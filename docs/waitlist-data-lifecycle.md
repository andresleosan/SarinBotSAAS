# Conservación privada de solicitudes de espera

`businesses/{id}/waitlistRequests/{hash}` guarda una solicitud actual por cuenta/negocio: selección, caso mínimo, anclas verificadas de permisos y revisión. No incluye nombre del beneficiario, teléfono, respuestas ni mensajes. UID, servicio y condición de representación siguen siendo datos privados; no deben aparecer en logs ni exportaciones públicas.

El vencimiento al terminar el día de Colombia se deriva al consultar; no existe TTL ni purga automática. Una nueva alta explícita sustituye una solicitud vencida. «Salir de la lista» borra su selección y caso, conservando revisión y última operación para rechazar reintentos antiguos. El documento vacío también pertenece a la cuenta y se incluye en su exportación. Reservar una cita no vincula ni elimina automáticamente la solicitud.

La bandeja añade `waitlistOwnerReviews/{entryId}` privado. Versión2 liga waitlistRecordId/waitlistRevision para distinguir encarnaciones aunque el cliente reutilice join requestId; versión1 sigue legible para la primera encarnación. No es un historial de todas las revisiones. Export incluye marcas por recordId canónico aunque falte singleton, haya tombstone o cambie la entrada; no se borran automáticamente al salir.

## Procedimiento autorizado de exportación o eliminación

Estos helpers privados no deciden la autorización del expediente, no contienen credenciales, no eligen producción por defecto ni tienen ruta HTTP. El operador debe verificar identidad, alcance y conservación aplicable, además de completar los procedimientos de cuenta/negocio/citas por separado.

1. Para eliminación, detener los escritores relevantes y drenar operaciones; verificar respaldo privado según el procedimiento existente. Para borrar cuenta o negocio, revocar las sesiones/identidades o deshabilitar definitivamente el ámbito antes de reabrir escrituras. No borrar primero el padre: sus documentos hijos sobreviven.
2. Importar `exportWaitlistData` y `deleteExportedWaitlistData` de `src/lib/server/waitlist-data-maintenance.ts` en una herramienta de confianza y pasar la instancia Database autorizada explícitamente.
3. Exportar `{businessId, ownerUid}` para una cuenta en un negocio o `{businessId}` para el negocio completo. La exportación contiene documentos íntegros, ámbito y SHA-256. Guardar fuera de Git en el expediente privado, sin imprimir cuerpos en logs. No admite appointmentId: no existe vinculación con una cita concreta.
4. Para una cuenta completa, inventariar todos los negocios y ancestros ausentes con documentos de espera desde el respaldo completo D1; en Firestore, incluir padres ausentes. No usar solo negocios activos o visitedTenants.
5. Revisar la exportación y pasar el objeto exacto a `deleteExportedWaitlistData(db, exported)`. Relee el inventario y compara en una transacción. Una alta, baja o modificación concurrente rechaza todo el borrado. No adoptar automáticamente un inventario nuevo.
6. El borrado único admite100 documentos conjuntos. Dividir negocios grandes por cuentas desde el inventario completo. Una cuenta puede superar100 o1000 por acumulación de marcas: su export pagina por document ID real de100 en100 sin truncar. Usar el flujo por lotes siguiente, sin recortar el export para fingir otro ámbito.
7. Exportar otra vez el ámbito original para verificar ausencia, contrastar huellas de vecinos y completar la eliminación principal. Respaldos privados tienen su propio plazo de conservación; no desaparecen con los datos activos.

**Límite de protección:** el borrado administrativo elimina también la revisión y el tombstone antirreintentos. No se promete protección contra solicitudes históricas después de ese borrado deliberado. Detener escritores evita carreras durante la operación; revocar identidad/sesiones o cerrar el ámbito impide que solicitudes antiguas vuelvan a crear datos al reabrir. Una retirada ordinaria desde la app conserva el tombstone y no tiene este límite.

Las pruebas `tests/waitlist-data-maintenance.test.ts` ejercitan exportación/borrado exactos, tombstones, padres ausentes, vecinos, cambios concurrentes, corrupción, lotes grandes y dos conexiones D1 locales. Solo usan datos sintéticos.

## Una cuenta grande: lotes y recuperación

Mantener escritores detenidos durante todo el procedimiento; `writersStopped:true` declara esa precondición, no detiene servicios. Conservar export completo e inmutable y cada recibo en el expediente privado.

1. Revisar el export y llamar `deleteExportedWaitlistDataBatch(db, exported, {writersStopped:true})`. Verifica cada fila del siguiente lote y borra≤100 en una transacción. Devuelve exportSha256, totalCount, deletedCount, complete y hash del recibo.
2. Guardar el recibo antes de continuar. El siguiente llamado lleva `{writersStopped:true, previous:receipt}`. No recortar export ni inventar deletedCount; otro export o recibo alterado/incoherente se rechaza.
3. Si se pierde respuesta, llamar `reconcileWaitlistDataErasure(db, exported, {writersStopped:true, previous:lastKnownReceipt})`; omitir previous si se perdió el primer recibo. Siguiente lote íntegramente presente conserva progreso, íntegramente ausente permite observar avance; parcial/modificado409. `basis:'current_inventory'` es estado actual, sin atribución histórica de quién borró.
4. El último lote contrasta inventario residual del ámbito mediante consultas limitadas101 antes de borrar o acreditar finalización. Una fila nueva/recreada impide complete: conservar export/recibos y revisar inventario nuevo, sin adoptarlo automáticamente.
5. Con complete, exportar de nuevo y comprobar ausencia/vecinos antes de cerrar la eliminación principal. Fallos conservan los lotes anteriores acreditados; último lote atómico. Mantener identidades/escritores cerrados según el expediente para impedir recreación posterior.

Sin ruta pública ni botón del dueño. Export puede abarcar el expediente completo con consultas≤100; cada borrado verifica≤100 filas y limita writes a100, con lecturas residuales adicionales acotadas al terminar. Se verificaron cuentas de1006 documentos en memoria/D1 real y203 en Firestore real, además de respuesta perdida, vecinos y cambios rechazados. No acredita un borrado productivo.
