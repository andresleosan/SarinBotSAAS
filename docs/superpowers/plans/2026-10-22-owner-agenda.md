# Agenda visual del propietario — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Plan preparado el 22 de octubre; ejecutado por autorización del titular el 23 de octubre. Los resultados y límites reales se registran en el [reporte de QA](../../qa/2026-10-23-owner-agenda.md), no se deducen de las casillas históricas de este plan.

**Goal:** Dar al propietario una agenda visual de día y semana por recurso, con tarjetas y acciones existentes y sin modificar contratos del cliente.

**Architecture:** Modelo puro de fechas/recursos/bloques, lector acotado de GET diarios y un único hook sobre `useApiPoll`. Gráfico suplementario sin interacción de reserva, semana de un recurso y listado canónico del día seleccionado; integración mínima en el dashboard actual.

**Tech Stack:** Node 24, pnpm 11.23.0, Next 16.4.0, React 19.3.0, TypeScript estricto, Tailwind existente, Vitest 5 y react-test-renderer existentes.

**Spec:** [2026-10-22-owner-agenda-design.md](../specs/2026-10-22-owner-agenda-design.md). Leer ambos documentos antes de ejecutar.

**Base efectiva de ejecución:** `867a67b0a592afa6154e91ee7ef7130beab2dcca`, worktree aislado `C:/Users/Drean Skate/AppData/Local/SarinBot/fresha-p2-20261023/source`, Node 24.22.0 y Next 16.4.1 ya instalados, lockfile intacto. Se conservó la única rama remota `main` y su publicación automática. Esta reconciliación sustituye los pins históricos indicados más abajo. El reporte documenta también la excepción interna de `apiFetch` necesaria para rechazar 401/403 antes de esperar JSON.

## Global Constraints

- Node 24 y pnpm 11.23.0; conservar `pnpm-lock.yaml` sin cambios.
- Sin dependencias nuevas, migraciones, APIs nuevas ni modificaciones de reglas/almacenamiento/Worker.
- Conservar marca, tokens de diseño, `AppShell`, `AuthGate` y navegación existentes.
- Hora y fechas de Colombia (`America/Bogota`); semana de lunes a domingo.
- Lecturas existentes autorizadas por Firebase; escrituras conservan consentimiento, suscripción y autorización existentes.
- No modificar calendario/consentimientos de cliente, salud/menores, representación ni políticas de reserva.
- Sin IA, mensajes externos, suscripciones nuevas ni cambios de canal WhatsApp.
- Nunca usar `E:/Proyectos/Sarin Bot` como base ejecutable ni desplegar desde ese checkout mixto.

## Review Focus

- Cambio de Google/negocio o GET sin respuesta durante siete lecturas: ocultar el ámbito previo, rechazar resultados tardíos y terminar cada espera en 10 s; tests tarea 2.
- Reprogramación concurrente entre GET diarios: ID repetido no se elige arbitrariamente ni se representa como dos citas; tests tareas 1–2.
- Recurso retirado, margen histórico ausente o tiempo corrupto: conservar la cita sin inventar ocupación; tests tareas 1 y 3.
- Semana próxima al límite de 366 días o con un GET fallido: diferenciar fuera de rango/error/vacío; tests tareas 1–3.
- Bloqueo/cancelación del dashboard y revisión de menores con navegación: congelar controles solo para las dos primeras, y descartar respuestas de representación fuera de UID/negocio/día; tests tarea 4.

## Base de ejecución y mapa de archivos

Pin revisado `463ae55f8c873468980746185fb3e91f55cb8681`, worktree recuperado `C:/Users/Drean Skate/AppData/Local/SarinBot/whatsapp-adaptation-20261020/source-restoration`. Runtime documentado `c8bb0a99d9ac2bb20acaef2e5a157b0ff83b05f2`; delta documental. Al ejecutar, comprobar versión real autorizada y el estado de fuente/CI; no dar por vigente ese runtime sin verificarlo. Si existe una versión posterior, reconciliar sin perderla. Usar using-git-worktrees para una rama nueva desde la base efectiva; no alterar el worktree recuperado ni incorporar cambios sueltos de E:. Trasladar estos dos documentos a la rama de ejecución.

| Archivo previsto | Responsabilidad |
| --- | --- |
| Nuevo `src/lib/owner-agenda.ts` | Fechas/rango, recursos históricos, bloques, carriles, escala y duplicados; sin React/red. |
| Nuevo `src/lib/client/owner-agenda.ts` | GET diario acotado, validación de envoltura/ámbito y resultado por fecha. |
| Nuevo `src/hooks/use-owner-agenda.ts` | Un poller visible, scope, refresco y reemplazo de una cita conocida. |
| Nuevo `src/components/owner-agenda-calendar.tsx` | Controles y gráfico/resumen accesible; sin API ni escrituras. |
| Nuevo `src/components/owner-agenda-appointments.tsx` | Tarjetas actuales del día, estados y revisión de representación; callbacks hacia dashboard. |
| Modificar `src/app/dashboard/page.tsx` | Componer componentes y conservar acciones/cliente/consentimiento del propietario. |
| Nuevos `tests/owner-agenda-model.test.ts`, `tests/owner-agenda-read.test.ts`, `tests/use-owner-agenda.test.tsx`, `tests/owner-agenda-calendar.test.tsx`, `tests/owner-agenda-dashboard.test.tsx` | Casos de modelo, fallos de lectura, carrera de ámbito, UI e integración. |
| Nuevo `qa/tests/owner-agenda.md`, `docs/qa/2026-10-23-owner-agenda.md` en la rama futura | Protocolo y evidencia realmente ejecutada, sin datos privados. |

El dashboard conserva sus zonas de suscripción/QR/políticas/bloqueo; extraer solo las tarjetas que cambian. No modificar `src/lib/client/api-polling.ts`, rutas existentes o tipos persistidos salvo que aparezca un defecto bloqueante independiente y se documente aparte.

### Task 1: Modelo puro y reglas de presentación

**Files:** crear `src/lib/owner-agenda.ts`; pruebas `tests/owner-agenda-model.test.ts`.

**Interfaces producidas:**

```ts
type OwnerAgendaMode = 'day' | 'week';
type OwnerAgendaRange = { selectedDate: string; dates: string[]; queryDates: string[]; outsideDates: string[] };
type OwnerAgendaResource = { id: string; label: string; kind: 'active' | 'inactive' | 'unknown' };
type OwnerAgendaBlock = { appointmentId: string; resourceId: string; startMinute: number; serviceEndMinute: number; reservedEndMinute: number; lane: number; laneCount: number; manual: boolean };
type OwnerAgendaDay = { dateKey: string; state: 'ready'; appointments: Appointment[] } | { dateKey: string; state: 'error'; message: string } | { dateKey: string; state: 'outside' };
type OwnerAgendaSnapshot = { days: OwnerAgendaDay[]; checkedAt: number };
type OwnerAgendaDayLayout = { blocks: OwnerAgendaBlock[]; warnings: Record<string, string[]> };
agendaToday(now: number): string;
shiftAgendaDate(dateKey: string, days: number): string;
getOwnerAgendaRange(dateKey: string, mode: OwnerAgendaMode, now: number): OwnerAgendaRange | null;
getOwnerAgendaResources(resources: TenantResource[], days: OwnerAgendaDay[]): OwnerAgendaResource[];
getOwnerAgendaDayLayout(dateKey: string, appointments: Appointment[]): OwnerAgendaDayLayout;
getOwnerAgendaScale(schedule: Business['weeklySchedule'], range: OwnerAgendaRange, layouts: OwnerAgendaDayLayout[]): { startMinute: number; endMinute: number };
rejectDuplicateAgendaIds(days: OwnerAgendaDay[]): OwnerAgendaDay[];
```

Los tipos se exportan desde el mismo archivo; importar `Appointment`, `Business` y `TenantResource` del contrato existente. Los warnings fijados son «Margen no registrado», «El registro continúa fuera de este día» y «Horario no verificable». La escala/carriles solo usa bloques confirmados válidos; fechas inválidas devuelven null y no se corrigen silenciosamente.

- [ ] Escribir tests `colombiaDateIgnoresHostZone`, `mondayWeekCrossesYear`, `weekClampsQueryDatesAt366Days` y `invalidDateHasNoRange`: usar `2026-10-22T02:00:00Z` → hoy `2026-10-21`; semana de `2027-01-01` → `2026-12-28` a `2027-01-03`; máximo calculado con el mismo now.
- [ ] Escribir tests `savedBufferWinsOverCurrentCatalog`, `missingBufferDoesNotInventPreparation`, `cancelledAndUnknownStatusesDoNotOccupy`, `inactiveAndDeletedResourcesRetainHistory`, `shortOverlapHasStableLanes`, `crossMidnightAndInvalidTimeStayInList` y `duplicateIdInvalidatesEveryAffectedDay`. Ejemplo servicio 09:00–09:30 con reservado hasta 09:45: extremos 540/570/585; no se consulta catálogo para ampliarlo.
- [ ] Ejecutar `pnpm exec vitest run tests/owner-agenda-model.test.ts`; confirmar RED específico de la capacidad ausente antes del código.
- [ ] Implementar las interfaces y escala 64 px/hora utilizada después por la UI, fallback 08:00–18:00 y asignación de carriles por intervalo guardado. No truncar listas ni ocultar historia.
- [ ] Repetir el comando; todos los casos GREEN. Commit focalizado futuro `feat: model owner agenda dates and occupancy` incluyendo solo modelo/pruebas.

### Task 2: Lector de rango y hook con ámbito

**Files:** crear `src/lib/client/owner-agenda.ts`, `src/hooks/use-owner-agenda.ts`; pruebas `tests/owner-agenda-read.test.ts`, `tests/use-owner-agenda.test.tsx`.

**Consumes:** tipos/rango de tarea 1, `apiFetch<T>(path, init, expectedUid, isCurrentScope)` y `useApiPoll<T>` existentes.

**Interfaces producidas:**

```ts
readOwnerAgendaRange(input: { businessId: string; ownerUid: string; range: OwnerAgendaRange; signal: AbortSignal; isCurrentScope: () => boolean }): Promise<OwnerAgendaSnapshot>;
useOwnerAgenda(input: { businessId: string | null; ownerUid: string | null; range: OwnerAgendaRange | null; enabled: boolean }): {
  snapshot: OwnerAgendaSnapshot | null; loading: boolean; error: string | null;
  refresh: () => void; replaceAppointment: (saved: Appointment) => void;
};
```

`enabled` lo calcula el dashboard con UID dueño/configuración, sin añadir barrera de consentimiento/suscripción. `replaceAppointment` solo reemplaza un ID existente en día ready con negocio/fecha coincidentes e invalida la lectura pendiente; nunca inserta una cita de otra fecha.

- [ ] Escribir `readsAtMostSevenDatesWithTwoInFlight`, `doesNotRefetchForResourceSelection`, `oneDayFailureIsNotEmpty`, `invalidEnvelopeRejectsDay` y `foreignTenantOrDateRejectsDay`. Afirmar paths exactos `?date=`, llamadas con expectedUid y predicado, máximo simultáneo 2, sin `view=mine` ni truncado de citas.
- [ ] Escribir `unauthorizedAbortsWholeCycle`, `abortStopsQueuedDates`, `rangeSwitchMasksPreviousDuringRender`, `accountSwitchRejectsLateResponse`, `hiddenPageStopsReads`, `refreshWaitsForPendingCycle` y `replaceInvalidatesOldRepresentationRead`. Reutilizar patrón de fake timers y EventTarget de `tests/api-polling.test.ts`; no modificar el poller compartido.
- [ ] Escribir con fake timers `dailyDeadlineIsTenSeconds`, `timeoutIsPartialNotEmpty`, `sevenHungDaysFinishInFourWaves`, `scopeAbortIsGlobalNotDailyTimeout`, `unauthorizedCancelsOtherDeadlines`, `deadlineCoversPendingTokenAndJson`, `lateIgnoredAbortResultCannotPublish` y `timersAndListenersAreReleased`. Afirmar: pendiente a 9.999 ms, error diario a 10.000 ms; siete promesas que nunca resuelven terminan en cuatro tandas/40.000 ms con máximo dos workers; quedan cero timers/listeners propios. En adaptador que ignore abort, resolver/rechazar después del deadline no cambia snapshot ni produce rechazo no manejado. Ninguna prueba llama inferencia ni red real.
- [ ] Ejecutar `pnpm exec vitest run tests/owner-agenda-read.test.ts tests/use-owner-agenda.test.tsx`; registrar RED específico.
- [ ] Implementar dos workers locales compartiendo índice de fechas, un controller de ciclo enlazado al signal y controller hijo por GET. Envolver toda llamada a `apiFetch` en carrera contra deadline de 10.000 ms y aborto global; al timeout abortar hijo y marcar solo esa fecha como error. Limpiar timer/listener en `finally` y consumir rechazos/resoluciones tardíos sin publicarlos; el ciclo no espera indefinidamente a una promesa que ignore abort. Error diario conserva otros días; aborto de ámbito/visibilidad y 401/403 cancelan todo y rechazan. No iniciar fechas tras aborto global ni reintentar una fecha en el mismo ciclo. Solo publicar al terminar ambos workers; aplicar `rejectDuplicateAgendaIds` antes de devolver. checkedAt corresponde al fin del ciclo, sin promesa de snapshot atómico.
- [ ] Implementar hook con scope UID/negocio/fechas, `intervalMs: 15000`, `abortOnBlur: true`, `waitForPending: true`, `clearOnError: true`. El predicado compara identidad de la generación en ref; scope nulo oculta y no lee. Esperar cierre del ciclo invalidado antes de otro: siete fechas tienen como máximo cuatro tandas/40 s de espera, más planificación del navegador; el polling espera otros 15 s después del cierre. No afirmar deadline de tiempo real ni ausencia física de promesas no cooperativas: estas quedan descartadas y con signal abortado. Sin caché persistente ni peticiones por filtro.
- [ ] Repetir los dos archivos más `tests/api-polling.test.ts`; GREEN. Commit futuro `feat: load bounded owner agenda ranges`.

### Task 3: Componentes visuales y tarjetas accesibles

**Files:** crear `src/components/owner-agenda-calendar.tsx`, `src/components/owner-agenda-appointments.tsx`; pruebas `tests/owner-agenda-calendar.test.tsx`.

**Consumes:** modelo/rango/snapshot tarea 1 y tipos existentes.

**Interfaces producidas:**

```ts
type OwnerAgendaCalendarProps = {
  business: Business; mode: OwnerAgendaMode; selectedDate: string; resourceId: string | null;
  range: OwnerAgendaRange | null; snapshot: OwnerAgendaSnapshot | null; loading: boolean; error: string | null; busy: boolean;
  onModeChange: (mode: OwnerAgendaMode) => void; onDateChange: (dateKey: string) => void;
  onResourceChange: (resourceId: string | null) => void; onRefresh: () => void;
};
type OwnerAgendaAppointmentsProps = {
  business: Business; dateKey: string; day: OwnerAgendaDay | null; resourceId: string | null; saving: boolean;
  onCancel: (appointmentId: string) => void; onSaved: (saved: Appointment) => void;
};
```

Exportar `OwnerAgendaCalendar` y `OwnerAgendaAppointments` con esos props. `resourceId: null` significa Todos solo en Día. El padre resuelve la selección de Semana; la UI no dispara mutaciones. El listado tiene heading `id="owner-agenda-day-details"` y `tabIndex={-1}`; cabecera diaria selecciona fecha y mueve foco allí después del render. Si no está cargado, el heading permanece para recibir foco y describir error/carga.

- [ ] Escribir `dayAndWeekControlsExposePressedState`, `weekShowsExactlyOneResourceAndSevenDays`, `partialDayHasErrorNotZero`, `outsideDayDoesNotClaimEmpty`, `inactiveUnknownAndLongNamesAreVisible`, `bufferUsesDifferentLegend`, `cancelledRowsRetainStatusWithoutChartBlock`, `smallEventsHaveFullListDetails` y `noHealthOrContactDataInDecorativeChart`.
- [ ] Escribir `primaryControlsStayTogether`, `helpAndAppointmentDetailsAreInitiallyCollapsed`, `appointmentActionsRemainInsideTheirDetails` y `skipChartTargetsDayList`: el primer resumen contiene hora/servicio/recurso/estado; contacto, revisión y cancelación se abren con detalle nativo. Las tres orientaciones breves de la spec aparecen junto a su contexto sin panel adicional ni configuración avanzada.
- [ ] Afirmar que los únicos callbacks de tarjetas son cancelación y revisión existentes; no aparecen controles de mover, completar, ausencia o reserva sobre celdas. Usar spy del componente `RepresentationReviewControls` para comprobar businessId/appointment/onSaved preservados, sin aceptar permisos.
- [ ] Ejecutar `pnpm exec vitest run tests/owner-agenda-calendar.test.tsx`; RED.
- [ ] Implementar gráfico decorativo, cabeceras accesibles, scrollbar local, min 180 px/columna, eje 48 px, 64 px/hora, altura máxima 420 px móvil/640 px escritorio y listado con resúmenes compactos y detalles nativos. Mantener textos/estados/beneficiario/revisión actuales; fallback explícito para estado desconocido. Texto fijo sobre no garantizar disponibilidad; leyenda ampliada cerrada inicialmente. Tokens Sarin, controles 44 px, sin role grid ni interacciones ocultas en aria-hidden. Separar controles primarios de la fila secundaria y añadir salto a citas del día.
- [ ] Repetir tests; GREEN. Commit futuro `feat: present owner agenda day and week views`.

### Task 4: Integración en el dashboard y acciones conservadas

**Files:** modificar `src/app/dashboard/page.tsx`; crear `tests/owner-agenda-dashboard.test.tsx`.

**Consumes:** hook tarea 2 y componentes tarea 3. El dashboard conserva propiedad de modo/fecha/recurso, reloj, acciones POST/PATCH y formulario de bloqueo; no crea otra ruta de escritura.

- [ ] Escribir `defaultsToColombiaDayAllResources`, `weekSelectsFirstActiveOrHistoricalResource`, `navigationPreservesSelectedWeekday`, `blockUsesSelectedTuesdayNotMonday`, `filterDoesNotChangePolicyClientPopulation`, `dashboardBlockAndCancelFreezeViewControls`, `cancelRefreshesRangeWithoutChangingPayload`, `scopeChangeAbortsDashboardMutationAndMasksDetails` y `representationSaveReplacesKnownRow`. Verificar cuerpos existentes y que recursos inactivos/desconocidos no entran al selector del bloqueo.
- [ ] Con `RepresentationReviewControls` real y API sintética retrasada, escribir `representationKeepsLocalBusyWithoutFreezingAgenda`, `representationLateResultAfterDaySwitchIsIgnored`, `representationLateResultAfterAccountOrBusinessSwitchIsIgnored` y `currentRepresentationSaveInvalidatesEarlierRead`. El key del listado incluye UID/negocio/día; `onSaved` captura además ID y compara ámbito vigente antes de llamar `replaceAppointment`. Una respuesta de escritura fuera de contexto no aparece en la nueva fecha ni se traslada a otro negocio. No añadir `onBusy` ni modificar API del componente; no prometer abortar/deshacer una revisión que ya pudo persistir.
- [ ] Añadir `expiredSubscriptionStillReadsHistory`, `missingAccountConsentDoesNotEnableBlock` y `ownerCancellationPreservesExistingAuthority`: no convertir las barreras de nueva reserva en bloqueo de lectura/cancelación del dueño. Mockear Auth/useBusiness/consent y API como los tests vecinos; no usar Firebase productivo.
- [ ] Ejecutar `pnpm exec vitest run tests/owner-agenda-dashboard.test.tsx`; RED.
- [ ] Sustituir poller diario y tarjetas inline por hook/componentes. Derivar `appointments` para políticas del día completo ready, aunque haya filtro visual. En errores no dar al panel de políticas una falsa lista vacía como si estuviera cargada: mantenerlo oculto con explicación hasta tener día ready. Mantener el área de suscripción/QR y consentimiento actual.
- [ ] Conservar POST/PATCH, añadir expectedUid/predicado de ámbito a esas llamadas y mantener abort/anti-doble envío. Deshabilitar navegación/filtros durante `saving` de crear bloqueo/cancelar; éxito refresca rango, fallo muestra error sin reenvío automático. La fecha vacía no lee ni envía bloqueo. Preservar bloqueo/generación locales de representación y aplicar el wrapper de ámbito descrito antes de `replaceAppointment`; no extender congelación global a representación/políticas de cliente.
- [ ] Ejecutar `pnpm exec vitest run tests/owner-agenda-model.test.ts tests/owner-agenda-read.test.ts tests/use-owner-agenda.test.tsx tests/owner-agenda-calendar.test.tsx tests/owner-agenda-dashboard.test.tsx tests/use-business.test.tsx tests/api-polling.test.ts tests/business-read-routes.test.ts tests/bookings.test.ts tests/client-appointments.test.tsx tests/representation-review.test.tsx tests/representation-review.test.ts tests/representation-review-route.test.ts`.
- [ ] Confirmar GREEN y `pnpm run typecheck` exit 0. Commit futuro `feat: integrate visual owner agenda with existing controls`.

### Task 5: Verificación final, evidencia y preparación de publicación

**Files:** crear protocolo `qa/tests/owner-agenda.md` y reporte `docs/qa/2026-10-23-owner-agenda.md` en la rama futura. No atribuir resultados antes de ejecutarlos.

- [ ] Ejecutar `pnpm exec vitest run tests/owner-agenda-model.test.ts tests/owner-agenda-read.test.ts tests/use-owner-agenda.test.tsx tests/owner-agenda-calendar.test.tsx tests/owner-agenda-dashboard.test.tsx`; todas GREEN. Ejecutar una suite general `pnpm test` y `pnpm run typecheck`; registrar aprobadas/fallos/omitidas reales, sin sumar ejecuciones solapadas.
- [ ] Ejecutar `pnpm run build` en copia física de la fuente exacta si el worktree mantiene dependencias enlazadas que impiden el build de Next. Usar configuración pública y procedimiento de build de la base efectiva, sin copiar secretos ni arrancar procesos contra producción. Si falla por entorno, conservar fallo y corregir el entorno; no afirmar build aprobado por haber pasado tipos.
- [ ] Abrir entorno sintético con `pnpm run dev:local --port 3042` (Node 24, Java 21+, puertos locales 8080/9099/4400/4500 libres; solo `demo-sarin-bot`). Preparar fixture local con dos recursos activos, uno inactivo con cita, un ID eliminado, horario partido, cancelada, bloqueos, buffer de 15 min, cita de 5 min, solapamiento y beneficiario sintético de menor. No leer ni sembrar datos reales.
- [ ] Comprobar en navegador 320/390/1280 px y zoom 200 %: día/semana, scrollbar local sin desbordamiento de página, teclado/foco, nombres largos, lista completa, leyendas y no confundir preparación con duración. Verificar controles primarios juntos, ayuda cerrada inicialmente, detalle progresivo sin contacto repetido por toda la pantalla, salto al listado y resultado de acciones junto a su contexto. Verificar día cerrado con historia, día vacío correcto y recurso sin citas.
- [ ] Inyectar solo en entorno local un GET diario fallido y una respuesta tardía; comprobar Semana incompleta sin cero falso, cambio de cuenta sin datos antiguos y refresco visible/oculto. Las pruebas de carreras de siete GET permanecen automatizadas, no atribuirlas al navegador si no se observaron allí.
- [ ] Medir un ciclo real del fixture local de siete días: número de GET (máximo siete), máximo de solicitudes simultáneas (dos), duración total y duraciones diarias. Registrar resultado y contexto, sin extrapolar capacidad productiva. El caso de siete timeouts y cierre a 40 s se verifica con timers simulados de tarea 2; no esperar 40 s ni llamar producción para repetirlo. Si la medición muestra coste/latencia impropios, registrar el hallazgo antes de proponer otro contrato; no ocultarlo como semana vacía.
- [ ] En fixture local, bloquear el martes seleccionado, cancelar ese bloqueo y registrar revisión de representación; comprobar API/fecha/ID, mismas reglas y actualización visual. No iniciar inferencia, aceptar permisos reales ni enviar mensajes. Registrar limpieza por inventario/UID de fixture, cerrar únicamente procesos y pestañas propias.
- [ ] Revisar diff/rutas para confirmar que solo hay UI/modelo/lector/hook/tests/docs previstos; no cambios de dependencias, rutas, persistencia, cliente ni Worker. Revisión independiente del branch completo centrada en los cinco Review Focus. No ejecutar check/rollout de Worker sin cambios de Worker por rutina; la publicación futura usará los gates vigentes de release.
- [ ] Reconciliar con runtime/configuración autorizada inmediatamente antes de publicar. La autorización del titular para probar/publicar existe, pero este plan no ejecuta publicación: preparar artefacto exacto, evidencia, mecanismo de mantenimiento/rollout/reversión vigente y una instancia única antes de actuar en la fase futura. Sin migración: rollback de aplicación conserva todos los datos; los cambios de cancelación/bloqueo hechos por usuarios no se revierten al revertir código.
- [ ] Documentar capturas saneadas, comandos y resultados reales, pin de fuente/runtime y límites. Commit futuro `docs: verify owner agenda day and week views`.

## Autorrevisión del plan

- Cobertura: tareas 1–2 resuelven tiempo/historia/lectura; 3 presenta y conserva detalle; 4 integra permisos/acciones; 5 verifica UI y prepara evidencia.
- Contratos: tipos y nombres de tareas posteriores coinciden con sus Interfaces; null de recurso solo significa Todos en Día, no una estación inexistente.
- Fallos críticos: ID repetido entre días, GET fallido/colgado con deadline, máximo de fecha, cambio de cuenta y revisión de menores fuera de ámbito tienen pruebas asignadas. Congelación global limitada a bloqueo/cancelación del dashboard; revisión conserva API/busy internos. El gráfico no anuncia disponibilidad ni oculta registros fuera de catálogo.
- Proporción: no incorpora backend semanal, nueva biblioteca, estados operativos o reprogramación del dueño. Esos cambios requieren otro incremento.
- Estado histórico del 22 de octubre: diseño y plan escritos; en esa fecha no se presentaba implementación, prueba ni publicación como ejecutada. El resultado posterior se registra en [la evidencia del 23 de octubre](../../qa/2026-10-23-owner-agenda.md).
