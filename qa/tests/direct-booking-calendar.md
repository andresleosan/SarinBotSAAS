# Aceptación del calendario de reserva directa

Protocolo de aceptación para el calendario predeterminado del adulto autenticado que reserva para sí mismo en un negocio general. Define comprobaciones pendientes; no acredita una corrida de QA, una publicación ni compatibilidad verificada en producción. Registrar resultados reales, comandos y capturas de cada corrida en `docs/qa/`.

El recorrido aprobado es servicio, profesional, día y hora, revisión, contacto y el intake existente, y confirmación explícita. El chat es una elección manual. Se conservan los consentimientos de cuenta y negocio y las restricciones estructuradas de salud y menores. Se utilizan las API existentes y `useStructuredBooking`, sin migraciones, dependencias nuevas ni otro proveedor.

## Entorno y preparación

Usar exclusivamente la aplicación local conectada a los emuladores oficiales de `demo-sarin-bot`, con cuentas emuladas y negocios sintéticos identificables. Confirmar el origen `http://127.0.0.1:<puerto>` o `http://localhost:<puerto>` y el proyecto demo antes de empezar. No usar producción, sesiones reales o secretos ni iniciar solicitudes de inferencia.

Preparar un adulto sintético con los consentimientos requeridos, un negocio general activo, dos servicios y profesionales con disponibilidad conocida, y datos ficticios de contacto e intake. Preparar también los fixtures existentes de salud, menor y cambio de identidad para las comprobaciones automatizadas. Conservar el estado inicial y los identificadores que pertenecen a esta corrida. No modificar reglas o políticas para facilitar el recorrido.

Como contexto de compatibilidad, el runtime registrado `accab511`, imagen `b2b925f5965b38e8eca40fccd31087648f97b245e27da9a0e9725c54ae431df0`, admite propuestas v2 generales para sí mismo y las citas resultantes. Esta referencia no demuestra que este protocolo se haya ejecutado. La propuesta vive en la memoria de la página: no se promete reanudarla tras recargar ni al volver a una versión anterior del frontend.

## Contratos automatizados de unidad y componente

Ejecutar estas comprobaciones con transportes controlados y respuestas diferidas, sin navegador real ni proveedor de IA. Registrar por separado las pruebas que las implementan y su resultado; los casos de esta tabla son requisitos de aceptación, no afirmaciones de cobertura existente.

| Caso | Resultado requerido |
| --- | --- |
| Entrada general, adulto y sujeto propio | Tras autenticación y consentimientos, el calendario es la ruta inicial. No se monta el chat ni su motor y no se solicita inferencia. Elegir chat requiere una acción manual explícita. |
| Consentimientos | Sin consentimiento de cuenta o negocio no se inicia el recorrido operativo. Aceptarlos habilita el camino correspondiente; su retirada no dispara inferencia ni una reserva nueva. |
| Selección y revisión | Servicio, profesional y horario usan los contratos existentes. Antes de preparar la propuesta, cambiar una selección invalida los horarios dependientes. Después se conserva el intento; cambiar sus datos requiere iniciar otra reserva cuando los bloqueos lo permitan. Contacto e intake conservan sus validaciones y límites actuales. No se escribe una cita antes de confirmar expresamente. |
| Propuesta y confirmación | Solo una propuesta válida permite confirmar. El cuerpo y la propuesta enviados quedan asociados al UID esperado, negocio y sujeto explícito de ese intento. Doble clic o repetición concurrente no crean otro intento de confirmación. |
| Bloqueos durante trabajo pendiente | Intentar cambiar entre calendario y chat o cambiar sujeto mientras hay un batch, generación, mutación de propuesta o confirmación, o una confirmación incierta, no cambia la ruta ni el sujeto. No se inicia trabajo alternativo ni se pierde el intento pendiente. |
| Confirmación ambigua | Un transporte diferido simula que el servidor confirmó pero la respuesta se perdió, y también que aún no respondió. La interfaz conserva la incertidumbre y ofrece la recuperación admitida. Recuperar repite la propuesta y el cuerpo originales con el UID esperado; no los reconstruye con campos nuevos, no genera una propuesta y no invoca inferencia. |
| Cambio de consentimiento o política durante incertidumbre | Con el mismo transporte diferido, retirar el consentimiento, recibir un error de política o cambiar la política del negocio de general a salud no sustituye el intento incierto. La recuperación conserva la repetición original y el UID esperado, y deja al contrato existente resolver el resultado. No comienza una reserva nueva ni aplica una nueva inferencia. |
| Recuperación idempotente | La repetición de una confirmación aplicada devuelve la misma cita según el contrato existente. Una respuesta pendiente o fallida no se presenta como éxito y no habilita otro intento que pueda duplicarla. |
| Cambio de identidad o ámbito | Un cambio de UID, negocio o sujeto explícito reinicia el estado del ámbito anterior. Una respuesta tardía del ámbito anterior no restaura selecciones, propuesta, cita ni avisos en el nuevo. El bloqueo de cambios de sujeto durante una operación no elimina la protección frente a cambios externos de identidad o negocio. |
| Salud y menores | Los fixtures de salud y menor conservan la ruta estructurada, restricciones, verificaciones y consentimientos actuales. El calendario general no permite eludirlas. Volver a un contexto general no lanza chat ni inferencia automáticamente. |
| Recarga y vuelta de versión | Una nueva instancia de página no presenta una propuesta en memoria como recuperable. No reenvía automáticamente una confirmación ni afirma haber recuperado una cita sin respuesta del contrato existente. |

La simulación de pérdida de respuesta pertenece únicamente a esta capa automatizada. No interceptar tráfico de un navegador real, cerrar una conexión de producción ni provocar una confirmación ambigua con una sesión real.

## Recorrido HTTP local con emuladores

Mantener este resultado separado de las pruebas de componente y de CUA. Usar solicitudes autenticadas del fixture local contra las API existentes, sin llamar al chat ni al motor.

1. Comprobar los límites existentes de autenticación, pertenencia al negocio, consentimiento, sujeto y política con los fixtures sintéticos. Registrar los códigos y cuerpos mínimos necesarios sin tokens ni datos personales.
2. Consultar las opciones y disponibilidad del negocio general. Crear una propuesta general para sí mismo de versión 2 con un servicio, profesional y horario válidos, siguiendo el contrato actual de `useStructuredBooking`.
3. Comprobar que la propuesta no constituye una cita. Confirmar de forma explícita con el cuerpo original y la identidad esperada, y comprobar que la cita resultante corresponde al mismo negocio, sujeto, servicio, profesional y horario.
4. Repetir exactamente la confirmación mediante HTTP y comprobar la recuperación idempotente de la misma cita. Comprobar también los rechazos existentes por propuesta inválida o caducada, conflicto de disponibilidad y ámbito ajeno, sin inventar nuevos códigos de respuesta.
5. Comprobar que los casos de salud y menor mantienen el contrato estructurado existente y no admiten una propuesta general para saltar sus restricciones.
6. Verificar la lectura de la cita en «Mis citas» y su correspondencia con el resultado de confirmación. Restaurar o retirar únicamente los datos identificados del fixture según las operaciones de prueba ya admitidas.

Este recorrido HTTP comprueba la integración de los contratos. La respuesta perdida y los cambios de política mientras la confirmación está incierta se prueban con el transporte diferido de unidad/componente, no mediante manipulación de una sesión del navegador.

## Recorrido en CUA

Usar Chrome local con interacción real de teclado y controles visibles. No inyectar estado, interceptar solicitudes ni enviar mensajes al motor de IA. Las comprobaciones de montaje del chat y ausencia de solicitudes al motor corresponden a los contratos automatizados; CUA comprueba el recorrido y sus estados observables.

1. Abrir `/b/[slug-sintético]`, acceder con la cuenta emulada y comprobar los pasos de consentimiento de cuenta y negocio que correspondan. Antes de aceptarlos, el calendario no permite completar la reserva.
2. Con el adulto general que reserva para sí mismo y los consentimientos aceptados, entrar al recorrido de reserva. Comprobar que aparece el calendario como opción inicial, con una acción visible para elegir chat manualmente.
3. Elegir un servicio, profesional y día del fixture. Activar «Consultar horarios», escoger una hora y activar «Revisar propuesta». Comprobar que las opciones disponibles y la revisión final coinciden con la selección, incluidos precio y duración donde el contrato actual los muestre.
4. Completar contacto y los campos de intake existentes con datos sintéticos. Probar un campo requerido vacío y corregirlo mediante los controles normales. El error debe estar asociado al campo y conservar la selección válida.
5. Revisar la reserva antes de confirmar. Hasta pulsar la acción de confirmación explícita no debe mostrarse una cita confirmada. Confirmar una sola vez y comprobar el estado final y la cita en «Mis citas».
6. En un recorrido nuevo y sin operaciones pendientes, elegir manualmente chat y comprobar la transición visible. No escribir ni enviar mensajes. Volver al calendario mediante el control admitido y comprobar que no se inicia una conversación automáticamente.
7. Comprobar los avisos de carga, bloqueo o error que se observen mediante el funcionamiento local normal y las acciones soportadas. Mientras exista una operación pendiente observable, los controles de cambio de ruta y sujeto deben reflejar su bloqueo. Si el estado dura demasiado poco para observarlo o no ocurre, registrarlo como no observado y remitir a la prueba automatizada; no provocarlo interceptando tráfico.
8. En los fixtures locales de salud y menor, comprobar que aparece el recorrido estructurado que corresponde y que se conservan las restricciones y consentimientos existentes. No completar pasos de IA. No usar una sesión real para generar estos casos.
9. Repetir la revisión del calendario, selección, contacto, intake, resumen, confirmación y acceso al chat manual a **320, 390 y 1280 px**. No debe existir desplazamiento horizontal; los textos largos envuelven líneas, las horas se pueden seleccionar y la acción principal no queda recortada ni cubierta.
10. Con Tab y Shift+Tab, recorrer las selecciones del formulario, contacto, intake y confirmación. Comprobar etiquetas accesibles, foco visible, orden coherente y activación por teclado conforme al tipo de control. Los errores y cambios de estado deben ser perceptibles sin depender solo del color.
11. Si se prueba una recarga con una propuesta sin confirmar, comprobar la limitación declarada de memoria de página: no se ofrece una reanudación ficticia. No recargar durante una confirmación para fabricar incertidumbre.
12. Revisar que no haya errores inesperados en la consola. Restaurar la configuración y retirar solo los datos del fixture de esta corrida; restaurar el viewport y cerrar solo sus pestañas de aceptación. No limpiar almacenamiento histórico del usuario ni sesiones ajenas.

## Registro de resultados

Registrar por separado: contratos de unidad/componente con transporte diferido, recorrido HTTP local con emuladores y recorrido CUA. Indicar revisión probada, fixture sintético, comandos realmente ejecutados, resultado, pasos no observados y capturas de los tres anchos. No guardar tokens, secretos, cuerpos de conversaciones ni información real.

Una prueba automatizada no acredita una interacción de CUA; una captura no acredita el contrato de idempotencia. Marcar cada capa como pendiente hasta disponer de su evidencia real. Este archivo es únicamente el protocolo y no autoriza despliegues ni declara QA ejecutado.
