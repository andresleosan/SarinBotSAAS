import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { completeChat, getChatProvider, getEngineConfiguration, probeEngine, type EngineMessage, type EngineUsageObservation } from '@/lib/sarin/engine';

const messages: EngineMessage[] = [{ role: 'user', content: 'Consulta sintética sin datos personales.' }];
const tool = { type: 'function' as const, function: { name: 'consultar_disponibilidad', description: 'Consulta horarios.', parameters: { type: 'object', properties: { dateKey: { type: 'string' } }, required: ['dateKey'] } } };
const toolCall = { id: 'call_synthetic', type: 'function' as const, function: { name: 'consultar_disponibilidad', arguments: '{"dateKey":"2030-01-07"}' } };
const usage = { prompt_tokens: 1000, prompt_tokens_details: { cached_tokens: 600, cache_write_tokens: 300 }, completion_tokens: 100, total_tokens: 1100 };
const reply = (extra: Record<string, unknown> = {}) => Response.json({ model: 'gpt-6-luna', service_tier: 'default', usage, choices: [{ message: { content: 'Respuesta sintética.' } }], ...extra });

beforeEach(() => {
  vi.stubEnv('SARIN_CHAT_PROVIDER', 'openai');
  vi.stubEnv('OPENAI_API_KEY', 'synthetic-openai-key');
  vi.stubEnv('OPENAI_MODEL', undefined);
  vi.stubEnv('DEEPSEEK_API_KEY', 'synthetic-deepseek-key');
  vi.stubEnv('SARIN_TUNNEL_URL', 'https://ia-sarin.alsdevstudio.com/v1/chat/completions');
  vi.stubEnv('CF_ACCESS_CLIENT_ID', 'synthetic-cf-id');
  vi.stubEnv('CF_ACCESS_CLIENT_SECRET', 'synthetic-cf-secret');
  vi.stubEnv('OLLAMA_MAIN_MODEL', 'qwen3:32b');
  vi.stubEnv('OLLAMA_VISION_MODEL', 'qwen3-vl:8b');
  vi.stubEnv('LLM_REQUEST_TIMEOUT_MS', '120000');
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Unexpected network boundary')));
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('explicit OpenAI transport', () => {
  it('supports two tool rounds using only OpenAI credentials and the supported non-reasoning payload', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(reply({ choices: [{ message: { content: null, tool_calls: [toolCall] } }] })).mockResolvedValueOnce(reply());
    vi.stubGlobal('fetch', fetcher);
    const first = await completeChat(messages, [tool]);
    expect(first).toEqual({ role: 'assistant', content: null, tool_calls: [toolCall] });
    const continued: EngineMessage[] = [...messages, first, { role: 'tool', tool_call_id: toolCall.id, content: '{"available":true}' }];
    expect(await completeChat(continued, [tool])).toEqual({ role: 'assistant', content: 'Respuesta sintética.' });
    expect(fetcher).toHaveBeenCalledTimes(2);
    for (const [url, init] of fetcher.mock.calls as [string, RequestInit][]) {
      expect(url).toBe('https://api.openai.com/v1/chat/completions');
      expect(init).toMatchObject({ method: 'POST', cache: 'no-store', redirect: 'error' });
      expect(Object.fromEntries(new Headers(init.headers))).toEqual({ accept: 'application/json', authorization: 'Bearer synthetic-openai-key', 'content-type': 'application/json' });
      expect(JSON.parse(String(init.body))).toEqual({ model: 'gpt-6-luna', messages: init === fetcher.mock.calls[0][1] ? messages : continued, stream: false, max_completion_tokens: 4096, reasoning_effort: 'none', store: false, service_tier: 'default', tools: [tool], tool_choice: 'auto' });
    }
  });

  it('defaults to Ollama and allows an explicit local vision request while OpenAI is selected', async () => {
    vi.stubEnv('SARIN_CHAT_PROVIDER', undefined);
    expect(getChatProvider()).toBe('ollama');
    vi.stubEnv('SARIN_CHAT_PROVIDER', 'openai');
    const fetcher = vi.fn().mockResolvedValue(reply()); vi.stubGlobal('fetch', fetcher);
    await completeChat(messages, undefined, { provider: 'ollama', vision: true });
    const [url, init] = fetcher.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://ia-sarin.alsdevstudio.com/v1/chat/completions');
    expect(new Headers(init.headers).has('authorization')).toBe(false);
    expect(JSON.parse(String(init.body))).toMatchObject({ model: 'qwen3-vl:8b', think: false });
  });

  it.each([
    ['missing key', 'OPENAI_API_KEY', undefined], ['whitespace key', 'OPENAI_API_KEY', 'key value'],
    ['control character', 'OPENAI_API_KEY', 'key\r\nInjected'], ['unsupported model', 'OPENAI_MODEL', 'gpt-6-nano'],
  ])('rejects %s before sending data or observing usage', async (_name, variable, value) => {
    vi.stubEnv(variable, value);
    const onUsage = vi.fn(); const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    await expect(completeChat(messages, undefined, { onUsage })).rejects.toMatchObject({ status: 503, message: expect.stringMatching(/OpenAI/) });
    expect(fetcher).not.toHaveBeenCalled(); expect(onUsage).not.toHaveBeenCalled();
    expect(JSON.stringify(getEngineConfiguration('openai'))).not.toMatch(/synthetic-|Injected/);
  });

  it('rejects both explicit vision and embedded images before sending them to OpenAI', async () => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    await expect(completeChat(messages, undefined, { vision: true })).rejects.toMatchObject({ status: 503, message: expect.stringMatching(/local/) });
    await expect(completeChat([{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,c3ludGhldGlj' } }] }])).rejects.toMatchObject({ status: 503 });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([401, 403, 429, 500])('contains HTTP %s errors without exposing upstream text or retrying', async status => {
    const fetcher = vi.fn().mockResolvedValue(new Response('synthetic-private-upstream', { status })); vi.stubGlobal('fetch', fetcher);
    const observations: EngineUsageObservation[] = [];
    const error = await completeChat(messages, undefined, { onUsage: observation => { observations.push(observation); } }).catch(error => error);
    expect(error).toMatchObject({ status: 503, message: expect.stringMatching(/OpenAI/) });
    expect(error.message).not.toMatch(/synthetic|Mac|DeepSeek/);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(observations).toEqual([expect.objectContaining({ provider: 'openai', success: false, usage: null })]);
  });

  it('uses a bounded timeout and safely reports a transport timeout without fallback', async () => {
    vi.stubEnv('LLM_REQUEST_TIMEOUT_MS', '2300');
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    const fetcher = vi.fn().mockRejectedValue(new DOMException('synthetic-private-timeout', 'TimeoutError')); vi.stubGlobal('fetch', fetcher);
    await expect(completeChat(messages)).rejects.toMatchObject({ status: 503, message: expect.stringMatching(/OpenAI/) });
    expect(timeout).toHaveBeenCalledWith(2300); expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('probes the fixed model catalog using only OpenAI auth and never claims local vision', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ data: [{ id: 'gpt-6-luna' }, { id: 'qwen3-vl:8b' }] })); vi.stubGlobal('fetch', fetcher);
    expect(await probeEngine()).toMatchObject({ provider: 'openai', online: true, visionAvailable: false });
    const [url, init] = fetcher.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.openai.com/v1/models');
    expect(init).toMatchObject({ method: 'GET', cache: 'no-store', redirect: 'error' });
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer synthetic-openai-key');
    expect(JSON.stringify(init)).not.toMatch(/synthetic-cf|synthetic-deepseek/);
    expect(init.body).toBeUndefined();
  });

  it('reports a missing catalog model as offline without returning upstream details', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ data: [{ id: 'other' }] })));
    expect(await probeEngine()).toMatchObject({ provider: 'openai', online: false, error: expect.stringMatching(/OpenAI/) });
  });

  it('normalizes cache reads and writes once per call and keeps telemetry out of the assistant', async () => {
    const observations: EngineUsageObservation[] = [];
    vi.stubGlobal('fetch', vi.fn(async () => reply()));
    const result = await completeChat(messages, undefined, { onUsage: observation => { observations.push(observation); } });
    expect(result).toEqual({ role: 'assistant', content: 'Respuesta sintética.' });
    expect(observations).toEqual([{ callId: expect.any(String), provider: 'openai', model: 'gpt-6-luna', serviceTier: 'default', startedAt: expect.any(Number), finishedAt: expect.any(Number), success: true, usage: { promptTokens: 1000, cacheHitTokens: 600, cacheMissTokens: 400, cacheWriteTokens: 300, completionTokens: 100, totalTokens: 1100 } }]);
    expect(JSON.stringify(observations)).not.toMatch(/Consulta|Respuesta/);
  });

  it('retains absent cache-write and tier information as unknown rather than zero', async () => {
    const onUsage = vi.fn();
    vi.stubGlobal('fetch', vi.fn(async () => reply({ service_tier: undefined, usage: { ...usage, prompt_tokens_details: { cached_tokens: 600 } } })));
    await completeChat(messages, undefined, { onUsage });
    expect(onUsage).toHaveBeenCalledWith(expect.objectContaining({ serviceTier: null, usage: { promptTokens: 1000, cacheHitTokens: 600, cacheMissTokens: 400, cacheWriteTokens: null, completionTokens: 100, totalTokens: 1100 } }));
  });

  it('captures usage and actual model/tier before rejecting a malformed assistant', async () => {
    const onUsage = vi.fn();
    vi.stubGlobal('fetch', vi.fn(async () => reply({ model: 'unexpected-model', service_tier: 'priority', choices: [] })));
    await expect(completeChat(messages, undefined, { onUsage })).rejects.toMatchObject({ status: 502 });
    expect(onUsage).toHaveBeenCalledWith(expect.objectContaining({ model: 'unexpected-model', serviceTier: 'priority', success: false, usage: expect.objectContaining({ cacheWriteTokens: 300 }) }));
  });

  it('keeps an absent returned model and an unknown service tier unpriced instead of assuming the request configuration', async () => {
    const onUsage = vi.fn();
    vi.stubGlobal('fetch', vi.fn(async () => reply({ model: undefined, service_tier: 'synthetic-private-tier' })));
    expect((await completeChat(messages, undefined, { onUsage })).content).toBe('Respuesta sintética.');
    expect(onUsage).toHaveBeenCalledWith(expect.objectContaining({ model: null, serviceTier: null, success: true, usage: expect.objectContaining({ promptTokens: 1000 }) }));
    expect(JSON.stringify(onUsage.mock.calls)).not.toContain('synthetic-private-tier');
  });

  it.each([
    { ...usage, total_tokens: 1200 },
    { ...usage, prompt_tokens_details: { cached_tokens: 600, cache_write_tokens: 401 } },
    { ...usage, prompt_tokens_details: { cached_tokens: -1 } },
    { ...usage, prompt_tokens_details: { cached_tokens: 0.5 } },
    { ...usage, prompt_tokens_details: {} },
  ])('treats inconsistent or incomplete usage as unknown: %j', async invalidUsage => {
    const onUsage = vi.fn(); vi.stubGlobal('fetch', vi.fn(async () => reply({ usage: invalidUsage })));
    expect((await completeChat(messages, undefined, { onUsage })).content).toBe('Respuesta sintética.');
    expect(onUsage).toHaveBeenCalledWith(expect.objectContaining({ success: true, usage: null }));
  });

  it('contains telemetry failures without changing a valid assistant or repeating inference', async () => {
    const fetcher = vi.fn(async () => reply()); vi.stubGlobal('fetch', fetcher);
    expect((await completeChat(messages, undefined, { onUsage: async () => { throw new Error('synthetic storage failure'); } })).content).toBe('Respuesta sintética.');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
