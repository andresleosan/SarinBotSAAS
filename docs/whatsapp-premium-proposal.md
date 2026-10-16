# Propuesta Premium WhatsApp — 15 de octubre de 2026

Estado: propuesta comercial, sin integración ni tarifa Premium activada. Los planes vigentes de Sarin siguen siendo 7 días por $20.000 COP, 15 días por $35.000 COP y 30 días por $59.900 COP.

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

Ejemplo ilustrativo con 3.000 respuestas de servicio y 500 mensajes de utilidad entregados, sin otras exenciones: `(3.000 - 1.000 + 500) × 2,9455 = $7.363,75 COP` de Meta. Sumados a la suscripción propuesta: `$157.263,75 COP`, antes de impuestos y de cualquier intermediario. Los 30 días de Sarin no necesariamente coinciden con el mes calendario de Meta.

Fuentes: [precios oficiales y hoja COP](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing/), [cambios de servicio y utilidad](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing/non-template-messages/). Las tarifas pueden cambiar; revisar nuevamente antes de lanzar el plan. La tabla corresponde a entrega con IA de terceros, no al producto Meta Business Agent y su cobro por tokens.

## Decisiones antes de ofrecerlo

Recomendación pendiente de adopción: cada negocio conserva su cuenta/número y paga directamente a Meta; Sarin cobra su propia suscripción. Definir todavía límites incluidos de uso de IA, sobreconsumo, alta inicial y soporte. No ofrecer respuestas ilimitadas mientras esos límites no estén definidos. Esta propuesta no habilita cargos, métodos de pago ni envío de mensajes.
