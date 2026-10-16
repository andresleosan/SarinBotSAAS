import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { memoryFirestore } from './memoryFirestore';
import { inbound, syntheticWhatsAppEnv, whatsappRows } from './whatsapp-fixtures';
const state = vi.hoisted(() => ({ db: undefined as unknown, verify: vi.fn(), kick: vi.fn() }));
vi.mock('@/lib/firebase/admin', () => ({ getAdminDb: () => state.db, getAdminAuth: () => ({ verifyIdToken: state.verify }) }));
vi.mock('@/lib/server/whatsapp-worker', () => ({ kickWhatsAppWorker: state.kick }));
import { GET as adminGet, PATCH as adminPatch } from '@/app/api/admin/whatsapp/route';
import { GET, POST } from '@/app/api/whatsapp/webhook/route';
import { POST as cleanup } from '@/app/api/admin/whatsapp/cleanup/route';
const adminRequest = (method: string, token?: string, body?: unknown) => new Request('https://example.test/api/admin/whatsapp', { method,
  headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
beforeEach(() => {
  syntheticWhatsAppEnv(); state.db = memoryFirestore(whatsappRows()).db;
  vi.stubEnv('SUPERADMIN_UID', 'owner');
  state.verify.mockReset().mockImplementation(async token => { if (token === 'invalid') throw new Error(); return { uid: token }; });
  state.kick.mockReset(); vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('Network prohibited in route fixture'); }));
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
describe('WhatsApp registered route boundaries', () => {
  it.each([['GET', adminGet], ['PATCH', adminPatch]] as const)('requires real superadmin authorization for %s', async (method, handler) => {
    expect((await handler(adminRequest(method))).status).toBe(401);
    expect((await handler(adminRequest(method, 'invalid'))).status).toBe(401);
    expect((await handler(adminRequest(method, 'ordinary'))).status).toBe(403);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('returns status and empty measurement without claiming a Meta invoice or exposing credentials', async () => {
    const response = await adminGet(adminRequest('GET', 'owner'));
    expect(response.status).toBe(200); expect(response.headers.get('Cache-Control')).toBe('no-store');
    const body = await response.json();
    expect(body.usage).toMatchObject({ invoice: false, estimatedCostCOP: null, totals: { delivered: 0 } });
    expect(JSON.stringify(body)).not.toMatch(/synthetic|accessToken|appSecret|contentKey/);
  });
  it('rejects browser secrets and arbitrary endpoints before network or mutation', async () => {
    const result = await adminPatch(adminRequest('PATCH', 'owner', { businessId: 'business_a', phoneNumberId: '100001', wabaId: '200001', enabled: true, accessToken: 'forbidden' }));
    expect(result.status).toBe(400); expect(fetch).not.toHaveBeenCalled();
  });
  it('accepts signed batches only after durable writes, while unauthenticated bodies never kick a worker', async () => {
    const body = JSON.stringify(inbound());
    const bad = await POST(new Request('https://example.test/webhook', { method: 'POST', body }));
    expect(bad.status).toBe(401); expect(state.kick).not.toHaveBeenCalled();
    const good = await POST(new Request('https://example.test/webhook', { method: 'POST', body, headers: { 'X-Hub-Signature-256': `sha256=${createHmac('sha256', 'synthetic-app-secret').update(body).digest('hex')}` } }));
    expect(good.status).toBe(200); expect(state.kick).toHaveBeenCalledTimes(1);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('serves the subscription challenge without Firebase login and returns non-200 for a bad token', async () => {
    const response = await GET(new Request('https://example.test/webhook?hub.mode=subscribe&hub.verify_token=synthetic-verify-token&hub.challenge=123'));
    expect(response.status).toBe(200); expect(await response.text()).toBe('123');
    expect((await GET(new Request('https://example.test/webhook?hub.mode=subscribe&hub.verify_token=bad&hub.challenge=123'))).status).toBe(403);
  });
  it('allows only superadmin to clean expired bodies with WhatsApp disabled and never starts processing', async () => {
    const { db, rows } = memoryFirestore({ 'whatsappInbox/expired_fixture': { content: { data: 'synthetic-ciphertext' }, bodyExpiresAt: 1, expiresAt: Date.now() + 1000 }, 'whatsappInbox/current_fixture': { content: { data: 'fresh-ciphertext' }, bodyExpiresAt: Date.now() + 1000, expiresAt: Date.now() + 1000 } }); state.db = db;
    vi.stubEnv('WHATSAPP_ENABLED', 'false'); vi.stubEnv('WHATSAPP_CONTENT_KEY', '');
    expect((await cleanup(adminRequest('POST'))).status).toBe(401);
    expect((await cleanup(adminRequest('POST', 'ordinary'))).status).toBe(403);
    expect((await cleanup(adminRequest('POST', 'owner'))).status).toBe(200);
    expect(rows.get('whatsappInbox/expired_fixture')!.data.content).toBeNull();
    expect(rows.get('whatsappInbox/current_fixture')!.data.content).toEqual({ data: 'fresh-ciphertext' });
    expect(fetch).not.toHaveBeenCalled(); expect(state.kick).not.toHaveBeenCalled();
  });
});
