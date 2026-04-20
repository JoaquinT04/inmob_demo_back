# Deploy — inmob_demo_back

## Infraestructura

| Servicio | Plataforma | URL |
|----------|-----------|-----|
| **API** | Render (Free) | https://inmob-demo-back.onrender.com |
| **Base de datos** | Neon (Free) | PostgreSQL 17 — sa-east-1 (São Paulo) |

> ⚠️ El free tier de Render se duerme tras 15 min sin requests. El primer request tarda ~30 segundos (cold start). Normal para desarrollo/demo.

---

## Credenciales de demo

**Login:** `POST https://inmob-demo-back.onrender.com/api/auth/login`

```json
{ "email": "owner@demo.com", "tenantSlug": "inmob-demo", "password": "owner123" }
```

| Rol | Email | Password |
|-----|-------|----------|
| owner | owner@demo.com | owner123 |
| administrador | admin@demo.com | admin123 |
| coordinador | coordinador@demo.com | coord123 |
| agente | agente@demo.com | agente123 |
| captador | captador@demo.com | capt123 |

---

## Variables de entorno en Render

Configuradas en Render → Environment:

| Variable | Descripción |
|----------|-------------|
| `DATABASE_URL` | Connection string de Neon (con `?sslmode=require`) |
| `APP_SECRET` | Secret para firmar JWT (32+ chars) |
| `NODE_ENV` | `production` |
| `PORT` | `3001` |
| `CORS_ORIGIN` | URL del frontend (o `*` en dev) |
| `JWT_EXPIRY` | `7d` |
| `TRIAL_DAYS` | `14` |

---

## Deploy automático

Render redeploya automáticamente en cada push a `main`. No hace falta hacer nada manual.

---

## Migraciones

Las migraciones se corren manualmente desde local contra Neon:

```bash
# En .env local, usar la URL de Neon
pnpm db:migrate
```

El entrypoint en Render NO corre migraciones automáticamente — se hace desde local antes de deployar cambios que las requieran.

---

## Comandos útiles

```bash
# Verificar que la API está viva
curl https://inmob-demo-back.onrender.com/health

# Login
curl -X POST https://inmob-demo-back.onrender.com/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"owner@demo.com","tenantSlug":"inmob-demo","password":"owner123"}'

# Listar propiedades (con token)
curl https://inmob-demo-back.onrender.com/api/properties \
  -H "Authorization: Bearer <token>"
```

---

## Cómo agregar una nueva migración

```bash
# 1. Modificar la entidad en packages/database/src/entities/
# 2. Generar la migración
pnpm db:migrate:create nombre-del-cambio

# 3. Revisar el SQL generado en packages/database/src/migrations/
# 4. Aplicar contra Neon
pnpm db:migrate

# 5. Commitear y pushear → Render redeploya automáticamente
git add . && git commit -m "feat: ..." && git push
```

---

## Notas de seguridad

- El `APP_SECRET` en Render es diferente al del `.env` local — los tokens de dev no funcionan en prod
- La `DATABASE_URL` de Neon tiene credenciales reales — no commitear, no compartir por chat
- `CORS_ORIGIN=*` es solo para desarrollo — cambiar a la URL real del frontend antes de presentar la demo
