import 'server-only';
import type { Database, Transaction } from '@/lib/storage/types';
import { isPlatformWhatsAppConversationRecord, PLATFORM_METADATA_TTL, type PlatformWhatsAppScope } from '../../../shared/platform-whatsapp-records';
import { isPlatformWhatsAppLinkUidRecord, isPlatformWhatsAppLinkRecord } from '../../../shared/platform-whatsapp-link-records';
import { readWork, stageWork, checkedAdd } from './platform-whatsapp-work-records';
import { platformWhatsAppUnavailableError, samePlatformWhatsAppScope } from './platform-whatsapp-store';

export async function readWorkCancellation(id: string, scope: PlatformWhatsAppScope, tx: Transaction, db: Database) {
  const head = await readWork(tx, db, 'platformWhatsAppJobs/head_' + id);
  if (!head) return null;
  if (head.recordType !== 'control_head' || !samePlatformWhatsAppScope(head, scope)) throw platformWhatsAppUnavailableError();
  const job = head.headJobId ? await readWork(tx, db, 'platformWhatsAppJobs/' + head.headJobId) : null;
  if (job && (job.recordType !== 'job' || job.conversationId !== id || !samePlatformWhatsAppScope(job, scope))) throw platformWhatsAppUnavailableError();
  const outbox = job?.recordType === 'job' && job.outboxId ? await readWork(tx, db, 'platformWhatsAppOutbox/' + job.outboxId) : null;
  if (outbox && (outbox.recordType !== 'outbox' || outbox.jobId !== job?.jobId || outbox.epoch !== job?.epoch || !samePlatformWhatsAppScope(outbox, scope))) throw platformWhatsAppUnavailableError();
  return { head, job, outbox };
}
export function stageWorkCancellation(facts: Awaited<ReturnType<typeof readWorkCancellation>>, revision: number | null, tx: Transaction, db: Database, now: number) {
  if (!facts) return;
  const { head, job, outbox } = facts;
  stageWork(tx, db, 'platformWhatsAppJobs/head_' + head.conversationId, { ...head, controlRevision: checkedAdd(head.controlRevision, 1), attachedConversationRevision: revision, entryState: 'human_paused', botAuthorityFingerprint: null, headJobId: null, tailJobId: null, currentMenuOutboxId: null, status: 'idle', nextAttemptAt: null, receivedAt: now, expiresAt: now + PLATFORM_METADATA_TTL });
  if (job?.recordType === 'job' && job.controlEpoch === head.controlEpoch && job.controlRevision === head.controlRevision && !['completed', 'cancelled', 'unknown'].includes(job.status)) stageWork(tx, db, 'platformWhatsAppJobs/' + job.jobId, { ...job, status: 'cancelled', nextAttemptAt: null });
  if (outbox?.recordType === 'outbox' && outbox.controlEpoch === head.controlEpoch && outbox.controlRevision === head.controlRevision && !['accepted', 'rejected', 'unknown', 'cancelled'].includes(outbox.status)) stageWork(tx, db, 'platformWhatsAppOutbox/' + outbox.outboxId, { ...outbox, status: 'cancelled', sendFinishedAt: now });
}
/** Key-independent bounded owner lookup; no customer/contact history scan. */
export async function readOwnerWorkCancellation(uid: string, tx: Transaction, db: Database) {
  const found = await tx.get(db.collection('platformWhatsAppLinks').where('ownerUid', '==', uid).limit(2));
  if (found.size > 1) throw platformWhatsAppUnavailableError();
  const doc = found.docs[0]; if (!doc) return null;
  const owner = doc.data(); if (!isPlatformWhatsAppLinkUidRecord(owner) || owner.ownerUid !== uid || doc.id !== 'uid_' + owner.uidIndex) throw platformWhatsAppUnavailableError();
  if (!owner.currentLinkId) return null;
  const link = (await tx.get(db.collection('platformWhatsAppLinks').doc('link_' + owner.currentLinkId))).data();
  if (!isPlatformWhatsAppLinkRecord(link) || link.uidIndex !== owner.uidIndex || !samePlatformWhatsAppScope(link, owner)) throw platformWhatsAppUnavailableError();
  const conversation = (await tx.get(db.collection('platformWhatsAppConversations').doc(link.conversationId))).data();
  if (conversation !== undefined && (!isPlatformWhatsAppConversationRecord(conversation) || !samePlatformWhatsAppScope(conversation, owner))) throw platformWhatsAppUnavailableError();
  return { id: link.conversationId, conversation, cancellation: await readWorkCancellation(link.conversationId, owner, tx, db) };
}
export function stageOwnerWorkCancellation(facts: Awaited<ReturnType<typeof readOwnerWorkCancellation>>, tx: Transaction, db: Database, now: number) {
  if (!facts?.cancellation) return;
  const revision = facts.conversation ? checkedAdd(facts.conversation.revision, 1) : null;
  if (facts.conversation) tx.set(db.collection('platformWhatsAppConversations').doc(facts.id), { ...facts.conversation, mode: 'human', revision });
  stageWorkCancellation(facts.cancellation, revision, tx, db, now);
}
