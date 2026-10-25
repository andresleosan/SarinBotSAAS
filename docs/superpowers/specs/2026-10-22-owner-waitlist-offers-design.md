# Ofertas de espera dentro de Sarin y confirmación del cliente

Fecha: 22 de octubre de2026, Colombia. Diseño documental por delegación expresa, posterior a [bandeja y revisión manual S10](2026-10-22-owner-waitlist-design.md); [plan](../plans/2026-10-22-owner-waitlist-offers.md). No hay implementación, pruebas ejecutadas, migración o publicación en este encargo. La fase anterior es útil sin esta; este par añade una oferta real y su resolución, sin confundirla con revisión.

## Resultado y alcance cerrado

El dueño elige manualmente una solicitud y un horario compatible; publica una oferta **privada dentro de Sarin, sin exclusividad**. El cliente autenticado de esa solicitud la consulta, revisa una propuesta y confirma con sus datos actuales. Solo esa confirmación transaccional crea la cita y retira esa entrada concreta de la espera. Un horario visible o una propuesta preparada no consume capacidad ni significa aceptada.

Primer alcance: política general y representedMinorsEnabled=false; solicitud self con anclas actuales válidas. Salud y menores conservan espera y consulta existentes, pero no reciben esta nueva oferta operativa. No reutilizar un consentimiento sensible, emitirlo como dueño ni asumir que un UID identifica a todos sus beneficiarios. Ampliar ese alcance requiere diseño específico de caso/consentimiento.

Sin email/SMS/WhatsApp/push, tareas automáticas, cobros, listas de contactos, invitaciones, reserva por dueño, prioridad comercial, series o retención exclusiva. «Publicar oferta en Sarin» prueba que se guardó y puede consultarse: no prueba que alguien la leyó. El cliente debe entrar y pulsar «Comprobar ofertas». FIFO de la bandeja sigue siendo orden visible, no motor que avanza automáticamente al siguiente.

## Fuente y composición

Fuente leída solo lectura: `C:/Users/Drean Skate/AppData/Local/SarinBot/whatsapp-adaptation-20261020/source-restoration`, pin463ae55f8c873468980746185fb3e91f55cb8681; runtime documentado c8bb0a99d9ac2bb20acaef2e5a157b0ff83b05f2. E: no es fuente ejecutable. Base compuesta: Agenda/configuración guiada/S09 y bandeja S10 terminadas/verificadas, Attendance/CRM/S07 reconciliados si están integrados. No modificar matriz/documentos raíz ni producto durante esta preparación.

Código real: waitlist.ts conserva una entrada por UID/negocio y no la cierra al reservar; booking-proposals.ts separa preparación/confirmación y replay; bookings.ts:createAppointmentInTransaction hace lecturas de permisos/cupo/locks/ocupación y después escribe cita/cuota; BookingProposal recoge teléfono y campos permitidos; BookingWorkspace de `/b/[slug]` coordina acciones y el Mis citas keyed por version. Mantener rutas/contratos actuales del cliente y sus propuestas1/2. Contexto: [reglas públicas y huecos](../../qa/2026-10-22-fresha-waitlist-and-change-rules.md), [inventario](../../qa/2026-10-22-sarin-effective-admin-inventory.md) y [S09](2026-10-22-resource-schedules-and-closures-design.md). Decisiones siguientes son Sarin, no reglas atribuidas a Fresha.

Alternativas: **elegida**, oferta privada con una propuesta cliente embebida, usando la primitiva transaccional común de crear cita; evita ampliar versiones del bookingProposals actual y permite cierre serializado propio. Descartada sugerencia que abre calendario normal y luego marca resuelta: no acredita cuál reserva aceptó la oferta ni protege expiry. Descartada reserva automática del dueño: suplanta intención/permisos y puede gastar cupo sin confirmación.

## Identidad, selección y tiempo

Dueño vigente exacto para crear/consultar/retirar ofertas del negocio; superadmin no sustituye dueño. Cliente para consultar/aceptar/rechazar es el ownerUid almacenado en el registro canónico, siempre comparado con requireUser real. No aceptar UID de cliente/actor/beneficiario desde cuerpo. Las comprobaciones read-only de principal de la fase anterior no autorizan crear citas ni consentimientos.

Crear oferta: dueño con consentimiento de cuenta, negocio configurado y isSubscriptionAllowed actual; solicitud canónica vigente con requestRevision y anclas verificadas, estado available, política general sin menores y caso self. Servicio y fecha se derivan de la solicitud; el dueño elige solo resourceId/startTimeStr dentro de disponibilidad devuelta. Si request.resourceId no es null, debe ser ese; null admite un recurso activo asignado al servicio. Capturar catálogo vigente (servicio/recurso/intakeFields), huella S09 del día y revisión de bookingDataPolicy. Revalidar todo en transacción, sin asumir que un GET anterior conserva el hueco.

Oferta expiresAt = min(createdAt+600000, request.expiresAt, target.startAt). Reloj servidor, igualdad vence; tiempo fijo sin TTL elegido por cliente/dueño. Una retransmisión conserva ID y plazo. La propuesta del cliente tiene el mismo expiresAt de oferta, no diez minutos adicionales. En UI se muestra límite absoluto Colombia y tiempo restante orientativo; el reloj de UI no prueba cierre persistido ni resultado de confirmación pendiente.

No hay hold ni bookingLock al ofrecer/preparar. Todos los canales pueden ocupar el horario hasta que una confirmación gane los locks normales. Dos ofertas de clientes distintos pueden apuntar al mismo horario; no implican dos plazas. Cambio de turno/cierre/catálogo/política o anclas exige revisión nueva, aunque la hora todavía quepa. Una cuenta bloqueada/sin cupo no recibe una reserva por vía alternativa.

## Persistencia privada

Dos hijos nuevos de businesses, deny SDK conservado:

- `waitlistOfferHeads/{waitlistRecordId}`: versión1, businessId, waitlistRecordId, revision positiva segura, entryId y currentOfferId. Ausencia⇒revisión0; documento inválido no es ausencia. La revisión aumenta únicamente al crear una oferta nueva, no al consultar/cerrar/confirmar. Head por singleton permite recuperar la última oferta aun después de request:null.
- `waitlistOffers/{offerId}`: versión1 strict, id, businessId, waitlistRecordId, entryId, waitlistRevision, headRevisionAtCreation, clientUid, ownerActorUid, requestId, commandFingerprint, requestFingerprint, dateKey, createdAt, expiresAt, immutable target/catalog snapshot y fingerprints, policyRevision, state, proposal nullable y booking nullable. Estado offered/withdrawn/declined/expired/booked; offered exige closedAt/closedReason/closedByUid null. Cada terminal guarda closedAt, closedReason igual a su estado y closedByUid del actor servidor; booked exige booking proof, otros estados booking:null. No almacenar contacto/respuestas/nombre del cliente o menor/chat/Appointment completo.

offerId=stableDocumentId('waitlist-offer',businessId,entryId,owner.uid,requestId). Fingerprint canónico del comando incluye expectativa de entrada/head y selección; autor/negocio implícitos del servidor. Validar el ID derivado al leer. Snapshot de target contiene serviceId/resourceId/nombres/fecha/horas, startAt/endAt/reservedUntilAt, precio/duración/buffer e intakeFields públicos permitidos; no respuestas. Comprobar correspondencia exacta timestamps/duración/buffer y expiración. Hash de solicitud incluye request y revisión normalizados; no devolverlo como permiso ni log.

Una oferta admite **una** propuesta cliente: `{id,requestId,createdAt,expiresAt,subjectCase:{bookingRequestId:requestId,subjectKind:'self'},catalogFingerprint,resourceScheduleFingerprint,policyRevision}`. ID=stableDocumentId('waitlist-offer-proposal',businessId,offerId,client.uid,requestId). Selección inmutable procede de oferta, beneficiario es self y autorización null solo porque la política vigente no exige autorización sensible. No copiar la autorización del caso viejo de espera. Repetir mismo requestId recupera; uno distinto con propuesta existente⇒409 y ofrece recuperar la existente. No editar/reemplazar propuesta bajo el mismo offerId.

Booking proof inmutable en oferta: `{appointmentId,proposalId,entryId,previousWaitlistRevision,resolvedWaitlistRevision,confirmedAt,source:{dateKey,startAt,endAt,reservedUntilAt,resourceId,serviceId}}`. Solo refleja la confirmación original. Una lectura posterior devuelve aparte la cita actual, que puede haber sido reprogramada/cancelada; no igualar su posición/estado al proof ni restaurarla. No añadir actor u oferta privada al Appointment; el enlace inverso vive en oferta.

Revisiones head/espera/markers presentes deben ser válidas y permitir incremento seguro, sin escribir MAX_SAFE_INTEGER. El retiro de espera usa exactamente el schema1 existente: request:null, revision+1, updatedAt del servidor, lastOperation `{requestId:'offer-'+offerId,operationHash:hash({kind:'resolve_offer',offerId,proposalId,entryId,appointmentId}),appliedRevision:nuevaRevision}`. El requestId interno cabe en validador actual y no se presenta como operación iniciada por cliente en UI. La prueba de resolución vive en oferta; el tombstone no se convierte en CRM ni archivo clínico.

## Contratos HTTP

Node/dynamic/no-store en éxitos y errores. Todas las rutas sin querystring; schemas strict, controles completos de IDs/UID y cuerpos acotados. Parámetros opacos solo viajan en API; no persistir selección/contacto en URL/storage. No se necesita un enlace público para recibir una oferta.

| Rol, método y ruta bajo `/api/businesses/[id]` | Entrada y resultado |
| --- | --- |
| Dueño POST `owner-waitlist/[recordId]/offers` | 2048bytes `{requestId,entryId,expectedWaitlistRevision,expectedHeadRevision,selection:{resourceId,startTimeStr}}`; devuelve oferta mínima+headRevision/replayed. |
| Dueño GET `owner-waitlist/[recordId]/offer-context` | Detail de fase1, headRevision y oferta actual, writesEnabled y elegibilidad general/self. Todo leído en misma tx; no ampliar DTO estricto del endpoint anterior ni tomar su GET como permiso durable. |
| Dueño POST `owner-waitlist/offers/query` | 2048bytes `{dateKey,filter:'all'|'offered'|'booked',cursor?}`;20+1 ofertas por fecha, createdAt DESC/id ASC. Sin métricas/totales. |
| Dueño GET `owner-waitlist/offers/[offerId]` | Oferta mínima/estado/proof, sin UID cliente/actor ni Appointment crudo. |
| Dueño POST `owner-waitlist/offers/[offerId]/withdraw` | 1024bytes `{withdraw:true}`; retira o recupera estado terminal; no cancelar cita. |
| Cliente GET `waitlist/offer` | Head del singleton derivado de requireUser; oferta actual o null. Si hay request nueva diferente no asociar una oferta vieja a esa entrada. Si request:null y última está booked, permitir prueba de ese resultado propio. |
| Cliente GET `waitlist/offers/[offerId]` | Oferta/propuesta/estado y, si booked, proof+cita actual propia; no envía/muta. |
| Cliente POST `waitlist/offers/[offerId]/proposal` | 1024bytes `{requestId}`; propuesta con target fijo para revisar; no reserva. |
| Cliente POST `waitlist/offers/[offerId]/confirm` | 16384bytes `{confirm:true,clientPhone:unknown,intakeAnswers:unknown}`; confirma propuesta existente del mismo UID; fresh valida bookingSchema, replay no usa datos nuevos. |
| Cliente POST `waitlist/offers/[offerId]/decline` | 1024bytes `{decline:true}`; rechaza oferta, conserva solicitud. |
| Dueño/cliente POST sufijo `[offerId]/close-expired` en su respectivo árbol de ofertas | 1024bytes `{closeExpired:true}`; cierra al vencer o devuelve proof si ya booked. Access deriva de ruta/autenticación, nunca de body. |

DTOs compartidos en `src/lib/waitlist-offers.ts` con schemas exactos; envolturas siguientes no se sustituyen por Appointment/registro privado casteado:

```ts
type WaitlistOfferState = 'offered'|'withdrawn'|'declined'|'expired'|'booked';
type WaitlistOfferUsability = 'ready'|'consent_changed'|'request_changed'|'policy_changed'|
  'catalog_changed'|'schedule_changed'|'slot_unavailable'|'expired_pending_close'|'disabled';
type WaitlistOfferSummary = {
  id:string;businessId:string;waitlistRecordId:string;entryId:string;createdAt:number;expiresAt:number;
  persistedState:WaitlistOfferState;
  target:{serviceId:string;serviceName:string;resourceId:string;resourceName:string;dateKey:string;
    startTimeStr:string;endTimeStr:string;startAt:number;endAt:number;reservedUntilAt:number;
    durationMinutes:number;bufferMinutes:number;priceCOP:number};
};
type WaitlistOfferBookingProof = {
  appointmentId:string;proposalId:string;entryId:string;previousWaitlistRevision:number;
  resolvedWaitlistRevision:number;confirmedAt:number;
  source:{dateKey:string;startAt:number;endAt:number;reservedUntilAt:number;resourceId:string;serviceId:string};
};
type WaitlistOfferProposalView = {offerId:string;entryId:string;proposal:BookingProposalView};
type WaitlistOfferRecovery = {
  businessId:string;viewerUid:string;serverNow:number;writesEnabled:boolean;
  offer:WaitlistOfferSummary;usability:WaitlistOfferUsability|null;
  proposal:WaitlistOfferProposalView|null;proof:WaitlistOfferBookingProof|null;
};
type OwnerWaitlistOfferRecovery = Omit<WaitlistOfferRecovery,'proposal'> & {proposal:null};
type ClientWaitlistOfferRecovery = WaitlistOfferRecovery & {appointment:Appointment|null};
type OwnerWaitlistOfferContext = {
  detail:OwnerWaitlistDetail;headRevision:number;currentOffer:OwnerWaitlistOfferRecovery|null;
  service:{serviceId:string;serviceName:string;durationMinutes:number;bufferMinutes:number;priceCOP:number}|null;
  writesEnabled:boolean;eligible:boolean;reason:'restricted_policy'|'not_available'|'disabled'|null;
};
type OwnerWaitlistOfferResult = {recovery:OwnerWaitlistOfferRecovery;
  appliedHeadRevision:number;headRevision:number;replayed:boolean};
type ClientWaitlistOfferCurrent = {businessId:string;viewerUid:string;serverNow:number;
  headRevision:number;current:ClientWaitlistOfferRecovery|null};
type OwnerWaitlistOfferCursor = {offerId:string;createdAt:number};
type OwnerWaitlistOfferQuery = {dateKey:string;filter:'all'|'offered'|'booked';cursor?:OwnerWaitlistOfferCursor};
type OwnerWaitlistOfferPage = {businessId:string;viewerUid:string;serverNow:number;
  dateKey:string;filter:OwnerWaitlistOfferQuery['filter'];rows:WaitlistOfferSummary[];
  nextCursor:OwnerWaitlistOfferCursor|null};
type WaitlistOfferCloseResult = {businessId:string;viewerUid:string;offerId:string;
  persistedState:WaitlistOfferState;proof:WaitlistOfferBookingProof|null};
type WaitlistOfferConfirmation = {proof:WaitlistOfferBookingProof;appointment:Appointment;replayed:boolean};
```

Owner recovery omite cliente/actor/contacto y solo muestra proof administrativo; no entrega formulario de intake en proposal al dueño: allí proposal debe ser null y la única propuesta visible al dueño es su target revisado. Client recovery valida el cliente privado contra sesión y puede devolver Appointment actual propio como el endpoint de confirmación existente; no proyección de otro cliente. usability es null en estados terminales y un código cerrado en offered; no es prueba terminal de una mutación anterior. reason es null exactamente cuando eligible=true; restricted_policy corresponde a salud/menores, not_available a request no available o target no verificable, disabled al gate. El detalle conserva estados/permisos de fase1 y no convierte un error de validación en razón de negocio.

Oferta listada se valida contra negocio/docID/schema; filtros offered/booked son **estados guardados**, offered puede tener fecha vencida pendiente de cierre. Cursor `{offerId,createdAt}` se valida leyendo ancla y filtro/fecha; continuation tail por createdAt==/id> y older por createdAt<, como CRM20+1. Página/consulta no es snapshot entre recorridos. Lectura de listado no recalcula permisos/slots por cada oferta. Detalle sí valida la evidencia actual, sin mutar ni llamar closed a una propuesta solo por reloj.

## Creación, cierre y propuesta

Crear en una transacción: leer negocio/solicitud/head/offerId; autorizar dueño. Si existe ese ID, validar actor/fingerprint y devolver **esa oferta y head actual**, sin reactivar ni renovar plazo aun si después hubo otra oferta. Para nueva, exigir headRevision y waitlistRevision, permisos/plan/política y disponibilidad actuales. Si head apunta a oferta aún offered/no vencida,409 OFFER_EXISTS; no reemplazo silencioso. Si está offered vencida, se puede cerrar expired y crear la nueva en el mismo commit: UI lo explica en revisión y ambos documentos serializan frente a confirmación vieja. Leer admisión prepareBookingActionAdmission con dueño/kind proposal y namespace literal **`waitlist-offer-owner:${entryId}:${requestId}`**; aplicar solo tras todas las lecturas y escribir offer+head/eventual cierre anterior. Sin cita/locks de capacidad/cuota. EntryId en el namespace evita que reutilizar requestId para otra cuenta haga gratis una intención distinta.

Cliente prepara con requireUser real: oferta/clientUid exactos, head aún señala esa oferta/entrada, solicitud misma revisión/huella, permisos actuales y política general/self. Revalidar catálogo/S09 y hueco sin truncar ocupación. Crear propuesta embebida con admisión de cliente/kind proposal y namespace literal **`waitlist-offer-client:${offerId}:${requestId}`**. Mismo requestId conserva prueba y expiry; proposal nueva no prolonga oferta. El beneficiario self de este caso nuevo no requiere permiso sensible por la política elegida; un cambio de política cierra la elegibilidad, no autoriza otro caso.

Withdraw/decline/close-expired leen el mismo documento oferta que confirm. Estado booked devuelve proof y cita actual solo al cliente; no retirar una cita. Estado terminal devuelve su estado sin otra escritura. offered puede cambiar solo a withdrawn por dueño, declined por su cliente o expired si now>=expiresAt. Revalidar rol y reloj después de lecturas; persistir cierre y devolver sentinel, no throw después de escribir dentro del callback. Son cierres, no nuevas reservas: no exigen plan o consentimiento activo para retirarse/consultar prueba. Ningún cierre retira/reabre la solicitud ni consume/refunda cuota. GET siempre es lectura.

## Confirmación atómica y reloj final

La reutilización de createAppointmentInTransaction necesita una extracción **sin cambiar su contrato público**: `prepareAppointmentInTransaction(...)` hace sus mismas lecturas/validaciones y devuelve `{kind:'existing',appointment}` o `{kind:'new',appointment,apply:()=>void}`; apply síncrono realiza únicamente sus writes y solo una vez por intento. El wrapper actual prepara, aplica si new y retorna la misma cita; todos sus callers/rutas/replay/cuotas mantienen comportamiento. No separar en dos transacciones ni hacer que caller reciba un permiso durable. PreparedAppointment es tipo privado servidor.

Esto permite revalidar expiración después de TODAS las lecturas de cita/consentimientos/cupo/policy/locks. Comprobar solo antes de llamar al helper actual sería insuficiente: podría vencer durante esas lecturas y aun escribir una cita. La preparación no escribe, no gasta cuota ni admisión si no se ejecuta apply. S09 se lee dentro de esa misma transacción y el helper sigue pasándolo requerido a getAvailableSlots.

Confirmación de oferta en una transacción:

1. Leer negocio/oferta/propuesta y comprobar sesión cliente exacta, IDs/ámbito/schema. Si booked, validar proof y leer cita actual propia por ID; devolver prueba original+cita actual sin mirar contacto nuevo, plan, consentimiento o reloj de la oferta. No reaplicar ni exigir que posiciones/revisión actuales coincidan con la copia histórica. Si terminal no booked, devolver sentinel409 OFFER_CLOSED.
2. Si offered ya vencida, persistir expired y devolver terminal; no requiere contacto válido/permisos nuevos. Si vigente, exigir gate de nuevas aceptaciones y propuesta válida, head actual/entrada/revisión/huella exactas y request no retirada. Releer permisos/anclas/política/catálogo/S09/ocupación; exigir sus huellas de revisión además de caber. Cuenta real del cliente, cupo y consentimiento vigentes; dueño no interviene en esta sesión.
3. Validar contact con bookingSchema y campos únicamente de la propuesta, como reserva actual. Construir ValidatedBookingSubject del caso nuevo self/autorización null y llamar prepareAppointmentInTransaction con requestId **`waitlist-offer-`+proposal.id**. kind existing mientras oferta no booked es inconsistencia503, no reparar/resolver de forma oportunista. Todas las lecturas necesarias para cierre/proof/tombstone suceden antes de apply.
4. Retomar now tras la última lectura. Si now>=offer/proposal/request expiry, escribir únicamente cierre expired y devolver terminal; **no llamar apply**. Si target.startAt<=now, mismo cierre; la oferta ya tiene expiresAt<=target.startAt. Revalidar isSubscriptionAllowed/business access final y revisión de espera incrementable. No lanzar después de persistir cierre.
5. apply ejecuta cita/locks/cuota normales. Actualizar solicitud exacta a tombstone de resolución y offer a booked con proof; todos los writes se confirman juntos. Sin otro await/read después de apply. Tiempo de proof es reloj final del servidor; timestamps del target y cuota estándar no se recalculan para eludir el snapshot revisado.

Si falla la confirmación antes del commit, no se crea cita ni se resuelve espera. D1 conserva journal/reintento de commit idéntico y dominio conserva offer/proposal IDs; replay posterior recupera la cita actual. Respuesta perdida no autoriza otra propuesta ni otra reserva. La cuota de prueba se consume una vez como toda cita nueva, nunca al ofrecer/preparar/cerrar; capacidad y clientBookingLimit se comprueban normalmente.

Competencia: reserva directa/S07/otra oferta comparte recurso-día y client locks del helper. Gana una ocupación compatible. Perdedor obtiene conflicto y su solicitud sigue, sin cierre automático por estar ocupado. cancelWaitlist o nueva entrada compiten sobre el mismo waitlistRequest: si cancelación gana, confirmación falla; si confirmación gana, cancelación vieja falla por revisión y no borra la prueba. Cancelar/reprogramar una cita ya convertida no reabre espera. Una reserva normal de ese UID/servicio/día no la resuelve: no hay watcher ni búsqueda por parecido. Consentimiento, política y S09 se leen de la misma tx y vuelven a comprobarse al retry.

## Recuperación y UI progresiva

Oferta persistedState offered, aunque serverNow>=expiresAt, no prueba que una confirmación anterior fracasó. GET devuelve expiresAt y usability expired_pending_close; la UI dice «La oferta venció; falta comprobar el resultado». POST explícito close-expired o la misma confirmación persiste cierre o devuelve booked. La escritura del cierre serializa frente al confirm antiguo: una vez terminal verificado, no puede aplicar después sin releerlo. Withdraw/decline pueden cerrar antes de expiry con la misma garantía. Nunca declarar fracaso por reloj, 404 de transporte, red o coincidencia de datos.

Dueño: desde detalle S10 Ver disponibilidad, seleccionar hora concreta→revisión de servicio/precio/recurso/fecha/margen/fin de oferta/no exclusividad→Publicar oferta en Sarin. Sin selector TTL/canal, sin datos del cliente. Página S10 añade pestaña Ofertas por fecha (20 por página) y estados guardados; permite abrir proof/retirar/cerrar vencida. No cuenta vistas/entregas ni muestra booked como completed. UI mantiene un solo comando de creación en memoria por scope y requestId; incertidumbre permite recuperar ID determinista del resultado mediante repetir comando exacto, no cambiar hora/ID. CAS/head impide una creación vieja sobre otra cabeza. Polling de agenda no remonta ese workspace.

Cliente: en la lista de espera, botón Comprobar ofertas (GET del head propio), selección de oferta→Revisar esta oferta (POST proposal)→BookingProposal reutilizado con beneficiary self y vencimiento absoluto correcto→Confirmar cita. Añadir a BookingProposal prop opcional `validityText?:string`; default diez minutos actual sin cambio, oferta proporciona su plazo restante absoluto, que puede ser menor. No preseleccionar otra fecha/recurso ni lanzar POST al renderizar/abrir enlace. Ofrecer Rechazar oferta conserva solicitud. Guardado muestra cita/proof y «Esta solicitud se resolvió»; refrescar useWaitlist y Mis citas, sin cerrar otras entradas por UID.

El hook cliente vive en BookingWorkspace por UID/authEpoch/negocio, fuera del subtree ClientAppointments keyed por version. Añadir slot opcional `waitlistOfferContent?:ReactNode` a ClientAppointments y `offerContent?:ReactNode` a ClientWaitlist para presentar el bloque; el controller/propuesta/comando sobreviven al refresh de Mis citas. El slot no crea otra instancia de hook. Integración usa la exclusión de acciones ya existente con ref/token de ámbito: no iniciar oferta si booking/reschedule/waitlist/cancelación están pendientes; oferta activa bloquea esas nuevas acciones por ref, sin convertir su propio lock en enabled=false/autoabort. Liberar solo el token de esa identidad; cleanup antiguo no desbloquea otra acción.

Lecturas UI10s con cleanup; mutaciones no se abortan por cronómetro, a20s aviso de demora. Controllers separados para recuperar GET sin abortar POST pendiente. Solo prueba booked/terminal persistida libera una confirmación incierta; offered o usability no lo hacen. Un POST con error real puede repetirse con mismo body/ID; no paralelizar otro confirm mientras el anterior sigue en vuelo. Cierre probado invalida publicación tardía de ese POST, sin afirmar que se deshizo en servidor. Cambio de UID/época/negocio oculta/aborta local y descarta callbacks, sin deshacer efectos persistidos. No guardar contacto/cuerpos/selección/IDs en browser storage o URL. Tras recarga, Comprobar ofertas recupera head y propuesta sin POST automático; Mis citas sigue fuente de reservas propias.

## Errores, mantenimiento y rollout

### Ajuste de implementación R12, 25 de octubre de 2026

El contexto de oferta incorpora `service`, una proyección mínima del servicio identificado por `request.serviceId` y del catálogo vigente, leídos en la misma transacción. El detalle anterior solo expone etiquetas: dos servicios pueden compartir nombre, por lo que la UI no debe deducir identidad, precio o duración a partir de `serviceLabel`. La proyección contiene únicamente los cinco campos del contrato anterior; no incluye contacto, respuestas, intake ni huellas privadas. Es null si el servicio no se puede verificar y `eligible=true` exige una proyección no nula. El DTO y endpoint de detalle S10 anterior permanecen intactos.

La revisión previa del dueño usa esta proyección y la disponibilidad del contexto. Son datos consultados: crear revalida el catálogo, y el target y expiresAt de la oferta publicada son definitivos. Antes de crear, la vigencia mostrada es orientativa, limitada por diez minutos, fin de solicitud y comienzo del horario; no se inventa un createdAt futuro. Este ajuste resuelve un dato faltante en el contrato aún no publicado; no agrega un endpoint ni modifica el comando de creación, la autoridad o el alcance general/self.

Errores de rol401/403 y ámbito404; validación400/413/415; consentimiento428, plan402, admisión429;409 OFFER_CHANGED/OFFER_EXISTS/OFFER_REQUEST_REUSED/OFFER_PROPOSAL_EXISTS/OFFER_CLOSED/OFFER_NOT_EXPIRED/SLOT_UNAVAILABLE;503 WAITLIST_OFFER_UNVERIFIABLE. Gatefalse para nuevos create/prepare/freshconfirm:503 WAITLIST_OFFERS_DISABLED. Errores/storage no equivalen a oferta inexistente. Lecturas/replay/withdraw/decline/close-expired mantienen autoridad y sirven sin plan/consentimiento nuevo, aunque gatefalse.

Gate servidor `SARIN_WAITLIST_OFFERS_ENABLED === 'true'`, defaultfalse; forwarding explícito runtimeKeys/validación booleana en router Worker y vars false como S09. Detener nuevas operaciones no prueba fracaso de las ya enviadas. El lector/cierre/proof se conserva para resolverlas. Worker allowlist añade heads/offers sin abrir SDK. Queries de ofertas usan campos existentes dateKey/createdAt/id/state; mantenimiento usa waitlistRecordId añadido por fase1. Índices D1 para offers fecha+createdAt DESC/id ASC y variante fecha+state+createdAt DESC/id ASC; head por docID no índice propio. Firestore composiciones equivalentes; números de migración se reconcilian con todas las ramas.

Ampliar inventario/export/borrado privado de espera a requests/reviews/heads/offers por waitlistRecordId canónico. Incluye ofertas viejas aunque singleton sea tombstone/ausente. Mantener hash, stopwriters,≤100docsconjunto y conflicto si inventario cambió; no borrar solo cabecera dejando ofertas/anti-replay huérfanos. Backups/reconciliación conservan proof/propuesta/cierres/tombstones; no TTL ni purga al expirar. No exponer exportación al dueño ni registrar cuerpos de confirmación.

Rollout futuro índices+allowlist/lectores antes de habilitar gate, luego UI/aceptación con rama compuesta verificada. Rollback conserva lector S09 y endpoints de recuperar/cerrar/proof de ofertas existentes, gate de nuevas operaciones apagado; no volver a app que ignore estos recibos con confirmaciones pendientes. No restaurar cuotas/citas/posiciones para revertir UI, ni mover datos a otro backend ante error. Esta preparación no activa el gate ni publica.

## Aceptación y límites

Pruebas reales futuras: autorización dueño/cliente cruzada, general/self cerrado y cambio a salud/menores,20+1/ofertas FIFO sin automatismo, expiry exacto durante la **última** lectura de preparar cita, cierre contra confirm antiguo, respuesta perdida/replay después de S07/cancelación, confirm contra reserva directa y contra otra oferta, cancelWaitlist contra confirm, cupo/cuota final, DTOs sin contacto en records privados y mantenimiento completo. UI320/390/1280/teclado/zoom200 con error/ambigüedad/recarga; sin canales externos ni personas reales. Este par prepara oferta y resolución específicas, no toda administración Fresha ni segundo alcance sensible.
