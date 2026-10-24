# Consulta mínima de reservas de una cuenta para el propietario

> Ejecucion iniciada el 24/10/2026 sobre main publicado `95a3a3e16f67f42520094b82ec5bb3b59a8d8d3f` (P1-P5 nucleo verificados). El titular indico ?ok sigamos?; se ejecuta el siguiente bloque S06 del orden acumulativo. Las restricciones de preparacion del texto historico describen su redaccion, no una nueva pausa de ejecucion. Mantener S05 Task7 diferida.


> Precision de ejecucion S06 Task1 (24/10/2026): el limite de resourceLabel es de 120 caracteres incluyendo el distintivo « · Inactivo». Un nombre actual valido de hasta 120 caracteres conserva su texto literal; si el recurso esta inactivo, se recorta solo el prefijo mostrado cuando hace falta para incluir el distintivo dentro del limite, sin dividir pares sustitutos Unicode. Nombres invalidos o referencias desconocidas usan «Recurso anterior».

Fecha: 22 de octubre de 2026, Colombia. Diseño preparado por delegación expresa del titular; acompaña el [plan](../plans/2026-10-22-owner-client-record.md). Estado: especificación documental, no implementación ni verificación de producto. No se ejecutan pruebas, migraciones, publicación o commits en esta preparación.

## Resultado y alcance

Desde una cita de la agenda, el propietario puede consultar páginas de reservas de **la misma cuenta reservante y del mismo negocio**, distinguir sus resultados guardados y volver a una cita en la agenda. La cuenta puede reservar para sí o representar a personas distintas: esta consulta no es una ficha personal de todos los beneficiarios. No se unen cuentas por nombre, teléfono, correo o parecido.

Se adopta S06 de forma acotada: consulta individual autorizada, filtros de resultados reales y navegación paginada. No hay directorio global, búsqueda de personas, edición de perfil, contactos consolidados, notas, etiquetas, segmentos, marketing, pagos, diagnóstico, historia clínica, importación ni exportación. Tampoco se añaden totales, frecuencia, penalizaciones o «última visita»: una página parcial y una cuenta con varios beneficiarios no justifican esos indicadores. Los resultados `completed`/`no_show` son estados guardados, no hechos inferidos porque transcurrió una hora.

## Fuente y orden de integración

Fuente efectiva leída, solo lectura: `C:/Users/Drean Skate/AppData/Local/SarinBot/whatsapp-adaptation-20261020/source-restoration`, pin `463ae55f8c873468980746185fb3e91f55cb8681`; runtime documentado `c8bb0a99d9ac2bb20acaef2e5a157b0ff83b05f2`, delta documental. E: contiene documentación y una copia mixta, no una base de implementación. La ejecución futura reconcilia pin/runtime y utiliza rama aislada.

Base compuesta elegida: **Agenda → Estados de atención → esta consulta**. Integrar en `src/components/owner-agenda-appointments.tsx` creado por Agenda; el dashboard conserva contexto, hook y acciones. No restaurar las tarjetas inline antiguas ni añadir otra lectura diaria. S09 y reprogramación del dueño pueden coexistir: esta lectura no valida disponibilidad, crea propuestas ni cambia huecos.

Referencias: [inventario efectivo](../../qa/2026-10-22-sarin-effective-admin-inventory.md), [maestro Fresha](../../product/fresha-admin-capture-register.md), [matriz granular](../../product/fresha-admin-coverage-matrix.md), [operación de citas observada](../../qa/2026-10-22-fresha-appointment-operation.md), [diseño de Agenda](2026-10-22-owner-agenda-design.md) y [Estados de atención](2026-10-22-owner-attendance-and-client-record-design.md). Los recorridos de Fresha no prueban este contrato ni una captura administrativa completa.

Contratos comprobados en la fuente:

- `src/types/firestore.ts`: Appointment contiene `client.uid`, datos de contacto/intake, beneficiario y estados; esos campos no son una entidad CRM canónica. `beneficiary` puede faltar en legado.
- `src/app/api/businesses/[id]/appointments/route.ts`: GET diario del dueño; `view=mine` consulta exclusivamente al cliente autenticado y no se reutiliza para suplantar otra cuenta.
- `src/lib/server/client-policy.ts`: políticas por UID, selector del dueño poblado por citas del día. La consulta nueva no modifica ese selector, cuotas, bloqueos ni motivos.
- `src/lib/storage/types.ts`: consultas con comparaciones simples, varios `orderBy` y límite, sin OR ni `startAfter`. `src/lib/storage/database.ts` conserva múltiples órdenes; D1 admite `client.uid`, `type`, `status`, `startAt` e `id` en consultas. No ampliar el protocolo para esta función.
- `cloudflare/src/data.ts`: los campos usados para ordenar deben existir; desempate final por path. El máximo general de 1.000 no es paginación ni un truncado aceptable. Firestore también excluye documentos sin campos de ordenación.
- `tests/memoryFirestore.ts`: el doble actual guarda solo un `orderBy`; no permite certificar empates compuestos. El plan lo corrige como infraestructura de prueba y exige además D1/Firebase locales.

## Decisiones y límites de cobertura

Alternativas: (1) **elegida**, proyección mínima de citas indexables, sin nueva colección y con cobertura explícita; (2) leer todas las citas de la cuenta y paginar en navegador, descartada por lectura no acotada/límite de almacenamiento; (3) crear entidad de cliente, notas y métricas, pospuesta por identidad, privacidad y mantenimiento distintos.

La consulta ordena por `startAt DESC, id ASC`. Los escritores actuales crean esos campos, pero **una cita heredada sin startAt o id puede quedar fuera de los índices y no será detectada por esta consulta**. También quedan fuera documentos sin el UID exacto o sin `type: appointment`; los filtros de resultado excluyen estados ausentes/diferentes. Un documento sin UID no permite atribuir una cuenta por contacto o parecido. No se conoce cuántas faltan sin una auditoría privada independiente; no devolver un número supuesto ni afirmar que se comprobó ausencia de legado. Valores existentes pero inválidos que sí aparezcan provocan error verificable, no descarte silencioso. Una fila con identidad/ámbito incoherente tampoco se omite para rellenar la página.

La API declara siempre `coverage: { mode: 'indexed_appointments', completeness: 'not_guaranteed' }`. La interfaz mantiene «Esta consulta muestra reservas con fecha verificable. Algunos registros antiguos incompletos pueden no aparecer» y «La cuenta puede gestionar reservas para personas distintas». Un vacío significa **«No hay reservas verificables para este filtro»**, nunca «Esta persona nunca ha venido». No introducir un flag, backfill o gate operativo nuevo para habilitar esta lectura. Una auditoría privada de legado es diagnóstico posterior, no una reparación durante el GET/POST ni condición escondida.

## Identidad, autorización y minimización

Ruta nueva de lectura: `POST /api/businesses/[id]/appointments/[appointmentId]/client-record`, Node, dinámica, no-store en éxito/error. POST permite mantener UID y cursor en cuerpo, sin UID en navegación ni querystring. No tiene efectos persistentes ni requestId de escritura. Requiere `requireUser` y `assertOwner` exacto; superadmin, recurso reservable o compañero no sustituyen al dueño vigente. Se mantiene lectura con plan vencido o sin consentimiento nuevo de cuenta. No saltar permisos de salud/menores ni consultar expedientes clínicos.

Cada petición lee dentro de una transacción el negocio y la cita de entrada: documento existente, `id` almacenado igual al ID canónico del documento, tenant exacto, `type === 'appointment'` y UID válido. Valida `clientUid` del cuerpo y exige igualdad exacta con esa cita; ese UID no elige una persona arbitraria porque la cita demuestra la relación. Mismo UID en otro negocio nunca amplía la colección consultada. Cita sin cliente: función no disponible, no inventar identidad. No consultar `users`, Firebase Auth, otros negocios ni perfiles globales. No persistir selección/cuerpo en URL, localStorage, analítica o logs.

Validar UID con `clientUidSchema` y rechazo explícito de cualquier carácter de control, incluido salto final; no trim/case-fold que fusione identidades. IDs mediante `documentIdSchema` con comprobación completa del string. La consulta usa siempre colección de appointments del negocio y filtros `client.uid == UID` y `type == appointment`; filtro de resultado, si existe, es exacto `status == completed|no_show`.

DTO definido con allowlist, **nunca spread/cast de Appointment**:

```ts
type OwnerClientRecordFilter = 'all' | 'completed' | 'no_show';
type OwnerClientRecordCursor = { appointmentId: string; startAt: number; revision: string };
type OwnerClientRecordRow = {
  appointmentId: string; dateKey: string; startAt: number; endAt: number | null;
  status: 'confirmed' | 'cancelled_by_client' | 'cancelled_by_owner' | 'completed' | 'no_show' | 'unverified';
  resourceLabel: string; beneficiaryKind: 'self' | 'represented_minor' | 'undeclared' | 'unverified';
};
type OwnerClientRecordPage = {
  scope: { businessId: string; sourceAppointmentId: string; clientUid: string };
  filter: OwnerClientRecordFilter; checkedAt: number; rows: OwnerClientRecordRow[];
  nextCursor: OwnerClientRecordCursor | null;
  coverage: { mode: 'indexed_appointments'; completeness: 'not_guaranteed' };
};
```

No devolver teléfono, correo, nombre de cliente/menor, intakeAnswers, serviceName/serviceId, precio, autorizaciones, revisión de representación, audit actor/motivo ni Appointment crudo. El nombre ya mostrado en la tarjeta puede servir de contexto local «Cuenta de esta reserva», sin convertirlo en perfil actualizado. `resourceLabel` procede exclusivamente del recurso actual del mismo negocio, como texto literal acotado a 120 caracteres; si no está en el catálogo, su nombre falta o es inválido, «Recurso anterior». Un recurso inactivo conocido conserva su nombre y distintivo «inactivo». No consultar perfiles de empleados.

Identidad/orden de cada fila: ID válido, igual al doc.id, tenant/UID/tipo exactos y startAt entero seguro positivo representable por Date. `dateKey` del DTO se deriva de startAt en `America/Bogota`, no arregla el documento. endAt inválido/ausente o menor que startAt produce null y «Fin no verificable». Estado desconocido en all produce `unverified`; no se convierte en confirmado ni terminal. `beneficiaryKind` usa `bookingBeneficiarySchema`: ausencia es undeclared, presencia inválida es unverified. No expone nombre/rol del menor ni une beneficiarios por UID. No se determina fecha de asistencia ni autoría a partir de metadatos parciales; para auditar un resultado se usa el control ya especificado de esa cita.

## Paginación exacta y concurrencia

Cuerpo máximo 2.048 bytes, esquema estricto: `{ clientUid, filter, cursor? }`; sin querystring, campos desconocidos, arrays, pageSize, UID alternativo o límites libres. Cursor contiene ID, startAt y `revision` SHA-256 hexadecimal de64 caracteres calculada en servidor sobre JSON ordenado de `{id,startAt,status,rescheduleRevision,attendanceRevision}`. Revisiones ausentes usan0, presentes inválidas provocan503. El hash no es una autorización ni un secreto; no incluye contacto/intake. La ruta revalida autoridad y ámbito aunque el cursor haya sido fabricado.

Página fija20 con lookahead21. Todas las consultas y documentos de una petición se leen en la misma transacción, sin escribir locks ni documentos. Para continuación, leer cita ancla por cursor.appointmentId y comprobar UID/tenant/tipo/ID/startAt/revision y pertenencia al filtro. Ancla ausente, movida o corregida:409 `CLIENT_RECORD_CHANGED`, reiniciar recorrido. No confiar solo en la firma proporcionada ni buscar otra ancla aproximada.

1. Primera página: base+filtro, `orderBy('startAt','desc').orderBy('id','asc').limit(21)`.
2. Continuación: misma base+filtro, `startAt == cursor.startAt`, `id > cursor.appointmentId`, `orderBy('id','asc').limit(21)`. Si hay21 no se consulta el bloque más antiguo.
3. Si hay menos de21 empatadas, consultar base+filtro, `startAt < cursor.startAt`, `orderBy('startAt','desc').orderBy('id','asc').limit(21 - empatadas.length)`. Concatenar primero empatadas y después antiguas. Nunca límite0 ni OR improvisado.
4. Validar todas las filas leídas, incluida lookahead, orden estricto y unicidad de IDs. Devolver primeras20. Si hubo21, nextCursor es la última fila **devuelta**, con revisión tomada de su documento; en caso contrario null. No usar la fila lookahead como cursor ni perder un registro.

Máximo dos consultas acotadas y21 citas leídas por página, más negocio/cita entrada/ancla; el índice debe limitar trabajo real, no solo resultados. Comparación de id por ordinal ASCII, coherente entre D1/Firestore para IDs permitidos; no `localeCompare` dependiente de máquina. Empates de más de20, distintos recursos y canceladas no pueden desaparecer. startAt exacto puede representar una cita futura: orden descendente significa «Más recientes por fecha de reserva», sin llamarlo «últimas asistencias».

La transacción garantiza coherencia **de una petición**, no un snapshot retenido entre páginas. Otra sesión puede crear, reprogramar o corregir citas entre ellas. El ancla detecta su propio cambio; no detecta todos los movimientos de otras filas. Por eso no se prometen recorrido exhaustivo, deduplicación global ni métricas sobre páginas. Si una nueva página repite un ID de la página que sigue visible, descartar esa respuesta y pedir Actualizar; no borrar/saltar silenciosamente para fingir continuidad. Un movimiento desde páginas anteriores ya reemplazadas puede reaparecer: el aviso «Los registros pueden cambiar; Actualizar vuelve al inicio» permanece. No mostrar ni sumar páginas simultáneas como un conjunto completo.

Errores: autenticación401, dueño403, negocio/cita inexistente o incoherente404, cita sin cuenta409 `CLIENT_RECORD_NO_ACCOUNT`, ancla cambiada409 `CLIENT_RECORD_CHANGED`, datos devueltos no verificables503 `CLIENT_RECORD_UNVERIFIABLE`; contratos400/413/415 existentes. Error de índice/timeout/storage nunca equivale a página vacía. Aplicar no-store incluso en errores anteriores a consulta. Sin gates de plan activo, nueva reserva o consentimiento de escritura; cero cambios en cuotas/clientPolicies/attendance/locks.

## UX progresiva e integración

Dentro del detalle de cada tarjeta elegible, acción secundaria **«Reservas de esta cuenta»**. No cargar automáticamente por tarjeta ni al renderizar semana. Solo un panel abierto por dashboard. Paso inicial muestra contexto y las dos aclaraciones de identidad/cobertura; primera página al abrir. Filtros «Todas», «Atendidas», «No asistió» usan estados persistidos exactos; selección cancela lectura anterior y reinicia cursor. La página presenta20 filas como máximo; «Ver reservas anteriores» reemplaza la página, y «Volver al inicio»/«Actualizar» reinicia desde cabeza. No acumular listas de miles de citas, conteos o copias de contactos.

Cada fila muestra fecha/hora Colombia, recurso, resultado guardado y beneficiario «Para sí», «Representante de un menor», «Sin declaración guardada» o «Dato no verificable». Confirmada pasada: «Confirmada · sin resultado registrado», sin escribir un estado nuevo. Atendida/no_show heredada sigue siendo un resultado guardado sin inventar auditoría. Detalle de ayuda cerrado explica límite de cobertura; aviso breve siempre visible. Nada clínico o sensible se añade por abrir el panel.

«Ver en agenda» entrega solo `{appointmentId,dateKey}` al dashboard: cierra panel, selecciona modo día, día indicado y todos los recursos, y deja a useOwnerAgenda hacer su lectura normal. Enfoca la tarjeta solo después de que la lectura autorizada de ese día la encuentre; si ya cambió, «La cita cambió; actualiza la agenda». No insertar DTO minimizado en el store de Appointment ni obtener Appointment por otro endpoint. Durante saving combinado del dashboard no se abre/cambia cita ni se navega por esa acción; comprobar ref además del botón. Cancelar, representación, políticas y asistencia conservan sus acciones y contratos actuales.

Extender `OwnerAgendaAppointmentsProps` únicamente con `onOpenClientRecord: (appointment: Appointment) => void`; mantener props/callbacks de Agenda+Attendance. Dashboard mantiene selección `{businessId,ownerUid,dateKey,appointmentId,clientUid}` y panel nuevo. Hook `useOwnerClientRecord` usa apiFetch con expectedUid, AbortController y generación por UID/negocio/cita origen/clientUid/filtro. La habilitación depende de autoridad/selección válida; disabled por saving impide acciones nuevas, sin producir peticiones nuevas ni publicar datos de otro ámbito. Cerrar panel, cambiar cuenta/negocio/día/cita o filtro aborta y enmascara datos durante render, antes del efecto. Timeout local10s; lectura reintentable solo por usuario. No polling, ni cambio a GET diario/view=mine, ni búsqueda global.

Una respuesta se valida con schema estricto y scope/filtro/cursor/orden, no solo aserción TypeScript. Una lectura tardía no reemplaza filtro nuevo. 401/403 oculta página y selección. Error de página anterior no se muestra como vacío; se conserva la página actual del mismo ámbito con error y botón Actualizar. Al aceptar un guardado/cancelación conocido de esa cuenta, el dashboard invalida generación de la ficha y reinicia desde cabeza si está abierta; no presenta el resultado de una lectura iniciada antes del cambio. No mutar optimistamente otras páginas. Cambios remotos solo se observan por Actualizar y controles de cursor.

## Índices, mantenimiento y verificación exigida

Sin nueva colección, datos persistidos, migración de documentos, reglas, permisos o campos de Worker. Añadir dos índices D1 aditivos sobre parent, client.uid, type, startAt DESC, id ASC, path y variante con status entre type/startAt. Nombres `app_client_record_all` y `app_client_record_status`; reconciliar siguiente número de migración después de Attendance (0007 previsto) y demás ramas, sin sobrescribir migraciones. Firestore añade las dos composiciones equivalentes con client.uid/type y client.uid/type/status, startAt DESC+id ASC. Las consultas empatadas usan el prefijo de igualdades y orden id; validar uso real con explain y emulador, no asumirlo.

Rollback de app conserva índices, citas y auditoría; esta función no escribe ni requiere revertir datos. Rollout futuro: índices primero; Firestore listo si se usa ese backend; aplicación después. No cambiar backend como fallback ante error. Diagnóstico de legado solo mediante herramientas privadas existentes y permiso de mantenimiento vigente, nunca imprimir contactos ni exportar a documentos compartidos. No habilitar exportación de la ficha por esta tarea.

Pruebas obligatorias futuras: dueño contra cliente/superadmin/otro negocio; UID de entrada manipulado, cita sin UID; privacidad de DTO incluyendo menor e intake sintético;20/21/45/1001 citas con empates; más de20 mismas fechas; ancla movida/corregida/eliminada; índice ausente/campos de orden ausentes/error; cambios de ámbito/late response; integración Agenda+Attendance sin otro poller diario; D1 y Firebase locales; rendimiento por índice. Un test debe demostrar exactamente la exclusión de documentos sin campos de orden y el aviso de cobertura, sin llamarlos «sin reservas». No hay datos productivos, clientes reales ni mensajería en QA.

## Autorrevisión

Identidad es reservante+negocio, no beneficiario ni CRM global. La consulta prueba vínculo por cita y autoriza cada página. DTO permite revisar actividad administrativa sin copiar datos sensibles; filtros no inventan asistencia. Cobertura y concurrencia son limitadas y visibles, sin auditoría/backfill obligatorios ni métricas sobre páginas. Composición exacta Agenda→Attendance, firmas HTTP/UI, índices y pruebas tienen tareas responsables en el plan. Esta especificación no convierte S06 entero, Fresha ni los cinco planes iniciales en una captura o implementación completa.
