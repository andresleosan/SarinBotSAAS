# Publicación del piloto comercial: aceptación productiva

**Estado: piloto comercial publicado y abierto; verificación productiva y CI completadas.** La instancia efectiva sirve la candidata y el presupuesto aprobado está configurado. La CI de `4eed34f` terminó con los tres jobs aprobados a las 04:51:19 UTC del 17 de octubre. Salud y menores se habilitan tras revisar cada establecimiento.

El propietario indicó «solucionalo» después de preguntar por push y producción. Se preparó el [procedimiento de operación por negocio](../product/2026-10-16-production-pilot-operation.md) y se inició la publicación. La [aceptación técnica local](2026-10-16-health-and-represented-booking.md) sigue siendo la evidencia de pruebas de la candidata; los resultados de este documento describen el corte remoto y no sustituyen aquellas pruebas.

## Fuente, repositorio y automatización

- Push de la rama de trabajo y de `main` completado en `bf76ee20da4407c4fa93919c43c4fbd91ecefc85`.
- El commit usa `[CF-Pages-Skip]`; no se atribuye a ese push un despliegue automático de Pages.
- En el panel del Worker, Builds mostraba la opción **Connect**: no había una fuente Git conectada observada para desplegar ese Worker mediante el push.
- Pages sí tenía fuente Git y despliegue automático configurados. Su publicación de este corte se ejecutó por separado.

El runtime de aplicación procede de `6315379b8c0482af57fea20abd8e2e1af0c00ff1`. Los cambios documentales posteriores no añaden comportamiento a esa imagen. Deben distinguirse commit Git, revisión Worker, imagen de contenedor y despliegue Pages al comprobar qué está sirviendo producción.

## Imagen registrada

| Dato | Resultado ejecutado |
| --- | --- |
| Plataforma | Linux/amd64 |
| Etiqueta de registro | `health-6315379-platform` |
| Digest de registro | `sha256:a319ac8b2b8b4188746e0f00bcc41439b40fc5c807463ee6d798c5bedeaae90e` |
| Correspondencia con candidata local | RootFS y Config comprobados iguales a la imagen candidata `6315379`. |
| Ajuste de empaquetado | Reexportación sin attestations después de que el registro rechazara el índice OCI con `blob unknown`. No se cambió el código de aplicación para resolver ese rechazo. |

El nuevo digest identifica el manifiesto registrado de plataforma; no debe confundirse con el ID local histórico `sha256:d890c075238e3c5e0d8cdc10a6037625dba2b243a61143b583f54e40d62f8d25` del [manifiesto local](2026-10-16-health-and-represented-booking-release.json). El rechazo inicial quedó resuelto mediante el formato de publicación. La API directa de Containers fijó la versión 7 al digest registrado a las **04:44:31 UTC del 17 de octubre de 2026**; la lista de instancias anteriores quedó vacía. A las **04:45:04 UTC**, la instancia efectiva y el panel mostraban versión 7 y el digest `a319ac8b…`.

## Respaldo previo y restauración ensayada

El respaldo se conserva privadamente en la carpeta de este corte bajo `%LOCALAPPDATA%/SarinBot/production-release…`. No se incluyen aquí rutas de objetos privados, enlaces firmados, cuentas, correos o contenido de documentos.

| Elemento | Evidencia ejecutada |
| --- | --- |
| Exportación SQL | 48 documentos; revisión 33. |
| SHA-256 del SQL | `8657862be804b6edbb42a8837bb37034b2d092eefaa95dea20f182619487357a` |
| R2 | Un archivo, 23.434 bytes. |
| Restauración local del SQL | Integridad comprobada y hash de datos coincidente; 17 objetos de esquema y 33 commits observados. |

La restauración ensayada es local. No se afirma una restauración destructiva del entorno remoto ni que SQL/R2 respalden por sí solos identidades de Auth o secretos. Los datos respaldados no se incorporan al repositorio. Tras drenar y antes de la reapertura, la revisión SQL seguía en **33**, sin nuevas escrituras; se verificó que el respaldo final correspondía a ese estado.

## Revisiones remotas publicadas

| Componente | Revisión y estado observado |
| --- | --- |
| Worker de mantenimiento | `45068698-54fa-474c-9c79-763be6a97c76` |
| Worker con runtime candidato bajo mantenimiento | `f6cd66e8-1938-4dbe-90fb-1472c08ba5d7` |
| Worker de reapertura | `d5a704e7-5bc3-4484-bc58-3c3f334ee3a7`, publicado aproximadamente a las **04:44:49 UTC del 17 de octubre de 2026**. |
| Configuración efectiva tras reabrir | `SARIN_MAINTENANCE=false`; `PILOT_AI_BUDGET_ENFORCED=true`. |
| Secretos Worker | Se conservaron los 13 secretos existentes; no se copian valores al informe. |
| Pages | Despliegue `a461b670-5130-41e7-8c75-957f5439cfd7`, publicado en [a461b670.sarinbotsaas.pages.dev](https://a461b670.sarinbotsaas.pages.dev). |

Se reabrió con la compuerta monetaria activa. Hasta guardar la configuración global, la IA permanecía cerrada por configuración ausente. Después, la sesión superadministradora guardó los límites aprobados y leyó de vuelta el resultado desde la UI: **«Límites guardados. El consumo se conserva.»** La sección nueva aparecía activa, sin aviso de compuerta inactiva. No se reiniciaron períodos ni consumos para abrir.

## Comprobaciones remotas ejecutadas

| Comprobación | Resultado observado |
| --- | --- |
| Contenedor efectivo | Versión 7 con digest de plataforma `a319ac8b…`; instancias anteriores vacías antes de abrir. |
| Origen público | `/` respondió 200 y `/api/session` sin sesión respondió 401. |
| Oferta pública | 200, `Cache-Control: no-store`; prueba COP 5.000, diez citas y 700 respuestas; paquetes COP 20.000, 35.000 y 59.900. |
| Presupuesto general | Guardado y consultado desde UI: USD 0,50/día y USD 8/mes globales; valores predeterminados por negocio USD 0,10/día y USD 2/mes, con motivo de piloto. |
| Límites de tokens | Conservados: 20 millones/día y 300 millones/mes globales; 2 millones/día y 30 millones/mes por negocio. |
| Clasificación de los dos negocios de QA | Guardada y leída desde UI: servicios generales, menores deshabilitados, revisión 1; decisión basada en sus catálogos existentes. |
| Contadores históricos | Conservados; el negocio observado mostraba dos citas de diez y siete respuestas de 700. No se reiniciaron cupos ni consumo. |
| Proveedor | DeepSeek aparecía online con siete llamadas históricas; no se iniciaron chats ni nuevas llamadas al modelo en estas comprobaciones. |
| Funciones aplazadas | WhatsApp deshabilitado; marketplace oculto. |

Las pruebas anteriores no se presentan como una reserva nueva con IA, un canje productivo, una descarga productiva del kit QR ni una incorporación sanitaria real. Esos recorridos funcionales cuentan con aceptación local. Se comprobó también:

- Términos y privacidad: HTTP 200 con ALS Dev Studio como responsable; decisiones de términos y datos separadas y desmarcadas. No se aceptaron acuerdos por una persona real.
- Rutas de presupuesto, autorización específica y propuestas: HTTP 401 sin autenticación. El chat permanece deshabilitado mientras faltan los permisos; «Mis citas» sigue accesible.
- Invitaciones: botón «Generar código de 6 dígitos» visible; ninguna invitación productiva emitida en esta verificación.
- Lectura privada D1: presupuesto versión 1, `paused=false`; ambas clasificaciones revisión 1, `general`, menores deshabilitados. Revisión de aplicación 36 después de las tres operaciones administrativas, desde la revisión 33 del respaldo final.

Evidencia: [comprobaciones HTTP/UI y configuración](2026-10-16-production-commercial-pilot-release.json), [panel de presupuesto](assets/production-20261016/admin-budget.jpg), [precios vigentes](assets/production-20261016/landing-plans.jpg). Las capturas se inspeccionaron visualmente y no incluyen cuentas bancarias, credenciales ni datos de clientes.

## CI y cierre

Para `bf76ee20da4407c4fa93919c43c4fbd91ecefc85`, las comprobaciones de GitHub de Cloudflare, build, pruebas y reglas pasaron. El **recorrido completo** falló porque su harness no había incorporado las nuevas autorizaciones. La corrección focalizada se publicó en `4eed34f7ff6ba30573d381d675580a04b9987f9e`: el recorrido real local aprobó 117 comprobaciones con cuentas sintéticas y limpieza verificada; la regresión de limpieza aprobó 12/12. Se comprobó primero el rechazo 428 sin permisos y después la aceptación expresa mediante la API real. No se cambiaron los controles de autorización productivos. El mismo commit conserva `PILOT_AI_BUDGET_ENFORCED=true` en la configuración del repositorio; Worker 74/74, tipos y dry-run aprobados. [La ejecución CI 39003955233](https://github.com/andresleosan/SarinBotSAAS/actions/runs/39003955233) terminó **SUCCESS** a las 04:51:19 UTC: tres jobs aprobados, 888 pruebas de aplicación aprobadas/26 omitidas, 24 Firestore, 117 comprobaciones del recorrido con limpieza verificada y 74 Worker. Builds y auditoría aprobados. Las pruebas omitidas conservan sus condiciones opt-in; las 24 Firestore se ejecutaron en el job de emuladores.

- [x] Corregir el harness y repetir el recorrido completo; commit `4eed34f`, CI verde.
- [x] Incorporar la evidencia final de UI/API y sus límites: visualización de invitaciones y autorizaciones, consulta individual y controles de consumo; no se realizó un canje ni se aceptaron términos reales.
- [x] Publicar configuración y harness en `4eed34f` sobre `main` y la rama. El commit documental de esta aceptación usa `[skip ci]` y `[CF-Pages-Skip]`: solo añade evidencia de la CI ya aprobada y del corte, sin volver a desplegar ni cambiar el runtime `6315379`.
- [x] Comprobar después de abrir las ocho respuestas HTTP esperadas, ausencia de fallos visibles en los recorridos inspeccionados y conservación del consumo histórico, sin nuevas llamadas pagadas. La observación con clientes reales continúa durante el piloto.

Salud y reservas representadas permanecen sin incorporación real hasta la revisión de cada establecimiento descrita en el [procedimiento operativo](../product/2026-10-16-production-pilot-operation.md). No hay una compuerta global de clasificación: una política ausente conserva el chat general. Por eso el inventario y la clasificación explícita forman parte de la apertura, además de no emitir invitaciones ni aprobar incorporaciones sensibles pendientes.

## Reversión durante el corte

Si falla una comprobación, mantener o restablecer mantenimiento, drenar la cola y diagnosticar con la revisión e imagen efectivas. Aplicar el [runbook](../cloudflare-no-vps-runbook.md#activación-y-reversión), conservando políticas, constancias/retiradas, propuestas y cierre durable, citas, cupos y presupuestos. No borrar contratos nuevos para que una imagen antigua vuelva a arrancar ni restaurar un respaldo que reactive permisos o duplique operaciones. Este informe todavía no registra una reversión remota ejecutada.
