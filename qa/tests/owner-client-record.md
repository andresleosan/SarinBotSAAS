# Consulta de reservas de esta cuenta — protocolo

Protocolo para S06 integrado. Entorno local aislado `demo-sarin-bot`; datos sintéticos, sin mensajes, inferencia, pagos ni contactos reales. La lectura se abre desde la agenda del dueño. Resultados y límites de la ejecución del 24 de octubre: `docs/qa/2026-10-24-owner-client-record.md`.

1. Antes de abrir, no debe haber peticiones de ficha por tarjeta. Abrir «Reservas de esta cuenta» muestra las advertencias de identidad/cobertura y una sola página de hasta veinte filas.
2. Con cuarenta y cinco reservas y veintisiete a la misma hora, avanzar por tres páginas de veinte, veinte y cinco. No perder empates ni mostrar filas de otra cuenta/negocio. «Ver reservas anteriores» reemplaza la página; «Actualizar» y «Volver al inicio» vuelven a la primera.
3. Probar Todas/Atendidas/No asistió. Una confirmada pasada no se convierte en ausencia. No aparecen nombres/roles del menor, contactos, intake, servicio, precio ni auditoría en el panel. Recurso retirado conserva distintivo; recurso borrado tiene etiqueta anterior.
4. Retener una lectura y cambiar filtro, cita de origen, fecha o sesión; la respuesta antigua no debe publicarse. Cerrar cancela/oculta la ficha. Cambiar cuenta y volver no recupera su página privada anterior. Comprobar pérdida de sesión con los controles reales de la demo.
5. Simular error de transporte, 503 y plazo de diez segundos. Un error no se presenta como vacío; fallar la página anterior conserva la actual y permite recuperación explícita. Un 409 de ancla cambiada pide actualizar. Retirar todas las interceptaciones al terminar.
6. «Ver en agenda» cierra la ficha, elige día y todos los recursos, usa la lectura diaria existente y enfoca solo la tarjeta canónica encontrada. Cita movida/no encontrada muestra aviso; nunca inyecta el DTO mínimo como Appointment.
7. Guardar un resultado conocido invalida una lectura anterior de la misma cuenta. Con una asistencia pendiente, cerrar la ficha no aborta su PATCH ni elimina su reintento exacto. Los controles de navegación comprueban también la barrera síncrona.
8. A 320/390/1280 px y con teclado: controles accesibles, cierre y devolución de foco, ayuda cerrada inicialmente, sin desbordamiento. Registrar zoom nativo al 200 % solo si se observa realmente; no sustituirlo por viewport equivalente.
9. Antes/después, verificar hashes de los documentos sintéticos y ausencia de escrituras al solo consultar. Las escrituras de asistencia usadas para invalidación se registran por separado. Las garantías de servidor, índices, legado y concurrencia se atribuyen a los tests D1/SDK reales.

Publicación: índices D1 aditivos antes de la aplicación, respaldo privado verificado, sin migrar documentos ni activar Firestore de producción. Push exacto a main solo tras revisión/gates; workflow y runtime/Pages deben corresponder al mismo SHA. Conservar índices y datos en rollback.

Resultado actual: QA local automatizada y de navegador ejecutada; evidencia en el reporte enlazado. Zoom nativo y lector audible no observados. Sin publicación o aceptación productiva atribuida.
