# Añadir cita al calendario

Segundo incremento de la secuencia autorizada: «ok vamos paso a paso, implementando probando y publicando, y pasamos al otro». La búsqueda de próxima fecha ya está publicada y verificada.

## Alcance

Desde Mis citas, descargar de forma explícita un archivo ICS de una cita futura confirmada de la cuenta actual. El archivo contiene servicio, negocio, profesional si está disponible y horario exacto. Identidad estable por negocio/cita, sin contactos, respuestas, notas privadas o beneficiarios. Se conserva Guardar imagen de la cita. Los cambios y cancelaciones se consultan en Mis citas; no se promete sincronización ni recordatorios automáticos.

## Pruebas automatizadas

- Horarios UTC equivalentes a Colombia, cruce de medianoche, identidad estable y aislamiento entre negocios/citas.
- Escapes, saltos CRLF, plegado de líneas por bytes UTF-8 y rechazo de fechas/intervalos/UID no válidos.
- DTO reducido sin datos personales ni preguntas del negocio.
- Cita propia futura confirmada; impedir acciones obsoletas, descarga duplicada y conflictos con PNG/cancelación/rebooking.
- Revalidar identidad, lectura, cita y metadatos después de la generación; descartar cambios, cancelaciones, inicio de cita y desmontaje.
- Fallo de generación/descarga sin aviso de éxito; regresión de PNG y del historial.

## Navegador local

1. Usar demo-sarin-bot y emuladores oficiales en loopback con cliente y cita sintéticos.
2. Abrir Mis citas: botón Añadir al calendario y aviso claro en la cita futura confirmada.
3. Descargar ICS con clic explícito; inspeccionar el archivo real y comprobar servicio, negocio, profesional y horario.
4. Repetir y comprobar el mismo UID; ninguna solicitud de escritura, propuesta, confirmación o inferencia.
5. Revisar Historial y Calendario: sin exportar citas anteriores/canceladas; conservación de navegación y PNG.
6. Revisar 320×740, 390×844 y escritorio: sin desbordamiento, controles de 44 px y foco de teclado visible.
7. Conservar la sesión administrativa real; limpiar únicamente documentos propios y detener los procesos de QA.

## Publicación

Congelar la revisión probada, construir imagen normal, auditar fuente/imagen y humo aislado. Reversión compatible a runtime 1b8138582a2784748537a7f1905db29368c9e57e e imagen d7ee223446ef4609137056572e3adbfdecb2233828a402afbc1ab46e8d42f617. Activar mantenimiento, drenar cola, reemplazar instancia única y verificarla antes de reabrir. Comprobar HTTP, iconos y autenticación administrativa, sin crear citas ni aceptar permisos reales para fabricar cobertura de UI.

Formato basado en [RFC 5545](https://www.rfc-editor.org/rfc/rfc5545), secciones 3.1, 3.3.5, 3.3.11 y 3.8.4.7.
