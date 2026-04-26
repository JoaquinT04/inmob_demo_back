# Deploy — inmob_demo_back

## Infraestructura

| Servicio | Plataforma | Descripción |
|----------|-----------|-------------|
| **API** | Render (Free) | Node.js — autodeploy desde `main` |
| **Platform DB** | Neon (`inmob_platform`) | DB central: TenantRegistry, HubProperty, billing |
| **Tenant DBs** | Neon (una por tenant) | DB aislada por inmobiliaria — actualmente `neondb` = demo |

> El free tier de Render se duerme tras 15 min sin requests. El primer request tarda ~30s (cold start). Normal para demo.

---

## Estado actual de Neon

Proyecto: `br-calm-heart-aca8361n` (branch `production` — default)
Role: `neondb_owner`

| DB | Descripción | Variable de entorno |
|----|-------------|---------------------|
| `inmob_platform` | Platform DB — TenantRegistry, billing | `PLATFORM_DATABASE_URL` |
| `neondb` | Tenant "demo" — Properties, Users, etc. | Se guarda en `tenant_registry.database_url` |

Las connection strings tienen este formato (ir a Neon → Connection Details, elegir cada DB):
```
postgresql://neondb_owner:PASSWORD@ep-XXXX.aws.neon.tech/inmob_platform?sslmode=require
postgresql://neondb_owner:PASSWORD@ep-XXXX.aws.neon.tech/neondb?sslmode=require
```

---

## Variables de entorno en Render

Configurar en Render → Service → Environment:

| Variable | Valor | Descripción |
|----------|-------|-------------|
| `PLATFORM_DATABASE_URL` | `postgres://neondb_owner:...@.../inmob_platform?sslmode=require` | Platform DB |
| `APP_SECRET` | 32+ chars aleatorios | Secret para firmar JWT |
| `NODE_ENV` | `production` | — |
| `PORT` | `3001` | — |
| `APP_DOMAIN` | `tudominio.com` | Dominio base para URLs de subdominio |
| `CORS_ORIGIN` | `https://front.tudominio.com` | URL del frontend. Múltiples separados por coma. |
| `JWT_EXPIRY` | `7d` | — |
| `TRIAL_DAYS` | `30` | — |
| `NEON_API_KEY` | `...` | API key de Neon — para crear DBs al provisionar nuevos tenants |
| `NEON_PROJECT_ID` | `...` | ID del proyecto Neon |
| `NEON_DB_OWNER` | `neondb_owner` | Role dueño de las DBs |
| `NEON_BASE_URL` | `https://console.neon.tech/api/v2` | URL de la API de Neon |

> `DATABASE_URL` ya **no se usa** — cada tenant tiene su URL en `tenant_registry.database_url`.

---

## Primer deploy (setup desde cero)

### Paso 1 — Migrar la Platform DB

La DB `inmob_platform` ya existe en Neon pero tiene el schema vacío. Hay que aplicar las migraciones:

```bash
# .env local — apuntar a la Platform DB de Neon:
PLATFORM_DATABASE_URL=postgresql://neondb_owner:PASSWORD@ep-XXXX.neon.tech/inmob_platform?sslmode=require

pnpm platform:migrate
```

### Paso 2 — Registrar el tenant demo en la Platform DB

La DB `neondb` ya tiene data (users, properties del deploy anterior). Solo hay que registrarla en la nueva tabla `tenant_registry`:

```sql
-- Conectarse a inmob_platform y ejecutar:
INSERT INTO tenant_registry (
  id,
  subdomain,
  name,
  owner_email,
  database_url,
  plan,
  status,
  subscription_status,
  trial_ends_at,
  cancel_at_period_end,
  created_at,
  updated_at
) VALUES (
  gen_random_uuid(),
  'demo',
  'Inmobiliaria Demo',
  'owner@demo.com',
  'postgresql://neondb_owner:PASSWORD@ep-XXXX.neon.tech/neondb?sslmode=require',
  'free',
  'trial',
  'trialing',
  NOW() + INTERVAL '30 days',
  false,
  NOW(),
  NOW()
);
```

> **Importante:** usar la connection string de `neondb` (NO `inmob_platform`) en el campo `database_url`.
> La password y endpoint se obtienen desde Neon → Connection Details → DB: `neondb`.

### Paso 3 — Configurar Render

Ir a Render → Service → Environment y setear todas las variables de la tabla anterior.

La más importante: `PLATFORM_DATABASE_URL` apuntando a `inmob_platform`.

### Paso 4 — Push a main

```bash
git push origin main
# Render redeploya automáticamente
```

### Paso 5 — Verificar

```bash
# Health check
curl https://inmob-api.onrender.com/health
# → {"status":"ok"}

# Confirmar que el tenant demo existe
curl https://inmob-api.onrender.com/api/portal/tenants
# → { data: [{ subdomain: "demo", ... }] }

# Login del demo
curl -X POST https://inmob-api.onrender.com/api/auth/login \
  -H "Content-Type: application/json" \
  -H "X-Tenant: demo" \
  -d '{"email":"owner@demo.com","password":"owner123"}'
# → { token: "..." }
```

---

## Agregar un nuevo tenant (provisioner)

```bash
curl -X POST https://inmob-api.onrender.com/api/portal/provision \
  -H "Content-Type: application/json" \
  -d '{
    "subdomain": "garcia",
    "name": "Inmobiliaria García",
    "ownerEmail": "garcia@garcia.com",
    "ownerFirstName": "José",
    "ownerLastName": "García",
    "password": "secure123"
  }'
# El provisioner: crea una DB nueva en Neon, corre migraciones,
# crea el Tenant + User owner, registra en tenant_registry, retorna JWT.
```

---

## Migraciones

### Platform DB

```bash
pnpm platform:migrate:create nombre-del-cambio
pnpm platform:migrate
```

### Tenant DB

Las migraciones del tenant **corren automáticamente** al provisionar un tenant nuevo.

Para tenants ya existentes (ej: demo / `neondb`):
```bash
DATABASE_URL=postgresql://neondb_owner:...@.../neondb?sslmode=require pnpm db:migrate
```

---

## Comandos útiles en producción

```bash
# Health
curl https://inmob-api.onrender.com/health

# Listar tenants
curl https://inmob-api.onrender.com/api/portal/tenants

# Login
curl -X POST https://inmob-api.onrender.com/api/auth/login \
  -H "Content-Type: application/json" \
  -H "X-Tenant: demo" \
  -d '{"email":"owner@demo.com","password":"owner123"}'

# Propiedades (reemplazar TOKEN)
curl https://inmob-api.onrender.com/api/properties \
  -H "Authorization: Bearer TOKEN" \
  -H "X-Tenant: demo"
```

---

## DNS wildcard (producción con subdominios)

Para que `demo.tudominio.com` → API sin `X-Tenant` header (opcional):

```
*.tudominio.com  CNAME  inmob-api.onrender.com
```

Sin DNS wildcard, el frontend usa `X-Tenant: demo` header — funciona igual.

---

## Seguridad

- `APP_SECRET` en Render ≠ `.env` local — tokens de dev no funcionan en prod.
- `PLATFORM_DATABASE_URL` tiene credenciales reales — no commitear.
- `NEON_API_KEY` da acceso a crear/borrar DBs — protegerla como secret crítico.
- `CORS_ORIGIN` debe ser la URL exacta del frontend en producción, nunca `*`.
