# Resultados de atención del propietario y límite de la ficha de cliente

> Ejecuci?n iniciada el 23/10/2026 sobre la base publicada `b7e9a2811db1a9d31bfcabeb12f177e72d50e0da`, con Agenda y Recepci?n verificadas. La continuaci?n del titular autoriza implementar, probar y publicar el n?cleo de tareas 1?6. La restricci?n documental del texto original describe su preparaci?n; tarea 7 (Quitar resultado) permanece diferida.

Fecha: 22 de octubre de 2026, Colombia. Diseño arquitectónico preparado por delegación expresa del titular; acompaña el [plan de implementación](../plans/2026-10-22-owner-attendance-and-client-record.md). Esta tarea escribe documentación: no implementa, prueba, migra, publica ni crea commits. La delegación permite resolver las decisiones ordinarias sin otra petición de aprobación.

**Delta revisado:** el titular decidió añadir **Quitar resultado → Pendiente de registrar** tras observar la anulación de una inasistencia en Fresha. La revisión independiente de admin_audit_scope de este cambio y su composición S07/S11/S12 cerró sin P1/P2 pendientes conocidos el22/10; no acredita implementación o pruebas. La QA nueva de la operación Fresha permanece a cargo del recorrido principal, sin declararse cerrada aquí.

**Dos momentos de entrega en el mismo par:** el núcleo inicial de registro/corrección terminal permanece en el primer paquete; la habilitación de quitar corresponde a la tarea final de integración del plan, después de la base14 y S12 preparados/verificados. Antes de esa integración no se acepta target confirmed ni se muestra Quitar resultado. S12 aporta la prueba de una cancelación posterior; no publicar clear sin ese lector/escritor compatible. No es otro subsistema ni un nuevo flag de activación: se habilita mediante el incremento de código compuesto y revisado, sin un import prematuro de un archivo S12 todavía inexistente.

## Resultado y alcance decidido

El dueño necesita distinguir una cita atendida de una ausencia real, registrar quién lo decidió y corregir un error sin perder historia. Una hora transcurrida no prueba asistencia. Este incremento habilita registro/corrección de `completed`/`no_show` y quitar un resultado erróneo cuando el resultado real se desconoce: estado existente `confirmed`, mostrado como **Pendiente de registrar**. No obliga a sustituir una ausencia errónea por atendida. Incluye historial privado e interfaz progresiva; no representa pagos, evaluación clínica ni sanciones automáticas.

La **ficha consolidada por cliente queda para otro incremento**. El GET diario no proporciona historia completa por identidad; `view=mine` pertenece al cliente autenticado y no es un endpoint del dueño para consultar otra cuenta. Además, reservante y beneficiario menor no son la misma persona. Un resumen obtenido de un día/semana no puede llamarse última visita ni historial global. Aquí se conserva el detalle de la cita y sus políticas actuales, sin crear directorio, búsqueda por teléfono, notas, segmentos o CRM entre negocios. Esa separación deja el alcance de estados completamente especificado y ejecutable por sí solo.

## Base comprobada y dependencias

Fuente leída: `C:/Users/Drean Skate/AppData/Local/SarinBot/whatsapp-adaptation-20261020/source-restoration`, pin `463ae55f8c873468980746185fb3e91f55cb8681`. El runtime documentado es `c8bb0a99d9ac2bb20acaef2e5a157b0ff83b05f2`; el delta hasta el pin es documental. El orden elegido es **Agenda antes de Estados**: ejecutar este plan sobre esa fuente reconciliada más la agenda visual terminada/verificada según sus documentos, no sobre una segunda copia de las tarjetas antiguas. Antes de ejecutar, comprobar ese pin compuesto y aislar una rama; no modificar el worktree recuperado ni desplegar desde el checkout mixto E:.

Referencias siguientes relativas a esa fuente, sin ejecución nueva:

- `src/types/firestore.ts`: `Appointment.status` ya incluye `completed` y `no_show`; no contiene historial de asistencia. `client.hasNoShowHistory` es una propiedad histórica, no un contador fiable ni un permiso para sancionar.
- `src/lib/server/bookings.ts`: `cancelAppointment` solo cambia confirmadas y escribe locks de recurso/día y cliente; `createAppointmentInTransaction` consume la unidad de prueba al reservar. Cancelar no devuelve esa unidad.
- `src/lib/server/appointment-rescheduling.ts`: reprogramación propia del cliente, revisión y fingerprint de origen, misma cita y locks de origen/destino/cliente. No equivale a reprogramación del dueño.
- `src/app/api/businesses/[id]/appointments/route.ts`: GET diario, GET propio `view=mine`, POST de bloqueo y PATCH de cancelación. No añadir significados al PATCH actual.
- `src/lib/server/representation-review.ts` y su ruta: patrón existente de dueño, revisión optimista, consentimiento de cuenta y transacción. Su estado y permisos no se alteran.
- `src/lib/storage/database.ts`: D1 usa revisión global, commit con journal y reintento del mismo commit tras respuesta perdida. `Database`/`Transaction` de `src/lib/storage/types.ts` también permiten Firestore; no escribir SDK exclusivo de uno.
- `shared/data-protocol.ts`: subcolecciones de negocio permitidas explícitamente; no existe `attendanceEvents`. `cloudflare/src/data.ts` ya admite los campos de consulta `appointmentId` y `sequence`.
- `firestore.rules`: dueño y cliente pueden leer sus citas por SDK, pero el wildcard privado deniega otras subcolecciones y todas las escrituras de navegador. Por ello **no incrustar actor, motivo ni historial privado en Appointment**.

Contexto: [inventario efectivo](../../qa/2026-10-22-sarin-effective-admin-inventory.md), [registro maestro](../../product/fresha-admin-capture-register.md) y [operación sintética de Fresha](../../qa/2026-10-22-fresha-appointment-operation.md). Fresha rechazó una ausencia futura; no se probó Completed. Las reglas siguientes son decisiones de Sarin, no una reproducción de efectos internos de Fresha.

## Alternativas consideradas

1. **Elegida: estado existente, metadato mínimo de revisión en cita y eventos privados independientes.** La transacción conserva trazabilidad e idempotencia sin ampliar estados, duplicar contactos ni hacer crecer un array dentro de la cita.
2. Incrustar historial/actor en la cita: lectura sencilla, pero los clientes pueden leer ese documento y el array crecería sin límite. Descartada.
3. Añadir CRM, identidad del beneficiario, estadísticas y reglas de penalización a la vez: exige contratos distintos y amplía datos sensibles. Pospuesta; no se sustituye por una ficha parcial presentada como completa.

## Restricciones globales

- Node 24 y pnpm 11.23.0; conservar `pnpm-lock.yaml` sin cambios y no añadir dependencias.
- Fuente efectiva reconciliada y rama aislada; nunca usar E: como base ejecutable.
- Hora y fechas de Colombia (`America/Bogota`); tiempos de autorización calculados en servidor.
- Solo dueño vigente del negocio; superadministrador y recurso reservable no equivalen a empleado autorizado.
- Lectura histórica sin barrera nueva de suscripción/consentimiento; PATCH requiere consentimiento de cuenta activo, sin exigir plan activo ni consentimiento nuevo del cliente.
- Sin pagos, marketing, inferencia, mensajes externos, información clínica, estados automáticos ni cambios de políticas de salud/menores.
- No modificar cancelación, reprogramación, reserva, cuota comercial ni reglas de beneficiario; coordinar mediante sus documentos/locks existentes.
- Auditoría privada, sin cuerpos de chat, contactos, respuestas de formularios, texto libre ni eventos en proyecciones públicas.
- Migraciones solo aditivas; sin backfill masivo, borrado automático o reversión de datos por rollback de aplicación.

## Estados, tiempo y corrección

La operación requiere `type === 'appointment'`, ámbito e identificadores válidos, estado reconocido y tiempos enteros seguros positivos con `startAt < endAt <= reservedUntilAt`. `dateKey` debe ser válido y corresponder al día colombiano de `startAt`; el cruce legítimo de medianoche del final es admisible. No reconstruir tiempos/márgenes con el catálogo actual. Una referencia de recurso retirada sigue siendo válida si su ID almacenado es válido; no exigir servicio o recurso activo para corregir historia.

**Ambos resultados se pueden registrar solo cuando `Date.now() >= reservedUntilAt`.** Es una decisión conservadora: el motor y las consultas actuales reservan únicamente estados confirmed; marcar atendida al terminar el servicio pero antes del margen liberaría preparación todavía vigente. No ampliar aquí todas las consultas de disponibilidad. La interfaz dice «Puedes registrar el resultado cuando terminen el servicio y su margen de preparación». No se concede ausencia anticipada al empezar la cita. El límite se vuelve a comprobar en cada intento de transacción, después de sus lecturas y antes de escribir.

| Estado actual | Resultado solicitado | Regla |
| --- | --- | --- |
| confirmed | completed o no_show | Registro inicial; sin motivo de corrección. |
| completed | no_show | Corrección explícita con motivo estructurado `recording_error`. |
| no_show | completed | Misma regla de corrección. |
| completed/no_show | confirmed | **Quitar resultado**, revisión explícita y motivo estructurado `recording_error`; queda pendiente, sin borrar auditoría. |
| confirmed/completed/no_show | mismo estado | Nueva solicitud rechazada con `ATTENDANCE_NO_CHANGE`; un replay del mismo requestId sí recupera su recibo. |
| cancelled_by_client / cancelled_by_owner | cualquiera | Rechazar; no reactivar ni convertir cancelación en asistencia. |
| manual_block o estado desconocido | cualquiera | Rechazar; no convertir bloqueos ni interpretar estados corruptos. |

Todas las transiciones, **también quitar**, exigen el final del margen guardado. Quitar no renueva confirmación, cambia hora, reabre una reserva futura, rearma recordatorios ni borra un resultado anterior. La agenda puede volver a dibujar el bloque histórico por su estado confirmed; no ofrece huecos futuros ni certifica asistencia. Una nueva anotación desde pendiente crea otro evento. No hay cancelación retrospectiva de resultados terminales desde esta API. La revisión de representación conserva su flujo independiente; registrar asistencia no certifica parentesco, consentimiento médico ni quién recibió tratamiento.

Datos heredados: ausencia de `attendance` significa revisión cero, sin auditoría previa. Un completed/no_show heredado puede corregirse o quitarse si los tiempos son verificables; el primer evento indica `legacyPreviousOutcome: true` y no inventa autor/fecha del resultado antiguo. Un confirmed antiguo puede registrar su primer resultado. Un confirmed con attendance presente solo es coherente si su cabeza acredita quitar un resultado; nunca eliminar el metadato para volver a revisión cero. Tiempos o metadato inválidos quedan legibles pero sin nueva escritura, con «No podemos verificar este registro; contacta con soporte». No rellenar automáticamente márgenes faltantes, valores revisionados corruptos o asistencia de citas pasadas.

## Persistencia y privacidad

Ampliar Appointment únicamente con `attendance?: { revision: number; lastEventId: string }`. Este metadato no contiene actor ni motivo. Revisión positiva entera segura, menor que `Number.MAX_SAFE_INTEGER`; evento referenciado existente y consistente. Ausencia equivale a cero; un objeto presente inválido nunca equivale a cero.

Nueva subcolección privada `businesses/{businessId}/attendanceEvents/{eventId}`. Evento inmutable por el servicio de dominio, no una garantía de inmutabilidad frente al operador de almacenamiento:

```ts
type AttendanceStatus = 'completed' | 'no_show';
type AttendanceTargetStatus = 'confirmed' | AttendanceStatus;
type AttendanceSourceStatus = AttendanceTargetStatus;
type AppointmentAttendanceEvent = {
  schemaVersion: 1; businessId: string; appointmentId: string;
  actorUid: string; requestId: string; requestFingerprint: string;
  sequence: number; previousStatus: AttendanceSourceStatus; status: AttendanceTargetStatus;
  recordedAt: number; reason: 'initial' | 'recording_error'; legacyPreviousOutcome: boolean;
  source: { dateKey: string; resourceId: string; startAt: number; endAt: number; reservedUntilAt: number; rescheduleRevision: number };
};
```

`eventId = stableDocumentId('attendance', businessId, appointmentId, owner.uid, requestId)`, usando la función existente de `businesses.ts`. Fingerprint con SHA-256 de los campos normalizados del comando en orden fijo, sin datos de cita, token o contacto. El evento usa `sequence = attendance.revision + 1` y fecha/actor del servidor. No copiar Appointment completo al evento ni añadir su historial a `/b`, al chat o al GET propio del cliente.

La cadena se mantiene con el último evento referenciado. Exportar en `src/lib/server/appointment-attendance.ts` **`readVerifiedAttendanceHead(tx: Transaction, db: Database, businessId: string, appointment: Appointment): Promise<AppointmentAttendanceEvent | null>`** para lectores/mutadores compuestos. null solo significa metadato ausente. Para revisión positiva comprobar esquema, negocio/cita, sequence y snapshot source exacto contra dateKey/resourceId/startAt/endAt/reservedUntilAt/revisión de reprogramación guardados. El evento satisface una transición válida y recordedAt≥source.reservedUntilAt; no reconstruir snapshot con catálogo. En confirmed/completed/no_show, head.status coincide con el estado actual. Una cabeza confirmed solo puede venir de completed/no_show, motivo recording_error: nunca initial ni confirmed→confirmed.

**Cancelación posterior:** después de quitar, una cancelación del dueño puede cambiar ese confirmed pasado conforme al contrato actual. Conservar attendance y sus eventos; no fabricar un evento Attendance de cancelación. Para leer una cita cancelada con attendance positivo, exigir cabeza de quitar válida y **prueba privada S12** mediante `readVerifiedCancellationProof(tx,db,businessId,appointment)` de `src/lib/server/cancellation-proof.ts`. Ese helper sin imports de bookings/attendance valida pointer/evento de cancelación, estado/negocio/cita, previousStatus=confirmed, occurrence exacta y `CancellationEvent.attendanceSource:{revision,lastEventId}` igual al metadato attendance actual. Ausencia, corrupción o ancla distinta fallan503; no tolerar una discrepancia status/head por ser cancelada. S05 conserva la última decisión de asistencia y S12 acredita la cancelación actual; el historial muestra ambos conceptos por separado. El helper proof no llama a S05; S12 llama al lector Attendance para validar/capturar el ancla antes de cancelar, evitando un ciclo de imports. Canceladas siguen rechazando nuevas escrituras Attendance.

Una cadena faltante/corrupta falla con503, también en GET/replay; no se repara durante una acción del dueño. El historial empieza con el primer evento real; no reconstruye cancelaciones/reprogramaciones previas no auditadas por este subsistema. Sin S12 integrado todavía, una cancelación posterior con attendance no puede declararse válida por inferencia: la ejecución compuesta exige incorporar la prueba antes de habilitar ese camino; no publicar un estado intermedio que rompa la lectura del historial.

## Contrato HTTP y transacción

Nueva ruta `GET/PATCH /api/businesses/[id]/appointments/[appointmentId]/attendance`, `runtime='nodejs'`, `dynamic='force-dynamic'`, respuestas y errores `Cache-Control: no-store`. Usar `requireUser`, `documentIdSchema`, `readJson`/`apiError` y `assertOwner` actuales. Validar dueño antes de devolver cita, recibo o historial; un rol superadmin no omite esta comprobación. No listar eventos por cliente ni aceptar UID de actor desde el navegador.

PATCH rechaza querystring y cuerpo desconocido; máximo **2.048 bytes**:

```ts
type AttendanceCommand = {
  requestId: string; expectedRevision: number; expectedRescheduleRevision: number;
  expectedStatus: AttendanceSourceStatus; status: AttendanceTargetStatus;
  correctionReason?: 'recording_error';
};
type AttendanceUpdateResult = {
  appointment: Appointment;
  applied: { eventId: string; requestId: string; revision: number; status: AttendanceTargetStatus; recordedAt: number };
  replayed: boolean;
};
```

Usar el `requestIdSchema` existente (8–128 caracteres permitidos) y enteros no negativos hasta `MAX_SAFE_INTEGER - 1` para revisiones esperadas. Origen confirmed→resultado exige omitir correctionReason y evento reason=initial: initial significa registrar un resultado desde pendiente, no necesariamente el primer evento de toda la cadena. Origen completed/no_show exige correctionReason=recording_error para alternar o quitar, con reason homónimo. Target confirmed solo se admite desde un resultado terminal. legacyPreviousOutcome solo es true cuando el origen es terminal sin attendance previo. Revisión de reprogramación heredada ausente equivale a cero con la validación de `appointmentRescheduleRevision`; no aceptar un número corrupto.

Una sola transacción `Database.runTransaction`:

1. Leer negocio, cita y recibo por eventId. Exigir dueño vigente, IDs/tenant exactos y cita operativa; validar metadato de asistencia y cabeza cuando exista. Leer consentimiento de cuenta mediante `assertConsent` dentro de la transacción.
2. Si ya existe recibo, validar su esquema, ámbito, actor y fingerprint exacto. Con comando distinto, 409 `ATTENDANCE_REQUEST_REUSED`. Con comando idéntico, devolver recibo y **cita actual**, `replayed: true`, sin escribir, aunque haya una corrección posterior. No devolver una copia antigua de la cita ni volver a aplicar el resultado antiguo. No requiere que expectedRevision siga siendo la actual.
3. Sin recibo, exigir expectedRevision, expectedRescheduleRevision y expectedStatus coincidentes; si cambiaron, 409 `ATTENDANCE_SOURCE_CHANGED`. Antes de incrementar, exigir revisión actual de asistencia menor que `MAX_SAFE_INTEGER - 1`; de lo contrario503 `ATTENDANCE_RECORD_UNVERIFIABLE`, sin escribir un número que el lector rechazaría. Aplicar tabla de estados, motivo y regla temporal. Leer locks `${dateKey}_${resourceId}` y, solo si existe UID de cliente string válido de 1–128 caracteres, `client_${clientPolicyKey(uid)}`. Un cliente ausente permite historia de una cita legítima sin inventar identidad; un client.uid presente pero inválido impide escribir.
4. Hacer **todas** las lecturas antes de escribir; volver a tomar el reloj y validar el final del margen para cualquier target. Actualizar la cita mediante spread del registro leído, cambiando exclusivamente status y attendance. Crear el evento; incrementar versiones de locks existentes como en otras mutaciones (versiones corruptas fallan cerradas). Sin cambios de negocio, cuota, publicBusiness, clientPolicies, `hasNoShowHistory`, hora, rescheduleRevision, bookingTimeTerms o propuestas. Cuando S11 esté compuesto, preparar únicamente su invalidación antes de los writes y aplicar junto a ellos; quitar no prepara/rearma jobs ni recupera payload/cupo de envío. invalidatedAt es monotónico: un200 tardío del intento anterior sigue obsolete aunque el estado vuelva a confirmed.
5. Cita, evento y locks se confirman juntos. Un error conserva todo. El almacenamiento puede reejecutar la transacción tras conflicto, pero nunca genera requestId nuevo dentro del callback. El adapter D1 conserva su reintento de commit idéntico; no añadir otro bucle de retry de negocio en la ruta.

La escritura concurrente de cancelación/reprogramación/revisión lee la misma cita y provoca retry transaccional: se vuelve a comprobar origen. Si cancelar gana, asistencia falla por origen. Si registrar resultado gana, cancelación devuelve terminal según su contrato; si quitar gana, un comando revisado de cancelación anterior queda obsoleto y una cancelación posterior captura la nueva cabeza Attendance según S12. Quitar y registrar otro resultado compiten por expectedRevision/status: solo uno aplica sobre cada revisión. Si reprogramar gana, cambia revisión/horario y el comando obsoleto falla; un confirmed restaurado no es reprogramable porque acredita un intervalo ya terminado, aun si después cambia el reloj. Los locks compartidos mantienen la coordinación aunque la operación sea retrospectiva. La revisión de representación puede coexistir: spread del último registro conserva ambos metadatos.

GET admite solo `beforeRevision` opcional, entero positivo decimal canónico, una vez, no mayor que la revisión actual. Lee negocio, cita y cabeza en transacción; consulta eventos por appointmentId, `sequence < beforeRevision` cuando exista, `orderBy('sequence','desc').limit(21)`. Devuelve `{ appointment, events: primeros20, nextBeforeRevision: sequenceDelUltimoDevueltoSiHay21 : null }`. Validar cada evento y que la página sea estrictamente descendente/contigua con su límite superior: si faltan eventos o aparece otra cita/tenant, 503. No tratar errores de índice/almacenamiento como historial vacío. Cero sin auditoría previa devuelve lista vacía y rótulo explícito; lectura no crea documentos. Un cursor anterior es válido aunque entre páginas se añada una corrección: las páginas posteriores solo continúan hacia atrás; Actualizar reinicia desde la cabeza.

Errores de dominio: 409 `ATTENDANCE_TOO_EARLY`, `ATTENDANCE_UNSUPPORTED`, `ATTENDANCE_NO_CHANGE`, `ATTENDANCE_SOURCE_CHANGED`, `ATTENDANCE_REQUEST_REUSED`; 503 `ATTENDANCE_RECORD_UNVERIFIABLE`. Autenticación 401, dueño 403, inexistencia 404, consentimiento 428 y validación 400/413/415 mantienen los contratos existentes. No exponer detalles de otra cuenta en mensajes o logs.

## UI progresiva y recuperación

Componente nuevo `AppointmentAttendanceControls` dentro del detalle de cada cita del dueño; no en el gráfico ni para bloqueos. Resumen conserva estado actual. Paso1 «Registra qué ocurrió»: Atendida / No asistió; paso2 muestra cita, hora y resultado anterior/propuesto; botón explícito «Confirmar resultado». Para corregir, acción secundaria «Corregir resultado», motivo fijo «Error al registrar» y confirmación. Incluir **Quitar resultado** como opción secundaria para completed/no_show; revisión «De [resultado] a Pendiente de registrar», explicación «Se conserva el historial; no se cambia el horario ni se envían nuevos recordatorios» y botón **Confirmar quitar resultado**. No aplicar por seleccionar ni copiar la anulación inmediata de Fresha. Confirmed terminado sin resultado se muestra «Pendiente de registrar», sin presentarlo como una nueva confirmación del cliente. Ayuda breve explica que no implica cobro y que el margen debe haber terminado; se amplía con details cerrado.

«Historial de resultados» carga GET únicamente al abrir, páginas de 20 con «Ver cambios anteriores» y «Actualizar». Actor visible como «Tú» o «Otro propietario del negocio», sin buscar perfiles, emails ni nombres globales. No convertir una fecha endAt en fecha de asistencia. Para legado, «Resultado anterior sin auditoría registrada». Errores/espera permanecen junto a la acción. Lectura disponible con suscripción vencida; PATCH sin consentimiento invita al control de consentimiento existente.

API del componente: businessId, ownerUid, appointment, disabled, onSaved(Appointment) y onBusyChange(boolean). El padre mantiene un conjunto/ref de citas pendientes por UID/negocio/día/ID: bloquea navegación/filtros, crear bloqueo y cancelar mientras una escritura de asistencia está pendiente. Esta coordinación es solo para el componente nuevo y las dos escrituras del dashboard. `RepresentationReviewControls` y `ClientPolicyControls` conservan sus bloqueos locales sin ampliar sus APIs. Invocar onBusyChange antes de iniciar fetch; limpiar al terminar/desmontar, sin desbloquear otro ámbito. Las acciones del padre comprueban también el ref, no solo el botón deshabilitado.

`useAppointmentAttendance.enabled` depende únicamente de autoridad vigente, ámbito válido y cita de tipo appointment; **no depende de disabled, saving, busy ni de que el detalle esté abierto**. El cierre de details no desmonta el componente ni aborta una escritura. `disabled` impide iniciar acciones nuevas, pero su cambio a true por el busy combinado del propio PATCH no cancela ese PATCH, no borra su comando y no dispara cleanup de ámbito. Durante guardado se conserva el historial ya cargado como lectura visible; se deshabilita cargar/actualizar páginas hasta resolver la escritura, sin borrar ni abortar por ese motivo una lectura ya iniciada. Un éxito invalida después el historial anterior; una respuesta de lectura anterior al éxito no puede volver a publicarlo. Cambio real de UID/negocio/día/ID sí aborta y descarta como se especifica abajo.

Usar expectedUid/predicado de generación en `apiFetch`, AbortController y guardas de ámbito. Clave UID/negocio/día/ID desmonta contexto viejo; un callback tardío no reemplaza otra cita. El padre acepta solo ID/tenant/dateKey coincidentes y usa `useOwnerAgenda.replaceAppointment`, que invalida la lectura pendiente de la [agenda](2026-10-22-owner-agenda-design.md). La UI no ofrece corregir mientras guardar/bloqueo/cancelación esté pendiente; reemplazos conservan detalle de beneficiario y revisión existentes. Insertar únicamente en `src/components/owner-agenda-appointments.tsx`, dentro del detalle de cita; el dashboard conserva hook, contexto y acciones. Ampliar sus props con `onAttendanceBusyChange(appointmentId, busy)`; el `saving` existente recibe el estado combinado. No reconstruir tarjetas inline, añadir otro GET diario ni otro poller. El backend se puede verificar aisladamente, pero la integración UI requiere la base compuesta de Agenda.

Una respuesta perdida no prueba fallo ni éxito: conservar comando/requestId y ofrecer «Reintentar comprobación» explícitamente con **el mismo cuerpo**, sin repetir automáticamente ni generar otro ID. El recibo distingue operación aplicada de estado actual; si hubo una corrección posterior, mostrar ambos sin revertirla. Una revisión nueva invalida un borrador aún no enviado, pero **no modifica el comando ya enviado de resultado desconocido**: su comprobación exacta sigue siendo segura por recibo. Un 409 invalida la propuesta local y exige actualizar/revisar de nuevo. Abortar al navegar/cambiar cuenta solo cancela la espera; el servidor puede haber confirmado, por lo que nunca prometer deshacer. Tras cambio de ámbito no reutilizar comandos de la pantalla anterior. GET tiene espera máxima local de 10 s y PATCH de 20 s, con controller y carrera de promesas/limpieza; timeout de PATCH se trata como resultado desconocido, no como escritura fallida. Las respuestas tardías no cambian estado y sus rechazos quedan consumidos.

Móvil 320/390 px, controles de 44 px, teclado y zoom 200 %, labels, foco al resumen de revisión, `aria-busy` y resultado con `aria-live=polite`. No desplazar el foco por polling ni abrir de golpe contactos, historial o ayudas. No registrar cuerpos ni datos de clientes en capturas o evidencia.

## D1, Firestore, mantenimiento y rollback

Añadir `attendanceEvents` a `DATA_CHILDREN.businesses`. El Worker importa esa allowlist: debe incluirse en su artefacto efectivo. No hace falta añadir campos de consulta al validador D1 porque appointmentId/sequence ya existen. Añadir índice D1 de `(parent,json_extract(data,'$.appointmentId'),json_extract(data,'$.sequence') DESC,path)` en `cloudflare/migrations/0007_appointment_attendance.sql` sobre la base revisada; si apareció otra migración durante reconciliación, asignar el siguiente número sin sobrescribirla. Es creación de índice, no backfill de documentos. Índice Firestore `attendanceEvents`: appointmentId ASC + sequence DESC, queryScope COLLECTION, en `firestore.indexes.json`. Las reglas actuales ya deniegan SDK para ese hijo: conservarlas y probarlo, no abrir lecturas directas ni siquiera al dueño.

No copiar eventos a otras identidades ni purgarlos por edad. Son también recibos idempotentes; borrarlos rompe la cadena. No crear en este incremento un endpoint genérico de exportación/borrado de clientes. Los respaldos privados integrales y la restauración deben incluir esos documentos y attendance. `scripts/lib/data-migration.mjs` valida contra la allowlist compartida; extender sus tests de ida/vuelta y reconciliación con los nuevos registros. `scripts/verify-d1-backup.mjs` compara todas las filas de app_documents, revisión, commits y esquema: incluir una prueba local de respaldo sintético con eventos. No imprimir actor, citas o contactos. Una solicitud futura de borrado/conservación requiere procedimiento coherente del expediente/cita y recibos, con escrituras detenidas; no borrar solo eventos desde un botón de esta UI.

Publicación futura: verificar base/runtime y respaldo restaurable; mantenimiento vigente y una réplica. Aplicar índice aditivo y Worker compatible con nuevo hijo antes del Container/aplicación que escribe eventos; comprobar índice listo también en el backend Firestore si se usa. Una mezcla con Worker antiguo debe fallar sin escribir parcialmente. Controles actuales de publicación/reversión se mantienen. Esta etapa no ejecuta ninguno.

Rollback del núcleo inicial conserva campos/eventos, allowlist e índices; el código antiguo entiende completed/no_show y sus spreads conservan campos desconocidos, a verificar. **Después de habilitar quitar no basta ese binario antiguo:** conservar lectores que verifican confirmed auditado y prueba de cancelación S12, sus writers/anclas e invalidación S11. Si se retira la acción, usar release compatible, sin borrar cabeza/eventos, cambiar estados de vuelta o retirar índices por rutina. Volver a Firestore como fuente de verdad requiere reconciliación completa de documentos/eventos, no fallback automático tras un fallo D1. Un respaldo previo no debe restaurarse sobre escrituras posteriores para ocultar errores de UI.

## Aceptación y autorrevisión

Pruebas requeridas: autoridad tenant/actor, cuenta sin sesión/plan/consentimiento, antes/justo al final del margen, datos heredados/corruptos, repetición idéntica y distinta, doble registro/corrección, respuesta perdida y replay después de corrección, carrera con cancelación/reprogramación/revisión, cuota sin cambios, historial privado paginado sin huecos y migración/restauración. Ejecutar dominio en memoria, concurrencia en D1 real local y caracterización Admin SDK en emulador; no presentar el mock como evidencia del backend real. Verificar clientes siguen viendo sus estados y carecen de acceso a eventos.

Autorrevisión: quitar conserva resultado anterior, cadena positiva y recibo; no inventa atendida. Final del margen limita toda transición, sin ocupar futuro o mover hora. La cancelación posterior requiere prueba S12 anclada, nunca tolerancia genérica a status distinto; S07 reconoce el origen pasado y S11 no rearma. CRM elimina la fila de filtros de resultado y su cursor se invalida por revisión; S17 mantiene total, baja el resultado terminal y aumenta confirmed/awaitingOutcome. Esos módulos ya leen estado actual, no suman eventos. Actor/motivo siguen privados y cuota intacta. Revisión documental del delta cerrada; sus pruebas/gate compuesto permanecen futuros, sin aceptación ejecutada.
