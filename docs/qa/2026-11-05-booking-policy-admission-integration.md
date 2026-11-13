# R0-POLICY-I: Informe de integración de admisión y compatibilidad

- **Tarea:** `R0-POLICY-I` (`#task6` del subplan de `R0-POLICY`, módulo transversal sin `requirementIds`)
- **Fecha:** 2026-11-13
- **Repositorio de control y código:** `E:/Proyectos/Sarin Bot` (`consolidated-main`, rama `main`)
- **Candidato de código y pruebas verificado:** `bef63258bff5c6c0d26ffa9af80ea46dbceac337` (con ancestrales `R0-POLICY-B1` `a2bd140d3670b5d9a6f319f936bd6820cea67c4c`, `R0-POLICY-B2` `ccbfe9828a6a5fad3ee81f6ad368a9e9a42ffb1a`, `R0-POLICY-B3` `9d2f9c1dd32236a83139a8513788cb8919e38244`, `R0-POLICY-B4` `77ebaf21257506013d9f06fa7d307d4a6d9124e4`, `R0-POLICY-B5` `423213b51e8e7043280e362f6202f862041977ba` y `bef63258bff5c6c0d26ffa9af80ea46dbceac337`)
- **Contrato aprobado (`R0-POLICY-D`):** `docs/superpowers/specs/2026-10-30-booking-policy-admission-design.md` (SHA-256 `f828ff1ad95e7c02cbed837f36d1143399eaeaf5cab54d9f43a86c5dcf7c4ac9`)
- **Subplan (`R0-POLICY-P`):** `docs/superpowers/plans/2026-10-30-booking-policy-admission.md` (SHA-256 `bebb9f8b3760351c954dfa9fb22391230b457ad0ea2163ac06f45d28b328a8bb`)
- **Runbook operativo:** `docs/product/booking-admission-operation.md`
- **Diff de producto de esta integración:** sin cambios en `src/`, `cloudflare/`, `landing/`, `pages-gateway/` ni `tests/` respecto a `bef63258bff5c6c0d26ffa9af80ea46dbceac337`; solo se añade este informe de integración y se preserva intacto el mapeo de los 165 requisitos de Fresha.

---

## 1. Cobertura integrada de la matriz `POLICY-01` a `POLICY-12`

Todos los casos de la matriz transversal se verificaron con pruebas reales sobre SQLite/D1 real, emuladores oficiales de Firestore y Auth (Java 21+, dos handles independientes y `firestore.rules`), proveedores controlados/fake y el drill sintético de recuperación fuera de Vite.

| Caso | Alcance verificado | Pruebas y contratos ejecutados | Estado |
| --- | --- | --- | --- |
| `POLICY-01` | Negocio publicado no clasificado deniega IA, propuesta, alta de cita, lista de espera, consentimiento e intake antes de cuota; conserva consulta/cancelación previa | `tests/booking-admission-storage-contract.ts` (`prepare preserves absence; enforce requires its durable protocol`), `tests/booking-admission-model.test.ts` (`missing_is_required_only_after_cutover`, `7/7`), `tests/booking-admission-domain.test.ts` (`7/7`), `tests/booking-admission-recovery.test.ts` (`3/3`), `tests/booking-admission-ui.test.tsx` (`client island blocks new reservations when admission is classification_required but keeps existing appointments`, `4/4`) | Superado |
| `POLICY-02` | Solo el dueño vigente declara explícitamente general/adultos con texto versionado; rechaza sin sesión, empleado, dueño ajeno, inyección de salud/menores/rol y sustitución de política v1 admin | `tests/booking-policy-commands-contract.ts` (`owner_can_declare_general_adults with a single revision and atomic private receipt`, `no_session_employee_foreign_owner_denied including a superadmin who is not owner`, `the owner endpoint cannot use superadmin privileges to bypass suspension, health or minors`), `tests/booking-policy-commands.test.ts` (`14/14`), `tests/booking-declaration-routes.test.ts` (`3/3`), `tests/booking-data-policy-routes.test.ts` (`2/2`), `tests/owner-booking-declaration.test.tsx` (`6/6`) | Superado |
| `POLICY-03` | Competencia dueño vs admin (`suspend`), transferencia concurrente de `ownerUid`, revisión obsoleta y replay: CAS atómico sin escrituras parciales ni filtración entre dueños | `tests/booking-policy-commands-contract.ts` (`ownership_changed_before_commit never leaves a declaration or receipt`, `two concurrent declarations use CAS; only one revision/receipt wins`, `declare_races_admin_suspend rejects the stale declaration and preserves the suspension`, `replay rechecks ownership and new owners never receive the previous private declaration`), `tests/booking-admission-d1.test.ts` (`CAS retries admission after an owner change and aborts the dependent write`, `18/18`), `tests/booking-admission-firestore.test.ts` (`25/25`) | Superado |
| `POLICY-04` | Retirada con intake incompatible cierra admisión preservando datos; replay anterior no reabre; nueva declaración solo procede sin restricción administrativa | `tests/booking-policy-commands-contract.ts` (`withdraw_with_incompatible_intake closes admission and preserves business data`, `same_request_after_withdraw_does_not_reopen and different body conflicts`, `only admin resume lifts suspension; owner replay returns the current restriction`), `tests/booking-admission-domain.test.ts` (`allows corrective business configuration with corrupt policy when clearing or preserving intake`), `tests/owner-booking-declaration.test.tsx` | Superado |
| `POLICY-05` | Política ilegible/corrupta falla cerrada (`BOOKING_POLICY_UNAVAILABLE`) distinta de ausencia; consulta, cancelación, revocación y recuperación durable usan evidencia independiente | `tests/booking-admission-model.test.ts` (`storage failure is unavailable rather than a missing policy`), `tests/booking-admission-storage-contract.ts` (`restricted and corrupt policies never fall back; private projection has no notes`), `tests/booking-admission-recovery.test.ts` (`allows reading, cancelling and recovering a confirmed appointment when policy is withdrawn or corrupt`, `separates stored booking subject evidence from current policy readability and permits revocation`), `tests/booking-admission-ui.test.tsx` | Superado |
| `POLICY-06` | Cambio restrictivo en cola y antes de `fetch`: barrera común de despacho impide nuevo envío; tras corte/reinicio descubre heads inciertos sin usar TTL para borrar ni reintentar posible envío | `tests/booking-admission-storage-contract.ts` (`closes queued and new dispatches while an already registered transport resolves`, `the cut cannot enter durable transition between registration and the exact fetch invocation`, `restart discovers uncertain heads even with completed quota and never infers resolution from TTL`, `a full head refuses the next dispatch before its dependent marker is written`), `tests/booking-policy-transition.test.ts` (`7/7`), `tests/booking-policy-transition-d1.test.ts` (`7/7`) | Superado |
| `POLICY-07` | Chat denegado no entrega texto cacheado ni confirma propuestas pendientes; confirma/recupera solo cita durable vigente sin nuevo débito de cuota y conserva bloqueos manuales sin cliente | `tests/booking-admission-recovery.test.ts` (`chat denied does not return cached text or pending proposal but recovers durable confirmed appointment`), `tests/booking-proposals.test.ts` (`7/7`), `tests/booking-admission-domain.test.ts` (`allows manual block by owner without client data even when admission is withdrawn`) | Superado |
| `POLICY-08` | Salud admite estructurado y rechaza IA sin escrituras; general con menores y consentimiento respetan límites y omiten notas/cuerpos privados de proyecciones y modelos cliente | `tests/booking-admission-storage-contract.ts` (`health supports structured bookings and rejects inference without writes`), `tests/booking-admission-model.test.ts` (`private_fields_never_project`), `tests/booking-admission-domain.test.ts`, `tests/structured-booking.test.ts` (`7/7`), `tests/booking-subject-consent.test.ts` (`5/5`) | Superado |
| `POLICY-09` | Reprogramaciones, lista de espera y ofertas frente a cambio restrictivo rechazan nuevas escrituras y preservan cancelación y recuperación terminal | `tests/appointment-reschedule.integration.test.ts` (`8/8`), `tests/owner-rescheduling-d1.test.ts` (`14/14`), `tests/waitlist-d1.test.ts` (`7/7`), `tests/waitlist-offers-d1.test.ts` (`22/22`), `tests/waitlist-offers-firestore.test.ts` (`21/21` en `test:rules`) | Superado |
| `POLICY-10` | WhatsApp persistido con `policyRevision` transaccional en `whatsappOutbox`; `ready` incompatible se cancela antes de `fetch`; fallo en `sending` pasa a `unknown` sin reenvío ni liberación | `tests/booking-admission-channels.test.ts` (`3/3`: `persists policyRevision into whatsappOutbox inside persistWhatsAppReply transaction`, `cancels ready outbox when policy becomes incompatible before send without dispatching fetch`, `transitions sending outbox to unknown upon crash and never resends unknown outbox`) | Superado |
| `POLICY-11` | Drill sintético de backup/restauración y preflight de release: marcador `bookingAdmissionProtocol` y restricciones no retroceden con snapshots previos; rollback permitido conserva recuperación | `tests/recovery-drill.test.ts` (`8/8`: `snapshot before admission cutover cannot roll back the marker or policy restrictions`, `runs the standalone CLI with the native Node loader outside Vite`), `tests/recovery-backup-classification.test.ts` (`15/15`), `tests/booking-admission-storage-contract.ts` (`protocol creation is enforce-only, idempotent and never replaces an existing marker`, `the preparatory admin writer cannot overwrite or reopen a v2 restriction`), `cloudflare/tests/release.test.mjs` (`20/20`) | Superado |
| `POLICY-12` | Sesión UI del dueño y cliente: anti doble clic, respuesta tardía tras cambio de UID o `authEpoch`, enmascaramiento de recibo privado y recuperación sin IA | `tests/booking-policy-commands-contract.ts` (`uncertain_commit_recovers_current by receipt without issuing a new revision`), `tests/owner-booking-declaration.test.tsx` (`6/6`), `tests/booking-admission-ui.test.tsx` (`4/4`), `tests/owner-configuration-workspace.test.tsx` (`28/28`), `tests/owner-configuration-provider.test.tsx` (`37/37`), `tests/chat-surfaces.test.tsx` (`29/29`), `tests/admin-booking-data-policy.test.tsx` (`2/2`) | Superado |

---

## 2. Paridad D1 real vs Firestore oficial y auditoría del inventario

### 2.1 Paridad de backends reales
- **D1 real:** `tests/booking-admission-d1.test.ts` (`18/18`) y `tests/booking-policy-transition-d1.test.ts` (`7/7`) ejecutan ambos contratos compartidos (`registerBookingTransitionCases` con 7 casos y `registerBookingAdmissionCases` con 6 casos, más 11 casos de `registerBookingPolicyCommandCases` y la prueba específica `CAS retries admission after an owner change and aborts the dependent write`).
- **Firestore oficial + Auth Emulator + `firestore.rules` (Java 21):** `tests/booking-admission-firestore.test.ts` (`25/25` dentro de `pnpm run test:rules`) valida exactamente los 24 casos compartidos (6 admisión, 7 transición, 11 comandos) con dos handles independientes y añade `denies browser reads and mutations including forged administrator claims`.

### 2.2 Inventario contrastado de lectores, escritores y barreras
Se auditó por búsqueda directa en `src/` y `cloudflare/` cada consumidor identificado en el subplan `R0-POLICY-P`, confirmando cobertura sin omisiones:

| Archivo / módulo | Contrato verificado en código | Observación |
| --- | --- | --- |
| `src/lib/server/bookings.ts` (`L79,L83`) | `assertBookingAdmission(..., 'appointment')` y `assertBookingIntakePolicy` | `createManualBlock` exento por contrato (sin datos de cliente) |
| `src/lib/server/booking-proposals.ts` (`L69,L77,L133,L150`) | Admisión para `'proposal'` y `'appointment'` | Recuperación durable separada |
| `src/lib/server/structured-booking.ts` (`L24`) | Delega creación de propuesta y comprueba consentimiento e intake | Respeta salud estructurada sin IA |
| `src/lib/server/appointment-rescheduling.ts` (`L69,L71,L90,L95`) | `assertBookingAdmission(..., 'reschedule')` | Mantiene lectura/cancelación previa |
| `src/lib/server/owner-rescheduling.ts` (`L89,L165,L209`) | `readBookingDataPolicy`, admisión en `'proposal'` y `'reschedule'` | Respeta recuperación terminal |
| `src/lib/server/waitlist.ts` (`L89,L175,L178`) | `assertBookingAdmission(..., 'waitlist')` y `assertBookingIntakePolicy` | Deniega nuevas altas si cierra |
| `src/lib/server/waitlist-offers.ts` (`L211,L259,L265,L360`) | Admisión en `'offer'` y lectura `readBookingDataPolicy` | Conserva estado terminal existente |
| `src/lib/server/booking-subject-consent.ts` (`L64,L117`) | `readBookingDataPolicy` al aceptar y `assertBookingAdmission(..., 'subject_acceptance')` | Evidencia previa y revocación independientes de nueva admisión |
| `src/lib/server/businesses.ts` (`L100`) | `assertBookingIntakePolicy(..., previousIntakeFields)` en transacción | Permite configuración manual correctiva sin atrapar retirada |
| `src/lib/server/business-factual-faq.ts` (`L39`), `business-team.ts` (`L102`), `team-agenda.ts` (`L22`) | Lectura `readBookingDataPolicy` | Conserva agenda de equipo asignada aun con admisión retirada |
| `src/lib/server/chat.ts` (`L112,L113,L170`) | `assertBookingAdmission(..., 'inference')` y barrera `withBookingDispatch` | Revalidación en arranque y recuperación durable ante denegación |
| `src/lib/server/response-quota-store.ts` (`L51,L70,L79`) | `prepareBookingDispatchRegistration` y `assertBookingAdmission(..., 'inference')` | Registro atómico de head antes de `fetch` |
| `src/lib/server/whatsapp-store.ts` (`L248,L268`), `whatsapp-worker.ts` (`L102,L123`) | `prepareBookingDispatchRegistration(..., 'channel_reply')`, `readBookingAdmission` y `withBookingDispatch` | Outbox transaccional y cancelación previa de `ready` incompatible |
| `scripts/lib/recovery-classification.mjs` (`L60-L120`) | Esquemas estrictos para `bookingAdmissionProtocol`, `booking_policy_*`, `booking_dispatch_*`, `booking_policy_operation_*` | Drill con `age` verifica clasificación conservadora y no regresión |
| `cloudflare/src/data.ts` (`L84,L93,L249`), `cloudflare/scripts/booking-admission-preflight.mjs`, `release-core.mjs`, `release.mjs` | Bloqueo de borrado/mutación de `serverSettings/bookingAdmissionProtocol` y preflight `assertBookingAdmissionRelease` | Protege marcador inmutable y compatibilidad `enforce` |

---

## 3. Checks acumulados y despliegue remoto verificado

Ejecutado localmente en `E:/Proyectos/Sarin Bot` sobre el candidato `bef63258bff5c6c0d26ffa9af80ea46dbceac337` (con `SARIN_TEST_AGE_PATH` apuntando a `age.exe` local y Temurin JDK 21 portable para emuladores):

| Check | Resultado observado | Exit code |
| --- | --- | --- |
| `pnpm run typecheck` | TypeScript estricto (`tsc --noEmit`) sin errores | `0` |
| Suite focal `R0-POLICY` + drill (`13` archivos) | `Test Files 13 passed (13)`, `Tests 89 passed (89)` (`Duration 82.28s`) | `0` |
| `pnpm test` | `Test Files 340 passed \| 10 skipped (350)`, `Tests 5026 passed \| 114 skipped (5140)` (`Duration 181.41s`). Omitidos: 8 suites de emulador Firestore (`112` tests cubiertos en `test:rules`), `tests/local-journey.integration.test.ts` (`1` test cubierto en `test:journey`) y `tests/deepseek-intent.live.test.ts` (`1` test externo live omitido offline) | `0` |
| `pnpm run test:rules` (emuladores Firebase + Java 21) | `Test Files 9 passed (9)`, `Tests 116 passed (116)` (`Duration 172.32s`), incluyendo `tests/booking-admission-firestore.test.ts (25 tests)` | `0` |
| `pnpm run build` | Compilación Next.js 16.4.3 Turbopack (`20` rutas estáticas) | `0` |
| `pnpm run build:landing; pnpm run check:landing; pnpm run build:pages` | `Bot service landing verified: 41 public files...`; artefacto Pages con gateway y fallback estático generado | `0` |
| `pnpm --filter sarin-cloudflare-host run check` | `203/203` pruebas de host Cloudflare, `tsc --noEmit` y dry-run de Wrangler (`Total Upload: 1083.47 KiB / gzip: 196.46 KiB`) | `0` |
| `node --test cloudflare/tests/release.test.mjs` | `tests 20 \| pass 20 \| fail 0 \| skipped 0` | `0` |
| `node --test pages-gateway/tests/*.test.mjs` | `tests 25 \| pass 25 \| fail 0 \| skipped 0` | `0` |
| `node --test .agents/skills/avanzar/scripts/*.test.mjs` | `tests 35 \| pass 35 \| fail 0 \| skipped 0` | `0` |
| `pnpm audit --audit-level=high` | `3 vulnerabilities found \| Severity: 1 low \| 2 moderate` (`0` high, `0` critical) | `0` |
| `pnpm run dev:local --port 3040` + `pnpm run test:local --port 3040` + `pnpm run test:journey --port 3040` | `test:local` OK (auth, roles, 403/404, billing y negocio sin inferencia); `test:journey` superado `1/1` (`tests/local-journey.integration.test.ts`, `17358ms`, Fases 1 a 5, Catálogo HTTP, `129` comprobaciones y limpieza sintética; procesos y puertos cerrados al terminar) | `0` |

### Verificación CI/CD remota en GitHub Actions y Cloudflare (candidato `bef63258bff5c6c0d26ffa9af80ea46dbceac337`)
- Workflow `Verify Sarin`: run `42750088803` (`https://github.com/andresleosan/SarinBotSAAS/actions/runs/42750088803`) en estado `completed` / `success`.
- Los 4 jobs finalizaron en verde (`success`):
  1. `Types, tests and builds`
  2. `Firebase rules and local journey`
  3. `Cloudflare configuration dry-run`
  4. `Deploy Cloudflare production`

---

## 4. Revisión independiente, compatibilidad y límites

- **Privacidad y minimización de trazas:** las pruebas de contrato, canal y drill confirman cero cuerpos de conversación ni notas privadas en proyecciones cliente, diagnósticos o logs. Todos los datos usados pertenecen a fixtures `demo-*`.
- **Estado de `src/lib/booking-admission-release.ts` (commit `20862fdceacfe92b9b1ec7a0e6bf216cecc68f59`):** el módulo mantiene `BOOKING_ADMISSION_RELEASE = 'prepare'` en tiempo de ejecución para preservar compatibilidad de las fixtures heredadas de la suite completa (`5026` tests sin marcador sembrado), mientras `BOOKING_ADMISSION_COMPATIBILITY` declara `{ reader: 2, release: 'enforce', recoveryCompatible: true }` para el preflight de release y las rutas `enforce` se ejercitan mediante parámetro explícito y `vi.mock`. Esta decisión heredada de B5 se conserva deliberadamente intacta en `R0-POLICY-I`.
- **Tolerancia D1 `7403` en `cloudflare/scripts/release.mjs` (commit `b3c2f2f`):** cuando el token de API usado en CI carece de permisos directos de consulta/escritura D1 (error `7403`), `readAdmissionProtocol` devuelve `null` y `ensureAdmissionProtocol` registra el aviso y continúa. El registro automático del marcador remoto durante CI queda condicionado a los permisos del token hasta contar con credenciales D1 habilitadas o comprobación operativa directa.
- **Límites operativos y de UI:** no se realizaron envíos reales de WhatsApp, inferencia pagada ni activaciones externas; el test externo live (`tests/deepseek-intent.live.test.ts`) permaneció omitido offline. La verificación visual completa con Playwright MCP en navegador real (zoom `200%`, todos los viewports y recorridos UI integrados) queda diferida a la fase posterior a `BUILD-FREEZE`, sin atribuirse a las pruebas unitarias ni al journey HTTP local.
