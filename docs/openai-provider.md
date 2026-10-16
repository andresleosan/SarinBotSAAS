# OpenAI como proveedor opcional

El propietario puede elegir OpenAI, DeepSeek o IA local desde `/admin`. La selección es manual, global para chat de clientes, copiloto y configuración inicial; cada turno conserva su proveedor. No existe cambio automático ante errores. Vault y su visión siguen usando únicamente Ollama.

## Configuración privada

La integración actual de Sarin usa una API key y facturación de API separada del plan de ChatGPT. [Sign in with ChatGPT y ChatGPT plan usage](https://developers.openai.com/siwc/token-sharing-open-source) ofrecen otra vía: una aplicación elegible puede solicitar autorización para consumir los límites o créditos permitidos del plan del usuario mediante solicitudes compatibles. Sarin es una aplicación comercial alojada remotamente, por lo que debe [solicitar acceso al programa](https://developers.openai.com/siwc/request-client-id); no tiene aprobación ni esta integración implementada. La suscripción personal del propietario no se debe asumir como una bolsa compartida que cubra a todos los clientes de Sarin.

Configurar `OPENAI_API_KEY` únicamente en el entorno privado del servidor y `OPENAI_MODEL=gpt-6-luna`. Nunca usar variables `NEXT_PUBLIC`, incluir la clave en Git o pegarla en el panel. La aplicación admite este modelo explícito y el destino fijo `https://api.openai.com/v1/chat/completions`. Una clave ausente deja la opción visible como pendiente y deshabilitada.

El panel comprueba el catálogo mediante `GET /v1/models` antes de aceptar una selección. Esta comprobación no genera texto y no demuestra saldo suficiente, cuota o calidad de las respuestas: después de configurar la clave se debe realizar una prueba sintética de conversación y reserva antes de utilizarlo con clientes.

Chat Completions permite herramientas en GPT-6 Luna con `reasoning_effort=none`; Sarin fija ese valor, `service_tier=default`, `store=false` y una salida máxima de 4.096 tokens por llamada. Las herramientas mantienen sus validaciones, permisos e idempotencia en el servidor. Las respuestas de error del proveedor no se muestran ni se registran con su contenido original. No se envían imágenes a las APIs de chat externas.

## Datos y costos

OpenAI recibe el contexto de conversación y negocio que Sarin necesita y los resultados de las herramientas. `store=false` evita solicitar almacenamiento de la respuesta para recuperación, pero no equivale a retención cero. Revisar las condiciones de datos aplicables a la cuenta antes de habilitar conversaciones reales: [controles de datos de la API](https://developers.openai.com/api/docs/guides/your-data).

Tarifa estándar verificada el 15 de octubre de 2026, en USD por millón de tokens:

| Concepto | Tarifa |
| --- | ---: |
| Entrada normal | 0,10 |
| Entrada con acierto de caché | 0,01 |
| Escritura de caché | 0,125 |
| Salida | 0,50 |

La tarifa cambia para solicitudes con más de 272.000 tokens de entrada: entrada y caché al doble, salida a 1,5 veces. Sarin estima por llamada según los tokens y el modelo reportados, y separa el historial de OpenAI del de DeepSeek. Si faltan detalles de escritura de caché, muestra un rango; si no puede reconocer modelo o tarifa, conserva los tokens e informa costo desconocido. No mezcla ese gasto con la bolsa de respuestas de la suscripción.

Ejemplo orientativo: 1.000 llamadas, cada una con 2.000 tokens de entrada y 500 de salida, sin aciertos de caché, cuestan aproximadamente USD 0,45–0,50. El rango depende de las escrituras de caché. Una respuesta de Sarin puede requerir varias llamadas para consultar disponibilidad o reservar. Impuestos, moneda de pago y otros servicios quedan fuera del cálculo.

No hay un límite monetario mensual de OpenAI impuesto por Sarin ni alertas de gasto verificadas en la cuenta. Los límites de tokens, rondas y respuestas no sustituyen ese control. El operador debe revisar el consumo y los controles de gasto de su proyecto; esta integración no habilita recargas ni modifica la facturación.

Fuentes: [GPT-6 Luna: capacidades y tarifas](https://developers.openai.com/api/docs/models/gpt-6-luna), [contrato Chat Completions](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create) y [retirada de GPT-5.4 nano y reemplazo recomendado](https://developers.openai.com/api/docs/deprecations). La selección económica debe validarse con los casos reales del bot; no implica una calidad ya probada con esta cuenta.

## Verificación y reversión

Los tests usan respuestas simuladas para herramientas, errores, cancelación, consumo y autorización. `dev:local` vacía las credenciales de OpenAI y DeepSeek, y el ensayo local rechaza su presencia. El despliegue de código no selecciona OpenAI ni configura una clave.

Para dejar de usar OpenAI, seleccionar IA local o DeepSeek disponibles desde `/admin`. Los turnos en curso terminan con su proveedor original. El historial de consumo se conserva. Al volver a una imagen anterior que no reconozca OpenAI, cambiar primero la selección a un proveedor admitido; nunca dejar `serverSettings/ai.provider=openai` con ese código anterior.
