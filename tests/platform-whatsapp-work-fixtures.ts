import { vi } from 'vitest';
import { identity, now } from './platform-whatsapp-test-fixtures';
import type { ControlHead, PlatformJob, BudgetCircuit, CostStage } from '../shared/platform-whatsapp-work';
import { budgetIds, currentPlatformWorkPolicy } from '@/lib/server/platform-whatsapp-budget';
export const epoch = '00000000-0000-4000-8000-000000000001';
export const leaseToken = '00000000-0000-4000-8000-000000000002';
export function workJob(extra: Partial<PlatformJob> = {}): PlatformJob {
  return { ...identity, recordType: 'job', jobId: 'job_' + '1'.repeat(64), epoch, sourceEventId: 'event_' + '2'.repeat(64), sourceKind: 'text', kind: 'control',
    requestFingerprint: '3'.repeat(64), conversationId: '4'.repeat(64), controlEpoch: epoch, controlRevision: 0, connectionRevision: 0, conversationRevision: null,
    sourceOccurredAt: now, sourceReceivedAt: now, createdAt: now, customerSentAt: now, windowExpiresAt: now + 86_400_000, bodyExpiresAt: now + 86_400_000, expiresAt: now + 2_592_000_000,
    status: 'ready', nextJobId: null, nextAttemptAt: now, leaseToken: null, leaseClaimedAt: null, leaseExpiresAt: null, processingStartedAt: null, processingDeadlineAt: null,
    outboxId: null, outputKind: 'none', catalogId: 'identification', catalogVersion: 1, bodyState: 'body_erased', content: null,
    authorityKind: 'fixed_notice', noticeId: 'identification', noticeVersion: 1,
    audioState: 'not_applicable', audioToken: null, audioLeaseToken: null, audioReservationId: null, audioStartedAt: null, audioFinishedAt: null,
    generationState: 'not_applicable', generationToken: null, generationLeaseToken: null, generationReservationId: null, generationStartedAt: null, generationFinishedAt: null, ...extra } as PlatformJob;
}
export function workHead(job = workJob(), extra: Partial<ControlHead> = {}): ControlHead {
  return { ...identity, recordType: 'control_head', conversationId: job.conversationId, controlEpoch: job.controlEpoch, controlRevision: job.controlRevision, connectionRevision: 0, entryState: 'initial', botAuthorityFingerprint: null, attachedConversationRevision: null, headJobId: job.jobId, tailJobId: job.jobId, currentMenuOutboxId: null, status: 'active', nextAttemptAt: null, receivedAt: now, expiresAt: now + 2_592_000_000, ...extra };
}
export function configureWork() {
  for (const stage of ['AUDIO', 'GENERATION', 'SEND']) vi.stubEnv('PLATFORM_WHATSAPP_' + stage + '_DAILY_BUDGET_MICROS', '100');
  for (const flag of ['AUDIO', 'AI', 'SEND']) vi.stubEnv('PLATFORM_WHATSAPP_' + flag + '_ENABLED', 'true');
  vi.stubEnv('PLATFORM_WHATSAPP_TARIFF_POLICY', JSON.stringify({ version: 'demo-v1', sendEvidence: { version: 'demo-v1', currency: 'USD', timezone: 'UTC', category: 'service', destinationScope: 'all_e164', rate: { numerator: 10, denominator: 1 } }, audio: { numerator: 1, denominator: 120000 }, generationInput: { numerator: 1, denominator: 100 }, generationOutput: { numerator: 1, denominator: 100 }, send: { numerator: 10, denominator: 1 }, maximumInputTokens: 100, maximumOutputTokens: 100 }));
}
export function workCircuit(job = workJob(), stage: CostStage = 'send'): BudgetCircuit {
  return { ...identity, recordType: 'budget_circuit', circuitId: budgetIds(job, stage, now).circuitId, stage, status: 'open', policyFingerprint: currentPlatformWorkPolicy().fingerprint, createdAt: now, expiresAt: now + 2_592_000_000, trippedAt: null, reason: null };
}

/** Explicit synthetic verified mapping. Never production configuration. */
export function configureGenerationWork() {
  const tariff = JSON.parse(process.env.PLATFORM_WHATSAPP_TARIFF_POLICY!);
  vi.stubEnv('PLATFORM_WHATSAPP_TARIFF_POLICY', JSON.stringify({ ...tariff, generationInput: { numerator: 300, denominator: 1000 }, generationOutput: { numerator: 1200, denominator: 1000 }, maximumInputTokens: 132096, maximumOutputTokens: 4096 }));
  vi.stubEnv('PLATFORM_WHATSAPP_GENERATION_DAILY_BUDGET_MICROS', '1000000');
  vi.stubEnv('PLATFORM_WHATSAPP_GENERATION_POLICY', JSON.stringify({ version: 'synthetic-verified-v1', responseModels: ['synthetic-wire-model-v1'] }));
}
