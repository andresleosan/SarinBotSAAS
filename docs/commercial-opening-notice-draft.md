# Borrador de aviso de datos y funcionamiento de Sarin

Preparado el 16 de octubre de 2026. **Texto factual publicado y verificado por HTTP en la aceptación comercial.** El propietario confirmó el contacto `alsdevstudio@alsdevstudio.com`, a Andrés Santiago como contacto de Sarin y responsable de revisar pagos, y la bandeja de administración como único mecanismo de revisión por ahora, sin correo automático. Las páginas [Privacidad](../src/app/privacidad/page.tsx) y [Ayuda](../src/app/ayuda/page.tsx) contienen la información pública. Este archivo conserva la referencia editorial; no constituye una declaración de cumplimiento jurídico. La política formal de plazos de conservación sigue pendiente y el aviso explica el estado actual sin inventar una duración. Ver [aceptación final](qa/2026-10-16-commercial-e2e.md).

## Texto propuesto para el usuario

### Cómo funciona Sarin

Sarin ayuda a negocios de servicios a configurar su oferta, recibir reservas por su enlace o QR y consultar su agenda. Los clientes entran con Google para reservar y ver las citas asociadas a su cuenta dentro de cada negocio. Pueden consultar próximas citas e historial, cancelar una cita antes de su inicio y usar **Guardar imagen de la cita** para descargar un PNG de una reserva futura confirmada.

El PNG se genera en el navegador y es una imagen estática: los cambios o cancelaciones se consultan en Mis citas. Sarin no envía actualmente recordatorios automáticos por correo o WhatsApp ni sincroniza tu agenda mediante Google Calendar. La atención automatizada por WhatsApp todavía no está activa ni disponible para contratar.

El asistente usa inteligencia artificial y puede equivocarse al interpretar un mensaje. Revisa el servicio, profesional, fecha y hora antes de confirmar. La disponibilidad y el registro de las citas se validan en el servidor. Una respuesta de conversación no sustituye la confirmación de una reserva guardada.

### Pagos y acceso del negocio

La prueba de Sarin cuesta **$5.000 COP una sola vez** e incluye la configuración de un negocio, hasta **10 citas creadas** y un límite independiente de **700 respuestas de IA en total**, sin vencimiento por días. La configuración y las nuevas reservas se habilitan después de aprobar el comprobante de transferencia; subir una imagen no activa el acceso por sí solo.

Cada cita creada correctamente consume un cupo de la prueba y cancelarla no devuelve ese cupo. La configuración asistida y la atención al cliente comparten las 700 respuestas. No son 700 citas. Cuando se agotan los cupos o la capacidad de IA correspondiente, se necesita un plan para continuar; las citas existentes siguen disponibles para consulta y cancelación.

Los planes y ampliaciones se pagan por transferencia y requieren revisión del comprobante. Andrés Santiago revisa los pendientes manualmente en la bandeja de administración. Actualmente no se envían avisos automáticos por correo y no hay un horario ni plazo automático de aprobación prometido. La vigencia, el precio y las respuestas incluidas se muestran al elegir la compra. No hay cobros recurrentes automáticos. Estos pagos contratan el uso de Sarin para el negocio: no pagan el servicio que el cliente reserva en ese establecimiento. El importe y las condiciones de ese servicio corresponden al negocio.

### Qué datos utiliza el servicio

Para identificarte y vincular las operaciones a tu cuenta, Sarin usa Firebase Authentication con Google. El servicio recibe el identificador de tu cuenta y datos como tu nombre y correo. También utiliza información técnica de sesión para comprobar el acceso.

Sarin conserva en **Cloudflare D1** la configuración del negocio, perfiles y permisos, reservas e historial de estados, datos de contacto y respuestas del formulario de reserva, además de la información de planes, comprobantes y consumo del servicio. Las imágenes de los comprobantes se guardan en un bucket **Cloudflare R2 privado** y se consultan mediante accesos autorizados.

La información pública del negocio —por ejemplo, nombre, servicios, precios, horarios y contacto comercial— puede verse mediante su enlace. Tus citas se consultan después de iniciar sesión y el negocio necesita sus datos para atenderte. La administración de Sarin revisa los comprobantes y dispone de acceso administrativo para operar la plataforma.

### Cómo se procesan los mensajes de IA

Los mensajes y el contexto necesario para responder pasan por la aplicación alojada en Cloudflare. Ese contexto puede incluir mensajes anteriores de la conversación, información del negocio y datos de contacto o reserva que proporciones o que una operación autorizada necesite utilizar.

Cuando el proveedor seleccionado es **Ollama**, el modelo se ejecuta en la Mac operada para Sarin. La conexión remota usa HTTPS/TLS y Cloudflare Tunnel con controles de Cloudflare Access. Esto es inferencia en un equipo del operador; no significa que los mensajes permanezcan únicamente en tu dispositivo.

Si la administración selecciona **DeepSeek**, los mensajes y el contexto necesario se envían a su API externa para generar la respuesta. Ese procesamiento queda sujeto a las condiciones del proveedor. El servicio no cambia automáticamente de proveedor ante un error.

Gemini también forma parte de las opciones configurables. Si se habilita y selecciona, el contexto necesario se envía a la API externa de Google para generar la respuesta. Una opción disponible en el código no implica que tenga credenciales configuradas o esté seleccionada. Al cerrar la aceptación del 16 de octubre, DeepSeek quedó como proveedor de producción por decisión del propietario; Ollama conserva selección manual y Gemini no está configurado. El aviso cubre esas opciones sin prometer sustitución automática.

### Conservación y contacto

Sarin conserva registros de reservas, contacto, facturación y uso para operar el servicio. Actualmente no tiene borrado automático general por antigüedad de esos datos ni de las imágenes de comprobantes. Cancelar una cita cambia su estado y no elimina su registro. Cerrar sesión o cerrar la conversación tampoco elimina las reservas o los comprobantes.

La aplicación no ofrece una garantía de «cero registros» ni de eliminación inmediata de todos los sistemas, copias o proveedores. El procesamiento de mensajes y la información de sesión también involucran infraestructura de terceros.

**Contacto de Sarin:** Andrés Santiago · Sarin.

**Contacto para soporte y consultas sobre datos:** [alsdevstudio@alsdevstudio.com](mailto:alsdevstudio@alsdevstudio.com).

**Conservación/eliminación actual:** no hay borrado automático general por antigüedad. La política formal de plazos está pendiente. Las consultas y solicitudes de revisión, corrección o eliminación se atienden manualmente por el correo indicado, sin prometer un plazo no acordado ni eliminación instantánea de copias y proveedores.

Para cambios relacionados con la atención o el servicio reservado, contacta al negocio. Para problemas de acceso, funcionamiento de Sarin o consultas sobre tus datos en la plataforma, utiliza el canal del operador indicado arriba.

## Verificación interna del borrador

Esta sección no forma parte del texto para publicar.

| Afirmación | Evidencia revisada o límite |
| --- | --- |
| Auth Google; negocio y reservas en D1; comprobantes R2 privados | [Cliente Auth](../src/lib/firebase/client.ts), [adaptador de datos](../src/lib/storage/database.ts), [puente D1/R2](../cloudflare/src/data.ts), [arquitectura vigente](../STACK.md). Firebase también puede mantener metadatos propios de autenticación; no prometer que «solo se guarda el correo». |
| Datos del cliente ligados a la cita; cancelar cambia el estado | [Reservas y cancelaciones](../src/lib/server/bookings.ts), [contratos de entidades](../src/types/firestore.ts). El aviso no llama a cancelar «borrar». |
| Historial de mensajes y caché temporal | [Orquestador comercial](../src/lib/server/chat.ts) procesa el historial recibido y puede mantener respuestas temporalmente en memoria para reintentos, con vencimiento lógico de 15 minutos y límite de entradas. [Contabilidad de cuota](../src/lib/server/response-quota.ts) persiste identificadores, huellas y estados, no el cuerpo completo de respuestas. Esto no acredita ausencia de todo registro en proveedores o memoria del sistema. |
| Medición de uso | [Medidor](../src/lib/server/ai-usage.ts) registra proveedor, modelo, tiempos, resultados, contadores de tokens y costos estimados; no es un modo de chat anónimo. No se ofrece borrado automático general de ese histórico. |
| Destinos del contexto IA | [Motor](../src/lib/sarin/engine.ts) y [selector](../src/lib/server/provider-settings.ts) admiten Ollama, DeepSeek y Gemini. El contexto también puede contener resultados de herramientas. No se comprobó ni se promete retención cero de esos proveedores. |
| Cifrado de transporte al motor local | La validación del [motor](../src/lib/sarin/engine.ts) exige HTTPS y service token para destinos remotos; el tramo final en la Mac usa loopback. Esto no cifra el historial completo en reposo ni convierte a Cloudflare en un mero directorio sin tránsito de contenido. |
| Prueba, planes y aprobación | [Contrato de prueba](paid-trial.md), [facturación](../src/lib/server/billing.ts), [cuotas](response-quotas.md). Prueba de compra única, sin activación inicial preventiva por enviar una captura. No inventar tiempo de aprobación, disponibilidad continua ni política de devoluciones no definida. |
| WhatsApp | Los flags de producción revisados están desactivados y la compra del plan se bloquea sin conexión verificada. Un teléfono de contacto del negocio no equivale a automatización oficial de WhatsApp activa. |
| ICS y próximas citas | [Mis citas](../src/components/client-appointments.tsx). La descarga no acredita recordatorio entregado ni sincronización automática. |
| Retención y respaldos | No se halló una política aplicada de borrado automático general para negocio/citas/comprobantes/cuotas/telemetría. Existen respaldos privados y la copia Firestore previa al corte conservada para recuperación. El borrador requiere decidir duración y eliminación de esas copias; no debe anunciarse un plazo inventado. |

Referencias primarias externas consultadas para describir a los proveedores, sin trasladar sus certificaciones o promesas al producto Sarin: [Firebase: privacidad y seguridad](https://firebase.google.com/support/privacy), [política de Cloudflare](https://www.cloudflare.com/privacypolicy/), [política de DeepSeek](https://cdn.deepseek.com/policies/en-US/deepseek-privacy-policy.html). Sus documentos no sustituyen las decisiones operativas de Sarin.

## Correcciones de copy y controles de publicación

| Texto o ubicación actual | Riesgo de interpretación | Redacción propuesta |
| --- | --- | --- |
| «Abre tu isla privada» en [onboarding](../src/app/dashboard/onboarding/page.tsx) | Puede sugerir que la información del perfil comercial no es accesible por su enlace público. | Aplicado: «Configura el espacio de tu negocio». En [QR](../src/app/dashboard/qr-kit/page.tsx): «Enlace de tu negocio» y «Abrir página del negocio». |
| «El copiloto y las ampliaciones requieren un plan» y «La atención al cliente y el copiloto comparten esta bolsa» en [cuotas](../src/components/response-quota.tsx); mención similar en [facturación](../src/app/dashboard/billing/page.tsx) | El backend reconoce `sarin_owner_copilot`, pero en las rutas/componentes revisados no se encontró una interfaz accesible de copiloto para propietarios. La frase puede vender una función sin pantalla utilizable. | Aplicado: retiradas las promesas del copiloto. Cuotas describe configuración asistida y atención al cliente, y las ampliaciones requieren un plan vigente. |
| «Sin caducidad» en prueba y mensajes de bienvenida | Sin contexto puede entenderse como IA, citas o disponibilidad ilimitadas. La landing ya explica los límites en otra sección. | «Prueba sin vencimiento por días: hasta 10 citas y 700 respuestas de IA en total». Mantener aprobación y consumo por cancelación a la vista al comprar. |
| Cualquier futura promesa de «datos solo locales», «sin registros» o «borrar todo al cerrar» | No coincide con D1/R2/Auth, cuota, metadatos, cachés y proveedores de IA. | Usar la descripción factual de datos, destinos y conservación de este borrador. |
| «Te avisamos/recordamos por correo o WhatsApp» o «sincronizado con Google Calendar» | No hay entrega automática configurada para la apertura revisada. | «Descarga la cita para añadirla a tu calendario». |

Las correcciones indicadas se aplicaron en código, sin despliegue dentro de esta tarea. La revisión de copy no sustituye el recorrido comercial real de reserva, cancelación, pago y aprobación.

## Pendientes operativos y límites

1. Formalizar la duración de conservación y el procedimiento de eliminación para cuenta/perfil, citas/contacto, comprobantes, cuotas/telemetría y respaldos, incluida la copia Firestore del corte. El texto público describe la ausencia actual de borrado automático sin ocultar este pendiente.
2. Definir cómo se verifica y tramita una solicitud de datos. No publicar plazos de respuesta o eliminación sin acuerdo operativo.
3. Las condiciones de cancelación del servicio contratado y el tratamiento de pagos/devoluciones requieren decisiones separadas; este aviso factual no crea un contrato ni compromisos nuevos.
4. No se infiere una razón social o domicilio legal a partir de la marca. Se publica únicamente el contacto y nombre confirmados.

Los enlaces de la aplicación apuntan a `/privacidad` y `/ayuda`, no a este archivo editorial. Ambas rutas públicas devolvieron HTTP 200 después del despliegue de la imagen final.
