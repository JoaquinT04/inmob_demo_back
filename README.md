# inmob_demo_back

> Backend SaaS multi-tenant para plataforma inmobiliaria — gestión de propiedades, CRM, contactos, agenda y hub de colaboración entre inmobiliarias.

![Node](https://img.shields.io/badge/Node-≥24.0.0-brightgreen)
![pnpm](https://img.shields.io/badge/pnpm-10.33.0-orange)
![Fastify](https://img.shields.io/badge/Fastify-5.x-black)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-17-blue)
![TypeScript](https://img.shields.io/badge/TypeScript-6.x-blue)

---

## Stack tecnológico

| Capa | Tecnología | Versión |
|------|-----------|---------|
| Runtime | Node.js | >=24.0.0 |
| Package manager | pnpm (monorepo workspaces) | 10.33.0 |
| Framework HTTP | Fastify | ^5.3.3 |
| ORM | MikroORM | ^6.4.3 |
| Base de datos | PostgreSQL (Docker) | 17-alpine |
| Auth (producción) | Clerk | ^1.27.2 |
| Auth (desarrollo) | JWT local — jose (HS256) | ^6.2.2 |
| Hashing contraseñas | bcryptjs | ^3.0.3 |
| Validación de schemas | Zod | ^3.24.0 |
| Linter / Formatter | Biome | ^2.4.10 |
| TypeScript | TypeScript | ^6.0.2 |
| Logging | Pino + pino-pretty (dev) | built-in Fastify |
| Seguridad HTTP | @fastify/helmet + @fastify/cors | ^13.0.1 / ^10.0.2 |

---

## Arquitectura del monorepo

```
inmob_demo_back/
├── apps/
│   └── api/                      ← @inmob/api — Servidor Fastify
│       └── src/
│           ├── app.ts            ← Bootstrap, plugins, registro de rutas
│           ├── index.ts          ← Entry point (MikroORM init + listen)
│           ├── middleware/
│           │   ├── auth.ts       ← Autenticación (Clerk prod / JWT local dev)
│           │   ├── permissions.ts ← RBAC — requirePermission(), requireRole()
│           │   └── license.ts    ← Enforcement de plan/licencia
│           ├── routes/
│           │   ├── register.ts   ← Registro de nueva inmobiliaria
│           │   ├── auth.ts       ← Login / logout / me
│           │   ├── tenants.ts    ← Datos de la inmobiliaria
│           │   ├── subscriptions.ts ← Gestión de licencia/pago
│           │   ├── properties/   ← ABM de propiedades
│           │   ├── contacts/     ← Contactos
│           │   ├── crm/          ← Pipeline de leads
│           │   ├── agenda/       ← Calendario / eventos
│           │   └── settings/
│           │       ├── users.ts  ← Gestión de usuarios del tenant
│           │       └── permissions.ts ← Configuración de permisos
│           └── utils/
│               └── permissions.ts ← Resolución de permisos (5 capas)
│
├── packages/
│   ├── database/                 ← @inmob/database — MikroORM
│   │   └── src/
│   │       ├── config.ts         ← Configuración MikroORM + PostgreSQL
│   │       ├── entities/         ← Entidades (Tenant, User, Subscription, ...)
│   │       ├── migrations/       ← Migraciones generadas automáticamente
│   │       ├── scripts/          ← migrate-up/down/create/status
│   │       └── seeds/run.ts      ← Seed de datos de desarrollo
│   │
│   └── shared/                   ← @inmob/shared — Compartido frontend + backend
│       └── src/
│           ├── constants/
│           │   ├── plans.ts      ← TenantStatus, TenantPlan, PlanLimits, SubscriptionStatus
│           │   ├── roles-permissions.ts ← Roles, permisos, grupos
│           │   └── domain.ts     ← Enums de dominio (PropertyType, LeadStatus, ...)
│           ├── schemas/
│           │   └── register.schema.ts ← Zod schemas de registro
│           ├── types/            ← Interfaces TypeScript compartidas
│           └── utils/
│               └── slugify.ts    ← Genera slugs desde texto
│
└── docker/
    └── docker-compose.yml        ← PostgreSQL 17-alpine
```

---

## Explicación técnica

### 1. Sistema de autenticación

El middleware `auth.ts` opera en dos modos según la variable `DEV_BYPASS_AUTH`:

#### Modo desarrollo (`DEV_BYPASS_AUTH=true`)

Tres formas de autenticar (en orden de prioridad):

1. **Bearer JWT local** — token firmado con `APP_SECRET` (HS256, expira en 7 días). Se obtiene haciendo `POST /api/auth/login`. Payload: `{ userId, tenantId, type: 'dev' }`.
2. **Header `x-dev-tenant-id`** — útil para tests con curl/Postman sin hacer login.
3. **Fallback automático** — busca el tenant por `DEV_TENANT_SLUG` en la DB. Permite acceder a endpoints sin ninguna configuración extra.

#### Modo producción (`CLERK_SECRET_KEY` configurado)

- Verifica el JWT de Clerk con `verifyToken()` del SDK oficial.
- Extrae `tenantId` del payload de Clerk (cargado en `public_metadata` al momento del registro).
- Devuelve 401 si falta el token, 403 si el usuario no tiene `tenantId` asignado.

El contexto autenticado disponible en todos los handlers:

```typescript
request.auth = {
  clerkUserId: string,   // ID en Clerk (o "dev:<userId>" en dev mode)
  tenantId: string,      // ID del tenant en nuestra DB
  userId?: string        // ID interno (solo en DEV_BYPASS_AUTH mode)
}
```

---

### 2. Ciclo de vida de licencia / suscripción

Cada inmobiliaria tiene exactamente **una** entidad `Subscription`. El middleware `license.ts` la lee en cada request relevante y controla el acceso según el estado.

#### Estados y comportamiento

| Estado | Descripción | Acceso |
|--------|-------------|--------|
| `trialing` | Trial activo (TRIAL_DAYS desde el registro) | Acceso completo. Header `X-Trial-Days-Left: N` en cada respuesta. |
| `active` | Suscripción paga vigente | Acceso completo. |
| `past_due` | Pago fallido — período de gracia | Acceso completo. Header `X-Billing-Warning: payment_failed`. |
| `cancelled` | Cancelada, activa hasta `currentPeriodEnd` | Acceso completo hasta vencer. |
| `expired` | Trial o período expirado | Bloqueado. `402 TRIAL_EXPIRED`. Redirigir a `/settings/billing`. |

El `TenantStatus` se sincroniza automáticamente:

| TenantStatus | Comportamiento |
|--------------|----------------|
| `trial` / `active` | Acceso normal |
| `suspended` | Solo GET permitido. POST/PUT/PATCH/DELETE → `403 ACCOUNT_SUSPENDED` |
| `cancelled` | Todo bloqueado → `403 ACCOUNT_CANCELLED` |

#### Flujo de vida completo

```
POST /api/register
       │
       ▼
  Subscription: TRIALING (plan FREE, trialEndsAt = hoy + TRIAL_DAYS)
       │
       ├── Trial activo → acceso completo con límites del plan FREE
       │
       ├── POST /api/subscriptions/upgrade
       │         ▼
       │    Subscription: ACTIVE (plan PRO/ENTERPRISE, currentPeriodEnd = +30 días)
       │
       ├── Webhook: invoice.payment_failed
       │         ▼
       │    Subscription: PAST_DUE → período de gracia
       │
       ├── Webhook: subscription.deleted
       │         ▼
       │    Subscription: EXPIRED → tenant.status: SUSPENDED
       │
       └── POST /api/subscriptions/cancel
                 ▼
            cancelAtPeriodEnd = true → sigue activo hasta currentPeriodEnd
```

#### Límites por plan

| Límite | FREE | PRO | ENTERPRISE |
|--------|------|-----|------------|
| maxUsers | 3 | 15 | Sin límite |
| maxProperties | 20 | 500 | Sin límite |
| maxPhotosPerProperty | 5 | 20 | 50 |
| canExport | No | Sí | Sí |
| canUsePortals | No | Sí | Sí |
| canUseHub | No | Sí | Sí |
| canUseApi | No | No | Sí |
| soporte | Community | Email | Prioritario |

Los límites se verifican con el helper `enforcePlanLimit()`:

```typescript
// Ejemplo: verificar límite de propiedades antes de crear una
app.post('/properties', {
  preHandler: [
    requireAuth,
    checkLicense,
    enforcePlanLimit('maxProperties', async (tenantId, em) =>
      em.count(Property, { tenant: { id: tenantId } })
    ),
    requirePermission('property:create'),
  ]
}, handler)
```

---

### 3. Sistema de permisos (5 capas)

Inspirado en el modelo de grupos de Odoo. Los permisos se resuelven en tiempo real en cada request por `resolvePermissions()` en `utils/permissions.ts`.

#### Jerarquía de roles

```
owner > administrador > coordinador > agente > captador
```

El `owner` es el único con acceso a `billing:*`. No se puede asignar a otros usuarios al invitar.

#### Las 5 capas (en orden de aplicación)

```
Capa 1: base:user      → property:read, contact:read, hub:read
                          Implícito. TODOS los usuarios autenticados.

Capa 2: Role baseline  → RolePermissions[role]
                          Permisos por defecto del rol asignado.

Capa 3: Tenant overrides → tenant.permissionConfig.roleOverrides
                          El admin puede grant/deny permisos por rol para su inmobiliaria.
                          Configurable desde PUT /api/settings/permissions/roles.

Capa 4: User groups    → user.groups[]
                          Grupos adicionales asignados al usuario.
                          Ej: un captador con grupo "report:viewer" puede ver reportes.

Capa 5: User overrides → user.permissionOverrides.grant / .deny
                          Máxima granularidad. Los `deny` tienen prioridad absoluta
                          sobre todo lo de las capas anteriores.
```

#### Permisos por rol

| Recurso | owner | admin | coordinador | agente | captador |
|---------|:-----:|:-----:|:-----------:|:------:|:--------:|
| property:create/read/update | ✓ | ✓ | ✓ | ✓ | ✓ |
| property:delete/publish | ✓ | ✓ | ✓ | publish only | — |
| property:export | ✓ | ✓ | — | — | — |
| contact:CRUD | ✓ | ✓ | ✓ | CRU | — |
| contact:export | ✓ | ✓ | — | — | — |
| crm:CRUD | ✓ | ✓ | ✓ | CRU | — |
| agenda:CRUD | ✓ | ✓ | ✓ | CRU | — |
| hub:create/publish | ✓ | ✓ | ✓ | ✓ | — |
| user:manage | ✓ | ✓ | — | — | — |
| report:read | ✓ | ✓ | ✓ | ✓ | — |
| report:export | ✓ | ✓ | ✓ | — | — |
| settings:manage | ✓ | update only | read only | — | — |
| billing:manage | **owner only** | — | — | — | — |

#### Grupos del sistema (14 grupos predefinidos)

Los grupos son conjuntos de permisos ortogonales a los roles, con herencia:

```
property:manager → property:editor → property:viewer → base:user
contact:manager  → contact:editor  → contact:viewer  → base:user
crm:manager      → crm:viewer      → base:user
report:manager   → report:viewer   → base:user
user:manager     → base:user
hub:publisher    → base:user
settings:viewer  → base:user
```

Uso en la API:

```typescript
// Asignar grupo a un usuario:
PATCH /api/settings/users/:id
{ "groups": ["report:viewer", "crm:manager"] }

// Ver permisos efectivos de un usuario:
GET /api/settings/permissions/resolve/:userId
```

#### Restricciones de menú

Los ítems del menú de navegación se pueden ocultar por usuario usando el prefijo `menu:` en los deny overrides:

```typescript
// Ocultar acceso al Hub para un usuario específico:
PATCH /api/settings/users/:id
{ "permissionOverrides": { "grant": [], "deny": ["menu:hub"] } }
```

Prefijos disponibles: `menu:dashboard`, `menu:properties`, `menu:hub`, `menu:crm`, `menu:contacts`, `menu:agenda`, `menu:reports`, `menu:settings`.

---

### 4. Registro atómico de inmobiliaria

`POST /api/register` crea en **una sola transacción**:

1. `Tenant` — status: `trial`, plan: `free`
2. `User` — role: `owner`, vinculado al tenant
3. `Subscription` — status: `trialing`, `trialEndsAt = hoy + TRIAL_DAYS`

Si cualquier paso falla, la transacción hace rollback y no queda ningún registro parcial.

Validaciones previas (fuera de la transacción):
- **Slug único** globalmente. Se auto-genera desde `agencyName` si no se provee.
- **Email único** globalmente.

En **DEV_BYPASS_AUTH mode**: devuelve el JWT local en la respuesta para login inmediato.  
En **producción**: pendiente integración de webhook de Clerk para sincronizar `clerkId` al verificar el email.

---

### 5. Entidades de la base de datos

Todas las entidades usan `crypto.randomUUID()` nativo de Node 24 como PK (UUID v4).  
Las entidades de dominio (Property, Contact, Lead, Agenda, PortalConnection) tienen el filtro `byTenant` de MikroORM para que las queries siempre sean tenant-scoped.

| Entidad | Tabla | Descripción |
|---------|-------|-------------|
| `Tenant` | `tenants` | Inmobiliaria. Centro del modelo multi-tenant. |
| `User` | `users` | Usuario. `roles[]`, `groups[]`, `permissionOverrides`. Filtro byTenant. |
| `Subscription` | `subscriptions` | Licencia. OneToOne con Tenant. Tracking de webhook (`lastWebhookEvent`, `lastWebhookAt`). |
| `Property` | `properties` | Propiedad inmobiliaria. Filtro byTenant. |
| `Contact` | `contacts` | Contacto / cliente / propietario. Filtro byTenant. |
| `Lead` | `leads` | Oportunidad CRM con historial de actividades (JSON). Filtro byTenant. |
| `Agenda` | `agenda_events` | Eventos de calendario. Filtro byTenant. |
| `PortalConnection` | `portal_connections` | Credenciales encriptadas de portales (Zonaprop, Argenprop, ML). Filtro byTenant. |

---

### 6. API — Referencia de endpoints

#### Sin autenticación (públicos)

| Método | Ruta | Descripción |
|--------|------|-------------|
| `GET` | `/health` | Health check |
| `POST` | `/api/register` | Registrar nueva inmobiliaria |
| `GET` | `/api/register/check-slug/:slug` | Verificar disponibilidad de slug |
| `GET` | `/api/tenants/branding/:slug` | Branding público (logo, nombre) |
| `POST` | `/api/subscriptions/webhook` | Webhook de proveedor de pagos |

#### Autenticación

| Método | Ruta | Descripción |
|--------|------|-------------|
| `POST` | `/api/auth/login` | Login (DEV mode) |
| `POST` | `/api/auth/logout` | Logout |
| `GET` | `/api/auth/me` | Usuario actual + permisos |
| `GET` | `/api/auth/dev/users` | Listar usuarios DEV (DEV mode) |

#### Tenant

| Método | Ruta | Permiso | Descripción |
|--------|------|---------|-------------|
| `GET` | `/api/tenants/me` | — (auth) | Datos de la inmobiliaria |
| `PUT` | `/api/tenants/me` | `settings:update` | Actualizar datos |

#### Suscripción (solo owner)

| Método | Ruta | Permiso | Descripción |
|--------|------|---------|-------------|
| `GET` | `/api/subscriptions/me` | `billing:read` | Estado de la suscripción |
| `POST` | `/api/subscriptions/upgrade` | `billing:manage` | Subir de plan |
| `POST` | `/api/subscriptions/cancel` | `billing:manage` | Cancelar al fin del período |
| `POST` | `/api/subscriptions/reactivate` | `billing:manage` | Reactivar cancelación |

#### Propiedades, Contactos, CRM, Agenda

| Método | Ruta | Permiso | Descripción |
|--------|------|---------|-------------|
| `GET` | `/api/properties` | `property:read` | Listar propiedades |
| `GET` | `/api/contacts` | `contact:read` | Listar contactos |
| `GET` | `/api/crm/leads` | `crm:read` | Listar leads |
| `GET` | `/api/agenda` | `agenda:read` | Listar eventos |

> Las rutas de propiedades, contactos, CRM y agenda están en stub — la implementación completa se realiza en los sprints de desarrollo.

#### Configuración

| Método | Ruta | Permiso | Descripción |
|--------|------|---------|-------------|
| `GET` | `/api/settings/users` | `user:read` | Listar usuarios |
| `POST` | `/api/settings/users` | `user:create` | Invitar usuario |
| `GET` | `/api/settings/users/:id` | `user:read` | Ver usuario + permisos |
| `PATCH` | `/api/settings/users/:id` | `user:update` | Editar rol / grupos / overrides |
| `DELETE` | `/api/settings/users/:id` | `user:delete` | Desactivar usuario (baja lógica) |
| `GET` | `/api/settings/permissions` | `settings:read` | Config de permisos + catálogo |
| `PUT` | `/api/settings/permissions/roles` | `settings:manage` | Override de permisos por rol |
| `GET` | `/api/settings/permissions/resolve/:userId` | `settings:manage` | Permisos efectivos de usuario |

---

## Levantar el proyecto

### Prerrequisitos

- **Node.js** >= 24.0.0 ([descargar](https://nodejs.org/))
- **pnpm** >= 10.0.0 — `npm install -g pnpm`
- **Docker Desktop** — para PostgreSQL

### Paso a paso

```bash
# 1. Instalar dependencias del monorepo
cd inmob_demo_back
pnpm install

# 2. Configurar variables de entorno
cp .env.example .env
# Editar .env si es necesario (DEV_BYPASS_AUTH=true ya viene listo para desarrollo)

# 3. Levantar PostgreSQL
pnpm docker:up
# Esperar el healthcheck: "pg_isready -U inmob -d inmob_db"

# 4. Ejecutar migraciones
pnpm db:migrate
# Crea todas las tablas en la DB

# 5. Poblar datos de desarrollo
pnpm db:seed
# Crea el tenant "inmob-demo" con 5 usuarios de prueba

# 6. Iniciar la API en modo desarrollo
pnpm dev:api
# → API disponible en http://localhost:3001

# 7. Verificar que funciona
curl http://localhost:3001/health
# → {"status":"ok","timestamp":"..."}
```

### Usuarios de desarrollo (creados por el seed)

| Rol | Email | Password |
|-----|-------|----------|
| `owner` | owner@demo.com | owner123 |
| `administrador` | admin@demo.com | admin123 |
| `coordinador` | coordinador@demo.com | coord123 |
| `agente` | agente@demo.com | agente123 |
| `captador` | captador@demo.com | capt123 |

### Login de prueba

```bash
curl -X POST http://localhost:3001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "owner@demo.com",
    "tenantSlug": "inmob-demo",
    "password": "owner123"
  }'
```

Respuesta:

```json
{
  "token": "eyJ...",
  "user": { "id": "...", "email": "owner@demo.com", "roles": ["owner"], "permissions": ["property:create", "billing:manage", ...] },
  "tenant": { "id": "...", "name": "Inmobiliaria Demo", "slug": "inmob-demo", "plan": "free", "status": "trial" }
}
```

Usar el `token` en el header `Authorization: Bearer <token>` para todas las llamadas autenticadas.

---

## Variables de entorno

```bash
# ─── Base de datos ──────────────────────────────────────────────────────────────
DATABASE_URL=postgresql://inmob:inmob_pass@localhost:5432/inmob_db
# Credenciales del docker-compose. Cambiar en producción.

# ─── Auth ───────────────────────────────────────────────────────────────────────
CLERK_SECRET_KEY=sk_test_xxx
# Clave de Clerk (producción). Obtener en dashboard.clerk.com.
# Si no está configurada o es "sk_test_xxx", el modo DEV_BYPASS_AUTH debe estar activo.

DEV_BYPASS_AUTH=true
# true  = usar JWT local (jose). No requiere Clerk. Para desarrollo local.
# false = usar Clerk para autenticación. Para staging y producción.

DEV_TENANT_SLUG=inmob-demo
# Tenant que se usa como fallback en DEV_BYPASS_AUTH cuando no hay token.
# Debe coincidir con el slug del seed.

APP_SECRET=dev-secret-inmob-change-in-production-32chars
# Clave para firmar los JWT locales en DEV_BYPASS_AUTH mode.
# CAMBIAR por una cadena aleatoria de 32+ chars en cualquier entorno no-local.

# ─── App ────────────────────────────────────────────────────────────────────────
NODE_ENV=development
PORT=3001
CORS_ORIGIN=http://localhost:5173
# Origen permitido para CORS. En producción: la URL del frontend.
# Múltiples orígenes separados por coma: http://localhost:5173,https://app.tudominio.com

# ─── Pagos — Stripe ─────────────────────────────────────────────────────────────
STRIPE_SECRET_KEY=sk_test_xxx
# Clave secreta de Stripe. Obtener en dashboard.stripe.com.

STRIPE_WEBHOOK_SECRET=whsec_xxx
# Secret del webhook de Stripe para validar firmas.
# Necesario para que el endpoint /api/subscriptions/webhook acepte eventos.

# ─── Pagos — MercadoPago (alternativa a Stripe) ─────────────────────────────────
# MP_ACCESS_TOKEN=APP_USR-xxx
# MP_WEBHOOK_SECRET=xxx

# ─── Licencias ──────────────────────────────────────────────────────────────────
TRIAL_DAYS=14
# Duración del período de prueba en días desde el registro.
```

---

## Conexión con el Frontend

### 1. Autenticación

#### Modo desarrollo (`DEV_BYPASS_AUTH=true`)

```typescript
// 1. Login — obtener token
const res = await fetch('http://localhost:3001/api/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'owner@demo.com', tenantSlug: 'inmob-demo', password: 'owner123' })
})
const { token, user, tenant } = await res.json()

// 2. Guardar token (localStorage o cookie httpOnly)
localStorage.setItem('token', token)

// 3. Usar en cada request
fetch('http://localhost:3001/api/properties', {
  headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
})
```

#### Modo producción (Clerk)

```typescript
// El frontend usa el SDK de Clerk para login (signIn, signUp).
// Clerk provee el JWT — enviarlo como Bearer token a cada request.
import { useAuth } from '@clerk/react'

const { getToken } = useAuth()
const token = await getToken()

fetch('https://api.tudominio.com/api/auth/me', {
  headers: { 'Authorization': `Bearer ${token}` }
})
```

### 2. Primer request — cargar sesión

Al iniciar la app, hacer `GET /api/auth/me` para obtener:

```typescript
const { user, tenant, permissions } = await authMe()
// Guardar en estado global (Zustand, Context, Redux, etc.)

// user.permissions es el array completo de permisos efectivos del usuario.
// Usar para controlar qué UI mostrar.
```

### 3. Registro de nueva inmobiliaria

```typescript
// Verificar slug disponible en tiempo real (campo del formulario)
const { available } = await fetch(`/api/register/check-slug/${slug}`).then(r => r.json())

// Registrar
const res = await fetch('/api/register', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    agencyName: 'Inmobiliaria García',
    // slug: 'inmobiliaria-garcia',  ← opcional, se auto-genera
    ownerEmail: 'garcia@ejemplo.com',
    ownerFirstName: 'Juan',
    ownerLastName: 'García',
    country: 'AR',
    timezone: 'America/Argentina/Buenos_Aires',
    password: 'miPassword123'  // solo en DEV_BYPASS_AUTH mode
  })
})
const { token, tenant, subscription } = await res.json()
// En DEV mode: token disponible inmediatamente para login.
// En producción: el usuario recibe email de verificación de Clerk.
```

### 4. Verificar permisos en el frontend

```typescript
// Helper recomendado (guardar como hook o utilidad)
const hasPermission = (permissions: string[], permission: string): boolean =>
  permissions.includes(permission)

// Uso en componentes
const { permissions } = useAuthStore()

// Mostrar botón solo si tiene permiso
{hasPermission(permissions, 'property:create') && <Button>Nueva propiedad</Button>}

// Ocultar menú si tiene deny override
const hiddenMenus = user.permissionOverrides?.deny?.filter(p => p.startsWith('menu:')) ?? []
const showHub = !hiddenMenus.includes('menu:hub')
```

### 5. Manejo de errores de licencia

La API devuelve códigos específicos en las respuestas de error. Manejarlos globalmente en el cliente HTTP:

```typescript
// Interceptor global (Axios / fetch wrapper)
if (res.status === 402) {
  const { code, upgradeUrl, limit, current } = await res.json()

  if (code === 'TRIAL_EXPIRED') {
    router.push('/settings/billing')
    return
  }
  if (code === 'PLAN_LIMIT_REACHED') {
    showUpgradeModal({ message: `Límite alcanzado (${current}/${limit})`, upgradeUrl })
    return
  }
}

if (res.status === 403) {
  const { code } = await res.json()
  if (code === 'ACCOUNT_SUSPENDED') {
    showBillingBanner('Cuenta suspendida. Regularizar pago para continuar.')
    return
  }
}
```

#### Headers de advertencia de licencia

Leer en cada respuesta exitosa:

```typescript
// Mostrar contador de días del trial en la navbar
const daysLeft = res.headers.get('X-Trial-Days-Left')
if (daysLeft) setTrialDaysLeft(Number(daysLeft))

// Mostrar banner de pago fallido
const billingWarning = res.headers.get('X-Billing-Warning')
if (billingWarning === 'payment_failed') showPaymentFailedBanner()
```

### 6. Configuración de CORS

En el `.env` del backend, agregar el origen del frontend:

```bash
# Vite (React/Vue)
CORS_ORIGIN=http://localhost:5173

# Angular CLI
CORS_ORIGIN=http://localhost:4200

# Producción
CORS_ORIGIN=https://app.tudominio.com
```

### 7. Base URL recomendada

```typescript
// .env del frontend
VITE_API_URL=http://localhost:3001   # desarrollo
VITE_API_URL=https://api.tudominio.com  # producción

// Uso
const API = import.meta.env.VITE_API_URL
fetch(`${API}/api/auth/me`, ...)
```

---

## Comandos de desarrollo

```bash
# ─── API ────────────────────────────────────────────────────────────────────────
pnpm dev:api               # Iniciar API en modo watch (nodemon)
pnpm build:api             # Compilar para producción

# ─── Base de datos ──────────────────────────────────────────────────────────────
pnpm db:migrate            # Aplicar migraciones pendientes
pnpm db:migrate:create nombre  # Crear nueva migración
pnpm db:seed               # Poblar datos de desarrollo

# ─── Docker ─────────────────────────────────────────────────────────────────────
pnpm docker:up             # Levantar PostgreSQL en background
pnpm docker:down           # Detener PostgreSQL
pnpm docker:logs           # Ver logs en tiempo real

# ─── Calidad de código ──────────────────────────────────────────────────────────
pnpm lint                  # Verificar errores de linting (Biome)
pnpm lint:fix              # Corregir errores automáticamente
pnpm format                # Formatear código

# ─── DEV helpers ────────────────────────────────────────────────────────────────
# Listar usuarios del tenant de desarrollo
curl http://localhost:3001/api/auth/dev/users?tenant=inmob-demo

# Ver permisos efectivos de un usuario
curl -H "Authorization: Bearer <token>" \
  http://localhost:3001/api/settings/permissions/resolve/<userId>
```

---

## Notas para producción

Las siguientes funcionalidades están marcadas como `TODO` en el código y deben completarse antes del deploy:

| Pendiente | Archivo | Detalle |
|-----------|---------|---------|
| Webhook de Clerk | `routes/register.ts` | Al verificar email, Clerk debe hacer POST al webhook para sincronizar el `clerkId` real en nuestra DB |
| Checkout de Stripe | `routes/subscriptions.ts` | `POST /api/subscriptions/upgrade` debe crear una Checkout Session de Stripe y devolver la URL de pago |
| Validación de firma webhook | `routes/subscriptions.ts` | Implementar `stripe.webhooks.constructEvent()` o validación de `x-signature` de MercadoPago |
| Cancelación en Stripe/MP | `routes/subscriptions.ts` | `POST /api/subscriptions/cancel` y `/reactivate` deben llamar a la API del proveedor |
| Email de invitación | `routes/settings/users.ts` | `POST /api/settings/users` debe llamar a `clerk.invitations.createInvitation()` en producción |

**Variables a cambiar en producción:**

```bash
DEV_BYPASS_AUTH=false           # Desactivar bypass
CLERK_SECRET_KEY=sk_live_xxx    # Clave real de Clerk
APP_SECRET=<32+ chars aleatorios>  # Cambiar el default
NODE_ENV=production
DATABASE_URL=<URL de producción>
STRIPE_SECRET_KEY=sk_live_xxx
STRIPE_WEBHOOK_SECRET=whsec_xxx
```
