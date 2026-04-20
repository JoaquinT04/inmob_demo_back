# API Endpoints — inmob_demo_back

**Base URL:** `https://inmob-demo-back.onrender.com`

> Todos los endpoints protegidos requieren header:
> `Authorization: Bearer <token>`
>
> El token se obtiene en `POST /api/auth/login`.

---

## Índice

1. [Health](#health)
2. [Auth](#auth)
3. [Registro de inmobiliaria](#registro-de-inmobiliaria)
4. [Propiedades](#propiedades)
5. [Usuarios del tenant](#usuarios-del-tenant)
6. [Permisos](#permisos)
7. [Licencia — códigos de error](#licencia--códigos-de-error)

---

## Health

### `GET /health`

Verifica que la API está viva. Sin autenticación.

**Response 200**
```json
{
  "status": "ok",
  "timestamp": "2026-04-20T01:32:20.620Z"
}
```

---

## Auth

### `POST /api/auth/login`

Login con email + contraseña + slug de la inmobiliaria. Devuelve JWT y permisos resueltos.

**Body**
```json
{
  "email": "owner@demo.com",
  "tenantSlug": "inmob-demo",
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
    "id": "ef6b076a-...",
    "name": "Inmobiliaria Demo",
    "slug": "inmob-demo",
    "logoUrl": null,
    "plan": "free",
    "status": "trial"
  }
}
```

**Errores**
| Status | code | Cuándo |
|--------|------|--------|
| 401 | `INVALID_CREDENTIALS` | Email o contraseña incorrectos |
| 401 | `NO_PASSWORD` | Usuario sin contraseña asignada |
| 403 | `USER_INACTIVE` | Usuario desactivado |
| 404 | `TENANT_NOT_FOUND` | Slug de inmobiliaria no existe |

---

### `GET /api/auth/me`

Devuelve el usuario autenticado con permisos actuales. Útil al iniciar la app del frontend para hidratar el estado global.

**Headers:** `Authorization: Bearer <token>`

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
    "lastLoginAt": "2026-04-20T01:32:00.000Z"
  },
  "tenant": {
    "id": "ef6b076a-...",
    "name": "Inmobiliaria Demo",
    "slug": "inmob-demo",
    "logoUrl": null,
    "plan": "free",
    "status": "trial"
  },
  "permissions": ["agenda:create", "billing:manage", "property:create", "..."]
}
```

---

### `POST /api/auth/logout`

Stateless — el servidor no invalida el token (no hay sesión). El cliente debe descartar el token localmente.

**Response 204** (sin body)

---

### `GET /api/auth/users?tenant=inmob-demo`

Lista usuarios del tenant. Útil para construir un selector de login en el frontend de desarrollo.

**Query params**
| Param | Requerido | Descripción |
|-------|-----------|-------------|
| `tenant` | ✅ | Slug de la inmobiliaria |

**Response 200**
```json
{
  "tenant": {
    "id": "ef6b076a-...",
    "name": "Inmobiliaria Demo",
    "slug": "inmob-demo"
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

## Registro de inmobiliaria

### `GET /api/register/check-slug/:slug`

Verifica si un slug está disponible. Sin autenticación. Usar en tiempo real mientras el usuario escribe el nombre.

**Response 200**
```json
{ "available": true, "slug": "mi-inmobiliaria" }
```
```json
{ "available": false, "slug": "inmob-demo" }
```

**Response 400** — slug inválido (formato incorrecto o longitud)
```json
{
  "available": false,
  "error": "Slug inválido. Solo minúsculas, números y guiones (3-50 caracteres)."
}
```

---

### `POST /api/register`

Crea una inmobiliaria nueva con su owner. Devuelve JWT — el owner puede operar inmediatamente.
Sin autenticación.

**Body**
```json
{
  "agencyName": "Inmobiliaria García",
  "ownerEmail": "garcia@ejemplo.com",
  "ownerFirstName": "Carlos",
  "ownerLastName": "García",
  "ownerPhone": "+54 11 1234-5678",
  "password": "miPassword123",
  "taxId": "20-12345678-9",
  "country": "AR",
  "timezone": "America/Argentina/Buenos_Aires"
}
```

> `slug` es opcional — si no se envía, se genera automáticamente desde `agencyName`.

**Response 201**
```json
{
  "token": "eyJhbGciOiJIUzI1NiJ9...",
  "permissions": ["property:create", "property:read", "..."],
  "tenant": {
    "id": "...",
    "name": "Inmobiliaria García",
    "slug": "inmobiliaria-garcia",
    "status": "trial",
    "plan": "free"
  },
  "subscription": {
    "id": "...",
    "status": "trialing",
    "trialEndsAt": "2026-05-04T00:00:00.000Z",
    "plan": "free"
  },
  "user": {
    "id": "...",
    "email": "garcia@ejemplo.com",
    "firstName": "Carlos",
    "lastName": "García",
    "roles": ["owner"]
  },
  "message": "Inmobiliaria \"Inmobiliaria García\" creada. Trial activo hasta 4/5/2026."
}
```

**Errores**
| Status | code | Cuándo |
|--------|------|--------|
| 409 | `SLUG_TAKEN` | El slug ya existe |
| 409 | `EMAIL_TAKEN` | El email ya tiene cuenta |
| 400 | `PASSWORD_REQUIRED` | No se envió contraseña |

---

## Propiedades

### `GET /api/properties`

Lista propiedades del tenant con paginación y filtros opcionales.

**Headers:** `Authorization: Bearer <token>`

**Query params (todos opcionales)**
| Param | Valores posibles |
|-------|-----------------|
| `status` | `draft` `active` `reserved` `sold` `rented` `paused` `archived` |
| `type` | `house` `apartment` `land` `commercial` `office` `warehouse` `garage` `other` |
| `operationType` | `sale` `rent` `temporary_rent` |
| `page` | número (default: 1) |
| `perPage` | número máx 100 (default: 20) |

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
        "state": "Buenos Aires",
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
      "publishedAt": "2026-04-20T12:00:00.000Z",
      "createdAt": "2026-04-20T10:00:00.000Z"
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

Crea una propiedad nueva en estado `draft`.

**Headers:** `Authorization: Bearer <token>`

**Body**
```json
{
  "title": "Casa en Palermo",
  "description": "Hermosa casa con jardín, 3 dormitorios, cochera.",
  "type": "house",
  "operationType": "sale",
  "price": 180000,
  "currency": "USD",
  "expenses": 15000,
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
  "amenities": ["pileta", "quincho", "seguridad 24hs"],
  "assignedUserId": "2c568973-..."
}
```

> `slug`, `expenses`, `description`, `assignedUserId` son opcionales.
> `status` siempre arranca en `draft` — publicar con el endpoint `/publish`.

**Response 201**
```json
{
  "data": {
    "id": "...",
    "title": "Casa en Palermo",
    "slug": "casa-en-palermo",
    "description": "Hermosa casa con jardín...",
    "type": "house",
    "operationType": "sale",
    "status": "draft",
    "price": 180000,
    "currency": "USD",
    "expenses": 15000,
    "address": { "...": "..." },
    "features": { "...": "..." },
    "amenities": ["pileta", "quincho", "seguridad 24hs"],
    "images": [],
    "publishedAt": null,
    "createdAt": "2026-04-20T10:00:00.000Z",
    "updatedAt": "2026-04-20T10:00:00.000Z"
  }
}
```

---

### `GET /api/properties/:id`

Devuelve el detalle completo de una propiedad.

**Headers:** `Authorization: Bearer <token>`

**Response 200** — misma forma que el objeto `data` del POST arriba.

**Response 404**
```json
{ "error": "Propiedad no encontrada" }
```

---

### `PATCH /api/properties/:id`

Edita campos de una propiedad. Todos los campos son opcionales — solo se actualizan los que se envían.

**Headers:** `Authorization: Bearer <token>`

**Body** (todos opcionales)
```json
{
  "title": "Casa en Palermo — con jardín",
  "price": 185000,
  "status": "reserved",
  "features": {
    "bathrooms": 3
  },
  "assignedUserId": "2c568973-...",
}
```

> Para des-asignar usuario: `"assignedUserId": null`
> No se puede editar una propiedad archivada.

**Response 200** — objeto `data` completo actualizado.

---

### `PATCH /api/properties/:id/publish`

Publica o pausa una propiedad. Requiere permiso `property:publish`.

**Headers:** `Authorization: Bearer <token>`

**Body**
```json
{ "publish": true }
```
> `publish: true` → estado `active`, setea `publishedAt` si no tenía.
> `publish: false` → estado `paused`.

**Response 200**
```json
{
  "data": {
    "id": "...",
    "status": "active",
    "publishedAt": "2026-04-20T12:00:00.000Z"
  },
  "message": "Propiedad publicada."
}
```

---

### `DELETE /api/properties/:id`

Archiva la propiedad (baja lógica — no se borra de la DB). Requiere permiso `property:delete`.

**Headers:** `Authorization: Bearer <token>`

**Response 204** (sin body)

---

## Usuarios del tenant

### `GET /api/settings/users`

Lista todos los usuarios de la inmobiliaria.

**Headers:** `Authorization: Bearer <token>` — requiere permiso `user:read`

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
      "lastLoginAt": "2026-04-20T01:32:00.000Z",
      "createdAt": "2026-04-19T14:57:00.000Z"
    }
  ]
}
```

---

### `POST /api/settings/users`

Invita un nuevo usuario al tenant. Requiere permiso `user:create`.
El admin debe asignar una contraseña con `PATCH /api/settings/users/:id`.

**Headers:** `Authorization: Bearer <token>`

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
  "data": {
    "id": "...",
    "email": "nuevo@ejemplo.com",
    "firstName": "Ana",
    "lastName": "López",
    "roles": ["agente"]
  },
  "message": "Usuario creado. El admin debe asignar una contraseña: PATCH /api/settings/users/<id>"
}
```

**Errores**
| Status | Cuándo |
|--------|--------|
| 409 | Email ya existe en este tenant |

---

### `GET /api/settings/users/:id`

Detalle de un usuario con sus permisos efectivos resueltos.

**Headers:** `Authorization: Bearer <token>` — requiere `user:read`

**Response 200**
```json
{
  "data": {
    "id": "...",
    "email": "agente@demo.com",
    "firstName": "Agente",
    "lastName": "Demo",
    "phone": null,
    "avatarUrl": null,
    "roles": ["agente"],
    "groups": [],
    "permissionOverrides": null,
    "isActive": true,
    "twoFactorEnabled": false,
    "preferences": {
      "theme": "dark",
      "language": "es",
      "timezone": "America/Argentina/Buenos_Aires"
    },
    "lastLoginAt": null,
    "createdAt": "2026-04-19T14:57:00.000Z",
    "permissions": ["contact:create", "contact:read", "property:create", "..."]
  }
}
```

---

### `PATCH /api/settings/users/:id`

Edita un usuario. Requiere permiso `user:update`.
No se puede cambiar el rol del owner.

**Headers:** `Authorization: Bearer <token>`

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

> `groups` valores disponibles: `property:viewer` `property:editor` `property:manager` `contact:viewer` `contact:editor` `contact:manager` `crm:viewer` `crm:manager` `report:viewer` `report:manager` `settings:viewer` `user:manager` `hub:publisher`

**Response 200**
```json
{
  "data": {
    "id": "...",
    "email": "agente@demo.com",
    "firstName": "Ana",
    "lastName": "González",
    "roles": ["coordinador"],
    "groups": ["report:viewer", "contact:manager"],
    "permissionOverrides": {
      "grant": ["report:export"],
      "deny": ["property:delete"]
    },
    "isActive": true
  }
}
```

---

### `DELETE /api/settings/users/:id`

Desactiva un usuario (baja lógica — no se borra). No se puede desactivar al owner.
Requiere permiso `user:delete`.

**Headers:** `Authorization: Bearer <token>`

**Response 204** (sin body)

---

## Permisos

### `GET /api/settings/permissions`

Devuelve la config de permisos del tenant + catálogo completo de grupos disponibles.
Requiere `settings:read`.

**Headers:** `Authorization: Bearer <token>`

**Response 200**
```json
{
  "data": {
    "permissionConfig": null,
    "availableGroups": [
      {
        "id": "property:manager",
        "name": "Propiedades — Gestor",
        "description": "Control total: publicar, eliminar y exportar propiedades.",
        "permissions": ["property:create", "property:read", "property:update", "property:delete", "property:publish", "property:export"],
        "impliedGroups": ["property:editor"]
      }
    ]
  }
}
```

---

### `PUT /api/settings/permissions/roles`

Customiza los permisos de un rol para toda la inmobiliaria (capa 3 del sistema).
Requiere `settings:manage`.

**Headers:** `Authorization: Bearer <token>`

**Body**
```json
{
  "role": "agente",
  "grant": ["report:read"],
  "deny": ["property:delete"]
}
```

> `role` valores: `administrador` `coordinador` `agente` `captador`

**Response 200**
```json
{
  "data": {
    "roleOverrides": {
      "agente": {
        "grant": ["report:read"],
        "deny": ["property:delete"]
      }
    }
  },
  "message": "Permisos del rol \"agente\" actualizados."
}
```

---

### `GET /api/settings/permissions/resolve/:userId`

Vista de diagnóstico: permisos efectivos de un usuario específico (todas las capas resueltas).
Requiere `settings:manage`.

**Headers:** `Authorization: Bearer <token>`

**Response 200**
```json
{
  "data": {
    "userId": "...",
    "email": "agente@demo.com",
    "roles": ["agente"],
    "groups": ["report:viewer"],
    "permissionOverrides": {
      "grant": ["report:export"],
      "deny": ["property:delete"]
    },
    "effectivePermissions": ["contact:create", "property:create", "report:read", "report:export", "..."],
    "totalCount": 12
  }
}
```

---

## Licencia — códigos de error

El middleware de licencia puede responder en cualquier endpoint protegido:

| Status | code | Situación | Qué hacer en el frontend |
|--------|------|-----------|--------------------------|
| 402 | `TRIAL_EXPIRED` | Trial vencido | Redirigir a `/settings/billing` |
| 402 | `PLAN_LIMIT_REACHED` | Límite del plan alcanzado | Mostrar modal de upgrade |
| 402 | `FEATURE_NOT_IN_PLAN` | Feature no disponible en el plan | Mostrar mensaje de upgrade |
| 403 | `ACCOUNT_SUSPENDED` | Cuenta suspendida (solo GET pasa) | Mostrar banner de pago pendiente |
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
