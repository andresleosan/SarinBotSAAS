# Gemini como proveedor manual

El administrador puede elegir Gemini, IA local o DeepSeek para el chat, el copiloto y la configuración del negocio. Cada turno mantiene su proveedor y no hay cambio automático ante errores. Vault conserva exclusivamente Ollama y sus datos locales.

## Configuración y activación

Usar una clave dedicada, fuera de Git y del navegador, con `GEMINI_API_KEY`, `GEMINI_MODEL=gemini-3.5-flash-lite` y `GEMINI_BILLING_VERIFIED=true` solo después de verificar que el proyecto de esa clave tiene facturación activa. La marca es una confirmación operativa del responsable; no consulta Google Billing ni garantiza saldo futuro. Sin clave o sin confirmación, la tarjeta permanece pendiente y no permite seleccionar Gemini.

Se recomienda un proyecto de API independiente del Firebase de Sarin para conservar su facturación y límites existentes. La comprobación de disponibilidad consulta el modelo sin generar contenido; no prueba una reserva ni confirma el saldo. Antes de seleccionar Gemini para clientes, comprobar una conversación sintética con herramientas y el registro de consumo. Si se desactiva la facturación, retirar la confirmación y volver a un proveedor disponible.

La integración usa `generateContent` nativo con destino fijo de Google, modalidad `standard`, pensamiento mínimo y hasta 4.096 tokens de salida por llamada. Las firmas de pensamiento y los identificadores de herramientas se conservan solo en memoria del servidor durante el turno; no se devuelven al navegador ni se registran en el medidor. Cada respuesta de herramienta debe corresponder a una llamada pendiente. Las imágenes siguen requiriendo el motor local.

## Cuenta, datos y créditos

La cuota de Gemini de la aplicación de consumo no se transfiere a Sarin iniciando sesión con Google. Google AI Pro ofrece créditos mensuales de Google Cloud mediante Google Developer Program; requieren canje y una cuenta de facturación elegible. Si la cuenta usa prepago, Google exige saldo positivo antes de aplicar los créditos elegibles. El contador de Sarin muestra el costo bruto estimado de API y no conoce bonos, saldo, impuestos o descuentos de la cuenta.

Para conversaciones de clientes en Colombia, usar el proyecto con facturación activa. Los términos de los servicios gratuitos indican que no se debe enviar información personal o confidencial y permiten uso de entradas y salidas para mejorar productos. En los servicios de pago Google no usa ese contenido para mejorar sus productos, aunque puede conservarlo temporalmente para seguridad y cumplimiento. No habilitar registro de conversaciones ni funciones externas de búsqueda por defecto.

Fuentes verificadas el 15 de octubre de 2026: [beneficios de Google AI Pro](https://support.google.com/googleone/answer/14534406?hl=es-co), [créditos de desarrollador](https://developers.google.com/profile/help/benefits), [facturación de Gemini API](https://ai.google.dev/gemini-api/docs/billing), [condiciones de datos](https://ai.google.dev/gemini-api/terms).

## Costo estimado

Gemini 3.5 Flash-Lite, tarifa estándar por millón de tokens en USD: entrada 0,30; entrada con caché 0,03; salida, incluido pensamiento, 2,50. Ejemplo orientativo: 1.000 llamadas con 2.000 tokens de entrada y 500 de salida total cada una cuestan USD 1,85 sin caché. Una respuesta de Sarin puede requerir varias llamadas para consultar y reservar. El cálculo no incluye impuestos ni créditos promocionales y no constituye una factura.

No se crea caché explícita ni se habilitan herramientas de Google con cobro adicional. El medidor reconoce únicamente el modelo y modalidad admitidos; conserva tokens e informa costo desconocido cuando faltan datos suficientes. Los límites de tokens y rondas no son un presupuesto monetario. Revisar alertas y controles del proyecto; no se habilita recarga automática desde Sarin.

Fuentes: [modelo estable](https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash-lite), [precios](https://ai.google.dev/gemini-api/docs/pricing).

## Reversión

Seleccionar IA local o DeepSeek antes de volver a una imagen que no reconozca Gemini. Los turnos en curso terminan con su proveedor original. Conservar el historial privado de consumo; retirar las variables Gemini si ya no se utiliza. El historial de DeepSeek permanece independiente.
