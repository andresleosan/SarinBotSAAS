# Señales operativas sin conversaciones: propuesta R0-OBS-D

Fecha de ruta del plan: 2026-10-30. Preparada el 13 de noviembre de 2026, America/Bogota, para la tarea `R0-OBS-D`.

**Estado: contrato propuesto v1 con decisiones del propietario incorporadas; pendiente de aprobación final del documento completo.** Este diseño no acredita código implementado, no habilita logs/traces nativos ni activa envíos, alertas o cambios operativos reales.

- Control y código canónico inspeccionado: `E:/Proyectos/Sarin Bot`, rama `main`.
- SHA de la fuente inspeccionada: `4153189685eaa2b71aa3f7e0ff9aa2ff8ba2e40c`.
- Estado de avance único: [tasks.json](../../implementation/fresha/tasks.json).

## Intención, alcance y separación frente a métricas comerciales

Definir el contrato técnico de observabilidad operativa de Sarin para que el superadministrador conozca la salud del runtime (errores y latencia de fronteras críticas, contención y límites D1, cola de inferencia, reservas inciertas, retención/copias y presupuesto operativo) sin almacenar ni exponer cuerpos de conversaciones, identidad de usuarios finales ni secretos, y manteniendo los logs/traces nativos apagados y el coste adicional en USD 0.

Separación estricta de dominios:

| Aspecto | Señales operativas `R0-OBS` | Métricas comerciales (`S17` y `R5` / `A10`) |
| --- | --- | --- |
| Destinatario y autoridad | Exclusivamente superadministrador (`requireSuperadmin`). | Dueño del establecimiento autorizado para su propio negocio. |
| Objeto medido | Salud técnica de infraestructura, D1, cola, Cron, copias, reservas técnicas pendientes y techos de presupuesto. | Conteo de citas, asistencia (`completed`, `no_show`, `cancelled`), ocupación, retorno e ingresos del negocio. |
| Fuentes existentes | `cloudflare/src/index.ts`, `cloudflare/src/data.ts`, `src/lib/storage/database.ts`, `src/lib/sarin/queue.ts`, `src/lib/sarin/engine.ts`, `cloudflare/src/recovery-backup.ts`, `cloudflare/src/response-quota-recovery.ts`, `src/lib/server/ai-budget.ts`, `src/lib/server/ai-usage.ts`. | `src/lib/owner-operation-summary.ts` (`summarizeOwnerOperation`), ledger y disponibilidad futuros de R2/R4/R5. |
| Regla de aislamiento | Nunca publica métricas de negocio por establecimiento ni expone estados técnicos internos a dueños o clientes. | Nunca deriva presupuestos de infraestructura ni salud de cola/D1 como métricas comerciales. |

## Hechos comprobados en la fuente actual

Inspección de solo lectura sobre el commit `4153189685eaa2b71aa3f7e0ff9aa2ff8ba2e40c` (sin ejecutar pruebas nuevas ni alterar producción):

| Superficie | Evidencia en código | Brecha operativa observada |
| --- | --- | --- |
| Release y observabilidad Cloudflare | `cloudflare/wrangler.jsonc:9,26,37`; `cloudflare/scripts/release-core.mjs:78,103` | `send_metrics: false` y `observability.enabled/logs/traces: false` en Worker y Container. `validateSnapshot` aborta con `OBSERVABILITY_DRIFT` si alguno se activa y `preservedHash` fija su configuración. |
| Cron y errores de contenedor | `cloudflare/src/index.ts:30-33,62-84` | `SarinApp.onError` omite payload/tokens/URLs. El Cron `*/5 * * * *` corre `scheduleRecoveryBackup`, `recoverWorkerResponseQuota`, `cleanupAdminPaymentRetention`, `cleanupPlatformSupportRetention` y `cleanupPlatformWhatsAppRetention`, pero solo escribe `console.info/warn/error` efímeros (descartados con `logs.enabled: false`), sin resumen durable de ejecución o backlog. |
| Driver D1 y límites | `cloudflare/src/data.ts:11-14,210-292`; `src/lib/storage/database.ts:43-56,107-173` | Límites `MAX_BODY = 8 MiB`, `MAX_DOCUMENT = 1 MiB`, `MAX_READ = 1000`, 100 escrituras por commit. `runTransaction` reintenta hasta 10 veces ante `409 DATA_CONFLICT`; transporte reintenta una sola vez en `503`. No hay métricas acumuladas de reintentos CAS, agotamientos 409, rechazos `413 DATA_LIMIT` ni `503 DATA_UNAVAILABLE`. |
| Cola de inferencia | `src/lib/sarin/queue.ts:11-75`; `src/app/api/sarin/health/route.ts:10-25`; `cloudflare/src/router.ts:106-136,154-180` | `PriorityFifoQueue` (`maxSlots=4`, `maxQueued=64`, `waitTimeoutMs=120_000`, 1 posición VIP para `CRITICAL`) solo expone instantánea puntual en `/api/sarin/health?scope=engine` (accesible en mantenimiento para superadmin). No registra pico de cola, latencia de espera ni rechazos `QueueBusyError` (429). |
| Motor IA, presupuesto y telemetría | `src/lib/sarin/engine.ts:72-79,194-200,213-341`; `src/lib/server/ai-budget.ts:16-30,136-171`; `src/lib/server/ai-usage.ts:21-25,67-120` | `engine.ts` sanea errores de `ollama`, `deepseek` y `gemini`. `ai-budget.ts` deja llamadas ambiguas en `status: 'uncertain'` y pausa `pilotAiBudget` si detecta modelo/tier inesperado o exceso de cuota reservada. `ai-usage.ts` guarda `telemetryWriteFailures` en memoria por proceso/mes/proveedor, sin consolidación conjunta. |
| Recuperación de cuota comercial | `cloudflare/src/response-quota-recovery.ts:7-46`; `shared/response-quota-recovery.ts:7-41`; `src/lib/server/response-quota-admin.ts:13-43` | El Cron resuelve turnos `reserved` vencidos y envía a cuarentena (`QUOTA_TERMINAL`) los `needs_review` (`legacy_unknown`), consultables por cursor en `/api/admin/response-quota`. Falta una señal agregada con conteo y antigüedad máxima de pendientes/cuarentena. |
| Copias de recuperación | `cloudflare/src/recovery-backup.ts:36-75` | `recoveryStatus` ya calcula `phase`, `health` (`missing`, `ok`, `warning` >= 20 h, `breached` > 24 h), `lastRecoverableAt`, `ages`, `bytes`, `durationMs`, `failureCode` y `gaps`, listos para integrarse en la vista del operador. |
| Destinatario operativo existente | `src/lib/server/platform-support-notifications.ts:23-145` | Existe el enlace y destinatario del superadministrador (`platformSettings/platform_support_recipient`, `kind: 'operator_notification'`), sujeto a vínculo vigente, ventana 24 h y presupuesto de envíos de plataforma. |

## Alternativas evaluadas y decisiones del propietario

Se compararon tres opciones de arquitectura y entrega para R0-OBS:

| Alternativa | Descripción y efecto | Coste y compatibilidad con release |
| --- | --- | --- |
| **A (elegida): Panel consolidado en el Hub + aviso externo opcional con cooldown por canal operativo existente** | Estado técnico sanitizado en el Hub de superadministración y canal opcional de alerta con cooldown de 6 h sobre el canal operativo existente del superadministrador, apagado por defecto hasta autorización en `RELEASE-FLAGS`/`RELEASE-SEND`. | Coste adicional USD 0; mantiene `observability.enabled/logs/traces = false` y preserva `release-core.mjs` sin deriva de observabilidad. |
| B (descartada): Solo panel bajo demanda en el Hub | Únicamente lectura manual en el Hub de superadministración sin capacidad opcional de aviso ante incidente crítico prolongado. | Menor cobertura ante degradación de copias/presupuesto/Cron fuera de sesión activa del operador. |
| C (descartada): Logs/traces nativos de Cloudflare o servicio externo | Activa `observability.logs/traces` en Wrangler o integra proveedor externo de monitoreo. | Exige cambiar el contrato de `release-core.mjs` (`OBSERVABILITY_DRIFT`), revisar el techo de USD 15/mes y ampliar superficie de datos en logs. |

### Decisiones recibidas el 13 de noviembre de 2026

1. **Canal, destinatario y coste (`signalDeliveryAndChannel`):** El propietario eligió la alternativa A: panel consolidado en el Hub de superadministración más aviso externo opcional con cooldown por el canal operativo existente del superadministrador (apagado hasta `RELEASE`), manteniendo logs/traces desactivados y coste adicional USD 0.
2. **Responsable, umbrales y enfriamiento (`thresholdsAndResponsibility`):** El propietario aprobó: superadministrador único responsable; umbrales en dos niveles (`warning` / `critical`) para las seis familias descritas abajo, con ventana de cooldown de 6 horas por incidente activo.
3. **Fallo y recuperación (`signalFailureAndRecoveryPolicy`):** El propietario aprobó: degradación segura sin bloquear el tráfico comercial ni repetir envíos inciertos; todo fallo de escritura de observabilidad incrementa un contador interno en memoria/estado y cualquier aviso externo fallido o incierto queda registrado sin reenviar a ciegas.

Estas respuestas fijan el alcance de `R0-OBS-D` y la base para `R0-OBS-P`. No autorizan envíos reales, activación de flags ni cambios de `observability` en Cloudflare.

## Catálogo de las seis familias de señales y umbrales

Cada familia expone un estado agregado (`ok`, `warning`, `critical`, o `unknown` cuando el componente no es consultable), contadores por ventana móvil y marcas temporales.

| Familia | Señales medidas (sanitizadas) | Umbral `warning` | Umbral `critical` |
| --- | --- | --- | --- |
| **1. Errores y latencia de fronteras** | Fallos y latencia p95 en `identity_wif` (`SarinIdentity`/JWKS), `engine_ollama`, `engine_deepseek`, `engine_gemini` y `container_proxy`, clasificados por clase fija (`TIMEOUT`, `UPSTREAM_4XX`, `UPSTREAM_5XX`, `CONFIG_INVALID`, `RESPONSE_INVALID`, `TRANSPORT_UNAVAILABLE`). | >= 3 fallos en ventana de 15 min en una frontera o latencia p95 del motor > 15 000 ms. | Indisponibilidad sostenida >= 5 min en motor o contenedor, > 5 fallos consecutivos en una frontera, o cualquier fallo de emisión/JWKS en `identity_wif`. |
| **2. Contención y límites D1 / almacenamiento** | Distribución de reintentos CAS por transacción, `conflictExhausted` (agotar 10 intentos con `409 DATA_CONFLICT`), `limitRejected413` (`413 DATA_LIMIT`), `unavailable503` (`503 DATA_UNAVAILABLE`) y duración p95 de lecturas/commits. | Transacciones que requieren >= 5 reintentos CAS en ventana de 5 min o latencia D1 p95 > 2 000 ms. | Cualquier transacción abortada por agotar los 10 reintentos (`409 DATA_CONFLICT`), cualquier `413 DATA_LIMIT` o cualquier `503 DATA_UNAVAILABLE`. |
| **3. Cola de inferencia (`PriorityFifoQueue`)** | Instantánea (`activeSlots`, `queuedRequests`, `criticalQueued`, `normalQueued`, `maxSlots`), pico de cola (`highWaterQueued`), espera p95 (`waitMsP95`), `rejectedFull429` (cola llena >= 64) y `rejectedTimeout429` (espera >= 120 000 ms). | `queuedRequests >= 32` (50 % de `maxQueued=64`) o `waitMsP95 > 30 000 ms`. | Cualquier rechazo `QueueBusyError` (429 por saturación de cola o por vencimiento de espera de 120 s). |
| **4. Reservas inciertas y recuperación** | Conteo y edad máxima de `responseQuotaTurns` en `needs_review` (`QUOTA_TERMINAL`), turnos `reserved` vencidos pendientes de barrido, registros de `aiBudgetCalls` en `status: 'uncertain'`, y resultado de `recoverWorkerResponseQuota`. | >= 1 turno en `needs_review` o llamada en `uncertain` con edad >= 15 min, o `morePending: true` en >= 3 ciclos de Cron. | Cualquier reserva/llamada incierta sin conciliar >= 24 h o fallo de ejecución de `recoverWorkerResponseQuota`. |
| **5. Retención y copias de recuperación (Cron)** | Último disparo y último éxito por sub-tarea del Cron (`recovery_backup`, `response_quota_recovery`, `admin_payment_retention`, `platform_support_retention`, `platform_whatsapp_retention`), contadores `clearedBodies`, `deletedMetadata`, `invalidRecords`, `failedPhases`, ciclos consecutivos con `morePending`, más `BackupStatus` (`phase`, `health`, `lastRecoverableAt`, `failureCode`, `gaps`). | `BackupStatus.health === 'warning'` (>= 20 h), cualquier cleaner con `morePending: true` durante >= 3 ciclos consecutivos (15 min) o Cron retrasado > 15 min. | `BackupStatus.health === 'breached'` (> 24 h) o fallo de copia tras agotar reintentos, cualquier `failedPhases > 0` o `invalidRecords > 0`, o Cron > 30 min sin completar. |
| **6. Presupuesto y coste operativo** | Porcentaje máximo de uso (`used + reserved`) diario/mensual global y por negocio en `pilotAiBudget` (tokens y USD), estado `paused` y `reason`, uso de presupuestos diarios de plataforma (`audio`, `generation`, `send`), `telemetryWriteFailures` y referencia al techo de USD 15/mes de infraestructura. | Uso >= 80 % de cualquier límite diario/mensual de `pilotAiBudget` o plataforma, o `telemetryWriteFailures > 0`. | Uso al 100 % (`AI_BUDGET_EXHAUSTED` / `PLATFORM_WORK_CLOSED`), `pilotAiBudget.paused === true` (`unexpected_model_or_tier` o `usage_exceeded_reserved_bound`), o desbordamiento proyectado del techo operativo. |

## Minimización, sanitización y privacidad

Toda señal registrada, consultada o enviada como aviso externo cumple estrictamente estas reglas de minimización:

1. **Datos prohibidos:** nunca almacenar ni emitir cuerpos de mensajes o conversaciones, prompts, respuestas del modelo, argumentos de herramientas, teléfonos (`phoneE164`, `customerPhone`), direcciones de correo, UIDs en claro de clientes o dueños, nombres de negocios o personas, encabezados `Authorization`, `subject_token`, claves API, cookies, URLs firmadas ni rutas del sistema de archivos.
2. **Sanitización de errores:** los fallos capturados desde proveedores externos (`ollama`, `deepseek`, `gemini`, `ycloud`, `cloudflare`, `firebase`) o de almacenamiento/red se reducen en origen a una tupla cerrada: `{ boundary, errorClass, httpStatus, providerCode }`, siguiendo el patrón de `commandDiagnostic` (`cloudflare/scripts/release-core.mjs:25-38`). Nunca se persiste ni se muestra `error.message` libre ni el `stack` de la excepción.
3. **Identificadores opacos:** si una métrica necesita referirse a una entidad sin exponer datos personales (por ejemplo, identificar el negocio con mayor consumo o una huella de incidente), solo se usan agregados o los hashes SHA-256 opacos ya definidos en `ai-budget.ts` / `response-quota-records.ts`.
4. **Cero cuerpos en el Durable Object y logs desactivados:** `SarinApp` y `SarinIdentity` no almacenan métricas de aplicación en su almacenamiento DO; `wrangler.jsonc` conserva `send_metrics: false` y `observability.enabled/logs/traces: false`.

## Arquitectura, autoridad, avisos con cooldown y degradación

### 1. Recolección acotada y persistencia sin carga por petición

- **Acumulación en memoria de tamaño constante:** el Worker (`cloudflare/src/`) y el contenedor Node (`src/lib/`) mantienen contadores por ventana fija (anillo acotado de buckets de 5 minutos, máximo 12 buckets = 1 hora; arreglo acotado de latencias para estimación p95) sin crecer con el volumen de tráfico y sin abrir transacciones D1 extra durante las peticiones normales de reserva o chat.
- **Consolidación en Cron (`*/5 * * * *`):** al cierre de cada ciclo de Cron (cuando no esté en modo restringido de recuperación ni en mantenimiento bloqueante), el Worker evalúa los agregados acumulados desde el último corte junto con `recoveryStatus`, el conteo acotado de `responseQuotaTurns` en `needs_review` (limitado a página acotada igual que `response-quota-recovery.ts`) y los resultados de retención, escribiendo un único resumen consolidado sanitizado bajo ruta privada controlada por allowlist estricta en `cloudflare/src/data.ts` (p. ej. `serverSettings/operationalSignals`, con esquema Zod compartido en `shared/`).
- **Lectura en tiempo real para el contenedor:** durante las peticiones del panel administrativo, Next lee en memoria su propia cola (`PriorityFifoQueue`), latencias/errores del motor, `pilotAiBudget` / `aiUsage` (telemetría best-effort) y el resumen durable del Worker/Cron.

### 2. Autoridad y compatibilidad en mantenimiento

- **Endpoint exclusivo:** `GET /api/admin/operational-signals` autorizado únicamente por `requireSuperadmin(request)`, con respuesta `Cache-Control: no-store`, `CDN-Cache-Control: no-store` y `Cloudflare-CDN-Cache-Control: no-store`. Anónimos devuelven `401`; clientes y dueños de negocio devuelven `403`.
- **Disponible en mantenimiento:** `cloudflare/src/router.ts:145-161` permitirá `GET /api/admin/operational-signals` durante `SARIN_MAINTENANCE=true` bajo las mismas reglas estrictas ya usadas para `/api/sarin/health?scope=engine`, `/api/admin/abuse` y `/api/admin/booking-data-policy` (requiere método `GET`, sin fragmento ni parámetros ajenos, cabecera `Authorization: Bearer <token>` y validación posterior de `requireSuperadmin` en Next).

### 3. Avisos externos opcionales con cooldown de 6 h

- **Apagado por defecto:** gobernado por flag explícito `SARIN_OPERATIONAL_ALERTS_ENABLED` (valor `"false"` versionado en `wrangler.jsonc` y validado en `runtimeEnvironment` como booleano estricto). Su habilitación real queda reservada a `RELEASE-FLAGS` / `RELEASE-SEND`.
- **Deduplicación y cooldown de 6 h:** cada señal activa genera una huella técnica `incidentKey = sha256(family + ':' + code + ':' + severity)`. Se mantiene en el estado operativo de señales un mapa acotado de incidentes recientes (`lastAlertAt`, `lastSeverity`, `deliveryState`, `cooldownUntil` = `lastAlertAt + 6 * 3600 * 1000`, máximo 64 entradas activas/recientes).
  - Si un incidente sigue en el mismo nivel (`warning` o `critical`) antes de cumplirse `cooldownUntil`, no se emite otro aviso externo.
  - Si escala de `warning` a `critical`, se considera cambio de severidad y habilita un aviso inmediato con nueva marca `cooldownUntil`.
  - Cuando todas las señales de esa huella vuelven a `ok`, el incidente se marca resuelto en el estado; una reaparición posterior inicia un nuevo ciclo.
- **Transporte y destinatario:** reutiliza exclusivamente el canal operativo ya configurado y vigente del superadministrador (`platformSettings/platform_support_recipient` / `operator_notification` cuando esté activo y en presupuesto, o el canal administrativo aprobado en `RELEASE-SEND`), enviando una plantilla fija de solo códigos técnicos: `[Sarin Ops][<severity>] <family>:<code > (<observedAtBogota>)`.

### 4. Degradación segura y contrato de `release-core.mjs`

- **Fallo de registro o lectura de señales:** si falla la persistencia del resumen operativo o la consulta de una fuente secundaria, la operación comercial o de inferencia continúa sin abortar ni reintentar llamadas de negocio. El proceso incrementa un contador local (`signalWriteFailures` o `signalReadFailures`) y el panel muestra `unknown` o el último timestamp válido para esa familia sin ocultar el fallo de observación.
- **Fallo o incertidumbre de aviso externo:** si al intentar encolar o entregar un aviso externo el transporte responde error o queda en estado incierto (`started` / timeout / pérdida de ACK), se registra `deliveryState: 'failed' | 'uncertain'` en el incidente junto con la fecha y el cooldown vigente. **Nunca se reenvía a ciegas un intento incierto.** El superadministrador ve el estado de entrega en el Hub.
- **Preservación de `release-core.mjs`:** se conserva `observability: { enabled: false, logs: { enabled: false }, traces: { enabled: false } }` en `cloudflare/wrangler.jsonc` y la comprobación `OBSERVABILITY_DRIFT` en `cloudflare/scripts/release-core.mjs:78`. Añadir la variable de entorno plana `SARIN_OPERATIONAL_ALERTS_ENABLED: "false"` es compatible con `validateSnapshot` siempre que `runtimeEnvironment` en `router.ts` valide `'true' | 'false'` y `recoveryRestricted` la fuerce a `'false'`.

## Pruebas de recepción en fixture frente a entrega real

Para `R0-OBS-P` y sus hijos de construcción/integración, toda prueba automatizada usa datos sintéticos `demo-*` y un adaptador de envío controlado en memoria/fixture (nunca producción ni destinatarios reales):

1. **Simulación de fallos por frontera y Cron:** provocar errores en `identity_wif`, `engine_ollama`, `engine_deepseek`, `engine_gemini`, `container_proxy` y en cada fase del Cron; comprobar clasificación (`TIMEOUT`, `UPSTREAM_4XX`, `UPSTREAM_5XX`, etc.), transición exacta a `warning` y `critical` y disponibilidad durante `SARIN_MAINTENANCE=true`.
2. **Contención D1 y saturación de cola:** simular transacciones con 5 reintentos CAS (`warning`), agotamiento de 10 reintentos `409 DATA_CONFLICT`, `413 DATA_LIMIT` y `503 DATA_UNAVAILABLE` (`critical`); llenar `PriorityFifoQueue` al 50 % (`warning`) y provocar `QueueBusyError` 429 por cupo y timeout de 120 s (`critical`).
3. **Reservas inciertas, copias y presupuesto:** crear fixtures de `responseQuotaTurns` en `needs_review` y `aiBudgetCalls` en `uncertain` (>= 15 min -> `warning`, >= 24 h -> `critical`), `BackupStatus` a 20 h / 24 h, y uso de presupuesto al 80 % / 100 % / `paused: true`; verificar umbrales exactos y que `R0-OBS` nunca altera contadores de cuota o citas comerciales (`S17`).
4. **Cooldown de 6 h y escalada:** emitir la misma señal repetida dentro de 6 horas y comprobar una sola entrega en fixture; escalar de `warning` a `critical` y comprobar el segundo aviso; resolver a `ok` y reabrir para confirmar nuevo ciclo.
5. **Auditoría de sanitización con inyección sintética:** inyectar cadenas sensibles (`Bearer token-secreto`, `+573001234567`, `cliente@demo.test`, cuerpos JSON de chat y UIDs reales) en errores simulados de proveedor y almacenamiento; verificar por aserción negativa en el documento persistido, en la respuesta HTTP y en el payload del sumidero de alerta que ninguno de esos fragmentos aparece.
6. **Degradación segura y autoridad:** provocar fallo de escritura de `operationalSignals` durante una operación de chat/reserva y comprobar que la operación principal termina con éxito y suma `signalWriteFailures`; provocar resultado incierto del envío de alerta y comprobar que no hay segundo envío; rechazar acceso anónimo (`401`), cliente y dueño (`403`) y validar cabeceras `no-store` para superadmin (`200`).
7. **Entrega real:** cualquier habilitación real de `SARIN_OPERATIONAL_ALERTS_ENABLED` o prueba real contra el destinatario del superadministrador queda fuera de `R0-OBS-P`/construcción y sujeta a `RELEASE-FLAGS` y `RELEASE-SEND` con autorización explícita.

## Mapa para el desglose `R0-OBS-P`

Cuando este diseño quede aprobado, `R0-OBS-P` desglosará hijos mínimos de construcción (`build`) e integración (`integration`) respetando `ponytail`:

1. Esquema compartido sanitizado y agregador acotado en memoria + política de evaluación de umbrales y cooldown (`shared/`).
2. Integración en Worker/Cron/D1 (`cloudflare/src/index.ts`, `data.ts`, `router.ts`, `response-quota-recovery.ts`) y endpoint `GET /api/admin/operational-signals` + puente hacia `engine.ts`, `queue.ts`, `ai-budget.ts`, `ai-usage.ts` y `database.ts`.
3. Vista consolidada en el Hub de superadministración siguiendo `DESIGN.md` (Agenda clara) + adaptador de aviso opcional apagado por defecto y su prueba en fixture.
4. Gate de integración `R0-OBS-I`, reencadenando `R0-READY` a su cierre.

## Revisión y continuación

Las tres decisiones materiales (`signalDeliveryAndChannel`, `thresholdsAndResponsibility` y `signalFailureAndRecoveryPolicy`) quedaron incorporadas según las respuestas recibidas el 13 de noviembre de 2026.

Esta versión v1 completa se presenta para aprobación expresa del propietario identificada por su SHA-256. Solo después de recibir esa aprobación explícita se registrará `contractApproval` en `tasks.json`, se versionará este documento en `origin/main` y se cerrará `R0-OBS-D` como `verified`. La tarea `R0-OBS-P` corresponde a la siguiente invocación de `/avanzar`.
