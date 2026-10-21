import 'server-only';
import type { Database, Transaction } from '@/lib/storage/types';
import type { ControlHead, PlatformJob } from '../../../shared/platform-whatsapp-work';
import { readWork, stageWork } from './platform-whatsapp-work-records';
import { samePlatformWhatsAppScope } from './platform-whatsapp-store';
import { HttpError } from './http';
import type { WorkRecord } from '../../../shared/platform-whatsapp-work';

export const dueWork = (db: Database, status: string, now: number, limit = 25) => db.collection('platformWhatsAppJobs').where('status', '==', status).where('nextAttemptAt', '<=', now).orderBy('nextAttemptAt', 'asc').limit(limit);
export async function hasDuePlatformWork(db: Database, now: number): Promise<boolean> {
  for (const status of ['ready', 'leased', 'reply_saved', 'advance']) if (!(await dueWork(db, status, now, 1).get()).empty) return true;
  return false;
}
/** Reads <=20 exact queue edges. Returned closure performs writes only. */
export async function prepareHeadAdvance(head: ControlHead, from: PlatformJob | null, tx: Transaction, db: Database, now: number) {
  let id = from ? from.nextJobId : head.headJobId;
  const cancelled: PlatformJob[] = [], seen = new Set<string>(from ? [from.jobId] : []);
  let updated: ControlHead = head, promoted: PlatformJob | null = null;
  for (let n = 0; ; n++) {
    if (!id) { updated = { ...head, headJobId: null, tailJobId: null, status: 'idle', nextAttemptAt: null }; break; }
    if (n === 20) { updated = { ...head, headJobId: id, status: 'advance', nextAttemptAt: now }; break; }
    if (seen.has(id)) { updated = { ...head, status: 'repair_needed', nextAttemptAt: null }; break; } seen.add(id);
    let job: WorkRecord | null;
    try { job = await readWork(tx, db, 'platformWhatsAppJobs/' + id); }
    catch (error) { if (!(error instanceof HttpError) || error.code !== 'PLATFORM_WORK_CORRUPT') throw error; updated = { ...head, status: 'repair_needed', nextAttemptAt: null }; break; }
    if (job?.recordType !== 'job' || !samePlatformWhatsAppScope(job, head) || job.conversationId !== head.conversationId || job.controlEpoch !== head.controlEpoch || job.controlRevision !== head.controlRevision || (job.nextJobId === null) !== (head.tailJobId === job.jobId)) { updated = { ...head, status: 'repair_needed', nextAttemptAt: null }; break; }
    if (['waiting', 'ready'].includes(job.status) && job.bodyExpiresAt > now && job.expiresAt > now && job.windowExpiresAt !== null && job.windowExpiresAt > now && job.connectionRevision === head.connectionRevision && job.conversationRevision === head.attachedConversationRevision && head.entryState !== 'human_paused') {
      promoted = { ...job, status: 'ready', nextAttemptAt: now }; updated = { ...head, headJobId: job.jobId, status: 'active', nextAttemptAt: null }; break;
    }
    if (!['completed', 'cancelled', 'unknown'].includes(job.status)) cancelled.push({ ...job, status: 'cancelled', nextAttemptAt: null });
    id = job.nextJobId;
  }
  return () => {
    for (const j of cancelled) stageWork(tx, db, 'platformWhatsAppJobs/' + j.jobId, j);
    if (promoted) stageWork(tx, db, 'platformWhatsAppJobs/' + promoted.jobId, promoted);
    stageWork(tx, db, 'platformWhatsAppJobs/head_' + head.conversationId, updated);
  };
}
