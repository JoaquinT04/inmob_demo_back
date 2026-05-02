# Guía frontend — Flujos principales de la página central

Fecha: Mayo 2026  
Backend: `https://inmob-demo-back.onrender.com`

Esta guía cubre los flujos que el frontend necesita implementar en la **página principal del producto** (landing + portal hub + alta de nuevas inmobiliarias + billing dentro de la app).

---

## Índice

1. [Cómo funciona el routing de tenants](#1-cómo-funciona-el-routing-de-tenants)
2. [Flujo: registro de nueva inmobiliaria](#2-flujo-registro-de-nueva-inmobiliaria)
3. [Flujo: login](#3-flujo-login)
4. [Flujo: Hub — propiedades de todas las inmobiliarias](#4-flujo-hub--propiedades-de-todas-las-inmobiliarias)
5. [Flujo: gestión de licencia y pagos](#5-flujo-gestión-de-licencia-y-pagos)
6. [Variables de entorno que el frontend necesita](#6-variables-de-entorno-que-el-frontend-necesita)
7. [Configuración del cliente HTTP](#7-configuración-del-cliente-http)
8. [Manejo de errores global](#8-manejo-de-errores-global)

---

## 1. Cómo funciona el routing de tenants

La API es multi-tenant: cada inmobiliaria tiene su propia base de datos. El frontend debe decirle a la API con qué inmobiliaria está trabajando.

### Dos modos de operación

#### Modo A — Sin subdominios (desarrollo y staging)

Todo el mundo entra por el mismo dominio (`app.com`). El frontend envía el tenant via header:

```
X-Tenant: garcia
```

**Cómo funciona:**
- El usuario escribe o selecciona el subdomain en el login
- El frontend guarda ese valor en `localStorage` (o estado global)
- Cada request lleva `X-Tenant: <subdomain>` en los headers

#### Modo B — Con subdominios (producción con DNS wildcard)

Cada inmobiliaria tiene su propia URL: `garcia.app.com`, `martinez.app.com`.

**Requisitos en el servidor DNS:**
```
*.app.com → servidor backend
```

**Cómo funciona:**
- El usuario entra a `garcia.app.com/login`
- El backend detecta el subdominio del hostname automáticamente
- El frontend NO necesita enviar `X-Tenant` (pero puede enviarlo de todas formas — tiene prioridad)

**Variable de entorno del backend que activa esto:** `APP_DOMAIN=app.com`

### Recomendación para el frontend

**Siempre enviar `X-Tenant`** aunque estés en modo subdominio. Si el usuario está en `garcia.app.com`, leer el subdominio de la URL y ponerlo en el header. Así funciona en ambos modos sin cambios.

```typescript
// Detectar tenant del hostname (modo subdominio) o de storage (modo header)
function detectTenant(): string | null {
  const host = window.location.hostname; // "garcia.app.com"
  const appDomain = 'app.com'; // tu dominio base

  if (host.endsWith(`.${appDomain}`)) {
    return host.replace(`.${appDomain}`, ''); // "garcia"
  }

  return localStorage.getItem('tenant'); // fallback
}
```

### Endpoints que NO necesitan X-Tenant

```
GET  /health
GET  /api/portal/provision
GET  /api/portal/hub
GET  /api/portal/hub/:id
GET  /api/portal/tenants
GET  /api/portal/plans
GET  /api/register/check-slug/:slug
GET  /api/subscriptions/plans
GET  /api/subscriptions/checkout/success   (redirect de MercadoPago)
GET  /api/subscriptions/checkout/failure   (redirect de MercadoPago)
GET  /api/subscriptions/checkout/pending   (redirect de MercadoPago)
POST /api/subscriptions/webhook/mercadopago
```

---

## 2. Flujo: registro de nueva inmobiliaria

Este flujo crea la inmobiliaria, su base de datos con todas las tablas, el usuario owner, y retorna un token listo para usar. **Todo en un solo request.**

### Paso 1 — Verificar disponibilidad del subdomain (opcional, recomendado)

```
GET /api/register/check-slug/garcia
```

No necesita headers. Respuesta:
```json
{ "available": true, "slug": "garcia" }
{ "available": false, "slug": "demo" }
```

Llamar en tiempo real mientras el usuario escribe (debounce 400ms).

### Paso 2 — Crear la inmobiliaria

```
POST /api/portal/provision
Content-Type: application/json
```

Body:
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

| Campo | Requerido | Reglas |
|-------|-----------|--------|
| `subdomain` | ✅ | Minúsculas, números, guiones. 3–50 caracteres. Único. |
| `name` | ✅ | 2–100 caracteres |
| `ownerEmail` | ✅ | Email válido |
| `ownerFirstName` | ✅ | 1–80 caracteres |
| `ownerLastName` | ✅ | 1–80 caracteres |
| `password` | ✅ | Mínimo 6 caracteres |
| `taxId` | — | CUIT/RUT. Máx 20 caracteres |
| `country` | — | Código ISO 2 letras. Default: `AR` |
| `timezone` | — | Default: `America/Argentina/Buenos_Aires` |

**Response 201 — éxito:**
```json
{
  "token": "eyJhbGciOiJIUzI1NiJ9...",
  "subdomain": "garcia",
  "loginUrl": "https://garcia.app.com",
  "message": "Inmobiliaria \"Inmobiliaria García\" creada. Trial de 30 días activo."
}
```

**Qué hace este endpoint internamente:**
1. Crea una base de datos PostgreSQL nueva en Neon (cloud)
2. Crea todas las tablas automáticamente
3. Crea el usuario owner con contraseña hasheada
4. Registra la inmobiliaria en el directorio central
5. Activa el trial de 30 días
6. Genera y retorna un JWT válido

**Lo que el frontend debe hacer al recibir 201:**
```typescript
// 1. Guardar token y tenant
localStorage.setItem('token', data.token);
localStorage.setItem('tenant', data.subdomain);

// 2. Redirigir a la app
// Opción A (sin subdominios): ir a /dashboard
router.push('/dashboard');

// Opción B (con subdominios): redirigir al subdominio
window.location.href = data.loginUrl + '/dashboard';
```

**Errores:**
| Status | code | Qué mostrar |
|--------|------|-------------|
| 400 | — | Mostrar errores de validación del campo correspondiente |
| 409 | `SUBDOMAIN_TAKEN` | "Ese nombre ya está en uso, elegí otro" |
| 500 | `PROVISION_ERROR` | "Error al crear la inmobiliaria. Intentá de nuevo en un momento." |

> **Nota:** La provisión tarda entre 3 y 8 segundos (crea la DB en la nube). Mostrar un loading con mensaje tipo "Preparando tu espacio de trabajo…"

---

## 3. Flujo: login

### Login directo (el usuario sabe su subdomain)

```
POST /api/auth/login
Content-Type: application/json
X-Tenant: garcia
```

Body:
```json
{
  "email": "garcia@ejemplo.com",
  "password": "miPassword123"
}
```

Response 200:
```json
{
  "token": "eyJhbGciOiJIUzI1NiJ9...",
  "user": {
    "id": "28ca9dc6-...",
    "email": "garcia@ejemplo.com",
    "firstName": "Juan",
    "lastName": "García",
    "avatarUrl": null,
    "roles": ["owner"],
    "groups": [],
    "permissions": ["agenda:create", "billing:manage", "property:create", "property:delete", "property:publish", "property:read", "property:update", "..."]
  },
  "tenant": {
    "name": "Inmobiliaria García",
    "subdomain": "garcia",
    "logoUrl": null,
    "plan": "free",
    "status": "trial"
  }
}
```

**Lo que el frontend debe hacer:**
```typescript
// Guardar todo
localStorage.setItem('token', data.token);
localStorage.setItem('tenant', data.tenant.subdomain);

// Hidratar estado global (Zustand / Redux / Context)
store.setUser(data.user);
store.setTenant(data.tenant);
store.setPermissions(data.user.permissions);

// Redirigir
router.push('/dashboard');
```

### Login con selector de inmobiliaria (el usuario no sabe su subdomain)

Primero obtener la lista:
```
GET /api/portal/tenants
```

Response:
```json
{
  "data": [
    { "subdomain": "garcia", "name": "Inmobiliaria García", "logoUrl": null },
    { "subdomain": "martinez", "name": "Martínez Propiedades", "logoUrl": "https://..." }
  ]
}
```

Mostrar un selector con buscador. Al elegir, poner el subdomain en el campo de `X-Tenant` del formulario de login.

### Al iniciar la app (hidratar sesión)

Si hay un token guardado:
```
GET /api/auth/me
Authorization: Bearer <token>
X-Tenant: garcia
```

Response 200 → mismo que login, más el campo `preferences`.  
Response 401 → token vencido → borrar localStorage y redirigir a login.

---

## 4. Flujo: Hub — propiedades de todas las inmobiliarias

El hub es el listado central de propiedades publicadas por **todas** las inmobiliarias del sistema. No requiere login ni X-Tenant.

### Listar propiedades del hub

```
GET /api/portal/hub
```

Con filtros opcionales:
```
GET /api/portal/hub?operationType=sale&city=C%C3%B3rdoba&priceMin=50000&priceMax=150000&rooms=3&page=1&perPage=20
```

| Param | Tipo | Descripción |
|-------|------|-------------|
| `type` | string | `house` `apartment` `land` `commercial` `office` `warehouse` `garage` `other` |
| `operationType` | string | `sale` `rent` `temporary_rent` |
| `city` | string | Búsqueda parcial, case-insensitive |
| `priceMin` | number | Precio mínimo |
| `priceMax` | number | Precio máximo |
| `rooms` | number | Cantidad de ambientes exacta |
| `page` | number | Default `1` |
| `perPage` | number | Default `20`, máx `100` |

Response 200:
```json
{
  "data": [
    {
      "id": "uuid",
      "tenantSubdomain": "garcia",
      "tenantName": "Inmobiliaria García",
      "tenantLogoUrl": null,
      "externalId": "uuid-de-la-propiedad-en-el-tenant",
      "title": "Departamento en Nueva Córdoba",
      "type": "apartment",
      "operationType": "sale",
      "price": 95000,
      "currency": "USD",
      "city": "Córdoba",
      "neighborhood": "Nueva Córdoba",
      "state": "Córdoba",
      "rooms": 3,
      "publishedAt": "2026-05-01T14:00:00.000Z",
      "lastSyncAt": "2026-05-01T14:00:00.000Z"
    }
  ],
  "meta": {
    "total": 47,
    "page": 1,
    "perPage": 20,
    "totalPages": 3
  }
}
```

### Detalle de propiedad del hub

```
GET /api/portal/hub/:id
```

Retorna el mismo objeto individual. Si quiere ver todos los datos de la propiedad original (imágenes, descripción, etc.), usar el `tenantSubdomain` + `externalId` para armar el link al portal de esa inmobiliaria.

### ¿Qué propiedades aparecen en el hub?

Solo aparecen propiedades de inmobiliarias con **plan PRO o ENTERPRISE** que hayan publicado (`status: active`). Las del plan FREE no se sincronizan al hub.

---

## 5. Flujo: gestión de licencia y pagos

Esta sección vive dentro del panel de la inmobiliaria. Ruta sugerida: `/settings/billing`.

### Ver estado actual de la suscripción

```
GET /api/subscriptions/me
Authorization: Bearer <token>
X-Tenant: garcia
```

Response:
```json
{
  "data": {
    "subdomain": "garcia",
    "plan": "free",
    "planLimits": {
      "maxUsers": 3,
      "maxProperties": 20,
      "maxPhotosPerProperty": 5,
      "canExport": false,
      "canUsePortals": false,
      "canUseHub": false,
      "canUseApi": false,
      "supportLevel": "community"
    },
    "planPricing": {
      "price": 0,
      "currency": "USD",
      "interval": "month",
      "label": "Gratis"
    },
    "status": "trial",
    "subscriptionStatus": "trialing",
    "trialEndsAt": "2026-05-30T00:00:00.000Z",
    "trialDaysLeft": 28,
    "currentPeriodEnd": null,
    "cancelAtPeriodEnd": false,
    "paymentProvider": null
  }
}
```

**Estados posibles:**

| `subscriptionStatus` | `status` | Qué mostrar |
|---------------------|----------|-------------|
| `trialing` | `trial` | Banner amarillo: "X días de prueba restantes" |
| `active` | `active` | Badge verde con el plan + fecha de renovación |
| `past_due` | `active` | Alerta roja: "Pago pendiente — actualizá tu método de pago" |
| `cancelled` | `active` | Banner naranja: "Suscripción cancelada, activa hasta [fecha]" + botón Reactivar |
| `expired` | `suspended` | Pantalla de bloqueo: "Cuenta suspendida" |

### Ver catálogo de planes (para mostrar tabla de precios)

```
GET /api/subscriptions/plans
```

No requiere headers. Retorna los 3 planes con precios y límites:
```json
{
  "data": [
    {
      "id": "free",
      "price": 0,
      "currency": "USD",
      "interval": "month",
      "label": "Gratis",
      "limits": { "maxUsers": 3, "maxProperties": 20, "canUseHub": false, "canExport": false, ... }
    },
    {
      "id": "pro",
      "price": 29.99,
      "currency": "USD",
      "interval": "month",
      "label": "Pro",
      "limits": { "maxUsers": 15, "maxProperties": 500, "canUseHub": true, "canExport": true, ... }
    },
    {
      "id": "enterprise",
      "price": 89.99,
      "currency": "USD",
      "interval": "month",
      "label": "Enterprise",
      "limits": { "maxUsers": -1, "maxProperties": -1, "canUseHub": true, "canExport": true, ... }
    }
  ]
}
```

> Nota: `-1` en los límites significa "sin límite". Mostrarlo como "Ilimitado" en la UI.

### Iniciar pago (upgrade de plan)

Requiere permiso `billing:manage` (solo el owner lo tiene por defecto).

```
POST /api/subscriptions/checkout
Authorization: Bearer <token>
X-Tenant: garcia
Content-Type: application/json

{
  "plan": "pro",
  "successUrl": "https://tuapp.com/settings/billing",
  "failureUrl": "https://tuapp.com/settings/billing?error=payment_failed"
}
```

Response:
```json
{
  "checkoutUrl": "https://www.mercadopago.com.ar/checkout/v1/redirect?pref_id=...",
  "preferenceId": "...",
  "plan": "pro",
  "pricing": { "price": 29.99, "currency": "USD", "interval": "month", "label": "Pro" }
}
```

**El frontend redirige al usuario:**
```typescript
window.location.href = data.checkoutUrl;
```

MercadoPago maneja todo el pago y redirige de vuelta a `successUrl` o `failureUrl` con params:

| Param | Valor | Cuándo |
|-------|-------|--------|
| `status` | `success` | Pago aprobado. El plan ya está activo. |
| `status` | `failed` | Pago rechazado |
| `status` | `pending` | Pago en proceso (efectivo, transferencia) |
| `plan` | `pro` | Solo en success — el plan activado |
| `payment_id` | string | ID del pago en MP |

**Al aterrizar en `/settings/billing?status=success`:**
```typescript
// Recargar estado de la suscripción
const { data } = await api.get('/api/subscriptions/me');
store.setSubscription(data);

// Mostrar toast de éxito
toast.success(`Plan ${data.plan} activado.`);
```

### Cancelar suscripción

```
POST /api/subscriptions/cancel
Authorization: Bearer <token>
X-Tenant: garcia
```

Response:
```json
{
  "data": { "activeUntil": "2026-06-25T00:00:00.000Z" },
  "message": "Suscripción cancelada. Acceso hasta 25/6/2026."
}
```

### Reactivar cancelación

```
POST /api/subscriptions/reactivate
Authorization: Bearer <token>
X-Tenant: garcia
```

Solo funciona si `subscriptionStatus === "cancelled"`. Revierte antes del fin del período.

---

## 6. Variables de entorno que el frontend necesita

```env
VITE_API_URL=https://inmob-demo-back.onrender.com
VITE_APP_DOMAIN=tudominio.com        # Solo para modo subdominio
```

---

## 7. Configuración del cliente HTTP

```typescript
// lib/api.ts
import axios from 'axios';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL,
  headers: { 'Content-Type': 'application/json' },
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  const tenant = detectTenant(); // ver sección 1

  if (token) config.headers['Authorization'] = `Bearer ${token}`;
  if (tenant) config.headers['X-Tenant'] = tenant;

  return config;
});

api.interceptors.response.use(
  (res) => res,
  (err) => {
    const status = err.response?.status;
    const code = err.response?.data?.code;

    if (status === 401) {
      localStorage.removeItem('token');
      window.location.href = '/login';
    }

    if (status === 402 && code === 'TRIAL_EXPIRED') {
      window.location.href = '/settings/billing?reason=trial_expired';
    }

    if (status === 402 && code === 'PLAN_LIMIT_REACHED') {
      // Mostrar modal de upgrade con los datos del límite
      const { limit, current } = err.response.data;
      store.showUpgradeModal({ limit, current });
    }

    if (status === 403 && code === 'ACCOUNT_SUSPENDED') {
      window.location.href = '/suspended';
    }

    return Promise.reject(err);
  }
);

export default api;
```

---

## 8. Manejo de errores global

### Headers de advertencia en respuestas exitosas

El backend agrega headers en respuestas 200 cuando hay alertas activas. El frontend debe leerlos:

```typescript
// En el interceptor de response:
const trialDaysLeft = res.headers['x-trial-days-left'];
const billingWarning = res.headers['x-billing-warning'];

if (trialDaysLeft && Number(trialDaysLeft) <= 7) {
  store.setTrialWarning(Number(trialDaysLeft)); // Mostrar banner
}

if (billingWarning === 'payment_failed') {
  store.setBillingWarning(true); // Mostrar alerta de pago
}
```

### Tabla completa de errores de licencia

| Status | code | Situación | Acción en UI |
|--------|------|-----------|--------------|
| 400 | `TENANT_MISSING` | Falta X-Tenant | Redirigir a selector de inmobiliaria |
| 404 | `TENANT_NOT_FOUND` | Subdomain no existe | Redirigir a inicio |
| 401 | `INVALID_CREDENTIALS` | Email/pass incorrectos | Mostrar error en el form |
| 401 | (sin code) | Token vencido | Redirigir a login |
| 402 | `TRIAL_EXPIRED` | Trial vencido | Redirigir a `/settings/billing` |
| 402 | `PLAN_LIMIT_REACHED` | Límite de plan | Modal de upgrade |
| 402 | `FEATURE_NOT_IN_PLAN` | Feature no disponible | Banner "Disponible en plan Pro" |
| 403 | `FORBIDDEN` | Sin permiso | Toast "Sin permiso" |
| 403 | `ACCOUNT_SUSPENDED` | Cuenta suspendida | Pantalla de pago pendiente |
| 403 | `ACCOUNT_CANCELLED` | Cuenta cancelada | Pantalla de reactivación |
| 409 | `SUBDOMAIN_TAKEN` | Subdomain en uso | Error en el form de registro |
