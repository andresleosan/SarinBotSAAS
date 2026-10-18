# Lista de espera dentro de Sarin — aceptación

Estado: implementada, suite integrada y revisión independiente aprobadas en local. Artefacto y publicación pendientes; todavía no publicada.

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

Las verificaciones focales son subconjuntos o ejecuciones separadas; no se suman a la suite global. La primera ejecución global y los RED diagnósticos se conservan junto al resultado final. Revisión independiente final: **PASS, sin hallazgos P1/P2 pendientes**, con hashes de 25 archivos de runtime/pruebas y normalización explícita de CRLF a LF. Antes de publicar, la auditoría de fuente congelada debe contrastar también los bytes originales del archivo y la imagen; esta revisión local no sustituye esas comprobaciones.

## Publicación

Pendiente. Base inmutable: runtime `ed28549`, Containers v19, imagen `515440cf…`, Worker `50207852-3327-48d0-adb0-4417c454a3c3`. Paquete anterior: 847 archivos, huella `b2556058af02559692455a45ac23a789a4646ae7c88e34d8886929a80f3412d4`. No se modificó. La publicación conservará instancia única, configuración, secretos, presupuesto y Pages, con comprobaciones de cola y sesión reales.
