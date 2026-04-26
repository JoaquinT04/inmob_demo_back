# inmob_demo_back

> Backend SaaS multi-tenant para plataforma inmobiliaria — gestión de propiedades, CRM, contactos, agenda y hub de colaboración entre inmobiliarias.

![Node](https://img.shields.io/badge/Node-≥24.0.0-brightgreen)
![pnpm](https://img.shields.io/badge/pnpm-10.33.0-orange)
![Fastify](https://img.shields.io/badge/Fastify-5.8.5-black)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-17-blue)
![TypeScript](https://img.shields.io/badge/TypeScript-6.0.3-blue)
![MikroORM](https://img.shields.io/badge/MikroORM-6.6.13-red)

---

## Stack tecnológico

| Capa | Tecnología | Versión |
|------|-----------|---------|
| Runtime | Node.js | >=24.0.0 |
| Package manager | pnpm (monorepo workspaces) | 10.33.0 |
| Framework HTTP | Fastify | 5.8.5 |
| ORM | MikroORM | 6.6.13 |
| Base de datos | PostgreSQL (Neon en prod / Docker en dev) | 17 |
| Auth | JWT local — jose (HS256) | 6.2.2 |
| Hashing contraseñas | bcryptjs | 3.0.3 |
| Validación de schemas | Zod | 3.25.76 |
| Linter / Formatter | Biome | 2.4.10 |
| TypeScript | TypeScript | 6.0.3 |
| Logging | Pino + pino-pretty (dev) | built-in Fastify |
| Seguridad HTTP | @fastify/helmet + @fastify/cors | 13.x / 10.x |

---

## Arquitectura del monorepo

```
inmob_demo_back/
├── apps/
│   └── api/                          ← @inmob/api — Servidor Fastify
│       └── src/
│           ├── app.ts                ← Bootstrap, plugins, registro de rutas
│           ├── index.ts              ← Entry point (ORMs init + listen)
│           ├── hooks/
│           │   └── tenant-routing.ts ← Resuelve tenant DB por subdomain/X-Tenant header
│           ├── lib/
│           │   └── connection-manager.ts ← Cache de conexiones por tenant
│           ├── middleware/
│           │   ├── auth.ts           ← JWT local (HS256)
│           │   ├── permissions.ts    ← RBAC — requirePermission(), requireRole()
│           │   └── license.ts        ← Enforcement de plan/licencia
│           └── routes/
│               ├── register.ts       ← Delegado a portal/provision
│               ├── auth.ts           ← Login / logout / me
│               ├── tenants.ts        ← Datos de la inmobiliaria
│               ├── subscriptions.ts  ← Gestión de licencia/pago
│               ├── properties/       ← ABM de propiedades
│               ├── contacts/         ← Contactos
│               ├── crm/              ← Pipeline de leads
│               ├── agenda/           ← Calendario / eventos
│               ├── settings/
│               │   ├── users.ts      ← Gestión de usuarios del tenant
│               │   └── permissions.ts ← Configuración de permisos
│               └── portal/
│                   └── index.ts      ← Provision, hub, listado de tenants
│
├── packages/
│   ├── database/                     ← @inmob/database — entidades del tenant
│   │   └── src/
│   │       ├── config.ts             ← Configuración MikroORM tenant DB
│   │       ├── entities/             ← Tenant, User, Property, Contact, Lead, ...
│   │       ├── migrations/           ← Migraciones del schema de tenant
│   │       └── seeds/run.ts          ← Seed de datos de desarrollo
│   │
│   ├── platform/                     ← @inmob/platform — DB central (registry + billing)
│   │   └── src/
│   │       ├── entities/
│   │       │   ├── TenantRegistry.entity.ts ← Registro de tenants + billing
│   │       │   └── HubProperty.entity.ts    ← Índice cross-tenant de propiedades
│   │       ├── config.ts             ← Configuración MikroORM platform DB
│   │       ├── migrations/           ← Migraciones de la DB plataforma
│   │       └── provisioner/
│   │           └── provision.ts      ← Crea Neon DB + migra + registra tenant
│   │
│   └── shared/                       ← @inmob/shared — tipos compartidos front + back
│       └── src/
│           ├── constants/            ← Plans, roles, permisos, enums de dominio
│           ├── schemas/              ← Zod schemas de registro
│           ├── types/                ← Interfaces TypeScript
│           └── utils/
│               └── slugify.ts
│
└── docker/
    └── docker-compose.yml            ← PostgreSQL 17-alpine (solo dev)
```

---

## Arquitectura multi-tenant: DB por tenant

Cada inmobiliaria tiene su **propia base de datos PostgreSQL aislada**. No hay columna `tenant_id` ni filtros en las queries — los datos de un tenant simplemente no existen en la DB del otro.

```
                    ┌─────────────────┐
                    │   Platform DB   │   ← 1 DB central
                    │  (inmob_platform)│
                    │  TenantRegistry │
                    │  HubProperty    │
                    └────────┬────────┘
                             │
          ┌──────────────────┼──────────────────┐
          ▼                  ▼                  ▼
   ┌─────────────┐   ┌─────────────┐   ┌─────────────┐
   │  DB: demo   │   │  DB: garcia │   │  DB: lopez  │   ← 1 DB por tenant
   │  (Neon)     │   │  (Neon)     │   │  (Neon)     │
   │  Tenant     │   │  Tenant     │   │  Tenant     │
   │  Users      │   │  Users      │   │  Users      │
   │  Properties │   │  Properties │   │  Properties │
   └─────────────┘   └─────────────┘   └─────────────┘
```

**Cómo funciona el routing:**

Cada request llega con un subdominio (`demo.app.com`) o el header `X-Tenant: demo` (para desarrollo sin DNS wildcard). El hook `tenant-routing.ts` busca en la Platform DB el `databaseUrl` de ese tenant y pone el ORM correcto en `request.orm`.

---

## Levantar el proyecto en desarrollo

### Prerrequisitos

- **Node.js** >= 24.0.0
- **pnpm** >= 10.0.0 — `npm install -g pnpm`
- **Docker Desktop** — para PostgreSQL local

### Paso a paso

```bash
# 1. Instalar dependencias del monorepo
pnpm install

# 2. Configurar variables de entorno
cp .env.example .env
# Editar .env — ver sección "Variables de entorno" abajo

# 3. Levantar PostgreSQL (crea dos DBs: inmob_platform e inmob_db)
pnpm docker:up

# 4. Migrar la Platform DB (TenantRegistry, HubProperty)
pnpm platform:migrate

# 5. Migrar la DB de tenant demo
pnpm db:migrate

# 6. Poblar datos de desarrollo
pnpm db:seed
# Crea tenant "demo" en platform DB + usuarios de prueba en la DB de tenant

# 7. Iniciar la API
pnpm dev:api
# → API disponible en http://localhost:3001
```

### Verificar que funciona

```bash
curl http://localhost:3001/health
# → {"status":"ok","timestamp":"..."}
```

---

## Usuarios de desarrollo (creados por el seed)

| Rol | Email | Password |
|-----|-------|----------|
| `owner` | owner@demo.com | owner123 |
| `administrador` | admin@demo.com | admin123 |
| `coordinador` | coordinador@demo.com | coord123 |
| `agente` | agente@demo.com | agente123 |
| `captador` | captador@demo.com | capt123 |

### Login de prueba

El header `X-Tenant: demo` indica qué inmobiliaria usar. **Es obligatorio** en todos los endpoints excepto `/health`, `/api/register` y `/api/portal`.

```bash
curl -X POST http://localhost:3001/api/auth/login \
  -H "Content-Type: application/json" \
  -H "X-Tenant: demo" \
  -d '{
    "email": "owner@demo.com",
    "password": "owner123"
  }'
```

Respuesta:

```json
{
  "token": "eyJ...",
  "user": {
    "id": "...",
    "email": "owner@demo.com",
    "roles": ["owner"],
    "permissions": ["property:create", "billing:manage", "..."]
  },
  "tenant": {
    "name": "Inmobiliaria Demo",
    "subdomain": "demo",
    "plan": "free",
    "status": "trial"
  }
}
```

Usar el `token` en `Authorization: Bearer <token>` y el header `X-Tenant: demo` en todas las llamadas autenticadas.

---

## Variables de entorno

```bash
# ─── Platform DB (registro de tenants + billing) ─────────────────────────────
PLATFORM_DATABASE_URL=postgresql://inmob:inmob_pass@localhost:5432/inmob_platform
# En producción: URL de la DB central en Neon.

# ─── Tenant DB (para desarrollo local con Docker) ────────────────────────────
DATABASE_URL=postgresql://inmob:inmob_pass@localhost:5432/inmob_db
# En producción: no se usa esta variable — cada tenant tiene su propia URL
# almacenada en TenantRegistry.databaseUrl de la Platform DB.

# ─── Auth ────────────────────────────────────────────────────────────────────
APP_SECRET=dev-secret-inmob-change-in-production-32chars
# Clave para firmar los JWT. CAMBIAR por 32+ chars aleatorios en producción.

JWT_EXPIRY=7d
# Duración del JWT. Por defecto 7 días.

# ─── App ─────────────────────────────────────────────────────────────────────
NODE_ENV=development
PORT=3001
APP_DOMAIN=localhost:3001
# En producción: el dominio base, ej: app.inmob.com

CORS_ORIGIN=http://localhost:5173
# Origen del frontend. Múltiples separados por coma.

# ─── Trial ───────────────────────────────────────────────────────────────────
TRIAL_DAYS=30

# ─── Neon (solo producción — para provision automático de DBs) ───────────────
# NEON_API_KEY=...
# NEON_PROJECT_ID=...
# NEON_DB_OWNER=neondb_owner
# NEON_BASE_URL=https://console.neon.tech/api/v2
```

---

## Conexión con el frontend

### 1. El header X-Tenant

**Todos los endpoints** (excepto `/health`, `/api/register`, `/api/portal/*`) requieren el header `X-Tenant` con el subdominio de la inmobiliaria:

```
X-Tenant: demo
```

En producción con DNS wildcard (`*.app.com`), el subdominio se detecta automáticamente del hostname. El header tiene prioridad para facilitar el desarrollo local.

### 2. Autenticación — flujo típico

```typescript
// 1. Login — obtener token
const res = await fetch('http://localhost:3001/api/auth/login', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-Tenant': 'demo',          // ← obligatorio
  },
  body: JSON.stringify({ email: 'owner@demo.com', password: 'owner123' })
})
const { token, user, tenant } = await res.json()

// 2. Guardar token
localStorage.setItem('token', token)
localStorage.setItem('subdomain', 'demo')

// 3. Usar en cada request
fetch('http://localhost:3001/api/properties', {
  headers: {
    'Authorization': `Bearer ${localStorage.getItem('token')}`,
    'X-Tenant': localStorage.getItem('subdomain'),
  }
})
```

### 3. Cargar sesión al iniciar la app

```typescript
// GET /api/auth/me — carga usuario + permisos + datos del tenant
const res = await fetch(`${API}/api/auth/me`, {
  headers: {
    'Authorization': `Bearer ${token}`,
    'X-Tenant': subdomain,
  }
})
const { user, tenant, permissions } = await res.json()
// Guardar en estado global (Zustand, Context, Redux, etc.)
```

### 4. Registro de nueva inmobiliaria (via portal)

```typescript
const res = await fetch(`${API}/api/portal/provision`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  // Sin X-Tenant — los endpoints /api/portal no lo necesitan
  body: JSON.stringify({
    subdomain: 'garcia',           // ← slug único de la inmobiliaria
    name: 'Inmobiliaria García',
    ownerEmail: 'garcia@ejemplo.com',
    ownerFirstName: 'Juan',
    ownerLastName: 'García',
    password: 'miPassword123',
    country: 'AR',
    timezone: 'America/Argentina/Buenos_Aires',
  })
})
const { token, subdomain, loginUrl } = await res.json()
// token listo para usar inmediatamente
// subdomain = 'garcia' → usar en X-Tenant a partir de ahora
```

### 5. Verificar permisos en el frontend

```typescript
const hasPermission = (permissions: string[], permission: string) =>
  permissions.includes(permission)

const { permissions } = useAuthStore()

{hasPermission(permissions, 'property:create') && <Button>Nueva propiedad</Button>}

// Ocultar menú si tiene deny override
const hiddenMenus = user.permissionOverrides?.deny?.filter(p => p.startsWith('menu:')) ?? []
const showHub = !hiddenMenus.includes('menu:hub')
```

### 6. Manejo de errores de licencia

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

### 7. Headers de advertencia de licencia

```typescript
const daysLeft = res.headers.get('X-Trial-Days-Left')
if (daysLeft) setTrialDaysLeft(Number(daysLeft))

const billingWarning = res.headers.get('X-Billing-Warning')
if (billingWarning === 'payment_failed') showPaymentFailedBanner()
```

### 8. Base URL y CORS

```typescript
// .env del frontend
VITE_API_URL=http://localhost:3001   // desarrollo
VITE_API_URL=https://api.app.com    // producción

const API = import.meta.env.VITE_API_URL
```

En el `.env` del backend:
```bash
CORS_ORIGIN=http://localhost:5173   # Vite
CORS_ORIGIN=http://localhost:4200   # Angular
```

---

## Comandos de desarrollo

```bash
# ─── API ─────────────────────────────────────────────────────────────────────
pnpm dev:api                   # Iniciar API en modo watch (nodemon)
pnpm build:api                 # Compilar para producción

# ─── Platform DB ─────────────────────────────────────────────────────────────
pnpm platform:migrate          # Aplicar migraciones de platform DB
pnpm platform:migrate:create nombre  # Crear migración en platform
pnpm platform:seed             # Poblar platform DB (opcional)

# ─── Tenant DB ───────────────────────────────────────────────────────────────
pnpm db:migrate                # Aplicar migraciones de tenant DB
pnpm db:migrate:create nombre  # Crear nueva migración de tenant
pnpm db:seed                   # Poblar datos demo (crea tenant "demo" + 5 usuarios)

# ─── Docker ──────────────────────────────────────────────────────────────────
pnpm docker:up                 # Levantar PostgreSQL (crea inmob_platform + inmob_db)
pnpm docker:down               # Detener PostgreSQL
pnpm docker:logs               # Ver logs en tiempo real

# ─── Calidad de código ────────────────────────────────────────────────────────
pnpm lint                      # Verificar errores de linting (Biome)
pnpm lint:fix                  # Corregir errores automáticamente
pnpm format                    # Formatear código

# ─── DEV helpers ─────────────────────────────────────────────────────────────
# Listar tenants disponibles (sin X-Tenant)
curl http://localhost:3001/api/portal/tenants

# Ver permisos efectivos de un usuario
curl -H "Authorization: Bearer <token>" -H "X-Tenant: demo" \
  http://localhost:3001/api/settings/permissions/resolve/<userId>
```

---

## Sistema de permisos (5 capas)

Inspirado en el sistema de grupos de Odoo.

### Jerarquía de roles

```
owner > administrador > coordinador > agente > captador
```

### Las 5 capas

```
Capa 1: base:user      → property:read, contact:read, hub:read  (implícito, siempre)
Capa 2: Role baseline  → RolePermissions[role]
Capa 3: Tenant overrides → tenant.permissionConfig.roleOverrides (PUT /settings/permissions/roles)
Capa 4: User groups    → user.groups[]  (ej: captador con grupo "report:viewer")
Capa 5: User overrides → user.permissionOverrides.grant / .deny  (deny gana sobre todo)
```

### Permisos por rol

| Recurso | owner | admin | coordinador | agente | captador |
|---------|:-----:|:-----:|:-----------:|:------:|:--------:|
| property:create/read/update | ✓ | ✓ | ✓ | ✓ | ✓ |
| property:delete/publish | ✓ | ✓ | ✓ | publish only | — |
| contact:CRUD | ✓ | ✓ | ✓ | CRU | — |
| crm:CRUD | ✓ | ✓ | ✓ | CRU | — |
| agenda:CRUD | ✓ | ✓ | ✓ | CRU | — |
| user:manage | ✓ | ✓ | — | — | — |
| settings:manage | ✓ | update only | read only | — | — |
| billing:manage | **owner only** | — | — | — | — |

---

## Ciclo de licencia

| Estado | Comportamiento |
|--------|----------------|
| `trialing` | Acceso completo. Header `X-Trial-Days-Left: N` en respuestas. |
| `active` | Acceso completo. |
| `past_due` | Acceso completo. Header `X-Billing-Warning: payment_failed`. |
| `cancelled` | Acceso hasta `currentPeriodEnd`. |
| `expired` | Bloqueado → 402 TRIAL_EXPIRED |
| `suspended` (TenantStatus) | Solo GET. POST/PUT/PATCH/DELETE → 403 ACCOUNT_SUSPENDED |

### Límites por plan

| Límite | FREE | PRO | ENTERPRISE |
|--------|------|-----|------------|
| maxUsers | 3 | 15 | Sin límite |
| maxProperties | 20 | 500 | Sin límite |
| maxPhotosPerProperty | 5 | 20 | 50 |
| canUseHub | No | Sí | Sí |
| canExport | No | Sí | Sí |
| canUseApi | No | No | Sí |
