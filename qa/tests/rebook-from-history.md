# Volver a reservar: protocolo

Usar exclusivamente `demo-sarin-bot`, Auth/Firestore en loopback y un negocio sintético propio con permisos previos de prueba. Conservar las sesiones y datos de producción. El runner de fixture valida el inventario de emuladores y registra los documentos exactos para su limpieza.

1. Abrir el negocio y acceder con la cuenta local de cliente. Comprobar Próximas, guardar imagen y cancelación disponibles sin ejecutar esas acciones.
2. Abrir Historial. Comprobar dos acciones «Volver a reservar», con nombre accesible del servicio actual. La cita con servicio retirado conserva su fila sin botón.
3. Comprobar 320 px, 390 px y escritorio: sin desbordamiento horizontal; foco visible y acceso por teclado.
4. Pulsar el servicio gratuito histórico. Verificar foco en Nueva reserva, calendario seleccionado y servicio actual a 0 COP y 15 minutos, con profesional y hora sin elegir. Fecha distinta de la histórica; sin contacto, destinatario ni respuestas anteriores.
5. Observar red: solo lecturas vigentes y del nuevo consentimiento del caso. Cero chat/inferencia, propuestas, confirmaciones o consulta automática de disponibilidad. No confirmar ni crear citas para esta prueba.
6. Cambiar manualmente el servicio y dejar pasar un refresco: se conserva la elección. Iniciar otra reserva: servicio vacío. Volver al historial y usar el otro botón: nuevo caso con nombre, precio 42.000 COP y 40 minutos actuales.
7. Consultar horarios únicamente mediante su botón y comprobar la respuesta. Esta consulta explícita puede quedar registrada sin crear una cita.
8. Verificar consola desde la recarga final y guardar capturas con datos sintéticos. Restablecer viewport y cerrar solo las pestañas locales creadas.
9. Ejecutar cleanup del manifiesto. Debe borrar solo negocio, proyección, permiso de negocio y citas sintéticas propias; preservar Auth y el consentimiento de cuenta compartido. Detener únicamente los procesos iniciados para esta corrida.

Las pruebas de componentes e integración complementan permisos pendientes, suspensión, error de lectura, servicio retirado, identidad y callback obsoletos, StrictMode, operaciones en curso, recuperación incierta y salud/menores. No atribuir esos casos al navegador si no se ejecutaron allí.
