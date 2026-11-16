import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  OPERATIONAL_SIGNALS_DOC_PATH,
  OPERATIONAL_SIGNALS_WORKER_DOC_PATH,
  SIGNAL_COOLDOWN_MS,
  SIGNAL_FAMILIES,
  SIGNAL_MAX_INCIDENTS,
  SIGNAL_MAX_RECENT_ERRORS,
  SIGNAL_SEVERITIES,
  SIGNAL_WINDOW_BUCKETS,
  SIGNAL_WINDOW_BUCKET_MS,
  createOperationalCollector,
  evaluateOperationalSignals,
  formatOperationalAlertMessage,
  operationalSignalsOverviewSchema,
  operationalSignalsStateSchema,
  operationalSignalsWorkerSchema,
  reconcileIncidentCooldowns,
  sanitizeOperationalError,
  type OperationalEvaluationInput,
  type OperationalSignalsState,
  type OperationalSignalsWorker,
} from '../shared/operational-signals';

const BASE_TIME = 1_800_000_000_000;

function makeHealthyWorker(now = BASE_TIME): OperationalSignalsWorker {
  const subtask = {
    lastAttemptAt: now - 60_000,
    lastSuccessAt: now - 60_000,
    failed: false,
    morePending: false,
    invalidRecords: 0,
    failedPhases: 0,
    clearedBodies: 0,
    deletedMetadata: 0,
  };
  return {
    version: 1,
    updatedAt: now,
    maintenanceSkipped: false,
    cronLastAttemptAt: now - 60_000,
    cronLastSuccessAt: now - 60_000,
    backlogCycles: 0,
    cronConsecutiveFailures: 0,
    subtasks: {
      recovery_backup: { ...subtask },
      response_quota_recovery: { ...subtask },
      admin_payment_retention: { ...subtask },
      platform_support_retention: { ...subtask },
      platform_whatsapp_retention: { ...subtask },
    },
    backup: {
      phase: 'sealed',
      health: 'ok',
      lastRecoverableAt: now - 3_600_000,
      failureCode: null,
      gaps: { weeks: [], months: [] },
    },
    identityWifFailures15m: 0,
    containerProxyFailures15m: 0,
    recentErrors: [],
    signalWriteFailures: 0,
  };
}

type TestEvaluationInput = OperationalEvaluationInput & {
  worker: NonNullable<OperationalEvaluationInput['worker']>;
  queueLive: NonNullable<OperationalEvaluationInput['queueLive']>;
  uncertainReservations: NonNullable<OperationalEvaluationInput['uncertainReservations']>;
  budgets: NonNullable<OperationalEvaluationInput['budgets']>;
};

function makeHealthyEvaluationInput(now = BASE_TIME, collector = createOperationalCollector({ now: () => now })): TestEvaluationInput {
  return {
    now,
    maintenanceMode: false,
    collector: collector.snapshot(now),
    worker: { available: true, data: makeHealthyWorker(now) },
    queueLive: {
      available: true,
      stats: { activeSlots: 1, queuedRequests: 0, criticalQueued: 0, normalQueued: 0, maxSlots: 4 },
    },
    uncertainReservations: {
      available: true,
      reservedOverdueCount: 0,
      needsReviewCount: 0,
      aiUncertainCount: 0,
      oldestAgeMs: null,
      quotaRecoveryMorePending: false,
      quotaRecoveryFailed: false,
    },
    budgets: {
      available: true,
      maxRatio: 0.25,
      paused: false,
      blocked: false,
      pauseCode: null,
      telemetryWriteFailures: 0,
    },
    signalWriteFailures: 0,
    signalReadFailures: 0,
  };
}

describe('operational signals model, sanitizer, collector and cooldowns', () => {
  it('exposes exact contract constants and strips PII/secret canaries in sanitizeOperationalError', () => {
    expect(SIGNAL_SEVERITIES).toEqual(['ok', 'warning', 'critical', 'unknown']);
    expect(SIGNAL_FAMILIES).toHaveLength(6);
    expect(SIGNAL_WINDOW_BUCKET_MS).toBe(300_000);
    expect(SIGNAL_WINDOW_BUCKETS).toBe(12);
    expect(SIGNAL_COOLDOWN_MS).toBe(21_600_000);
    expect(OPERATIONAL_SIGNALS_DOC_PATH).toBe('serverSettings/operationalSignals');
    expect(OPERATIONAL_SIGNALS_WORKER_DOC_PATH).toBe('serverSettings/operationalSignalsWorker');

    const valid = sanitizeOperationalError({
      boundary: 'engine_deepseek',
      errorClass: 'TIMEOUT',
      httpStatus: 504,
      providerCode: 'GATEWAY_TIMEOUT',
    });
    expect(valid).toEqual({
      boundary: 'engine_deepseek',
      errorClass: 'TIMEOUT',
      httpStatus: 504,
      providerCode: 'GATEWAY_TIMEOUT',
    });

    expect(sanitizeOperationalError({ boundary: 'engine_gemini', httpStatus: 429, providerCode: 'RATE_LIMIT_429' })).toEqual({
      boundary: 'engine_gemini',
      errorClass: 'UPSTREAM_4XX',
      httpStatus: 429,
      providerCode: 'RATE_LIMIT_429',
    });

    const canaries = [
      'Bearer jwt-canary',
      'sk-canary-999',
      '+573005550199',
      'persona@ejemplo.test',
      '{"text":"cuerpo de cita confidencial"}',
      '/api/internal/secret?token=abc',
      'code_longer_than_thirty_two_characters_total',
    ];
    for (const canary of canaries) {
      const sanitized = sanitizeOperationalError({
        boundary: 'engine_ollama',
        httpStatus: 502.5,
        providerCode: canary,
        ...({ message: canary, stack: canary, phoneE164: '+573005550199', authorization: 'Bearer jwt-canary' } as Record<string, unknown>),
      });
      expect(sanitized).toEqual({
        boundary: 'engine_ollama',
        errorClass: 'UNKNOWN',
        httpStatus: null,
        providerCode: null,
      });
      expect(JSON.stringify(sanitized)).not.toContain(canary);
      expect(JSON.stringify(sanitized)).not.toContain('jwt-canary');
    }

    expect(sanitizeOperationalError({ boundary: 'container_proxy', httpStatus: 99 }).httpStatus).toBeNull();
    expect(sanitizeOperationalError({ boundary: 'container_proxy', httpStatus: 600 }).httpStatus).toBeNull();
  });

  it('rotates 5m, 15m and 60m buckets cleanly without permanent stickiness and degrades safely without throwing', () => {
    const collector = createOperationalCollector({ maxLatencySamples: 10 });

    // Record burst at t = BASE_TIME
    for (let i = 0; i < 4; i++) {
      collector.recordBoundaryError({ boundary: 'engine_deepseek', errorClass: 'UPSTREAM_5XX', httpStatus: 502 }, BASE_TIME + i * 1000);
    }
    collector.recordBoundarySuccess('engine_deepseek', 120, BASE_TIME + 5000);
    for (let i = 0; i < 15; i++) {
      collector.recordBoundarySuccess('engine_ollama', 100 + i * 100, BASE_TIME + 10_000 + i);
    }
    collector.recordD1Operation({ latencyMs: 2500, attempts: 6 }, BASE_TIME + 1000);
    collector.recordD1Operation({ latencyMs: 100, attempts: 1, statusCode: 409, errorCode: 'DATA_CONFLICT' }, BASE_TIME + 2000);
    collector.recordQueueDepth(40, BASE_TIME + 1000);
    collector.recordQueueWait(35_000, BASE_TIME + 1500);
    collector.recordQueueRejection('full', BASE_TIME + 2000);

    const atStart = collector.snapshot(BASE_TIME + 20_000);
    expect(atStart.windows.m5.boundaryErrors.engine_deepseek).toBe(4);
    expect(atStart.windows.m5.d1.casRetriesMax).toBe(5);
    expect(atStart.windows.m5.d1.conflictExhausted).toBe(1);
    expect(atStart.windows.m5.queue.highWaterQueued).toBe(40);
    expect(atStart.windows.m5.queue.rejectedFull429).toBe(1);
    expect(atStart.windows.m5.engineLatency.count).toBeLessThanOrEqual(10);

    // After 5 min, 5m window clears while 15m and 60m still observe the event
    const at5m = collector.snapshot(BASE_TIME + SIGNAL_WINDOW_BUCKET_MS);
    expect(at5m.windows.m5.d1.casRetriesMax).toBe(0);
    expect(at5m.windows.m5.d1.p95Ms).toBeNull();
    expect(at5m.windows.m15.d1.casRetriesMax).toBe(5);
    expect(at5m.windows.m15.queue.highWaterQueued).toBe(40);

    // After 15 min, 15m clears while 60m still holds historical count
    const at15m = collector.snapshot(BASE_TIME + 3 * SIGNAL_WINDOW_BUCKET_MS);
    expect(at15m.windows.m15.boundaryErrors.engine_deepseek).toBe(0);
    expect(at15m.windows.m15.queue.highWaterQueued).toBe(0);
    expect(at15m.windows.m15.queue.rejectedFull429).toBe(0);
    expect(at15m.windows.m60.boundaryErrors.engine_deepseek).toBe(4);

    // After 60 min, 60m clears completely
    const at60m = collector.snapshot(BASE_TIME + 12 * SIGNAL_WINDOW_BUCKET_MS);
    expect(at60m.windows.m60.boundaryErrors.engine_deepseek).toBe(0);
    expect(at60m.windows.m60.d1.conflictExhausted).toBe(0);
    expect(at60m.windows.m60.queue.rejectedFull429).toBe(0);

    // Recent errors cap at 16 and internal errors never throw
    for (let i = 0; i < 25; i++) {
      collector.recordBoundaryError({ boundary: 'engine_ollama', errorClass: 'TIMEOUT' }, BASE_TIME + i);
    }
    expect(collector.snapshot(BASE_TIME + 30).recentErrors).toHaveLength(SIGNAL_MAX_RECENT_ERRORS);

    const poisonedInput = new Proxy({}, {
      get() { throw new Error('telemetry boom'); },
    }) as unknown as Parameters<typeof collector.recordD1Operation>[0];
    expect(() => collector.recordD1Operation(poisonedInput, BASE_TIME + 40)).not.toThrow();
    expect(collector.snapshot(BASE_TIME + 40).signalWriteFailures).toBe(1);
  });

  it('evaluates exact ok/warning/critical/unknown thresholds across all 6 families', () => {
    // 1. All healthy
    const healthy = evaluateOperationalSignals(makeHealthyEvaluationInput(BASE_TIME));
    expect(healthy.overallSeverity).toBe('ok');
    for (const family of SIGNAL_FAMILIES) expect(healthy.families[family].severity).toBe('ok');
    expect(() => operationalSignalsOverviewSchema.parse(healthy)).not.toThrow();

    // 2. Engine errors & latency: warning (>=3 in 15m or p95 > 15s), critical (identity_wif, >5 consecutive, >=5m outage)
    const c1 = createOperationalCollector();
    for (let i = 0; i < 3; i++) c1.recordBoundaryError({ boundary: 'engine_deepseek', errorClass: 'UPSTREAM_5XX' }, BASE_TIME + i * 1000);
    let eval1 = evaluateOperationalSignals(makeHealthyEvaluationInput(BASE_TIME + 5000, c1));
    expect(eval1.families.engine_errors_and_latency.severity).toBe('warning');

    // Cooldown after 15m -> ok
    eval1 = evaluateOperationalSignals(makeHealthyEvaluationInput(BASE_TIME + 15 * 60_000, c1));
    expect(eval1.families.engine_errors_and_latency.severity).toBe('ok');

    // Latency p95 > 15_000 ms -> warning (1/20 at 16_000 keeps p95 at 1_000; 2/20 lifts p95 to 16_000)
    const cLat = createOperationalCollector();
    for (let i = 0; i < 20; i++) cLat.recordBoundarySuccess('engine_ollama', i === 19 ? 16_000 : 1_000, BASE_TIME + i);
    expect(evaluateOperationalSignals(makeHealthyEvaluationInput(BASE_TIME + 1000, cLat)).families.engine_errors_and_latency.severity).toBe('ok');
    cLat.recordBoundarySuccess('engine_ollama', 16_000, BASE_TIME + 20);
    expect(evaluateOperationalSignals(makeHealthyEvaluationInput(BASE_TIME + 1000, cLat)).families.engine_errors_and_latency.severity).toBe('warning');

    // >5 consecutive failures -> critical, resets on success
    const cConsec = createOperationalCollector();
    for (let i = 0; i < 6; i++) cConsec.recordBoundaryError({ boundary: 'engine_gemini', errorClass: 'TIMEOUT' }, BASE_TIME + i * 1000);
    expect(evaluateOperationalSignals(makeHealthyEvaluationInput(BASE_TIME + 10_000, cConsec)).families.engine_errors_and_latency.severity).toBe('critical');
    cConsec.recordBoundarySuccess('engine_gemini', 500, BASE_TIME + 11_000);
    // Still >=3 in 15m window -> warning, then ok after 15m
    expect(evaluateOperationalSignals(makeHealthyEvaluationInput(BASE_TIME + 12_000, cConsec)).families.engine_errors_and_latency.severity).toBe('warning');
    expect(evaluateOperationalSignals(makeHealthyEvaluationInput(BASE_TIME + 16 * 60_000, cConsec)).families.engine_errors_and_latency.severity).toBe('ok');

    // Sustained outage >= 5 min -> critical
    const cOutage = createOperationalCollector();
    cOutage.recordBoundaryError({ boundary: 'container_proxy', errorClass: 'TRANSPORT_UNAVAILABLE' }, BASE_TIME);
    cOutage.recordBoundaryError({ boundary: 'container_proxy', errorClass: 'TRANSPORT_UNAVAILABLE' }, BASE_TIME + 300_000);
    expect(evaluateOperationalSignals(makeHealthyEvaluationInput(BASE_TIME + 301_000, cOutage)).families.engine_errors_and_latency.severity).toBe('critical');

    // Any identity_wif failure in Worker -> critical
    const wifInput = makeHealthyEvaluationInput(BASE_TIME);
    wifInput.worker.data!.identityWifFailures15m = 1;
    expect(evaluateOperationalSignals(wifInput).families.engine_errors_and_latency.severity).toBe('critical');

    // 3. D1 contention: warning (casRetries >= 5 in 5m or p95 > 2000ms), critical (409 exhausted, 413, 503)
    const cD1 = createOperationalCollector();
    cD1.recordD1Operation({ latencyMs: 100, attempts: 6 }, BASE_TIME);
    expect(evaluateOperationalSignals(makeHealthyEvaluationInput(BASE_TIME + 1000, cD1)).families.d1_contention.severity).toBe('warning');
    expect(evaluateOperationalSignals(makeHealthyEvaluationInput(BASE_TIME + 5 * 60_000, cD1)).families.d1_contention.severity).toBe('ok');

    const cD1Lat = createOperationalCollector();
    cD1Lat.recordD1Operation({ latencyMs: 2100, attempts: 1 }, BASE_TIME);
    expect(evaluateOperationalSignals(makeHealthyEvaluationInput(BASE_TIME + 1000, cD1Lat)).families.d1_contention.severity).toBe('warning');

    for (const statusCode of [409, 413, 503]) {
      const cCrit = createOperationalCollector();
      cCrit.recordD1Operation({ latencyMs: 100, statusCode }, BASE_TIME);
      expect(evaluateOperationalSignals(makeHealthyEvaluationInput(BASE_TIME + 1000, cCrit)).families.d1_contention.severity).toBe('critical');
    }

    // 4. Queue pressure: warning (>=32 or waitP95 > 30s), critical (429 full/timeout)
    const qWarn = makeHealthyEvaluationInput(BASE_TIME);
    qWarn.queueLive.stats!.queuedRequests = 32;
    expect(evaluateOperationalSignals(qWarn).families.queue_pressure.severity).toBe('warning');

    const cQueue = createOperationalCollector();
    cQueue.recordQueueWait(31_000, BASE_TIME);
    expect(evaluateOperationalSignals(makeHealthyEvaluationInput(BASE_TIME + 1000, cQueue)).families.queue_pressure.severity).toBe('warning');
    cQueue.recordQueueRejection('timeout', BASE_TIME + 2000);
    expect(evaluateOperationalSignals(makeHealthyEvaluationInput(BASE_TIME + 3000, cQueue)).families.queue_pressure.severity).toBe('critical');
    expect(evaluateOperationalSignals(makeHealthyEvaluationInput(BASE_TIME + 16 * 60_000, cQueue)).families.queue_pressure.severity).toBe('ok');

    // 5. Uncertain reservations: warning (>=15m or >=3 pending cycles), critical (>=24h or quotaRecoveryFailed)
    const resWarn = makeHealthyEvaluationInput(BASE_TIME);
    resWarn.uncertainReservations = { available: true, reservedOverdueCount: 1, needsReviewCount: 0, aiUncertainCount: 0, oldestAgeMs: 900_000 };
    expect(evaluateOperationalSignals(resWarn).families.uncertain_reservations.severity).toBe('warning');
    resWarn.uncertainReservations.oldestAgeMs = 86_400_000;
    expect(evaluateOperationalSignals(resWarn).families.uncertain_reservations.severity).toBe('critical');

    const resBacklog = makeHealthyEvaluationInput(BASE_TIME);
    resBacklog.worker.data!.backlogCycles = 3;
    resBacklog.worker.data!.subtasks.response_quota_recovery.morePending = true;
    resBacklog.uncertainReservations.quotaRecoveryMorePending = true;
    expect(evaluateOperationalSignals(resBacklog).families.uncertain_reservations.severity).toBe('warning');
    resBacklog.uncertainReservations.quotaRecoveryFailed = true;
    expect(evaluateOperationalSignals(resBacklog).families.uncertain_reservations.severity).toBe('critical');

    // 6. Cron & retention: maintenance suppressed, warning (20h, backlog>=3, cron>15m), critical (24h breached, failed, invalidRecords, failedPhases, cron>30m)
    const cronMaint = makeHealthyEvaluationInput(BASE_TIME);
    cronMaint.maintenanceMode = true;
    cronMaint.worker.data!.maintenanceSkipped = true;
    cronMaint.worker.data!.backup = { phase: 'disabled', health: 'missing', lastRecoverableAt: null, failureCode: null, gaps: { weeks: [], months: [] } };
    expect(evaluateOperationalSignals(cronMaint).families.cron_and_retention.severity).toBe('ok');

    const cronWarn = makeHealthyEvaluationInput(BASE_TIME);
    cronWarn.worker.data!.backup.health = 'warning';
    expect(evaluateOperationalSignals(cronWarn).families.cron_and_retention.severity).toBe('warning');

    const cronStale = makeHealthyEvaluationInput(BASE_TIME);
    cronStale.worker.data!.cronLastSuccessAt = BASE_TIME - 1_000_000;
    expect(evaluateOperationalSignals(cronStale).families.cron_and_retention.severity).toBe('warning');
    cronStale.worker.data!.cronLastSuccessAt = BASE_TIME - 1_900_000;
    expect(evaluateOperationalSignals(cronStale).families.cron_and_retention.severity).toBe('critical');

    const cronInvalid = makeHealthyEvaluationInput(BASE_TIME);
    cronInvalid.worker.data!.subtasks.platform_whatsapp_retention.invalidRecords = 1;
    expect(evaluateOperationalSignals(cronInvalid).families.cron_and_retention.severity).toBe('critical');

    // 7. Budgets: warning (>=80% or telemetryWriteFailures > 0), critical (>=100%, paused, blocked)
    const budWarn = makeHealthyEvaluationInput(BASE_TIME);
    budWarn.budgets.maxRatio = 0.8;
    expect(evaluateOperationalSignals(budWarn).families.ai_and_whatsapp_budget.severity).toBe('warning');
    budWarn.budgets.maxRatio = 0.1;
    budWarn.budgets.telemetryWriteFailures = 1;
    expect(evaluateOperationalSignals(budWarn).families.ai_and_whatsapp_budget.severity).toBe('warning');
    budWarn.budgets.maxRatio = 1.0;
    expect(evaluateOperationalSignals(budWarn).families.ai_and_whatsapp_budget.severity).toBe('critical');
    budWarn.budgets.maxRatio = 0.2;
    budWarn.budgets.paused = true;
    expect(evaluateOperationalSignals(budWarn).families.ai_and_whatsapp_budget.severity).toBe('critical');

    // 8. Unavailable sources produce 'unknown' (never 'ok') unless critical
    const unavailableInput = makeHealthyEvaluationInput(BASE_TIME);
    unavailableInput.worker = { available: false, data: null };
    unavailableInput.uncertainReservations = { available: false, reservedOverdueCount: 0, needsReviewCount: 0, aiUncertainCount: 0, oldestAgeMs: null };
    unavailableInput.budgets = { available: false, maxRatio: null, paused: false, blocked: false, telemetryWriteFailures: 0 };
    const evalUnk = evaluateOperationalSignals(unavailableInput);
    expect(evalUnk.families.cron_and_retention.severity).toBe('unknown');
    expect(evalUnk.families.engine_errors_and_latency.severity).toBe('unknown');
    expect(evalUnk.families.uncertain_reservations.severity).toBe('unknown');
    expect(evalUnk.families.ai_and_whatsapp_budget.severity).toBe('unknown');
    expect(evalUnk.degradation.unknownFamilies).toEqual(expect.arrayContaining(['cron_and_retention', 'engine_errors_and_latency', 'uncertain_reservations', 'ai_and_whatsapp_budget']));
    expect(evalUnk.overallSeverity).toBe('unknown');
  });

  it('computes sha256(family:code:severity), enforces 6h cooldown, escalates warning->critical, resets on ok, and never retries uncertain', async () => {
    const c = createOperationalCollector();
    c.recordD1Operation({ latencyMs: 100, attempts: 6 }, BASE_TIME);
    const evalWarn = evaluateOperationalSignals(makeHealthyEvaluationInput(BASE_TIME + 1000, c));
    const warnCode = evalWarn.families.d1_contention.code;
    const expectedWarnKey = createHash('sha256').update(`d1_contention:${warnCode}:warning`).digest('hex');

    // Initial warning -> alert queued
    const r1 = await reconcileIncidentCooldowns(null, evalWarn, { alertsEnabled: true });
    expect(r1.alertsToDispatch).toHaveLength(1);
    expect(r1.alertsToDispatch[0].incidentKey).toBe(expectedWarnKey);
    expect(r1.alertsToDispatch[0].formattedMessage).toMatch(/^\[Sarin Ops\]\[warning\] d1_contention:/);
    expect(r1.alertsToDispatch[0].formattedMessage).toContain('alsdevstudio.com');

    // Mark sent at t = BASE_TIME + 1000
    const stateAfterSend: OperationalSignalsState = {
      ...r1.state,
      incidents: r1.state.incidents.map(inc => ({
        ...inc,
        lastAlertAt: BASE_TIME + 1000,
        cooldownUntil: BASE_TIME + 1000 + SIGNAL_COOLDOWN_MS,
        deliveryState: 'sent',
      })),
    };

    // Same warning within 6h -> suppressed
    const cSame = createOperationalCollector();
    cSame.recordD1Operation({ latencyMs: 100, attempts: 6 }, BASE_TIME + 3_600_000);
    const evalSame = evaluateOperationalSignals(makeHealthyEvaluationInput(BASE_TIME + 3_600_000, cSame));
    const r2 = await reconcileIncidentCooldowns(stateAfterSend, evalSame, { alertsEnabled: true });
    expect(r2.alertsToDispatch).toHaveLength(0);

    // Escalate warning -> critical within 6h -> immediate dispatch
    cSame.recordD1Operation({ latencyMs: 100, statusCode: 409 }, BASE_TIME + 3_605_000);
    const evalCrit = evaluateOperationalSignals(makeHealthyEvaluationInput(BASE_TIME + 3_605_000, cSame));
    const r3 = await reconcileIncidentCooldowns(r2.state, evalCrit, { alertsEnabled: true });
    expect(r3.alertsToDispatch).toHaveLength(1);
    expect(r3.alertsToDispatch[0].severity).toBe('critical');
    const warnRecord = r3.state.incidents.find(inc => inc.incidentKey === expectedWarnKey);
    expect(warnRecord?.resolvedAt).toBe(BASE_TIME + 3_605_000);

    // Mark critical alert as 'uncertain' -> never auto-retries even after >6h
    const uncertainState: OperationalSignalsState = {
      ...r3.state,
      incidents: r3.state.incidents.map(inc => inc.resolvedAt === null
        ? { ...inc, lastAlertAt: BASE_TIME + 3_605_000, cooldownUntil: BASE_TIME + 3_605_000 + SIGNAL_COOLDOWN_MS, deliveryState: 'uncertain', lastAlertErrorClass: 'ALERT_UNCERTAIN' }
        : inc),
    };
    const cAfter7h = createOperationalCollector();
    cAfter7h.recordD1Operation({ latencyMs: 100, statusCode: 409 }, BASE_TIME + 7 * 3_600_000);
    const evalAfter7h = evaluateOperationalSignals(makeHealthyEvaluationInput(BASE_TIME + 7 * 3_600_000, cAfter7h));
    const r4 = await reconcileIncidentCooldowns(uncertainState, evalAfter7h, { alertsEnabled: true });
    expect(r4.alertsToDispatch).toHaveLength(0);
    expect(r4.state.incidents.find(inc => inc.resolvedAt === null)?.deliveryState).toBe('uncertain');

    // Recover to ok -> resolves active incident; later reappearance starts fresh cycle
    const evalOk = evaluateOperationalSignals(makeHealthyEvaluationInput(BASE_TIME + 8 * 3_600_000));
    const r5 = await reconcileIncidentCooldowns(r4.state, evalOk, { alertsEnabled: true });
    expect(r5.state.incidents.every(inc => inc.resolvedAt !== null)).toBe(true);

    const cReopen = createOperationalCollector();
    cReopen.recordD1Operation({ latencyMs: 100, statusCode: 409 }, BASE_TIME + 8 * 3_600_000 + 60_000);
    const evalReopen = evaluateOperationalSignals(makeHealthyEvaluationInput(BASE_TIME + 8 * 3_600_000 + 60_000, cReopen));
    const r6 = await reconcileIncidentCooldowns(r5.state, evalReopen, { alertsEnabled: true });
    expect(r6.alertsToDispatch).toHaveLength(1);
    expect(r6.state.incidents.find(inc => inc.resolvedAt === null)?.deliveryState).toBe('none');
  });

  it('caps incidents at 64 keeping active ones and validates strict Zod schemas', async () => {
    const existingIncidents = Array.from({ length: SIGNAL_MAX_INCIDENTS }, (_, i) => ({
      incidentKey: createHash('sha256').update(`resolved:${i}`).digest('hex'),
      family: 'd1_contention' as const,
      code: `OLD_${i}`,
      lastSeverity: 'warning' as const,
      firstSeenAt: BASE_TIME - 100_000 + i,
      lastSeenAt: BASE_TIME - 100_000 + i,
      lastAlertAt: BASE_TIME - 100_000 + i,
      cooldownUntil: BASE_TIME - 100_000 + i + SIGNAL_COOLDOWN_MS,
      resolvedAt: BASE_TIME - 50_000 + i,
      deliveryState: 'sent' as const,
      lastAlertErrorClass: null,
    }));
    const prevState: OperationalSignalsState = {
      version: 1,
      updatedAt: BASE_TIME - 1000,
      alertsEnabled: false,
      signalWriteFailures: 0,
      signalReadFailures: 0,
      incidents: existingIncidents,
    };

    const c = createOperationalCollector();
    c.recordD1Operation({ latencyMs: 100, statusCode: 503 }, BASE_TIME);
    const evalCrit = evaluateOperationalSignals(makeHealthyEvaluationInput(BASE_TIME + 1000, c));
    const res = await reconcileIncidentCooldowns(prevState, evalCrit, { alertsEnabled: false });

    expect(res.state.incidents).toHaveLength(SIGNAL_MAX_INCIDENTS);
    expect(res.state.incidents.some(inc => inc.resolvedAt === null)).toBe(true);
    expect(() => operationalSignalsStateSchema.parse(res.state)).not.toThrow();
    expect(() => operationalSignalsStateSchema.parse({ ...res.state, unexpected: 'x' })).toThrow();

    const worker = makeHealthyWorker(BASE_TIME);
    expect(() => operationalSignalsWorkerSchema.parse(worker)).not.toThrow();
    expect(() => operationalSignalsWorkerSchema.parse({ ...worker, unexpected: 'x' })).toThrow();

    const msg = formatOperationalAlertMessage({
      severity: 'critical',
      family: 'd1_contention',
      code: 'D1_UNAVAILABLE_503',
      observedAt: BASE_TIME,
    });
    expect(msg).toMatch(/^\[Sarin Ops\]\[critical\] d1_contention:D1_UNAVAILABLE_503 \(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} COT\) alsdevstudio\.com$/);
  });

  it('expires worker boundary windows after 15m, re-notifies after 6h sent cooldown, and treats missing collector as unknown', async () => {
    // 1. Missing collector marks local collector-backed families as unknown
    const noCollector = makeHealthyEvaluationInput(BASE_TIME);
    const evalNoCol = evaluateOperationalSignals({ ...noCollector, collector: null });
    expect(evalNoCol.families.engine_errors_and_latency.severity).toBe('unknown');
    expect(evalNoCol.families.d1_contention.severity).toBe('unknown');
    expect(evalNoCol.families.queue_pressure.severity).toBe('unknown');

    // 2. Worker boundaryWindows filter cleanly by 15m buckets and stale fallback expires
    const staleWorkerInput = makeHealthyEvaluationInput(BASE_TIME);
    staleWorkerInput.worker.data!.identityWifFailures15m = 2;
    staleWorkerInput.worker.data!.updatedAt = BASE_TIME - 900_000;
    expect(evaluateOperationalSignals(staleWorkerInput).families.engine_errors_and_latency.severity).toBe('ok');

    const bucketedWorkerInput = makeHealthyEvaluationInput(BASE_TIME);
    bucketedWorkerInput.worker.data!.boundaryWindows = [
      { bucketStartAt: Math.floor(BASE_TIME / SIGNAL_WINDOW_BUCKET_MS) * SIGNAL_WINDOW_BUCKET_MS - 4 * SIGNAL_WINDOW_BUCKET_MS, identityWifFailures: 3, containerProxyFailures: 0 },
      { bucketStartAt: Math.floor(BASE_TIME / SIGNAL_WINDOW_BUCKET_MS) * SIGNAL_WINDOW_BUCKET_MS, identityWifFailures: 0, containerProxyFailures: 3 },
    ];
    expect(evaluateOperationalSignals(bucketedWorkerInput).families.engine_errors_and_latency.severity).toBe('warning');

    // 3. After 6h cooldown expires on a 'sent' incident, same level re-notifies
    const c = createOperationalCollector();
    c.recordD1Operation({ latencyMs: 100, statusCode: 409 }, BASE_TIME);
    const ev1 = evaluateOperationalSignals(makeHealthyEvaluationInput(BASE_TIME + 1000, c));
    const rec1 = await reconcileIncidentCooldowns(null, ev1, { alertsEnabled: true });
    expect(rec1.alertsToDispatch).toHaveLength(1);
    const sentState: OperationalSignalsState = {
      ...rec1.state,
      incidents: rec1.state.incidents.map(inc => ({
        ...inc,
        lastAlertAt: BASE_TIME + 1000,
        cooldownUntil: BASE_TIME + 1000 + SIGNAL_COOLDOWN_MS,
        deliveryState: 'sent',
      })),
    };
    const c2 = createOperationalCollector();
    c2.recordD1Operation({ latencyMs: 100, statusCode: 409 }, BASE_TIME + SIGNAL_COOLDOWN_MS + 1000);
    const ev2 = evaluateOperationalSignals(makeHealthyEvaluationInput(BASE_TIME + SIGNAL_COOLDOWN_MS + 1000, c2));
    const rec2 = await reconcileIncidentCooldowns(sentState, ev2, { alertsEnabled: true });
    expect(rec2.alertsToDispatch).toHaveLength(1);

    // 4. Overview schema rejects PII/secret strings injected into technical fields
    expect(() => operationalSignalsOverviewSchema.parse({
      ...ev2,
      families: {
        ...ev2.families,
        d1_contention: { ...ev2.families.d1_contention, code: 'Bearer jwt-canary' },
      },
    })).toThrow();
    expect(() => operationalSignalsOverviewSchema.parse({
      ...ev2,
      families: {
        ...ev2.families,
        d1_contention: { ...ev2.families.d1_contention, metrics: { bad: 'persona@ejemplo.test' } },
      },
    })).toThrow();
  });
});
