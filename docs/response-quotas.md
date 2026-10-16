# Capacidad de respuestas por vigencia

La capacidad comercial se aplica en el servidor a web, copiloto y WhatsApp. Es independiente del proveedor seleccionado y del medidor técnico de tokens DeepSeek. La prueba pagada cuesta $5.000 COP, permite configuración y diez citas sin vencimiento por días y tiene un límite total separado de 700 respuestas. Esencial incluye 700/1.500/3.000 respuestas en 7/15/30 días. WhatsApp comparte 4.500 respuestas entre web y su canal oficial durante 30 días.

No hay bolsa gratuita de onboarding. Un primer comprobante válido crea un borrador privado del negocio; hasta aprobarlo no se habilitan la configuración manual ni la asistida. La prueba comparte sus respuestas entre configuración y atención al cliente; el copiloto requiere una suscripción.

## Reserva y reintento

`responseQuotaScopes/business_{id}/periods/{periodId}` guarda fechas y contadores privados. `responseQuotaTurns/{hash}` registra la huella de la solicitud, canal, estado y referencia del período. No contiene mensajes, argumentos de herramientas ni respuestas. El identificador incorpora negocio, actor, modo, canal e identificador de solicitud; la configuración inicial conserva su identidad si crea el negocio dentro del turno.

Una transacción reserva capacidad antes de inferir. Todas las rondas de herramientas del turno comparten una reserva. Al completar se consume una respuesta; un fallo sin respuesta ni operación confirmada libera la reserva. Una cita ya guardada devuelve su confirmación verificada aunque falle la explicación del modelo. Un fallo de contabilidad posterior conserva la reserva y evita repetir la inferencia.

Repetir el mismo identificador no genera otra respuesta. Se reutiliza una caché en memoria de hasta 100 respuestas durante 15 minutos; las citas y bloqueos se vuelven a leer para respetar cancelaciones posteriores. Tras perder esa caché, se recupera la operación guardada o se informa que el turno ya terminó. El cliente puede iniciar otra consulta. Reutilizar un identificador con mensajes distintos se rechaza.

Una caída durante una operación puede dejar capacidad reservada sin confirmación. No se libera automáticamente por tiempo: hacerlo podría regalar una respuesta o repetir una reserva. El panel muestra estas unidades como reservadas o pendientes de confirmación. Su conciliación excepcional requiere revisar el registro y la operación, no cambiar contadores sin evidencia. La entrega WhatsApp guarda primero una salida persistente cifrada y permite confirmar su reserva al recuperar el trabajador.

## Renovaciones y ampliaciones

Cada comprobante conserva importe, duración y capacidad. Aprobar un plan durante o después de la prueba inicia la suscripción inmediatamente. Una renovación anticipada de una suscripción añade un período después de la vigencia pagada actual, sin reponer anticipadamente esa bolsa. Nunca se añade tiempo de la antigua prueba gratuita. El panel muestra el período actual y el siguiente.

Una ampliación compra 1.000 respuestas por $20.000 COP para el período pagado vigente al subir el comprobante. No extiende fechas, no concede gracia y no se vende durante la prueba. Aprobarla dos veces no duplica capacidad. Si el período vence antes de aprobar, el servidor rechaza la aprobación para revisión del pago; no transfiere el paquete a otro período ni genera un reembolso ficticio.

El aviso del 80% usa respuestas consumidas sobre capacidad total, incluidas ampliaciones. Las reservas reducen la disponibilidad inmediatamente. Al agotarse la bolsa, la IA se pausa y la agenda permanece accesible. No hay cargos automáticos.

## Frecuencia por cliente

El modo `sarin_client`, tanto web como WhatsApp, admite por UID global diez intentos capaces de iniciar inferencia en sesenta segundos, sesenta en una hora y ciento veinte en veinticuatro horas. Son ventanas deslizantes, independientes del negocio y del proveedor. No cambian el acceso ni las cuotas del propietario para configuración o copiloto. Un rechazo devuelve HTTP 429 y código `CLIENT_RATE_LIMITED`, con el tiempo de espera en el mensaje, antes de reservar capacidad o llamar al modelo. La lectura y cancelación de citas siguen disponibles.

El documento privado `serverSettings/client_rate_<sha256 UID>` conserva como máximo ciento veinte marcas de tiempo y hashes de identificador/huella; no almacena IP, cuerpos, teléfonos ni respuestas. La transacción impide superar el último puesto mediante solicitudes concurrentes. Al siguiente uso admitido se descartan marcas de más de veinticuatro horas; el documento por UID permanece con tamaño acotado. Un estado corrupto impide admitir nuevas consultas en lugar de reiniciar el contador.

La identidad queda ligada a contenido, negocio y canal; cambiar el contenido conservando el identificador produce HTTP 409 `AI_REQUEST_CONFLICT`. La caché exacta y los turnos duraderos completados o reservados se reconocen antes de la admisión para recuperar el resultado o informar su estado sin contar ni inferir de nuevo, incluso tras reiniciar o superar la ventana. Un turno liberado, o sin reserva duradera, sí puede volver a inferir: cada intento cuenta una admisión nueva aunque repita exactamente su identificador y contenido. Esto impide eludir el límite reintentando fallos del proveedor. Las marcas pueden repetir el hash de solicitud, manteniendo la misma huella y el máximo de ciento veinte marcas. La admisión también cuenta si después falla la cuota comercial; un 429 nunca crea ni retiene una reserva de respuestas.

Este control no verifica la titularidad del teléfono, no impone un máximo de citas futuras activas y no impide que varias cuentas consuman la bolsa compartida de un negocio. No sustituye una prueba de capacidad ni un límite monetario de los proveedores.

Las suscripciones pagadas anteriores sin historial de períodos conservan su vencimiento y reciben una única bolsa legada de 3.000 respuestas. No se reconstruye consumo anterior ni se amplían fechas. Las pruebas históricas gratuitas sin activación pagada no conceden acceso. Aprobar la nueva prueba crea su propio período de 700 respuestas sin caducidad por fecha; el límite de diez citas se impone por separado en la transacción de reserva. La primera operación materializa los períodos compatibles; consultar no escribe documentos.

## Autorización y operación

Solo el propietario consulta su capacidad por `/api/billing`; `/api/admin` exige el UID de superadministrador y muestra las capacidades por negocio. Las colecciones privadas no son accesibles desde el SDK del navegador. El chat público no expone importes, consumo privado ni configuración del proveedor.

WhatsApp requiere conexión verificada y un período WhatsApp vigente antes de llamar al modelo. Estar preparado para contratar no equivale a haber comprado el plan. No se habilitan pruebas reales ni envíos con credenciales ausentes. Véase [operación WhatsApp](whatsapp-cloud-api.md).

Mantener una única réplica Node. Una imagen anterior conserva documentos pero puede dejar de aplicar cuotas y contratos nuevos: mantener mantenimiento y nuevas reservas cerradas hasta comprobar compatibilidad. No se borran períodos ni contadores al revertir; la candidata del piloto añade las condiciones siguientes.

## Piloto: capacidad comercial y presupuesto monetario

Contrato de la versión local `003f5ab` y posteriores; no declara activación en producción. La prueba pagada o de cortesía conserva **diez citas y 700 respuestas totales**, sin caducidad por días. Cada cita nueva guardada consume una unidad; cancelarla no devuelve cupo. Los contadores comerciales y sus reglas de recuperación siguen independientes del gasto técnico.

Una respuesta de Sarin puede requerir varias llamadas al modelo. La reserva comercial es por respuesta/turno; el presupuesto se reserva **por llamada pagada**, incluyendo las rondas posteriores de herramientas. Cada registro monetario conserva modelo, modalidad, tarifa versionada y coeficientes de esa llamada. La conciliación usa ese contexto, no una tarifa nueva aplicada retroactivamente.

Los valores previstos son globalmente USD 0,50/día, USD 8/mes y 20/300 millones de tokens por día/mes; por negocio, USD 0,10/día, USD 2/mes y 2/30 millones de tokens. No son precio al cliente ni garantía de financiar toda su capacidad. El control necesita configuración privada versionada y `PILOT_AI_BUDGET_ENFORCED=true`; la candidata lo conserva en `false` por compatibilidad hasta su activación revisada bajo mantenimiento. Un flag ausente tampoco lo activa.

Los estados inciertos no vencen por tiempo. Timeout, uso ausente o metadatos desconocidos retienen el máximo reservado; **no pausan globalmente por esa incertidumbre sola**. Pueden reducir el saldo disponible y bloquear otra llamada si no cabe. Un modelo/tier explícitamente inesperado o uso/costo por encima de la cota reservada sí produce pausa global, además de preservar la contabilidad. Repetir una inferencia o eliminar una reserva no constituye conciliación.

La administración monetaria usa `GET/PATCH /api/admin/abuse`, exclusivos del superadministrador. GET pagina por cursor UUID, 50 registros con lectura de 51, orden ascendente por id; no debe mostrarse como «últimas llamadas». PATCH permite:

- `configure`: `{ action: 'configure', expectedVersion, paused, limits, reason }`; `limits` contiene exactamente `globalDayUsd`, `globalMonthUsd`, `businessDayUsd`, `businessMonthUsd`, `globalDayTokens`, `globalMonthTokens`, `businessDayTokens`, `businessMonthTokens`. Usar la versión leída, sin sobrescribir cambios concurrentes.
- `reconcile`: `{ action: 'reconcile', callId, resolution: 'keep_reserved' | 'confirmed_not_charged', reason, evidence }`. Conservar reserva por defecto; liberar solo cuando la evidencia acredita que no hubo cobro. No hay TTL automático ni reinicio del consumo comercial.

Un 503 `AI_BUDGET_*` indica control operativo, distinto del 402 por capacidad/acceso comercial. No presentarlo como respuestas agotadas ni descontar una respuesta no entregada por ese rechazo. Si una cita ya quedó guardada, recuperar su confirmación mediante el contrato de reintento; no ejecutarla otra vez. La consulta y cancelación de agenda siguen disponibles conforme a sus permisos.

La excepción de mantenimiento permite GET/PATCH exactos de `/api/admin/abuse`, con Bearer y delegando siempre en `requireSuperadmin` de Next. GET admite ausencia de query o únicamente `?cursor=<UUID válido>`, una sola vez, para paginar también durante mantenimiento; cursores inválidos y parámetros adicionales/repetidos quedan fuera de la excepción. PATCH sigue sin admitir query. Salud/cola conserva su excepción exacta anterior. Activación: backup D1/R2 y Auth/config, mantenimiento, cola vacía, candidata con gate apagado, configuración privada validada, gate encendido y comprobado antes de reabrir una sola instancia. Véase [operación del piloto](cloudflare-no-vps-runbook.md#piloto-presupuesto-y-operación-de-la-candidata-local).

Rollback conserva propuestas, políticas, invitaciones y contadores, además de los períodos y reservas. No reabrir la herramienta antigua de reserva dependiente solo del prompt; una versión que no interprete los contratos nuevos permanece cerrada para reservas hasta resolver compatibilidad. No se activan flags, modifican límites reales ni ejecutan conciliaciones al actualizar este documento.
