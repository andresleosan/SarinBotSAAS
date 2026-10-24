# Resultados de atención del propietario — Implementation Plan

> Ejecuci?n iniciada el 23/10/2026 sobre la base publicada `b7e9a2811db1a9d31bfcabeb12f177e72d50e0da`, con Agenda y Recepci?n verificadas. La continuaci?n del titular autoriza implementar, probar y publicar el n?cleo de tareas 1?6. La restricci?n documental del texto original describe su preparaci?n; tarea 7 (Quitar resultado) permanece diferida.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. La preparación documental y las decisiones están delegadas; este archivo no ejecuta producto, pruebas, dependencias, commits, migraciones o despliegues.

**Goal:** Permitir al dueño registrar/corregir atendida o ausencia con revisión, idempotencia e historial privado, conservando cuota y contratos existentes.

**Architecture:** Contrato puro y metadato mínimo en Appointment; servicio transaccional Database con recibos/eventos privados y locks actuales; GET paginado/PATCH propios; controles progresivos dentro de la cita. La ficha consolidada por cliente queda fuera de este incremento, expresamente separada en la spec.

**Tech Stack:** Node 24, pnpm 11.23.0, Next/React/TypeScript y Zod existentes; Vitest, react-test-renderer, Firebase emulator y Miniflare/Workerd/D1 ya presentes.

**Spec:** [2026-10-22-owner-attendance-and-client-record-design.md](../specs/2026-10-22-owner-attendance-and-client-record-design.md). Leer íntegra con este plan; la tabla de estados, payloads, errores y límites son contratos de implementación.

**Delta Quitar resultado con revisión independiente cerrada** por admin_audit_scope sin P1/P2 pendientes conocidos el22/10; sin ejecución. Conservar dos momentos dentro de este par: tareas1–6 entregan el núcleo inicial terminal del primer paquete; tarea7 habilita completed/no_show→confirmed después de la base14 y cancelación auditada S12 compatibles. No ejecutar tarea7 antes ni declarar esta ampliación terminada por aprobar las tareas originales. No hay plan/subsistema adicional ni flag nuevo: hasta el commit integrado, schema de escritura rechaza target confirmed y UI no ofrece quitar. Los tipos/lector finales documentados abajo se completan al integrar tarea7; el núcleo inicial no importa cancellation-proof.ts antes de que S12 lo aporte.

## Global Constraints

- Node 24 y pnpm 11.23.0; conservar `pnpm-lock.yaml` sin cambios y no añadir dependencias.
- Fuente efectiva reconciliada y rama aislada; nunca usar E: como base ejecutable.
- Hora y fechas de Colombia (`America/Bogota`); tiempos de autorización calculados en servidor.
- Solo dueño vigente del negocio; superadministrador y recurso reservable no equivalen a empleado autorizado.
- Lectura histórica sin barrera nueva de suscripción/consentimiento; PATCH requiere consentimiento de cuenta activo, sin exigir plan activo ni consentimiento nuevo del cliente.
- Sin pagos, marketing, inferencia, mensajes externos, información clínica, estados automáticos ni cambios de políticas de salud/menores.
- No modificar cancelación, reprogramación, reserva, cuota comercial ni reglas de beneficiario; coordinar mediante sus documentos/locks existentes.
- Auditoría privada, sin cuerpos de chat, contactos, respuestas de formularios, texto libre ni eventos en proyecciones públicas.
- Migraciones solo aditivas; sin backfill masivo, borrado automático o reversión de datos por rollback de aplicación.

## Review Focus

- Fin del servicio con preparación aún vigente: rechazar hasta reservedUntilAt, también en retry y con catálogo cambiado; tarea 1/2.
- Cita reprogramada/cancelada mientras se confirma resultado: un único resultado coherente, sin perder cita ni campos de menores; tareas 2/4.
- Respuesta de commit perdida y corrección posterior: mismo requestId recupera recibo original y cita actual, sin revertir ni consumir cuota; tareas 2/4/5.
- Historial legado o corrupto y acceso directo del cliente a citas: no fabricar asistencia/actor ni filtrar eventos privados; tareas 1/3/4.
- Cadena paginada y rollback con eventos nuevos: sin huecos silenciosos, escaneo global ni eliminación de recibos; tareas 3/4/6.

## Base y mapa de archivos

Fuente revisada `C:/Users/Drean Skate/AppData/Local/SarinBot/whatsapp-adaptation-20261020/source-restoration`, pin `463ae55f8c873468980746185fb3e91f55cb8681`; runtime documentado `c8bb0a99d9ac2bb20acaef2e5a157b0ff83b05f2`, delta documental. **Base de implementación elegida: fuente efectiva reconciliada más Agenda terminada/verificada**, en ese orden. Comprobar que existen OwnerAgendaAppointments y useOwnerAgenda con las interfaces del plan de Agenda; si faltan, terminar ese incremento, no duplicar tarjetas inline. Al ejecutar, comprobar versión efectiva, CI y cambios posteriores; aislar rama con using-git-worktrees sin alterar fuente recuperada. Trasladar estos documentos a esa rama. Los paths siguientes pertenecen a la rama futura, no al checkout E:.

| Archivo | Responsabilidad |
| --- | --- |
| Nuevo `src/lib/appointment-attendance.ts` | Tipos, schemas estrictos, revisión, validación temporal y etiquetas seguras; sin I/O. |
| `src/types/firestore.ts` | Campo opcional attendance, sin actor/motivo. |
| Nuevo `src/lib/server/appointment-attendance.ts` | Mutación atómica, recibos, cabeza y lectura paginada del dueño. |
| Nuevo `src/app/api/businesses/[id]/appointments/[appointmentId]/attendance/route.ts` | GET/PATCH, requireUser, IDs, cuerpo/query y no-store. |
| `shared/data-protocol.ts` | Allowlist de hijo attendanceEvents. |
| Nuevo `cloudflare/migrations/0007_appointment_attendance.sql` | Índice aditivo de consulta paginada; renumerar solo si la base reconciliada ya ocupa 0007. |
| `firestore.indexes.json` | Índice de attendanceEvents por appointmentId/sequence. |
| Nuevo `src/hooks/use-appointment-attendance.ts` | Peticiones por acción/apertura, scope, errores, retry exacto y estado de UI. |
| Nuevo `src/components/appointment-attendance-controls.tsx` | Pasos de selección/revisión/resultado e historial cerrado inicialmente. |
| `src/app/dashboard/page.tsx`, `src/components/owner-agenda-appointments.tsx` | Montaje dentro del detalle; coordinación pending/ref y reemplazo autorizado, sin tarjetas inline nuevas. |
| Nuevos `tests/appointment-attendance-model.test.ts`, `tests/appointment-attendance-domain.test.ts`, `tests/appointment-attendance-routes.test.ts`, `tests/appointment-attendance-d1.test.ts`, `tests/appointment-attendance-hook.test.tsx`, `tests/appointment-attendance-ui.test.tsx`, `tests/appointment-attendance-dashboard.test.tsx`; fixture `tests/appointment-attendance-contract.ts` | Modelo, dominio, protocolo, carreras reales, cliente/UI y fixture compartido. |
| `tests/firestore.integration.test.ts`, `tests/firestore.rules.test.ts`, `tests/data-migration.test.ts`, `cloudflare/tests/data.test.mjs` | Caracterización real Firestore, privacidad, ida/vuelta y allowlist. |
| Nuevos `qa/tests/owner-attendance.md`, `docs/qa/2026-10-22-owner-attendance.md` | Protocolo y evidencia futura ejecutada, saneada. |

No modificar cuerpos/rutas actuales de cancelación/reprogramación ni añadir acceso de empleados. No crear contrato de ficha global. No modificar RepresentationReviewControls o ClientPolicyControls para coordinar busy; el componente nuevo sí tiene onBusyChange explícito.

### Task 1: Modelo, validación y contrato puro

**Files:** crear `src/lib/appointment-attendance.ts`, modificar `src/types/firestore.ts`; crear `tests/appointment-attendance-model.test.ts` y `tests/appointment-attendance-contract.ts`.

**Produces:** exportar AttendanceStatus terminal y contratos del núcleo original; el contrato final añade AttendanceTargetStatus y amplía target/event/applied según la spec en tarea7. Los tipos compartidos pueden anticipar la unión, pero el schema mutador inicial solo acepta completed/no_show hasta tarea7. Añadir los siguientes:

```ts
type AppointmentAttendanceMetadata = { revision: number; lastEventId: string };
type AttendanceHistoryPage = { appointment: Appointment; events: AppointmentAttendanceEvent[]; nextBeforeRevision: number | null };
class AttendanceModelError extends Error { readonly status: 409 | 503; readonly code: string; }
appointmentAttendanceCommandSchema; appointmentAttendanceEventSchema; appointmentAttendanceCursorSchema;
readAttendanceMetadata(appointment: Appointment): AppointmentAttendanceMetadata | null;
assertAttendanceTransition(appointment: Appointment, command: AttendanceCommand, now: number): void;
```

`null` metadata solo para campo ausente; revisión lógica cero. Los schemas usan requestIdSchema/documentIdSchema existentes y son strict. Los errores puros son AttendanceModelError, sin importar HttpError/server-only/crypto al bundle cliente; el servicio convierte ese error a HttpError con el status/code previstos. SHA-256 vive exclusivamente en tarea2 servidor. El contrato de tests exporta `attendanceFixture(db: Database)` y `attendanceNow = Date.parse('2030-01-07T14:45:00Z')`; cita 09:00–09:30 Colombia, margen hasta09:45, negocio/UID demo, cuota usada1, propietario con consentimiento sintético y beneficiario de muestra sin datos reales.

- [ ] Escribir `rejectsFutureAndPreservesPreparation`, `acceptsExactlyAtReservedEnd`, `legacyZeroIsOnlyForAbsentMetadata`, `legacyOutcomeCorrectionHasNoInventedActor`, `coreRejectsClearUntilIntegratedDelta`, `rejectsManualCancelledAndUnknown`, `invalidOrMissingSavedTimesFailClosed`, `deletedCatalogDoesNotRewriteHistory`, `minorReviewAndLegacyClientFieldsArePreserved`. Antes de 14:45:00.000Z: 409 TOO_EARLY; justo en el límite: admisible. Cambiar buffer del catálogo no modifica el límite guardado. La expectativa coreRejectsClearUntilIntegratedDelta pertenece a esta fase y se sustituye por los casos de tarea7 al habilitar la ampliación; no conservar una aserción que contradiga el contrato final.
- [ ] Escribir validaciones `strictInputRejectsActorNotesAndTimestamp`, `revisionOverflowRejects`, `lastSafeRevisionNeverWritesUnreadableMetadata` y `correctionReasonDependsOnExpectedStatus`. Revisión actual MAX_SAFE_INTEGER - 1 es legible, pero no admite incremento; no persistir MAX_SAFE_INTEGER. Evento excluye email/teléfono/intake/beneficiario/precio.
- [ ] Ejecutar `pnpm exec vitest run tests/appointment-attendance-model.test.ts`; RED específico antes de código, después implementar y repetir hasta GREEN. Registrar resultados futuros, sin hacerlos pasar por ejecución de esta preparación.
- [ ] Commit focalizado futuro `feat: define owner attendance commands and invariants`.

### Task 2: Mutación transaccional y recibo idempotente

**Files:** crear `src/lib/server/appointment-attendance.ts` y `tests/appointment-attendance-domain.test.ts`; ampliar fixture de tarea 1.

**Consumes:** schemas/tipos/reglas tarea 1; Database/Transaction, stableDocumentId/assertOwner, assertConsent, appointmentRescheduleRevision y clientPolicyKey existentes.

**Produces:**

```ts
updateAppointmentAttendance(owner: ChatActor, businessId: string, appointmentId: string, supplied: z.input<typeof appointmentAttendanceCommandSchema>, db?: Database): Promise<AttendanceUpdateResult>;
attendanceRequestFingerprint(command: AttendanceCommand): string; // solo servidor
readVerifiedAttendanceHead(tx: Transaction, db: Database, businessId: string, appointment: Appointment): Promise<AppointmentAttendanceEvent | null>;
```

- [ ] Escribir casos `ownerOnlyEvenForSuperadmin`, `wrongTenantAndMismatchedStoredIdReject`, `expiredPlanCanRecordButMissingConsentCannot`, `initialOutcomeWritesOneEventAndLocks`, `correctionAppendsAndPreservesPreviousEvent`, `noShowNeverSetsClientPenaltyFlag` y `counterAndPublicBusinessRemainIdentical`. Afirmar cuatro cambios máximos por operación normal (cita, evento, lock recurso/día, lock cliente si hay UID), y cero cambios fuera de ellos. Cita sin cliente no inventa UID; UID presente inválido bloquea escritura.
- [ ] Escribir `identicalReplayWritesNothing`, `requestReuseWithOtherBodyRejects`, `replayAfterCorrectionReturnsCurrentAppointmentAndOriginalAppliedReceipt`, `competingResultsOnlyOneWins`, `competingCorrectionsOnlyOneWins`, `missingOrCorruptAuditHeadRejects`, `staleRescheduleRevisionDoesNotApply` y `fingerprintIsStableAndBindsEveryCommandField`. Comprobar sequence/revision, evento inmutable, actor/recordedAt del servidor y ausencia de array dentro de Appointment.
- [ ] Ejecutar `pnpm exec vitest run tests/appointment-attendance-domain.test.ts`; RED. Implementar transacción en el orden de la spec: autoridad/ámbito/metadato/cabeza/consentimiento, replay o expectativas, todas las lecturas de locks y nuevo reloj, después writes. Ausente version de lock equivale a0; presente debe ser entero seguro no negativo menor de MAX_SAFE_INTEGER, en caso contrario503. Conservar spreads del último registro; no mutar business/cuotas/clientPolicies.
- [ ] Extraer verificación de cabeza al export readVerifiedAttendanceHead con schema/tenant/ID/sequence/source exactos. En núcleo inicial un estado cancelado con attendance positivo falla503: todavía no se habilitó clear ni existe transición legítima que lo produzca. Tarea7 incorpora la excepción probada S12 mediante su helper, sin tolerancia genérica a estados discrepantes ni duplicación del algoritmo de cabeza.
- [ ] Añadir `cancellationWinnerPreventsAttendance`, `attendanceWinnerSurvivesExistingCancelNoop`, `representationReviewDoesNotLoseAttendanceAndViceVersa`, `transactionRetryRechecksTimeAndSource`. Memoria es prueba de dominio, no sustituto de D1/Firebase. Repetir todos los casos de tareas1–2 hasta GREEN.
- [ ] Commit focalizado futuro `feat: record owner attendance with private idempotent events`.

### Task 3: Persistencia, paginación y HTTP

**Files:** modificar shared/data-protocol.ts, firestore.indexes.json; crear migración D1, ruta y `tests/appointment-attendance-routes.test.ts`; ampliar `cloudflare/tests/data.test.mjs`.

**Consumes:** servicio de tarea2 y tipos tarea1. **Produces:**

```ts
readAppointmentAttendanceHistory(owner: ChatActor, businessId: string, appointmentId: string, beforeRevision?: number, db?: Database): Promise<AttendanceHistoryPage>;
```

Implementar esa lectura en el mismo módulo servidor, sin añadir endpoint de clientes. Leer dueño/cita/cabeza en runTransaction; consulta por appointmentId y sequence, tope21, devolver20 y cursor según spec. Revisiones positivas deben encadenar hasta1; ausencia de eventos esperados falla, no termina como historial vacío. Cursor se valida y no puede exceder la revisión actual; página nueva puede añadirse mientras se recorren las antiguas sin repetirlas.

- [ ] Escribir `historyRequiresOwnerAndNeverMutates`, `legacyReadHasExplicitEmptyHistory`, `pagesTwentyPlusLookaheadWithoutDuplicates`, `gapOrForeignEventRejects`, `newHeadBetweenPagesDoesNotCorruptOlderCursor` y `missingIndexIsErrorNotEmpty`. Sembrar45 eventos: páginas45–26,25–6,5–1, cursores26/6/null y tamaños20/20/5; no usar límite global1000 como truncado silencioso.
- [ ] Escribir ruta `anonymous401`, `clientAndOtherOwner403`, `pathAndStoredTenantCannotBeSubstituted`, `strictPatchAnd2048ByteLimit`, `rejectsDuplicateUnknownOrMalformedCursor`, `patchRejectsAnyQuery`, `noStoreOnSuccessAndErrors`, `forgedOwnerTimestampAndFreeText400`. Usar mocks de requireUser y Database aislada; casos415/413 mediante Request con bytes reales. GET del dueño funciona aunque plan esté vencido o no haya consentimiento activo; PATCH conserva428 del consentimiento.
- [ ] Ejecutar `pnpm exec vitest run tests/appointment-attendance-routes.test.ts`; RED. Añadir únicamente attendanceEvents al hijo businesses; dejar deny rules de navegador intactas. Crear índice D1 aditivo `(parent,json_extract(data,'$.appointmentId'),json_extract(data,'$.sequence') DESC,path)` y Firestore appointmentId ASC+sequence DESC. No ampliar fields del Worker innecesariamente: ya existen ambos.
- [ ] Implementar ruta GET/PATCH exacta, control de query, IDs y readJson(...,2048); apiError actual. Probar Worker acepta nuevo path válido, deniega nietos/colecciones desconocidas y mantiene sus límites de tamaño. Ejecutar `pnpm --filter sarin-cloudflare-host run test` y los tests focalizados hasta GREEN.
- [ ] Commit futuro `feat: expose private owner attendance history and updates`.

### Task 4: Concurrencia real, SDK y restauración

**Files:** crear `tests/appointment-attendance-d1.test.ts`; ampliar tests/firestore.integration.test.ts, tests/firestore.rules.test.ts, tests/data-migration.test.ts. No cambiar adapter Database ni reglas por hacer pasar un test.

**Consumes:** mismas funciones/fixture anteriores. Crear dos handles D1 mediante `createDataTestRuntime` de cloudflare/tests/data-runtime.mjs como `tests/appointment-reschedule.integration.test.ts`; todas las migraciones locales, sin credenciales ni red productiva.

- [ ] Escribir `d1SerializesResultsAndCorrections`, `d1AttendanceAgainstCancel`, `d1AttendanceAgainstDelayedReschedule`, `d1AttendanceAgainstRepresentation`, `d1LostCommitResponseUsesIdenticalJournaledCommit` y `d1ReplayAfterLaterCorrectionNeverReverts`. Interceptar/pausar commit como tests vecinos; reloj fresco dentro de transacción. En carrera de reprogramación, preparar propuesta antes del inicio y retrasar su confirmación hasta el límite: si origen ya empezó, reschedule rechaza; si una modificación del origen ganó, el expectedRescheduleRevision de asistencia rechaza. No fabricar una reprogramación válida de cliente sobre una cita que ya terminó.
- [ ] Afirmar un evento por comando aplicado, ninguna cita duplicada, locks coherentes y cuotas intactas. Simular respuesta perdida tras commit aplicado; adapter puede reenviar solo command idéntico, y replay de dominio mantiene cabeza actual. Simular fallo antes del commit: ni estado ni evento quedan escritos.
- [ ] Sembrar1001 eventos de otras citas y medir consulta por appointmentId/sequence mediante metadata local D1; debe usar el índice nuevo y devolver páginas válidas sin escanear la historia del negocio. EXPLAIN QUERY PLAN incluye app_attendance_history (nombre fijado del índice). No extrapolar capacidad productiva.
- [ ] En `tests/firestore.integration.test.ts`, caracterizar Admin SDK real con cita/locks/evento en misma transacción y dos cambios competidores; usar solo FIRESTORE_EMULATOR_HOST demo. En rules test, dueño/cliente/otra cuenta/anónimo no leen ni escriben attendanceEvents mediante SDK; dueño/cliente autorizado siguen leyendo citas sin actor/motivo añadido. No conceder acceso directo al dueño para simplificar la UI.
- [ ] En data-migration tests, snapshot y reconciliación conservan attendance y eventos, incluido actor sin imprimirse; una ida/vuelta mantiene IDs/fingerprint/sequence. Respaldar/restaurar dataset SQL sintético local con eventos usando el verificador existente, comparar todas las filas/esquema; sin exportar datos reales.
- [ ] Ejecutar `pnpm exec vitest run tests/appointment-attendance-model.test.ts tests/appointment-attendance-domain.test.ts tests/appointment-attendance-routes.test.ts tests/appointment-attendance-d1.test.ts tests/data-migration.test.ts`; GREEN. Ejecutar `pnpm run test:rules` (Java21+, su runner incluye firestore.integration y rules). No declarar aprobada una suite omitida por falta de emulador; corregir entorno antes de cerrar gate.
- [ ] Commit futuro `test: verify attendance races privacy and recovery`.

### Task 5: Controles progresivos e integración del dueño

**Files:** crear hook/componente y `tests/appointment-attendance-hook.test.tsx`, `tests/appointment-attendance-ui.test.tsx`, `tests/appointment-attendance-dashboard.test.tsx`; integrar dashboard y `src/components/owner-agenda-appointments.tsx` sobre la base compuesta de Agenda ya verificada.

**Consumes:** tipos, endpoint y apiFetch/expectedUid/predicado existentes. **Produces:**

```ts
type AttendanceScope = { businessId: string; ownerUid: string; appointmentId: string; dateKey: string };
useAppointmentAttendance(input: { scope: AttendanceScope; appointment: Appointment; enabled: boolean }): {
  busy: boolean; error: string | null; result: AttendanceUpdateResult | null;
  history: AttendanceHistoryPage | null; historyLoading: boolean; historyError: string | null;
  submit: (status: AttendanceStatus, correctionReason?: 'recording_error') => Promise<AttendanceUpdateResult | null>;
  retryPending: () => Promise<AttendanceUpdateResult | null>;
  loadHistory: (beforeRevision?: number) => Promise<void>;
};
type AppointmentAttendanceControlsProps = {
  businessId: string; ownerUid: string; appointment: Appointment; disabled: boolean;
  onSaved: (appointment: Appointment) => void; onBusyChange: (busy: boolean) => void;
};
```

Ampliar el OwnerAgendaAppointmentsProps existente únicamente con `onAttendanceBusyChange: (appointmentId: string, busy: boolean) => void`. Su `saving` recibe busy combinado del dashboard, y `onSaved` existente continúa llevando Appointment a `useOwnerAgenda.replaceAppointment`; no crear otra lectura de citas. El componente de tarjetas envuelve onBusyChange con el ID de su cita. El dashboard mantiene Set/ref por UID/negocio/día/ID y callbacks guardados por ámbito; sus escrituras comprueban ese ref antes de enviar.

El hook crea UUID una vez al confirmar y conserva comando íntegro ante resultado desconocido; submit no reenvía automáticamente. Una revisión nueva invalida borrador aún no enviado, pero conserva el comando ya enviado desconocido para su replay exacto. `retryPending` solo existe mientras se conserva el comando de ese ámbito y usa el mismo cuerpo/requestId; un nuevo submit no puede saltarse busy ni usar una propuesta desfasada. GET solo al abrir/actualizar historial, sin N pollers por tarjeta; descartar páginas/resultado de otra generación. Esperas máximas locales GET10s/PATCH20s mediante controller+carrera; limpiar timer/listener y consumir respuestas tardías. Timeout PATCH conserva recibo pendiente como estado desconocido; no afirmar rollback del efecto servidor. Nueva respuesta guardada invalida historia cacheada de esa tarjeta, sin refrescar todo el negocio.

Calcular enabled solo con autoridad/scope válido y type appointment: nunca `enabled = !disabled`, `!saving` o `!busy`, y no incluir apertura de details en su ciclo de vida. disabled solo bloquea nuevos envíos/cargas iniciadas por usuario. El PATCH ya iniciado conserva controller/comando cuando onBusyChange hace true el saving combinado del padre; no dispara cleanup por ese cambio. Historial ready permanece visible durante busy; no iniciar otra página/actualización, pero tampoco abortar lectura previa solo por busy. Al aceptar un guardado, invalidar generación del historial para que una lectura anterior no lo restaure; el cambio auténtico de scope sí aborta todo.

- [ ] Escribir `selectionDoesNotWrite`, `reviewShowsBeforeAndAfterAndNoPaymentClaim`, `tooEarlyExplainsSavedPreparation`, `legacyOutcomeDoesNotInventDate`, `historyInitiallyClosedAndFetchesOnlyOnOpen`, `correctionRequiresExplicitReview`, `keyboardAndCollapsedDetailsPreserved`, `historyErrorDoesNotLookEmpty`. No usar salud clínica ni contacto en resumen/eventos.
- [ ] Escribir `unknownWriteKeepsExactCommandForManualRetry`, `newRevisionKeepsAlreadySentUnknownCommand`, `replayAfterCorrectionShowsAppliedAndCurrent`, `conflictClearsDraftAndRequiresRefresh`, `scopeChangeMasksStateBeforeEffects`, `lateWriteAndLateHistoryCannotCrossAccountBusinessOrDay`, `failedWriteNeverCallsOnSaved`, `readDeadlineTenSeconds`, `writeDeadlineTwentySecondsKeepsUnknownReceipt` y `cleansDeadlineResources`. Validar respuesta de PATCH (IDs/tenant/dateKey, requestId coincidente, eventId de64hex y shapes; no recalcular hash privado del servidor en cliente) antes de onSaved. No aceptar JSON tipado solo con cast. 401/403 oculta historial; errores globales no muestran datos viejos de otra cuenta.
- [ ] Escribir `attendancePendingFreezesNavigationBlockAndCancel`, `ownBusyDisabledPropDoesNotAbortPatchOrClearCommand`, `closingDetailsDoesNotCancelPendingPatch`, `readyHistoryRemainsVisibleWhileBusyWithoutNewLoads`, `saveInvalidatesLatePriorHistory`, `busyCleanupCannotReleaseAnotherScope`, `parentActionsCheckPendingRef`, `savedAttendanceInvalidatesOlderAgendaRead`, `representationAndClientPoliciesKeepLocalBusy`, `clientAndMinorDetailsRemainUnchanged`. Usar component real con API retrasada, no solo spy: iniciar PATCH, propagar disabled=true desde su propio onBusyChange y afirmar mismo requestId/cuerpo/controlador no abortado, una sola llamada y éxito aceptado. El padre mantiene Set/ref por scope+ID para sumar pending; al cambiar cuenta limpia/oculta y no hereda tokens antiguos.
- [ ] Ejecutar `pnpm exec vitest run tests/appointment-attendance-hook.test.tsx tests/appointment-attendance-ui.test.tsx tests/appointment-attendance-dashboard.test.tsx`; RED. Implementar paso1/2/confirmación, historial y callbacks. Registrar onBusyChange antes del fetch y al finalizar/desmontar; parent wrapper ignora otro ámbito. Reusar tokens, 44px, móvil320/390, teclado/zoom200 y aria-live sin anuncios repetidos por polling.
- [ ] Integrar solo en el detalle de `OwnerAgendaAppointments`; dashboard conserva contexto/hook/acciones y usa replaceAppointment para invalidar lecturas antiguas. El GET de historial se dispara únicamente por apertura explícita y no sustituye ni duplica los GET diarios del rango. No añadir tarjetas inline, otro poller, endpoint de ficha o segunda ruta de cancelar/reprogramar.
- [ ] Ejecutar suites focalizadas y `tests/client-appointments.test.tsx tests/client-appointments-reschedule.test.tsx tests/client-appointments-reminders.test.tsx tests/representation-review.test.tsx tests/representation-review.test.ts tests/representation-review-route.test.ts`; GREEN y `pnpm run typecheck` exit0.
- [ ] Commit futuro `feat: guide owners through attendance outcomes and corrections`.

### Task 6: QA completa y preparación segura de entrega

**Files:** protocolo y reporte QA futuros; fuente/runtime exactos y capturas saneadas. No atribuir antes resultados.

- [ ] Ejecutar una suite general `pnpm test`, `pnpm run typecheck`, `pnpm run build`, `pnpm run test:rules` si hubo cambios desde el gate anterior y `pnpm --filter sarin-cloudflare-host run check` por allowlist/migración del Worker. Registrar pases/fallos/omitidos sin duplicar conteos. Build en copia física exacta si worktree con enlaces de dependencias impide Next, siguiendo configuración pública vigente sin copiar secretos.
- [ ] Verificar en entorno local demo dos dueños/clientes, cita futura/con margen/no margen terminado, terminal heredada, recurso retirado, menor sintético, cancelada y bloqueo. Recorrido seleccionar→revisar→confirmar→historial→corregir; antes y justo después del límite, cambiar cuenta durante lectura, error503 y respuesta perdida simulada. No invocar IA ni mensajes. Verificar cliente ve su estado y no puede abrir endpoint/auditoría del dueño; no convertir resultado en recibo o deuda.
- [ ] Verificar320/390/1280px, teclado y zoom200: tarea principal clara, detalles inicialmente cerrados, sin datos privados aglomerados, error junto al control y sin desbordamiento. Confirmar que registrar resultado no altera política de beneficiario/revisión, cuota ni importe. Todas las pruebas de concurrencia real se atribuyen al backend local usado, no a una observación de navegador diferente.
- [ ] Ensayar migración aditiva y rollback de app en dataset sintético. Cita terminal y auditoría se conservan con lector antiguo; cancelar sobre terminal no borra resultado; no hay purge/backfill ni fallback D1→Firestore. Verificar herramientas de reconciliación aceptan attendanceEvents y no omiten esos documentos por allowlist vieja.
- [ ] Antes de una publicación futura, reconciliar fuente/runtime, respaldar y verificar restauración privada; una réplica y procedimiento vigente de mantenimiento/rollout. Orden compatible: índices y Worker con allowlist ampliada, después aplicación escritora. Índice Firestore listo si se usa ese backend. Probar combinación Worker antiguo/aplicación nueva en local: error cerrado sin escritura parcial, no supuesto éxito. Si se revierte app, mantener allowlist/índices/eventos; no restaurar respaldo anterior sobre actividad nueva.
- [ ] Revisión independiente del branch completo contra Review Focus y spec. Diff acotado a archivos previstos; sin campos clínicos, nuevos permisos de empleados, CRM, cuota, pagos, dependencias o canales. Capturas/comandos/resultados reales en reporte, con límites de entorno. Limpiar únicamente fixtures/procesos propios según inventario de IDs demo.
- [ ] Commit futuro `docs: verify private owner attendance and rollback`; integración/publicación solo en su fase posterior autorizada. Esta preparación no crea esos commits ni ejecuta esos gates.

### Task 7: Delta integrada Quitar resultado y cancelación posterior verificada

**Prerequisito, sin ciclo:** tareas1–6 del núcleo S05 y base14 verificadas; S12 completo aporta modelos, `cancellation-proof.ts` y **todos** los caminos de cancelación que capturan attendanceSource, con su revisión cerrada. S11 tiene invalidación monotónica y S07 lector compatible. Preparar el delta en rama compuesta; no publicar clear porque solo exista el schema/helper S12 sin escritor legacy. Si faltan esas piezas, esta tarea sigue pendiente y el target confirmed continúa rechazado. El primer paquete no anuncia que ya permite quitar.

**Files:** modelos/servidor/ruta/hook/control de este par y sus pruebas ya previstas. Consumir `src/lib/server/cancellation-proof.ts` de S12, sin duplicarlo. Coordinar delta S07/S11 y suites; CRM/S17 conservan DTO/queries y necesitan regresiones de estado actual. Sin colecciones, migraciones, flags, estados de Appointment o subsistemas nuevos.

- [ ] Completar `AttendanceTargetStatus = 'confirmed' | AttendanceStatus`; AttendanceStatus sigue completed|no_show. SourceStatus usa TargetStatus; comando/evento/applied/schemas/historial aceptan target confirmed con transición estricta y fingerprint que incluye motivo. confirmed→confirmed sigue409 NO_CHANGE. Sustituir la prueba temporal de schema de núcleo por los casos finales, sin flag ficticio.
- [ ] Escribir `clearNoShowAndCompletedOnlyAfterSavedReservedEnd`, `clearNeedsRecordingErrorAndExplicitSourceRevision`, `clearPreservesSavedTimeQuotaAndPositiveHead`, `legacyOutcomeClearAcknowledgesUnauditedPreviousResult`, `clearThenRecordAgainAppendsWithoutErasingHistory`, `confirmedHeadMustBeValidClearFromTerminal`, `clearReplayAfterNewOutcomeReturnsOriginalAppliedAndCurrent`, `clearAndOutcomeConcurrentUseSameRevisionAndLocks`. Antes del margen rechaza/justo al límite admite, también tras lecturas lentas/retry; ningún recálculo con catálogo/S09 ni cambio de rescheduleRevision/bookingTimeTerms/cuota/precio/cliente.
- [ ] Completar readVerifiedAttendanceHead según spec: schema/ámbito/sequence/snapshot/transición válidos; confirmed positivo solo clear recording_error desde terminal. Para cancelada positiva importar readVerifiedCancellationProof S12 y exigir proof no null, ancla attendanceSource exacta y cabeza clear; helper verifica pointer/evento/occurrence/estado. Ausencia/corrupción/ancla cruzada/cabeza terminal falla503. No borrar cabeza ni relajar genéricamente la discrepancia de estado.
- [ ] Probar `clearThenLegacyOwnerCancelKeepsAttendanceHistoryWithS12Proof`, `clearThenReviewedCancelBindsCurrentAttendanceHead`, `cancelledAttendanceWithoutProofFailsClosed`, `cancellationProofWrongAttendanceAnchorFails`, `cancelledWithTerminalAttendanceHeadIsNotLegitimate`, `replayOlderOutcomeAfterClearAndCancelDoesNotReapply`, `historyPaginatesAcrossClearWithoutLosingEvents`. Conservar última decisión Attendance y estado cancelado actual separados. Mantener sequence contigua y enlace newer.previousStatus=older.status cuando ambos eventos estén presentes en la página; no query global ni evento Attendance de cancelación.
- [ ] UI `clearIsSecondaryAndNeverWritesOnSelect`, `clearReviewExplainsPendingAndPreservedHistory`, `confirmClearUsesSameUnknownCommandBarrier`, `pendingOutcomeDoesNotSayReconfirmedByClient`, `clearKeepsOwnerScopeAndHiddenProofRules`. Opción secundaria Quitar resultado, revisión a Pendiente de registrar y Confirmar quitar resultado explícito, recording_error fijo. Nuevo resultado desde pendiente crea otro evento reason=initial: significa registrar desde pendiente, no primer evento histórico. Preservar onBusyChange/disabled/OwnerRequestScope.
- [ ] Regresiones: S07 clear válido→source_started sin mover pasado, cabeza rota→503; CRM all muestra confirmed/filtros terminales lo excluyen, cursor cambia por attendanceRevision y onSaved invalida lectura vieja; S17 total igual, terminal-- y confirmed/awaitingOutcome++, sin sumar eventos/precio. S11 solo invalidación, jamás prepare/rearmar: sending→clear→200 tardío sigue accepted_obsolete con providerId aunque status vuelva a coincidir. Espera/oferta enlazada no se reabre.
- [ ] Ejecutar futuro `pnpm exec vitest run tests/appointment-attendance-model.test.ts tests/appointment-attendance-domain.test.ts tests/appointment-attendance-routes.test.ts tests/appointment-attendance-hook.test.tsx tests/appointment-attendance-ui.test.tsx tests/appointment-attendance-d1.test.ts`; después suites S07/S11/S12 y CRM/S17 de sus planes. Dos handles D1 y Firestore Emulator verifican clear→cancelación→historia, respuesta perdida y cuota/locks/eventos atómicos. Completar gates de tarea6 tras delta y revisión independiente; no ejecutar en preparación.
- [ ] Revisar habilitación: schema/UI permiten clear solo con unidad S05/S07/S11/S12 compatible. Rollback conserva lectores que entienden confirmed auditado y prueba de cancelación, eventos/anclas; nunca volver al lector que los rechaza ni borrar auditoría/restaurar backup previo. Retirar acción con release compatible si hace falta. Commit/publicación son futuros.

## Autorrevisión del plan

La ficha consolidada sigue separada. Tareas1–6 conservan núcleo inicial sin importar S12 antes de existir;7 habilita quitar con escritor/lector de prueba S12, S07 y S11 compatibles. Cabeza confirmed válida acredita clear, no se borra; cancelar después exige proof anclado. CRM/S17 leen estado actual sin entidad/consulta nueva. Los casos de delta cubren tiempo/legado/replay/carreras, UI y barrera incierta; revisión documental independiente cerrada, pruebas futuras. Actor/historial privados, cuota intacta y sin rearmar avisos. No se promete captura exhaustiva, código ejecutado o publicación.
