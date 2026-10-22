import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import type { Database } from '@/lib/storage/types';
const state = vi.hoisted(() => ({ db: null as Database | null, getUser: vi.fn() }));
vi.mock('@/lib/firebase/admin', () => ({ getAdminDb: () => { if (!state.db) throw new Error('Default backend forbidden'); return state.db; }, getAdminAuth: () => state }));
import { createDataTestRuntime } from '../cloudflare/tests/data-runtime.mjs';
import { createCloudflareDatabase, StorageError, type DataTransport } from '@/lib/storage/database';
import { buildSupportScenario } from './platform-support-fixtures';
import { buildWorkAudioScenario } from './platform-whatsapp-work-scenario';
import { preparePlatformAudio, startPlatformAudio, finishPlatformAudio, hasPotentialPlatformWork } from '../cloudflare/tests/platform-whatsapp-work-bridge.mjs';
import { AUDIO_ENDPOINT } from '../shared/platform-whatsapp-audio-protocol';
import { now, echo, incoming, identity, connectionPath } from './platform-whatsapp-test-fixtures';
import { token, phone as customerPhone } from './platform-whatsapp-link-fixtures';
import { runInSarinQueue, getSarinQueueStats } from '@/lib/sarin/queue';
import { updateConsent, consentDocuments } from '@/lib/server/consent';
import { ingestPlatformWhatsAppEvent } from '@/lib/server/platform-whatsapp-ingress';
import { reconcilePlatformConnection } from '@/lib/server/platform-whatsapp-connection';
import { beginPlatformWhatsAppLink, verifyPlatformWhatsAppLinkInbound, confirmPlatformWhatsAppLink, readPlatformWhatsAppLinkStatus, revokePlatformWhatsAppLink } from '@/lib/server/platform-whatsapp-link';
import { runPlatformSupportWork } from '@/lib/server/platform-support-bot';
import { processPlatformWhatsAppWork, startPlatformWhatsAppWorker } from '@/lib/server/platform-whatsapp-worker';
import { createPlatformWorkStore, recordPlatformDeliveryStatus, prepareOutbox } from '@/lib/server/platform-whatsapp-work-store';
import { isBudgetCall, isPlatformOutbox, isPlatformJob, isProviderAlias, emptyUsage } from '../shared/platform-whatsapp-work';
import { encryptPlatformWhatsAppContent } from '@/lib/server/platform-whatsapp-crypto';
import { workPayload } from '@/lib/server/platform-whatsapp-work-authority';
import { budgetIds } from '@/lib/server/platform-whatsapp-budget';
import { workCircuit } from './platform-whatsapp-work-fixtures';
import { hasDuePlatformWork } from '@/lib/server/platform-whatsapp-work-queue';
import { readYCloudWebhook } from '@/lib/server/ycloud-webhook';
import { getPlatformWhatsAppConfig } from '@/lib/server/platform-whatsapp-config';
import type { DataCommand, DataReadResult, DataCommitResult } from '../shared/data-protocol';
let runtime: Awaited<ReturnType<typeof createDataTestRuntime>>, db: Database, second: Database;
const commands: DataCommand[] = [], fetcher = vi.fn();
const transport: DataTransport = async command => { commands.push(structuredClone(command)); const r = await runtime.fetch(command), value = await r.json() as DataReadResult | DataCommitResult; if (!r.ok) throw new StorageError(r.status, (value as unknown as { code: string }).code); return value; };
const global = globalThis as typeof globalThis & { __platformWorkDriver?: { draining: boolean; timer: ReturnType<typeof setTimeout> | null } };
beforeAll(async () => { runtime = await createDataTestRuntime(); }, 30000);
afterAll(async () => { await runtime?.dispose(); });
beforeEach(async () => {
  vi.spyOn(Date, 'now').mockReturnValue(now); state.getUser.mockReset().mockImplementation(async uid => ({ uid, disabled: false }));
  await runtime.db.exec('DELETE FROM app_documents; DELETE FROM app_commits;'); db = createCloudflareDatabase(transport); second = createCloudflareDatabase(transport); state.db = db; commands.length = 0;
  fetcher.mockReset(); vi.stubGlobal('fetch', fetcher); vi.stubEnv('DEEPSEEK_API_KEY', 'synthetic-key'); vi.stubEnv('PLATFORM_YCLOUD_API_KEY', 'synthetic-key'); vi.stubEnv('PILOT_AI_BUDGET_ENFORCED', 'true');
});
afterEach(async () => { vi.stubEnv('PLATFORM_WHATSAPP_PROCESSING_ENABLED', 'false'); await vi.waitFor(() => expect(global.__platformWorkDriver?.draining ?? false).toBe(false)); if (global.__platformWorkDriver?.timer) clearTimeout(global.__platformWorkDriver.timer); delete global.__platformWorkDriver; state.db = null; vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
async function scenario() {
  const s = await buildSupportScenario(), q = await s.question();
  await db.runTransaction(async tx => { await tx.get(db.collection('serverSettings').doc('platform_whatsapp')); for (const [path, row] of s.rows) { const [root, id] = path.split('/'); tx.set(db.collection(root).doc(id), row); } });
  return q;
}
function fake() { fetcher.mockImplementation(async (url, options) => url.startsWith('https://api.deepseek.com/') ? Response.json({ model: 'synthetic-wire-model-v1', choices: [{ message: { content: JSON.stringify({ reply: 'Puedes pedir atención humana.', sourceIds: ['sarin.support.v1'] }) } }], usage: { prompt_tokens: 10, prompt_cache_hit_tokens: 0, prompt_cache_miss_tokens: 10, completion_tokens: 5, total_tokens: 15 } }) : Response.json({ id: 'provider-' + JSON.parse(options.body).externalId, status: 'accepted' })); }
const barrier = () => { let release!: () => void; const promise = new Promise<void>(resolve => { release = resolve; }); return { promise, release }; };
async function revoke(db: Database, suffix: string) {
  await updateConsent(token(), { scope: 'platform_support', action: 'revoke', requestId: 'fix1-revoke-' + suffix, expectedRevision: 1 }, db);
}
async function signedStatus(providerId: string, status: string, supplied = {}) {
  const config = getPlatformWhatsAppConfig(), timestamp = String(Math.floor(now / 1000));
  const bytes = JSON.stringify({ id: 'fix1-status-' + status, type: 'whatsapp.message.updated', apiVersion: 'v2', createTime: new Date(now).toISOString(), whatsappMessage: { id: providerId, status, ...supplied } });
  const signature = createHmac('sha256', config.signingSecret).update(timestamp + '.').update(bytes).digest('hex');
  const event = await readYCloudWebhook(new Request('https://synthetic.invalid/webhook', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'YCloud-Signature': `t=${timestamp},s=${signature}` }, body: bytes,
  }), { signingSecret: config.signingSecret, scope: { wabaId: config.scope!.wabaId, phoneE164: config.scope!.phoneE164 }, now });
  expect(event?.kind).toBe('message_status');
  if (event?.kind === 'message_status') await recordPlatformDeliveryStatus(event, second, now);
}
it.each(['relink', 'reaccept', 'reconnect'] as const)('late generation commit after %s cannot revive the old head, menu or source', async change => {
  const { lease } = await scenario(); fake();
  const gate = barrier(), entered = barrier(); let blocked = false, engineSignal: AbortSignal | undefined;
  const realFetch = fetcher.getMockImplementation()!;
  fetcher.mockImplementation(async (url, options) => {
    if (url.startsWith('https://api.deepseek.com/')) engineSignal = options.signal;
    return realFetch(url, options);
  });
  state.db = createCloudflareDatabase(async command => {
    if (!blocked && command.action === 'commit' && command.writes.some(w => w.op !== 'delete' && w.path === 'platformWhatsAppJobs/' + lease.jobId && w.data.generationState === 'completed')) {
      blocked = true; entered.release(); await gate.promise;
    }
    return transport(command);
  });
  vi.stubEnv('PLATFORM_WHATSAPP_PROCESSING_ENABLED', 'true');
  const processing = processPlatformWhatsAppWork(lease).catch(error => error);
  try {
    await entered.promise;
    if (change === 'reaccept') {
      await revoke(second, 'reaccept');
      await updateConsent(token(), { scope: 'platform_support', action: 'accept', requestId: 'fix1-reaccept', expectedRevision: 2, fingerprint: consentDocuments('platform_support').fingerprint, termsAccepted: true, dataAuthorized: true }, second);
    } else if (change === 'relink') {
      const prior = await readPlatformWhatsAppLinkStatus(token(), second, now);
      await revokePlatformWhatsAppLink(token(), 'revoke_v1_' + prior.revokeGeneration + '_00000000-0000-4000-8000-000000000078', second, now);
      const challenge = await beginPlatformWhatsAppLink(token(), { phoneE164: customerPhone, requestId: 'fix1-relink' }, second, now);
      await verifyPlatformWhatsAppLinkInbound(incoming({ text: challenge.code }), second, now);
      await confirmPlatformWhatsAppLink(token(), { challengeId: challenge.challengeId, requestId: 'fix1-relink-confirm' }, second, now);
    } else {
      const connection = (await second.collection('serverSettings').doc('platform_whatsapp').get()).data()!;
      await second.collection('serverSettings').doc('platform_whatsapp').set({ ...connection, observedAt: now - 300000 });
      const account = { id: identity.wabaId, accountReviewStatus: 'APPROVED', banState: 'REINSTATE', restrictions: [], paymentMethodAttached: true };
      const phone = { id: identity.phoneNumberId, wabaId: identity.wabaId, phoneNumber: identity.phoneE164 };
      fetcher.mockResolvedValueOnce(Response.json({ ...account, removedReason: 'ACCOUNT_DISCONNECTED' }))
        .mockResolvedValueOnce(Response.json({ ...phone, status: 'DISCONNECTED' }))
        .mockResolvedValueOnce(Response.json(account)).mockResolvedValueOnce(Response.json({ ...phone, status: 'CONNECTED' }));
      await reconcilePlatformConnection(second); await reconcilePlatformConnection(second);
      expect((await second.collection('serverSettings').doc('platform_whatsapp').get()).data()).toMatchObject({ connectionRevision: 1, providerConnection: 'connected', paused: true });
    }
    expect(engineSignal?.aborted).toBe(true);
  } finally { gate.release(); await processing; }
  await vi.waitFor(async () => {
    const job = (await second.collection('platformWhatsAppJobs').doc(lease.jobId).get()).data()!;
    expect(job).toMatchObject({ status: 'cancelled', generationState: 'cancelled', outboxId: null });
    expect((await second.collection('platformWhatsAppBudgetCalls').doc(job.generationReservationId).get()).data()).toMatchObject({ status: 'settled', actualMicros: 9 });
  }, { timeout: 5000 });
  const job = (await second.collection('platformWhatsAppJobs').doc(lease.jobId).get()).data()!;
  const head = (await second.collection('platformWhatsAppJobs').doc('head_' + job.conversationId).get()).data()!;
  expect(head.headJobId).toBeNull();
  // A reconnect may retain the previous accepted menu reference, but never the rejected late output.
  expect((await second.collection('platformWhatsAppOutbox').get()).docs.map(d => d.data()).filter(o => o.jobId === lease.jobId)).toHaveLength(0);
  state.db = second; startPlatformWhatsAppWorker(); await vi.waitFor(() => expect(global.__platformWorkDriver?.draining).toBe(false));
  expect(fetcher.mock.calls.filter(c => c[0].startsWith('https://api.deepseek.com/'))).toHaveLength(1);
  expect(fetcher.mock.calls.filter(c => c[0] === 'https://api.ycloud.com/v2/whatsapp/messages/sendDirectly')).toHaveLength(0);
}, 15000);
it('sparse status before acceptance, unknown ID plus original externalId and conflicting recipient cannot manufacture an alias or delivery', async () => {
  const { lease } = await scenario(); fake(); const original = fetcher.getMockImplementation()!;
  const providerId = 'fix1-provider-status'; let outboxId = '';
  fetcher.mockImplementation(async (url, options) => {
    if (url !== 'https://api.ycloud.com/v2/whatsapp/messages/sendDirectly') return original(url, options);
    outboxId = JSON.parse(options.body).externalId;
    await signedStatus(providerId, 'read', { externalId: outboxId });
    expect((await second.collection('platformWhatsAppOutbox').doc(outboxId).get()).data()).toMatchObject({ status: 'started', deliveryStatus: 'unobserved' });
    return Response.json({ id: providerId, status: 'accepted' });
  });
  vi.stubEnv('PLATFORM_WHATSAPP_PROCESSING_ENABLED', 'true'); await processPlatformWhatsAppWork(lease);
  const accepted = (await second.collection('platformWhatsAppOutbox').doc(outboxId).get()).data()!;
  const periods = (await second.collection('platformWhatsAppBudgetPeriods').get()).docs.map(d => d.data());
  await signedStatus('fix1-unknown-id', 'read', { externalId: outboxId });
  await signedStatus(providerId, 'read', { to: '+12025550999', externalId: outboxId });
  expect((await second.collection('platformWhatsAppOutbox').doc(outboxId).get()).data()).toEqual(accepted);
  expect((await second.collection('platformWhatsAppBudgetPeriods').get()).docs.map(d => d.data())).toEqual(periods);
  await signedStatus(providerId, 'read', { to: customerPhone, externalId: outboxId });
  expect((await second.collection('platformWhatsAppOutbox').doc(outboxId).get()).data()).toMatchObject({ deliveryStatus: 'read', status: 'accepted', expiresAt: accepted.expiresAt });
  expect(fetcher).toHaveBeenCalledTimes(2);
});
it('provider alias collision leaves the new started effect uncertain and never overwrites or retries the old destination', async () => {
  const { lease } = await scenario(); fake();
  const prior = (await second.collection('platformWhatsAppOutbox').get()).docs.find(doc => isProviderAlias(doc.data()))!;
  const priorAlias = structuredClone(prior.data());
  const jobBefore = (await second.collection('platformWhatsAppJobs').doc(lease.jobId).get()).data()!;
  const menuBefore = (await second.collection('platformWhatsAppJobs').doc('head_' + jobBefore.conversationId).get()).data()!.currentMenuOutboxId;
  const original = fetcher.getMockImplementation()!;
  fetcher.mockImplementation(async (url, options) => url === 'https://api.ycloud.com/v2/whatsapp/messages/sendDirectly' ? Response.json({ id: priorAlias.providerId, status: 'accepted' }) : original(url, options));
  vi.stubEnv('PLATFORM_WHATSAPP_PROCESSING_ENABLED', 'true'); await expect(processPlatformWhatsAppWork(lease)).rejects.toMatchObject({ status: 409 });
  const job = (await second.collection('platformWhatsAppJobs').doc(lease.jobId).get()).data()!;
  const out = (await second.collection('platformWhatsAppOutbox').doc(job.outboxId).get()).data()!;
  expect(out).toMatchObject({ status: 'started', providerId: null });
  expect((await second.collection('platformWhatsAppBudgetCalls').doc(out.sendReservationId).get()).data()).toMatchObject({ status: 'started', actualMicros: null });
  expect((await second.collection('platformWhatsAppOutbox').doc(prior.id).get()).data()).toEqual(priorAlias);
  expect((await second.collection('platformWhatsAppJobs').doc('head_' + job.conversationId).get()).data()).toMatchObject({ currentMenuOutboxId: menuBefore });
  state.db = second; startPlatformWhatsAppWorker(); await vi.waitFor(() => expect(global.__platformWorkDriver?.draining).toBe(false));
  expect(fetcher.mock.calls.filter(c => c[0] === 'https://api.ycloud.com/v2/whatsapp/messages/sendDirectly')).toHaveLength(1);
  expect(fetcher.mock.calls.filter(c => c[0].startsWith('https://api.deepseek.com/'))).toHaveLength(1);
});
it('revocation through a second D1 handle aborts an actual queued driver before reservation or inference', async () => {
  const { lease } = await scenario(); fake();
  const gate = barrier(), blockers = Array.from({ length: getSarinQueueStats().maxSlots }, () => runInSarinQueue(() => gate.promise));
  vi.stubEnv('PLATFORM_WHATSAPP_PROCESSING_ENABLED', 'true');
  const processing = processPlatformWhatsAppWork(lease).catch(error => error);
  try {
    await vi.waitFor(() => expect(getSarinQueueStats().normalQueued).toBe(1));
    await revoke(second, 'queued');
    await processing;
    expect(getSarinQueueStats().normalQueued).toBe(0);
    expect(fetcher).not.toHaveBeenCalled();
    const job = (await second.collection('platformWhatsAppJobs').doc(lease.jobId).get()).data()!;
    expect(job).toMatchObject({ status: 'cancelled', outboxId: null, generationToken: null });
    expect((await second.collection('platformWhatsAppJobs').doc('head_' + job.conversationId).get()).data()).toMatchObject({ entryState: 'human_paused', headJobId: null, currentMenuOutboxId: null });
    expect((await second.collection('platformWhatsAppBudgetCalls').get()).docs.map(d => d.data()).filter(c => c.jobId === lease.jobId)).toHaveLength(0);
  } finally { gate.release(); await Promise.all(blockers); await processing; }
});
it.each((['provider', 'finish'] as const).flatMap(point => (['echo', 'revoke'] as const).map(cancel => ({ point, cancel }))))('actual $cancel during $point fences late send completion without menu or retry', async ({ point, cancel }) => {
  const { lease } = await scenario(); fake();
  const gate = barrier(), entered = barrier(); let blocked = false, providerSignal: AbortSignal | undefined;
  const realFetch = fetcher.getMockImplementation()!;
  fetcher.mockImplementation(async (url, options) => {
    if (url === 'https://api.ycloud.com/v2/whatsapp/messages/sendDirectly') {
      providerSignal = options.signal;
      if (point === 'provider') { entered.release(); await gate.promise; }
    }
    return realFetch(url, options);
  });
  state.db = createCloudflareDatabase(async command => {
    if (point === 'finish' && !blocked && command.action === 'commit' && command.writes.some(w => w.op !== 'delete' && w.data.recordType === 'outbox' && w.data.outputKind === 'generated' && w.data.status === 'accepted')) {
      blocked = true; entered.release(); await gate.promise;
    }
    return transport(command);
  });
  vi.stubEnv('PLATFORM_WHATSAPP_PROCESSING_ENABLED', 'true');
  const processing = processPlatformWhatsAppWork(lease).catch(error => error);
  try {
    await entered.promise;
    if (cancel === 'echo') await ingestPlatformWhatsAppEvent(echo({ eventId: 'fix1-echo-' + point, messageId: 'fix1-echo-' + point, whatsappMessageId: null }), getPlatformWhatsAppConfig(), second, now);
    else await revoke(second, point);
    expect(providerSignal?.aborted).toBe(true);
  } finally { gate.release(); await processing; }
  const job = (await second.collection('platformWhatsAppJobs').doc(lease.jobId).get()).data()!;
  const out = (await second.collection('platformWhatsAppOutbox').doc(job.outboxId).get()).data()!;
  expect(job.status).toBe('cancelled'); expect(out.status).toBe('cancelled');
  expect((await second.collection('platformWhatsAppJobs').doc('head_' + job.conversationId).get()).data()).toMatchObject({ entryState: 'human_paused', headJobId: null, currentMenuOutboxId: null });
  expect((await second.collection('platformWhatsAppBudgetCalls').doc(out.sendReservationId).get()).data()).toMatchObject({ status: 'uncertain', actualMicros: null, usageMessages: null });
  state.db = second; startPlatformWhatsAppWorker(); await vi.waitFor(() => expect(global.__platformWorkDriver?.draining).toBe(false));
  expect(fetcher.mock.calls.filter(c => c[0] === 'https://api.ycloud.com/v2/whatsapp/messages/sendDirectly')).toHaveLength(1);
  expect(fetcher.mock.calls.filter(c => c[0].startsWith('https://api.deepseek.com/'))).toHaveLength(1);
}, 15000);
it.each((['prepared', 'claimed'] as const).flatMap(status => (['expired', 'stale-authority'] as const).map(closed => ({ status, closed }))))('boot and cold wake reach live $status behind fifty $closed continuations without ready rows', async ({ status, closed }) => {
  const { lease } = await scenario(); fake();
  vi.stubEnv('PLATFORM_WHATSAPP_SEND_DAILY_BUDGET_MICROS', '100000');
  for (const stage of ['audio', 'generation', 'send'] as const) {
    const circuit = workCircuit(undefined, stage);
    await db.collection('platformWhatsAppBudgetPeriods').doc(circuit.circuitId).set(circuit);
  }
  await runPlatformSupportWork(lease, db, new AbortController().signal);
  const store = createPlatformWorkStore(db), job = (await store.readAuthorized(lease))!;
  const original = (await db.collection('platformWhatsAppOutbox').doc(job.outboxId!).get()).data()!;
  const payload = workPayload(original as never, now)!;
  const liveId = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
  const live = prepareOutbox(job, payload.customerPhone, payload.text!, liveId, now);
  await db.runTransaction(async tx => {
    await tx.get(db.collection('platformWhatsAppJobs').doc(job.jobId));
    tx.delete(db.collection('platformWhatsAppOutbox').doc(job.outboxId!));
    tx.set(db.collection('platformWhatsAppOutbox').doc(liveId), live);
    tx.set(db.collection('platformWhatsAppJobs').doc(job.jobId), { ...job, outboxId: liveId });
  });
  if (status === 'claimed') await store.claimSend(liveId);
  const saved = (await db.collection('platformWhatsAppOutbox').doc(liveId).get()).data()!;
  const call = saved.sendReservationId ? (await db.collection('platformWhatsAppBudgetCalls').doc(saved.sendReservationId).get()).data()! : null;
  const oldIds: string[] = [];
  for (let index = 0; index < 50; index++) {
    const id = `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`, jobId = 'job_' + index.toString(16).padStart(64, '0'); oldIds.push(id);
    const old = { ...job, jobId, outboxId: id, ...(closed === 'expired' ? { processingStartedAt: now - 120000, processingDeadlineAt: now, leaseClaimedAt: now - 120000, leaseExpiresAt: now - 60000, nextAttemptAt: now } : {}) };
    old.content = encryptPlatformWhatsAppContent(workPayload(job, now)!, 'platformWhatsAppJobs/' + jobId, getPlatformWhatsAppConfig().contentKey);
    const out = prepareOutbox(old, payload.customerPhone, payload.text!, id, now);
    const ids = budgetIds(old, 'send', now);
    const claimed = status === 'claimed' ? { ...out, status: 'claimed' as const, sendToken: saved.sendToken, sendClaimedAt: now, sendReservationId: ids.reservationId } : out;
    expect(isPlatformJob(old)).toBe(true); expect(isPlatformOutbox(claimed)).toBe(true);
    await db.runTransaction(async tx => {
      await tx.get(db.collection('platformWhatsAppJobs').doc(jobId));
      tx.set(db.collection('platformWhatsAppJobs').doc(jobId), old);
      tx.set(db.collection('platformWhatsAppOutbox').doc(id), claimed);
      if (call) tx.set(db.collection('platformWhatsAppBudgetCalls').doc(ids.reservationId), { ...call, reservationId: ids.reservationId, jobId });
    });
  }
  if (call) {
    const period = db.collection('platformWhatsAppBudgetPeriods').doc(call.periodId);
    const current = (await period.get()).data()!;
    await period.set({ ...current, heldMicros: current.heldMicros + 50 * call.maximumMicros });
  }
  const sendPeriodsBefore = (await db.collection('platformWhatsAppBudgetPeriods').get()).docs.map(d => d.data()).filter(p => p.recordType === 'budget_period' && p.stage === 'send');
  expect((await db.collection('platformWhatsAppJobs').where('status', '==', 'ready').get()).empty).toBe(true);
  vi.stubEnv('PLATFORM_WHATSAPP_PROCESSING_ENABLED', 'true');
  const env = { SARIN_DB: runtime.db, SARIN_FILES: runtime.bucket, ...Object.fromEntries(Object.entries(process.env).filter(([key]) => key.startsWith('PLATFORM_'))) };
  // Both proofs are read-only and must find actual live authority, not expired existence.
  expect.soft(await hasDuePlatformWork(second, now)).toBe(true);
  expect.soft(await hasPotentialPlatformWork(env, now)).toBe(true);
  fetcher.mockClear(); startPlatformWhatsAppWorker();
  await vi.waitFor(() => expect(global.__platformWorkDriver?.draining).toBe(false), { timeout: 15000 });
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(JSON.parse(fetcher.mock.calls[0][1].body).externalId).toBe(liveId);
  expect((await db.collection('platformWhatsAppOutbox').doc(liveId).get()).data()).toMatchObject({ status: 'accepted', outboxId: liveId, expiresAt: live.expiresAt });
  for (const id of oldIds) expect((await db.collection('platformWhatsAppOutbox').doc(id).get()).data()).toMatchObject({ status: closed === 'expired' ? 'cancelled' : status, sendStartedAt: null });
  if (status === 'claimed') {
    const oldCalls = (await db.collection('platformWhatsAppBudgetCalls').get()).docs.map(doc => doc.data()).filter(row => row.stage === 'send' && row.jobId !== job.jobId && row.jobId.startsWith('job_000000'));
    expect(oldCalls).toHaveLength(50);
    for (const oldCall of oldCalls) expect(oldCall).toMatchObject({ status: 'reserved', effectToken: null, startedAt: null });
    expect((await db.collection('platformWhatsAppBudgetPeriods').get()).docs.map(d => d.data()).filter(p => p.recordType === 'budget_period' && p.stage === 'send')).toEqual(sendPeriodsBefore);
  }
  expect((await db.collection('platformWhatsAppJobs').doc('head_' + job.conversationId).get()).data()).toMatchObject({ currentMenuOutboxId: liveId });
  expect(global.__platformWorkDriver?.timer).toBeNull();
}, 30000);
it('two real D1 handles compete at generation start CAS and invoke the actual engine once', async () => {
  const { lease } = await scenario(); fake(); let arrivals = 0, release!: () => void; const barrier = new Promise<void>(r => { release = r; });
  const racing: DataTransport = async command => { if (command.action === 'commit' && command.writes.some(w => w.op !== 'delete' && w.data.generationState === 'started') && arrivals < 2) { arrivals++; if (arrivals === 2) release(); await barrier; } return transport(command); };
  const results = await Promise.allSettled([runPlatformSupportWork(lease, createCloudflareDatabase(racing), new AbortController().signal), runPlatformSupportWork(lease, createCloudflareDatabase(racing), new AbortController().signal)]);
  expect(arrivals).toBe(2); expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1); expect(fetcher).toHaveBeenCalledTimes(1);
  const calls = (await db.collection('platformWhatsAppBudgetCalls').get()).docs.map(d => d.data()).filter(isBudgetCall); expect(calls.filter(c => c.stage === 'generation')).toHaveLength(1);
  expect(commands.filter(c => c.action === 'commit').every(c => c.action === 'commit' && c.writes.every(w => !/^(?:aiBudget|businesses|payments)/.test(w.path)))).toBe(true);
}, 15000);
it.each(['start', 'result'] as const)('lost generation %s commit acknowledgment never replays engine or creates alternate text', async phase => {
  const { lease } = await scenario(); fake();
  const lost = createCloudflareDatabase(async command => { const result = await transport(command); if (command.action === 'commit' && command.writes.some(w => w.op !== 'delete' && w.path === 'platformWhatsAppJobs/' + lease.jobId && w.data.generationState === (phase === 'start' ? 'started' : 'completed'))) throw new StorageError(503, 'DATA_UNAVAILABLE'); return result; });
  await expect(runPlatformSupportWork(lease, lost, new AbortController().signal)).rejects.toThrow();
  await expect(runPlatformSupportWork(lease, second, new AbortController().signal)).rejects.toThrow();
  expect(fetcher).toHaveBeenCalledTimes(phase === 'start' ? 0 : 1);
  const outs = (await db.collection('platformWhatsAppOutbox').get()).docs.map(d => d.data()).filter(isPlatformOutbox).filter(o => o.outputKind === 'generated'); expect(outs).toHaveLength(phase === 'start' ? 0 : 1);
});
it.each(['permit', 'acceptance'] as const)('actual driver preserves <=1 provider dispatch after lost send %s response and restart', async phase => {
  const { lease } = await scenario(); fake();
  state.db = createCloudflareDatabase(async command => { const result = await transport(command); if (command.action === 'commit' && command.writes.some(w => w.op !== 'delete' && w.data.recordType === 'outbox' && w.data.outputKind === 'generated' && w.data.status === (phase === 'permit' ? 'started' : 'accepted'))) throw new StorageError(503, 'DATA_UNAVAILABLE'); return result; });
  vi.stubEnv('PLATFORM_WHATSAPP_PROCESSING_ENABLED', 'true'); await expect(processPlatformWhatsAppWork(lease)).rejects.toThrow();
  state.db = second; delete global.__platformWorkDriver; startPlatformWhatsAppWorker(); await vi.waitFor(() => expect(global.__platformWorkDriver?.draining).toBe(false));
  const sends = fetcher.mock.calls.filter(c => c[0] === 'https://api.ycloud.com/v2/whatsapp/messages/sendDirectly'); expect(sends).toHaveLength(phase === 'permit' ? 0 : 1);
  expect(fetcher.mock.calls.filter(c => c[0].startsWith('https://api.deepseek.com/'))).toHaveLength(1);
  const aliases = (await db.collection('platformWhatsAppOutbox').get()).docs.map(d => d.data()).filter(isProviderAlias); expect(aliases.filter(a => a.providerId.startsWith('provider-'))).toHaveLength(phase === 'permit' ? 0 : 1);
});
it('accepted provider alias and sparse signed delivery remain atomic, monotonic and independently sticky failed', async () => {
  const { lease } = await scenario(); fake(); vi.stubEnv('PLATFORM_WHATSAPP_PROCESSING_ENABLED', 'true'); await processPlatformWhatsAppWork(lease);
  const out = (await db.collection('platformWhatsAppOutbox').get()).docs.map(d => d.data()).filter(isPlatformOutbox).find(o => o.outputKind === 'generated')!;
  const config = getPlatformWhatsAppConfig();
  async function status(value: string, changes = {}) {
    const bytes = JSON.stringify({ id: 'synthetic-status-' + value, type: 'whatsapp.message.updated', apiVersion: 'v2', createTime: new Date(now).toISOString(), whatsappMessage: { id: out.providerId, status: value, ...changes } }), t = String(Math.floor(now / 1000));
    const signature = createHmac('sha256', config.signingSecret).update(t + '.').update(bytes).digest('hex');
    const event = await readYCloudWebhook(new Request('https://synthetic.invalid/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json', 'YCloud-Signature': `t=${t},s=${signature}` }, body: bytes }), { signingSecret: config.signingSecret, scope: { wabaId: config.scope!.wabaId, phoneE164: config.scope!.phoneE164 }, now });
    if (event?.kind === 'message_status') await recordPlatformDeliveryStatus(event, second, now);
  }
  const before = (await db.collection('platformWhatsAppBudgetPeriods').get()).docs.map(d => d.data());
  await status('read', { externalId: 'forged' }); expect((await db.collection('platformWhatsAppOutbox').doc(out.outboxId).get()).data()).toMatchObject({ deliveryStatus: 'accepted' });
  await status('failed'); await status('read'); await status('sent'); await status('failed');
  expect((await db.collection('platformWhatsAppOutbox').doc(out.outboxId).get()).data()).toMatchObject({ status: 'accepted', deliveryStatus: 'read', deliveryFailed: true, bodyExpiresAt: out.bodyExpiresAt, expiresAt: out.expiresAt });
  expect((await db.collection('platformWhatsAppBudgetPeriods').get()).docs.map(d => d.data())).toEqual(before); expect(fetcher).toHaveBeenCalledTimes(2);
  const atomic = commands.filter(c => c.action === 'commit' && c.writes.some(w => w.op !== 'delete' && w.data.providerId === out.providerId && w.data.recordType === 'provider_alias'));
  expect(atomic.some(c => c.action === 'commit' && c.writes.some(w => w.op !== 'delete' && w.path === 'platformWhatsAppOutbox/' + out.outboxId && w.data.status === 'accepted'))).toBe(true);
});
it.each(['completed', 'unknown'] as const)('actual A4 Node adapter delegates one audio reserve/Worker settlement and follows %s path', async audioStatus => {
  const s = await buildWorkAudioScenario({ generation: true });
  await db.runTransaction(async tx => { await tx.get(db.collection('serverSettings').doc('platform_whatsapp')); for (const [path, row] of s.rows) { const [root, id] = path.split('/'); tx.set(db.collection(root).doc(id), row); } });
  fake(); const regular = fetcher.getMockImplementation()!;
  const env = { SARIN_DB: runtime.db, SARIN_FILES: runtime.bucket, ...Object.fromEntries(Object.entries(process.env).filter(([key]) => key.startsWith('PLATFORM_'))) } as Parameters<typeof preparePlatformAudio>[1];
  fetcher.mockImplementation(async (url, options) => {
    if (url !== AUDIO_ENDPOINT) return regular(url, options);
    const prepared = (await preparePlatformAudio(s.lease, env, now))!; expect(prepared).not.toBeNull(); expect(await startPlatformAudio(s.lease, prepared.audioToken, env, now)).toBe(true);
    await finishPlatformAudio(s.lease, prepared.audioToken, audioStatus === 'completed' ? { status: 'completed', actualMicros: 1, usage: { ...emptyUsage, usageAudioMilliseconds: 1000 } } : { status: 'unknown', actualMicros: null, usage: emptyUsage }, env, now);
    return Response.json(audioStatus === 'completed' ? { ok: true, audioToken: prepared.audioToken, text: 'Consulta sintética de soporte', durationSeconds: 1 } : { ok: false, reason: 'unknown' });
  });
  vi.stubEnv('PLATFORM_WHATSAPP_PROCESSING_ENABLED', 'true'); vi.stubEnv('PLATFORM_WHATSAPP_TRANSCRIPTION_ENABLED', 'true'); await processPlatformWhatsAppWork(s.lease);
  expect(fetcher.mock.calls.filter(c => c[0] === AUDIO_ENDPOINT)).toHaveLength(1);
  expect(fetcher.mock.calls.filter(c => c[0].startsWith('https://api.deepseek.com/'))).toHaveLength(audioStatus === 'completed' ? 1 : 0);
  const calls = (await db.collection('platformWhatsAppBudgetCalls').get()).docs.map(d => d.data()).filter(isBudgetCall); expect(calls.filter(c => c.stage === 'audio')).toHaveLength(1);
  expect(calls.find(c => c.stage === 'audio')).toMatchObject({ status: audioStatus === 'completed' ? 'settled' : 'uncertain', maximumMicros: 1 });
  expect((await db.collection('platformWhatsAppOutbox').get()).docs.map(d => d.data()).filter(isPlatformOutbox).some(o => o.status === 'accepted' && o.outputKind === (audioStatus === 'completed' ? 'generated' : 'audio_fallback'))).toBe(true);
});
