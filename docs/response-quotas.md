# Capacidad de respuestas por vigencia

La capacidad comercial se aplica en el servidor a web, copiloto y WhatsApp. Es independiente del proveedor seleccionado y del medidor técnico de tokens DeepSeek. La prueba tiene 700 respuestas durante siete días; Esencial incluye 700/1.500/3.000 respuestas en 7/15/30 días. WhatsApp comparte 4.500 respuestas entre web y su canal oficial durante 30 días.

Antes de crear el negocio, la configuración asistida tiene una bolsa separada de 30 respuestas por cuenta. Después, las consultas del propietario descuentan de la bolsa del negocio. El formulario manual de configuración sigue disponible.

## Reserva y reintento

`responseQuotaScopes/business_{id}/periods/{periodId}` guarda fechas y contadores privados. `responseQuotaTurns/{hash}` registra la huella de la solicitud, canal, estado y referencia del período. No contiene mensajes, argumentos de herramientas ni respuestas. El identificador incorpora negocio, actor, modo, canal e identificador de solicitud; la configuración inicial conserva su identidad si crea el negocio dentro del turno.

Una transacción reserva capacidad antes de inferir. Todas las rondas de herramientas del turno comparten una reserva. Al completar se consume una respuesta; un fallo sin respuesta ni operación confirmada libera la reserva. Una cita ya guardada devuelve su confirmación verificada aunque falle la explicación del modelo. Un fallo de contabilidad posterior conserva la reserva y evita repetir la inferencia.

Repetir el mismo identificador no genera otra respuesta. Se reutiliza una caché en memoria de hasta 100 respuestas durante 15 minutos; las citas y bloqueos se vuelven a leer para respetar cancelaciones posteriores. Tras perder esa caché, se recupera la operación guardada o se informa que el turno ya terminó. El cliente puede iniciar otra consulta. Reutilizar un identificador con mensajes distintos se rechaza.

Una caída durante una operación puede dejar capacidad reservada sin confirmación. No se libera automáticamente por tiempo: hacerlo podría regalar una respuesta o repetir una reserva. El panel muestra estas unidades como reservadas o pendientes de confirmación. Su conciliación excepcional requiere revisar el registro y la operación, no cambiar contadores sin evidencia. La entrega WhatsApp guarda primero una salida persistente cifrada y permite confirmar su reserva al recuperar el trabajador.

## Renovaciones y ampliaciones

Cada comprobante conserva importe, duración y capacidad. Aprobar una renovación anticipada añade un período futuro, preservando la prueba o vigencia actual. No repone anticipadamente la bolsa agotada. El panel muestra el período actual y el siguiente.

Una ampliación compra 1.000 respuestas por $20.000 COP para el período pagado vigente al subir el comprobante. No extiende fechas, no concede gracia y no se vende durante la prueba. Aprobarla dos veces no duplica capacidad. Si el período vence antes de aprobar, el servidor rechaza la aprobación para revisión del pago; no transfiere el paquete a otro período ni genera un reembolso ficticio.

El aviso del 80% usa respuestas consumidas sobre capacidad total, incluidas ampliaciones. Las reservas reducen la disponibilidad inmediatamente. Al agotarse la bolsa, la IA se pausa y la agenda permanece accesible. No hay cargos automáticos ni un límite diario de conversaciones.

Las suscripciones anteriores sin historial de períodos conservan su vencimiento y reciben una única bolsa legada de 3.000 respuestas. No se reconstruye consumo anterior ni se amplían fechas. Los negocios en prueba reciben sus 700 respuestas hasta el vencimiento original. La primera operación materializa esta información; consultar no escribe documentos.

## Autorización y operación

Solo el propietario consulta su capacidad por `/api/billing`; `/api/admin` exige el UID de superadministrador y muestra las capacidades por negocio. Las colecciones privadas no son accesibles desde el SDK del navegador. El chat público no expone importes, consumo privado ni configuración del proveedor.

WhatsApp requiere conexión verificada y un período WhatsApp vigente antes de llamar al modelo. Estar preparado para contratar no equivale a haber comprado el plan. No se habilitan pruebas reales ni envíos con credenciales ausentes. Véase [operación WhatsApp](whatsapp-cloud-api.md).

Mantener una única réplica Node. Volver a la imagen anterior conserva los documentos pero deja de aplicar las nuevas cuotas: usar la reversión solo como medida operativa y registrar cuándo ocurrió. No se borran períodos ni contadores al revertir.
