import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import type { Database } from '@/lib/storage/types';
const state = vi.hoisted(() => ({ db: null as Database | null, getUser: vi.fn() }));
vi.mock('@/lib/firebase/admin', () => ({ getAdminDb: () => { if (!state.db) throw new Error('Default backend forbidden'); return state.db; }, getAdminAuth: () => state }));
import { createDataTestRuntime } from '../cloudflare/tests/data-runtime.mjs';
import { createCloudflareDatabase, StorageError, type DataTransport } from '@/lib/storage/database';
import { buildSupportScenario } from './platform-support-fixtures';
import { buildWorkAudioScenario } from './platform-whatsapp-work-scenario';
import { preparePlatformAudio, startPlatformAudio, finishPlatformAudio } from '../cloudflare/tests/platform-whatsapp-work-bridge.mjs';
import { AUDIO_ENDPOINT } from '../shared/platform-whatsapp-audio-protocol';
import { now } from './platform-whatsapp-test-fixtures';
import { runPlatformSupportWork } from '@/lib/server/platform-support-bot';
import { processPlatformWhatsAppWork, startPlatformWhatsAppWorker } from '@/lib/server/platform-whatsapp-worker';
import { createPlatformWorkStore, recordPlatformDeliveryStatus } from '@/lib/server/platform-whatsapp-work-store';
import { isBudgetCall, isPlatformOutbox, isProviderAlias, emptyUsage } from '../shared/platform-whatsapp-work';
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
