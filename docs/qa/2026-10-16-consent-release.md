# Candidata con consentimiento: artefacto y publicación pendiente

Imagen local construida desde el archivo Git íntegro de **`11315b71511eed436f012e64f64be830ece5317e`**. El último cambio de runtime incluido es `89114cc`; los commits posteriores anteriores al build son documentación. Incluye contactos ALS, invitaciones de seis dígitos, tarjeta A y el incremento de aceptación. No se ha publicado ni activado el presupuesto monetario.

## Artefacto comprobado

| Dato | Valor |
| --- | --- |
| Etiqueta local | `sarin-bot:pilot-11315b7` |
| ID de imagen | `sha256:c43f10492b880c5abb56c8e10e6a60739a7eacec9d3bf4d4da7f634022093d00` |
| Plataforma | `linux/amd64` |
| Tamaño | 79.685.629 bytes |
| SHA-256 del archivo de fuentes Git | `750d4d3485422b09d61da545c7b0f09ac83568b2ccf067ba0c8cde6c7a03de24` |

[Manifiesto](2026-10-16-consent-release.json). Se contrastaron el ID, la plataforma y la etiqueta OCI de revisión con `docker image inspect`. El contexto proviene de `git archive`; no contiene `.env` privados ni scratch del worktree. Solo se incorporaron los cuatro argumentos públicos de Firebase previstos por el Dockerfile. El build instala dependencias con red; la comprobación del contenedor sí se ejecutó sin red externa.

Comprobación Linux con `--network none`, `--read-only`, sin capacidades, `no-new-privileges`, directorios temporales acotados y sin credenciales externas:

- Sharp nativo produjo WebP de 512 × 512.
- Sesión sin credenciales: 401.
- `/terminos` y `/privacidad`: 200, identificando ALS Dev Studio.
- Documentos públicos de aceptación: 200 y huella válida.
- Preautorización afirmativa con origen público canónico: 200; origen ajeno: 403; decisión sin autorización de datos: 400.
- Consulta privada de permisos sin autenticación: 401.

La prueba no registra una aceptación de cuenta, no escribe en una base de datos y no hace llamadas Google/DeepSeek. No acredita conexión real a Auth/D1/R2, aceptación de clientes reales, capacidad comercial ni publicación. El contenedor temporal terminó con salida 0 y fue eliminado mediante `--rm`. El artefacto local se conserva.

La [QA de fuentes](2026-10-16-consent-acceptance.md) acredita 827 pruebas aprobadas, 25 omitidas, 23 Firestore, TypeScript, build y recorrido de navegador. No se repitieron esas suites por añadir documentación o empaquetar el mismo runtime. El build Linux volvió a compilar la aplicación.

## Secuencia preparada para el corte

Se mantiene el [procedimiento de activación](../cloudflare-no-vps-runbook.md#activación-y-reversión), con estas condiciones concretas:

1. Cerrar las decisiones de la [operación del piloto](../product/2026-10-16-pilot-operation.md): alcance, conservación/atención, acuerdos y negocios incorporados. Confirmar límites de IA entendiendo que no cubren alojamiento. Finalizar textos y reconstruir si cambia cualquier fuente de runtime.
2. Obtener la autorización explícita para publicar la candidata final y su configuración. Las continuaciones anteriores autorizan trabajo local; la petición de explicación del presupuesto no fue una aprobación de publicación.
3. Guardar la configuración vigente y referencias exactas de imagen/Worker/Pages. Preparar una configuración de release revisada; **`configure:build` copia `SARIN_MAINTENANCE=false` del template**, por lo que no debe publicarse ese resultado sin aplicar y comprobar el estado de mantenimiento requerido. No activar la compuerta monetaria antes de configurar sus límites.
4. Cerrar entrada con mantenimiento, observar `activeSlots=0` y `queuedRequests=0`, y obtener el respaldo final D1/R2 con recuperación local verificada. Respaldar por separado Auth/configuración; no exportar secretos a Git/logs. El preflight anterior es preliminar, no el respaldo final del corte.
5. Publicar el artefacto identificado manteniendo una instancia y mantenimiento. Conservar D1/R2, Google Auth, hostname ALS y WhatsApp/marketplace deshabilitados. Este incremento no requiere una migración de esquema ni volver a Firestore.
6. Comprobar sesión administrativa, origen canónico y configuración; escribir los ocho límites mediante la API administrativa con su versión real. Activar la compuerta y verificar el estado efectivo antes de reabrir. Un 503 general por mantenimiento no demuestra que el presupuesto se haya aplicado.
7. Reabrir tras comprobaciones, registrar referencias de versión y realizar la aceptación pública autorizada con datos delimitados. Observar cuota, propuestas/confirmación, permisos y gasto. No atribuir consentimiento a cuentas antiguas.

No se subió esta imagen a un registro remoto, no se ejecutó Wrangler deploy, no se modificó producción y no se efectuaron llamadas pagadas de IA. La aprobación de límites, cuando llegue, no equivale por sí sola a aprobar la publicación.

## Reversión compatible

Antes de revertir: mantenimiento y drenaje. Conservar D1/R2, las autorizaciones/revocaciones y todos los registros comerciales nuevos. El respaldo genérico de `app_documents` ya incluye los documentos privados de consentimiento; no filtrarlos ni restaurar un estado anterior que pierda retiradas.

Una imagen anterior que omita estos controles solo puede mantenerse con entrada cerrada. No permite reabrir nuevas operaciones ni nuevas reservas. Resolver hacia una versión compatible; no borrar constancias, índices de invitación, propuestas, períodos o reservas presupuestarias para adaptar los datos a una imagen vieja. Cambiar a Firestore necesita reconciliar antes las escrituras D1. Las imágenes antiguas se conservan como artefactos históricos, no como un rollback que autorice saltarse la aceptación.

Logs privados del build y archivo fuente están bajo `%LOCALAPPDATA%/SarinBot/pilot-implementation-20261016/candidate-11315b7-*`. Scripts y resultado local del smoke en `.superpowers/sdd/2026-10-16-launch-readiness/`. No contienen datos de clientes; no se publican rutas privadas ni pruebas firmadas en el manifiesto versionado.
