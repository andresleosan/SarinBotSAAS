# Reserva directa con calendario

Fecha: 17 de octubre de 2026.

## Decisión y alcance

Después de acceder con Google y revisar los permisos de cuenta y del negocio, una persona que reserva para sí misma en un negocio de servicios generales comienza en **Reservar con calendario**. El recorrido permite elegir servicio, profesional o recurso, día y hora; revisar una propuesta; completar el teléfono y las preguntas que el negocio ya exige; y confirmar expresamente la cita.

**Hablar con Sarin** sigue disponible como elección manual para ese mismo caso general. Entrar al negocio, abrir el calendario, consultar horarios o preparar y confirmar una propuesta estructurada no inicia inferencia. El calendario utiliza el formulario y los contratos existentes de reserva sin IA.

La ficha pública, el acceso con Google, los permisos, «Mis citas» y la cancelación mantienen sus recorridos. Esta entrega no añade API, migración, dependencia ni proveedor y no modifica el motor de disponibilidad o los cupos.

## Referencia y adaptación

La guía oficial de Fresha [Learn how clients book appointments online](https://www.fresha.com/help-center/knowledge-base/online-presence/102398-learn-how-clients-book-appointments-online), consultada el 17 de octubre de 2026, describe la selección de servicios, la elección de profesional según la configuración del negocio, el día y la hora, la revisión de detalles y la confirmación. Esa secuencia informa el orden del formulario de Sarin.

Sarin conserva sus contratos actuales: una selección de servicio y recurso por propuesta, horario en `America/Bogota`, precio en COP y teléfono y preguntas existentes antes de confirmar. La disponibilidad requiere la sesión y los permisos de Sarin. No se incorporan en este incremento las funciones adicionales que describe Fresha, como varios servicios en una misma cita, protección mediante tarjeta, pago anticipado o notificaciones de confirmación.

## Entrada y opciones de recorrido

| Caso vigente | Recorrido inicial y opciones |
| --- | --- |
| General, reserva para mí | Calendario inicial; se puede elegir manualmente el chat cuando no hay una operación pendiente. |
| General, menor representado habilitado | Selección explícita «Para un menor a quien represento»; formulario estructurado y requisitos existentes de representación. |
| Salud | Formulario estructurado; no se ofrece iniciar el chat general. La opción de menor sigue sujeta a la capacidad del negocio. |
| Sin permisos vigentes o sin política comprobada | No se inicia una nueva reserva ni un turno de chat. Las citas existentes y la recuperación de una confirmación ya enviada conservan sus controles. |

El caso general para sí mismo muestra el título «Reserva con calendario» y una ayuda sobre servicio, profesional y horario. Los avisos específicos de salud y representación se conservan para los casos correspondientes. El hook de permisos de la reserva sigue consultando y validando el caso: su panel solo se omite cuando el estado comprobado indica `required=false`, sin carga ni error. Con requisitos activos, estado pendiente o error, el panel permanece visible. Esto no elimina los permisos de cuenta y del negocio.

La selección «Para mí» no hereda nombre ni calidad de un representante anterior. Cambiar de destinatario inicia otro caso con identificador propio. El negocio y la cuenta forman parte de la identidad del controlador: sus selecciones, datos y respuestas tardías no se trasladan a otra cuenta o negocio.

Los controles del calendario no se montan inicialmente para un caso general sin permisos. Una vez iniciado un caso, se conserva su controlador cuando faltan permisos o hay un error temporal de política, para no perder una recuperación pendiente. Estar en calendario tampoco monta el hook del chat ni su diagnóstico del motor.

## Servicio, horario y confirmación

El formulario reutiliza los servicios, recursos activos y asignaciones del catálogo. «Cualquiera disponible» permite consultar recursos del servicio; la propuesta siempre queda asociada a un recurso y una hora concretos. El día y los horarios se muestran en la zona de Colombia.

«Consultar horarios» obtiene disponibilidad mediante el endpoint existente. Elegir una hora no crea una cita. «Revisar propuesta» obtiene el resumen de servicio, recurso, fecha, inicio, fin y precio; el resumen conserva su vigencia y comprobación de disponibilidad existentes. Confirmar vuelve a validar las condiciones en el servidor.

En un caso general para sí mismo se solicita el teléfono y se conservan los campos `intakeFields` previos, incluidos sus requisitos. No se añaden preguntas de salud o representación. Los casos de salud y menores mantienen el filtrado de datos, las autorizaciones y las declaraciones que ya les corresponden.

La cita solo se considera guardada después de validar la respuesta para el negocio y el UID actuales. Entonces se actualiza «Mis citas», donde permanece disponible la consulta y la cancelación conforme a las reglas existentes.

## Operaciones pendientes y recuperación

No se permite cambiar de recorrido o de destinatario mientras el chat agrupa mensajes, está generando, está confirmando o tiene una confirmación incierta. El calendario conserva su bloqueo durante las mutaciones y la recuperación incierta. Un cambio de recorrido permitido antes de confirmar puede descartar la selección o propuesta que solo estaba en la interfaz; no confirma una cita.

Una respuesta de red perdida o un fallo ambiguo después de enviar la confirmación puede corresponder a una cita ya guardada. En ese estado se conserva la misma propuesta y el cuerpo original de la operación. No se permite sustituirla por otra confirmación ni enviar un nuevo turno. El teléfono y las respuestas del formulario quedan congelados durante la recuperación.

En el calendario, la recuperación se ofrece mediante su acción separada y la confirmación ordinaria permanece deshabilitada; no aparecen dos acciones habilitadas con el mismo nombre. En el chat, la propuesta puede presentar su propia acción de recuperación conservando los mismos datos congelados.

«Recuperar confirmación» repite exclusivamente la operación original y conserva la comprobación del UID esperado. El servidor puede devolver la misma cita ya guardada sin crear otra ni consumir el cupo otra vez. La pérdida de permisos bloquea operaciones nuevas; no elimina esa posibilidad de recuperar una confirmación ya enviada. Los cambios de datos que se intenten durante el reintento no reemplazan el cuerpo guardado.

Si la política falla temporalmente, se mantiene el controlador iniciado con las nuevas operaciones deshabilitadas. Si un negocio cambia de general a salud mientras hay una operación de chat bloqueada, el controlador permanece para resolverla con `permitted=false`; no envía nuevas inferencias. Al resolverse, la interfaz pasa al formulario estructurado. Cambiar de UID o negocio limpia el estado del ámbito anterior y descarta sus respuestas tardías.

## Identidad visual y accesibilidad

Se mantiene [Agenda clara](../design-system.md): DM Sans autoalojada, fondo claro, superficies blancas, tinta existente y azul para acción y foco. Las opciones usan texto y estado `aria-pressed`, además de su tratamiento visual. Los controles conservan foco visible y área táctil mínima de 44 px.

Servicio, recurso, día, horario, teléfono y preguntas mantienen etiquetas accesibles. Las horas y los importes usan cifras tabulares. El formulario y los selectores deben envolver contenido y funcionar desde 320 px, con teclado y sin desplazamiento horizontal. Los mensajes de espera, error y recuperación explican la acción disponible sin depender solo del color.

## Compatibilidad y reversión

El runtime de catálogo `accab511b34863628b1ad5ebdb079e87e5a30657`, imagen `sha256:b2b925f5965b38e8eca40fccd31087648f97b245e27da9a0e9725c54ae431df0`, ya soporta casos `subjectKind: self`, beneficiarios `kind: self`, propuestas v2 y las citas resultantes. Esta entrega reutiliza esos contratos; volver a ese runtime conserva la lectura y cancelación de las citas creadas desde el calendario. No requiere borrar datos ni revertir un esquema.

Las propuestas y selecciones pendientes del navegador viven en memoria del componente. Recargar, abandonar la página o volver a abrir el frontend anterior no restituye ese controlador del calendario. Esa limitación de continuidad no elimina una cita que el servidor ya haya guardado: su estado debe comprobarse en «Mis citas». Un cliente del calendario que siga abierto conserva compatibilidad con el servidor anterior, pero la recuperación no persiste por sí sola tras navegar.

Una reversión operativa conserva D1/R2, secretos, presupuesto y la única instancia, y sigue el procedimiento de mantenimiento y drenaje vigente. Este documento define el alcance y los límites del cambio; no acredita que se haya publicado ni ejecutado su aceptación.

El protocolo repetible está en [qa/tests/direct-booking-calendar.md](../../qa/tests/direct-booking-calendar.md). Los resultados de cada corrida deben registrarse por separado en `docs/qa/`.
