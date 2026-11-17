import { recoveryRestricted } from '../../shared/recovery-admission.ts';
import {
  OPERATIONAL_SIGNALS_WORKER_DOC_PATH,
  SIGNAL_CRON_SUBTASKS,
  SIGNAL_MAX_RECENT_ERRORS,
  SIGNAL_WINDOW_BUCKETS,
  SIGNAL_WINDOW_BUCKET_MS,
  operationalSignalsWorkerSchema,
  sanitizeOperationalError,
  type OperationalSignalsWorker,
  type RecentSignalError,
  type SignalBoundary,
  type SignalCronSubtask,
  type SignalErrorClass,
  type WorkerSubtaskSummary,
} from '../../shared/operational-signals.ts';
import type { BackupStatus } from '../../shared/recovery-backup.ts';
import { DataError, executeDataCommand } from './data.ts';

type WorkerBoundary = 'identity_wif' | 'container_proxy';
type WorkerSignalsEnvironment = Partial<Pick<CloudflareBindings, 'SARIN_DB' | 'SARIN_FILES'>> & RecoveryBindings;

export type WorkerCronSubtaskInput = {
  ran: boolean;
  failed: boolean;
  morePending: boolean;
  invalidRecords: number;
  failedPhases: number;
  clearedBodies?: number;
  deletedMetadata?: number;
};

export type WorkerCronSummaryInput = {
  maintenanceSkipped: boolean;
  backup: BackupStatus | null;
  subtasks: Record<SignalCronSubtask, WorkerCronSubtaskInput>;
  errors: Array<{
    boundary: SignalBoundary;
    errorClass: SignalErrorClass;
    httpStatus: number | null;
    providerCode?: string | null;
  }>;
};

const VALID_BACKUP_PHASES = new Set(['disabled', 'idle', 'preparing', 'copying', 'verifying', 'sealed', 'failed']);
const VALID_BACKUP_HEALTHS = new Set(['missing', 'ok', 'warning', 'breached']);
const SHORT_CODE_RE = /^[A-Za-z0-9_.-]{1,32}$/;
const SECRET_PREFIX_RE = /^(?:sk[-_]|pk[-_]|rk[-_]|AIza|eyJ|gh[pousr]_|xox[baprs]-|Bearer)/i;
const MAX_CAS_ATTEMPTS = 4;

const activeBoundaryStreaks = new Set<WorkerBoundary>();
let totalWriteFailures = 0;
let pendingWriteFailures = 0;

export function getWorkerSignalWriteFailures(): number {
  return totalWriteFailures;
}

function safeTimestamp(now?: number): number {
  const value = now ?? Date.now();
  return Number.isSafeInteger(value) && value >= 0 ? value : Math.max(0, Math.floor(Date.now()));
}

function safeCount(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function sanitizeCode(value: unknown): string | null {
  return typeof value === 'string' && SHORT_CODE_RE.test(value) && !SECRET_PREFIX_RE.test(value) ? value : null;
}

function sanitizeCodeList(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  const result: string[] = [];
  for (const item of values) {
    const code = sanitizeCode(item);
    if (code) result.push(code);
    if (result.length >= 16) break;
  }
  return result;
}

function emptySubtask(): WorkerSubtaskSummary {
  return {
    lastAttemptAt: null,
    lastSuccessAt: null,
    failed: false,
    morePending: false,
    invalidRecords: 0,
    failedPhases: 0,
  };
}

function emptyStreaks(): NonNullable<OperationalSignalsWorker['boundaryStreaks']> {
  return {
    identityWifConsecutive: 0,
    identityWifOutageStartedAt: null,
    identityWifLastFailureAt: null,
    containerProxyConsecutive: 0,
    containerProxyOutageStartedAt: null,
    containerProxyLastFailureAt: null,
  };
}

function defaultWorkerSignals(now: number): OperationalSignalsWorker {
  return {
    version: 1,
    updatedAt: now,
    maintenanceSkipped: false,
    cronLastAttemptAt: null,
    cronLastSuccessAt: null,
    backlogCycles: 0,
    cronConsecutiveFailures: 0,
    subtasks: {
      recovery_backup: emptySubtask(),
      response_quota_recovery: emptySubtask(),
      admin_payment_retention: emptySubtask(),
      platform_support_retention: emptySubtask(),
      platform_whatsapp_retention: emptySubtask(),
    },
    backup: {
      phase: 'disabled',
      health: 'missing',
      lastRecoverableAt: null,
      failureCode: null,
      gaps: { weeks: [], months: [] },
    },
    identityWifFailures15m: 0,
    containerProxyFailures15m: 0,
    recentErrors: [],
    signalWriteFailures: 0,
    boundaryWindows: [],
    boundaryStreaks: emptyStreaks(),
  };
}

function sanitizeBackupSummary(
  status: BackupStatus | null,
  previous: OperationalSignalsWorker['backup'],
): OperationalSignalsWorker['backup'] {
  if (!status) {
    return {
      ...previous,
      phase: 'failed',
      failureCode: 'CRON_EXCEPTION',
    };
  }
  const phase = VALID_BACKUP_PHASES.has(status.phase) ? status.phase : 'failed';
  const health = VALID_BACKUP_HEALTHS.has(status.health) ? status.health : 'missing';
  const lastRecoverableAt = typeof status.lastRecoverableAt === 'number' && Number.isSafeInteger(status.lastRecoverableAt) && status.lastRecoverableAt >= 0
    ? status.lastRecoverableAt
    : null;
  return {
    phase,
    health,
    lastRecoverableAt,
    failureCode: sanitizeCode(status.failureCode),
    gaps: {
      weeks: sanitizeCodeList(status.gaps?.weeks),
      months: sanitizeCodeList(status.gaps?.months),
    },
  };
}

function updateBoundaryWindows(
  previous: OperationalSignalsWorker['boundaryWindows'],
  now: number,
  boundary?: WorkerBoundary,
): {
  windows: NonNullable<OperationalSignalsWorker['boundaryWindows']>;
  identityWifFailures15m: number;
  containerProxyFailures15m: number;
} {
  const bucketStartAt = Math.floor(now / SIGNAL_WINDOW_BUCKET_MS) * SIGNAL_WINDOW_BUCKET_MS;
  const byStart = new Map<number, { bucketStartAt: number; identityWifFailures: number; containerProxyFailures: number }>();
  let maxBucketStart = bucketStartAt;
  for (const entry of previous ?? []) {
    if (entry.bucketStartAt > maxBucketStart) maxBucketStart = entry.bucketStartAt;
    byStart.set(entry.bucketStartAt, { ...entry });
  }
  if (boundary && bucketStartAt >= maxBucketStart - (SIGNAL_WINDOW_BUCKETS - 1) * SIGNAL_WINDOW_BUCKET_MS) {
    const bucket = byStart.get(bucketStartAt) ?? {
      bucketStartAt,
      identityWifFailures: 0,
      containerProxyFailures: 0,
    };
    if (boundary === 'identity_wif') bucket.identityWifFailures += 1;
    else bucket.containerProxyFailures += 1;
    byStart.set(bucketStartAt, bucket);
  }
  const minKeep = maxBucketStart - (SIGNAL_WINDOW_BUCKETS - 1) * SIGNAL_WINDOW_BUCKET_MS;
  const windows = [...byStart.values()]
    .filter(entry => entry.bucketStartAt >= minKeep && entry.bucketStartAt <= maxBucketStart)
    .sort((left, right) => left.bucketStartAt - right.bucketStartAt)
    .slice(-SIGNAL_WINDOW_BUCKETS);

  const min15m = bucketStartAt - 2 * SIGNAL_WINDOW_BUCKET_MS;
  let identityWifFailures15m = 0;
  let containerProxyFailures15m = 0;
  for (const entry of windows) {
    if (entry.bucketStartAt >= min15m && entry.bucketStartAt <= bucketStartAt) {
      identityWifFailures15m += entry.identityWifFailures;
      containerProxyFailures15m += entry.containerProxyFailures;
    }
  }
  return { windows, identityWifFailures15m, containerProxyFailures15m };
}

function appendRecentErrors(
  existing: RecentSignalError[],
  incoming: RecentSignalError[],
): RecentSignalError[] {
  return [...incoming, ...existing].slice(0, SIGNAL_MAX_RECENT_ERRORS);
}

function hasDatabase(env: WorkerSignalsEnvironment): env is CloudflareBindings & RecoveryBindings {
  return Boolean(
    env?.SARIN_DB
    && typeof env.SARIN_DB.prepare === 'function'
    && typeof env.SARIN_DB.batch === 'function',
  );
}

async function mutateWorkerSignals(
  env: WorkerSignalsEnvironment,
  now: number,
  transform: (previous: OperationalSignalsWorker) => OperationalSignalsWorker,
): Promise<{ ok: boolean; signalWriteFailures: number }> {
  if (!hasDatabase(env) || recoveryRestricted(env)) {
    return { ok: false, signalWriteFailures: totalWriteFailures };
  }
  const dataEnv = { SARIN_DB: env.SARIN_DB, SARIN_FILES: env.SARIN_FILES! };
  for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt++) {
    try {
      const readResult = await executeDataCommand({
        action: 'read',
        read: { kind: 'document', path: OPERATIONAL_SIGNALS_WORKER_DOC_PATH },
      }, dataEnv);
      if (!('documents' in readResult)) {
        throw new DataError(503, 'DATA_UNAVAILABLE');
      }
      const rawExisting = readResult.documents[0]?.data;
      const parsed = rawExisting !== undefined ? operationalSignalsWorkerSchema.safeParse(rawExisting) : null;
      const base = parsed?.success ? parsed.data : defaultWorkerSignals(now);
      const next = transform(base);
      const doc: OperationalSignalsWorker = operationalSignalsWorkerSchema.parse({
        ...next,
        signalWriteFailures: safeCount(next.signalWriteFailures) + pendingWriteFailures,
      });
      await executeDataCommand({
        action: 'commit',
        expectedRevision: readResult.revision,
        requestId: crypto.randomUUID(),
        writes: [{ op: 'set', path: OPERATIONAL_SIGNALS_WORKER_DOC_PATH, data: doc }],
      }, dataEnv);
      pendingWriteFailures = 0;
      return { ok: true, signalWriteFailures: totalWriteFailures };
    } catch (error) {
      if (error instanceof DataError && error.code === 'DATA_CONFLICT' && attempt + 1 < MAX_CAS_ATTEMPTS) {
        continue;
      }
      break;
    }
  }
  totalWriteFailures += 1;
  pendingWriteFailures += 1;
  return { ok: false, signalWriteFailures: totalWriteFailures };
}

export async function recordWorkerBoundaryError(
  env: WorkerSignalsEnvironment,
  input: {
    boundary: WorkerBoundary;
    errorClass: SignalErrorClass;
    httpStatus: number | null;
    providerCode?: string | null;
  },
  now?: number,
): Promise<{ ok: boolean; signalWriteFailures: number }> {
  const safeNow = safeTimestamp(now);
  const boundary: WorkerBoundary = input.boundary === 'identity_wif' ? 'identity_wif' : 'container_proxy';
  const sanitized = sanitizeOperationalError({
    boundary,
    errorClass: input.errorClass,
    httpStatus: input.httpStatus,
    providerCode: input.providerCode,
  });

  const result = await mutateWorkerSignals(env, safeNow, previous => {
    const { windows, identityWifFailures15m, containerProxyFailures15m } = updateBoundaryWindows(
      previous.boundaryWindows,
      safeNow,
      boundary,
    );
    const streaks = { ...(previous.boundaryStreaks ?? emptyStreaks()) };
    if (boundary === 'identity_wif') {
      streaks.identityWifConsecutive += 1;
      streaks.identityWifOutageStartedAt ??= safeNow;
      streaks.identityWifLastFailureAt = safeNow;
    } else {
      streaks.containerProxyConsecutive += 1;
      streaks.containerProxyOutageStartedAt ??= safeNow;
      streaks.containerProxyLastFailureAt = safeNow;
    }
    return {
      ...previous,
      updatedAt: safeNow,
      identityWifFailures15m,
      containerProxyFailures15m,
      recentErrors: appendRecentErrors(previous.recentErrors, [{ ...sanitized, observedAt: safeNow }]),
      boundaryWindows: windows,
      boundaryStreaks: streaks,
    };
  });
  if (result.ok) activeBoundaryStreaks.add(boundary);
  return result;
}

export function recordWorkerBoundarySuccess(
  env: WorkerSignalsEnvironment,
  boundary: WorkerBoundary,
  now?: number,
): Promise<{ ok: boolean; signalWriteFailures: number }> | undefined {
  if (!activeBoundaryStreaks.has(boundary)) return undefined;
  activeBoundaryStreaks.delete(boundary);
  const safeNow = safeTimestamp(now);
  return mutateWorkerSignals(env, safeNow, previous => {
    const { windows, identityWifFailures15m, containerProxyFailures15m } = updateBoundaryWindows(
      previous.boundaryWindows,
      safeNow,
    );
    const streaks = { ...(previous.boundaryStreaks ?? emptyStreaks()) };
    if (boundary === 'identity_wif') {
      streaks.identityWifConsecutive = 0;
      streaks.identityWifOutageStartedAt = null;
      streaks.identityWifLastFailureAt = null;
    } else {
      streaks.containerProxyConsecutive = 0;
      streaks.containerProxyOutageStartedAt = null;
      streaks.containerProxyLastFailureAt = null;
    }
    return {
      ...previous,
      updatedAt: safeNow,
      identityWifFailures15m,
      containerProxyFailures15m,
      boundaryWindows: windows,
      boundaryStreaks: streaks,
    };
  });
}

export async function recordWorkerCronSummary(
  env: WorkerSignalsEnvironment,
  summary: WorkerCronSummaryInput,
  now?: number,
): Promise<{ ok: boolean; signalWriteFailures: number }> {
  const safeNow = safeTimestamp(now);
  const sanitizedErrors: RecentSignalError[] = summary.errors.map(err => ({
    ...sanitizeOperationalError(err),
    observedAt: safeNow,
  }));

  return mutateWorkerSignals(env, safeNow, previous => {
    const subtasks = { ...previous.subtasks };
    for (const key of SIGNAL_CRON_SUBTASKS) {
      const prevTask = previous.subtasks[key];
      const nextTask = summary.subtasks[key];
      if (!nextTask.ran) {
        subtasks[key] = {
          ...prevTask,
          failed: false,
          morePending: false,
          invalidRecords: 0,
          failedPhases: 0,
        };
      } else {
        const failed = Boolean(nextTask.failed || safeCount(nextTask.failedPhases) > 0);
        subtasks[key] = {
          lastAttemptAt: safeNow,
          lastSuccessAt: failed ? prevTask.lastSuccessAt : safeNow,
          failed,
          morePending: Boolean(nextTask.morePending),
          invalidRecords: safeCount(nextTask.invalidRecords),
          failedPhases: safeCount(nextTask.failedPhases),
          ...(nextTask.clearedBodies !== undefined ? { clearedBodies: safeCount(nextTask.clearedBodies) } : {}),
          ...(nextTask.deletedMetadata !== undefined ? { deletedMetadata: safeCount(nextTask.deletedMetadata) } : {}),
        };
      }
    }

    const { windows, identityWifFailures15m, containerProxyFailures15m } = updateBoundaryWindows(
      previous.boundaryWindows,
      safeNow,
    );
    const anyFailed = Object.values(subtasks).some(item => item.failed || item.failedPhases > 0);
    const anyMorePending = Object.values(subtasks).some(item => item.morePending);
    const maintenanceSkipped = Boolean(summary.maintenanceSkipped);

    return {
      ...previous,
      updatedAt: safeNow,
      maintenanceSkipped,
      cronLastAttemptAt: safeNow,
      cronLastSuccessAt: maintenanceSkipped || anyFailed ? previous.cronLastSuccessAt : safeNow,
      backlogCycles: maintenanceSkipped ? previous.backlogCycles : anyMorePending ? previous.backlogCycles + 1 : 0,
      cronConsecutiveFailures: maintenanceSkipped ? previous.cronConsecutiveFailures : anyFailed ? previous.cronConsecutiveFailures + 1 : 0,
      subtasks,
      backup: maintenanceSkipped ? previous.backup : sanitizeBackupSummary(summary.backup, previous.backup),
      identityWifFailures15m,
      containerProxyFailures15m,
      recentErrors: appendRecentErrors(previous.recentErrors, sanitizedErrors),
      boundaryWindows: windows,
    };
  });
}
