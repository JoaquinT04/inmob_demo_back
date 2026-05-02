# API Endpoints — inmob_demo_back

**Base URL desarrollo:** `http://localhost:3001`  
**Base URL producción:** `https://inmob-demo-back.onrender.com`

---

## Guía de integración para el frontend

### Conceptos clave

Esta API es multi-tenant: cada inmobiliaria tiene su propia base de datos aislada. El frontend necesita decirle a la API con qué inmobiliaria está trabajando en cada request.

Hay dos formas de identificar el tenant:

| Método | Cómo | Cuándo usar |
|--------|------|-------------|
| **Header `X-Tenant`** | `X-Tenant: demo` | Siempre — dev, staging, producción sin DNS wildcard |
| **Subdominio del hostname** | `demo.tudominio.com` | Producción con DNS wildcard configurado |

**Por ahora el frontend siempre debe mandar `X-Tenant`.** El subdominio real se puede agregar después sin cambiar nada en el frontend.

---

### Flujo completo: registro de nueva inmobiliaria

```
1. Verificar slug disponible
   GET /api/register/check-slug/garcia
   → { available: true }

2. Crear la inmobiliaria
   POST /api/portal/provision
   Body: { subdomain, name, ownerEmail, ownerFirstName, ownerLastName, password }
   → { token, subdomain, message }
      ↑ el token ya es válido — guardar y usar directamente

3. Guardar en el cliente:
   - token → localStorage / cookie httpOnly / estado global
   - subdomain → para el header X-Tenant de todos los requests siguientes
```

---

### Flujo completo: login en inmobiliaria existente

```
1. (Opcional) Listar inmobiliarias disponibles
   GET /api/portal/tenants
   → [{ subdomain: "demo", name: "Inmobiliaria Demo" }, ...]
   → Mostrar selector si el usuario no sabe su subdomain

2. Login
   POST /api/auth/login
   Headers: X-Tenant: demo
   Body: { email, password }
   → { token, user, tenant }

3. Guardar token + hidratar estado global con user y tenant

4. Al iniciar la app (si hay token guardado):
   GET /api/auth/me
   Headers: Authorization: Bearer <token>, X-Tenant: demo
   → { user, tenant, permissions }
   → Si 401: token vencido → redirigir a login
```

---

### Cómo configurar los headers en el cliente HTTP

#### fetch nativo

```typescript
const API_URL = 'https://inmob-demo-back.onrender.com';

async function apiRequest(path: string, options: RequestInit = {}, tenant: string, token?: string) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Tenant': tenant,
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${API_URL}${path}`, { ...options, headers });
  if (!res.ok) throw await res.json();
  return res.json();
}

// Uso:
const { token, user } = await apiRequest('/api/auth/login', {
  method: 'POST',
  body: JSON.stringify({ email, password }),
}, 'demo');
```

#### Axios

```typescript
import axios from 'axios';

const api = axios.create({ baseURL: 'https://inmob-demo-back.onrender.com' });

// Interceptor — agrega headers automáticamente desde el store
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  const tenant = localStorage.getItem('tenant');
  if (token) config.headers['Authorization'] = `Bearer ${token}`;
  if (tenant) config.headers['X-Tenant'] = tenant;
  return config;
});

// Interceptor — maneja 401 (token vencido)
api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem('token');
      window.location.href = '/login';
    }
    return Promise.reject(err);
  }
);
```

---

### Errores comunes y cómo manejarlos

| Status | code | Qué mostrar |
|--------|------|-------------|
| 400 | `TENANT_MISSING` | "Seleccioná una inmobiliaria" |
| 404 | `TENANT_NOT_FOUND` | "La inmobiliaria no existe" |
| 401 | `INVALID_CREDENTIALS` | "Email o contraseña incorrectos" |
| 401 | (token vencido) | Redirigir a login |
| 402 | `TRIAL_EXPIRED` | Modal: "Tu período de prueba venció, activá tu plan" |
| 403 | `FORBIDDEN` | "No tenés permiso para esta acción" |
| 409 | `SUBDOMAIN_TAKEN` | "Ese nombre ya está en uso, elegí otro" |

---

### Permisos — qué puede hacer cada rol

El login retorna un array `permissions` con todo lo que el usuario puede hacer. Úsalo para mostrar/ocultar elementos de la UI:

```typescript
const canCreate = permissions.includes('property:create');
const canPublish = permissions.includes('property:publish');
const canManageBilling = permissions.includes('billing:manage');
```

Permisos disponibles: `property:*`, `contact:*`, `crm:*`, `agenda:*`, `user:*`, `settings:*`, `billing:*`, `report:*`

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
2. [Portal (sin tenant)](#portal-sin-tenant) — `provision`, `hub`, `hub/:id`, `plans`, `tenants`
3. [Registro de inmobiliaria](#registro-de-inmobiliaria)
4. [Auth](#auth)
5. [Tenant](#tenant)
6. [Suscripción](#suscripción) — `plans`, `me`, `checkout`, `cancel`, `reactivate`, `webhook/mercadopago`
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

### `GET /api/portal/plans`

Catálogo público de planes. Sin autenticación, sin X-Tenant. Útil para la página de precios del sitio.

**Response 200**
```json
{
  "data": [
    { "id": "free",       "price": 0,     "currency": "USD", "interval": "month", "label": "Gratis",     "limits": { "maxUsers": 3,  "maxProperties": 20,  "canUseHub": false, "canExport": false } },
    { "id": "pro",        "price": 29.99, "currency": "USD", "interval": "month", "label": "Pro",        "limits": { "maxUsers": 15, "maxProperties": 500, "canUseHub": true,  "canExport": true  } },
    { "id": "enterprise", "price": 89.99, "currency": "USD", "interval": "month", "label": "Enterprise", "limits": { "maxUsers": -1, "maxProperties": -1,  "canUseHub": true,  "canExport": true  } }
  ]
}
```

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

### `GET /api/portal/hub/:id`

Detalle de una propiedad del hub por ID. Sin autenticación.

**Response 200** — objeto `HubProperty` completo.

**Response 404**
```json
{ "error": "Propiedad no encontrada en el hub", "code": "NOT_FOUND" }
```

---

### `GET /api/portal/tenants`

Lista tenants activos y en trial. Útil para construir un selector de inmobiliaria en el login.

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

Los endpoints que modifican estado requieren permiso `billing:manage` (solo `owner`). Los de lectura requieren `billing:read`.

### `GET /api/subscriptions/plans`

Catálogo de planes. Sin autenticación. (Mismo que `/api/portal/plans`.)

---

### `GET /api/subscriptions/me`

Estado de la suscripción del tenant. Requiere `billing:read`.

**Headers:** `Authorization: Bearer <token>`, `X-Tenant: demo`

**Response 200**
```json
{
  "data": {
    "subdomain": "demo",
    "plan": "free",
    "planLimits": { "maxUsers": 3, "maxProperties": 20, "canUseHub": false, "canExport": false },
    "planPricing": { "price": 0, "currency": "USD", "interval": "month", "label": "Gratis" },
    "status": "trial",
    "subscriptionStatus": "trialing",
    "trialEndsAt": "2026-05-25T00:00:00.000Z",
    "trialDaysLeft": 23,
    "currentPeriodEnd": null,
    "cancelAtPeriodEnd": false,
    "paymentProvider": null
  }
}
```

---

### `POST /api/subscriptions/checkout`

Crea una sesión de pago en MercadoPago. Requiere `billing:manage`.

**Headers:** `Authorization: Bearer <token>`, `X-Tenant: demo`

**Body**
```json
{
  "plan": "pro",
  "successUrl": "https://tuapp.com/billing?status=success",
  "failureUrl": "https://tuapp.com/billing?status=failed"
}
```

| Campo | Requerido | Descripción |
|-------|-----------|-------------|
| `plan` | ✅ | `pro` o `enterprise` |
| `successUrl` | — | URL de redirect tras pago aprobado. Default: `/api/subscriptions/checkout/success` |
| `failureUrl` | — | URL de redirect tras pago rechazado. Default: `/api/subscriptions/checkout/failure` |

**Response 200**
```json
{
  "checkoutUrl": "https://www.mercadopago.com.ar/checkout/v1/redirect?pref_id=...",
  "preferenceId": "...",
  "plan": "pro",
  "pricing": { "price": 29.99, "currency": "USD", "interval": "month", "label": "Pro" }
}
```

El frontend redirige al usuario a `checkoutUrl`. MercadoPago maneja el pago y redirige de vuelta.

**Errores**
| Status | code | Cuándo |
|--------|------|--------|
| 400 | — | Plan inválido |
| 409 | `ALREADY_ON_PLAN` | Ya está en este plan y activo |
| 502 | `CHECKOUT_ERROR` | Error al crear la preferencia en MP |

---

### `GET /api/subscriptions/checkout/success`

MP redirige aquí tras pago aprobado. Activa el plan y redirige al frontend.

→ Redirige a `FRONTEND_URL/billing?status=success&plan=pro`

---

### `GET /api/subscriptions/checkout/failure`

MP redirige aquí tras pago rechazado.

→ Redirige a `FRONTEND_URL/billing?status=failed&payment_id=...`

---

### `GET /api/subscriptions/checkout/pending`

MP redirige aquí cuando el pago está pendiente (ej: pago en efectivo).

→ Redirige a `FRONTEND_URL/billing?status=pending&payment_id=...`

---

### `POST /api/subscriptions/cancel`

Cancela la suscripción al fin del período. Requiere `billing:manage`.

**Response 200**
```json
{
  "data": { "activeUntil": "2026-05-25T00:00:00.000Z" },
  "message": "Suscripción cancelada. Acceso hasta 25/5/2026."
}
```

---

### `POST /api/subscriptions/reactivate`

Revierte una cancelación pendiente (solo si `subscriptionStatus === "cancelled"`). Requiere `billing:manage`.

**Response 200**
```json
{ "message": "Suscripción reactivada correctamente." }
```

---

### `POST /api/subscriptions/webhook/mercadopago`

IPN de MercadoPago. Sin autenticación. MP envía notificaciones aquí; el servidor las procesa de forma asíncrona.

Responde `200` de inmediato (requerido por MP). Luego consulta el pago y actualiza el tenant según `payment.status`:

| `payment.status` | Resultado |
|-----------------|-----------|
| `approved` | Plan activado, `subscriptionStatus: active`, período 1 mes |
| `rejected` / `cancelled` | `subscriptionStatus: past_due` |
| `refunded` / `charged_back` | `subscriptionStatus: expired`, `tenantStatus: suspended` |

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
