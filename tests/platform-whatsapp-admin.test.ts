import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const auth = vi.hoisted(() => ({ getUser: vi.fn() }));
vi.mock('@/lib/firebase/admin', () => ({ getAdminDb: () => { throw new Error('Default backend forbidden'); }, getAdminAuth: () => auth }));
import { buildSupportScenario } from './platform-support-fixtures';
import { now } from './platform-whatsapp-test-fixtures';
beforeEach(() => { vi.spyOn(Date, 'now').mockReturnValue(now); auth.getUser.mockReset().mockImplementation(async uid => ({ uid, disabled: false })); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });
it('routes a current configured administrator source to private work, independently of question text', async () => {
  vi.stubEnv('SUPERADMIN_UID', 'demo-link-user');
  const s = await buildSupportScenario(), { lease } = await s.question('lista los pagos');
  expect(s.rows.get('platformWhatsAppJobs/' + lease.jobId)).toMatchObject({ kind: 'admin_query' });
});
import { runPlatformSupportWork } from '@/lib/server/platform-support-bot';
import { workActor, workPayload } from '@/lib/server/platform-whatsapp-work-authority';
import { assertPlatformSuperadmin, answerPlatformAdmin } from '@/lib/server/platform-whatsapp-admin';
import { isPlatformOutbox, isBudgetCall } from '../shared/platform-whatsapp-work';
import { takePlatformSendPermit } from '@/lib/server/platform-whatsapp-work-store';
const response = (value = { reply: 'Hay un comprobante pendiente consultado.', sourceIds: ['payment-demo-payment'] }, extra = {}) => Response.json({ model: 'synthetic-wire-model-v1', choices: [{ message: { content: JSON.stringify(value) } }], usage: { prompt_tokens: 11, prompt_cache_hit_tokens: 1, prompt_cache_miss_tokens: 10, completion_tokens: 3, total_tokens: 14 }, ...extra });
async function privateScenario(question = 'lista los pagos') {
  vi.stubEnv('SUPERADMIN_UID', 'demo-link-user'); vi.stubEnv('DEEPSEEK_API_KEY', 'synthetic-key'); vi.stubEnv('PILOT_AI_BUDGET_ENFORCED', 'true');
  const s = await buildSupportScenario();
  s.seed('paymentReceipts/demo-payment', { tenantId: 'demo-business', tenantName: 'Demo business', status: 'pending', submittedAt: now, amountCOP: 1000, imageUrl: 'https://private.invalid/image' });
  const { lease } = await s.question(question);
  return { ...s, lease };
}
it('generates the private consulted payment answer through the once capability and encrypted outbox', async () => {
  const s = await privateScenario(), fetcher = vi.fn().mockResolvedValue(response()); vi.stubGlobal('fetch', fetcher);
  const answer = await runPlatformSupportWork(s.lease, s.db, new AbortController().signal);
  expect(answer).toMatchObject({ sources: [{ id: 'payment-demo-payment', href: '/admin?focusPayment=demo-payment#payment-demo-payment' }] });
  const out = [...s.rows.values()].find(r => isPlatformOutbox(r) && r.outputKind === 'generated')!;
  expect(workPayload(out as never, now)?.text).toContain('https://sarinbotsaas.pages.dev/admin?focusPayment=demo-payment');
  expect(workPayload(out as never, now)?.text).toContain('consultados: 1');
  expect(JSON.stringify(fetcher.mock.calls)).not.toContain('private.invalid');
  expect([...s.rows.values()].find(r => isBudgetCall(r) && r.stage === 'generation')).toMatchObject({ status: 'settled', actualMicros: 8 });
  const claim = (await s.work.claimSend(out.outboxId as string))!;
  expect(await takePlatformSendPermit(out.outboxId as string, claim.token, s.db, now)).not.toBeNull();
  expect(await takePlatformSendPermit(out.outboxId as string, claim.token, s.db, now)).toBeNull();
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it.each(['foreign', 'disabled', 'deleted', 'cutoff', 'role'] as const)('denies current %s private identity before a private snapshot', async loss => {
  const s = await privateScenario(), job = (await s.work.readAuthorized(s.lease))!;
  if (job.authorityKind !== 'actor') throw new Error('Expected actor');
  const actor = workActor(job), before = s.seen.length;
  if (loss === 'disabled') auth.getUser.mockResolvedValue({ uid: actor.uid, disabled: true });
  if (loss === 'deleted') auth.getUser.mockRejectedValue({ code: 'auth/user-not-found' });
  if (loss === 'cutoff') auth.getUser.mockResolvedValue({ uid: actor.uid, disabled: false, tokensValidAfterTime: new Date(now + 1000).toISOString() });
  if (loss === 'role') vi.stubEnv('SUPERADMIN_UID', 'other');
  await expect(assertPlatformSuperadmin(loss === 'foreign' ? { ...actor, uid: 'other' } : actor, s.db)).rejects.toMatchObject({ status: 403 });
  expect(JSON.stringify(s.seen.slice(before))).not.toMatch(/paymentReceipts|businesses/);
});
it('drops a late private answer after current role loss while retaining incurred cost', async () => {
  const s = await privateScenario(); vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => { vi.stubEnv('SUPERADMIN_UID', 'other'); return response(); }));
  await expect(runPlatformSupportWork(s.lease, s.db, new AbortController().signal)).rejects.toThrow();
  expect([...s.rows.values()].filter(r => isPlatformOutbox(r) && r.outputKind === 'generated')).toHaveLength(0);
  expect([...s.rows.values()].find(r => isBudgetCall(r) && r.stage === 'generation')).toMatchObject({ status: 'settled', actualMicros: 8 });
});
it.each(['role', 'disabled'] as const)('denies saved private send when %s changes', async loss => {
  const s = await privateScenario(); vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response()));
  await runPlatformSupportWork(s.lease, s.db, new AbortController().signal);
  const out = [...s.rows.values()].find(r => isPlatformOutbox(r) && r.outputKind === 'generated')!;
  const claim = (await s.work.claimSend(out.outboxId as string))!;
  if (loss === 'role') vi.stubEnv('SUPERADMIN_UID', 'other'); else auth.getUser.mockResolvedValue({ uid: 'demo-link-user', disabled: true });
  expect(await takePlatformSendPermit(out.outboxId as string, claim.token, s.db, now)).toBeNull();
});
afterEach(() => vi.unstubAllGlobals());
import { getSarinQueueStats, runInSarinQueue } from '@/lib/sarin/queue';
import { readPlatformAdminMenu, platformAdminSourceUrl, readPlatformAdminContext } from '@/lib/server/platform-whatsapp-admin';
import { seedConsents } from './platform-whatsapp-link-fixtures';
import { AsyncLocalStorage } from 'node:async_hooks';
it('gives foreign/client calls 403 without a bound context or private read', async () => {
  const s = await privateScenario(), job = (await s.work.readAuthorized(s.lease))!;
  if (job.authorityKind !== 'actor') throw new Error('Expected actor');
  const actor = { ...workActor(job), uid: 'customer' };
  await expect(answerPlatformAdmin(actor, { requestId: 'demo-request', question: 'lista pagos' }, new AbortController().signal)).rejects.toMatchObject({ status: 403 });
  await expect(readPlatformAdminMenu(actor)).rejects.toMatchObject({ status: 403 });
});
it('rechecks authority after waiting in the existing critical queue before snapshot', async () => {
  const s = await privateScenario(); let release!: () => void;
  const gate = new Promise<void>(r => { release = r; });
  const blockers = Array.from({ length: 4 }, () => runInSarinQueue(() => gate));
  const before = s.seen.length, running = runPlatformSupportWork(s.lease, s.db, new AbortController().signal).catch(error => error);
  try { await vi.waitFor(() => expect(getSarinQueueStats().criticalQueued).toBe(1)); vi.stubEnv('SUPERADMIN_UID', 'other'); }
  finally { release(); await Promise.all(blockers); }
  expect(await running).toHaveProperty('status', 409);
  expect(JSON.stringify(s.seen.slice(before))).not.toMatch(/paymentReceipts|businesses/);
});
it.each(['requestId', 'question', 'businessId', 'signal', 'actor', 'leadingSpace', 'trailingSpace', 'trailingNewline', 'oversized', 'illFormed', 'requestIdNewline'] as const)('rejects altered private context %s without consuming the valid entry', async changed => {
  const s = await privateScenario(), fetcher = vi.fn().mockResolvedValue(response()); vi.stubGlobal('fetch', fetcher);
  const realRun = AsyncLocalStorage.prototype.run;
  let probes = 0;
  vi.spyOn(AsyncLocalStorage.prototype, 'run').mockImplementation(function(this: AsyncLocalStorage<unknown>, context, callback, ...args) {
    if (context?.db !== s.db || context?.lease?.jobId !== s.lease.jobId) return realRun.call(this, context, callback, ...args);
    return realRun.call(this, context, async () => {
      probes++;
      await expect(answerPlatformAdmin(changed === 'actor' ? { ...context.actor, linkRevision: context.actor.linkRevision + 1 } : context.actor, {
        requestId: changed === 'requestId' ? 'forged-request' : changed === 'requestIdNewline' ? context.requestId + '\n' : context.requestId,
        question: changed === 'question' ? 'forged question' : changed === 'leadingSpace' ? ' ' + context.question : changed === 'trailingSpace' ? context.question + ' ' : changed === 'trailingNewline' ? context.question + '\n' : changed === 'oversized' ? 'x'.repeat(4097) : changed === 'illFormed' ? '\ud800' : context.question,
        ...(changed === 'businessId' ? { businessId: 'foreign' } : {}),
      }, changed === 'signal' ? new AbortController().signal : context.signal)).rejects.toThrow();
      expect(context.entered).toBe(false); return callback(...args);
    });
  });
  await runPlatformSupportWork(s.lease, s.db, new AbortController().signal); expect(probes).toBe(1); expect(fetcher).toHaveBeenCalledTimes(1);
});
it.each([
  { reply: 'https://private.invalid/image', sourceIds: ['payment-demo-payment'] },
  { reply: 'Imagen /api/payment/image', sourceIds: ['payment-demo-payment'] },
  { reply: 'Pago', sourceIds: ['payment-foreign'] },
  { reply: 'Pago', sourceIds: [], tool: 'reviewPayment' },
  { reply: 'Pago', sourceIds: [], action: 'approve' },
  { reply: 'x'.repeat(321), sourceIds: [] },
])('rejects forged private response and accounts usage once: %j', async value => {
  const s = await privateScenario(), fetcher = vi.fn().mockResolvedValue(response(value)); vi.stubGlobal('fetch', fetcher);
  await expect(runPlatformSupportWork(s.lease, s.db, new AbortController().signal)).rejects.toThrow();
  expect([...s.rows.values()].filter(r => isPlatformOutbox(r) && r.outputKind === 'generated')).toHaveLength(0);
  expect([...s.rows.values()].find(r => isBudgetCall(r) && r.stage === 'generation')).toMatchObject({ status: 'settled', actualMicros: 8 });
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it('keeps bounded and unknown coverage truthful and rejects forged server paths', async () => {
  const s = await privateScenario(), job = (await s.work.readAuthorized(s.lease))!;
  for (let n = 0; n < 102; n++) s.seed('paymentReceipts/demo-' + n, { tenantId: 'demo-business', tenantName: 'Demo', status: 'pending', submittedAt: now, amountCOP: 1000 });
  s.seed('businesses/demo-business', { id: 'demo-business', name: 'Demo', createdAt: now, subscription: { status: 'active', trialEndsAt: 0, currentPeriodEndsAt: now + 86400000 } });
  s.seed('responseQuotaScopes/business_demo-business', { initializedAt: now });
  s.seed('responseQuotaScopes/business_demo-business/periods/broken', { startsAt: now - 1, endsAt: now + 86400000 });
  if (job.authorityKind !== 'actor') throw new Error('Expected actor');
  const context = await readPlatformAdminContext(workActor(job), s.db);
  expect(context.menu.payments).toBe(100); expect(context.menu.health).toContain('pagos truncados');
  expect(context.snapshot.businesses[0]).toMatchObject({ quotaState: 'unavailable', remainingResponses: null });
  expect(context.menu.health).toContain('cupos no disponibles: 1');
  expect(context.menu.support).toBe(1);
  expect(() => platformAdminSourceUrl({ ...context.snapshot.sources[0], href: '//private.invalid/image' })).toThrow();
});
it.each(['abort', 'expiry', 'anchor', 'disabled', 'deleted', 'cutoff'] as const)('drops private provider result after %s and never retries generation', async loss => {
  const s = await privateScenario(), controller = new AbortController(), fetcher = vi.fn().mockImplementation(async () => {
    if (loss === 'abort') controller.abort();
    if (loss === 'expiry') vi.spyOn(Date, 'now').mockReturnValue(now + 121000);
    if (loss === 'anchor') await seedConsents(s.db, 'demo-link-user', 2, false);
    if (loss === 'disabled') auth.getUser.mockResolvedValue({ uid: 'demo-link-user', disabled: true });
    if (loss === 'deleted') auth.getUser.mockRejectedValue({ code: 'auth/user-not-found' });
    if (loss === 'cutoff') auth.getUser.mockResolvedValue({ uid: 'demo-link-user', disabled: false, tokensValidAfterTime: new Date(now + 1000).toISOString() });
    return response();
  }); vi.stubGlobal('fetch', fetcher);
  await expect(runPlatformSupportWork(s.lease, s.db, controller.signal)).rejects.toThrow();
  expect([...s.rows.values()].filter(r => isPlatformOutbox(r) && r.outputKind === 'generated')).toHaveLength(0);
  const call = [...s.rows.values()].find(r => isBudgetCall(r) && r.stage === 'generation')!;
  expect(call.status).toBe('settled'); // The synthetic transport ignores cancellation and supplies known usage.
  await expect(runPlatformSupportWork(s.lease, s.db, new AbortController().signal)).rejects.toThrow(); expect(fetcher).toHaveBeenCalledTimes(1);
});
import { ingestPlatformWhatsAppEvent } from '@/lib/server/platform-whatsapp-ingress';
import { getPlatformWhatsAppConfig } from '@/lib/server/platform-whatsapp-config';
import { PLATFORM_SCOPE_REFUSAL } from '@/lib/server/platform-support-knowledge';
it.each(['payments', 'status', 'inbox'] as const)('consumes only a current server admin menu %s choice once', async action => {
  vi.stubEnv('SUPERADMIN_UID', 'demo-link-user'); const s = await buildSupportScenario();
  const menu = [...s.rows.values()].find(r => isPlatformOutbox(r) && r.menuPurpose === 'admin')!;
  expect(menu).toMatchObject({ authorityKind: 'actor', status: 'accepted' });
  const { text: _text, ...event } = s.event();
  await ingestPlatformWhatsAppEvent({ ...event, kind: 'incoming_choice', choiceId: `sarinbot.menu.v1:${action}:${menu.outboxId}` }, getPlatformWhatsAppConfig(), s.db, now);
  const lease = (await s.work.claimNext())!, job = (await s.work.readAuthorized(lease))!;
  expect(job).toMatchObject({ kind: 'admin_query', sourceKind: 'menu' });
  expect(workPayload(job, now)?.question).toMatch(/^Consulta /);
  const { text: _repeat, ...repeat } = s.event();
  await ingestPlatformWhatsAppEvent({ ...repeat, kind: 'incoming_choice', choiceId: `sarinbot.menu.v1:${action}:${menu.outboxId}` }, getPlatformWhatsAppConfig(), s.db, now);
  expect([...s.rows.values()].filter(r => r.recordType === 'job' && r.kind === 'admin_query' && r.catalogId === null)).toHaveLength(1);
  vi.stubEnv('DEEPSEEK_API_KEY', 'synthetic-key'); vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ reply: 'Consulta de los registros disponibles.', sourceIds: [] })));
  await expect(runPlatformSupportWork(lease, s.db, new AbortController().signal)).resolves.toHaveProperty('snapshot');
});
it('keeps public requests for payments and forged private menu choices away from private reads', async () => {
  const s = await buildSupportScenario(), oldMenu = [...s.rows.values()].find(r => isPlatformOutbox(r) && r.status === 'accepted')!;
  const { text: _text, ...event } = s.event();
  await ingestPlatformWhatsAppEvent({ ...event, kind: 'incoming_choice', choiceId: `sarinbot.menu.v1:payments:${oldMenu.outboxId}` }, getPlatformWhatsAppConfig(), s.db, now);
  expect([...s.rows.values()].filter(r => r.recordType === 'job' && r.kind === 'admin_query')).toHaveLength(0);
  const { lease } = await s.question('lista los pagos');
  const fetcher = vi.fn().mockResolvedValue(response({ reply: PLATFORM_SCOPE_REFUSAL, sourceIds: [] })); vi.stubGlobal('fetch', fetcher); vi.stubEnv('DEEPSEEK_API_KEY', 'synthetic-key');
  const offset = s.seen.length;
  expect(await runPlatformSupportWork(lease, s.db, new AbortController().signal)).toEqual({ reply: PLATFORM_SCOPE_REFUSAL, sourceIds: [] });
  expect(s.seen.slice(offset).filter(c => c.action === 'read' && /^(?:paymentReceipts|businesses|responseQuota)/.test(c.read.path))).toHaveLength(0);
});
it('a genuine private menu loses authority when the configured administrator changes', async () => {
  vi.stubEnv('SUPERADMIN_UID', 'demo-link-user'); const s = await buildSupportScenario();
  const menu = [...s.rows.values()].find(r => isPlatformOutbox(r) && r.menuPurpose === 'admin')!;
  vi.stubEnv('SUPERADMIN_UID', 'other');
  const { text: _text, ...event } = s.event(), offset = s.seen.length;
  await ingestPlatformWhatsAppEvent({ ...event, kind: 'incoming_choice', choiceId: `sarinbot.menu.v1:payments:${menu.outboxId}` }, getPlatformWhatsAppConfig(), s.db, now);
  expect([...s.rows.values()].filter(r => r.recordType === 'job' && r.kind === 'admin_query' && r.catalogId === null)).toHaveLength(0);
  expect(s.rows.get('platformWhatsAppOutbox/' + menu.outboxId)).toMatchObject({ consumedAt: null });
  expect(s.seen.slice(offset).filter(c => c.action === 'read' && /^(?:paymentReceipts|businesses)/.test(c.read.path))).toHaveLength(0);
});
it('rejects a foreign actor before even selecting the default database', async () => {
  const s = await privateScenario(), job = (await s.work.readAuthorized(s.lease))!;
  if (job.authorityKind !== 'actor') throw new Error('Expected actor');
  await expect(assertPlatformSuperadmin({ ...workActor(job), uid: 'other' })).rejects.toMatchObject({ status: 403 });
});

import { quotePlatformGeneration } from '@/lib/server/platform-whatsapp-budget';
it.each([
  ['leading whitespace', ' lista los pagos'], ['trailing whitespace', 'lista los pagos '], ['trailing newline', 'lista los pagos\n'],
  ['over web limit', 'x'.repeat(2001)], ['4096 code points', 'x'.repeat(4096)], ['4096 supplementary code points / 16384 bytes', '\u{1f600}'.repeat(4096)],
])('preserves the exact private source question through once dispatch: %s', async (_label, question) => {
  const s = await privateScenario(question), fetcher = vi.fn().mockResolvedValue(response()); vi.stubGlobal('fetch', fetcher);
  const sourceJob = (await s.work.readAuthorized(s.lease))!;
  expect(workPayload(sourceJob, now)?.question).toBe(question);
  await runPlatformSupportWork(s.lease, s.db, new AbortController().signal);
  expect(fetcher).toHaveBeenCalledTimes(1);
  const body = fetcher.mock.calls[0][1].body;
  expect(JSON.parse(JSON.parse(body).messages[1].content).question).toBe(question);
  const generation = [...s.rows.values()].filter(r => isBudgetCall(r) && r.stage === 'generation');
  expect(generation).toHaveLength(1);
  expect(generation[0]).toMatchObject({ status: 'settled', actualMicros: 8, quote: quotePlatformGeneration(body) });
  expect([...s.rows.values()].filter(r => isPlatformOutbox(r) && r.outputKind === 'generated')).toHaveLength(1);
  expect([...s.rows.keys()].filter(path => path.startsWith('aiUsageCalls/'))).toEqual(['aiUsageCalls/' + generation[0].effectToken]);
  await expect(runPlatformSupportWork(s.lease, s.db, new AbortController().signal)).rejects.toThrow();
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it.each([
  ['oversize ASCII', 'x'.repeat(4097)], ['oversize supplementary', '\u{1f600}'.repeat(4097)],
  ['unpaired high surrogate', '\ud800'], ['unpaired low surrogate', '\udc00'], ['NUL', 'a\0b'], ['blank', ' \n '],
])('does not admit invalid private source text: %s', async (_label, question) => {
  const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
  vi.stubEnv('SUPERADMIN_UID', 'demo-link-user');
  const s = await buildSupportScenario();
  if ([...question].length > 4096) await expect(s.question(question)).rejects.toMatchObject({ status: 400 });
  else expect((await s.question(question)).lease).toBeNull();
  expect([...s.rows.values()].filter(r => isBudgetCall(r) && r.stage === 'generation')).toHaveLength(0);
  expect([...s.rows.values()].filter(r => isPlatformOutbox(r) && r.outputKind === 'generated')).toHaveLength(0);
  expect(fetcher).not.toHaveBeenCalled();
});
