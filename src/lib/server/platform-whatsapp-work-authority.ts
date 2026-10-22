import 'server-only';
import { readSupportNotificationAuthority, supportNotificationSourcePhone } from './platform-support-notifications';
import { isSuperadmin } from './auth';
import type { Database, Transaction } from '@/lib/storage/types';
import type { PlatformActor } from '../../../shared/platform-whatsapp-authorization';
import { isPlatformWhatsAppConversationRecord, isPlatformWhatsAppEventRecord, PLATFORM_PHONE_PATTERN, type PlatformWhatsAppScope } from '../../../shared/platform-whatsapp-records';
import { type ActorAuthority, type PlatformJob, type PlatformOutbox, type WorkAuthority, workExact, workObject, workText } from '../../../shared/platform-whatsapp-work';
import { preparePlatformWhatsAppAudioRetentionIdentity, readPlatformWhatsAppAudioRetentionIdentityInTransaction, type AudioRetentionIdentity } from './platform-whatsapp-link';
import { getPlatformWhatsAppConfig } from './platform-whatsapp-config';
import { decryptPlatformWhatsAppContent, platformWhatsAppDigest } from './platform-whatsapp-crypto';
import { normalizePlatformWhatsAppConnection, platformWhatsAppUnavailableError, samePlatformWhatsAppScope } from './platform-whatsapp-store';
import { readWork, workHash } from './platform-whatsapp-work-records';
import { currentWorkProjection } from '../../../shared/platform-whatsapp-work-authorization';

export function actorAuthority(v: AudioRetentionIdentity): ActorAuthority {
  return { authorityKind: 'actor', uid: v.uid, confirmedAuthTime: v.confirmedAuthTime, linkId: v.linkId, linkRevision: v.linkRevision, accountRevision: v.account.revision, accountFingerprint: v.account.fingerprint, accountReceiptId: v.account.receiptId, supportRevision: v.support.revision, supportFingerprint: v.support.fingerprint, supportReceiptId: v.support.receiptId };
}
export function authorityFingerprint(v: ActorAuthority): string {
  return workHash('bot-authority', v.uid, v.confirmedAuthTime, v.linkId, v.linkRevision, v.accountRevision, v.accountFingerprint, v.accountReceiptId, v.supportRevision, v.supportFingerprint, v.supportReceiptId);
}
export function workActor(v: PlatformJob & ActorAuthority): PlatformActor {
  return { uid: v.uid, linkId: v.linkId, linkRevision: v.linkRevision, account: { revision: v.accountRevision, fingerprint: v.accountFingerprint, receiptId: v.accountReceiptId }, support: { revision: v.supportRevision, fingerprint: v.supportFingerprint, receiptId: v.supportReceiptId }, connectionRevision: v.connectionRevision, conversationRevision: v.conversationRevision! };
}
export function sameWorkAuthority(a: WorkAuthority, b: WorkAuthority): boolean {
  return a.authorityKind === 'fixed_notice' ? b.authorityKind === 'fixed_notice' && a.noticeId === b.noticeId && a.noticeVersion === b.noticeVersion : b.authorityKind === 'actor' && authorityFingerprint(a) === authorityFingerprint(b);
}
export function workContact(phone: string, scope: PlatformWhatsAppScope): string {
  const config = getPlatformWhatsAppConfig();
  if (config.contentKey.length !== 32 || !config.scope || !samePlatformWhatsAppScope(config.scope, scope)) throw platformWhatsAppUnavailableError();
  return platformWhatsAppDigest('conversation', [scope.wabaId, scope.phoneE164, scope.phoneNumberId, phone], config.contentKey);
}
export function workPayload(record: PlatformJob | PlatformOutbox, now: number): { customerPhone: string; question?: string | null; text?: string } | null {
  if (record.bodyState !== 'body_present' || !record.content || record.bodyExpiresAt <= now || record.expiresAt <= now) return null;
  const key = getPlatformWhatsAppConfig().contentKey;
  if (key.length !== 32) throw platformWhatsAppUnavailableError();
  let v: unknown;
  try { v = decryptPlatformWhatsAppContent(record.content, record.recordType === 'job' ? 'platformWhatsAppJobs/' + record.jobId : 'platformWhatsAppOutbox/' + record.outboxId, key); } catch { throw platformWhatsAppUnavailableError(); }
  const keys = record.recordType === 'outbox' ? ['customerPhone', 'text'] : record.authorityKind === 'actor' ? ['customerPhone', 'question'] : ['customerPhone'];
  if (!workObject(v) || !workExact(v, keys) || typeof v.customerPhone !== 'string' || !PLATFORM_PHONE_PATTERN.test(v.customerPhone) || v.customerPhone === record.phoneE164 || workContact(v.customerPhone, record) !== record.conversationId || record.recordType === 'outbox' && !workText(v.text, 'reply') || record.recordType === 'job' && record.authorityKind === 'actor' && v.question !== null && !workText(v.question, 'question')) throw platformWhatsAppUnavailableError();
  return v as { customerPhone: string; question?: string | null; text?: string };
}
export async function prepareWorkIdentity(job: PlatformJob, db: Database, now: number) {
  if (['admin_query', 'operator_notification'].includes(job.kind) && (job.authorityKind !== 'actor' || !isSuperadmin(job.uid))) return null;
  const payload = workPayload(job, now);
  if (!payload) return null;
  const identity = job.authorityKind === 'actor' ? await preparePlatformWhatsAppAudioRetentionIdentity(payload.customerPhone, job, db, now) : null;
  if (job.authorityKind === 'actor' && (!identity || !sameWorkAuthority(job, actorAuthority(identity)))) return null;
  return { payload, identity };
}
export type PreparedWork = NonNullable<Awaited<ReturnType<typeof prepareWorkIdentity>>>;
export function freshWorkConnection(connection: ReturnType<typeof normalizePlatformWhatsAppConnection>, now: number): boolean {
  return connection.providerConnection === 'connected' && !connection.paused && connection.observationStatus === 'connected' && connection.observationRevision === connection.connectionRevision && connection.observedAt !== null && connection.observedAt !== undefined && connection.observedAt <= now && now - connection.observedAt < 300_000;
}
/** A prepared Firebase result is necessary, never sufficient, for an actor effect. */
export async function readWorkAuthority(job: PlatformJob, prepared: PreparedWork, tx: Transaction, db: Database, now: number) {
  const [h, s, c, v] = await Promise.all([readWork(tx, db, 'platformWhatsAppJobs/head_' + job.conversationId), tx.get(db.collection('platformWhatsAppEvents').doc(job.sourceEventId)), tx.get(db.collection('serverSettings').doc('platform_whatsapp')), tx.get(db.collection('platformWhatsAppConversations').doc(job.conversationId))]);
  const source = s.data(), conversation = v.data(), connection = normalizePlatformWhatsAppConnection(c.data(), job, now);
  if (h && h.recordType !== 'control_head' || source !== undefined && !isPlatformWhatsAppEventRecord(source) || conversation !== undefined && !isPlatformWhatsAppConversationRecord(conversation)) throw platformWhatsAppUnavailableError();
  if (!currentWorkProjection(job, { head: h, source, conversation, connection }, now)) return null;
  if (h?.recordType !== 'control_head' || !isPlatformWhatsAppEventRecord(source) || h.expiresAt <= now || h.receivedAt > now || h.status !== 'active' || h.headJobId !== job.jobId || h.controlEpoch !== job.controlEpoch || h.controlRevision !== job.controlRevision || h.connectionRevision !== job.connectionRevision || h.attachedConversationRevision !== job.conversationRevision || h.entryState === 'human_paused'
    || ['admin_query', 'operator_notification'].includes(job.kind) && (job.authorityKind !== 'actor' || !isSuperadmin(job.uid)) || !freshWorkConnection(connection, now) || connection.connectionRevision !== job.connectionRevision
    || source.conversationId !== job.conversationId || source.fingerprint !== job.requestFingerprint || source.connectionRevision !== job.connectionRevision || source.occurredAt !== job.sourceOccurredAt || source.receivedAt !== job.sourceReceivedAt || Math.min(source.bodyExpiresAt, job.supportNotification?.bodyExpiresAt ?? Infinity) !== job.bodyExpiresAt || Math.min(source.expiresAt, job.supportNotification?.expiresAt ?? Infinity) !== job.expiresAt || !samePlatformWhatsAppScope(source, job) || !samePlatformWhatsAppScope(h, job)
    || !('customerSentAt' in source) || source.customerSentAt !== job.customerSentAt || job.customerSentAt === null || job.windowExpiresAt === null || job.windowExpiresAt <= now || job.bodyExpiresAt <= now || job.expiresAt <= now || job.sourceReceivedAt > now || job.createdAt > now || !workPayload(job, now)) return null;
  if (job.conversationRevision === null ? conversation !== undefined : !isPlatformWhatsAppConversationRecord(conversation) || !samePlatformWhatsAppScope(conversation, job) || conversation.expiresAt <= now || conversation.revision !== job.conversationRevision) return null;
  if (job.authorityKind === 'actor') {
    if (h.entryState !== 'bot' || h.botAuthorityFingerprint !== authorityFingerprint(job) || !isPlatformWhatsAppConversationRecord(conversation) || conversation.mode !== 'bot' || !prepared.identity) return null;
    const identity = await readPlatformWhatsAppAudioRetentionIdentityInTransaction(prepared.identity, prepared.payload.customerPhone, job, tx, db, now);
    if (!identity || !sameWorkAuthority(job, actorAuthority(identity))) return null;
  } else if (h.entryState !== 'initial') return null;
  if (job.kind === 'operator_notification' && (!await readSupportNotificationAuthority(job, tx, db, now) || supportNotificationSourcePhone(source, 'platformWhatsAppEvents/' + job.sourceEventId, now) !== prepared.payload.customerPhone)) return null;
  return { head: h, source, conversation, connection };
}
