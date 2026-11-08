# Evidencia QA: R0-POLICY-B4 — Admisión de Entradas y Recuperación Independiente

- **Fecha:** 2026-11-08
- **Tarea:** `R0-POLICY-B4`
- **Módulo:** `R0-POLICY` (Subplan `docs/superpowers/plans/2026-10-30-booking-policy-admission.md`, anchor `task4`)
- **Contrato aprobado:** `docs/superpowers/specs/2026-10-30-booking-policy-admission-design.md`
- **Commit SHA:** `77ebaf21257506013d9f06fa7d307d4a6d9124e4`
- **Rama:** `main` en `andresleosan/SarinBotSAAS`

---

## 1. Alcance Implementado

1. **Guards de admisión transaccionales en todas las entradas operativas:**
   - Cita directa (`prepareAppointmentInTransaction` en `src/lib/server/bookings.ts`) protegida con `assertBookingAdmission(..., 'appointment')` tras la verificación de replay durable.
   - Propuestas (`createBookingProposal` y `confirmBookingProposalDetailed` en `src/lib/server/booking-proposals.ts`) protegidas con `assertBookingAdmission` ('proposal' y 'appointment'). Las propuestas v1 y v2 guardan `policyRevision: capability.revision`. Propuestas desactualizadas o bajo política `health` no confirmables mediante formulario general.
   - Reprogramación de citas por cliente (`rescheduleAppointmentInTransaction` en `src/lib/server/appointment-rescheduling.ts`) protegida con `assertBookingAdmission(..., 'reschedule')`.
   - Reprogramación por dueño (`prepareOwnerReschedule` y `confirmOwnerReschedule` en `src/lib/server/owner-rescheduling.ts`) protegidas con `assertBookingAdmission`.
   - Lista de espera (`joinWaitlist` en `src/lib/server/waitlist.ts`) protegida con `assertBookingAdmission(..., 'waitlist')`.
   - Ofertas de lista de espera (`createOwnerWaitlistOffer` en `src/lib/server/waitlist-offers.ts`) protegida con `assertBookingAdmission(..., 'offer')`. `waitlistOfferEligible` verifica `admission === 'active'`.
   - Aceptación de consentimiento (`updateBookingSubjectConsent` en `src/lib/server/booking-subject-consent.ts`) protegida con `assertBookingAdmission(..., 'subject_acceptance')` en acción `'accept'`.

2. **Recuperación durable independiente de la política vigente:**
   - Lectura, cancelación y replay de citas confirmadas preexistentes funcionan incluso bajo política retirada, suspendida o corrupta (503).
   - Separación estricta entre lectura de evidencia durable (`readStoredBookingSubjectEvidence`) y construcción de documentos de aceptación nueva. Consulta de consentimiento y revocación (`action: 'revoke'`) proceden con recibos históricos incluso si la política vigente es ilegible.
   - Bloqueos manuales por dueños (`createManualBlock`) sin datos de clientes operan sin requerir admisión de reserva de cliente.
   - Configuración correctiva del negocio (`createBusiness`): dueños pueden vaciar `intakeFields: []` o conservar los campos previos inalterados cuando la política está corrupta; agregar o modificar campos de texto libre requiere política legible y compatible.

3. **Canal WhatsApp y Outbox:**
   - `persistWhatsAppReply` almacena `policyRevision: capability.revision` dentro de su transacción.
   - `sendPending` en `whatsapp-worker.ts` revalida la admisión y concordancia de `policyRevision` antes del despacho; registros `ready` incompatibles se cancelan (`state: 'cancelled'`) sin invocar `fetch`. Registros `sending`/`unknown` no reintentan envío.
   - Clasificación de respaldo en `scripts/lib/recovery-classification.mjs` admite `policyRevision` opcional en `whatsappOutbox`.

4. **Recuperación en chat de IA:**
   - Negativas de admisión en `assertNewProcessing` ejecutan `recoverAdmission`, recuperando citas confirmadas durables preexistentes sin nueva inferencia. Mensajes con fingerprint discordante sobre el mismo `requestId` devuelven 409 `AI_REQUEST_CONFLICT`. Propuestas pendientes no confirmadas no se simulan como citas y propagan el error de admisión.

---

## 2. Pruebas Automatizadas

```powershell
pnpm exec vitest run tests/booking-admission-domain.test.ts tests/booking-admission-recovery.test.ts tests/booking-admission-channels.test.ts tests/booking-admission-d1.test.ts tests/booking-subject-consent.test.ts tests/booking-proposals.test.ts tests/represented-booking.integration.test.ts tests/waitlist-offers-d1.test.ts tests/owner-rescheduling-d1.test.ts tests/chat.test.ts tests/chat-route.test.ts tests/whatsapp-queue.test.ts tests/recovery-backup-classification.test.ts
```

- **Resultado:** 14 archivos de prueba evaluados, 156 pruebas unitarias y de integración superadas (código de salida 0).
- **TypeScript:** `pnpm run typecheck` superado sin advertencias ni errores (código de salida 0).
