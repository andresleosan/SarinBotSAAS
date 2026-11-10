# Protocolo Operativo y Manual de Admisión de Reservas (R0-POLICY)

Este runbook describe el protocolo durable de admisión de reservas, los estados operativos, el corte a producción en modo `enforce`, los límites estrictos de reversión (rollback) y los procedimientos de recuperación.

---

## 1. Arquitectura y Marcador de Protocolo

La admisión de reservas protege el consentimiento, la clasificación y el modo de datos (`general` vs `health`) en todo el ciclo de vida de la reserva, el outbox de mensajería y la inferencia asistida por IA.

### Marcador Durable
- **Clave:** `serverSettings/bookingAdmissionProtocol` (almacenado en D1 tabla `app_documents`).
- **Esquema:**
  ```json
  {
    "version": 1,
    "minimumReader": 2,
    "introducedBySha": "<sha-40-o-64-del-commit-de-corte>"
  }
  ```
- **Invariante:** Creado de forma idempotente únicamente en el primer despliegue con `BOOKING_ADMISSION_RELEASE = 'enforce'` mediante `ensureBookingAdmissionProtocol`. Una vez registrado, es inmutable; ninguna versión preparatoria ni despliegue posterior puede degradarlo, sobrescribirlo ni eliminarlo.

---

## 2. Estados de Admisión y Semántica Operativa

El runtime evalúa la política de reserva (`serverSettings/booking_policy_<hash(businessId)>`) y el propietario actual del negocio para determinar uno de los cinco estados canónicos:

| Estado | Admisión | Reservas Nuevas | Inferencia IA | Consulta / Cancelación Cliente | Acción Requerida |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `active` | Activa | Permitida | Permitida (si `general`) / Bloqueada (si `health`) | Permitida | Operación normal. |
| `classification_required` | Requerida | Bloqueada (409) | Bloqueada (409) | Permitida (vía web/enlace) | Dueño debe declarar la política en su workspace/onboarding. |
| `withdrawn` | Retirada | Bloqueada (409) | Bloqueada (409) | Permitida (vía web/enlace) | Dueño retiró declaración; debe reactivarla o reclasificar. |
| `administrative_review` | Suspensión Admin | Bloqueada (409) | Bloqueada (409) | Permitida (vía web/enlace) | Superadmin suspendió la política; requiere revisión administrativa. |
| `transitioning` | Transición | Bloqueada (409) | Bloqueada (409) | Permitida (vía web/enlace) | Drenaje transaccional de dispatches en vuelo; se reanuda con `requestId`. |

### Modo Salud (`dataMode === 'health'`)
- Las reservas se gestionan exclusivamente mediante formulario estructurado web.
- La inferencia de modelos de IA está terminantemente bloqueada (`STRUCTURED_BOOKING_REQUIRED`, 409).
- No se descuentan ni consumen turnos de cuota (`responseQuotaTurns`).
- No se permiten campos de texto libre (`intakeFields`) que capturen datos de salud no estructurados (`BOOKING_FREE_INTAKE_NOT_ALLOWED`, 409).

---

## 3. Preflight de Release y Despliegue Enforce

El pipeline de lanzamiento de Cloudflare (`cloudflare/scripts/release-core.mjs` y `cloudflare/scripts/booking-admission-preflight.mjs`) ejecuta `assertBookingAdmissionRelease({ candidate, liveProtocol })` en dos momentos críticos:
1. **Pre-build:** Antes de compilar Next.js y el bundle del Worker.
2. **Pre-deploy:** Inmediatamente antes de aplicar migraciones y publicar a Cloudflare Pages / Worker.

### Validaciones del Preflight
- **Candidato Enforce:** Requiere `BOOKING_ADMISSION_RELEASE === 'enforce'`, `recoveryCompatible === true`, `reader >= 2` y un SHA de Git válido (40 o 64 caracteres hex).
- **Prevención de Downgrade:** Si la base de datos viva ya contiene el marcador `bookingAdmissionProtocol`, cualquier artefacto con `release === 'prepare'` es rechazado de inmediato (`PREFLIGHT_BOOKING_ADMISSION_DOWNGRADE`).
- **Lector Obsoleto:** Si la versión del lector del candidato es menor a `liveProtocol.minimumReader`, se rechaza el despliegue (`PREFLIGHT_BOOKING_ADMISSION_READER_OBSOLETE`).
- **Corrupción:** Si el marcador vivo está corrupto o malformado, se aborta el despliegue antes de realizar escrituras (`PREFLIGHT_BOOKING_ADMISSION_MARKER_CORRUPT`).

---

## 4. Política de Reversión (Rollback Limits)

> [!CAUTION]
> Una vez aplicado el corte con el marcador en producción, **Task R0-POLICY-B5 es el candidato mínimo absoluto de rollback permitido**.

- **Reversión a Prepare Prohibida:** Cualquier intento de desplegar un commit anterior a B5 (incluyendo B1, B2, B3 o B4 que tengan `BOOKING_ADMISSION_RELEASE = 'prepare'`) fallará en preflight con error cerrado.
- **Prohibición de Borrado Manual:** No se debe borrar ni alterar manualmente la fila `bookingAdmissionProtocol` en la base de datos de producción D1.
- **Rollback Seguro:** En caso de emergencia operativa tras el corte, el rollback solo puede realizarse hacia un commit que cumpla `reader >= 2`, `release === 'enforce'` y conserve `recoveryCompatible: true`.

---

## 5. Procedimientos de Recuperación y Resiliencia

### Continuidad del Cliente ante Fallos de Política
- Si la política de admisión de un negocio está ausente, en revisión o corrupta (código 503 `BOOKING_POLICY_UNAVAILABLE`):
  - La página pública `/b/[slug]` **nunca** muestra una pantalla blanca o dead-end.
  - La consulta de citas agendadas previamente permanece 100% operativa.
  - La cancelación de citas y la revocación de consentimiento se ejecutan normalmente sin requerir inferencia ni políticas activas.
  - Los canales de contacto directo (WhatsApp y teléfono) se mantienen visibles y activos.

### Configuración Correctiva del Dueño
- En `/dashboard/onboarding` y `/dashboard/settings`:
  - Si la política es ilegible o devuelve 503, la interfaz no bloquea la edición básica del negocio.
  - Se muestra una advertencia explícita de "Capacidad de reservas desconocida".
  - **No hay fallback optimista a 'general'**: el sistema no asume permisos no confirmados.
  - Se ocultan las opciones de intake de texto libre y asistentes de IA.
  - El dueño puede guardar datos comerciales y eliminar campos de intake preexistentes para restaurar la conformidad.
