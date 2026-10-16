# Pilot Invitations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Regalar la prueba existente mediante invitaciones individuales, con emisión, trazabilidad y control administrativo sin ingresos ficticios.

**Architecture:** Ampliar `subscription.paidTrial` con origen de cortesía y conservar contadores. Usar transacciones `Database` para D1/Firestore y componentes separados en administración/facturación.

**Tech Stack:** Node 24, pnpm 11.23.0, Next.js, TypeScript, Zod, `node:crypto`, D1/Firestore, Vitest y react-test-renderer existentes; ninguna dependencia nueva.

**Spec:** [Brief aprobado](../../product/BRIEF.md), «Invitaciones gratuitas», y [contrato vigente](../../paid-trial.md). Los códigos **regalan** la prueba de **5.000 pesos colombianos**. Revisar y elegir ejecución antes de implementar. Base, aceptación conjunta y release: [índice del piloto](2026-10-16-commercial-pilot.md).

## Global Constraints

- «Diez citas y 700 respuestas; sin cobro», sin vencimiento por días después del canje. Cancelar no devuelve citas.
- «No conceder una segunda prueba ni reiniciar contadores». Conservar pagos, citas y consumo; no fabricar comprobantes aprobados ni `paymentId`.
- «Un plan activo no se reemplaza por una cortesía». Conservar también la exclusión actual tras historial pagado vencido.
- Separar «Revocar código sin usar» de «Suspender acceso de cortesía»; reactivar conserva consumo y no revive una prueba agotada.
- Propuesta sometida a revisión: correo obligatorio, un uso, vencimiento del código de siete días por defecto, configurable entre uno y treinta antes de emitirlo.
- Servidor comprueba `SUPERADMIN_UID`; canje exige Google y correo verificado. No confiar en roles del navegador.
- No guardar código completo en almacenamiento, logs, URLs o analítica; no enviar mensajes a invitados.
- Usar `Database` de `src/lib/storage/types.ts`, mantener D1 activo, Node 24, pnpm 11.23.0 y lockfile. Sin dependencias nuevas.
- Datos sintéticos/locales. Preservar trabajo previo; commits futuros con staging explícito, nunca `git add .`.
- Tarifas, branding, guardrails generales y marketplace quedan en sus planes. No implementar ni desplegar durante esta revisión.

## Review Focus

1. Dos códigos simultáneos de una misma cuenta conceden una sola prueba; el segundo queda disponible: Task 2/4.
2. Reintentar canje tras suspensión/agotamiento recupera estado actual sin reactivar; una orden administrativa antigua tampoco revierte una decisión posterior: Task 2/3.
3. Comprobante pendiente, aprobación concurrente e historial pagado vencido no se reemplazan por cortesía: Task 2/4.
4. Correo normalizado, Google no verificado/proveedor diferente y destinatario ajeno: rechazar sin revelar identidad: Task 1/3.
5. Después de contratar un plan, mostrar consumo histórico de cortesía; período ausente significa «No disponible», nunca cero inventado: Task 2/3.

---

## Files and interfaces

Crear `src/types/invitations.ts`, `src/lib/server/invitation-schemas.ts`, `src/lib/server/introductory-access.ts`, `src/lib/server/invitations.ts`, `src/app/api/admin/invitations/route.ts`, `src/app/api/invitations/redeem/route.ts`, `src/components/admin-invitations.tsx`, `src/components/invitation-redeem.tsx` y tres suites `tests/invitations.test.ts`, `tests/invitation-routes.test.ts`, `tests/invitation-ui.test.tsx`.

Modificar `src/types/firestore.ts`, `src/lib/paid-trial.ts`, `src/lib/sarin/subscription.ts`, `src/lib/server/businesses.ts`, `src/lib/server/billing.ts`, `src/lib/server/response-quota.ts`, `shared/data-protocol.ts`; integrar UI en `src/app/admin/page.tsx` y `src/app/dashboard/billing/page.tsx`; ajustar etiquetas en `src/components/paid-trial-status.tsx`, `src/app/dashboard/page.tsx`, `src/app/dashboard/onboarding/page.tsx`. Pruebas adicionales y documentos se asignan abajo.

**Prueba compatible:** extraer `IntroductoryTrialUsage = { activatedAt: number; appointmentLimit: 10; appointmentsUsed: number }`. El tipo privado `paidTrial` será ese uso unido a `{ source?: 'payment'; paymentId: string } | { source: 'invitation'; invitationId: string; accessSuspended: boolean }`. Exclusión mutua de referencias mediante `?: never`. Documentos históricos sin `source` siguen válidos sin migración. Proyección pública explícita: uso, `source?`, `accessSuspended?`; excluir referencias privadas, correos y auditoría. No aplicar un `Omit` indiscriminado sobre la unión.

**Contratos en `src/types/invitations.ts`:**

- `CreateInvitationInput = { recipientEmail: string; expiresInDays?: number; requestId: string }`.
- `RedeemInvitationInput = { code: string; requestId: string }`.
- `InvitationAdminCommand = { action: 'revoke_code' | 'suspend_access' | 'reactivate_access'; invitationId: string; expectedVersion: number; requestId: string; reason: string }`.
- `InvitationRecord`: `id`, `codeHash`, `maskedCode`, `recipientEmail`, `createdBy`, `createFingerprint` son strings; `createdAt`, `expiresAt`, `expiresInDays`, `version` números; `state: 'issued' | 'revoked' | 'redeemed'`; `redemption?: { uid; email; businessId; requestId; trialPeriodId: string; at: number }`; `codeRevocation?: { at: number; by: string; reason: string }`; `access?: { state: 'active' | 'suspended'; at: number; by: string; reason: string }`. Los campos sin anotación dentro de `redemption` son strings.
- `InvitationSummary = Omit<InvitationRecord, 'codeHash' | 'createFingerprint'> & { codeState: 'available' | 'expired' | 'revoked' | 'redeemed'; usage: { appointmentsUsed: number | null; appointmentLimit: 10; responsesUsed: number | null; responseLimit: 700 } | null }`.
- `InvitationPage = { invitations: InvitationSummary[]; nextCursor: string | null }`.
- `InvitationCreationResult = { invitation: InvitationSummary; code: string | null; replayed: boolean }`; `InvitationRedemptionResult = { business: Business; invitationId: string; replayed: boolean }`; `InvitationCommandResult = { invitation: InvitationSummary; replayed: boolean }`.

**Servicios**, todos con último argumento `db: Database = getAdminDb()`:

```ts
createInvitation(admin: DecodedIdToken, input: CreateInvitationInput, db?: Database): Promise<InvitationCreationResult>
redeemInvitation(user: DecodedIdToken, input: RedeemInvitationInput, db?: Database): Promise<InvitationRedemptionResult>
updateInvitation(admin: DecodedIdToken, input: InvitationAdminCommand, db?: Database): Promise<InvitationCommandResult>
listInvitations(admin: DecodedIdToken, after?: string, db?: Database): Promise<InvitationPage>
activateIntroductoryTrial(subscription: Business['subscription'], origin: { source: 'payment'; paymentId: string } | { source: 'invitation'; invitationId: string }, now: number): Business['subscription']
```

El activador vive en `introductory-access.ts`; los otros cuatro, en `invitations.ts`. Los servicios administrativos comprueban también `isSuperadmin`; canje valida identidad incluso invocado directamente.

**Código:** `SARIN-<24 hex minúsculos>-<32 caracteres base64url>`. Id determinista: `stableDocumentId(admin.uid, requestId, 'invitation').slice(0, 24)`; secreto: `randomBytes(24)`, antes del callback. SHA-256 del código completo tras `trim()`, comparación `timingSafeEqual`; referencia `SARIN-…` más últimos seis caracteres del secreto. Repetir creación idéntica devuelve `code: null, replayed: true`; datos distintos con mismo requestId dan `409 INVITATION_REQUEST_CONFLICT`. Si se pierde el secreto, revocar y emitir código nuevo, sin recuperación falsa.

**HTTP:** `/api/admin/invitations` usa `requireSuperadmin`: GET devuelve `InvitationPage`; POST JSON creación, máximo 4 KiB, devuelve resultado con 201/200 replay; PATCH comando, máximo 4 KiB, devuelve resultado con 200. GET admite solo `after` de 24 hex: ordenar por `id` ascendente, filtrar `id > after`, leer 51/devolver 50 y cursor solo si hay siguiente. Rechazar parámetros duplicados/desconocidos. `POST /api/invitations/redeem` usa `requireUser`, JSON máximo 2 KiB y resultado 200; sin lectura auxiliar posterior capaz de convertir un commit confirmado en error.

Todas las rutas: nodejs, dinámicas, `Cache-Control: no-store`, `readJson`/`apiError`. 401 sin sesión; 403 privilegio/Google verificado ausente; 400 formato inválido. Código inexistente, incorrecto, ajeno, vencido o revocado: mismo `409 INVITATION_UNAVAILABLE`, sin destinatario. Otro UID/requestId después de canje: `409 INVITATION_ALREADY_REDEEMED`. Replay válido del mismo UID/requestId devuelve negocio actual sin escrituras, aunque venciera el código o se suspendiera/agotara la cortesía.

## Task 1: Compatible entitlement and validation

**Files:** tipos/ayudantes/activador arriba; modificar `billing.ts`, `businesses.ts`, `response-quota.ts`; ampliar `tests/paid-trial.test.ts`, `tests/billing-paid-trial.test.ts`, `tests/business-read-routes.test.ts`.

**Interfaces:** produce unión, schemas `createInvitationSchema`, `redeemInvitationSchema`, `invitationCommandSchema`, `invitationCursorSchema` y `normalizeInvitationEmail(email: string): string` en `invitation-schemas.ts`; consume firmas existentes de acceso y proyección sin cambiarlas.

- [ ] **RED:** Añadir casos nombrados `preserves legacy paid trial`, `suspends courtesy without changing usage`, `paid plan wins over courtesy suspension` y `strips private invitation references`. Afirmar:

```ts
expect(paidTrialRemaining(courtesySuspendedWithTwoUsed)).toBe(8);
expect(getBusinessAccess({ subscription: courtesySuspendedWithTwoUsed }, now)).toBe('suspended');
expect(getBusinessAccess({ subscription: paidPlanWithSuspendedCourtesy }, now)).toBe('subscription');
expect(JSON.stringify(publicBusiness(courtesyBusiness))).not.toContain('private-invitation-id');
```

Construir esas variables desde `pending`, `paidTrial` y fixtures locales existentes, sin inventar exports. Probar correo `trim().toLowerCase()` sin modificar alias; días 1/30 válidos, 0/31 inválidos; campos extra y razón vacía rechazados.
- [ ] **RED:** `pnpm test -- tests/paid-trial.test.ts tests/billing-paid-trial.test.ts tests/business-read-routes.test.ts`; observar fallo nuevo de comportamiento.
- [ ] **GREEN:** Implementar activador común usado por aprobación pagada y futuro canje. Conservar `paymentId` real, elegibilidad y ausencia de gracia inicial. Suspensión de cortesía se comprueba después del plan vigente; suspensión global sigue prioritaria. `getResponseQuota` refleja acceso suspendido. Schemas estrictos: correo hasta 254 caracteres, requestId existente, razón 1–300, versión entera no negativa.
- [ ] **GREEN:** Repetir comando y `pnpm run typecheck`, ambos correctos.
- [ ] **Commit futuro:** `feat: support complimentary introductory access`, solo cambios propios.

## Task 2: Transactional lifecycle and historical usage

**Files:** implementación/schemas de invitaciones, `shared/data-protocol.ts`, `tests/invitations.test.ts`, `tests/cloudflare-database.test.ts`.

**Interfaces:** consume Task 1 y helpers existentes `privateBusinessDraft`, `businessIdForOwner`, `readResponsePeriodState`, `initializeResponsePeriods`, `responsePeriodReference`; produce cuatro servicios definidos arriba.

- [ ] **RED:** Usar `memoryFirestore()` y tokens de `billing-paid-trial.test.ts`; `vi.stubEnv` para admin sintético, Google verificado y reloj restaurado por prueba. Tests `redeems once without financial records`, `two codes cannot reset one owner`, `replay cannot lift suspension`, `pending receipt blocks courtesy`, `historic quota survives upgrade`:

```ts
expect(result.business.subscription.paidTrial).toMatchObject({ source: 'invitation', appointmentLimit: 10, appointmentsUsed: 0 });
expect(result.business.subscription.paidTrial).not.toHaveProperty('paymentId');
expect([...rows.keys()].filter(path => /^(paymentReceipts|paymentImages|publicBusinesses|businessSlugs)\//.test(path))).toEqual([]);
expect((await listInvitations(admin, undefined, db)).invitations[0].usage?.responsesUsed).toBeNull(); // período eliminado en esta fixture
```

Añadir carreras de dos UIDs/mismo correo/un código, dos códigos/mismo UID; una concesión/período. Crear recibo mediante `submitReceipt`: pendiente bloquea `409 PAYMENT_PENDING`, rechazo explícito permite canje. Prueba anterior e historial pagado vencido bloquean. Repetición de creación no recupera secreto; almacenamiento no contiene código completo. Actualizar test del adapter para aceptar `invitations/{id}`.
- [ ] **RED:** `pnpm test -- tests/invitations.test.ts tests/cloudflare-database.test.ts`; observar fallos nuevos.
- [ ] **RED:** Añadir `limits redemption attempts without blocking recovery`: diez intentos nuevos por UID en 60 segundos son admitidos; el undécimo da 429 `INVITATION_RATE_LIMITED`, incluso si cambia de código. A los 60 segundos se admite otro. Recuperar el mismo canje ya confirmado no consume otro intento ni queda bloqueado. Dos llamadas concurrentes al último lugar admiten una sola. No guardar el código ni correo en el registro de frecuencia.
- [ ] **GREEN:** Añadir `invitations` a `DATA_COLLECTIONS`; sin migración SQL. Transacción lee todo antes de escribir: invitación, negocio determinista, perfil, último comprobante y cuota. Activar borrador privado, guardar canje/incrementar versión, vincular perfil y crear exactamente un período `invitation_<id>`, 700 respuestas, final `PAID_TRIAL_PERIOD_END`; sin período `initial` adicional. Escritura común del negocio serializa códigos distintos.
- [ ] **GREEN:** En `invitations.ts` producir `claimInvitationAttempt(uid: string, db: Database, now: number): Promise<void>`. Usar una transacción propia sobre `serverSettings/invitation_rate_<sha256(uid)>`, solo timestamps de la ventana y versión; descartar tiempos fuera de 60 segundos. Reclamar antes de validar un código nuevo después de autenticar/validar formato. La recuperación del mismo UID/requestId ya confirmado se detecta antes y no vuelve a escribir. Un registro corrupto falla cerrado; propagar 429 sin detalles privados. Esta defensa por cuenta no identifica a la persona detrás de varias cuentas.
- [ ] **GREEN:** Revocar solo `issued`; suspender/reactivar solo `redeemed`, con motivo y versión actual. Cambiar `paidTrial.accessSuspended` y proyección pública, nunca estado global ni pagos. Idempotencia administrativa en `serverSettings/invitation_command_<stableDocumentId(admin.uid, requestId)>`: fingerprint/acción/fecha; replay devuelve estado actual sin repetir; payload distinto da conflicto. Orden nueva con versión vieja: `409 INVITATION_STATE_CHANGED`. No reactivar suspensión global.
- [ ] **GREEN:** Resumen consulta período exacto del canje, aunque haya plan posterior; documento ausente produce consumo `null`, error de almacenamiento falla lectura. Listado paginado usa campo `id` ya autorizado por D1. Repetir suites y typecheck.
- [ ] **Commit futuro:** `feat: add transactional complimentary invitations`.

## Task 3: Authorized API and administration/redemption UI

**Files:** rutas/componentes nuevos e integraciones/etiquetas indicadas; `tests/invitation-routes.test.ts`, `tests/invitation-ui.test.tsx`, `tests/billing-pages.test.tsx`.

**Interfaces:** consume servicios/HTTP. Produce `AdminInvitations()` y `InvitationRedeem({ onRedeemed }: { onRedeemed: (result: InvitationRedemptionResult) => void })`; padre actualiza negocio inmediatamente, sin comprobante ficticio.

- [ ] **RED:** Seguir mocks de `business-read-routes.test.ts`/`http-auth.test.ts`: 401/403, flags falsos, proveedor/correo inválidos, errores uniformes, tamaños/campos/query inválidos y no-store. Afirmar `expect(response.status).toBe(401)` y `expect(JSON.stringify(await response.json())).not.toMatch(/recipientEmail|codeHash/)` sin sesión. GET/PATCH nunca contienen hash ni secreto.
- [ ] **RED:** react-test-renderer/`act` y promesas diferidas como `billing-pages.test.tsx`: código visible/copiable solo al crear; error de copiar no lo pierde; retry conserva requestId, editar entrada lo cambia; acciones bloqueadas mientras carga. Billing sin bancos puede canjear; éxito muestra **Prueba de cortesía: diez citas y 700 respuestas; sin cobro**, actualización del negocio y continuación. Pendiente exige resolverlo; suspensión conserva consulta de agenda. Datos ausentes muestran «No disponible»; historial de pagos no añade cortesía.
- [ ] **RED:** `pnpm test -- tests/invitation-routes.test.ts tests/invitation-ui.test.tsx tests/billing-pages.test.tsx`.
- [ ] **GREEN:** Implementar HTTP fijado. Tabla: destinatario, estado/expiración código, canjeador/negocio, activación, acceso y consumo; botón cargar más. Código completo solo en memoria hasta descartarlo; nunca localStorage. Separar controles Revocar código/Suspender cortesía/Reactivar cortesía, con motivo y confirmación. No enviar invitaciones automáticamente.
- [ ] **GREEN:** Integrar «Tengo un código de invitación» en billing y etiquetas de cortesía en dashboard/onboarding/status. Mockear componentes nuevos en suite previa; probarlos en suite nueva. Repetir comando/typecheck; revisar móvil 320 px/escritorio sintético.
- [ ] **Commit futuro:** `feat: expose invitation management and redemption`.

## Task 4: D1/Firestore parity and feature evidence

**Files:** `tests/cloudflare-data.integration.test.ts`, `tests/firestore.integration.test.ts`, `tests/firestore.rules.test.ts`, `docs/paid-trial.md`; crear `docs/qa/2026-10-16-pilot-invitations.md`.

**Interfaces:** usar setup real `createDataTestRuntime`/`createCloudflareDatabase` del archivo D1 y `user()`, `config`, `db` locales del archivo Firestore; no presumir exports. Añadir correo verificado a tokens nuevos.

- [ ] **RED:** Repetir carreras y replay de Task 2 en ambos backends. Flujo cortesía→configuración→consumo→suspensión→lectura/cancelación→reactivación→plan semanal: conserva consumo/fechas, pago prevalece. Probar carrera canje/subida de recibo. D1: sembrar 51 ids con igual fecha, páginas 50+1; afirmar `new Set([...first.invitations, ...second.invitations].map(x => x.id)).size === 51`. No ampliar el mock de memoria para fingir rangos string. Pérdida de respuesta usa patrón `loseNextResponse` de `cloudflare-database.test.ts`.
- [ ] **RED:** Reglas: denegar get/list/set de invitaciones/órdenes y cambios de source/invitationId/accessSuspended desde navegador, incluso con perfil administrativo falso.
- [ ] **RED/GREEN:** `pnpm test -- tests/cloudflare-data.integration.test.ts` y `pnpm run test:rules`, secuenciales. Corregir solo diferencias detectadas; si integraciones ya pasan, no fabricar fallos. Repetir suites dirigidas Tasks 1–3 y typecheck; suites omitidas no acreditan backend.
- [ ] **GREEN:** Registrar resultados reales, capturas sintéticas y compatibilidad/rollback en contrato/QA: código vence, cortesía activada no; código anterior no entiende su suspensión. No publicar secretos ni afirmar producción verificada. Checks globales/release se ejecutan una sola vez mediante el índice.
- [ ] **Commit futuro:** `test: verify invitation parity and lifecycle`.

## Self-review

Revisados cobertura, pasos, firmas, proporción y cinco Review Focus: cuatro entregables, compatibilidad pagada y privacidad explícita. Sin implementación, pruebas ejecutadas, recursos ni commits durante esta redacción.
