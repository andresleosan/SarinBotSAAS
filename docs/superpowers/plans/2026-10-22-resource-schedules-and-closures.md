# Horarios por recurso y cierres — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. La captura documental inicial fue seguida por autorización del titular el24 de octubre. Las cinco tareas se ejecutaron con executing-plans; [QA, revisión y límites](../../qa/2026-10-24-resource-schedules.md). Integración/publicación S09 pendientes.

**Goal:** Permitir al dueño definir jornada semanal de recursos, excepciones de fecha y cierres, aplicados uniformemente a nueva disponibilidad sin cambiar citas existentes.

**Architecture:** Política JSON independiente con revisión, recibos de operación durables y CAS. Resolver puro intersecta apertura común y jornada individual, aplica excepción y resta cierres; todos los caminos de disponibilidad la leen, con confirmaciones transaccionales. UI por pasos independiente del guardado agregado del negocio.

**Tech Stack:** Node 24, pnpm 11.23.0, Next 16.4.1, React 19.3.0, TypeScript estricto, Zod, Vitest y adaptador D1/Workerd existentes; sin dependencias nuevas.

**Spec:** [2026-10-22-resource-schedules-and-closures-design.md](../specs/2026-10-22-resource-schedules-and-closures-design.md). Leer también agenda, configuración guiada y resultados operativos enlazados allí.

## Global Constraints

- Ejecutar en worktree aislado desde fuente efectiva reconciliada, referencia `463ae55f8c873468980746185fb3e91f55cb8681` en `C:/Users/Drean Skate/AppData/Local/SarinBot/whatsapp-adaptation-20261020/source-restoration`; E: es documental mixto.
- Node 24 y pnpm 11.23.0; conservar lockfile, marca/tokens y shell; no nuevas dependencias ni migraciones SQL.
- Horario común es límite superior; política ausente hereda, política inválida/error falla sin abrir huecos.
- Cinco intervalos por jornada de entrada, sin truncar fragmentos efectivos; 30 semanas propias, 120 excepciones, 120 cierres; Colombia UTC−05; HH:mm sin 24:00 ni noche; horizonte366 días y cierre máximo366 días inclusivos.
- Preservar consentimiento, suscripción, salud/menores, cuotas, locks, autorización por servidor y distinción reservante/beneficiario.
- No mover/cancelar citas ni crear cobros, avisos externos, IA, empleados/nómina o reservas por celda.
- No registrar cuerpos/contactos/secretos ni reglas en URL/browser storage; engine solo `alsdevstudio.com`, una réplica.
- `SARIN_RESOURCE_SCHEDULE_WRITES_ENABLED` false por defecto; rollback conserva lector de restricciones, no vuelve a463 ignorándolas.

## Review Focus

- Política ausente frente a ilegible y recurso histórico desconocido: herencia solo por ausencia real; tareas1–3/5.
- Buffer cerca de cierre y nuevo intervalo09:10: conservar ancla15 y bloque completo; tareas1/3.
- Cierre o cambio común concurrente con confirmación: ninguna validación usa policy fuera de la transacción; tareas2–3.
- Respuesta perdida/replay después de otra revisión y borrador dirty ante polling: un recibo prueba aplicación, no actualidad; tareas2/4.
- Pérdida de propiedad, reentrada o petición tardía: no exponer caché/horario anterior; tareas2/4–5.

## Archivos y responsabilidades

| Archivo | Cambio previsto |
| --- | --- |
| Crear `src/lib/resource-schedules.ts` | Tipos, schemas aptos para cliente, canonicalización, resolver de intervalos y validación estructural. |
| Crear `src/lib/sarin/calendar-time.ts` | Extraer helpers actuales de fecha/hora sin cambiar semántica; availability los reexporta para evitar ciclo de imports con policy. |
| Modificar `src/lib/sarin/availability.ts` | Recibir policy requerida; conservar anclas comunes y filtrar por jornada efectiva con buffer. |
| Crear `src/lib/server/resource-schedules.ts` | Lectura validada, fingerprints, autorización, CAS, recibos y comando dueño. |
| Crear `src/app/api/businesses/[id]/resource-schedules/route.ts` | GET/PUT estricto, no-store, límite128KiB y gate; sin SQL directo. |
| Modificar `shared/data-protocol.ts`, `cloudflare/tests/data.test.mjs` | Añadir solo children resourceSchedulePolicies/resourceScheduleOperations y verificar límites/aislamiento de rutas. |
| Modificar `cloudflare/src/router.ts`, `cloudflare/wrangler.jsonc`, `cloudflare/tests/router.test.mjs` | Forward/validación del gate booleano y valor false inicial, sin tocar credenciales ni flags de otros módulos. |
| Modificar `src/lib/server/bookings.ts`, `booking-proposals.ts`, `appointment-rescheduling.ts`, `structured-booking.ts`, `waitlist.ts` | Integrar policy en las nueve llamadas actuales y transacción de destino; no duplicar algoritmos. |
| Crear `src/hooks/use-resource-schedules.ts` | Read/edit, ámbito revocable, borrador local, revisión, comando único/recibo/replay. |
| Crear `src/components/resource-schedule-workspace.tsx`, `src/app/dashboard/schedule/page.tsx` | UI por tareas/pasos, route guard y propietario; sin editor de configuración común. |
| Modificar `src/components/app-shell.tsx`, `src/components/owner-configuration-workspace.tsx` | Contexto Mi negocio mediante businessNavigationPath y enlace secundario Turnos y cierres; conservar cuatro destinos principales, sin ampliar payload/config provider. |
| Modificar `src/components/owner-agenda-calendar.tsx`, `src/app/dashboard/page.tsx` | Contexto readonly de horarios y advertencias; conservar lectura independiente de citas. |
| Crear pruebas `tests/resource-schedules.test.ts`, `resource-schedules-server.test.ts`, `resource-schedules-routes.test.ts`, `resource-schedules.integration.test.ts`, `use-resource-schedules.test.tsx`, `resource-schedule-workspace.test.tsx`, `resource-schedule-agenda.test.tsx` | Resolver, contrato, carreras D1 reales, scope/dirty/operación y UI. |
| Crear durante ejecución `qa/tests/resource-schedules-and-closures.md`, `docs/qa/2026-10-22-resource-schedules-and-closures.md` | Fixture sintético y resultados reales. No crear en fase documental. |

`owner-configuration-workspace` y `owner-agenda-calendar` son archivos producidos por planes anteriores, no archivos existentes en463. Integrar esos incrementos primero. Si cambian nombres durante ejecución, reconciliar interfaces antes de tocar código; no crear una segunda agenda/formulario. La reprogramación del dueño posterior consume funciones de tarea2, no implementa otro resolver.

### Task 1: Modelo, schemas y resolver puro

**Files:** crear `src/lib/resource-schedules.ts`, `src/lib/sarin/calendar-time.ts`, `tests/resource-schedules.test.ts`; modificar `src/lib/sarin/availability.ts`, `tests/availability.test.ts`.

**Interfaces:** exportar los tipos exactos de la spec, `resourceScheduleRulesSchema`, `resourceSchedulePolicySchema` y:

```ts
emptyResourceSchedulePolicy(businessId: string): ResourceSchedulePolicy;
canonicalResourceScheduleRules(rules: ResourceScheduleRules): ResourceScheduleRules;
resolveResourceDaySchedule(input: { business: Pick<Business, 'weeklySchedule'>; policy: ResourceSchedulePolicy; resourceId: string; dateKey: string }): DaySchedule;
```

`getAvailableSlots` conserva nombre/resultado y recibe propiedad **requerida** `resourceSchedulePolicy: ResourceSchedulePolicy`. Los callers de prueba legacy usan emptyResourceSchedulePolicy explícita. Tipar cierre como unión discriminada efectiva: `{scope:'business';resourceId?:never}` o `{scope:'resource';resourceId:string}` intersectada con campos comunes de la spec. Schemas rechazan negocio cruzado/versión/desconocidos y validan duplicados; el validador estructural no exige que los IDs existan en Business, tarea2 aplica esa regla contextual.

- [ ] Escribir pruebas `absentPolicyPreservesLegacySlots`, `ownClosedDayDoesNotInherit`, `exceptionReplacesResourceDayButCannotOpenCommonClosedDay`, `closureWinsAndUnionsOverlaps`, `manyClosuresProduceMoreThanFiveEffectiveSegmentsWithoutClipping`, `adjacentCommonIntervalsDoNotBridge`, `businessGridRemainsAnchored`, `bufferMustFitEffectiveInterval`, `closedDayRequiresEmptyIntervals`, `duplicatesAndInvalidDatesFail`, `inactiveAndServiceExcludedResourcesRemainExcluded`.
- [ ] Fijar fixture lunes2030-01-07, común09:00–12:00, recurso A09:10–11:00, B hereda, servicio30+buffer15. A comienza09:15; cierre A hasta10:05 deja10:15 como primero; inicio10:30 cabe hasta11:15 solo si el turno llega11:15. Excepción abierta no crea slots el domingo común cerrado. Un cierre de día completo elimina solo candidatos, no appointments del input.
- [ ] Ejecutar futuro `pnpm exec vitest run tests/resource-schedules.test.ts tests/availability.test.ts`; confirmar RED por capacidad ausente.
- [ ] Extraer isDateKey/isTimeString/toMinutes/toTimeStr/toColombiaTimestamp sin modificar cuerpo a calendar-time y reexportarlos desde availability; policy importa calendar-time directamente. Schemas Zod de política viven en resource-schedules, sin import de schemas servidor; conservar regex/límites de documentId y rechazar __proto__/prototype/constructor. Command HTTP en servidor reutiliza requestIdSchema/documentIdSchema. Verificar importación cliente sin server-only y ausencia de ciclo runtime.
- [ ] Implementar resolver en minutos [inicio,fin), intersección/substracción y canonicalización; conservar bucle de candidatos anclado en cada intervalo común y exigir inclusión completa en intervalo efectivo. No reiniciar cuadrícula al restar cierre ni cambiar lógica de ocupación/tenant/buffer histórico.
- [ ] Afirmar que común09:00–18:00 con seis cierres cortos disjuntos devuelve siete segmentos efectivos y ningún slot invade esos cierres. Max5 valida solo jornadas de entrada; no aplicar daySchema.max(5), slice(0,5) ni otra pérdida a los intervalos derivados, incluidos los que fragmenten intersecciones de semana/excepción.
- [ ] Repetir pruebas; confirmar GREEN. Actualizar fixtures de tests que invocan getAvailableSlots con policy explícita, sin aflojar aserciones. Commit futuro focalizado `feat: resolve resource schedules and closures`.

### Task 2: Persistencia, CAS y recibos verificables de dueño

**Files:** crear servidor/ruta y pruebas server/routes/integration de la tabla; modificar shared/data-protocol, cloudflare/tests/data.test.mjs y router/config/tests del gate de la tabla.

**Interfaces producidas:** tipos ResourceScheduleCommand/Receipt/View/SaveResult y firmas exactas de servidor en la spec. Importar `Transaction`, `Database`, `ChatActor` reales. `db` por defecto getAdminDb en funciones públicas. La canonicalización del comando incluye requestId, expectedRevision, expectedBasisFingerprint y reglas normalizadas; SHA256 forma operationHash. Persistir recibo con businessId/actorUid y validar ambos al releer. No guardar nombres/contactos ni snapshot del catálogo dentro del recibo.

- [ ] Escribir `missingPolicyIsRevisionZero`, `malformedOrCrossBusinessPolicyFailsClosed`, `ownerOnlyAndFreshBusinessOnEveryRequest`, `readAllowedWithoutPlanButWriteRequiresPlanConsentAndGate`, `staleRevisionAndBasisRejectWithoutWrites`, `receiptAndPolicyCommitTogether`, `identicalReplayAfterLaterEditReturnsAppliedAndCurrentSeparately`, `sameRequestDifferentPayloadRejects`, `pastEntriesCanOnlyStayOrBeRemoved`, `unknownInactiveReferencesOnlyPreservedIfUnchanged`.
- [ ] Escribir route tests: requireUser, ID/query/requestId duplicado o inválido, JSON estricto128KiB, 401/403/402/409/503, no-store, solo GET/PUT; ownerUid y businessId en respuesta verificados. Ningún GET escribe policy/recibo/locks. Gate false devuelve writesEnabled false y PUT503 `SCHEDULE_WRITES_DISABLED` para comando nuevo.
- [ ] Ejecutar `pnpm exec vitest run tests/resource-schedules-server.test.ts tests/resource-schedules-routes.test.ts`; confirmar RED. Usar memoryFirestore existente para dominio, sin credenciales/red.
- [ ] Implementar transacción de spec con `resourceSchedulePolicies/current` y recibo estable. Verificar dueño antes de replay. Replay idéntico puede consultarse aunque después falte plan/gate, pues no escribe. Documento existente inválido jamás usa empty. Si revision llegara a MAX_SAFE_INTEGER, rechazar sin incremento inseguro. Validar horizonte con serverNow y referencias modificadas contra recursos activos; mantener filas antiguas idénticas o eliminables.
- [ ] Agregar children permitidos al protocolo, sin permisos navegador ni SQL. Verificar rutas genéricas Worker en tests existentes; conservar forward de nuevas rutas Next sin introducir endpoint público de datos. `firestore.rules` ya deniega estas subcolecciones: no abrirlo para simplificar UI.
- [ ] Añadir `SARIN_RESOURCE_SCHEDULE_WRITES_ENABLED` a runtimeKeys de `cloudflare/src/router.ts`, validar solo true/false si está presente y fijar false en vars de `cloudflare/wrangler.jsonc`. Tests router: ausencia/false no habilitan, true se conserva hasta Container y valor inválido rechaza sin volcar env. No asumir que una variable Worker se transmite automáticamente al proceso Node; no incluirla en argumentos públicos de build. Si types generados requieren actualizar bindings al ejecutar `pnpm --filter sarin-cloudflare-host run types`, revisar que el diff solo refleje esta variable no secreta.
- [ ] Crear integración D1 con createDataTestRuntime/createCloudflareDatabase y **dos handles**, patrón `tests/appointment-reschedule.integration.test.ts`. Probar dos comandos expectedRevision0: exactamente uno escribe revision1; mismo requestId concurrente crea una revisión/recibo; response loss reenvía commit idéntico y replay de dominio reconoce evidencia después de revision2. Corromper policy existente ⇒ error explícito, no herencia. Verificar documentos de negocio/publicBusiness/citas/cuotas sin cambios por PUT.
- [ ] Ejecutar `pnpm exec vitest run tests/resource-schedules-server.test.ts tests/resource-schedules-routes.test.ts tests/resource-schedules.integration.test.ts` y `pnpm --filter sarin-cloudflare-host test` (script real node --test tests/*.test.mjs). Registrar resultados reales, no afirmar prueba por existir fixture. Commit futuro `feat: persist resource schedules with revision receipts`.

### Task 3: Aplicación uniforme en reserva, propuesta, reprogramación y espera

**Files:** modificar los cinco módulos servidor de tabla; actualizar suites existentes `tests/bookings.test.ts`, `tests/appointment-reschedule.test.ts`, `tests/appointment-reschedule.integration.test.ts`, `tests/next-availability.test.ts`, `tests/next-availability-d1.integration.test.ts`, `tests/waitlist-d1.test.ts`; ampliar `tests/resource-schedules.integration.test.ts`.

**Consumes:** readResourceSchedulePolicy(tx,businessId,db), policy requerida de tarea1. **Produce:** mismas firmas públicas de reservas/propuestas/espera y mismos shapes HTTP, con horarios nuevos efectivamente restringidos. `readAvailability` conserva firma Business como entrada de compatibilidad pero relee por business.id en transacción y no usa horario cacheado; `business` dentro del resolver es el vigente de esa transacción.

- [ ] Escribir casos `allAvailabilityPathsHonorResourceClosedDay`, `nextSkipsClosedDateWithoutExtraPolicyReadPerDay`, `waitlistDoesNotReportClosedSlotAvailable`, `proposalBeforeClosureCannotConfirmAfterClosure`, `clientRescheduleDestinationRevalidatesPolicy`, `scheduleRacePreservesCommittedExistingAppointment`, `commonScheduleRaceRechecksAvailability`, `manualBlockOutsideShiftRetainsContract`.
- [ ] Para cada una de las nueve llamadas actuales a getAvailableSlots: leer policy exactamente una vez por transacción/búsqueda y pasarla. En next usar misma policy en todo rango14días. En espera usar la misma tx de contexto/proyección/creación. No introducir fallback ante503 ni catch que devuelva slots[] simulando cierre/no disponibilidad.
- [ ] Reserva y movimiento validan policy antes de preparar writes, dentro de transacción que lee locks existentes; no mover esa lectura a un prefiltro exterior. Mantener idempotencia/replay de reservas ya completadas: reconocer éxito previo no debe volver a validar disponibilidad y rechazarlo por cierre posterior.
- [ ] Probar carrera D1 con barrera de transporte: A confirma cita mientras B guarda cierre. Orden A→B conserva cita y policy nueva; orden B→A deja propuesta sin cita y devuelve409. Propuesta creada antes de cierre no consume cupo de reserva al rechazar confirmación. Si el cierre cambia después de una confirmación ya committeada, esa cita no se cancela. Añadir carrera de turno común editado vía createBusiness para comprobar que lectura de Business sigue siendo parte de la misma tx.
- [ ] No aplicar jornada al origen de una reprogramación, cancelación o resultado retrospectivo. Confirmación nueva valida destino actual. No modificar createManualBlock para exigir turno ni reemplazar sus controles de colisión.
- [ ] Ejecutar `pnpm exec vitest run tests/resource-schedules.test.ts tests/resource-schedules.integration.test.ts tests/availability.test.ts tests/bookings.test.ts tests/appointment-reschedule.test.ts tests/appointment-reschedule.integration.test.ts tests/next-availability.test.ts tests/next-availability-d1.integration.test.ts tests/waitlist-d1.test.ts`; confirmar todas GREEN. `rg -n 'getAvailableSlots\(' src` debe mostrar policy explícita en todos los callers; typecheck también lo impone. Commit futuro `feat: enforce resource schedules across booking flows`.

### Task 4: Controlador, edición por pasos y recuperación de operación

**Files:** crear hook/workspace/ruta y `tests/use-resource-schedules.test.tsx`, `tests/resource-schedule-workspace.test.tsx`; modificar shell y OwnerConfigurationWorkspace.

**Interfaces producidas:**

```ts
type ResourceSchedulePhase = 'loading' | 'ready' | 'review' | 'saving' | 'uncertain' | 'conflict' | 'error';
type ResourceScheduleController = {
  view: ResourceScheduleView | null; draft: ResourceScheduleRules | null;
  phase: ResourceSchedulePhase; dirty: boolean; error: string | null; message: string | null;
  setRules: (rules: ResourceScheduleRules) => void; review: () => void;
  save: () => Promise<void>; refresh: () => Promise<void>;
  inspectPending: () => Promise<void>; retryPending: () => Promise<void>; discard: () => void;
};
useResourceSchedules(input: { businessId: string | null; ownerUid: string | null; authEpoch: number; mode: 'read' | 'edit'; enabled: boolean }): ResourceScheduleController;
ResourceScheduleWorkspace(props: { controller: ResourceScheduleController }): ReactNode;
```

`mode:'read'` no permite setRules/review/save/retryPending: no-op sin mutación; readonly no crea borrador. Edit usa último snapshot validado como baseline. review guarda fingerprint de draft+basis/revision; save solo acepta revisión local vigente e immutable command. authEpoch procede del hook de Auth existente, no se inventa otro proveedor. No extraer roles o negocio de URL sin verificación servidor.

- [ ] Escribir `freshReadBeforeShowingEditorOnReentry`, `sameUid403PurgesAndDiscardsLateResponse`, `readFailureNeverShowsInheritedHours`, `externalUpdateKeepsDirtyAndRequiresReload`, `reviewBecomesInvalidWhenDraftChanges`, `gateAndCommercialFailuresDoNotEraseDraft`, `soft20SecondsDoesNotAbortPut`, `missingReceiptNeverUnlocksDifferentCommand`, `retryUsesIdenticalIdRevisionBasisAndPayload`, `oldReceiptWithNewPolicyExplainsBoth`, `readonlyCannotSendPut`.
- [ ] Ejecutar `pnpm exec vitest run tests/use-resource-schedules.test.tsx`; confirmar RED. Implementar GET10s con childAbort/timer cleanup y race acotada; PUT sin deadline duro y aviso20s. Cada respuesta valida ámbito UID/época/negocio/generación. Red conserva draft protegido; 401/403/dueño ajeno purga. Error503 de GET no se convierte en empty policy. Reentrada exige GET nuevo, no useBusiness cacheado.
- [ ] Mantener solo un comando en vuelo; tras error ambiguo sellar payload/requestId. inspectPending hace GET con ese requestId; solo recibo válido/hash/revisión/ámbito prueba operación. Ausencia mientras puede seguir en curso no permite B. retryPending repite exactamente comando tras error real; nunca crea ID nuevo. Coincidencia de reglas sin recibo no prueba aplicación. Respuesta final/recibo válido adopta current policy, mostrando aparte revision aplicada cuando difieren.
- [ ] Con dirty y GET externo diferente, phase conflict conserva draft y ofrece revisar o cargar actual con confirmación inline; no guardar sobre nueva revisión hasta descarte/carga/reedición y review nuevo. discard no actúa durante saving/uncertain. Al desmontar ruta no conservar conversación ni archivos; beforeunload protege cuando navegador puede, sin prometer interceptar toda salida SPA.
- [ ] Escribir UI tests `oneTaskVisibleAtATime`, `inheritDoesNotDeleteExceptions`, `closureSaysEveryDayAndExistingAppointmentsRemain`, `commonClosedDayCannotAppearOpenInPreview`, `inactiveUnknownRulesAreVisibleAndRemovable`, `backDoesNotSave`, `errorsRevealAndFocusField`, `noPrivateOrAiInputs`, `scheduleLinkDoesNotSubmitAggregateConfig`.
- [ ] Implementar ruta `/dashboard/schedule` y tres tareas de spec, revisión y guardar; sin portal/diálogos ocultos ni autofocus en vista ausente. AppShell recibe `businessNavigationPath='/dashboard/onboarding'`, unión opcional limitada a las cuatro rutas principales, ignorada en admin; introducir ese contrato si todavía no existe y FAQ lo reutiliza después. Enlace secundario Turnos y cierres desde Horarios de Mi negocio, en otra pestaña explícita, sin POST ni quinto destino principal. Probar `ownerKeepsFourDestinations` y contexto activo Mi negocio de la ruta nueva; conservar enlaces/guardias de otros incrementos. Mantener Configuración común en su ruta/guardado actual. Label genérico sin datos de clientes; no exponerlo al público. GET view.basis actual alimenta preview, no semana cacheada de otro poller.
- [ ] Ejecutar `pnpm exec vitest run tests/use-resource-schedules.test.tsx tests/resource-schedule-workspace.test.tsx tests/owner-configuration-workspace.test.tsx tests/workspace-navigation.test.tsx`; GREEN. Commit futuro `feat: guide owners through resource schedule changes`.

### Task 5: Contexto readonly en agenda y verificación integrada

**Files:** modificar OwnerAgendaCalendar/dashboard; crear `tests/resource-schedule-agenda.test.tsx`; QA futura de tabla.

**Interfaces:** prop adicional requerida en OwnerAgendaCalendar:

```ts
scheduleContext: { state: 'ready'; view: ResourceScheduleView } | { state: 'loading' | 'error' };
```

Dashboard compone useResourceSchedules mode read con identidad verificada; el calendar no hace fetch. Un GET policy por refresco visible15s, no un GET por día; no solapar lecturas de ese hook. Las siete consultas de citas conservan deadline/errores ya definidos por agenda. No crear dependencia de citas hacia éxito de policy.

- [ ] Escribir `scheduleReadFailureKeepsAppointmentsButRemovesShading`, `resourceClosureShowsContextWithoutHidingExistingAppointment`, `unknownHistoricalResourceHasUnverifiableHours`, `policyRefreshDoesNotResetAgendaDateOrActions`, `onePolicyReadServesSevenDates`, `ownerScopeSwitchNeverRendersOldSchedule`. Intervalo fuera de horario lleva advertencia, no se elimina; canceladas/históricas conservan reglas de agenda/resultados.
- [ ] Ejecutar `pnpm exec vitest run tests/resource-schedule-agenda.test.tsx tests/owner-agenda-calendar.test.tsx tests/owner-agenda-dashboard.test.tsx`; confirmar RED y después GREEN al integrar prop/leyenda. Declarar gráfico contextual, sin botón reservar ni porcentaje de ocupación inventado.
- [ ] Crear fixture sintético dos recursos, siete días, cierre global y uno individual, excepción, buffer y una cita ya fuera de turno. Revisar teclado, lector, móvil320/390px y zoom200%; error/carga visible, ayuda plegada, retorno conserva selección. Registrar duración/cantidad real de lecturas locales; sin inferencia, producción, export privado ni mensajes.
- [ ] Ejecutar una vez tras cambios finales `pnpm test`, `pnpm run typecheck`, `pnpm run build` y `pnpm --filter sarin-cloudflare-host run check`. Estos comandos son para ejecución futura en rama aislada; este documento no afirma resultados. Respetar skips reales y fallos previos; no inventar acceso a motores para volverlos verdes.
- [ ] Revisar branch completo: todos los callers requieren policy, children añadidos son únicos, ningún publicBusiness expone reglas/labels, no SQL migrado, no cambios pago/inferencia/cliente omitidos. Revisar gates: allowlist/lector antes de habilitar writes, escritor off conserva enforcement, rollback usa release lector compatible. Dejar protocolo/QA con resultados reales y limitaciones.
- [ ] Commit futuro `feat: show resource schedule context in owner agenda`; revisión independiente antes de publicación. No desplegar automáticamente por completar este plan.

## Integración posterior con reprogramación del dueño

S07 debe leer policy con `readResourceSchedulePolicy(tx,businessId,db)` en preparación y confirmación y guardar `resourceScheduleFingerprint` obtenido de `resourceDayScheduleFingerprint(business,policy,targetResourceId,targetDateKey)`. Confirmación compara huella, verifica disponibilidad nueva con policy y conserva locks/revisión/origen. Cambio de política ⇒409 y revisión nueva, sin override. El origen histórico no se rechaza por haber quedado fuera de turno. No existe dependencia inversa: S09 funciona sin S07.

## Autorrevisión documental

Cobertura: tarea1 modelo/límites; tarea2 autoridad/idempotencia/CAS/allowlist; tarea3 todos los caminos actuales; tarea4 UX/operación/scope; tarea5 agenda/lecturas/rollback. Los cinco Review Focus tienen pruebas nombradas. No hay implementación, test ejecutado ni publicación atribuida a estos archivos. Se eligió política independiente para evitar ampliar config agregada; el recibo durable nuevo no se presenta como capacidad de su POST actual. Horarios no resuelven automáticamente citas antiguas, buffer histórico, nómina ni métricas de ocupación: esos límites permanecen visibles.
