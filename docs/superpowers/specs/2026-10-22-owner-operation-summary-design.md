# Resumen operativo mínimo del dueño — diseño S17

Preparado el 22 de octubre de 2026 por delegación expresa del titular. Entrega documental para revisión; sin producto, pruebas, instalación o publicación ejecutados. Objetivo: conocer cuántas citas conservan cada estado en un periodo y cuáles terminaron sin resultado registrado, con fecha/cobertura explícitas. No perseguir paridad de todos los informes de Fresha.

## Base y alcance

Fuente efectiva leída: `C:/Users/Drean Skate/AppData/Local/SarinBot/whatsapp-adaptation-20261020/source-restoration`, HEAD limpio `463ae55f8c873468980746185fb3e91f55cb8681`; runtime conservado `c8bb0a9`, sin consulta remota nueva. `E:/Proyectos/Sarin Bot` es entrega documental mixta, no base ejecutable. Reconciliar versión real antes de crear aislamiento y ejecutar.

Código de referencia relativo a la fuente efectiva:

- `src/types/firestore.ts`, Appointment: fecha, tipo, cinco estados y tiempos guardados; precio no registra dinero recibido.
- `src/lib/server/bookings.ts:22–29`: GET diario devuelve documentos; no produce resumen de rango ni denominadores globales.
- `src/app/api/businesses/[id]/appointments/route.ts`: lectura propia view=mine no sirve como informe de todas las citas del negocio para el dueño.
- `src/lib/storage/types.ts`, `database.ts:119–174`: lectura transaccional y revisión coherente del adaptador; no usar SQL directo ni SDK específico.
- `cloudflare/src/data.ts:5–17,50–65,128–159`: límites de documentos/lectura, campos dateKey/type/tenantId/status existentes y rechazo ante sobrecapacidad.
- `shared/data-protocol.ts:15–25`, `cloudflare/migrations/0001_data.sql`: colección de citas e índices genéricos ya disponibles; este incremento no agrega persistencia/SQL.
- `src/lib/client/api.ts`: apiFetch no valida JSON por su genérico; el cliente debe validar DTO antes de mostrarlo.

Depende de [agenda](2026-10-22-owner-agenda-design.md), [resultados operativos](2026-10-22-owner-attendance-and-client-record-design.md) y navegación del dueño ya compuestas/verificadas. **No depende de CRM, turnos/cierres o reprogramación del dueño**: no calcula personas, ocupación o disponibilidad. No consulta eventos privados de asistencia; observa el estado actual, también el legado. La implementación de resultados aporta escrituras futuras fiables, pero no sanea registros anteriores.

La [referencia funcional de clientes/informes](../../qa/2026-10-22-fresha-client-and-report-rules.md) conserva las fuentes oficiales de Fresha: Completed puede seguir impagado; rango de clientes no siempre filtra citas; rebooked no es visita completada; ocupación tiene reglas de turnos específicas. Aquí **no se traslada ninguna de esas fórmulas** a datos que Sarin todavía no mide.

## Alternativas y decisión

1. **Elegida: endpoint dueño de lectura agregada por rango en una transacción.** Devuelve números mínimos, sin transferir contactos/precios al informe y con límite explícito. Tiene un contrato pequeño nuevo, sin escrituras.
2. Sumar los GET diarios de agenda en cliente: reutiliza API, pero varias lecturas pueden ver una reprogramación en ambos días o en ninguno; transporta información innecesaria y mezcla fallos parciales con cero. Descartada.
3. Contadores persistentes/materializados: exigen backfill, actualizar cada mutación/corrección/replay y reconciliación. Pospuestos; no se crean para una primera pantalla.

## Diccionario exacto y cobertura

Periodo **inclusivo por dateKey guardado de la cita**, en Colombia. De1 a31 días; desde hoy−365 días hasta hoy, sin fechas futuras. La vista inicial muestra últimos7 días, incluido hoy; accesos Hoy/7 días/30 días y personalizado. Este rango sirve a operación retrospectiva; agenda conserva programación futura. No usar createdAt, fecha de pago ni fecha en que se registró/corrigió el resultado.

Cada documento de tipo appointment clasificable cuenta una vez, sin deduplicar personas, servicios, familiares o nombres. Una reserva reprogramada se cuenta en su **fecha actual**; cambiar estado o fecha puede modificar un informe pasado al actualizarlo. No es una fotografía histórica, libro financiero ni historial de eventos.

| Campo | Regla |
| --- | --- |
| total | Suma exacta de confirmed + completed + noShow + cancelledByClient + cancelledByOwner clasificables. |
| confirmed | Estado actual confirmed; incluye citas de hoy aún futuras y antiguas sin resultado. No significa que fueron atendidas. |
| completed | Estado actual completed. UI: **Marcadas atendidas**; no «cobradas», venta ni resultado clínico. Incluye resultados legados sin auditoría. |
| noShow | Estado actual no_show. UI: **Marcadas como ausencia**. No sanciona ni altera clientPolicies. |
| cancelledByClient / cancelledByOwner | Estado actual correspondiente. UI principal puede sumar Canceladas y desplegar desglose. No infiere motivo o falta de pago. |
| awaitingOutcome | Subconjunto de confirmed con tiempos verificables cuyo reservedUntilAt ≤ serverNow. UI: **Terminaron sin resultado registrado**; no lo suma otra vez a total. |
| confirmedEndUnverifiable | Confirmadas cuyos tiempos no permiten decidir ese último subconjunto; no se clasifican automáticamente como terminadas. |

Para awaitingOutcome exigir enteros seguros positivos `startAt < endAt <= reservedUntilAt` y fecha colombiana de startAt igual a dateKey, como resultados de atención. No reconstruir buffer con catálogo actual ni usar hora del navegador. Una cita con tiempos no verificables sigue contándose por estado si el resto del registro es clasificable; coverage informa el límite de su final.

Clasificable exige docID válido, tenantId exacto, type appointment, dateKey válido en rango y uno de los cinco estados. Si el campo id está ausente, usar docID como identidad técnica; si existe y difiere o es inválido, excluir como registro no clasificable. No examinar client/intake/beneficiary/precio para contar. Orden de validación: primero objeto, identidad/tenant/fecha; después tipo. Solo un manual_block con esos campos básicos válidos aumenta excludedManualBlocks, nunca atención; manual_block con ID/fecha/tenant corruptos aumenta invalidRecords. Campos básicos corruptos, ámbito cruzado, tipo/estado desconocido se excluyen y elevan invalidRecords. No mostrar su cuerpo ni ID.

**Límite histórico permanente:** una consulta por índice dateKey no encuentra documentos que carecen de esa clave o de su tipo correcto. Por tanto incluso con invalidRecords=0, no se declara inventario completo del pasado. Aviso visible: **«Cuenta los registros consultables por fecha de cita. Los registros antiguos sin fecha válida pueden no aparecer. Muestra el estado actual, no un historial de cambios»**. No hay backfill ni estimación de cuántos faltan. La advertencia no desaparece por consulta vacía o porque todas las citas nuevas sean correctas.

Si invalidRecords>0 mostrar **«Hay N registros que no pudimos clasificar; los recuentos son parciales»**. Si todas las filas recuperadas son inválidas, mostrar ese estado y cero clasificables, nunca «No tienes citas». Si no hay clasificables y no hubo filas inválidas: **«No hay citas clasificables en los registros consultados para este periodo»**. confirmedEndUnverifiable>0 añade aviso específico, sin inventar ausencia o atención.

No hay dinero, precio total, tickets promedio, porcentajes de cancelación/ausencia, retención/rebooking, clientes únicos, última visita, ocupación, horas trabajadas, duración real, ranking de recursos o evaluación de personal. Esto evita fijar denominadores o medidas ausentes. Esas métricas requerirán otro diseño/diccionario y evidencia.

## Contrato de lectura y límites

Nuevo `GET /api/businesses/:id/operation-summary?from=YYYY-MM-DD&through=YYYY-MM-DD`. Node/force-dynamic/no-store, requireUser y dueño vigente. Superadmin no tiene bypass. No requiere plan ni nuevo consentimiento para leer su operación histórica; no escribe ni llama IA. Solo parámetros from/through únicos, obligatorios y válidos; rechazar otros parámetros, cuerpo inesperado y rango fuera de límites con400. Endpoint no admite UID de cliente, recurso, teléfono, búsqueda libre, exportación ni paginación.

En una transacción leer Business por ID, verificar dueño y consultar su subcolección appointments con `where('dateKey','>=',from).where('dateKey','<=',through).orderBy('dateKey','asc').limit(1000)`. **Si devuelve1000 filas o más, responder413 OPERATION_SUMMARY_RANGE_TOO_LARGE**, sin números parciales. Éxito admite máximo999 documentos recuperados, incluidos bloqueos/inválidos; la cota es conservadora incluso cuando exactamente1000 fueran todo el rango. Nunca sumar un resultado truncado ni paginar cortes sin snapshot. Si el adaptador falla antes por bytes/capacidad/índice, conservar error explícito, no cero. No editar MAX_READ, query global, índices o storage compartido para ocultar el límite.

La lectura transaccional mantiene negocio y rango coherentes según Database/Firestore; no se presenta como snapshot duradero entre refrescos. Capturar serverNow dentro del intento final, después de obtener filas. Inicializar cada día solicitado con cero solo después de leer satisfactoriamente la consulta completa bajo ese límite. Calcular counters con datos de esa lectura y sin otras consultas a perfiles/eventos. El rango y ownerUid de respuesta deben coincidir con solicitud/usuario. No devolver citas individuales ni etiquetas/IDs de recursos.

DTO y helpers puros en `src/lib/owner-operation-summary.ts`:

```ts
type OperationRange = { from: string; through: string };
type OperationCounts = {
  total: number; confirmed: number; completed: number; noShow: number;
  cancelledByClient: number; cancelledByOwner: number;
  awaitingOutcome: number; confirmedEndUnverifiable: number;
};
type OperationCoverage = {
  basis: 'stored_date_key'; invalidRecords: number; excludedManualBlocks: number;
};
type OwnerOperationSummary = {
  businessId: string; ownerUid: string; range: OperationRange;
  timezone: 'America/Bogota'; serverNow: number;
  totals: OperationCounts; days: { dateKey: string; counts: OperationCounts }[];
  coverage: OperationCoverage;
};
parseOperationRange(input: { from: string; through: string }, now: number): OperationRange;
operationPresetRange(preset: 'today' | '7days' | '30days', now: number): OperationRange;
summarizeOwnerOperation(input: {
  businessId: string; ownerUid: string; range: OperationRange; serverNow: number;
  records: { id: string; data: unknown }[];
}): OwnerOperationSummary;
```

Schema de DTO estricto compartido `ownerOperationSummarySchema`: contadores enteros seguros0–999; serverNow es timestamp positivo seguro representable por Date, sin esa cota de contador. Días exactamente todos los del rango, ordenados y sin duplicar; totales suman días, suma de cinco estados=total, awaitingOutcome+confirmedEndUnverifiable≤confirmed, cobertura/fecha/identidad/formato exactos. El cálculo vuelve a validar rango con serverNow; excepción conocida de límite es413, nunca normalizar fechas imposibles. Schema no necesita importar servidor. Reusar helpers de fecha/hora actuales de availability; si S09 ya extrajo calendar-time, usar su reexport compatible, sin crear otro archivo de tiempo.

Servidor `src/lib/server/owner-operation-summary.ts` exporta `readOwnerOperationSummary(user: ChatActor, businessId: string, range: OperationRange, db: Database = getAdminDb()): Promise<OwnerOperationSummary>`. Valida ID y rango después de requireUser y dentro del intento usa reloj servidor; errores401/403/404 existentes. Registro no clasificable es coverage; consulta no completada/owner no verificado es error global. No devolver números antiguos junto a un mensaje de fallo.

## UI y ámbito

Nueva ruta dueña `/dashboard/reports`, acceso secundario **Resumen operativo** desde Mi agenda. AppShell usa `businessNavigationPath='/dashboard'` y conserva los cuatro destinos principales Mi agenda/Mi negocio/Enlace y QR/Suscripción; no añade Informes al menú principal. Una pantalla con periodo y **Consultar** juntos; consulta inicial7 días solo tras auth/negocio candidato, cuya autorización real confirma endpoint. El selector personalizado permite editar fechas sin disparar solicitud por cada tecla. Botón Hoy/7 días/30 días fija y consulta rango explícito; no cambia timezone local. Mostrar periodo aplicado y **Consultado a las …, Colombia** desde serverNow; no llamar tiempo real a esta lectura.

Primera vista: total clasificable y tres resultados destacados (marcadas atendidas, marcadas ausencia, canceladas). Confirmadas y terminaron sin resultado se explican debajo, aclarando subconjunto. Desglose de cancelaciones y tabla diaria están en details cerrados. No gráficas que aparenten tasa de ocupación ni seis paneles de configuración. Mantener advertencia de cobertura junto al resumen, visible sin desplegar ayuda; las definiciones ampliadas sí son plegables. Acceso «Ver agenda» navega a `/dashboard` sin prometer deep-link diario no contratado. No habilitar registrar resultado desde el informe.

Hook `useOwnerOperationSummary` sin polling periódico: leer al entrar y por consulta/actualizar explícitos, un GET en vuelo. Al recibir DTO válido del ámbito actual, conservar ancla `{serverNow, receivedMono:performance.now()}`; un preset posterior usa `serverNow + (performance.now() - receivedMono)`, no serverNow congelado ni reloj de pared alterado. Antes del primer resultado válido puede usar Date.now solo como propuesta que servidor valida. `queryPreset` obtiene ese ahora derivado y usa operationPresetRange; el timestamp mostrado de la consulta sigue siendo el serverNow fijo del snapshot. Al cambiar ámbito se elimina ancla. Una página abierta al cruzar medianoche Colombia debe proponer el día nuevo, incluso si Date.now local cambió. El servidor sigue siendo autoridad y revalida rango/reloj en cada petición; no se promete sincronización exacta de latencia de red.

GET deadline10s con childAbort+race acotada, cleanup y rechazo tardío consumido. Cambio rango/UID/época/negocio oculta datos durante render, aborta/invalida generación y nunca acepta respuesta antigua. Usar apiFetch con expectedUid e isCurrentScope; validar DTO y rango aplicado antes de mostrar. Error red/503/timeout/413 ⇒ sin tarjetas viejas/ceros fingidos; botón reintentar mismo rango, o reducir rango en413. 401/403/dueño ajeno revoca el ámbito y oculta números; no confiar en useBusiness cacheado. Reingresar realiza lectura nueva. Borrador de fechas solo en memoria de ruta, sin URL ni storage privado.

Los GET no mutan ni requieren congelar agenda/configuración/asistencia de otras rutas. Al salir se desmonta vista y cesan anuncios; sin diálogos portaled. Reporte puede quedar desactualizado si otro módulo corrige una cita: timestamp y Actualizar son el contrato, no un bus global nuevo. Labels/fieldsets/errores asociados, loading/status accesibles, foco al resumen tras consulta explícita y al error si falla; sin mover foco por render inicial. Móvil320–390px, tabla con encabezados y scroll local si hace falta, zoom200%, sin ocupar todo con ayuda.

## Validación, rollback y límites

Fixture sintético en2030-01-07/08: una cita por estado, bloqueo manual, confirmed con margen terminado, confirmed de hoy aún futura, confirmed sin margen verificable y una fila corrupta. Probar suma por día/total, límites Colombia y clock de servidor; count no depende de precio, personas o cantidad de beneficiarios. Legado sin dateKey no aparece y sigue advertencia. Corrección completed→no_show cambia ambos contadores al refrescar, no genera otro documento/cobro.

Probar999 recuperados exitosos;1000→413 incluso con bloqueos; response perdida/red/índice no muestra cero. Dos handles D1 y barrera de transporte verifican reintento de lectura coherente ante cambio de fecha/estado, sin doble conteo de una cita entre dos consultas diarias porque se usa una sola query de rango. Ningún GET modifica app_documents, app_revision, cuotas, citas, eventos, recordatorios o WhatsApp. No backfill ni exports privados.

Sin persistencia/migraciones/allowlist nuevos: rollback de UI/API no cambia resultados ya guardados. Antes de publicar comprobar fuente/runtime y gates de release en rama aislada; no ejecutar desde E:. El plan se compone después de resultados operativos, sin esperar CRM/S09 y sin deshacerlos si ya están integrados.

Autorrevisión: se eligieron conteos de estados, no mediciones de asistencia o dinero inferidas; diccionario/rango/capacidad/cobertura y falla global están cerrados. Se separa error de consulta de fila no clasificable; no se promete detectar documentos que el índice no devuelve. Se evita depender de historial de personas o de cuotas/turnos que este informe no utiliza. No se atribuye verificación ejecutada a esta documentación.
