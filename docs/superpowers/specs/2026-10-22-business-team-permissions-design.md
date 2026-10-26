# Equipo y permisos por negocio — diseño por fases S13

Diseño del 22 de octubre de2026, preparado por delegación del titular. Conserva arquitectura y primer incremento ejecutable; no implementa, invita, prueba o publica producto. Equipo es posterior al piloto actual y no implica contratar prestaciones laborales, nómina ni pagos de Fresha.

## Propósito, base y diferencias que se conservan

Una cuenta autenticada puede colaborar en un negocio sin convertirse en su dueño ni recibir automáticamente contactos, cobros o configuración. Un recurso reservable puede ser persona, silla o estación: **no es una cuenta ni un rol**. «Agenda propia» significa agenda del recurso que el dueño asignó explícitamente a esa membresía, no identidad laboral inferida del nombre. Varias cuentas pueden compartir el mismo recurso si el dueño así lo aprueba; no se promete un empleado único por recurso.

Fuente leída: `C:/Users/Drean Skate/AppData/Local/SarinBot/whatsapp-adaptation-20261020/source-restoration`, pin limpio463ae55f8c873468980746185fb3e91f55cb8681; runtime documentado c8bb0a9, no consultado remotamente. E: es documentación/copia mixta. Ejecución futura desde fuente reconciliada y rama aislada, sin modificar el worktree recuperado.

Hechos relativos a esa fuente: `src/lib/server/auth.ts` solo distingue usuario y superadministrador de plataforma; `businesses.ts:85–87` aplica assertOwner exacto; `src/types/firestore.ts` separa ownerUid del recurso id/name/active. `bookings.ts:22–29` da a no dueños sus propias citas como clientes, no las citas de su recurso. `firestore.rules` permite lectura de cita al dueño/reservante y deniega las demás subcolecciones/escrituras. `src/lib/server/booking-data-policy.ts` controla general/salud/menores. `src/components/auth-provider.tsx` ya expone authEpoch/isCurrentSession. Ninguno de estos contratos es hoy una membresía de equipo.

La referencia [permisos observados](../../qa/2026-10-22-fresha-admin-catalog-and-guidance.md) y [B09](../../qa/2026-10-22-fresha-admin-business-rules.md) distingue propia/ajena, contactos, exportación, ventas, informes y configuración. Fue sesión de dueño, no prueba de denegación de empleado; no se atribuyen a Sarin esas capacidades por copiar casillas.

## Fases y matriz decidida

| Fase | Entrega | Queda denegado |
| --- | --- | --- |
| 1, este plan | Solicitud interna de acceso de cuenta autenticada, aprobación final dueño, revocación/salida y **lectura mínima de agenda asignada**. Un rol cerrado version1; un recurso por membresía. | Agenda ajena, contactos/identidades de clientes, acciones sobre citas, CRM, espera, auditoría de atención, informes, exportar, cobros y configuración. |
| 2, posterior | Diseñar roles de recepción/gestión y capacidades de agenda propia/ajena y cada acción, sobre contratos existentes S05/S07/S09/S10. | Ninguna capacidad se añade automáticamente al rol version1; salud/menores y contactos necesitan diseño específico. |
| 3, posterior | Contactos y finalidad, exportación, informes, catálogo/configuración, cobros/reembolsos cuando esos subsistemas existan. | Nómina, fichaje, salarios, comisiones, transferir dueño, sedes y facturación siguen contratos distintos. Cobros del establecimiento fuera del piloto. |

Catálogo de capacidades para decisiones posteriores: `agenda.read.own`, `agenda.read.all`, `client.contact.read.own`, `client.contact.read.all`, `client.record.read`, `client.export`, `appointment.create`, `appointment.reschedule`, `appointment.cancel`, `appointment.attendance.write`, `appointment.representation.review`, `waitlist.manage`, `resource.schedule.write`, `service.catalog.write`, `business.config.write`, `team.manage`, `reports.read`, `sales.read`, `sales.collect`, `sales.refund`. Fase1 **solo** agenda.read.own; no endpoint genérico que conceda una cadena desconocida. No existe herencia «gestor=todo» ni acceso de plataforma como bypass. El dueño conserva sus rutas actuales y autoridad implícita, sin necesitar membresía.

Roles futuros no se implementan con checkboxes deshabilitados anunciados como funcionales. Se deberá fijar alcance propio/ajeno en cada DTO/mutación, actoría y retiro de acceso antes de habilitarlos. Copiar un rol nunca asignará cuentas ni ampliará automáticamente miembros de un rol viejo. Un nuevo catálogo tendrá versión nueva y aceptación/reasignación explícita, no reinterpretación silenciosa de version1.

## Primer incremento: solicitud, no invitación externa

Se elige **solicitud interna por slug público + aprobación del dueño**. La persona inicia sesión, comprueba negocio, ve que todavía no tiene acceso y solicita colaboración; el dueño revisa la cuenta solicitante, elige un recurso propio activo y confirma acceso solo lectura. No se envían emails/WhatsApp, no hay código bearer, directorio de usuarios ni reutilización de las invitaciones pagadas de Sarin. Solicitar conocer un slug no concede permiso.

Identidad se vincula al UID autenticado, nunca al UID/correo/nombre enviado en body. El dueño ve identificador de cuenta en detalle para contrastarlo con la cuenta de la persona, sin buscar perfiles globales ni mostrar correo/teléfono. La persona puede ver/copiar su propio UID desde su sesión para comprobarlo; no es un secreto ni una prueba de propiedad por sí solo. Aprobación no se basa solo en parecido de nombre. El servidor comprueba las dos acciones autenticadas.

Fase1 exige negocio configurado y **clasificación configurada general, sin menores habilitados** para solicitar/aprobar/leer agenda de equipo. Ausencia de política no equivale a aptitud de equipo; corrupción/error falla cerrado. Cambiar a salud/menores después suspende lectura de equipo sin borrar membresía ni citas; no afirma adecuación legal o clínica. Recursos inactivos/retirados suspenden su agenda. El dueño mantiene lectura/revocación para resolver estos casos. No exigir plan activo a lecturas históricas o revocación/salida; solicitar/aprobar requiere consentimiento de cuenta activo y plan permitido del negocio. El dueño no acepta consentimiento de cliente en nombre del colaborador.

## Modelo canónico y persistencia privada

Crear tipos/schemas puros `src/lib/business-team.ts`. UID 1–128 sin controles (incluido salto final), exacto, sin trim/case-fold; IDs completos según patrón de storage, rechazando segmentos reservados. Estados y rol son enums cerrados:

```ts
type TeamMembershipStatus = 'requested' | 'active' | 'rejected' | 'revoked';
type TeamRole = { id: 'own_agenda_viewer'; version: 1 };
type BusinessTeamMembership = {
  version: 1; id: string; businessId: string; memberUid: string;
  status: TeamMembershipStatus; revision: number;
  role: TeamRole | null; resourceId: string | null;
  ownerUidAtApproval: string | null; businessLabel: string;
  createdAt: number; updatedAt: number; lastRequestedAt: number; lastEventId: string;
};
type BusinessTeamState = {
  version: 1; businessId: string; revision: number;
  requestedCount: number; activeCount: number;
  requestEvents: { at: number; requestHash: string }[];
};
```

Canonical membership `businessMemberships/{stableDocumentId('business-team',businessId,memberUid)}`. Es la única autoridad de pertenencia; `users.role`, visitedTenants, ownedTenantId, un token antiguo o el recurso público nunca la sustituyen. Business no recibe campos team ni roles, evitando filtración por sus proyecciones existentes.

Estado por negocio en `serverSettings/business_team_${sha256(businessId)}`; contador solicitado/activo0–30 y revisión segura. Cada mutación lee/escribe ese documento para serializar contadores/cola también en Firestore, sin confiar en phantoms de queries. Ausencia inicial es0 solo si una consulta `.where('businessId','==',id).limit(1)` confirma que aún no hay membresías; datos existentes sin estado ⇒503. Documento presente inválido jamás equivale a cero.

Eventos/recibos inmutables por dominio en `businesses/:id/teamAccessEvents/:eventId`, `eventId=stableDocumentId('team-access',businessId,actorUid,requestId)`. Contienen version1, businessId/membershipId/memberUid/actorUid, requestId, commandHash, sequence=state.revision+1, membershipRevision, before/afterStatus, role/resourceId resultantes y recordedAt. Sin contactos, nombre de persona, texto libre o Appointment. Membresía/estado/evento se confirman juntos. lastEventId debe apuntar a evento consistente con membresía/revisión/rol antes de conceder acceso; su sequence debe ser≤TeamState.revision y estado active exige activeCount≥1 (requested exige requestedCount≥1). Ausencia/corrupción ⇒503, no reparación en el lector.

Recibo canónico del comando incluye kind, businessId, actorUid, requestId, expectedMembershipRevision, expectedTeamRevision o null, resourceId o null, en ese orden. SHA256 servidor y Web Crypto navegador verifican respuesta/recibo contra comando sellado. Un requestId previo idéntico devuelve prueba de aplicación y estado actual; distinto comando ⇒409 TEAM_REQUEST_REUSED. No volver a aplicar un rol antiguo tras revocación/cambio posterior. Conservar recibos, no depender del TTL técnico de app_commits.

Revisiones de membresía/estado positivas en registros existentes; expected0 solo ausencia real; rechazar overflow antes de incrementar. Para active exigir role version1/resourceId/ownerUidAtApproval válidos; requested requiere role/resource/owner nulos. rejected/revoked conservan datos históricos mínimos y no conceden permiso. businessLabel es copia de nombre público al solicitar/aprobar para listar espacios; no autoriza ni garantiza nombre vigente, que se relee al abrir agenda.

## Transiciones, límites y retiro

| Actor/acción | Origen → destino | Controles adicionales |
| --- | --- | --- |
| Cuenta solicita | ausencia/rejected/revoked → requested | UID propio, revisión exacta, clasificación/plan/consentimiento, límites de solicitud; no resourceId/role del solicitante. |
| Dueño aprueba | requested → active | Revisión de membresía+estado, recurso propio activo, role version1 fijo, consentimiento actual de ambos y clasificación; máximo30 activas. |
| Dueño rechaza | requested → rejected | Dueño y revisiones; sin plan/consentimiento nuevos para retirar solicitud. |
| Dueño revoca | active → revoked | Dueño y revisiones; disponible aunque plan/gate/consentimiento estén pausados. |
| Cuenta se retira | requested/active → revoked | Solo su membresía, revisión exacta; sin plan/consentimiento nuevos. |

No restaurar active por una solicitud ni por replay; nueva solicitud requiere otra aprobación. ownerUidAtApproval distinto del dueño actual suspende la agenda incluso con mismo token: transferencia de negocio no transfiere accesos automáticamente. El nuevo dueño revoca o exige nueva solicitud/aprobación, sin recuperar privilegios antiguos.

Solicitudes: máximo30 pendientes por negocio,5 nuevas por UID en24h y30 por negocio en24h, además de una por UID+negocio cada24h tras solicitud previa. Membresía guarda **lastRequestedAt**, que request fija al reloj servidor y aprobar/rechazar/revocar/salir conservan; este campo determina cooldown del par, nunca createdAt o lastEventId. `serverSettings/team_request_uid_${sha256(uid)}` guarda hasta5 huellas/tiempos del último día; TeamState hasta30. requestHash es SHA256 del JSON ordenado `[memberUid,businessId,requestId]` y representa esa solicitud, no el último evento de membresía. Leer antes de escribir, podar solo eventos fuera24h en la mutación; comprobar replay antes de rate, sin consumir otro intento. 429 con Retry-After derivado de reloj servidor. Estado corrupto/futuro falla503; rechazar/revocar/salir nunca se bloquea por rate-limit. La misma membresía conserva createdAt original; lastRequestedAt y el evento requested registran fecha real de nueva solicitud. No se generan colas en memoria que se pierdan al reiniciar.

## APIs fase1 y denegaciones

Todas requireUser, Node/force-dynamic/no-store; comandos JSON strict≤4096bytes, IDs/rangos/queries exactos y requestId validado. Sesión mediante Firebase actual revocation-aware; actor deriva del token. No actualizan claims, perfil global o rol de plataforma.

| Ruta | Contrato |
| --- | --- |
| `GET /api/team/memberships` | Solo propias,20+lookahead; query opcional afterBusinessId. Alternativamente businessSlug único excluyente para comprobar un negocio y obtener su propia membresía/null. Nunca buscar otra cuenta. |
| `POST /api/team/requests` | `{businessSlug,requestId,expectedMembershipRevision}`; resuelve slug a negocio, UID token; crea requested. Un dueño no solicita su propio negocio. |
| `DELETE /api/team/memberships/[membershipId]` | `{requestId,expectedMembershipRevision}`; salida/retirada propia. Comprueba memberUid exacto, no ID supuesto. |
| `GET /api/businesses/[id]/team` | Dueño: requested/active de ese negocio, role version1, revisión de estado y últimos20 eventos. Query opcional requestId para su recibo; no devolver perfiles/contactos. |
| `PATCH /api/businesses/[id]/team/[membershipId]` | `{action:'approve'|'reject'|'revoke',requestId,expectedMembershipRevision,expectedTeamRevision,resourceId?}`. ResourceId solo requerido en approve; rol fijo servidor. |
| `GET /api/team/businesses/[id]/agenda?date=YYYY-MM-DD` | Membresía active validada en tx y recurso asignado; día desde hoy hasta hoy+31días. No acepta resourceId/clientUid/view=all. |

GET propio permite query adicional requestId **solo junto a businessSlug** para consultar recibo propio de request/leave; no expone eventos ajenos ni acepta actorUid. Owner GET receipt lookup usa actor dueño/requestId y comprueba ámbito; un recibo de un actor anterior no se revela. DTO de comando devuelve applied `{requestId,commandHash,eventId,membershipRevision,teamRevision,recordedAt}` y proyección actual apropiada al actor, sin prometer que la revisión aplicada siga vigente. Recibo ausente no demuestra que una petición en curso falló.

Listado propio consulta businessMemberships por memberUid, `orderBy('businessId','asc').limit(21)` y continuación `businessId>afterBusinessId`; ID canónico garantiza una fila por negocio/cuenta, validar orden ordinal y cada ámbito. DTO propio solo businessId/businessLabel/status/revision/role/resourceId, más serverNow y scopeUid. Cargar página reemplaza, sin directorio global ni contactos. Consulta específica por slug valida negocio existente y devuelve solo datos públicos mínimos/propios. Los slugs son públicos, el UID no viaja en URL.

Owner roster realiza dos queries limit31 por businessId/status requested|active y valida counts con TeamState;≥31/corrupción implica503, no truncado. Eventos20 ordenados sequenceDESC, sin pretender mostrar auditoría ilimitada. Owner conoce memberUid porque esa cuenta solicitó relación; mostrarlo solo en detalle, no traer email/avatar/perfiles de Auth. No exponer esta respuesta al colaborador por darle acceso a agenda.

Autorización de agenda `assertTeamAgendaAccess(tx,user,businessId,db)` lee negocio+política+estado+membresía+su último evento y consentimiento de cuenta actual. Exige gate, ownerUID de aprobación vigente, rol1 exacto, recurso activo y clasificación configurada general sin menores. No exige plan activo para lectura. Consulta appointments por dateKey y resourceId asignado con limit1000;1000→413, sin huecos falsos. Al revocar/cambiar recurso/política después de una respuesta autorizada no se promete borrar lo que la persona ya vio; siguiente petición revalida y pestaña oculta al conocer denegación. GET concurrente se atribuye a su snapshot, no acceso eterno.

DTO agenda solo `{businessId,businessName,resource:{id,name},dateKey,checkedAt,membershipRevision,rows:[{id,startAt,endAt,status,kind:'appointment'|'manual_block'}]}`; máximo999. Tiempos/tenant/recurso/fecha/ID se validan; corrupción ⇒503 y no vacío. **No** retornar Appointment, client, nombres/contactos de clientes, beneficiary, intake, autorizaciones, precio, serviceName (bloqueos pueden contener motivos privados), auditoría ni eventIDs de atención. Bloqueo se llama «Tiempo bloqueado», cita «Reserva»; ninguna celda libre implica disponibilidad. No inferir atendida por hora ni mostrar capacidad reservable de S09 como dato de persona.

Denegaciones explícitas del rol1: todos los endpoints actuales de dueño (config/logo/FAQ/settings/team, política cliente, resource-schedules, CRM, asistencia, S07/S10, informes/S17, cobros/admin) continúan con dueño exacto y403. GET actual appointments como no dueño sigue siendo solo sus citas como cliente; no ensancharlo. Acciones de una cuenta como cliente legítimo permanecen independientes de ser equipo: su UID no puede modificar citas de terceros por tener membresía. SDK directo permanece denegado a datos de equipo y a citas de otros clientes.

## UI, gate y privacidad de sesión

Dueño: `/dashboard/team` como gestión secundaria desde Mi negocio, en otra pestaña explícita para conservar borrador agregado. Pantalla divide Solicitudes/Accesos en tareas; detalle→cuenta/recurso/permiso exacto→confirmar. Revocar muestra antes/después, sin casillas de módulos futuros. No añadir empleados o vincular recursos al guardar BusinessConfig. Preservar AppShell/brand; resolver activo Mi negocio con businessNavigationPath si ya existe, o añadir ese prop opcional con el mismo contrato de navegación.

Colaborador: `/team` con AuthGate y shell propio mínimo Sarin (Mis espacios/Solicitar acceso/Salir); no usar menú del dueño como si tuviera permisos. Buscar por slug público y comprobar proyección propia, luego botón Solicitar acceso, con indicación «El dueño debe aprobarlo». `/team/[businessId]` muestra solo agenda asignada por día y estado de acceso; sin acciones, contactos o recursos ajenos. Usuario puede ser dueño de A y colaborador de B sin mezclar contextos. No montar copiloto de dueño ni engine health en estas rutas.

Lecturas GET10s con abort/generación y validación DTO, sin datos privados en URL/storage/logs. Scope UID+authEpoch+businessId+membresía; reentrada requiere GET actual. Agenda refresca visible cada15s sin solapar; al recuperar foco revalida antes de mostrar caché. Cada401/403/propiedad/capacidad inválida purga/oculta; red/timeout no convierte acceso en autorizado ni pantalla en huecos vacíos. No afirmar revocación remota instantánea: se aplica en servidor al siguiente acceso y en UI cuando se revalida, con el último checkedAt visible.

Comando único sellado/revisado,20s aviso blando sin abortar escritura por tardar. Error ambiguo conserva requestId/hash/payload, comprobación de recibo o replay exacto; no permite un comando distinto mientras resultado desconocido. Respuesta aplicada antigua se distingue del estado actual. Logout/época cambia purga y descarta tarde; una operación pudo llegar al servidor y su CAS/recibo conserva evidencia. No prometer barrera durable del navegador. Confirmaciones inline y detalles progresivos, foco/errores/44px/320–390px/zoom200; nada sensible permanece portaled desde panel oculto.

Gate `SARIN_TEAM_ACCESS_ENABLED` false por defecto, forwarding/validación booleanos explícitos Worker→Container. False impide solicitar/aprobar/leer agenda de equipo; owner/self todavía pueden leer relación propia y rechazar/revocar/salir. Desactivar gate no devuelve datos ni reactiva invitados. Esta fase no activa equipo por ser dueño, tener recurso o pagar Sarin; no es regla comercial de un plan nuevo.

## Archivos, migraciones y rollback

Nuevo top-level businessMemberships en DATA_COLLECTIONS, child teamAccessEvents en businesses, field memberUid:string en allowlist D1; no ampliar SQL libre ni SDK rules. Índices D1 aditivos `app_team_member` sobre parent/memberUid/businessId/path, `app_team_business_status` sobre parent/businessId/status/path y **`app_team_events_sequence(parent,json_extract(data,'$.sequence') DESC,path)`** para últimos20 eventos del negocio. Índices existentes con conversationId/appointmentId entre parent/sequence no cubren ese orden sin ese filtro. Firestore composiciones equivalentes para memberships y orden single-field sequenceDESC de eventos verificado en su backend. Usar orden de owner roster por path implícito, sin añadir sorted timestamps al protocolo. Seleccionar número siguiente de migración después de reconciliar Attendance/CRM/otras ramas, sin colisión. Backup/reverse migration conservan membresías/estado/eventos; no es exportación para el dueño.

Primero Worker/índices compatibles, app con gatefalse y pruebas restringidas locales, después habilitación futura explícita. Rollback mantiene datos/eventos, deja gatefalse; rutas antiguas continúan owner-only y no interpretan membresías. Si otros incrementos escribieron S09, conservar además su lector al revertir; no volver a base que ignore sus cierres. No purgar solicitudes/recibos ni resetear roles para resolver fallos.

Autorrevisión: la fase1 tiene entrada útil y retiro efectivo sin invitaciones externas, directorio global o permisos fantasma. Propia/ajena/contactos/export/cobros/config están separados; se autoriza antes de producir DTO, no por ocultar botones. Estado/counters/eventos y límites son transaccionales; un rol antiguo no se amplía por nueva versión de código. Quedan deliberadamente fuera contratos de fase2–3, salud/menores/equipo, transferir negocio y toda nómina. Ninguna prueba o activación se presenta ejecutada por escribir este diseño.
