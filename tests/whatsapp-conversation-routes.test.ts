import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { memoryFirestore } from './memoryFirestore';
import { businessId, inbound, phoneId, sender, syntheticWhatsAppEnv, wabaId, whatsappRows } from './whatsapp-fixtures';
const state = vi.hoisted(() => ({ db: undefined as unknown, verify: vi.fn(), kick: vi.fn() }));
vi.mock('@/lib/firebase/admin', () => ({ getAdminDb: () => state.db, getAdminAuth: () => ({ verifyIdToken: state.verify }) }));
vi.mock('@/lib/server/whatsapp-worker', () => ({ kickWhatsAppWorker: state.kick }));
import { GET, PATCH } from '@/app/api/admin/whatsapp/conversations/route';
import { POST as webhook } from '@/app/api/whatsapp/webhook/route';
import { ingestWhatsAppWebhook, whatsappHash } from '@/lib/server/whatsapp-store';
const id = whatsappHash(businessId, phoneId, sender);
const request = (method: string, token?: string, body?: unknown) => new Request('https://example.test/api/admin/whatsapp/conversations', {
  method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}),
});
beforeEach(() => {
  syntheticWhatsAppEnv(); vi.stubEnv('SUPERADMIN_UID', 'owner'); state.db = memoryFirestore(whatsappRows()).db;
  state.verify.mockReset().mockImplementation(async token => { if (token === 'invalid') throw new Error(); return { uid: token }; });
  state.kick.mockReset(); vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('No external calls in fixtures'); }));
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
describe('private conversation routes', () => {
  it.each([['GET', GET], ['PATCH', PATCH]] as const)('authorizes %s before storage or external work', async (method, handler) => {
    state.db = undefined;
    expect((await handler(request(method))).status).toBe(401);
    expect((await handler(request(method, 'invalid'))).status).toBe(401);
    expect((await handler(request(method, 'other'))).status).toBe(403);
    expect(fetch).not.toHaveBeenCalled(); expect(state.kick).not.toHaveBeenCalled();
  });
  it('returns a private bounded list and a confirmed revision after takeover', async () => {
    await ingestWhatsAppWebhook(inbound());
    const result = await GET(request('GET', 'owner'));
    expect(result.status).toBe(200); expect(result.headers.get('Cache-Control')).toBe('no-store');
    expect(await result.json()).toMatchObject({ conversations: [{ id, mode: 'bot', revision: 0 }], truncated: false });
    const changed = await PATCH(request('PATCH', 'owner', { conversationId: id, mode: 'human', expectedRevision: 0 }));
    expect(changed.status).toBe(200); expect(changed.headers.get('Cache-Control')).toBe('no-store');
    expect(await changed.json()).toMatchObject({ conversation: { id, mode: 'human', revision: 1 } });
    expect((await PATCH(request('PATCH', 'owner', { conversationId: id, mode: 'bot', expectedRevision: 0 }))).status).toBe(409);
    expect(fetch).not.toHaveBeenCalled(); expect(state.kick).not.toHaveBeenCalled();
  });
  it('rejects spoofed audit identity, invalid control and oversized requests', async () => {
    const valid = { conversationId: id, mode: 'human', expectedRevision: 0 };
    for (const body of [{ ...valid, actorUid: 'other' }, { ...valid, mode: 'admin' }, { ...valid, conversationId: '../' }, { ...valid, expectedRevision: -1 }]) {
      expect((await PATCH(request('PATCH', 'owner', body))).status).toBe(400);
    }
    expect((await PATCH(request('PATCH', 'owner', { ...valid, extra: 'x'.repeat(3000) }))).status).toBe(413);
    expect((await PATCH(request('PATCH', 'owner', valid))).status).toBe(404);
  });
  it('accepts app echoes only behind the existing signed webhook boundary', async () => {
    const body = JSON.stringify({ object: 'whatsapp_business_account', entry: [{ id: wabaId, changes: [{ field: 'smb_message_echoes', value: {
      messaging_product: 'whatsapp', metadata: { phone_number_id: phoneId }, message_echoes: [{ id: 'wamid.human', from: '573009998877', to: sender, type: 'text', text: { body: 'Te atiendo yo' }, timestamp: String(Math.floor(Date.now() / 1000)) }],
    } }] }] });
    expect((await webhook(new Request('https://example.test/webhook', { method: 'POST', body }))).status).toBe(401);
    const signature = createHmac('sha256', 'synthetic-app-secret').update(body).digest('hex');
    expect((await webhook(new Request('https://example.test/webhook', { method: 'POST', body, headers: { 'x-hub-signature-256': `sha256=${signature}` } }))).status).toBe(200);
    expect(await (await GET(request('GET', 'owner'))).json()).toMatchObject({ conversations: [{ id, mode: 'human', revision: 1 }] });
    expect(fetch).not.toHaveBeenCalled();
  });
});
