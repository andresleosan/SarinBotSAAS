# Agenda del propietario: protocolo de aceptación

Ejecutar sobre la fuente compuesta de P3 y datos sintéticos de `demo-sarin-bot`. Este protocolo no acredita resultados: registrarlos en `docs/qa/2026-10-23-owner-agenda.md` con commit, comandos y límites. No usar datos reales, inferencia, mensajes, pagos ni cambios de producción para probar la UI.

## Modelo y lectura automatizados

- Día de Colombia, semana lunes–domingo entre meses/años, fecha inválida y máximo de 366 días.
- Servicio y preparación guardados, bloqueos sin buffer añadido, intervalos breves/solapados, recursos inactivos/eliminados y estados históricos.
- Horarios inválidos y cruces de medianoche permanecen en el listado. Fechas históricas usan `America/Bogota`; un intervalo que cruza un cambio de desfase se conserva con aviso y sin gráfico ambiguo.
- Un GET diario o hasta siete semanales, dos workers como máximo, sin consulta extra al cambiar recurso o elegir otro día de la misma semana.
- Deadline de 10 s incluye token, respuesta y JSON; siete consultas colgadas terminan en cuatro tandas simuladas. Sin timers/listeners propios después de terminar.
- Error diario, fuera de rango y vacío correcto son estados distintos. Una envoltura inválida o registro ajeno invalida ese día; ID repetido entre días invalida todas sus copias.
- 401/403, cambio de identidad/negocio/rango y pestaña oculta abortan/ocultan el ámbito anterior. Respuestas tardías nunca lo restauran.
- Refresco serializado; reemplazo de una cita conocida invalida la lectura previa sin insertar registros de otro ámbito.

## Interfaz y acciones locales

Fixture: dos recursos activos, uno inactivo con historia, un recurso eliminado, horario partido, día cerrado con cita, cancelada/completada/ausencia, bloqueo, margen de 15 minutos, cita de cinco minutos, solapamiento y menor sintético representado.

- Revisar Día y Semana en 320, 390 y 1280 px: controles legibles, gráfico con scroll local y página sin desbordamiento horizontal.
- Verificar ayuda y detalles inicialmente cerrados, resumen compacto, navegación de teclado, foco del día y enlace al listado. Comprobar zoom real del navegador al 200 % por separado de los tamaños de viewport.
- Confirmar que el gráfico decorativo no contiene contactos, beneficiario ni preguntas; el listado accesible conserva toda la información permitida y acciones actuales.
- Seleccionar un día semanal y crear/cancelar un bloqueo en esa fecha, con un recurso activo independiente del filtro. Mientras se envían esas acciones, los controles de vista están deshabilitados.
- Registrar revisión de representación con el componente real. Su busy permanece local; navegar durante una respuesta retrasada no transfiere la cita o el resultado a otra fecha/cuenta/negocio.
- Cambiar recurso no reduce los clientes del panel de políticas del día. Si el día falla, no presentar una lista vacía como lectura correcta.
- Suscripción agotada no bloquea historial/cancelación del dueño; falta de consentimiento conserva bloqueada una nueva reserva de tiempo.
- Fallar un GET local y restaurarlo: Semana incompleta, demás días utilizables y recuperación mediante Actualizar. No interpretar el hueco visual como disponibilidad para reservar.

## Medición y cierre

Medir un ciclo semanal real del fixture usando el dashboard: número de GET, máximo simultáneo, duración del ciclo y por fecha. Registrar sólo metadatos; no cabeceras, tokens ni cuerpos. Separar ciclos de polling y lecturas explícitas de revisión.

Ejecutar pruebas focales, suite completa, TypeScript y build sobre la fuente final. Revisar el diff para asegurar ausencia de cambios de backend, dependencias, lockfile y Worker. La publicación autorizada usa los gates vigentes de `main`; verificar el commit desplegado y una sola réplica.

Cerrar únicamente las pestañas y procesos propios, restaurar interceptores/emulación y comprobar puertos libres. Distinguir resultados automatizados, observados en navegador y pendientes; no atribuir a la emulación Firestore una verificación funcional del runtime D1 de producción.
