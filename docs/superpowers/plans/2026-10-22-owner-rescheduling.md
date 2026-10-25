# Reprogramación del dueño — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. El titular delegó preparar diseño y plan; este encargo no los ejecuta ni publica producto.

**Goal:** Permitir al dueño revisar y confirmar el movimiento de una cita futura del alcance general, conservando ID/cuota y recuperando la misma operación ante respuesta perdida.

**Architecture:** Dominio y propuestas privadas de dueño, separados del cliente; reutilización de fingerprint/revisión, disponibilidad efectiva S09 y locks de reserva. Workspace único en dashboard, recuperación por ID opaco con GET y confirmación explícita; invalidación del rango de agenda tras aplicar.

**Tech Stack:** Node 24, pnpm 11.23.0, Next 16.4.0, React 19.3.0, TypeScript estricto, Zod 4.6.7, Vitest 5.0.4, adaptador Database Firestore/D1 y tokens/Tailwind existentes.

**Spec:** [2026-10-22-owner-rescheduling-design.md](../specs/2026-10-22-owner-rescheduling-design.md). Leer íntegra: tablas HTTP, orden transaccional, elegibilidad, replay y UI son el contrato.

**Delta de lectura S05 con revisión independiente cerrada** por admin_audit_scope sin P1/P2 pendientes conocidos el22/10; sin ejecución. Consumir `readVerifiedAttendanceHead(tx,db,businessId,appointment)` del núcleo S05 y su ampliación final, sin copiar verificación o borrar metadata. Confirmed con cabeza clear válida se lee como source_started y jamás se mueve, incluso con retroceso del reloj; cabeza corrupta/terminal sigue503. Habilitar quitar solo en tarea7 del plan S05 después de S12 completo; no crear dependencia circular ni imports de pruebas de cancelación antes de existir.

## Global Constraints

- Node 24 y pnpm 11.23.0; conservar lockfile y no añadir dependencias.
- Fuente efectiva reconciliada y rama aislada; nunca ejecutar o publicar desde E: mixto.
- Hora de Colombia `America/Bogota`; reloj y autorización del servidor.
- Solo dueño vigente; superadministrador, recurso y supuesto empleado no sustituyen esa autoridad.
- Sin inferencia, pagos, mensajes externos, alta de citas, cuota adicional o modificación del cliente.
- Misma cita, servicio e identidad de beneficiario; no modificar cancelación, asistencia o reprogramación propia del cliente.
- Datos, actor y prueba de operación privados; no contactos, selección, texto libre o beneficiarios en URL, logs o almacenamiento del navegador.
- UI con identidad/tokens Sarin, guía progresiva, revisión explícita y controles de 44 px.

## Review Focus

- Otro movimiento/cancelación/cambio de metadatos del origen entre lectura y confirmación: rechazar expectativa vieja, conservando la cita ganadora; tareas1–3.
- Turno/cierre o catálogo cambia después de preparar aunque la hora siga pareciendo libre: comparar huellas y volver a evaluar, sin override; tareas2–3.
- Commit perdido, propuesta expirada o replay después de otro movimiento: recuperar prueba original y cita actual sin doble aplicación ni cuota; tareas2–4.
- Cambio de dueño/UID/época y URL manipulada o tardía: ocultar privado y no leer/confirmar otro destino ni usar actor cliente; tareas2,3,5.
- Polling cambia la tarjeta o mueve la cita de fecha durante el cambio: workspace conserva tupla, su propio lock no lo aborta y éxito invalida rango viejo; tarea5.

---

## Base compuesta y mapa de archivos

Fuente de lectura `C:/Users/Drean Skate/AppData/Local/SarinBot/whatsapp-adaptation-20261020/source-restoration`, pin463ae55f8c873468980746185fb3e91f55cb8681; runtime documentado c8bb0a99d9ac2bb20acaef2e5a157b0ff83b05f2. No se comprobó remoto en esta preparación. Implementar en rama aislada desde fuente efectiva reconciliada, con [Agenda](2026-10-22-owner-agenda.md), **tareas1–6 del núcleo** de [Estados](2026-10-22-owner-attendance-and-client-record.md) y [Turnos/cierres S09](2026-10-22-resource-schedules-and-closures.md) terminados/verificados, incluidas las dependencias de configuración guiada de S09. No exigir el par Estados entero: su Task7 y delta lector S07 se completan juntos después de S12, sin ciclo. No ejecutar sobre E: ni copiar sus archivos de producto; trasladar solo documentos.

| Archivo | Responsabilidad |
| --- | --- |
| Crear `src/lib/owner-rescheduling.ts` | Tipos/view/schemas cliente, expectativas, errores de modelo, validadores de URL y pruebas de proof. Sin I/O, crypto o módulos server-only. |
| Crear `src/lib/server/owner-rescheduling.ts` | Lecturas, elegibilidad, propuesta/recuperación/confirmación atómicas y fingerprints privados. |
| Crear cinco `route.ts` en las rutas de la spec | Transporte estricto, límites, requireUser, no-store y status. No lógica duplicada de reserva. |
| Modificar `shared/data-protocol.ts` | Agregar hijo privado `ownerRescheduleProposals`; sin quitar hijos de Estados/S09. |
| Crear `src/hooks/use-owner-reschedule.ts` | Lecturas por acción, preparación/reintento inmutable, confirmación/recuperación y scope. |
| Crear `src/components/owner-reschedule-workspace.tsx`, `src/components/owner-reschedule-boundary.tsx` | Guía del cambio y adaptador Next/URL bajo Suspense. |
| Modificar `src/app/dashboard/page.tsx`, `src/components/owner-agenda-appointments.tsx`, `src/hooks/use-owner-agenda.ts` | Entrada desde cita, coordinación de acciones, workspace estable e invalidateAndRefresh. |
| Crear `tests/owner-rescheduling-model.test.ts`, `tests/owner-rescheduling-domain.test.ts`, `tests/owner-rescheduling-routes.test.ts`, `tests/owner-rescheduling-d1.test.ts`, `tests/owner-rescheduling-contract.ts` | Modelo/dominio, rutas, fixtures comunes, carreras reales y recuperación. |
| Crear `tests/owner-reschedule-hook.test.tsx`, `tests/owner-reschedule-workspace.test.tsx`, `tests/owner-reschedule-dashboard.test.tsx` | UI, transporte incierto, URL y composición real. |
| Ampliar `cloudflare/tests/data.test.mjs`, `tests/firestore.rules.test.ts`, `tests/firestore.integration.test.ts`, `tests/data-migration.test.ts` | Allowlist, privacidad, atomicidad y respaldo/reconciliación. |
| Crear en ejecución `qa/tests/owner-rescheduling.md`, `docs/qa/2026-10-22-owner-rescheduling.md` | Protocolo y resultados reales saneados. |

No modificar `booking-proposals.ts`, `appointment-rescheduling.ts`, rutas cliente, cuotas o representación para reutilizarlos con actor falso. Imports de utilidades existentes no autorizan cambiar sus contratos. No hay índice/migración nueva porque los accesos del nuevo hijo son por ID.

### Task 1: Contratos estrictos, elegibilidad y fixture compartido

**Files:** crear modelo y `tests/owner-rescheduling-model.test.ts`, `tests/owner-rescheduling-contract.ts`.

**Consumes:** Appointment/Business, utilidades de fecha y schemas compartibles de `appointment-reschedule.ts`/`booking-subject.ts`; no importar `server/schemas.ts` al cliente. **Produces:** tipos de la spec y los siguientes exports:

```ts
ownerRescheduleCommandSchema;
ownerRescheduleAvailabilitySchema; // expectation + dateKey + resourceId?
ownerRescheduleSourceSchema;
ownerRescheduleProposalViewSchema;
ownerRescheduleRecoverySchema;
ownerRescheduleConfirmationSchema; // appointment + rescheduleResult + replayed
parseOwnerRescheduleReference(search: string): { proposalId: string | null; error: string | null };
```

Los schemas cliente usan validadores locales equivalentes a IDs/requestId actuales, fechas reales, HH:mm y hashes lowercase64hex; servidor valida otra vez con schemas existentes. `sourceRevision` de comando permite0..MAX_SAFE_INTEGER-2. El esquema de envelope Appointment permite metadatos históricos adicionales pero valida IDs/tenant/tipo/revisión y campos temporales necesarios; no podar datos que el caller debe conservar. No usar schema strict de catálogo para analizar toda una cita.

- [ ] Escribir `strictCommandRejectsActorContactServiceAndUnknownFields`, `revisionZeroAndOverflowAreExplicit`, `invalidDateAndTimestampCannotBecomeAvailable`, `proposalProofMatchesSourceAndTarget`, `appliedRecoveryCanCarryLaterCurrentAppointment` y `urlAcceptsOneOpaqueReferenceOnly`. Afirmar que `?ownerReschedule=a&ownerReschedule=b` produce error y ninguna referencia; un query ajeno no se convierte en datos de API. Un `result.revision` mayor que la revisión actual no valida recuperación. Validar timestamps de ambos intervalos, margen/duración destino, fin de origen cruzando medianoche y variante24:00; price histórico ausente es null, no cero.
- [ ] Fixture `seedOwnerRescheduleScenario(db:Database)` y `ownerRescheduleNow = Date.parse('2030-01-01T12:00:00Z')`: dueño `demo-owner`, cliente `demo-client`, negocio `demo-owner-reschedule`, origen `demo-source`, lunes2030-01-07 09:00–09:30 con margen09:45, dos recursos activos, servicio30min/buffer15/precio25000, precio histórico20000, cuota de prueba usada1, política general y consentimientos sintéticos. Incluir metadato histórico extra y attendance ausente; no imprimir contactos/respuestas de fixture.
- [ ] Ejecutar `pnpm exec vitest run tests/owner-rescheduling-model.test.ts`; confirmar RED por capacidad nueva. Implementar contratos/validador puro; repetir hasta GREEN. Futuro commit `feat: define owner rescheduling contracts`.

### Task 2: Dominio privado y confirmación atómica

**Files:** crear `src/lib/server/owner-rescheduling.ts`, `tests/owner-rescheduling-domain.test.ts`; ampliar fixture. **Consumes:** contratos tarea1, assertOwner/assertConsent, stableDocumentId, appointmentRescheduleRevision/Fingerprint, bookingSubjectHash, clientUidSchema/clientPolicyKey, prepareBookingActionAdmission y Database.

S09 consume exactamente `readResourceSchedulePolicy(tx,businessId,db)`, `resourceDayScheduleFingerprint(business,policy,resourceId,dateKey)` y `getAvailableSlots({ ..., resourceSchedulePolicy:policy })`; funciones acordadas viven en `src/lib/server/resource-schedules.ts` y tipo en `src/lib/resource-schedules.ts`. No extraer una política alternativa ni usar horario común si falla.

**Produces:**

```ts
readOwnerRescheduleSource(owner:ChatActor,businessId:string,appointmentId:string,db?:Database):Promise<OwnerRescheduleSource>;
readOwnerRescheduleAvailability(owner:ChatActor,businessId:string,appointmentId:string,input:OwnerRescheduleExpectation & {dateKey:string;resourceId?:string},db?:Database):Promise<AvailabilitySlots>;
prepareOwnerReschedule(owner:ChatActor,businessId:string,appointmentId:string,input:OwnerRescheduleCommand,db?:Database):Promise<{proposal:OwnerRescheduleProposalView;replayed:boolean}>;
readOwnerRescheduleProposal(owner:ChatActor,businessId:string,proposalId:string,db?:Database):Promise<OwnerRescheduleRecovery>;
confirmOwnerReschedule(owner:ChatActor,businessId:string,proposalId:string,db?:Database):Promise<{appointment:Appointment;rescheduleResult:RescheduleResult;replayed:boolean}>;
```

- [ ] Escribir `ownerCannotBeReplacedByClientSuperadminOrResource`, `wrongTenantOrActorCannotReadReceipt`, `generalLegacyAndSelfAreEligible`, `healthMinorFlagSensitiveAuthorizationAndRepresentationAreClosed`, `malformedPolicyDoesNotDefaultToGeneral`, `historicalReadDoesNotRequirePlanOrConsent`, `newMoveNeedsOwnerConsentAndRescheduleSubscription`, `blockedClientDoesNotGrantOrRemoveOwnerAuthority`. Casos subscription/paid_trial/trial_exhausted admitidos; suspended/past_due no habilitados según helper existente. No falsificar un ChatActor cliente ni aceptar actorUID del body.
- [ ] Escribir `preparationDoesNotMoveHoldOrConsumeQuota`, `sameCommandKeepsProposalIdAndExpiry`, `requestReuseWithChangedTargetFails`, `freshServiceSameIdDefinesReviewedTarget`, `removedOriginResourceCanMoveToActiveTarget`, `inactiveOrUnassignedTargetAndRemovedServiceFail`. Propuesta no contiene cliente/beneficiario/intakeAnswers/Appointment; actor solo en registro privado.
- [ ] Escribir `sameIdSameClientAndMetadataSurviveMove`, `originDestinationAndClientLocksAreDeduplicated`, `clientlessSourceDoesNotInventClientLock`, `presentCorruptClientUidNeverSkipsOrChangesClientLock`, `sourceFingerprintChangeRejectsEvenAtSameRevision`, `catalogChangeRejectsReviewedProposal`, `resourceScheduleChangeRejectsEvenIfTargetStillFits`, `outsideScheduleAndBufferConflictCannotOverride`, `sourceOrTargetStartedDuringTransactionFails`, `maxRevisionAndCorruptLockFailClosed`, `invalidConfirmedAttendanceHeadFailsWithoutReset`. UID de cliente vacío, no string o con controles/salto final falla503 aunque el regex con `$` aceptase coincidencia parcial; no trim ni tratarlo como cliente ausente. Capturar snapshots de negocio/cuota/proyección y afirmar igualdad tras propuesta, éxito y replay.
- [ ] Delta S05: consumir readVerifiedAttendanceHead en la misma tx al leer confirmed con metadata, sin copiar su validación. Probar `clearedOutcomeIsReadableButSourceStarted`, `clearedOutcomeCannotMoveEvenIfClockGoesBack`, `clearHeadWithWrongSourceOrTerminalStatusFails503`, `clearDoesNotResetRescheduleRevisionOrQuota`. Cabeza clear legítima devuelve source_started antes de exigir catálogo vigente o preparar destino, sin writes ni propuesta; caso con recurso/servicio retirado conserva ese motivo temporal. Estas fixtures usan el contrato final de tarea7 S05 y se activan/validan junto a su integración, sin pedirle al núcleo inicial aceptar clear antes de S12.
- [ ] Escribir `appliedReplayReturnsOriginalProofAndCurrentAppointment`, `replayAfterLaterMoveOrCancellationDoesNotMoveBack`, `ownerTransferRevokesOldActorRecovery`, `replayCanBeReadAfterPlanExpiryOrConsentWithdrawal`, `expiryClosesProposalWithoutMovingSource`, `expiryClosureConflictsWithOlderConfirmation`, `recoveryGetNeverClosesOrConfirms`. GET prepared después de expiresAt sigue prepared; POST explícito persiste closed fuera del callback que luego devuelve409.
- [ ] Ejecutar `pnpm exec vitest run tests/owner-rescheduling-domain.test.ts`; RED. Implementar orden transaccional exacto de spec; parsear registro privado strictversion1, fingerprint de comando canónico, state/result consistentes. Ausente revisión0 y lock0 son distintos de objeto corrupto. Reservar admisión solo al crear propuesta nueva y con namespace owner-reschedule; confirmar/replay no usa admisión de IA.
- [ ] Repetir GREEN y ejecutar regresiones `pnpm exec vitest run tests/appointment-reschedule.test.ts tests/appointment-reschedule-subject.test.ts tests/booking-proposals.test.ts tests/bookings.test.ts tests/booking-action-admission.test.ts`. No corregir contratos del cliente por fallar un caso nuevo de dueño; revisar separación. Futuro commit `feat: confirm owner rescheduling with private durable proofs`.

### Task 3: Transporte y protocolo de almacenamiento

**Files:** crear rutas exactas:

```text
src/app/api/businesses/[id]/appointments/[appointmentId]/owner-reschedule/route.ts
src/app/api/businesses/[id]/appointments/[appointmentId]/owner-reschedule/availability/route.ts
src/app/api/businesses/[id]/appointments/[appointmentId]/owner-reschedule/proposals/route.ts
src/app/api/businesses/[id]/owner-reschedule-proposals/[proposalId]/route.ts
src/app/api/businesses/[id]/owner-reschedule-proposals/[proposalId]/confirm/route.ts
```

Modificar `shared/data-protocol.ts`; pruebas `tests/owner-rescheduling-routes.test.ts`, `cloudflare/tests/data.test.mjs`. **Consumes:** cinco funciones tarea2. **Produces:** tabla HTTP de spec sin ampliar endpoints actuales.

- [ ] Escribir `routesRequireVerifiedUserAndCurrentOwner`, `queryDuplicateForeignIdsAndUnknownBodyAreRejected`, `limitsAre2048_4096_1024Bytes`, `confirmationOnlyAcceptsLiteralTrue`, `allSuccessAndErrorResponsesAreNoStore`, `postProposalStatusDistinguishesReplay`, `getRecoveryNeverWrites`. Montar handlers reales con requireUser simulado y DB sintética; no mockear dominio para las aserciones de autoridad/ausencia de writes.
- [ ] En Worker, afirmar `isDataPath('businesses/demo/ownerRescheduleProposals/proof',true)` y colección hija aceptados; otro hijo arbitrario sigue denegado. Campos de consulta no se amplían porque solo se lee documento. Conservar cambios aditivos attendanceEvents y S09 al reconciliar allowlist.
- [ ] Ejecutar `pnpm exec vitest run tests/owner-rescheduling-routes.test.ts`; RED. Implementar requireUser/IDs/readJson/APIError, límites y headers incluso cuando falle. POST confirm no acepta teléfono, respuestas, selección, beneficiario o actor. Agregar solo allowlist; no abrir reglas SDK ni añadir SQL/index por rutina.
- [ ] Repetir GREEN y `pnpm --filter sarin-cloudflare-host run check` en ejecución futura para protocolo/Worker afectado. Futuro commit `feat: expose owner reschedule proposal endpoints`.

### Task 4: Carreras reales, privacidad y mantenimiento

**Files:** crear `tests/owner-rescheduling-d1.test.ts`; ampliar `tests/firestore.integration.test.ts`, `tests/firestore.rules.test.ts`, `tests/data-migration.test.ts` y fixture común.

**Consumes:** dominio2, Worker3 y `createDataTestRuntime`, `createCloudflareDatabase`, patrones de `appointment-reschedule.integration.test.ts`. **Produces:** caracterización real de almacenamiento; memoria no sustituye este gate.

- [ ] Fixture exporta `verifyOwnerRescheduleMove(db,secondDb)`, `verifyOwnerRescheduleRaces(db,secondDb)` y `verifyOwnerRescheduleReplay(db,secondDb)`: dos handles D1 sobre runtime local. Dos propuestas del mismo origen → un éxito; movimiento contra reserva/bloqueo destino → un ocupante compatible; contra cancelación/cliente → resultado ganador conservado; cambio de horarios/política/catálogo en otra transacción → huella/relectura correcta y ningún movimiento parcial.
- [ ] Probar attendance y representación con funciones reales de la base compuesta. Representación/salud no se pueden habilitar desde S07; cambio de metadato durante propuesta invalida origen. Attendance por tiempo solo puede competir con una propuesta que queda obsoleta al pasar el inicio: adelantar reloj de fixture para comprobar que el origen se vuelve inelegible, sin fingir que ambas operaciones eran válidas a la vez.
- [ ] Simular pérdida de respuesta del commit que mueve cita como en suite cliente: dos envíos del adapter contienen el mismo requestId/writes. Debe quedar una cita, una revisión nueva y una prueba; confirmación posterior recupera resultado. Probar carrera confirmación iniciada antes de expiración frente a cierre después: applied o closed consistente, jamás GET terminal falso ni cierre revertido por throw.
- [ ] En emulador Admin SDK ejecutar transacción real cita/propuesta/locks y competencia del destino. Rules: dueño/cliente/otra cuenta/anónimo no leen/escriben ownerRescheduleProposals por SDK; lectura de citas autorizada permanece, sin actor/fingerprint/cliente duplicado en nuevos campos. El dueño accede al recibo solo por API autorizada.
- [ ] En data-migration tests incluir prepared/closed/applied, IDs/huellas/result y cita con última propuesta; respaldo/restauración sintéticos preservan todas las filas y revisión. No imprimir datos privados ni borrar recibos al vencer. Afirmar Worker viejo rechaza nuevo hijo sin cambiar la cita, no hay fallback automático de D1 a Firestore.
- [ ] Ejecutar `pnpm exec vitest run tests/owner-rescheduling-domain.test.ts tests/owner-rescheduling-routes.test.ts tests/owner-rescheduling-d1.test.ts tests/appointment-reschedule.integration.test.ts tests/data-migration.test.ts` y `pnpm run test:rules` con Java21+/emulador demo. Gate pendiente si se omite almacenamiento real; no marcarlo pasado por mock. Futuro commit `test: verify owner reschedule races and durable recovery`.

### Task 5: Workspace guiado, URL de recuperación e integración

**Files:** crear hook/workspace/boundary y tres suites UI; modificar dashboard, owner-agenda-appointments y use-owner-agenda de la base compuesta. **Consumes:** contratos/HTTP anteriores, auth epoch/current session, consentimiento de cuenta, tarjetas/locks de Estados y hook de Agenda.

**Produces:**

```ts
type OwnerRescheduleEntry = {appointmentId:string} | {proposalId:string};
useOwnerReschedule(input:{ownerUid:string;authEpoch:number;businessId:string;entry:OwnerRescheduleEntry;enabled:boolean}): OwnerRescheduleController;
type OwnerRescheduleController = {
  source:OwnerRescheduleSource|null; selection:OwnerRescheduleTarget;
  availability:AvailabilitySlots; proposal:OwnerRescheduleProposalView|null;
  recovery:OwnerRescheduleRecovery|null; stage:'source'|'selection'|'review'|'result';
  availabilityStatus:'idle'|'loading'|'success'|'error'; frozen:boolean;
  busy:boolean; uncertain:boolean; error:string|null;
  loadSource:()=>Promise<void>; setSelection:(target:OwnerRescheduleTarget)=>void;
  loadAvailability:()=>Promise<void>; prepare:()=>Promise<void>;
  confirm:()=>Promise<void>; recover:()=>Promise<void>;
};
OwnerRescheduleWorkspace(props:{controller:OwnerRescheduleController;onClose:()=>void;onViewCurrentDay:(dateKey:string)=>void}):ReactNode;
OwnerRescheduleBoundary(props:{businessId:string;ownerUid:string;authEpoch:number;onApplied:(value:{appointment:Appointment;rescheduleResult:RescheduleResult})=>void;onLockedChange:(locked:boolean)=>void;entry:OwnerRescheduleEntry|null;onEntryChange:(entry:OwnerRescheduleEntry|null)=>void}):ReactNode;
```

Hook enabled deriva de identidad/autoridad vigente, no del busy/disabled/lock propio. Guardar referencia/contexto en refs; validación de permiso se relee al enviar y servidor decide. Boundary fija entry al abrir una identidad local del flujo: la actualización propia de URL con proposalID no cambia ese input/key ni remonta el hook. frozen=true desde el primer envío de preparación impide setSelection/loadAvailability aunque se pierda respuesta; se reintenta cuerpo exacto. Un rechazo verificable de primera confirmación sin incertidumbre previa permite volver a origen; después de incertidumbre, solo recibo applied/closed resuelve, no un error aislado. Boundary coordina hooks Next/Suspense/URL y controller; onApplied solo una vez por proof válido en scope actual, nunca por un GET preparado. Workspace no llama router/API directamente. No guardar cuerpos/tuplas en almacenamiento navegador.

- [ ] Añadir al retorno `useOwnerAgenda` únicamente `invalidateAndRefresh:()=>void`: invalida/aborta generación, oculta snapshot sin esperar red y solicita nuevo ciclo acotado. Mantener refresh/replaceAppointment existentes; no insertar el destino en otra fecha. Probar `appliedMoveClearsOldRangeBeforeRead`, `lateOldRangeCannotRestoreSource`, `failedReloadIsNotEmptyDay` y límites existentes de dos GET/10s/40s.
- [ ] Añadir a `OwnerAgendaAppointmentsProps` `onReschedule:(appointmentId:string)=>void`; usar saving combinado para impedir iniciar otro flujo. Dashboard mantiene entry estable fuera del listado y lock/ref por UID/época/negocio; apertura rechaza si bloqueo/cancelación/attendance están pendientes, y sus handlers rechazan si hay flujo abierto. No ampliar APIs de representación/client policy. Tras éxito invalidar/refrescar rango; proof permanece hasta cierre. No key por día, resourceId, objeto Appointment del polling o sourceFingerprint.
- [ ] Tests hook `samePrepareBodySurvivesLostResponse`, `sameConfirmationSurvivesTimeoutAndInvalidEnvelope`, `expiredPreparedGetDoesNotUnlockUncertainConfirmation`, `samePostClosesExpiredProposalDurably`, `recoveryAfterReloadDoesNotPost`, `laterCurrentAppointmentDoesNotEraseOriginalProof`, `ownParentLockDoesNotAbortRequest`, `scopeChangeRejectsLateSourceAndMutation`. Con fake timers, `readDeadlineIsTenSeconds`, `mutationOnlyWarnsAfterTwentySeconds`, `pendingPostCanBeInspectedButPreparedGetDoesNotAllowSecondPost`, `proofInvalidatesLatePostPublication`. En cada llamada usar expectedUid y predicado de UID/época/generación; no aplicar respuesta vieja ni reintentar como nuevo actor. Separar controller de lectura de mutación; recuperar GET no aborta el POST.
- [ ] Tests workspace `threeStepsDoNotMutateOnSelection`, `beforeAfterShowsPriceAndBuffer`, `noExternalMessageOrPaymentPromise`, `healthMinorAndStartedReasonsAreClear`, `noSlotDifferentFromValidatedResponseCanBeProposed`, `uncertainStateOffersSameConfirmationOnly`, `sourceDetailsDoNotRepeatPrivateAnswers`, `inactiveOriginRequiresExplicitTargetAndNoHourIsPreselected`. Selección inicial fija fecha original, recurso original solo si elegible y hora vacía; nunca elegir primer recurso en nombre del usuario. Renderizar componentes reales; síntesis de prueba no equivale a funcionamiento de proveedor externo.
- [ ] Tests dashboard `rescheduleLivesOutsideDayKeyedCards`, `pollingDoesNotRemountActiveTuple`, `changeOfDayFilterKeepsWorkspace`, `openFlowBlocksOtherWritesByRef`, `closingCardDetailsKeepsWorkspace`, `onlyOpaqueProposalIdEntersUrl`, `ownProposalUrlDoesNotResetEntryOrHook`, `invalidDuplicateUrlDoesNotRead`, `urlEntryRecoversButNeverConfirms`, `externalUrlCannotReplaceOpenFlow`, `sensitiveUrlTransitionCannotReplaceUncertainTuple`, `identityChangeRemovesPrivateWorkspace`. Usar handlers/hook reales y respuestas retrasadas, no solo spy que acepte props.
- [ ] Ejecutar `pnpm exec vitest run tests/owner-reschedule-hook.test.tsx tests/owner-reschedule-workspace.test.tsx tests/owner-reschedule-dashboard.test.tsx tests/use-owner-agenda.test.tsx`; confirmar RED. Implementar guía y boundary conforme a spec, URL router.replace sin scroll y GET solo tras negocio autorizado. Si llega otra referencia externa mientras hay flujo abierto, aviso con enlace explícito validado `target=_blank rel=noopener noreferrer`, sin abrirla automáticamente; cambio propio al ID de su propuesta no reinicia entry/key. Cierre seguro elimina parámetro; no cancela cita.
- [ ] Repetir GREEN. Ejecutar `pnpm exec vitest run tests/owner-agenda-dashboard.test.tsx tests/appointment-attendance-dashboard.test.tsx tests/representation-review.test.tsx tests/client-reschedule-entry.test.tsx tests/appointment-reschedule-hook.test.tsx tests/appointment-reschedule-ui.test.tsx tests/appointment-reminders.test.ts tests/client-appointment-reminders.test.tsx`; Agenda/Estados proceden de la base compuesta y los demás archivos existen en463. Futuro commit `feat: guide owners through recoverable appointment moves`.

### Task 6: Verificación completa y entrega futura

**Files:** protocolo `qa/tests/owner-rescheduling.md` y reporte `docs/qa/2026-10-22-owner-rescheduling.md` futuros, sin atribuirles resultados actuales.

- [ ] Ejecutar todas las suites nuevas y las de Agenda/Estados/S09 afectadas, `pnpm run typecheck`, `pnpm test`, `pnpm run build`, `pnpm run test:rules` y `pnpm --filter sarin-cloudflare-host run check` con versiones requeridas. Registrar exit codes/recuentos/omitidas reales; no sumar dos veces suites solapadas. Build comprueba límite Suspense del dashboard y que schemas server-only no entren en cliente.
- [ ] QA local sintética con motor no usado: 320/390/1280px, teclado, zoom200%, antes/después, margen/precio, destino ocupado, fuente recurso retirado, error/red, URL de recuperación, recarga después de respuesta perdida y cierre por expiración. Sin contactos reales, pagos, mensajes, IA o invitados. Estados no observados en navegador se atribuyen a tests y se declara el límite.
- [ ] Verificar manualmente histórico por dueño sin plan/consentimiento, nueva escritura bloqueada donde corresponde, salud/menores sin botón operativo y cliente conserva su recorrido. Verificar prueba aplicada tras otra reprogramación no muestra posición antigua como actual. Abrir un enlace no muta ni cobra; filtros nunca sustituyen requestId.
- [ ] Ensayar protocolo/rollback en D1 local y respaldo sintético: Worker compatible primero, app después; viejo Worker falla cerrado. El rollback de app debe mantener el lector/enforcement S09 y leer citas/revisiones/recibos; no volver al lector463 ignorando políticas activas. Escritor S09 apagado no significa enforcement apagado. No retirar allowlist/recibos o restaurar un backup sobre cambios nuevos para ocultar un fallo de UI. Mantener una instancia y procedimiento vigente de despliegue/reversión; esta tarea no los ejecuta.
- [ ] Revisión independiente del diff compuesto y Review Focus antes de integrar. Confirmar cero cambios a rutas cliente/cuotas/beneficiario, cero contactos en propuestas/URL/logs y ausencia de inferencia/envío. Guardar evidencias saneadas, pin exacto compuesto y límites de alcance. Futuro commit `docs: verify owner rescheduling and recovery`.

## Autorrevisión

R01/R06/R07 → modelo/dominio/rutas1–3; R02/R03 → dominio2; R04/R05/R10 → almacenamiento real4; R08/R09 → UI5 y QA6. Cinco Review Focus con casos asignados. Base y contrato S09 fijados, mismo ID/revisión y proof durables, origen inactivo legible pero destino validado. No se declara implementado el segundo alcance salud/menores, plazo configurable, serie o mensaje externo. Todas las tareas quedan sin marcar porque este encargo solo prepara documentación.
