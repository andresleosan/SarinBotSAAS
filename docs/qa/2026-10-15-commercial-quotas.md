# Cuotas comerciales y preparación de WhatsApp

El propietario autorizó implementar la estructura comercial y confirmó prueba de siete días con 700 respuestas, copiloto en la misma bolsa y límite separado antes de crear el negocio. Todavía no tiene número WhatsApp: toda la validación de ese canal es sintética, sin mensajes reales.

## Implementación y revisión

Períodos privados, reserva atómica de capacidad, reintentos idempotentes, ampliaciones de 1.000 respuestas, renovación futura y pausa de IA; contrato en [cuotas](../response-quotas.md). El chat compartido conserva las herramientas y la identidad verificada de cada transporte. WhatsApp tiene firma, cifrado, bandejas durables, ventana de respuesta, estados y mantenimiento; contrato en [WhatsApp](../whatsapp-cloud-api.md).

Revisión independiente de cuotas/pagos, chat, UI, permisos y worker. Se corrigieron la confirmación de un bloqueo ya cancelado, la compra de paquetes durante acceso preventivo, la cola bloqueada por números pausados y la limpieza concurrente de historial renovado. Se separó el mantenimiento de WhatsApp de los envíos y se redujo el polling vacío a 30 segundos. El registro Meta declara el mes de generación de las respuestas; no se confunde con el mes de su factura ni asigna un costo cero cuando no puede calcularlo.

## Evidencia local

- `pnpm run typecheck`: aprobado.
- `pnpm test`: 408 aprobadas; las suites opt-in de Firestore/recorrido se ejecutan con sus runners.
- `pnpm run test:rules`: 17 aprobadas con Java 21 y Firestore real emulado. Incluye carrera por la última respuesta, aprobación concurrente/idempotente, denegación de todas las colecciones privadas y recepción/entrega WhatsApp persistida sin red real.
- `pnpm run test:journey --port 3040`: 84 comprobaciones y limpieza limitada aprobadas. Incluye trial700, bolsa semanal, paquete de 1.000 sin extensión, aprobación repetida, renovaciones futuras y permisos administrativos WhatsApp.
- `pnpm run build`, `pnpm run build:landing`, `pnpm run check:landing`: aprobados; la portada temporal conserva 41 archivos públicos y no expone rutas privadas.
- `pnpm --filter sarin-cloudflare-host run check`: nueve pruebas, tipos y dry-run aprobados. El worker de WhatsApp requiere VPS persistente; no se habilitó en Containers.
- `pnpm audit --audit-level=high`: sin vulnerabilidades conocidas.

Chrome usa una copia privada de las fuentes, Next Webpack y los emuladores oficiales de `demo-sarin-bot`. WhatsApp y retención permanecen apagados; Ollama apunta a un puerto loopback sin servicio. Los 25 documentos de la fixture son sintéticos y se crearon con precondición de inexistencia. El recorrido se ejecutó antes del login visual para conservar su comprobación del perfil administrativo.

Verificación visual: precios semanales/quincenales/mensuales, trial sin venta de paquetes, aviso al80% con renovación programada, ampliación con vencimiento actual explícito, comprobante pendiente y bolsa agotada. A320px, el ancho del documento y del viewport son305px (resto: scrollbar); no hay desbordamiento horizontal de página. La navegación conserva su desplazamiento propio. Un mensaje sintético al negocio agotado recibe la pausa de IA y bloquea la entrada, sin llamar al modelo.

## Límites y operación

No se ha enlazado un número Meta ni validado una entrega real. El costo Meta permanece desconocido y se remite a su plataforma; el medidor DeepSeek continúa separado. La imagen anterior y los documentos se conservarán para reversión. La publicación pública del backend y la prueba real de WhatsApp son pasos posteriores independientes.

CI y activación privada se registrarán después de completarse; esta sección no afirma que estén realizados.
