# Corte de datos Firestore → D1 y R2

Este procedimiento conserva Firebase Auth y sus UID. Tras el corte, D1 es la única fuente de datos comerciales y el bucket R2 es privado. Firestore se conserva intacto como respaldo inicial. La copia cubre datos comerciales del servidor; no incluye ni elimina datos locales que versiones anteriores hayan guardado en los navegadores. La herramienta no borra documentos Firestore, no aplica restauraciones y no imprime tokens ni contenido de documentos.

## Requisitos y límites

- Node 24, dependencias del lockfile y autenticación de operador existente en Google Cloud y Wrangler. Google se consulta siempre con `--project=sarinbotsaas --billing-project=sarinbotsaas`; no se crean claves de servicio ni se trasladan credenciales humanas al contenedor. En Windows se ejecuta el Python incluido del SDK con `lib/gcloud.py`.
- Recursos dedicados `sarin-bot-data` y `sarin-bot-files`, con el esquema `cloudflare/migrations/0001_data.sql` aplicado. Confirmar sus identificadores antes de ejecutar comandos remotos. El bucket no debe habilitar acceso público.
- Un directorio absoluto nuevo fuera de este repositorio, en almacenamiento privado con espacio suficiente y cifrado de disco según la configuración del operador. La herramienta establece permisos del usuario actual y SYSTEM en Windows, o directorio 0700 y archivos 0600 en otros sistemas. No sincronizarlo, adjuntarlo a incidencias ni copiarlo a Git. Los logs de Wrangler se guardan allí porque pueden contener resultados privados.
- Un único import final de producción, con el destino vacío: cero documentos, revisión global 0 y journal vacío. Los ensayos usan almacenamiento local. No hay UPSERT, borrado ni reinicio automático del destino. Un destino parcial exige investigar el fallo y decidir una recuperación; no volver a importar a ciegas.

`--export` lee Firestore real aunque no lleve `--remote`. Las operaciones D1/R2 son locales por defecto; `--remote` las dirige a Cloudflare. El CLI captura la salida de sus subprocesos y solo muestra resúmenes de conteos, revisión y SHA-256. No ejecutar con trazas HTTP ni imprimir los archivos privados.

## Comportamiento de la copia

Una consulta fuerte `documents:runQuery`, con `users`, límite 1 y proyección `__name__`, obtiene un `readTime` del servidor. También funciona cuando no hay usuarios. Ese instante se usa en todas las páginas de documentos y colecciones; no se calcula restando tiempo al reloj local. El recorrido descubre colecciones y subcolecciones recursivamente, pagina ambos listados y usa `showMissing=true`: conserva descendientes cuyos documentos ancestros faltan sin inventar documentos vacíos. Rechaza ciclos de paginación, nombres de otro proyecto y duplicados. La exportación debe terminar en menos de 55 minutos; si excede la ventana, repetir en otro directorio.

Los archivos se crean exclusivamente, sin sobrescribir copias anteriores:

| Archivo | Contenido y verificación |
| --- | --- |
| `firestore-export.json` | Respuesta documental tipada original, colecciones, ancestros faltantes e instante de lectura. |
| `firestore-manifest.json` | SHA-256 y conteos de la copia original. |
| `documents.json` | Filas D1 con ruta, padre, ID, JSON, fecha de import y referencia de archivo opcional. |
| `blobs/<sha256>` | Bytes originales deduplicados de comprobantes y logos; las referencias conservan cada clave R2. |
| `migration-manifest.json` | Hash de origen, compatibilidad de todas las rutas/JSON, conteos, reservas y hashes de filas/archivos. |
| `import.sql` | Inserciones con escape literal SQL y guard que exige destino vacío. |
| `baseline-restore.json` | Escrituras Firestore originales con precondición de `updateTime`; no se ejecutan automáticamente. |

La transformación conserva null, booleanos, cadenas Unicode válidas, enteros exactamente representables en JavaScript, doubles finitos, mapas y arrays de valores admitidos. Las fechas comerciales que ya son números o cadenas permanecen así; no se convierten a Timestamp. Los tipos originales quedan además en el archivo fuente y en la restauración base.

Se rechazan sin imprimir sus valores: Timestamp, bytes, referencias Firestore, GeoPoint, enteros fuera del rango seguro, NaN/Infinity, cero negativo, arrays directamente anidados, uniones tipadas malformadas, Unicode inválido y objetos no JSON. También se rechazan claves reservadas (`__proto__`, `prototype`, `constructor`), claves con NUL, profundidad fuera del contrato y documentos JSON de más de 1 MiB. Las rutas deben cumplir exactamente `isDataPath` de `shared/data-protocol.ts`: colecciones admitidas, subcolecciones explícitas, dos o cuatro segmentos para documentos e IDs de hasta 128 caracteres alfanuméricos, `_` o `-`. Una incompatibilidad bloquea toda la preparación con `MIGRATION_RUNTIME_COMPATIBILITY`; nunca se omite una fila. El manifiesto solo declara `runtimeCompatibility.allCompatible=true` cuando todos los documentos pasan.

`paymentImages` y los comprobantes antiguos en `paymentReceipts` extraen `receiptDataUrl` a R2. Solo se aceptan PNG/JPEG/WebP canónicos, firma compatible y 12–153600 bytes. D1 conserva el propietario y demás metadatos, junto con `{key,contentType,byteLength,sha256}`; la clave es `payment-images/<sha256>`. La lectura individual del puente vuelve a formar el data URL canónico; las consultas no incluyen imágenes. Cada sentencia SQL se limita a 90000 bytes; un documento mayor que ese límite de import se rechaza antes de escribir artefactos preparados, conservando la copia original para resolverlo explícitamente.

El piloto a?ade `businessLogos`: extrae `logoDataUrl` a `business-logos/<sha256>`, solo WebP can?nico de 12 a 262144 bytes. Valida `businessId`, propietario, fecha, SHA y el ID compuesto del documento; no ampl?a el l?mite ni los tipos de comprobantes. La reversi?n repone `logoDataUrl` para logos y `receiptDataUrl` para comprobantes. Los manifiestos deduplican por clave R2, preservando dos referencias si ambos prefijos contienen los mismos bytes; los archivos privados locales conservan el nombre hist?rico `<sha256>` y se escriben una sola vez. La exportaci?n/verificaci?n descarga cada clave remota, incluso si comparten hash. `verify-d1-backup.mjs` valida la pol?tica por colecci?n y ensaya recuperaci?n SQL y R2 en almacenamiento local aislado. La prueba sint?tica del piloto incluye un logo de 151 KiB, ambos prefijos con el mismo SHA y lectura de bundles hist?ricos; no sustituye el respaldo consistente de producci?n bajo mantenimiento.

## Ensayo local

Ejecutar desde la raíz del repositorio. Estos comandos son ejemplos para el operador, no una constancia de ejecución. Elegir una ruta nueva para cada exportación. Una exportación preliminar es de solo lectura; sus conteos pueden incluir actividad en curso y no autoriza un corte final.

```powershell
$migrationDir = 'C:\SarinPrivate\preflight-20261016-unique'
node scripts/cloudflare-data-migration.mjs --export --directory $migrationDir
node scripts/cloudflare-data-migration.mjs --verify-source --directory $migrationDir
node scripts/cloudflare-data-migration.mjs --prepare --directory $migrationDir
node scripts/cloudflare-data-migration.mjs --verify --directory $migrationDir
```

El ensayo CLI necesita el esquema local en la misma ruta persistente que usa el import:

```powershell
pnpm --dir cloudflare exec wrangler d1 execute sarin-bot-data --local --persist-to "$migrationDir\local-cloudflare-state" --file migrations/0001_data.sql --yes
node scripts/cloudflare-data-migration.mjs --import --directory $migrationDir --database sarin-bot-data --bucket sarin-bot-files
node scripts/cloudflare-data-migration.mjs --verify-target --directory $migrationDir --database sarin-bot-data --bucket sarin-bot-files
```

La verificación compara cada fila con el manifiesto, exige revisión 0 y descarga cada archivo R2 para comprobar longitud y SHA-256. No basta comparar el número de documentos. Para ensayar otra copia usar otro directorio y almacenamiento local; no modificar una copia preparada. Las pruebas automatizadas con datos sintéticos están en `tests/data-migration.test.ts`, incluidas importación Workerd D1/R2 y rehidratación de imágenes de ambos formatos.

## Corte final

1. Conservar fuera de Git la versión, configuración activa y evidencia de los ensayos. Preparar la imagen y bindings D1/R2, manteniendo todavía `SARIN_DATA_BACKEND=firestore`. Confirmar que el esquema dedicado está aplicado y vacío; no importar un preflight a producción.
2. Activar mantenimiento en todos los accesos de aplicación, impedir nuevos productores y detener los disparadores de tareas de fondo. WhatsApp debe seguir deshabilitado. Esperar a que terminen respuestas, mutaciones y liquidaciones en curso. Confirmar en la instancia que sirve tráfico `queue.activeSlots=0` y `queue.queuedRequests=0`, ausencia de solicitudes activas y ninguna reserva IA nueva con `status=reserved`.
3. Las estadísticas existentes son de `/api/sarin/health` para superadmin. Si mantenimiento bloquea esa ruta pública, usar únicamente el transporte autenticado de operador ya disponible hacia el proceso existente. No medir una cola importando el módulo en un proceso Node nuevo, porque tendría su propia memoria vacía. No crear una ruta pública de diagnóstico. Si no puede demostrarse el drain, el corte permanece bloqueado.
4. Detener el proceso anterior y confirmar su terminación antes de exportar. Mantenimiento por sí solo no detiene una respuesta ya iniciada ni sus escrituras posteriores. Mantener deshabilitado cualquier proceso antiguo/VPS con capacidad de escribir Firestore. No arrancarlo durante la copia. Mantener bloqueados los escritores hasta terminar la verificación final.
5. Exportar de nuevo en un directorio **nuevo**, ahora con la confirmación de mantenimiento y drain. El CLI obtiene el `readTime` del servidor después de esa confirmación; no acepta como copia final un archivo generado por el antiguo método de reloj local.

```powershell
$finalDir = 'C:\SarinPrivate\final-20261016-unique'
node scripts/cloudflare-data-migration.mjs --export --maintenance-confirmed --directory $finalDir
node scripts/cloudflare-data-migration.mjs --verify-source --directory $finalDir
node scripts/cloudflare-data-migration.mjs --prepare --directory $finalDir
node scripts/cloudflare-data-migration.mjs --verify --directory $finalDir
```

6. Revisar los resúmenes: `runtimeCompatibility.allCompatible=true`, cantidades esperadas y `reservations.statusReserved=0`, `reservations.reservedResponses=0`. `reservedResponseDocuments` cuenta documentos que contienen ese contador, incluso si vale cero. Son agregados sin UID ni cuerpos. Si aparecen reservas antiguas, investigar y resolver su estado mediante las reglas existentes; **no liberarlas automáticamente** ni ajustar contadores para hacer pasar el corte. El import remoto las rechaza.
7. Ejecutar un único import remoto en los recursos dedicados. Primero se suben archivos y un manifiesto privado `migration-manifests/<sha256>.json`; después se importan filas D1. Así ninguna fila confirmada referencia un archivo pendiente. Un fallo previo puede dejar archivos privados sin referencia; no se borran automáticamente.

```powershell
node scripts/cloudflare-data-migration.mjs --import --remote --maintenance-confirmed --directory $finalDir --database sarin-bot-data --bucket sarin-bot-files
node scripts/cloudflare-data-migration.mjs --verify-target --remote --directory $finalDir --database sarin-bot-data --bucket sarin-bot-files
```

8. Solo tras `import-verified` y verificación de correspondencia completa, activar `SARIN_DATA_BACKEND=d1` con mantenimiento todavía activo y publicar la imagen nueva para la única instancia. No reactivar el proceso anterior. Confirmar configuración e imagen antes de retirar mantenimiento; las rutas de sesión, negocio y agenda siguen bloqueadas durante esa fase. Después de desactivar mantenimiento, verificar login Google con el mismo UID y lecturas autorizadas de negocio, agenda y comprobante, sin introducir pagos o reservas reales como prueba. Si falla la aceptación, volver a bloquear entradas. A partir de la primera escritura, D1 es la fuente de verdad y se aplica el procedimiento de reversión con reconciliación.

`--maintenance-confirmed` es una constancia del operador, no una detección automática del estado de los procesos. El marcador del manifiesto y los conteos son controles adicionales; no sustituyen cerrar todos los escritores. El CLI no crea recursos, no cambia flags, no detiene contenedores y no inicia tráfico.

Durante mantenimiento, el Worker solo permite `GET /api/sarin/health?scope=engine` con Bearer al handler existente de Next, que vuelve a verificar Firebase y el UID superadmin. Si Ollama está offline, transforma únicamente un 503 JSON con cinco contadores de cola válidos en una respuesta saneada HTTP 200 con `online:false`. No expone errores privados ni el catálogo; el cuerpo se limita a 16 KiB. Un 200 en esa consulta acredita el drenaje observado, no la disponibilidad del motor. Las respuestas 401/403 se conservan y las demás rutas siguen bloqueadas. Los informes de cortes anteriores conservan el nombre de diagnóstico utilizado en ese momento.

## Reversión

Tras la aceptación del corte se retiró el binding incondicional `roles/datastore.user` del miembro `serviceAccount:sarin-runtime@sarinbotsaas.iam.gserviceaccount.com`. Se conserva `roles/firebaseauth.viewer` y la confianza WIF; la aplicación activa usa Firebase solo para Auth. La política anterior está respaldada fuera de Git. La misma cuenta también era usada por la VPS: su imagen antigua no puede recuperar Firestore sin restituir ese permiso.

Si una recuperación autorizada exige volver a Firestore, restaurar únicamente ese miembro/rol después de cumplir las condiciones de reconciliación que siguen; no restaurar toda una política IAM antigua ni otorgar roles más amplios:

```powershell
gcloud --project=sarinbotsaas --billing-project=sarinbotsaas projects add-iam-policy-binding sarinbotsaas --member=serviceAccount:sarin-runtime@sarinbotsaas.iam.gserviceaccount.com --role=roles/datastore.user --condition=None --quiet --format=none
```

Antes de admitir escrituras D1, si la revisión sigue en 0 y la copia se verificó íntegra, mantener mantenimiento, detener la instancia D1 y restaurar la configuración/artefacto Firestore anterior. Firestore no se alteró durante la migración. No aplicar `baseline-restore.json` para este caso: es innecesario.

Después de cualquier escritura D1, no volver únicamente el flag. Primero bloquear entradas y productores, drenar y detener la instancia D1 con las mismas condiciones del corte. Exportar D1 y todos sus archivos R2 a un directorio privado nuevo y generar un plan contra la copia final original:

```powershell
$rollbackDir = 'C:\SarinPrivate\rollback-20261016-unique'
node scripts/cloudflare-data-migration.mjs --export-d1 --remote --maintenance-confirmed --directory $rollbackDir --database sarin-bot-data --bucket sarin-bot-files
node scripts/cloudflare-data-migration.mjs --reverse-plan --directory $rollbackDir --baseline $finalDir
```

La exportación comprueba la revisión antes y después del recorrido y rechaza cambios concurrentes; no depende del journal, que puede caducar. `firestore-reverse-plan.json` contiene el estado D1 completo en `upserts`, rehidrata y verifica los bytes R2, conserva tipos originales cuando existe una referencia base y separa ausencias en `deletionCandidates`. Incluye revisión D1, hash de la base y hash del plan. Los documentos que ya existían requieren su `updateTime` original; los nuevos requieren `exists=false`. Una escritura accidental en Firestore durante el intervalo causa conflicto y debe reconciliarse, no ignorarse.

Este CLI es de solo lectura respecto a Firestore y **no aplica el plan**. El operador debe revisar el plan en el entorno privado, aplicar y verificar con precondiciones una reconciliación autorizada, incluidas las eliminaciones que realmente correspondan, y demostrar correspondencia de rutas, valores y archivos antes de activar Firestore. No imprimir el plan. Mantener mantenimiento durante toda la reconciliación; conservar D1/R2 y ambos respaldos. `baseline-restore.json` restaura únicamente la base y perdería cambios posteriores al corte si se usara en su lugar.

## Referencias

La implementación usa las APIs oficiales de [listado de documentos y `showMissing`](https://firebase.google.com/docs/firestore/reference/rest/v1/projects.databases.documents/list), [descubrimiento de colecciones](https://firebase.google.com/docs/firestore/reference/rest/v1/projects.databases.documents/listCollectionIds), [consulta fuerte y `readTime` incluso con resultado vacío](https://firebase.google.com/docs/firestore/reference/rest/v1/projects.databases.documents/runQuery) y [valores tipados Firestore](https://firebase.google.com/docs/firestore/reference/rest/v1/Value). La importación sigue las opciones de [importación y exportación D1](https://developers.cloudflare.com/d1/best-practices/import-export-data/). El contrato local definitivo está en `shared/data-protocol.ts`, el esquema en `cloudflare/migrations/0001_data.sql` y la arquitectura aprobada en `docs/superpowers/specs/2026-10-16-cloudflare-data-design.md`.
