# Volver a reservar: aceptación local

Fecha: 17 de octubre de 2026. Estado: aprobado localmente; publicación pendiente de autorización específica sobre el artefacto preparado. Rama `codex/rebook-from-history-20261017`, basada en `38cd5b8`, en el worktree existente del catálogo. El checkout original permanece intacto.

## Resultado

Historial ofrece «Volver a reservar» para citas propias cuyo servicio siga vigente. La acción abre un caso nuevo del calendario con los datos actuales del catálogo y lleva el foco a Nueva reserva. Solo transfiere el ID del servicio: no fecha, hora, profesional, precio, beneficiario, teléfono o respuestas anteriores. Elegir otro servicio e iniciar otra reserva conservan sus controles habituales.

Cuenta, negocio, política, lectura del catálogo y suscripción habilitan la acción. Operaciones en curso e incertidumbres la bloquean sin desmontar el recorrido recuperable. Los permisos de salud y menores se revisan de nuevo en cada caso. [Decisión](../design/2026-10-17-rebook-from-history.md) y [protocolo](../../qa/tests/rebook-from-history.md).

## Verificación

| Control | Evidencia |
| --- | --- |
| Base focal | 25 pruebas de entrada/calendario y 18 de Mis citas aprobadas antes de implementar. |
| TDD de Mis citas | 18 fallos y cuatro caracterizaciones aprobadas antes del botón; GREEN después de implementarlo. |
| TDD de integración | 14 fallos iniciales por callback/guards ausentes; GREEN tras conectar el calendario. Dos regresiones adicionales cubren catálogo ilegible y recuperación estructurada incierta. |
| StrictMode | La revisión independiente reprodujo un handler obsoleto tras desmontaje. Dos pruebas nuevas fallaron; restaurar la identidad al configurar el efecto corrigió el guard. Reproducción independiente final: acción vigente 1, callbacks obsoletos 0 tras remontaje y desmontaje. |
| Pruebas finales | `pnpm test`: **1.026 aprobadas, 26 omitidas**, 118 archivos aprobados y cuatro omitidos. No se atribuyen las opt-in como ejecutadas. |
| Tipos | `pnpm run typecheck`: exit 0 tras la compilación y restauración del archivo generado de Next. |
| Dependencias | `pnpm audit --audit-level=high`: sin vulnerabilidades conocidas; lockfile y dependencias sin cambios. |
| Revisión independiente | PASS después del arreglo StrictMode. No quedan bloqueantes en identidad, recuperación, permisos, selección o consumo. |
| Navegador | CUA: **32 comprobaciones verdaderas**, 320×740, 390×844 y 1280×900; sin errores de consola. |
| Preview compilada | Build y TypeScript correctos, 12 páginas generadas; `--debug-prerender` solo para QA emulada, sin Next dev simultáneo. No se usa como imagen de producción. |
| Imagen de producción | Build normal correcto; humo aislado sin red/credenciales aprobado. El intento previo offline falló al obtener pnpm sin caché y se conserva como tal. |
| Auditoría independiente del paquete | PASS: 657 archivos idénticos al archivo Git, baseline y migración preservados; imagen Linux/amd64, label y evidencia de humo correctos. |
| Diff | `git diff --check`: sin errores. |

La revisión de seguridad se limitó a las dos superficies modificadas: página de negocio y Mis citas. No se añadieron endpoints, integraciones o persistencia. La nueva acción revalida registro, catálogo, UID/negocio y estado de permisos/bloqueos al pulsar, incluso si el callback quedó retenido. El calendario mantiene confirmación explícita y recuperación con su cuerpo original. No hay cambios de inferencia, esquema, migraciones, reglas, proveedor, dependencias o cuotas. Por ser un incremento pequeño no se atribuye una campaña nueva de rendimiento.

## Navegador y límites

Auth y Firestore oficiales en loopback, proyecto `demo-sarin-bot`, negocio único `volver-reservar-qa-0a344cd0` (`b_70a6a2fef06443cb0f3a31f98e2b57cf`). Se reutilizó la cuenta local sintética y el helper creó permisos de prueba, tres citas históricas propias y una futura confirmada. El servicio gratuito pasó de nombre/precio/duración históricos a los actuales 0 COP/15 minutos; el otro pasó a 42.000 COP/40 minutos. Una tercera cita usa un servicio retirado.

Se comprobaron Próximas con sus botones existentes, las dos acciones de Historial, omisión del servicio retirado, etiquetas accesibles y foco visible de teclado. Enter abrió el calendario nuevo y movió el foco. El servicio vigente, precio cero, duración, profesional vacío y día actual se verificaron sin heredar el beneficiario sintético de la cita anterior. No se montaron su contacto ni respuestas. Los cambios manuales sobrevivieron a una lectura de fondo después de 21 segundos. Otra reserva dejó el servicio vacío; repetir la acción abrió nuevos casos y mostró los metadatos actuales. La consulta explícita del día cerrado devolvió el aviso existente, que desapareció al abrir otro caso.

La observación de red registró lecturas de perfil, permisos, política, citas y autorización del caso, más **un único POST de disponibilidad pulsado manualmente**. No hubo solicitudes de chat/diagnóstico de inferencia, propuestas o confirmaciones; la lectura de eventos no estaba truncada. Se observaron cinco casos diferentes. No se crearon propuestas ni citas desde el navegador; las cuatro citas del fixture se distinguen de una reserva real.

Suspensión, permisos pendientes, errores, cambios de identidad, StrictMode, operaciones de chat y confirmación incierta y salud/menores se cubren con pruebas de componentes/integración. No se atribuyen a esta corrida del navegador.

El cleanup validó fingerprints y eliminó exactamente **10 documentos propios**, incluidas las cuatro citas, conservando Auth y el permiso compartido de cuenta. Se cerró la pestaña local, se restauró viewport y se detuvieron solo los procesos propios; 3041/8080/9099/4400/4500/9150 quedaron libres. No se aceptaron decisiones reales ni se modificó producción. Se localizaron las pestañas reales actuales; su DOM administrativo agotó el tiempo de lectura, por lo que no se atribuye una nueva verificación de autenticación en esta corrida.

Capturas sintéticas inspeccionadas:

- [Historial y foco a 320 px](2026-10-17-rebooking-history-320.jpg).
- [Servicio gratuito actual a 320 px](2026-10-17-rebooking-selected-320.jpg).
- [Datos vigentes a 390 px](2026-10-17-rebooking-current-390.jpg).
- [Calendario en escritorio](2026-10-17-rebooking-desktop.jpg).

JSON CUA y logs permanecen en `qa/reports/`, ignorados por Git; se copian al paquete privado junto con el reporte HTML autocontenido.

## Artefacto para publicación

Runtime congelado `0b3bf0558b48ded61f9869374bee75c80d29d22a`. El archivo Git tiene SHA-256 `da2fbb1971712c88f39fef4ae207ea4f85043f664b268eeaf0ffb3f9ca1d9ee1`; una auditoría independiente comparó sus **657 archivos** con un archivo Git fresco y con la fuente extraída, sin diferencias ni archivos adicionales. Configuración base, bindings, variables y migración se conservan; solo se adaptan rutas locales del paquete.

Imagen local Linux/amd64 `sarin-bot:rebooking-20261017`, digest `sha256:d75c6c8e217de30ca2adde03a324ec56058be7306bda83e4cbcec0647b1e33bc`, con label de la revisión congelada. La construcción normal de producción pasó. El intento inicial sin red no tenía en caché la capa de pnpm y falló con `EAI_AGAIN registry.npmjs.org`; se conservó su log y se repitió con el registro oficial y versiones fijadas, sin credenciales montadas ni cambios de fuente. El lockfile permanece intacto.

El humo de la imagen final se ejecutó **sin red, en solo lectura y sin credenciales**: cinco páginas 200, APIs protegidas 401, manifiesto e iconos originales idénticos, y marcadores de calendario, detalles, entrada por servicio, disponibilidad vacía y «Volver a reservar». Es una comprobación estática del runtime; el recorrido funcional con datos se acredita con la prueba emulada anterior.

Paquete privado `%LOCALAPPDATA%/SarinBot/rebooking-release-20261017`: archivo y fuente congelados, configuración base, imagen identificada, logs de ambas construcciones, pruebas, fixture limpiado, capturas, aceptación y plan de publicación/reversión. No se ha enviado la imagen al registro ni cambiado producción. La aprobación específica debe cubrir este artefacto y preceder al mantenimiento, drenaje, sustitución de la única instancia, verificación efectiva y reapertura.

## Reversión

Base compatible: runtime `2440af53a7331f9e44a4a7324e798267e72cb912`, imagen `sha256:3c8e555db893889c444335de9d35a18041d8620ba3bda3e85d68c9fcee5aacd6`, Worker `bb969dc5-7062-46a0-9da4-34a08009f236`, Containers v13. Se preservan datos y contratos; volver al frontend anterior retira esta comodidad y conserva lectura y cancelación de citas. No hay migraciones ni borrado de datos.
