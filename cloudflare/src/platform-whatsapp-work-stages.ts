import { executeDataCommand, DataError } from './data.ts';
import type { DataCommand, DataWrite } from '../../shared/data-protocol.ts';
import { isWorkRecordAtPath, isPlatformJob, type Lease, type PlatformJob, type BudgetCall, type BudgetPeriod, type BudgetCircuit, type Usage, emptyUsage, validUsage, workDigest, workInteger, workObject } from '../../shared/platform-whatsapp-work.ts';
import { isPlatformWhatsAppEventRecord, isPlatformWhatsAppConnectionRecord, isPlatformWhatsAppConversationRecord } from '../../shared/platform-whatsapp-records.ts';
import { isPlatformWhatsAppLinkRecord, isPlatformWhatsAppLinkPhoneRecord, isPlatformWhatsAppLinkUidRecord, isPlatformWhatsAppLinkKeyMarker, isPlatformWhatsAppLinkChallengeRecord } from '../../shared/platform-whatsapp-link-records.ts';
import { currentWorkProjection, currentWorkLink, workScopeEqual } from '../../shared/platform-whatsapp-work-authorization.ts';
import { parsePlatformWorkPolicy, platformPolicyTuple, maximumPlatformCost } from '../../shared/platform-whatsapp-policy.ts';
import { consentContent } from '../../src/lib/legal.ts';
import { platformSettlementPeriod } from '../../shared/platform-whatsapp-accounting.ts';

type Env = Pick<CloudflareBindings, 'SARIN_DB' | 'SARIN_FILES'> & PlatformWhatsAppBindings;
const unavailable = () => new DataError(503, 'DATA_UNAVAILABLE');
const conflict = () => new DataError(409, 'DATA_CONFLICT');
const bytes = (v: string) => new TextEncoder().encode(v);
const hex = (v: ArrayBuffer) => [...new Uint8Array(v)].map(n => n.toString(16).padStart(2, '0')).join('');
const hash = async (v: unknown) => hex(await crypto.subtle.digest('SHA-256', bytes(JSON.stringify(v))));
const workHash = (domain: string, ...parts: unknown[]) => hash(['sarin/platform-whatsapp', 1, domain, ...parts]);
function canonical(v: unknown): unknown { return Array.isArray(v) ? v.map(canonical) : workObject(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, x]) => [k, canonical(x)])) : v; }
async function keyed(domain: string, parts: string[], encoded: string | undefined) {
  if (!encoded || !/^[A-Za-z0-9+/]{43}=$/.test(encoded)) throw unavailable();
  const raw = Uint8Array.from(atob(encoded), c => c.charCodeAt(0)); if (raw.length !== 32) throw unavailable();
  const key = await crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const derived = await crypto.subtle.sign('HMAC', key, bytes(JSON.stringify(['sarin/platform-whatsapp', 1, 'digest-key', domain])));
  const subkey = await crypto.subtle.importKey('raw', derived, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', subkey, bytes(JSON.stringify(parts))));
}
type Reader = { get(path: string): Promise<Record<string, unknown> | undefined>; owner(uid: string): Promise<Array<{ path: string; data: Record<string, unknown> }>>; set(path: string, data: object): void };
/** Same CAS/revision/journal protocol as application storage; never raw revision SQL. */
async function transaction<T>(env: Env, handler: (tx: Reader) => Promise<T>): Promise<T> {
  let command: Extract<DataCommand, { action: 'commit' }> | undefined, result: T | undefined;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      if (!command) {
        let revision: number | undefined; const writes: DataWrite[] = [];
        const read = async (read: Extract<DataCommand, { action: 'read' }>['read']) => {
          if (writes.length) throw unavailable();
          const r = await executeDataCommand({ action: 'read', read }, env);
          if (!('documents' in r)) throw unavailable();
          if (revision !== undefined && revision !== r.revision) throw conflict(); revision = r.revision; return r.documents;
        };
        result = await handler({ get: async path => (await read({ kind: 'document', path }))[0]?.data, owner: uid => read({ kind: 'query', path: 'platformWhatsAppLinks', filters: [{ field: 'ownerUid', op: '==', value: uid }], order: [], limit: 2 }), set: (path, data) => {
          if (writes.length >= 100 || (path.startsWith('platformWhatsAppEvents/') ? !isPlatformWhatsAppEventRecord(data) : !isWorkRecordAtPath(path, data))) throw unavailable();
          writes.push({ op: 'set', path, data: data as Record<string, unknown> });
        } });
        if (!writes.length) return result;
        if (revision === undefined) throw unavailable(); command = { action: 'commit', expectedRevision: revision, requestId: crypto.randomUUID(), writes };
      }
      await executeDataCommand(command, env); return result!;
    } catch (e) { if (e instanceof DataError && e.code === 'DATA_CONFLICT') { command = undefined; continue; } if (command && attempt < 2) continue; throw e; }
  }
  throw conflict();
}
async function readJob(lease: Lease, tx: Reader): Promise<PlatformJob | null> {
  const j = await tx.get('platformWhatsAppJobs/' + lease.jobId);
  if (j !== undefined && (!isPlatformJob(j) || j.jobId !== lease.jobId)) throw unavailable();
  return j && isPlatformJob(j) && j.epoch === lease.epoch ? j : null;
}
async function authorized(job: PlatformJob, lease: Lease, env: Env, tx: Reader, now: number): Promise<boolean> {
  if (job.authorityKind !== 'actor' || !['customer_reply', 'admin_query'].includes(job.kind) || job.kind === 'admin_query' && (!env.SUPERADMIN_UID || env.SUPERADMIN_UID !== job.uid) || job.sourceKind !== 'audio' || job.status !== 'leased' || job.leaseToken !== lease.token || job.leaseExpiresAt === null || job.leaseExpiresAt <= now || job.processingDeadlineAt === null || job.processingDeadlineAt <= now) return false;
  const [head, source, conversation, connection, link] = await Promise.all([tx.get('platformWhatsAppJobs/head_' + job.conversationId), tx.get('platformWhatsAppEvents/' + job.sourceEventId), tx.get('platformWhatsAppConversations/' + job.conversationId), tx.get('serverSettings/platform_whatsapp'), tx.get('platformWhatsAppLinks/link_' + job.linkId)]);
  if (head !== undefined && !isWorkRecordAtPath('platformWhatsAppJobs/head_' + job.conversationId, head)
    || source !== undefined && !isPlatformWhatsAppEventRecord(source)
    || conversation !== undefined && !isPlatformWhatsAppConversationRecord(conversation)
    || connection !== undefined && !isPlatformWhatsAppConnectionRecord(connection)
    || link !== undefined && !isPlatformWhatsAppLinkRecord(link)) throw unavailable();
  if (isPlatformWhatsAppEventRecord(source) && (!workScopeEqual(source, job) || source.conversationId !== job.conversationId || source.fingerprint !== job.requestFingerprint || source.receivedAt !== job.sourceReceivedAt || source.occurredAt !== job.sourceOccurredAt || source.bodyExpiresAt !== job.bodyExpiresAt || source.expiresAt !== job.expiresAt || source.connectionRevision !== job.connectionRevision || source.kind !== 'incoming_audio' || source.ingressDisposition !== 'descriptor_retained' || source.customerSentAt !== job.customerSentAt)) throw unavailable();
  if (isPlatformWhatsAppLinkRecord(link) && (!workScopeEqual(link, job) || link.conversationId !== job.conversationId || link.createdAt > now)) throw unavailable();
  if (!currentWorkProjection(job, { head, source, conversation, connection }, now) || !isPlatformWhatsAppEventRecord(source) || source.kind !== 'incoming_audio' || source.ingressDisposition !== 'descriptor_retained' || source.state !== 'body_present' || !isPlatformWhatsAppLinkRecord(link)) return false;
  if (link.status === 'revoked' || link.validUntil <= now) return false;
  const scope = [job.wabaId, job.phoneE164, job.phoneNumberId];
  if (env.PLATFORM_WHATSAPP_WABA_ID !== job.wabaId || env.PLATFORM_WHATSAPP_PHONE_E164 !== job.phoneE164 || env.PLATFORM_WHATSAPP_PHONE_NUMBER_ID !== job.phoneNumberId) return false;
  const scopeDigest = await hash(['sarin-link-scope', 1, ...scope]), expectedUidIndex = await keyed('link-uid-v1', [...scope, job.uid], env.PLATFORM_WHATSAPP_LINK_HMAC_KEY), keyFingerprint = await keyed('link-key-marker-v1', scope, env.PLATFORM_WHATSAPP_LINK_HMAC_KEY);
  const [marker, owner, phone, owners] = await Promise.all([tx.get('serverSettings/platform_whatsapp_link_key_' + scopeDigest), tx.get('platformWhatsAppLinks/uid_' + expectedUidIndex), tx.get('platformWhatsAppLinks/phone_' + link.phoneIndex), tx.owner(job.uid)]);
  if (owners.length > 1 || owners.some(row => !isPlatformWhatsAppLinkUidRecord(row.data) || row.data.ownerUid !== job.uid || row.path !== 'platformWhatsAppLinks/uid_' + row.data.uidIndex)
    || owner !== undefined && (!isPlatformWhatsAppLinkUidRecord(owner) || owner.uidIndex !== expectedUidIndex || owner.ownerUid !== job.uid || !workScopeEqual(owner, job))
    || phone !== undefined && (!isPlatformWhatsAppLinkPhoneRecord(phone) || phone.phoneIndex !== link.phoneIndex || !workScopeEqual(phone, job))
    || marker !== undefined && (!isPlatformWhatsAppLinkKeyMarker(marker) || marker.scopeDigest !== scopeDigest || marker.keyFingerprint !== keyFingerprint)) throw unavailable();
  if (link.uidIndex !== expectedUidIndex || !isPlatformWhatsAppLinkUidRecord(owner) || owners.length !== 1 || owners[0].path !== 'platformWhatsAppLinks/uid_' + expectedUidIndex) throw unavailable();
  const currentLink = owner.currentLinkId === job.linkId ? link : owner.currentLinkId ? await tx.get('platformWhatsAppLinks/link_' + owner.currentLinkId) : undefined;
  const challenge = owner.pendingChallengeId ? await tx.get('platformWhatsAppLinkChallenges/challenge_' + owner.pendingChallengeId) : undefined;
  if (owner.currentLinkId && (!isPlatformWhatsAppLinkRecord(currentLink) || currentLink.uidIndex !== owner.uidIndex || !workScopeEqual(currentLink, owner) || currentLink.status !== 'active')
    || owner.pendingChallengeId && (!isPlatformWhatsAppLinkChallengeRecord(challenge) || challenge.uidIndex !== owner.uidIndex || !workScopeEqual(challenge, owner) || !['pending', 'verified'].includes(challenge.status))) throw unavailable();
  const dates = [...owner.issues.map(i => ({ createdAt: i.issuedAt, expiresAt: i.expiresAt })), ...isPlatformWhatsAppLinkRecord(currentLink) ? [currentLink] : [], ...isPlatformWhatsAppLinkChallengeRecord(challenge) ? [{ createdAt: challenge.createdAt, expiresAt: challenge.validUntil }] : []];
  if (!dates.length || owner.createdAt > now || owner.createdAt !== Math.max(...dates.map(d => d.createdAt)) || owner.expiresAt !== Math.max(...dates.map(d => d.expiresAt))) throw unavailable();
  if (owner.currentLinkId === job.linkId && (!isPlatformWhatsAppLinkPhoneRecord(phone) || phone.linkId !== job.linkId || phone.uidIndex !== owner.uidIndex || phone.linkRevision !== link.revision || phone.createdAt !== link.createdAt || phone.expiresAt !== link.expiresAt)) throw unavailable();
  if (!currentWorkLink(job, { link, owner, phone, marker, expectedUidIndex, scopeDigest, keyFingerprint }, now)) return false;
  const fingerprint = await workHash('bot-authority', job.uid, job.confirmedAuthTime, job.linkId, job.linkRevision, job.accountRevision, job.accountFingerprint, job.accountReceiptId, job.supportRevision, job.supportFingerprint, job.supportReceiptId);
  if (head?.botAuthorityFingerprint !== fingerprint) return false;
  for (const scopeName of ['account', 'platform_support'] as const) {
    const prefix = scopeName === 'account' ? 'account' : 'support', stateId = 'consent_state_' + await hash(canonical([job.uid, scopeName, null]));
    const state = await tx.get('serverSettings/' + stateId);
    if (!state) return false;
    if (state.version !== 1 || state.uid !== job.uid || state.scope !== scopeName || state.businessId !== null || typeof state.active !== 'boolean' || !workInteger(state.revision) || state.revision >= Number.MAX_SAFE_INTEGER || !workDigest(state.fingerprint) || typeof state.receiptId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(state.receiptId) || ['__proto__', 'constructor', 'prototype'].includes(state.receiptId)) throw unavailable();
    const receipt = await tx.get('serverSettings/' + state.receiptId);
    const expected = await hash(canonical(consentContent(scopeName)));
    if (!receipt || receipt.uid !== job.uid || receipt.scope !== scopeName || receipt.businessId !== null || receipt.revision !== state.revision || receipt.action !== (state.active ? 'accept' : 'revoke') || receipt.termsAccepted !== state.active || receipt.dataAuthorized !== state.active || !workInteger(receipt.occurredAt) || !workObject(receipt.documents)) throw unavailable();
    const { fingerprint: saved, ...documents } = receipt.documents;
    if (saved !== state.fingerprint || await hash(canonical(documents)) !== saved) throw unavailable();
    if (!state.active || state.revision !== job[`${prefix}Revision`] || state.receiptId !== job[`${prefix}ReceiptId`] || state.fingerprint !== job[`${prefix}Fingerprint`] || state.fingerprint !== expected) return false;
  }
  return true;
}
async function budget(job: PlatformJob, tx: Reader, env: Env, now: number, current: boolean) {
  const scope = [job.wabaId, job.phoneE164, job.phoneNumberId], id = 'call_' + await workHash('cost', scope, job.jobId, job.epoch, 'audio');
  const call = await tx.get('platformWhatsAppBudgetCalls/' + id);
  if (!call) return null;
  if (!isWorkRecordAtPath('platformWhatsAppBudgetCalls/' + id, call) || call.recordType !== 'budget_call') throw unavailable();
  const c = call as unknown as BudgetCall;
  const [period, circuit] = await Promise.all([tx.get('platformWhatsAppBudgetPeriods/' + c.periodId), tx.get('platformWhatsAppBudgetPeriods/' + c.circuitId)]);
  if (!period || !circuit || !isWorkRecordAtPath('platformWhatsAppBudgetPeriods/' + c.periodId, period) || !isWorkRecordAtPath('platformWhatsAppBudgetPeriods/' + c.circuitId, circuit) || period.recordType !== 'budget_period' || circuit.recordType !== 'budget_circuit' || c.jobId !== job.jobId || c.epoch !== job.epoch || c.stage !== 'audio' || c.requestFingerprint !== job.requestFingerprint || c.expiresAt !== job.expiresAt) throw unavailable();
  if (!workScopeEqual(c, job) || !workScopeEqual(period as unknown as BudgetPeriod, job) || !workScopeEqual(circuit as unknown as BudgetCircuit, job) || period.stage !== 'audio' || circuit.stage !== 'audio' || c.circuitId !== 'circuit_' + await workHash('stage-circuit', scope, 'audio') || c.periodId !== 'day_' + await workHash('day', scope, 'audio', period.dayStart) || c.createdAt < Number(period.dayStart) || c.createdAt >= Number(period.dayEnd)) throw unavailable();
  if (current) {
    const policy = parsePlatformWorkPolicy(env);
    if (!policy || !policy.enabled.audio || policy.limits.audio <= 0 || c.maximumMicros !== maximumPlatformCost(policy, 'audio') || c.policyFingerprint !== await workHash('policy', platformPolicyTuple(policy)) || circuit.policyFingerprint !== c.policyFingerprint || circuit.status !== 'open' || Number(circuit.expiresAt) <= now || Number(circuit.createdAt) > now || Number(period.dayStart) > now || Number(period.dayEnd) <= now || c.tariffVersion !== policy.tariff.version) return null;
  }
  return { call: c, period: period as unknown as BudgetPeriod, circuit: circuit as unknown as BudgetCircuit };
}
export async function preparePlatformAudio(lease: Lease, env: Env, now: number) {
  const audioToken = crypto.randomUUID();
  return transaction(env, async tx => {
    const j = await readJob(lease, tx);
    if (!j || j.audioState !== 'not_started' || !await authorized(j, lease, env, tx, now)) return null;
    const b = await budget(j, tx, env, now, true), source = await tx.get('platformWhatsAppEvents/' + j.sourceEventId);
    if (!b || b.call.status !== 'reserved' || !isPlatformWhatsAppEventRecord(source) || source.state !== 'body_present') return null;
    tx.set('platformWhatsAppJobs/' + j.jobId, { ...j, audioState: 'preparing', audioToken, audioLeaseToken: lease.token, audioReservationId: b.call.reservationId });
    if (j.authorityKind !== 'actor') throw unavailable();
    return { audioToken, sourceEventPath: 'platformWhatsAppEvents/' + j.sourceEventId, sourceEnvelope: source.content, bodyExpiresAt: j.bodyExpiresAt, processingDeadlineAt: j.processingDeadlineAt!, sourceBinding: {
      conversationId: j.conversationId,
      scope: { wabaId: j.wabaId, phoneE164: j.phoneE164, phoneNumberId: j.phoneNumberId },
      retentionAnchor: { uid: j.uid, linkId: j.linkId, linkRevision: j.linkRevision,
        account: { revision: j.accountRevision, fingerprint: j.accountFingerprint, receiptId: j.accountReceiptId },
        support: { revision: j.supportRevision, fingerprint: j.supportFingerprint, receiptId: j.supportReceiptId } },
    } };
  });
}
export async function startPlatformAudio(lease: Lease, audioToken: string, env: Env, now: number): Promise<boolean> {
  return transaction(env, async tx => {
    const j = await readJob(lease, tx);
    if (!j || j.audioState !== 'preparing' || j.audioToken !== audioToken || j.audioLeaseToken !== lease.token || !await authorized(j, lease, env, tx, now)) return false;
    const b = await budget(j, tx, env, now, true); if (!b || b.call.status !== 'reserved' || b.call.reservationId !== j.audioReservationId) return false;
    tx.set('platformWhatsAppBudgetCalls/' + b.call.reservationId, { ...b.call, status: 'started', effectToken: audioToken, startedAt: now });
    tx.set('platformWhatsAppJobs/' + j.jobId, { ...j, audioState: 'started', audioStartedAt: now }); return true;
  });
}
export type PlatformAudioOutcome = { status: 'completed' | 'failed' | 'unknown'; actualMicros: number | null; usage: Usage };
export async function finishPlatformAudio(lease: Lease, audioToken: string, outcome: PlatformAudioOutcome, env: Env, now: number): Promise<boolean> {
  return transaction(env, async tx => {
    const j = await readJob(lease, tx);
    if (!j || !['preparing', 'started'].includes(j.audioState) || j.audioToken !== audioToken || j.audioLeaseToken !== lease.token) return false;
    const permitted = await authorized(j, lease, env, tx, now), b = await budget(j, tx, env, now, false), source = await tx.get('platformWhatsAppEvents/' + j.sourceEventId);
    if (!b || b.call.reservationId !== j.audioReservationId || !isPlatformWhatsAppEventRecord(source) || source.fingerprint !== j.requestFingerprint || source.conversationId !== j.conversationId || source.receivedAt !== j.sourceReceivedAt || !validUsage(outcome.usage, 'audio')) throw unavailable();
    if (j.audioState === 'preparing' && (outcome.status === 'completed' || outcome.actualMicros !== 0 || Object.values(outcome.usage).some(v => v !== null))) throw unavailable();
    let state = permitted ? outcome.status === 'completed' ? 'result_pending' : outcome.status : 'cancelled';
    let call: BudgetCall = b.call, period: BudgetPeriod | null = null, circuit: BudgetCircuit | null = null;
    if (b.call.status === 'reserved') { if (b.period.heldMicros < b.call.maximumMicros) throw unavailable(); call = { ...b.call, status: 'released', actualMicros: 0, finishedAt: now }; period = { ...b.period, heldMicros: b.period.heldMicros - b.call.maximumMicros }; }
    else if (b.call.status === 'started' && b.call.effectToken === audioToken) {
      if (outcome.actualMicros === null) call = { ...b.call, status: 'uncertain', finishedAt: now, ...emptyUsage };
      else {
        const actual = outcome.actualMicros;
        period = platformSettlementPeriod(b.period, b.call.maximumMicros, actual, outcome.usage);
        if (!period) { state = 'unknown'; circuit = { ...b.circuit, status: 'blocked', reason: 'accounting_invalid', trippedAt: b.circuit.trippedAt ?? now }; }
        else { call = { ...b.call, status: 'settled', actualMicros: actual, finishedAt: now, ...outcome.usage }; if (actual > b.call.maximumMicros) circuit = { ...b.circuit, status: 'blocked', reason: 'overrun', trippedAt: b.circuit.trippedAt ?? now }; }
      }
    } else throw unavailable();
    if (call !== b.call) tx.set('platformWhatsAppBudgetCalls/' + call.reservationId, call); if (period) tx.set('platformWhatsAppBudgetPeriods/' + period.periodId, period); if (circuit) tx.set('platformWhatsAppBudgetPeriods/' + circuit.circuitId, circuit);
    tx.set('platformWhatsAppJobs/' + j.jobId, { ...j, audioState: state, audioFinishedAt: now });
    tx.set('platformWhatsAppEvents/' + j.sourceEventId, { ...source, state: 'body_erased', content: null });
    return state === 'result_pending';
  });
}
