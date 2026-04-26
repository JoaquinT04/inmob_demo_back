# API Endpoints — inmob_demo_back

**Base URL desarrollo:** `http://localhost:3001`  
**Base URL producción:** `https://inmob-api.onrender.com`

---

## Headers obligatorios

### X-Tenant (requerido en casi todos los endpoints)

Indica qué inmobiliaria se está usando. Requerido en **todos los endpoints** excepto `/health`, `/api/register/*` y `/api/portal/*`.

```
X-Tenant: demo
```

En producción con DNS wildcard (`demo.app.com`), el subdominio se detecta automáticamente. El header tiene prioridad para facilitar desarrollo local sin DNS.

### Authorization (en endpoints protegidos)

```
Authorization: Bearer <token>
```

El token se obtiene en `POST /api/auth/login`.

---

## Índice

1. [Health](#health)
2. [Portal (sin tenant)](#portal-sin-tenant)
3. [Registro de inmobiliaria](#registro-de-inmobiliaria)
4. [Auth](#auth)
5. [Tenant](#tenant)
6. [Suscripción](#suscripción)
7. [Propiedades](#propiedades)
8. [Contactos](#contactos)
9. [CRM — Leads](#crm--leads)
10. [Agenda](#agenda)
11. [Configuración — Usuarios](#configuración--usuarios)
12. [Configuración — Permisos](#configuración--permisos)
13. [Licencia — códigos de error](#licencia--códigos-de-error)

---

## Health

### `GET /health`

Sin autenticación, sin X-Tenant.

```json
{ "status": "ok", "timestamp": "2026-04-25T00:00:00.000Z" }
```

---

## Portal (sin tenant)

Los endpoints de portal **no requieren X-Tenant** — operan sobre la Platform DB directamente.

### `POST /api/portal/provision`

Crea una nueva inmobiliaria completa. Provisiona una DB Neon, ejecuta migraciones, crea el owner y registra el tenant.

**Body**
```json
{
  "subdomain": "garcia",
  "name": "Inmobiliaria García",
  "ownerEmail": "garcia@ejemplo.com",
  "ownerFirstName": "Juan",
  "ownerLastName": "García",
  "password": "miPassword123",
  "taxId": "20-12345678-9",
  "country": "AR",
  "timezone": "America/Argentina/Buenos_Aires"
}
```

| Campo | Requerido | Descripción |
|-------|-----------|-------------|
| `subdomain` | ✅ | Slug único. Solo minúsculas, números y guiones. Mínimo 3 caracteres. |
| `name` | ✅ | Nombre de la inmobiliaria |
| `ownerEmail` | ✅ | Email del dueño |
| `ownerFirstName` | ✅ | Nombre |
| `ownerLastName` | ✅ | Apellido |
| `password` | ✅ | Contraseña mínimo 6 caracteres |
| `taxId` | — | CUIT/RUT/NIF |
| `country` | — | Código ISO 2 letras. Default: `AR` |
| `timezone` | — | Default: `America/Argentina/Buenos_Aires` |

**Response 201**
```json
{
  "token": "eyJhbGciOiJIUzI1NiJ9...",
  "subdomain": "garcia",
  "loginUrl": "https://garcia.app.com",
  "message": "Inmobiliaria \"Inmobiliaria García\" creada. Trial de 30 días activo."
}
```

El `token` está listo para usar inmediatamente. El `subdomain` va en `X-Tenant` a partir de ahora.

**Errores**
| Status | code | Cuándo |
|--------|------|--------|
| 400 | — | Datos de validación inválidos |
| 409 | `SUBDOMAIN_TAKEN` | El subdominio ya existe |
| 500 | `PROVISION_ERROR` | Error al crear la DB Neon |

---

### `GET /api/portal/hub`

Busca propiedades publicadas en todos los tenants (índice cross-tenant). Sin autenticación.

**Query params**
| Param | Tipo | Descripción |
|-------|------|-------------|
| `type` | string | `house` `apartment` `land` `commercial` `office` etc. |
| `operationType` | string | `sale` `rent` `temporary_rent` |
| `city` | string | Búsqueda parcial (case-insensitive) |
| `priceMin` | number | Precio mínimo |
| `priceMax` | number | Precio máximo |
| `rooms` | number | Cantidad de ambientes |
| `page` | number | Default `1` |
| `perPage` | number | Default `20`, máx `100` |

**Response 200**
```json
{
  "data": [
    {
      "id": "...",
      "tenantSubdomain": "garcia",
      "type": "apartment",
      "operationType": "sale",
      "price": 120000,
      "currency": "USD",
      "city": "Buenos Aires",
      "neighborhood": "Palermo",
      "rooms": 3,
      "publishedAt": "2026-04-25T10:00:00.000Z"
    }
  ],
  "meta": {
    "total": 1,
    "page": 1,
    "perPage": 20,
    "totalPages": 1
  }
}
```

---

### `GET /api/portal/tenants`

Lista todos los tenants activos. Útil para construir un selector de inmobiliaria en el login.

**Response 200**
```json
{
  "data": [
    {
      "subdomain": "demo",
      "name": "Inmobiliaria Demo",
      "logoUrl": null
    },
    {
      "subdomain": "garcia",
      "name": "Inmobiliaria García",
      "logoUrl": "https://..."
    }
  ]
}
```

---

## Registro de inmobiliaria

### `GET /api/register/check-slug/:slug`

Verifica si un subdomain está disponible. Sin autenticación.

```json
{ "available": true, "slug": "garcia" }
{ "available": false, "slug": "demo" }
```

**Response 400** — slug inválido
```json
{ "available": false, "error": "Slug inválido. Solo minúsculas, números y guiones (3-50 caracteres)." }
```

---

### `POST /api/register`

Alias de `POST /api/portal/provision` — mismos parámetros y respuesta. Se mantiene por compatibilidad.

---

## Auth

### `POST /api/auth/login`

Login con email + contraseña. Requiere `X-Tenant`.

**Headers:** `X-Tenant: demo`

**Body**
```json
{
  "email": "owner@demo.com",
  "password": "owner123"
}
```

**Response 200**
```json
{
  "token": "eyJhbGciOiJIUzI1NiJ9...",
  "user": {
    "id": "28ca9dc6-...",
    "email": "owner@demo.com",
    "firstName": "Owner",
    "lastName": "Demo",
    "avatarUrl": null,
    "roles": ["owner"],
    "groups": [],
    "permissions": ["agenda:create", "billing:manage", "property:create", "..."]
  },
  "tenant": {
    "name": "Inmobiliaria Demo",
    "subdomain": "demo",
    "logoUrl": null,
    "plan": "free",
    "status": "trial"
  }
}
```

**Errores**
| Status | code | Cuándo |
|--------|------|--------|
| 400 | `TENANT_MISSING` | No se envió X-Tenant |
| 401 | `INVALID_CREDENTIALS` | Email o contraseña incorrectos |
| 401 | `NO_PASSWORD` | Usuario sin contraseña asignada |
| 403 | `USER_INACTIVE` | Usuario desactivado |
| 404 | `TENANT_NOT_FOUND` | El subdomain del X-Tenant no existe |

---

### `GET /api/auth/me`

Usuario autenticado con permisos actuales. Usar al iniciar la app para hidratar estado global.

**Headers:** `Authorization: Bearer <token>`, `X-Tenant: demo`

**Response 200**
```json
{
  "user": {
    "id": "28ca9dc6-...",
    "email": "owner@demo.com",
    "firstName": "Owner",
    "lastName": "Demo",
    "avatarUrl": null,
    "roles": ["owner"],
    "groups": [],
    "preferences": {
      "theme": "dark",
      "language": "es",
      "timezone": "America/Argentina/Buenos_Aires"
    },
    "permissionOverrides": null,
    "isActive": true,
    "lastLoginAt": "2026-04-25T01:32:00.000Z"
  },
  "tenant": {
    "name": "Inmobiliaria Demo",
    "subdomain": "demo",
    "logoUrl": null,
    "plan": "free",
    "status": "trial"
  },
  "permissions": ["agenda:create", "billing:manage", "property:create", "..."]
}
```

---

### `POST /api/auth/logout`

Stateless — el servidor no invalida el token. El cliente debe descartarlo.

**Response 204** (sin body)

---

### `GET /api/auth/users`

Lista usuarios del tenant. Útil para un selector de login en el frontend de desarrollo.

**Headers:** `X-Tenant: demo`  
*(No requiere Authorization — solo funciona con NODE_ENV=development)*

**Response 200**
```json
{
  "tenant": {
    "name": "Inmobiliaria Demo",
    "subdomain": "demo"
  },
  "users": [
    {
      "id": "28ca9dc6-...",
      "email": "owner@demo.com",
      "firstName": "Owner",
      "lastName": "Demo",
      "roles": ["owner"],
      "hasPassword": true
    }
  ]
}
```

---

## Tenant

### `GET /api/tenants/me`

Datos de la inmobiliaria del usuario autenticado.

**Headers:** `Authorization: Bearer <token>`, `X-Tenant: demo`

**Response 200**
```json
{
  "data": {
    "name": "Inmobiliaria Demo",
    "subdomain": "demo",
    "logoUrl": null,
    "taxId": null,
    "settings": {
      "primaryColor": "#1a73e8",
      "defaultCurrency": "USD",
      "defaultLanguage": "es"
    }
  }
}
```

---

### `PUT /api/tenants/me`

Actualiza datos de la inmobiliaria. Requiere permiso `settings:update`.

**Headers:** `Authorization: Bearer <token>`, `X-Tenant: demo`

**Body** (todos opcionales)
```json
{
  "name": "Inmobiliaria Demo 2",
  "logoUrl": "https://cdn.ejemplo.com/logo.png",
  "taxId": "30-12345678-9",
  "settings": {
    "primaryColor": "#e53935",
    "defaultCurrency": "ARS"
  }
}
```

**Response 200** — datos actualizados.

---

### `GET /api/tenants/branding/:subdomain`

Branding público de una inmobiliaria. Sin autenticación. Para la página de login por subdominio.

**Response 200**
```json
{
  "name": "Inmobiliaria Demo",
  "subdomain": "demo",
  "logoUrl": null,
  "primaryColor": "#1a73e8"
}
```

---

## Suscripción

Todos los endpoints de suscripción requieren permiso `billing:*` (solo `owner`).

### `GET /api/subscriptions/me`

Estado de la suscripción del tenant. Requiere `billing:read`.

**Headers:** `Authorization: Bearer <token>`, `X-Tenant: demo`

**Response 200**
```json
{
  "data": {
    "plan": "free",
    "status": "trial",
    "subscriptionStatus": "trialing",
    "trialEndsAt": "2026-05-25T00:00:00.000Z",
    "currentPeriodEnd": null,
    "cancelAtPeriodEnd": false,
    "paymentProvider": null
  }
}
```

---

### `POST /api/subscriptions/upgrade`

Sube de plan. Requiere `billing:manage`.

**Body**
```json
{ "plan": "pro" }
```

---

### `POST /api/subscriptions/cancel`

Cancela al fin del período. Requiere `billing:manage`.

**Response 200**
```json
{ "message": "Suscripción cancelada. Activa hasta 2026-05-25." }
```

---

### `POST /api/subscriptions/reactivate`

Reactiva una cancelación. Requiere `billing:manage`.

---

### `POST /api/subscriptions/webhook`

Webhook del proveedor de pagos (Stripe / MercadoPago). Sin autenticación.

---

## Propiedades

Todos requieren `X-Tenant` + `Authorization`.

### `GET /api/properties`

Lista propiedades con paginación y filtros.

**Query params**
| Param | Tipo | Descripción |
|-------|------|-------------|
| `type` | string | `house` `apartment` `land` `commercial` `office` `warehouse` `garage` `other` |
| `operationType` | string | `sale` `rent` `temporary_rent` |
| `status` | string | `draft` `active` `reserved` `sold` `rented` `paused` `archived` |
| `city` | string | Búsqueda parcial en ciudad |
| `neighborhood` | string | Búsqueda parcial en barrio |
| `priceMin` | number | Precio mínimo |
| `priceMax` | number | Precio máximo |
| `rooms` | number | Ambientes. `5` = "5 o más" |
| `ageMax` | number | Antigüedad máxima en años. `0` = a estrenar |
| `page` | number | Default `1` |
| `perPage` | number | Default `20`, máx `100` |

**Ejemplos**
```
GET /api/properties?type=apartment&operationType=sale&city=Buenos Aires
GET /api/properties?rooms=3&priceMin=100000&priceMax=200000
GET /api/properties?neighborhood=Palermo&ageMax=0
```

**Response 200**
```json
{
  "data": [
    {
      "id": "...",
      "title": "Casa en Palermo",
      "slug": "casa-en-palermo",
      "type": "house",
      "operationType": "sale",
      "status": "active",
      "price": 180000,
      "currency": "USD",
      "address": {
        "neighborhood": "Palermo",
        "city": "Buenos Aires",
        "country": "AR",
        "showExactAddress": true
      },
      "features": {
        "totalArea": 200,
        "coveredArea": 150,
        "bedrooms": 3,
        "bathrooms": 2,
        "garages": 1
      },
      "images": [],
      "publishedAt": "2026-04-25T12:00:00.000Z",
      "createdAt": "2026-04-25T10:00:00.000Z"
    }
  ],
  "meta": {
    "total": 1,
    "page": 1,
    "perPage": 20,
    "totalPages": 1,
    "hasNextPage": false,
    "hasPreviousPage": false
  }
}
```

---

### `POST /api/properties`

Crea una propiedad en estado `draft`. Requiere `property:create`.

**Body**
```json
{
  "title": "Casa en Palermo",
  "description": "Hermosa casa con jardín.",
  "type": "house",
  "operationType": "sale",
  "price": 180000,
  "currency": "USD",
  "address": {
    "street": "Thames",
    "number": "1234",
    "neighborhood": "Palermo",
    "city": "Buenos Aires",
    "state": "Buenos Aires",
    "country": "AR",
    "showExactAddress": true
  },
  "features": {
    "totalArea": 200,
    "coveredArea": 150,
    "rooms": 5,
    "bedrooms": 3,
    "bathrooms": 2,
    "garages": 1,
    "age": 10
  },
  "amenities": ["pileta", "quincho"],
  "assignedUserId": "2c568973-..."
}
```

**Response 201** — objeto completo de la propiedad creada.

---

### `GET /api/properties/:id`

Detalle de una propiedad. Requiere `property:read`.

**Response 404**
```json
{ "error": "Propiedad no encontrada" }
```

---

### `PATCH /api/properties/:id`

Edita campos. Todos opcionales. Requiere `property:update`.

```json
{
  "title": "Casa en Palermo — con jardín",
  "price": 185000,
  "status": "reserved",
  "assignedUserId": null
}
```

---

### `PATCH /api/properties/:id/publish`

Publica o pausa. Requiere `property:publish`.

```json
{ "publish": true }
```

**Response 200**
```json
{
  "data": { "id": "...", "status": "active", "publishedAt": "2026-04-25T12:00:00.000Z" },
  "message": "Propiedad publicada."
}
```

---

### `DELETE /api/properties/:id`

Archiva (baja lógica). Requiere `property:delete`.

**Response 204**

---

## Contactos

### `GET /api/contacts`

Lista contactos. Requiere `contact:read`.

**Query params:** `search`, `type` (`client` `owner` `both`), `page`, `perPage`

---

### `POST /api/contacts`

Crea contacto. Requiere `contact:create`.

---

### `GET /api/contacts/:id`

Detalle de contacto.

---

### `PATCH /api/contacts/:id`

Edita contacto. Requiere `contact:update`.

---

### `DELETE /api/contacts/:id`

Archiva contacto. Requiere `contact:delete`.

---

## CRM — Leads

### `GET /api/crm/leads`

Lista leads del pipeline. Requiere `crm:read`.

**Query params:** `status`, `assignedUserId`, `page`, `perPage`

---

### `POST /api/crm/leads`

Crea lead. Requiere `crm:create`.

---

### `GET /api/crm/leads/:id`

Detalle de lead con historial de actividades.

---

### `PATCH /api/crm/leads/:id`

Edita lead. Requiere `crm:update`.

---

### `DELETE /api/crm/leads/:id`

Archiva lead. Requiere `crm:delete`.

---

## Agenda

### `GET /api/agenda`

Lista eventos del calendario. Requiere `agenda:read`.

**Query params:** `from` (ISO date), `to` (ISO date), `assignedUserId`

---

### `POST /api/agenda`

Crea evento. Requiere `agenda:create`.

---

### `GET /api/agenda/:id`

Detalle de evento.

---

### `PATCH /api/agenda/:id`

Edita evento. Requiere `agenda:update`.

---

### `DELETE /api/agenda/:id`

Elimina evento. Requiere `agenda:delete`.

---

## Configuración — Usuarios

### `GET /api/settings/users`

Lista usuarios de la inmobiliaria. Requiere `user:read`.

**Response 200**
```json
{
  "data": [
    {
      "id": "...",
      "email": "owner@demo.com",
      "firstName": "Owner",
      "lastName": "Demo",
      "avatarUrl": null,
      "roles": ["owner"],
      "groups": [],
      "isActive": true,
      "lastLoginAt": "2026-04-25T01:32:00.000Z",
      "createdAt": "2026-04-19T14:57:00.000Z"
    }
  ]
}
```

---

### `POST /api/settings/users`

Invita nuevo usuario. Requiere `user:create`.

**Body**
```json
{
  "email": "nuevo@ejemplo.com",
  "firstName": "Ana",
  "lastName": "López",
  "role": "agente"
}
```

> `role` valores: `administrador` `coordinador` `agente` `captador`

**Response 201**
```json
{
  "data": { "id": "...", "email": "nuevo@ejemplo.com", "roles": ["agente"] },
  "message": "Usuario creado. El admin debe asignar una contraseña: PATCH /api/settings/users/<id>"
}
```

---

### `GET /api/settings/users/:id`

Detalle con permisos efectivos resueltos. Requiere `user:read`.

**Response 200**
```json
{
  "data": {
    "id": "...",
    "email": "agente@demo.com",
    "roles": ["agente"],
    "groups": [],
    "permissionOverrides": null,
    "isActive": true,
    "permissions": ["contact:create", "contact:read", "property:create", "..."]
  }
}
```

---

### `PATCH /api/settings/users/:id`

Edita usuario. Requiere `user:update`. No se puede cambiar el rol del owner.

**Body** (todos opcionales)
```json
{
  "firstName": "Ana",
  "lastName": "González",
  "phone": "+54 11 9999-8888",
  "role": "coordinador",
  "groups": ["report:viewer", "contact:manager"],
  "permissionOverrides": {
    "grant": ["report:export"],
    "deny": ["property:delete"]
  },
  "isActive": true,
  "password": "nuevaPassword123"
}
```

> `groups` disponibles: `property:viewer` `property:editor` `property:manager` `contact:viewer` `contact:editor` `contact:manager` `crm:viewer` `crm:manager` `report:viewer` `report:manager` `settings:viewer` `user:manager` `hub:publisher`

---

### `DELETE /api/settings/users/:id`

Desactiva usuario (baja lógica). No se puede desactivar al owner. Requiere `user:delete`.

**Response 204**

---

## Configuración — Permisos

### `GET /api/settings/permissions`

Config de permisos del tenant + catálogo de grupos. Requiere `settings:read`.

**Response 200**
```json
{
  "data": {
    "permissionConfig": null,
    "availableGroups": [
      {
        "id": "property:manager",
        "name": "Propiedades — Gestor",
        "permissions": ["property:create", "property:read", "property:update", "property:delete", "property:publish", "property:export"],
        "impliedGroups": ["property:editor"]
      }
    ]
  }
}
```

---

### `PUT /api/settings/permissions/roles`

Override de permisos para un rol en toda la inmobiliaria (capa 3 del sistema). Requiere `settings:manage`.

**Body**
```json
{
  "role": "agente",
  "grant": ["report:read"],
  "deny": ["property:delete"]
}
```

---

### `GET /api/settings/permissions/resolve/:userId`

Permisos efectivos de un usuario (todas las capas resueltas). Requiere `settings:manage`.

**Response 200**
```json
{
  "data": {
    "userId": "...",
    "email": "agente@demo.com",
    "roles": ["agente"],
    "groups": ["report:viewer"],
    "effectivePermissions": ["contact:create", "property:create", "report:read", "..."],
    "totalCount": 12
  }
}
```

---

## Licencia — códigos de error

El middleware de licencia puede responder en cualquier endpoint protegido:

| Status | code | Situación | Qué hacer en el frontend |
|--------|------|-----------|--------------------------|
| 400 | `TENANT_MISSING` | Falta header X-Tenant | Mostrar selector de inmobiliaria |
| 404 | `TENANT_NOT_FOUND` | Subdomain no existe | Redirigir a pantalla de inicio |
| 402 | `TRIAL_EXPIRED` | Trial vencido | Redirigir a `/settings/billing` |
| 402 | `PLAN_LIMIT_REACHED` | Límite del plan alcanzado | Mostrar modal de upgrade |
| 402 | `FEATURE_NOT_IN_PLAN` | Feature no disponible | Mostrar mensaje de upgrade |
| 403 | `ACCOUNT_SUSPENDED` | Cuenta suspendida | Mostrar banner de pago pendiente |
| 403 | `ACCOUNT_CANCELLED` | Cuenta cancelada | Mostrar pantalla de reactivación |

**Respuesta 402 PLAN_LIMIT_REACHED**
```json
{
  "error": "Límite de maxProperties alcanzado para el plan free (máx: 20).",
  "code": "PLAN_LIMIT_REACHED",
  "limit": 20,
  "current": 20,
  "upgradeUrl": "/settings/billing"
}
```

**Headers de advertencia** (presentes en respuestas exitosas)

| Header | Cuándo | Valor |
|--------|--------|-------|
| `X-Trial-Days-Left` | Trial activo | días restantes (ej: `"14"`) |
| `X-Billing-Warning` | Pago fallido | `"payment_failed"` |
