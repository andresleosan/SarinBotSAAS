# Plan: oferta in-app y resolución de espera

> Solo preparación documental. Ejecutar después con habilidad de planes vigente, fuente efectiva reconciliada y rama aislada. No código, pruebas, Git, dependencias o deploy durante esta fase. El titular delegó las decisiones de diseño.

**Goal:** Publicar una oferta no exclusiva para una solicitud self/general, que su cliente revisa y confirma explícitamente; crear una sola cita/cuota y resolver solo esa entrada de forma atómica y recuperable.

**Spec:** [Ofertas de espera](../specs/2026-10-22-owner-waitlist-offers-design.md). Base: pin463ae55 en ruta exacta de spec, más Agenda/configuración guiada/S09/bandeja S10 verificados; reconciliar Attendance/CRM/S07. Fuente E: no ejecutable. Node24,pnpm11.23.0; lockfile sin cambio/dependencias nuevas.

**Architecture:** waitlistOfferHeads por singleton y waitlistOffers por comando del dueño; propuesta cliente única embebida, cierre serializado y proof permanente. Dominios separados de bookingProposals actual, UI BookingProposal reutilizada. Refactor transaccional común de reserva en preparación sin writes+apply síncrono permite reloj final antes de oferta/cita/cuota/espera atómicos.

## Review Focus

1. Dueño publica; solo UID cliente almacenado y autenticado acepta; política general/self cerrada, sin renovar autorizaciones como dueño.
2. No hold/aviso externo; expiry no se prolonga al preparar y reloj final después de todas las lecturas.
3. Una cita/una cuota y vínculo exacto entrada-oferta-propuesta; no resolver por coincidencia ni reabrir al cancelar/reprogramar.
4. Replay proof+cita actual, cierre contra confirm antiguo y command inmutable ante error/recarga/cambio de scope.
5. Extracción de reserva preserva callers existentes y todos los caminos S09; head/listado/mantenimiento/rollback compatibles.

## Archivos

| Crear/modificar | Responsabilidad |
| --- | --- |
| Crear `src/lib/waitlist-offers.ts`, `src/lib/server/waitlist-offers.ts` | Contratos/modelos y dominio privado de ofertas/propuesta/proof. |
| Modificar `src/lib/server/bookings.ts` | Extraer prepareAppointmentInTransaction+PreparedAppointment, conservar wrapper público existente y S09. |
| Crear rutas de tablaHTTP spec bajo api/businesses/[id] | Dueño create/query/read/withdraw/close-expired; cliente current/read/proposal/confirm/decline/close-expired. |
| Crear `src/hooks/use-owner-waitlist-offer.ts`, `src/hooks/use-client-waitlist-offer.ts` | Comandos, recuperación y scopes distintos por rol. |
| Crear `src/components/owner-waitlist-offer-workspace.tsx`, `src/components/client-waitlist-offer.tsx` | Revisión progresiva dueño/cliente, sin envío externo. |
| Modificar UI | OwnerWaitlistWorkspace/ruta de fase1, ClientAppointments/ClientWaitlist slots, `/b/[slug]/page.tsx` controller estable, BookingProposal validityText opcional. |
| Persistencia/runtime | shared/data-protocol.ts, migraciones/Firestore índices, cloudflare/router/wrangler/tests del gate y mantenimiento privado de espera. |
| Tests nuevos | waitlist-offers-model, waitlist-offers-domain, waitlist-offers-routes, waitlist-offers-d1 (.test.ts); owner/client-waitlist-offer (.test.tsx). Fixture `tests/waitlist-offers-contract.ts`. |

No ampliar ChatResponse/selection, versiones bookingProposals1/2, rutas existentes de preparación/confirmación o escritura de owner-rescheduling. La función común de crear cita mantiene su firma pública; no añadir cliente ficticio a ese wrapper.

### Task 1: Modelos, schemas, identidad y reloj

- [ ] Crear tipos/schemas strict completos de registros head/offer/proposal/proof y DTOs owner/client de spec. Modelos cliente no importan server-only/crypto. IDs/UID con validación completa, sin newlinefinal; fingerprints64hex y revisiones seguras. Schemas discriminan offered/terminal/booked/proposal y exigen proof solo al booked, closedAt/reason correctos y timestamps consistentes.
- [ ] Escribir `headAbsentIsNotCorruptHead`, `opaqueOfferIdsBindCommandAndActor`, `offerExpiryIsMinOfTenMinutesRequestAndStart`, `proposalCannotExtendOfferExpiry`, `generalSelfOnlyNotMinorOrHealth`, `dtoOmitsClientActorAnchorsContactsAndAnswers`, `proofOriginalPositionIsNotCurrentAppointment`, `structuredSelfSubjectIsNewCaseNotBorrowedAuthorization`, `currentHeadForNewEntryNeverAttachesOldOffer`.
- [ ] Fixture sintético desde waitlist-contract con dos clientes/dueños,2030-01-07 bloqueado→liberar hueco, servicio30/buffer15/precio25000, política general y permisos, paid_trial usado1. No imprimir UID/contacto/intake de fixture.
- [ ] Ejecutar `pnpm exec vitest run tests/waitlist-offers-model.test.ts`; RED→implementar→GREEN. Commit futuro `feat: define private waitlist offer and resolution contracts`.

### Task 2: Preparación de cita sin escrituras prematuras

**Files:** bookings.ts y nuevo `tests/appointment-preparation.test.ts`; ampliar contratos existentes de bookings/reschedule/proposals/S09 donde corresponda.

```ts
type PreparedAppointment = {kind:'existing';appointment:Appointment} |
  {kind:'new';appointment:Appointment;apply:()=>void}; // servidor, solo mismo callback tx
prepareAppointmentInTransaction(transaction:Transaction,user:ChatActor,business:Business,input:BookingInput,
  requestId:string,db:Database,now:number,subject?:ValidatedBookingSubject):Promise<PreparedAppointment>;
```

- [ ] Escribir `preparationReadsButWritesNothing`, `withoutApplyNoAppointmentQuotaOrLocks`, `applyPerformsSameWritesExactlyOnce`, `wrapperRetainsReplayAndContactBehavior`, `sameIdDifferentSelectionStillRejects`, `allReadsBeforeApplyAndNoReadsInsideApply`, `bookingFailureStillAtomic`, `policyRequiredInsidePreparationAfterS09`. Snapshot diff exacto wrapper anterior vs wrapper refactorizado en fixtures válidos y errores de permisos/cupo/intake.
- [ ] Extraer el cuerpo de createAppointmentInTransaction, sin cambiar orden/reglas de lectura ni IDs/versiones/counters. Modoexisting conserva return sin writes; new construye cita y cierre de writes, aplica a lo sumo una vez por intento. El wrapper prepara y aplica inmediatamente como antes; offer domain decidirá si aplicar tras reloj final. No exports de PreparedAppointment a browser/HTTP ni reutilización fuera de transacción.
- [ ] Ejecutar `pnpm exec vitest run tests/appointment-preparation.test.ts tests/bookings.test.ts tests/booking-proposals.test.ts tests/appointment-reschedule.test.ts tests/appointment-reschedule.integration.test.ts tests/resource-schedules.integration.test.ts`. No borrar regresiones por asumir pure refactor. Typecheck todas las firmas; source usa alias Database como Firestore en bookings, conservar adapter-neutral.
- [ ] Commit futuro `refactor: stage appointment writes within the same transaction`.

### Task 3: Crear, leer y cerrar oferta privada

**Files:** servidor y domain tests. **Produces:**

```ts
createOwnerWaitlistOffer(owner:ChatActor,businessId:string,recordId:string,input:CreateWaitlistOfferCommand,db?:Database):Promise<OwnerWaitlistOfferResult>;
readOwnerWaitlistOffers(owner:ChatActor,businessId:string,input:OwnerWaitlistOfferQuery,db?:Database):Promise<OwnerWaitlistOfferPage>;
readOwnerWaitlistOffer(owner:ChatActor,businessId:string,offerId:string,db?:Database):Promise<OwnerWaitlistOfferRecovery>;
readOwnerWaitlistOfferContext(owner:ChatActor,businessId:string,recordId:string,db?:Database):Promise<OwnerWaitlistOfferContext>;
readCurrentClientWaitlistOffer(client:ChatActor,businessId:string,db?:Database):Promise<ClientWaitlistOfferCurrent>;
readClientWaitlistOffer(client:ChatActor,businessId:string,offerId:string,db?:Database):Promise<ClientWaitlistOfferRecovery>;
withdrawOwnerWaitlistOffer(owner:ChatActor,businessId:string,offerId:string,db?:Database):Promise<OwnerWaitlistOfferRecovery>;
declineClientWaitlistOffer(client:ChatActor,businessId:string,offerId:string,db?:Database):Promise<ClientWaitlistOfferRecovery>;
closeExpiredWaitlistOffer(actor:ChatActor,businessId:string,offerId:string,access:'owner'|'client',db?:Database):Promise<WaitlistOfferCloseResult>;
```

Access elegido por handler, no body. Cada función autoriza ámbito vigente; ownerActorUid al crear/replay debe coincidir con actor original y dueño vigente. Nuevo dueño puede leer/retirar ofertas del negocio con DTO mínimo, no suplantar al actor antiguo para replay de create. Ofertas no confirmadas de dueño anterior tienen usability policy_changed hasta revisión nueva; confirm nueva exige ownerActorUid==Business.ownerUid. Booked cliente conserva recuperación tras cambio de dueño.

- [ ] Escribir `ownerOnlyCurrentBusinessEvenForSuperadmin`, `clientCannotReadOtherClientOfferOrHead`, `canonicalWaitlistAndHeadScopeChecked`, `snapshotSelectionDerivedFromRequest`, `specifiedResourceCannotBecomeAny`, `inactiveServiceResourceOrClosedShiftCannotPublish`, `noHoldNoQuotaNoContactOnCreate`, `sameOwnerCommandReplaysSameExpiryAndReturnsCurrentHead`, `staleHeadRequestOrFingerprintRejects`, `liveOfferCannotBeReplacedSilently`, `expiredPreviousCanCloseAndNewHeadCommitTogether`, `creationAdmissionOncePerCommand`.
- [ ] Escribir `getNeverMutatesEvenPastExpiry`, `declineOrWithdrawKeepsRequestAndQuota`, `closeExpiredBeforeBoundary409AtBoundaryCloses`, `bookedCannotBeWithdrawnOrReopened`, `otherOwnerReceiptCannotBecomeReplay`, `newEntryResetsOfferContextNotOldProof`, `listTwentyPlusLookaheadFiltersStoredStateNotDynamicExpiry`, `listDoesNotRevalidateAvailabilityPerRow`. Cursor/tail/older usa campos fecha/created/id y ancla verificada; no total/universo.
- [ ] Implementar tx con todas lecturas antes de writes/admissionclosure. Fijar admisión kind proposal con namespace literal `waitlist-offer-owner:${entryId}:${requestId}`; prueba de mismo requestId con otra entrada cuenta intención nueva, replay de la misma no. Gatefalse bloquea nuevas ofertas, pero no lectura/cierre. Corrupt head/offer no usa null; backend error no vacío. GET no escribe expiry ni interpreta una confirmación pendiente como fracaso. Domain statuses y usability separados.
- [ ] Ejecutar modelo/dominio focalizados RED→GREEN; commit futuro `feat: manage nonexclusive waitlist offers with durable states`.

### Task 4: Propuesta y confirmación del cliente con resolución exacta

**Produces:**

```ts
prepareClientWaitlistOffer(client:ChatActor,businessId:string,offerId:string,input:{requestId:string},db?:Database):Promise<ClientWaitlistOfferRecovery>;
confirmClientWaitlistOffer(client:ChatActor,businessId:string,offerId:string,contact:{clientPhone:unknown;intakeAnswers:unknown},db?:Database):Promise<WaitlistOfferConfirmation>;
// WaitlistOfferConfirmation = {proof,appointment,replayed}; proof/cita actual se validan aparte
```

- [ ] Escribir `realClientOnlyNotOwnerOrBodyUid`, `prepareRequiresCurrentRequestAnchorsGeneralSelfAndGate`, `sameProposalRequestKeepsIdAndExpiry`, `anotherRequestIdDoesNotOverwritePreparedProposal`, `catalogSchedulePolicyOrOwnerChangedRequireNewOffer`, `preparationConsumesAdmissionButNotBookingQuota`, `proposalUsesCurrentAllowedIntakeDefinitionsWithoutAnswers`. Admisión cliente usa exactamente `waitlist-offer-client:${offerId}:${requestId}`; no reutilizar namespace dueño o requestId sin contexto.
- [ ] Confirmar en orden exacto spec: bookedreplay primero; terminal/expiry persistido mediante sentinel; request/head/revisión/permisos/huellas; contact bookingSchema y onlyknownintake; preparar cita sin writes con cliente real+caso selfnuevo; reloj final; cierre sin apply o apply+cita+locks/cuota+tombstone+proof atómicos. Nunca async/read después de apply. Fresh guard de acceso/plan y revisiones incrementables antes de writes.
- [ ] Escribir `expiryDuringLastPreparationReadClosesWithoutAppointmentOrQuota`, `expiryEqualsNowRejects`, `targetStartedBeforeApplyCloses`, `sameOfferProducesOneAppointmentAndOneQuota`, `resolvedTombstoneMatchesExistingWaitlistSchema`, `replayIgnoresNewContactAndReturnsCurrentAppointment`, `replayAfterS07OrCancellationDoesNotRestoreOriginalSlot`, `existingAppointmentWithUnbookedOfferIsUnverifiableNotAutoRepair`, `partialFailureLeavesRequestAndOfferUnresolved`, `independentBookingDoesNotResolveByUid`, `convertedAppointmentCancelOrMoveDoesNotReopen`.
- [ ] Escribir `slotTakenLeavesRequestAndQuotaIntact`, `quotaLastUnitAndClientLimitStillApply`, `clientCancellationWinnerRejectsOffer`, `offerWinnerMakesOldWaitlistCancelConflict`, `revocationOrPolicyChangeWinsBeforeConfirm`, `newRequestCannotBeResolvedByOldOffer`, `ownerTransferBlocksFreshAcceptButKeepsOwnBookedRead`.
- [ ] Usar fakeclock+barrera en última lectura del staginghelper; no suponer que clockprevio al helper cubre periodo de sus lecturas. Confirmar cierrepersistido fuera de throwcallback y sin los writes de apply. Ejecutar focalizados/regresiones hasta GREEN; commit futuro `feat: confirm client waitlist offers and resolve exact entries atomically`.

### Task 5: HTTP, allowlist, índices y flag de operaciones nuevas

- [ ] Crear rutas exactas tablaHTTP de spec; tests requireUser por rol/scope, queryrechazada, schemasstrict y límites1024/2048/16384bytes reales, no-store incluso errores. Handler confirm primero parsea shape básica unknowncontact; dominio valida contacto solo fresh, nunca impide replay/cierreexpired por datos nuevos inválidos. GET no crea/cierra/reserva; abrir enlace no acepta.
- [ ] Crear children waitlistOfferHeads/waitlistOffers sin abrir SDK. Queryfields de list son existentes; mantenimiento waitlistRecordId procede de fase1. Índices D1 offers `(parent,dateKey,createdAt DESC,id ASC,path)` y variante `(parent,dateKey,state,createdAt DESC,id ASC,path)` mediante json_extract como almacenamiento actual; nombres app_waitlist_offers_date/app_waitlist_offers_state. Firestore composiciones equivalentes. Siguiente migración libre tras reconciliar todas las ramas, sin sobrescribir las anteriores.
- [ ] SARIN_WAITLIST_OFFERS_ENABLED defaultfalse en servidor y varsWorker; runtimeKeys/routerboolean forwarding con tests true/false/ausente/invalid. Gatefalse bloquea create/proposal/freshconfirm, conserva readers/replay/cierres para resolver lo pendiente. No confundir deployflag con cierre transaccional de una operación anterior.
- [ ] Tests Worker pathlimit/campos/children y rolAPI, suites rutas+Worker check. Commit futuro `feat: expose waitlist offer endpoints with compatible runtime gates`.

### Task 6: Carreras D1/Firebase, conservación y privacidad

- [ ] D1 local con dos handles y createDataTestRuntime: oferta contra reserva directa/bloqueo/S07 del destino y dos ofertas de distintos UID al mismo hueco. Una ocupación compatible; cada perdedor conserva espera y cuota. La última unidad paid_trial se serializa como el helper actual, sin dos confirmaciones válidas en recursos distintos. Memoria no sustituye este resultado.
- [ ] Confirmación iniciada antes de expiry contra close-expired/withdraw/decline: un único estado booked o terminal. Si el cierre se confirmó, la transacción antigua no aplica después. Pérdida de respuesta tras commit: adapter reenvía el mismo journal; replay devuelve proof original y cita actual sin segunda unidad ni resolución. GET expired_pending_close no libera incertidumbre mientras persistedState sea offered.
- [ ] Carreras contra cancelWaitlist/rejoin, revocación de consentimiento, política booking/S09/catálogo/dueño. Una barrera en la última lectura del helper de preparación fuerza now==expiry: solo cierre expired, sin writes de cita/locks/counter. Probar el helper real, además de la función pura de expiración.
- [ ] Emulador Admin SDK con los mismos invariantes transaccionales. Rules deniegan SDK heads/offers a cliente/dueño/anónimo; las APIs verifican roles. Snapshot de oferta sin phone/email/name/answers; Appointment conserva los datos legítimos del cliente sin actor de oferta. Revisar tipos, imports y DTO de forma independiente.
- [ ] Ampliar collect/export/delete de waitlist-data-maintenance a los cuatro children: requests, reviews, heads y offers por waitlistRecordId, incluso con request:null/ausente. Mantener máximo100 documentos por borrado conjunto, hash, parada de escritores y409 si cambió inventario. Backup/restore sintéticos conservan estados/propuesta/proof/tombstone/head y revisión; sin TTL/purga al vencer ni ruta de exportación del dueño.
- [ ] Ejecutar `pnpm exec vitest run tests/waitlist-offers-model.test.ts tests/appointment-preparation.test.ts tests/waitlist-offers-domain.test.ts tests/waitlist-offers-routes.test.ts tests/waitlist-offers-d1.test.ts tests/waitlist-data-maintenance.test.ts tests/data-migration.test.ts`, emulador Java21+ y Worker check. Registrar omitidas como gates pendientes; commit futuro `test: verify waitlist offer races recovery and data maintenance`.

### Task 7: UI de dueño/cliente y recuperación estable

- [ ] Hook del dueño en página S10 fuera de filas/listas keyed: conserva createCommand y requestId al seleccionar recurso/hora→revisar→publicar, sin publicar automáticamente. Una intención en memoria; POST incierto impide cambiar cuerpo/ID hasta replay verificable o conflicto con estado actual. Cambiar pestaña bandeja/ofertas no monta otro controller ni reinicia el comando; UID/epoch/negocio sí purga.
- [ ] Hook cliente en BookingWorkspace fuera de ClientAppointments keyversion. Slots ClientAppointments.waitlistOfferContent y ClientWaitlist.offerContent presentan un único controller. Comprobar ofertas hace GET explícito; Revisar hace POST proposal y BookingProposal usa validityText con plazo absoluto. Texto literal en React. Contactos quedan en formulario/comando de confirmación y Appointment estándar, nunca en offer/URL/log/storage.
- [ ] Coordinar lease/ref por UID/epoch/negocio entre booking/reschedule/waitlist/cancel/offer: no abrir si hay otra acción; el lock propio no cambia enabled a false. Cleanup libera solo token propio. Éxito refresca Mis citas/useWaitlist y conserva proof fuera del subtree version; sin iniciar otra reserva automáticamente. Recarga hace GET current para recuperar estado/propuesta, nunca POST.
- [ ] TestsUI `ownerReviewSaysNonexclusiveAndNoExternalDelivery`, `clientPrepareNotConfirmOnOpen`, `shorterExpiryDoesNotClaimTenFreshMinutes`, `declineKeepsWaitlist`, `onlyLinkedSuccessSaysResolved`, `oldProofCurrentAppointmentShownSeparately`, `pendingConfirmSurvivesOwnLockAndAppointmentsRefresh`, `lateResponseCannotCrossUidEpochBusinessOffer`, `separateRecoveryDoesNotAbortPendingPost`, `offeredOrUsabilityDoesNotUnlockUnknownConfirm`, `terminalCloseInvalidatesLateMutationPublication`, `identityChangeMasksBeforeEffects`, `actionLeaseCannotReleaseAnotherScope`.
- [ ] Lecturas UI10s con cleanup; mutaciones avisan20s sin abortar por cronómetro, retry del mismo cuerpo solo tras error real. Una confirmación incierta se resuelve por proof booked/terminal persistido, nunca por head ausente/usability/reloj. close-expired/rechazo explícitos no crean otra reserva. Móvil320/390/1280, teclado y zoom200: un paso principal, textos breves, ayuda ampliable y sin aglomerar CRM/configuración.
- [ ] Ejecutar suites nuevas de dueño/cliente, waitlist UI/lifecycle, client-appointments/booking-proposal/structured-booking y S07/Agenda afectados, más typecheck. QA sintética local sin mensajes/IA/datos reales; commit futuro `feat: guide owners and clients through nonexclusive waitlist offers`.

### Task 8: Gate integrado y entrega compatible

- [ ] pnpm test/typecheck/build/Worker check y emulador si hubo cambios desde el gate anterior, con comandos/recuentos/exitcodes reales. Reporte futuro docs/qa/2026-10-22-waitlist-offers.md con pin compuesto, fixtures y límites. No afirmar pruebas por existir el plan.
- [ ] Rollout con índices/allowlist/lectores primero y gatefalse; habilitar tras evidencia de dueño/cliente y almacenamiento real. Rollback gatefalse conserva lector S09 y endpoints de oferta/cierre/proof para pendientes, sin volver a463/fase1 sin recuperación. No revertir citas/cuota o restaurar snapshot sobre actividad nueva para deshacer UI.
- [ ] Revisar diff contra los cinco Review Focus, helper común sin regresiones y ausencia de canales externos. Preservar solicitudes independientes y no reapertura automática. Commit futuro `docs: verify waitlist offers resolution and compatible rollback`.

## Autorrevisión

Se eligió propuesta embebida para no cambiar versiones/endpoints actuales; la primitiva común conserva reglas y permite un reloj final correcto. Head, estados persistidos y proof separan publicación, propuesta, cierre y reserva. Resolución enlazada no se deduce de identidad/fecha ni reaparece por cancelación. Existen tareas reales para permiso, cuota, carreras, DTO, mantenimiento y UX; ningún estado se afirma probado en esta fase. Salud/menores y canales externos siguen fuera del alcance implementable de este par.
