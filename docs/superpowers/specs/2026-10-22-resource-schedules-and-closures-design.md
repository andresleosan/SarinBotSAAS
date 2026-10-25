# Horarios por recurso, excepciones y cierres — diseño S09

Preparado el 22 de octubre de 2026. Estado al24 de octubre: implementado y revisado en la rama `codex/resource-schedules-20261024`; integración y publicación S09 pendientes. [Validación y límites observados](../../qa/2026-10-24-resource-schedules.md). El titular delegó decisiones y pidió conservar la administración de Fresha y dejar los incrementos listos para implementar. La entrega documental inicial no inició ejecución; el titular autorizó la implementación posterior el24 de octubre.

## Propósito y base efectiva

El dueño debe indicar qué jornadas trabaja cada recurso y cerrar fechas sin editar una semana común para todos. La interfaz enseña una tarea cada vez; no copia literalmente Fresha ni mezcla turnos con nómina. Éxito: toda disponibilidad nueva respeta apertura, jornada individual, excepción, cierre, servicio, buffer y reservas; una cita existente nunca se mueve o cancela al editar horarios.

Base leída en modo solo lectura: `C:/Users/Drean Skate/AppData/Local/SarinBot/whatsapp-adaptation-20261020/source-restoration`, HEAD limpio `463ae55f8c873468980746185fb3e91f55cb8681`. La evidencia runtime anterior identifica `c8bb0a9`; no se consultó producción en este encargo. `E:/Proyectos/Sarin Bot` es entrega documental mixta, no fuente de ejecución. Antes de implementar: reconciliar runtime/CI y crear aislamiento desde la fuente efectiva, preservando trabajo ajeno.

Fuentes de código relativas a ese worktree:

- `src/types/firestore.ts:62–80,114–116`: recurso sin horario propio y `DaySchedule`; `Appointment.endAt` separa fin de servicio de `reservedUntilAt`.
- `src/lib/sarin/availability.ts:29–89`: horario semanal común, intervalos y paso de 15 minutos; recurso activo/asignado, citas confirmadas y buffer completo dentro del intervalo.
- `src/lib/server/schemas.ts:14–23`: intervalos HH:mm, máximo cinco por día, sin solapamiento; semana completa 0–6.
- `src/lib/server/bookings.ts:50–106`: reserva transaccional, locks recurso/día y cliente; `110–137`: bloqueo manual, futuro y sin colisión, sin exigir turno.
- `src/lib/server/appointment-rescheduling.ts:60–76,82–114`: lectura y movimiento con transacción y locks de origen/destino.
- `src/lib/server/booking-proposals.ts:88–94`, `structured-booking.ts:32–67`, `waitlist.ts:124,163`: otras entradas al mismo cálculo que también deben incorporar la política.
- `src/lib/server/businesses.ts:89–120`: configuración agregada ya modifica proyección pública; no existe SaveDraft/Publish ni CAS agregado.
- `src/lib/storage/database.ts:119–174`: transacciones con revisión; `shared/data-protocol.ts:15–25`: allowlist explícita de colecciones hijas. `cloudflare/migrations/0001_data.sql` ya almacena documentos JSON.

Se compone después de [agenda](2026-10-22-owner-agenda-design.md), [configuración guiada](2026-10-22-owner-guided-configuration-design.md) y [resultados operativos](2026-10-22-owner-attendance-and-client-record-design.md). La futura reprogramación del dueño consumirá este contrato, sin duplicar reglas. Referencia funcional Fresha: [B06](../../qa/2026-10-22-fresha-admin-business-rules.md); cierre prevalece y conserva citas, turno recurrente y excepción de un día. Son decisiones Sarin los límites técnicos siguientes.

## Enfoques y decisión

1. **Política independiente con intersección**, elegida: no cambia el POST de configuración, conserva clientes antiguos y proporciona revisión/CAS propio. Añade lecturas y un contrato de servidor delimitado.
2. Campos dentro de cada recurso del Business: menos lecturas, pero el formulario agregado y clientes antiguos podrían borrar horarios nuevos; amplía propuestas/asistente y acopla dos guardados.
3. Expandir turnos a bloqueos diarios: reutiliza citas, pero exige materialización/reconciliación, muchos documentos y distinguir excepciones futuras de bloques manuales. Se descarta para este incremento.

El horario común continúa como **límite superior** de apertura. No se transforma en un mero texto público ni permite reserva fuera de horario por ser dueño. Heredar sigue siendo el valor inicial sin escribir migraciones de datos. No se crea entidad empleado, sede, vacaciones laborales, fichaje, nómina ni optimizador.

## Modelo y reglas exactas

Crear `src/lib/resource-schedules.ts`, apto para cliente y servidor, sin Node/Firebase/red. Para evitar ciclo availability→resource-schedules→availability, extraer las funciones existentes isDateKey/isTimeString/toMinutes/toTimeStr/toColombiaTimestamp a `src/lib/sarin/calendar-time.ts` y reexportarlas desde availability para conservar imports actuales. El módulo nuevo de política importa esas funciones desde calendar-time y usa schemas Zod propios de sus datos, sin importar schemas del servidor. RequestId del comando HTTP reutiliza el validador servidor existente; los IDs de recursos/cierres mantienen la misma expresión y límites, rechazando además segmentos reservados del storage. Exportar estos tipos, importando `Business`, `DaySchedule` y `TenantResource` existentes:

```ts
type ScheduleInterval = { start: string; end: string };
type ResourceWeeklySchedule = { resourceId: string; weeklySchedule: Business['weeklySchedule'] };
type ResourceDateSchedule = { resourceId: string; dateKey: string; day: DaySchedule };
type ScheduleClosure = {
  id: string; scope: 'business' | 'resource'; resourceId?: string;
  fromDateKey: string; throughDateKey: string; interval: ScheduleInterval | null;
  label: string;
};
type ResourceScheduleRules = {
  weekly: ResourceWeeklySchedule[]; exceptions: ResourceDateSchedule[]; closures: ScheduleClosure[];
};
type ResourceSchedulePolicy = {
  version: 1; businessId: string; revision: number;
  rules: ResourceScheduleRules; updatedAt: number | null;
};
type ResourceScheduleBasis = { weeklySchedule: Business['weeklySchedule']; resources: TenantResource[] };
resolveResourceDaySchedule(input: {
  business: Pick<Business, 'weeklySchedule'>; policy: ResourceSchedulePolicy;
  resourceId: string; dateKey: string;
}): DaySchedule;
```

`scope='business'` prohíbe resourceId; `scope='resource'` lo exige. La validación expresa esta unión, aunque el tipo anterior muestra la forma común. Intervalos son HH:mm del día colombiano, positivos, ordenados, no solapados, máximo cinco; no se admiten cruces de medianoche ni `24:00`. Un día cerrado requiere intervals vacío. Semana propia contiene los siete días 0–6. IDs, fechas y requestId reutilizan validadores existentes. Máximo 30 semanas propias, 120 excepciones y 120 cierres; label 0–120 caracteres, genérico, sin contactos, salud ni motivo privado. Sin nuevo campo de texto en citas.

Reglas por recurso/fecha, en este orden:

1. Obtener día del horario común en Colombia. Falta/día cerrado ⇒ cerrado.
2. Obtener día de semana propia; si el recurso no tiene entrada, hereda el común. Una semana propia cerrada no hereda apertura.
3. Si hay excepción exacta recurso+fecha, reemplaza ese día individual completo. No añade intervalos a su semana ni modifica el común.
4. Intersectar jornada individual/excepción con cada intervalo común. Una excepción no puede abrir un negocio cerrado. Mostrar la porción fuera de apertura como advertencia; no publicar un hueco fuera de ella.
5. Restar la unión de cierres aplicables globales o del recurso. El cierre prevalece siempre, también sobre una excepción abierta. `interval:null` cierra el día entero. Un cierre con rango aplica el mismo intervalo **cada día**, desde/hasta inclusivos; la UI lo dice expresamente. No son un único intervalo que atraviesa noches.

Canonicalizar orden de semanas por resourceId, excepciones por resourceId/fecha, cierres por id e intervalos por inicio. Rechazar claves duplicadas, IDs de cierre repetidos, intervalos vacíos abiertos, fechas normalizadas inválidas y solapamientos dentro de una jornada. Los cierres pueden coincidir: restar su unión, sin duplicar minutos. Conservar límites separados de intervalos comunes adyacentes; no unirlos para permitir una cita que antes no cabía.

El máximo de cinco intervalos aplica **solo a jornadas de entrada**, no al resultado efectivo de intersección/resta. Resolver puede producir más fragmentos, acotados por entradas/cierres válidos; conservarlos todos, sin truncar ni pasarlos por un daySchema de entrada con max(5). Ejemplo: común09:00–18:00 y seis cierres pequeños disjuntos produce siete segmentos efectivos; cada cierre debe seguir bloqueando disponibilidad.

**Cuadrícula:** conservar ancla del paso existente en cada intervalo común, no reiniciarla al principio del turno o tras un cierre. Común 09:00–12:00, turno 09:10–11:00, paso 15 ⇒ primer inicio 09:15. Cierre hasta 10:05 ⇒ primer candidato 10:15. Para cada candidato exigir que `[inicio, inicio+duración+buffer)` quepa íntegro en un único intervalo efectivo. El fin es exclusivo; una cita cuyo buffer termina exactamente al cierre sí cabe. Recursos activos/asignados siguen siendo condición aparte. Mantener reserva histórica de buffer y no sustituirlo por precio/duración actuales donde ya existe snapshot.

Fechas nuevas/modificadas desde hoy hasta hoy+366 días; cierre de hasta 366 días inclusivos. Registros pasados existentes pueden conservarse idénticos o eliminarse, sin alterar retrospectivamente su rango. Para cambiar un cierre ya iniciado, retirar el anterior y crear uno desde hoy, con revisión explícita. Este es un registro de política vigente, no historial de horas trabajadas ni de disponibilidad histórica.

Recursos inactivos/eliminados: las reglas guardadas no se borran automáticamente. No afectan a recursos distintos ni crean recursos nuevos. UI los muestra como inactivos/desconocidos, permite quitar reglas y no crear nuevas para ellos. Al enviar, referencias nuevas o modificadas deben apuntar a recurso existente activo; referencias antiguas idénticas se preservan. Restablecer **Heredar horario del negocio** elimina solo la semana propia, sin borrar excepciones/cierres. La vista lo explica antes de confirmar.

## Persistencia, autoridad y concurrencia

Guardar singleton `businesses/:businessId/resourceSchedulePolicies/current`; ausencia real ⇒ policy version1/revision0/reglas vacías/updatedAt null. Un documento existente inválido, versión desconocida, businessId distinto o error de lectura produce `503 RESOURCE_SCHEDULE_UNAVAILABLE`; **nunca heredar ante corrupción/error**. Crear segundo child `resourceScheduleOperations` con recibos inmutables. Añadir ambos a `DATA_CHILDREN.businesses`; las tablas JSON D1 existentes bastan, sin migración SQL ni índices nuevos. Firestore navegador continúa denegando subcolecciones privadas.

Funciones servidor en `src/lib/server/resource-schedules.ts`:

```ts
readResourceSchedulePolicy(tx: Transaction, businessId: string, db: Database): Promise<ResourceSchedulePolicy>;
resourceScheduleBasisFingerprint(basis: ResourceScheduleBasis): string;
resourceDayScheduleFingerprint(business: Business, policy: ResourceSchedulePolicy, resourceId: string, dateKey: string): string;
readOwnerResourceSchedules(user: ChatActor, businessId: string, requestId?: string, db?: Database): Promise<ResourceScheduleView>;
saveOwnerResourceSchedules(user: ChatActor, businessId: string, command: ResourceScheduleCommand, db?: Database): Promise<ResourceScheduleSaveResult>;
```

Fingerprint de basis: SHA-256 de JSON canónico de semana común y recursos id/name/active ordenados. Fingerprint de día: SHA-256 de `{ v:1, resourceId, dateKey, policyRevision:policy.revision, effectiveDay:resolveResourceDaySchedule(...) }` en ese orden canónico. Toda edición de política invalida conservadoramente propuestas anteriores aunque otro recurso fuera el cambiado; un cambio efectivo del horario común también se detecta. Estas huellas no conceden permiso y no se registran en logs con datos privados.

```ts
type ResourceScheduleCommand = {
  requestId: string; expectedRevision: number; expectedBasisFingerprint: string;
  rules: ResourceScheduleRules;
};
type ResourceScheduleReceipt = {
  requestId: string; operationHash: string; resultRevision: number; appliedAt: number;
};
type ResourceScheduleView = {
  businessId: string; ownerUid: string; policy: ResourceSchedulePolicy;
  basis: ResourceScheduleBasis; basisFingerprint: string;
  writesEnabled: boolean; serverNow: number; operation: ResourceScheduleReceipt | null;
};
type ResourceScheduleSaveResult = ResourceScheduleView & {
  operation: ResourceScheduleReceipt; replayed: boolean;
};
```

Nuevo endpoint `GET/PUT /api/businesses/:id/resource-schedules`, Node/force-dynamic/no-store. GET admite solo `requestId` opcional único validado; PUT JSON máximo 128 KiB y schema estricto. GET transaccional relee negocio, comprueba dueño y devuelve basis/policy de la misma lectura; no exige plan/consentimiento para consultar. No permite superadministrador como bypass de dueño ni devuelve citas/clientes. PUT exige dueño actual, configurado, consentimiento de cuenta y suscripción permitida; conserva restricciones existentes. No envía IA ni cambia política salud/menores.

Transacción PUT: leer negocio actual, singleton y recibo con ID `stableDocumentId(user.uid, requestId, 'resource-schedule')`. Después de verificar dueño, un recibo existente con hash del comando canónico idéntico devuelve evidencia de aplicación y política actual; hash diferente ⇒ `409 RESOURCE_SCHEDULE_REQUEST_REUSED`. Para un comando nuevo exigir feature gate, plan/consentimiento y expectedRevision/basis actuales; diferencias ⇒ `409 RESOURCE_SCHEDULE_CHANGED` o `409 BUSINESS_SCHEDULE_CHANGED`. Validar recursos contra negocio actual, límites de fecha con serverNow, reglas y revisión segura; escribir policy revision+1 y crear recibo atómicamente. No escribir Business/publicBusiness ni tocar citas/locks/cuotas. El recibo guarda businessId y actorUid en persistencia para validar ámbito; DTO omite campos redundantes. No borrar recibos en este incremento ni asumir TTL de app_commits como idempotencia de dominio.

Recibo y policy comparten commit. Reintentar exactamente mismo comando/requestId es seguro incluso tras otra edición; se devuelve revisión aplicada y política actual separadas, sin sobrescribir. Una petición en vuelo nunca se sustituye por otra con payload diferente. Si el GET no encuentra recibo durante una petición pendiente, no significa fracaso: mantener barrera y ofrecer solo esperar o reintentar el mismo comando tras error real. Si recibo prueba revisión antigua pero la política actual difiere, explicar «Este cambio se aplicó; después hubo otra modificación» y cargar/revisar actual antes de editar. CAS evita que una petición vieja llegue después y sobrescriba una revisión más nueva.

Todos los cálculos servidor pasan **resourceSchedulePolicy requerido** a `getAvailableSlots`. Leerla mediante tx en reserva/confirmación, propuesta, reprogramación, structured/next y espera. La lectura conversacional `readAvailability` pasa a transacción que relee Business por ID: no usar el argumento cacheado como autoridad del horario. Next lee una sola policy por búsqueda, no por cada día. No alterar cuotas/consentimientos/representación ni acortar listas con limit para inventar huecos. La reserva y reprogramación mantienen sus locks de ocupación; la lectura de policy dentro de la misma transacción las serializa contra su edición. Una cita que ganó la carrera antes del cierre permanece; una confirmación posterior ve cerrado y falla 409. No se exige que editar política busque todas las citas futuras.

El bloqueo manual conserva su contrato: se puede registrar fuera del turno, sigue rechazando colisión y no crea disponibilidad. La cancelación y los resultados retrospectivos conservan intervalos guardados. No aplicar restricciones nuevas al origen de una reprogramación: validar destino actual; el origen puede haber quedado fuera de turno.

## UI guiada y composición

Nueva ruta dueña `/dashboard/schedule`, con acceso secundario **Turnos y cierres** desde sección Horarios de `OwnerConfigurationWorkspace`; enlace anunciado en otra pestaña para preservar borrador agregado. No añade un destino principal: AppShell conserva Mi agenda/Mi negocio/Enlace y QR/Suscripción y usa `businessNavigationPath='/dashboard/onboarding'` para esta ruta. Si ese prop aún no existe, introducir el mismo contrato opcional de las cuatro rutas principales previsto por FAQ, sin incluir `/dashboard/schedule` como destino principal. La configuración común sigue su guardado agregado y efecto público; aquí se muestra resumen y enlace a `/dashboard/onboarding` sin inventar deep-link de sección. Configuración no guarda esta política ni la incluye en dirty/assistantScope/logo. La política afecta huecos nuevos inmediatamente; el perfil público sigue mostrando apertura común, no turnos privados ni labels.

Pantalla inicial: título, explicación breve y tres elecciones **Semana habitual**, **Cambiar un día**, **Cierres**. Solo una vista/editor principal a la vez. Recurso y tarea visibles juntos; herencia explicada junto al control. Semana usa siete días plegables e intervalos cortos; excepción pide recurso→fecha→horas; cierre pide negocio/recurso→fechas→día completo/intervalo diario→revisión. Sin RRHH, panel gigante ni mezcla de configuración del asistente. Una sola acción final **Guardar horarios**, resumen antes/después y reconocimiento «Las citas existentes se conservan; revísalas en Mi agenda». No promete número de citas afectadas sin consulta completa.

Crear `src/components/resource-schedule-workspace.tsx` y `src/hooks/use-resource-schedules.ts`. El hook admite `mode:'read'|'edit'`, usa API tipada con expectedUid/signal/generación y guarda borrador solo local en la ruta. Entrar/reingresar requiere GET dueño; no exponer controller desde useBusiness cacheado. Cambiar UID/negocio, 401/403 o respuesta con dueño distinto purga y descarta tarde. GET limitado a 10 s con cleanup; lectura fallida no se transforma en horario heredado. Mantener borrador protegido ante red/402/consentimiento; actualizar externamente estando dirty abre comparación sin merge ni sobrescritura automática.

Un PUT en vuelo deshabilita cambiar reglas/segundo envío; a 20 s solo aviso de demora, sin abortar por cronómetro. Después de error ambiguo conservar payload/requestId y consultar recibo o reintentar **misma petición**; nunca inferir saved por solo coincidencia del contenido actual. Sin recibo no se libera barrera. Respuesta/recibo verificado muestra revisión aplicada y adopta estado actual, distinguiendo cambios posteriores. Navegar dentro de la ruta conserva borrador; salir muestra aviso nativo si procede y explicación de que borrador no enviado se pierde. No inventar bloqueo SPA garantizado. Al volver, GET fresco y CAS/recibos protegen servidor aun si se perdió memoria. No guardar reglas en URL/localStorage/sessionStorage ni imprimir payload.

El componente se desmonta al salir; no mantener diálogos portaled ocultos. Usar pasos/confirmación inline, labels, fieldsets, errores asociados y foco al heading/resumen de error. Atrás cambia paso sin escribir. Móvil 320–390px/zoom200%, botones y bloques en flujo, estado visible y ayuda ampliable.

Agenda: el hook `mode:'read'` obtiene policy+basis para sombreado de turnos/cierres con refresh visible de 15 s sin solapar sus propias lecturas, una consulta adicional, no siete. La agenda mantiene sus lecturas de citas y errores por fecha. Prop añadido `scheduleContext: { state:'ready'; view:ResourceScheduleView } | { state:'loading'|'error' }` en OwnerAgendaCalendar. Si horario falla, quitar sombreado/advertencias dependientes y mostrar «Horario no verificable»; conservar citas y sus errores, sin afirmar huecos libres. Con ready, citas fuera del intervalo efectivo llevan advertencia contextual, jamás se ocultan. No cambia la regla de que el gráfico no reserva ni certifica disponibilidad. Para recursos históricos desconocidos mostrar horas no verificables; no atribuir herencia como prueba de su jornada pasada.

## Activación y rollback

Gate servidor `SARIN_RESOURCE_SCHEDULE_WRITES_ENABLED === 'true'`, por defecto false, reflejado como writesEnabled. Añadirlo explícitamente a runtimeKeys/validación booleana de `cloudflare/src/router.ts` y vars false de `cloudflare/wrangler.jsonc`; una variable Worker no llega sola al Container. No es argumento público de build. Desplegar primero lector compatible/allowlist y validar localmente; habilitar escritor/UI después de verificar todos los caminos. Deshabilitar escritor conserva políticas y aplicación de restricciones. **No volver al lector 463ae55 mientras existan políticas activas:** ignorarlas abriría huecos cerrados. Rollback seguro conserva commit lector compatible y desactiva escritura; cambios de reglas se revierten mediante nuevo comando CAS revisado, nunca borrando datos para volver atrás. No hay migración SQL; las extensiones de allowlist son aditivas. Publicación futura necesita revisión/CI/runtime y gates vigentes, no se ejecuta desde E:.

## Aceptación y autorrevisión

Comprobar sin inferencia/prod: legado ausente conserva slots; corrupción falla; intersección y ancla15; excepción no abre día común cerrado; buffer cruza cierre ⇒ rechazo; cierre concurrente con propuesta/confirmación y cambio semanal común no permite hueco obsoleto; cita que ya existe permanece; next/espera/cliente usan misma policy; recurso inactivo/desconocido no reaparece; GET403 revoca y respuesta tardía no expone datos; PUT con respuesta perdida/replay/CAS no duplica ni sobrescribe; polling no borra dirty. Fixture de dos recursos y siete días permite medir lecturas/latencia local, sin prometer rendimiento antes de ejecutar.

La revisión propia comprobó que no se confunden horario público, turnos y ocupación; que el editor independiente no amplía guardado agregado; que todas las nueve llamadas actuales a getAvailableSlots están cubiertas; y que rollback mantiene enforcement. La recuperación por recibo es contrato nuevo real, no capacidad atribuida a la configuración agregada existente. No incluye reservas fuera de turno, plantillas quincenales, series materializadas, multidestino, festivos automáticos, turnos históricos, cálculo laboral ni cobros. La reprogramación del dueño posterior debe leer policy y comparar resourceDayScheduleFingerprint antes de mover atómicamente.
