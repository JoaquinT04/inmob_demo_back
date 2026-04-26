# Arquitectura de inmob_demo_back — Guía técnica

Este documento explica **por qué** cada decisión técnica fue tomada, cómo funciona cada sistema internamente y qué trampas encontramos. Es el mapa mental del proyecto — para leer antes de tocar código.

---

## 1. Modelo multi-tenant: DB por tenant

### Qué es y por qué

Cada inmobiliaria tiene su **propia base de datos PostgreSQL aislada**. No hay columna `tenant_id`, no hay `@Filter byTenant`, no hay `WHERE tenant_id = ?` en ninguna query.

```
                    ┌──────────────────┐
                    │   Platform DB    │   inmob_platform
                    │  TenantRegistry  │   (un registro por tenant)
                    │  HubProperty     │   (índice cross-tenant)
                    └────────┬─────────┘
                             │ databaseUrl por tenant
          ┌──────────────────┼──────────────────┐
          ▼                  ▼                  ▼
   ┌─────────────┐   ┌─────────────┐   ┌─────────────┐
   │  DB: demo   │   │  DB: garcia │   │  DB: lopez  │
   │  (Neon)     │   │  (Neon)     │   │  (Neon)     │
   │  Tenant     │   │  Tenant     │   │  Tenant     │
   │  Users      │   │  Users      │   │  Users      │
   │  Properties │   │  Properties │   │  Properties │
   └─────────────┘   └─────────────┘   └─────────────┘
```

**Ventajas sobre el modelo de DB compartida:**
- Aislamiento total: una query mal escrita nunca puede leer datos de otro tenant.
- Migrations independientes: se pueden hacer upgrades de schema por tenant sin bloquear a todos.
- Backup/restore por tenant: fácil de implementar.
- Cumplimiento de privacidad: datos nunca coexisten en la misma tabla.

---

## 2. Estructura del monorepo

```
inmob_demo_back/
├── apps/
│   └── api/              → @inmob/api        (Fastify server, rutas, middleware)
├── packages/
│   ├── database/         → @inmob/database   (entidades + migraciones de tenant DB)
│   ├── platform/         → @inmob/platform   (entidades + migraciones de platform DB + provisioner)
│   └── shared/           → @inmob/shared     (tipos, constantes, schemas — isomórfico)
└── pnpm-workspace.yaml
```

**Por qué 4 paquetes:**
- `@inmob/shared`: importado por API y frontend. Un solo lugar para tipos TypeScript y schemas Zod. Nunca hay drift entre front y back.
- `@inmob/database`: entidades de la DB de cada tenant (Tenant, User, Property, Contact, etc.).
- `@inmob/platform`: entidades de la Platform DB (TenantRegistry, HubProperty) y el provisioner que crea nuevas inmobiliarias.
- `@inmob/api`: el servidor Fastify. Importa los tres paquetes anteriores.

---

## 3. Subdomain routing hook

### El problema

Con DB-per-tenant, cada request debe usar el ORM de la DB correcta. El hook `apps/api/src/hooks/tenant-routing.ts` resuelve esto automáticamente en cada request.

### Cómo funciona

```
Request → onRequest hook
  │
  ├─ ¿Es /api/portal, /api/register, /health? → skip (no necesitan tenant)
  │
  ├─ ¿Tiene header X-Tenant: demo? → subdomain = "demo"  (dev / frontend sin DNS)
  │
  ├─ ¿No tiene X-Tenant? → tomar subdomain del hostname (demo.app.com → "demo")
  │
  ├─ Buscar en Platform DB: TenantRegistry.where(subdomain = "demo")
  │     → No existe: 404 TENANT_NOT_FOUND
  │     → Existe: registry.databaseUrl = "postgres://..."
  │
  └─ request.orm = connectionManager.get(registry.databaseUrl)
       (ORM cacheado — no reconecta si ya existe)
```

### Por qué el header X-Tenant tiene prioridad

En producción, el subdominio viene del DNS wildcard (`*.app.com`). En desarrollo local, no se pueden usar subdominios reales. El header `X-Tenant: demo` es el sustituto — el frontend lo envía en todos los requests y la API funciona igual que en producción.

### Código relevante

```typescript
// apps/api/src/hooks/tenant-routing.ts
const headerTenant = request.headers['x-tenant'] as string | undefined;
const host = request.hostname;
const parts = host.split('.');
const hostSubdomain = parts.length >= 2 && parts[0] !== 'www' ? parts[0] : null;
const subdomain = headerTenant ?? hostSubdomain;  // header tiene prioridad
```

---

## 4. TenantConnectionManager (connection caching)

`apps/api/src/lib/connection-manager.ts` mantiene un `Map<databaseUrl, MikroORM>`. Cuando llega un request para "demo", la primera vez crea el ORM y lo cachea. Las siguientes requests del mismo tenant reutilizan el mismo ORM — mismo pool de conexiones, sin overhead de reconexión.

```typescript
class TenantConnectionManager {
  private cache = new Map<string, MikroORM>();

  async get(databaseUrl: string): Promise<MikroORM> {
    if (this.cache.has(databaseUrl)) return this.cache.get(databaseUrl)!;
    const orm = await MikroORM.init({ clientUrl: databaseUrl, ... });
    this.cache.set(databaseUrl, orm);
    return orm;
  }

  async closeAll(): Promise<void> {
    for (const orm of this.cache.values()) await orm.close();
  }
}
```

El `closeAll()` se llama en el graceful shutdown del proceso para no dejar conexiones colgadas.

---

## 5. Dos ORMs en paralelo

`apps/api/src/app.ts` decora la instancia Fastify con dos ORMs:

| ORM | Decorador | Qué DB apunta | Para qué se usa |
|-----|-----------|---------------|-----------------|
| `platformOrm` | `app.platformOrm` | Platform DB | TenantRegistry, HubProperty, billing |
| `orm` (legacy) | `app.orm` | Tenant DB de dev | Solo usado en startup/seed |
| `request.orm` | por request | DB del tenant activo | Todos los handlers de negocio |

Regla práctica para el frontend: **no necesita saber nada de esto**. Solo manda el header `X-Tenant` y el backend resuelve todo.

Regla para el código backend:
- Handlers de negocio (propiedades, contactos, etc.): usar `request.orm.em.fork()`
- Handlers de portal y billing: usar `app.platformOrm.em.fork()`

---

## 6. Sistema de autenticación

### Flujo completo

```
POST /api/auth/login
  headers: { X-Tenant: demo }
  body: { email, password }
    → El hook ya puso request.orm = ORM del tenant "demo"
    → busca User por email en esa DB
    → bcrypt.compare(password, user.passwordHash)
    → signToken({ userId, subdomain: "demo" })   ← jose HS256
    → devuelve { token, user, permissions }

Requests autenticados:
  Authorization: Bearer <token>
  X-Tenant: demo
    → requireAuth middleware
    → jwtVerify(token, APP_SECRET)
    → request.auth = { userId, subdomain: "demo" }
```

### Por qué subdomain en el JWT (no tenantId)

El JWT ahora lleva `{ userId, subdomain }` en lugar de `{ userId, tenantId }`. El `subdomain` es suficiente para identificar el tenant — el hook ya tiene el ORM resuelto de todos modos. Además, el subdomain es legible para debug, mientras que un UUID no lo es.

### Modo desarrollo (`requireAuthDev`)

Headers especiales para tests sin hacer login:
```bash
curl -H "x-dev-user-id: <id>" -H "x-dev-subdomain: demo" http://localhost:3001/api/...
```
Solo activo cuando `NODE_ENV=development`.

---

## 7. Entidades — dos categorías

### Platform DB (`@inmob/platform`)

| Entidad | Tabla | Descripción |
|---------|-------|-------------|
| `TenantRegistry` | `tenant_registry` | Una fila por inmobiliaria. Tiene `subdomain`, `databaseUrl`, `plan`, billing state. |
| `HubProperty` | `hub_properties` | Índice cross-tenant de propiedades publicadas. Desnormalizado para búsquedas rápidas. |

### Tenant DB (`@inmob/database`)

| Entidad | Tabla | Descripción |
|---------|-------|-------------|
| `Tenant` | `tenants` | Una sola fila por DB. Nombre, config, permissionConfig. |
| `User` | `users` | Usuarios de esa inmobiliaria. Roles, grupos, overrides. |
| `Property` | `properties` | Propiedades. |
| `Contact` | `contacts` | Contactos / clientes / propietarios. |
| `Lead` | `leads` | Oportunidades CRM con historial (JSON). |
| `Agenda` | `agenda_events` | Eventos de calendario. |
| `PortalConnection` | `portal_connections` | Credenciales de portales externos (Zonaprop, ML). |

**No hay `@Filter byTenant`**: era necesario en el modelo de DB compartida para aislar datos por `tenant_id`. Con DB-per-tenant, esa columna y ese filtro no existen. Las queries son directas:

```typescript
// Antes (DB compartida):
em.find(Property, { tenant: { id: tenantId } })

// Ahora (DB por tenant):
em.find(Property, {})   // la DB solo tiene datos de un tenant
```

---

## 8. Provisioner — crear una nueva inmobiliaria

`packages/platform/src/provisioner/provision.ts` hace todo el onboarding en un solo call:

```
provision(input, platformOrm)
  │
  ├─ 1. Crear DB Neon via API REST (NEON_API_KEY)
  │      → Retorna databaseUrl de la nueva DB
  │
  ├─ 2. Conectar a esa DB y ejecutar migraciones
  │      → Crea todas las tablas del schema de tenant
  │
  ├─ 3. Crear fila Tenant en la nueva DB
  │
  ├─ 4. Crear User owner con bcrypt(password)
  │
  ├─ 5. Registrar en Platform DB: TenantRegistry
  │      → subdomain, name, databaseUrl, ownerEmail, plan: FREE, trialEndsAt
  │
  └─ 6. Firmar JWT { userId, subdomain }
         → Retorna { subdomain, databaseUrl, ownerId, token }
```

En **desarrollo local**, Neon no está disponible. El seed de desarrollo crea manualmente el tenant "demo" en la Docker DB local y lo registra en la platform DB.

---

## 9. MikroORM — decisiones profundas

### TsMorphMetadataProvider (no ReflectMetadata)

MikroORM necesita metadata de los decorators. La forma clásica (`ReflectMetadataProvider`) requiere `emitDecoratorMetadata: true` en tsconfig, que hace que tsc emita `Reflect.metadata(...)`. **Problema**: tsx (que usamos en dev) usa esbuild, que ignora `emitDecoratorMetadata`.

Solución: `TsMorphMetadataProvider` de `@mikro-orm/reflection` **lee los archivos `.ts` directamente** con ts-morph en vez de depender de metadata en runtime. Genera un caché en `temp/` la primera vez (~2-3 segundos) y lo reutiliza.

**Implicación para connection-manager**: al crear ORMs dinámicos para los tenants, también se usa `TsMorphMetadataProvider`.

### `em.fork()` — obligatorio en cada handler

```typescript
const em = request.orm.em.fork();  // ← siempre, nunca usar el em raíz
```

`em.fork()` crea un entity manager hijo con identity map propio. Requests concurrentes no se contaminan entre sí. Al terminar el handler, el fork se descarta.

### `& Opt` en campos con defaults

MikroORM requiere que los campos con defaults en la entidad tengan el tipo marcado como `T & Opt` para no ser requeridos en `em.create()`:

```typescript
@Property({ default: false })
cancelAtPeriodEnd: boolean & Opt = false;  // ← & Opt es necesario
```

Sin `& Opt`, TypeScript se queja de que `cancelAtPeriodEnd` es required en `em.create(TenantRegistry, { ... })`.

---

## 10. Sistema de permisos (5 capas)

Inspirado en el sistema de grupos de Odoo.

```
Capa 1: base:user (implícita, siempre)
  → property:read, contact:read, hub:read
  → No se puede quitar.

Capa 2: RolePermissions[rol] (baseline del rol)
  → captador: property:create, read, update, hub:read
  → agente: + contact:*, crm:*, agenda:*, hub:publish
  → coordinador: + property:delete, report:*
  → administrador: + todo excepto billing
  → owner: billing incluido

Capa 3: tenant.permissionConfig.roleOverrides (admin configura por rol)
  → Stored en Tenant.permissionConfig (JSON en DB)
  → grant/deny por rol para toda la inmobiliaria
  → Configurable desde PUT /api/settings/permissions/roles

Capa 4: user.groups (grupos adicionales del usuario)
  → Un captador con grupo 'report:viewer' puede ver reportes
  → Los grupos tienen herencia: property:manager → property:editor → property:viewer
  → Stored en User.groups (JSON array)

Capa 5: user.permissionOverrides (máxima granularidad, deny gana sobre todo)
  → grant: ['crm:read']
  → deny: ['property:delete']
  → deny tiene prioridad absoluta (se aplica al final)
```

**Por qué Set:** operaciones O(1) para has/add/delete. El set se convierte a array solo para serializar.

**Menú como permisos deny:**

```typescript
user.permissionOverrides.deny = ['menu:reports', 'menu:hub']
```

El frontend filtra la navegación con esto. No hay sistema separado de visibilidad.

---

## 11. Ciclo de vida de la suscripción

El estado de billing vive en `TenantRegistry` de la Platform DB. No hay entidad `Subscription` separada — TenantRegistry tiene todos los campos necesarios:

| Campo | Descripción |
|-------|-------------|
| `plan` | FREE / PRO / ENTERPRISE |
| `status` | TRIAL / ACTIVE / SUSPENDED / CANCELLED |
| `subscriptionStatus` | TRIALING / ACTIVE / PAST_DUE / CANCELLED / EXPIRED |
| `trialEndsAt` | Fecha de vencimiento del trial |
| `currentPeriodEnd` | Fin del período pagado actual |
| `cancelAtPeriodEnd` | Si está programada la cancelación |
| `externalSubscriptionId` | ID del proveedor de pagos (Stripe/MP) |

### Estado de acceso

| TenantStatus | GET | POST/PUT/PATCH/DELETE |
|--------------|-----|----------------------|
| TRIAL / ACTIVE | ✅ | ✅ |
| SUSPENDED | ✅ | ❌ 403 ACCOUNT_SUSPENDED |
| CANCELLED | ❌ 403 | ❌ 403 |

Para TRIALING expirado: el middleware automáticamente setea `status = SUSPENDED`, `subscriptionStatus = EXPIRED` y responde 402 TRIAL_EXPIRED.

---

## 12. Flujo de un request típico

```
1. Request llega a Fastify
2. @fastify/helmet — headers de seguridad
3. @fastify/cors — verifica origen
4. onRequest hook (RequestContext MikroORM para Platform DB)
5. tenant-routing hook:
     → Lee X-Tenant header (o subdomain del hostname)
     → Busca TenantRegistry en Platform DB
     → request.orm = connectionManager.get(databaseUrl)
6. Handler de ruta:
     preHandler: [requireAuth, checkLicense, requirePermission('recurso:accion')]
       → requireAuth: verifica JWT → request.auth = { userId, subdomain }
       → checkLicense: verifica estado en TenantRegistry (Platform DB)
       → requirePermission: carga User de tenant DB → resolvePermissions()
7. Handler body: lógica de negocio con request.orm.em.fork()
8. em.flush(): persiste cambios en tenant DB
9. reply.send(): serializa respuesta
10. Error handler global si algo falla
```

---

## 13. Patrones a seguir al agregar código nuevo

### Agregar una entidad al tenant

1. Crear `packages/database/src/entities/NombreEntidad.entity.ts`
2. Sin `@Filter byTenant` — no es necesario en DB-per-tenant
3. Exportar desde `packages/database/src/entities/index.ts`
4. Registrar en `packages/database/src/config.ts` → `entities: [...]`
5. Ejecutar `pnpm db:migrate:create nombre-entidad`

### Agregar una ruta nueva

1. Crear `apps/api/src/routes/feature/index.ts`
2. Registrar en `apps/api/src/app.ts` con `app.register(featureRoutes, { prefix: '/api/feature' })`
3. Usar `preHandler: [requireAuth, requirePermission('resource:action')]`
4. Usar `request.orm.em.fork()` para queries de negocio
5. Si el endpoint es para el portal: usar `app.platformOrm.em.fork()` y registrar bajo `/api/portal`

### Agregar un permiso nuevo

1. En `packages/shared/src/constants/roles-permissions.ts`:
   - Agregar a `Resource` o `Action`
   - Agregar al `RolePermissions` de los roles correspondientes
   - Si es un grupo nuevo: agregar a `SystemGroup` y `GroupDefinitions`

---

## 14. Problemas conocidos y pendientes

### Webhook de pagos

`TenantRegistry` tiene `externalSubscriptionId`, `externalCustomerId`, `lastWebhookEvent`, `lastWebhookAt`. El webhook handler (`POST /api/subscriptions/webhook`) recibe eventos pero no llama aún a la API de Stripe/MercadoPago — está marcado con `// TODO`.

`lastWebhookEvent + lastWebhookAt` implementan idempotencia: si llega el mismo evento en menos de 5 minutos, se ignora para prevenir doble procesamiento.

### Provisioner en desarrollo local

En local no hay Neon. El provisioner (`provision.ts`) va a fallar si se llama en local. Para tests de registro, usar directamente el seed (`pnpm db:seed`) que crea el tenant "demo" manualmente.

### `allowGlobalContext: false`

Está en ambos `config.ts`. Si accidentalmente usás el em raíz sin `fork()` en un handler concurrente, MikroORM lanza error. Es una red de seguridad intencional — si ves ese error, falta el `fork()`.
