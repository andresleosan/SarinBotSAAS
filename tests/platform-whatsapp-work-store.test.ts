import { afterEach, describe, expect, it, vi } from 'vitest';
import { isDataPath } from '../shared/data-protocol';
import { isPlatformWhatsAppConnectionRecord } from '../shared/platform-whatsapp-records';
import { connection } from './platform-whatsapp-test-fixtures';
vi.mock('@/lib/firebase/admin', () => ({ getAdminDb: () => { throw new Error('Default backend forbidden'); } }));
import { getPlatformWhatsAppConfig } from '@/lib/server/platform-whatsapp-config';
import { ingestPlatformWhatsAppEvent } from '@/lib/server/platform-whatsapp-ingress';
import { createPlatformWorkStore, takePlatformSendPermit } from '@/lib/server/platform-whatsapp-work-store';
import { workCatalog, isPlatformJob } from '../shared/platform-whatsapp-work';
import { configureWork, workCircuit } from './platform-whatsapp-work-fixtures';
import { configure, now, memoryStore, incoming, connectionPath } from './platform-whatsapp-test-fixtures';
import { workJob, workHead } from './platform-whatsapp-work-fixtures';
import { prepareHeadAdvance, hasDuePlatformWork } from '@/lib/server/platform-whatsapp-work-queue';

afterEach(() => vi.unstubAllEnvs());
describe('durable platform work boundaries', () => {
  it('allows the four independent work roots without allowing child collections', () => {
    for (const root of ['platformWhatsAppJobs', 'platformWhatsAppOutbox', 'platformWhatsAppBudgetCalls', 'platformWhatsAppBudgetPeriods']) {
      expect(isDataPath(root + '/example', true)).toBe(true);
      expect(isDataPath(root + '/example/history', false)).toBe(false);
    }
  });
  it('accepts explicit fresh observation evidence and rejects partial evidence', () => {
    const observed = { ...connection({ providerConnection: 'connected' }), observationStatus: 'connected', observationRevision: 0, observedAt: 1_900_000_000_000 };
    expect(isPlatformWhatsAppConnectionRecord(observed)).toBe(true);
    expect(isPlatformWhatsAppConnectionRecord({ ...observed, observationRevision: null })).toBe(false);
    expect(isPlatformWhatsAppConnectionRecord({ ...observed, observationStatus: 'none' })).toBe(false);
  });
});

describe('real source to outbox to consumed choice', () => {
  function fixture() {
    configure(); configureWork();
    const s = memoryStore();
    s.seed(connectionPath, { ...connection({ providerConnection: 'connected' }), observationStatus: 'connected', observationRevision: 0, observedAt: now });
    const c = workCircuit(); s.seed('platformWhatsAppBudgetPeriods/' + c.circuitId, c);
    return { ...s, work: createPlatformWorkStore(s.db, () => now) };
  }
  async function sendNotice(s: ReturnType<typeof fixture>) {
    const lease = await s.work.claimNext(); expect(lease).not.toBeNull();
    const j = await s.work.readAuthorized(lease!); expect(j).not.toBeNull();
    const saved = await s.work.saveReply(lease!, workCatalog[j!.catalogId!].text);
    const claimed = await s.work.claimSend(saved.outboxId); expect(claimed).not.toBeNull();
    expect(await takePlatformSendPermit(saved.outboxId, claimed!.token, s.db, now)).toMatchObject({ externalId: saved.outboxId });
    expect(await takePlatformSendPermit(saved.outboxId, claimed!.token, s.db, now)).toBeNull();
    await s.work.finishSend(saved.outboxId, claimed!.token, { status: 'accepted', providerId: 'demo-accepted-' + saved.outboxId });
    return saved.outboxId;
  }
  it('atomically admits once and consumes only an accepted current menu exactly once', async () => {
    const s = fixture(), event = incoming({ customerSentAt: now });
    const results = await Promise.all([ingestPlatformWhatsAppEvent(event, getPlatformWhatsAppConfig(), s.db, now), ingestPlatformWhatsAppEvent(event, getPlatformWhatsAppConfig(), s.db, now)]);
    expect(results.map(v => v.outcome).sort()).toEqual(['duplicate', 'stored']);
    expect([...s.rows.values()].filter(isPlatformJob)).toHaveLength(1);
    const id = await sendNotice(s);
    const { text: _text, ...base } = incoming({ eventId: 'demo-choice', messageId: 'demo-choice', whatsappMessageId: null, customerSentAt: now });
    const choice = { ...base, kind: 'incoming_choice', choiceId: 'sarinbot.menu.v1:accept:' + id };
    expect((await ingestPlatformWhatsAppEvent(choice, getPlatformWhatsAppConfig(), s.db, now)).outcome).toBe('stored');
    expect(s.rows.get('platformWhatsAppOutbox/' + id)).toMatchObject({ status: 'accepted', consumedAt: now });
    expect([...s.rows.values()].filter(isPlatformJob).map(j => j.catalogId).sort()).toEqual(['identification', 'support_menu']);
    expect([...s.rows.values()].find(r => r.ingressDisposition === 'choice_consumed')).toMatchObject({ consumedOutboxId: id, consumedAction: 'accept' });
    expect([...s.rows.values()].find(r => r.recordType === 'control_head')).toMatchObject({ entryState: 'initial' });
    expect((await ingestPlatformWhatsAppEvent(choice, getPlatformWhatsAppConfig(), s.db, now)).outcome).toBe('duplicate');
    expect((await ingestPlatformWhatsAppEvent({ ...choice, eventId: 'demo-second-choice', messageId: 'demo-second-choice' }, getPlatformWhatsAppConfig(), s.db, now)).outcome).toBe('stored');
    expect([...s.rows.values()].filter(isPlatformJob)).toHaveLength(2);
    await sendNotice(s);
  });
  it('denies legacy/no-window work and keeps all default-disabled effects closed', async () => {
    const s = fixture();
    await ingestPlatformWhatsAppEvent(incoming(), getPlatformWhatsAppConfig(), s.db, now);
    expect([...s.rows.values()].filter(isPlatformJob)).toHaveLength(0);
    const d = memoryStore(); configure();
    await ingestPlatformWhatsAppEvent(incoming({ customerSentAt: now }), getPlatformWhatsAppConfig(), d.db, now);
    expect([...d.rows.values()].filter(isPlatformJob)).toHaveLength(0);
  });
  it('fixes the first processing deadline and denies equality after renewals', async () => {
    const s = fixture(); await ingestPlatformWhatsAppEvent(incoming({ customerSentAt: now }), getPlatformWhatsAppConfig(), s.db, now);
    const lease = (await s.work.claimNext())!;
    const later = createPlatformWorkStore(s.db, () => now + 20_000); expect(await later.renew(lease)).toBe(true);
    expect((await later.readAuthorized(lease))?.processingDeadlineAt).toBe(now + 120_000);
    expect(await createPlatformWorkStore(s.db, () => now + 80_000).readAuthorized(lease)).toBeNull();
  });
  it.each([{ age: 59_999, count: 10, allowed: false }, { age: 60_000, count: 10, allowed: true }, { age: 86_399_999, count: 50, allowed: false }, { age: 86_400_000, count: 50, allowed: true }])('uses rolling contact boundaries $age/$count and never counts denied work', async ({ age, count, allowed }) => {
    const s = fixture(), first = await ingestPlatformWhatsAppEvent(incoming(), getPlatformWhatsAppConfig(), s.db, now);
    const head = s.rows.get('platformWhatsAppJobs/head_' + first.conversationId)!;
    s.seed('platformWhatsAppBudgetPeriods/rate_' + first.conversationId, { version: 1, provider: 'ycloud', purpose: 'platform_support', wabaId: head.wabaId, phoneE164: head.phoneE164, phoneNumberId: head.phoneNumberId, recordType: 'contact_rate', conversationId: first.conversationId, acceptedAt: Array(count).fill(now - age), expiresAt: now - age + 86_400_000 });
    await ingestPlatformWhatsAppEvent(incoming({ eventId: 'demo-rate', messageId: 'demo-rate', whatsappMessageId: null, customerSentAt: now }), getPlatformWhatsAppConfig(), s.db, now);
    expect([...s.rows.values()].filter(isPlatformJob)).toHaveLength(allowed ? 1 : 0);
    const current = s.rows.get('platformWhatsAppBudgetPeriods/rate_' + first.conversationId)!;
    expect((current.acceptedAt as number[]).length).toBe(allowed ? age === 86_400_000 ? 1 : count + 1 : count);
  });
  it('advances at most twenty stale edges and continues from the sole head', async () => {
    const s = memoryStore(), source = now - 86_400_000;
    const jobs = Array.from({ length: 26 }, (_, i) => workJob({ jobId: 'job_' + i.toString(16).padStart(64, '0'), status: 'waiting', nextAttemptAt: null, ...(i < 25 ? { sourceOccurredAt: source, sourceReceivedAt: source, createdAt: source, customerSentAt: source, windowExpiresAt: now, bodyExpiresAt: now, expiresAt: source + 2_592_000_000 } : {}) }));
    jobs.forEach((j, i) => { j.nextJobId = jobs[i + 1]?.jobId ?? null; s.seed('platformWhatsAppJobs/' + j.jobId, j); });
    let head = workHead(jobs[0], { status: 'advance', nextAttemptAt: now, tailJobId: jobs.at(-1)!.jobId }); s.seed('platformWhatsAppJobs/head_' + head.conversationId, head);
    expect(await hasDuePlatformWork(s.db, now)).toBe(false); // Raw expired edges alone cannot authorize a singleton wake.
    await s.db.runTransaction(async tx => { const apply = await prepareHeadAdvance(head, null, tx, s.db, now); apply(); });
    head = s.rows.get('platformWhatsAppJobs/head_' + head.conversationId) as unknown as typeof head;
    expect(head).toMatchObject({ status: 'advance', headJobId: jobs[20].jobId });
    await s.db.runTransaction(async tx => { const apply = await prepareHeadAdvance(head, null, tx, s.db, now); apply(); });
    expect(s.rows.get('platformWhatsAppJobs/head_' + head.conversationId)).toMatchObject({ status: 'active', headJobId: jobs[25].jobId });
    expect(s.rows.get('platformWhatsAppJobs/' + jobs[25].jobId)).toMatchObject({ status: 'ready', nextAttemptAt: now });
    expect(s.seen.filter(c => c.action === 'commit').every(c => c.action === 'commit' && c.writes.length <= 22)).toBe(true);
  });
  it('marks a corrupt queue edge repair-needed without reconstructing history', async () => {
    const s = memoryStore(), j = workJob(), h = workHead(j, { status: 'advance', nextAttemptAt: now });
    s.seed('platformWhatsAppJobs/' + j.jobId, { ...j, extra: 'invalid' });
    await s.db.runTransaction(async tx => { const apply = await prepareHeadAdvance(h, null, tx, s.db, now); apply(); });
    expect(s.rows.get('platformWhatsAppJobs/head_' + j.conversationId)).toMatchObject({ status: 'repair_needed', nextAttemptAt: null });
    expect(s.rows.get('platformWhatsAppJobs/' + j.jobId)).toHaveProperty('extra');
  });
});
