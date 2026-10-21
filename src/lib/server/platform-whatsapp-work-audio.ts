import 'server-only';
import { randomUUID } from 'node:crypto';
import type { Database } from '@/lib/storage/types';
import { type Lease, type PlatformJob, workText, workCatalog } from '../../../shared/platform-whatsapp-work';
import { maximumPlatformCost } from '../../../shared/platform-whatsapp-policy';
import { readWork, stageWork } from './platform-whatsapp-work-records';
import { preparedLease, prepareOutbox, stageReply } from './platform-whatsapp-work-store';
import { readWorkAuthority, workPayload } from './platform-whatsapp-work-authority';
import { encryptPlatformWhatsAppContent } from './platform-whatsapp-crypto';
import { getPlatformWhatsAppConfig } from './platform-whatsapp-config';
import { platformWhatsAppConflictError } from './platform-whatsapp-store';
import { currentPlatformWorkPolicy, readPlatformReservation } from './platform-whatsapp-budget';

export async function commitPlatformAudioResult(lease: Lease, audioToken: string, text: string, durationSeconds: number, db: Database, now = Date.now()): Promise<boolean> {
  if (!workText(text, 'question') || !Number.isFinite(durationSeconds) || durationSeconds <= 0 || durationSeconds > 120) throw platformWhatsAppConflictError();
  const p = await preparedLease(lease, db, now); if (!p) return false;
  const envelope = encryptPlatformWhatsAppContent({ customerPhone: p.prepared.payload.customerPhone, question: text }, 'platformWhatsAppJobs/' + lease.jobId, getPlatformWhatsAppConfig().contentKey);
  return db.runTransaction(async tx => {
    const j = await readWork(tx, db, 'platformWhatsAppJobs/' + lease.jobId);
    if (j?.recordType !== 'job' || j.authorityKind !== 'actor' || j.epoch !== lease.epoch || j.leaseToken !== lease.token || j.leaseExpiresAt === null || j.leaseExpiresAt <= now || j.processingDeadlineAt === null || j.processingDeadlineAt <= now || j.audioToken !== audioToken || j.audioLeaseToken !== lease.token || !await readWorkAuthority(j, p.prepared, tx, db, now)) return false;
    if (j.audioState === 'completed') { if (workPayload(j, now)?.question !== text) throw platformWhatsAppConflictError(); return true; }
    if (j.audioState !== 'result_pending') return false;
    stageWork(tx, db, 'platformWhatsAppJobs/' + j.jobId, { ...j, audioState: 'completed', bodyState: 'body_present', content: envelope }); return true;
  });
}
/** Deterministic fallback is the same original actor job, never a new allowance. */
export async function preparePlatformAudioFallback(lease: Lease, db: Database, now = Date.now()) {
  const p = await preparedLease(lease, db, now); if (!p || p.job.authorityKind !== 'actor') return null;
  const selected: PlatformJob = { ...p.job, catalogId: 'audio_fallback', catalogVersion: 1, generationState: 'not_applicable' };
  const id = randomUUID(), outbox = prepareOutbox(selected, p.prepared.payload.customerPhone, workCatalog.audio_fallback.text, id, now);
  return db.runTransaction(async tx => {
    const j = await readWork(tx, db, 'platformWhatsAppJobs/' + lease.jobId);
    if (j?.recordType !== 'job' || j.authorityKind !== 'actor' || j.sourceKind !== 'audio' || !['failed', 'unknown'].includes(j.audioState) || j.generationState !== 'not_started' || j.outboxId !== null || j.epoch !== lease.epoch || j.leaseToken !== lease.token || j.leaseExpiresAt === null || j.leaseExpiresAt <= now || !await readWorkAuthority(j, p.prepared, tx, db, now)) return null;
    const policy = currentPlatformWorkPolicy(); await readPlatformReservation(j, 'send', maximumPlatformCost(policy.policy, 'send'), tx, db, now);
    stageReply({ ...j, catalogId: 'audio_fallback', catalogVersion: 1, generationState: 'not_applicable' }, outbox, tx, db); return { outboxId: id };
  });
}
