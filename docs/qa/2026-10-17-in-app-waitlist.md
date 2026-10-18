# Lista de espera dentro de Sarin — aceptación

Estado: publicada en Containers v20 y verificada el 17 de octubre de 2026 a las 21:02 de Colombia (18 de octubre, 02:02 UTC). Suite integrada, revisión independiente, imagen y comprobaciones productivas aprobadas.

El propietario autorizó implementar, probar y publicar cada incremento y aprobó continuar con la lista de espera. [Diseño](../superpowers/specs/2026-10-17-in-app-waitlist-design.md) · [Plan](../superpowers/plans/2026-10-17-in-app-waitlist.md).

## Comportamiento

Una solicitud privada por cuenta y negocio, después de una consulta correcta sin horarios, conserva servicio, día de Colombia y profesional opcional. «Mis citas» permite comprobar disponibilidad y salir de la lista. «Elegir horario» inicia un caso nuevo del calendario con esa selección; no elige hora, crea propuesta ni confirma una cita automáticamente. Conserva los recorridos actuales de salud y menores sin copiar datos personales o permisos del caso anterior.

La solicitud permanece hasta retirarla o terminar el día elegido, incluso si se reserva una cita. Se comprueba al abrir la pantalla o actualizarla; no hay sondeo nuevo, mensajes externos, prioridad ni reserva exclusiva. Una retirada normal conserva revisión mínima para impedir reintentos antiguos. [Exportación y eliminación privadas](../waitlist-data-lifecycle.md).

## Datos, coste y compatibilidad

Colección privada `waitlistRequests`, un documento determinista por cuenta/negocio y anclas verificadas de permisos. GET no escribe; altas y retiradas usan revisión e identidad de operación. Cancelar no requiere negocio existente o permisos de nueva reserva. No se cambia Appointment, propuestas ni transacciones de citas.

La medición inicial detectó 28→1.029 filas leídas al añadir 1.001 citas históricas. La consulta de citas confirmadas del día ahora ordena por `dateKey`, que ya forma parte de su filtro exacto; usa el índice existente sin excluir documentos por un campo adicional ni truncar resultados. Medición final local: **30 filas leídas, 0 escritas y 28 sentencias**, con y sin ese historial. Corresponde al endpoint de espera, no al coste completo de Mis citas.

No hay migración SQL. 0001/0002 y el router de mantenimiento de v19 se conservan. El runtime v19 puede ignorar las nuevas solicitudes; la reversión conserva solicitudes y tombstones. No restaura datos antiguos ni elimina información.

## Navegador y limpieza

Loopback `http://127.0.0.1:3041`, Auth/Firestore emulados, cliente local y negocio único sintético. Resultado privado `in-app-waitlist.browser.result.json`: **21 controles verdaderos**. Se observaron alta tras vacío, persistencia al recargar, disponibilidad después de liberar el bloqueo propio, selección conservada con bookingRequestId nuevo, ausencia de selección automática de hora/propuesta, retirada persistente, teclado y anchos 320/390/1280 sin desbordamiento. La consola de la pestaña no registró errores.

El fixture sembró un bloqueo manual, liberó ese bloqueo y verificó cada transición sin escrituras de comprobación. No se crearon citas de cliente ni propuestas. La limpieza pasó con helper lifecycle real y verificó ausencia, preservando Auth, perfiles, permisos y admisión compartidos. Se cerró la pestaña local, restauró el viewport y detuvieron solo los procesos propios. Evidencia privada bajo `qa/reports/in-app-waitlist*`.

| Evidencia visual | Resultado |
| --- | --- |
| [Espera en móvil, 390 px](2026-10-17-in-app-waitlist-waiting-390.png) | Selección persistida, permanencia explícita y retirada con foco. |
| [Controles a 320 px](2026-10-17-in-app-waitlist-waiting-320.png) | Botones de 44 px y foco de teclado. |
| [Disponible en escritorio](2026-10-17-in-app-waitlist-available-1280.png) | Disponibilidad comprobada y continuación explícita. |
| [Retirada persistente](2026-10-17-in-app-waitlist-cancelled-390.png) | Solicitud ausente después de recargar. |

La revisión posterior al recorrido detectó identidad de admisión al reutilizar requestId, mensaje obsoleto tras POST503 recuperado con GET, y validación de profesionales activos al continuar con «Cualquiera disponible». Quedaron corregidos con regresiones RED/GREEN. La identidad de admisión incluye ahora la operación completa y su revisión; un reintento exacto sigue sin consumir otra admisión.

La revisión final encontró además que un ownerUid ausente o alterado podía ocultar el documento canónico en una exportación por cuenta. El helper ahora valida esa lectura puntual dentro de la transacción antes de consultar el inventario por propietario; tres regresiones exigen 503 y preservan datos. La prueba de continuidad también reproducía un desfase de 1 ms entre serverNow, createdAt y checkedAt: el fixture usa un único instante y conserva la validación estricta de producción. Estos cambios se verificaron con pruebas automatizadas posteriores; los 21 controles visuales y sus capturas corresponden al recorrido anterior y no se presentan como una repetición del navegador sobre los bordes corregidos.

## Pruebas y revisión

| Verificación | Resultado local observado |
| --- | --- |
| Suite completa de aplicación | **1.575 aprobadas, 28 omitidas**, 1.603 totales; 151 archivos aprobados y 4 omitidos; exit 0. |
| TypeScript | `tsc --noEmit`, exit 0. |
| Cloudflare | **76 aprobadas**, typecheck y dry-run aprobados. |
| Dependencias de producción | Sin vulnerabilidades conocidas en la auditoría ejecutada. |
| Reglas oficiales de Firestore | **26 aprobadas** en 2 archivos, con emulador aislado. |
| Ciclo privado final | **11 aprobadas**, incluyendo corrupción del propietario canónico y concurrencia D1. |
| Revisión independiente de UI | **109 aprobadas** en 5 archivos después de las correcciones. |
| Fixture de continuidad corregido | **24 aprobadas**; desfase temporal anterior reproducido y corregido sin relajar el DTO. |
| Navegador local | **21 controles observados** antes de las correcciones de revisión, con limpieza y viewport restaurado. |

Las verificaciones focales son subconjuntos o ejecuciones separadas; no se suman a la suite global. La primera ejecución global y los RED diagnósticos se conservan junto al resultado final. Revisión independiente final: **PASS, sin hallazgos P1/P2 pendientes**, con hashes de 25 archivos de runtime/pruebas y normalización explícita de CRLF a LF. La auditoría posterior del paquete contrastó también los bytes originales del archivo, la fuente y la imagen; esas comprobaciones se registran por separado.

## Publicación

Publicación completa en `https://sarinbotsaas.pages.dev`, con mantenimiento desactivado y una sola revisión Worker al 100 %.

| Identidad | Valor verificado |
| --- | --- |
| Runtime | `491ab526f8bb6c26d63f4fbc806bcb5a90b47cea` |
| Worker final | `61ebd3f8-4e6f-41d9-bd6e-fb9b8f0e849b` |
| Containers | v20, una instancia conectada y cero asignaciones antiguas |
| Imagen | `sha256:f601ca41a14244cb24a1e177921ec6923143c5211c58a1f66de375941b3c49d3` |
| Asignación efectiva | `d03d0d7d-9828-4364-8617-b881b1a65d60` |
| Archivo de fuente | `sha256:c1286483e85ca03ab7fe7606fa82519c296ec82b9861316b981cecf119ddb178` |

La auditoría independiente del paquete comprobó **763 archivos de fuente** y 107 directorios contra un archivo nuevo del commit, sin faltantes, extras ni bytes alterados. Build y smoke aislado aprobados; el contenedor se ejecutó por ID de imagen, sin red ni credenciales, como usuario no root y con filesystem de solo lectura. Se verificó su eliminación antes de registrar éxito. El build conserva el aviso conocido de `workerd postinstall` sobre validación de su binario; el mismo paso terminó en `Done`, y la construcción de la imagen y el smoke de Node finalizaron correctamente.

Se realizaron cuatro controles autenticados de cola, todos HTTP 200 con cero slots activos y cero solicitudes en espera: antes de mantenimiento (`default`), tras drenar (`engine`), después de comprobar la asignación efectiva v20 (`engine`) y tras reabrir (`default`). Hubo además un calentamiento auxiliar de la candidata, separado de esos cuatro controles. GET `/api/session` autenticado devolvió **200 con rol superadmin durante mantenimiento**, usando la excepción exacta conservada de v19.

La auditoría remota independiente confirmó la imagen y asignación reales, Durable Object conectado, instancia única, cero antiguas, 13 nombres de secretos preservados, bindings D1/R2, configuración, presupuesto, schedules y Pages sin cambios. HTTP público, manifest e iconos pasaron; las rutas privadas de espera, recordatorios y reprogramación rechazaron solicitudes anónimas con 401. Los marcadores de bundle se verificaron como evidencia de código servido, sin inferir visibilidad de controles.

En el navegador productivo se observó realmente el panel **«Lista de espera» en estado vacío** dentro de «Mis citas» de Sarin Pruebas. [Captura de producción](2026-10-17-in-app-waitlist-production.png). No aparecieron acciones de alta o continuación: esta cuenta no tiene solicitud y el negocio requiere permisos para una nueva reserva. El flujo completo se comprobó localmente con datos sintéticos; no se aceptaron consentimientos ni se crearon, retiraron o alteraron solicitudes, citas o datos de negocio reales para QA. La sesión administrativa se conservó y su autenticación se reverificó; viewport e interceptación de salud quedaron restaurados y la consola no registró errores.

No se aplicó migración SQL ni se restauró respaldo en esta entrega: los archivos 0001/0002 permanecen intactos. Base de reversión: runtime `ed28549402b2c93e88324f33f130ef6f56d6988d`, Containers v19, imagen `sha256:515440cfc7cb1ea7d2bb2e282cbe90cd6c5eb37dafc00859915b06598adc6afe`, Worker `50207852-3327-48d0-adb0-4417c454a3c3`. La reversión conserva solicitudes/tombstones e índices; v19 ignora las solicitudes nuevas, y volver a v20 revalida vencimiento, permisos y disponibilidad. No incluye restauración ni eliminación de datos.

Paquete privado nuevo: `%LOCALAPPDATA%/SarinBot/in-app-waitlist-release-20261017`, con `release-status.json` en `complete`, `source-record.json`, auditorías de fuente/paquete/remota, resultados HTTP/navegador, colas, sesión y resumen de publicación. El paquete anterior de v19 conserva **847 archivos** y la huella `b2556058af02559692455a45ac23a789a4646ae7c88e34d8886929a80f3412d4`, comprobados de nuevo después de construir y publicar.
