# Ensayo de recuperación D1 y archivos referenciados

Fecha: 16 de octubre de 2026, America/Bogota. Se exportó la base de producción mediante una operación de lectura y se restauró la copia en un entorno local aislado. No se restauró, importó, alteró ni borró información en producción. El origen público y el selector de IA no se modificaron.

## Resultado

| Comprobación | Evidencia |
| --- | --- |
| Exportación SQL D1 completa | `sarin-bot-data.sql`, 22.884 bytes |
| SHA-256 del SQL | `a57b432f5b0b4453ce6f8626ae1c352164626dcd3bce477c65ef13bf1425a8e1` |
| Ventana de exportación | 16 de octubre, 07:00:47–07:00:50 Colombia; `12:00:47.173Z`–`12:00:50.904Z` |
| Esquema restaurado | 17 objetos entre tablas, índices y triggers; huella idéntica al SQL original |
| Datos restaurados | 27 filas documentales, 5 registros de commit y 1 fila de revisión; todas las columnas verificadas por huella y conteo |
| Revisión del snapshot | 5 |
| Integridad SQLite/D1 local | `PRAGMA quick_check`: `ok`; 51 sentencias importadas localmente |
| Archivos R2 referenciados | Un objeto, 23.434 bytes; descarga privada y comparación de SHA-256, longitud y tipo |
| Restauración R2 local | Objeto restaurado en bucket Miniflare aislado; lectura posterior conserva SHA-256, longitud y tipo |
| Time Travel | Consulta de información correcta; bookmark guardado únicamente en el respaldo privado |
| Pruebas de guardas | Rechazo de SQL con hash alterado y de directorio de respaldo dentro del checkout |

La comparación del SQL se hizo con dos instancias separadas: SQLite local en memoria para establecer las filas del respaldo y Workerd/Miniflare para restaurarlas realmente en D1 local. Se compararon esquema y contenido completo mediante representaciones canónicas; no se imprimieron filas, correos, conversaciones, cuentas bancarias ni imágenes. El único objeto R2 se leyó por la referencia incluida en este snapshot, sin listar ni descargar otros objetos del bucket.

La verificación completa D1/R2 terminó a las `12:03:55.125Z`, 07:03:55 Colombia. Todos los handles SQLite, Worker y Miniflare se cierran mediante `finally`. Los archivos locales de recuperación quedan dentro del directorio privado para revisión; no se creó un servidor Next ni emuladores Firebase.

## Respaldo privado

Directorio nuevo, fuera de Git:

```text
%LOCALAPPDATA%/SarinBot/commercial-acceptance-2026-10-16/backup-before-release-20261016T120046694Z/
```

Contiene el SQL original, `export-manifest.json`, metadatos de D1 y Time Travel, `r2-backup-manifest.json`, bytes R2 en `r2-objects/`, logs capturados y los resultados privados de verificación. Las restauraciones locales usan subdirectorios `local-restore-*`. La ACL del directorio se comprobó con herencia protegida y dos entradas permitidas: el usuario actual y SYSTEM. Los hijos heredan esa restricción. No se omitió la comprobación de permisos.

La exportación falló inicialmente por selección/autenticación implícita de Wrangler y se repitió una vez con la cuenta explícita `05fb22c155667de064b55c4e287b21d8` y el OAuth autorizado cargado solo en memoria al entorno hijo. No se renovaron credenciales ni se añadieron permisos. Los intentos fallidos conservaron sus directorios separados y no contienen un respaldo exitoso; el directorio anterior es la única copia de esta corrida marcada como verificada.

## Repetición del ensayo

La exportación remota usó Wrangler 4.150.0 y el equivalente del comando:

```powershell
pnpm --filter sarin-cloudflare-host exec wrangler d1 export sarin-bot-data --remote --output <directorio-privado-nuevo>/sarin-bot-data.sql --skip-confirmation --config wrangler.jsonc
```

Para repetir la restauración **local** del respaldo ya creado:

```powershell
node scripts/verify-d1-backup.mjs --directory <directorio-privado-del-respaldo>
```

El verificador no ofrece operaciones remotas ni acepta un selector de entorno. Exige respaldo fuera del checkout, valida el manifiesto SQL, restaura en un D1 Miniflare nuevo y verifica todos los bytes R2 referenciados. Rechaza la ausencia o alteración de esos archivos y manifiestos. La salida solo contiene conteos, huellas y estado; los resultados se guardan también dentro de la copia privada.

Cloudflare documenta que una exportación bloquea temporalmente otras solicitudes a la base. Por eso esta corrida se coordinó sin inferencias ni escrituras E2E activas durante sus cuatro segundos; no se activó mantenimiento. Una futura exportación debe coordinar la misma ventana. [Exportación e importación oficiales](https://developers.cloudflare.com/d1/best-practices/import-export-data/).

## Time Travel y límites

Time Travel mantiene puntos de recuperación automáticamente. La retención documentada es de treinta días en Workers Paid y siete en Free. La consulta de bookmark funcionó, pero este ensayo no ejecutó una restauración remota. Restaurar con Time Travel sobrescribe la base y cancela consultas en curso; no debe ejecutarse como una comprobación de lectura. [Time Travel oficial](https://developers.cloudflare.com/d1/reference/time-travel/), [comandos Wrangler D1](https://developers.cloudflare.com/d1/wrangler-commands/).

El bookmark leído corresponde a su propio instante; no se presenta como una asociación exacta al SQL exportado. Este respaldo corresponde a revisión 5, antes de las nuevas reservas del recorrido comercial posterior. No incluye automáticamente cambios E2E realizados después de las 07:00:50 Colombia, objetos R2 sin referencia en ese snapshot, usuarios/identidades Firebase Auth, secretos, configuración de Cloudflare ni modelos Ollama. No acredita recuperación completa de la plataforma ni disponibilidad continua del Mac.

Se acreditó una restauración local del esquema, documentos y archivo R2 referenciado. Falta ensayar un procedimiento de recuperación integral de producción con autorización y ventana propias antes de prometer un objetivo de recuperación; no se usará este resultado para justificar un rollback remoto improvisado.
