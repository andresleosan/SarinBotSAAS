# Reserva por servicio y disponibilidad vacía: publicado

Fecha: 17 de octubre de 2026. Estado: publicado después de autorización específica del propietario. Runtime publicado `2440af53a7331f9e44a4a7324e798267e72cb912`, rama `codex/booking-selection-and-availability-20261017`, basada en `8ca4770` en el worktree existente del catálogo. El checkout mixto original permanece intacto.

## Resultado

La ficha pública permite «Reservar este servicio» y conserva el ID elegido a través del acceso y los permisos hasta inicializar el calendario. El servicio y su resumen están seleccionados; profesional y hora siguen vacíos. No se consulta disponibilidad ni se prepara o confirma una cita automáticamente. La selección genérica mantiene el servicio vacío y, en pausa, se conserva «Ver mis citas» sin botones individuales.

Una consulta correcta sin horarios muestra una sola indicación para cambiar día o profesional. Estado inicial, carga y error se distinguen de una respuesta vacía. Cambiar selección limpia el aviso y descarta respuestas tardías.

[Diseño y referencia de Fresha](../design/2026-10-17-booking-service-entry.md). [Protocolo repetible](../../qa/tests/booking-service-entry.md).

## Verificación ejecutada

| Comprobación | Resultado |
| --- | --- |
| RED/GREEN de disponibilidad | Seis fallos iniciales por estado/aviso ausentes; éxito vacío, carga/error, selección y respuestas tardías cubiertos. |
| RED/GREEN de servicio inicial | Cinco fallos por seed ausente y tres al volver al ámbito anterior; se inicializa una vez, se valida el catálogo y no se restituye tras cambios o nuevos casos. |
| RED/GREEN del recorrido completo | Dos fallos por pérdida del servicio después del acceso; además, un fallo probado al sustituir business.id manteniendo el slug. Aislamiento y consumo único corregidos y verificados. |
| Revisión independiente final | PASS. Único ajuste de accesibilidad: el nombre accesible incluye ahora el texto visible «Reservar este servicio» y el nombre del servicio. Dos regresiones RED/GREEN antes del cambio de etiqueta. |
| `pnpm test` final | **986 aprobadas, 26 omitidas**, 116 archivos aprobados y cuatro omitidos. Las pruebas opt-in no se atribuyen como ejecutadas. |
| `pnpm run typecheck` | Sin errores después del código final y de restaurar el archivo generado de Next. |
| `pnpm audit --audit-level=high` | Sin vulnerabilidades conocidas. Lockfile y dependencias sin cambios. |
| Preview final compilada | Next 16.4.0, TypeScript y 12 páginas correctos; solo QA emulado con `--debug-prerender`, sin Next dev simultáneo. |
| Navegador CUA | **29 comprobaciones verdaderas**, 320×740, 390×844 y 1280×900; sin errores de consola desde la recarga de la compilación final. |
| Imagen congelada de producción | Linux/amd64, build correcto y humo estático sin red ni credenciales aprobado. |
| Auditoría independiente del paquete | PASS: ZIP byte idéntico a `git archive`, 647 archivos extraídos coincidentes y sin extras; baseline, imagen, label, plataforma y humo verificados. |
| `git diff --check` | Sin errores. |

La revisión de seguridad conserva permisos de cuenta, negocio y caso, aislamiento por UID/negocio/destinatario, confirmación explícita y recuperación incierta. La intención pública solo contiene un ID de servicio en memoria, se limita a la primera cuenta que accede, se valida contra el catálogo autenticado actual y se descarta al salir o cambiar de ámbito. No hay cambios en API, servidor, esquema, reglas, almacenamiento, dependencia, proveedor o inferencia. El único hook modificado es el controlador cliente del calendario.

## Navegador y límites

Entorno `demo-sarin-bot`, Auth/Firestore oficiales en loopback y Cliente local. Negocio exclusivo `reservar-servicio-qa-790daf71`, con hoy 17 de octubre cerrado y mañana 18 abierto; catálogo completo, gratuito y texto Unicode largo, dos profesionales. Los permisos sintéticos previos fueron creados por el helper de pruebas, sin decisiones de personas reales.

Se verificaron los tres botones individuales, nombre accesible y foco de teclado; entrada con el servicio gratuito y resumen `0 COP`; profesional/hora vacíos; ausencia de aviso inicial y de solicitudes automáticas de disponibilidad/reserva; consulta del día cerrado con un solo estado vacío; limpieza al cambiar profesional o fecha; entrada nativa de mañana con horarios desde 09:00; cambio manual de servicio que permanece tras lecturas de fondo; nueva reserva vacía; salida y nueva entrada genérica sin arrastrar ID; texto largo literal, sin interpretar HTML; y ajuste sin desbordamiento horizontal. Tras corregir la etiqueta accesible se recompiló, recargó y repitió la preselección y la consulta vacía con el código final.

La observación de red registró únicamente las lecturas existentes de sesión, permisos, perfil, política y citas, más disponibilidad al pulsar su botón. No hubo solicitudes de chat, diagnóstico de inferencia, propuestas ni confirmaciones; los eventos no estaban truncados. No se crearon citas o propuestas. Identidad, permisos pendientes, salud/menores, catálogo retirado, carga/error y carreras de respuestas se complementan con pruebas de componentes/hooks; no se atribuyen al navegador de esta corrida.

El helper limpió exactamente **seis documentos propios** con validación de manifiesto, preservando Auth y los permisos compartidos de cuenta. Se cerró la pestaña local, se restauró viewport, se detuvieron solo los procesos propios y se verificaron libres 3041/8080/9099/4400/4500/9150. Las pestañas reales de cliente y administración se conservaron sin cerrar sesión ni modificar producción.

Capturas sintéticas inspeccionadas:

- [Botones de servicio a 320 px](2026-10-17-booking-entry-profile-320.png).
- [Servicio elegido después del acceso a 390 px](2026-10-17-booking-entry-selected-390.png).
- [Aviso sin horarios a 390 px](2026-10-17-booking-entry-empty-390.png).
- [Calendario a 320 px](2026-10-17-booking-entry-calendar-320.png).
- [Ficha de escritorio](2026-10-17-booking-entry-desktop.png).

Reporte HTML ignorado: `qa/reports/2026-10-17-booking-service-entry.html`. Datos CUA: `qa/reports/booking-entry.browser.result.json`. Fixture, manifiesto y logs permanecen ignorados y se copian al paquete privado para reproducibilidad.

## Artefacto y reversión

Paquete privado `%LOCALAPPDATA%/SarinBot/booking-entry-release-20261017`: archivo Git exacto de `2440af5`, fuente extraída, SHA-256, configuración base, logs, QA y plan. Tag local `sarin-bot:booking-entry-20261017`; imagen `sha256:3c8e555db893889c444335de9d35a18041d8620ba3bda3e85d68c9fcee5aacd6`.

El humo aislado comprobó cinco páginas HTTP 200, sesión/negocios protegidos 401, manifiesto e iconos 192/512 idénticos, calendario/detalles existentes y nuevos marcadores de botón, disponibilidad y mensaje vacío. Es una comprobación estática del runtime; el recorrido con datos se probó por separado con los emuladores.

Reversión compatible al runtime publicado `f47daf4`, imagen `sha256:6b9dacd55f21fec481b0726fdde2dc4d6ce8874ee3bef6c8849fba9826b5abba`, Worker `795cd3ac-670d-41d0-a026-3a954dc4e35f`, Containers v12. No hay migraciones ni contratos nuevos; conserva lectura y cancelación de citas guardadas. Volver al frontend anterior retira las dos mejoras y conserva datos y metadatos. La selección y propuestas del navegador siguen siendo estados en memoria que una navegación no restituye por sí sola.

Publicación completada con autorización específica del propietario, Worker `bb969dc5-7062-46a0-9da4-34a08009f236`, Containers v13 e imagen `sha256:3c8e555db893889c444335de9d35a18041d8620ba3bda3e85d68c9fcee5aacd6`. Una instancia conectada y cero antiguas; mantenimiento desactivado, presupuesto y configuración conservados. La comprobación real mantuvo el permiso del negocio pendiente: no se atribuye UI nueva visible ni una reserva real. Los detalles y resultados se registran a continuación.

## Publicación verificada

Cierre efectivo: `2026-10-17T18:02:19.081Z` (13:02 de Bogotá). El propietario autorizó expresamente «Sí, publicar ambas mejoras». La imagen enviada al registro y el runtime desplegado corresponden al archivo Git `2440af53a7331f9e44a4a7324e798267e72cb912`; el digest del registro se verificó después del push. El paquete privado conserva las lecturas y los controles independientes utilizados para este cierre.

Se activó mantenimiento sobre la imagen anterior con Worker `67bf9f98-f592-4abd-a1a0-c2973f7603fa` y se verificó HTTP 503 público. El rollout inmediato con Worker `909fecde-053b-42a8-a807-9ba1a38c311f` mantuvo ese estado hasta confirmar la imagen efectiva y su única instancia conectada. Después se reabrió con el Worker final de la tabla, sin repetir el rollout. Wrangler 4.150.0 validó primero la configuración exacta mediante dry-run; no se ampliaron permisos de la autenticación habitual.

| Elemento | Evidencia real |
| --- | --- |
| Worker efectivo | `bb969dc5-7062-46a0-9da4-34a08009f236`, 100 % del tráfico; mantenimiento desactivado. |
| Containers | v13; 1 instancia, 0 asignaciones antiguas; paginación completa. |
| Asignación | `d03e5404-e96a-4885-ba0d-1b31f985861f`, `running` / `connected`. |
| Imagen publicada | `sha256:3c8e555db893889c444335de9d35a18041d8620ba3bda3e85d68c9fcee5aacd6`. |
| Configuración | Bindings D1/R2, variables y nombres de 13 secretos conservados; presupuesto activo; sin migraciones. |
| Auditoría independiente | SHA-256 `30dd7c85f899af17caf2c13f8670d069028ec14f32db12b39a81bee85ec08d9c` y 647 archivos coincidentes; baseline, imagen y humo verificados. |

Las cuatro lecturas autenticadas de cola devolvieron HTTP 200 y todos los contadores en cero. En mantenimiento se consultó el ámbito del motor; antes y después se usó el ámbito predeterminado.

| Momento | Ámbito | HTTP | Activas / en cola / críticas / normales |
| --- | --- | --- | --- |
| Antes del mantenimiento | `default` | 200 | 0 / 0 / 0 / 0 |
| Drenaje en mantenimiento | `engine` | 200 | 0 / 0 / 0 / 0 |
| Después de sustituir la instancia | `engine` | 200 | 0 / 0 / 0 / 0 |
| Después de reabrir | `default` | 200 | 0 / 0 / 0 / 0 |

| Ruta HTTP comprobada | Estado |
| --- | --- |
| `/` | 200 |
| `/ayuda` | 200 |
| `/privacidad` | 200 |
| `/b/sarin-pruebas-20261015` | 200 |
| `/dashboard/onboarding` | 200 |
| `/manifest.webmanifest` | 200 |
| `/api/session` | 401 |
| `/api/businesses` | 401 |

El perfil público devolvió HTTP 200, con allowlist de negocio y de su único servicio verificada. Los bundles enlazados por la ficha de reserva conservan calendario y detalles e incluyen «Reservar este servicio», `availabilityStatus` y «Prueba otro»; onboarding conserva el marcador del catálogo. Es una verificación `bundle_only`: no acredita que esos controles se hayan visto en la UI real.

| Icono publicado | SHA-256 |
| --- | --- |
| `/brand/sarin-face-192.png` | `bec2324dd74f8d0dbc476b5b580c5b2eca65aff171426574706071a40724541e` |
| `/brand/sarin-face-512.png` | `bfe3c69878d4089d14076be0394acb67bc42fc879a0111e1bbfb855b70e85482` |

En el navegador real, el calendario estaba seleccionado, calendario/chat permanecieron bloqueados por el consentimiento pendiente del negocio y «Mis citas» era visible. Los campos estructurados y el chat no se montaron antes del permiso. **No se vieron en producción los botones individuales de servicio, los detalles ni el estado de disponibilidad vacía.** La UI completa se verificó localmente con los 29 controles del entorno emulado, descritos en la aceptación anterior.

No se aceptaron consentimientos reales, no se modificaron datos del negocio y no se crearon citas en producción. La sesión administrativa se preservó, el viewport se restauró y la intercepción de salud quedó retirada. Las lecturas HTTP y los marcadores del bundle se registran por separado de esta observación del navegador.

La reversión sigue siendo compatible con `f47daf4955872bf007206413489b719e6787aa6c`, imagen `sha256:6b9dacd55f21fec481b0726fdde2dc4d6ce8874ee3bef6c8849fba9826b5abba`, Worker `795cd3ac-670d-41d0-a026-3a954dc4e35f` y Containers v12. No requiere migraciones ni eliminación de datos; conserva citas y metadatos.

El paquete conserva `wrangler.rollback-rollout.json` y `wrangler.rollback-final.json` fijados a esa imagen. Para revertir se repite mantenimiento y drenaje, se espera la única instancia compatible y se reabre. La captura real `booking-entry-live.png` y las lecturas de producción quedan fuera de Git. La rama y la evidencia se enviaron a `origin`; no se atribuye un CI remoto a este push y los cambios posteriores son solo documentación.
