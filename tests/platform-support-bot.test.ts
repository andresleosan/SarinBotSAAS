import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const auth = vi.hoisted(() => ({ getUser: vi.fn() }));
vi.mock('@/lib/firebase/admin', () => ({ getAdminDb: () => { throw new Error('Default backend forbidden'); }, getAdminAuth: () => auth }));
import { buildSupportScenario } from './platform-support-fixtures';
import { now } from './platform-whatsapp-test-fixtures';
import { runPlatformSupportWork, answerPlatformSupport, consumePlatformGenerationCapability } from '@/lib/server/platform-support-bot';
import { completeChat } from '@/lib/sarin/engine';
import { quotePlatformGeneration, reservePlatformGeneration } from '@/lib/server/platform-whatsapp-budget';
import { takePlatformGenerationPermit } from '@/lib/server/platform-whatsapp-work-store';
import { PLATFORM_SCOPE_REFUSAL, validatePlatformSupportOutput } from '@/lib/server/platform-support-knowledge';
import { isBudgetCall, isPlatformOutbox } from '../shared/platform-whatsapp-work';
import { workActor } from '@/lib/server/platform-whatsapp-work-authority';
import { parseGenerationPolicy } from '../shared/platform-whatsapp-policy';
const fetcher = vi.fn();
beforeEach(() => { vi.spyOn(Date, 'now').mockReturnValue(now); auth.getUser.mockReset().mockImplementation(async uid => ({ uid, disabled: false })); fetcher.mockReset(); vi.stubGlobal('fetch', fetcher); vi.stubEnv('DEEPSEEK_API_KEY', 'synthetic-key'); vi.stubEnv('PILOT_AI_BUDGET_ENFORCED', 'true'); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
const response = (text: string, changes = {}) => Response.json({ model: 'synthetic-wire-model-v1', choices: [{ message: { content: text } }], usage: { prompt_tokens: 11, prompt_cache_hit_tokens: 1, prompt_cache_miss_tokens: 10, completion_tokens: 3, total_tokens: 14 }, ...changes });
it('closes malformed mapping identifiers including trailing line terminators', () => {
  for (const value of [{ version: 'synthetic\n', responseModels: ['synthetic-model'] }, { version: 'synthetic', responseModels: ['synthetic-model\n'] }]) expect(parseGenerationPolicy(JSON.stringify(value))).toBeNull();
});
it('uses actual durable once permit/shared engine and settles exact public request without commercial accounting', async () => {
  const s = await buildSupportScenario(), { lease } = await s.question('lista los pagos');
  fetcher.mockResolvedValue(response(JSON.stringify({ reply: PLATFORM_SCOPE_REFUSAL, sourceIds: [] })));
  expect(await runPlatformSupportWork(lease, s.db, new AbortController().signal)).toEqual({ reply: PLATFORM_SCOPE_REFUSAL, sourceIds: [] });
  expect(fetcher).toHaveBeenCalledTimes(1);
  const body = fetcher.mock.calls[0][1].body, call = [...s.rows.values()].find(r => isBudgetCall(r) && r.stage === 'generation')!;
  expect(call).toMatchObject({ quote: quotePlatformGeneration(body), actualMicros: 8, usageInputTokens: 11, usageOutputTokens: 3, status: 'settled' });
  expect(JSON.parse(body)).toMatchObject({ model: 'deepseek-flash', max_tokens: 4096, thinking: { type: 'disabled' }, stream: false });
  const observations = [...s.rows.entries()].filter(([path]) => path.startsWith('aiUsageCalls/')); expect(observations).toHaveLength(1);
  expect(observations[0][0]).toBe('aiUsageCalls/' + call.effectToken);
  expect([...s.rows.keys()].some(k => /^(?:businesses|payments|aiBudget|adminCopilot)/.test(k))).toBe(false);
  const reads = s.seen.filter(c => c.action === 'read').map(c => JSON.stringify(c)); expect(reads.some(c => /"path":"(?:payments|businesses|receipts)/.test(c))).toBe(false);
  await expect(runPlatformSupportWork(lease, s.db, new AbortController().signal)).rejects.toThrow(); expect(fetcher).toHaveBeenCalledTimes(1);
  await expect(completeChat([{ role: 'user', content: 'commercial' }], undefined, { provider: 'deepseek' })).rejects.toMatchObject({ code: 'AI_BUDGET_UNAVAILABLE' });
});
it('checks exact request bytes, component ceilings and persisted quote mutation before start', async () => {
  const s = await buildSupportScenario(), { lease } = await s.question(), job = (await s.work.readAuthorized(lease))!;
  const quote = quotePlatformGeneration('a'); expect(quote).toMatchObject({ requestBytes: 1, inputUpper: 4097, outputCap: 4096, maximumMicros: 6146 });
  expect(quotePlatformGeneration('a'.repeat(128000)).inputUpper).toBe(132096); expect(() => quotePlatformGeneration('a'.repeat(128001))).toThrow();
  await reservePlatformGeneration(job, quote, s.db);
  await expect(takePlatformGenerationPermit(lease, s.db, now, quotePlatformGeneration('b'))).rejects.toThrow();
  expect(await takePlatformGenerationPermit(lease, s.db, now)).toBeNull(); expect(fetcher).not.toHaveBeenCalled();
});
it('isolates simultaneous asynchronous public contexts and their exact question bytes', async () => {
  const first = await buildSupportScenario(), a = await first.question('pregunta A'), second = await buildSupportScenario(), b = await second.question('pregunta B');
  fetcher.mockImplementation(async (_url, options) => {
    const question = JSON.parse(options.body).messages[1].content;
    await Promise.resolve(); return response(JSON.stringify({ reply: question, sourceIds: ['sarin.support.v1'] }));
  });
  const answers = await Promise.all([runPlatformSupportWork(a.lease, first.db, new AbortController().signal), runPlatformSupportWork(b.lease, second.db, new AbortController().signal)]);
  expect(answers.map(a => a.reply)).toEqual(['pregunta A', 'pregunta B']); expect(fetcher).toHaveBeenCalledTimes(2);
});
it('records generation overrun once and trips its circuit', async () => {
  const s = await buildSupportScenario(), { lease } = await s.question();
  fetcher.mockResolvedValue(response(JSON.stringify({ reply: 'Soporte público.', sourceIds: ['sarin.support.v1'] }), { usage: { prompt_tokens: 100000, prompt_cache_hit_tokens: 0, prompt_cache_miss_tokens: 100000, completion_tokens: 10000, total_tokens: 110000 } }));
  await runPlatformSupportWork(lease, s.db, new AbortController().signal);
  expect([...s.rows.values()].find(r => isBudgetCall(r) && r.stage === 'generation')).toMatchObject({ actualMicros: 42000, status: 'settled' });
  expect([...s.rows.values()].find(r => r.recordType === 'budget_circuit' && r.stage === 'generation')).toMatchObject({ status: 'blocked', reason: 'overrun' }); expect(fetcher).toHaveBeenCalledTimes(1);
});
it.each([{ model: undefined }, { model: 'unverified-wire' }, { usage: undefined }, { usage: { prompt_tokens: -1 } }])('retains full uncertainty and produces no generated answer for %j', async change => {
  const s = await buildSupportScenario(), { lease } = await s.question(); fetcher.mockResolvedValue(response(JSON.stringify({ reply: 'Soporte público.', sourceIds: ['sarin.support.v1'] }), change));
  await expect(runPlatformSupportWork(lease, s.db, new AbortController().signal)).rejects.toThrow();
  expect([...s.rows.values()].find(r => isBudgetCall(r) && r.stage === 'generation')).toMatchObject({ status: 'uncertain', actualMicros: null });
  expect([...s.rows.values()].filter(r => isPlatformOutbox(r) && r.outputKind === 'generated')).toHaveLength(0); expect(fetcher).toHaveBeenCalledTimes(1);
});
it('accounts known usage for forged output without repair inference', async () => {
  const s = await buildSupportScenario(), { lease } = await s.question(); fetcher.mockResolvedValue(response(JSON.stringify({ reply: 'Inventado', sourceIds: ['private.payments'] })));
  await expect(runPlatformSupportWork(lease, s.db, new AbortController().signal)).rejects.toThrow();
  expect([...s.rows.values()].find(r => isBudgetCall(r) && r.stage === 'generation')).toMatchObject({ status: 'settled', actualMicros: 8 }); expect(fetcher).toHaveBeenCalledTimes(1);
});
it('denies outside context, structural capability and default closed mapping before fetch', async () => {
  const s = await buildSupportScenario(), { lease } = await s.question(), job = (await s.work.readAuthorized(lease))!;
  if (job.authorityKind !== 'actor') throw new Error('Expected actor'); const signal = new AbortController().signal;
  await expect(answerPlatformSupport(workActor(job), 'forged', signal)).rejects.toMatchObject({ status: 409 });
  expect(() => consumePlatformGenerationCapability({}, 'forged', signal)).toThrow();
  vi.stubEnv('PLATFORM_WHATSAPP_GENERATION_POLICY', '');
  await expect(runPlatformSupportWork(lease, s.db, signal)).rejects.toThrow(); expect(fetcher).not.toHaveBeenCalled();
  expect([...s.rows.values()].filter(r => isBudgetCall(r) && r.stage === 'generation')).toHaveLength(0);
});
it('enforces strict output keys, source uniqueness, Unicode and public scope', () => {
  const sources = [{ id: 'sarin.support.v1' }];
  for (const value of [{ reply: '<script>x</script>', sourceIds: ['sarin.support.v1'] }, { reply: 'https://private.invalid', sourceIds: ['sarin.support.v1'] }, { reply: 'x'.repeat(1025), sourceIds: ['sarin.support.v1'] }, { reply: '\ud800', sourceIds: ['sarin.support.v1'] }, { reply: 'Contenido', sourceIds: [] }, { reply: 'Contenido', sourceIds: ['sarin.support.v1', 'sarin.support.v1'] }, { reply: 'Contenido', sourceIds: ['sarin.support.v1'], tool: 'pay' }]) expect(validatePlatformSupportOutput(JSON.stringify(value), sources)).toBeNull();
});
