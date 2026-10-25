# Resumen operativo mínimo del dueño — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Solo documentación en este encargo; no ejecutar producto, comandos de prueba o despliegue ahora.

**Goal:** Mostrar recuentos actuales de citas por fecha/estado y confirmadas terminadas sin resultado, con cobertura histórica y límite de consulta visibles, sin importes ni porcentajes inferidos.

**Architecture:** Nuevo GET dueño readonly agrega una consulta de rango en transacción, máximo999 filas recuperadas con corte1000→413. Modelo puro clasifica estados y cobertura; hook validado sin polling y UI por periodo/detalle progresivo. No escribe contadores ni depende de CRM/turnos.

**Tech Stack:** Node24, pnpm11.23.0, Next16.4.0, React19.3.0, TypeScript estricto, Zod/Vitest y Database/D1/Firestore existentes; sin dependencias/SQL nuevos.

**Spec:** [2026-10-22-owner-operation-summary-design.md](../specs/2026-10-22-owner-operation-summary-design.md). Leer ambos documentos antes de ejecutar; la preparación no acredita pruebas aprobadas.

## Global Constraints

- Fuente efectiva reconciliada desde `C:/Users/Drean Skate/AppData/Local/SarinBot/whatsapp-adaptation-20261020/source-restoration`, referencia463ae55, más Agenda y Estados verificados; E: mixto no ejecutable.
- Node24, pnpm11.23.0, lockfile intacto, marca/tokens/accessibilidad y shell existentes; sin dependencias ni migraciones, índices, allowlist o persistencia nuevos.
- Solo dueño vigente en cada lectura; sin bypass superadmin ni requisitos nuevos de plan/consentimiento para leer historia propia.
- Rango inclusivo dateKey Colombia,1–31días, dentro de hoy−365 a hoy; presets Hoy/7días/30días; sin programación futura ni createdAt/pago/fecha del evento como criterio.
- Máximo999 documentos recuperados; query limitada1000 y1000→413, sin resumen truncado ni fallback a cero ante errores.
- Estado actual, cobertura por índices no garantizada; sin dinero, personas, penalizaciones, IA, mensajes, exportaciones, tasas de retención/ausencia u ocupación.
- Mantener consentimiento, salud/menores, suscripción y contratos de citas intactos; engine solo alsdevstudio.com, una réplica, nunca cuerpos/contactos/secretos en logs o capturas.

## Review Focus

- Documento legado sin dateKey o tipo de fecha indexable: no aparece y advertencia nunca promete completitud; tareas1–2/4.
- Cita con precio, beneficiarios y correcciones: cuenta un documento/estado actual, nunca cobro/persona/fecha de evento; tareas1–2.
- Lectura1000, error de índice/transporte y filas corruptas: límite/error global distinto de cobertura parcial/ceros; tareas1–3.
- Medianoche Colombia y fin del buffer no verificable: reloj servidor, subconjunto pendiente sin inferir asistencia; tareas1–2.
- Cambio de ámbito/rango y respuesta tardía o JSON inválido: no exponer números previos ni confundir periodo editado con aplicado; tareas3–4.

## Archivos previstos y contratos

| Acción | Archivo/responsabilidad |
| --- | --- |
| Crear | `src/lib/owner-operation-summary.ts`: tipos, schemas estrictos, rango, agregador puro, errores conocidos. |
| Crear | `src/lib/server/owner-operation-summary.ts`: lectura dueña/rango en transacción y DTO mínimo. |
| Crear | `src/app/api/businesses/[id]/operation-summary/route.ts`: GET Node/dynamic/no-store y parámetros exactos. |
| Crear | `src/hooks/use-owner-operation-summary.ts`: consulta explícita, ámbito/abort/deadline y validación respuesta. |
| Crear | `src/components/owner-operation-summary.tsx`, `src/app/dashboard/reports/page.tsx`: periodo y detalle de recuentos, estados/advertencias, AuthGate/AppShell. |
| Modificar | `src/app/dashboard/page.tsx`: enlace secundario Resumen operativo; `src/components/app-shell.tsx`: conservar contrato businessNavigationPath y los cuatro destinos principales. |
| Crear pruebas | `tests/owner-operation-summary-model.test.ts`, `owner-operation-summary-domain.test.ts`, `owner-operation-summary-routes.test.ts`, `owner-operation-summary-d1.test.ts`, `owner-operation-summary-hook.test.tsx`, `owner-operation-summary-ui.test.tsx`, `owner-operation-summary-page.test.tsx`. |
| Ampliar pruebas reales | `tests/firestore.integration.test.ts`: rango/capacidad/legado/auth e invariancia de datos. |
| Crear al ejecutar | `qa/tests/owner-operation-summary.md`, `docs/qa/2026-10-22-owner-operation-summary.md`: protocolo sintético/resultados medidos reales. |

No tocar esquemas Appointment, eventos de asistencia, cambios de estado, reserva/reprogramación, configuración, recibos/cuotas ni módulos del cliente. Si S09 ya extrajo calendar-time, usar el reexport estable de availability para fechas; no crear otro helper de timezone divergente. No cambiar memoryFirestore para simular errores que requieren D1/Firestore reales; si CRM ya mejoró el doble, conservar esa caracterización.

### Task1: Diccionario, rango y agregación pura

**Files:** modelo y tests de tabla.

**Interfaces producidas:** OperationRange/Counts/Coverage/OwnerOperationSummary y firmas parseOperationRange/operationPresetRange/summarizeOwnerOperation exactamente de spec; export `ownerOperationSummarySchema`, `OperationSummaryRangeError extends Error` y `OperationSummaryCapacityError extends Error`. parseOperationRange lanza OperationSummaryRangeError ante forma/rango/horizonte inválidos; summarize lanza OperationSummaryCapacityError para records.length≥1000 antes de devolver números. El servidor mapeará solo estas clases conocidas, no cualquier excepción genérica.

- [ ] Escribir `rangeIsInclusiveOneToThirtyOneDaysInColombia`, `thirtyTwoDaysInvalidAndThirtyOneValid`, `futureAndOlderThan365DaysReject`, `invalidDateNeverNormalizes`, `statusCountsSumAndEachDocumentCountsOnce`, `manualBlockIsNotAppointment`, `priceAndClientFieldsNeverAffectCounts`, `representedBeneficiariesDoNotCreatePeopleTotals`.
- [ ] Usar reloj2030-01-08T02:00:00Z (Colombia7enero21:00): through es2030-01-07; from7días es2030-01-01. end/reservedUntilAt exacto al reloj incluye awaitingOutcome; un milisegundo posterior no. `startAt < endAt <= reservedUntilAt`, enteros seguros y día inicial igual a dateKey; ausencia/invalidez deja confirmed y aumenta confirmedEndUnverifiable.
- [ ] Escribir `outcomesAreCurrentStatusNotEventDate`, `correctionReplacesCountsRatherThanAddsVisit`, `cancelledOriginBreakdownIsExact`, `pastConfirmedDoesNotBecomeNoShow`, `unknownStatusTenantTypeOrConflictingIdMakesPartialCoverage`, `missingStoredIdCanUseCanonicalDocumentId`, `invalidTimeKeepsStatusCountButNotEndedSubset`, `allInvalidRowsArePartialNotEmpty`, `zeroDaysOnlyAfterSuccessfulRead`, `capacity1000NeverReturnsPartial`, `dtoSchemaRejectsWrongSumsDatesBoundsAndUnexpectedFields`.
- [ ] Ejecutar `pnpm exec vitest run tests/owner-operation-summary-model.test.ts`; RED específico antes de implementar. Crear schemas/modelo sin imports servidor ni objetos Appointment completos en DTO. IDs/range/time se validan, campos sensibles no se inspeccionan para contar ni se copian. Arrays days contienen cada fecha pedida, ascendente, incluso sin citas clasificables.
- [ ] Schema de salida comprueba totales=sum(días), suma cinco estados=total, awaitingOutcome+confirmedEndUnverifiable≤confirmed, total+invalidRecords+excludedManualBlocks≤999, días/rango/identity válidos y contadores seguros0–999. serverNow es timestamp positivo seguro/Date representable, no contador0–999. DTO no incluye prices/client/beneficiary/Appointment/eventos. No genera avisos de legislación ni presume historial completo por invalidRecords0.
- [ ] Fijar prueba `corruptManualBlockIsInvalidBeforeTypeExclusion`: identidad/tenant/fecha se validan antes del tipo; un bloqueo con esos campos inválidos aumenta invalidRecords, no excludedManualBlocks. Solo después de campos básicos válidos se descarta tipo manual_block.
- [ ] Repetir hasta GREEN. Commit futuro `feat: define scoped owner operation counts`.

### Task2: Lectura autorizada, límite conservador y backends reales

**Files:** servidor/ruta y tests dominio/ruta/D1/Firestore de tabla.

**Consumes:** modelo tarea1, requireUser/assertOwner/documentIdSchema/Database/apiError reales. **Produces:** `readOwnerOperationSummary(user: ChatActor,businessId: string,range: OperationRange,db: Database = getAdminDb()): Promise<OwnerOperationSummary>` y GET exacto de spec. Query `dateKey>=from,dateKey<=through,orderBy dateKey ASC,limit1000`; sin type/status filter que oculte filas a clasificar y sin SQL directo.

- [ ] Escribir `ownerOnlyNoSuperadminBypass`, `foreignBusinessNeverCounted`, `missingBusiness404`, `expiredPlanAndNoNewConsentCanRead`, `readOnlyNoEventsLocksQuotasWrites`, `rangeQueryUsesSingleTenantAndLimit1000`, `queriesDoNotAskProfilesOrPrices`, `storageFailureNotEmptySummary`, `exactly1000FailsConservatively`, `999CanSucceedIncludingManualAndInvalid`.
- [ ] Route tests:401/403/404, from/through únicos obligatorios, extras/duplicados/rango400, no-store en éxitos/errores, únicamente GET, sin cuerpo o parámetros de UID/recurso/export. Mapear RangeError propio→400 `OPERATION_SUMMARY_INVALID_RANGE` y CapacityError→413 `OPERATION_SUMMARY_RANGE_TOO_LARGE`; storage503/413 conservan error. No convertir errores en DTO con ceros.
- [ ] Ejecutar `pnpm exec vitest run tests/owner-operation-summary-domain.test.ts tests/owner-operation-summary-routes.test.ts`; confirmar RED. Implementar transacción que lee Business/autoridad y luego rango; serverNow se toma después de lecturas del intento final, se revalida rango y se agrega. La pertenencia de cada documento se valida antes de contar aunque esté en la colección correcta. No escribir contadores ni usar Business cacheado como dueño.
- [ ] Crear D1 test usando createDataTestRuntime/createCloudflareDatabase de pruebas existentes. Sembrar conjunto sintético de estados/bloqueos/legado/filas inválidas y comparar sumas exactas; comprobar ausencia de dateKey/campo de otro tipo no entra por índice y aviso basis=stored_date_key permanece. No exigir a memoryFirestore que reproduzca estos casos si su comparación de undefined lanza.
- [ ] Con dos handles y barrera de transporte entre lectura de negocio y query, mover/corregir una cita desde el segundo handle. La lectura debe reintentar revisión coherente; una cita cuenta una vez en fecha/estado finales de esa petición. Verificar que request de resumen no añade writes ni modifica app_documents/revisión; distinguir el cambio explícito de la fixture concurrente del GET. Sin carrera, app_revision y documentos permanecen idénticos.
- [ ] Sembrar999 y1000 recuperables incluidos bloqueos;999 éxito/1000 error. Repetir en Firestore Emulator AdminSDK para verificar limit/orden/rango y no side effects. No llamar Completed a dinero ni consultar eventos privados por cada fila. Si índice/bytecap fallan antes, registrar error y no sumar resultados parciales.
- [ ] Ejecutar `pnpm exec vitest run tests/owner-operation-summary-model.test.ts tests/owner-operation-summary-domain.test.ts tests/owner-operation-summary-routes.test.ts tests/owner-operation-summary-d1.test.ts`, y `pnpm run test:rules` con Java21+ (runner existente de integración/rules, proyecto demo). GREEN real; un gate no ejecutado queda pendiente, no aprobado. Commit futuro `feat: read bounded owner operation summaries`.

### Task3: Consulta explícita y presentación progresiva

**Files:** hook/componente/ruta y tests hook/UI/page; `src/app/dashboard/page.tsx` para enlace secundario y shell para contrato de contexto ya integrado.

**Interfaces:**

```ts
type OwnerOperationSummaryScope = { businessId: string; ownerUid: string; authEpoch: number };
useOwnerOperationSummary(input: { scope: OwnerOperationSummaryScope | null; enabled: boolean }): {
  summary: OwnerOperationSummary | null; appliedRange: OperationRange | null;
  loading: boolean; error: string | null; capacityError: boolean;
  query: (range: OperationRange) => Promise<void>; refresh: () => Promise<void>;
  queryPreset: (preset: 'today' | '7days' | '30days') => Promise<void>;
};
type OwnerOperationSummaryPanelProps = {
  summary: OwnerOperationSummary | null; appliedRange: OperationRange | null;
  loading: boolean; error: string | null; capacityError: boolean;
  onQuery: (range: OperationRange) => void; onRefresh: () => void;
  onPreset: (preset: 'today' | '7days' | '30days') => void;
};
```

El componente exportado es OwnerOperationSummaryPanel; hook hace consulta inicial queryPreset('7days') una vez por entrada/scope con fechas Colombia, y no polling. Tras DTO válido guardar ancla serverNow+receivedMono de performance.now. queryPreset calcula ahora como serverNow+(performance.now−receivedMono) y llama operationPresetRange; el panel envía onPreset y no reutiliza timestamp congelado del snapshot. Antes de primera lectura válida usa Date.now solo como propuesta validada por servidor. Mantener timestamp de consulta fijo en UI; el reloj derivado solo calcula presets. Cambiar ámbito purga ancla. Hora local manipulada sin ancla que produzca rango inválido muestra error, no corrección silenciosa. La ruta conserva enabled por auth/negocio candidato y no por plan; endpoint prueba autoridad en cada respuesta.

- [ ] Escribir `loadsOncePerEntryNoPolling`, `customDatesDoNotFetchEachKeystroke`, `presetUsesColombiaAndServerClockWhenKnown`, `editedRangeNeverRelabelsPreviousCounts`, `oneRequestScopeAndOldRangeCannotWin`, `scopeMasksBeforeEffects`, `sameUidNewEpochClearsNumbers`, `403AndWrongOwnerHideSummary`, `deadlineTenSecondsCleanupAndLateResponseIgnored`, `invalidDtoOrMismatchedRangeNeverDisplays`.
- [ ] Añadir `presetCrossesColombiaMidnightUsingMonotonicElapsed`: respuesta serverNow2030-01-08T04:59:50Z recibida en mono1000; mono avanza20000ms y Date.now devuelve fecha local falsa. Hoy consulta2030-01-08 y7días2030-01-02..08. El timestamp visible anterior permanece fijo; no agregar polling/interval para obtener este resultado. Una respuesta descartada por scope no actualiza ancla.
- [ ] Implementar apiFetch<unknown> con expectedUid/isCurrentSession/generación de scope+rango, AbortController y carrera10s incluyendo token/JSON. Al nueva query limpiar summary/appliedRange, invalidar anterior y abortar; no mantener tarjetas de otro periodo bajo campos nuevos. Un GET no cooperativo no publica tarde. Errores dejan summary null sin spinner infinito ni cero inventado. refresh repite último rango solicitado si fue inválido/error; no genera otro desde placeholders. No auto-retry ni bucle periódico.
- [ ] UI tests `coverageNoticeAlwaysVisibleEvenZero`, `currentStateAndNoPaymentCopy`, `cardsAreCountsNotRates`, `endedSubsetNotAddedToTotal`, `unknownEndShowsCoverageWarning`, `allInvalidNotClaimedNoAppointments`, `dailyTableAndCancellationBreakdownInitiallyClosed`, `explicitQueryFocusesResultOrError`, `initialLoadDoesNotStealFocus`, `customerOrAdminDoesNotGetOwnerBypass`.
- [ ] Implementar periodo+Consultar juntos, Hoy/7/30, tres resultados y total, confirmed/awaitingOutcome explicados, details para tabla diaria/desglose/definiciones. Mostrar aplicado/timestamp Colombia separados de edición de filtros. En413 pedir reducir fechas; no paginar trozos para fingir suma estable. No acciones de asistencia ni contactos/importes/ocupación dentro del informe. Navegación a agenda normal sin query nueva de cita.
- [ ] Agregar ruta `/dashboard/reports` bajo AuthGate/AppShell con `businessNavigationPath='/dashboard'` y enlace secundario Resumen operativo desde Mi agenda, sin nuevo destino principal. Conservar Mi agenda/Mi negocio/Enlace y QR/Suscripción y módulos admin. Probar `ownerKeepsFourDestinations` al integrar S09/S17 y que cada enlace secundario resuelve su ruta/contexto; navegación durante acciones pendientes respeta las guardas del dashboard, sin autoenviar/reintentar escrituras. No reconstruir shell ni introducir otra autoridad global. Desmontar al salir; sin portales, anuncios ocultos, dashboard gigante ni guardar selección en storage/URL.
- [ ] Ejecutar `pnpm exec vitest run tests/owner-operation-summary-hook.test.tsx tests/owner-operation-summary-ui.test.tsx tests/owner-operation-summary-page.test.tsx tests/workspace-navigation.test.tsx`; RED→GREEN. Commit futuro `feat: guide owners through operational appointment counts`.

### Task4: Verificación completa, costo de lectura y entrega

**Files:** QA futura y solo reparaciones justificadas por fallos; no ampliar alcance a métricas nuevas.

- [ ] Fixture de siete días, dos recursos y estados sintéticos: confirmar UI cuenta documentos independientemente de beneficiario/precio y señala fechas/índice/parcialidad. Ver estados cambiados desde otro módulo y Actualizar; timestamp impide llamarlo tiempo real. Comprobar640/1280 y320/390px, zoom200%, teclado/lector, errors/empty/999/capacity; no captura identificable.
- [ ] Medir en fixture local número real de lecturas/bytes/duración: una lectura de negocio y una query de rango por intento, más retries transaccionales reales. No son31 GET ni una lectura por resultado auditado. Registrar mediciones como locales, sin extrapolar capacidad productiva. Ninguna lectura produce inferencia, delivery o movimiento financiero.
- [ ] Ejecutar suites focalizadas completas, `pnpm test`, `pnpm run typecheck`, `pnpm run build`. Repetir emulador solo si hubo cambios posteriores a su gate. No ejecutar Worker deploy/check por rutina si no cambió Worker; si una reparación de adaptador llegara a ser necesaria, separarla y añadir sus gates existentes antes de cerrar.
- [ ] Revisar diff de branch contra spec: no nuevos campos persistidos/SQL/allowlists, denominadores/precios/personas omitidos, todos los warnings/códigos/pruebas de Review Focus cubiertos. Revisión independiente del incremento completo; trasladar QA real a documentación sin convertir este plan en evidencia ejecutada.
- [ ] Reconciliar fuente/runtime y publicar solo artefacto verificado en la etapa de ejecución autorizada. Rollback revierte UI/endpoint conservando asistencia/citas/índices ajenos, sin restaurar datos antiguos ni deshacer S09/CRM. Commit futuro `docs: verify owner operation summary and coverage limits`.

## Autorrevisión documental

Diccionario/rango/coverage están en tarea1; autorización/consulta/coherencia/capacidad en tarea2; UI/scope/JSON/error en tarea3; medición/gates/rollback en tarea4. Los cinco Review Focus tienen pruebas específicas. Se evita llamar cobertura completa a ausencia de filas o estado atendida a cobro. La consulta nueva no consume CRM ni requiere turnos individuales, y no cambia el primer paquete de cinco entregas ya documentado. Este plan no se ejecutó ni se publicó.
