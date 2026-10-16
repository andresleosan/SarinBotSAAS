# Estructura comercial aprobada — 15 de octubre de 2026

El propietario aprobó esta estructura y después autorizó su implementación. Las cuotas, paquetes y pantallas se implementan según el [contrato de capacidad](response-quotas.md). WhatsApp permanece preparado en código y deshabilitado hasta enlazar y verificar el número que proporcionará el propietario.

## Modalidades y capacidad

| Modalidad | Vigencia | Precio COP | Respuestas de IA incluidas |
| --- | ---: | ---: | ---: |
| Sarin Esencial semanal | 7 días | $20.000 | 700 |
| Sarin Esencial quincenal | 15 días | $35.000 | 1.500 |
| Sarin Esencial mensual | 30 días | $59.900 | 3.000 |
| Sarin WhatsApp | 30 días | $149.900 + consumo de Meta | 4.500 |
| Sarin a medida | Según acuerdo | Cotización | Según volumen |

Esencial incluye agenda, reservas y atención por el enlace web y QR. Las tres duraciones ofrecen las mismas funciones, con capacidad proporcional a la vigencia.

WhatsApp añade automatización mediante la API oficial para un negocio y un número. La atención web y WhatsApp comparten una bolsa de 4.500 respuestas: no son 4.500 por canal. Se prepara solo por 30 días. La suscripción incluye la IA; el consumo de Meta se cobra aparte. La contratación y aprobación se bloquean mientras el número no esté conectado y verificado.

El administrador conserva la elección manual entre IA local y DeepSeek. La capacidad comercial se expresa en respuestas, independientemente del proveedor; el costo técnico de DeepSeek es un gasto de Sarin, no un cargo duplicado al cliente.

## Unidad de consumo

Una respuesta completa de Sarin al cliente cuenta una vez, aunque internamente utilice varias llamadas al modelo. Los mensajes enviados por el cliente no descuentan respuestas. Las llamadas técnicas y los tokens del medidor existente no equivalen a respuestas comerciales.

La prueba gratuita incluye 700 respuestas durante siete días. El copiloto comparte la bolsa del negocio. La configuración asistida anterior a crear el negocio tiene un límite separado de 30 respuestas por cuenta. Ambas reglas fueron confirmadas por el propietario.

Las conversaciones son una referencia orientativa, no un segundo límite. Suponiendo diez respuestas por conversación:

- 3.000 respuestas equivalen a unas 300 conversaciones por 30 días, aproximadamente diez diarias.
- 4.500 respuestas equivalen a unas 450 conversaciones por 30 días, aproximadamente quince diarias.

No hay un límite diario rígido: un día ocupado puede consumir más mientras quede capacidad en la vigencia del plan. Conversaciones más largas consumen la bolsa antes; las más breves permiten atender más conversaciones. La vigencia contratada no tiene que coincidir con el mes calendario que utiliza Meta.

## Crecimiento y agotamiento

- Ampliación de 1.000 respuestas por $20.000 COP, válida durante el período contratado.
- Aviso al alcanzar el 80% del uso incluido.
- Ampliación elegida por el cliente; sin cargos automáticos por excedentes.
- Al agotar la capacidad, se pausa la atención de IA y la agenda continúa disponible.
- Los negocios con unas 30 conversaciones diarias sostenidas pasan a cotización según uso real, sedes, números y soporte. Los paquetes cubren aumentos de uso entre la capacidad inicial y una solución a medida; treinta conversaciones no es un bloqueo diario automático.

No se ofrece atención ilimitada ni se aplica una tarifa según el tamaño físico del local.

## Texto comercial aprobado como base

**Sarin Esencial:** ideal para negocios con aproximadamente 4–10 conversaciones al día. Incluye 3.000 respuestas de IA por 30 días.

**Sarin WhatsApp:** atención automatizada por WhatsApp y web. Incluye 4.500 respuestas de IA por 30 días, equivalentes a unas quince conversaciones diarias de diez respuestas. Consumo de Meta adicional.

Estos textos solo deben publicarse como condiciones disponibles cuando la función correspondiente esté implementada y verificada.

## Estado y trabajo previo a la oferta

Disponible: suscripciones Esencial por 7, 15 y 30 días, selector administrativo de IA y medidor de llamadas/tokens/costo estimado DeepSeek. El medidor actual usa meses calendario y no impone límites de suscripción.

Implementado: contador por vigencia, paquetes por comprobante, aviso de consumo, pausa de IA al agotarse la bolsa y visualización para propietario y administrador. Los reintentos, fallos, operaciones confirmadas y renovaciones se describen en [capacidad de respuestas](response-quotas.md). El despliegue y las pruebas efectivamente realizadas se registran por separado en la evidencia QA.

Preparado: webhook firmado, bandejas cifradas, entrega con deduplicación, estados de mensajes y contadores administrativos de WhatsApp. Pendiente por separado: número y cuenta Meta, credenciales, prueba real de recepción/entrega y conciliación con su factura. El costo Meta no calculado se muestra como desconocido, nunca como cero. No se han activado envíos, cargos ni métodos de pago de terceros.

Los cálculos de referencia y sus supuestos están en [costos de WhatsApp y DeepSeek](whatsapp-premium-proposal.md). La estructura se adopta para el piloto; la rentabilidad debe revisarse con tokens, rondas, infraestructura y soporte reales. La cantidad de respuestas por sí sola no garantiza un costo técnico máximo.
