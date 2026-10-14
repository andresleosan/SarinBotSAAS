import { afterEach, describe, expect, it, vi } from 'vitest';
import { completeChat, probeEngine } from '@/lib/sarin/engine';

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
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
