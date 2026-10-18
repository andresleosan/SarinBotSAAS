# Conservación y solicitudes privadas: recordatorios

Los recordatorios no tienen un cuerpo guardado ni copian servicio, contacto o respuestas. Sí conservan identificadores personales: `ownerUid`, negocio, cita, revisiones/huellas de permisos, horario de la ocurrencia y fecha de visto. Son datos privados. La preferencia y el recibo no se incluyen en la ficha pública, logs, capturas o respuestas a terceros.

Se guardan en `businesses/{id}/reminderPreferences/{hash}` y `businesses/{id}/reminderReceipts/{hash}`. Solo hay un recibo por cuenta/cita/antelación; marcar otra ocurrencia lo sustituye. Desactivar no borra los vistos. En este incremento no hay purga automática ni TTL; un recibo acompaña la conservación de su cita. Revertir al runtime v18 deja estos documentos intactos.

## Procedimiento operativo

Aplicar como parte de una solicitud de exportación o eliminación autorizada y verificada. Esta función no se expone al navegador y no decide si una solicitud debe atenderse. El operador debe confirmar identidad, alcance y conservación aplicable, y completar también los procedimientos existentes de citas/cuenta/negocio. Estos helpers solo gestionan las dos colecciones nuevas.

1. Antes de eliminar una cuenta o negocio, poner los escritores relevantes en mantenimiento y drenar operaciones. Obtener un respaldo privado vigente con el procedimiento existente de D1. No borrar primero el negocio: sus subcolecciones sobreviven.
2. Importar `exportReminderData` y `deleteExportedReminderData` de `src/lib/server/reminder-data-maintenance.ts` en una herramienta administrativa de confianza. Pasar explícitamente la instancia `Database` autorizada; el helper no elige producción, no contiene credenciales ni tiene CLI o ruta HTTP pública.
3. Exportar el ámbito exacto. El resultado contiene versión, ámbito, documentos completos y SHA-256 de contenido. Guardarlo fuera de Git en el expediente privado; no imprimir datos personales en logs. Para una cita: `{businessId, appointmentId}` exporta sus recibos y conserva preferencias. Para una cuenta en un negocio: `{businessId, ownerUid}` exporta preferencias y recibos. Para un negocio: `{businessId}` exporta ambas colecciones completas. Los identificadores de la consulta provienen del expediente verificado, no de `visitedTenants`.
4. Para una cuenta completa, inventariar todos los negocios y también padres ausentes que tengan estas subcolecciones desde el respaldo completo de D1; ejecutar el ámbito de esa cuenta en cada negocio. No usar únicamente el historial visitado ni solo los negocios activos. En Firestore, recorrer también ancestros ausentes del exportador existente. Eliminar una cita/cuenta/negocio de la colección principal no elimina los documentos hijos.
5. Tras revisar y archivar la exportación, pasar ese objeto exacto a `deleteExportedReminderData(db, exported)`. La función relee el inventario y compara su contenido en una transacción antes de borrar. Una modificación, alta o baja concurrente produce conflicto; no se adopta automáticamente una exportación nueva ni se borra parcialmente. Revisar el nuevo estado y repetir solo tras resolverlo.
6. La transacción admite como máximo100 documentos. Si se supera, dividir primero por cuenta y, si hace falta, por cita (`ownerUid` y `appointmentId` pueden combinarse). Reexportar cada ámbito, revisarlo y borrarlo; al final, exportar otra vez el ámbito original para incluir preferencias restantes. Una lectura que exceda el límite de almacenamiento falla explícitamente; usar el inventario completo del respaldo para subdividir sin perder padres o cuentas. No añadir un `limit` que oculte datos pendientes.
7. Verificar con otra exportación que el ámbito original queda vacío y que registros vecinos conservan sus huellas. Completar la eliminación de citas/cuenta/negocio correspondiente y verificarla por separado. Conservar solo evidencia mínima de ejecución según la política del expediente; los respaldos privados siguen su propio plazo de conservación, no desaparecen con la eliminación de datos activos.

Ejemplo del núcleo, dentro de la herramienta administrativa y con `db` ya elegido y autorizado:

```ts
const exported = await exportReminderData(db, { businessId, ownerUid });
// Guardar y revisar exported en el expediente privado antes de continuar.
await deleteExportedReminderData(db, exported);
const after = await exportReminderData(db, exported.scope);
if (after.documents.length !== 0) throw new Error('Verificación de eliminación pendiente');
```

## Ensayo seguro

`tests/reminder-data-maintenance.test.ts` ejecuta exportación, borrado y verificación de ausencia para cita, cuenta y negocio con datos sintéticos. Comprueba preservación de preferencias al borrar una cita, cuentas vecinas, otro negocio y citas originales; rechaza inventarios alterados, identidades incoherentes y lotes excesivos. El caso D1 usa dos conexiones locales: una inserción antes del commit provoca conflicto sin borrar y una exportación nueva explícita permite finalizar. No usa red de producción ni realiza eliminaciones reales.
