# Propuesta Premium WhatsApp — 15 de octubre de 2026

Estado: referencia de costos que respalda la [estructura comercial aprobada](commercial-plans.md). El propietario aprobó Esencial con 700/1.500/3.000 respuestas por 7/15/30 días, WhatsApp con 4.500 por 30 días y ampliaciones de 1.000 respuestas por $20.000. Las cuotas, paquetes e integración WhatsApp aún no están activados. Los precios Esencial configurados siguen siendo $20.000, $35.000 y $59.900 COP, respectivamente.

La propuesta de **$149.900 COP por 30 días + consumo de Meta** separa la suscripción de Sarin del costo de entregar mensajes por la plataforma oficial de WhatsApp Business. La aplicación móvil WhatsApp Business y la API de automatización son productos diferentes. Usar Ollama en la Mac no elimina la tarifa de entrega de Meta. DeepSeek, cuando el administrador lo elija, genera además costos de inferencia en la cuenta de ese proveedor.

## Referencia de Meta

La documentación y la hoja oficial COP verificadas el 15 de octubre indican estas tarifas de lista, vigentes desde el 1 de octubre de 2026, para destinatarios de Colombia:

| Categoría | COP por mensaje entregado |
| --- | ---: |
| Servicio, después de la franquicia mensual | 2,9455 |
| Utilidad | 2,9455 |
| Autenticación | 2,9455 |
| Plantilla de marketing por Cloud API | 46,0227 |

Cada número de negocio recibe 1.000 mensajes de servicio gratis por mes calendario; no se acumulan. La tarifa depende del mercado del destinatario, la categoría, la moneda de facturación y las exenciones aplicables. Las plantillas de utilidad/autenticación tienen niveles de volumen. Los mensajes sin plantilla pueden responder dentro de la ventana de atención de 24 horas que abre o renueva un mensaje del usuario.

Los recordatorios y seguimientos proactivos son opcionales: se pueden omitir. La confirmación inmediata de una reserva puede formar parte de la respuesta libre dentro de las 24 horas; sigue contando como mensaje de servicio entregado. Fuera de esa ventana se requiere una plantilla aprobada. No se cambia la categoría de una plantilla para evitar su tarifa. Actualmente Sarin no tiene conectada la API de WhatsApp ni envíos de notificaciones.

## Ejemplo de barbería, sin recordatorios

El propietario confirmó **15–50 conversaciones diarias, cada una con 6–12 respuestas de Sarin**. Supuestos de cálculo: 30 días, un número empresarial, destinatarios de Colombia, una salida de WhatsApp por respuesta, todas entregadas dentro de la ventana de atención, sin marketing ni plantillas y sin otras exenciones. Los 30 días de Sarin no necesariamente coinciden con el mes calendario de Meta.

Para DeepSeek Flash se presupuestan **dos llamadas al modelo por respuesta de Sarin**, cada una con **2.000 tokens de entrada y 500 de salida**, sin ahorro por caché. Incluyen instrucciones, historial y resultados de herramientas; no son solo las palabras del último mensaje. El código admite hasta cuatro rondas por turno. El rango aplica la tarifa fuera de pico/pico a todo el consumo: USD 0,15/0,30 por millón de entrada y USD 0,60/1,20 por millón de salida. No es un límite garantizado: un historial mayor o más rondas aumenta el costo.

Conversión ilustrativa con la TRM oficial del 15 de octubre de 2026, **$3.197,65 COP/USD**; no garantiza el cambio aplicado por el medio de pago. Cifras redondeadas, antes de impuestos, recargas/comisiones, intermediarios e infraestructura.

| Conversaciones/día × respuestas | Salidas en 30 días | Meta COP | DeepSeek USD | DeepSeek COP | Meta + IA COP |
| --- | ---: | ---: | ---: | ---: | ---: |
| 15 × 6 | 2.700 | $5.007 | 3,24–6,48 | $10.360–$20.721 | $15.368–$25.728 |
| 30 × 9 | 8.100 | $20.913 | 9,72–19,44 | $31.081–$62.162 | $51.994–$83.075 |
| 50 × 12 | 18.000 | $50.074 | 21,60–43,20 | $69.069–$138.138 | $119.143–$188.212 |

Fórmulas: `Meta = max(0, salidas - 1.000) × 2,9455 COP`; `IA = salidas × 2 llamadas × (2.000 × tarifa_entrada + 500 × tarifa_salida) / 1.000.000`. Se trata de escenarios, no de mediciones reales de clientes. Los aciertos de caché podrían reducir la entrada a USD 0,003/0,006 por millón; no se presupone ese ahorro. El horario de pico es lunes a viernes UTC 01:00–04:00 y 06:00–10:00, excluyendo festivos oficiales chinos. La atención de día en Colombia normalmente corresponde a fuera de pico; un bot disponible todo el día también puede recibir mensajes en pico.

Antes de definir cuotas, la propuesta de **$149.900 + Meta incluyendo IA** habría dado totales al cliente de **$154.907, $170.813 o $199.974 COP** en esos tres escenarios. Son ejemplos históricos de precio base más Meta, no cotizaciones de los planes aprobados: el escenario medio y alto superan las 4.500 respuestas ahora incluidas y requieren ampliación o cotización. DeepSeek sale del ingreso de Sarin, no se agrega dos veces a la factura. En el escenario alto, USD 43,20 equivalen a unos $138.138 COP de IA, lo que explica la necesidad de limitar el uso incluido antes de sumar alojamiento, soporte e impuestos.

DeepSeek cobra tokens de cada llamada contra el saldo de la cuenta (saldo otorgado primero, cuando exista, y saldo recargado después); no es una mensualidad fija de chat. Una respuesta que consulta horarios o reserva puede requerir varias llamadas. El panel de Sarin calcula una estimación desde los tokens devueltos por la API; la liquidación definitiva sigue siendo la del proveedor.

Fuentes verificadas el 15 de octubre de 2026: [precios oficiales y hoja COP](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing/), [cambios de servicio y utilidad](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing/non-template-messages/), [tarifas y reglas de cobro de DeepSeek](https://api-docs.deepseek.com/quick_start/pricing/), [histórico oficial de TRM de la SFC](https://www.datos.gov.co/Econom-a-y-Finanzas/Tasa-de-Cambio-Representativa-del-Mercado-Historic/mcec-87by). Las tarifas pueden cambiar; revisar nuevamente antes de lanzar el plan. La tabla corresponde a entrega con IA de terceros, no al producto Meta Business Agent y su cobro por tokens.

## Decisiones antes de ofrecerlo

Los precios, respuestas incluidas y ampliaciones ya están definidos en la estructura comercial aprobada, pendiente de implementación. Continúa como recomendación operativa por resolver que cada negocio conserve su cuenta/número y pague directamente a Meta, mientras Sarin cobra su suscripción. También falta concretar alta inicial y soporte antes de contratar WhatsApp. No se ofrece atención ilimitada. Este documento no habilita cargos, métodos de pago ni envío de mensajes.
