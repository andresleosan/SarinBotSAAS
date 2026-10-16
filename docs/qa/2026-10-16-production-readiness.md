# Preparación comercial y producción — 16 de octubre de 2026

> **Actualización más reciente:** [imagen PNG de la cita publicada y validada](2026-10-16-appointment-image.md), Worker `82361d3f-2e3a-4830-8785-ecfc678bfc68`, Containers versión 5. Sustituye la descarga ICS de la fase comercial descrita a continuación; mantiene DeepSeek y D1/R2. Los identificadores y pruebas inferiores conservan la evidencia de su fase.

> **Estado vigente de entrega:** candidata a un piloto comercial controlado. El [informe comercial E2E](2026-10-16-commercial-e2e.md) es la fuente de aceptación actual y prevalece sobre el dictamen histórico conservado abajo. DeepSeek quedó activo por decisión explícita del propietario; D1/R2 y Google Auth continúan operativos. Imagen `sha256:3c416933dbc6ec618e71fd6d6199ae162a17889fb87ea24f58aab3c89ef44c01`, Worker `5beb7020-fb82-42b7-a618-ea0406e5803a`, instancia versión 4.
>
> Ollama completó el recorrido con un cliente externo. DeepSeek completó reserva, `.ics` y cancelación en la interfaz pública con la sesión del propietario; el UID compartido explica «cancelada por el negocio» y no se cuenta como cliente distinto. Se aprobó un comprobante sintético y se verificaron 10 citas/700 respuestas; no hubo transferencia ni conciliación de dinero real. Los pagos se revisan únicamente en la bandeja administrativa, sin avisos automáticos por correo.
>
> Verificación actual: 679 pruebas de aplicación aprobadas y 20 integraciones omitidas, 68 del Worker y 25 del gateway. El recorrido local de 96 comprobaciones y el E2E público son evidencias separadas. Alertas Cloudflare USD 5/USD 8 y alerta DeepSeek de saldo USD 2 activas, sin tope automático garantizado de USD 15. Hay una copia privada de 123 archivos de las fuentes, todavía sin commit de esta entrega. Siguen pendientes decisiones formales de conservación/devolución y la transferencia bancaria real; el cierre de horarios del negocio de prueba se registra en el informe vigente. WhatsApp está deshabilitado y el marketplace es solo análisis.
>
> **Registro histórico a continuación:** las menciones de Firestore comercial, Vault, Ollama offline, cifras anteriores y trabajo pendiente describen las fases en que se escribieron; no son el estado de la entrega actual.

## Dictamen

Decisión de alcance posterior: el propietario retiró Vault y descartó el chat personal para concentrar el producto en la operación comercial. La evidencia anterior de ese módulo es histórica. Ver [retiro y verificaciones comerciales](2026-10-16-commercial-focus.md).

Actualización de datos posterior a la aceptación de alojamiento: **D1 y R2 ya están activados**, con los 19 documentos verificados y Firebase conservado para Auth Google. Sesión, administración y citas existentes funcionan con la imagen nueva; Firestore se conserva como respaldo anterior. Al terminar esta fase el Mac está apagado y Ollama offline, confirmado por el propietario. Ver [aceptación de datos y pendientes exactos](2026-10-16-cloudflare-data-migration.md). La aceptación de Ollama descrita abajo corresponde a la fase de alojamiento anterior.

Actualización posterior: **aplicación y landing publicadas en Cloudflare y verificadas con sesión real**. Funcionan Google/Firebase Admin, lecturas Firestore, administración y Ollama directo a la Mac; se repitieron después de reiniciar el Container y detener el Node de la VPS. También se comprobaron una cita existente, historial, calendario y descarga `.ics`. El contenedor antiguo, su timer de certificados y su forward local están detenidos; se conservó reversión. Ver [evidencia de la migración](2026-10-16-cloudflare-migration.md). Las tablas de la auditoría local se conservan como evidencia histórica, separadas de esa aceptación pública.

El código tiene un MVP funcional de agenda, reservas con IA, pagos revisados manualmente y aislamiento entre negocios. **La apertura pública todavía requiere validación y trabajo operativo.** Las comprobaciones locales no prueban disponibilidad pública ni capacidad para un número concreto de negocios.

El origen confirmado es **https://sarinbotsaas.pages.dev/**, con la parte del cliente dentro de cada negocio. Pages sirve la landing y conecta por binding privado con un Worker y un Container único para Next. Firebase permanece en Google; Ollama en la Mac por Tunnel/Access; Vault en el navegador. La aplicación activa no depende de la VPS.

La auditoría local conservó todos los cambios anteriores, incluida la prueba pagada, y usó `demo-sarin-bot` para sus escrituras. La migración posterior fue autorizada y publicada; sus pruebas autenticadas no crearon reservas, pagos, mensajes ni inferencias de producción. No se enviaron comunicaciones.

## Evidencia repetida durante la auditoría

Entorno: Node 24.18.0, pnpm 11.23.0. Para el emulador se seleccionó Java 21 de Adoptium solo en el proceso de prueba; el Java predeterminado del equipo es 8.

| Comprobación del estado inicial | Resultado observado |
| --- | --- |
| `pnpm run typecheck` | Correcto |
| `pnpm test` | 578 pasan; 20 omitidas en tres archivos de integración |
| `pnpm run test:rules` | 19 pasan con Firestore oficial en 8188 |
| `pnpm run test:local --port 3040` | Correcto: Auth, APIs, Admin SDK, Firestore y rechazo de cliente en administración/Vault |
| `pnpm run test:journey --port 3040` | Una prueba con 96 comprobaciones; limpieza de sus datos y cuentas confirmada |
| `pnpm audit --json` | Cero vulnerabilidades conocidas reportadas |
| `pnpm run build` | Correcto; rutas Next generadas |
| `pnpm run build:landing` y `pnpm run check:landing` | Correctos; 41 archivos públicos verificados |
| `pnpm --filter sarin-cloudflare-host run check` | Nueve pruebas, tipos y dry-run correctos; sin desplegar |
| Instancia privada `/api/session`, sin sesión | HTTP 401, `no-store` |
| Catálogo del motor remoto, sin token Access | HTTP 403, `no-store` |

Las 20 omisiones de la suite general no son 20 fallos: 19 se ejecutaron mediante `test:rules` y el archivo restante mediante `test:journey`. La integración de reservas usa funciones reales sobre el emulador; no prueba conversación con el modelo. El dry-run del Worker no acredita conectividad, configuración de cuenta ni ejecución de la imagen en producción.

`doctor` detecta Firebase/ADC presentes en este checkout y UID/modelos/motor pendientes en su configuración local. No valida credenciales y **no describe la configuración de la VPS**. Tampoco prueba DeepSeek o Gemini.

## Lo que ya existe y lo que faltaba para el cliente

Antes de esta ampliación, `/b/[slug]` ya exigía Google, consultaba citas por `client.uid`, mostraba próximas reservas confirmadas en tiempo real y descargaba `.ics`. La recarga conservó una reserva real con Ollama en la [prueba privada grabada](2026-10-16-recorded-private-journey.md).

Faltaban una vista de histórico, consulta por fecha y controles de cancelación. La lectura filtraba `status === "confirmed"` y después descartaba citas terminadas, por lo que las canceladas y pasadas no aparecían. El backend ya autorizaba cancelar al propietario de la cita, pero la interfaz del cliente no lo ofrecía.

La ampliación solicitada conserva las citas dentro de cada negocio y aprovecha esa API. No añade un panel global ni reprogramación conversacional. Descargar `.ics` requiere importación por el usuario; no es sincronización bidireccional ni un aviso automático.

## Cambios implementados y verificación final

- **Landing:** se retiraron «Próximamente», el anuncio de funciones no disponibles y sus metadatos antiguos. Se muestran funciones concretas, prueba pagada, planes Esencial, respuestas incluidas y aprobación manual. Los precios proceden de constantes aprobadas, no de una consulta a Firestore; cambios de tarifas requieren republicar la portada. WhatsApp y copiloto no se ofrecen como funciones activas.
- **Cliente:** `ClientAppointments` añade Próximas, Historial y Calendario por fecha, con estados explícitos, carga/reintento y errores propios. Una hora pasada no se presenta como asistencia confirmada. La cabecera enlaza a «Mis citas». Se consulta exclusivamente el negocio y UID autenticados, se descartan callbacks anteriores y registros sin identidad/tipo/estado válidos. Las citas se conservan con el chat pausado.
- **Cancelación:** dos pasos explícitos, una petición PATCH, bloqueo de duplicados, validación del resultado y paso al historial. Se conserva la cita ante error. La UI solo permite cancelar/exportar futuras confirmadas y revalida la hora al actuar. El backend existente verifica identidad, pero aún permite cancelar una cita pasada si un cliente llama directamente a la API: la restricción temporal de esta entrega es de interfaz.
- **Calendario:** exportación de un evento con fecha/hora de Colombia y duración del servicio, sin añadir el margen de preparación. No se envía correo ni se sincroniza una cuenta de calendario.
- **Pages/Container:** gateway en `pages-gateway/`, empaquetado con `pnpm run build:pages`, conectado por `SARIN_APP_HOST` a un Worker privado. La CI incluye sus pruebas y el build del artefacto. El [runbook vigente](../cloudflare-no-vps-runbook.md) documenta publicación, costos y reversión; la [guía Pages/VPS](../pages-vps-gateway.md) corresponde a la alternativa anterior.

Validación final sobre las fuentes modificadas:

| Comprobación | Resultado |
| --- | --- |
| `pnpm test` | **605 pasan**, 20 integraciones omitidas en la suite general |
| `node --test pages-gateway/tests/*.test.mjs` | **17 pasan**, sin red ni credenciales reales |
| `pnpm run typecheck` y `git diff --check` | Correctos |
| `pnpm run build` | Correcto, build completo Next después de las modificaciones |
| `pnpm run build:pages` | Correcto: exportación verificada y Worker/manifiesto empaquetados sin secretos |
| `wrangler pages dev`, runtime local, compatibilidad `2026-10-13` | Portada y JS **200**; cinco rutas de app/privadas y POST **503** sin caché cuando no hay backend configurado |
| Navegador Chrome, cliente emulado | Próximas, histórico y consulta por fecha correctos; cancelación con confirmación devuelve PATCH 200 y aparece en el historial |
| Descarga real de `.ics` desde el navegador | Archivo de 360 bytes, un evento: `20261017T150000Z`–`20261017T153000Z`, equivalente a 10:00–10:30 Colombia |
| Móvil de 320 × 740 | Landing y cliente con ancho de documento 320; sin desbordamiento horizontal; título de negocio y acceso a citas legibles |

Los cambios nuevos recibieron revisión independiente sin bloqueantes. Las 19 pruebas Firestore y las 96 comprobaciones del recorrido descritas arriba se ejecutaron en esta misma auditoría antes de la ampliación de interfaz; no se modificaron backend, reglas ni dependencias para esa ampliación. La auditoría de dependencias reportó cero vulnerabilidades conocidas.

Evidencia visual con datos exclusivamente sintéticos:

- [Landing en escritorio](2026-10-16-product-landing-desktop.png).
- [Landing móvil](2026-10-16-product-landing-mobile.png) y [planes móviles](2026-10-16-product-plans-mobile.png).
- [Histórico del cliente después de cancelar](2026-10-16-client-history-mobile.png).

El aviso rojo del emulador en la captura del cliente identifica deliberadamente el entorno de prueba. No se ocultó para simular producción. La automatización del evento de descarga agotó su espera, pero el archivo sí se descargó y se verificó posteriormente desde el disco; no se confundió ese timeout del harness con un fallo de la aplicación.

Al terminar la auditoría local se cerró la pestaña creada, se restableció el viewport y se detuvieron los servidores de QA en 3031/3040/3050 y los emuladores. La instancia privada preexistente en 3032 permaneció activa en ese momento; después de aceptar Cloudflare se detuvo su runtime y forward. La copia previa de los archivos modificados vive fuera de Git en `%LOCALAPPDATA%/SarinBot/audit-2026-10-16`.

La primera comprobación pública encontró todavía «Próximamente» y rutas privadas 404. **Ese estado quedó superado por el despliegue posterior**: landing real 200, dashboard con sesión y APIs autenticadas 200, Ollama disponible desde Cloudflare y citas del cliente verificadas con la VPS Sarin detenida. La migración terminó con 628 pruebas de aplicación, 40 de Cloudflare y 25 de gateway correctas, además de tipos/builds; sus límites están registrados en el informe enlazado. El lockfile no cambió.

## Bloqueos para abrir el servicio

### P1 — Aceptación comercial y versión exacta

- La publicación, dominio Firebase, credenciales Google sin VPS, administración y conexión al motor ya están verificados. Completar el recorrido público con una cuenta de cliente distinta, QR canónico, nueva reserva, histórico, cancelación y pago propio de aceptación. Las lecturas de una reserva existente no sustituyen ese recorrido.
- Medir una inferencia real y solicitudes largas con cola desde el origen público. La consulta saludable de modelos no demuestra generación ni tiempo de respuesta completo. Medir también capacidad antes de prometer un número de negocios.
- La imagen publicada incluye las fuentes locales revisadas, incluida la prueba pagada. No hubo commit ni push por tratarse de un checkout mixto; integrar y verificar las fuentes exactas antes de la siguiente publicación desde Git. La [QA de prueba pagada](2026-10-16-paid-trial.md) describe su fase anterior sin despliegue, no el estado actual completo.
- Respaldar datos y revisar compatibilidad antes de cambiar acceso comercial. [Prueba pagada y reversión](../paid-trial.md) explica que volver a una imagen anterior puede restituir acceso gratuito.

### P1 — Protección contra consumo abusivo

`src/lib/server/inference.ts` impide dos consultas simultáneas del mismo UID, pero no limita consultas secuenciales por usuario o ventana de tiempo. `response-quota.ts` permite que los clientes consuman la bolsa compartida del negocio. No se encontró control por frecuencia/actor, bloqueo de clientes ni verificación del teléfono del cliente web. Tampoco se verificaron reglas WAF externas.

Un cliente autenticado podría automatizar mensajes nuevos y agotar la bolsa o crear reservas no deseadas. Es una conclusión de revisión de código; no se atacó el servicio real. Definir y probar límites por cliente/negocio, protección de reservas y tratamiento de errores 429 antes de captar tráfico abierto.

### P1 — Información de privacidad y operación comercial

No se encontró aviso/política accesible en login, landing o chat que explique datos guardados, uso de proveedores externos y contacto para solicitudes. Las reservas conservan contacto y campos de admisión; los resultados de herramientas pueden volver al proveedor de IA seleccionado. Es una brecha de información del producto; esta auditoría no determina cumplimiento jurídico.

Bancolombia y Nequi **sí fueron configurados**, según la actualización final de [QA de planes](2026-10-15-billing-plans.md). Los pendientes antiguos que dicen lo contrario quedaron superados. Falta acreditar un cobro y conciliación reales, y fijar responsable/frecuencia para aprobar comprobantes y atender errores. La captura de un recibo no verifica por sí sola una transferencia.

### P1 — Recuperación y respaldo

La documentación acredita reinicio del Container, nuevas credenciales Google y respuesta del motor con el runtime VPS detenido. No acredita restauración de Firestore, reinicio completo de la Mac ni aviso automático de fallos al operador. Preparar una copia verificable y ensayar restauración, definir monitoreo de web/motor/identidad y comprobar alertas operativas y de gasto. El presupuesto de USD 15 no tiene corte automático. Con una sola réplica, reinicios interrumpen solicitudes y la cola no persiste.

## Limitaciones que deben reflejarse en la oferta

- **WhatsApp:** implementación preparada y pruebas sintéticas; sin número conectado ni entrega real acreditada. No anunciar como canal operativo ni habilitar su venta antes de aceptarlo.
- **Copiloto:** existe modo servidor, sin pantalla que lo invoque. Retirarlo de las promesas comerciales o completar su acceso.
- **Capacidad:** máximo cuatro slots y cola en memoria; no hay prueba de carga comercial. No prometer disponibilidad continua ni negocios simultáneos ilimitados.
- **Notificaciones:** no hay correo ni recordatorios automáticos. El calendario actual se descarga como archivo.
- **Retención:** citas, admisión y comprobantes carecen de un ciclo operativo de retención/borrado acreditado; WhatsApp sí tiene mantenimiento específico. Definir plazos y procedimiento de solicitudes sin eliminar datos por iniciativa de esta auditoría.
- **Cuotas:** una caída puede dejar unidades reservadas sin confirmación. Su conciliación necesita revisar la operación, según [el contrato de cuotas](../response-quotas.md).
- **Vault:** exclusivo del administrador, local al navegador/UID/origen; exportar antes de cambiar de origen. No ofrecerlo como módulo del cliente.

## Otros hallazgos

La prueba real documenta una explicación imprecisa del margen posterior al servicio y Markdown visible como texto. El prompt actual describe preparación sin precisar su posición. Son defectos de explicación/presentación, distintos de la disponibilidad transaccional que sí fue probada.

El hallazgo inicial de allowlist incompleta de Containers quedó corregido durante la migración: se añadió paridad de runtime, ADC federado y pruebas. Containers es ahora el alojamiento activo. La aceptación real comprobó Ollama; no se presenta como prueba real de DeepSeek, Gemini o WhatsApp.

No se encontró un bypass confirmado de autenticación, escalada a administrador o lectura entre negocios. La revisión de secretos en archivos versionados y nombres históricos fue acotada; no equivale a escaneo exhaustivo de todo el historial, revisión IAM ni comprobación de los secretos desplegados.

## Orden recomendado para la salida

1. Conservar la landing, espacio del cliente e infraestructura Cloudflare ya publicados y verificados.
2. Cerrar protección contra abuso e información de privacidad, y preparar respaldo/alertas/procedimiento de pagos; integrar las fuentes publicadas en Git.
3. Completar en el origen público el recorrido de escritura con cliente distinto: pago propio, inferencia, nueva reserva y cancelación; comprobar caída/recuperación del motor. Google, lecturas, calendario y adquisición de credenciales tras reinicio ya están acreditados.
4. Abrir un piloto acompañado con pocos negocios de Esencial y medir tiempos/consumo antes de ampliar la venta. Mantener WhatsApp fuera de la oferta activa.

El paso de aceptación pública no se puede sustituir por un build verde ni por una captura de la landing.
