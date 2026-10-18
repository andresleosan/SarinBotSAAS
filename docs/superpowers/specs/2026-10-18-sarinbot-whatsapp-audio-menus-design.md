# SarinBot por WhatsApp: audios, menús y administración privada

Fecha: 2026-10-18. Estado: diseño para revisión del titular; sin implementación ni activación nueva.

## Resultado solicitado

Adaptar el chatbot de `F:/Proyectos/ALS DevStudio/Dev` a SarinBot. El titular confirmó dos públicos: clientes para soporte y suscripciones, y él mismo para administrar, con accesos separados. Conservar WhatsApp Business App en coexistencia y el canal propio de SarinBot, en YCloud Free.

El objetivo completo sigue incluyendo consultas desde la web y reflejar los cambios en la aplicación. La primera entrega de recepción ya preparada conserva sus comprobaciones pendientes; este diseño amplía la automatización de la siguiente entrega y no convierte esas comprobaciones en aprobadas.

## Evidencia de la referencia y del destino

Referencia ALS inspeccionada en HEAD `c224477d291e8b78c687bcde281a47e9679b3ce5`, árbol limpio al inicio de la inspección. No se modificó ni publicó ALS. Este HEAD es evidencia local, no una afirmación de su versión productiva.

- `server/sarin/whatsapp/menu.js`: botones identificados por acción y referencia de salida; aceptar, atención humana y salir. No confía en el título visible ni interpreta cifras fuera del menú correspondiente.
- `audio-client.js`: descarga autenticada restringida a YCloud, límite de 2 MiB, validación de Ogg/Opus e integridad, duración máxima de 120 segundos y transcripción con Whisper en Cloudflare. No descarga ni transcribe sin permiso.
- `processor.js`, `work-store.js`, `ycloud-client.js`: trabajos durables, controles antes de inferir/enviar, intervención humana, entrega incierta sin reenvío ciego.
- Se ejecutaron cuatro suites locales de la referencia: menú, cliente de audio, flujo de audio y botones de respuesta. Resultado: 78 pruebas aprobadas, cero fallos. Usan datos y transportes simulados; no prueban recepción real ni adaptación a SarinBot.
- El grafo existente de ALS no contiene vocabulario de estos módulos recientes. Los hallazgos proceden del código y las pruebas, no del grafo.

Base de SarinBot: paquete congelado `C:/Users/USER/AppData/Local/SarinBot/whatsapp-platform-20261018/brand-name-20261018/source`, correspondiente a la publicación con nombre SarinBot. Sus flags de IA/envío son deliberadamente inoperantes y el lector inicial acepta texto y ecos humanos. El copiloto administrativo existente consulta pagos, cupos y vigencias sin ejecutar cambios. `billing.ts:reviewPayment` contiene la revisión transaccional de pagos que debe seguir siendo la autoridad de negocio.

## Alternativas y elección

1. **Adaptar los módulos de transporte y controles a los dominios de SarinBot — recomendado.** Reutiliza el comportamiento probado y los casos de prueba; mantiene datos, configuración y contabilidad propios. Requiere traducir JS/Workers a las interfaces TypeScript/D1 existentes y añadir las piezas que faltan.
2. Copiar el chatbot entero de ALS. Ahorra trabajo inicial pero arrastra su catálogo comercial, avisos, esquema SQL, cuotas y finalidad; no satisface la administración de suscripciones de SarinBot.
3. Hacer que SarinBot llame al backend de ALS. Introduce dependencia operativa y circulación de datos privados entre productos sin aportar una necesidad funcional.

Se elige la primera. Ningún despliegue utilizará la carpeta compartida con cambios ajenos; se preparará un paquete aislado a partir de la versión vigente de SarinBot.

## Canal y límites

- Mantener el número y la WABA propios de SarinBot y su webhook dedicado. Conservar el webhook de ALS y sus reglas actuales.
- YCloud distribuye eventos a nivel de compañía: filtrar por WABA y número antes de cualquier efecto. Un secreto distinto de webhook separa autenticación; no crea aislamiento de transporte en el proveedor.
- No copiar secretos, historial ni registros de ALS. Un cliente de envío de SarinBot tendrá configuración y presupuesto propios. Antes de habilitarlo, revisar y comunicar el alcance real de la credencial de YCloud Free; el filtro del código no restringe los permisos intrínsecos de una clave de compañía.
- Mantener recepción, retención, transcripción, IA y envío con controles explícitos. Activarlos por entregas comprobadas, con pausa y reversión. Cambiar flags en el artefacto actual no implementa la automatización.

## Flujo de clientes

1. Mostrar identificación de SarinBot y sus condiciones de soporte y tratamiento, adaptadas a los proveedores y a la finalidad reales. No reutilizar las constancias ni los textos de ALS.
2. Ofrecer Aceptar, Atención humana y Salir. Una respuesta debe corresponder al aviso vigente, destinatario y conversación; botones antiguos o duplicados no conceden permisos nuevos.
3. Tras aceptar, ofrecer un menú de Soporte, Planes y suscripción y Atención humana. SALIR permanece disponible por texto y en los controles posteriores. Respetar el máximo de tres botones de respuesta por mensaje; no diseñar una pantalla que dependa de cuatro botones simultáneos.
4. Soporte responde con información pública revisada de SarinBot. Planes utiliza precios y condiciones de la aplicación; cualquier dato de una cuenta requiere vínculo verificado y permisos actuales.
5. Aceptar notas de voz de WhatsApp Ogg/Opus de hasta dos minutos y 2 MiB. Transcribir solo después de autorizar. Un audio previo al permiso se descarta del procesamiento y se solicita reenviarlo después; no se reproduce backlog.
6. Responder inicialmente por texto, con botones. Sintetizar respuestas de voz no forma parte de esta adaptación.
7. Ante audio inválido, fallo o resultado incierto, pedir texto o atención humana sin repetir inferencias o envíos ambiguos.
8. Si el titular interviene desde Business App, pausar el bot en esa conversación y cancelar trabajo pendiente. Volver a bot exige acción explícita y permisos todavía vigentes.

La transcripción es contenido de una consulta. Nunca prueba identidad, acepta documentos ni autoriza un pago, aunque diga «acepto» o «aprueba».

## Acceso administrativo privado

El titular vincula un número que controle a su sesión web con autenticación reciente, desafío firmado de un solo uso y confirmación web. El número de prueba de recepción no se considera automáticamente su número administrador. No se habilitan privilegios por nombre, por remitente escrito en un formulario ni por el eco del propio número Business.

La sesión de WhatsApp debe corresponder al UID real con rol superadmin vigente. Cada consulta valida vínculo, permisos, conexión, modo y expiración. Revocar acceso o desvincular cancela tareas pendientes.

Menú administrativo inicial: Pagos pendientes, Estado de SarinBot y Soporte recibido. Permite preguntas por texto o audio y usa el servicio administrativo existente con datos recientes y referencias a registros reales. No comparte este snapshot con el asistente público.

Para aprobar o rechazar una suscripción:

1. Identificar el comprobante y mostrar el negocio, importe, plan, estado y efecto propuesto, obtenidos del servidor.
2. Crear una propuesta determinista, de un solo uso y con caducidad de cinco minutos, ligada al actor, comprobante y huella del estado actual. Un rechazo necesita motivo explícito.
3. Pedir confirmación individual en el panel autenticado, abierto desde WhatsApp. La primera entrega de acciones conserva este paso web; confirmar pagos íntegramente en WhatsApp requiere un diseño posterior de autorización reciente.
4. Al confirmar, revalidar rol y estado; consumir la propuesta y llamar a las reglas de revisión dentro de una misma transacción. Una carrera con la revisión manual o un cambio de plan invalida la propuesta; no se aplica una versión antigua.
5. Informar el resultado confirmado. El modelo no decide si un comprobante es auténtico ni ejecuta aprobación autónoma. Una respuesta generada no se presenta como cambio aplicado.

Las consultas administrativas estarán disponibles antes que las acciones de escritura. El titular revisará este orden y el paso de confirmación web al aprobar este diseño.

## Conexión con la web y actualización de la app

Crear un dominio de soporte de plataforma con identidad Firebase y permisos propios. El chat de reservas actual pertenece a negocios y no se convierte silenciosamente en soporte de SarinBot.

Mensajes, eventos y solicitudes de entrega deben confirmarse transaccionalmente e identificarse para evitar duplicados. La bandeja web muestra únicamente datos vigentes. Como primera sincronización usar actualización incremental con cursor y consulta cada cinco segundos mientras la vista esté visible; se describe como actualización automática, sin prometer latencia instantánea. WebSockets se evaluarán si las mediciones justifican su costo y complejidad.

Para avisos por WhatsApp al titular se necesita un destinatario verificado distinto del remitente Business. El titular elegirá ese número al configurar el acceso privado. No asumir que el Business puede enviarse a sí mismo los chats de la web. Primera notificación: resumen mínimo y enlace privado; reenviar el contenido íntegro requiere divulgación y autorización aplicables. Una conversación web no abre por sí sola una ventana de atención de WhatsApp. Fuera de ventana no enviar mensajes libres; cualquier plantilla requiere configuración y revisión propia.

## Piezas técnicas

- Extender el lector firmado con eventos explícitos de audio y selección de botones, conservando firma, reloj, tamaños y descarte por ámbito. No ampliar la tolerancia de reintentos para simular compatibilidad.
- Crear consentimiento `platform_support`, vínculos y desafíos revocables, sin UID sintético ni cuota de un negocio ficticio.
- Adaptar funciones puras de menú y validación de audio, manteniendo sus pruebas de contrato. El cliente de transcripción usará Workers AI desde el Worker, tras autorización interna del trabajo; el contenedor no recibe una ruta de inferencia pública sin autenticación ni la clave global de Cloudflare.
- Crear outbox y trabajo durable exclusivos de plataforma. Guardar antes de notificar a cualquier cola; una caída o reinicio no pierde ni duplica un trabajo. Una instancia de aplicación sigue siendo el límite existente.
- Revalidar permisos antes de descargar/transcribir, generar, persistir salida, reclamar y enviar. Presupuestos de audio, generación y mensajes se controlan de forma independiente.
- Conservar contacto y contenido cifrados hasta 24 horas; metadatos mínimos de control hasta 30 días conforme al diseño existente. El audio bruto se procesa en memoria y no se conserva en R2 ni en la bandeja. Los recibos legales tienen su política separada. Extender limpieza e índices antes de recibir nuevas categorías.
- Mostrar en administración estados separados de recepción comprobada, coexistencia comprobada, transcripción disponible y automatización habilitada. Connected en YCloud no sustituye estas pruebas.
- Antes de activar automatización, comprobar pausa, desconexión/offboarding y reconciliación de estado con el contrato real del proveedor, como exige el diseño de recepción aprobado. Un eco antiguo no reconecta el canal. Los nuevos avisos legales deben tener versión y constancias propias; no alterar retrospectivamente las anteriores.

## Costo y activación

No contratar un plan superior de YCloud. Su plan Free no equivale a uso ilimitado sin cargos de mensajes. La documentación consultada publica cargos por mensaje entregado y, desde octubre de 2026, 1.000 mensajes de servicio gratuitos por número al mes; se revisará la tarifa aplicable antes de activar envíos.

Whisper large-v3-turbo publica USD 0,000513 por minuto: 1.000 minutos equivalen aproximadamente a USD 0,513 solo de transcripción, sin generación de texto, transporte, alojamiento ni almacenamiento. Es una referencia de cálculo, no presupuesto autorizado. Reutilizar el medidor de IA de SarinBot y documentar los límites efectivos en STACK.md durante la implementación. No se verificaron todavía límites específicos de gasto del nuevo canal ni se autoriza recarga automática por este diseño.

Fuentes oficiales consultadas: https://developers.cloudflare.com/workers-ai/models/whisper-large-v3-turbo/ y https://docs.ycloud.com/en/documentation/pricing-and-billing/whatsapp-pricing-and-billing.

## Entregas y aceptación

1. Cerrar la comprobación real de reintentos, recepción y eco humano del canal ya conectado. Mantener el observador temporal y su limpieza como operación separada; la inspección de ALS no lo activó.
2. Consentimiento y vínculo, menús y audios con transportes simulados y envío productivo apagado. Probar remitente ajeno, botón viejo, falta/revocación de permiso, audio excedido, duplicados y reinicio.
3. Soporte público y administración de solo consulta, outbox y presupuestos propios. Pruebas de que un cliente no accede a pagos ni instrucciones administrativas, y de que intervención humana detiene descargas, generación y envío.
4. Propuestas de revisión de pagos con confirmación web. Probar doble confirmación, propuesta vencida, cambio de contexto, actor ajeno y concurrencia con revisión manual, con transacciones D1 reales locales.
5. Soporte web y notificaciones al destinatario privado verificado; probar propietario de hilo, orden, expiración, ventana y entrega incierta.
6. QA de escritorio y 320 px, publicación aislada y pruebas controladas de texto, nota de voz, botones y toma humana. Cada activación se registra con resultado real y rollback; no declarar que un servicio funciona por pasar pruebas simuladas.

La aprobación de este documento permite preparar el plan de implementación. No activa credenciales, procesamiento de audios, envíos ni nuevas condiciones en producción.
