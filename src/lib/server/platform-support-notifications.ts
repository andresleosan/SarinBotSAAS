import 'server-only';
import { randomUUID } from 'node:crypto';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { getAdminDb } from '@/lib/firebase/admin';
import type { Database, Transaction } from '@/lib/storage/types';
import type { SupportMessage, SupportRecipient, SupportIntent } from '../../../shared/platform-support-records';
import { isSupportRecipient, SUPPORT_CONTROL_TTL, SUPPORT_BODY_TTL } from '../../../shared/platform-support-records';
import type { SupportNotificationState, SupportRecipientInput, SupportRecipientView } from '@/types/platform-support';
import { workExact, workInteger, workUuid, workObject, type PlatformJob } from '../../../shared/platform-whatsapp-work';
import { isPlatformWhatsAppEventRecord, isPlatformWhatsAppConversationRecord, PLATFORM_PHONE_PATTERN, type PlatformWhatsAppEventRecord } from '../../../shared/platform-whatsapp-records';
import { isPlatformWhatsAppLinkRecord } from '../../../shared/platform-whatsapp-link-records';
import { maximumPlatformCost } from '../../../shared/platform-whatsapp-policy';
import { currentSupportToken, currentSupportUser, repeatSupportUser, supportPermissions, sameSupportPermissions, readSupportRecord, stageSupportRecord, supportUnavailable, supportConflict, supportDenied, supportRef, supportCrypto, supportMarker, supportNow } from './platform-support-core';
import { preparePlatformSupportRecipientLink, readPlatformSupportRecipientLink, preparePlatformWhatsAppAudioRetentionIdentity, readPlatformWhatsAppAudioRetentionIdentityInTransaction } from './platform-whatsapp-link';
import { getPlatformWhatsAppConfig } from './platform-whatsapp-config';
import { decryptPlatformWhatsAppContent, encryptPlatformWhatsAppContent } from './platform-whatsapp-crypto';
import { actorAuthority, authorityFingerprint, freshWorkConnection, workContact } from './platform-whatsapp-work-authority';
import { readWork, stageWork, workHash } from './platform-whatsapp-work-records';
import { currentPlatformWorkPolicy, readPlatformReservation } from './platform-whatsapp-budget';
import { normalizePlatformWhatsAppConnection, samePlatformWhatsAppScope, platformWhatsAppIdentity } from './platform-whatsapp-store';
import { isSuperadmin } from './auth';
import { HttpError } from './http';
const configPath = 'platformSettings/platform_support_recipient';
async function recipient(tx: Transaction, db: Database): Promise<SupportRecipient | null> { const v = (await tx.get(supportRef(db, configPath))).data(); if (v === undefined) return null; if (!isSupportRecipient(v)) throw supportUnavailable(); return v; }
export async function configurePlatformSupportRecipient(actor: DecodedIdToken, input: SupportRecipientInput, db: Database = getAdminDb()): Promise<{ revision: number }> {
  await currentSupportToken(actor, 'admin');
  if (!input || !workExact(input, ['linkId', 'expectedRevision', 'requestId']) || !workUuid(input.linkId) || !workUuid(input.requestId) || !workInteger(input.expectedRevision)) throw new HttpError(400, 'Datos no válidos.');
  const at = supportNow(), crypto = supportCrypto(), prepared = await preparePlatformSupportRecipientLink(actor, db, at);
  if (!prepared || prepared.uid !== actor.uid || prepared.linkId !== input.linkId) throw supportDenied();
  const requestDigest = crypto.digest('config-request', [actor.uid, input.requestId]), fingerprint = crypto.digest('config-fingerprint', input), path = 'platformSupportConversations/config_' + requestDigest;
  return db.runTransaction(async tx => {
    const permissions = await supportPermissions(actor.uid, tx, db), marker = await supportMarker(tx, db, crypto, true), old = await recipient(tx, db), prior = await readSupportRecord(tx, db, path);
    if (!isSuperadmin(actor.uid) || !await readPlatformSupportRecipientLink(prepared, tx, db, at) || !sameSupportPermissions(prepared, permissions)) throw supportDenied();
    if (prior && prior.recordType !== 'config_request') throw supportUnavailable();
    if (prior && prior.expiresAt > at) { if (prior.ownerUid !== actor.uid || prior.requestFingerprint !== fingerprint) throw supportConflict(); return { revision: prior.revision }; }
    if ((old?.revision ?? 0) !== input.expectedRevision || input.expectedRevision >= Number.MAX_SAFE_INTEGER) throw supportConflict();
    const revision = input.expectedRevision + 1;
    const value: SupportRecipient = { version: 1, revision, linkId: prepared.linkId, linkRevision: prepared.linkRevision, ownerUid: actor.uid, ...permissions, createdAt: at, expiresAt: at + SUPPORT_CONTROL_TTL };
    marker(); tx.set(supportRef(db, configPath), value);
    stageSupportRecord(tx, db, path, { version: 1, recordType: 'config_request', requestDigest, requestFingerprint: fingerprint, ownerUid: actor.uid, revision, createdAt: at, expiresAt: value.expiresAt }); return { revision };
  });
}
export async function readPlatformSupportRecipient(actor: DecodedIdToken, db: Database = getAdminDb()): Promise<SupportRecipientView> {
  await currentSupportToken(actor, 'admin'); const user = await currentSupportUser({ uid: actor.uid, role: 'admin' }), at = supportNow();
  const current = await preparePlatformSupportRecipientLink(actor, db, at);
  const result = await db.runTransaction(async tx => {
    const permissions = await supportPermissions(actor.uid, tx, db), value = await recipient(tx, db);
    const valid = current && await readPlatformSupportRecipientLink(current, tx, db, at);
    return { configured: !!(value && value.expiresAt > at && value.ownerUid === actor.uid && valid && value.linkId === valid.linkId && value.linkRevision === valid.linkRevision && sameSupportPermissions(value, permissions)), revision: value?.revision ?? 0, expiresAt: value?.expiresAt ?? null };
  });
  await repeatSupportUser({ uid: actor.uid, role: 'admin' }, user); return result;
}
export function supportNotificationSourcePhone(source: PlatformWhatsAppEventRecord, path: string, now: number) {
  if (source.state !== 'body_present' || source.kind !== 'incoming_text' || source.bodyExpiresAt <= now || source.expiresAt <= now || !('customerSentAt' in source) || source.customerSentAt === null || source.customerSentAt === undefined || source.customerSentAt + SUPPORT_BODY_TTL <= now) return null;
  const config = getPlatformWhatsAppConfig(); if (!config.scope || config.contentKey.length !== 32 || !samePlatformWhatsAppScope(config.scope, source)) return null;
  let payload; try { payload = decryptPlatformWhatsAppContent(source.content, path, config.contentKey); } catch { throw supportUnavailable(); }
  if (!workObject(payload) || !workExact(payload, ['customerPhone', 'text']) || typeof payload.customerPhone !== 'string' || !PLATFORM_PHONE_PATTERN.test(payload.customerPhone) || payload.customerPhone === source.phoneE164 || workContact(payload.customerPhone, source) !== source.conversationId) throw supportUnavailable();
  return payload.customerPhone;
}
/** Current Firebase observation is prepared once outside every retry callback. */
export async function prepareSupportRecipientIdentity(db: Database, at: number) {
  const config = await db.runTransaction(tx => recipient(tx, db));
  if (!config || config.expiresAt <= at || !isSuperadmin(config.ownerUid)) return null;
  const observed = await db.runTransaction(async tx => {
    const link = (await tx.get(db.collection('platformWhatsAppLinks').doc('link_' + config.linkId))).data();
    if (link !== undefined && !isPlatformWhatsAppLinkRecord(link)) throw supportUnavailable();
    if (!isPlatformWhatsAppLinkRecord(link) || link.status !== 'active' || link.revision !== config.linkRevision || link.validUntil <= at) return null;
    // One bounded exact-scope source lookup, never an address book or reconstructed HMAC phone.
    const rows = await tx.get(db.collection('platformWhatsAppEvents').where('recordType', '==', 'event').where('conversationId', '==', link.conversationId).where('state', '==', 'body_present').orderBy('bodyExpiresAt', 'desc').limit(1));
    const row = rows.docs[0]; if (!row) return null; const source = row.data(), path = 'platformWhatsAppEvents/' + row.id;
    if (!isPlatformWhatsAppEventRecord(source) || !/^event_[a-f0-9]{64}$/.test(row.id) || source.conversationId !== link.conversationId) throw supportUnavailable();
    const phone = supportNotificationSourcePhone(source, path, at); return phone ? { source, path, phone } : null;
  });
  if (!observed) return null;
  const identity = await preparePlatformWhatsAppAudioRetentionIdentity(observed.phone, observed.source, db, at);
  if (!identity || identity.uid !== config.ownerUid || identity.linkId !== config.linkId || identity.linkRevision !== config.linkRevision || !sameSupportPermissions(identity, config)) return null;
  const result = { config, ...observed, identity }; preparedRecipients.add(result); return result;
}
type PreparedRecipient = Awaited<ReturnType<typeof prepareSupportRecipientIdentity>>;
const preparedRecipients = new WeakSet<object>();
type NotificationInput = { conversationId: string; messageId: string; authorUid: string; at: number };
export function allocateSupportNotification(messageId: string, prepared: PreparedRecipient) {
  const jobId = 'job_' + workHash('operator-notification', messageId);
  return { jobId, epoch: randomUUID(), outboxId: randomUUID(), content: prepared ? encryptPlatformWhatsAppContent({ customerPhone: prepared.phone, question: null }, 'platformWhatsAppJobs/' + jobId, getPlatformWhatsAppConfig().contentKey) : null };
}
export async function prepareSupportNotification(tx: Transaction, input: NotificationInput, db: Database): Promise<{ state: 'pending' | 'blocked'; outboxId: string | null }> {
  return prepareSupportNotificationWithIdentity(tx, input, db, null, null);
}
/** Reads everything before applying the returned queue/intent writes in the caller transaction. */
export async function prepareSupportNotificationWithIdentity(tx: Transaction, input: NotificationInput, db: Database, prepared: PreparedRecipient, allocation: ReturnType<typeof allocateSupportNotification> | null): Promise<{ state: 'pending' | 'blocked'; outboxId: string | null }> {
  const thread = await readSupportRecord(tx, db, 'platformSupportConversations/' + input.conversationId), prior = await readSupportRecord(tx, db, 'platformSupportMessages/intent_' + input.messageId);
  if (!thread || thread.recordType !== 'conversation' || thread.ownerUid !== input.authorUid || thread.expiresAt <= input.at) throw supportUnavailable();
  if (prior) { if (prior.recordType !== 'notification_intent' || prior.authorUid !== input.authorUid || prior.conversationId !== input.conversationId) throw supportUnavailable(); return { state: prior.state, outboxId: prior.outboxId }; }
  const intent: SupportIntent = { version: 1, recordType: 'notification_intent', messageId: input.messageId, conversationId: input.conversationId, authorUid: input.authorUid, state: 'blocked', jobId: null, outboxId: null, createdAt: input.at, expiresAt: thread.expiresAt };
  const prepare = async () => {
    if (!prepared || !preparedRecipients.has(prepared) || !allocation?.content) return null;
    const config = await recipient(tx, db); if (JSON.stringify(config) !== JSON.stringify(prepared.config)) throw supportConflict();
    if (!config || config.expiresAt <= input.at || !isSuperadmin(config.ownerUid)) return null;
    const source = (await tx.get(supportRef(db, prepared.path))).data(); if (!isPlatformWhatsAppEventRecord(source)) throw supportUnavailable();
    if (!('customerSentAt' in source) || source.customerSentAt === null || source.customerSentAt === undefined || JSON.stringify(source) !== JSON.stringify(prepared.source) || supportNotificationSourcePhone(source, prepared.path, input.at) !== prepared.phone) return null;
    const identity = await readPlatformWhatsAppAudioRetentionIdentityInTransaction(prepared.identity, prepared.phone, source, tx, db, input.at); if (!identity || identity.uid !== config.ownerUid || !sameSupportPermissions(identity, config)) return null;
    const h = await readWork(tx, db, 'platformWhatsAppJobs/head_' + source.conversationId), conversation = (await tx.get(db.collection('platformWhatsAppConversations').doc(source.conversationId))).data(), connection = normalizePlatformWhatsAppConnection((await tx.get(db.collection('serverSettings').doc('platform_whatsapp'))).data(), source, input.at);
    if (h && h.recordType !== 'control_head' || conversation !== undefined && !isPlatformWhatsAppConversationRecord(conversation)) throw supportUnavailable();
    if (h?.recordType !== 'control_head' || h.entryState !== 'bot' || !['idle', 'active', 'advance'].includes(h.status) || h.expiresAt <= input.at || h.botAuthorityFingerprint !== authorityFingerprint(actorAuthority(identity)) || !isPlatformWhatsAppConversationRecord(conversation) || conversation.mode !== 'bot' || h.attachedConversationRevision !== conversation.revision || !freshWorkConnection(connection, input.at) || connection.connectionRevision !== h.connectionRevision || source.connectionRevision !== h.connectionRevision || !samePlatformWhatsAppScope(source, h)) return null;
    const tail = h.tailJobId ? await readWork(tx, db, 'platformWhatsAppJobs/' + h.tailJobId) : null;
    if (tail && (tail.recordType !== 'job' || tail.nextJobId !== null || tail.controlEpoch !== h.controlEpoch || tail.controlRevision !== h.controlRevision || tail.conversationId !== h.conversationId)) throw supportUnavailable();
    const binding = { conversationId: thread.id, messageId: input.messageId, configRevision: config.revision, outboxId: allocation.outboxId, bodyExpiresAt: Math.min(input.at + SUPPORT_BODY_TTL, thread.expiresAt), expiresAt: thread.expiresAt };
    const job: PlatformJob = { ...platformWhatsAppIdentity(source), ...actorAuthority(identity), recordType: 'job', jobId: allocation.jobId, epoch: allocation.epoch, supportNotification: binding, sourceEventId: prepared.path.split('/')[1], sourceKind: 'text', kind: 'operator_notification', requestFingerprint: source.fingerprint, conversationId: source.conversationId, controlEpoch: h.controlEpoch, controlRevision: h.controlRevision, connectionRevision: h.connectionRevision, conversationRevision: h.attachedConversationRevision,
      sourceOccurredAt: source.occurredAt, sourceReceivedAt: source.receivedAt, createdAt: input.at, customerSentAt: source.customerSentAt!, windowExpiresAt: source.customerSentAt! + SUPPORT_BODY_TTL, bodyExpiresAt: Math.min(source.bodyExpiresAt, binding.bodyExpiresAt), expiresAt: Math.min(source.expiresAt, binding.expiresAt), status: h.headJobId ? 'waiting' : 'ready', nextJobId: null, nextAttemptAt: h.headJobId ? null : input.at, leaseToken: null, leaseClaimedAt: null, leaseExpiresAt: null, processingStartedAt: null, processingDeadlineAt: null, outboxId: null, outputKind: 'none', catalogId: null, catalogVersion: null, bodyState: 'body_present', content: allocation.content,
      audioState: 'not_applicable', audioToken: null, audioLeaseToken: null, audioReservationId: null, audioStartedAt: null, audioFinishedAt: null, generationState: 'not_applicable', generationToken: null, generationLeaseToken: null, generationReservationId: null, generationStartedAt: null, generationFinishedAt: null };
    try { const p = currentPlatformWorkPolicy(); await readPlatformReservation(job, 'send', maximumPlatformCost(p.policy, 'send'), tx, db, input.at); } catch (e) { if (e instanceof HttpError && e.code === 'PLATFORM_WORK_CLOSED') return null; throw e; }
    return { job, head: h, tail };
  };
  const work = await prepare();
  if (work) {
    if (work.tail?.recordType === 'job') stageWork(tx, db, 'platformWhatsAppJobs/' + work.tail.jobId, { ...work.tail, nextJobId: work.job.jobId });
    stageWork(tx, db, 'platformWhatsAppJobs/' + work.job.jobId, work.job);
    stageWork(tx, db, 'platformWhatsAppJobs/head_' + work.head.conversationId, { ...work.head, headJobId: work.head.headJobId ?? work.job.jobId, tailJobId: work.job.jobId, status: work.head.status === 'advance' ? 'advance' : 'active' });
    intent.state = 'pending'; intent.jobId = work.job.jobId; intent.outboxId = work.job.supportNotification!.outboxId;
  }
  stageSupportRecord(tx, db, 'platformSupportMessages/intent_' + input.messageId, intent); return { state: intent.state, outboxId: intent.outboxId };
}
export async function readSupportNotificationAuthority(job: PlatformJob, tx: Transaction, db: Database, at: number) {
  const n = job.supportNotification; if (job.kind !== 'operator_notification' || !n || job.authorityKind !== 'actor' || !isSuperadmin(job.uid)) return false;
  const config = await recipient(tx, db), thread = await readSupportRecord(tx, db, 'platformSupportConversations/' + n.conversationId), message = await readSupportRecord(tx, db, 'platformSupportMessages/' + n.messageId), intent = await readSupportRecord(tx, db, 'platformSupportMessages/intent_' + n.messageId);
  if (!config || config.expiresAt <= at || config.revision !== n.configRevision || config.ownerUid !== job.uid || config.linkId !== job.linkId || config.linkRevision !== job.linkRevision || !thread || thread.recordType !== 'conversation' || thread.expiresAt <= at || !message || message.recordType !== 'message' || message.author !== 'customer' || message.authorUid !== thread.ownerUid || message.conversationId !== thread.id || message.bodyExpiresAt !== n.bodyExpiresAt || message.bodyExpiresAt <= at || message.expiresAt !== n.expiresAt || !intent || intent.recordType !== 'notification_intent' || intent.state !== 'pending' || intent.jobId !== job.jobId || intent.outboxId !== n.outboxId) return false;
  try { const owner = await supportPermissions(thread.ownerUid, tx, db); return sameSupportPermissions(thread, owner); } catch (e) { if (e instanceof HttpError && e.status === 428) return false; throw e; }
}
export async function readSupportNotificationStates(tx: Transaction, messages: SupportMessage[], db: Database, at: number): Promise<Array<{ messageId: string; state: SupportNotificationState }>> {
  const result: Array<{ messageId: string; state: SupportNotificationState }> = [];
  for (const message of messages) if (message.author === 'customer') {
    const intent = await readSupportRecord(tx, db, 'platformSupportMessages/intent_' + message.id);
    if (!intent || intent.recordType !== 'notification_intent' || intent.conversationId !== message.conversationId || intent.authorUid !== message.authorUid) throw supportUnavailable();
    let state: SupportNotificationState = intent.state;
    if (intent.state === 'pending') {
      const job = await readWork(tx, db, 'platformWhatsAppJobs/' + intent.jobId), out = await readWork(tx, db, 'platformWhatsAppOutbox/' + intent.outboxId);
      if (job && (job.recordType !== 'job' || job.supportNotification?.messageId !== message.id) || out && (out.recordType !== 'outbox' || out.jobId !== intent.jobId)) throw supportUnavailable();
      if (out?.recordType === 'outbox') state = out.deliveryStatus === 'delivered' || out.deliveryStatus === 'read' ? 'delivered' : out.deliveryFailed ? 'rejected' : ['accepted', 'rejected', 'unknown', 'cancelled'].includes(out.status) ? out.status as SupportNotificationState : out.status === 'started' ? 'unknown' : 'pending';
      else if (job?.recordType === 'job' && ['cancelled', 'unknown'].includes(job.status)) state = job.status as SupportNotificationState;
      else if (!job || job.bodyExpiresAt <= at) state = 'cancelled';
    }
    result.push({ messageId: message.id, state });
  }
  return result;
}
