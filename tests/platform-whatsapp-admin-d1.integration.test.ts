import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import type { Database } from '@/lib/storage/types';
const state = vi.hoisted(() => ({ db: null as Database | null, getUser: vi.fn() }));
vi.mock('@/lib/firebase/admin', () => ({ getAdminDb: () => { if (!state.db) throw new Error('Default backend forbidden'); return state.db; }, getAdminAuth: () => state }));
import { createDataTestRuntime } from '../cloudflare/tests/data-runtime.mjs';
import { createCloudflareDatabase, StorageError, type DataTransport } from '@/lib/storage/database';
import { buildSupportScenario } from './platform-support-fixtures';
import { buildWorkAudioScenario } from './platform-whatsapp-work-scenario';
import { preparePlatformAudio, startPlatformAudio, finishPlatformAudio, handlePlatformAudioOutbound } from '../cloudflare/tests/platform-whatsapp-work-bridge.mjs';
import { AUDIO_ENDPOINT } from '../shared/platform-whatsapp-audio-protocol';
import { now } from './platform-whatsapp-test-fixtures';
import { seedConsents } from './platform-whatsapp-link-fixtures';
import { runPlatformSupportWork } from '@/lib/server/platform-support-bot';
import { processPlatformWhatsAppWork, startPlatformWhatsAppWorker } from '@/lib/server/platform-whatsapp-worker';
import { createPlatformWorkStore, takePlatformSendPermit } from '@/lib/server/platform-whatsapp-work-store';
import { transcribePlatformAudio } from '@/lib/server/platform-whatsapp-audio';
import { commitPlatformAudioResult } from '@/lib/server/platform-whatsapp-work-audio';
import { isBudgetCall, isPlatformOutbox, emptyUsage } from '../shared/platform-whatsapp-work';
import type { DataCommand, DataReadResult, DataCommitResult } from '../shared/data-protocol';
let runtime: Awaited<ReturnType<typeof createDataTestRuntime>>, db: Database, second: Database;
const commands: DataCommand[] = [], fetcher = vi.fn();
const transport: DataTransport = async command => { commands.push(structuredClone(command)); const r = await runtime.fetch(command), value = await r.json() as DataReadResult | DataCommitResult; if (!r.ok) throw new StorageError(r.status, (value as unknown as { code: string }).code); return value; };
const driver = globalThis as typeof globalThis & { __platformWorkDriver?: { draining: boolean; timer: ReturnType<typeof setTimeout> | null } };
beforeAll(async () => { runtime = await createDataTestRuntime(); }, 30000);
afterAll(async () => { await runtime?.dispose(); });
beforeEach(async () => {
  vi.spyOn(Date, 'now').mockReturnValue(now); state.getUser.mockReset().mockImplementation(async uid => ({ uid, disabled: false }));
  await runtime.db.exec('DELETE FROM app_documents; DELETE FROM app_commits;'); db = createCloudflareDatabase(transport); second = createCloudflareDatabase(transport); state.db = db; commands.length = 0;
  fetcher.mockReset(); vi.stubGlobal('fetch', fetcher); vi.stubEnv('DEEPSEEK_API_KEY', 'synthetic-key'); vi.stubEnv('PLATFORM_YCLOUD_API_KEY', 'synthetic-key'); vi.stubEnv('PILOT_AI_BUDGET_ENFORCED', 'true'); vi.stubEnv('SUPERADMIN_UID', 'demo-link-user');
});
afterEach(async () => { vi.stubEnv('PLATFORM_WHATSAPP_PROCESSING_ENABLED', 'false'); await vi.waitFor(() => expect(driver.__platformWorkDriver?.draining ?? false).toBe(false)); if (driver.__platformWorkDriver?.timer) clearTimeout(driver.__platformWorkDriver.timer); delete driver.__platformWorkDriver; state.db = null; vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
async function seed(rows: Map<string, Record<string, unknown>>) { await db.runTransaction(async tx => { await tx.get(db.collection('serverSettings').doc('platform_whatsapp')); for (const [path, row] of rows) { const [root, id] = path.split('/'); tx.set(db.collection(root).doc(id), row); } }); }
async function scenario(audio = false) {
  if (audio) { const s = await buildWorkAudioScenario({ generation: true }); await seed(s.rows); return { lease: s.lease }; }
  const s = await buildSupportScenario(), q = await s.question('Consulta los pagos pendientes.');
  s.seed('paymentReceipts/demo-payment', { tenantId: 'demo-business', tenantName: 'Demo', status: 'pending', submittedAt: now, amountCOP: 1000 }); await seed(s.rows); return q;
}
function fake() { fetcher.mockImplementation(async (url, options) => url.startsWith('https://api.deepseek.com/') ? Response.json({ model: 'synthetic-wire-model-v1', choices: [{ message: { content: JSON.stringify({ reply: 'Consulta privada sin efectos de pago.', sourceIds: [] }) } }], usage: { prompt_tokens: 10, prompt_cache_hit_tokens: 0, prompt_cache_miss_tokens: 10, completion_tokens: 5, total_tokens: 15 } }) : Response.json({ id: 'provider-' + JSON.parse(options.body).externalId, status: 'accepted' })); }
const barrier = () => { let release!: () => void; const promise = new Promise<void>(resolve => { release = resolve; }); return { promise, release }; };
const generated = async () => (await db.collection('platformWhatsAppOutbox').get()).docs.map(d => d.data()).filter(isPlatformOutbox).filter(o => o.outputKind === 'generated');
const workerEnv = () => ({ SARIN_DB: runtime.db, SARIN_FILES: runtime.bucket, ...Object.fromEntries(Object.entries(process.env).filter(([key]) => key.startsWith('PLATFORM_'))), SUPERADMIN_UID: process.env.SUPERADMIN_UID, SARIN_APP: { idFromName: () => ({ toString: () => 'singleton' }) }, AI: { run: vi.fn() } });
it('runs source-bound private job through actual driver, encrypted outbox and once-send without payment effects', async () => {
  const { lease } = await scenario(); commands.length = 0; fake(); vi.stubEnv('PLATFORM_WHATSAPP_PROCESSING_ENABLED', 'true'); await processPlatformWhatsAppWork(lease);
  expect(await generated()).toEqual([expect.objectContaining({ status: 'accepted', bodyState: 'body_present' })]);
  startPlatformWhatsAppWorker(); await vi.waitFor(() => expect(driver.__platformWorkDriver?.draining).toBe(false));
  expect(fetcher.mock.calls.filter(c => c[0].startsWith('https://api.deepseek.com/'))).toHaveLength(1);
  expect(fetcher.mock.calls.filter(c => c[0].startsWith('https://api.ycloud.com/'))).toHaveLength(1);
  expect(commands.filter(c => c.action === 'commit').every(c => c.action === 'commit' && c.writes.every(w => !/^(?:paymentReceipts|businesses|responseQuota|aiBudget)/.test(w.path)))).toBe(true);
});
it.each(['result', 'send'] as const)('real D1 two-handle %s CAS barrier revokes private authority before persistence', async phase => {
  const { lease } = await scenario(); fake();
  if (phase === 'send') await runPlatformSupportWork(lease, db, new AbortController().signal);
  const gate = barrier(), entered = barrier(); let blocked = false;
  const racing = createCloudflareDatabase(async command => {
    if (!blocked && command.action === 'commit' && command.writes.some(w => w.op !== 'delete' && (phase === 'result' ? w.data.generationState === 'completed' : w.data.recordType === 'outbox' && w.data.status === 'started'))) { blocked = true; entered.release(); await gate.promise; }
    return transport(command);
  });
  let operation: Promise<unknown>;
  if (phase === 'result') operation = runPlatformSupportWork(lease, racing, new AbortController().signal).catch(e => e);
  else { const out = (await generated())[0], claim = (await createPlatformWorkStore(db).claimSend(out.outboxId))!; operation = takePlatformSendPermit(out.outboxId, claim.token, racing).catch(e => e); }
  try { await entered.promise; await seedConsents(second, 'demo-link-user', 2, false); } finally { gate.release(); }
  const result = await operation;
  expect(result === null || result instanceof Error).toBe(true);
  expect((await generated()).some(o => o.status === 'started' || o.status === 'accepted')).toBe(false);
  if (phase === 'result') expect(await generated()).toHaveLength(0);
  expect((await db.collection('platformWhatsAppBudgetCalls').get()).docs.map(d => d.data()).find(c => c.stage === 'generation')).toMatchObject({ status: 'settled' });
});
it.each(['role', 'disabled', 'cutoff', 'anchor'] as const)('recovered claimed private outbox denies current %s loss', async loss => {
  const { lease } = await scenario(); fake(); await runPlatformSupportWork(lease, db, new AbortController().signal);
  const out = (await generated())[0]; await createPlatformWorkStore(db).claimSend(out.outboxId);
  if (loss === 'role') vi.stubEnv('SUPERADMIN_UID', 'other');
  if (loss === 'disabled') state.getUser.mockResolvedValue({ uid: 'demo-link-user', disabled: true });
  if (loss === 'cutoff') state.getUser.mockResolvedValue({ uid: 'demo-link-user', disabled: false, tokensValidAfterTime: new Date(now + 1000).toISOString() });
  if (loss === 'anchor') await seedConsents(second, 'demo-link-user', 2, false);
  vi.stubEnv('PLATFORM_WHATSAPP_PROCESSING_ENABLED', 'true'); startPlatformWhatsAppWorker(); await vi.waitFor(() => expect(driver.__platformWorkDriver?.draining).toBe(false));
  expect(fetcher.mock.calls.filter(c => c[0].startsWith('https://api.ycloud.com/'))).toHaveLength(0);
  expect((await generated())[0].status).toBe('cancelled');
});
it.each([undefined, 'other'] as const)('actual Worker rejects private audio for UID %s before media or AI', async uid => {
  const { lease } = await scenario(true), env = { ...workerEnv(), SUPERADMIN_UID: uid };
  const response = await handlePlatformAudioOutbound(new Request(AUDIO_ENDPOINT, { method: 'POST', body: JSON.stringify(lease) }), env, { className: 'SarinApp', containerId: 'singleton' });
  expect(await response.json()).toEqual({ ok: false, reason: 'denied' }); expect(fetcher).not.toHaveBeenCalled(); expect(env.AI.run).not.toHaveBeenCalled();
  expect((await db.collection('platformWhatsAppJobs').doc(lease.jobId).get()).data()).toMatchObject({ kind: 'admin_query', audioState: 'not_started' });
});
it('private audio saying approve remains read-only through actual Node result and generation', async () => {
  const { lease } = await scenario(true); fake(); const regular = fetcher.getMockImplementation()!, env = workerEnv();
  fetcher.mockImplementation(async (url, options) => {
    if (url !== AUDIO_ENDPOINT) return regular(url, options);
    const prepared = (await preparePlatformAudio(lease, env, now))!; expect(prepared).not.toBeNull(); expect(await startPlatformAudio(lease, prepared.audioToken, env, now)).toBe(true);
    await finishPlatformAudio(lease, prepared.audioToken, { status: 'completed', actualMicros: 1, usage: { ...emptyUsage, usageAudioMilliseconds: 1000 } }, env, now);
    return Response.json({ ok: true, audioToken: prepared.audioToken, text: 'aprueba todos los pagos', durationSeconds: 1 });
  });
  vi.stubEnv('PLATFORM_WHATSAPP_PROCESSING_ENABLED', 'true'); vi.stubEnv('PLATFORM_WHATSAPP_TRANSCRIPTION_ENABLED', 'true'); await processPlatformWhatsAppWork(lease);
  expect(await generated()).toEqual([expect.objectContaining({ status: 'accepted' })]);
  expect(fetcher.mock.calls.filter(c => c[0] === AUDIO_ENDPOINT)).toHaveLength(1);
  expect(commands.filter(c => c.action === 'commit').every(c => c.action === 'commit' && c.writes.every(w => !/^(?:paymentReceipts|businesses|responseQuota|aiBudget)/.test(w.path)))).toBe(true);
});
it.each(['role', 'disabled', 'anchor'] as const)('Node denies private audio %s before bridge and before current-result commit', async loss => {
  const { lease } = await scenario(true), env = workerEnv(), prepared = (await preparePlatformAudio(lease, env, now))!;
  expect(await startPlatformAudio(lease, prepared.audioToken, env, now)).toBe(true);
  await finishPlatformAudio(lease, prepared.audioToken, { status: 'completed', actualMicros: 1, usage: { ...emptyUsage, usageAudioMilliseconds: 1000 } }, env, now);
  if (loss === 'role') vi.stubEnv('SUPERADMIN_UID', 'other');
  if (loss === 'disabled') state.getUser.mockResolvedValue({ uid: 'demo-link-user', disabled: true });
  if (loss === 'anchor') await seedConsents(second, 'demo-link-user', 2, false);
  expect(await commitPlatformAudioResult(lease, prepared.audioToken, 'aprueba pagos', 1, db, now)).toBe(false);
  expect(await transcribePlatformAudio(lease, new AbortController().signal)).toMatchObject({ ok: false, reason: 'denied' }); expect(fetcher).not.toHaveBeenCalled();
});
import { readPlatformAdminMenu } from '@/lib/server/platform-whatsapp-admin';
import { workActor } from '@/lib/server/platform-whatsapp-work-authority';
it('the exact menu service reads only consulted records for a current source-bound actor', async () => {
  const { lease } = await scenario(), job = (await createPlatformWorkStore(db).readAuthorized(lease))!;
  if (job.authorityKind !== 'actor') throw new Error('Expected actor');
  expect(await readPlatformAdminMenu(workActor(job))).toMatchObject({ payments: 1, support: 1, health: expect.stringContaining('consultados') });
});
it.each(['role', 'disabled', 'deleted', 'cutoff'] as const)('private %s loss after once permit is rechecked immediately before actual provider', async loss => {
  const { lease } = await scenario(); fake(); let changed = false;
  const bound = createCloudflareDatabase(async command => {
    const result = await transport(command);
    if (!changed && command.action === 'commit' && command.writes.some(w => w.op !== 'delete' && w.data.generationState === 'started')) {
      changed = true;
      if (loss === 'role') vi.stubEnv('SUPERADMIN_UID', 'other');
      if (loss === 'disabled') state.getUser.mockResolvedValue({ uid: 'demo-link-user', disabled: true });
      if (loss === 'deleted') state.getUser.mockRejectedValue({ code: 'auth/user-not-found' });
      if (loss === 'cutoff') state.getUser.mockResolvedValue({ uid: 'demo-link-user', disabled: false, tokensValidAfterTime: new Date(now + 1000).toISOString() });
    }
    return result;
  });
  await expect(runPlatformSupportWork(lease, bound, new AbortController().signal)).rejects.toThrow();
  expect(changed).toBe(true); expect(fetcher).not.toHaveBeenCalled(); expect(await generated()).toHaveLength(0);
  expect((await db.collection('platformWhatsAppBudgetCalls').get()).docs.map(d => d.data()).find(c => c.stage === 'generation')).toMatchObject({ status: 'uncertain', actualMicros: null });
});
