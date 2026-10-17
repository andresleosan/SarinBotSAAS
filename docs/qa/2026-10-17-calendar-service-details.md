# Detalles del servicio: aceptación local

Fecha: 17 de octubre de 2026. Estado: publicado y verificado después de autorización específica. Runtime `f47daf4955872bf007206413489b719e6787aa6c`, rama `codex/calendar-service-details-20261017`, basada en `4b0efb6` en el worktree existente del catálogo. El checkout original se conserva.

## Resultado

Elegir un servicio muestra categoría y descripción opcionales, duración y precio debajo del selector y antes del profesional. Los detalles se actualizan con la selección; el buffer no se suma a la duración y cero se muestra como `0 COP`. El bloque reutiliza los datos disponibles, sin peticiones ni estado nuevos.

[Diseño y alcance](../design/2026-10-17-calendar-service-details.md). [Protocolo repetible](../../qa/tests/calendar-service-details.md).

## Verificación ejecutada

| Comprobación | Resultado |
| --- | --- |
| RED inicial | Dos casos fallaron por ausencia del resumen antes de implementar el bloque. |
| Revisión independiente | Detectó `.trim()` sobre metadatos históricos sin normalizar. Dos regresiones fallaron por tipo incorrecto y longitud fuera de límite. Se reutilizó `serviceCatalogMetadata`; segunda revisión PASS. |
| `pnpm test -- tests/structured-booking.test.tsx` | **12/12 aprobadas**: texto literal, duración sin buffer, cero, metadatos ausentes/blancos/malformados/excesivos, cambio de servicio, limpieza de horario, identidad y bloqueos existentes. |
| `pnpm test` final | **960 aprobadas, 26 omitidas**, 115 archivos aprobados y cuatro omitidos. Los casos opt-in no se atribuyen como ejecutados. |
| `pnpm run typecheck` | Sin errores. |
| `pnpm audit --audit-level=high` | Sin vulnerabilidades conocidas. Dependencias y lockfile sin cambios. |
| Preview local compilada | Next 16.4.0, tipos y 12 páginas correctos; modo de prueba emulado con `--debug-prerender`, separado de la imagen de producción. Sin Next dev simultáneo. |
| Navegador CUA | **16 comprobaciones verdaderas**, cero errores de consola; 320×740, 390×844 y 1280×900. |
| Imagen de producción congelada | Linux/amd64, Next y TypeScript correctos; humo HTTP aislado aprobado, sin red ni credenciales. |
| Auditoría independiente del paquete | PASS: ZIP idéntico a `git archive`, 634 archivos coincidentes, configuración preservada, revisión e imagen verificadas; cero cambios de contratos. |
| `git diff --check` | Sin errores. |

La revisión de seguridad no encontró bloqueantes pendientes: se renderiza texto de React, se filtran los metadatos por tipo/límite con el helper vigente y no se añade HTML interpretado, API, secreto, integración o dependencia. El backend, hooks, esquema, reglas, disponibilidad, consentimiento y confirmación permanecen iguales al runtime publicado. La duración y el precio utilizan los campos obligatorios del catálogo existente.

## Navegador y límites de la evidencia

Auth y Firestore oficiales en loopback, proyecto `demo-sarin-bot`; Cliente local y negocio exclusivo `resumen-servicios-qa-dc2bdd0b`. Las autorizaciones de cuenta y negocio fueron constancias sintéticas del helper de pruebas. No se aceptaron acuerdos de cuentas reales ni se cambió su sesión.

Se comprobó ausencia inicial del bloque; servicio completo con 30 minutos, buffer de cinco y 25.000 COP; elección de hora; cambio al servicio gratuito con limpieza de profesional/hora/disponibilidad y propuesta deshabilitada; ausencia de párrafos vacíos; texto Unicode extenso con saltos y `<strong>` literal; orden anterior al profesional; ajuste sin desbordamiento; teclado y foco visible; detalle legible con selección congelada; teléfono existente en la propuesta; y reinicio con selección/resumen vacíos.

Se preparó una propuesta sintética sin confirmar ninguna cita. La observación CDP desde la primera consulta de disponibilidad hasta el reinicio mostró las API existentes de disponibilidad, permisos y propuesta, sin `/api/sarin/chat` ni `/api/sarin/health` y sin eventos truncados. Las pruebas de componente complementan la evidencia de identidad, restricciones de salud/menores y recuperación; esos escenarios no se atribuyen al navegador de esta corrida.

La fixture registra seis documentos propios y conserva las cuentas compartidas. Al existir una propuesta posterior, su limpieza por manifiesto se deja deliberadamente fuera: se terminó la sesión completa de emuladores efímeros sin exportación. Se cerró la pestaña local, se restauró el viewport y se comprobó que 3041/8080/9099/4400/4500/9150 quedaron libres. Se preservaron las pestañas reales de administración y cliente, sin cerrar sesión.

Capturas sintéticas inspeccionadas:

- [Servicio completo a 320 px](2026-10-17-service-details-320.png).
- [Servicio completo a 390 px](2026-10-17-service-details-390.png).
- [Descripción larga y HTML literal a 390 px](2026-10-17-service-details-long-390.png).
- [Escritorio](2026-10-17-service-details-desktop.png).

Reporte HTML ignorado: `qa/reports/2026-10-17-calendar-service-details.html`. Resultados CUA: `qa/reports/service-details.browser.result.json`. Helpers de emulación/fixture y logs quedan ignorados en `qa/reports/` y se copian al paquete privado para reproducibilidad.

## Artefacto y reversión

Paquete privado: `%LOCALAPPDATA%/SarinBot/calendar-service-details-release-20261017`. Archivo Git exacto de `f47daf4`, fuente extraída, SHA-256, configuración base, logs, resumen de QA y plan de publicación. Tag local `sarin-bot:calendar-service-details-20261017`, imagen `sha256:6b9dacd55f21fec481b0726fdde2dc4d6ce8874ee3bef6c8849fba9826b5abba`.

El humo aislado verificó portada, ayuda, privacidad, onboarding y ruta de negocio con HTTP 200; sesión y negocios protegidos con 401; manifiesto e iconos 192/512 idénticos; y el marcador `Detalles del servicio` en el bundle. Este humo estático no sustituye la prueba de datos realizada con los emuladores.

La base anterior y reversión compatible es `98629e1`, imagen `sha256:b6bc75f9f108e0f798dcb4f135e3cf281844060c2bd64e3181382b7cb785a39b`, Worker `08a0183f-997a-4b84-8c9a-803a78b47b3c`, Containers v11. No hay migraciones ni cambios de contratos. La reversión retira el nuevo bloque conservando citas y metadatos; debe mantener D1/R2, secretos, presupuesto activo y una sola instancia.

Antes de la autorización se congelaron el código y la imagen, se completaron las pruebas y se preparó la reversión sin modificar producción. El propietario respondió «Sí, publicar esta versión» a la pregunta específica de publicación del resumen en `sarinbotsaas.pages.dev`.

## Publicación y aceptación real

La imagen enviada al registro coincide con el digest local probado `6b9dacd5…`; el candidato se desplegó por digest fijo, sin reconstrucción. Wrangler 4.150.0 validó la configuración exacta mediante dry-run. La lectura independiente inicial confirmó la base v11, trece secretos, todos los bindings y variables, presupuesto activo y Pages sin cambios. Se renovó únicamente la autenticación habitual existente, sin ampliar permisos.

| Etapa | Resultado real |
| --- | --- |
| Mantenimiento sobre imagen anterior | Worker `48b96f0e-0d78-4aea-8b2e-5facbc7b851d`; HTTP 503 público y cola administrativa drenada. |
| Cambio de imagen con mantenimiento | Worker `3892d90d-134b-452b-a407-c7caee33be07`; app efectiva v12 verificada antes de reabrir. |
| Instancia efectiva | Allocation `d0333291-f1f6-4701-95a4-19fe19bb67a7`, running, Durable Object conectado, singleton `sarin-global-app`; una instancia y cero antiguas con paginación completa. |
| Reapertura | Worker `795cd3ac-670d-41d0-a026-3a954dc4e35f`, 100 %, mantenimiento desactivado; misma imagen y versión 12. |
| Cola autenticada | Antes, drenada, después del rollout y después de reabrir: HTTP 200; active/queued/critical/normal en cero, capacidad cuatro. La lectura final usó el diagnóstico estándar del proveedor activo. |
| HTTP y artefactos | Seis rutas públicas 200, sesión/negocios anónimos 401, perfil mínimo válido sin caché, iconos idénticos, marcadores de calendario/detalles/catálogo presentes en los bundles publicados. |
| Auditoría independiente final | PASS, 16:49:27 UTC: imagen exacta, max/configured=1, cero antiguas, trece secretos, bindings/variables, D1/R2, presupuesto y Pages conservados. |

El navegador real se recargó en el negocio de pruebas y conservó sesión, calendario seleccionado y «Mis citas». Los permisos de cuenta siguen vigentes y los del negocio siguen pendientes; calendario y chat permanecen deshabilitados y no se montan campos antes de esa decisión. No se aceptaron consentimientos, crearon citas ni editaron negocios reales para la comprobación. Por ese límite, el resumen completo se acredita con el bundle publicado y la prueba funcional aislada; no se afirma que se haya visto habilitado en esta cuenta de producción.

La captura real `service-details-live-390.png`, el estado de navegador y los informes HTTP, de cola y auditoría quedan en el paquete privado, fuera de Git. Viewport restaurado y pestañas de cliente/administración conservadas; no hay sesión pendiente de restaurar. Cierre del paquete: **16:50:32 UTC / 11:50:32 de Bogotá**.

La rama y su evidencia se enviaron a `origin`; no se atribuye un CI remoto al push de esta rama. La documentación posterior conserva el runtime congelado de la imagen. El paquete contiene `wrangler.rollback-rollout.json` y `wrangler.rollback-final.json` fijados a `b6bc75f9…`; una reversión debe repetir mantenimiento/drenaje, esperar la única instancia efectiva compatible y después reabrir, sin migraciones ni borrado de datos.
