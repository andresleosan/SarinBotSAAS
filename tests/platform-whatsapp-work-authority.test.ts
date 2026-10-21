import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const auth = vi.hoisted(() => ({ getUser: vi.fn() }));
vi.mock('@/lib/firebase/admin', () => ({ getAdminDb: () => { throw new Error('Default backend forbidden'); }, getAdminAuth: () => auth }));
import { beginPlatformWhatsAppLink, verifyPlatformWhatsAppLinkInbound, confirmPlatformWhatsAppLink, readPlatformWhatsAppLinkStatus, revokePlatformWhatsAppLink } from '@/lib/server/platform-whatsapp-link';
import { ingestPlatformWhatsAppEvent as ingest } from '@/lib/server/platform-whatsapp-ingress';
import { getPlatformWhatsAppConfig } from '@/lib/server/platform-whatsapp-config';
import { applyPlatformWhatsAppConversationControl } from '@/lib/server/platform-whatsapp-conversations';
import { updateConsent } from '@/lib/server/consent';
import { createPlatformWorkStore, takePlatformSendPermit, takePlatformGenerationPermit, completePlatformGeneration } from '@/lib/server/platform-whatsapp-work-store';
import { reservePlatformCost } from '@/lib/server/platform-whatsapp-budget';
import { isPlatformJob, workCatalog, emptyUsage, type Lease } from '../shared/platform-whatsapp-work';
import { configureLink, seedConsents, phone, token } from './platform-whatsapp-link-fixtures';
import { now, incoming, connection, connectionPath, memoryStore, echo } from './platform-whatsapp-test-fixtures';
import { configureWork, workCircuit } from './platform-whatsapp-work-fixtures';

describe('original actor authority and supplied transaction cancellation', () => {
  let s: ReturnType<typeof memoryStore>, work: ReturnType<typeof createPlatformWorkStore>, seq: number;
  beforeEach(async () => {
    configureLink(); configureWork(); seq = 0; vi.spyOn(Date, 'now').mockReturnValue(now);
    auth.getUser.mockReset().mockImplementation(async uid => ({ uid, disabled: false })); s = memoryStore(); work = createPlatformWorkStore(s.db, () => now);
    s.seed(connectionPath, { ...connection({ providerConnection: 'connected' }), observationStatus: 'connected', observationRevision: 0, observedAt: now });
    for (const stage of ['audio', 'generation', 'send'] as const) { const c = workCircuit(undefined, stage); s.seed('platformWhatsAppBudgetPeriods/' + c.circuitId, c); }
    await seedConsents(s.db);
    const challenge = await beginPlatformWhatsAppLink(token(), { phoneE164: phone, requestId: 'demo-work-link' }, s.db, now);
    await verifyPlatformWhatsAppLinkInbound(incoming({ text: challenge.code }), s.db, now);
    await confirmPlatformWhatsAppLink(token(), { challengeId: challenge.challengeId, requestId: 'demo-work-confirm' }, s.db, now);
  });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });
  const event = (patch = {}) => incoming({ eventId: 'demo-work-' + ++seq, messageId: 'demo-work-' + seq, whatsappMessageId: null, customerSentAt: now, ...patch });
  async function deliver() {
    const lease = (await work.claimNext())!, job = (await work.readAuthorized(lease))!;
    expect(job).not.toBeNull(); const out = await work.saveReply(lease, workCatalog[job.catalogId!].text), claim = (await work.claimSend(out.outboxId))!;
    expect(await takePlatformSendPermit(out.outboxId, claim.token, s.db, now)).not.toBeNull();
    await work.finishSend(out.outboxId, claim.token, { status: 'accepted', providerId: 'demo-provider-' + seq }); return out.outboxId;
  }
  async function choose(id: string, action: string) { const { text: _t, ...e } = event(); return ingest({ ...e, kind: 'incoming_choice', choiceId: `sarinbot.menu.v1:${action}:${id}` }, getPlatformWhatsAppConfig(), s.db, now); }
  async function enter() {
    const first = await ingest(event(), getPlatformWhatsAppConfig(), s.db, now);
    await choose(await deliver(), 'accept'); await choose(await deliver(), 'support'); await deliver(); return first.conversationId;
  }
  async function question() { await ingest(event({ text: 'Synthetic support question' }), getPlatformWhatsAppConfig(), s.db, now); return (await work.claimNext())!; }
  it('enters bot only from the real accepted support menu and creates deterministic actor acknowledgment', async () => {
    const id = await enter();
    expect(s.rows.get('platformWhatsAppConversations/' + id)).toMatchObject({ mode: 'bot', revision: 1 });
    const ack = [...s.rows.values()].filter(isPlatformJob).find(j => j.catalogId === 'support_ready')!;
    expect(ack).toMatchObject({ authorityKind: 'actor', uid: token().uid, generationState: 'not_applicable', status: 'completed' });
    const lease = await question(); expect((await work.readAuthorized(lease))?.kind).toBe('customer_reply');
    await expect(work.saveReply(lease, 'Unmetered generated answer')).rejects.toMatchObject({ status: 409 });
  });
  it.each(['disabled', 'deleted', 'revoked-cutoff', 'receipt', 'connection', 'deadline'])('fences %s before a generation permit', async failure => {
    await enter(); const lease = await question();
    await reservePlatformCost(lease.jobId, 'generation', 2, s.db);
    if (failure === 'disabled') auth.getUser.mockResolvedValue({ uid: token().uid, disabled: true });
    if (failure === 'deleted') auth.getUser.mockRejectedValue({ code: 'auth/user-not-found' });
    if (failure === 'revoked-cutoff') auth.getUser.mockResolvedValue({ uid: token().uid, disabled: false, tokensValidAfterTime: new Date(now + 1).toISOString() });
    if (failure === 'receipt') await seedConsents(s.db, token().uid, 2);
    if (failure === 'connection') s.seed(connectionPath, { ...s.rows.get(connectionPath), observationStatus: 'failed', observationRevision: null, observedAt: null });
    expect(await takePlatformGenerationPermit(lease, s.db, failure === 'deadline' ? now + 120_000 : now)).toBeNull();
  });
  it('consumes a generation permit only once and requires its exact lease token', async () => {
    await enter(); const lease = await question(); await reservePlatformCost(lease.jobId, 'generation', 2, s.db);
    expect(await takePlatformGenerationPermit({ ...lease, token: '00000000-0000-4000-8000-000000000099' }, s.db, now)).toBeNull();
    expect(await takePlatformGenerationPermit(lease, s.db, now)).toMatchObject({ question: 'Synthetic support question' });
    expect(await takePlatformGenerationPermit(lease, s.db, now)).toBeNull();
  });
  it.each([false, true])('atomically persists a generated outbox or terminates oversized output (%s)', async oversized => {
    const id = await enter(), lease = await question(); await reservePlatformCost(lease.jobId, 'generation', 2, s.db);
    const permit = (await takePlatformGenerationPermit(lease, s.db, now))!;
    const result = await completePlatformGeneration(lease, permit.generationToken, { status: 'completed', text: oversized ? 'x'.repeat(1025) : 'Synthetic metered answer', actualMicros: 1, usage: { ...emptyUsage, usageInputTokens: 10, usageOutputTokens: 5 } }, s.db, now);
    if (oversized) {
      expect(result).toBeNull();
      expect(s.rows.get('platformWhatsAppJobs/' + lease.jobId)).toMatchObject({ generationState: 'failed', outboxId: null });
      expect(s.rows.get('platformWhatsAppJobs/head_' + id)).toMatchObject({ status: 'idle', headJobId: null });
    } else {
      expect(result).not.toBeNull();
      expect(await work.saveReply(lease, 'Synthetic metered answer')).toEqual(result);
      await expect(work.saveReply(lease, 'Changed metered answer')).rejects.toMatchObject({ status: 409 });
    }
  });
  it.each(['account', 'platform_support'] as const)('cancels the current head in the same %s consent transaction', async scope => {
    const id = await enter(), lease = await question(), before = s.seen.length;
    await updateConsent(token(), { scope, action: 'revoke', requestId: 'demo-work-revoke-' + scope, expectedRevision: 1 }, s.db);
    expect(await work.readAuthorized(lease)).toBeNull();
    expect(s.rows.get('platformWhatsAppJobs/head_' + id)).toMatchObject({ entryState: 'human_paused', headJobId: null, currentMenuOutboxId: null });
    const commits = s.seen.slice(before).filter(c => c.action === 'commit');
    expect(commits.some(c => c.action === 'commit' && c.writes.some(w => w.path.startsWith('serverSettings/consent_state_')) && c.writes.some(w => w.path === 'platformWhatsAppJobs/' + lease.jobId))).toBe(true);
  });
  it('key-independent link revoke cancels current work without permitting reacceptance reentry', async () => {
    const id = await enter(), lease = await question(), status = await readPlatformWhatsAppLinkStatus(token(), s.db, now);
    vi.stubEnv('PLATFORM_WHATSAPP_LINK_HMAC_KEY', '');
    await revokePlatformWhatsAppLink(token(), 'revoke_v1_' + status.revokeGeneration + '_00000000-0000-4000-8000-000000000077', s.db, now);
    expect(s.rows.get('platformWhatsAppJobs/' + lease.jobId)).toMatchObject({ status: 'cancelled' });
    expect(s.rows.get('platformWhatsAppJobs/head_' + id)).toMatchObject({ entryState: 'human_paused' });
  });
  it('requires exact signed SALIR and only authenticated admin control can reenter after takeover', async () => {
    const id = await enter();
    await ingest(event({ text: ' salir ' }), getPlatformWhatsAppConfig(), s.db, now);
    expect(s.rows.get('platformWhatsAppJobs/head_' + id)?.entryState).toBe('bot');
    await ingest(event({ text: 'SALIR' }), getPlatformWhatsAppConfig(), s.db, now);
    expect(s.rows.get('platformWhatsAppJobs/head_' + id)?.entryState).toBe('human_paused');
    const revision = Number(s.rows.get('platformWhatsAppConversations/' + id)?.revision);
    await applyPlatformWhatsAppConversationControl({ conversationId: id, mode: 'bot', expectedRevision: revision, requestId: 'demo-admin-reentry' }, 'demo-real-admin', s.db, now);
    expect(s.rows.get('platformWhatsAppJobs/head_' + id)).toMatchObject({ entryState: 'bot', attachedConversationRevision: revision + 1, headJobId: null });
  });
  it('human echo atomically fences an in-flight actor and preserves unknown accounting', async () => {
    const id = await enter(), lease = await question();
    await reservePlatformCost(lease.jobId, 'generation', 2, s.db); await takePlatformGenerationPermit(lease, s.db, now);
    await ingest(echo({ eventId: 'demo-work-echo', messageId: 'demo-work-echo', whatsappMessageId: null }), getPlatformWhatsAppConfig(), s.db, now);
    expect(s.rows.get('platformWhatsAppJobs/head_' + id)).toMatchObject({ entryState: 'human_paused' });
    expect(await work.readAuthorized(lease)).toBeNull();
    expect([...s.rows.values()].find(r => r.recordType === 'budget_call' && r.stage === 'generation')).toMatchObject({ status: 'started', actualMicros: null });
  });
});
