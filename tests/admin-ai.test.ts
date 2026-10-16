import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { memoryFirestore } from './memoryFirestore';

const state = vi.hoisted(() => ({ db: undefined as unknown, verify: vi.fn() }));
vi.mock('@/lib/firebase/admin', () => ({ getAdminDb: () => state.db, getAdminAuth: () => ({ verifyIdToken: state.verify }) }));
import { GET, PATCH } from '@/app/api/admin/ai/route';
import { getAiProviderSelection } from '@/lib/server/provider-settings';

const request = (method: 'GET' | 'PATCH', body?: unknown, token = 'admin-token') => new Request('http://localhost/api/admin/ai', {
  method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  ...(method === 'PATCH' ? { body: JSON.stringify(body) } : {}),
});
const catalog = (url: string) => Response.json({ data: [{ id: url.includes('api.deepseek.com') ? 'deepseek-flash' : url.includes('api.openai.com') ? 'gpt-6-luna' : 'qwen3:32b' }] });
beforeEach(() => {
  state.db = memoryFirestore().db;
  state.verify.mockReset().mockImplementation(async token => ({ uid: token === 'admin-token' ? 'admin' : 'ordinary', email: 'synthetic@example.test' }));
  vi.stubEnv('SUPERADMIN_UID', 'admin');
  vi.stubEnv('SARIN_CHAT_PROVIDER', 'ollama');
  vi.stubEnv('SARIN_TUNNEL_URL', 'https://ia-sarin.alsdevstudio.com/v1/chat/completions');
  vi.stubEnv('OLLAMA_MAIN_MODEL', 'qwen3:32b');
  vi.stubEnv('DEEPSEEK_MODEL', 'deepseek-flash');
  vi.stubEnv('DEEPSEEK_API_KEY', 'synthetic-deepseek-key');
  vi.stubEnv('OPENAI_API_KEY', undefined);
  vi.stubEnv('OPENAI_MODEL', 'gpt-6-luna');
  vi.stubEnv('CF_ACCESS_CLIENT_ID', 'synthetic-cf-id');
  vi.stubEnv('CF_ACCESS_CLIENT_SECRET', 'synthetic-cf-secret');
  vi.stubEnv('LLM_REQUEST_TIMEOUT_MS', '120000');
  vi.stubGlobal('fetch', vi.fn(async (url: string) => catalog(url)));
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('private administrator AI selection', () => {
  it.each(['GET', 'PATCH'] as const)('rejects unauthenticated and ordinary users for %s before inspecting providers', async method => {
    const { db, rows } = memoryFirestore(); state.db = db;
    const handler = method === 'GET' ? GET : PATCH;
    expect((await handler(request(method, { provider: 'deepseek' }, ''))).status).toBe(401);
    expect((await handler(request(method, { provider: 'deepseek' }, 'ordinary-token'))).status).toBe(403);
    expect(fetch).not.toHaveBeenCalled();
    expect(rows.size).toBe(0);
  });

  it('returns safe configuration and independent health, without creating an override', async () => {
    const { db, rows } = memoryFirestore(); state.db = db;
    vi.stubGlobal('fetch', vi.fn(async (url: string) => url.includes('api.deepseek.com') ? new Response('synthetic upstream secret', { status: 401 }) : catalog(url)));
    const response = await GET(request('GET'));
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data).toMatchObject({ provider: 'ollama', source: 'environment', updatedAt: null, providers: [
      { provider: 'ollama', configured: true, model: 'qwen3:32b', online: true },
      { provider: 'deepseek', configured: true, model: 'deepseek-flash', online: false, error: expect.stringMatching(/credencial/i) },
      { provider: 'openai', configured: false, model: null, online: false, error: expect.stringMatching(/credencial/i) },
    ] });
    expect(JSON.stringify(data)).not.toMatch(/synthetic|Authorization|CF-Access|https:\/\//);
    expect(rows.size).toBe(0);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });

  it('marks a provider unconfigured without fetching it or exposing invalid values', async () => {
    vi.stubEnv('DEEPSEEK_API_KEY', '');
    const response = await GET(request('GET'));
    expect((await response.json()).providers[1]).toMatchObject({ provider: 'deepseek', configured: false, model: null, online: false });
    expect(vi.mocked(fetch).mock.calls.map(call => call[0])).toEqual(['https://ia-sarin.alsdevstudio.com/v1/models']);
  });

  it.each([
    { provider: 'deepseek', modelUrl: 'https://api.deepseek.com/models' },
    { provider: 'openai', modelUrl: 'https://api.openai.com/v1/models' },
  ])('persists verified $provider manually and reads it after module reload instead of the environment', async ({ provider, modelUrl }) => {
    vi.stubEnv('OPENAI_API_KEY', 'synthetic-openai-key');
    const { db, rows } = memoryFirestore(); state.db = db;
    const response = await PATCH(request('PATCH', { provider }));
    expect(response.status).toBe(200);
    const saved = await response.json();
    expect(saved).toEqual({ provider, source: 'admin', updatedAt: expect.any(Number) });
    expect([...rows.keys()]).toEqual(['serverSettings/ai']);
    expect(rows.get('serverSettings/ai')!.data).toEqual({ provider, updatedAt: saved.updatedAt });
    expect(vi.mocked(fetch).mock.calls.map(call => [call[0], call[1]?.method])).toEqual([[modelUrl, 'GET']]);
    vi.resetModules();
    const restarted = await import('@/lib/server/provider-settings');
    expect(await restarted.getAiProviderSelection(db)).toEqual(saved);
  });

  it('shows independent safe OpenAI health without selecting it or returning its credential', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'synthetic-openai-key');
    const { db, rows } = memoryFirestore(); state.db = db;
    const response = await GET(request('GET'));
    const data = await response.json();
    expect(data).toMatchObject({ provider: 'ollama', providers: expect.arrayContaining([{ provider: 'openai', configured: true, model: 'gpt-6-luna', online: true, checkedAt: expect.any(Number) }]) });
    expect(JSON.stringify(data)).not.toMatch(/synthetic|Authorization|https:\/\//);
    expect(rows.size).toBe(0);
  });

  it.each(['missing-config', 'missing-model', 'denied', 'forbidden', 'quota', 'network'])('keeps the active provider when OpenAI validation fails: %s', async failure => {
    vi.stubEnv('OPENAI_API_KEY', failure === 'missing-config' ? undefined : 'synthetic-openai-key');
    const original = { provider: 'deepseek', updatedAt: 1234 };
    const { db, rows } = memoryFirestore({ 'serverSettings/ai': original }); state.db = db;
    if (failure === 'missing-model') vi.stubGlobal('fetch', vi.fn(async () => Response.json({ data: [{ id: 'other-model' }] })));
    if (['denied', 'forbidden', 'quota'].includes(failure)) vi.stubGlobal('fetch', vi.fn(async () => new Response('synthetic private error', { status: failure === 'denied' ? 401 : failure === 'forbidden' ? 403 : 429 })));
    if (failure === 'network') vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('synthetic private transport error'); }));
    const response = await PATCH(request('PATCH', { provider: 'openai' }));
    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toMatch(/synthetic|CF-Access|Authorization/);
    expect(rows.get('serverSettings/ai')!.data).toEqual(original);
    expect(vi.mocked(fetch).mock.calls.every(call => call[0] === 'https://api.openai.com/v1/models')).toBe(true);
  });

  it.each(['missing-config', 'missing-model', 'offline', 'denied', 'network'])('does not replace the active choice when the candidate fails: %s', async failure => {
    const original = { provider: 'ollama', updatedAt: 1234 };
    const { db, rows } = memoryFirestore({ 'serverSettings/ai': original }); state.db = db;
    if (failure === 'missing-config') vi.stubEnv('DEEPSEEK_API_KEY', '');
    if (failure === 'missing-model') vi.stubGlobal('fetch', vi.fn(async () => Response.json({ data: [{ id: 'other-model' }] })));
    if (failure === 'offline' || failure === 'denied') vi.stubGlobal('fetch', vi.fn(async () => new Response('synthetic secret upstream', { status: failure === 'denied' ? 401 : 503 })));
    if (failure === 'network') vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('synthetic secret network'); }));
    const response = await PATCH(request('PATCH', { provider: 'deepseek' }));
    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain('synthetic');
    expect(rows.get('serverSettings/ai')!.data).toEqual(original);
    expect(vi.mocked(fetch).mock.calls.every(call => call[0] === 'https://api.deepseek.com/models')).toBe(true);
  });

  it.each([{ provider: 'unsupported' }, { provider: null }, { provider: 'deepseek', apiKey: 'synthetic-injected' }, { provider: 'openai', apiKey: 'synthetic-injected' }, { provider: 'ollama', endpoint: 'https://other.example.test' }])('rejects unsupported settings before probing or saving: %j', async body => {
    const { db, rows } = memoryFirestore(); state.db = db;
    expect((await PATCH(request('PATCH', body))).status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
    expect(rows.size).toBe(0);
  });

  it.each([{ provider: 'unsupported', updatedAt: 123 }, { provider: 'ollama' }, { provider: 'deepseek', updatedAt: -1 }, { provider: 'ollama', updatedAt: 123, apiKey: 'synthetic-private' }])('fails closed on invalid stored configuration: %j', async value => {
    const { db } = memoryFirestore({ 'serverSettings/ai': value }); state.db = db;
    const response = await GET(request('GET'));
    expect(response.status).toBe(503);
    expect(fetch).not.toHaveBeenCalled();
    await expect(getAiProviderSelection(db)).rejects.toMatchObject({ status: 503 });
  });

  it('uses the environment only when no private override exists and rejects an invalid default', async () => {
    const { db } = memoryFirestore();
    vi.stubEnv('SARIN_CHAT_PROVIDER', undefined);
    expect(await getAiProviderSelection(db)).toEqual({ provider: 'ollama', source: 'environment', updatedAt: null });
    vi.stubEnv('SARIN_CHAT_PROVIDER', 'deepseek');
    expect(await getAiProviderSelection(db)).toMatchObject({ provider: 'deepseek', source: 'environment' });
    vi.stubEnv('SARIN_CHAT_PROVIDER', 'unsupported');
    await expect(getAiProviderSelection(db)).rejects.toMatchObject({ status: 503 });
  });
});
