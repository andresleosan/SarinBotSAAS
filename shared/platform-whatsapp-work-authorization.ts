import { isPlatformWhatsAppConnectionRecord, isPlatformWhatsAppConversationRecord, isPlatformWhatsAppEventRecord } from './platform-whatsapp-records.ts';
import { isPlatformWhatsAppLinkRecord, isPlatformWhatsAppLinkPhoneRecord, isPlatformWhatsAppLinkUidRecord, isPlatformWhatsAppLinkKeyMarker } from './platform-whatsapp-link-records.ts';
import { isControlHead, type PlatformJob } from './platform-whatsapp-work.ts';

export const workScopeEqual = (a: { wabaId: string; phoneE164: string; phoneNumberId: string }, b: { wabaId: string; phoneE164: string; phoneNumberId: string }) => a.wabaId === b.wabaId && a.phoneE164 === b.phoneE164 && a.phoneNumberId === b.phoneNumberId;
/** Durable predicate only. Firebase proof is independently required by Node. */
export function currentWorkProjection(job: PlatformJob, facts: { head: unknown; source: unknown; conversation: unknown; connection: unknown }, now: number): boolean {
  const { head: h, source: s, conversation: c, connection: n } = facts;
  return isControlHead(h) && isPlatformWhatsAppEventRecord(s) && isPlatformWhatsAppConnectionRecord(n)
    && workScopeEqual(job, h) && workScopeEqual(job, s) && workScopeEqual(job, n) && h.headJobId === job.jobId && h.status === 'active' && h.entryState !== 'human_paused'
    && h.controlEpoch === job.controlEpoch && h.controlRevision === job.controlRevision && h.connectionRevision === job.connectionRevision && h.attachedConversationRevision === job.conversationRevision && h.expiresAt > now && h.receivedAt <= now
    && n.connectionRevision === job.connectionRevision && n.providerConnection === 'connected' && !n.paused && n.observationStatus === 'connected' && n.observationRevision === n.connectionRevision && n.observedAt !== null && n.observedAt !== undefined && n.observedAt <= now && now - n.observedAt < 300_000
    && s.fingerprint === job.requestFingerprint && s.conversationId === job.conversationId && s.connectionRevision === job.connectionRevision && s.occurredAt === job.sourceOccurredAt && s.receivedAt === job.sourceReceivedAt && s.bodyExpiresAt === job.bodyExpiresAt && s.expiresAt === job.expiresAt && 'customerSentAt' in s && s.customerSentAt === job.customerSentAt
    && s.kind === (job.sourceKind === 'text' ? 'incoming_text' : job.sourceKind === 'audio' ? 'incoming_audio' : 'incoming_choice')
    && job.bodyExpiresAt > now && job.expiresAt > now && job.windowExpiresAt !== null && job.windowExpiresAt > now && job.sourceReceivedAt <= now && job.createdAt <= now
    && (job.conversationRevision === null ? c === undefined || c === null : isPlatformWhatsAppConversationRecord(c) && workScopeEqual(job, c) && c.revision === job.conversationRevision && c.expiresAt > now)
    && (job.authorityKind === 'fixed_notice' ? h.entryState === 'initial' : h.entryState === 'bot' && isPlatformWhatsAppConversationRecord(c) && c.mode === 'bot') && !['admin_query', 'operator_notification'].includes(job.kind);
}
export function currentWorkLink(job: PlatformJob, facts: { link: unknown; phone: unknown; owner: unknown; marker: unknown; expectedUidIndex: string; scopeDigest: string; keyFingerprint: string }, now: number): boolean {
  const { link: l, phone: p, owner: o, marker: m } = facts;
  return job.authorityKind === 'actor' && isPlatformWhatsAppLinkRecord(l) && isPlatformWhatsAppLinkPhoneRecord(p) && isPlatformWhatsAppLinkUidRecord(o) && isPlatformWhatsAppLinkKeyMarker(m)
    && m.scopeDigest === facts.scopeDigest && m.keyFingerprint === facts.keyFingerprint && workScopeEqual(l, job) && workScopeEqual(p, job) && workScopeEqual(o, job)
    && l.status === 'active' && l.validUntil > now && l.expiresAt > now && l.createdAt <= now && l.uidIndex === facts.expectedUidIndex && l.conversationId === job.conversationId && l.revision === job.linkRevision && l.confirmedAuthTime === job.confirmedAuthTime
    && o.ownerUid === job.uid && o.uidIndex === l.uidIndex && o.currentLinkId === job.linkId && o.expiresAt > now && o.createdAt <= now
    && p.uidIndex === l.uidIndex && p.linkId === job.linkId && p.phoneIndex === l.phoneIndex && p.linkRevision === l.revision && p.createdAt === l.createdAt && p.expiresAt === l.expiresAt
    && l.account.revision === job.accountRevision && l.account.fingerprint === job.accountFingerprint && l.account.receiptId === job.accountReceiptId && l.support.revision === job.supportRevision && l.support.fingerprint === job.supportFingerprint && l.support.receiptId === job.supportReceiptId;
}
