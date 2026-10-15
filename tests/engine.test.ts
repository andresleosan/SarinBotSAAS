import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { completeChat, probeEngine, type EngineMessage } from '@/lib/sarin/engine';

beforeEach(() => {
  vi.stubEnv('SARIN_CHAT_PROVIDER', undefined);
  vi.stubEnv('DEEPSEEK_API_KEY', undefined);
  vi.stubEnv('DEEPSEEK_MODEL', undefined);
  vi.stubEnv('GEMINI_API_KEY', undefined);
  vi.stubEnv('GEMINI_MODEL', undefined);
  vi.stubEnv('LLM_REQUEST_TIMEOUT_MS', '120000');
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Unexpected network boundary')));
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const textTurn = [{ role: 'user' as const, content: 'Consulta sintética.' }];
const toolCall = { id: 'call_booking', type: 'function' as const, function: { name: 'consultar_disponibilidad', arguments: '{"dateKey":"2030-01-07"}' } };
const completionResponse = () => Response.json({
  id: 'synthetic-completion', object: 'chat.completion', created: 1893456000, model: 'deepseek-flash',
  choices: [{ index: 0, message: { role: 'assistant', content: null, tool_calls: [toolCall] }, finish_reason: 'tool_calls' }],
  usage: { prompt_tokens: 12, completion_tokens: 8, total_tokens: 20 },
});

const geminiResponse = (toolCalls?: unknown[]) => Response.json({
  id: 'synthetic-gemini-completion', object: 'chat.completion', created: 1893456000, model: 'gemini-3.5-flash-lite',
  choices: [{ index: 0, message: { role: 'assistant', content: toolCalls ? null : 'Consulta completada.', ...(toolCalls ? { tool_calls: toolCalls } : {}) }, finish_reason: toolCalls ? 'tool_calls' : 'stop' }],
  usage: { prompt_tokens: 12, completion_tokens: 8, total_tokens: 20 },
});

describe('explicit Gemini transport', () => {
  beforeEach(() => {
    vi.stubEnv('SARIN_CHAT_PROVIDER', 'gemini');
    vi.stubEnv('GEMINI_API_KEY', 'AQ.synthetic-google-key');
    vi.stubEnv('DEEPSEEK_API_KEY', 'synthetic-deepseek-key');
    vi.stubEnv('SARIN_TUNNEL_URL', 'https://private.example.com/v1/chat/completions');
    vi.stubEnv('CF_ACCESS_CLIENT_ID', 'synthetic-cf-id');
    vi.stubEnv('CF_ACCESS_CLIENT_SECRET', 'synthetic-cf-secret');
    vi.stubEnv('OLLAMA_MAIN_MODEL', 'qwen3:32b');
  });

  it('sends requests to the fixed Google endpoint with only its credential and supported generation settings', async () => {
    const fetcher = vi.fn().mockResolvedValue(geminiResponse());
    vi.stubGlobal('fetch', fetcher);
    expect(await completeChat(textTurn)).toEqual({ role: 'assistant', content: 'Consulta completada.' });
    const [url, init] = fetcher.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/openai/chat/completions');
    expect(init).toMatchObject({ method: 'POST', cache: 'no-store', redirect: 'error' });
    expect(Object.fromEntries(new Headers(init.headers))).toEqual({ accept: 'application/json', authorization: 'Bearer AQ.synthetic-google-key', 'content-type': 'application/json' });
    expect(JSON.parse(String(init.body))).toEqual({ model: 'gemini-3.5-flash-lite', messages: textTurn, stream: false, max_tokens: 4096, reasoning_effort: 'minimal' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['missing key', 'GEMINI_API_KEY', undefined],
    ['whitespace key', 'GEMINI_API_KEY', 'AQ. key'],
    ['control character key', 'GEMINI_API_KEY', 'AQ.key\r\nInjected: value'],
    ['non-ASCII key', 'GEMINI_API_KEY', 'AQ.clavé'],
    ['unsupported model', 'GEMINI_MODEL', 'gemini-other'],
  ])('rejects %s before sending data', async (_name, key, value) => {
    vi.stubEnv(key, value);
    const fetcher = vi.fn().mockResolvedValue(geminiResponse());
    vi.stubGlobal('fetch', fetcher);
    await expect(completeChat(textTurn)).rejects.toMatchObject({ status: 503, message: expect.stringMatching(/Gemini/) });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('preserves opaque signatures through two tool rounds including unsigned parallel calls', async () => {
    const first = { ...toolCall, extra_content: { google: { thought_signature: '  opaque-A+/=\n' } } };
    const parallel = { ...toolCall, id: 'parallel-call' };
    const second = { ...toolCall, id: 'second-round', extra_content: { google: { thought_signature: 'opaque-B+/=' } } };
    const fetcher = vi.fn().mockResolvedValueOnce(geminiResponse([first, parallel])).mockResolvedValueOnce(geminiResponse([second])).mockResolvedValueOnce(geminiResponse());
    vi.stubGlobal('fetch', fetcher);
    const tools = [{ type: 'function' as const, function: { name: 'consultar_disponibilidad', description: 'Consulta.', parameters: { type: 'object', properties: {} } } }];
    const messages: EngineMessage[] = [...textTurn];
    const answerOne = await completeChat(messages, tools);
    expect(answerOne.tool_calls).toEqual([first, parallel]);
    messages.push(answerOne, { role: 'tool', tool_call_id: first.id, content: '{}' }, { role: 'tool', tool_call_id: parallel.id, content: '{}' });
    const answerTwo = await completeChat(messages, tools);
    expect(answerTwo.tool_calls).toEqual([second]);
    messages.push(answerTwo, { role: 'tool', tool_call_id: second.id, content: '{}' });
    await completeChat(messages, tools);
    const roundTwo = JSON.parse(String(fetcher.mock.calls[1][1].body));
    const roundThree = JSON.parse(String(fetcher.mock.calls[2][1].body));
    expect(roundTwo.messages[1].tool_calls).toEqual([first, parallel]);
    expect(roundThree.messages[1].tool_calls).toEqual([first, parallel]);
    expect(roundThree.messages[4].tool_calls).toEqual([second]);
    expect(roundThree).toMatchObject({ tools, tool_choice: 'auto' });
  });

  it('retains only the documented Google metadata fields', async () => {
    const signed = { ...toolCall, extra_content: { unknown: 'discard', google: { thought_signature: 'opaque', unknown: 'discard' } } };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(geminiResponse([signed])));
    expect((await completeChat(textTurn)).tool_calls).toEqual([{ ...toolCall, extra_content: { google: { thought_signature: 'opaque' } } }]);
  });

  it.each([
    ['signature number', { google: { thought_signature: 12 } }],
    ['signature object', { google: { thought_signature: { secret: true } } }],
    ['oversized signature', { google: { thought_signature: 'a'.repeat(128_001) } }],
    ['invalid Google metadata', { google: 'invalid' }],
  ])('rejects %s without retrying', async (_name, metadata) => {
    const fetcher = vi.fn().mockResolvedValue(geminiResponse([{ ...toolCall, extra_content: metadata }]));
    vi.stubGlobal('fetch', fetcher);
    await expect(completeChat(textTurn)).rejects.toMatchObject({ status: 502 });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each(['ollama', 'deepseek'] as const)('removes Google metadata before sending a history to %s without mutating it', async provider => {
    const signed = { ...toolCall, extra_content: { google: { thought_signature: 'opaque-do-not-export' } } };
    const messages: EngineMessage[] = [...textTurn, { role: 'assistant', content: null, tool_calls: [signed] }, { role: 'tool', tool_call_id: signed.id, content: '{}' }];
    const fetcher = vi.fn().mockResolvedValue(completionResponse());
    vi.stubGlobal('fetch', fetcher);
    await completeChat(messages, undefined, { provider });
    const init = fetcher.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(String(init.body)).messages[1].tool_calls).toEqual([toolCall]);
    expect(String(init.body)).not.toContain('opaque-do-not-export');
    expect(messages[1].tool_calls?.[0].extra_content).toEqual({ google: { thought_signature: 'opaque-do-not-export' } });
    expect(new Headers(init.headers).get('authorization')).toBe(provider === 'deepseek' ? 'Bearer synthetic-deepseek-key' : null);
  });

  it.each([false, true])('rejects cloud image processing before fetch with vision=%s', async vision => {
    const fetcher = vi.fn().mockResolvedValue(geminiResponse());
    vi.stubGlobal('fetch', fetcher);
    await expect(completeChat(vision ? textTurn : [{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,c3ludGhldGlj' } }] }], undefined, { vision })).rejects.toMatchObject({ status: 503, message: expect.stringMatching(/local/) });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each(['generativelanguage.googleapis.com', 'nested.generativelanguage.googleapis.com', 'generativelanguage.googleapis.com.'])('refuses %s as a local tunnel', async hostname => {
    vi.stubEnv('SARIN_TUNNEL_URL', `https://${hostname}/v1/chat/completions`);
    const fetcher = vi.fn().mockResolvedValue(geminiResponse());
    vi.stubGlobal('fetch', fetcher);
    await expect(completeChat(textTurn, undefined, { provider: 'ollama' })).rejects.toMatchObject({ status: 503 });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('probes the Google catalog with isolated credentials', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ object: 'list', data: [{ id: 'gemini-3.5-flash-lite', object: 'model', owned_by: 'google' }] }));
    vi.stubGlobal('fetch', fetcher);
    expect(await probeEngine()).toMatchObject({ provider: 'gemini', online: true, visionAvailable: false });
    const [url, init] = fetcher.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/openai/models');
    expect(init).toMatchObject({ method: 'GET', cache: 'no-store', redirect: 'error' });
    expect(Object.fromEntries(new Headers(init.headers))).toEqual({ accept: 'application/json', authorization: 'Bearer AQ.synthetic-google-key', 'content-type': 'application/json' });
  });

  it('recognizes a Gemini catalog ID with the models/ resource prefix', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ object: 'list', data: [{ id: 'models/gemini-3.5-flash-lite', object: 'model', owned_by: 'google' }] })));
    expect(await probeEngine()).toMatchObject({ provider: 'gemini', online: true, visionAvailable: false });
  });

  it.each(['ollama', 'deepseek'] as const)('preserves exact catalog matching for %s', async provider => {
    const id = provider === 'ollama' ? 'models/qwen3:32b' : 'models/deepseek-flash';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ data: [{ id }] })));
    expect(await probeEngine(provider)).toMatchObject({ provider, online: false });
  });

  it('reports exhausted Gemini quota without retrying or exposing upstream details', async () => {
    const fetcher = vi.fn().mockImplementation(async () => new Response('synthetic-private-quota-details', { status: 429 }));
    vi.stubGlobal('fetch', fetcher);
    const failure = await completeChat(textTurn).catch(error => error);
    expect(failure).toMatchObject({ status: 503, message: expect.stringMatching(/Gemini.*cuota/i) });
    expect(failure.message).not.toContain('synthetic-private');
    expect(await probeEngine()).toMatchObject({ provider: 'gemini', online: false, visionAvailable: false, error: expect.stringMatching(/Gemini.*cuota/i) });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
describe('local inference transport', () => {
  it('uses server CF credentials, rejects redirects, routes vision and disables caching', async () => {
    vi.stubEnv('SARIN_TUNNEL_URL','https://private.example.com/v1/chat/completions');
    vi.stubEnv('CF_ACCESS_CLIENT_ID','server-id'); vi.stubEnv('CF_ACCESS_CLIENT_SECRET','server-secret');
    vi.stubEnv('OLLAMA_MAIN_MODEL','qwen3:32b'); vi.stubEnv('OLLAMA_VISION_MODEL','qwen3-vl:8b');
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices:[{message:{role:'assistant',content:'Local answer'}}] }),{headers:{'content-type':'application/json'}}));
    vi.stubGlobal('fetch',fetcher);
    expect(await completeChat([{role:'user',content:'x'}],undefined,{vision:true})).toMatchObject({content:'Local answer'});
    const [url, init] = fetcher.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://private.example.com/v1/chat/completions'); expect(init.redirect).toBe('error'); expect(init.cache).toBe('no-store');
    expect(init.headers).toMatchObject({'CF-Access-Client-Id':'server-id','CF-Access-Client-Secret':'server-secret'});
    expect(JSON.parse(String(init.body)).model).toBe('qwen3-vl:8b');
  });
  it('fails closed without CF credentials for a remote tunnel or with cloud models', async () => {
    vi.stubEnv('SARIN_TUNNEL_URL','https://private.example.com/v1/chat/completions');
    vi.stubEnv('CF_ACCESS_CLIENT_ID',''); vi.stubEnv('CF_ACCESS_CLIENT_SECRET','');
    await expect(completeChat([{role:'user',content:'private'}])).rejects.toMatchObject({status:503});
    vi.stubEnv('SARIN_TUNNEL_URL','http://127.0.0.1:11434/v1/chat/completions'); vi.stubEnv('OLLAMA_MAIN_MODEL','qwen3:cloud');
    await expect(completeChat([{role:'user',content:'private'}])).rejects.toMatchObject({status:503});
  });
  it('probes the real models endpoint and reports stopped engine as offline', async () => {
    vi.stubEnv('SARIN_TUNNEL_URL','http://127.0.0.1:11434/v1/chat/completions');
    vi.stubEnv('OLLAMA_MAIN_MODEL','qwen3:32b');
    const fetcher=vi.fn().mockRejectedValue(new TypeError('connection refused')); vi.stubGlobal('fetch',fetcher);
    expect((await probeEngine()).online).toBe(false);
    expect(fetcher.mock.calls[0][0]).toBe('http://127.0.0.1:11434/v1/models');
  });
});

describe('explicit DeepSeek transport', () => {
  beforeEach(() => {
    vi.stubEnv('SARIN_CHAT_PROVIDER', 'deepseek');
    vi.stubEnv('DEEPSEEK_API_KEY', 'synthetic-deepseek-key');
    vi.stubEnv('SARIN_TUNNEL_URL', 'https://private.example.com/v1/chat/completions');
    vi.stubEnv('CF_ACCESS_CLIENT_ID', 'synthetic-cf-id');
    vi.stubEnv('CF_ACCESS_CLIENT_SECRET', 'synthetic-cf-secret');
    vi.stubEnv('OLLAMA_MAIN_MODEL', 'qwen3:32b');
    vi.stubEnv('OLLAMA_VISION_MODEL', 'qwen3-vl:8b');
  });

  it('sends tool requests only to DeepSeek with its own credential and thinking disabled', async () => {
    const fetcher = vi.fn().mockResolvedValue(completionResponse());
    vi.stubGlobal('fetch', fetcher);
    const tools = [{ type: 'function' as const, function: { name: 'consultar_disponibilidad', description: 'Consulta horarios.', parameters: { type: 'object', properties: { dateKey: { type: 'string' } }, required: ['dateKey'] } } }];
    expect(await completeChat(textTurn, tools)).toEqual({ role: 'assistant', content: null, tool_calls: [toolCall] });
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.deepseek.com/chat/completions');
    expect(init).toMatchObject({ method: 'POST', redirect: 'error', cache: 'no-store' });
    const headers = new Headers(init.headers);
    expect(headers.get('authorization')).toBe('Bearer synthetic-deepseek-key');
    expect(headers.has('CF-Access-Client-Id')).toBe(false);
    expect(headers.has('CF-Access-Client-Secret')).toBe(false);
    expect(JSON.parse(String(init.body))).toEqual({ model: 'deepseek-flash', messages: textTurn, stream: false, temperature: 0.2, max_tokens: 4096, thinking: { type: 'disabled' }, tools, tool_choice: 'auto' });
  });

  it('keeps explicitly local requests on Ollama despite the chat provider switch', async () => {
    const fetcher = vi.fn().mockResolvedValue(completionResponse());
    vi.stubGlobal('fetch', fetcher);
    await completeChat(textTurn, undefined, { provider: 'ollama', vision: true });
    const [url, init] = fetcher.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://private.example.com/v1/chat/completions');
    expect(new Headers(init.headers).has('authorization')).toBe(false);
    expect(JSON.parse(String(init.body))).toMatchObject({ model: 'qwen3-vl:8b', think: false });
  });

  it.each([
    ['missing key', 'DEEPSEEK_API_KEY', undefined],
    ['whitespace key', 'DEEPSEEK_API_KEY', '  '],
    ['unsafe key', 'DEEPSEEK_API_KEY', 'key\r\nInjected: value'],
    ['unsupported model', 'DEEPSEEK_MODEL', 'deepseek-pro'],
    ['unsupported provider', 'SARIN_CHAT_PROVIDER', 'other'],
    ['invalid timeout', 'LLM_REQUEST_TIMEOUT_MS', '0'],
  ])('rejects %s before sending data', async (_name, key, value) => {
    vi.stubEnv(key, value);
    const fetcher = vi.fn().mockResolvedValue(completionResponse());
    vi.stubGlobal('fetch', fetcher);
    await expect(completeChat(textTurn)).rejects.toMatchObject({ status: 503 });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('rejects a vision request before sending data to DeepSeek', async () => {
    const fetcher = vi.fn().mockResolvedValue(completionResponse());
    vi.stubGlobal('fetch', fetcher);
    await expect(completeChat(textTurn, undefined, { vision: true })).rejects.toMatchObject({ status: 503 });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('rejects embedded images even when the caller omits the vision flag', async () => {
    const fetcher = vi.fn().mockResolvedValue(completionResponse());
    vi.stubGlobal('fetch', fetcher);
    await expect(completeChat([{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,c3ludGhldGlj' } }] }])).rejects.toMatchObject({ status: 503 });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each(['api.deepseek.com', 'nested.api.deepseek.com', 'api.deepseek.com.'])('refuses %s as a local tunnel before exposing CF credentials', async host => {
    vi.stubEnv('SARIN_TUNNEL_URL', `https://${host}/v1/chat/completions`);
    const fetcher = vi.fn().mockResolvedValue(completionResponse());
    vi.stubGlobal('fetch', fetcher);
    await expect(completeChat(textTurn, undefined, { provider: 'ollama' })).rejects.toMatchObject({ status: 503 });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([[401, /credencial/i], [402, /saldo/i], [429, /límite/i], [500, /DeepSeek/]])('reports HTTP %s safely without retrying or falling back', async (status, message) => {
    const fetcher = vi.fn().mockResolvedValue(new Response('synthetic-secret-from-upstream', { status }));
    vi.stubGlobal('fetch', fetcher);
    await expect(completeChat(textTurn)).rejects.toMatchObject({ status: 503, message: expect.stringMatching(message) });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('reports a network failure as DeepSeek unavailable without exposing its underlying error', async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error('synthetic-secret-from-fetch'));
    vi.stubGlobal('fetch', fetcher);
    await expect(completeChat(textTurn)).rejects.toMatchObject({ status: 503, message: expect.stringMatching(/DeepSeek/) });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  // Characterization of the existing bounded, cancellable transport shared by both providers.
  it('cancels a DeepSeek request when the caller aborts without retrying', async () => {
    const controller = new AbortController();
    const fetcher = vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
    }));
    vi.stubGlobal('fetch', fetcher);
    const pending = completeChat(textTurn, undefined, { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][1].signal?.aborted).toBe(true);
  });

  it('applies the configured request timeout to DeepSeek', async () => {
    vi.stubEnv('LLM_REQUEST_TIMEOUT_MS', '2300');
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    const fetcher = vi.fn().mockResolvedValue(completionResponse());
    vi.stubGlobal('fetch', fetcher);
    await completeChat(textTurn);
    expect(timeout).toHaveBeenCalledWith(2300);
    expect(fetcher.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });

  it.each([
    ['invalid JSON', () => new Response('{invalid')],
    ['empty answer', () => Response.json({ choices: [{ message: { content: ' ' } }] })],
    ['invalid tool arguments shape', () => Response.json({ choices: [{ message: { tool_calls: [{ ...toolCall, function: { name: 'consultar_disponibilidad', arguments: {} } }] } }] })],
    ['oversized body', () => new Response('x'.repeat(2 * 1024 * 1024 + 1))],
  ])('rejects %s without exposing or retrying the response', async (_name, response) => {
    const fetcher = vi.fn().mockResolvedValue(response());
    vi.stubGlobal('fetch', fetcher);
    await expect(completeChat(textTurn)).rejects.toMatchObject({ status: 502 });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('probes the selected provider without transmitting CF credentials or claiming vision support', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ object: 'list', data: [{ id: 'deepseek-flash', object: 'model', owned_by: 'deepseek' }, { id: 'qwen3-vl:8b', object: 'model', owned_by: 'synthetic' }] }));
    vi.stubGlobal('fetch', fetcher);
    expect(await probeEngine()).toMatchObject({ provider: 'deepseek', online: true, visionAvailable: false });
    const [url, init] = fetcher.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.deepseek.com/models');
    expect(init).toMatchObject({ method: 'GET', redirect: 'error', cache: 'no-store' });
    const headers = new Headers(init.headers);
    expect(headers.get('authorization')).toBe('Bearer synthetic-deepseek-key');
    expect(headers.has('CF-Access-Client-Id')).toBe(false);
    expect(headers.has('CF-Access-Client-Secret')).toBe(false);
  });

  it('probes Ollama separately while DeepSeek is selected for chat', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ data: [{ id: 'qwen3:32b' }, { id: 'qwen3-vl:8b' }] }));
    vi.stubGlobal('fetch', fetcher);
    expect(await probeEngine('ollama')).toMatchObject({ provider: 'ollama', online: true, visionAvailable: true });
    expect(fetcher.mock.calls[0][0]).toBe('https://private.example.com/v1/models');
  });

  it('reports an invalid provider selection without probing a destination', async () => {
    vi.stubEnv('SARIN_CHAT_PROVIDER', 'other');
    const fetcher = vi.fn().mockResolvedValue(Response.json({ data: [{ id: 'qwen3:32b' }] }));
    vi.stubGlobal('fetch', fetcher);
    expect(await probeEngine()).toMatchObject({ provider: null, online: false, visionAvailable: false, error: expect.stringMatching(/proveedor/i) });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('reports missing DeepSeek models as offline with an appropriate safe error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ data: [{ id: 'other' }] })));
    expect(await probeEngine()).toMatchObject({ provider: 'deepseek', online: false, visionAvailable: false, error: expect.stringMatching(/DeepSeek/) });
  });

  it('keeps raw upstream errors out of the health response', async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error('synthetic-secret-from-health'));
    vi.stubGlobal('fetch', fetcher);
    const health = await probeEngine();
    expect(health).toMatchObject({ provider: 'deepseek', online: false, visionAvailable: false, error: expect.stringMatching(/DeepSeek/) });
    expect(JSON.stringify(health)).not.toContain('synthetic-secret');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
