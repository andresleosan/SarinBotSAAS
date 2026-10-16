import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { completeChat, probeEngine, type EngineMessage } from '@/lib/sarin/engine';

beforeEach(() => {
  vi.stubEnv('SARIN_CHAT_PROVIDER', undefined);
  vi.stubEnv('DEEPSEEK_API_KEY', undefined);
  vi.stubEnv('DEEPSEEK_MODEL', undefined);
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

  it.each(['api.deepseek.com', 'nested.api.deepseek.com', 'api.deepseek.com.', 'generativelanguage.googleapis.com', 'nested.generativelanguage.googleapis.com', 'generativelanguage.googleapis.com.'])('refuses %s as a local tunnel before exposing CF credentials', async host => {
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
