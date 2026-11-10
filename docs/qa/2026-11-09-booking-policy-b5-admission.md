# Evidencia QA: R0-POLICY-B5 — Declaración Visible, Recuperación y Corte Conjunto

- **Fecha:** 2026-11-09
- **Tarea:** `R0-POLICY-B5`
- **Módulo:** `R0-POLICY` (Subplan `docs/superpowers/plans/2026-10-30-booking-policy-admission.md`, anchor `task5`)
- **Contrato aprobado:** `docs/superpowers/specs/2026-10-30-booking-policy-admission-design.md`
- **Rama:** `main` en `andresleosan/SarinBotSAAS`

---

## 1. Alcance Implementado

1. **Declaración visible del dueño (`OwnerBookingDeclaration` y `useOwnerBookingDeclaration`):**
   - Componente UI visible integrado en onboarding (`src/app/dashboard/onboarding/page.tsx`) y disponible para workspace.
   - Superficies, etiquetas y avisos diferenciados para los cinco estados del ciclo de admisión:
     - `classification_required`: casilla de confirmación deseleccionada por defecto, texto legal íntegro versionado (`BOOKING_DECLARATION_TEXT`), botón de declaración general para adultos con protección contra doble clic.
     - `active`: distinción visual entre origen dueño y superadmin, enmascaramiento de recibo privado durable y diálogo modal de confirmación antes del retiro.
     - `withdrawn`: aviso de suspensión de nuevas reservas e inferencia, texto legal visible en solo lectura y opción de reactivación mediante nueva declaración.
     - `administrative_review`: bloqueo de autodeclaración con aviso explicativo y canal de contacto de soporte.
     - `transitioning`: aviso transitorio con botón de reintento/actualización para verificar resolución asíncrona.
   - Modo salud (`dataMode === 'health'`): aviso explícito de que las reservas operan mediante formulario estructurado sin modelo de IA.
   - Hook `use-owner-booking-declaration.ts` aislado por la tupla `[uid, authEpoch, businessId]`, preservando `requestId` en reintentos para idempotencia y evitando fugas de memoria o recibos entre cuentas.

2. **Isla pública de clientes (`src/app/b/[slug]/page.tsx`):**
   - Consulta, cancelación y enlaces directos de contacto permanecen activos y accesibles incluso ante política ausente, corrupta (503) o con admisión no activa.
   - `admissionActive` condiciona exclusivamente el inicio de nuevas reservas (mostrando aviso contextual), sin bloquear la recuperación de citas confirmadas preexistentes.
   - El modo salud opera sin inferencia ni montaje de chat de IA.

3. **Configuración correctiva no bloqueante para dueños:**
   - Onboarding y workspace de configuración permiten edición manual correctiva aun cuando la política no sea legible, mostrando advertencia de capacidad desconocida sin fallback optimista a `general`.
   - Se ocultan estrictamente las opciones de preguntas de texto libre y asistente de IA hasta que exista una clasificación válida.
   - Desacople de `writeBlocked` frente a `policy.ready` en `use-owner-configuration.ts` y `owner-configuration-workspace.tsx`.

4. **Corte conjunto a `enforce` y preflight de despliegue (`assertBookingAdmissionRelease`):**
   - Configuración de candidato en `src/lib/booking-admission-release.ts`: `BOOKING_ADMISSION_RELEASE = 'enforce'` y compatibilidad de recuperación activa.
   - Preflight en `cloudflare/scripts/booking-admission-preflight.mjs`: valida que el protocolo `serverSettings/bookingAdmissionProtocol` sea compatible antes de compilar y desplegar.
   - Creación idempotente del marcador de protocolo en D1 (`cloudflare/scripts/release-core.mjs` y `release.mjs`) durante el primer despliegue `enforce`.
   - Rechazo estricto de despliegues `prepare` o candidatos pre-B1 si el marcador ya existe. B5 es el candidato mínimo de rollback permitido.

5. **Runbook Operativo (`docs/product/booking-admission-operation.md`):**
   - Documentación exhaustiva sobre la estructura del protocolo, estados, preflights de CI/CD, contingencia, criterios de rollback (B5 mínimo) y recuperación ante desastres.

---

## 2. Pruebas Automatizadas y Comprobaciones Acumuladas

### Suite Focal Vitest B5
```powershell
pnpm exec vitest run tests/owner-booking-declaration.test.tsx tests/booking-admission-ui.test.tsx tests/owner-configuration-workspace.test.tsx tests/owner-configuration-provider.test.tsx tests/chat-surfaces.test.tsx tests/admin-booking-data-policy.test.tsx tests/booking-admission-d1.test.ts
```
- **Resultado:** 7 archivos evaluados, 124 pruebas superadas (código de salida 0).

### Pruebas de Despliegue y Release Cloudflare
```powershell
node --test cloudflare/tests/release.test.mjs
```
- **Resultado:** 20 pruebas superadas (código de salida 0). Invariantes de preflight y corte enforce verificados.

### Reglas de Seguridad Firestore y Emuladores
```powershell
pnpm run test:rules
```
- **Resultado:** 9 archivos evaluados, 116 pruebas superadas en emulador oficial con Java 21 (código de salida 0).

### Chequeo Estricto de Tipos TypeScript
```powershell
pnpm run typecheck
```
- **Resultado:** Código de salida 0; cero errores o advertencias en `tsc --noEmit`.

### Suite Completa Vitest del Repositorio
```powershell
pnpm test
```
- **Resultado:** 340 archivos evaluados, 5.026 pruebas superadas, 10 omitidos de emulador/live (código de salida 0).

### Compilación de Producción Next.js
```powershell
pnpm run build
```
- **Resultado:** Compilación Turbopack exitosa, 20 páginas estáticas generadas sin errores (código de salida 0).

### Chequeo y Dry-Run del Worker Cloudflare
```powershell
pnpm --filter sarin-cloudflare-host run check
```
- **Resultado:** 203 pruebas de Worker superadas, chequeo de tipos TypeScript y dry-run de Wrangler desplegando sin errores (código de salida 0).

### Pruebas del Coordinador de Avance
```powershell
node --test .agents/skills/avanzar/scripts/*.test.mjs
```
- **Resultado:** 35 pruebas superadas (código de salida 0).
