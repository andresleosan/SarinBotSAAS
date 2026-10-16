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
const catalog = (url: string) => Response.json(url.includes('generativelanguage.googleapis.com')
  ? { name: 'models/gemini-3.5-flash-lite', supportedGenerationMethods: ['generateContent'] }
  : { data: [{ id: url.includes('api.deepseek.com') ? 'deepseek-flash' : 'qwen3:32b' }] });
beforeEach(() => {
  state.db = memoryFirestore().db;
  state.verify.mockReset().mockImplementation(async token => ({ uid: token === 'admin-token' ? 'admin' : 'ordinary', email: 'synthetic@example.test' }));
  vi.stubEnv('SUPERADMIN_UID', 'admin');
  vi.stubEnv('SARIN_CHAT_PROVIDER', 'ollama');
  vi.stubEnv('SARIN_TUNNEL_URL', 'https://ia-sarin.alsdevstudio.com/v1/chat/completions');
  vi.stubEnv('OLLAMA_MAIN_MODEL', 'qwen3:32b');
  vi.stubEnv('DEEPSEEK_MODEL', 'deepseek-flash');
  vi.stubEnv('DEEPSEEK_API_KEY', 'synthetic-deepseek-key');
  vi.stubEnv('GEMINI_API_KEY', '');
  vi.stubEnv('GEMINI_BILLING_VERIFIED', 'false');
  vi.stubEnv('GEMINI_MODEL', 'gemini-3.5-flash-lite');
  vi.stubEnv('CF_ACCESS_CLIENT_ID', 'synthetic-cf-id');
  vi.stubEnv('CF_ACCESS_CLIENT_SECRET', 'synthetic-cf-secret');
  vi.stubEnv('LLM_REQUEST_TIMEOUT_MS', '120000');
  vi.stubGlobal('fetch', vi.fn(async (url: string) => catalog(url)));
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('private administrator AI selection', () => {
  it('rejects the retired OpenAI choice before probing even if an old credential remains', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'synthetic-retired-key');
    vi.stubEnv('OPENAI_MODEL', 'gpt-6-luna');
    const original = { provider: 'ollama', updatedAt: 1234 };
    const { db, rows } = memoryFirestore({ 'serverSettings/ai': original }); state.db = db;
    expect((await PATCH(request('PATCH', { provider: 'openai' }))).status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
    expect(rows.get('serverSettings/ai')!.data).toEqual(original);
  });
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
      { provider: 'gemini', configured: false, model: null, online: false },
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

  it('persists only a verified manual choice and reads it after module reload instead of the environment', async () => {
    const { db, rows } = memoryFirestore(); state.db = db;
    const response = await PATCH(request('PATCH', { provider: 'deepseek' }));
    expect(response.status).toBe(200);
    const saved = await response.json();
    expect(saved).toEqual({ provider: 'deepseek', source: 'admin', updatedAt: expect.any(Number) });
    expect([...rows.keys()]).toEqual(['serverSettings/ai']);
    expect(rows.get('serverSettings/ai')!.data).toEqual({ provider: 'deepseek', updatedAt: saved.updatedAt });
    expect(vi.mocked(fetch).mock.calls.map(call => [call[0], call[1]?.method])).toEqual([['https://api.deepseek.com/models', 'GET']]);
    vi.resetModules();
    const restarted = await import('@/lib/server/provider-settings');
    expect(await restarted.getAiProviderSelection(db)).toEqual(saved);
  });

  it('persists Gemini only after paid billing is verified and its native model GET succeeds', async () => {
    vi.stubEnv('GEMINI_API_KEY', 'AQ-synthetic-google-key');
    const original = { provider: 'ollama', updatedAt: 1234 };
    const { db, rows } = memoryFirestore({ 'serverSettings/ai': original }); state.db = db;
    const denied = await PATCH(request('PATCH', { provider: 'gemini' }));
    expect(denied.status).toBe(503);
    expect((await denied.json()).error).toMatch(/pago/i);
    expect(fetch).not.toHaveBeenCalled();
    expect(rows.get('serverSettings/ai')!.data).toEqual(original);
    vi.stubEnv('GEMINI_BILLING_VERIFIED', 'true');
    vi.mocked(fetch).mockResolvedValueOnce(new Response('synthetic-private-error', { status: 403 }));
    expect((await PATCH(request('PATCH', { provider: 'gemini' }))).status).toBe(503);
    expect(rows.get('serverSettings/ai')!.data).toEqual(original);
    const saved = await PATCH(request('PATCH', { provider: 'gemini' }));
    expect(saved.status).toBe(200);
    expect(await saved.json()).toMatchObject({ provider: 'gemini', source: 'admin' });
    expect(await getAiProviderSelection(db)).toMatchObject({ provider: 'gemini', source: 'admin' });
    expect(vi.mocked(fetch).mock.calls.every(([url, init]) => url === 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite' && init?.method === 'GET')).toBe(true);
    expect(rows.get('serverSettings/ai')!.data).toEqual({ provider: 'gemini', updatedAt: expect.any(Number) });
    const status = await (await GET(request('GET'))).json();
    expect(status.providers[2]).toMatchObject({ provider: 'gemini', configured: true, online: true });
    expect(JSON.stringify(status)).not.toMatch(/synthetic|x-goog|https:\/\//);
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

  it.each([{ provider: 'unsupported' }, { provider: null }, { provider: 'deepseek', apiKey: 'synthetic-injected' }, { provider: 'gemini', billingVerified: true }, { provider: 'gemini', apiKey: 'synthetic-injected' }, { provider: 'ollama', endpoint: 'https://other.example.test' }])('rejects unsupported settings before probing or saving: %j', async body => {
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
