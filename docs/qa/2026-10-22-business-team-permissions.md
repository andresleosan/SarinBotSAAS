# S13: equipo y agenda asignada, aceptación local de fase 1

Documento histórico del plan del 22 de octubre. Ejecución: 25 de octubre de 2026 en Colombia / 26 de octubre UTC. Fuente aislada: rama `codex/business-team-permissions-20261025`, base compuesta `c79480755bf2e067c80ae6e07c21936b661482be`, código verificado `8ebd1705b75eb7f6e9feb3616de112fdcc138459`. [Diseño](../superpowers/specs/2026-10-22-business-team-permissions-design.md), [plan](../superpowers/plans/2026-10-22-business-team-permissions.md) y [protocolo reproducible](../../qa/tests/business-team-permissions.md).

**Documentación finalizada con reservas; aceptación Task6 incompleta: gate nativo pendiente.** Tipos, build, suite integrada y HTTP local finales aceptados, junto con reutilización verificada del Worker. El recorrido nativo se detuvo por la confianza insuficiente de la herramienta para determinar la URL del navegador en Windows. No acredita producción, merge, despliegue, migración remota ni activación. El gate de producto permanece false por defecto. Solo fase 1: solicitud interna, aprobación/rechazo, revocación/salida y lectura mínima del recurso asignado con rol cerrado `own_agenda_viewer` versión 1. Una UI visible no acredita permiso efectivo.

## Procedencia y gates finales

Workspace: `C:/Users/Drean Skate/AppData/Local/SarinBot/fresha-p2-20261023/source`. Evidencia privada/sintética externa: `../work/`; diario y revisiones: `.superpowers/sdd/2026-10-22-business-team-permissions/` (ignorado, conservado). No se copiaron exports, tokens ni datos reales a Git. Node `24.22.0`, pnpm cacheado `11.23.0`, TypeScript `5.9.3`, Next `16.4.1`, Vitest `5.0.4`. Lock SHA256 conservado: `f035b6bd0ddb862b899be3e15ec8115cf0a47ac508f8d1e644899aa902e12358`.

Los tres comandos de app usan `node ../work/s13-validate.mjs <modo> <etiqueta>`: entorno aislado demo, Node24 y versión pnpm comprobada, sin instalación ni cambio de dependencias. El runner invoca herramientas instaladas directamente. Estos resultados no se describen como wrappers pnpm ejecutados con éxito.

| Gate | Resultado observado | Recibo bajo `../work/s13-validation/` |
| --- | --- | --- |
| `types task6-final-types` → `node node_modules/typescript/bin/tsc --noEmit` | exit 0, 3.869 s | `2026-10-26T02-01-34-280Z-task6-final-types-bcdca6/result.json` |
| `build task6-final-build` → `node node_modules/next/dist/bin/next build` | exit 0, 34.940 s; compilación, TypeScript y 20 páginas estáticas; rutas de equipo incluidas | `2026-10-26T02-01-43-956Z-task6-final-build-74bbf6/result.json` |
| `suite task6-final-suite` → Vitest completo, `--configLoader runner --maxWorkers 1` | exit 0; 4731 pasadas/70 omitidas/0 fallidas; 305 archivos pasados/6 omitidos; 608.553 s de runner | `2026-10-26T02-02-37-693Z-task6-final-suite-57c670/result.json` |
| `node ../work/s13-controller.mjs worker` | 51 entradas de inventario y SHA256 idénticas; lock y binding sin cambios. No repite checks | Diario: `worker-acceptance-reuse-2026-10-26T02-02-21-031Z.json` |

El build final terminó antes del servidor de QA. No reconstruir `.next` durante la sesión dev. Cada recibo conserva ejecutable/argumentos, versiones, timestamps, duración, exit code y ruta de `output.log`; Vitest añade `vitest.json`.

La suite integrada se ejecutó una sola vez, de `02:02:38.074Z` a `02:12:46.627Z`; Vitest reporta 607.97 s internos. Las 70 omitidas se distribuyen así: team Firestore9, Firestore integración22, reglas16, waitlist Firestore21, journey local1 y proveedor live1. No se contactó el proveedor live. El total JSON de 529 suites internas no equivale al número de archivos; se usa el resumen CLI de 311 archivos. No se suman otra vez los casos focalizados ya incluidos.

## Cobertura aceptada de almacenamiento y autorización

Task4 ejecutó D1 real local, con dos handles sobre un runtime por caso, y 9 casos reales Admin/SDK del emulador oficial Firestore. El run de app normal omite estos 9 si no existe `FIRESTORE_EMULATOR_HOST`; no sumarlos como ejecutados por esa suite. La aceptación dedicada está en `../work/s13-team-qa-runs/2026-10-26T01-11-08-551Z-681740/` (`vitest.json`, `rules-result.json`, provenance, log emulador y preflight Java21). Solo se seleccionó el archivo nuevo `tests/business-team-firestore.test.ts`: el texto heredado del launcher `exact-source-firestore-runner` no representa una repetición de los 59 casos legacy. Esos casos permanecen aceptados por CI53 y no se reabrieron.

Aceptación scoped Task4: 56/56 en `2026-10-26T01-10-02-665Z-task4-storage-green-7bf854/`. Después se corrigió únicamente el orden de disposición de runtimes en backup: caso existente 1 pasado/18 no seleccionados en `2026-10-26T01-20-42-437Z-task4-backup-lifecycle-fix-f8f22d/`. El run anterior sí solapó fuente y verificador; no se presenta como originalmente libre de solapamiento. La suite integrada final cubre ese código corregido.

| Lector real → SQL generado y EXPLAIN local D1 | Límite | Índice observado |
| --- | --- | --- |
| memberUid ordenado por businessId ASC | 21 | `app_team_member` |
| roster businessId/status | 31 | `app_team_business_status` |
| teamAccessEvents por sequence DESC, path ASC | 20 | `app_team_events_sequence` |

Los planes usan SEARCH, sin `SCAN app_documents` ni B-tree temporal. Con 1001 recibos sintéticos válidos devuelve secuencias 1001..982; 999 son carga histórica preparada, no 999 transiciones de dominio ejecutadas. Se usan SQL del generador real y EXPLAIN real, sin SQL sustituto. El control negativo quitó solo el índice del runtime de prueba: cayó al índice de expiry/sort temporal y la aserción falló, luego se restauró la migración aceptada. Logs y fallos están conservados en Task4.

Backup/reconciliación/importación real conserva 17 documentos sintéticos, incluidos 5 de membresía/estado/eventos y documentos de consentimiento/rate/política. Backup corregido: `../work/s13t/sarin-s13-team-backup-uecA5V/`, SQL SHA256 `7cdd985a31254713598b8a36111320e245884aed7ea688e4b6630dca9e7a9e11`. El runtime fuente termina antes del verificador y este antes del restore. Lecturas reales recuperan membresía revocada, estado y eventos. No es un respaldo de producción.

La migración `0011_business_team.sql` es aditiva y no reemplaza attendance/CRM. Dos índices compuestos Firestore nuevos se suman a los 14 anteriores. El emulador acredita comportamiento local; despliegue/validación de índices productivos sigue pendiente.

## Cinco Review Focus: qué evidencia responde a cada uno

| Review Focus del plan | Evidencia ejecutada y alcance |
| --- | --- |
| Solicitar no convierte en colaborador; UID/slug/recurso/rol alterados y superadmin no amplían acceso | Modelo/dominio/rutas estrictos; membresía real solicitada/aprobada; matriz de handlers reales con entradas válidas y aserción 403, sin 404 aceptado. Integración automatizada hook→GET→dominio con agenda positiva. HTTP local requested→agenda403, approved→200; cliente/otro dueño/superadmin permanecen denegados donde corresponde. Flujo nativo no observado. |
| Revocación, transferencia, clasificación o recurso inactivo con pestaña/token vigente; respuesta tardía no restaura | Carreras D1/Firestore, relectura con actor intacto y barreras de UI por UID/época/negocio/revisión. Firestore readOnly puede devolver snapshot histórico autorizado; la siguiente lectura deniega. HTTP local mismo JWT válido:200 antes/403 después de revocar. Pestaña y respuesta tardía nativas no observadas. |
| Dos aprobaciones, capacidad 30, counter perdido y respuesta de commit perdida | CAS real en D1/Admin; 29 aprobaciones reales antes de carrera por slot30; requested30; corrupción503; transport pierde respuesta después del commit D1, replay exacto sin duplicar estado/eventos. HTTP local descarta deliberadamente cuerpo tras headers200 y recupera recibo exacto; no es fallo de red observado. No reparación automática de counters. |
| Bloqueo con serviceName privado no filtra texto/contacto/menor/precio | Fixtures persistidos con marcadores; proyección exacta DTO en D1/Admin y tests de serialización; otro recurso excluido, 1000 filas→413. HTTP local 200/no-store con 3 filas mínimas y privateMarkers:false; visual nativa no observada. |
| Retiro con plan/consentimiento/gate pausado y replay después de revocar | Dominio/rutas/UI cubren relación propia/dueño y leave/reject/revoke disponibles; replay devuelve recibo histórico más estado actual revocado, sin reactivar. HTTP local conserva prueba original de aprobación y estado revocado, revisión 3/eventos 3/active 0. Caso gatefalse nativo no observado. |

La revisión independiente de Tasks1–5 está aceptada, incluido el addendum Task5. Task5 corrigió `dateKey` en URL a `date` mediante RED real 400→200 con datos asignados, y relojes deterministas 2030/2031/2032; 45 tests finales. Los anteriores 42/90 verdes no ejercían esa frontera y se conservan como históricos. La revisión independiente Task6 y de toda la rama corresponde al cierre posterior; este reporte no la sustituye.

## DTO y módulos existentes

La agenda solo devuelve negocio/recurso, fecha, checkedAt, membershipRevision y filas `{id,startAt,endAt,status,kind}`. No devuelve Appointment completo, `serviceName`, razón de bloqueo, cliente/contacto, beneficiario/menor, intake, precio ni auditoría. Las filas se rotulan Reserva/Tiempo bloqueado; no representan huecos disponibles. Actor viene del token revocation-aware, y cada lectura valida membresía/head/estado, dueño aprobador actual, rol1, recurso activo, clasificación general sin menores y consentimientos actuales de ambas cuentas. La lectura no exige plan activo. Solicitar/aprobar sí mantiene plan y consentimientos.

Los 33 casos HTTP de dueño más copiloto siguen 403 con miembro realmente activo, incluso si esa cuenta es SUPERADMIN_UID: business GET/POST, logo/QR, política cliente, resource schedules, bloqueos, attendance, representation review, CRM, FAQ, S17, team, cinco rutas owner-reschedule y espera/ofertas. Se preservan requireSuperadmin, assertOwner, claims, roles globales, BookingConfig y reglas SDK. Matriz separada deniega módulos de plataforma y pago ajeno, conservando la autoridad independiente de un administrador real. El colaborador como cliente sigue leyendo/cancelando solo su cita propia; la ajena permanece intacta.

SDK del colaborador activo deniega documento/query de membresía, eventos, cita ajena y query por recurso asignado, y escrituras forjadas. Admin API proyectado positivo precede esas pruebas. Exportación, cobros, informes, contactos y acciones de terceros no se conceden por membresía. Un 404 en una capacidad futura no acredita autorización; fases 2/3 requieren contratos y pruebas propios.

## QA nativa y sesiones

La sesión principal operó exclusivamente el navegador y el harness aislado puerto 3056, `demo-sarin-bot`, con cinco identidades sintéticas y cuatro citas con marcadores de privacidad. El recibo registra el motivo de detención CUA: “Computer Use has been stopped for this turn because it could not determine the current browser URL on Windows with enough confidence to enforce policy.” No se continuó con acciones UI ni automatización de navegador alternativa. Las dos pestañas locales iniciales permanecieron verificando sesión; solo se observó banner emulador y pantalla de carga, sin login ni mutación de producto en GUI. Se observaron recompilaciones dev/HMR, pero no se estableció su relación causal con esa pantalla ni un defecto de producto; no se afirma haberlo corregido.

**NO OBSERVADO:** flujo nativo dueño/colaborador, recuperación visual por respuesta retenida/perdida, respuesta tardía contra denegación en pestaña, DOM/foco, tamaños 320/390/1280, teclado, zoom nativo 200% y lector de pantalla. Ninguno se marca pasado por pruebas unitarias ni por HTTP. No hay captura nativa de aceptación publicada. El gate nativo sigue pendiente, y Task6 no puede cerrarse como aceptada completa.

La aceptación CLI/API terminó correctamente y acredita HTTP local, no aceptación nativa. Evidencia en ese mismo run:

| Observación HTTP local | Resultado | Recibo |
| --- | --- | --- |
| Cinco sesiones de identidades Auth distintas, verificación revocation-aware | 5 UID distintos; tokens solo en memoria | `http-sessions-1792980493751.json` |
| Solicitud interna real | requested, revisión 1, owner requested 1/active 0, agenda 403 | `api-team-request-observed.json` |
| Aprobación real, cuerpo descartado deliberadamente después de observar headers HTTP 200 | Un solo PATCH de aprobación; GET recupera requestId/hash/evento/revisiones exactos y evento ligado al objetivo, revisión 2/active 1 | `api-team-approval-recovered.json` |
| Agenda del colaborador aprobado | 200/no-store; recurso asignado, 3 filas: reserva confirmada, bloqueo y reserva cancelada; privateMarkers:false | `http-active-1792981428018.json` |
| Matriz HTTP de dueño/plataforma | team, resource-schedules, factual-faq-settings, operation-summary y admin 403/no-store; cliente sin membresía agenda 403, otro dueño y superadmin roster 403 | `http-active-1792981428018.json` |
| Revocación con el mismo JWT vigente | agenda 403/no-store, identityStillValid:true, relación revoked; huella idéntica antes/después | `http-revoked-1792981428745.json`, `http-complete-1792981428754.json` |
| Derechos independientes como cliente | 200 y solo su cita cancelada, antes y después de revocar | Recibos active/revoked anteriores |
| Prueba histórica después de revocar | prueba de aprobación original estable; teamRevision 3, 3 eventos, active 0/requested 0; solo 3 comandos: request/approve/revoke | `api-team-acceptance-result.json` y `api-team-acceptance-intent.json` |

El observador es de solo lectura de negocio y realizó 5 sign-ins de infraestructura Auth. El helper de mutación realizó 2 sign-ins adicionales: **7 sign-ins, 5 UID distintos**. Sus 3 comandos locales son explícitos; `apiMutations:false` del recibo del observador no describe al helper de mutaciones. No se persistieron JWT. Descartar el cuerpo tras HTTP 200 simula una respuesta no consumida: **no se observó fallo de red, barrera de incertidumbre ni recuperación GUI**. La prueba de transporte D1 con respuesta realmente suprimida pertenece a Task4 y conserva su alcance separado.

Snapshot final: `team-snapshot-1792981557422.json`, 1 membresía revocada, 3 eventos, 4 citas; `appointmentsAndBusinessUnchanged:true` compara hashes de **JSON canónico de negocio/citas**, no bytes binarios de la base. `team-demo-snapshot-1792981557579.json` conserva 33 documentos Firestore sintéticos en 67094 bytes fuera de Git. El harness propio se detuvo con exit 0; `receipt.json` registra state:stopped y el check posterior de la sesión principal verificó los 7 puertos libres a 02:29:15 UTC. La preservación externa verificó 760 archivos del checkout E:, ref, index y status idénticos al inicio (`../work/s13-session-2026-10-26T00-24-18-661Z/preservation-2026-10-26T02-29-15-131Z.json`). Main remoto se consultó solo en lectura y siguió en la base compuesta. No hubo publicación ni activación.

Run nativo iniciado: `../work/s13-team-qa-runs/2026-10-26T02-02-42-728Z-df5935/`. El primer seed falló al reportar el bulk Auth antes de escribir Firestore. Diagnóstico de solo lectura confirmó las cinco identidades sintéticas exactas ya creadas y ninguno de los 27 documentos previstos. Un helper de resume nuevo y congelado verificó identidad/pathset/timestamp original, evitó repetir Auth y creó atómicamente esos 27 documentos. Provenance, intento y diagnóstico se conservan; el helper original permanece sin editar, con manifiesto en `../work/s13-qa-helper-freeze-20261026T020139752Z/manifest.json`. Estado inicial verificado: cero membresías/eventos y cuatro citas, hashes de negocio/citas conservados. Es un incidente local de fixture, no un fallo de producto ni evidencia de aceptación del navegador.

El motivo exacto y alcance nativo pendiente se conservan en `native-gate-incomplete.json`. Hace falta un nuevo turno de Computer Use para completar esos escenarios; no se intentó un bypass o automatización UI alternativa tras la detención.

## Fallos conservados y límites

El wrapper literal cacheado `pnpm --filter sarin-cloudflare-host run check` falló antes de tests por intentar invocar un ejecutable pnpm install inexistente en su ruta de dependency-status. No instaló nada ni alteró lock/source. Recibo de fallo: `../work/s13-validation/2026-10-26T01-12-13-633Z-task4-worker-full-check/`. El equivalente nativo aceptado posterior ejecutó suite Worker 166/166, tipos y Wrangler dry-run, todos exit0: `../work/s13-validation/2026-10-26T01-12-54-186Z-task4-worker-full-check/`. El dry-run usó outdir externo único y `--containers-rollout=none`, sin publicar, y mostró `SARIN_TEAM_ACCESS_ENABLED=false`. La comparación final de 51 entradas autoriza reutilizar esos resultados sin repetirlos; no vuelve verde el wrapper fallido.

Se conservan los fallos de fixtures y controles negativos previos y los avisos de rendimiento/aislamiento Vitest y deprecación `react-test-renderer` del run final, metadataLookup del harness y antecedentes pnpm/Miniflare; no se afirma que estén corregidos globalmente. El advisory de Vitest estima 33.15 s de startup para 311 workers aislados; no se deshabilitó aislamiento para suprimirlo. Marketing, landing, Pages, gateway, emulator legacy59 y checks S10 aceptados no se repitieron por no cambiar. El pipeline remoto completo, auditoría de dependencias y proveedores externos no se ejecutaron en esta aceptación local.

Menores diferidos por el usuario: Task2 owner GET de draft válido no configurado devuelve503 en vez de proyección vacía eligible:false; Task3 caso denso de autorización difícil de mantener. Se mantienen los menores anteriores CRM/FAQ/S17/S10, sin correcciones de alcance ajeno.

## Entrega y rollback

Producción y activación pendientes. Antes de activar: revisión independiente completa, backup verificable, Worker/protocolo e índices aditivos primero, app compatible después y decisión explícita sobre gate. Una sola réplica. Mantener engine solo en `alsdevstudio.com`, HTTPS y Cloudflare Access Service Auth si se configura Ollama remoto; nada de ello fue invocado aquí.

Rollback por gatefalse conserva lectura de relación propia/dueño y rechazo/revocación/salida; suspende solicitud/aprobación/agenda delegada. Conservar memberships, estado, eventos/recibos, índices y lector/enforcement S09 aunque su escritor esté apagado. No limpiar históricos, resetear contadores ni elevar roles para resolver errores. No retirar silenciosamente datos de navegador de módulos personales retirados. Fases 2/3 no forman parte del cierre de fase 1.
