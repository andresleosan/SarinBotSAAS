import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { memoryFirestore } from './memoryFirestore';

const auth = vi.hoisted(() => ({ requireUser: vi.fn(), isSuperadmin: vi.fn() }));
vi.mock('@/lib/server/auth', () => auth);
const database = vi.hoisted(() => ({ db: undefined as unknown }));
vi.mock('@/lib/firebase/admin', () => ({ getAdminDb: () => database.db }));
import { GET } from '@/app/api/sarin/health/route';
import { HttpError } from '@/lib/server/http';

const state = globalThis as typeof globalThis & { __sarinProbe?: unknown; __sarinProbes?: unknown };
beforeEach(() => {
  database.db = memoryFirestore().db;
  delete state.__sarinProbe;
  delete state.__sarinProbes;
  auth.requireUser.mockReset().mockResolvedValue({ uid: 'admin' });
  auth.isSuperadmin.mockReset().mockReturnValue(true);
  vi.stubEnv('SARIN_CHAT_PROVIDER', 'deepseek');
  vi.stubEnv('DEEPSEEK_API_KEY', 'synthetic-deepseek-key');
  vi.stubEnv('DEEPSEEK_MODEL', 'deepseek-flash');
  vi.stubEnv('SARIN_TUNNEL_URL', 'https://ia-sarin.alsdevstudio.com/v1/chat/completions');
  vi.stubEnv('OLLAMA_MAIN_MODEL', 'qwen3:32b');
  vi.stubEnv('CF_ACCESS_CLIENT_ID', 'synthetic-cf-id');
  vi.stubEnv('CF_ACCESS_CLIENT_SECRET', 'synthetic-cf-secret');
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); delete state.__sarinProbes; delete state.__sarinProbe; });

describe('chat and Vault health', () => {
  it('follows persisted changes immediately while keeping separate provider health caches', async () => {
    const { db } = memoryFirestore({ 'serverSettings/ai': { provider: 'deepseek', updatedAt: 123 } }); database.db = db;
    vi.stubEnv('SARIN_CHAT_PROVIDER', 'ollama');
    vi.stubGlobal('fetch', vi.fn(async (url: string) => Response.json({ data: [{ id: url.includes('api.deepseek.com') ? 'deepseek-flash' : 'qwen3:32b' }] })));
    expect(await (await GET(new Request('http://localhost/api/sarin/health'))).json()).toMatchObject({ provider: 'deepseek', status: 'online' });
    await db.collection('serverSettings').doc('ai').set({ provider: 'ollama', updatedAt: 124 });
    expect(await (await GET(new Request('http://localhost/api/sarin/health'))).json()).toMatchObject({ provider: 'ollama', status: 'online' });
  });

  it('fails closed for invalid chat selection while Vault remains explicitly local', async () => {
    database.db = memoryFirestore({ 'serverSettings/ai': { provider: 'unsupported', updatedAt: 123 } }).db;
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ data: [{ id: 'qwen3:32b' }] })));
    expect((await GET(new Request('http://localhost/api/sarin/health'))).status).toBe(503);
    expect(fetch).not.toHaveBeenCalled();
    const vault = await GET(new Request('http://localhost/api/sarin/health?scope=vault'));
    expect(await vault.json()).toMatchObject({ provider: 'ollama', status: 'online' });
    expect(vi.mocked(fetch).mock.calls.map(call => call[0])).toEqual(['https://ia-sarin.alsdevstudio.com/v1/models']);
  });

  it.each([
    { provider: 'deepseek', model: 'deepseek-flash', modelsUrl: 'https://api.deepseek.com/models' },
  ])('keeps a successful $provider probe separate from a stopped local Vault and caches each', async ({ provider, model, modelsUrl }) => {
    vi.stubEnv('SARIN_CHAT_PROVIDER', provider);
    const fetcher = vi.fn(async (url: string) => url === modelsUrl
      ? Response.json({ data: [{ id: model }] }) : new Response(null, { status: 503 }));
    vi.stubGlobal('fetch', fetcher);
    const chat = await GET(new Request('http://localhost/api/sarin/health'));
    expect(chat.status).toBe(200);
    expect(await chat.json()).toMatchObject({ status: 'online', provider, visionAvailable: false });
    const vault = await GET(new Request('http://localhost/api/sarin/health?scope=vault'));
    expect(vault.status).toBe(503);
    expect(await vault.json()).toMatchObject({ status: 'offline', provider: 'ollama' });
    await GET(new Request('http://localhost/api/sarin/health'));
    await GET(new Request('http://localhost/api/sarin/health?scope=vault'));
    expect(fetcher.mock.calls.map(call => call[0])).toEqual([
      modelsUrl, 'https://ia-sarin.alsdevstudio.com/v1/models',
    ]);
    expect(chat.headers.get('Cache-Control')).toBe('no-store');
  });

  it('denies non-admin Vault probes and invalid scopes before contacting either provider', async () => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    auth.isSuperadmin.mockReturnValue(false);
    expect((await GET(new Request('http://localhost/api/sarin/health?scope=vault'))).status).toBe(403);
    expect((await GET(new Request('http://localhost/api/sarin/health?scope=external'))).status).toBe(400);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('requires authentication even when health has been cached', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ data: [{ id: 'deepseek-flash' }] }));
    vi.stubGlobal('fetch', fetcher);
    await GET(new Request('http://localhost/api/sarin/health'));
    auth.requireUser.mockRejectedValue(new HttpError(401, 'Inicia sesión.'));
    expect((await GET(new Request('http://localhost/api/sarin/health'))).status).toBe(401);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('reports cloud failures without blaming the Mac or exposing upstream response text', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('private upstream detail', { status: 401 })));
    auth.isSuperadmin.mockReturnValue(false);
    const response = await GET(new Request('http://localhost/api/sarin/health'));
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.error).toMatch(/DeepSeek/);
    expect(body.error).not.toMatch(/Mac|private upstream detail|synthetic/);
    expect(body.queue).toBeUndefined();
  });
});
