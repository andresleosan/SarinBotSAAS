# Reprogramación del dueño: misma cita y confirmación recuperable

Diseño arquitectónico S07 del 22 de octubre de 2026, Colombia, preparado por delegación explícita del titular con brainstorming y writing-plans. Acompaña el [plan](../plans/2026-10-22-owner-rescheduling.md). Solo documentación: no se implementa, ejecuta, instala, publica o crea un commit en este encargo.

**Delta S05 revisado:** el origen confirmed puede conservar una cabeza válida de Quitar resultado después de terminar el margen. Reconocerlo como pasado, sin borrar auditoría ni permitir moverlo. Revisión independiente de admin_audit_scope cerrada sin P1/P2 pendientes conocidos el22/10; no cambia el alcance futuro ni acredita ejecución.

## Resultado y alcance elegido

El dueño vigente debe poder cambiar fecha, hora o recurso de una cita futura confirmada de su negocio, revisar antes/después y confirmar sin crear otra cita ni consumir otra unidad. Si falla la operación, el origen permanece; si la respuesta se pierde, se recupera la misma operación. No se suplanta la cuenta del cliente para utilizar su endpoint.

Primer incremento: negocio general sin reservas de menores habilitadas, cita sin beneficiario declarado o con beneficiario `self`, sin autorización sensible/revisión de representación. Salud y menores conservan consulta, cancelación y revisión actuales; **esta nueva acción no se habilita para ellos**. El alcance está cerrado y ejecutable, no se presenta como reprogramación universal. No incluye servicio distinto, otra sede, cita ya iniciada, bloqueos, series, arrastre, sobreasignación, mensajes externos, cobros ni un plazo configurable nuevo.

Se conserva el servicio por ID y se utiliza su catálogo vigente para duración, preparación, nombre y precio, igual que la reprogramación propia actual. La revisión muestra cualquier diferencia de precio; confirmar no cobra ni reembolsa. Se conserva cliente, contacto, respuestas históricas, creador y demás metadatos; la UI no pide rellenarlos de nuevo.

## Base, alternativas y composición

Fuente leída en solo lectura: `C:/Users/Drean Skate/AppData/Local/SarinBot/whatsapp-adaptation-20261020/source-restoration`, pin `463ae55f8c873468980746185fb3e91f55cb8681`; runtime documentado `c8bb0a99d9ac2bb20acaef2e5a157b0ff83b05f2`, sin verificación remota nueva. E: es un checkout mixto documental y no es base ejecutable. Antes de ejecutar, reconciliar fuente efectiva y aislar rama sin modificar el worktree recuperado.

Base compuesta elegida: **Agenda → Estados de atención, tareas1–6 del núcleo → Turnos/cierres S09 → Reprogramación S07**. Consumir los contratos de [Agenda](2026-10-22-owner-agenda-design.md), [Estados](2026-10-22-owner-attendance-and-client-record-design.md), [Turnos/cierres](2026-10-22-resource-schedules-and-closures-design.md) y su [plan](../plans/2026-10-22-resource-schedules-and-closures.md); sus interfaces acordadas se fijan abajo. S07 base no espera Task7 de Estados: esa habilitación de quitar sucede después de S12 completo y aplica conjuntamente el delta de lectura S07. S09 también depende de configuración guiada, que se integra antes. No recrear tarjetas, pollers, políticas o editores.

| Fuente real | Contrato que se conserva |
| --- | --- |
| `src/lib/server/appointment-rescheduling.ts` | Cliente propio, misma cita, revisión y fingerprint completos del origen, origen/destino/cliente con locks. No convertir su actor cliente en dueño. |
| `src/lib/server/booking-proposals.ts` | Propuesta con vigencia de diez minutos, revisión de catálogo, prueba persistida de cambio y replay que devuelve cita actual. Su recuperación exige `appointment.client.uid`; no reutilizarla con identidad inventada. |
| `src/lib/appointment-reschedule.ts` | Selección estricta y `RescheduleResult`; `canRescheduleSubscription` permite suscripción, prueba pagada y prueba agotada. |
| `src/lib/server/bookings.ts` | Reservar crea/consume unidad; cancelar no la devuelve. Reprogramar no llama a creación ni toca negocio/proyección/cuota. |
| `src/lib/sarin/availability.ts` | Recursos activos/asignados, intervalos efectivos, tiempos de Colombia y colisiones con margen; S09 integra política de turnos requerida. |
| `src/lib/server/booking-data-policy.ts`, `booking-subject-consent.ts` | Política corrupta falla cerrada; autorizaciones sensibles están ligadas al caso del cliente. No emitir ni renovar una desde la acción del dueño. |
| `shared/data-protocol.ts`, `firestore.rules` | Hijo privado nuevo exige allowlist del Worker; navegador no escribe y no lee subcolecciones no permitidas. |
| `tests/appointment-reschedule-contract.ts`, `.integration.test.ts` | Ejemplos reales de D1 local, dos handles, carreras, commit perdido y replay tras otro movimiento; reutilizar patrón, no suplantar actor ni dar un mock por prueba de D1. |

Alternativas: **elegida**, propuestas privadas del dueño y dominio separado que comparte primitivas puras, revisión/fingerprint y locks; mantiene intacto el cliente. Ampliar el discriminante de las propuestas actuales afectaría autorizaciones estructuradas y recuperación del cliente; se descarta para este incremento. PATCH directo sin propuesta simplifica pantalla, pero pierde revisión, cierre de expiración y prueba recuperable; se descarta.

## Restricciones globales

- Node 24 y pnpm 11.23.0; conservar lockfile y no añadir dependencias.
- Fuente efectiva reconciliada y rama aislada; nunca ejecutar o publicar desde E: mixto.
- Hora de Colombia `America/Bogota`; reloj y autorización del servidor.
- Solo dueño vigente; superadministrador, recurso y supuesto empleado no sustituyen esa autoridad.
- Sin inferencia, pagos, mensajes externos, alta de citas, cuota adicional o modificación del cliente.
- Misma cita, servicio e identidad de beneficiario; no modificar cancelación, asistencia o reprogramación propia del cliente.
- Datos, actor y prueba de operación privados; no contactos, selección, texto libre o beneficiarios en URL, logs o almacenamiento del navegador.
- UI con identidad/tokens Sarin, guía progresiva, revisión explícita y controles de 44 px.

## Elegibilidad, autoridad y tiempo

Lectura del origen y de un recibo: dueño vigente del negocio, IDs/tenant exactos y esquema verificable; no añadir barrera de suscripción o consentimiento a la lectura histórica. Preparación/confirmación nueva: consentimiento de cuenta del dueño activo, negocio configurado, `canRescheduleSubscription` vigente y política leída dentro de la transacción. No exigir consentimiento `business_client` al dueño ni actuar con el UID del reservante. Un replay aplicado es lectura: se permite con plan vencido/consentimiento retirado, conservando dueño y actor de la propuesta.

La política debe ser general y `representedMinorsEnabled === false`; ausencia válida conserva el contrato actual de revisión cero/general, corrupción/error produce 503. No aceptar `subjectAuthorization` o `representationReview` presentes, ni beneficiario distinto de self. No modificar esos campos para habilitar la acción. La cita puede carecer de cliente; si tiene `client`, su UID debe pasar `clientUidSchema` y no contener ningún carácter de control U+0000–U+001F/U+007F, incluido salto final que el ancla `$` del schema podría admitir. Rechazar, sin recortar/normalizar/fabricar UID ni omitir su lock como si faltara cliente. El dueño gestiona una cita existente: no aplicar bloqueo del cliente o límite de nuevas citas como permisos del dueño; no levantar el bloqueo ni crear otra cita. Los endpoints del cliente conservan sus restricciones.

Origen: `type=appointment`, `status=confirmed`, revisión válida y menor que `MAX_SAFE_INTEGER - 1` antes de incrementar. Tiempos enteros seguros, positivos y coherentes `startAt < endAt <= reservedUntilAt`; `dateKey`/hora de inicio corresponden al timestamp colombiano y la hora final al final guardado. Permitir 24:00 únicamente si equivale a medianoche del día siguiente; mostrar fecha final cuando cruce de día. Un precio presente debe ser finito/no negativo. Si attendance está presente, leer en la misma transacción `readVerifiedAttendanceHead(tx,db,businessId,appointment)` de S05: solo una cabeza confirmed válida desde completed/no_show con recording_error y snapshot exacto explica ese estado. Ese origen acredita un intervalo terminado y devuelve ineligibilidad source_started; jamás prepara/confirma movimiento, incluso si el reloj retrocede. No borrar metadatos ni declarar cualquier confirmed auditado corrupto. Cabeza ausente/corrupta, terminal o incoherente sigue503. No exigir recurso de origen activo o existente para mover una cita histórica. El servicio sí debe seguir existiendo y validar el schema vigente; no sustituirlo por el primero. Un objeto histórico corrupto queda consultable en agenda, pero no se mueve mediante este flujo.

Solo `startAt > now` y nuevo inicio futuro; comprobar otra vez tras lecturas y antes de writes en cada intento transaccional. No se adopta el override manual de Fresha ni se permite mover retrospectivamente. No hay un plazo cliente configurable en la base: su límite actual es no haber iniciado, además de sus permisos/políticas. No inventar una opción para ignorar un plazo inexistente.

Destino: recurso actual activo/asignado al mismo servicio, día válido hasta `now + 366 días`, franja ofrecida por `getAvailableSlots` con servicio completo y preparación. Excluir únicamente el ID del origen de la ocupación del destino. Mismo día/hora/recurso es `OWNER_RESCHEDULE_NO_CHANGE`. Recurso inactivo o eliminado no recibe la cita; origen retirado puede trasladarse a un destino vigente. Sin override de cierres, turnos, conflictos o margen.

## Contrato de S09 y huellas

Consumir `ResourceSchedulePolicy` de `src/lib/resource-schedules.ts` y, en servidor:

```ts
readResourceSchedulePolicy(tx: Transaction, businessId: string, db: Database): Promise<ResourceSchedulePolicy>;
resourceDayScheduleFingerprint(business: Business, policy: ResourceSchedulePolicy, resourceId: string, dateKey: string): string;
```

`getAvailableSlots` recibe `resourceSchedulePolicy` requerido tras integrar S09. Ausencia de registro produce política válida revisión cero/herencia; fallo/corrupción no hereda silenciosamente. Disponibilidad, preparación y confirmación leen política en su misma transacción. La propuesta guarda la huella del día/recurso destino; se compara en confirmación, además de volver a evaluar disponibilidad. Un cambio cualquiera de revisión de política invalida conservadoramente conforme al contrato S09; no basta que el nuevo horario todavía contenga la hora elegida.

Origen usa `appointmentRescheduleFingerprint` existente, que incluye el registro completo y revisión normalizada. El comando enlaza esa huella a la copia leída en este flujo; si cambia contacto, asistencia, representación, estado o revisión, no se mueve sobre una revisión ignorada. Huella de catálogo adicional: `bookingSubjectHash({ service: servicioValidado, resource: recursoValidado })`; precio/duración/preparación/nombre o asignación cambiados exigen nueva revisión. El fingerprint del comando es hash canónico de IDs, revisión/huella esperadas y selección, nunca del token o cuerpo de chat.

## Contratos de lectura, propuesta y confirmación

Tipos compartidos nuevos en `src/lib/owner-rescheduling.ts`, schemas strict; no ampliar `ChatResponse`, `ChatSelection` ni las propuestas del cliente. Reutilizar `rescheduleSelectionSchema`, `rescheduleResultSchema`, `documentIdSchema` y `requestIdSchema` donde corresponda. Schemas de servidor permanecen fuera del bundle cliente.

```ts
type OwnerRescheduleExpectation = { sourceRevision: number; sourceFingerprint: string };
type OwnerRescheduleTarget = { dateKey: string; startTimeStr: string; resourceId: string };
type OwnerRescheduleCommand = OwnerRescheduleExpectation & { requestId: string; selection: OwnerRescheduleTarget };
type OwnerRescheduleIneligibility = 'restricted_policy' | 'source_started' | 'unsupported_source' | 'service_unavailable' | 'subscription_unavailable' | 'business_unconfigured';
type OwnerRescheduleSource = { appointment: Appointment; expectation: OwnerRescheduleExpectation; eligible: boolean; reason: OwnerRescheduleIneligibility | null };
type OwnerRescheduleProposalView = {
  id: string; businessId: string; appointmentId: string; requestId: string;
  sourceRevision: number; sourceFingerprint: string; expiresAt: number;
  source: { dateKey: string; startTimeStr: string; endTimeStr: string; startAt: number; endAt: number; reservedUntilAt: number; resourceId: string; resourceName: string; priceCOP: number | null };
  target: OwnerRescheduleTarget & { serviceId: string; serviceName: string; resourceName: string; endTimeStr: string; startAt: number; endAt: number; reservedUntilAt: number; durationMinutes: number; bufferMinutes: number; priceCOP: number };
};
type OwnerRescheduleRecovery = { proposal: OwnerRescheduleProposalView; state: 'prepared' | 'closed' | 'applied'; appointment: Appointment; result: RescheduleResult | null };
```

`reason` contiene un código cerrado de elegibilidad, no texto libre; fuente inválida devuelve 503, no eligible=false que simule ausencia. Las etiquetas de recurso de origen retirado usan «Recurso anterior no disponible»; no revelar datos de otro recurso. Fuente de precio ausente es null, nunca cero inventado. Fechas/horas se validan con utilidades existentes; fin calculado debe representar el mismo final positivo que el timestamp mostrado. En destino, endAt-startAt coincide con durationMinutes y reservedUntilAt-endAt con bufferMinutes; la prueba usa esos timestamps exactos. Fuente conserva sus timestamps/margen guardados, sin recalcularlos con catálogo.

Rutas nuevas bajo `/api/businesses/[id]`, `runtime=nodejs`, `dynamic=force-dynamic`, `Cache-Control: no-store` también en errores. Todas usan requireUser, assertOwner, validación de IDs, readJson y apiError; rechazan querystring y campos extra:

| Método y sufijo | Cuerpo / respuesta |
| --- | --- |
| GET `appointments/[appointmentId]/owner-reschedule` | Sin cuerpo. Devuelve `OwnerRescheduleSource` con lectura fresca; elegibilidad no altera cita. |
| POST `appointments/[appointmentId]/owner-reschedule/availability` | Expectativa + dateKey y resourceId opcional. Máximo 2.048 bytes. Devuelve `{ availability }`; no crea propuesta. |
| POST `appointments/[appointmentId]/owner-reschedule/proposals` | `OwnerRescheduleCommand`, máximo 4.096 bytes. Devuelve `{ proposal }`; 201 nueva, 200 replay idéntico. |
| GET `owner-reschedule-proposals/[proposalId]` | Devuelve `OwnerRescheduleRecovery`; solo dueño vigente y actor original. Nunca cierra o confirma una propuesta por GET. |
| POST `owner-reschedule-proposals/[proposalId]/confirm` | Solo `{ confirm: true }`, máximo 1.024 bytes. Devuelve `{ appointment, rescheduleResult, replayed }`; confirmación nueva y replay aplicados comparten prueba. |

Propuesta con mismo requestId/comando devuelve el mismo ID y `expiresAt`; diferente comando produce 409 `OWNER_RESCHEDULE_REQUEST_REUSED`. No revivir una propuesta vencida ni extender diez minutos por reintentar. Nuevo intento tras cierre requiere nuevo requestId y lectura/revisión nuevas.

## Persistencia y transacciones

Subcolección privada `businesses/{id}/ownerRescheduleProposals/{proposalId}`. ID determinista: `stableDocumentId('owner-reschedule', businessId, appointmentId, owner.uid, requestId)`. Registro versión 1 strict: view anterior, actorUid, commandFingerprint, catalogFingerprint, resourceScheduleFingerprint, createdAt, state y `result` nullable; cerrado añade closedAt y closedReason='expired'. No duplicar cliente, contacto, respuestas, beneficiario, objeto Appointment completo ni intakeFields. Actor no se agrega a Appointment.

Preparar en una transacción: leer negocio/origen/registro; comprobar dueño y actor/ámbito de un registro previo. Con comando idéntico ya existente, devolver su view sin renovar vencimiento ni gastar admisión. Para nueva propuesta, validar permisos, consentimiento, política y origen/huella, destino, catálogo y S09; leer ocupación. Preparar `prepareBookingActionAdmission(... owner.uid, businessId, 'proposal', 'owner-reschedule:' + requestId)`; invocar su closure solo después de todas las lecturas. Guardar propuesta `prepared` con `expiresAt=now+600000`, sin bloquear franja o escribir cita. El ID se calcula fuera del callback y no cambia por retry.

Confirmar en una sola transacción, con todas las lecturas antes de writes:

1. Leer negocio/propuesta y exigir dueño vigente, actor original, IDs y registro válidos. Leer cita actual. Si ya aplicada, validar proof/ámbito/revisión y devolver prueba original más **cita actual**, incluso tras otro movimiento/cancelación o vencimiento. No aplicar de nuevo ni exigir que conserve la posición del resultado antiguo. Un propietario nuevo no recibe el recibo privado del actor anterior.
2. Si cerrada, devolver resultado terminal sin writes; fuera de la transacción convertir a 409 `OWNER_RESCHEDULE_PROPOSAL_CLOSED`. Si preparada y vencida, escribir cierre `expired` y devolver terminal, sin tocar cita/locks. Esa clausura de una propuesta propia no ejecuta una nueva reprogramación ni requiere permiso de nueva reserva; requiere autoridad/actor vigentes. No lanzar dentro del callback después del cierre, porque lo desharía. La escritura de cierre serializa frente a una confirmación más antigua.
3. Si preparada vigente, exigir consentimiento/capacidad/plan/origen actual, revisión y fingerprint exactos. Leer política S09, servicio/recurso actuales, sus huellas y ocupación destino. Leer locks deduplicados `${origen.dateKey}_${origen.resourceId}`, `${destino.dateKey}_${destino.resourceId}` y, si cliente válido, `client_${clientPolicyKey(source.client.uid)}`. Nunca usar el UID dueño como lock del cliente por comodidad.
4. Retomar reloj tras lecturas. Si acaba de vencer, cerrar como arriba. De lo contrario revalidar origen futuro, destino futuro/horizonte, elegibilidad y franja sin origen. Versiones de locks ausentes son cero; presentes deben ser enteros seguros no negativos y permitir incremento seguro; corrupción/agotamiento falla503.
5. Spread de cita recién leída: cambiar solo fecha/horas/timestamps, `reservedUntilAt`, recurso, nombre/precio vigentes del mismo servicio, `rescheduleRevision+1`, `lastRescheduleProposalId` y `rescheduledAt`. Preservar ID/status, cliente, creador, metadatos de asistencia y todos los demás campos. Construir `RescheduleResult` persistente con la nueva revisión; actualizar cita, locks y propuesta aplicada juntos. No escribir negocio, cuota, proyección pública, clientPolicies, recordatorios o espera.

Un error conserva origen/locks/propuesta sin aplicación parcial. D1 conserva su journal/retry del commit idéntico; no añadir retry de dominio con identidad nueva. Dos propuestas para el mismo origen solo pueden aplicar una por revisión/huella. Una reserva/bloqueo competidor comparte lock destino. Cancelación/cliente/revisión de representación/asistencia leen la misma cita: reintentar transacción y volver a validar; no sobrescribir con la copia inicial. Si asistencia o cancelación gana, ya no es confirmed; si cliente reprograma, cambia origen. Si S07 gana, una acción obsoleta de asistencia/cliente falla conforme a sus contratos.

GET de recuperación no declara una propuesta expirada terminal solo por reloj: una confirmación anterior podría seguir resolviéndose. Devuelve estado almacenado prepared y expiresAt. La UI puede decir «La propuesta venció; falta comprobar el resultado». Un **POST explícito de la misma confirmación** recupera aplicación o persiste cierre; una vez cerrado, una transacción antigua no puede aplicar sin releer ese cierre. No convertir error de red, 503 o JSON inválido en prueba de fracaso.

Errores nuevos: 409 `OWNER_RESCHEDULE_SOURCE_CHANGED`, `OWNER_RESCHEDULE_SOURCE_STARTED`, `OWNER_RESCHEDULE_NO_CHANGE`, `OWNER_RESCHEDULE_CATALOG_CHANGED`, `OWNER_RESCHEDULE_SCHEDULE_CHANGED`, `OWNER_RESCHEDULE_PROPOSAL_CLOSED`, `OWNER_RESCHEDULE_REQUEST_REUSED`, `OWNER_RESCHEDULE_UNSUPPORTED`; 503 `OWNER_RESCHEDULE_UNVERIFIABLE`. Conflicto de hueco conserva409 actual con texto verificable. 401/403/404,428,402,429 y validación400/413/415 mantienen su semántica; no incluir datos de otra cuenta.

## UI y recuperación sin congestión

Añadir **Cambiar horario** dentro del detalle de cita de `OwnerAgendaAppointments`, no sobre celdas. El dueño ve una explicación breve si el negocio/cita no corresponde al alcance; no esconder las citas restringidas. El callback entrega solo appointmentId al controlador del dashboard. Un único `OwnerRescheduleWorkspace`, fuera del listado keyed por día y del filtro de recurso, permanece montado por UID/época/negocio y una identidad local fija del flujo; no remonta por objeto de cita del polling, URL o paso. La entry inicial se captura una vez. Añadir el ID de propuesta a la URL desde ese mismo flujo no cambia entry, requestId o key ni reinicia el hook.

Recorrido: 1. Consultar origen fresco → 2. Elegir fecha/recurso y Consultar horarios → 3. Revisar Antes/Propuesto → **Confirmar cambio**. Selección inicial: fecha del origen, recurso del origen solo si sigue activo/asignado y hora vacía; un recurso retirado exige elegir destino, sin escoger el primero silenciosamente. Seleccionar fecha/hora no prepara ni confirma. Una propuesta no aparta el hueco; decirlo junto al resumen. Mostrar precio anterior/nuevo si verificables, margen y recurso, con «Este cambio no procesa cobros ni envía avisos externos». No repetir contacto/respuestas o documentación larga; `details` «Qué conserva este cambio» cerrado. Sin diálogo obligatorio, drag/drop o librería.

Tras preparar, añadir con `router.replace(...,{scroll:false})` únicamente `ownerReschedule=<proposalId>` a `/dashboard`; sin selección, ID de cliente o contacto. Mantener parámetros ajenos sin pasarlos a APIs; parámetro duplicado/vacío/malformado muestra error y no lee un destino. El ID opaco está ligado a sesión/dueño/actor y no concede acceso. Un límite Suspense y hooks Next se sitúan en el adaptador del flujo del dashboard; no añadirlos a todos los formularios del dueño.

Al recargar o entrar con URL, efectuar solo GET de recuperación tras cargar el negocio propio; nunca proponer/confirmar automáticamente. Una propuesta de otro negocio/actor no se busca globalmente y falla sin datos privados. Mientras haya flujo abierto, un cambio externo posterior de URL no sustituye su entry ni tupla: conservarlas y ofrecer el enlace validado en otra pestaña por acción explícita; la escritura propia de su proposalId se reconoce como la misma operación. No leer/restaurar selección, chat o contactos desde localStorage/sessionStorage. Cerrar un flujo seguro quita ese parámetro; salir no cancela la cita ni escribe cierre de propuesta.

El workspace mantiene cuerpo/URL de preparación inmutables al enviarlos, y tras recibir proposalID la confirmación siempre usa su mismo endpoint y `{confirm:true}`. Respuesta perdida al preparar: congelar selección y reintentar mismo requestId/cuerpo, sin nueva propuesta. Puede salir sin cambio porque preparar no mueve ni bloquea, pero no fingir que se eliminó el registro preparado. Respuesta perdida al confirmar o resultado inválido: estado **Resultado por comprobar**, bloquear nueva operación y ofrecer «Recuperar la misma confirmación». GET aplicado/closed permite resolver; GET prepared no demuestra que una confirmación haya fallado. No liberar ese bloqueo por polling, cambiar de pestaña o pasar expiresAt. Un rechazo de dominio verificable en la primera confirmación, sin incertidumbre previa, permite descartar la revisión y leer origen de nuevo; después de incertidumbre, un error aislado no sustituye la prueba aplicada/cerrada. Tras401/403 ocultar datos y no reintentar como otro usuario; el servidor reautoriza toda recuperación.

El controlador fija un lock de acciones por flujo abierto: impide iniciar cancelación, bloqueo, asistencia u otro cambio desde este dashboard. No abortar la propia operación cuando disabled cambie por ese lock. Los filtros/fecha pueden seguir consultándose porque el workspace es independiente del día; mientras bloqueos/asistencia ya iniciados estén pendientes, no abrir este flujo. `RepresentationReviewControls` y `ClientPolicyControls` mantienen sus contratos locales; su cambio concurrente se detecta con la huella y transacción, sin agregar callbacks ficticios. Cerrar details de una tarjeta no desmonta el workspace. Cambiar UID/época/negocio sí aborta, oculta y descarta callbacks; no promete deshacer una escritura ya confirmada.

Lecturas de origen/recuperación y disponibilidad tienen plazo UI de10s con controller/generación, limpieza de timer y rechazo de respuestas tardías; disponibilidad es POST sin mutación de dominio. Preparar/confirmar no se abortan por cronómetro: tras20s solo aviso de demora. Si ya existe proposalID, permitir GET de recuperación mientras un POST sigue pendiente mediante controller separado; solo prueba aplicada/cerrada resuelve, prepared no permite otro POST paralelo. Reintento POST únicamente después de error real, con mismo cuerpo. Una recuperación que prueba éxito invalida la generación de publicación del POST antiguo, sin afirmar que lo canceló en servidor.

Éxito/replay aplicado muestra prueba de **ese cambio** y estado actual por separado si hubo otro movimiento. Añadir a `useOwnerAgenda` `invalidateAndRefresh(): void`: aborta/invalida generación, oculta snapshot inmediatamente y programa lectura fresca con límites existentes. No insertar una cita movida en `replaceAppointment`, que exige misma fecha; no dibujar el origen antiguo mientras llega el nuevo rango. Workspace conserva prueba hasta cerrar y ofrece «Ver día actualizado» como navegación explícita, sin otra escritura. Un callback tardío solo actúa en UID/época/negocio vigentes.

Teclado, labels, foco al paso/revisión/resultado, `aria-busy` y avisos polite; no robar foco por reloj/polling. 320/390/1280px y zoom200%, textos largos y errores inline. Mantener marca, DM Sans y tokens Sarin; una columna y ayudas plegadas, sin editor de configuración o panel técnico en este flujo.

## Almacenamiento, despliegue y límites de alcance posteriores

Añadir solo `ownerRescheduleProposals` a `DATA_CHILDREN.businesses`; operaciones por documento, sin query nueva, índice SQL/Firestore o migración de esquema. Conservar deny SDK del hijo y escrituras solo servidor. El Worker compatible debe publicarse antes de la aplicación que usa el hijo; Worker antiguo debe fallar sin aplicación parcial. Reconciliación/backups incluyen recibos y citas; probar ida/vuelta y D1 local. No purgar recibos aplicados por TTL de propuesta: el vencimiento de preparar no es retención de evidencia. No crear aquí un procedimiento de borrado/exportación de clientes.

Rollback conserva documentos, allowlist y campos existentes de cita. No retroceder posiciones, cuotas o revisiones para simular rollback de UI. El rollback admisible usa un **lector compatible con S09** que mantiene restricciones de políticas ya guardadas; no volver a463ae55 ignorando turnos/cierres. El escritor S09 puede deshabilitarse sin desactivar su enforcement; S07 no requiere que ese escritor esté habilitado para leer política. La aplicación anterior compatible sigue leyendo citas movidas y el cliente usa la revisión nueva; probar esa compatibilidad y los recordatorios existentes ligados a revisión/inicio. No añadir notificaciones externas ni reabrir/cerrar espera como efecto secundario.

Segundo alcance concreto para salud/menores: antes de permitirlo, definir si una modificación administrativa requiere un caso nuevo del cliente, qué autorización vigente la sustenta, revocación/cambio de política, legado sensible y revisión de representación; disponer de casos/recibos sintéticos y pruebas de beneficiario/representante que demuestren que dueño no autoriza en su nombre. Requiere diseño propio y endpoints/contratos coherentes; este documento no los entrega ni los simula renovando el receipt anterior.

## Aceptación y autorrevisión

R01 dueño real por negocio; R02 origen/propuesta/horario/catálogo revisionados; R03 mismo ID y cuota intacta; R04 ocupación/locks atómicos con carreras reales; R05 replay y cierre tras respuesta perdida, incluso tras otro movimiento; R06 destino activo/origen retirado sin sustitución de servicio; R07 general cerrado y salud/menores sin bypass; R08 workspace persistente, URL solo lectura y sin tuple perdida por polling; R09 agenda invalida rango anterior y conserva estados/acciones existentes; R10 privacidad, D1/Firestore y respaldo compatibles. Cada criterio se asigna a tareas/pruebas del plan.

Autorrevisión: no se suplanta actor, no se abre cliente/plan ni se suman cuotas, no se copia el override de Fresha, no se introduce plazo configurable sin contrato. Propuestas privadas no exponen actor al cliente; cierre serializado distingue caducidad de resultado incierto. S09 cambia disponibilidad futura sin mover citas y su huella se relee en confirmación. La integración está definida sobre base compuesta, no sobre dos dashboards paralelos. Ninguna aceptación se afirma probada por esta preparación documental.
