# Subplan de implementación: señales operativas sanitizadas sin conversaciones (`R0-OBS`)

> Basado en el contrato aprobado [docs/superpowers/specs/2026-10-30-sarin-operational-signals-design.md](docs/superpowers/specs/2026-10-30-sarin-operational-signals-design.md) (`sha256=e4a3e58af27f4141891aed81e1351b6cf2ec986ff9a10aaa475b0019d4f869c5`), en [DESIGN.md](DESIGN.md) y en [docs/implementation/fresha/plans/00-base-produccion.md](docs/implementation/fresha/plans/00-base-produccion.md#r0-obs-p).

## Objetivo y alcance

Instrumentar y exponer señales técnicas de operación para Sarin sin habilitar `observability` de Cloudflare ni capturar cuerpos de conversación, mensajes, prompts, teléfonos, correos, tokens, rutas internas con parámetros o identidades personales. Todas las señales describen exclusivamente las seis familias técnicas acordadas en `R0-OBS-D`:

1. `engine_errors_and_latency`: fallos y latencia `p95` en fronteras `identity_wif`, `engine_ollama`, `engine_deepseek`, `engine_gemini` y `container_proxy`.
2. `d1_contention`: distribución de reintentos CAS en `runTransaction` (`>= 5`), agotamientos `409 DATA_CONFLICT`, rechazos `413 DATA_LIMIT`, indisponibilidad `503 DATA_UNAVAILABLE` / `DATA_RECOVERY_CLOSED` y latencia `p95` D1.
3. `queue_pressure`: instantánea en `PriorityFifoQueue` (`activeSlots`, `queuedRequests`, `criticalQueued`, `normalQueued`, `maxSlots`), pico de cola (`highWaterQueued`), espera `p95` (`waitMsP95`), `rejectedFull429` (`>= 64`) y `rejectedTimeout429` (`>= 120_000 ms`) sobre ventana móvil.
4. `uncertain_reservations`: conteo y edad máxima de `responseQuotaTurns` en `reserved`/`needs_review`, llamadas `aiBudgetCalls` en `status: 'uncertain'`, y resultado de `recoverWorkerResponseQuota`.
5. `cron_and_retention`: disparo y éxito por cada subtarea del Cron `*/5 * * * *` (`recovery_backup`, `response_quota_recovery`, `admin_payment_retention`, `platform_support_retention`, `platform_whatsapp_retention`), contadores `clearedBodies`, `deletedMetadata`, `invalidRecords`, `failedPhases`, `backlogCycles` con `morePending: true` y `BackupStatus` (`phase`, `health`, `lastRecoverableAt`, `failureCode`, `gaps`).
6. `ai_and_whatsapp_budget`: porcentaje máximo (`used + reserved`) diario/mensual global y por negocio en `pilotAiBudget`, estado `paused` y `reason`, presupuestos diarios de plataforma (`platform_whatsapp_budget` y etapas `audio`, `generation`, `send` en `platformWhatsAppBudgetPeriods`), más `telemetryWriteFailures > 0`.

Quedan fuera de este subplan las métricas comerciales S17/R5 (`conversiones`, ingresos, citas por negocio o retención de clientes), la activación en producción de alertas externas reales (`RELEASE-FLAGS` / `RELEASE-SEND`) y cualquier envío automático sin bandera explícita.

## Contratos compartidos, límites y compatibilidad de release

### Esquema compartido (`shared/operational-signals.ts`)

Debe mantenerse libre de `@/`, `server-only`, `enum`, `namespace` y parameter properties para ejecutarse tanto en Next como en `cloudflare/tests/*.test.mjs` y `scripts/lib/recovery-classification.mjs` bajo type-stripping nativo de Node 24. Usar extensiones relativas explícitas cuando importe módulos hermanos compartidos.

* **Severidades (`SignalSeverity`)**: `'ok' | 'warning' | 'critical' | 'unknown'`. Toda familia o componente no consultable por fallo de lectura o ausencia de señal válida informa `'unknown'` (nunca finge `'ok'`).
* **Fronteras (`SignalBoundary`)**: `'identity_wif' | 'engine_ollama' | 'engine_deepseek' | 'engine_gemini' | 'container_proxy' | 'd1_storage' | 'queue' | 'recovery_backup' | 'response_quota_recovery' | 'admin_payment_retention' | 'platform_support_retention' | 'platform_whatsapp_retention' | 'budget_ai' | 'budget_whatsapp' | 'alert_channel'`.
* **Clases de error (`SignalErrorClass`)**:
  * Clases fijas de frontera del contrato `R0-OBS-D`: `'TIMEOUT' | 'UPSTREAM_4XX' | 'UPSTREAM_5XX' | 'CONFIG_INVALID' | 'RESPONSE_INVALID' | 'TRANSPORT_UNAVAILABLE'`.
  * Clases técnicas auxiliares acotadas: `'NONE' | 'QUOTA_BUSY' | 'CONFLICT_EXHAUSTED' | 'STORAGE_LIMIT' | 'BACKUP_OVERDUE' | 'RETENTION_INCOMPLETE' | 'CRON_STALE' | 'CRON_FAILED' | 'BUDGET_BLOCKED' | 'ALERT_REJECTED' | 'ALERT_UNCERTAIN' | 'TELEMETRY_DEGRADED' | 'UNKNOWN'`.
* **Tupla sanitizada (`SanitizedErrorDiagnostic`)**: `{ boundary, errorClass, httpStatus, providerCode }`.
  * `httpStatus`: entero `100..599` o `null`.
  * `providerCode`: identificador corto estrictamente validado `/^[A-Za-z0-9_.-]{1,32}$/` o `null`. Nunca se copia `error.message`, stack traces, encabezados, URLs, UIDs ni cuerpos JSON.
* **Ventana acotada (`OperationalCollector`)**:
  * Anillo circular fijo de 12 cubetas de 5 minutos (`SIGNAL_WINDOW_BUCKET_MS = 300_000`, `SIGNAL_WINDOW_BUCKETS = 12`, total 60 min) con capacidad de consultar cortes de 5 min (1 cubeta), 15 min (3 cubetas) y 60 min (12 cubetas).
  * Todas las métricas móviles (fallos por frontera, latencias del motor y D1 con tope de 256 muestras por proceso, `highWaterQueued`, `waitMsSamples`, `rejectedFull429`, `rejectedTimeout429`, `casRetryWarnings`, `conflictExhausted`, `limitRejected413`, `unavailable503`) rotan dentro de las cubetas temporales para que al recuperarse el tráfico todas las familias vuelvan limpiamente a `'ok'`.
* **Estado persistido en D1/Firestore (`serverSettings/*`)**: dos documentos fijos con esquema Zod `.strict()` para eliminar contención CAS entre el Worker Cron y el Contenedor Next (validados en `create` y `set`, rechazando `merge: true` en `cloudflare/src/data.ts`):
  1. `serverSettings/operationalSignalsWorker`: escrito por el Worker mediante `executeDataCommand({ action: 'commit', expectedRevision, requestId, writes }, env)` con bucle CAS y tolerancia de degradación (`recoveryRestricted(env)` retorna `503` controlado):
     * `version: 1`, `updatedAt`, `maintenanceSkipped`, `cronLastAttemptAt`, `cronLastSuccessAt`, `backlogCycles`, `cronConsecutiveFailures`,
     * `subtasks`: mapa fijo con `{ recovery_backup, response_quota_recovery, admin_payment_retention, platform_support_retention, platform_whatsapp_retention }`, cada uno `{ lastAttemptAt, lastSuccessAt, failed, morePending, invalidRecords, failedPhases }`,
     * `backup`: resumen sanitizado de `BackupStatus` (`phase`, `health`, `lastRecoverableAt`, `failureCode`, `gaps`),
     * `identityWifFailures15m` / `containerProxyFailures15m`, `recentErrors` (máximo 16 tuplas sanitizadas) y `signalWriteFailures`.
  2. `serverSettings/operationalSignals`: escrito únicamente por el Contenedor Next al conciliar incidentes/cooldown:
     * `version: 1`, `updatedAt`, `alertsEnabled`, `signalWriteFailures`, `signalReadFailures`,
     * `incidents`: mapa o arreglo acotado de máximo 64 registros `{ incidentKey, family, code, lastSeverity, firstSeenAt, lastSeenAt, lastAlertAt, cooldownUntil, resolvedAt, deliveryState: 'none' | 'disabled' | 'sent' | 'failed' | 'uncertain' | 'skipped_unconfigured', lastAlertErrorClass }`.
* **Reglas de huella, cooldown 6 h y canal opcional (`SARIN_OPERATIONAL_ALERTS_ENABLED="false"`)**:
  * `incidentKey`: resumen SHA-256 hex de `${family}:${code}:${severity}` según `R0-OBS-D`.
  * Aplica en niveles `'warning'` y `'critical'`: un mismo nivel dentro de `cooldownUntil > now` (`COOLDOWN_MS = 21_600_000`) no reemite alerta; la escalada de `'warning'` a `'critical'` genera nuevo disparo inmediato con su nuevo `cooldownUntil`; la recuperación de todas las señales de la familia marca el incidente resuelto (`resolvedAt`) para habilitar ciclos futuros.
  * Plantilla fija sanitizada de aviso externo: `[Sarin Ops][${severity}] ${family}:${code} (${observedAtBogota}) alsdevstudio.com` (sin cuerpos, prompts, teléfonos, UIDs ni texto libre).
  * Ante error o resultado `unknown` en transporte, registra `deliveryState: 'failed' | 'uncertain'` conservando cooldown y prohibiendo reintento automático a ciegas.
* **Compatibilidad con `release-core.mjs`, `wrangler.jsonc` y `router.ts`**:
  * `cloudflare/wrangler.jsonc` mantiene `send_metrics: false` y `observability: { enabled: false, logs: { enabled: false }, traces: { enabled: false } }`.
  * Se añade `"SARIN_OPERATIONAL_ALERTS_ENABLED": "false"` a `vars` en `cloudflare/wrangler.jsonc` y se actualiza `cloudflare/worker-configuration.d.ts` con `pnpm --filter sarin-cloudflare-host run types`.
  * En `cloudflare/src/router.ts`: añadir `'SARIN_OPERATIONAL_ALERTS_ENABLED'` a `runtimeKeys`, exigir booleano estricto `'true' | 'false'`, forzar `'false'` bajo `recoveryRestricted` y excluirla en `publicBuildArguments`.
  * En `cloudflare/scripts/release-core.mjs`: mantener fuera del objeto `expected` de `validateSnapshot` porque `release.mjs` publica el Worker con `vars: {}` y `--keep-vars` (`releaseConfig`); exigir ese binding por adelantado rompería el primer despliegue antes de sincronizar variables. En Next, `process.env.SARIN_OPERATIONAL_ALERTS_ENABLED === 'true'` cierra por defecto ante `undefined` o `'false'`.
* **Compatibilidad con respaldos y reglas**:
  * `scripts/lib/recovery-classification.mjs` añade `'operationalSignals'` y `'operationalSignalsWorker'` en `serverSchema(id, data)`. Ningún campo de esos esquemas colisiona con `scrubbedKeys` (`reason`, `evidence`, `content`, etc.).
  * `cloudflare/src/data.ts` agrega `'startedAt': 'number'` a `fields` si hiciera falta ordenar o filtrar por tiempo, y las consultas sobre `responseQuotaTurns` usan exclusivamente los índices ya declarados en `firestore.indexes.json` (`status == 'reserved'` ordenado por `__name__`, igual que `response-quota-admin.ts`), manteniendo límites acotados (`limit(100)`) y sin requerir nuevos índices compuestos en Firestore.
  * `firestore.rules` continúa denegando lecturas/escrituras de cliente en `serverSettings/**`.
* **Compatibilidad de contratos existentes**:
  * `cleanupPlatformWhatsAppRetention` (`cloudflare/src/platform-whatsapp-retention.ts`) conserva exactamente `{ clearedBodies, deletedMetadata, morePending }`; se exporta `cleanupPlatformWhatsAppRetentionReport` devolviendo además `invalidRecords` y `failedPhases`.
  * `getSarinQueueStats()` (`src/lib/sarin/queue.ts`) conserva exactamente sus 5 claves (`activeSlots`, `queuedRequests`, `criticalQueued`, `normalQueued`, `maxSlots`) exigidas por `/api/sarin/health?scope=engine` en `router.ts:129`; las métricas de ventana se exponen mediante `getSarinQueueOperationalMetrics()`.
* **Integración visual en Hub (`/admin`, `#admin-overview`) y modo mantenimiento**:
  * Respeta estrictamente las clases y tokens reales definidos en [DESIGN.md](DESIGN.md) y `src/app/globals.css`: `bg-sarin-paper`, `bg-sarin-canvas`, `bg-sarin-soft`, `border-sarin-line`, `text-sarin-ink`, `text-sarin-muted`, `text-sarin-blue`, tipografía `DM Sans`, `tabular-nums`, controles `min-h-11` (`44px`) y ancho mínimo `320px`.
  * En `src/app/admin/page.tsx`: `<AdminOperationalSignals />` usa contenedores `<div>` (sin añadir una `<section inert>` adicional, manteniendo intactos los 6 módulos de `src/lib/admin-navigation.ts` y exactamente 11 paneles en `tests/admin-modules.test.tsx`). Se monta dentro de `#admin-overview` (`Estado técnico`) cuando `data` cargó, y además en bloque de contingencia cuando `!data && error` (p. ej. mantenimiento donde `/api/admin` devuelve `503` mientras `/api/admin/operational-signals` sigue accesible con Bearer superadmin). Pasa `uid={uid}` definido en `Console`.

---

## Mapa de tareas e hijos generados

| ID | Tipo | Dependencias | Propósito principal | Ancla |
| :--- | :--- | :--- | :--- | :--- |
| `R0-OBS-B1` | `build` | `R0-OBS-P` | Contrato compartido, sanitizador 6 clases, colector en anillo 5m/15m/60m, evaluador 4 severidades, cooldown 6h, validación D1 y clasificación respaldo | [task1](#task1) |
| `R0-OBS-B2` | `build` | `R0-OBS-B1` | Worker (`identity`, `identity-core`, `router`, `index`, subtareas Cron, `waitUntil`, mantenimiento strict URL) y `SARIN_OPERATIONAL_ALERTS_ENABLED="false"` | [task2](#task2) |
| `R0-OBS-B3` | `build` | `R0-OBS-B2` | Contenedor (`database`, `queue`, `engine` por proveedor), lectores sin transacción en recuperación, ruta `GET /api/admin/operational-signals`, evaluación Cron y adaptador YCloud apagado | [task3](#task3) |
| `R0-OBS-B4` | `build` | `R0-OBS-B3` | Panel `<AdminOperationalSignals />` en `/admin` (`DESIGN.md`, tokens `sarin-*`, soporte mantenimiento) y mocks en pruebas UI de consola | [task4](#task4) |
| `R0-OBS-I` | `integration` | `R0-OBS-B1..B4` | Gate integral: 6 familias en falla/recuperación, sanitización negativa, D1 + Firestore + Workerd + UI y reporte QA | [task5](#task5) |

---

<a id="task1"></a>
### Tarea 1 (`R0-OBS-B1`): Modelo compartido, sanitizador, colector/evaluador, cooldown 6h y clasificación D1/respaldo

**Dependencias:** `R0-OBS-P`

**Archivos:**
* Crear:
  * `shared/operational-signals.ts`
  * `tests/operational-signals-model.test.ts`
* Modificar:
  * `cloudflare/src/data.ts`
  * `scripts/lib/recovery-classification.mjs`
* Probar (incluidos regresión):
  * `tests/operational-signals-model.test.ts`
  * `tests/recovery-backup-classification.test.ts`
  * `tests/recovery-drill.test.ts`
  * `cloudflare/tests/data.test.mjs`

**Interfaces y comportamiento exacto:**
1. En `shared/operational-signals.ts` (puro TypeScript compatible con `--experimental-strip-types`):
   * Constantes: `SIGNAL_FAMILIES`, `SIGNAL_SEVERITIES = ['ok', 'warning', 'critical', 'unknown']`, `SIGNAL_WINDOW_BUCKET_MS = 300_000`, `SIGNAL_WINDOW_BUCKETS = 12`, `SIGNAL_COOLDOWN_MS = 21_600_000`, `OPERATIONAL_SIGNALS_DOC_PATH = 'serverSettings/operationalSignals'`, `OPERATIONAL_SIGNALS_WORKER_DOC_PATH = 'serverSettings/operationalSignalsWorker'`.
   * `sanitizeOperationalError(input: { boundary: SignalBoundary; errorClass?: SignalErrorClass; httpStatus?: unknown; providerCode?: unknown }): SanitizedErrorDiagnostic`: valida `httpStatus` entero `100..599` y `providerCode` `/^[A-Za-z0-9_.-]{1,32}$/` (descarta cualquier otro formato a `null`), garantizando que mensajes arbitrarios, teléfonos, correos, tokens o rutas nunca entran en la tupla devuelta.
   * `createOperationalCollector(options?: { maxLatencySamples?: number })`:
     * Cubetas circulares de 5 min con rotación limpia para errores por frontera, duración de motor, duración/reintentos/errores D1 y presión de cola (`highWaterQueued`, `waitMsSamples`, `rejectedFull429`, `rejectedTimeout429`).
     * `snapshot(now)` entrega resúmenes separados de 5 min, 15 min (`3` cubetas) y 60 min (`12` cubetas), percentiles `p50Ms` / `p95Ms`, fallos consecutivos por frontera y `signalWriteFailures`. Nunca propaga excepciones si falla internamente.
   * `evaluateOperationalSignals(input: OperationalEvaluationInput)`:
     * Devuelve `families` con estado `'ok' | 'warning' | 'critical' | 'unknown'`, códigos, métricas sanitizadas y severidad global agregada. Si una fuente llega marcada como no consultable (`unavailable: true`) o corrupta, su familia toma `'unknown'` salvo que ya exista otra condición crítica probada.
     * Umbrales exactos de `R0-OBS-D`:
       1. `engine_errors_and_latency`: `critical` ante cualquier fallo en `identity_wif`, o `> 5` fallos consecutivos en una frontera, o indisponibilidad sostenida `>= 5 min` (`300_000 ms`) en motor o `container_proxy`; `warning` ante `>= 3` fallos en 15 min en una frontera o `p95Ms > 15_000`; `ok` al enfriarse las ventanas.
       2. `d1_contention`: `critical` ante `conflictExhausted > 0` (`409 DATA_CONFLICT`), `limitRejected413 > 0` (`413 DATA_LIMIT`) o `unavailable503 > 0` (`503 DATA_UNAVAILABLE` / `DATA_RECOVERY_CLOSED`) en 15 min; `warning` ante `casRetriesMax >= 5` en 5 min o `d1LatencyP95Ms > 2_000`; `ok` al recuperarse.
       3. `queue_pressure`: `critical` ante `rejectedFull429 > 0` o `rejectedTimeout429 > 0` en ventana activa de 15 min; `warning` ante `queuedRequests >= 32` (`highWaterQueued >= 32`) o `waitMsP95 > 30_000`; `ok` cuando baja la cola y pasa la ventana.
       4. `uncertain_reservations`: `critical` ante reserva `needs_review`/`reserved` vencida o `aiBudgetCalls` `uncertain` `>= 86_400_000 ms` (`>= 24 h`) o fallo de ejecución de `recoverWorkerResponseQuota`; `warning` ante edad `>= 900_000 ms` (`>= 15 min`) o `quotaRecovery.morePending` durante `>= 3` ciclos de Cron.
       5. `cron_and_retention`: suprime falsos positivos en mantenimiento (`maintenanceSkipped === true` -> `ok` informativo); fuera de mantenimiento: `critical` si `BackupStatus.health === 'breached'` (`> 24 h`), fallo de copia/subtarea Cron, `invalidRecords > 0`, `failedPhases > 0` o `cronAgeMs > 1_800_000` (`> 30 min`); `warning` si `BackupStatus.health === 'warning'` (`>= 20 h`), `backlogCycles >= 3` (`>= 15 min` con `morePending: true`) o `cronAgeMs > 900_000` (`> 15 min`).
       6. `ai_and_whatsapp_budget`: `critical` si ratio `>= 1.0` en presupuesto diario/mensual global o por negocio de `pilotAiBudget` o presupuestos diarios de plataforma (`platform_whatsapp_budget` y etapas `audio`/`generation`/`send`), o `pilotAiBudget.paused === true` o `blocked === true`; `warning` si ratio máximo `>= 0.80` o `telemetryWriteFailures > 0`.
   * `reconcileIncidentCooldowns(previousState, evaluation, now)`: huella `sha256(`${family}:${code}:${severity}`)` (tope `64`), respeta `cooldownUntil` por 6 h en nivel igual (`warning` o `critical`), dispara inmediato al escalar `warning -> critical`, marca resuelto al volver a `'ok'` y conserva `deliveryState: 'uncertain'` sin reenvío automático.
   * Esquemas Zod `.strict()`: `operationalSignalsWorkerSchema`, `operationalSignalsStateSchema`, `operationalSignalsOverviewSchema`.
2. En `cloudflare/src/data.ts`:
   * Validar tanto `create` como `set` (rechazando `merge: true` con `400 DATA_INVALID`) para `serverSettings/operationalSignals` y `serverSettings/operationalSignalsWorker`. Agregar `'startedAt': 'number'` a `fields` si fuera útil sin romper filtros existentes.
3. En `scripts/lib/recovery-classification.mjs`:
   * Declarar `'operationalSignals'` y `'operationalSignalsWorker'` en `serverSchema(id, data)` reutilizando las definiciones compartidas y confirmar compatibilidad limpia con `scrub` (`D1_BACKUP_UNCLASSIFIED` prevenido).

**Ciclo TDD (RED -> GREEN):**
* **RED:** En `tests/operational-signals-model.test.ts`, verificar todas las transiciones `ok -> warning -> critical -> ok` y `'unknown'` ante fuente no consultable, ventana móvil 5/15/60 min sin pegajosidad permanente en cola, huella `sha256(family:code:severity)`, cooldown 6 h en `warning` y `critical` con escalada inmediata, aserción negativa frente a cadenas secretas/PII sintéticas y degradación interna segura sin lanzar excepciones. En `tests/recovery-backup-classification.test.ts` y `cloudflare/tests/data.test.mjs`, agregar aserciones sobre `operationalSignals` y `operationalSignalsWorker`.
* **GREEN:** Implementar `shared/operational-signals.ts`, actualizar `cloudflare/src/data.ts` y `scripts/lib/recovery-classification.mjs` y pasar las pruebas.

**Comandos de verificación:**
* `pnpm exec vitest run tests/operational-signals-model.test.ts tests/recovery-backup-classification.test.ts tests/recovery-drill.test.ts`
* `node --test cloudflare/tests/data.test.mjs`
* `pnpm run typecheck`

---

<a id="task2"></a>
### Tarea 2 (`R0-OBS-B2`): Instrumentación del Worker, Cron/retención, allowlist estricta en mantenimiento y variable segura

**Dependencias:** `R0-OBS-B1`

**Archivos:**
* Crear:
  * `cloudflare/src/operational-signals.ts`
  * `cloudflare/tests/operational-signals.test.mjs`
* Modificar:
  * `cloudflare/src/platform-whatsapp-retention.ts`
  * `cloudflare/src/index.ts`
  * `cloudflare/src/identity.ts`
  * `cloudflare/src/router.ts`
  * `cloudflare/wrangler.jsonc`
  * `cloudflare/worker-configuration.d.ts`
  * `cloudflare/tests/router.test.mjs`
  * `cloudflare/tests/release.test.mjs`
  * `cloudflare/tests/response-quota-scheduled.test.mjs`
* Probar (incluidos regresión):
  * `cloudflare/tests/operational-signals.test.mjs`
  * `cloudflare/tests/router.test.mjs`
  * `cloudflare/tests/release.test.mjs`
  * `cloudflare/tests/platform-whatsapp-retention.test.mjs`
  * `cloudflare/tests/response-quota-scheduled.test.mjs`
  * `cloudflare/tests/recovery-backup.test.mjs`
  * `cloudflare/tests/identity.test.mjs`

**Interfaces y comportamiento exacto:**
1. En `cloudflare/src/platform-whatsapp-retention.ts`:
   * Conservar `cleanupPlatformWhatsAppRetention(env, options)` devolviendo exactamente `{ clearedBodies, deletedMetadata, morePending }`.
   * Exportar `cleanupPlatformWhatsAppRetentionReport(env, options)` devolviendo `{ clearedBodies, deletedMetadata, morePending, invalidRecords, failedPhases }` sin duplicar lógica interna.
2. En `cloudflare/src/operational-signals.ts`:
   * `recordWorkerBoundaryError(env, input: { boundary: 'identity_wif' | 'container_proxy'; errorClass: SignalErrorClass; httpStatus: number | null; providerCode?: string | null }, now?: number)`: actualiza el registro de ventana de 15 min y escribe en `serverSettings/operationalSignalsWorker` mediante lectura de revisión + `executeDataCommand({ action: 'commit', expectedRevision, requestId: crypto.randomUUID(), writes }, env)` con bucle CAS y manejo seguro de `DataError` (`recoveryRestricted` / `409` / `503`), ejecutándose vía `ctx.waitUntil(...)` para no perder eventos entre aislados HTTP y el aislado del Cron.
   * `recordWorkerCronSummary(env, summary, now)`: actualiza `subtasks` individuales, `backup`, `backlogCycles`, `cronConsecutiveFailures`, `cronLastAttemptAt` y `cronLastSuccessAt` en `serverSettings/operationalSignalsWorker`. En fallo de commit, suma `signalWriteFailures` local sin abortar `scheduled`.
3. En `cloudflare/src/identity.ts`, `cloudflare/src/router.ts` y `cloudflare/src/index.ts`:
   * `identity.ts` (`handlePublicIdentityRequest` / `handleIdentityOutbound`): dado que `identity-core.ts` captura internamente los errores para devolver `503` JSON, envolver los callbacks `getJwks` / `mintToken` pasados desde `identity.ts` (o inspeccionar el rechazo en origen antes del `catch` de `identity-core.ts`) y emitir señal sanitizada `'identity_wif'` mediante `ctx.waitUntil(...)` sin exponer tokens ni claves privadas.
   * `router.ts`:
     * En `forwardToSingleton`, capturar errores reales de proxy/contenedor dentro de sus bloques `catch` (`router.ts:162-195`, nunca los `503` deliberados de mantenimiento) invocando un callback opcional `onProxyError` para que `index.ts` emita `'container_proxy'` vía `ctx.waitUntil(...)`.
     * Añadir `'SARIN_OPERATIONAL_ALERTS_ENABLED'` a `runtimeKeys` (validación estricta `'true' | 'false'`, forzada a `'false'` en `recoveryRestricted`, excluida de `publicBuildArguments`).
     * En mantenimiento (`SARIN_MAINTENANCE === 'true'`), abrir **únicamente** `GET /api/admin/operational-signals` comprobando igualdad exacta de URL (`request.method === 'GET' && url.href === `${url.origin}/api/admin/operational-signals`` para rechazar incluso `?` vacío, `#`, barras extra o codificaciones) más cabecera `Authorization: Bearer <token>`, forzando `Cache-Control`, `CDN-Cache-Control` y `Cloudflare-CDN-Cache-Control: no-store` y delegando autenticación a Next (`requireSuperadmin`).
     * En `forwardToSingleton`, eliminar cualquier cabecera privada interna (`x-sarin-ops-evaluate`) en peticiones públicas entrantes y mantener `404` público en `/api/internal/*`.
   * `index.ts`:
     * Aceptar `(request, env, ctx)` en `fetch` para pasar `ctx.waitUntil` al hook de error de `container_proxy`/`identity_wif`.
     * En `scheduled`: envolver individualmente las 5 subtareas (`scheduleRecoveryBackup`, `recoverWorkerResponseQuota`, `cleanupAdminPaymentRetention`, `cleanupPlatformSupportRetention`, `cleanupPlatformWhatsAppRetentionReport`) en `try/catch` para registrar todas en `recordWorkerCronSummary` aun si una falla, registrando `maintenanceSkipped: true` cuando `SARIN_MAINTENANCE === 'true'`. Solo cuando `env.SARIN_OPERATIONAL_ALERTS_ENABLED === 'true'` y fuera de mantenimiento/recuperación restringida, realizar evaluación interna opcional en el singleton (`/api/internal/operational-signals`) para alertas críticas desatendidas (cuando está `'false'` no despierta el contenedor, preservando coste USD 0).
     * Actualizar los stubs del esbuild test en `cloudflare/tests/response-quota-scheduled.test.mjs` para `./operational-signals.ts` y `cleanupPlatformWhatsAppRetentionReport`.
4. En `cloudflare/wrangler.jsonc`, `cloudflare/worker-configuration.d.ts` y `cloudflare/tests/release.test.mjs`:
   * Añadir `"SARIN_OPERATIONAL_ALERTS_ENABLED": "false"` en `vars` de `wrangler.jsonc` manteniendo `observability` desactivada y regenerar `worker-configuration.d.ts`.
   * En `cloudflare/tests/release.test.mjs`, validar compatibilidad de `validateSnapshot(value, config, account)` tanto con el binding presente (`"false"`) como ausente en producción previa al primer `--keep-vars` sync.

**Ciclo TDD (RED -> GREEN):**
* **RED:** Escribir pruebas en `cloudflare/tests/operational-signals.test.mjs`, `cloudflare/tests/router.test.mjs` y `cloudflare/tests/release.test.mjs` cubriendo fallos en `getJwks`/`mintToken` (`identity_wif`), caída real de `forwardToSingleton` (`container_proxy`), fallo aislado de cada una de las 5 subtareas Cron (`scheduled` continúa y persiste resumen en `serverSettings/operationalSignalsWorker` usando `action: 'commit'`), backlog `>= 3` ciclos, degradación segura ante `503`/`409` al persistir señales, rechazo de URLs/métodos/Bearer inválidos en mantenimiento (incluido `?` vacío) y compatibilidad release con y sin `SARIN_OPERATIONAL_ALERTS_ENABLED` en snapshot vivo.
* **GREEN:** Implementar cambios de Worker/Router/Wrangler y verificar todas las suites de `cloudflare/tests/`.

**Comandos de verificación:**
* `pnpm --filter sarin-cloudflare-host run types`
* `pnpm --filter sarin-cloudflare-host run check`
* `node --test cloudflare/tests/operational-signals.test.mjs cloudflare/tests/router.test.mjs cloudflare/tests/release.test.mjs cloudflare/tests/platform-whatsapp-retention.test.mjs cloudflare/tests/response-quota-scheduled.test.mjs cloudflare/tests/recovery-backup.test.mjs cloudflare/tests/identity.test.mjs`

---

<a id="task3"></a>
### Tarea 3 (`R0-OBS-B3`): Instrumentación del Contenedor, ruta superadmin, evaluación en Cron y canal externo apagado por defecto

**Dependencias:** `R0-OBS-B2`

**Archivos:**
* Crear:
  * `src/lib/server/operational-signals.ts`
  * `src/app/api/admin/operational-signals/route.ts`
  * `src/app/api/internal/operational-signals/route.ts`
  * `tests/operational-signals-server.test.ts`
* Modificar:
  * `src/lib/storage/database.ts`
  * `src/lib/sarin/queue.ts`
  * `src/lib/sarin/engine.ts`
* Probar (incluidos regresión):
  * `tests/operational-signals-server.test.ts`
  * `tests/engine.test.ts`
  * `tests/engine-budget.test.ts`
  * `tests/engine-health.test.ts`
  * `tests/chat.test.ts`
  * `tests/response-quota-admin-route.test.ts`

**Interfaces y comportamiento exacto:**
1. En `src/lib/sarin/queue.ts`:
   * Conservar `getSarinQueueStats()` exactamente con `{ activeSlots, queuedRequests, criticalQueued, normalQueued, maxSlots }` para compatibilidad estricta con `router.ts:129`.
   * Registrar las muestras en el colector de ventana móvil (`SIGNAL_WINDOW_BUCKET_MS` 5m / 15m) dentro de `PriorityFifoQueue` y exponer `getSarinQueueOperationalMetrics()` sin propagar errores de telemetría.
2. En `src/lib/storage/database.ts`:
   * Instrumentar `runTransaction` dentro de `createCloudflareDatabase` capturando cantidad de intentos (`attempts`), latencia de lecturas/commits y fallos `409 DATA_CONFLICT`, `413 DATA_LIMIT`, `503 DATA_UNAVAILABLE` / `DATA_RECOVERY_CLOSED` usando clase sanitaria fija (`d1_storage`).
3. En `src/lib/sarin/engine.ts`:
   * Instrumentar `completeChat`, `completePlatformSupport` y `probeEngine` capturando frontera exacta (`'engine_ollama' | 'engine_deepseek' | 'engine_gemini'`), duración y clasificación precisa (`TIMEOUT`, `UPSTREAM_4XX`, `UPSTREAM_5XX`, `CONFIG_INVALID`, `RESPONSE_INVALID`, `TRANSPORT_UNAVAILABLE`) en el punto de fallo antes de convertirla a `HttpError(503)` hacia el cliente.
4. En `src/lib/server/operational-signals.ts`:
   * Mantener colector acotado por proceso (`globalThis`) con contadores `signalWriteFailures` y `signalReadFailures`.
   * Exportar `readOperationalSignalsOverview(actor: { uid: string }, db?: Database, options?: { now?: number; dispatchAlerts?: boolean; alertClient?: { sendText: ... } }): Promise<OperationalSignalsOverview>`:
     * Consulta cada fuente con `try/catch` independiente y lecturas directas `.get()` (evita `runTransaction` para no fallar bajo `SARIN_RECOVERY_MODE === 'recovery'`), marcando `'unknown'` y sumando `signalReadFailures` si una fuente falla o contiene datos corruptos:
       1. Colector local + `getSarinQueueOperationalMetrics()`.
       2. `serverSettings/operationalSignalsWorker` y `serverSettings/operationalSignals`.
       3. `responseQuotaTurns` usando el índice existente (`where('status', '==', 'reserved').orderBy('__name__').limit(100)`) distinguiendo `needs_review` (`legacy_unknown`/sin `execution`) y turnos `reserved` vencidos por `startedAt`/`deadlineAt`, más `aiBudgetCalls` (`where('status', '==', 'uncertain').limit(100)`).
       4. `serverSettings/pilotAiBudget` (con `DEFAULT_AI_BUDGET_LIMITS` cuando no esté configurado y verificación de `paused`/`reason`), `aiBudgetPeriods/global_day_<Bogota>` + `global_month_<Bogota>` + lectura acotada de períodos por negocio del día/mes actual (`limit(100)`) y overrides `pilotAiBudgetBusiness_*`; `serverSettings/platform_whatsapp_budget`, `platformWhatsAppSpending/{day,month}` y `platformWhatsAppBudgetPeriods` (`audio`, `generation`, `send`); más `readAdminAiUsage(..., 'deepseek' | 'gemini').telemetryWriteFailures`.
     * Evalúa las 6 familias con `evaluateOperationalSignals` y concilia incidentes con `reconcileIncidentCooldowns`. Si cambia estado, persiste `serverSettings/operationalSignals` bajo transacción aislada (fallo suma `signalWriteFailures` sin afectar retorno `200`).
   * Exportar `dispatchOperationalAlertsIfEnabled(overview, db, options)`:
     * Apagado por defecto: si `process.env.SARIN_OPERATIONAL_ALERTS_ENABLED !== 'true'` o `process.env.SARIN_MAINTENANCE === 'true'` o `recoveryRestricted(process.env)`, no hace llamadas externas y conserva estado `'disabled'`.
     * Cuando se habilita explícitamente (en pruebas mediante fixture/mock; producción solo tras `RELEASE-FLAGS`/`RELEASE-SEND`), resuelve `platformSettings/platform_support_recipient`, vínculo vigente en `platformWhatsAppLinks`, `supportNotificationSourcePhone` (si expiró la ventana de 24h o devuelve `null`, registra `'skipped_unconfigured'` limpio), `serverSettings/platform_whatsapp`, `PLATFORM_YCLOUD_API_KEY`, presupuesto administrativo (`platform-whatsapp-admin-budget.ts`) y llama `sendText` usando exclusivamente la plantilla sanitizada `[Sarin Ops][${severity}] ${family}:${code} (${observedAtBogota}) alsdevstudio.com`. Registra `sent`, `failed` (`rejected`/`cancelled`/presupuesto cerrado) o `uncertain` (`unknown`/timeout) con cooldown de 6 h y cero reintento automático tras `uncertain`.
5. Rutas HTTP en Next:
   * `src/app/api/admin/operational-signals/route.ts`: `GET` protegido por `requireSuperadmin(request)` (`401` anónimo, `403` no superadmin), rechaza cualquier query (`400`) y responde `200` con `Cache-Control`, `CDN-Cache-Control` y `Cloudflare-CDN-Cache-Control: no-store`.
   * `src/app/api/internal/operational-signals/route.ts`: receptor interno invocado solo desde el DO/Worker Cron cuando `SARIN_OPERATIONAL_ALERTS_ENABLED === 'true'` (`x-sarin-ops-evaluate` limpiada por `router.ts` en tráfico público, donde `/api/internal/*` devuelve `404`), que evalúa y despacha alerta crítica si aplica sin depender de sesiones activas en `/admin`.

**Ciclo TDD (RED -> GREEN):**
* **RED:** En `tests/operational-signals-server.test.ts`:
  * Provocar errores clasificados (`TIMEOUT`, `UPSTREAM_4XX`, `UPSTREAM_5XX`, `CONFIG_INVALID`, `RESPONSE_INVALID`) en `engine.ts` (`ollama`, `deepseek`, `gemini`), `>= 5` reintentos CAS y `409`/`413`/`503` en `database.ts`, saturación `>= 50%` y `429` + recuperación posterior en `PriorityFifoQueue`, reservas `>= 15m` y `>= 24h`, presupuestos global/por negocio/`audio`/`generation`/`send` + `telemetryWriteFailures > 0`, y lectura bajo `SARIN_RECOVERY_MODE=recovery`.
  * Comprobar `GET /api/admin/operational-signals` (`401`, `403`, `400` con query, `200` `no-store`) y bloqueo público de `/api/internal/operational-signals`.
  * Verificar adaptador de alerta: apagado cuando `SARIN_OPERATIONAL_ALERTS_ENABLED` es `'false'` o ausente; en fixture habilitado, prueba de cooldown 6 h en `warning` y `critical`, escalada inmediata `warning -> critical`, registro `uncertain` sin segundo envío automático y degradación segura ante vínculo expirado o fallo de persistencia sin bloquear `completeChat` ni `runTransaction`.
  * Aserción negativa con cadenas canario sintéticas en respuesta API, documento D1/Firestore y mensaje enviado.
* **GREEN:** Implementar instrumentación en `queue.ts`, `database.ts`, `engine.ts`, servicio y rutas, verificando suites objetivo y regresión.

**Comandos de verificación:**
* `pnpm exec vitest run tests/operational-signals-server.test.ts tests/engine.test.ts tests/engine-budget.test.ts tests/engine-health.test.ts tests/chat.test.ts tests/response-quota-admin-route.test.ts`
* `pnpm run typecheck`

---

<a id="task4"></a>
### Tarea 4 (`R0-OBS-B4`): Panel consolidado en el Hub de superadministración (`DESIGN.md`)

**Dependencias:** `R0-OBS-B3`

**Archivos:**
* Crear:
  * `src/components/admin-operational-signals.tsx`
  * `tests/admin-operational-signals.test.tsx`
* Modificar:
  * `src/app/admin/page.tsx`
  * `tests/admin-modules.test.tsx`
  * `tests/admin-ai-usage.test.tsx`
  * `tests/admin-ai-page.test.tsx`
  * `tests/admin-whatsapp-page.test.tsx`
  * `tests/admin-focus-navigation.test.tsx`
  * `tests/billing-pages.test.tsx`
* Probar (incluidos regresión):
  * `tests/admin-operational-signals.test.tsx`
  * `tests/admin-modules.test.tsx`
  * `tests/admin-navigation.test.ts`
  * `tests/admin-ai-usage.test.tsx`
  * `tests/admin-ai-page.test.tsx`
  * `tests/admin-whatsapp-page.test.tsx`
  * `tests/admin-focus-navigation.test.tsx`
  * `tests/billing-pages.test.tsx`

**Interfaces y comportamiento exacto:**
1. En `src/components/admin-operational-signals.tsx`:
   * Componente `'use client'` sin `<section inert>` para no alterar el conteo de paneles del Hub (`11`).
   * Polling con `useApiPoll(uid, load, { intervalMs: 15_000 })` (`api-polling.ts` solo admite `5_000` o `15_000` ms) y validación estructural del snapshot antes de renderizar (resiste respuestas parciales o mocks ajenos sin lanzar error).
   * Cumplimiento estricto de [DESIGN.md](DESIGN.md) y `src/app/globals.css`:
     * Únicamente tokens existentes: `bg-sarin-paper`, `bg-sarin-canvas`, `bg-sarin-soft`, `border-sarin-line`, `text-sarin-ink`, `text-sarin-muted`, `text-sarin-blue` y badges legibles AA (`amber` para `warning`, `red` para `critical`, neutro para `ok` y `unknown`). Tipografía `DM Sans` y cifras con `tabular-nums`.
     * Botón `Actualizar señales` con `min-h-11` (`>= 44px`), layout responsive usable desde `320px` sin desbordamiento horizontal.
     * Muestra severidad general, las 6 familias con estado, cifra clave, umbral y marca temporal; bloque desplegable `<details>` con últimos eventos sanitizados (`boundary`, `errorClass`, `httpStatus`, `providerCode`), estado de alertas externas (`disabled | sent | failed | uncertain | skipped_unconfigured`) y degradación observada (`signalWriteFailures`, `signalReadFailures`, fuentes `'unknown'`).
2. En `src/app/admin/page.tsx`:
   * Montar `<AdminOperationalSignals uid={uid} />` dentro de `#admin-overview` (`Estado técnico`) cuando `data` existe, y mostrar el mismo componente bajo el error de carga cuando `!data && error` para que durante `SARIN_MAINTENANCE=true` (`/api/admin` devuelve `503` mientras `/api/admin/operational-signals` responde `200`) el operador siga accediendo a las señales técnicas sin quedar bloqueado por falta de `data`.
   * Mantener intactos `src/lib/admin-navigation.ts` (6 módulos) y las 11 `<AdminModulePanel>`.
3. En pruebas existentes de `AdminPage`:
   * Añadir mock aislado `vi.mock('@/components/admin-operational-signals', () => ({ AdminOperationalSignals: () => null }))` en `tests/admin-modules.test.tsx`, `tests/admin-ai-usage.test.tsx`, `tests/admin-ai-page.test.tsx`, `tests/admin-whatsapp-page.test.tsx`, `tests/admin-focus-navigation.test.tsx` y `tests/billing-pages.test.tsx` (igual al patrón ya usado en esos archivos para `AdminPlatformBudget`, `AdminInvitations`, `AdminAiSettings`, `AdminAiUsage`).

**Ciclo TDD (RED -> GREEN):**
* **RED:** En `tests/admin-operational-signals.test.tsx`, probar renderizado `ok`, `warning`, `critical` y `unknown`, visibilidad de `signalWriteFailures`/`signalReadFailures` y `deliveryState: 'uncertain'`, estado `disabled` por defecto, botón `Actualizar señales` (`min-h-11`), resistencia ante payload inválido y ausencia total de KPIs comerciales S17/R5 o secretos/cuerpos en el DOM. Verificar también montaje real en `AdminPage` en modo normal (`#admin-overview`) y modo contingencia sin `data` (mantenimiento).
* **GREEN:** Implementar `AdminOperationalSignals`, integrarlo en `src/app/admin/page.tsx`, actualizar los mocks de las 6 suites de consola y confirmar verde en todas.

**Comandos de verificación:**
* `pnpm exec vitest run tests/admin-operational-signals.test.tsx tests/admin-modules.test.tsx tests/admin-navigation.test.ts tests/admin-ai-usage.test.tsx tests/admin-ai-page.test.tsx tests/admin-whatsapp-page.test.tsx tests/admin-focus-navigation.test.tsx tests/billing-pages.test.tsx`
* `pnpm run typecheck`

---

<a id="task5"></a>
### Tarea 5 (`R0-OBS-I`): Gate de integración, backends reales (D1/Firestore), sanitización negativa y reporte QA

**Dependencias:** `R0-OBS-B1`, `R0-OBS-B2`, `R0-OBS-B3`, `R0-OBS-B4`

**Archivos:**
* Crear:
  * `tests/operational-signals.integration.test.ts`
  * `tests/operational-signals-firestore.test.ts`
  * `docs/qa/2026-11-13-sarin-operational-signals-integration.md`
* Modificar:
  * `scripts/firestore-emulator-tests.mjs`
* Probar (gate completo):
  * `tests/operational-signals.integration.test.ts`
  * `tests/operational-signals-firestore.test.ts`
  * `tests/firestore.rules.test.ts`
  * `tests/recovery-backup-classification.test.ts`
  * `tests/recovery-drill.test.ts`
  * `tests/admin-modules.test.tsx`
  * `cloudflare/tests/*.test.mjs`

**Alcance del gate de integración (`R0-OBS-I`):**
1. **Matriz de fallos y recuperación end-to-end (`tests/operational-signals.integration.test.ts`)**:
   * Integrar Worker (`index.ts`, `identity.ts`, `router.ts`, `data.ts`) y Contenedor (`database.ts`, `queue.ts`, `engine.ts`, `operational-signals.ts`, `/api/admin/operational-signals`, `/api/internal/operational-signals`) contra SQLite/D1 real local y `recovery-classification.mjs`:
     * **Fronteras motor e identidad:** fallo en `identity_wif` (`getJwks`/`mintToken`) y errores/latencia (`>= 3` en 15m, `p95 > 15s`, `> 5` consecutivos o `>= 5 min` caído) en `engine_ollama` / `engine_deepseek` / `engine_gemini` y `container_proxy` -> transiciones `warning`/`critical` y regreso a `'ok'` al avanzar la ventana.
     * **Contención D1:** transacciones con `>= 5` reintentos CAS y D1 `p95 > 2s` (`warning`), agotamiento `409 DATA_CONFLICT`, `413 DATA_LIMIT` y `503 DATA_UNAVAILABLE` (`critical`).
     * **Cola:** saturación `>= 50%` / `waitMsP95 > 30s` (`warning`), rechazos `429` por cupo o timeout (`critical`) y recuperación limpia al vaciar ventana.
     * **Reservas inciertas:** turnos `responseQuotaTurns` en `needs_review`/`reserved` y llamadas `aiBudgetCalls` en `uncertain` (`>= 15m` -> `warning`, `>= 24h` -> `critical`) + fallo de `recoverWorkerResponseQuota`.
     * **Cron y retención:** ejecución de `scheduled` con todas las subtareas, respaldo `20h`/`24h`, backlog `>= 3` ciclos, `invalidRecords=1`, `failedPhases=1`, clasificación del snapshot SQLite completo por `classifyBackupDocument` sin `D1_BACKUP_UNCLASSIFIED`, y supresión limpia en `SARIN_MAINTENANCE=true`.
     * **Presupuesto:** `80%` (`warning`), `100%` / `paused` (`critical`) en límites global y por negocio de `pilotAiBudget` y etapas de plataforma, más `telemetryWriteFailures > 0`.
     * **Mantenimiento y autoridad:** `GET /api/admin/operational-signals` en mantenimiento acepta solo Bearer válido de superadmin (`200`, `no-store`) y rechaza queries, fragmentos, `?` vacío y métodos ajenos; tráfico público a `/api/internal/operational-signals` sigue devolviendo `404`.
     * **Degradación segura:** fallo de escritura/lectura o corrupción deliberada en `serverSettings/operationalSignals*` marca `'unknown'` y suma `signalWriteFailures`/`signalReadFailures` sin bloquear citas, respuestas IA ni commits D1.
     * **Sanitización negativa y canal externo:** inyección de canarios sintéticos (`sk-canary-999`, `Bearer jwt-canary`, `+573005550199`, `persona@ejemplo.test`, `"cuerpo de cita confidencial"`) en fallos simulados comprobando ausencia total en D1, HTTP JSON, UI y texto de alerta mock; validar `SARIN_OPERATIONAL_ALERTS_ENABLED="false"` sin envíos, cooldown 6h, escalada `warning -> critical` y `uncertain` sin reintento ciego.
2. **Paridad y reglas en emulador Firestore (`tests/operational-signals-firestore.test.ts` + `scripts/firestore-emulator-tests.mjs`)**:
   * Registrar `tests/operational-signals-firestore.test.ts` en `scripts/firestore-emulator-tests.mjs`.
   * Verificar lectura/escritura administrativa en emulador Firestore (incluidas consultas sobre `responseQuotaTurns` y `aiBudgetCalls` sin requerir índices nuevos) y denegación estricta por `firestore.rules` ante clientes anónimos y autenticados sobre `serverSettings/operationalSignals` y `serverSettings/operationalSignalsWorker`.
3. **Verificación integral y cierre documentado (`docs/qa/2026-11-13-sarin-operational-signals-integration.md`)**:
   * Ejecutar todas las comprobaciones reales y registrar evidencia exacta:
     * `pnpm exec vitest run tests/operational-signals-model.test.ts tests/operational-signals-server.test.ts tests/admin-operational-signals.test.tsx tests/operational-signals.integration.test.ts tests/recovery-backup-classification.test.ts`
     * `pnpm run typecheck`
     * `pnpm test`
     * `pnpm run test:rules`
     * `pnpm --filter sarin-cloudflare-host run check`
     * `pnpm run build` y `pnpm run build:pages`
     * `node --test pages-gateway/tests/*.test.mjs`
     * `pnpm audit --audit-level=high`
   * Dejar constancia explícita en el reporte QA de que `observability.*` permanece `false`, `SARIN_OPERATIONAL_ALERTS_ENABLED` sigue en `"false"` y ninguna prueba ejecutó envíos reales de WhatsApp/YCloud ni inferencia pagada.

**Comandos de verificación del gate (`R0-OBS-I`):**
* `pnpm exec vitest run tests/operational-signals-model.test.ts tests/operational-signals-server.test.ts tests/admin-operational-signals.test.tsx tests/operational-signals.integration.test.ts`
* `pnpm run typecheck`
* `pnpm test`
* `pnpm run test:rules`
* `pnpm --filter sarin-cloudflare-host run check`
* `pnpm run build`
* `pnpm run build:pages`
* `node --test pages-gateway/tests/*.test.mjs`
* `pnpm audit --audit-level=high`

---

## Matriz de cobertura del contrato (`R0-OBS-D` y `R0-OBS-P`)

| Criterio | Descripción del requisito | Tarea(s) | Verificación principal |
| :--- | :--- | :--- | :--- |
| `OBS-01` | Seis familias técnicas con umbrales `warning`/`critical` y estado `unknown` | `B1`, `B2`, `B3`, `I` | `tests/operational-signals-model.test.ts`, `tests/operational-signals.integration.test.ts` |
| `OBS-02` | Separación estricta frente a métricas comerciales S17/R5 | `B1`, `B4`, `I` | `shared/operational-signals.ts`, `tests/admin-operational-signals.test.tsx` |
| `OBS-03` | `observability.*` en `false` y compatibilidad de `release-core.mjs` (`--keep-vars`) | `B2`, `I` | `cloudflare/tests/release.test.mjs`, `pnpm --filter sarin-cloudflare-host run check` |
| `OBS-04` | Sanitización negativa (`TIMEOUT`, `UPSTREAM_4XX`, `UPSTREAM_5XX`, `CONFIG_INVALID`, `RESPONSE_INVALID`, `TRANSPORT_UNAVAILABLE`; cero PII/secretos/cuerpos) | `B1`, `B2`, `B3`, `B4`, `I` | Canarios sintéticos en `model`, `server`, `ui` e `integration` tests |
| `OBS-05` | Clasificación D1 (`recovery-classification.mjs`) sin `D1_BACKUP_UNCLASSIFIED`, compatibilidad índices/reglas Firestore | `B1`, `I` | `tests/recovery-backup-classification.test.ts`, `pnpm run test:rules` |
| `OBS-06` | Huella `sha256(family:code:severity)`, cooldown 6h (`warning` y `critical`), escalada y `uncertain` sin reintento ciego | `B1`, `B3`, `I` | `tests/operational-signals-model.test.ts`, `tests/operational-signals-server.test.ts` |
| `OBS-07` | Canal externo apagado por defecto (`SARIN_OPERATIONAL_ALERTS_ENABLED="false"`), plantilla fija `[Sarin Ops]` y disparo Cron solo si está activo | `B2`, `B3`, `I` | `cloudflare/tests/router.test.mjs`, `tests/operational-signals-server.test.ts` |
| `OBS-08` | Lista blanca estricta en mantenimiento (`GET /api/admin/operational-signals`), `no-store` y `/api/internal/*` cerrado al público (`404`) | `B2`, `B3`, `I` | `cloudflare/tests/router.test.mjs`, `tests/operational-signals.integration.test.ts` |
| `OBS-09` | Degradación segura: fallos de lectura/escritura suman contadores y marcan `unknown` sin bloquear tráfico ni `runTransaction` | `B1`, `B2`, `B3`, `B4`, `I` | `cloudflare/tests/operational-signals.test.mjs`, `tests/operational-signals.integration.test.ts` |
| `OBS-10` | Panel consolidado en `/admin` (`DESIGN.md`, tokens `sarin-*`, soporte mantenimiento, 11 paneles preservados) | `B4`, `I` | `tests/admin-operational-signals.test.tsx`, `tests/admin-modules.test.tsx` |
