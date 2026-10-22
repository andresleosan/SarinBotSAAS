import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import type { Database } from '@/lib/storage/types';
const runtime = vi.hoisted(() => ({ db: null as Database | null, getUser: vi.fn() }));
vi.mock('@/lib/firebase/admin', () => ({ getAdminDb: () => { if (!runtime.db) throw new Error('Default backend forbidden'); return runtime.db; }, getAdminAuth: () => runtime }));
import { buildSupportScenario } from './platform-support-fixtures';
import { now, echo, memoryStore, configure, connection, connectionPath, identity } from './platform-whatsapp-test-fixtures';
import { configureWork, workCircuit } from './platform-whatsapp-work-fixtures';
import { POST } from '@/app/api/whatsapp/ycloud/platform/webhook/route';
import { processPlatformWhatsAppWork, startPlatformWhatsAppWorker, recognizePlatformWorkCancellation } from '@/lib/server/platform-whatsapp-worker';
import { runPlatformSupportWork } from '@/lib/server/platform-support-bot';
import { getPlatformWhatsAppConfig } from '@/lib/server/platform-whatsapp-config';
import { ingestPlatformWhatsAppEvent } from '@/lib/server/platform-whatsapp-ingress';
import { isPlatformOutbox } from '../shared/platform-whatsapp-work';
const fetcher = vi.fn();
type State = { draining: boolean; pending: boolean; timer: ReturnType<typeof setTimeout> | null; owned: Map<string, { controller: AbortController }> };
const global = globalThis as typeof globalThis & { __platformWorkDriver?: State };
const idle = () => vi.waitFor(() => expect(global.__platformWorkDriver?.draining ?? false).toBe(false));
beforeEach(() => { vi.spyOn(Date, 'now').mockReturnValue(now); runtime.getUser.mockReset().mockImplementation(async uid => ({ uid, disabled: false })); fetcher.mockReset(); vi.stubGlobal('fetch', fetcher); vi.stubEnv('DEEPSEEK_API_KEY', 'synthetic-key'); vi.stubEnv('PLATFORM_YCLOUD_API_KEY', 'synthetic-provider-key'); });
afterEach(async () => { vi.stubEnv('PLATFORM_WHATSAPP_PROCESSING_ENABLED', 'false'); await idle(); if (global.__platformWorkDriver?.timer) clearTimeout(global.__platformWorkDriver.timer); for (const o of global.__platformWorkDriver?.owned.values() ?? []) o.controller.abort(); delete global.__platformWorkDriver; runtime.db = null; vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
function engine() { return Response.json({ model: 'synthetic-wire-model-v1', choices: [{ message: { content: JSON.stringify({ reply: 'Puedes pedir atención humana.', sourceIds: ['sarin.support.v1'] }) } }], usage: { prompt_tokens: 10, prompt_cache_hit_tokens: 0, prompt_cache_miss_tokens: 10, completion_tokens: 5, total_tokens: 15 } }); }
function fakeProvider() { fetcher.mockImplementation(async (url, options) => url.startsWith('https://api.deepseek.com/') ? engine() : Response.json({ id: 'provider-' + JSON.parse(options.body).externalId, status: 'accepted' })); }
it('actual driver generates and dispatches once, then boot sees no runnable work or idle timer', async () => {
  const s = await buildSupportScenario(), { lease } = await s.question(); runtime.db = s.db; fakeProvider(); vi.stubEnv('PLATFORM_WHATSAPP_PROCESSING_ENABLED', 'true');
  await processPlatformWhatsAppWork(lease);
  expect(fetcher).toHaveBeenCalledTimes(2);
  const out = [...s.rows.values()].find(r => isPlatformOutbox(r) && r.outputKind === 'generated'); expect(out).toMatchObject({ status: 'accepted', deliveryStatus: 'accepted' });
  startPlatformWhatsAppWorker(); await idle(); expect(fetcher).toHaveBeenCalledTimes(2); expect(global.__platformWorkDriver?.timer).toBeNull();
});
it.each(['prepared', 'claimed'] as const)('restarts from %s outbox without another generation or replacing UUID', async status => {
  const s = await buildSupportScenario(), { lease } = await s.question(); runtime.db = s.db; fakeProvider();
  await runPlatformSupportWork(lease, s.db, new AbortController().signal);
  const id = (await s.work.readAuthorized(lease))!.outboxId!; if (status === 'claimed') await s.work.claimSend(id);
  const original = structuredClone(s.rows.get('platformWhatsAppOutbox/' + id));
  vi.stubEnv('PLATFORM_WHATSAPP_PROCESSING_ENABLED', 'true'); startPlatformWhatsAppWorker(); await idle();
  expect(fetcher).toHaveBeenCalledTimes(2); expect(s.rows.get('platformWhatsAppOutbox/' + id)).toMatchObject({ status: 'accepted', outboxId: id, outputFingerprint: original!.outputFingerprint, bodyExpiresAt: original!.bodyExpiresAt, expiresAt: original!.expiresAt });
});
it('human echo during engine fetch aborts the owned signal and prevents output/send revival', async () => {
  const s = await buildSupportScenario(), { lease } = await s.question(); runtime.db = s.db;
  let release!: () => void, entered!: () => void; const started = new Promise<void>(r => { entered = r; }), barrier = new Promise<void>(r => { release = r; });
  let signal: AbortSignal | undefined;
  fetcher.mockImplementation(async (_url, options) => { signal = options.signal; entered(); await barrier; return engine(); });
  vi.stubEnv('PLATFORM_WHATSAPP_PROCESSING_ENABLED', 'true'); const processing = processPlatformWhatsAppWork(lease); const handled = processing.catch(() => {}); await started;
  await ingestPlatformWhatsAppEvent(echo({ eventId: 'synthetic-a5-echo', messageId: 'synthetic-a5-echo', whatsappMessageId: null }), getPlatformWhatsAppConfig(), s.db, now);
  expect(signal?.aborted).toBe(true); release(); await handled; await idle();
  expect(fetcher).toHaveBeenCalledTimes(1); expect([...s.rows.values()].filter(r => isPlatformOutbox(r) && r.outputKind === 'generated')).toHaveLength(0);
});
it('starts empty with no provider request, no timers and no phantom source', async () => {
  runtime.db = memoryStore().db; vi.stubEnv('PLATFORM_WHATSAPP_PROCESSING_ENABLED', 'true'); startPlatformWhatsAppWorker(); await idle();
  expect(fetcher).not.toHaveBeenCalled(); expect(global.__platformWorkDriver?.timer).toBeNull(); expect(global.__platformWorkDriver?.owned.size).toBe(0);
});
it('signed first ordinary input reconciles before admission and exact replay never creates a second notice', async () => {
  configure(); configureWork(); const s = memoryStore(); runtime.db = s.db;
  s.seed(connectionPath, connection()); const circuit = workCircuit(); s.seed('platformWhatsAppBudgetPeriods/' + circuit.circuitId, circuit);
  fetcher.mockImplementation(async (url, options) => url.includes('/businessAccounts/') ? Response.json({ id: identity.wabaId, accountReviewStatus: 'APPROVED', banState: 'REINSTATE', restrictions: [], paymentMethodAttached: true }) : url.includes('/phoneNumbers/') ? Response.json({ id: identity.phoneNumberId, wabaId: identity.wabaId, phoneNumber: identity.phoneE164, status: 'CONNECTED' }) : Response.json({ id: 'provider-' + JSON.parse(options.body).externalId, status: 'accepted' }));
  vi.stubEnv('PLATFORM_WHATSAPP_PROCESSING_ENABLED', 'true');
  const bytes = JSON.stringify({ id: 'synthetic-initial-event', type: 'whatsapp.inbound_message.received', apiVersion: 'v2', createTime: new Date(now).toISOString(), whatsappInboundMessage: { id: 'synthetic-initial-message', wabaId: identity.wabaId, from: '+12025550123', to: identity.phoneE164, type: 'text', sendTime: new Date(now).toISOString(), text: { body: 'Hola' } } }), timestamp = String(Math.floor(now / 1000));
  const signature = createHmac('sha256', getPlatformWhatsAppConfig().signingSecret).update(timestamp + '.').update(bytes).digest('hex');
  const request = () => new Request('https://synthetic.invalid/api/whatsapp/ycloud/platform/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json', 'YCloud-Signature': `t=${timestamp},s=${signature}` }, body: bytes });
  expect((await POST(request())).status).toBe(200); await idle(); expect(fetcher).toHaveBeenCalledTimes(3);
  expect((await POST(request())).status).toBe(200); await idle(); expect(fetcher).toHaveBeenCalledTimes(3);
  expect(s.rows.get(connectionPath)).toMatchObject({ observationStatus: 'connected', observedAt: now });
  expect([...s.rows.values()].filter(isPlatformOutbox)).toHaveLength(1);
});
it('sole renewal extends 60s lease at 20s while preserving immutable 120s deadline', async () => {
  const s = await buildSupportScenario(), { lease } = await s.question(); runtime.db = s.db;
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
  let entered!: () => void, release!: () => void; const started = new Promise<void>(r => { entered = r; }), barrier = new Promise<void>(r => { release = r; });
  fetcher.mockImplementation(async () => { entered(); await barrier; return engine(); }); vi.stubEnv('PLATFORM_WHATSAPP_PROCESSING_ENABLED', 'true');
  const result = processPlatformWhatsAppWork(lease).catch(() => {}); await started;
  vi.mocked(Date.now).mockReturnValue(now + 20000); await vi.advanceTimersByTimeAsync(20000);
  expect(s.rows.get('platformWhatsAppJobs/' + lease.jobId)).toMatchObject({ leaseExpiresAt: now + 80000, processingDeadlineAt: now + 120000 });
  runtime.getUser.mockResolvedValue({ uid: 'synthetic-disabled', disabled: true }); await recognizePlatformWorkCancellation(); release(); await result;
  expect(fetcher).toHaveBeenCalledTimes(1); expect(global.__platformWorkDriver?.owned.size).toBe(0); vi.useRealTimers();
});
it('activity-only 30s recovery timer drains prepared work and disappears when empty', async () => {
  const s = await buildSupportScenario(), { lease } = await s.question(); runtime.db = s.db; fakeProvider();
  await runPlatformSupportWork(lease, s.db, new AbortController().signal);
  vi.stubEnv('PLATFORM_YCLOUD_API_KEY', ''); vi.stubEnv('PLATFORM_WHATSAPP_PROCESSING_ENABLED', 'true');
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] }); startPlatformWhatsAppWorker();
  for (let i = 0; i < 100 && global.__platformWorkDriver?.draining; i++) await vi.advanceTimersByTimeAsync(0);
  expect(global.__platformWorkDriver?.draining).toBe(false); expect(global.__platformWorkDriver?.timer?.hasRef()).toBe(false);
  const recoveryTimer = global.__platformWorkDriver?.timer;
  startPlatformWhatsAppWorker();
  for (let i = 0; i < 100 && global.__platformWorkDriver?.draining; i++) await vi.advanceTimersByTimeAsync(0);
  expect(global.__platformWorkDriver?.timer).toBe(recoveryTimer);
  vi.stubEnv('PLATFORM_YCLOUD_API_KEY', 'synthetic-provider-key'); vi.mocked(Date.now).mockReturnValue(now + 30000); await vi.advanceTimersByTimeAsync(30000);
  for (let i = 0; i < 100 && global.__platformWorkDriver?.draining; i++) await vi.advanceTimersByTimeAsync(0);
  expect(fetcher).toHaveBeenCalledTimes(2); expect(global.__platformWorkDriver?.timer).toBeNull(); vi.useRealTimers();
});
