# Deploy — inmob_demo_back

## Arquitectura multi-tenant

Cada inmobiliaria tiene su propia base de datos PostgreSQL aislada en Neon. Hay una **Platform DB** central que sabe qué tenants existen y en qué DB vive cada uno.

```
Frontend
   │
   ├── X-Tenant: demo          ← header en dev / sin DNS wildcard
   └── demo.tudominio.com      ← subdominio en producción real
         │
         ▼
      API (Render)
         │
         ├── Platform DB (inmob_platform)
         │     └── tenant_registry: subdomain → database_url
         │
         └── Tenant DB (inmob_{subdomain})
               └── tenants, users, properties, contacts, ...
```

### Cómo se identifica el tenant en cada request

El hook `tenant-routing.ts` corre en cada request (excepto `/health` y `/api/portal`):

1. **Header `X-Tenant: demo`** — prioridad. Usado en dev y cuando el frontend no tiene DNS wildcard configurado.
2. **Subdominio del hostname** — solo si `APP_DOMAIN` está seteado y el host termina en `.APP_DOMAIN`. Ej: host `demo.inmob.com` con `APP_DOMAIN=inmob.com` → tenant `demo`.

Si ninguno de los dos está presente → 400 `TENANT_MISSING`.

**Para el frontend sin subdominios reales:** siempre mandar el header `X-Tenant: <subdomain>`. Funciona igual que con subdominios.

---

## Infraestructura actual

| Servicio | Plataforma | Descripción |
|----------|-----------|-------------|
| **API** | Render (Free) | Node.js — autodeploy desde `main` |
| **Platform DB** | Neon (`inmob_platform`) | TenantRegistry — mapea subdomain → DB URL |
| **Tenant DBs** | Neon (una por tenant) | DB aislada por inmobiliaria |

> Free tier de Render: se duerme tras 15 min sin requests. Cold start ~30s. Normal para demo.

### Neon — estado actual

Proyecto ID: `orange-glade-18695817`
Branch ID: `br-calm-heart-aca8361n` (branch `main` — default)
Role: `neondb_owner`
Endpoint (con pooler): `ep-frosty-wave-acsr9b2z-pooler.sa-east-1.aws.neon.tech`
Endpoint (directo):     `ep-frosty-wave-acsr9b2z.sa-east-1.aws.neon.tech`

| DB | Descripción |
|----|-------------|
| `inmob_platform` | Platform DB — TenantRegistry |
| `neondb` | Tenant "demo" — datos de la inmobiliaria demo |
| `inmob_test01..N` | DBs de prueba — se pueden borrar desde Neon |

**Pooler vs directo:**
- `*-pooler.*` → para la app (muchas conexiones cortas) — usar en `PLATFORM_DATABASE_URL` y en `NEON_DB_HOST`
- sin `-pooler` → para migrations (necesitan transacciones DDL) — el provisioner las usa automáticamente

---

## Variables de entorno en Render

Ir a Render → Service → Environment:

| Variable | Valor de ejemplo | Descripción |
|----------|-----------------|-------------|
| `PLATFORM_DATABASE_URL` | `postgresql://neondb_owner:PWD@ep-xxx-pooler.neon.tech/inmob_platform?sslmode=require` | Platform DB |
| `APP_SECRET` | 64 hex chars (`openssl rand -hex 32`) | Firma los JWT |
| `NODE_ENV` | `production` | — |
| `PORT` | `3001` | — |
| `APP_DOMAIN` | `tudominio.com` | Base para detección de subdominios. Dejar vacío si solo usás `X-Tenant`. |
| `CORS_ORIGIN` | `https://front.tudominio.com` | URL exacta del frontend. Múltiples separados por coma. En dev: `*`. |
| `JWT_EXPIRY` | `7d` | Expiración del token |
| `TRIAL_DAYS` | `14` | Días de trial para nuevos tenants |
| `NEON_API_KEY` | `napi_...` | Clave de Neon para crear DBs — **rotar si se expone** |
| `NEON_PROJECT_ID` | `orange-glade-18695817` | ID del proyecto en Neon (Project Settings) |
| `NEON_BRANCH_ID` | `br-calm-heart-aca8361n` | ID del branch donde crear las DBs |
| `NEON_DB_OWNER` | `neondb_owner` | Role dueño de las nuevas DBs |
| `NEON_DB_HOST` | `postgresql://neondb_owner:PWD@ep-xxx-pooler.neon.tech` | Host SIN nombre de DB, SIN trailing slash |

> **`NEON_DB_HOST` — errores comunes al pegar en Render:**
> - ❌ `postgresql:\nneondb_owner:...` — hay un salto de línea oculto, pegaste en dos líneas
> - ❌ `postgresql://...neon.tech/neondb` — tiene nombre de DB al final
> - ❌ `postgresql://...neon.tech/` — tiene trailing slash
> - ✅ `postgresql://neondb_owner:PWD@ep-xxx-pooler.neon.tech` — una sola línea, termina en el host

> `DATABASE_URL` ya **no se usa** — cada tenant tiene su URL en `tenant_registry.database_url`.

---

## Provisioner — cómo crea un nuevo tenant

`POST /api/portal/provision` ejecuta este flujo:

```
1. createNeonDatabase(inmob_{subdomain})
      └── Neon API v2: POST /projects/{id}/branches/{branchId}/databases
      └── Retorna: poolerUrl + directUrl (sin -pooler, para migrations)

2. setupTenantDb(directUrl)
      ├── MikroORM.init → conecta a la nueva DB vacía
      ├── migrator.up() → aplica todas las migrations (crea tablas)
      └── pg.Client → INSERT tenant + user owner + subscription (raw SQL)

3. TenantRegistry.create(poolerUrl)
      └── Registra el tenant en la Platform DB

4. SignJWT → retorna token listo para usar
```

### Testear el provisioner

```bash
curl -X POST https://inmob-demo-back.onrender.com/api/portal/provision \
  -H "Content-Type: application/json" \
  -d '{
    "subdomain": "garcia",
    "name": "Inmobiliaria García",
    "ownerEmail": "garcia@garcia.com",
    "ownerFirstName": "José",
    "ownerLastName": "García",
    "password": "secure123"
  }'
# Respuesta exitosa:
# { "subdomain": "garcia", "databaseUrl": "...", "ownerId": "...", "token": "..." }
```

Campos opcionales: `taxId`, `country` (default `AR`), `timezone`, `plan` (`free`/`starter`/`pro`).

### Limpiar DBs de prueba

Ir a Neon → Databases → borrar `inmob_test01`, `inmob_test02`, etc.
También borrar la fila en `inmob_platform.tenant_registry` si la provision llegó hasta ese paso.

---

## Primer deploy (setup desde cero)

### Paso 1 — Migrar la Platform DB

```bash
# .env local:
PLATFORM_DATABASE_URL=postgresql://neondb_owner:PWD@ep-xxx-pooler.neon.tech/inmob_platform?sslmode=require

pnpm platform:migrate
```

### Paso 2 — Registrar el tenant demo

La DB `neondb` ya tiene datos. Solo registrarla en `tenant_registry`:

```sql
-- Conectarse a inmob_platform y ejecutar:
INSERT INTO tenant_registry (
  id, subdomain, name, owner_email, database_url,
  plan, status, subscription_status,
  trial_ends_at, cancel_at_period_end, created_at, updated_at
) VALUES (
  gen_random_uuid(),
  'demo',
  'Inmobiliaria Demo',
  'owner@demo.com',
  'postgresql://neondb_owner:PWD@ep-xxx-pooler.neon.tech/neondb?sslmode=require',
  'free', 'trial', 'trialing',
  NOW() + INTERVAL '30 days',
  false, NOW(), NOW()
);
```

> Usar la connection string de `neondb` (pooler), NO de `inmob_platform`.

### Paso 3 — Configurar Render

Setear todas las variables de la tabla de arriba.

### Paso 4 — Push a main

```bash
git push origin main
# Render redeploya automáticamente (~2 min)
```

### Paso 5 — Verificar

```bash
# Health
curl https://inmob-demo-back.onrender.com/health
# → {"status":"ok","timestamp":"..."}

# Listar tenants
curl https://inmob-demo-back.onrender.com/api/portal/tenants

# Login demo
curl -X POST https://inmob-demo-back.onrender.com/api/auth/login \
  -H "Content-Type: application/json" \
  -H "X-Tenant: demo" \
  -d '{"email":"owner@demo.com","password":"owner123"}'
# → { "token": "eyJ..." }

# Propiedades (con token del paso anterior)
curl https://inmob-demo-back.onrender.com/api/properties \
  -H "Authorization: Bearer TOKEN" \
  -H "X-Tenant: demo"
```

---

## Migraciones

### Platform DB

```bash
pnpm platform:migrate:create nombre-del-cambio
pnpm platform:migrate
```

### Tenant DB — nueva (vía provisioner)

Las migrations **corren automáticamente** al provisionar. No hace falta nada manual.

### Tenant DB — existente (demo / neondb)

```bash
DATABASE_URL=postgresql://neondb_owner:PWD@ep-xxx.neon.tech/neondb?sslmode=require pnpm db:migrate
```

---

## Uso desde el frontend

### Sin subdominios reales (situación actual)

El frontend manda el header `X-Tenant` en cada request:

```http
POST /api/auth/login
X-Tenant: demo
Content-Type: application/json

{"email": "owner@demo.com", "password": "owner123"}
```

```http
GET /api/properties
Authorization: Bearer eyJ...
X-Tenant: demo
```

### Con subdominios reales (producción futura)

Cuando tengás un dominio propio:

1. DNS: `*.tudominio.com  CNAME  inmob-demo-back.onrender.com`
2. Render env: `APP_DOMAIN=tudominio.com`
3. El frontend accede desde `demo.tudominio.com` — la API detecta el subdomain automáticamente
4. Ya no es necesario el header `X-Tenant`

Hasta que tengas el dominio, el header `X-Tenant` funciona igual — no hay diferencia para el frontend.

---

## Seguridad

- `APP_SECRET` en Render ≠ `.env` local — tokens de dev no funcionan en prod.
- `NEON_API_KEY` da acceso a crear/borrar DBs — **rotar si se expone en logs o en chat**.
- `PLATFORM_DATABASE_URL` tiene credenciales reales — no commitear.
- `CORS_ORIGIN` debe ser la URL exacta del frontend en producción, nunca `*` en prod.
- Si algún secret aparece en los logs de Render (visible en el dashboard) → rotar inmediatamente en Neon y actualizar la variable en Render.
