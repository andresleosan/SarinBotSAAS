# Piloto privado de Sarin Pruebas

El propietario aprobó una prueba de experiencia completa antes de incorporar un negocio piloto. Instancia privada, reservas identificadas como pruebas, cuentas propias autorizadas y ninguna comunicación por WhatsApp. No se publicará el backend durante este recorrido.

## Estado inicial

- Código activo: `ac478e4`, imagen `compact-forms-20261016t025030z`.
- Las comprobaciones automatizadas y las pruebas de pagos/cuotas con emuladores ya tienen evidencia en `2026-10-15-commercial-quotas.md` y `2026-10-15-compact-forms.md`. No sustituyen la validación del chat con el modelo real.
- La sesión inicialmente abierta era la administradora, sin negocio propio. Se abrió el acceso de la cuenta propietaria del negocio existente; Google quedó cargando al seleccionarla. Pendiente completar ese acceso para verificar la configuración actual.
- Ninguna reserva, inferencia, cambio de configuración o selección de proveedor ejecutados al preparar este documento.

Actualización posterior: el propietario completó el acceso y Chrome mostró Sarin Pruebas. Antes del recorrido solicitó separar el país del WhatsApp; ese ajuste quedó implementado y verificado en `2026-10-15-whatsapp-country-selector.md`. El bloqueo de acceso está resuelto; las pruebas de reservas e inferencia enumeradas abajo continúan pendientes.

## Recorrido previsto

1. Leer la configuración y agenda del negocio existente. Elegir una fecha futura abierta y otra cerrada según sus horarios reales; conservar los datos actuales salvo ajustes de prueba necesarios y reversibles.
2. Con IA local, consultar catálogo/precio/duración y pedir una hora fuera del horario. Los datos deben coincidir con la configuración.
3. Consultar disponibilidad. Proporcionar datos de prueba y pedir un resumen sin autorizar todavía la reserva. La agenda debe permanecer sin nuevas citas.
4. Confirmar una reserva. Verificar fecha, hora, duración, preparación, recurso y una sola cita persistida, tanto en agenda como en la tarjeta del cliente.
5. Intentar reservar un intervalo ocupado y pedir mover/cancelar la cita desde el chat. No debe crear duplicados, aceptar solapamientos ni afirmar acciones que no puede ejecutar.
6. Cancelar desde la agenda del dueño, comprobar que desaparece de las citas activas del cliente y que el horario queda disponible. Probar un bloqueo de agenda y su retirada.
7. Revisar la cuota utilizada. Las conversaciones del piloto consumen la bolsa vigente; no se restablece artificialmente.
8. Con autorización de acceso administrativo disponible, seleccionar temporalmente DeepSeek y ejecutar tres consultas nuevas sin reservas: catálogo, día cerrado y disponibilidad. Comprobar medidor de llamadas/tokens/costo registrado y restituir IA local. No reenviar el historial de reservas.
9. Mantener cualquier prueba de aprobación/rechazo de pagos y agotamiento de cuota en el entorno emulado. No enviar transferencias ni comprobantes ficticios a la instancia real.

La secuencia se adapta a las respuestas reales y se detiene ante una reserva ambigua para consultar el estado antes de reintentar. No se ejecuta carga concurrente contra la Mac durante este piloto.

## Límites identificados al leer el código

- El chat cliente tiene herramientas para consultar disponibilidad, crear una cita y generar un enlace de contacto. No hay herramientas de cancelación ni reprogramación.
- La agenda del dueño sí permite cancelar. La API autoriza también al cliente dueño de una cita a cancelarla, pero la isla cliente aún no ofrece ese control.
- El modo de copiloto del dueño existe en backend, sin una pantalla que lo invoque actualmente.
- Las reservas usan identidad y nombre de la cuenta autenticada. No se sustituye esa identidad escribiendo un nombre ficticio en el chat. Una prueba funcional con una sola cuenta no constituye prueba de aislamiento entre usuarios distintos.

## Evidencia

Pendiente de ejecutar el recorrido. Los resultados y capturas se registrarán sin credenciales ni cuerpos de conversaciones privadas en Git. Las citas de prueba se cancelarán desde la aplicación al terminar; se conserva su historial.
