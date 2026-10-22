import { beforeEach, afterEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ verifyIdToken: vi.fn(), getUser: vi.fn(), db: vi.fn() }));
vi.mock('@/lib/firebase/admin', () => ({ getAdminAuth: () => state, getAdminDb: () => { state.db(); throw new Error('Default backend forbidden'); } }));
import { GET, POST } from '@/app/api/platform-support/conversations/route';
import { GET as adminGET } from '@/app/api/admin/platform-support/conversations/route';
import { GET as messagesGET, POST as messagesPOST } from '@/app/api/platform-support/conversations/[id]/messages/route';
import { PATCH } from '@/app/api/admin/platform-support/notifications/route';
import { token } from './platform-whatsapp-link-fixtures';
import { now } from './platform-whatsapp-test-fixtures';
const context = { params: Promise.resolve({ id: '12345678-1234-4123-8123-123456789abc' }) };
beforeEach(() => { vi.spyOn(Date, 'now').mockReturnValue(now); state.db.mockReset(); state.verifyIdToken.mockReset().mockResolvedValue(token()); state.getUser.mockReset().mockImplementation(async uid => ({ uid, disabled: false })); vi.stubEnv('SUPERADMIN_UID', 'demo-admin'); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });
it('authenticates before malformed body, query, route params or database work', async () => {
  for (const handler of [GET, POST, adminGET, PATCH]) expect((await handler(new Request('https://app.test/?unknown=1', { method: 'POST', body: '{' }))).status).toBe(401);
  expect((await messagesGET(new Request('https://app.test/?cursor=broken'), context)).status).toBe(401);
  expect(state.db).not.toHaveBeenCalled();
});
it('denies current deleted/disabled/cutoff and nonadmin callers before parsing', async () => {
  const request = () => new Request('https://app.test/?unknown=1', { method: 'POST', body: '{', headers: { authorization: 'Bearer synthetic' } });
  expect((await adminGET(request())).status).toBe(403);
  state.getUser.mockResolvedValue({ uid: token().uid, disabled: true });
  expect((await POST(request())).status).toBe(401);
  expect(state.db).not.toHaveBeenCalled();
});
it('rejects authority injection, invalid Unicode, noncanonical requests and >32KiB streaming JSON', async () => {
  const send = (value: unknown) => messagesPOST(new Request('https://app.test/', { method: 'POST', headers: { authorization: 'Bearer synthetic', 'content-type': 'application/json' }, body: JSON.stringify(value) }), context);
  const valid = { requestId: '12345678-1234-4123-8123-123456789abc', expectedRevision: 0, text: 'hello' };
  for (const value of [{ ...valid, uid: 'other' }, { ...valid, text: '\ud800' }, { ...valid, requestId: valid.requestId.toUpperCase() }, { ...valid, text: 'x'.repeat(4097) }]) expect((await send(value)).status).toBe(400);
  expect((await send({ ...valid, text: 'x'.repeat(32769) })).status).toBe(413);
  expect(state.db).not.toHaveBeenCalled();
});
