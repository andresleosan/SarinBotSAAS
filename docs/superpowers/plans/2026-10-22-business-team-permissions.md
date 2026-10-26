# Equipo con agenda asignada de solo lectura — Implementation Plan S13 fase1

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. La preparación actual es documental: no ejecutar código/tests/SQL/instalación/commit o despliegue.

**Goal:** Vincular cuentas a un negocio por solicitud/aprobación interna y permitir solo lectura mínima de la agenda asignada, con revocación y denegaciones verificables.

**Architecture:** Membership canónica tenant+UID, rol cerrado version1, estado/counters y eventos/recibos transaccionales. APIs separadas de dueño y colaborador producen DTO mínimos; las rutas existentes siguen owner-only. No invitaciones externas ni campos de equipo dentro de Business/publicBusiness/claims.

**Tech Stack:** Node24, pnpm11.23.0, Next/React/TypeScript/Zod/Vitest existentes, Firebase Auth y Database/D1/Firestore; sin dependencias nuevas.

**Spec:** [2026-10-22-business-team-permissions-design.md](../specs/2026-10-22-business-team-permissions-design.md). El catálogo por fases no concede capacidades de fases2–3 ni modifica el alcance del piloto.

## Global Constraints

- Fuente efectiva reconciliada desde source-restoration463ae55 más navegación/configuración guiada; ejecutar en aislamiento, no E: mixto ni worktree recuperado.
- Node24/pnpm11.23.0, lockfile/brand/tokens conservados, una réplica y engine solo alsdevstudio.com; sin llamadas de IA/health, cobros o mensajes del equipo.
- Rol único own_agenda_viewer/version1, un recurso asignado por dueño; membresía no es recurso, dueño ni rol global. Todas las demás capacidades quedan denegadas.
- Solo general con clasificación configurada y menores deshabilitados para solicitar/aprobar/agenda; recursos activos y ownerUidAtApproval actual. Revocación/salida y lectura propia siguen disponibles cuando gate/plan fallen.
- No modificar assertOwner/requireSuperadmin, claims, roles globales, BookingConfig, publicaciones públicas o reglas SDK para conceder acceso laboral.
- Máximo30 requested y30 active por negocio; solicitudes5/UID/24h y30/negocio/24h, una por UID+negocio/24h. Retiro/rechazo/revocación fuera de rate-limit.
- Toda mutación revisionada+evento/recibo atómico; ningún ID/cursor/UID del navegador concede autoridad; datos sensibles no entran en DTO/logs/URL/storage.
- Gate SARIN_TEAM_ACCESS_ENABLED false inicial y forwarding explícito; nuevos índices/allowlist aditivos, datos/eventos conservados en rollback.

## Review Focus

- Cuenta que solicita no es colaborador hasta aprobación; UID/slug/recurso/rol manipulados y rol superadmin nunca amplían permiso; tareas1–3/5.
- Revocación/transferencia de dueño/clasificación o recurso inactivo con pestaña abierta y token válido: nueva lectura denegada, respuesta tardía no restaura permiso; tareas2–3/5.
- Dos aprobaciones, capacidad30, counter perdido y respuesta de commit perdida: CAS/recibo no duplica acceso ni oculta corrupción; tareas2/4.
- DTO de agenda con bloqueos cuyo serviceName contiene motivo privado: no filtra texto/contactos/menor/precio por datos ocultos; tareas1/3/5.
- Retiro con plan/consentimiento/gate pausado y replay después de revocar: se retira sin reactivar roles antiguos; tareas2–5.

## Archivos y responsabilidades

| Crear/modificar | Responsabilidad |
| --- | --- |
| Crear `src/lib/business-team.ts` | Tipos, catálogo1, schemas puros, canonicalización de comando, proyecciones allowlist y fechas de agenda. |
| Crear `src/lib/server/business-team.ts` | Estado/membership/evento, autorización por tx, request/decisión/salida/listas y recibos. |
| Crear `src/lib/server/team-agenda.ts` | assertTeamAgendaAccess y lectura mínima por recurso asignado, sin API dueña reutilizada con cast. |
| Crear seis rutas de spec | `/api/team/memberships`, `/api/team/requests`, `/api/team/memberships/[membershipId]`, `/api/businesses/[id]/team`, `/api/businesses/[id]/team/[membershipId]`, `/api/team/businesses/[id]/agenda`. |
| Modificar `shared/data-protocol.ts`, `cloudflare/src/data.ts` | Nuevo top businessMemberships, child teamAccessEvents, campo memberUid:string consultable. No SQL libre. |
| Modificar `cloudflare/src/router.ts`, `cloudflare/wrangler.jsonc` | Forward y validación booleanos del gate, defaultfalse. |
| Crear siguiente migración D1 `*_business_team.sql`, modificar `firestore.indexes.json` | Índices aditivos de búsquedas propias y roster dueño; reconciliar número después de Attendance/CRM/otras ramas. |
| Crear `src/hooks/use-business-team.ts`, `src/components/business-team-workspace.tsx`, `src/app/dashboard/team/page.tsx` | Gestión dueña por solicitud/recurso/confirmación y retiro. |
| Crear `src/hooks/use-team-workspace.ts`, `src/components/team-workspace-shell.tsx`, `src/components/team-assigned-agenda.tsx`, `src/app/team/page.tsx`, `src/app/team/[businessId]/page.tsx` | Espacios propios, solicitud por slug y agenda mínima; no menú/copliloto de dueño. |
| Modificar `src/components/owner-configuration-workspace.tsx`, `src/components/app-shell.tsx` si hace falta | Enlace secundario a Equipo sin guardar configuración; contexto Mi negocio compatible con businessNavigationPath existente. |
| Crear pruebas `tests/business-team-model.test.ts`, `business-team-domain.test.ts`, `business-team-routes.test.ts`, `business-team-denials.test.ts`, `business-team-d1.test.ts`, `business-team-owner-ui.test.tsx`, `team-workspace.test.tsx` | Contratos, permisos/estados/carreras, UI/ámbito/DTO. |
| Ampliar `tests/firestore.rules.test.ts`, `tests/firestore.integration.test.ts`, `tests/data-migration.test.ts`, `cloudflare/tests/data.test.mjs`, `cloudflare/tests/router.test.mjs` | SDK denegado, APIs Firebase, índices/protocolo/gate, backup con nuevos documentos. |

No editar APIs actuales para aceptar `owner || member`. La matriz de denegaciones se prueba con membresía real activa; un mock que hace owner al staff no demuestra nada. Si S09/FAQ/S17 ya están integrados, conservarlos y reconciliar AppShell/allowlist, sin sobrescribir ramas.

### Task1: Contrato de membresía y DTO sin datos de clientes

**Files:** modelo puro/modeltests. **Produces:** tipos de spec y tipos siguientes:

```ts
type TeamSelfRequestCommand = { businessSlug: string; requestId: string; expectedMembershipRevision: number };
type TeamLeaveCommand = { requestId: string; expectedMembershipRevision: number };
type TeamOwnerDecisionCommand =
  | { action: 'approve'; requestId: string; expectedMembershipRevision: number; expectedTeamRevision: number; resourceId: string }
  | { action: 'reject' | 'revoke'; requestId: string; expectedMembershipRevision: number; expectedTeamRevision: number };
type TeamSelfMembership = {
  membershipId: string; businessId: string; businessLabel: string; status: TeamMembershipStatus;
  revision: number; role: TeamRole | null; resourceId: string | null; updatedAt: number;
};
type TeamOwnerMembership = TeamSelfMembership & { memberUid: string };
type TeamApplied = { requestId: string; commandHash: string; eventId: string; membershipRevision: number; teamRevision: number; recordedAt: number };
type TeamMutationResult = { applied: TeamApplied; replayed: boolean; teamRevision: number } & (
  | { audience: 'member'; current: TeamSelfMembership }
  | { audience: 'owner'; current: TeamOwnerMembership }
);
type TeamAccessEventView = {
  id: string; sequence: number; membershipId: string; memberUid: string; actorUid: string;
  beforeStatus: TeamMembershipStatus | null; afterStatus: TeamMembershipStatus;
  role: TeamRole | null; resourceId: string | null; recordedAt: number;
};
type TeamAgendaView = {
  businessId: string; businessName: string; resource: { id: string; name: string };
  dateKey: string; checkedAt: number; membershipRevision: number;
  rows: { id: string; startAt: number; endAt: number; status: Appointment['status']; kind: 'appointment' | 'manual_block' }[];
};
teamAccessCommandCanonicalString(input: {
  kind: 'request' | 'leave' | 'approve' | 'reject' | 'revoke'; businessId: string; actorUid: string;
  requestId: string; expectedMembershipRevision: number; expectedTeamRevision: number | null; resourceId: string | null;
}): string;
```

ResourceId/role de requested son null, active exige role1/asignación/owner válido. Schemas de DTO diferencian current propio (prohíbe memberUid/actor) del dueño, nunca hacen spread de entidad privada. Strings/IDs con comprobación completa y sin controles; límites de revisión≤MAX_SAFE_INTEGER−2 para entradas y antes de incremento. No importar server/client-policy al modelo cliente; reutilizar o replicar allí la regla pura exacta de UID, servicio puede usar la existente.

- [ ] Escribir `onlyRoleVersionOneGrantsOwnAgenda`, `unknownRolesNeverInherit`, `requestedIsNotAccess`, `resourceNameCannotProveAccountIdentity`, `strictCommandsDoNotAcceptMemberUidOrRole`, `canonicalHashCoversActorScopeRevisionAndResource`, `privateMembershipNeverSpreadToSelfDto`, `agendaProjectionDropsContactMinorIntakePriceServiceAndReasons`, `unknownTimesAndScopesFailClosed`.
- [ ] Fixture sintético dueñoA, staffU, clienteC, superadminS y dueñoB; recurso estaciónA yprofesionalB. StaffU puede tener cuenta dueña en B sin privilegio adicional en A; no comparar nombres. Probar nombre de bloqueo con marcador privado y todos los campos Appointment sensibles ausentes por claves exactas en DTO.
- [ ] Ejecutar `pnpm exec vitest run tests/business-team-model.test.ts`; RED nuevas capacidades, implementar tipos/schemas/proyecciones/canonical y GREEN. Commit futuro `feat: define tenant team memberships and minimal agenda DTOs`.

### Task2: Estado transaccional, aprobación y retiro verificables

**Files:** business-team server/domain tests. **Consumes:** requireUser actor, assertOwner/assertConsent/readBookingDataPolicy/isSubscriptionAllowed, Database/Transaction/stableDocumentId. **Produces:**

```ts
requestTeamAccess(actor: ChatActor, command: TeamSelfRequestCommand, db?: Database): Promise<TeamMutationResult>;
decideTeamAccess(owner: ChatActor, businessId: string, membershipId: string, command: TeamOwnerDecisionCommand, db?: Database): Promise<TeamMutationResult>;
leaveTeamAccess(actor: ChatActor, membershipId: string, command: TeamLeaveCommand, db?: Database): Promise<TeamMutationResult>;
readOwnTeamMemberships(actor: ChatActor, input: { afterBusinessId?: string; businessSlug?: string; requestId?: string }, db?: Database): Promise<TeamMembershipPage>;
readOwnerBusinessTeam(owner: ChatActor, businessId: string, requestId?: string, db?: Database): Promise<OwnerBusinessTeamView>;
```

Definir en modelo `TeamMembershipPage={scopeUid:string;items:TeamSelfMembership[];serverNow:number;applied:TeamApplied|null} & ({mode:'page';nextAfterBusinessId:string|null;target:null}|{mode:'business';nextAfterBusinessId:null;target:{businessId:string;businessName:string}|null})`; búsqueda por businessSlug devuelve0/1items, nunca datos de otra cuenta. `OwnerBusinessTeamView={businessId:string;ownerUid:string;teamRevision:number;requested:TeamOwnerMembership[];active:TeamOwnerMembership[];events:TeamAccessEventView[];serverNow:number;enabled:boolean;eligible:boolean;applied:TeamApplied|null}`. Events solo last20 de ese negocio, proyección exacta de Task1 sin cuerpos/contactos/hash privado. No declarar audiencia member como union que acepte DTO dueño con campos extra; schema discriminado por audience y validado contra operación/ruta.

- [ ] Escribir tabla completa de estados: crear requested por cuenta propia; dueño aprobarrequested→active con recurso activo y role1 fijo; rechazarrequested; revocaractive; salidarequested/active propia; nuevos requestID contra mismo estado⇒409 TEAM_NO_CHANGE. Replay del comando exacto anterior devuelve recibo+current, nunca restaura el estado anterior. Aprobar miembro propio del dueño⇒409 TEAM_ALREADY_OWNER.
- [ ] Escribir `ownerUidAndBusinessAlwaysRevalidated`, `requestCannotAssignRoleResourceOrOtherUid`, `requestBySlugDoesNotEnumerateAccounts`, `memberCannotApproveSelf`, `twoApprovalsRespectThirtyActive`, `pendingLimitThirty`, `missingStateWithExistingMemberFails503`, `corruptCounterHeadOrFutureRateEventFailsClosed`, `receiptAndMembershipAndCountersCommitTogether`, `sameIdOtherCommand409`, `replayAfterRevocationStaysRevoked`.
- [ ] Implementar todas las lecturas antes de writes. Resolver slug vía businessSlugs, comprobar Business/owner/classificación, canonical membership/state/cabeza/recibo; receipt idéntico se devuelve después de autoridad vigente sin volver a exigir plan para reconocer operación previa. Comando nuevo exige revisiones/tabla. Actualizar contadores: requested al solicitar; requested−1/active+1 al aprobar; requested−1 al rechazar/retirar; active−1 al revocar/salir. Re-request limpia rol/recurso/owner a null, nueva revisión, conserva createdAt e historia, y actualiza lastRequestedAt. Otras acciones conservan lastRequestedAt. Cabeza valida membershipRevision/rol/estado, sequence≤TeamState.revision y activeCount≥1 si active (requestedCount≥1 si requested), sin scan nuevo.
- [ ] Gate false impide request/approve, pero no read own/owner ni reject/revoke/leave. Request/approve exige clasificación configurada general/no minors, consentimiento actual del solicitante/dueño y plan; leave/reject/revoke no exige plan/gate/consentimiento de escritura nuevo. No modificar consentimientos ni crear business_client del staff. Validar operatorUID de cada evento y lastEventhead; transferencia owner suspende lectura futura sin borrar historia.
- [ ] Rate-limit transaccional:5porUID/24h,30pornegocio/24h y una porUID+negocio/24h con reloj servidor. Cooldown del par usa lastRequestedAt explícito, no createdAt ni lastEventId que puede apuntar a revoke; requestHash=SHA256(JSON.stringify([memberUid,businessId,requestId])). Replay antes de admisión no consume. Probar `requestApproveRevokeThenRerequestBefore24hIsLimited` y límite exacto24h; acciones intermedias no cambian lastRequestedAt. Podar eventos vencidos al mutar, no diario en memoria. Rechazo429 con Retry-After y cero cambios de membership/event; revocar/rechazar/salir nunca consulta bloqueo de admisión. No reutilizar prepareBookingActionAdmission con kind inventado.
- [ ] Listas: propia memberUid ordenbusinessId20+lookahead, cursor exacto y comprobación de cada cuenta/orden; roster dos queries limit31 de requested/active, counts exactos comparados con estado y≥31 error503. Cabeza20eventos se valida en ámbito, no promete historial global. No consultar perfiles/Google Auth ni todo usuarios. Ejecutar dominio hasta GREEN. Commit futuro `feat: manage scoped team requests approvals and revocation`.

### Task3: Transporte, agenda propia y matriz de denegaciones

**Files:** seis rutas, team-agenda server, tests routes/denials; allowlist/data/gate/indexes. **Produces:**

```ts
assertTeamAgendaAccess(tx: Transaction, actor: ChatActor, businessId: string, db: Database): Promise<{ business: Business; membership: BusinessTeamMembership; resource: TenantResource }>;
readTeamAssignedAgenda(actor: ChatActor, businessId: string, dateKey: string, db?: Database): Promise<TeamAgendaView>;
```

- [ ] Route tests: seis métodos exactos de spec, cuerpo strict4096bytes, queries únicas, requestId/rango/slug/ID completos, no-store y códigos401/403/404/409/413/415/428/429/503. Staff body nunca elige UID ni resource; own receipt solo requestId+businessSlug, ownerreceipt actor dueño. WebCrypto verifica commandHash antes de anunciar aplicación; no exponer hash/actor de recibos de otros.
- [ ] Agenda valida gate+estado+membership/head+Business/ownerAtApproval+recurso+clasificación+consentimiento en la misma tx. Fecha Colombia hoy..hoy+31, ninguna otra query. Leer appointments dateKey+recurso, limit1000 y1000→413; DTO solo datos mínimos. Cita corrupta no se omite fingiendo libre. Estado unknown/type/tiempos/tenant/id/recurso inválidos⇒503; canceladas conservan etiqueta, sin porcentaje de ocupación. Read-only no escribe locks/cuotas/resultados.
- [ ] Con membership active real, probar acceso403 a owner BusinessConfig/logo, client-policy/resource-schedules, attendance/representation-review, CRM/S07/S10, FAQ settings, S17 y admin/pagos. Testear cada ruta existente al integrar su módulo; rutas aún ausentes no se declaran protegidas por un test404, se conservan como requisito hasta integrarlas. Cliente legítimo del staff puede seguir leyendo/cancelando **su** reserva por rutas cliente, sin heredar otra cita de su recurso.
- [ ] Añadir DATA_COLLECTIONS.businessMemberships, DATA_CHILDREN.businesses.teamAccessEvents y field memberUid:string. Nuevos índices D1 `app_team_member(parent,json_extract(data,'$.memberUid'),json_extract(data,'$.businessId'),path)`, `app_team_business_status(parent,json_extract(data,'$.businessId'),json_extract(data,'$.status'),path)` y `app_team_events_sequence(parent,json_extract(data,'$.sequence') DESC,path)`. Firestore: memberUid ASC,businessId ASC; businessId ASC,status ASC; orden sequenceDESC de eventos validado en backend. Owner roster sin orden explícito de timestamp; perfil público no recibe campos privados.
- [ ] Gate defaultfalse en wrangler vars y runtimeKeys/validacióntrue|false de router.ts; no argumento público de build. Ejecutar futuro `pnpm --filter sarin-cloudflare-host run types` si binding generado lo requiere, revisar diff de solo flag no secreto. Mantener reglas SDK actuales denegadas a top/child y citas ajenas, incluso miembro activo. No ampliar assertOwner, requireSuperadmin o users.role.
- [ ] Ejecutar `pnpm exec vitest run tests/business-team-model.test.ts tests/business-team-domain.test.ts tests/business-team-routes.test.ts tests/business-team-denials.test.ts`; GREEN. Commit futuro `feat: authorize minimal assigned team agenda without owner bypass`.

### Task4: Concurrencia, índices y revocación en almacenamiento real

**Files:** D1test/Firestore/rules/data-migration/data/router suites de tabla.

- [ ] Dos handles D1 con createDataTestRuntime y createCloudflareDatabase, fixture demo: competir approve con revoke/leave sobre mismo miembro y con último cupo30. Verificar eventos/counters/cabeza consistentes y un solo estado final. Drop de respuesta tras commit y replay exacto conserva revisión única; replay aprobación después de revocar retorna aplicada antigua+currentrevoked, no re-activa.
- [ ] Pausar lectura de agenda tras membership read, revocar desde segundohandle y continuar: resultado atribuible a una revisión válida o retry/403, nunca mezclar recursos/DTO de revisiones. Cambiar ownerUid, dataMode/menores y active recurso produce denegación en nueva petición con mismoJWT. Cita/motivo privado jamás llega al DTO.
- [ ] EXPLAIN SQL de queries reales propias/roster usa índices previstos;21/31límites no equivalen a scan global. Sembrar1001 teamAccessEvents de un negocio y comprobar últimos20 en sequenceDESC usando app_team_events_sequence, sin depender de índices con conversationId/appointmentId. Probar `headSequenceCannotExceedTeamRevision` y `activeMembershipWithZeroActiveCountFailsClosed`. Sembrar otras cuentas/negocios para aislamiento/capacidad. Default missing-policy es inelegible para equipo; corrupción estado/head falla503.1000filas agenda⇒413, no truncado.
- [ ] Firestore Admin emulador reproduce approval/leave CAS, pertenencia/owner stale y readerDTO; Rules test demuestra que staff active no lee raw membership/eventos/citas de otros por SDK. Backup/migración sintéticos conservan top/state/events, sin imprimir UID/datos. Migraciones nuevas aditivas se numeran sin pisar CRM/Attendance y rollback conserva índices.
- [ ] Ejecutar `pnpm exec vitest run tests/business-team-d1.test.ts tests/business-team-denials.test.ts tests/data-migration.test.ts`, `pnpm run test:rules` (Java21+/proyectos demo), `pnpm --filter sarin-cloudflare-host test`. Registrar RED/GREEN reales y gates sin ejecutar pendientes. Commit futuro `test: verify tenant team isolation revocation and replay`.

### Task5: UI por rol, sesión y recuperación

**Files:** hooks/vistas/rutas owner/team de tabla, enlaces secundarios y pruebas UI.

**Interfaces:**

```ts
useBusinessTeam(input: { businessId: string; ownerUid: string; authEpoch: number; enabled: boolean }): {
  view: OwnerBusinessTeamView | null; loading: boolean; busy: boolean; error: string | null;
  refresh: () => Promise<void>;
  decide: (membershipId: string, command: TeamOwnerDecisionCommand) => Promise<void>;
  inspectPending: () => Promise<void>; retryPending: () => Promise<void>;
};
useTeamWorkspace(input: { uid: string; authEpoch: number; businessId?: string; enabled: boolean }): {
  page: TeamMembershipPage | null; agenda: TeamAgendaView | null; loading: boolean; busy: boolean; error: string | null;
  checkBusiness: (slug: string) => Promise<void>; loadMemberships: (afterBusinessId?: string) => Promise<void>;
  requestAccess: (command: TeamSelfRequestCommand) => Promise<void>;
  leave: (membershipId: string, command: TeamLeaveCommand) => Promise<void>;
  readAgenda: (dateKey: string) => Promise<void>; inspectPending: () => Promise<void>; retryPending: () => Promise<void>;
};
BusinessTeamWorkspace(props: { businessId: string; ownerUid: string }): ReactNode;
TeamAssignedAgenda(props: { view: TeamAgendaView | null; loading: boolean; error: string | null; onDateChange: (dateKey: string) => void }): ReactNode;
```

Componentes obtienen authEpoch/useAuth vigente o reciben controlador propio; no auth global nueva. El comando revisado incluye expectedRevision/state del snapshot mostrado. Durante hashing async bloquear edición de esa operación y revalidar scope antes de enviar. Solo una operación pendiente por controlador;20s aviso blando no abort; ambiguo sella payload/requestId y permite solo inspección/replay exacto, sin inferir saved por contenido. Nuevo estado/recibo aplicado antiguo se explican separados. GET10s cleanup, generación UID/epoch/business/member/date, datos enmascarados durante render;401/403 purga. La memoria no es almacenamiento durable.

- [ ] Tests owner: `requestDoesNotGrantBeforeExplicitApproval`, `onlyAssignedResourceAndReadRoleInReview`, `wrongOrInactiveResourceCannotApprove`, `revocationReviewShowsBeforeAfter`, `planGateAndConsentDoNotBlockWithdrawal`, `secondaryTeamLinkDoesNotSaveConfiguration`, `oldReceiptDoesNotShowActiveAgain`, `sameUidOwnershipLossPurgesPrivateRoster`.
- [ ] Tests staff: `requestUsesTokenIdentityOnly`, `pendingIsNotAgenda`, `spacesAreOwnAndPaged`, `assignedAgendaHasNoOwnerMenusContactsReasonsOrActions`, `otherResourceCannotBeChosenByQuery`, `sameUidNewEpochAndLateReadsCannotRestoreAccess`, `focusReentryVerifiesBeforeShowingCache`, `gatePolicyOrResourceDenialClearsAgenda`, `networkErrorIsNotEmptySlots`, `leavingDoesNotChangeClientBookings`.
- [ ] Owner UI: Solicitudes/Accesos separados, detalle de UID para contrastar y recurso+permiso fijo, confirmación inline; actividad últimos20 plegada y sin contactos. Nueva ruta usa shell propio actual con contexto Mi negocio; enlace secundario desde configuración abre pestaña nueva anunciada, no pierde draft y no cambia BusinessConfig.
- [ ] Staff UI: /team propia y /team/:businessId con TeamWorkspaceShell reutilizando marca/tokens/UserAvatar/AuthGate, navegación mínima. Comprobar slug→revisar negocio/relación→solicitar, sin QR secreto/email/invitación externa. Mis espacios reemplaza páginas20filas; agenda un día/recurso, revisión15s solo visible no solapada y al foco antes de mostrar caché. ConsentPanel existente cuando el propio usuario necesite renovar cuenta, nunca aceptar por él.
- [ ] Teclado/móvil320/390/zoom200, error/vacío/pausa/revocación/busy claros. Ningún diálogo/aria-live de panel oculto; salir/ruta desmonta y limpia. «Sin reservas» solo tras lectura autorizada completa, sin afirmar disponibilidad de celdas. No llamada al motor/health por estos componentes. Ejecutar `pnpm exec vitest run tests/business-team-owner-ui.test.tsx tests/team-workspace.test.tsx tests/owner-configuration-workspace.test.tsx tests/workspace-navigation.test.tsx`; RED→GREEN. Commit futuro `feat: guide internal team access and assigned agenda`.

### Task6: Gates de rama y activación posterior

- [ ] Ejecutar focalizadas, `pnpm test`, `pnpm run typecheck`, `pnpm run build`, `pnpm --filter sarin-cloudflare-host run check`; emulador de tarea4 repetir solo si cambió su código. Conservar gatefalse por defecto; una UI visible no acredita permisos efectivos.
- [ ] QA sintética con sesiones realmente distintas dueño/staff/cliente/otro dueño/superadmin, tokens válidos tras revocación y sin exposición en SDK/rutas. Registrar fuente/runtime compuesto, permisos autorizados/denegados, problemas/mediciones e índices; no clientes reales, contactos, emisiones, pagos o inferencia. Crear `qa/tests/business-team-permissions.md` y evidencia real en `docs/qa/2026-10-22-business-team-permissions.md` durante ejecución.
- [ ] Revisión independiente completa de los cinco Review Focus antes de habilitar gate. Worker/índices primero, app compatible después. Retiro sigue disponible con gatefalse; rollback conserva membership/state/events y lector S09 si se integró. No reparar contadores, borrar eventos o promover roles con scripts improvisados para volver verde.
- [ ] Cerrar solo fase1. Cualquier fase2/3 necesita spec/plan propio para scopes de datos/acciones existentes y pruebas de retiro; no habilitar contactos, exportación, cobro/config por pertenecer al equipo. Commit futuro `docs: verify minimal tenant team access and rollback`.

## Autorrevisión

Identidad/DTO en1; transiciones/recibos/counters en2; autorización/denegaciones/transporte en3; carreras/índices/backend en4; UI/ámbito/reentrada en5; evidencia/gate en6. Los estados y roles futuros no aparecen como concedidos. La solicitud interna evita transporte de invitaciones/códigos sin convertir un slug en permiso. El dueño no pierde su autoridad actual y staff no usa sus endpoints como sustituto de permisos. Esta documentación no ejecutó pruebas, migró datos ni activó miembros.
