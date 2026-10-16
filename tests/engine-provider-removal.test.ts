import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { completeChat, probeEngine, type EngineProvider } from '@/lib/sarin/engine';

beforeEach(() => {
  vi.stubEnv('SARIN_CHAT_PROVIDER', 'openai');
  vi.stubEnv('OPENAI_API_KEY', 'synthetic-retired-key');
  vi.stubEnv('OPENAI_MODEL', 'gpt-6-luna');
  vi.stubEnv('SARIN_TUNNEL_URL', 'https://ia-sarin.alsdevstudio.com/v1/chat/completions');
  vi.stubEnv('OLLAMA_MAIN_MODEL', 'local-model');
  vi.stubEnv('CF_ACCESS_CLIENT_ID', 'synthetic-cf-id');
  vi.stubEnv('CF_ACCESS_CLIENT_SECRET', 'synthetic-cf-secret');
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ model: 'gpt-6-luna', choices: [{ message: { content: 'Synthetic reply.' } }] })));
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe('retired OpenAI provider', () => {
  it('rejects stale environment selection before sending data or observing a cloud call', async () => {
    const onUsage = vi.fn();
    await expect(completeChat([{ role: 'user', content: 'Synthetic private request.' }], undefined, { onUsage })).rejects.toMatchObject({ status: 503, message: expect.stringMatching(/proveedor/i) });
    expect(fetch).not.toHaveBeenCalled();
    expect(onUsage).not.toHaveBeenCalled();
  });

  it('rejects a stale explicit selection instead of silently choosing another provider', async () => {
    vi.stubEnv('SARIN_CHAT_PROVIDER', 'ollama');
    await expect(completeChat([{ role: 'user', content: 'Synthetic request.' }], undefined, { provider: 'openai' as EngineProvider })).rejects.toMatchObject({ status: 503, message: expect.stringMatching(/proveedor/i) });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('reports an invalid provider without probing its catalog', async () => {
    expect(await probeEngine()).toMatchObject({ provider: null, online: false, visionAvailable: false, error: expect.stringMatching(/proveedor/i) });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('continues rejecting the public OpenAI host as a local tunnel before exposing CF headers', async () => {
    vi.stubEnv('SARIN_CHAT_PROVIDER', 'ollama');
    vi.stubEnv('SARIN_TUNNEL_URL', 'https://api.openai.com/v1/chat/completions');
    await expect(completeChat([{ role: 'user', content: 'Synthetic private request.' }])).rejects.toMatchObject({ status: 503 });
    expect(fetch).not.toHaveBeenCalled();
  });
});
