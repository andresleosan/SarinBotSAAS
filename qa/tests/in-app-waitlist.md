# Lista de espera — aceptación en navegador

Entorno: loopback 127.0.0.1:3041, Auth/Firestore emulados demo-sarin-bot, fixture privado `qa/reports/in-app-waitlist.fixture.runner.mjs`. Sin datos reales ni credenciales productivas para las mutaciones. Ejecutar mediante las capacidades documentadas del navegador; guardar resultado JSON/HTML privado y capturas sanitizadas en docs/qa.

1. Entrar con cliente emulado, abrir el negocio temporal y comprobar Recordatorios/Mis citas existentes.
2. Elegir el servicio, día y profesional del fixture; consultar sin horarios. Comprobar que aparece «Apuntarme a la lista de espera» y no antes de una consulta correcta.
3. Apuntarse una vez; comprobar el resumen persistido con fixture `record joined`. No crea cita ni propuesta.
4. Recargar: solicitud visible en Mis citas, mismo servicio/día/profesional. Comprobar espera y retirada accesible.
5. Registrar recarga; fixture `release-slot` libera únicamente el bloqueo sintético propio. «Comprobar horarios» pasa a disponibilidad.
6. «Elegir horario» abre caso nuevo con selección conservada, sin hora elegida ni confirmación automática. Comprobar controles/preguntas actuales; no confirmar una reserva en este ensayo.
7. Volver al panel, salir explícitamente y verificar ausencia de solicitud con tombstone/revisión persistente. Recargar confirma retirada.
8. En 320, 390 y 1280 px comprobar que los textos y botones no desbordan, hay foco de teclado y objetivos táctiles legibles. Revisar consola por errores propios de la función.
9. Capturar espera, disponible/continuación y estado final; generar reporte real de controles. Limpiar inventario exacto del fixture con helper lifecycle, preservando Auth/consentimiento compartido y vecinos.
10. Restaurar viewport, cerrar pestaña local y detener solo procesos propios. Producción se verifica luego por separado, sin aceptar permisos o modificar citas reales.

Los casos de red incierta, cambio UID/negocio, callbacks retenidos, medianoche, corrupción y carreras se cubren además por pruebas de integración/unitarias. No atribuir al navegador los casos que solo se ejerciten allí.
