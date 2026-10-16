# Preparación de Gemini mientras se resuelve la facturación

La activación real permanece pendiente de confirmar el prepago y la clave del proyecto dedicado. No se realizaron solicitudes reales a Google ni se modificó la selección de IA del servidor durante esta preparación.

## Comprobado sin API real

- 92 pruebas correctas en motor Gemini, permisos y selección administrativa, medidor de consumo, interfaz administrativa y reservas atómicas. Se usaron respuestas simuladas y base de datos en memoria.
- `pnpm run typecheck`: correcto.
- La regresión HTTP ahora incluye explícitamente 402: mensaje de saldo insuficiente, una sola solicitud, una sola observación de uso fallida y ningún reintento ni cambio automático de proveedor. También comprueba mensajes diferenciados para credenciales, cuota y desconexión.
- El procedimiento privado de configuración se ajustó al tag, ID y Compose exactos de la imagen `compact-suggestions` ya instalada. Siete pruebas aisladas y revisión independiente correctas; mantiene los controles de entorno, pago confirmado y reversión. No se ejecutó contra el servidor.
- La prueba privada futura de dos solicitudes exige modelo admitido, modalidad Standard y contadores de uso válidos. Una respuesta sin esos datos no basta para dar por validado el consumo.

## Aceptación pendiente con la API real

Primero verificar la facturación del proyecto exacto de la clave. El catálogo de modelos por sí solo no acredita saldo ni condiciones de pago.

1. Ejecutar la prueba acotada de catálogo y herramienta ficticia. Comprobar continuidad de la conversación, respuesta final y tokens. No crea reservas ni escribe en el medidor de producción.
2. En un entorno de prueba con datos sintéticos, preparar una barbería con un servicio de 30 minutos, 10 minutos entre citas, precio de 30.000 COP y una estación. Usar una fecha futura habilitada y zona `America/Bogota`.
3. Pedir servicio, precio y horarios. Verificar que Gemini consulte disponibilidad real antes de ofrecer una hora.
4. Solicitar una reserva y aportar las preguntas obligatorias. Verificar que se cree solo tras confirmación del cliente, aparezca una única cita en la agenda y se respete el margen entre servicios.
5. Intentar reservar el mismo horario desde otro cliente sintético. Debe rechazarse la colisión y ofrecer disponibilidad actualizada, sin afirmar que la segunda cita quedó creada.
6. Probar una pregunta que requiera atención humana. Debe ofrecer el enlace configurado del negocio; no enviar mensajes de WhatsApp durante esta prueba.
7. Verificar llamadas, tokens y costo bruto estimado en el medidor del entorno de prueba. Contrastar con los metadatos de Google, sin descontar bonos manualmente ni asumir costo cero cuando falten datos.
8. Tras aceptar el recorrido, seleccionar Gemini manualmente en administración. Confirmar el estado y conservar la posibilidad de volver a IA local o DeepSeek.

No usar clientes reales ni cambiar el proveedor global de sus conversaciones para probar estos escenarios. Las comprobaciones simuladas anteriores no sustituyen esta aceptación real.
