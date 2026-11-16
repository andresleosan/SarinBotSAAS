import { z } from 'zod';
import type { BackupStatus } from './recovery-backup.ts';

export const SIGNAL_FAMILIES = [
  'engine_errors_and_latency',
  'd1_contention',
  'queue_pressure',
  'uncertain_reservations',
  'cron_and_retention',
  'ai_and_whatsapp_budget',
] as const;

export const SIGNAL_SEVERITIES = ['ok', 'warning', 'critical', 'unknown'] as const;

export const SIGNAL_BOUNDARIES = [
  'identity_wif',
  'engine_ollama',
  'engine_deepseek',
  'engine_gemini',
  'container_proxy',
  'd1_storage',
  'queue',
  'recovery_backup',
  'response_quota_recovery',
  'admin_payment_retention',
  'platform_support_retention',
  'platform_whatsapp_retention',
  'budget_ai',
  'budget_whatsapp',
  'alert_channel',
] as const;

export const SIGNAL_ERROR_CLASSES = [
  'TIMEOUT',
  'UPSTREAM_4XX',
  'UPSTREAM_5XX',
  'CONFIG_INVALID',
  'RESPONSE_INVALID',
  'TRANSPORT_UNAVAILABLE',
  'NONE',
  'QUOTA_BUSY',
  'CONFLICT_EXHAUSTED',
  'STORAGE_LIMIT',
  'BACKUP_OVERDUE',
  'RETENTION_INCOMPLETE',
  'CRON_STALE',
  'CRON_FAILED',
  'BUDGET_BLOCKED',
  'ALERT_REJECTED',
  'ALERT_UNCERTAIN',
  'TELEMETRY_DEGRADED',
  'UNKNOWN',
] as const;

export const SIGNAL_CRON_SUBTASKS = [
  'recovery_backup',
  'response_quota_recovery',
  'admin_payment_retention',
  'platform_support_retention',
  'platform_whatsapp_retention',
] as const;

export const SIGNAL_DELIVERY_STATES = [
  'none',
  'disabled',
  'sent',
  'failed',
  'uncertain',
  'skipped_unconfigured',
] as const;

export const SIGNAL_WINDOW_BUCKET_MS = 300_000;
export const SIGNAL_WINDOW_BUCKETS = 12;
export const SIGNAL_COOLDOWN_MS = 21_600_000;
export const SIGNAL_MAX_RECENT_ERRORS = 16;
export const SIGNAL_MAX_INCIDENTS = 64;
export const SIGNAL_MAX_LATENCY_SAMPLES = 256;
export const OPERATIONAL_SIGNALS_DOC_PATH = 'serverSettings/operationalSignals';
export const OPERATIONAL_SIGNALS_WORKER_DOC_PATH = 'serverSettings/operationalSignalsWorker';
export const OPERATIONAL_ALERTS_HOST = 'alsdevstudio.com';

const ENGINE_OR_IDENTITY_BOUNDARIES = [
  'identity_wif',
  'engine_ollama',
  'engine_deepseek',
  'engine_gemini',
  'container_proxy',
] as const;

export type SignalFamily = (typeof SIGNAL_FAMILIES)[number];
export type SignalSeverity = (typeof SIGNAL_SEVERITIES)[number];
export type SignalBoundary = (typeof SIGNAL_BOUNDARIES)[number];
export type SignalErrorClass = (typeof SIGNAL_ERROR_CLASSES)[number];
export type SignalCronSubtask = (typeof SIGNAL_CRON_SUBTASKS)[number];
export type SignalDeliveryState = (typeof SIGNAL_DELIVERY_STATES)[number];
export type EngineOrIdentityBoundary = (typeof ENGINE_OR_IDENTITY_BOUNDARIES)[number];
export type SignalMetricUnit = 'count' | 'ms' | 'percent' | 'age_ms' | 'status';

const nonNegInt = z.number().int().nonnegative().safe();
const shortCodeSchema = z.string().regex(/^[A-Za-z0-9_.-]{1,32}$/);
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const SECRET_PREFIX_PATTERN = /^(?:sk[-_]|pk[-_]|rk[-_]|AIza|eyJ|gh[pousr]_|xox[baprs]-|Bearer)/i;

export const signalFamilySchema = z.enum(SIGNAL_FAMILIES);
export const signalSeveritySchema = z.enum(SIGNAL_SEVERITIES);
export const signalBoundarySchema = z.enum(SIGNAL_BOUNDARIES);
export const signalErrorClassSchema = z.enum(SIGNAL_ERROR_CLASSES);
export const signalDeliveryStateSchema = z.enum(SIGNAL_DELIVERY_STATES);

export const sanitizedErrorDiagnosticSchema = z.object({
  boundary: signalBoundarySchema,
  errorClass: signalErrorClassSchema,
  httpStatus: z.number().int().min(100).max(599).nullable(),
  providerCode: shortCodeSchema.nullable(),
}).strict();

export type SanitizedErrorDiagnostic = z.infer<typeof sanitizedErrorDiagnosticSchema>;

export const recentSignalErrorSchema = sanitizedErrorDiagnosticSchema.extend({
  observedAt: nonNegInt,
}).strict();

export type RecentSignalError = z.infer<typeof recentSignalErrorSchema>;

export const workerSubtaskSummarySchema = z.object({
  lastAttemptAt: nonNegInt.nullable(),
  lastSuccessAt: nonNegInt.nullable(),
  failed: z.boolean(),
  morePending: z.boolean(),
  invalidRecords: nonNegInt,
  failedPhases: nonNegInt,
  clearedBodies: nonNegInt.optional(),
  deletedMetadata: nonNegInt.optional(),
}).strict();

export type WorkerSubtaskSummary = z.infer<typeof workerSubtaskSummarySchema>;

export const workerBackupSummarySchema = z.object({
  phase: z.enum(['disabled', 'idle', 'preparing', 'copying', 'verifying', 'sealed', 'failed'] satisfies readonly BackupStatus['phase'][]),
  health: z.enum(['missing', 'ok', 'warning', 'breached'] satisfies readonly BackupStatus['health'][]),
  lastRecoverableAt: nonNegInt.nullable(),
  failureCode: shortCodeSchema.nullable(),
  gaps: z.object({
    weeks: z.array(shortCodeSchema).max(16),
    months: z.array(shortCodeSchema).max(16),
  }).strict(),
}).strict();

export const workerBoundaryWindowSchema = z.object({
  bucketStartAt: nonNegInt,
  identityWifFailures: nonNegInt,
  containerProxyFailures: nonNegInt,
}).strict();

export const workerBoundaryStreakSchema = z.object({
  identityWifConsecutive: nonNegInt,
  identityWifOutageStartedAt: nonNegInt.nullable(),
  identityWifLastFailureAt: nonNegInt.nullable(),
  containerProxyConsecutive: nonNegInt,
  containerProxyOutageStartedAt: nonNegInt.nullable(),
  containerProxyLastFailureAt: nonNegInt.nullable(),
}).strict();

export const operationalSignalsWorkerSchema = z.object({
  version: z.literal(1),
  updatedAt: nonNegInt,
  maintenanceSkipped: z.boolean(),
  cronLastAttemptAt: nonNegInt.nullable(),
  cronLastSuccessAt: nonNegInt.nullable(),
  backlogCycles: nonNegInt,
  cronConsecutiveFailures: nonNegInt,
  subtasks: z.object({
    recovery_backup: workerSubtaskSummarySchema,
    response_quota_recovery: workerSubtaskSummarySchema,
    admin_payment_retention: workerSubtaskSummarySchema,
    platform_support_retention: workerSubtaskSummarySchema,
    platform_whatsapp_retention: workerSubtaskSummarySchema,
  }).strict(),
  backup: workerBackupSummarySchema,
  identityWifFailures15m: nonNegInt,
  containerProxyFailures15m: nonNegInt,
  recentErrors: z.array(recentSignalErrorSchema).max(SIGNAL_MAX_RECENT_ERRORS),
  signalWriteFailures: nonNegInt,
  boundaryWindows: z.array(workerBoundaryWindowSchema).max(SIGNAL_WINDOW_BUCKETS).optional(),
  boundaryStreaks: workerBoundaryStreakSchema.optional(),
}).strict();

export type OperationalSignalsWorker = z.infer<typeof operationalSignalsWorkerSchema>;

export const operationalIncidentRecordSchema = z.object({
  incidentKey: sha256Schema,
  family: signalFamilySchema,
  code: shortCodeSchema,
  lastSeverity: z.enum(['warning', 'critical']),
  firstSeenAt: nonNegInt,
  lastSeenAt: nonNegInt,
  lastAlertAt: nonNegInt.nullable(),
  cooldownUntil: nonNegInt.nullable(),
  resolvedAt: nonNegInt.nullable(),
  deliveryState: signalDeliveryStateSchema,
  lastAlertErrorClass: signalErrorClassSchema.nullable(),
}).strict();

export type OperationalIncidentRecord = z.infer<typeof operationalIncidentRecordSchema>;

export const operationalSignalsStateSchema = z.object({
  version: z.literal(1),
  updatedAt: nonNegInt,
  alertsEnabled: z.boolean(),
  signalWriteFailures: nonNegInt,
  signalReadFailures: nonNegInt,
  incidents: z.array(operationalIncidentRecordSchema).max(SIGNAL_MAX_INCIDENTS),
}).strict();

export type OperationalSignalsState = z.infer<typeof operationalSignalsStateSchema>;

export const signalMetricValueSchema = z.union([
  z.number().finite(),
  z.boolean(),
  shortCodeSchema,
  z.null(),
]);

export type SignalMetricValue = z.infer<typeof signalMetricValueSchema>;

export const signalFamilySummarySchema = z.object({
  family: signalFamilySchema,
  severity: signalSeveritySchema,
  code: shortCodeSchema,
  observedAt: nonNegInt.nullable(),
  metricValue: z.number().finite().nullable(),
  metricUnit: z.enum(['count', 'ms', 'percent', 'age_ms', 'status']),
  thresholdLabel: z.string().regex(/^[A-Za-z0-9_.:/;,% >=<-]{1,80}$/),
  metrics: z.record(z.string().regex(/^[A-Za-z0-9_]{1,40}$/), signalMetricValueSchema),
}).strict();

export type SignalFamilySummary = z.infer<typeof signalFamilySummarySchema>;

export const operationalSignalsOverviewSchema = z.object({
  version: z.literal(1),
  generatedAt: nonNegInt,
  overallSeverity: signalSeveritySchema,
  alertsEnabled: z.boolean(),
  maintenanceMode: z.boolean(),
  families: z.object({
    engine_errors_and_latency: signalFamilySummarySchema,
    d1_contention: signalFamilySummarySchema,
    queue_pressure: signalFamilySummarySchema,
    uncertain_reservations: signalFamilySummarySchema,
    cron_and_retention: signalFamilySummarySchema,
    ai_and_whatsapp_budget: signalFamilySummarySchema,
  }).strict(),
  recentErrors: z.array(recentSignalErrorSchema).max(SIGNAL_MAX_RECENT_ERRORS),
  incidents: z.array(operationalIncidentRecordSchema).max(SIGNAL_MAX_INCIDENTS),
  degradation: z.object({
    signalWriteFailures: nonNegInt,
    signalReadFailures: nonNegInt,
    unknownFamilies: z.array(signalFamilySchema).max(6),
  }).strict(),
  alertDelivery: z.object({
    enabled: z.boolean(),
    latestState: signalDeliveryStateSchema,
    activeIncidentCount: nonNegInt,
    lastAlertAt: nonNegInt.nullable(),
    lastErrorClass: signalErrorClassSchema.nullable(),
  }).strict(),
}).strict();

export type OperationalSignalsOverview = z.infer<typeof operationalSignalsOverviewSchema>;

export function sanitizeOperationalError(input: {
  boundary: SignalBoundary;
  errorClass?: SignalErrorClass;
  httpStatus?: unknown;
  providerCode?: unknown;
}): SanitizedErrorDiagnostic {
  const boundary: SignalBoundary = (SIGNAL_BOUNDARIES as readonly string[]).includes(input.boundary)
    ? input.boundary
    : 'container_proxy';
  const httpStatus = typeof input.httpStatus === 'number'
    && Number.isInteger(input.httpStatus)
    && input.httpStatus >= 100
    && input.httpStatus <= 599
    ? input.httpStatus
    : null;
  const providerCode = typeof input.providerCode === 'string'
    && /^[A-Za-z0-9_.-]{1,32}$/.test(input.providerCode)
    && !SECRET_PREFIX_PATTERN.test(input.providerCode)
    ? input.providerCode
    : null;
  let errorClass: SignalErrorClass;
  if (typeof input.errorClass === 'string' && (SIGNAL_ERROR_CLASSES as readonly string[]).includes(input.errorClass)) {
    errorClass = input.errorClass;
  } else if (httpStatus !== null && httpStatus >= 400 && httpStatus < 500) {
    errorClass = 'UPSTREAM_4XX';
  } else if (httpStatus !== null && httpStatus >= 500) {
    errorClass = 'UPSTREAM_5XX';
  } else {
    errorClass = 'UNKNOWN';
  }
  return { boundary, errorClass, httpStatus, providerCode };
}

type TimedSample = { bucketStartAt: number; value: number };

type CollectorBucket = {
  bucketStartAt: number;
  boundaryErrors: Record<SignalBoundary, number>;
  d1CasRetriesMax: number;
  d1CasRetryWarnings: number;
  d1ConflictExhausted: number;
  d1LimitRejected413: number;
  d1Unavailable503: number;
  queueHighWaterQueued: number;
  queueRejectedFull429: number;
  queueRejectedTimeout429: number;
};

type BoundaryStreak = {
  consecutiveFailures: number;
  outageStartedAt: number | null;
  lastFailureAt: number | null;
};

export type WindowAggregate = {
  boundaryErrors: Record<SignalBoundary, number>;
  engineLatency: { count: number; p50Ms: number | null; p95Ms: number | null };
  d1: {
    count: number;
    p50Ms: number | null;
    p95Ms: number | null;
    casRetriesMax: number;
    casRetryWarnings: number;
    conflictExhausted: number;
    limitRejected413: number;
    unavailable503: number;
  };
  queue: {
    highWaterQueued: number;
    waitCount: number;
    waitP50Ms: number | null;
    waitP95Ms: number | null;
    rejectedFull429: number;
    rejectedTimeout429: number;
  };
};

export type OperationalCollectorSnapshot = {
  now: number;
  windows: { m5: WindowAggregate; m15: WindowAggregate; m60: WindowAggregate };
  boundaryStreaks: Record<EngineOrIdentityBoundary, BoundaryStreak>;
  recentErrors: RecentSignalError[];
  signalWriteFailures: number;
};

export type OperationalCollector = {
  recordBoundaryError: (input: { boundary: SignalBoundary; errorClass?: SignalErrorClass; httpStatus?: unknown; providerCode?: unknown }, at?: number) => SanitizedErrorDiagnostic | null;
  recordBoundarySuccess: (boundary: SignalBoundary, latencyMs?: number, at?: number) => void;
  recordD1Operation: (input: { latencyMs?: number; attempts?: number; statusCode?: number; errorCode?: string }, at?: number) => void;
  recordQueueDepth: (queuedRequests: number, at?: number) => void;
  recordQueueWait: (waitMs: number, at?: number) => void;
  recordQueueRejection: (kind: 'full' | 'timeout', at?: number) => void;
  recordWriteFailure: () => void;
  snapshot: (at?: number) => OperationalCollectorSnapshot;
};

function emptyBoundaryCounts(): Record<SignalBoundary, number> {
  return Object.fromEntries(SIGNAL_BOUNDARIES.map(boundary => [boundary, 0])) as Record<SignalBoundary, number>;
}

function emptyBucket(bucketStartAt = -1): CollectorBucket {
  return {
    bucketStartAt,
    boundaryErrors: emptyBoundaryCounts(),
    d1CasRetriesMax: 0,
    d1CasRetryWarnings: 0,
    d1ConflictExhausted: 0,
    d1LimitRejected413: 0,
    d1Unavailable503: 0,
    queueHighWaterQueued: 0,
    queueRejectedFull429: 0,
    queueRejectedTimeout429: 0,
  };
}

function percentile(values: readonly number[], quantile: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(quantile * sorted.length) - 1));
  return sorted[index];
}

function pushBoundedSample(ring: TimedSample[], maxSamples: number, bucketStartAt: number, value: number): void {
  if (!Number.isFinite(value) || value < 0 || maxSamples < 1) return;
  if (ring.length >= maxSamples) ring.shift();
  ring.push({ bucketStartAt, value: Math.round(value) });
}

function resolveNow(nowFn: () => number, at?: number): number {
  const value = at ?? nowFn();
  return Number.isSafeInteger(value) && value >= 0 ? value : Math.max(0, Math.floor(nowFn()));
}

function bucketStartFor(at: number): number {
  return Math.floor(at / SIGNAL_WINDOW_BUCKET_MS) * SIGNAL_WINDOW_BUCKET_MS;
}

export function createOperationalCollector(options?: { maxLatencySamples?: number; now?: () => number }): OperationalCollector {
  const maxSamples = Math.max(1, Math.min(2048, Math.floor(options?.maxLatencySamples ?? SIGNAL_MAX_LATENCY_SAMPLES)));
  const clock = options?.now ?? (() => Date.now());
  const buckets: CollectorBucket[] = Array.from({ length: SIGNAL_WINDOW_BUCKETS }, () => emptyBucket());
  const engineSamples: TimedSample[] = [];
  const d1Samples: TimedSample[] = [];
  const queueWaitSamples: TimedSample[] = [];
  const streaks = Object.fromEntries(
    ENGINE_OR_IDENTITY_BOUNDARIES.map(boundary => [boundary, { consecutiveFailures: 0, outageStartedAt: null, lastFailureAt: null }]),
  ) as Record<EngineOrIdentityBoundary, BoundaryStreak>;
  const recentErrors: RecentSignalError[] = [];
  let maxBucketStart = -1;
  let signalWriteFailures = 0;

  function acquireBucket(at: number): CollectorBucket | null {
    const start = bucketStartFor(at);
    if (maxBucketStart >= 0 && start < maxBucketStart - (SIGNAL_WINDOW_BUCKETS - 1) * SIGNAL_WINDOW_BUCKET_MS) {
      return null;
    }
    if (start > maxBucketStart) maxBucketStart = start;
    const index = ((Math.floor(start / SIGNAL_WINDOW_BUCKET_MS) % SIGNAL_WINDOW_BUCKETS) + SIGNAL_WINDOW_BUCKETS) % SIGNAL_WINDOW_BUCKETS;
    const current = buckets[index];
    if (current.bucketStartAt > start) return null;
    if (current.bucketStartAt !== start) buckets[index] = emptyBucket(start);
    return buckets[index];
  }

  function safeRun<T>(fallback: T, fn: () => T): T {
    try {
      return fn();
    } catch {
      signalWriteFailures++;
      return fallback;
    }
  }

  function aggregateWindow(currentBucketStart: number, bucketCount: number): WindowAggregate {
    const minStart = currentBucketStart - (bucketCount - 1) * SIGNAL_WINDOW_BUCKET_MS;
    const activeBuckets = buckets.filter(bucket => bucket.bucketStartAt >= minStart && bucket.bucketStartAt <= currentBucketStart);
    const boundaryErrors = emptyBoundaryCounts();
    let d1CasRetriesMax = 0;
    let d1CasRetryWarnings = 0;
    let d1ConflictExhausted = 0;
    let d1LimitRejected413 = 0;
    let d1Unavailable503 = 0;
    let queueHighWaterQueued = 0;
    let queueRejectedFull429 = 0;
    let queueRejectedTimeout429 = 0;

    for (const bucket of activeBuckets) {
      for (const boundary of SIGNAL_BOUNDARIES) {
        boundaryErrors[boundary] += bucket.boundaryErrors[boundary];
      }
      d1CasRetriesMax = Math.max(d1CasRetriesMax, bucket.d1CasRetriesMax);
      d1CasRetryWarnings += bucket.d1CasRetryWarnings;
      d1ConflictExhausted += bucket.d1ConflictExhausted;
      d1LimitRejected413 += bucket.d1LimitRejected413;
      d1Unavailable503 += bucket.d1Unavailable503;
      queueHighWaterQueued = Math.max(queueHighWaterQueued, bucket.queueHighWaterQueued);
      queueRejectedFull429 += bucket.queueRejectedFull429;
      queueRejectedTimeout429 += bucket.queueRejectedTimeout429;
    }

    const inRange = (samples: TimedSample[]) => samples
      .filter(sample => sample.bucketStartAt >= minStart && sample.bucketStartAt <= currentBucketStart)
      .map(sample => sample.value);

    const eng = inRange(engineSamples);
    const d1Lat = inRange(d1Samples);
    const qWait = inRange(queueWaitSamples);

    return {
      boundaryErrors,
      engineLatency: { count: eng.length, p50Ms: percentile(eng, 0.5), p95Ms: percentile(eng, 0.95) },
      d1: {
        count: d1Lat.length,
        p50Ms: percentile(d1Lat, 0.5),
        p95Ms: percentile(d1Lat, 0.95),
        casRetriesMax: d1CasRetriesMax,
        casRetryWarnings: d1CasRetryWarnings,
        conflictExhausted: d1ConflictExhausted,
        limitRejected413: d1LimitRejected413,
        unavailable503: d1Unavailable503,
      },
      queue: {
        highWaterQueued: queueHighWaterQueued,
        waitCount: qWait.length,
        waitP50Ms: percentile(qWait, 0.5),
        waitP95Ms: percentile(qWait, 0.95),
        rejectedFull429: queueRejectedFull429,
        rejectedTimeout429: queueRejectedTimeout429,
      },
    };
  }

  return {
    recordBoundaryError(input, at) {
      return safeRun<SanitizedErrorDiagnostic | null>(null, () => {
        const now = resolveNow(clock, at);
        const sanitized = sanitizeOperationalError(input);
        const bucket = acquireBucket(now);
        if (bucket) bucket.boundaryErrors[sanitized.boundary]++;
        if ((ENGINE_OR_IDENTITY_BOUNDARIES as readonly string[]).includes(sanitized.boundary)) {
          const streak = streaks[sanitized.boundary as EngineOrIdentityBoundary];
          streak.consecutiveFailures++;
          if (streak.outageStartedAt === null) streak.outageStartedAt = now;
          streak.lastFailureAt = now;
        }
        recentErrors.unshift({ ...sanitized, observedAt: now });
        if (recentErrors.length > SIGNAL_MAX_RECENT_ERRORS) recentErrors.length = SIGNAL_MAX_RECENT_ERRORS;
        return sanitized;
      });
    },
    recordBoundarySuccess(boundary, latencyMs, at) {
      safeRun(undefined, () => {
        const now = resolveNow(clock, at);
        if ((ENGINE_OR_IDENTITY_BOUNDARIES as readonly string[]).includes(boundary)) {
          streaks[boundary as EngineOrIdentityBoundary] = { consecutiveFailures: 0, outageStartedAt: null, lastFailureAt: null };
        }
        if (typeof latencyMs === 'number' && ['engine_ollama', 'engine_deepseek', 'engine_gemini'].includes(boundary)) {
          const start = bucketStartFor(now);
          if (maxBucketStart < 0 || start >= maxBucketStart - (SIGNAL_WINDOW_BUCKETS - 1) * SIGNAL_WINDOW_BUCKET_MS) {
            if (start > maxBucketStart) maxBucketStart = start;
            pushBoundedSample(engineSamples, maxSamples, start, latencyMs);
          }
        }
      });
    },
    recordD1Operation(input, at) {
      safeRun(undefined, () => {
        const now = resolveNow(clock, at);
        const bucket = acquireBucket(now);
        if (typeof input.latencyMs === 'number') {
          const start = bucketStartFor(now);
          if (maxBucketStart < 0 || start >= maxBucketStart - (SIGNAL_WINDOW_BUCKETS - 1) * SIGNAL_WINDOW_BUCKET_MS) {
            if (start > maxBucketStart) maxBucketStart = start;
            pushBoundedSample(d1Samples, maxSamples, start, input.latencyMs);
          }
        }
        if (!bucket) return;
        const retries = typeof input.attempts === 'number' && Number.isFinite(input.attempts) ? Math.max(0, Math.floor(input.attempts - 1)) : 0;
        if (retries > bucket.d1CasRetriesMax) bucket.d1CasRetriesMax = retries;
        if (retries >= 5) bucket.d1CasRetryWarnings++;
        if (input.statusCode === 409 || input.errorCode === 'DATA_CONFLICT') bucket.d1ConflictExhausted++;
        if (input.statusCode === 413 || input.errorCode === 'DATA_LIMIT') bucket.d1LimitRejected413++;
        if (input.statusCode === 503 || input.errorCode === 'DATA_UNAVAILABLE' || input.errorCode === 'DATA_RECOVERY_CLOSED') bucket.d1Unavailable503++;
      });
    },
    recordQueueDepth(queuedRequests, at) {
      safeRun(undefined, () => {
        if (typeof queuedRequests !== 'number' || !Number.isFinite(queuedRequests)) return;
        const now = resolveNow(clock, at);
        const bucket = acquireBucket(now);
        if (bucket) bucket.queueHighWaterQueued = Math.max(bucket.queueHighWaterQueued, Math.max(0, Math.floor(queuedRequests)));
      });
    },
    recordQueueWait(waitMs, at) {
      safeRun(undefined, () => {
        if (typeof waitMs !== 'number') return;
        const now = resolveNow(clock, at);
        const start = bucketStartFor(now);
        if (maxBucketStart < 0 || start >= maxBucketStart - (SIGNAL_WINDOW_BUCKETS - 1) * SIGNAL_WINDOW_BUCKET_MS) {
          if (start > maxBucketStart) maxBucketStart = start;
          pushBoundedSample(queueWaitSamples, maxSamples, start, waitMs);
        }
      });
    },
    recordQueueRejection(kind, at) {
      safeRun(undefined, () => {
        const now = resolveNow(clock, at);
        const bucket = acquireBucket(now);
        if (!bucket) return;
        if (kind === 'full') bucket.queueRejectedFull429++;
        else if (kind === 'timeout') bucket.queueRejectedTimeout429++;
      });
    },
    recordWriteFailure() {
      signalWriteFailures++;
    },
    snapshot(at) {
      const now = resolveNow(clock, at);
      const currentBucketStart = bucketStartFor(now);
      const clonedStreaks = Object.fromEntries(
        ENGINE_OR_IDENTITY_BOUNDARIES.map(boundary => [boundary, { ...streaks[boundary] }]),
      ) as Record<EngineOrIdentityBoundary, BoundaryStreak>;
      return {
        now,
        windows: {
          m5: aggregateWindow(currentBucketStart, 1),
          m15: aggregateWindow(currentBucketStart, 3),
          m60: aggregateWindow(currentBucketStart, SIGNAL_WINDOW_BUCKETS),
        },
        boundaryStreaks: clonedStreaks,
        recentErrors: recentErrors.map(entry => ({ ...entry })),
        signalWriteFailures,
      };
    },
  };
}

export type OperationalEvaluationInput = {
  now: number;
  maintenanceMode?: boolean;
  alertsEnabled?: boolean;
  collector?: OperationalCollectorSnapshot | null;
  worker?: { available: boolean; data: OperationalSignalsWorker | null };
  queueLive?: {
    available: boolean;
    stats: { activeSlots: number; queuedRequests: number; criticalQueued: number; normalQueued: number; maxSlots: number } | null;
  };
  uncertainReservations?: {
    available: boolean;
    reservedOverdueCount: number;
    needsReviewCount: number;
    aiUncertainCount: number;
    oldestAgeMs: number | null;
    quotaRecoveryMorePending?: boolean;
    quotaRecoveryFailed?: boolean;
  };
  budgets?: {
    available: boolean;
    maxRatio: number | null;
    paused: boolean;
    blocked: boolean;
    pauseCode?: string | null;
    telemetryWriteFailures: number;
  };
  previousState?: OperationalSignalsState | null;
  signalWriteFailures?: number;
  signalReadFailures?: number;
};

function makeFamily(
  family: SignalFamily,
  severity: SignalSeverity,
  code: string,
  observedAt: number | null,
  metricValue: number | null,
  metricUnit: SignalMetricUnit,
  thresholdLabel: string,
  metrics: Record<string, SignalMetricValue>,
): SignalFamilySummary {
  return { family, severity, code, observedAt, metricValue, metricUnit, thresholdLabel, metrics };
}

function activeWorkerBoundaryCounts(worker: OperationalSignalsWorker, now: number): { identityWif15m: number; containerProxy15m: number } {
  const currentBucketStart = bucketStartFor(now);
  const minBucket = currentBucketStart - 2 * SIGNAL_WINDOW_BUCKET_MS;
  if (worker.boundaryWindows) {
    let identityWif15m = 0;
    let containerProxy15m = 0;
    for (const entry of worker.boundaryWindows) {
      if (entry.bucketStartAt >= minBucket && entry.bucketStartAt <= currentBucketStart) {
        identityWif15m += entry.identityWifFailures;
        containerProxy15m += entry.containerProxyFailures;
      }
    }
    return { identityWif15m, containerProxy15m };
  }
  if (now - worker.updatedAt < 900_000) {
    return { identityWif15m: worker.identityWifFailures15m, containerProxy15m: worker.containerProxyFailures15m };
  }
  return { identityWif15m: 0, containerProxy15m: 0 };
}

function evaluateEngineFamily(input: OperationalEvaluationInput): SignalFamilySummary {
  const threshold = 'warn >=3/15m or p95>15000ms; crit wif>=1 or >5 or >=5m';
  const collector = input.collector ?? null;
  const workerData = input.worker?.available ? input.worker.data : null;
  const workerCounts = workerData ? activeWorkerBoundaryCounts(workerData, input.now) : { identityWif15m: 0, containerProxy15m: 0 };

  const errors15m: Record<EngineOrIdentityBoundary, number> = {
    identity_wif: (collector?.windows.m15.boundaryErrors.identity_wif ?? 0) + workerCounts.identityWif15m,
    engine_ollama: collector?.windows.m15.boundaryErrors.engine_ollama ?? 0,
    engine_deepseek: collector?.windows.m15.boundaryErrors.engine_deepseek ?? 0,
    engine_gemini: collector?.windows.m15.boundaryErrors.engine_gemini ?? 0,
    container_proxy: (collector?.windows.m15.boundaryErrors.container_proxy ?? 0) + workerCounts.containerProxy15m,
  };

  let maxConsecutive = 0;
  let maxOutageMs = 0;
  for (const boundary of ENGINE_OR_IDENTITY_BOUNDARIES) {
    const streak = collector?.boundaryStreaks[boundary];
    if (streak && streak.lastFailureAt !== null && input.now - streak.lastFailureAt < 900_000) {
      maxConsecutive = Math.max(maxConsecutive, streak.consecutiveFailures);
      if (boundary !== 'identity_wif' && streak.outageStartedAt !== null) {
        maxOutageMs = Math.max(maxOutageMs, Math.max(0, streak.lastFailureAt - streak.outageStartedAt));
      }
    }
  }
  if (workerData?.boundaryStreaks) {
    const ws = workerData.boundaryStreaks;
    if (ws.identityWifLastFailureAt !== null && input.now - ws.identityWifLastFailureAt < 900_000) {
      maxConsecutive = Math.max(maxConsecutive, ws.identityWifConsecutive);
    }
    if (ws.containerProxyLastFailureAt !== null && input.now - ws.containerProxyLastFailureAt < 900_000) {
      maxConsecutive = Math.max(maxConsecutive, ws.containerProxyConsecutive);
      if (ws.containerProxyOutageStartedAt !== null) {
        maxOutageMs = Math.max(maxOutageMs, Math.max(0, ws.containerProxyLastFailureAt - ws.containerProxyOutageStartedAt));
      }
    }
  }

  const maxErrors15m = Math.max(...Object.values(errors15m));
  const p95Ms = collector?.windows.m15.engineLatency.p95Ms ?? null;
  const metrics: Record<string, SignalMetricValue> = {
    ...errors15m,
    maxConsecutive,
    maxOutageMs,
    engineLatencyP95Ms: p95Ms,
  };

  if (errors15m.identity_wif > 0) {
    return makeFamily('engine_errors_and_latency', 'critical', 'IDENTITY_WIF_ERROR', input.now, errors15m.identity_wif, 'count', threshold, metrics);
  }
  if (maxConsecutive > 5) {
    return makeFamily('engine_errors_and_latency', 'critical', 'BOUNDARY_CONSECUTIVE_CRITICAL', input.now, maxConsecutive, 'count', threshold, metrics);
  }
  if (maxOutageMs >= 300_000) {
    return makeFamily('engine_errors_and_latency', 'critical', 'BOUNDARY_OUTAGE_CRITICAL', input.now, maxOutageMs, 'ms', threshold, metrics);
  }
  if (!collector || !input.worker?.available) {
    return makeFamily('engine_errors_and_latency', 'unknown', 'ENGINE_SIGNAL_UNAVAILABLE', null, null, 'status', threshold, metrics);
  }
  if (maxErrors15m >= 3) {
    return makeFamily('engine_errors_and_latency', 'warning', 'BOUNDARY_ERRORS_WARNING', input.now, maxErrors15m, 'count', threshold, metrics);
  }
  if (p95Ms !== null && p95Ms > 15_000) {
    return makeFamily('engine_errors_and_latency', 'warning', 'ENGINE_LATENCY_WARNING', input.now, p95Ms, 'ms', threshold, metrics);
  }
  return makeFamily('engine_errors_and_latency', 'ok', 'OK', input.now, p95Ms ?? maxErrors15m, p95Ms !== null ? 'ms' : 'count', threshold, metrics);
}

function evaluateD1Family(input: OperationalEvaluationInput): SignalFamilySummary {
  const threshold = 'warn cas>=5 or p95>2000ms/5m; crit 409/413/503>0';
  const collector = input.collector ?? null;
  if (!collector) {
    return makeFamily('d1_contention', 'unknown', 'D1_SIGNAL_UNAVAILABLE', null, null, 'status', threshold, {});
  }
  const m5 = collector.windows.m5.d1;
  const m15 = collector.windows.m15.d1;
  const metrics: Record<string, SignalMetricValue> = {
    casRetriesMax5m: m5.casRetriesMax,
    latencyP95Ms5m: m5.p95Ms,
    conflictExhausted15m: m15.conflictExhausted,
    limitRejected413_15m: m15.limitRejected413,
    unavailable503_15m: m15.unavailable503,
  };
  if (m15.conflictExhausted > 0) return makeFamily('d1_contention', 'critical', 'D1_CONFLICT_EXHAUSTED', input.now, m15.conflictExhausted, 'count', threshold, metrics);
  if (m15.limitRejected413 > 0) return makeFamily('d1_contention', 'critical', 'D1_LIMIT_413', input.now, m15.limitRejected413, 'count', threshold, metrics);
  if (m15.unavailable503 > 0) return makeFamily('d1_contention', 'critical', 'D1_UNAVAILABLE_503', input.now, m15.unavailable503, 'count', threshold, metrics);
  if (m5.casRetriesMax >= 5) return makeFamily('d1_contention', 'warning', 'D1_CAS_RETRY_WARNING', input.now, m5.casRetriesMax, 'count', threshold, metrics);
  if (m5.p95Ms !== null && m5.p95Ms > 2_000) return makeFamily('d1_contention', 'warning', 'D1_LATENCY_WARNING', input.now, m5.p95Ms, 'ms', threshold, metrics);
  return makeFamily('d1_contention', 'ok', 'OK', input.now, m5.p95Ms ?? m5.casRetriesMax, m5.p95Ms !== null ? 'ms' : 'count', threshold, metrics);
}

function evaluateQueueFamily(input: OperationalEvaluationInput): SignalFamilySummary {
  const threshold = 'warn q>=32 or waitP95>30000ms; crit 429>0';
  const collector = input.collector ?? null;
  const live = input.queueLive?.available ? input.queueLive.stats : null;
  const q15 = collector?.windows.m15.queue;
  const metrics: Record<string, SignalMetricValue> = {
    activeSlots: live?.activeSlots ?? null,
    queuedRequests: live?.queuedRequests ?? null,
    highWaterQueued15m: q15?.highWaterQueued ?? null,
    waitP95Ms15m: q15?.waitP95Ms ?? null,
    rejectedFull429_15m: q15?.rejectedFull429 ?? null,
    rejectedTimeout429_15m: q15?.rejectedTimeout429 ?? null,
  };
  if (q15 && q15.rejectedFull429 > 0) return makeFamily('queue_pressure', 'critical', 'QUEUE_FULL_429', input.now, q15.rejectedFull429, 'count', threshold, metrics);
  if (q15 && q15.rejectedTimeout429 > 0) return makeFamily('queue_pressure', 'critical', 'QUEUE_TIMEOUT_429', input.now, q15.rejectedTimeout429, 'count', threshold, metrics);
  if (!collector || !live || !q15) return makeFamily('queue_pressure', 'unknown', 'QUEUE_SIGNAL_UNAVAILABLE', null, null, 'status', threshold, metrics);
  const peak = Math.max(live.queuedRequests, q15.highWaterQueued);
  if (peak >= 32) return makeFamily('queue_pressure', 'warning', 'QUEUE_DEPTH_WARNING', input.now, peak, 'count', threshold, metrics);
  if (q15.waitP95Ms !== null && q15.waitP95Ms > 30_000) return makeFamily('queue_pressure', 'warning', 'QUEUE_WAIT_WARNING', input.now, q15.waitP95Ms, 'ms', threshold, metrics);
  return makeFamily('queue_pressure', 'ok', 'OK', input.now, peak, 'count', threshold, metrics);
}

function evaluateReservationsFamily(input: OperationalEvaluationInput): SignalFamilySummary {
  const threshold = 'warn age>=15m or backlog>=3; crit age>=24h or fail';
  const res = input.uncertainReservations;
  const workerData = input.worker?.available ? input.worker.data : null;
  const quotaSubtask = workerData?.subtasks.response_quota_recovery;
  const quotaFailed = Boolean(res?.quotaRecoveryFailed || quotaSubtask?.failed);
  const backlogCycles = quotaSubtask?.morePending ? workerData!.backlogCycles : 0;
  const oldestAgeMs = res?.available ? res.oldestAgeMs : null;
  const totalOpen = res?.available ? res.reservedOverdueCount + res.needsReviewCount + res.aiUncertainCount : null;
  const metrics: Record<string, SignalMetricValue> = {
    reservedOverdueCount: res?.available ? res.reservedOverdueCount : null,
    needsReviewCount: res?.available ? res.needsReviewCount : null,
    aiUncertainCount: res?.available ? res.aiUncertainCount : null,
    oldestAgeMs,
    backlogCycles,
    quotaRecoveryFailed: quotaFailed,
  };
  if (oldestAgeMs !== null && oldestAgeMs >= 86_400_000) return makeFamily('uncertain_reservations', 'critical', 'UNCERTAIN_RESERVATION_24H', input.now, oldestAgeMs, 'age_ms', threshold, metrics);
  if (quotaFailed) return makeFamily('uncertain_reservations', 'critical', 'QUOTA_RECOVERY_FAILED', input.now, 1, 'count', threshold, metrics);
  if (!res?.available) return makeFamily('uncertain_reservations', 'unknown', 'RESERVATION_SIGNAL_UNAVAILABLE', null, null, 'status', threshold, metrics);
  if (oldestAgeMs !== null && oldestAgeMs >= 900_000) return makeFamily('uncertain_reservations', 'warning', 'UNCERTAIN_RESERVATION_15M', input.now, oldestAgeMs, 'age_ms', threshold, metrics);
  if (backlogCycles >= 3 && (res.quotaRecoveryMorePending ?? quotaSubtask?.morePending)) {
    return makeFamily('uncertain_reservations', 'warning', 'QUOTA_RECOVERY_BACKLOG', input.now, backlogCycles, 'count', threshold, metrics);
  }
  return makeFamily('uncertain_reservations', 'ok', 'OK', input.now, totalOpen ?? 0, 'count', threshold, metrics);
}

function evaluateCronFamily(input: OperationalEvaluationInput): SignalFamilySummary {
  const threshold = 'warn 20h/backlog>=3/>15m; crit 24h/fail/invalid/>30m';
  const w = input.worker?.available ? input.worker.data : null;
  if (!w) return makeFamily('cron_and_retention', 'unknown', 'CRON_SIGNAL_UNAVAILABLE', null, null, 'status', threshold, {});
  const refAt = w.cronLastSuccessAt ?? w.cronLastAttemptAt;
  const cronAgeMs = refAt === null ? null : Math.max(0, input.now - refAt);
  const subtasks = Object.values(w.subtasks);
  const invalidRecords = subtasks.reduce((sum, s) => sum + s.invalidRecords, 0);
  const failedPhases = subtasks.reduce((sum, s) => sum + s.failedPhases, 0);
  const anySubtaskFailed = subtasks.some(s => s.failed);
  const metrics: Record<string, SignalMetricValue> = {
    maintenanceSkipped: w.maintenanceSkipped,
    cronAgeMs,
    backlogCycles: w.backlogCycles,
    cronConsecutiveFailures: w.cronConsecutiveFailures,
    backupHealth: w.backup.health,
    backupPhase: w.backup.phase,
    invalidRecords,
    failedPhases,
  };
  if (w.maintenanceSkipped) return makeFamily('cron_and_retention', 'ok', 'MAINTENANCE_PAUSED', w.updatedAt, 0, 'status', threshold, metrics);
  if (w.backup.health === 'breached') return makeFamily('cron_and_retention', 'critical', 'BACKUP_BREACHED', w.updatedAt, 1, 'status', threshold, metrics);
  if (w.backup.phase === 'failed' || w.backup.failureCode !== null) return makeFamily('cron_and_retention', 'critical', 'BACKUP_FAILED', w.updatedAt, 1, 'status', threshold, metrics);
  if (anySubtaskFailed || w.cronConsecutiveFailures > 0) return makeFamily('cron_and_retention', 'critical', 'CRON_SUBTASK_FAILED', w.updatedAt, Math.max(1, w.cronConsecutiveFailures), 'count', threshold, metrics);
  if (invalidRecords > 0 || failedPhases > 0) return makeFamily('cron_and_retention', 'critical', 'RETENTION_INTEGRITY_ERROR', w.updatedAt, invalidRecords + failedPhases, 'count', threshold, metrics);
  if (cronAgeMs !== null && cronAgeMs > 1_800_000) return makeFamily('cron_and_retention', 'critical', 'CRON_STALE_CRITICAL', w.updatedAt, cronAgeMs, 'age_ms', threshold, metrics);
  if (w.backup.health === 'warning') return makeFamily('cron_and_retention', 'warning', 'BACKUP_WARNING', w.updatedAt, 1, 'status', threshold, metrics);
  if (w.backlogCycles >= 3) return makeFamily('cron_and_retention', 'warning', 'RETENTION_BACKLOG_WARNING', w.updatedAt, w.backlogCycles, 'count', threshold, metrics);
  if (cronAgeMs !== null && cronAgeMs > 900_000) return makeFamily('cron_and_retention', 'warning', 'CRON_STALE_WARNING', w.updatedAt, cronAgeMs, 'age_ms', threshold, metrics);
  return makeFamily('cron_and_retention', 'ok', 'OK', w.updatedAt, cronAgeMs ?? 0, cronAgeMs !== null ? 'age_ms' : 'status', threshold, metrics);
}

function evaluateBudgetFamily(input: OperationalEvaluationInput): SignalFamilySummary {
  const threshold = 'warn >=80% or writeErr>0; crit >=100% or paused/blocked';
  const b = input.budgets;
  const maxPct = b?.available && b.maxRatio !== null ? Math.round(b.maxRatio * 1000) / 10 : null;
  const metrics: Record<string, SignalMetricValue> = {
    maxPercent: maxPct,
    paused: b?.paused ?? null,
    blocked: b?.blocked ?? null,
    telemetryWriteFailures: b?.available ? b.telemetryWriteFailures : null,
  };
  if (b?.paused) return makeFamily('ai_and_whatsapp_budget', 'critical', 'AI_BUDGET_PAUSED', input.now, maxPct ?? 100, 'percent', threshold, metrics);
  if (b?.blocked) return makeFamily('ai_and_whatsapp_budget', 'critical', 'WHATSAPP_BUDGET_BLOCKED', input.now, maxPct ?? 100, 'percent', threshold, metrics);
  if (b?.available && b.maxRatio !== null && b.maxRatio >= 1.0) return makeFamily('ai_and_whatsapp_budget', 'critical', 'BUDGET_EXHAUSTED', input.now, maxPct, 'percent', threshold, metrics);
  if (!b?.available) return makeFamily('ai_and_whatsapp_budget', 'unknown', 'BUDGET_SIGNAL_UNAVAILABLE', null, null, 'status', threshold, metrics);
  if (b.maxRatio !== null && b.maxRatio >= 0.8) return makeFamily('ai_and_whatsapp_budget', 'warning', 'BUDGET_NEAR_LIMIT', input.now, maxPct, 'percent', threshold, metrics);
  if (b.telemetryWriteFailures > 0) return makeFamily('ai_and_whatsapp_budget', 'warning', 'TELEMETRY_WRITE_FAILURES', input.now, b.telemetryWriteFailures, 'count', threshold, metrics);
  return makeFamily('ai_and_whatsapp_budget', 'ok', 'OK', input.now, maxPct ?? 0, 'percent', threshold, metrics);
}

export function evaluateOperationalSignals(input: OperationalEvaluationInput): OperationalSignalsOverview {
  const families = {
    engine_errors_and_latency: evaluateEngineFamily(input),
    d1_contention: evaluateD1Family(input),
    queue_pressure: evaluateQueueFamily(input),
    uncertain_reservations: evaluateReservationsFamily(input),
    cron_and_retention: evaluateCronFamily(input),
    ai_and_whatsapp_budget: evaluateBudgetFamily(input),
  };

  const severities = SIGNAL_FAMILIES.map(family => families[family].severity);
  const overallSeverity: SignalSeverity = severities.includes('critical')
    ? 'critical'
    : severities.includes('warning')
      ? 'warning'
      : severities.includes('unknown')
        ? 'unknown'
        : 'ok';

  const unknownFamilies = SIGNAL_FAMILIES.filter(family => families[family].severity === 'unknown');
  const workerData = input.worker?.available ? input.worker.data : null;
  const mergedErrors = [
    ...(input.collector?.recentErrors ?? []),
    ...(workerData?.recentErrors ?? []),
  ]
    .sort((left, right) => right.observedAt - left.observedAt)
    .slice(0, SIGNAL_MAX_RECENT_ERRORS);

  const incidents = [...(input.previousState?.incidents ?? [])].slice(0, SIGNAL_MAX_INCIDENTS);
  const activeIncidents = incidents.filter(incident => incident.resolvedAt === null);
  const latestIncident = incidents[0] ?? null;
  const alertsEnabled = Boolean(input.alertsEnabled);

  return {
    version: 1,
    generatedAt: input.now,
    overallSeverity,
    alertsEnabled,
    maintenanceMode: Boolean(input.maintenanceMode),
    families,
    recentErrors: mergedErrors,
    incidents,
    degradation: {
      signalWriteFailures: (input.collector?.signalWriteFailures ?? 0) + (workerData?.signalWriteFailures ?? 0) + (input.signalWriteFailures ?? 0),
      signalReadFailures: input.signalReadFailures ?? 0,
      unknownFamilies,
    },
    alertDelivery: {
      enabled: alertsEnabled,
      latestState: latestIncident ? latestIncident.deliveryState : (alertsEnabled ? 'none' : 'disabled'),
      activeIncidentCount: activeIncidents.length,
      lastAlertAt: latestIncident?.lastAlertAt ?? null,
      lastErrorClass: latestIncident?.lastAlertErrorClass ?? null,
    },
  };
}

export function formatOperationalAlertMessage(input: {
  severity: 'warning' | 'critical';
  family: SignalFamily;
  code: string;
  observedAt: number;
}): string {
  const bogotaIso = new Date(input.observedAt - 5 * 3_600_000).toISOString().slice(0, 19).replace('T', ' ');
  return `[Sarin Ops][${input.severity}] ${input.family}:${input.code} (${bogotaIso} COT) ${OPERATIONAL_ALERTS_HOST}`;
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function operationalIncidentKey(family: SignalFamily, code: string, severity: 'warning' | 'critical'): Promise<string> {
  return sha256Hex(`${family}:${code}:${severity}`);
}

export type PendingOperationalAlert = {
  incidentKey: string;
  family: SignalFamily;
  code: string;
  severity: 'warning' | 'critical';
  formattedMessage: string;
};

export async function reconcileIncidentCooldowns(
  previousState: OperationalSignalsState | null,
  evaluation: OperationalSignalsOverview,
  options?: { alertsEnabled?: boolean; signalWriteFailures?: number; signalReadFailures?: number },
): Promise<{ state: OperationalSignalsState; alertsToDispatch: PendingOperationalAlert[]; changed: boolean }> {
  const now = evaluation.generatedAt;
  const alertsEnabled = options?.alertsEnabled ?? evaluation.alertsEnabled;
  const incidents = (previousState?.incidents ?? []).map(item => ({ ...item }));
  const alertsToDispatch: PendingOperationalAlert[] = [];

  for (const family of SIGNAL_FAMILIES) {
    const summary = evaluation.families[family];
    if (summary.severity === 'ok') {
      for (const item of incidents) {
        if (item.family === family && item.resolvedAt === null) item.resolvedAt = now;
      }
      continue;
    }
    if (summary.severity !== 'warning' && summary.severity !== 'critical') continue;

    const severity = summary.severity;
    const key = await operationalIncidentKey(family, summary.code, severity);
    for (const item of incidents) {
      if (item.family === family && item.resolvedAt === null && item.incidentKey !== key) {
        item.resolvedAt = now;
      }
    }

    const activeIndex = incidents.findIndex(item => item.incidentKey === key && item.resolvedAt === null);
    if (activeIndex === -1) {
      const existingResolved = incidents.findIndex(item => item.incidentKey === key);
      const fresh: OperationalIncidentRecord = {
        incidentKey: key,
        family,
        code: summary.code,
        lastSeverity: severity,
        firstSeenAt: now,
        lastSeenAt: now,
        lastAlertAt: null,
        cooldownUntil: null,
        resolvedAt: null,
        deliveryState: alertsEnabled ? 'none' : 'disabled',
        lastAlertErrorClass: null,
      };
      if (existingResolved !== -1) incidents[existingResolved] = fresh;
      else incidents.push(fresh);

      if (alertsEnabled) {
        alertsToDispatch.push({
          incidentKey: key,
          family,
          code: summary.code,
          severity,
          formattedMessage: formatOperationalAlertMessage({ severity, family, code: summary.code, observedAt: now }),
        });
      }
      continue;
    }

    const current = incidents[activeIndex];
    current.lastSeenAt = now;
    if (current.deliveryState === 'uncertain') continue;
    if (!alertsEnabled) {
      if (current.deliveryState === 'none') current.deliveryState = 'disabled';
      continue;
    }
    if (current.cooldownUntil === null || now >= current.cooldownUntil) {
      alertsToDispatch.push({
        incidentKey: key,
        family,
        code: summary.code,
        severity,
        formattedMessage: formatOperationalAlertMessage({ severity, family, code: summary.code, observedAt: now }),
      });
    }
  }

  incidents.sort((left, right) => {
    const leftActive = left.resolvedAt === null ? 0 : 1;
    const rightActive = right.resolvedAt === null ? 0 : 1;
    if (leftActive !== rightActive) return leftActive - rightActive;
    return right.lastSeenAt - left.lastSeenAt;
  });
  const capped = incidents.slice(0, SIGNAL_MAX_INCIDENTS);

  const signalWriteFailures = options?.signalWriteFailures ?? evaluation.degradation.signalWriteFailures;
  const signalReadFailures = options?.signalReadFailures ?? evaluation.degradation.signalReadFailures;
  const state: OperationalSignalsState = {
    version: 1,
    updatedAt: now,
    alertsEnabled,
    signalWriteFailures,
    signalReadFailures,
    incidents: capped,
  };

  const changed = !previousState
    || JSON.stringify(previousState.incidents) !== JSON.stringify(state.incidents)
    || previousState.alertsEnabled !== state.alertsEnabled
    || previousState.signalWriteFailures !== state.signalWriteFailures
    || previousState.signalReadFailures !== state.signalReadFailures;

  return { state, alertsToDispatch, changed };
}
