# Propuesta de Infraestructura — Sistema SaaS Inmobiliario
**Fecha:** Mayo 2026  
**Preparado por:** Equipo de Desarrollo  
**Para:** Análisis de costos y escalabilidad

---

## Resumen ejecutivo

El sistema utiliza una arquitectura **multi-tenant con base de datos por cliente**: existe una base de datos central para el directorio de inmobiliarias y el hub de propiedades, y se crea automáticamente una base de datos aislada para cada inmobiliaria que se registra.

Esta guía presenta **cuatro opciones de infraestructura** ordenadas de menor a mayor inversión inicial, con análisis de costo, rendimiento y escalabilidad para Argentina.

---

## Arquitectura del sistema

```
┌─────────────────────────────────────────────────────┐
│                  BASE DE DATOS CENTRAL               │
│  • Directorio de inmobiliarias                       │
│  • Hub de propiedades (todas las inmobiliarias)      │
│  • Registro de planes y suscripciones                │
└─────────────────────────────────────────────────────┘
           ↓ una BD por cada inmobiliaria ↓
┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐
│ garcia   │  │ martinez │  │ cordoba  │  │ salta    │
│ DB       │  │ DB       │  │ DB       │  │ DB       │
└──────────┘  └──────────┘  └──────────┘  └──────────┘
```

**¿Por qué una BD por cliente?**
- Los datos de cada inmobiliaria están completamente aislados
- Una falla en la BD de un cliente no afecta a los demás
- Se puede hacer backup, migrar o eliminar una inmobiliaria de forma independiente
- Escala horizontalmente sin límites

---

## Componentes de la infraestructura

| Componente | Función |
|-----------|---------|
| **API / Servidor** | Lógica de negocio, autenticación, endpoints REST |
| **BD Central** | Directorio global, hub de propiedades |
| **BD por Tenant** | Datos de cada inmobiliaria (propiedades, contactos, agenda) |
| **Storage de imágenes** | Fotos de propiedades, logos |
| **CDN** | Distribución de imágenes y archivos estáticos por toda Argentina |
| **Email transaccional** | Invitaciones, alertas de trial, recuperación de contraseña |

---

## Opciones de infraestructura

---

### OPCIÓN A — Cloud completo (recomendada para iniciar)

**Concepto:** todo en la nube, sin servidores propios, sin mantenimiento de hardware.

```
Usuario Argentina
      ↓
Cloudflare CDN (PoPs en BsAs, Córdoba, Rosario, Mendoza, Tucumán)
      ↓ imágenes/assets: 5–15ms
API en la nube (Ohio, USA)
      ↓ ~140ms desde Argentina
Base de datos en São Paulo, Brasil
      ↓ ~15ms desde la API
```

#### Servicios y costos

| Servicio | Función | Costo USD/mes | Costo ARS/mes* |
|---------|---------|--------------|----------------|
| **Neon PostgreSQL** (Plan Launch) | BD Central + todas las BDs de clientes | $19 | $20.900 |
| **Render** (Starter) | Servidor API siempre activo | $7 | $7.700 |
| **Cloudflare R2** | Storage de imágenes + CDN global | ~$0.50 | ~$550 |
| **Resend** | Email transaccional | $0 (hasta 3.000/mes) | $0 |
| **Total MVP** | | **~$26.50/mes** | **~$29.150/mes** |

*Tipo de cambio referencial: $1.100 ARS/USD*

#### Capacidad incluida

| Recurso | Incluido en este costo |
|---------|----------------------|
| Inmobiliarias (tenants) | Hasta ~100 (10 GB BD) |
| Propiedades por inmobiliaria | Ilimitadas (límite del plan) |
| Imágenes almacenadas | 25–30 GB (~50.000 fotos) |
| Emails por mes | 3.000 gratuitos |
| Uptime garantizado | 99.9% |

#### Escala de costos según cantidad de clientes

| Clientes | Neon | Render | Storage | **Total USD/mes** | **Total ARS/mes** |
|---------|------|--------|---------|-------------------|-------------------|
| 1–50 | $19 | $7 | $0.50 | **~$26.50** | **~$29.150** |
| 50–200 | $19 | $25 | $2 | **~$46** | **~$50.600** |
| 200–500 | $69 | $25 | $5 | **~$99** | **~$108.900** |
| 500–1.000 | $69 | $85 | $10 | **~$164** | **~$180.400** |
| +1.000 | $700 | $150+ | $20+ | **~$870+** | **~$957.000+** |

#### Pros y contras

| ✅ Ventajas | ❌ Desventajas |
|-----------|---------------|
| Sin inversión inicial en hardware | Pago mensual en USD |
| Sin mantenimiento técnico de servidores | Latencia ~140ms desde Argentina |
| Escala automáticamente | Dependencia de servicios de terceros |
| Nuevas BDs se crean solas en segundos | A 1.000+ clientes el costo sube |
| Backups automáticos incluidos | |
| Deploy nuevo en 5 minutos | |

---

### OPCIÓN B — Cloud optimizado para Argentina (recomendada al crecer)

**Concepto:** igual que Opción A pero moviendo el servidor API a São Paulo para reducir la latencia a ~20ms.

```
Usuario Argentina
      ↓
Cloudflare CDN (PoPs en Argentina)
      ↓ imágenes: 5–15ms
API en Fly.io São Paulo, Brasil
      ↓ ~20ms desde Argentina (vs 140ms en Opción A)
Base de datos en Neon São Paulo
      ↓ ~10ms desde la API
```

#### Servicios y costos

| Servicio | Función | Costo USD/mes | Costo ARS/mes |
|---------|---------|--------------|----------------|
| **Neon PostgreSQL** | BD Central + BDs de clientes | $19 | $20.900 |
| **Fly.io** (shared-cpu-2x, 1GB RAM) | Servidor API en São Paulo | $10–15 | $11.000–16.500 |
| **Cloudflare R2** | Storage + CDN | ~$0.50 | ~$550 |
| **Resend** | Email | $0 | $0 |
| **Total MVP** | | **~$30–35/mes** | **~$33.000–38.500/mes** |

#### Diferencia clave con Opción A

| | Opción A | Opción B |
|-|----------|----------|
| Latencia API desde Argentina | ~140ms | **~20ms** |
| Costo mensual MVP | ~$26.50 | ~$30–35 |
| Complejidad setup | Baja | Media |
| Experiencia de usuario | Buena | **Excelente** |

> **Recomendación:** iniciar con Opción A, migrar a Opción B cuando haya 20+ clientes pagos. La migración toma 1 día de trabajo y no requiere cambios en el código.

---

### OPCIÓN C — VPS dedicado en Europa (ahorro a largo plazo)

**Concepto:** servidor virtual privado en Hetzner (Alemania). Se administra vía SSH de forma remota.

```
Usuario Argentina
      ↓
Cloudflare CDN (imágenes/assets en Argentina)
      ↓
VPS Hetzner Frankfurt o Helsinki
(API + BD todo en un mismo servidor)
      ↓ ~200ms desde Argentina
```

#### Servicios y costos

| Servicio | Especificaciones | Costo EUR/mes | Costo USD/mes | Costo ARS/mes |
|---------|-----------------|--------------|--------------|----------------|
| **Hetzner CX32** | 4 vCPU, 8 GB RAM, 80 GB SSD | €11 | ~$12 | ~$13.200 |
| **Hetzner CCX23** | 4 vCPU dedicados, 8 GB RAM | €29 | ~$32 | ~$35.200 |
| **Cloudflare R2** | Storage + CDN imágenes | ~$0.50 | ~$0.50 | ~$550 |
| **Resend** | Email | $0 | $0 | $0 |
| **Total básico** | | | **~$12.50/mes** | **~$13.750/mes** |

#### Capacidad

| VPS | Clientes estimados | RAM disponible | Storage |
|-----|-------------------|---------------|---------|
| CX32 (€11) | Hasta 150–200 | 8 GB | 80 GB SSD |
| CCX23 (€29) | Hasta 400–500 | 8 GB dedicado | 80 GB SSD |
| Agregar volumen extra | — | — | +$0.05/GB/mes |

#### Importante: cambio en el provisioner

Con esta opción, **la creación automática de BDs cambia**: en lugar de usar la API de Neon, el servidor crea las bases de datos directamente en el PostgreSQL local. Requiere **~8 horas adicionales de desarrollo** no incluidas en la estimación actual.

| ✅ Ventajas | ❌ Desventajas |
|-----------|---------------|
| Costo muy bajo (€11/mes) | Latencia ~200ms desde Argentina |
| Control total del servidor | Requiere trabajo adicional de dev (~8h) |
| Sin dependencia de Neon | Backups manuales o configurados aparte |
| Fácil migración futura | Administración técnica del servidor |
| Pago en EUR (útil si tienen ingresos en USD) | No escala automáticamente |

---

### OPCIÓN D — Servidor propio en Argentina

**Concepto:** hardware físico en las instalaciones del cliente (ej. Córdoba). Máximo control, mínimo costo mensual a largo plazo.

#### Inversión inicial (hardware)

| Equipo | Especificaciones | Costo ARS estimado |
|-------|-----------------|-------------------|
| **Servidor básico** | Mini PC / workstation, 8 GB RAM, SSD 500 GB | $1.500.000–$2.500.000 |
| **Servidor dedicado** | Rack server, 16 GB RAM, SSD 1 TB, RAID | $3.000.000–$5.000.000 |
| **UPS** (protección cortes de luz) | 1500VA | $300.000–$500.000 |
| **Total inversión inicial** | | **$1.800.000–$5.500.000** |

#### Costos mensuales recurrentes

| Concepto | Costo ARS/mes |
|---------|---------------|
| Internet con IP fija (Fibertel/Claro empresas) | $25.000–$50.000 |
| Electricidad estimada (servidor 24/7) | $15.000–$25.000 |
| Cloudflare R2 (imágenes) | ~$550 |
| Resend (email) | $0 |
| **Total mensual** | **~$40.000–$75.550/mes** |

#### Requerimientos técnicos

| Requisito | Obligatorio | Quién lo hace |
|---------|-------------|---------------|
| Setup inicial del servidor (SO, PostgreSQL, Nginx, SSL) | Sí | Nosotros (remoto via SSH) |
| IP fija del ISP | Sí | El cliente gestiona con su ISP |
| UPS instalado | Sí | El cliente |
| Persona técnica en el local | Sí | Empleado del cliente con conocimientos básicos de IT |
| Monitoreo y updates | Sí | Nosotros (remoto) |

#### Análisis de amortización vs cloud

| Inversión | Tiempo para igualar Opción A ($26.50/mes) | Tiempo para igualar Opción C (€11/mes) |
|----------|------------------------------------------|----------------------------------------|
| $1.800.000 ARS (básico) | ~62 meses (5 años) | — |
| $3.500.000 ARS (dedicado) | ~120 meses (10 años) | — |

> El servidor propio solo es rentable si tienen +300 clientes activos y quieren reducir costos a largo plazo.

| ✅ Ventajas | ❌ Desventajas |
|-----------|---------------|
| Latencia mínima si el servidor está en Argentina | Alta inversión inicial |
| Sin costo en USD | Amortización en 5–10 años |
| Datos en Argentina (cumplimiento legal) | Necesita persona técnica en el local |
| Control total | Sin escala automática |
| | Riesgo de cortes de luz, internet, hardware |

---

## Comparativa directa de opciones

### Costo a lo largo del tiempo (30 clientes pagos)

| | Opción A (Cloud) | Opción B (Cloud AR) | Opción C (VPS) | Opción D (Propio) |
|-|-----------------|--------------------|--------------|--------------------|
| Inversión inicial | $0 | $0 | $0 | $1.800.000+ ARS |
| Mes 1 | $29.150 ARS | $33.000 ARS | $13.750 ARS | $40.000+ ARS |
| Mes 12 | $349.800 ARS | $396.000 ARS | $165.000 ARS | $480.000+ ARS |
| Mes 36 | $1.049.400 ARS | $1.188.000 ARS | $495.000 ARS | $1.440.000+ ARS |
| **Total 3 años** | **~$1.049.400** | **~$1.188.000** | **~$495.000** | **~$3.240.000+** |

*Los costos ARS son aproximados. Los servicios en USD se pagan al tipo de cambio vigente.*

---

### Comparativa técnica

| Criterio | Opción A | Opción B | Opción C | Opción D |
|---------|----------|----------|----------|----------|
| **Latencia desde Argentina** | ~140ms | **~20ms** | ~200ms | **~5ms** |
| **Costo mensual (50 clientes)** | $29.150 | $33.000 | $13.750 | $40.000+ |
| **Escala automática** | ✅ | ✅ | Manual | Manual |
| **Mantenimiento** | Ninguno | Ninguno | Bajo | Alto |
| **Backups automáticos** | ✅ | ✅ | Manual | Manual |
| **Inversión inicial** | $0 | $0 | $0 | $1.8M+ ARS |
| **Datos en Argentina** | ❌ | ❌ | ❌ | ✅ |
| **Nueva inmobiliaria lista en** | 5 seg | 5 seg | 5 seg | 5 seg* |
| **Requiere personal IT local** | No | No | No | Sí |

*Con Opción D requiere ~8h adicionales de desarrollo para adaptar el provisioner*

---

## Recomendación según etapa del proyecto

### Etapa 1 — Lanzamiento (0 a 50 clientes)

**Recomendamos: Opción A — Cloud completo**

- Costo: ~$26–30 USD/mes
- Sin inversión inicial
- El equipo de desarrollo se enfoca en el producto, no en servidores
- Si el proyecto no funciona, no hay hardware que recuperar
- Migrar a otra opción en el futuro toma 1–2 días de trabajo

### Etapa 2 — Crecimiento (50 a 200 clientes)

**Recomendamos: Opción B — Cloud optimizado para Argentina**

- Migrar la API de Ohio a São Paulo (Fly.io)
- Mejora de latencia: 140ms → 20ms para todos los usuarios de Argentina
- Costo adicional: ~$5–8 USD/mes (mínimo)
- Sin cambios en el código de la aplicación

### Etapa 3 — Escala (200+ clientes)

**Recomendamos: Opción C — VPS Hetzner o Fly.io con más recursos**

- Evaluar Hetzner dedicado según volumen
- Considerar bases de datos gestionadas (Supabase o DigitalOcean Managed PG)
- El costo por cliente baja a medida que crece la base

### Etapa 4 — Enterprise (requisitos especiales)

**Considerar Opción D si:**
- Hay requisitos legales de datos en Argentina
- El cliente tiene IT propio en su oficina
- El volumen justifica la inversión (300+ clientes activos)

---

## Storage de imágenes — detalle

Las fotos de propiedades son el contenido de mayor volumen. Se procesan automáticamente al subir:

```
Foto original (3–8 MB jpg/png)
        ↓
Procesamiento automático en el servidor
        ↓
Foto optimizada WebP (200–400 KB)    ← para el detalle
Thumbnail WebP (25–40 KB)            ← para el listado
        ↓
Guardados en Cloudflare R2
Disponibles via CDN en toda Argentina en 5–15ms
```

**Ahorro de ancho de banda:** una foto de 5 MB queda en ~280 KB WebP (94% menos). En conexiones móviles del interior del país, esto es crítico.

| Escenario | Fotos almacenadas | Storage estimado | Costo R2/mes |
|---------|-----------------|-----------------|-------------|
| 50 inmobiliarias, 200 fotos c/u | 10.000 fotos | ~5 GB | ~$0.08 |
| 200 inmobiliarias, 300 fotos c/u | 60.000 fotos | ~28 GB | ~$0.42 |
| 500 inmobiliarias, 400 fotos c/u | 200.000 fotos | ~85 GB | ~$1.28 |

---

## Pagos — MercadoPago

MercadoPago es la opción estándar para Argentina. Ya está integrado en el sistema.

| Concepto | Costo |
|---------|-------|
| Tarjeta de crédito (1 cuota) | 3.49% + IVA |
| Tarjeta de débito | 0.99% + IVA |
| Transferencia / CVU | 0% |
| Efectivo (Rapipago, Pago Fácil) | 3.49% + IVA |

No hay costo mensual fijo. Solo se paga comisión por transacción exitosa.

---

## Emails transaccionales — Resend

El sistema envía emails automáticos para:
- Invitar nuevos usuarios a una inmobiliaria
- Alertar cuando el trial está por vencer (7, 3 y 1 día antes)
- Recuperación de contraseña
- Confirmación de pago

| Plan | Emails/mes | Costo USD/mes |
|------|-----------|--------------|
| Gratis | 3.000 | $0 |
| Pro | 50.000 | $20 |
| Business | 100.000 | $90 |

Para los primeros 50–100 clientes, el plan gratuito es más que suficiente.

---

## Preguntas frecuentes

**¿Qué pasa si Neon tiene un problema?**  
Neon garantiza 99.9% de uptime. En caso de caída, las bases de datos existentes siguen disponibles. Solo se verían afectadas las creaciones de nuevas inmobiliarias durante el incidente.

**¿Los datos de cada inmobiliaria están separados?**  
Sí. Cada inmobiliaria tiene su propia base de datos PostgreSQL. Un error en los datos de un cliente no puede afectar los datos de otro.

**¿Se puede migrar a otro proveedor en el futuro?**  
Sí. PostgreSQL es estándar. Un `pg_dump` exporta todos los datos y se importan en cualquier servidor PostgreSQL del mundo. La migración de 100 clientes lleva aproximadamente 1 noche de trabajo.

**¿Qué pasa si el proyecto crece más de lo esperado?**  
El sistema escala horizontalmente. Agregar más recursos (más RAM, más CPU, plan superior de BD) no requiere cambios en el código.

**¿Pueden tener múltiples regiones geográficas?**  
Sí. En una etapa avanzada se puede replicar la base de datos en múltiples regiones para garantizar disponibilidad 24/7 incluso si una región completa cae.

---

## Resumen de decisión

| Si priorizan... | Elegir |
|----------------|--------|
| Mínimo costo inicial, arrancar rápido | **Opción A** |
| Mejor experiencia para usuarios argentinos | **Opción B** |
| Menor costo mensual, sin inversión inicial | **Opción C** |
| Control total, datos en Argentina | **Opción D** |

**Para la mayoría de los proyectos SaaS en etapa de lanzamiento en Argentina, la Opción A es la decisión correcta.** Permite validar el negocio sin comprometer capital en infraestructura, y escalar a cualquiera de las otras opciones cuando el volumen lo justifique.

---

*Documento preparado por el equipo de desarrollo — Mayo 2026*  
*Los costos en ARS son aproximados al tipo de cambio vigente y pueden variar.*  
*Los costos en USD corresponden a los precios publicados por cada proveedor al momento de la elaboración.*
