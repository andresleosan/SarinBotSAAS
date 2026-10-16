# WhatsApp Cloud API: implementación preparada, sin número conectado

El usuario todavía no tiene número de WhatsApp Business. Este cambio implementa el canal y sus pruebas sintéticas; no registra números, crea tokens, expone puertos, modifica el runtime ni envía mensajes reales. Google OAuth, Firebase y el proveedor de IA seleccionado siguen independientes.

## Contrato y activación futura

`GET/PATCH /api/admin/whatsapp` exige Firebase Auth y el UID exacto de superadministrador. El panel muestra configuración del servidor, números vinculados y consumo observado. PATCH solo acepta `businessId`, `phoneNumberId`, `wabaId`, `enabled`; nunca tokens, secretos o endpoints. Un número queda ligado a un solo negocio y viceversa. Cambiar esa identidad requiere una migración explícita; deshabilitar el vínculo sí está permitido.

Guardar habilitado consulta exclusivamente `GET https://graph.facebook.com/v25.0/{phoneNumberId}?fields=id,status` y exige identidad coincidente y `CONNECTED`. Esta comprobación prueba registro en Meta en ese momento, no garantiza disponibilidad futura ni suscripción correcta del webhook. El estado `ready` requiere además configuración íntegra, credencial de ese WABA y vínculo habilitado. La venta del plan WhatsApp usa este gate; atender clientes requiere también una vigencia WhatsApp actual, según la lógica compartida de suscripción. No se abre WhatsApp durante el trial por defecto.

Faltan para la primera prueba real:

1. Cuenta empresarial de Meta/WABA, aplicación con producto WhatsApp y número registrado; permisos `whatsapp_business_messaging` y los de administración necesarios. Para atender cuentas de terceros, revisar Advanced Access/App Review y el onboarding oficial antes de comercializar esa modalidad.
2. Token servidor con acceso al número, App Secret y Verify Token propio. El secreto de cifrado es una clave aleatoria de 32 bytes codificada en base64, guardada fuera de Git y respaldada por el operador. No reutilizar claves Firebase, Google OAuth o Cloudflare.
3. Configurar las variables privadas indicadas abajo. Mantener los flags apagados hasta revisar número, presupuesto, webhook HTTPS y consentimiento de la prueba.
4. Publicar únicamente `/api/whatsapp/webhook` mediante el origen HTTPS definitivo, completar el challenge y suscribir `messages` para el WABA. No abrir Ollama ni el puerto interno de Next. La ruta de Meta se autentica mediante firma, no Firebase ni una cookie del administrador.
5. Guardar la vinculación en el panel; habilitarla dispara la comprobación de registro. Con una cuenta de prueba controlada por el propietario, enviar un texto al número, verificar recepción, respuesta, estado delivered/read y cuota. Después probar duplicación de webhook, expiración y pausa. Estas pruebas reales siguen pendientes.

Variables solo servidor:

| Variable | Uso |
| --- | --- |
| `WHATSAPP_ENABLED` | Habilita recepción/procesamiento/envíos; por defecto false. |
| `WHATSAPP_RETENTION_ENABLED` | Mantenimiento independiente; debe ser true antes de activar el canal y mantenerse true al pausar envíos. |
| `WHATSAPP_GRAPH_API_VERSION` | Contrato fijado a `v25.0`; otra versión requiere revisión y pruebas. |
| `WHATSAPP_APP_SECRET` | HMAC de Meta, nunca se devuelve al navegador. |
| `WHATSAPP_VERIFY_TOKEN` | Secreto propio para challenge GET. |
| `WHATSAPP_CONTENT_KEY` | AES-256-GCM, base64 canónico de exactamente 32 bytes. |
| `WHATSAPP_PHONE_CREDENTIALS_JSON` | Objeto `phoneNumberId -> {wabaId, accessToken}`, hasta 100 números; fuera del navegador. |

Los ejemplos de entorno dejan todo desactivado. `dev:local` y `test:journey` fuerzan ambos flags false y credenciales vacías incluso frente a variables heredadas o dotenv.

## Recepción, chat y entrega

El GET del webhook compara el Verify Token y devuelve el challenge exacto. POST limita el cuerpo real a 1 MiB, verifica `X-Hub-Signature-256` HMAC-SHA256 sobre bytes sin reserializar y limita cada lote a 100 eventos. Solo confirma HTTP200 después de persistir; un fallo de almacenamiento devuelve error para que Meta reintente. Números sin vínculo, WABA distinto y medios no soportados se ignoran sin generar respuestas. Esta versión atiende texto; no interpreta imágenes, audios ni documentos recibidos por WhatsApp.

`whatsappInbox` deduplica por hash de número y wamid. El contenido (teléfono, nombre y texto) se cifra con nonce nuevo y autenticación ligada a la ruta del documento. `whatsappConversations` conserva como máximo 20 mensajes y 55.000 caracteres cifrados; la historia completa expira con el mensaje más antiguo, para no prolongar la retención de mensajes anteriores. Cada solicitud al chat está limitada a 20 mensajes y 60.000 caracteres, `sarin_client`, negocio verificado, UID estable específico del remitente y teléfono impuesto por transporte. Reutiliza herramientas, agenda, cupo compartido y proveedor de IA del chat web.

Antes de confirmar el consumo, el callback del chat guarda atómicamente `whatsappOutbox`, su reserva de cuota y el inbox completado. El worker reconcilia esa reserva idempotentemente antes de enviar. Una caída tras guardar la respuesta no vuelve a consultar la IA ni descuenta otra unidad. Si la caída ocurrió durante la generación y no existe outbox, el inbox pasa a `review`: requiere inspección manual; no reejecuta herramientas a ciegas.

Solo se envía texto de hasta 4096 unidades UTF-16, con destino y reply-to extraídos del mensaje firmado. El límite conservador evita exceder el máximo de Meta con caracteres suplementarios. Se usa únicamente el endpoint fijo `graph.facebook.com`, TLS normal, sin redirecciones y con timeout de 15 segundos. La respuesta debe enviarse antes de 24 horas desde el mensaje entrante que originó ese turno; una nueva entrada no prolonga artificialmente un mensaje viejo. No hay plantillas, campañas, recordatorios ni respuestas proactivas.

Un POST con timeout, fallo de red, 5xx o cuerpo de éxito inválido pasa a `unknown`: no se repite porque pudo entregarse. `biz_opaque_callback_data` permite conciliar un status posterior incluso si se perdió la respuesta HTTP. Solo un rechazo HTTP429 explícito con código Meta se reintenta, con espera creciente y máximo tres intentos, siempre dentro de la ventana. Los 4xx explícitos restantes son terminales. Estados sin resolución y mensajes en revisión requieren revisión del operador; no hay botón que fabrique una entrega ni reenvío automático ambiguo.

## Worker, retención y costo operativo

El runtime Node inicia un único worker por proceso, compatible con la restricción existente de **una réplica**. Un webhook despierta la cola inmediatamente y un polling cada 30 segundos recupera pendientes después de reinicios. Hay una inferencia por ciclo y hasta cinco envíos; leases persistentes impiden tomar nuevamente trabajos activos. Un lease de envío vencido queda `unknown`, no se reenvía. Un vínculo pausado difiere pendientes, evitando que bloquee otros negocios.

El polling vacío requiere aproximadamente 5.760 lecturas mínimas/día (dos queries cada 30 segundos), además de registros, cuotas y mantenimiento; es consumo Firestore, independiente del costo Meta/IA. No se inicia con flags apagados/configuración incompleta. El contenedor Cloudflare actual duerme por inactividad: **este worker requiere el VPS persistente**; antes de trasladar WhatsApp a un runtime que duerme se debe añadir un despertador durable. No se cambió el router Cloudflare para aparentar ese soporte.

El contenido deja de usarse a las 24 horas. Su borrado físico es eventual: mantenimiento por hora, hasta 100 cuerpos y 100 documentos por colección y lote; si el lote queda lleno vuelve al minuto para drenar backlog. Se conservan metadatos operativos/dedupe 30 días, por encima de las reentregas de Meta de hasta siete días. Los agregados mensuales no contienen teléfonos ni texto y se conservan para medición. No se configuró TTL administrado de Firestore ni se promete eliminación física exacta a la hora 24.

`WHATSAPP_RETENTION_ENABLED=true` mantiene limpieza aunque `WHATSAPP_ENABLED=false` o se pierda la clave. Si el proceso está detenido, el operador debe reanudar mantenimiento. Como alternativa, `POST /api/admin/whatsapp/cleanup` con la sesión auténtica del superadministrador purga un lote vencido sin hacer inferencia ni envíos; repetir mientras devuelva `morePending:true`. Este endpoint funciona con entrega apagada y sin clave, porque no necesita descifrar. Nunca copiar tokens de usuario en documentación o consola pública. Borrar la clave antes del mantenimiento puede impedir leer cuerpos pero no elimina ciphertext; conservarla privada durante la retención y limpiar antes de retirarla.

## Medición y pruebas

Los estados se fusionan idempotentemente por outbox/wamid. `read` implica `delivered`, porque Meta puede omitir el evento delivered. Una entrega solo se cuenta una vez, y los campos de pricing pueden llegar con otro status. Los contadores sent/delivered/read son conjuntos acumulativos; no se suman. `failed` deja de contarse si después se demuestra entrega, y `unknown` deja de contarse al conciliar.

El agrupamiento es una **cohorte por mes de generación**, zona Bogotá: una respuesta generada el último día y entregada el mes siguiente actualiza la cohorte original. No representa el calendario de facturación de Meta. El DTO declara `cohort:generated_month`, `source:meta_webhooks`, `invoice:false` y `estimatedCostCOP:null`. Se muestran categorías y clasificación regular/free/unknown informadas por Meta; no se resta localmente la franquicia de 1000 ni se presume Colombia para todos los destinos. El costo se consulta en Meta y sigue separado de los 149.900 COP del plan; no se genera cobro automático.

Pruebas sintéticas: firma sobre bytes, challenge, tamaños, cifrado/AAD, autorización 401/403, aislamiento de negocio/WABA, deduplicación concurrente, callbacks durables, cuota idempotente, pausa sin bloqueo, leases vencidos, no reenvío ambiguo, 429 acotado, ventana24h, read sin delivered, cambio de mes y limpieza independiente. Ninguna prueba usa números, tokens o endpoints reales de envío. La validación con Meta y el número real está pendiente.

Fuentes oficiales consultadas: [webhook y firma](https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/create-webhook-endpoint), [reentregas](https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/overview), [número y estado CONNECTED](https://developers.facebook.com/documentation/business-messaging/whatsapp/business-phone-numbers/phone-numbers), [envío y ventana](https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/send-messages), [texto y límite](https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/text-messages), [status/pricing](https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/messages/status).
