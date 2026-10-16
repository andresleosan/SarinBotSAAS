import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { completeChat, getEngineConfiguration, probeEngine, type EngineMessage, type EngineUsageObservation, type ToolDefinition } from '@/lib/sarin/engine';

const endpoint = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent';
const tools: ToolDefinition[] = [{ type: 'function', function: { name: 'read_slots', description: 'Read synthetic slots', parameters: { type: 'object', properties: { day: { type: 'string' } }, required: ['day'], additionalProperties: false } } }];
const usage = { promptTokenCount: 1000, cachedContentTokenCount: 800, toolUsePromptTokenCount: 20, candidatesTokenCount: 100, thoughtsTokenCount: 50, totalTokenCount: 1170, serviceTier: 'standard' };
const reply = (parts: unknown[] = [{ text: 'Synthetic reply.' }], extra: Record<string, unknown> = {}) => ({ modelVersion: 'gemini-3.5-flash-lite', usageMetadata: usage, candidates: [{ content: { role: 'model', parts }, finishReason: 'STOP' }], ...extra });
const nativeCall = (id: string, signature?: string) => ({ functionCall: { id, name: 'read_slots', args: { day: '2026-11-01' } }, ...(signature ? { thoughtSignature: signature } : {}) });
const input: EngineMessage[] = [{ role: 'system', content: 'Synthetic system.' }, { role: 'user', content: 'Synthetic request.' }];

beforeEach(() => {
  vi.stubEnv('SARIN_CHAT_PROVIDER', 'gemini');
  vi.stubEnv('GEMINI_API_KEY', 'AQ-synthetic-google-key');
  vi.stubEnv('GEMINI_BILLING_VERIFIED', 'true');
  vi.stubEnv('GEMINI_MODEL', 'gemini-3.5-flash-lite');
  vi.stubEnv('DEEPSEEK_API_KEY', 'synthetic-deepseek-key');
  vi.stubEnv('DEEPSEEK_MODEL', 'deepseek-flash');
  vi.stubEnv('SARIN_TUNNEL_URL', 'https://ia-sarin.alsdevstudio.com/v1/chat/completions');
  vi.stubEnv('OLLAMA_MAIN_MODEL', 'synthetic-local');
  vi.stubEnv('CF_ACCESS_CLIENT_ID', 'synthetic-cf-id');
  vi.stubEnv('CF_ACCESS_CLIENT_SECRET', 'synthetic-cf-secret');
  vi.stubEnv('LLM_REQUEST_TIMEOUT_MS', '120000');
  vi.stubGlobal('fetch', vi.fn(async () => Response.json(reply())));
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('manual paid Gemini native transport', () => {
  it.each([
    ['GEMINI_API_KEY', ''], ['GEMINI_API_KEY', 'key with spaces'], ['GEMINI_API_KEY', 'key\nheader'],
    ['GEMINI_BILLING_VERIFIED', ''], ['GEMINI_BILLING_VERIFIED', 'false'], ['GEMINI_BILLING_VERIFIED', 'TRUE'], ['GEMINI_MODEL', 'unapproved-model'],
  ])('blocks invalid server configuration %s=%j before sending data', async (key, value) => {
    vi.stubEnv(key, value);
    const onUsage = vi.fn();
    expect(getEngineConfiguration('gemini').configured).toBe(false);
    await expect(completeChat(input, tools, { onUsage })).rejects.toMatchObject({ status: 503 });
    expect(fetch).not.toHaveBeenCalled(); expect(onUsage).not.toHaveBeenCalled();
  });

  it('uses a fixed native endpoint with isolated credentials, bounded minimal thinking and JSON-schema tools', async () => {
    expect(await completeChat(input, tools)).toEqual({ role: 'assistant', content: 'Synthetic reply.' });
    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe(endpoint);
    expect(init).toMatchObject({ method: 'POST', cache: 'no-store', redirect: 'error', headers: { 'x-goog-api-key': 'AQ-synthetic-google-key' } });
    expect(init?.headers).not.toHaveProperty('Authorization');
    expect(JSON.stringify(init?.headers)).not.toMatch(/CF-Access|deepseek/);
    expect(JSON.parse(String(init?.body))).toEqual({
      systemInstruction: { parts: [{ text: 'Synthetic system.' }] }, contents: [{ role: 'user', parts: [{ text: 'Synthetic request.' }] }],
      serviceTier: 'standard', generationConfig: { maxOutputTokens: 4096, thinkingConfig: { thinkingLevel: 'MINIMAL' } },
      tools: [{ functionDeclarations: [{ name: 'read_slots', description: 'Read synthetic slots', parametersJsonSchema: tools[0].function.parameters }] }], toolConfig: { functionCallingConfig: { mode: 'AUTO' } },
    });
  });

  it('preserves native signatures, call IDs, order and parallel responses across two tool rounds without exposing thought metadata', async () => {
    const first = [{ text: 'Private synthetic reasoning.', thought: true, thoughtSignature: 'text-signature==' }, nativeCall('call-a', '  opaque-signature==  '), nativeCall('call-b')];
    const second = [nativeCall('call-c', 'second-signature==')];
    vi.mocked(fetch).mockResolvedValueOnce(Response.json(reply(first))).mockResolvedValueOnce(Response.json(reply(second))).mockResolvedValueOnce(Response.json(reply()));
    const messages = [...input];
    const a = await completeChat(messages, tools); messages.push(a);
    expect(a.content).toBeNull();
    expect(a.tool_calls?.map(call => call.id)).toEqual(['call-a', 'call-b']);
    expect(JSON.stringify(a)).not.toMatch(/signature|reasoning/);
    messages.push(...a.tool_calls!.map(call => ({ role: 'tool' as const, tool_call_id: call.id, content: '{"available":true}' })));
    const b = await completeChat(messages, tools); messages.push(b, { role: 'tool', tool_call_id: 'call-c', content: '{"available":false}' });
    await completeChat(messages, tools);
    const body = JSON.parse(String(vi.mocked(fetch).mock.calls[2][1]?.body));
    expect(body.contents).toEqual([
      { role: 'user', parts: [{ text: 'Synthetic request.' }] }, { role: 'model', parts: first },
      { role: 'user', parts: ['call-a', 'call-b'].map(id => ({ functionResponse: { id, name: 'read_slots', response: { available: true } } })) },
      { role: 'model', parts: second }, { role: 'user', parts: [{ functionResponse: { id: 'call-c', name: 'read_slots', response: { available: false } } }] },
    ]);
  });

  it('strips unknown native metadata while preserving literal signature bytes', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(Response.json(reply([{ ...nativeCall('call-a', 'signature=='), unknownPrivate: 'must-strip' }])));
    const assistant = await completeChat(input, tools);
    await completeChat([...input, assistant, { role: 'tool', tool_call_id: 'call-a', content: '{}' }], tools);
    expect(String(vi.mocked(fetch).mock.calls[1][1]?.body)).not.toContain('must-strip');
    expect(String(vi.mocked(fetch).mock.calls[1][1]?.body)).toContain('signature==');
  });

  it.each([
    [{ functionCall: { name: 'read_slots', args: {} }, thoughtSignature: 'sig' }],
    [nativeCall('call-a')], [nativeCall('same', 'sig'), nativeCall('same')],
    [{ ...nativeCall('call-a', 'sig'), thoughtSignature: { invalid: true } }],
    [{ functionCall: { id: 'call-a', name: 'read_slots', args: 'invalid' }, thoughtSignature: 'sig' }],
  ])('rejects malformed native tool history before tools can execute: %j', async (...parts) => {
    vi.mocked(fetch).mockResolvedValueOnce(Response.json(reply(parts)));
    await expect(completeChat(input, tools)).rejects.toMatchObject({ status: 502 });
  });

  it('rejects cloned signature-less assistant history and missing or duplicate tool results before another request', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(Response.json(reply([nativeCall('call-a', 'sig'), nativeCall('call-b')])));
    const assistant = await completeChat(input, tools);
    const a: EngineMessage = { role: 'tool', tool_call_id: 'call-a', content: '{}' };
    const b: EngineMessage = { role: 'tool', tool_call_id: 'call-b', content: '{}' };
    for (const history of [[structuredClone(assistant), a, b], [assistant, a], [assistant, a, a], [assistant, { ...a, tool_call_id: 'unknown' }, b]]) {
      await expect(completeChat([...input, ...history], tools)).rejects.toMatchObject({ status: 502 });
    }
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('never forwards private Google metadata when a caller overrides the provider', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(Response.json(reply([nativeCall('call-a', 'private-google-signature')]))).mockResolvedValueOnce(Response.json({ choices: [{ message: { content: 'Synthetic DeepSeek reply.' } }] }));
    const assistant = await completeChat(input, tools);
    await completeChat([...input, assistant, { role: 'tool', tool_call_id: 'call-a', content: '{}' }], tools, { provider: 'deepseek' });
    expect(String(vi.mocked(fetch).mock.calls[1][1]?.body)).not.toMatch(/thought|signature|functionCall/);
  });

  it('normalizes cache, tool-input and thought tokens exactly once using reported model and service tier', async () => {
    const onUsage = vi.fn(); await completeChat(input, tools, { onUsage });
    expect(onUsage).toHaveBeenCalledTimes(1);
    expect(onUsage.mock.calls[0][0]).toMatchObject({ provider: 'gemini', model: 'gemini-3.5-flash-lite', serviceTier: 'standard', success: true,
      usage: { promptTokens: 1020, cacheHitTokens: 800, cacheMissTokens: 220, completionTokens: 150, thinkingTokens: 50, totalTokens: 1170 } });
  });

  it('records valid usage even when the assistant response fails validation', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(Response.json(reply([], { candidates: [] })));
    const onUsage = vi.fn();
    await expect(completeChat(input, tools, { onUsage })).rejects.toMatchObject({ status: 502 });
    expect(onUsage.mock.calls[0][0]).toMatchObject({ success: false, usage: { completionTokens: 150 } });
  });

  it('never assigns the requested model or tier when the response omits them', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(Response.json(reply(undefined, { modelVersion: undefined, usageMetadata: { ...usage, serviceTier: undefined } })));
    const onUsage = vi.fn(); await completeChat(input, undefined, { onUsage });
    expect(onUsage.mock.calls[0][0]).toMatchObject({ model: null, serviceTier: null, usage: { totalTokens: 1170 } });
  });

  it.each([
    undefined, { ...usage, totalTokenCount: 1100 }, { ...usage, thoughtsTokenCount: -1 }, { ...usage, cachedContentTokenCount: 1001 }, { ...usage, promptTokenCount: 1.5 },
  ])('marks missing or inconsistent usage unknown without losing a valid reply', async metadata => {
    vi.mocked(fetch).mockResolvedValueOnce(Response.json(reply(undefined, { usageMetadata: metadata })));
    const observations: EngineUsageObservation[] = [];
    expect((await completeChat(input, undefined, { onUsage: event => { observations.push(event); } })).content).toBe('Synthetic reply.');
    expect(observations[0].usage).toBeNull();
  });

  it('accepts omitted protobuf zero counters only when the reported total reconciles', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(Response.json(reply(undefined, { usageMetadata: { promptTokenCount: 20, candidatesTokenCount: 5, totalTokenCount: 25, serviceTier: 'standard' } })));
    const onUsage = vi.fn(); await completeChat(input, undefined, { onUsage });
    expect(onUsage.mock.calls[0][0].usage).toEqual({ promptTokens: 20, cacheHitTokens: 0, cacheMissTokens: 20, completionTokens: 5, thinkingTokens: 0, totalTokens: 25 });
  });

  it.each([
    [401, /credencial/], [403, /credencial/], [402, /no tiene saldo disponible/],
    [429, /límite de solicitudes o cuota/], [503, /no puede conectar/],
  ] as const)('sanitizes HTTP %i and records one failed call without retry or fallback', async (status, message) => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response('synthetic-secret-from-upstream', { status }));
    const onUsage = vi.fn();
    await expect(completeChat(input, undefined, { onUsage })).rejects.toMatchObject({ status: 503, message: expect.stringMatching(message) });
    expect(fetch).toHaveBeenCalledTimes(1); expect(onUsage).toHaveBeenCalledTimes(1);
    expect(onUsage.mock.calls[0][0]).toMatchObject({ provider: 'gemini', success: false, model: null, usage: null });
    expect(JSON.stringify(onUsage.mock.calls)).not.toContain('synthetic-secret');
  });

  it('contains timeout errors and preserves caller cancellation without retry', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new DOMException('synthetic-private-timeout', 'TimeoutError'));
    await expect(completeChat(input)).rejects.toMatchObject({ status: 503, message: expect.stringMatching(/Gemini/) });
    const controller = new AbortController(); controller.abort();
    vi.mocked(fetch).mockRejectedValueOnce(new Error('synthetic-abort'));
    await expect(completeChat(input, undefined, { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('blocks cloud images and keeps an explicitly selected local model local', async () => {
    await expect(completeChat(input, undefined, { vision: true })).rejects.toMatchObject({ status: 503 });
    await expect(completeChat([{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,synthetic' } }] }])).rejects.toMatchObject({ status: 503 });
    expect(fetch).not.toHaveBeenCalled();
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ choices: [{ message: { content: 'Synthetic local reply.' } }] }));
    await completeChat(input, undefined, { provider: 'ollama' });
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe('https://ia-sarin.alsdevstudio.com/v1/chat/completions');
  });

  it('checks the exact model via a catalogue GET with no inference or vision', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ name: 'models/gemini-3.5-flash-lite', supportedGenerationMethods: ['generateContent'] }));
    expect(await probeEngine()).toMatchObject({ provider: 'gemini', online: true, visionAvailable: false });
    expect(vi.mocked(fetch).mock.calls[0]).toEqual([endpoint.replace(':generateContent', ''), expect.objectContaining({ method: 'GET', redirect: 'error', headers: expect.objectContaining({ 'x-goog-api-key': 'AQ-synthetic-google-key' }) })]);
    vi.stubEnv('GEMINI_BILLING_VERIFIED', 'false');
    expect(await probeEngine()).toMatchObject({ provider: 'gemini', online: false, error: expect.stringMatching(/pago/i) });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
