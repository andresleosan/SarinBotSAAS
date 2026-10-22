import { parsePlatformWorkPolicy, parseGenerationPolicy, type WorkPolicyEnvironment } from './platform-whatsapp-policy.ts';
import { isPlatformWhatsAppConnectionRecord, isPlatformWhatsAppConversationRecord, isPlatformWhatsAppEventRecord } from './platform-whatsapp-records.ts';
import { isPlatformWhatsAppLinkRecord, isPlatformWhatsAppLinkPhoneRecord, isPlatformWhatsAppLinkUidRecord, isPlatformWhatsAppLinkKeyMarker } from './platform-whatsapp-link-records.ts';
import { isControlHead, isPlatformJob, isPlatformOutbox, outboxMatchesJob, isBudgetCall, type PlatformJob } from './platform-whatsapp-work.ts';

export const workScopeEqual = (a: { wabaId: string; phoneE164: string; phoneNumberId: string }, b: { wabaId: string; phoneE164: string; phoneNumberId: string }) => a.wabaId === b.wabaId && a.phoneE164 === b.phoneE164 && a.phoneNumberId === b.phoneNumberId;
/** Durable predicate only. Firebase proof is independently required by Node. */
export function currentWorkProjection(job: PlatformJob, facts: { head: unknown; source: unknown; conversation: unknown; connection: unknown }, now: number, requireObservation = true): boolean {
  const { head: h, source: s, conversation: c, connection: n } = facts;
  return isControlHead(h) && isPlatformWhatsAppEventRecord(s) && isPlatformWhatsAppConnectionRecord(n)
    && workScopeEqual(job, h) && workScopeEqual(job, s) && workScopeEqual(job, n) && h.headJobId === job.jobId && h.status === 'active' && h.entryState !== 'human_paused'
    && h.controlEpoch === job.controlEpoch && h.controlRevision === job.controlRevision && h.connectionRevision === job.connectionRevision && h.attachedConversationRevision === job.conversationRevision && h.expiresAt > now && h.receivedAt <= now
    && n.connectionRevision === job.connectionRevision && n.providerConnection === 'connected' && !n.paused && (!requireObservation || n.observationStatus === 'connected' && n.observationRevision === n.connectionRevision && n.observedAt !== null && n.observedAt !== undefined && n.observedAt <= now && now - n.observedAt < 300_000)
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

/** Read-only bounded scheduling proof. It never authorizes a stage effect. */
export async function potentialPlatformWork(read: (path: string) => Promise<unknown>, candidates: (root: string, status: string) => Promise<Array<{ path: string; data: unknown }>>, env: Record<string, unknown>, now: number): Promise<boolean> {
  if (env.PLATFORM_WHATSAPP_PROCESSING_ENABLED !== 'true' || env.SARIN_MAINTENANCE === 'true') return false;
  const scope = { wabaId: env.PLATFORM_WHATSAPP_WABA_ID, phoneE164: env.PLATFORM_WHATSAPP_PHONE_E164, phoneNumberId: env.PLATFORM_WHATSAPP_PHONE_NUMBER_ID };
  const policy = parsePlatformWorkPolicy(env as WorkPolicyEnvironment); if (!policy) return false;
  const check = async (job: PlatformJob, advance = false): Promise<boolean> => {
    if (job.wabaId !== scope.wabaId || job.phoneE164 !== scope.phoneE164 || job.phoneNumberId !== scope.phoneNumberId || job.bodyState !== 'body_present' || job.processingDeadlineAt !== null && now >= job.processingDeadlineAt) return false;
    const head = await read('platformWhatsAppJobs/head_' + job.conversationId);
    const facts = { head: advance && isControlHead(head) && head.status === 'advance' ? { ...head, status: 'active' } : head, source: await read('platformWhatsAppEvents/' + job.sourceEventId), conversation: await read('platformWhatsAppConversations/' + job.conversationId), connection: await read('serverSettings/platform_whatsapp') };
    if (!currentWorkProjection(job, facts, now, false)) return false;
    const stage = job.outboxId || job.catalogId ? 'send' : job.sourceKind === 'audio' && job.audioState !== 'completed' ? 'audio' : 'generation';
    if (!policy.enabled[stage] || policy.limits[stage] <= 0 || stage === 'send' && !policy.tariff.sendEvidence || stage === 'generation' && !parseGenerationPolicy(typeof env.PLATFORM_WHATSAPP_GENERATION_POLICY === 'string' ? env.PLATFORM_WHATSAPP_GENERATION_POLICY : undefined)) return false;
    if (stage === 'audio' && env.PLATFORM_WHATSAPP_TRANSCRIPTION_ENABLED !== 'true') return false;
    return true;
  };
  for (const status of ['prepared', 'claimed']) for (const row of await candidates('platformWhatsAppOutbox', status)) {
    const out = row.data;
    if (!isPlatformOutbox(out) || row.path !== 'platformWhatsAppOutbox/' + out.outboxId || out.status !== status || out.bodyState !== 'body_present') continue;
    const job = await read('platformWhatsAppJobs/' + out.jobId);
    if (!isPlatformJob(job) || job.status !== 'reply_saved' || !outboxMatchesJob(out, job) || !await check(job)) continue;
    if (out.status === 'claimed') { const call = out.sendReservationId ? await read('platformWhatsAppBudgetCalls/' + out.sendReservationId) : null; if (!isBudgetCall(call) || call.status !== 'reserved' || call.stage !== 'send' || call.jobId !== job.jobId || call.epoch !== job.epoch || call.requestFingerprint !== job.requestFingerprint || call.expiresAt !== job.expiresAt || !workScopeEqual(call, job)) continue; }
    return true;
  }
  for (const status of ['ready', 'leased', 'advance']) for (const row of await candidates('platformWhatsAppJobs', status)) {
    const value = row.data;
    const job = isControlHead(value) && value.status === 'advance' && row.path === 'platformWhatsAppJobs/head_' + value.conversationId && value.headJobId ? await read('platformWhatsAppJobs/' + value.headJobId) : value;
    if (!isPlatformJob(job) || !['ready', 'waiting', 'leased'].includes(job.status) || job.outboxId !== null || !['not_started', 'not_applicable'].includes(job.generationState) || !['not_started', 'not_applicable', 'completed'].includes(job.audioState)) continue;
    if (status !== 'advance' && (row.path !== 'platformWhatsAppJobs/' + job.jobId || job.nextAttemptAt === null || job.nextAttemptAt > now)) continue;
    if (await check(job, status === 'advance')) return true;
  }
  return false;
}
