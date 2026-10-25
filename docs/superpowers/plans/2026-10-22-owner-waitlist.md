# Plan: bandeja del dueño y revisión manual de espera

> Preparación documental. Ejecutar después mediante habilidad de ejecución vigente, en rama aislada de fuente efectiva reconciliada; no sobre E: mixto. Ninguna tarea de producto, test, Git o publicación se ejecuta al escribir este documento.

**Goal:** Dar al dueño una bandeja FIFO por fecha de las solicitudes actuales, consultar disponibilidad real y marcar revisión manual sin reservas, avisos o resolución implícita.

**Spec:** [Bandeja y revisión](../specs/2026-10-22-owner-waitlist-design.md). Base `source-restoration` pin463ae55 en ruta exacta de spec, más Agenda/configuración guiada/S09 verificados. Reconciliar Attendance, CRM y S07 si ya integrados. Node24,pnpm11.23.0; sin dependencias/lockfile.

**Architecture:** Inbox con query compuesta acotada20+1, lector compartido de espera por principal de datos, marker privado por entryId con CAS y lastOperation, página dueña por pasos. Cliente actual no cambia estados ni contratos; dueño nunca actúa como cliente. Oferta/confirmación enlazada va en segundo par, no se simula aquí.

## Review Focus

- ownerUid del registro es cliente, ownerUid del DTO es dueño autenticado; autoridad por negocio en cada lectura/mutación y principal interno no habilita mutaciones.
- FIFO visible no es asignación; expiración y cobertura actual no son archivo histórico ni total de personas.
- Ver disponibilidad reutiliza anclas/permisos/cupo y S09 en la misma transacción, sin N cálculos por fila, sin truncar ocupación.
- Revisión no cierra espera ni avisa; CAS/lastOperation/ambigüedad no se hacen pasar por journal histórico.
- Datos minimizados, cambio de scope, mantenimiento de marcas/tombstones y compatibilidad Worker/índices.

## Archivos

| Acción | Archivo |
| --- | --- |
| Crear | `src/lib/owner-waitlist.ts`, `src/lib/server/owner-waitlist.ts` |
| Refactorizar sin cambiar API cliente | `src/lib/server/waitlist.ts`, helpers read-only en `src/lib/server/booking-subject-consent.ts` |
| Crear | `src/app/api/businesses/[id]/owner-waitlist/query/route.ts`, `[id]/owner-waitlist/[recordId]/route.ts`, `[id]/owner-waitlist/[recordId]/review/route.ts` bajo mismo prefijo api/businesses |
| Crear UI | `src/app/dashboard/waitlist/page.tsx`, `src/hooks/use-owner-waitlist.ts`, `src/components/owner-waitlist-workspace.tsx` |
| Integrar | Enlace secundario desde Mi agenda y contexto AppShell businessNavigationPath='/dashboard', sin quinto destino principal ni otra instancia de tarjetas |
| Persistencia | shared/data-protocol.ts, cloudflare/src/data.ts, migración siguiente disponible, firestore.indexes.json |
| Mantenimiento | src/lib/server/waitlist-data-maintenance.ts y pruebas correspondientes |
| Tests nuevos | owner-waitlist-model, owner-waitlist-domain, owner-waitlist-routes, owner-waitlist-d1, owner-waitlist-hook, owner-waitlist-ui; .test.ts/.test.tsx según entorno |

### Task 1: Modelo y contrato de FIFO/revisión

**Files:** nuevo modelo/testmodel/fixture sintético. **Produces:** tipos exactos OwnerWaitlistCursor/Review/Row/Page/Detail, query/review schema, validadores estrictos de respuestas aptos cliente; no importar server-only/schemas servidor al bundle.

- [ ] Escribir `strictDatesCursorAnd2048ReviewShape`, `opaqueRecordIdIsNotClientUid`, `controlCharactersIncludingFinalNewlineReject`, `fifoUsesCreatedAtThenOrdinalEntryId`, `listLifecycleNeverClaimsLiveAvailability`, `nullRequestIsNotActiveHistory`, `reviewDefaultOnlyOnRealAbsence`, `projectionOmitsUidContactCaseRoleAnchorsAndMinorName`, `dtoOwnerIsBusinessOwnerNotStoredWaitlistOwner`. Labels limitados120, referencias retiradas visibles sin datos globales.
- [ ] Ejecutar `pnpm exec vitest run tests/owner-waitlist-model.test.ts`; RED→implementar→GREEN. Fixture deriva de tests/waitlist-contract.ts, fechas2030 y dos clientes/dueños; no registros reales ni mensajes.
- [ ] Commit futuro `feat: define owner waitlist inbox and review contracts`.

### Task 2: Lector compartido sin suplantación y detalle de disponibilidad

**Files:** refactor waitlist.ts/booking-subject-consent.ts; nuevo servicio y testdomain. **Produces:**

```ts
readOwnerWaitlistDetail(owner:ChatActor,businessId:string,recordId:string,db?:Database):Promise<OwnerWaitlistDetail>;
// interno servidor de waitlist.ts; autoridad dueño comprobada en el propio helper
readOwnerWaitlistProjection(tx:Transaction,owner:ChatActor,businessId:string,recordId:string,db:Database):Promise<{
  recordId:string; record:WaitlistRecord; state:WaitlistState;
  availability:{resourceId:string;resourceName:string;slots:string[]}[];
}>;
```

Exportar WaitlistRecord solo como tipo servidor si hace falta, no como DTO. Extraer parse/validación canónica compartida para query y detalle. projection interna devuelve state+availability; readWaitlist sigue devolviendo state exacto actual. Helpers read-only usan `Pick<ChatActor,'uid'>`; funciones mutantes/rutas mantienen ChatActor real. No crear un usuario autenticado falso ni pasar principal a join/cancel/book/consentimientos.

- [ ] Escribir `detailRequiresCurrentOwnerEvenForSuperadmin`, `canonicalRecordBusinessAndUidCannotBeSubstituted`, `strictStoredRecordIdExpiryAndEntryLinkAreChecked`, `missingOrCancelledEntry404`, `currentVerifiedClientPermissionsAreReadOnlyEvidence`, `clientConsentRevokedIsSuspendedWithoutReceiptLeak`, `corruptEvidenceCannotHideAsSuspension`, `healthMinorPolicyIsPreservedNotAuthorizedByOwner`.
- [ ] Escribir `detailAvailabilityMatchesClientProjectionAndSchedule`, `closedShiftBufferAndQuotaNeverOfferSlots`, `deletedResourceOrServiceDoesNotBecomeAnyResource`, `readDoesNotWriteAdmissionQuotaPolicyRequestOrReview`, `expiredSkipsAvailability`, `occupancyOverflowFailsNotFreeSlots`. SourceS09policy requerida por mismo tx de Business/permisos/citas; no leerla fuera ni reconstruir oferta a partir de un booleano available.
- [ ] Ejecutar dominio+`tests/waitlist.test.ts tests/waitlist-d1.test.ts tests/waitlist-routes.test.ts tests/booking-subject-consent.test.ts`. Refactor solo firmas/helper read-only, mantener todas las aserciones cliente, no aflojar validaciones.
- [ ] Commit futuro `refactor: share verified waitlist projections for owner reads`.

### Task 3: Bandeja paginada, marker CAS y transporte

**Files:** servicio, rutas, domain/routes tests; protocolo/Worker/índices. **Produces:**

```ts
readOwnerWaitlistPage(owner:ChatActor,businessId:string,input:OwnerWaitlistQuery,db?:Database):Promise<OwnerWaitlistPage>;
updateOwnerWaitlistReview(owner:ChatActor,businessId:string,recordId:string,input:OwnerWaitlistReviewCommand,db?:Database):Promise<{
  businessId:string;ownerUid:string;recordId:string;entryId:string;waitlistRevision:number;
  review:OwnerWaitlistReview;replayed:boolean;
}>;
```

- [ ] Escribir `twentyPlusLookaheadAndFortyFivePages`, `moreThanTwentyCreatedAtTiesAreNotLost`, `tailPrecedesLaterTimes`, `cursorUsesLastReturnedNotLookahead`, `anchorCancelledReplacedOrForeign409`, `queryMissingFieldsHaveExplicitCoverage`, `listDoesNotCalculateAvailabilityPerRow`, `twentyMarkerReadsBoundedConcurrencyFour`, `invalidMarkerFailsInsteadOfDefaultFalse`, `noGlobalCountsOrPersonalDirectory`. Adaptar pruebas al doble multi-order corregido por CRM o caracterizarlo si CRM aún no entró; D1/Firebase mandan para orden real.
- [ ] Implementar query/tail/after según spec en una transacción, validando21 solicitudes y20marcadores. Marcadores por docID entryId, limitados; ausencia legítima es única fuente default. Nunca query sin fecha/límite para llenar bandeja. updatedAt de marker no altera FIFO.
- [ ] Escribir `reviewOnlyWritesPrivateMarker`, `reviewNeedsOwnerConsentButNotSubscription`, `staleEntryOrRequestRevisionRejects`, `sameLatestRequestReplayWritesNothing`, `requestReuseOtherBodyRejects`, `olderReplayAfterAnotherReviewDoesNotOverwrite`, `sameValueNewCommandIsNoChange`, `maxRevisionCannotWriteUnreadableMarker`, `clientCancelOrReplaceWinsAgainstReview`, `markingExpiredDoesNotReactivate`. Transacción lee negocio/record/marker/consentimiento antes de escribir; no leer perfiles o emitir avisos.
- [ ] Crear waitlistOwnerReviews allowlist y cuatro campos de consulta estrictos indicados en spec; tests Worker rechazan campos/tipos no autorizados y children desconocidos. Índice D1 FIFO+marker por waitlistRecordId y Firestore compuesto exactos; siguiente número libre tras reconciliar ramas. Mantener deny SDK y rutas cliente intactas.
- [ ] Route tests requireUser/owner,2048bytes reales, queryrechazada,400/413/415/401/403/404/409/428/503 y no-store siempre. Ningún GET escribe; POST query read-only. Cuerpo no acepta UID/actor/label libre ni price.
- [ ] Ejecutar tests modelo/dominio/rutas y Worker focalizados hasta GREEN. Commit futuro `feat: expose scoped owner waitlist inbox and review actions`.

### Task 4: Persistencia real, concurrencia y mantenimiento privado

**Files:** nuevo tests/owner-waitlist-d1.test.ts; ampliar firestore.integration/rules, waitlist-data-maintenance, data-migration tests.

- [ ] D1 runtime local con dos handles:45 entradas de una fecha,25mismo createdAt,1001de otras fechas/clientes; explicar queryreal usa app_waitlist_owner_fifo y no scan general;20markers máximo y sin consultas de disponibilidad en lista. Medir local coste de21+20 lecturas; no concluir capacidad productiva.
- [ ] Carrera de dos revisiones expected0⇒solo una marca revision1; revisión contra salida/reemplazo cliente ⇒no marker para intención ya cambiada. Si marker gana justo antes de salida, queda metadato de entrada antigua sin reactivar nada. Respuesta perdida: retry idéntico último comando devuelve estado; después de otra revisión vieja no sobrescribe y UI debe leer actual, sin reclamar proof inexistente.
- [ ] Firebase Emulator Admin SDK: repetir FIFO/ties/ancla y markerCAS real, no solo memoria. Rules dueños/clientes/otros/anónimo no leen/escriben waitlistOwnerReviews desde browser; cliente propio conserva esperaAPI. El API dueño sigue sin devolver UID, anchors, actor o caso sensible.
- [ ] Ampliar collect/export/delete privado para nuevos markers mediante waitlistRecordId canónico, incluso si el singleton falta o es tombstone; todo negocio incluye ambos children. Ámbito UID nunca se envía al UI. Viejo export incompleto contra inventario nuevo⇒409; exportnuevo+stopwriters+hash permite borrar≤100docsconjunto, sin orphan markers. No imprimir paths/UID privados ni crear route export.
- [ ] Respaldo/reconciliación sintéticos conservan markers/requests/tombstones/lastOperation; roundtrip IDs y revisiones iguales. Worker viejo rechaza nuevo child sin borrar estado. Ejecutar `pnpm exec vitest run tests/owner-waitlist-d1.test.ts tests/waitlist-data-maintenance.test.ts tests/data-migration.test.ts`, `pnpm run test:rules` con Java21+/demo; no aprobar gate omitido.
- [ ] Commit futuro `test: verify owner waitlist races privacy and maintenance`.

### Task 5: Página guiada y siguiente paso cliente explícito

**Files:** hook/workspace/ruta/shell y enlace Agenda, tests hook/UI.

```ts
useOwnerWaitlist(input:{businessId:string|null;ownerUid:string|null;authEpoch:number;enabled:boolean}):OwnerWaitlistController;
type OwnerWaitlistController={
  dateKey:string; page:OwnerWaitlistPage|null; detail:OwnerWaitlistDetail|null;
  loading:boolean; busy:boolean; uncertain:boolean; error:string|null;
  setDate:(dateKey:string)=>void; refresh:()=>Promise<void>; loadOlder:()=>Promise<void>;
  open:(recordId:string)=>Promise<void>; close:()=>void;
  setReviewed:(reviewed:boolean)=>Promise<void>; retryPending:()=>Promise<void>;
};
OwnerWaitlistWorkspace(props:{controller:OwnerWaitlistController;onViewAgenda:()=>void}):ReactNode;
```

- [ ] Un panel, fecha/FIFO/lista, detalle por acción; solo visible una tarea principal. CTA Ver disponibilidad llama detalle compartido (también al Actualizar explícito, sin polling). Horarios no son exclusividad ni oferta. Texto cliente concreto Comprobar horarios→Elegir horario→revisar/confirmar; no botón que actúe por cliente ni contacto supuesto. Botón **Abrir Mi agenda** navega a `/dashboard`, acompañado de «En la agenda, selecciona [fecha visible]». La base no tiene deep-link de fecha: no inventar `agendaDate` ni afirmar que quedó preseleccionada. Esta decisión evita cambiar el contrato URL/S07 para una lectura de espera.
- [ ] Tests `doesNotReadAvailabilityPerRowOrBeforeOpen`, `fifoNotAutomaticAllocation`, `availabilityExplainsNoHoldAndClientConfirmation`, `noContactNoNotifyNoOwnerBooking`, `reviewConfirmationSaysNoWithdrawal`, `reviewedDoesNotChangeClientState`, `emptyIsNotNoCustomersWaiting`, `coverageAndPastRequestLimitVisible`, `keyboardFocusAndProgressiveHelp`.
- [ ] Hook expectedUid/epoch/scope/generación, lectura10s+cleanup; mutación espera20s local con comando exacto retenido si incierto, sin otro comando hasta reconciliar. enabled nunca depende de propio busy/disabled. Separar lectura de reconciliación para consultar marker actual: revision≤pending.expectedReviewRevision mantiene barrera, aunque reviewed coincida. Solo respuesta/replay exacto de A, o revision>expected verificada, permite otro comando; en segundo caso mostrar estado actual sin proof de A. Entrada retirada/reemplazada exige cambio verificable de waitlistRevision/entryId, no timeout404 de transporte. Cambiar cuenta/negocio/fecha purga/máscara respuestas previas y aborta localmente sin prometer deshacer write.
- [ ] Tests `ownBusyDoesNotAbortPatch`, `lateListDetailOrPatchCannotCrossScope`, `earlierReadCannotRestoreOldReview`, `olderPageFailureKeepsCurrentPageAndError`, `sameTupleRetriesAfterUnknownResponse`, `equalCurrentRevisionDoesNotUnlockUnknownPatch`, `noChangeAttemptCannotFenceAnOlderWrite`, `newerCurrentRevisionResolvesAsCurrentNotHistoricalProof`, `logoutOr403PurgesBeforeRender`, `readDeadlineResourcesCleaned`. A pendiente con expected0→GETrev0→intento B no envía nada, aunque B quiera false/default; GETrev1 de otra operación permite revisión nueva sin afirmar que A aplicó. No requestId nuevo durante retry ni mutation en GET.
- [ ] UI320/390/1280/zoom200/teclado, expiración a medianocheCO, recurso retirado, permisos revocados, servidor503. Sin mensajes/IA/prod. Ejecutar suites nuevas+waitlistUI/lifecycle y Agenda afectada, typecheck. Commit futuro `feat: guide owners through manual waitlist review`.

### Task 6: Gates y continuidad a ofertas

- [ ] Ejecutar pnpm test/typecheck/build, emulador si cambios posteriores y Worker check por allowlist/query/index; registrar resultados reales. QA nueva en docs/qa/2026-10-22-owner-waitlist.md durante ejecución, sin atribuir aquí resultados.
- [ ] Despliegue futuro compatible índices/Worker antes de app; respaldo privado verificado, una réplica, lectorS09conservado en rollback. Mantener markers/tombstones/índices, no cleanup automático ni fallbackbackend. No abrir reglas navegador/exportaciones para facilitar UI.
- [ ] Revisión independiente de autoridad, readprincipal, índices, caplecturas y alcance mínimo. Ningún DTO/clienthook nuevo afirma request resuelta, reserva aceptada o notificación entregada. Este par es implementable sin ofertas; preparar el siguiente par separado con proposal+expiry+resolution del cliente, sin canales externos ni confirmar por dueño.
- [ ] Commit futuro `docs: verify owner waitlist review and handoff`.

## Autorrevisión

El lector cliente mantiene su API/estado y no suplanta una sesión. FIFO, empates y marcadores tienen índices y casos reales asignados; el detalle comparte validación S09/permisos. La revisión es privada, usa CAS y conserva la última operación, sin inventar auditoría histórica. El siguiente paso del cliente es explícito y vigente; una oferta real queda para el par separado. Todas las tareas están pendientes: este documento no acredita implementación ni captura administrativa exhaustiva.
