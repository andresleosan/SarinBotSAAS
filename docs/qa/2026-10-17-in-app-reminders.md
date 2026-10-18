# Recordatorios dentro de Sarin — QA antes de publicar

**Estado: implementación, revisión de código, aceptación local de navegador y limpieza de datos sintéticos completas; publicación pendiente.** Los procesos locales propios están cerrados y los seis puertos de QA libres; faltan empaquetado y despliegue. Este documento no acredita un despliegue. La base productiva sigue siendo Containers v18, runtime `97b65723ad35994c49f56f15a73367ba33a6eb3c`. El trabajo se realiza en `codex/in-app-reminders-20261017`, dentro del worktree `service-catalog`; no se modifica el paquete cerrado de v18.

El propietario aprobó un único aviso desde 24 horas antes, dentro de Mis citas, optativo por cuenta/negocio y con visto explícito persistente. También autorizó implementar, probar y publicar los incrementos. [Diseño aprobado](../superpowers/specs/2026-10-17-in-app-reminders-design.md) · [Plan](../superpowers/plans/2026-10-17-in-app-reminders.md).

## Comportamiento implementado

El servidor deriva cada aviso de la cita propia confirmada y futura. Preferencia y visto se guardan en colecciones privadas separadas; no modifican Appointment ni su fingerprint de reprogramación. La preferencia conserva referencias verificadas a los permisos de cuenta y negocio: retirar y volver a aceptar suspende el opt-in anterior hasta reactivarlo explícitamente. Desactivar sigue disponible sin permisos activos.

La interfaz muestra fecha/hora de Colombia y un resumen genérico. Consulta solo en primer plano, oculta datos al cambiar de ámbito y descarta respuestas tardías. «Ver cita» enfoca la tarjeta canónica respetando bloqueos. Un temporizador de redibujado retira el aviso al inicio sin hacer peticiones ni escrituras. No hay correo, SMS, WhatsApp, push, IA ni avisos con la app cerrada.

## Verificación automatizada observada

Los registros completos permanecen en el directorio privado/ignorado `qa/reports/`; no se incorporan exportaciones privadas a Git.

| Comprobación | Resultado observado | Evidencia |
| --- | --- | --- |
| Suite final de aplicación | 1.482 aprobadas, 27 omitidas; 145 archivos aprobados y 4 omitidos, 149 en total; salida 0 | `in-app-reminders-final-tests.log` |
| TypeScript | Aprobado, salida 0 | `in-app-reminders-typecheck-final.log` |
| Cloudflare: pruebas, tipos y dry-run | 76 pruebas aprobadas y dry-run terminado; salida 0 | `in-app-reminders-cloudflare.log` |
| Dependencias | «No known vulnerabilities found» | `in-app-reminders-audit.log` |
| Hook, componente e integración de recordatorios | 48 aprobadas en 3 archivos | `in-app-reminders-ui-report.md` |
| Backend, rutas, D1 y regresiones de permisos/reprogramación | 53 aprobadas en 5 archivos; incluyen 34 nuevas | `in-app-reminders-backend-report.md` |
| Reglas en emulador Firestore | 25 aprobadas en 2 archivos | `in-app-reminders-backend-report.md` |
| Exportación/eliminación privada | 10 aprobadas, incluidos D1 real y ámbito por cita | `tests/reminder-data-maintenance.test.ts` y ejecución registrada por el controlador |

Las cifras focalizadas se solapan con la suite general; no se suman como pruebas adicionales. Las 27 omitidas no se presentan como ejecutadas. El build de previsualización se reconstruyó con la corrección final y se utilizó para repetir la aceptación del caso de respuesta perdida. La imagen de publicación todavía requiere congelación, construcción y auditoría propias.

Cobertura relevante: UID/negocio ajenos, ventana inclusiva de 24 horas e inicio exclusivo, citas antiguas, revisión corrupta, revocación y nueva aceptación de permisos, CAS de preferencia, visto idempotente, A→B→A con revisión, conflictos de cancelación/reprogramación, pérdida de respuesta y journal. Los casos D1 usan dos conexiones locales y el manejador productivo de datos; GET no escribe y marcar visto conserva intacta una propuesta de cambio pendiente.

## D1, conservación y mantenimiento

La medición inicial detectó que 1.001 citas históricas elevaban una lectura de 17 a 1.018 filas. La migración aditiva `0002_appointment_reminder_window.sql` añade el índice de la consulta por cuenta/estado/tipo/inicio. La evidencia final local registra **16 filas leídas, 0 escritas y 16 sentencias**, tanto en el caso mínimo como con las 1.001 citas históricas. El ensayo de migración conserva todos los documentos y la revisión global. El índice puede permanecer durante una reversión de aplicación a v18; **todavía no se acredita su aplicación en producción**.

El [procedimiento privado de conservación](../reminder-data-lifecycle.md) cubre exportación, revisión, eliminación transaccional del inventario exacto y comprobación de ausencia para cita/cuenta/negocio, preservando vecinos. No hay TTL ni purga automática. Una revisión independiente detectó que D1 no admitía el filtro `appointmentId`; se corrigió y se observaron dos regresiones fallar antes y pasar después con D1 real.

La excepción de mantenimiento permite únicamente GET exacto `/api/session` con formato Bearer y conserva la autenticación real de Next/Firebase. Los casos de método, consulta, fragmento, ruta y cabecera inválidos siguen cerrados. La comprobación con sesión administrativa real durante mantenimiento es un paso de publicación pendiente; las pruebas de routing no sustituyen esa observación.

## Navegador sintético y limpieza

Entorno de loopback `http://127.0.0.1:3041`, Auth/Firestore emulados y negocio temporal. `in-app-reminders.browser.result.json` contiene **20 controles verdaderos**, `verified: true` y comprobación registrada en `2026-10-18T01:17:32.915Z`. Acredita:

- Preferencia inicialmente apagada, explicación de 24 horas y uso dentro de la app, sección mínima y ausencia de desbordamiento a 320 px.
- Error de lectura distinto del estado vacío; activación cuya respuesta se perdió después del éxito del servidor, recuperada mediante GET.
- Preferencia persistente tras recarga sin visto automático; «Ver cita» enfoca la tarjeta actual; visto explícito persistente y grupo plegable operable con teclado.
- Reprogramación de la misma cita de 14:00 a 15:00: el aviso usa el horario actual y vuelve a pendiente. Cancelarla retira el aviso.
- Desactivación mediante teclado, preferencia apagada tras recarga, escritorio de 1280 px sin desbordamiento y cierre de sesión que oculta los recordatorios privados.

Los registros `in-app-reminders.fixture.record-changed.log` y `in-app-reminders.fixture.record-cancelled.log` pasaron su verificación sin escrituras de comprobación. Registran **una cita sintética modificada, una cancelada, una propuesta creada y cero citas nuevas creadas por el navegador**, conservando Auth y permisos de cuenta compartidos. No hubo mutaciones de datos productivos.

La primera pérdida controlada de respuesta reveló un defecto visual: GET recuperaba la preferencia, pero quedaba el error rojo inglés «Failed to fetch». Se corrigió con pruebas RED/GREEN: mensajes de red en español y eliminación del error incierto de preferencia después de GET válido, sin repetir PATCH. Los errores de visto o rechazos definitivos de permisos se conservan. Tras reconstruir la previsualización, el navegador repitió la desactivación: el servidor respondió 200, se perdió deliberadamente esa respuesta, GET recuperó el estado apagado y desapareció el error obsoleto. Se observó **un solo PATCH**, mensaje temporal en español y persistencia después de recarga.

La limpieza terminó con salida 0 (`in-app-reminders.fixture.cleanup.log`): eliminó **17 documentos propios**, incluidos los 2 de recordatorios mediante el helper real de conservación y otros 15 del fixture. Verificó ausencia de recordatorios y preservó Auth/permisos de cuenta compartidos. El navegador restauró el viewport y cerró la pestaña local. Se cerraron exclusivamente los procesos propios y se comprobó que 3041, 8080, 9099, 4400, 4500 y 9150 están libres (`in-app-reminders-ports.json`).

### Capturas disponibles

Todas son del entorno sintético y muestran la sección relevante:

| Captura | Lo que permite comprobar |
| --- | --- |
| [Aviso pendiente, 320 px](2026-10-17-in-app-reminders-pending-320.png) | Sección Recordatorios, aviso genérico a las 14:00 y acciones explícitas. |
| [Desactivados después de recuperar la respuesta, 390 px](2026-10-17-in-app-reminders-disabled-final-390.png) | Estado apagado sin error obsoleto, opción de activación y foco visible de teclado. |
| [Escritorio, 1280 px](2026-10-17-in-app-reminders-desktop-1280.png) | Sección legible, preferencia apagada e Historial dentro del ancho disponible. |

Visto y cambio de horario a las 15:00 se acreditan mediante observación del DOM y registros del fixture; no se atribuyen a una captura que no los muestre. Los cambios de UID/negocio y respuestas tardías tienen cobertura automatizada; la observación final de cuenta en navegador fue cierre de sesión.

## Revisión independiente y límites

Los informes privados `in-app-reminders-backend-independent-review.md`, `in-app-reminders-ui-independent-review.md`, `in-app-reminders-maintenance-root-review.md` e `in-app-reminders-final-code-review.md` registran PASS de sus ámbitos. La revisión integral incluye el ajuste posterior del error de preferencia y hashes exactos de los archivos revisados. Son revisión de código/evidencia, no certificación de publicación.

- La elegibilidad y las escrituras usan el reloj del servidor. La proyección canónica existente de Mis citas todavía usa el reloj local: un dispositivo muy adelantado puede ocultar un aviso o impedir su foco. No se promete tolerancia arbitraria a desfases del dispositivo.
- La medición con 1.001 citas históricas prueba la consulta estrecha del backend de recordatorios. La lectura existente de Mis citas sigue cargando el historial completo con su límite D1; no demuestra paginación ni soporte integral de interfaz por encima de ese límite. Si esa lectura falla, se muestra el error y se ocultan los avisos.
- Los sondeos independientes pueden ocultar brevemente una ocurrencia recién movida hasta coincidir. Cada escritura vuelve a validar el estado canónico.
- Un aviso requiere Sarin abierto y conexión; no equivale a una alarma externa.

## Cierre pendiente

- [x] Build de previsualización final, aceptación local de navegador, capturas correctas y limpieza verificada de datos propios.
- [x] Detención de procesos locales propios y comprobación de puertos libres.
- [ ] Fuente revisada congelada y publicada en Git, paquete nuevo, imagen inmutable, auditoría y smoke; v18 preservada.
- [ ] Respaldo privado D1/R2 verificado, escritores drenados, aplicación de 0002 y comprobación de documentos intactos.
- [ ] Sesión administrativa real durante mantenimiento, cola auténtica vacía, nueva instancia única y cero asignaciones anteriores antes de reabrir.
- [ ] Reapertura, comprobaciones HTTP/UI y cola autenticada; identificación de imagen, Worker, versión y asignación efectivas.
- [ ] Documentación final, evidencia sincronizada y conservación del acceso administrativo.

Imagen candidata, versión efectiva, Worker final, asignación y evidencias productivas: **pendientes**. No se asignan valores hasta ejecutar y comprobar esos pasos.
