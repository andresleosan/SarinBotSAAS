# Cambiar horario de una cita: aceptación local

Estado: aprobado localmente. Publicación autorizada pendiente de ejecutar y verificar.

El propietario autorizó implementar, probar y publicar cada adaptación antes de comenzar la siguiente. Esta entrega permite cambiar el horario de una cita propia futura confirmada desde Mis citas, conservando su identidad, cliente, contacto, respuestas y beneficiario. El resumen compara el horario anterior con el propuesto y muestra las condiciones actuales del servicio antes de confirmar.

Referencia consultada de nuevo el 17 de octubre: la [guía oficial de Fresha](https://www.fresha.com/help-center/knowledge-base/calendar/263-reschedule-appointments) describe conservar la información de la cita al cambiar fecha, hora o profesional y remitir al negocio cuando el servicio deja de estar disponible. Sarin adapta ese recorrido al cliente con sus propios permisos y reglas comerciales.

La ocupación original permanece hasta confirmar la sustitución atómica. El cambio no crea otra cita ni consume una unidad del plan. La respuesta de una confirmación perdida se recupera como la misma operación; una repetición no vuelve a mover la cita. El resultado original se distingue de la lectura actual cuando hubo cambios posteriores.

Las citas con beneficiario declarado requieren un caso nuevo con tipo y rol fijos y los permisos actuales que correspondan. Las citas antiguas sin beneficiario conservan esa ausencia y solo admiten este recorrido cuando la política del negocio es general y no tiene menores habilitados. En los demás casos se indica contactar al negocio.

Protocolo: [contrato y casos de prueba](../../qa/tests/appointment-reschedule.md). Los archivos de calendario importados anteriormente requieren actualización manual.

## Verificación automática y revisión

- `pnpm test`: **1.390 aprobadas y 26 omitidas**, 138 archivos aprobados y cuatro omitidos; 120 pruebas nuevas frente a la versión publicada anterior.
- `pnpm run typecheck`: aprobado. `pnpm audit`: ninguna vulnerabilidad conocida.
- `pnpm --filter sarin-cloudflare-host run check`: **74 pruebas aprobadas**, tipos y dry-run del Worker aprobados.
- Revisión independiente de 14 archivos de runtime y nueve archivos de pruebas/contrato: **PASS sin P1/P2**, con hashes de la fuente revisada. No sustituye las pruebas ejecutadas por root ni acredita producción.

TDD detectó y corrigió la identidad de la cita, la vinculación completa de los metadatos al mapping, el reloj posterior a las lecturas, la cancelación del cliente al iniciar la cita y carreras entre acciones del mismo evento. Las regresiones de UI también cubren recuperación tras cambios de política, permiso y catálogo, incluyendo capability ausente y transición de una cita legacy a política de salud. Los mensajes afectados por una escritura local con codificación incorrecta se restauraron antes del cierre.

## Pruebas avanzadas

Ocho casos usan D1/Workerd real con dos conexiones: cambio atómico, locks del origen/destino/cliente, competencia por la revisión de origen, conflictos con una reserva o bloqueo manual, cancelación concurrente, secuencia A→B→A seguida de cancelación y retransmisión del mismo commit después de perder su respuesta. Se verifica que el resultado original permanece separado del estado actual y que no aparecen citas adicionales ni consumo de cuota.

Los contratos de las dos rutas nuevas y la confirmación existente cubren autenticación, validación estricta, ausencia de querystring, respuestas no-store y compatibilidad de nuevas reservas. Las pruebas de salud/menores conservan beneficiario y revisión de representación, exigen la autorización vigente del caso fijo y rechazan cambios de teléfono o respuestas. La ausencia histórica de beneficiario no se convierte en una declaración nueva.

## Navegador local

**44 controles de Chrome** a 320, 390 y 1280 px con proyecto `demo-sarin-bot`. El fixture tiene un negocio único y una cita futura propia: 18 de octubre, 14:00–14:30, profesional origen, precio anterior $25.000. El servicio vigente vale $30.000, dura 40 minutos y tiene cinco minutos de buffer. La prueba comercial ya usó 10/10 citas y el cliente tiene límite de una cita futura, que está alcanzado.

Se comprobó acceso desde «Ver mis citas», fuente/beneficiario fijos, ausencia de teléfono o preguntas nuevas, consulta explícita, día vacío, rechazo del mismo horario, foco y bloqueo de PNG/ICS/cancelación/otras reservas durante el cambio. Una propuesta para el 19 de octubre, 15:00–15:40 con profesional destino, dejó la cita y los contadores originales intactos según `record proposed`.

Tras confirmar, el ensayo interceptó **solo la respuesta Fetch de confirmación local**, comprobó HTTP 200 y la prueba de revisión 1, y simuló un fallo de red antes de entregarla a la UI. La pantalla bloqueó abandono y otras operaciones y permitió recuperar. El segundo POST usó exactamente la misma ruta y cuerpo y devolvió la misma prueba. `record changed` y `record replay` comprobaron un único cambio, identidad y datos originales, locks 2/1/2 y contadores sin cambios. La lectura actual mostró una sola cita en el nuevo día; el día anterior e Historial quedaron sin otra cita y su horario volvió a estar disponible.

La descarga real ICS tiene 541 bytes, UID derivado de la misma cita, horario `20261019T200000Z–20261019T204000Z` y profesional actualizado; excluye contacto y respuestas. La imagen PNG tiene 149.001 bytes y 1080×1148 px y se inspeccionó visualmente con el nuevo horario/profesional. Se abrió la confirmación de cancelación y se eligió «Conservar cita», sin ejecutar cancelación. La captura de red completa del recorrido, sin cabeceras de autorización, contiene una propuesta, dos confirmaciones de la misma operación y consultas diarias; no hubo solicitudes de IA ni otras escrituras de negocio.

El observador de descarga del harness agotó su espera para ICS; el evento `Page.downloadProgress` completado y el archivo real confirmaron la descarga. Los campos nativos de fecha de Chrome requirieron eventos de teclado después de fill. Un primer registro del fixture rechazó una ampliación tardía del esquema local de anclaje Auth: se restauró exactamente el esquema capturado, sin editar manifiesto, fingerprints ni datos, y los registros posteriores pasaron. Se conserva el log fallido junto a los aprobados.

![Comparación a 320 px, datos sintéticos](2026-10-17-appointment-reschedule-comparison-320.jpg)

![Resumen a 390 px, datos sintéticos](2026-10-17-appointment-reschedule-summary-390.jpg)

![Cita actualizada en escritorio, datos sintéticos](2026-10-17-appointment-reschedule-desktop.jpg)

## Limpieza y límites

La limpieza validó todos los inventarios, anclajes y fingerprints antes de eliminar **15 documentos propios**. Conservó cuatro documentos compartidos y las tres identidades Auth sintéticas. Se cerró la pestaña local, se restauró el viewport y se detuvieron únicamente los árboles de procesos propios del preview y los emuladores; seis puertos se verifican libres en el cierre. Los dos archivos generados en Descargas se eliminaron después de compararlos con sus copias de QA por hash.

Las evidencias privadas están bajo `qa/reports/appointment-reschedule*` y se copiarán al paquete de publicación. Se alteró una cita sintética y se creó una propuesta local; el navegador no creó otra cita. No se aceptaron consentimientos ni se crearon o cambiaron citas, direcciones o datos reales. La autenticación administrativa se reverificará al publicar. No se atribuye importación ni sincronización con un calendario externo.

La reversión prevista es la versión publicada de ubicación y modalidad: runtime `8da7c5494f578d04af09f9a20e470d2c913e222b`, imagen `sha256:d59fa71083e4e76c62b15959818e19d0bad6ae28c3aa2f52c2dae4d22a9dfcff`, Containers v17. Sin migraciones SQL ni cambios de bindings. Conserva las citas en su estado actual con metadatos opcionales; v17 no ofrece el nuevo recorrido ni confirma o recupera sus propuestas. Revertir código no restaura horarios anteriores.

Publicación autorizada pendiente: congelar esta revisión, construir y auditar imagen, activar mantenimiento, drenar cola, sustituir la instancia única, reabrir y verificar producción.
