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

Verificación visual: precios semanales/quincenales/mensuales, trial sin venta de paquetes, aviso al 80% con renovación programada, ampliación con vencimiento actual explícito, comprobante pendiente y bolsa agotada. A 320 px, el ancho del documento y del viewport son 305 px (resto: scrollbar); no hay desbordamiento horizontal de página. La navegación conserva su desplazamiento propio. Un mensaje sintético al negocio agotado recibe HTTP 402, pausa la IA y bloquea la entrada, sin llamar al modelo.

La cuenta de negocio recibe «Acceso restringido» en `/admin`. Como administrador local se abrió la captura sintética y se aprobó el paquete: la capacidad pasó de 3.000 a 4.000, con 1.000 disponibles y el mismo vencimiento 25/10/2026. La cuenta del negocio confirmó ese saldo y el comprobante aprobado. La agenda abrió correctamente. No se observaron errores de consola. Capturas privadas: `sarin-commercial-warning-mobile-20261016.png` y `sarin-commercial-admin-synthetic-20261016.png`. Al terminar se cerró la pestaña sintética y se detuvieron Next/emuladores; se preservó el túnel privado 3032.

## Límites y operación

No se ha enlazado un número Meta ni validado una entrega real. El costo Meta permanece desconocido y se remite a su plataforma; el medidor DeepSeek continúa separado. La imagen anterior y los documentos se conservarán para reversión. La publicación pública del backend y la prueba real de WhatsApp son pasos posteriores independientes.

## CI e instancia privada

Código en `c509b26716e2782fc9fff03e4ea94f3ce57468c6`. La [ejecución CI 38840751541](https://github.com/andresleosan/SarinBotSAAS/actions/runs/38840751541) aprobó sus tres jobs: calidad/builds, Firestore/recorrido y Cloudflare. Los logs confirman 408 pruebas, 17 de reglas/integración y 84 comprobaciones del recorrido. Las 18 pruebas omitidas en la suite general corresponden a las suites ejecutadas por los runners opt-in.

Se construyó y activó `sarin-bot:commercial-quotas-20261016t023024z`, imagen `sha256:b8e43c0d518d24bac9da342a811f0d5319a55229ddb9b769412da46b8d36f005`, desde 107 archivos exactos del commit. Se verificaron cada blob y SHA del contexto, Node24, standalone y ausencia de archivos privados en la imagen. El build conservó la instancia anterior en funcionamiento.

La activación cambió solo la imagen de Compose, con copia privada verificada y reversión automática ante fallo. Conservó entorno, ADC readonly, usuario Node, DNS, una réplica y puerto loopback. Pasaron 22 controles de autorización antes y 28 después, GET/POST de webhook desactivado con 503, páginas/assets y lecturas acotadas de Firebase. El catálogo Ollama protegido devolvió 200 con el modelo presente; `/api/tags` siguió bloqueado con 404. No hubo inferencia pagada ni cambio de proveedor. Respaldo operativo: `/opt/sarin-bot/runtime/rollbacks/commercial-quotas-image-update-20261016T022838Z-779900f8`.

La sesión real del propietario abrió el panel: IA local disponible, DeepSeek configurado, WhatsApp desactivado sin números, negocio piloto con 700 respuestas y ningún pago. Se verificó también el acceso a Vault sin modificar su contenido. La configuración persistida conservaba $19.900/$34.900 en semanal/quincenal; se corrigió mediante el panel a los $20.000/$35.000 expresamente aprobados. Mensual quedó en $59.900, WhatsApp preparado en $149.900 y ampliación en $20.000. Se confirmó «Datos de facturación guardados» y se conservaron las cuentas receptoras. Esta modificación administrativa es posterior e independiente del cambio de imagen.

Captura de la instancia privada: `C:/Users/USER/AppData/Local/SarinBot/deployment/sarin-commercial-private-20261016.png`. Manifiesto, archivo fuente, build, scripts revisados y tiempos se conservan fuera de Git. El panel privado quedó abierto para el propietario; no se publicó el backend al público ni se habilitó Meta.

## Rendimiento y costos

Los mismos controles de despliegue midieron tiempos, sin generar carga adicional: Auth 3.898/3.809 ms y lectura Firestore 1.091/1.083 ms antes/después, incluyendo las condiciones reales de identidad federada. Nueve assets tardaron 11,6/21,9 ms en conjunto. El HTTP más lento posterior fue el primer `/api/session` tras arrancar (603 ms); los siguientes dos más lentos fueron 25,4 y 23,8 ms. Son comprobaciones aisladas de arranque y transporte, no un benchmark de carga ni una garantía de latencia de chat.

No se hizo optimización especulativa de consultas administrativas. La documentación del stack cuantifica las escrituras de cuota y el polling WhatsApp, y separa las bolsas comerciales de los límites monetarios. Las alertas de gasto y la conciliación de Meta siguen pendientes de su alta; ninguna conexión paga nueva se activó.
