# Recordatorios de citas dentro de Sarin

Estado: diseño aprobado, implementado y publicado como runtime `ed28549`, Containers v19. [Aceptación y límites](../../qa/2026-10-17-in-app-reminders.md). Base de comparación y reversión: runtime `97b6572`, Containers v18; documentación `6df82f3`.

## Intención y alcance

El propietario autorizó avanzar por incrementos implementados, probados y publicados, y eligió «todo dentro de la app de momento». El siguiente incremento ayudará al cliente a recordar una cita próxima cuando consulte Sarin, sin enviar mensajes externos. No se atribuye todavía una reducción de inasistencias.

Decisión confirmada: **un recordatorio disponible desde 24 horas antes de la cita**, dentro de «Mis citas» de cada negocio. El propietario eligió «Un aviso 24 horas antes» y aprobó implementar este diseño. No se incluye un segundo aviso.

El recordatorio necesita Sarin abierto y conexión. No funciona como una alarma con la app cerrada, ni solicita permisos de notificaciones del navegador. Correo, SMS, WhatsApp, push, IA y un centro global de notificaciones quedan fuera de este incremento.

## Recorrido del cliente

En «Mis citas» aparece una sección «Recordatorios», con una preferencia opcional por cuenta y negocio, inicialmente desactivada. Texto: «Ver avisos de mis próximas citas en Sarin. Los avisos aparecen al abrir esta pantalla; no se envían con la app cerrada». Activarla no acepta condiciones, autoriza datos ni habilita reservas de salud o representación.

Con la preferencia activa, aparecen las citas propias confirmadas cuyo inicio esté en las próximas 24 horas. Reservar dentro de esa ventana hace que el aviso esté disponible en la siguiente consulta; nunca se muestra después del inicio. El resumen dice «Tu cita se acerca», con fecha y hora de Colombia, y ofrece «Ver cita» y «Marcar como visto». No copia servicio, precio, contacto, respuestas ni datos del beneficiario. «Ver cita» enfoca la tarjeta actual y respeta las operaciones pendientes de reserva o cambio.

El visto se guarda solo tras la acción explícita; no se marca al montar, consultar o desplazar la pantalla. Los vistos pueden consultarse en un grupo plegable mientras la cita siga siendo futura. Desactivar oculta los avisos y se conserva entre sesiones; no borra citas ni los vistos. Cambiar de cuenta o negocio oculta inmediatamente los datos anteriores y descarta respuestas tardías.

Estados diferenciados: apagado, guardando, cargando, avisos pendientes, vistos y error con reintento. «No tienes recordatorios pendientes» requiere una consulta correcta. Un error de red no equivale a ausencia de avisos. No se usa una preferencia incierta o una respuesta de otro ámbito para volver a mostrar datos.

## Decisión de arquitectura

Se recomienda conservar el monolito y **calcular la disponibilidad al consultar la cita canónica, usando una regla persistida y recibos de lectura separados**. La regla y la cita sobreviven al cierre del navegador y a reinicios; no depende de un temporizador de la pestaña. La consulta existente en primer plano sirve como patrón de actualización y se suspende al ocultar o cerrar la pantalla.

Alternativas consideradas:

| Opción | Evaluación |
| --- | --- |
| Regla persistida, cita actual y recibo de lectura | Recomendada: no necesita un proceso despierto ni cambios en la confirmación de reservas. |
| Guardar trabajos al crear, cambiar y cancelar cada cita | Añade acoplamiento transaccional y trabajos obsoletos si una versión anterior modifica la cita. |
| Despachador por cron | Útil para canales externos futuros; innecesario para consultar avisos dentro de la pantalla y añade operación y consumo. |

No se cambia `Appointment`: su fingerprint actual incluye todo el documento y agregar allí un visto invalidaría propuestas de reprogramación pendientes. Tampoco se modifican las transacciones de crear, cambiar o cancelar citas. La cancelación deja de cumplir el filtro y el cambio de horario produce otra ocurrencia lógica.

## Contrato de datos y API propuesto

Dos colecciones privadas bajo cada negocio, incorporadas expresamente a la lista de rutas admitidas del protocolo D1:

- Preferencia por UID autenticado: versión de esquema, revisión para controlar cambios concurrentes, `ownerUid`, `businessId`, habilitación, antelación permitida y fecha de modificación del servidor. Al habilitar se guardan las revisiones y huellas verificadas de los permisos `account` y `business_client` vigentes; no se copian sus textos ni respuestas.
- Recibo por cuenta, cita y clase de aviso: referencia de cita, revisión de reprogramación, inicio de esa ocurrencia, antelación y fecha de visto. Como máximo un recibo físico por cita y clase; otra ocurrencia sustituye el recibo al marcarla como vista. No hay cuerpos de notificación ni copia de datos personales de la reserva.

La identidad lógica del aviso incluye negocio, UID, cita, revisión, inicio y antelación fija de 1.440 minutos. La revisión ausente de una cita anterior equivale a cero; un valor corrupto no se normaliza silenciosamente.

Un GET autenticado devuelve la preferencia y una proyección mínima de avisos disponibles. Consulta exclusivamente citas propias confirmadas dentro de la ventana futura máxima, calcula `disponibleDesde = inicio - antelación` y lee por ID determinista solo los recibos correspondientes a esas citas. No recorre el historial de citas o vistos ni escribe durante GET. Un desbordamiento del límite documental produce un error explícito, nunca un resultado vacío o truncado sin aviso. Se añadirán los índices de Firestore necesarios para conservar el entorno de pruebas y la reversión explícita.

Las mutaciones separan cambiar la preferencia de marcar un aviso como visto, con cuerpos estrictos, sin UID aportado por el cliente y respuestas `no-store`. Cambiar la preferencia exige su revisión esperada: una solicitud antigua no puede reactivar una preferencia deshabilitada después. Un resultado incierto se reconcilia consultando el estado actual, sin volver a aplicar una decisión anterior. Marcar visto revalida dentro de una transacción la cuenta, negocio, preferencia activa, propiedad, estado, inicio, revisión, antelación y reloj actuales. Repetir una marca de la misma ocurrencia todavía vigente devuelve su visto original sin mover la fecha; una ocurrencia obsoleta devuelve conflicto y nunca sustituye el visto de la nueva. D1 conserva el control de revisión global y la recuperación de commits existentes.

Las consultas y controles solo están disponibles para la cuenta propietaria de la cita, también cuando esta gestiona la reserva de un representado. No se envían avisos a una identidad inferida del nombre o teléfono del beneficiario. Se mantienen las comprobaciones vigentes de cuenta y tratamiento; activar un recordatorio no sustituye permisos. Desactivar la preferencia siempre sigue disponible. Los avisos requieren permisos activos cuyas revisiones y huellas coincidan con las guardadas al habilitar: retirar y volver a autorizar mientras Sarin está cerrado deja la preferencia suspendida hasta reactivarla explícitamente. Ninguna consulta acepta permisos ni repara automáticamente esa suspensión. La lectura ordinaria de las citas propias sigue conservando sus reglas actuales.

## Compatibilidad y conservación

Las citas existentes quedan cubiertas sin backfill: la regla se aplica a su horario canónico. v18 puede ignorar los nuevos documentos y seguir gestionando las citas. Al volver a esta función, un recibo solo es válido para la ocurrencia actual. El inicio distingue cambios de horario de un escritor antiguo; no se promete distinguir A→B→A de escritores arbitrarios que no incrementen la revisión.

No se cambia la tabla documental ni se eliminan datos de producción. La prueba D1 durante la implementación encontró 1.018 filas leídas con 1.001 citas históricas, frente a 17 en el caso mínimo: el índice por cliente todavía examinaba su historial. Se incorpora un índice compuesto aditivo por padre, UID, estado, tipo e inicio para la ventana futura, con respaldo verificado antes de aplicarlo. El runtime v18 admite conservar este índice durante la reversión.

Las nuevas colecciones deben figurar en los procedimientos privados de exportación y atención de solicitudes de eliminación. En este incremento no hay purga automática: los recibos se conservan con su cita, y el procedimiento operativo de eliminación de cita, cuenta o negocio debe borrar sus recibos y las preferencias que correspondan, y verificar su ausencia. Ese procedimiento debe documentarse y ensayarse con datos sintéticos antes de publicar. No se promete TTL por añadir un campo de caducidad; una limpieza automática posterior necesita implementación y verificación propias.

## Coste y operación

No se incorpora un proveedor ni se mantiene el contenedor despierto para recordatorios. El consumo adicional es de consultas mientras la pantalla está activa y escrituras explícitas de preferencias/vistos. Escenario de planificación: 1.000 citas al mes, un visto por cita y 50 horas mensuales agregadas de pantalla activa implicarían unas 12.000 actualizaciones HTTP por un refresco cada 15 segundos, cada una con varias lecturas D1, más preferencias y los commits de vistos. Las filas leídas dependen de índices y volumen; deben medirse en las pruebas D1.

Estimación incremental: aproximadamente USD 0 al mes dentro de los cupos D1/Workers ya contratados, condicionada al consumo total de la cuenta; no es una factura ni un límite de gasto. No se verificó una nueva alerta de facturación en esta exploración. No hay consumo de IA, mensajes externos ni un nuevo servicio de pago.

Antes de otro despliegue se resolverá y probará por separado la lectura autenticada de sesión durante mantenimiento, detectada al publicar v18. Este diseño de recordatorios no depende de la sesión administrativa ni del motor de inferencia.

## Validación prevista y criterio de entrega

Pruebas de autorización entre cuentas y negocios; antelación exacta e inicio; citas existentes y creadas dentro de la ventana; visto persistente e idempotente; cambio/cancelación concurrentes; A→B→A con revisión; pérdida de respuesta; no invalidación de propuestas al marcar visto; retiro y nueva autorización con la app cerrada; habilitación antigua que llega después de deshabilitar; cambio de cuenta, ámbito y respuestas tardías; fallo de lectura sin vacío falso; proyección sin datos del beneficiario ni intake. Contratos D1 reales con dos conexiones y regresiones de citas/reprogramación.

Navegador con datos sintéticos en 320, 390 y 1280 px: activar, recargar, marcar visto, cambiar horario, cancelar, cambiar de cuenta y verificar teclado/foco/errores. Comprobar que la app cerrada no solicita permisos ni produce envíos. Limpiar solo los datos propios de QA. Después, congelar, construir y auditar el artefacto; publicar en instancia única y verificar producción, conservando sus límites de observación. La lista de espera empieza después de cerrar este incremento.

## Fuentes y evidencia

La [guía oficial de recordatorios de Fresha](https://www.fresha.com/help-center/knowledge-base/calendar/167-send-appointment-reminders), consultada el 17 de octubre de 2026 en Colombia, describe anticipación configurable y preferencias de notificación. La propuesta de consulta dentro de Sarin es una adaptación propia, no una función in-app atribuida a Fresha. [Precios D1](https://developers.cloudflare.com/d1/platform/pricing/) y [Containers](https://developers.cloudflare.com/containers/platform/pricing/) sustentan la evaluación de consumo.

Exploración de código y revisión independiente sobre `6df82f3`: `client-appointments.tsx`, API de citas `view=mine`, `api-polling.ts`, `appointment-rescheduling.ts`, `queue.ts`, protocolo documental y ciclo de Containers. No se ejecutaron pruebas nuevas ni consultas de datos reales para este diseño; la publicación v18 tiene su [evidencia separada](../../qa/2026-10-17-appointment-reschedule.md).
