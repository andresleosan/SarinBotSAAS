import { cleanupAdminPaymentRetention } from './admin-payment-retention.ts';
import { recoveryRestricted } from '../../shared/recovery-admission.ts';
import { scheduleRecoveryBackup, handleRecoveryOutbound, sourceObjectsPinned } from './recovery-backup.ts';
import { recoverWorkerResponseQuota } from './response-quota-recovery.ts';
import { cleanupPlatformSupportRetention } from './platform-support-retention.ts';
import { hasPotentialPlatformWork } from './platform-whatsapp-wake.ts';
import { handlePlatformAudioOutbound } from './platform-whatsapp-audio.ts';
import { Container, ContainerProxy, getContainer } from '@cloudflare/containers';
import { handleIdentityOutbound, handlePublicIdentityRequest } from './identity.ts';
import { handleDataOutbound } from './data.ts';
import { cleanupPlatformWhatsAppRetentionReport } from './platform-whatsapp-retention.ts';
import {
  recordWorkerBoundaryError,
  recordWorkerBoundarySuccess,
  recordWorkerCronSummary,
  type WorkerCronSubtaskInput,
  type WorkerCronSummaryInput,
} from './operational-signals.ts';
import { backgroundWorkEnabled, forwardToSingleton, runtimeEnvironment, wakeBackgroundSingleton, SINGLETON_NAME } from './router.ts';
import type { BackupStatus } from '../../shared/recovery-backup.ts';

export { SarinIdentity } from './identity.ts';
export { ContainerProxy };

/** The DO stores SDK lifecycle metadata only; application bodies never enter DO storage. */
export class SarinApp extends Container<CloudflareBindings> {
  override defaultPort = 3000;
  override sleepAfter = '2m';
  // Firebase Admin uses native TLS/gRPC. Avoid HTTPS interception and its CA/protocol changes.
  override enableInternet = true;
  override interceptHttps = false;

  constructor(ctx: ConstructorParameters<typeof Container<CloudflareBindings>>[0], env: CloudflareBindings) {
    super(ctx, env);
    this.envVars = runtimeEnvironment({ ...env });
  }

  override onError(_error: unknown): void {
    // No error payload, token, URL or request body is logged from this hook.
    throw new Error('El proceso de la aplicación no está disponible.');
  }

  override async onActivityExpired(): Promise<void> {
    if (recoveryRestricted(this.env)) { if (this.ctx.container?.running) await this.stop(); return; }
    // WhatsApp polling and retention run in Node after HTTP responses finish.
    // Keep that process alive only when one of those explicit flags is enabled.
    if (backgroundWorkEnabled(this.envVars ?? {})) {
      this.renewActivityTimeout();
      return;
    }
    if (this.env.SARIN_RECOVERY_DB && await sourceObjectsPinned(this.env)) {
      this.renewActivityTimeout();
      return;
    }
    if (this.ctx.container?.running) await this.stop();
  }
}

// Invoke the SDK's inherited setter to populate ContainerProxy's dispatch registry.
// A subclass static field would shadow that setter in the pinned SDK 0.3.7.
SarinApp.outboundByHost = { 'sarin-google.internal': handleIdentityOutbound, 'sarin-data.internal': handleDataOutbound, 'sarin-audio.internal': handlePlatformAudioOutbound, 'sarin-backup.internal': handleRecoveryOutbound };

function skippedSubtask(): WorkerCronSubtaskInput {
  return { ran: false, failed: false, morePending: false, invalidRecords: 0, failedPhases: 0 };
}

function dispatchSignal(ctx: ExecutionContext | undefined, promise: Promise<unknown> | undefined): Promise<unknown> | void {
  if (!promise) return;
  if (ctx?.waitUntil) {
    ctx.waitUntil(promise);
    return;
  }
  return promise;
}

function recordRetentionSubtask(
  boundary: 'admin_payment_retention' | 'platform_support_retention' | 'platform_whatsapp_retention',
  result: { clearedBodies?: number; deletedMetadata?: number; morePending?: boolean; invalidRecords?: number; failedPhases?: number },
  errors: WorkerCronSummaryInput['errors'],
  failedCode: string,
  invalidCode: string,
): WorkerCronSubtaskInput {
  const invalidRecords = result.invalidRecords ?? 0;
  const failedPhases = result.failedPhases ?? 0;
  if (failedPhases > 0 || invalidRecords > 0) {
    errors.push({
      boundary,
      errorClass: failedPhases > 0 ? 'CRON_FAILED' : 'RETENTION_INCOMPLETE',
      httpStatus: null,
      providerCode: failedPhases > 0 ? failedCode : invalidCode,
    });
  }
  return {
    ran: true,
    failed: failedPhases > 0,
    morePending: Boolean(result.morePending),
    invalidRecords,
    failedPhases,
    clearedBodies: result.clearedBodies ?? 0,
    deletedMetadata: result.deletedMetadata ?? 0,
  };
}

export default {
  async fetch(request: Request, env: CloudflareBindings, ctx?: ExecutionContext): Promise<Response> {
    // Google must discover the signing keys even before application runtime is configured.
    const identity = await handlePublicIdentityRequest(request, env, ctx);
    if (identity) return identity;
    return forwardToSingleton(request, (name) => getContainer(env.SARIN_APP, name), { ...env }, {
      onProxyError: (diagnostic) => dispatchSignal(ctx, recordWorkerBoundaryError(env, { boundary: 'container_proxy', ...diagnostic })),
      onProxySuccess: () => dispatchSignal(ctx, recordWorkerBoundarySuccess(env, 'container_proxy')),
    });
  },
  async scheduled(_controller: ScheduledController, env: CloudflareBindings): Promise<void> {
    if (recoveryRestricted(env)) return;
    const now = Date.now();
    if (!Number.isSafeInteger(now) || now < 0 || now > 8_640_000_000_000_000) {
      throw new Error('Invalid retention options');
    }
    const flags: Record<string, unknown> = { ...env };
    const maintenance = flags.SARIN_MAINTENANCE === 'true';
    const summary: WorkerCronSummaryInput = {
      maintenanceSkipped: maintenance,
      backup: null,
      subtasks: {
        recovery_backup: skippedSubtask(),
        response_quota_recovery: skippedSubtask(),
        admin_payment_retention: skippedSubtask(),
        platform_support_retention: skippedSubtask(),
        platform_whatsapp_retention: skippedSubtask(),
      },
      errors: [],
    };

    try {
      const backup: BackupStatus = await scheduleRecoveryBackup(env, now);
      summary.backup = backup;
      summary.subtasks.recovery_backup = {
        ran: !maintenance,
        failed: false,
        morePending: false,
        invalidRecords: 0,
        failedPhases: 0,
      };
    } catch {
      console.error({ event: 'recovery_backup_failed' });
      summary.subtasks.recovery_backup = { ran: true, failed: true, morePending: false, invalidRecords: 0, failedPhases: 1 };
      summary.errors.push({ boundary: 'recovery_backup', errorClass: 'CRON_FAILED', httpStatus: null, providerCode: 'RECOVERY_BACKUP_FAILED' });
    }

    if (!maintenance) {
      try {
        const quota = await recoverWorkerResponseQuota(env, now);
        if (quota.visited) console.info({ event: 'response_quota_recovery', ...quota });
        summary.subtasks.response_quota_recovery = {
          ran: true,
          failed: false,
          morePending: Boolean(quota.morePending),
          invalidRecords: 0,
          failedPhases: 0,
        };
      } catch {
        console.error({ event: 'response_quota_recovery_failed' });
        summary.subtasks.response_quota_recovery = { ran: true, failed: true, morePending: false, invalidRecords: 0, failedPhases: 1 };
        summary.errors.push({ boundary: 'response_quota_recovery', errorClass: 'CRON_FAILED', httpStatus: null, providerCode: 'QUOTA_RECOVERY_FAILED' });
      }

      try {
        const result = await cleanupAdminPaymentRetention(env, now);
        if (result.morePending || result.clearedBodies || result.deletedMetadata) console.info({ event: 'admin_payment_retention', ...result });
        summary.subtasks.admin_payment_retention = recordRetentionSubtask('admin_payment_retention', result, summary.errors, 'ADMIN_PAYMENT_PHASE_FAILED', 'ADMIN_PAYMENT_INVALID');
      } catch {
        summary.subtasks.admin_payment_retention = { ran: true, failed: true, morePending: false, invalidRecords: 0, failedPhases: 1 };
        summary.errors.push({ boundary: 'admin_payment_retention', errorClass: 'CRON_FAILED', httpStatus: null, providerCode: 'ADMIN_PAYMENT_FAILED' });
      }

      if (flags.PLATFORM_WHATSAPP_RETENTION_ENABLED !== 'true') {
        try {
          const support = await cleanupPlatformSupportRetention(env, now);
          if (support.morePending || support.clearedBodies || support.deletedMetadata) console.info({ event: 'platform_support_retention', ...support });
          summary.subtasks.platform_support_retention = recordRetentionSubtask('platform_support_retention', support, summary.errors, 'SUPPORT_PHASE_FAILED', 'SUPPORT_INVALID');
        } catch {
          summary.subtasks.platform_support_retention = { ran: true, failed: true, morePending: false, invalidRecords: 0, failedPhases: 1 };
          summary.errors.push({ boundary: 'platform_support_retention', errorClass: 'CRON_FAILED', httpStatus: null, providerCode: 'SUPPORT_RETENTION_FAILED' });
        }
      }
    }

    if (flags.PLATFORM_WHATSAPP_RETENTION_ENABLED === 'true' && !maintenance) {
      try {
        const result = await cleanupPlatformWhatsAppRetentionReport(env, { now });
        console.info({
          event: 'platform_whatsapp_retention',
          clearedBodies: result.clearedBodies,
          deletedMetadata: result.deletedMetadata,
          morePending: result.morePending,
        });
        summary.subtasks.platform_whatsapp_retention = recordRetentionSubtask('platform_whatsapp_retention', result, summary.errors, 'WHATSAPP_PHASE_FAILED', 'WHATSAPP_INVALID');
      } catch {
        summary.subtasks.platform_whatsapp_retention = { ran: true, failed: true, morePending: false, invalidRecords: 0, failedPhases: 1 };
        summary.errors.push({ boundary: 'platform_whatsapp_retention', errorClass: 'CRON_FAILED', httpStatus: null, providerCode: 'WHATSAPP_RETENTION_FAILED' });
      }
    }

    await recordWorkerCronSummary(env, summary, now);

    if (backgroundWorkEnabled(flags)) await wakeBackgroundSingleton(flags, (name) => getContainer(env.SARIN_APP, name));
    else if (await hasPotentialPlatformWork(env)) await getContainer(env.SARIN_APP, SINGLETON_NAME).startAndWaitForPorts();

    if (!maintenance && flags.SARIN_OPERATIONAL_ALERTS_ENABLED === 'true' && env.SARIN_APP) {
      try {
        const response = await getContainer(env.SARIN_APP, SINGLETON_NAME).fetch(
          new Request('http://sarin-container.internal/api/internal/operational-signals', {
            method: 'POST',
            headers: { 'x-sarin-ops-evaluate': 'true' },
            signal: AbortSignal.timeout(15000),
            redirect: 'manual',
          }),
        );
        await response.body?.cancel();
      } catch {
        // Safe degradation: do not abort scheduled on alert evaluation failure.
      }
    }
  },
} satisfies ExportedHandler<CloudflareBindings>;
