import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import { POST } from '@/app/api/whatsapp/ycloud/platform/webhook/route';
import * as diagnostic from '@/app/api/admin/platform-whatsapp/retry-diagnostic/route';
import * as status from '@/app/api/admin/platform-whatsapp/status/route';
import * as conversations from '@/app/api/admin/platform-whatsapp/conversations/route';
import { configure, memoryStore, now, scope } from './platform-whatsapp-test-fixtures';

const admin = vi.hoisted(() => ({ db: vi.fn(), verify: vi.fn() }));
vi.mock('@/lib/firebase/admin', () => ({ getAdminDb: admin.db, getAdminAuth: () => ({ verifyIdToken: admin.verify }) }));
let store: ReturnType<typeof memoryStore>;
const secret = 'demo-only-signing-secret';
const nonce = 'demo-only-nonce-0123456789abcdefghij';
function signed(overrides = {}, headers = {}) {
  const body = JSON.stringify({ id: 'demo-http-event', type: 'whatsapp.inbound_message.received', apiVersion: 'v2', createTime: new Date(now).toISOString(), whatsappInboundMessage: { id: 'demo-http-message', wabaId: scope.wabaId, from: '+12025550101', to: scope.phoneE164, type: 'text', text: { body: nonce } }, ...overrides });
  const t = String(now / 1000), s = createHmac('sha256', secret).update(t + '.').update(body).digest('hex');
  return new Request('https://demo.invalid/webhook', { method: 'POST', body, headers: { 'content-type': 'application/json', 'YCloud-Signature': `t=${t},s=${s}`, ...headers } });
}
function authorized(method: string, body?: unknown) { return new Request('https://demo.invalid/admin', { method, headers: { authorization: 'Bearer demo-token', 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }); }
beforeEach(() => {
  vi.clearAllMocks(); store = memoryStore(); admin.db.mockReturnValue(store.db); admin.verify.mockResolvedValue({ uid: 'demo-admin' });
  vi.spyOn(Date, 'now').mockReturnValue(now); configure(); vi.stubEnv('SUPERADMIN_UID', 'demo-admin'); vi.stubEnv('PLATFORM_YCLOUD_DIAGNOSTIC_ENABLED', 'false'); vi.stubEnv('SARIN_MAINTENANCE', 'false');
  delete (globalThis as any)[Symbol.for('sarin.ycloud.retry-diagnostic.process')].cached;
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

it('signed ordinary ingress persists once and exposes only received on replay', async () => {
  const first = await POST(signed()); expect(first.status).toBe(200); expect(await first.json()).toEqual({ received: true });
  const before = structuredClone([...store.rows]); const replay = await POST(signed()); expect(await replay.json()).toEqual({ received: true }); expect([...store.rows]).toEqual(before);
  expect([...store.rows.keys()].some(key => key.startsWith('platformWhatsAppConversations/'))).toBe(true);
  expect(store.rows.has('serverSettings/ycloud_retry_diagnostic')).toBe(false);
});
it('strict public MIME differs from admin JSON prefix parsing', async () => {
  const result = await POST(signed({}, { 'content-type': 'application/json-extra' })); expect(result.status).toBe(415); expect(admin.db).not.toHaveBeenCalled();
  const req = authorized('PATCH', { action: 'pause', expectedRevision: 0, requestId: 'demo-pause-http' }); req.headers.set('content-type', 'application/json-extra');
  expect((await status.PATCH(req)).status).toBe(200);
});
it.each([{ type: 'unrelated' }, { whatsappInboundMessage: { id: 'demo-message', wabaId: '99999', from: '+12025550101', to: scope.phoneE164, type: 'text', text: { body: nonce } } }])('unrelated signed company event never initializes persistence', async patch => {
  const result = await POST(signed(patch)); expect(result.status).toBe(200); expect(await result.json()).toEqual({ received: true }); expect(admin.db).not.toHaveBeenCalled(); expect(store.rows.size).toBe(0);
});
it('real admin status/list/control preserve domain shapes and verified actor', async () => {
  const initial = await status.GET(authorized('GET')); const body = await initial.json();
  expect(body).toMatchObject({ receiveEnabled: true, retentionEnabled: true, aiEnabled: false, sendEnabled: false, scope, presentationState: 'configured_unverified', audit: [] }); expect(body).not.toHaveProperty('config'); expect(body).not.toHaveProperty('signingSecret');
  const paused = await status.PATCH(authorized('PATCH', { action: 'pause', expectedRevision: 0, requestId: 'demo-pause-http' }));
  expect(await paused.json()).toMatchObject({ presentationState: 'paused', connectionRevision: 1, audit: [expect.objectContaining({ actorUid: 'demo-admin', action: 'pause' })] });
  const list = await conversations.GET(authorized('GET')); expect(await list.json()).toEqual({ conversations: [], truncated: false, observedAt: new Date(now).toISOString() });
});
it('isolated diagnostic arm/public observation/admin summary/DELETE share only singleton state', async () => {
  for (const flag of ['RECEIVE', 'RETENTION', 'AI', 'SEND']) vi.stubEnv(`PLATFORM_WHATSAPP_${flag}_ENABLED`, 'false');
  for (const [name, value] of Object.entries({ PLATFORM_YCLOUD_DIAGNOSTIC_ENABLED: 'true', PLATFORM_YCLOUD_DIAGNOSTIC_RUN_ID: '11111111-1111-4111-8111-111111111111', PLATFORM_YCLOUD_DIAGNOSTIC_EXPIRES_AT: new Date(now + 2_700_000).toISOString(), PLATFORM_YCLOUD_DIAGNOSTIC_SENDER: '+12025550101', PLATFORM_YCLOUD_DIAGNOSTIC_NONCE: nonce })) vi.stubEnv(name, value);
  expect((await diagnostic.POST(authorized('POST', {}))).status).toBe(204);
  const retry = await POST(signed()); expect(retry.status).toBe(503); expect(await retry.text()).toBe('');
  const summary = await diagnostic.GET(authorized('GET')); expect(await summary.json()).toEqual({ status: 'pinned', expiresAt: new Date(now + 2_700_000).toISOString(), requests: 1, attempts: [expect.objectContaining({ eventId: 'demo-http-event', hmacValid: true })] });
  expect([...store.rows.keys()]).toEqual(['serverSettings/ycloud_retry_diagnostic']);
  expect((await diagnostic.DELETE(authorized('DELETE'))).status).toBe(204);
  expect(store.rows.get('serverSettings/ycloud_retry_diagnostic')).toMatchObject({ status: 'closed', requests: 1, attempts: [] });
  expect((await POST(signed())).status).toBe(503); expect((await diagnostic.POST(authorized('POST', {}))).status).toBe(409);
});
