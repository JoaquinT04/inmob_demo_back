# Arquitectura de inmob_demo_back — Guía técnica personal

Este documento es tuyo. Explica **por qué** cada decisión técnica fue tomada, cómo funciona cada sistema internamente, y qué trampas encontramos en el camino. No es un README para terceros — es el mapa mental del proyecto.

---

## 1. Estructura del monorepo

```
inmob_demo_back/
├── apps/
│   └── api/              → @inmob/api       (Fastify server, rutas, middleware)
├── packages/
│   ├── database/         → @inmob/database  (entidades MikroORM, migraciones, seeds)
│   └── shared/           → @inmob/shared    (tipos, constantes, schemas — isomórfico)
└── pnpm-workspace.yaml
```

**Por qué monorepo con pnpm workspaces:**

- `@inmob/shared` se importa desde el API y también lo va a importar el frontend. Un solo lugar para tipos TypeScript y schemas Zod → nunca hay drift entre front y back.
- `@inmob/database` exporta las entidades MikroORM. Si mañana agregás un CLI de seed o una lambda, importan el mismo paquete sin duplicar modelos.
- pnpm workspaces con `catalog:` (pnpm 10) permite definir versiones de dependencias una vez en el root `package.json` y referenciarlas desde los paquetes hijos. Si actualizás Zod, lo hacés en un lugar.

---

## 2. Runtime y módulos ESM

El proyecto usa **ESM nativo** (`"type": "module"` en todos los `package.json`). Esto significa:

- Todos los imports en `.ts` llevan extensión `.js` (el compilador TS no la cambia, Node la resuelve al `.js` compilado).
- `__dirname` y `__filename` no existen → hay que reconstruirlos con `import.meta.url`:
  ```typescript
  import { dirname } from 'path';
  import { fileURLToPath } from 'url';
  const __dirname = dirname(fileURLToPath(import.meta.url));
  ```
- **tsx** ejecuta TypeScript directamente con esbuild sin compilar a disco. Rápido en dev. Pero esbuild no emite decorator metadata — tiene consecuencias importantes (ver sección MikroORM).

---

## 3. Sistema de autenticación

### 3.1 El flujo completo

```
POST /api/auth/login
  body: { email, tenantSlug, password }
    → busca User por email + tenant.slug
    → bcrypt.compare(password, user.passwordHash)
    → signToken({ userId, tenantId })          ← jose HS256
    → devuelve { token, user, permissions }

Requests autenticados:
  Authorization: Bearer <token>
    → requireAuth middleware
    → jwtVerify(token, APP_SECRET)             ← jose
    → request.auth = { userId, tenantId }
```

### 3.2 Por qué jose (no jsonwebtoken)

`jsonwebtoken` usa `crypto` síncrono de Node y no es amigable con ESM. `jose` es moderno, async-first, compatible con Web Crypto API, y tiene soporte nativo para ESM. El algoritmo es HS256 (HMAC-SHA256) — simétrico, suficiente para MVP.

### 3.3 AuthContext

```typescript
interface AuthContext {
  userId: string;    // ID interno de la DB
  tenantId: string;  // ID del tenant → aísla todos los datos
  externalId?: string; // Reservado para Clerk/Auth0 (sub del JWT externo)
}
```

Todo handler con `requireAuth` tiene `request.auth` garantizado. Si mañana cambiás a Clerk, solo cambia la función `verifyAppToken` — los handlers no se tocan porque `request.auth` mantiene la misma forma.

### 3.4 Modo desarrollo (`requireAuthDev`)

Headers especiales para no necesitar token en curl/Postman:
```bash
curl -H "x-dev-user-id: <id>" -H "x-dev-tenant-id: <id>" http://localhost:3001/api/...
```
Solo activo cuando `NODE_ENV=development`. La función `requireAuthDev` hace early-return si los headers están presentes, si no cae a `requireAuth` normal.

---

## 4. MikroORM — Decisiones profundas

### 4.1 Por qué TsMorphMetadataProvider

MikroORM necesita metadata de los decorators TypeScript para saber cómo mapear clases a tablas: tipos de columnas, relaciones, etc.

La forma clásica (`ReflectMetadataProvider`) requiere `emitDecoratorMetadata: true` en tsconfig, que hace que tsc emita código extra con `Reflect.metadata(...)`. **tsx (que usamos en dev) usa esbuild — esbuild ignora completamente `emitDecoratorMetadata`**. Resultado: MikroORM no podría leer los metadatos en runtime.

La solución: `TsMorphMetadataProvider` de `@mikro-orm/reflection`. Este provider **lee los archivos `.ts` directamente** (no el JS compilado) usando ts-morph para extraer tipos estáticos. En vez de depender de metadatos en runtime, parsea el código fuente en tiempo de inicialización. Genera un caché en `temp/` (`.json` por entidad) para no re-parsear en cada arranque.

```typescript
import { TsMorphMetadataProvider } from '@mikro-orm/reflection';

export default defineConfig({
  metadataProvider: TsMorphMetadataProvider,
  // ...
});
```

**Implicación importante:** Si borrás los archivos en `temp/` (o no existen), MikroORM re-parsea todas las entidades al arrancar. Esto es lento la primera vez (~2-3 segundos) pero después usa el caché.

### 4.2 Identity Map y el bug del "skeleton entity"

Este fue el bug más sutil del proyecto. Entenderlo es clave para cualquier app MikroORM.

**Qué es el Identity Map:**
MikroORM tiene un "Unit of Work" pattern. Cada `em` (entity manager) mantiene un mapa de entidades ya cargadas, indexadas por clase + PK. Si pedís `em.findOne(Tenant, id)` y ese tenant ya está en el mapa, **no hace query a la DB — devuelve el objeto del mapa**.

**El problema:**
Cuando cargás un `User` con `em.findOne(User, ...)`, MikroORM necesita construir la referencia a `Tenant` (porque `User` tiene `@ManyToOne(() => Tenant)`). Para no hacer una query extra, crea un **skeleton entity**: un objeto `Tenant` con solo el PK cargado y el resto de las propiedades como undefined/defaults de clase.

Luego, si en el mismo `em` hacés `em.findOne(Tenant, { id: tenantId })`, MikroORM ve el skeleton en el identity map y lo devuelve **sin hacer query**. Tenés un Tenant "válido" pero con `name: undefined`, `slug: undefined`, etc.

**Dónde apareció:**
En `POST /api/settings/users` (invitar usuario). El request pasa por `requireAuth` (que carga el User del token) y luego el handler necesita el Tenant para crear el nuevo User. El tenant cargado era un skeleton.

**La solución:**
```typescript
let tenant = await em.findOne(Tenant, { id: tenantId });
if (!tenant || !tenant.name) {
  // skeleton detectado → forzar recarga desde DB
  tenant = await em.refresh(tenant ?? em.getReference(Tenant, tenantId))
            ?? await em.findOneOrFail(Tenant, { id: tenantId });
}
```

`em.refresh(entity)` fuerza una query a la DB aunque el entity esté en el identity map. Es el antídoto correcto para skeletons.

### 4.3 Por qué `em.fork()`

Cada request HTTP **debe usar su propio fork del entity manager**. El `app.orm.em` es el EM raíz, que no debería usarse directamente en handlers concurrentes (su identity map se contaminaría entre requests).

`em.fork()` crea un EM hijo con identity map propio, hereda la conexión del pool pero tiene estado independiente. Al terminar el handler, el fork se descarta junto con todos sus objetos en memoria.

```typescript
const em = app.orm.em.fork();  // ← siempre en el handler, nunca el em raíz
```

### 4.4 Relación OneToOne — quién es el "owning side"

En MikroORM (y en SQL), en una relación OneToOne **uno de los dos lados tiene la FK en su tabla**. Ese es el "owning side". El otro lado es el "inverse side".

```
subscriptions table: tiene columna tenant_id (FK → tenants.id)
```

Por eso:
- **Owning side** = `Subscription` → `@OneToOne(() => Tenant, { inversedBy: 'subscription', ref: true })`
- **Inverse side** = `Tenant` → `@OneToOne(() => Subscription, { mappedBy: 'tenant', nullable: true })`

Regla: `inversedBy` va en el lado que tiene la FK. `mappedBy` va en el lado que no tiene FK.

Si los ponés al revés, MikroORM genera migraciones incorrectas o lanza errores de "owning side not set".

### 4.5 `type: 'string'` en campos enum

MikroORM, si no le decís el tipo explícitamente, intenta inferirlo del tipo TypeScript. Para campos con tipo `string` pero que en la entidad son enums (`PropertyType`, `OperationType`, etc.), la inferencia puede generar `varchar` con CHECK constraints o incluso `enum` nativo de PostgreSQL.

Para evitar inconsistencias, todos los campos que son strings pero de tipo enum llevan `type: 'string'` explícito:

```typescript
@Prop({ type: 'string' })
type!: PropertyType;
```

Esto le dice a MikroORM: "en la DB es varchar, sin magia extra".

### 4.6 `createInitialMigration()` vs `createMigration()`

`createMigration()` compara el estado actual de la DB contra los metadatos de las entidades y genera el **diff**. Si la DB está vacía (primera vez), el diff puede salir vacío dependiendo de cómo el migrator detecta el estado base.

`createInitialMigration()` ignora el estado de la DB y genera el SQL completo para crear todas las tablas desde cero. Ideal para el primer migration de un proyecto nuevo.

```bash
# Primera vez: usar --initial
pnpm db:migrate:create init --initial

# Cambios posteriores: usar el nombre
pnpm db:migrate:create add-campo-xyz
```

---

## 5. Sistema de permisos — 5 capas

Inspirado en el sistema de grupos de Odoo. Es el corazón del RBAC de la app.

### 5.1 Las capas explicadas

```
Capa 1: base:user (implícita, siempre)
  → property:read, contact:read, hub:read
  → Todo usuario autenticado tiene esto. No se puede quitar.

Capa 2: RolePermissions[rol] (baseline del rol)
  → captador: property:create, property:read, property:update, hub:read
  → agente: + contact:*, crm:*, agenda:*, hub:publish
  → coordinador: + property:delete, contact:delete, report:*, user:read
  → administrador: + todo excepto billing
  → owner: billing incluido

Capa 3: tenant.permissionConfig.roleOverrides (el admin configura por rol)
  → Ejemplo: para todos los "agente" en esta inmobiliaria, agregar report:read
  → Stored en Tenant.permissionConfig (JSON en DB)
  → grant/deny por rol, sin tocar la baseline global

Capa 4: user.groups (grupos adicionales del usuario)
  → Un captador con grupo 'report:viewer' puede ver reportes
  → Los grupos tienen herencia: property:manager implica property:editor implica property:viewer
  → Stored en User.groups (JSON array en DB)

Capa 5: user.permissionOverrides (máxima granularidad, deny gana sobre todo)
  → grant: ['crm:read'] — dar un permiso puntual a este usuario
  → deny: ['property:delete'] — bloquear un permiso aunque el rol lo tenga
  → deny tiene prioridad absoluta (se aplica al final)
```

### 5.2 Código de resolución

```typescript
// apps/api/src/utils/permissions.ts
export function resolvePermissions(user: UserLike, tenantConfig?): Set<Permission> {
  // Capa 1
  const effective = resolveGroupPermissions(SG.BASE_USER);

  // Capa 2
  const role = user.roles[0];
  for (const p of RolePermissions[role] ?? []) effective.add(p);

  // Capa 3
  const override = tenantConfig?.roleOverrides?.[role];
  if (override) {
    for (const p of override.grant ?? []) effective.add(p);
    for (const p of override.deny ?? []) effective.delete(p);  // ← delete, no skip
  }

  // Capa 4
  for (const groupId of user.groups ?? []) {
    for (const p of resolveGroupPermissions(groupId)) effective.add(p);
  }

  // Capa 5 (deny al final = prioridad absoluta)
  if (user.permissionOverrides) {
    for (const p of user.permissionOverrides.grant ?? []) effective.add(p);
    for (const p of user.permissionOverrides.deny ?? []) effective.delete(p);
  }

  return effective;
}
```

**Por qué Set:** operaciones O(1) para has/add/delete. El set final se convierte a array solo cuando hace falta (para serializar en respuesta o para listar).

### 5.3 Herencia de grupos

```typescript
// packages/shared/src/constants/roles-permissions.ts
export function resolveGroupPermissions(groupId, visited = new Set()): Set<Permission> {
  if (visited.has(groupId)) return new Set(); // evita ciclos
  visited.add(groupId);

  const def = GroupDefinitions[groupId];
  const result = new Set(def.permissions);

  for (const implied of def.impliedGroups ?? []) {
    for (const p of resolveGroupPermissions(implied, visited)) {
      result.add(p);
    }
  }
  return result;
}
```

El `visited` Set es protección contra ciclos teóricos. La herencia es aditiva: property:manager incluye todo lo de property:editor que incluye todo lo de property:viewer.

### 5.4 Secciones de menú como permisos deny

Los ítems del menú del frontend se controlan con "deny overrides" de tipo `menu:xxx`:

```
user.permissionOverrides.deny = ['menu:reports', 'menu:settings']
```

El layout del frontend filtra la navegación según esto. No hay un sistema separado de visibilidad — se reutiliza la misma capa 5 de permisos. Simple y extensible.

### 5.5 Middleware `requirePermission`

```typescript
// En una ruta:
{ preHandler: [requireAuth, requirePermission('property:create')] }

// El middleware:
// 1. Carga el User desde la DB usando request.auth.userId
// 2. Verifica que pertenece al tenant correcto
// 3. Carga el Tenant para obtener permissionConfig
// 4. Llama resolvePermissions(user, tenant.permissionConfig)
// 5. Si el permiso no está → 403
// 6. Si está → pone request.currentUser para evitar re-query en el handler
```

---

## 6. Ciclo de vida de la suscripción

### 6.1 Estados y transiciones

```
Registro
    ↓
TRIALING (plan FREE, trialEndsAt = hoy + TRIAL_DAYS)
    ↓ (pago exitoso)
ACTIVE (plan actualizado, currentPeriodEnd = hoy + 30d)
    ↓ (pago falla)
PAST_DUE (período de gracia, acceso normal + header X-Billing-Warning)
    ↓ (no paga en 7 días)
EXPIRED → tenant.status = SUSPENDED (solo lectura)
    ↓ (cancela activamente)
CANCELLED (activa hasta currentPeriodEnd, luego EXPIRED)
```

### 6.2 Enforcement en middleware

El middleware `checkLicense` (en `apps/api/src/middleware/license.ts`) se ejecuta **en cada request relevante** (no en health check ni endpoints públicos).

Lógica de acceso por estado de cuenta:

| tenant.status | GET | POST/PATCH/DELETE |
|---------------|-----|-------------------|
| TRIAL / ACTIVE | ✅ | ✅ |
| SUSPENDED | ✅ | ❌ 403 ACCOUNT_SUSPENDED |
| CANCELLED | ❌ 403 | ❌ 403 |

Para TRIALING: si `trialEndsAt < now`, automáticamente:
1. `tenant.status = SUSPENDED`
2. `sub.status = EXPIRED`
3. `em.flush()` — persiste en DB
4. Responde 402 TRIAL_EXPIRED

El header `X-Trial-Days-Left` lo setea el middleware cuando el trial está activo. El frontend lo usa para mostrar un contador en la navbar.

### 6.3 Enforcement de límites por plan

```typescript
// Factory que genera un preHandler:
enforcePlanLimit('maxProperties', (tenantId, em) => {
  return em.count(Property, { tenant: { id: tenantId } });
})

// Uso en ruta:
{ preHandler: [requireAuth, checkLicense, enforcePlanLimit('maxProperties', countFn), requirePermission('property:create')] }
```

`PlanLimits` en `@inmob/shared` define los límites por plan. `-1` = sin límite (ENTERPRISE). El middleware hace el count y compara contra el límite del plan del tenant.

---

## 7. Registro atómico (transacción única)

`POST /api/register` crea tres entidades en una sola transacción:

```typescript
await em.begin();
try {
  const tenant = em.create(Tenant, { ... });
  const subscription = em.create(Subscription, { tenant: tenant as never, ... });
  const owner = em.create(User, { clerkId: tempId, tenant: tenant as never, ... });
  
  await em.flush();  // INSERT las tres entidades
  
  // El clerkId es un "chicken and egg": necesitamos el ID de la DB para usarlo como clerkId
  // En MVP: clerkId = userId (autorreferencia). En prod: Clerk devuelve su propio ID
  owner.clerkId = owner.id;
  await em.flush();
  await em.commit();
} catch (err) {
  await em.rollback();
  throw err;
}
```

**Por qué `tenant as never` en las relaciones:**
MikroORM espera `Ref<Tenant>` (una referencia lazy), pero `em.create()` acepta la entidad directamente y la convierte internamente. El cast `as never` es un hack necesario para satisfacer el tipo de TypeScript sin perder la ergonomía de `em.create()`. En runtime funciona correctamente.

**Por qué `clerkId` se auto-referencia:**
El campo `clerkId` es el puente diseñado para conectar con Clerk. En producción, Clerk devuelve su propio `sub` (ej: `user_2abc...`) y ese valor va en `clerkId`. En MVP, como no hay Clerk, usamos el propio UUID de la DB. El patrón: crear con UUID temporal → flush → sobreescribir con el ID real → flush de nuevo.

---

## 8. Multi-tenancy

### 8.1 El @Filter de MikroORM

Todas las entidades de negocio (Property, Contact, Lead, Agenda, PortalConnection, User) tienen un filtro declarativo:

```typescript
@Filter({
  name: 'byTenant',
  cond: (args: { tenantId: string }) => ({ tenant: { id: args.tenantId } }),
  default: false,  // ← no se aplica por defecto
})
```

Con `default: false`, el filtro no se activa automáticamente. Hay que activarlo explícitamente:

```typescript
em.addFilter('byTenant', { tenantId: request.auth!.tenantId });
// Ahora TODAS las queries de ese em solo ven datos de ese tenant
```

**En esta implementación MVP**, las rutas no usan `addFilter` — agregan la condición `{ tenant: { id: tenantId } }` directamente en cada `findOne`/`find`. Esto es más explícito y fácil de razonar para un MVP. El filtro está declarado para uso futuro cuando haya más rutas y la consistencia sea más crítica.

### 8.2 Aislamiento por tenantId en el token

El `tenantId` viene del JWT. El usuario **no puede** cambiar su tenantId — está firmado con `APP_SECRET`. Cada query usa ese `tenantId` para filtrar. No hay forma de ver datos de otro tenant sin comprometer el secreto del servidor.

---

## 9. Migraciones

### 9.1 Estructura

```
packages/database/src/migrations/
├── .snapshot-inmob_db.json          ← snapshot del schema actual (para calcular diffs)
└── Migration20260419145701.ts       ← migración inicial (todas las tablas)
```

El snapshot JSON es el "estado conocido" de la DB. Cuando generás una nueva migración, MikroORM compara las entidades actuales contra este snapshot para calcular el diff.

### 9.2 Comandos

```bash
# Primera migración (schema completo desde cero):
pnpm db:migrate:create init --initial

# Migración incremental (después de cambiar una entidad):
pnpm db:migrate:create nombre-descriptivo

# Aplicar migraciones pendientes:
pnpm db:migrate

# Revertir última migración:
pnpm db:migrate:down
```

### 9.3 Por qué el script tiene `--initial`

```typescript
// packages/database/src/scripts/migrate-create.ts
const initial = process.argv[3] === '--initial';
if (initial) {
  await migrator.createInitialMigration('./src/migrations');
} else {
  await migrator.createMigration(undefined, false, false, name);
}
```

`createMigration()` puede devolver un diff vacío si la DB está vacía y el migrator considera que no hay cambios respecto al "último estado conocido" (que podría ser vacío también). `createInitialMigration()` fuerza la generación del SQL completo sin comparar con estado previo.

---

## 10. dotenv y el problema de paths relativos

Un problema clásico en monorepos: ¿desde dónde se ejecuta el proceso?

El `.env` está en la raíz del monorepo. Cuando `packages/database/src/config.ts` hace `dotenv.config()` sin argumentos, busca `.env` en el CWD (current working directory), que en pnpm es la raíz del monorepo. **Funciona** cuando ejecutás desde la raíz.

Pero cuando el migrator ejecuta scripts directamente desde `packages/database/`, el CWD cambia. La solución robusta: calcular el path absoluto relativo al archivo `.ts`:

```typescript
import dotenv from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

// Este archivo está en packages/database/src/config.ts
// ../../.. lleva a la raíz del monorepo
dotenv.config({
  path: resolve(dirname(fileURLToPath(import.meta.url)), '../../../.env')
});
```

`import.meta.url` devuelve la URL del módulo actual (`file:///...`). `fileURLToPath` convierte a path del sistema. A partir de ahí, `../../../` es siempre la raíz del monorepo, sin importar desde dónde ejecutás.

---

## 11. Fastify — Decisiones de diseño

### 11.1 Plugin system y registro de rutas

```typescript
// apps/api/src/app.ts
app.register(registerRoutes, { prefix: '/api/register' });
app.register(authRoutes, { prefix: '/api/auth' });
app.register(propertiesRoutes, { prefix: '/api/properties' });
// ...
```

Fastify usa un sistema de plugins con encapsulación. Cada `register()` crea un scope aislado. Las rutas dentro de ese scope heredan el prefijo. El `preHandler` se puede definir por scope o por ruta individual.

### 11.2 Decorador `app.orm`

```typescript
// app.ts
app.decorate('orm', orm);

// En cualquier handler:
const em = request.server.orm.em.fork();
```

`app.decorate()` agrega propiedades al objeto Fastify. Es el mecanismo estándar para compartir recursos (DB, cache, etc.) entre plugins. TypeScript lo conoce porque en `app.ts` extendemos la interfaz:

```typescript
declare module 'fastify' {
  interface FastifyInstance {
    orm: MikroORM;
  }
}
```

### 11.3 Error handler global

```typescript
app.setErrorHandler((error: Error & { statusCode?: number }, _req, reply) => {
  const statusCode = error.statusCode ?? 500;
  app.log.error(error);
  return reply.status(statusCode).send({
    error: statusCode >= 500 ? 'Error interno del servidor' : error.message,
  });
});
```

El cast `Error & { statusCode?: number }` es necesario porque Fastify puede generar errores con `statusCode` (ej: payload demasiado grande) pero el tipo base `Error` no lo tiene. Sin el cast, TypeScript se queja.

---

## 12. Seed de desarrollo

```
packages/database/src/seeds/run.ts
```

Crea en orden:
1. `Tenant` "inmob-demo"
2. `Subscription` TRIALING (30 días desde hoy)
3. 5 `User` con roles distintos (owner, administrador, coordinador, agente, captador)

**Usuarios disponibles después del seed:**

| Email | Password | Rol |
|-------|----------|-----|
| owner@demo.com | owner123 | owner |
| admin@demo.com | admin123 | administrador |
| coordinador@demo.com | coord123 | coordinador |
| agente@demo.com | agente123 | agente |
| captador@demo.com | capt123 | captador |

El seed hace `em.findOne(Tenant, { slug: 'inmob-demo' })` primero — si ya existe, no hace nada (idempotente).

---

## 13. Patrones a seguir al agregar código nuevo

### Agregar una entidad nueva

1. Crear `packages/database/src/entities/NombreEntidad.entity.ts`
2. Agregar `@Filter({ name: 'byTenant', ... })` si pertenece a un tenant
3. Exportar desde `packages/database/src/entities/index.ts`
4. Registrar en `packages/database/src/config.ts` → `entities: [...]`
5. Ejecutar `pnpm db:migrate:create nombre-entidad`
6. Verificar la migración generada antes de ejecutarla

### Agregar una ruta nueva

1. Crear `apps/api/src/routes/feature/index.ts`
2. Registrar en `apps/api/src/app.ts` con `app.register(featureRoutes, { prefix: '/api/feature' })`
3. Usar `preHandler: [requireAuth, requirePermission('resource:action')]`
4. Si crea recursos limitados por plan: agregar `enforcePlanLimit('maxX', countFn)` antes del handler
5. Agregar el permiso al `RolePermissions` correspondiente en `@inmob/shared` si es nuevo

### Agregar un permiso nuevo

1. En `packages/shared/src/constants/roles-permissions.ts`:
   - Agregar a `Resource` o `Action` si es un nuevo tipo
   - Agregar al `RolePermissions` de los roles que lo necesitan
   - Si es un grupo nuevo: agregar a `SystemGroup` y a `GroupDefinitions`
2. Generar migración si se cambia `permissionConfig` del schema de Tenant

---

## 14. Problemas conocidos y pendientes

### Pendiente: Webhook Clerk

`user.clerkId` actualmente es el propio `user.id` (autorreferencia). Al integrar Clerk:
1. En `POST /api/register`: crear el usuario en Clerk primero, usar `clerkUser.id` como `clerkId`
2. Agregar webhook `POST /api/webhooks/clerk` para `user.created` / `user.updated` / `user.deleted`
3. El middleware `requireAuth` verificaría el JWT de Clerk con `CLERK_SECRET_KEY`

### Pendiente: Integración de pagos

`subscriptions.ts` tiene marcadores `// TODO: Stripe` y `// TODO: MercadoPago`. La tabla `Subscription` ya tiene `externalSubscriptionId` y `externalCustomerId` para el vínculo con el proveedor.

Idempotencia del webhook: `lastWebhookEvent` + `lastWebhookAt`. Si llega el mismo evento en menos de 5 minutos, se ignora (previene procesamiento duplicado de webhooks).

### Pendiente: `allowGlobalContext: false`

Está en `config.ts`. Significa que si accidentalmente usás `app.orm.em` sin hacer `fork()` en un handler concurrente, MikroORM lanza un error. Es una red de seguridad — si ves ese error, significa que olvidaste el `em.fork()` en algún handler.

---

## 15. Resumen mental del flujo de un request típico

```
1. Request entra a Fastify
2. @fastify/helmet agrega headers de seguridad
3. @fastify/cors verifica origen
4. requireAuth: verifica JWT → request.auth = { userId, tenantId }
5. checkLicense: verifica estado del tenant/suscripción
6. requirePermission('recurso:accion'):
     → carga User de la DB (o usa request.currentUser si ya está)
     → carga Tenant para permissionConfig
     → resolvePermissions() → set de permisos efectivos
     → si no tiene el permiso: 403
7. Handler: lógica de negocio con em.fork()
8. em.flush(): persiste cambios en DB
9. reply.send(): serializa respuesta
10. Error handler (si algo falla en cualquier paso)
```

Cada middleware es una función `async (request, reply)` que hace `reply.send(error)` para cortocircuitar el chain, o retorna undefined para dejar pasar al siguiente.
