# Espera del dueño: bandeja y revisión manual

Fecha: 22 de octubre de 2026, Colombia. Diseño documental por delegación expresa; [plan](../plans/2026-10-22-owner-waitlist.md). No implementado, ejecutado, migrado o publicado en esta preparación. S10 se divide deliberadamente: esta fase entrega bandeja autorizada, disponibilidad verificable y marca de revisión; la siguiente define **oferta in-app vinculada a confirmación del cliente**. Una marca «revisada» no es oferta, envío, reserva ni resolución.

## Fuente y comportamiento que se conserva

Fuente solo lectura `C:/Users/Drean Skate/AppData/Local/SarinBot/whatsapp-adaptation-20261020/source-restoration`, pin `463ae55f8c873468980746185fb3e91f55cb8681`; runtime documentado `c8bb0a99d9ac2bb20acaef2e5a157b0ff83b05f2`. E: es documental mixto. Ejecución futura en rama aislada de fuente reconciliada, después de Agenda, configuración guiada y S09. Attendance/CRM/S07 se componen si ya están integrados, conservando sus interfaces; esta fase no depende de reprogramar ni escribir citas.

Referencias funcionales: [reglas oficiales y huecos de espera](../../qa/2026-10-22-fresha-waitlist-and-change-rules.md), [captura C09](../../qa/2026-10-22-fresha-admin-catalog-and-guidance.md), [maestro](../../product/fresha-admin-capture-register.md), [matriz](../../product/fresha-admin-coverage-matrix.md) y [S09](2026-10-22-resource-schedules-and-closures-design.md). No atribuir a Fresha los límites elegidos ni calificar ayuda como prueba de esta cuenta.

Contratos comprobados en463:

- `src/lib/server/waitlist.ts`: un singleton por UID/negocio en `waitlistRequests`, ID `waitlistDocumentId(uid,businessId)`. Cada solicitud tiene entryId, caso, un servicio, una fecha y recurso opcional. **No hay franja horaria, varios días, contacto, nombre de cliente, prioridad comercial ni conversión automática.**
- `waitlistRecordSchema` versión1 estricto: ownerUid significa cliente reservante, no dueño del negocio; revisión, request nullable y lastOperation. createdAt pertenece a esa entrada. Expira a las00:00 del día siguiente de Colombia (`expiry(dateKey)`), sin borrar el documento. Salir deja tombstone request:null; otra solicitud reemplaza la anterior. No es un archivo de todas las solicitudes históricas.
- `readWaitlist` proyecta waiting/available/suspended/expired sin escribir. Valida anclas de cuenta/negocio/caso, política, acceso, servicio/recurso y cupo del cliente. available significa al menos un hueco calculado, sin reservarlo. S09 añade lectura de su policy dentro de esa misma transacción.
- `ClientWaitlist`/`useWaitlist`: «Elegir horario» está condicionado a solicitud vigente available y revisión observada. `src/app/b/[slug]/page.tsx:91–103` reinicia el recorrido estructurado con servicio/fecha/recurso/caso; el cliente elige y confirma. **Reservar no retira la solicitud actual**, como explica la propia UI. Mantener ese contrato en esta fase.
- `waitlist-data-maintenance.ts`: exportación/borrado privado sin ruta pública, incluye tombstones y exige detener escritores para borrar anti-replay. La marca nueva debe incorporarse a ese mantenimiento, sin abrir una exportación al dueño.

## Fase mínima elegida y siguiente acción útil

Elegida bandeja diaria FIFO con revisión manual reversible, más «Ver disponibilidad» y «Ver día en agenda». Permite al dueño conocer demanda y revisar un hueco sin buscar perfiles ni inventar una reserva en nombre de alguien. Descartadas prioridad por precio/asistencia, borrar solicitudes desde el dueño, avisar por canal no autorizado y marcar «reservada» solo por ver un hueco.

La UI explica el siguiente paso actual del cliente: **debe entrar en su solicitud, Comprobar horarios → Elegir horario → revisar y confirmar**. Esto ya es un recorrido propio del cliente; la bandeja no lo ejecuta. Al dueño no se le promete que el cliente esté conectado o haya recibido aviso. El incremento siguiente llevará la oferta al mismo bloque in-app y asociará una confirmación concreta antes de resolver la espera; hasta integrarlo no se muestra botón «Ofrecer» ni «Notificar» inerte.

## Autoridad e identidad

Todas las rutas requieren usuario y dueño vigente exacto del negocio, también si su rol global es superadmin. GET/POST de lectura sin barrera nueva de plan o consentimiento; marcar revisada requiere consentimiento de cuenta del dueño, sin plan de nueva reserva porque no ocupa capacidad. Se admite marcar también una entrada caducada visible, sin reactivarla. Nada otorga autorización clínica o de representación.

`recordId` es el ID opaco del singleton, no UID aportado por navegador. Al leer/actuar: validar docID, schema estricto, businessId, ownerUid válido sin controles, igualdad con `waitlistDocumentId(ownerUid,businessId)`, revisión==lastOperation.appliedRevision y vínculo entryId/lastOperation/expiry exactos del validador actual. No adivinar propietario por nombre o unir cuentas. Cliente sin cita no recibe ficha CRM de otra persona. API no consulta users/Auth/perfiles ni devuelve UID, contacto, caso completo, recibos, motivo privado o nombre de menor.

Para reutilizar comprobaciones vigentes sin suplantar una sesión, extraer un lector interno de **principal de datos**, `Pick<ChatActor,'uid'>`, únicamente para helpers read-only de espera y `readVerifiedBookingSubjectAnchor`/su load interno. Ese uid procede del registro canónico ya autorizado por dueño; no de un campo libre del request. Las rutas cliente siguen pasando requireUser real; las mutaciones/consentimientos/propuestas conservan ChatActor autenticado y nunca aceptan este principal como autorización. No llamar join/cancel/createBookingProposal/createAppointment con un cliente fabricado.

## Bandeja y prioridad

Nueva página `/dashboard/waitlist`, una fecha Colombia,20 filas y lookahead21; acceso por acción secundaria desde Mi agenda. AppShell usa businessNavigationPath='/dashboard' y conserva los cuatro destinos principales, sin añadir Espera al topnav. Fecha inicial hoy, navegación explícita y datepicker válido hasta hoy+366; fechas pasadas consultables sin límite artificial de31 días, pero solo muestran solicitudes **aún presentes** con esa fecha, no las reemplazadas/borradas. «Orden de llegada (FIFO)» significa orden visual por request.createdAt ASC y request.id ASC ordinal; no es motor de asignación ni garantía de turno. Sin orden por importe, diagnóstico, menor, no-show o valoración del cliente; no reordenamiento manual en esta fase.

POST de lectura `/api/businesses/[id]/owner-waitlist/query`, cuerpo2048 estricto `{ dateKey, cursor? }`, sin querystring. Cursor `{ recordId, entryId, createdAt }`; en continuación leer ancla actual y exigir mismas fecha/entrada/createdAt, identidad/revisión coherentes. Si el cliente canceló/reemplazó esa entrada,409 OWNER_WAITLIST_CHANGED. Marcador de revisión no cambia el cursor FIFO.

Consulta base `request.dateKey == dateKey`, orden `request.createdAt ASC, request.id ASC`, limit21. Continuación sin OR: consultar fecha+createdAt==cursor.createdAt+request.id>entryId, orderBy request.id ASC limit21; si faltan, fecha+createdAt>cursor.createdAt, orderBy createdAt ASC/id ASC limit(21-n). Validar resultados/lookahead/orden/IDs, devolver20 y cursor de última devuelta solo si hay21. Una transacción por petición; no snapshot entre páginas. No contar un universo por tamaño de página; ancla cambiada reinicia. Datos sin los campos indexados pueden faltar, expresado como `coverage:'current_indexed_requests'` y ayuda «No incluye solicitudes retiradas, reemplazadas o antiguas incompletas». Error de índice/almacenamiento no equivale a vacío.

Por cada una de las20 filas devueltas, leer solo su marcador por ID con concurrencia4 dentro de la misma transacción; no calcular permisos, cuotas ni slots por fila. Son hasta21 solicitudes,20 marcadores, negocio y ancla: trabajo acotado que se mide con D1 local. Si ese coste no cabe en objetivo de lectura10s, mejorar lectura/transporte o reducir tamaño coherentemente en contrato y tests, nunca ocultar filas/errores ni eliminar validación. No repetir un GET de disponibilidad por cada fila ni listar todas las cuentas.

```ts
type OwnerWaitlistCursor = { recordId: string; entryId: string; createdAt: number };
type OwnerWaitlistReview = { revision: number; reviewed: boolean; updatedAt: number | null };
type OwnerWaitlistRow = {
  recordId: string; entryId: string; waitlistRevision: number; dateKey: string;
  createdAt: number; expiresAt: number; subjectKind: 'self'|'represented_minor';
  serviceLabel: string; resourceLabel: string; lifecycle: 'unchecked'|'expired';
  review: OwnerWaitlistReview;
};
type OwnerWaitlistPage = {
  businessId: string; ownerUid: string; dateKey: string; serverNow: number;
  rows: OwnerWaitlistRow[]; nextCursor: OwnerWaitlistCursor|null; coverage:'current_indexed_requests';
};
type OwnerWaitlistDetail = {
  businessId:string; ownerUid:string; serverNow:number; row:OwnerWaitlistRow;
  state:'waiting'|'available'|'suspended'|'expired'; reason?:WaitlistSuspensionReason;
  availability:{resourceId:string;resourceName:string;slots:string[]}[];
};
```

Labels salen del catálogo actual del mismo negocio como texto literal limitado a120; referencia retirada usa «Servicio anterior»/«Recurso anterior», recurso null «Cualquiera elegible». Nombre no es snapshot histórico ni identidad del cliente. Datos del menor limitados a subjectKind, sin nombre/representativeRole. Nunca spread de record, consentimientos o Appointment. El ownerUid de los DTO anteriores siempre es **dueño autenticado**, no el ownerUid cliente del registro de espera; tests lo distinguen explícitamente.

## Detalle y disponibilidad real

GET `/api/businesses/[id]/owner-waitlist/[recordId]`, sin querystring. Devuelve solo detalle de la entrada actual verificable; request:null/ausente⇒404 OWNER_WAITLIST_ENTRY_GONE. Una transacción vuelve a autorizar dueño, parsea registro canónico y llama al lector compartido de proyección con principal UID almacenado. Si el cliente ha retirado permisos, cambiado política, agotado límite o sido bloqueado, conserva el estado suspended y código cerrado, **sin exponer el receipt ni respuestas privadas**. La caducada no calcula slots. No convertir corrupción en suspended ni falta de slots.

Refactorizar projection interna actual para producir `{ state:WaitlistState, availability }`, manteniendo `readWaitlist` devolviendo exclusivamente state. Reutilizar exactamente la misma validación de anclas, política, acceso, catálogo e intake y una consulta de citas confirmadas por fecha sin truncar. Para estado eligible, leer `readResourceSchedulePolicy(tx,businessId,db)` y pasar policy requerida a `getAvailableSlots`; misma lectura para owner/client. Respetar buffer, recursos activos/asignados, cierres y reloj final. No reservar, bloquear o gastar admisión al consultar.

«Ver disponibilidad» abre ese detalle explícitamente; no al renderizar una fila. Muestra horarios válidos a serverNow y aviso «Esta consulta no retiene el horario. El cliente debe elegir y confirmar su reserva». **Abrir Mi agenda** navega a `/dashboard` con ayuda «Selecciona [fecha de la solicitud]»; no promete una fecha preseleccionada ni inventa un deep-link que Agenda no tiene. No propone mover una cita S07. Un hueco puede desaparecer por reserva/reprogramación en cualquier canal después del GET; Actualizar reevalúa. La UI no llama «oferta» a estos resultados ni garantiza exclusividad/FIFO al reservar.

## Revisión manual: persistencia y semántica

Un único child privado nuevo `businesses/{businessId}/waitlistOwnerReviews/{entryId}`, ID de entrada canónico existente. Ausencia⇒revision0/reviewedfalse/updatedAtnull. Registro versión1 strict: businessId, waitlistRecordId, entryId, revision positiva segura menor que MAX_SAFE_INTEGER, reviewed:boolean, updatedAt, actorUid, lastOperation:{requestId,operationHash,appliedRevision}. No notas libres, contactos o historia ilimitada. Marcador presente inválido cruza negocio/entrada o revisión incoherente⇒503, no false por defecto. Una nueva entrada del cliente tiene otro ID y empieza sin marca; no hereda la revisión anterior.

PATCH `/api/businesses/[id]/owner-waitlist/[recordId]/review`, JSON2048 estricto `{ requestId, entryId, expectedWaitlistRevision, expectedReviewRevision, reviewed }`; sin querystring. Reutilizar requestId/IDs con validación completa de controles. Solo el dueño y consentimiento de cuenta actual, actor/fecha del servidor. Transacción lee negocio/solicitud/marcador/consentimiento antes de escribir. Exige entrada y revisión de espera actuales y expectedReviewRevision; cliente cancelar/reemplazar concurrentemente provoca409. Cambiar solo marcador, jamás waitlistRequests/cita/locks/cuota/admisión/políticas/consentimiento.

Hash canónico de comando+businessId/recordId/actorUid liga el último requestId. Repetición exacta de **la última operación** devuelve el marcador actual sin escribir; mismo ID/cuerpo distinto⇒409 OWNER_WAITLIST_REQUEST_REUSED. Operación más antigua tras otra revisión⇒409 OWNER_WAITLIST_CHANGED, no recuperación de un recibo histórico que no existe. Mismo valor con comando nuevo⇒409 OWNER_WAITLIST_NO_CHANGE. Antes de incrementar, revisión debe ser menor que MAX_SAFE_INTEGER-1. No inventar una auditoría de todas las revisiones; se conserva solo autor/fecha/operación más recientes privados. GET omite actorUid/hash/requestId.

UI: «Marcar como revisada»/«Volver a pendiente de revisión», confirmación breve que explica «No avisa al cliente ni retira su solicitud». Solo una escritura pendiente. Si respuesta ambigua, mantener comando exacto y no enviar otra versión; PATCH20s de espera local no prueba rollback. GET con review.revision **menor o igual que pending.expectedReviewRevision no libera la barrera**: el comando puede seguir en vuelo, aunque el valor coincida con lo deseado por otro borrador. Se resuelve por respuesta/replay exacto válido del comando, o lectura verificada con review.revision **mayor** que expected; CAS entonces impide que el comando antiguo aplique después. Ese segundo caso se presenta solo como estado actual, sin atribuirle prueba histórica a la operación desconocida. No usar un NO_CHANGE de otro comando sin write para simular esa revisión mayor. Entrada retirada/reemplazada también requiere evidencia verificable de cambio de waitlistRevision/entryId antes de abandonar el comando, no un error de red. Esta acción no es económica ni ocupa capacidad y no necesita un journal durable adicional de aplicación histórica.

## UI, errores y mantenimiento

Inicial: selector fecha, explicación FIFO, lista reducida y ayuda cerrada. Abrir una fila enseña primero solicitud/estado/revisión; horarios y explicación cliente se despliegan con «Ver disponibilidad». Una sola solicitud expandida; atrás no guarda. Sin contacto/«Enviar»/«Reservar por cliente» ni formulario clínico. La fila no es persona única; para menor dice «Reserva gestionada por representante». Canceladas/reemplazadas no se presentan como archivo de espera.

Hook por UID/authEpoch/negocio/fecha/recordId/entryId; apiFetch expectedUid, generación y AbortControllers separados lectura/escritura. Cambio real de autoridad/ámbito oculta en render antes de efectos y descarta respuestas tardías. Abrir detalle no dispara otro listado diario de citas del dashboard. No polling: Actualizar explícito; lecturas UI10s y cleanup; 401/403 purga privado. Busy propio no participa en enabled y no autoaborta PATCH. Una lectura anterior a PATCH aceptado no restaura revisión vieja; success invalida listado/detalle de esa generación. No browser storage ni cuerpos/UID en navegación/logs.

Todas las rutas Node/dynamic/no-store también en errores, sin GET que escriba. 400/413/415/401/403/428 existentes;404 ENTRY_GONE;409 CHANGED/REQUEST_REUSED/NO_CHANGE;503 OWNER_WAITLIST_UNVERIFIABLE para evidencia/marker/índice inválido. Fallo no se muestra como cero solicitudes.

Worker añade child waitlistOwnerReviews y campos de query `request.dateKey` string, `request.createdAt` number, `request.id` string y `waitlistRecordId` string para mantenimiento privado. Validación estricta de campos/tipos, sin consulta libre de JSON. Índice D1 aditivo `(parent,json_extract(data,'$.request.dateKey'),json_extract(data,'$.request.createdAt'),json_extract(data,'$.request.id'),path)` y marcador `(parent,json_extract(data,'$.waitlistRecordId'),path)`; nombres app_waitlist_owner_fifo/app_waitlist_owner_review_record. Número siguiente tras reconciliar Attendance/CRM/otras migraciones. Firestore espera: request.dateKey ASC,request.createdAt ASC,request.id ASC; marcador por un campo usa índice normal.

Ampliar mantenimiento privado de espera para incluir marcadores por waitlistRecordId canónico incluso si falta singleton/tiene request:null; ámbito todo negocio incluye ambos children. Conservar hash/confirmación/exportación privada y límite100 de borrado conjunto. Export viejo que omite nuevas filas no puede borrar un inventario cambiado:409 y export nuevo. Sin ruta de exportación o borrado al dueño, ni purga automática/TTL. Backups/reconciliación preservan marcas y tombstones; rollback app conserva child/índices/documentos. Worker compatible antes de app; no fallback de backend ni reinterpretar marca como estado del cliente.

## Siguiente incremento: oferta in-app y resolución concreta

Un par separado debe definir oferta no exclusiva por entryId con vigencia propia, actor dueño y selección dentro de preferencias actuales; no sustituye la expiración al final del día. Lectura solo del cliente UID enlazado, sin avisos externos. Cliente pulsa revisar, crea propuesta vinculada a oferta+entrada+revisión y confirma bajo sus permisos/cupo/beneficiario vigentes. Confirmación transaccional debe revalidar oferta, solicitud, políticaS09/catálogo y ocupación, crear cita normal/cuota correspondiente y registrar vínculo preciso. Solo esa confirmación cierra esa entrada; una reserva independiente no la resuelve por parecido de UID/fecha. Cancelar o reprogramar la cita enlazada no reabre solicitud automáticamente. Dos ofertas/aceptaciones compiten con locks normales; el perdedor ve conflicto, no sobreasignación. La expiración/cierre debe serializar frente a confirmación anterior antes de declarar fracaso definitivo. No basta añadir un botón que abre calendario y luego decir «resuelta».

El diseño/plan de esa fase se preparan a continuación; este par queda implementable por sí solo sin una oferta falsa ni dependencia de entrega externa. No declara S10 entero ni Fresha capturado o implementado.
