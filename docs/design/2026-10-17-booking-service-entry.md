# Reserva desde un servicio y consultas sin horarios

Fecha: 17 de octubre de 2026. Incrementos acotados aprobados por el propietario al aceptar la recomendación de realizar primero la respuesta sin horarios y después la reserva por servicio.

## Recorrido

Cada servicio de la ficha pública ofrece «Reservar este servicio» cuando el negocio admite nuevas reservas. La acción conserva únicamente el ID elegido en memoria mientras la persona accede y revisa los permisos. El calendario inicializa ese servicio con su resumen actual, sin elegir profesional ni hora, consultar disponibilidad o crear una propuesta automáticamente. La acción general «Reservar» mantiene la selección vacía; en pausa sigue disponible «Ver mis citas» sin botones individuales de reserva.

La adaptación toma el patrón de [Fresha de asociar un servicio a una acción de reserva](https://www.fresha.com/help-center/knowledge-base/online-presence/101688-create-your-service-portfolio); aquella fuente describe la entrada desde el portafolio de imágenes. Sarin aplica la acción a las tarjetas de su catálogo actual y conserva su acceso y permisos existentes. No incorpora imágenes ni una integración externa en esta entrega.

La intención anónima solo puede ser reclamada por la primera cuenta que accede en ese recorrido. Salir, cambiar de UID, cambiar de enlace o de negocio completo detrás del mismo enlace descarta el ID. Volver a la ficha y utilizar la acción general también lo limpia. El ID se valida contra el catálogo autenticado actual; un servicio retirado deja la selección vacía. Se consume una sola vez al inicializar el primer caso, de modo que las ediciones manuales, otra reserva o un cambio de destinatario no resuciten la elección anterior. No se guarda en URL ni almacenamiento del navegador y no sobrevive por sí sola a una recarga completa.

## Disponibilidad

El controlador distingue consulta inicial, carga, éxito y error. Una respuesta correcta sin ningún horario —lista vacía o recursos con listas vacías— muestra una sola indicación accesible: «No hay horarios disponibles para esta selección. Prueba otro día o profesional.» Los controles de día y profesional existentes permiten continuar. No se confunde un fallo o una consulta aún no realizada con falta de cupos.

Cambiar servicio, profesional o día limpia el resultado y su estado, aborta la consulta anterior y descarta respuestas tardías. Cuenta, negocio y caso conservan el aislamiento vigente. No se consultan otros días automáticamente ni se reserva en nombre del cliente.

## Límites e identidad

Se mantiene Agenda clara, áreas táctiles de 44 px, foco visible y ajuste desde 320 px. Los botones tienen nombres accesibles que identifican su servicio; el texto del catálogo sigue siendo literal. La preselección no cambia los consentimientos, los recorridos de salud/menores, el chat manual, la confirmación ni su recuperación.

No hay API, esquema, dependencia, proveedor o migración nuevos. El runtime publicado `f47daf4`, imagen `sha256:6b9dacd55f21fec481b0726fdde2dc4d6ce8874ee3bef6c8849fba9826b5abba`, es la reversión compatible: las citas guardadas siguen siendo consultables y cancelables. Volver al frontend anterior elimina esta comodidad de entrada; la selección y las propuestas del navegador siguen sujetas a su continuidad en memoria actual.

[Protocolo de aceptación](../../qa/tests/booking-service-entry.md).
