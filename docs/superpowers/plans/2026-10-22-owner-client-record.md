# Plan: consulta mínima de reservas de una cuenta

> Ejecucion iniciada el 24/10/2026 sobre main publicado `95a3a3e16f67f42520094b82ec5bb3b59a8d8d3f` (P1-P5 nucleo verificados). El titular indico ?ok sigamos?; se ejecuta el siguiente bloque S06 del orden acumulativo. Las restricciones de preparacion del texto historico describen su redaccion, no una nueva pausa de ejecucion. Mantener S05 Task7 diferida.


> **Para ejecutar después:** usar la habilidad de ejecución de planes vigente sobre una rama aislada de la fuente efectiva reconciliada. Este documento no autoriza improvisar sobre el checkout mixto E:. La preparación actual solo escribe documentación: no ejecuta tests, código, migraciones, dependencias, Git o despliegue.

**Goal:** Permitir al dueño consultar reservas indexables de la misma cuenta y negocio desde una cita, con paginación real, estados guardados y privacidad de beneficiarios; sin CRM global, métricas o escrituras.

**Spec:** [Diseño de consulta mínima](../specs/2026-10-22-owner-client-record-design.md). Base: fuente `C:/Users/Drean Skate/AppData/Local/SarinBot/whatsapp-adaptation-20261020/source-restoration` pin `463ae55f8c873468980746185fb3e91f55cb8681`, más Agenda y Estados verificados. Reconocer al iniciar los deltas reales de S09/reprogramación u otras ramas; no volver a crear sus archivos. Runtime documentado `c8bb0a99d9ac2bb20acaef2e5a157b0ff83b05f2`, delta al pin documental.

**Architecture:** Servicio servidor read-only sobre Database, POST privado de lectura y DTO allowlist, modelo puro de filtro/cursor/proyección, hook con scope/abort y un panel del dueño. Query por client.uid+type dentro de un negocio,20+lookahead; continuación empates y fechas anteriores sin OR. No nueva entidad cliente, esquema persistido, reglas o allowlist. Node24 y pnpm11.23.0, sin dependencias ni cambio de lockfile.

## Global Constraints

- Node 24, pnpm 11.23.0, lockfile compartido conservado, sin dependencias nuevas y una replica.
- Desde una cita de la agenda, el propietario puede consultar paginas de reservas de la misma cuenta reservante y del mismo negocio.
- POST /api/businesses/[id]/appointments/[appointmentId]/client-record; cuerpo maximo 2.048 bytes, esquema estricto, no-store en exito/error.
- Pagina fija20 con lookahead21; maximo dos consultas acotadas y21 citas leidas por pagina, mas negocio/cita entrada/ancla.
- La API declara siempre coverage: { mode: indexed_appointments, completeness: not_guaranteed }; sin historia completa, totales o snapshot entre paginas.
- Sin nueva coleccion, datos persistidos, migracion de documentos, reglas, permisos o campos de Worker. Indices aditivos primero; produccion usa D1/R2, Firebase solo Auth.
- No devolver contactos, nombre/rol del menor, intake, servicio, precio, autorizaciones o auditoria; no escribir cuotas/politicas/locks/asistencia.
- Usar solo alsdevstudio.com como hostname del motor. E: permanece solo lectura y no ejecutable; implementar exclusivamente en el workspace aislado actual.

## Review Focus

1. Reautorizar dueño y vínculo cita→UID en cada página; nunca suplantar cliente en view=mine ni buscar perfiles/otros tenants.
2. DTO excluye contactos, intake, nombres/roles del menor, servicio, precio, consentimientos y auditoría; beneficiaryKind no significa identidad única.
3. Cursor estable de campos actuales, empates de más de20, ancla cambiada y límites reales de indexación/concurrencia; ninguna promesa de historia completa/totales.
4. Único panel explícito, estado aislado por cuenta/negocio/cita/filtro, sin nuevo polling ni datos antiguos tras cambiar scope.
5. Integración sobre tarjetas postAgenda+Attendance, navegación con saving/ref, índices compatibles y rollout/rollback sin mutar citas.

## Archivos previstos

| Acción | Archivo |
| --- | --- |
| Crear | `src/lib/owner-client-record.ts` (tipos/schemas/orden/proyección pura), `src/lib/server/owner-client-record.ts` (lectura/fingerprint privado) |
| Crear | `src/app/api/businesses/[id]/appointments/[appointmentId]/client-record/route.ts` |
| Crear | `src/hooks/use-owner-client-record.ts`, `src/components/owner-client-record-panel.tsx` |
| Modificar | `src/components/owner-agenda-appointments.tsx`, `src/app/dashboard/page.tsx` sobre base compuesta |
| Modificar | `firestore.indexes.json`; crear siguiente migración D1 de índices, sin sobrescribir Attendance/S09/otras ramas |
| Pruebas | `tests/owner-client-record-model.test.ts`, `tests/owner-client-record-domain.test.ts`, `tests/owner-client-record-routes.test.ts`, `tests/owner-client-record-d1.test.ts`, `tests/owner-client-record-hook.test.tsx`, `tests/owner-client-record-ui.test.tsx`, `tests/owner-client-record-dashboard.test.tsx` |
| Adaptar prueba compartida | `tests/memoryFirestore.ts`, `tests/firestore.integration.test.ts` y test de caracterización del doble |

No modificar Appointment persistido, client-policy, reglas, disponibilidad, confirmación/reschedule, attendance ni shared/data-protocol. No se necesitan callbacks de escritura en el panel.

### Task 1: Modelo puro y contrato de proyección

**Files:** crear modelo y tests; fixture sintético `tests/owner-client-record-fixture.ts` que amplíe citas de la base compuesta sin datos reales.

**Produces:** tipos OwnerClientRecordFilter/Cursor/Row/Page idénticos a spec, schemas estrictos de input y respuesta, `compareOwnerClientRecordRows` ordinal y funciones puras de etiquetas/proyección. El fingerprint cursor permanece en módulo server para no enviar crypto de Node al cliente. El modelo cliente no importa `server/client-policy.ts` ni `server/schemas.ts`: expresa los mismos límites UID/ID y rechazo completo de controles mediante Zod apto para cliente; el servicio de Task2 sí reutiliza los validadores servidor y prueba paridad. No extraer otro servidor al bundle para reutilizar una regex.

- [ ] Escribir `strictBodyHasFixedFilterAndCursor`, `rejectsArbitraryPageSizeUidControlsAndTrailingNewline`, `cursorRequiresCanonicalIdTimestampAnd64HexRevision`, `projectionUsesAllowlistOnly`, `minorNameRoleIntakeAndContactsNeverLeaveProjection`, `unknownBeneficiaryIsNotSelf`, `unknownStatusIsNotConfirmed`, `invalidEndTimeIsExplicit`, `deletedResourceDoesNotHideHistory` y `colombiaDateDerivedFromSavedStart`. Comparar JSON de salida con claves exactas, no solo buscar una cadena sensible.
- [ ] Escribir `ordinalIdsHaveSameTieOrderRegardlessLocale`, `invalidCoreIdentityCannotBeSkipped`, `pastConfirmedIsNotAttendance`, `completedAndNoShowArePersistedStatesNotCounters`. Recursos actuales inactivos siguen reconocibles; referencia desconocida usa Recurso anterior, sin exponer IDs como nombre. Beneficiario ausente es undeclared; objeto presente inválido es unverified.
- [ ] Ejecutar `pnpm exec vitest run tests/owner-client-record-model.test.ts`; RED específico antes de implementar. Proyección nunca hace spread de Appointment ni devuelve serviceName/price. Repetir hasta GREEN.
- [ ] Commit focalizado futuro `feat: define minimal owner account reservation projection`.

### Task 2: Consulta autorizada y paginación compuesta

**Files:** crear servicio servidor y tests dominio; adaptar doble memoria para mantener lista de orderBy, lookup anidado y exclusión de campos de orden ausentes. Añadir caracterización del doble; conservar aviso de que no simula phantoms de consulta.

**Consumes:** modelos Task1, assertOwner/documentIdSchema/clientUidSchema/Database existentes y parser de revisión de reschedule. Metadato Attendance proviene de la base compuesta; ausencia0, presencia corrupta falla503.

**Produces:**

```ts
readOwnerClientRecord(owner: ChatActor, businessId: string, sourceAppointmentId: string,
  supplied: z.input<typeof ownerClientRecordInputSchema>, db?: Database): Promise<OwnerClientRecordPage>;
ownerClientRecordCursorRevision(appointment: Appointment): string; // servidor, SHA-256
```

- [ ] Escribir `ownerOnlyIncludingSuperadmin`, `sourceAppointmentProvesExactUidWithinTenant`, `guessedUidCannotChooseAnotherAccount`, `wrongStoredIdOrTenantCannotRead`, `manualBlockOrNoAccountCannotOpen`, `sameUidInAnotherTenantNeverAppears`, `expiredPlanAndMissingNewConsentStillRead`, `readNeverWritesLocksPoliciesQuotaOrAudits`. Espiar cero tx.set/create/delete; no invocar inferencia ni Auth Admin profiles.
- [ ] Escribir `firstPage20PlusLookahead`, `fortyFiveRowsAre20_20_5`, `moreThanTwentyEqualStartTimesDoNotDisappear`, `sameDateTailPrecedesOlderTimes`, `lookaheadIsNotCursor`, `zeroLimitNeverIssued`, `moreThan1000RowsUseBoundedQueries`, `allIncludesCancelledAndFuture`, `outcomeFilterMatchesStoredStatusExactly`. Sembrar IDs válidos con mayúsculas/minúsculas/guiones y comparar ordinal con backends reales después.
- [ ] Implementar una transacción read-only: negocio y cita entrada, autoridad/tenant/id/type/UID; ancla si cursor; queries según spec. Primera página una consulta limit21; continuación tail limit21 y solo si falta, older limit(21-tail.length). No leer globalmente para ordenar en Node ni usar límite1000 como página. Validar cada resultado/lookahead antes de cortar y proyectar.
- [ ] Escribir `movedCorrectedDeletedOrForeignAnchor409`, `forgedRevisionIsNotTrusted`, `corruptRevisionDoesNotBecomeZero`, `duplicateOrMisorderedRowsReject`, `queryErrorIsNotEmpty`, `missingOrderingFieldMayBeAbsentButCoverageNeverClaimsComplete`, `presentInvalidOrderingFieldFailsClosedWhenReturned`. No lanzar una segunda lectura masiva para contar los legados excluidos.
- [ ] Ejecutar modelo/dominio hasta GREEN. El doble corregido reproduce múltiples órdenes, presencia de campos y comparaciones anidadas; no cambiar semántica productiva para acomodar el doble. Ejecutar suites vecinas de reschedule/bookings/attendance que usen memoryFirestore una vez por el cambio compartido.
- [ ] Commit futuro `feat: query owner account reservations with bounded cursors`.

### Task 3: Endpoint privado e índices de ambos backends

**Files:** ruta POST, tests rutas, firestore.indexes.json y nueva migración D1 aditiva. Actualmente base tiene0001–0006; Attendance prevé0007: escoger número siguiente tras reconciliar otras ramas, no fijar una colisión. Índices `app_client_record_all` y `app_client_record_status`.

- [ ] Escribir `unauthenticated401`, `clientOtherOwnerAndSuperadmin403`, `sourceAndTenantPathCannotBeSubstituted`, `postOnlyReadHasNoSideEffects`, `strict2048ByteBodyAndNoQuery`, `malformedFilterCursorAndUid400`, `contentType415`, `actualStreamOver2048Bytes413`, `allErrorsAndSuccessNoStore`, `doesNotCallViewMineOrProfileDirectory`. Body UID válido no es autorización por sí solo; debe coincidir con source.client.uid dentro de la transacción.
- [ ] Ejecutar `pnpm exec vitest run tests/owner-client-record-routes.test.ts`; RED. Implementar Node/dynamic route con requireUser, readJson(...,2048), apiError y no-store. POST solo lectura no reclama idempotencia de escritura; GET no implementado y querystring rechazada. Mantener errores/domaincodes de spec, sin imprimir request/UID/filas.
- [ ] Crear índices D1 `(parent,json_extract(data,'$.client.uid'),json_extract(data,'$.type'),json_extract(data,'$.startAt') DESC,json_extract(data,'$.id') ASC,path)` y variante insertando status después de type. Firestore: client.uid ASC,type ASC,startAt DESC,id ASC; y client.uid ASC,type ASC,status ASC,startAt DESC,id ASC. No añadir fields/collections al Worker ni reglas de lectura directa nuevas.
- [ ] Afirmar queries de empates e históricas usan índices y no cambian límites/protocolo. No eliminar índices previos de reminders/reschedule/attendance; tampoco deducir que el índice ascendente existente sirve a ambos nuevos órdenes.
- [ ] Commit futuro `feat: expose private paged reservation records for owners`.

### Task 4: D1/Firebase reales, legado y límite de concurrencia

**Files:** nuevo test D1, ampliar firestore.integration y caracterización del doble. Usar createDataTestRuntime de `cloudflare/tests/data-runtime.mjs`, patrones de `tests/appointment-reschedule.integration.test.ts`, fixtures demo. No credenciales ni servidores productivos.

- [ ] Escribir `d1CompositeTiesAndFiltersUseIndexes`, `d1ThousandPlusAppointmentsNeverHitGlobalQueryCap`, `d1CursorAnchorChangeRejects`, `d1EachPageHasCoherentTransaction`, `d1SnapshotIsNotRetainedAcrossPages`. Dos handles D1: pausar segunda lectura y mutar cita; retry read-only debe producir página válida de una revisión. Una vez enviada la primera página, nueva cita/movimiento remoto puede quedar antes o después del cursor; test demuestra esa limitación y el aviso, sin prometer snapshot global.
- [ ] Medir SQL local con EXPLAIN QUERY PLAN de queries realmente generadas, incluidos tail/older y ambos filtros; usar app_client_record_all/status. Sembrar muchos documentos de otros UID/negocios y1001 del seleccionado; solo21 resultados de query por página, máximo dos queries. Si explain indica scan/sort amplio, corregir índice/consulta antes de cerrar rendimiento; no atribuir capacidad productiva por ensayo local.
- [ ] Probar filas ausentes de startAt/id: D1 y Firebase no las incluyen por orderBy y respuesta conserva completeness:not_guaranteed. Incluir un valor existente corrupto devuelto y comprobar503, nunca drop silencioso. No reparar dataset dentro del lector ni escribir un total de omitidas. Backend error/missing index falla, no usa otro backend ni página vacía.
- [ ] En Firebase Emulator Admin SDK, repetir45 citas incluyendo25 de misma hora y ambos filtros, ancla reprogramada/corregida, DTO de menor y owneronly. No certificar estos casos únicamente con memoryFirestore. Conservar reglas existentes: API dueña autoriza por servidor, no una colección nueva abierta a browser.
- [ ] Ejecutar `pnpm exec vitest run tests/owner-client-record-model.test.ts tests/owner-client-record-domain.test.ts tests/owner-client-record-routes.test.ts tests/owner-client-record-d1.test.ts`; GREEN. Ejecutar `pnpm run test:rules` con Java21+ y FIRESTORE_EMULATOR_HOST demo (runner incluye integración). Registrar gates omitidos como pendientes si no puede arrancar entorno; no declararlos aprobados.
- [ ] Commit futuro `test: verify owner records across storage backends and legacy data`.

### Task 5: Hook y panel progresivo

**Files:** hook, panel, tests hook/UI; usar apiFetch/expectedUid/AbortController existentes, sin poller nuevo.

**Produces:**

```ts
type OwnerClientRecordScope = {
  businessId: string; ownerUid: string; dateKey: string; sourceAppointmentId: string; clientUid: string;
};
useOwnerClientRecord(input: { scope: OwnerClientRecordScope | null; enabled: boolean; invalidation: number }): {
  page: OwnerClientRecordPage | null; loading: boolean; error: string | null;
  filter: OwnerClientRecordFilter; setFilter: (value: OwnerClientRecordFilter) => void;
  loadOlder: () => Promise<void>; refresh: () => Promise<void>;
};
type OwnerClientRecordPanelProps = {
  scope: OwnerClientRecordScope; contextName?: string; disabled: boolean; invalidation: number;
  onClose: () => void; onOpenAppointment: (target: { appointmentId: string; dateKey: string }) => void;
};
```

- [ ] Escribir `doesNotLoadBeforeExplicitOpen`, `bodyCarriesExactSourceUidAndFilter`, `neverUsesMineOrAnotherDailyGet`, `scopeChangeMasksBeforeEffects`, `filterChangeResetsCursorAndAborts`, `latePagesCannotCrossAccountBusinessSourceOrFilter`, `deadlineTenSeconds`, `closingAbortsAndClears`, `unauthorizedClearsPrivatePage`, `cleansTimersAndConsumesLateResponses`. Cada fetch valida schema estricto y scope/filter/orden; revision64hex y cursores no se aceptan solo por cast.
- [ ] Escribir `olderPageReplacesInsteadOfAccumulating`, `failedOlderPageRetainsCurrentScopePageWithError`, `headRefreshDoesNotMixOldPages`, `repeatedIdFromCurrentPageRequiresRefresh`, `anchorChangedOffersRestart`, `invalidationRejectsEarlierRead`. Un fallo503 no dice «sin historial». Deshabilitar solicitudes nuevas mientras loading/disabled, sin disparar auto-reintentos; retry explícito usa cursor actual aún válido y si409 reinicia solo tras Actualizar.
- [ ] Escribir UI `accountNotBeneficiaryCopyAlwaysVisible`, `coverageWarningAndVerifiedEmptyAreExplicit`, `allCompletedNoShowFiltersUseRealStatuses`, `pastConfirmedIsNotMarkedNoShow`, `minorNameAndIntakeNeverRender`, `noTotalLastVisitOrPaymentClaim`, `resultOnlyNotAuditProven`, `keyboardCloseAndFocusRestoration`. En filtros completed/no_show, nunca agrupar por beneficiarykind ni llamar única persona al conjunto.
- [ ] Implementar máximo20 filas de una sola página; filtros sencillos, Ver reservas anteriores reemplaza, Volver al inicio/Actualizar reinicia, ayuda inicialmente cerrada, errores locales y aria-live. contextName viene de tarjeta actual y se escapa como texto, sin prometer nombre vigente ni pedirlo a otro endpoint. No guardar page/scope/UID en storage o URL.
- [ ] Ejecutar `pnpm exec vitest run tests/owner-client-record-hook.test.tsx tests/owner-client-record-ui.test.tsx`; RED→GREEN, sin mensajes reales/IA. Commit futuro `feat: guide owners through scoped reservation records`.

### Task 6: Dashboard postAgenda+Attendance y QA

**Files:** dashboard, OwnerAgendaAppointments y tests dashboard; reporte QA futuro. No duplicar tarjetas inline ni otra ruta para lectura diaria.

- [ ] Extender OwnerAgendaAppointmentsProps con `onOpenClientRecord(appointment)` exclusivamente; conservar saving/onSaved/onCancel/onAttendanceBusyChange y todos los props anteriores. Botón solo para appointment con UID válido; bloqueos y cita sin cliente no ofrecen ficha. Dashboard comprueba contexto y savingRef antes de abrir, guarda selección mínima y monta un solo panel junto a agenda.
- [ ] onOpenAppointment del panel comprueba savingRef, cierra panel, cambia modo a día, fecha target y filtro todos recursos. El hook de Agenda carga como siempre y solo se enfoca una tarjeta encontrada con mismoID/tenant/dateKey; no convertir OwnerClientRecordRow en Appointment. Cambio de cuenta/negocio/día invalida selección antes de render; volver a fecha anterior no recupera página privada cacheada.
- [ ] En wrapper actual de onSaved (asistencia/representación) y cancelación exitosa, si la cita conocida pertenece a selected.clientUid incrementar invalidation y reiniciar página abierta. Coordinar useOwnerAgenda.replaceAppointment de la base compuesta; lectura vieja de la ficha no publica después de esa invalidación. No añadir otra llamada diaria para «refrescar CRM» ni cambiar ClientPolicyControls a un directorio nuevo.
- [ ] Escribir `onlyOnePanelAndNoPerCardReads`, `postAgendaCardsKeepExistingActionsAndPolicies`, `attendanceOwnBusyDoesNotAbortItsOwnPatchWhenRecordIsClosed`, `savingRefBlocksOpenAndNavigate`, `recordNavigationUsesExistingAgendaReadAndFocusesCanonicalRow`, `missingMovedAppointmentDoesNotInjectDto`, `savedOutcomeInvalidatesOlderRecordRead`, `accountChangeClosesAndMasksPanel`, `recordDoesNotChangeQuotaOrSubjectReview`. Usar componentes reales con respuestas retrasadas para aislamiento, no solo callbacks espía.
- [ ] Ejecutar suites focalizadas y `tests/owner-agenda-dashboard.test.tsx tests/appointment-attendance-dashboard.test.tsx tests/client-appointments.test.tsx tests/representation-review.test.tsx`; `pnpm run typecheck`. Probar320/390/1280px, teclado/zoom200, carga/error/vacío/20filas, recurso inactivo/retirado y menor sintético. La UI no debe aglomerar datos en el dashboard al abrir una ficha.
- [ ] Ejecutar una suite general `pnpm test`, `pnpm run build` y `pnpm --filter sarin-cloudflare-host run check` por migración/SQL; repetir emulador solo si hubo cambios posteriores al gate. Usar copia física exacta si build de worktree/enlaces lo exige según prácticas vigentes, sin copiar secretos. Registrar comandos/resultados reales y entorno; esta documentación no los presenta como ejecutados.
- [ ] Rollout futuro: reconciliar fuente/runtime, respaldo privado verificado y despliegue compatible de índices antes de app. Si Firestore se usa, índices listos. Prueba local rollback app conserva citas/auditoría/índices y no crea datos nuevos. No fallback D1↔Firebase, backfill, exportación de clientes ni restaurar snapshot antiguo sobre actividad nueva. Publicar solo en etapa posterior autorizada.
- [ ] Revisión independiente de diff final contra los cinco Review Focus, cobertura exacta y límites; sin fotos/contactos/intake en capturas ni logs. Commit futuro `docs: verify scoped owner reservation records and rollout`.

## Autorrevisión documental

El plan separa lectura paginada de CRM global y no agrega los indicadores de S06 que siguen sin contrato propio. Endpoint, scopes, DTO, cursor, índices y estados de error tienen tareas y pruebas responsables. Cubre lo que los índices pueden omitir sin inventar un conteo, y lo que una transacción por página no garantiza entre páginas. La base elegida incluye Agenda y Attendance; no existe dependencia implícita de S09/S07 para leer historia, aunque la ejecución debe reconciliar sus cambios concurrentes. Preparado para implementación acotada y revisión independiente, no implementado ni equivalente a captura completa de Fresha.
