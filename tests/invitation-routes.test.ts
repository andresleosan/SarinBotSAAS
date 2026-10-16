import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { memoryFirestore } from './memoryFirestore';
const state = vi.hoisted(() => ({ db: null as any, token: null as any }));
vi.mock('@/lib/firebase/admin', () => ({ getAdminDb: () => state.db, getAdminAuth: () => ({ verifyIdToken: async () => state.token }) }));
import { GET, POST, PATCH } from '@/app/api/admin/invitations/route';
import { POST as redeem } from '@/app/api/invitations/redeem/route';
const request = (method = 'GET', body?: unknown, query = '', authorized = true) => new Request(`http://localhost/api/admin/invitations${query}`, { method, headers: { ...(authorized ? { Authorization: 'Bearer synthetic' } : {}), 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
beforeEach(() => { state.db = memoryFirestore().db; state.token = { uid: 'admin' }; vi.stubEnv('SUPERADMIN_UID', 'admin'); });
afterEach(() => vi.unstubAllEnvs());
describe('invitation HTTP boundaries', () => {
  it('requires authentication and exact server privilege, never browser admin flags', async () => {
    for (const call of [() => GET(request('GET', undefined, '', false)), () => POST(request('POST', {}, '', false)), () => PATCH(request('PATCH', {}, '', false)), () => redeem(request('POST', {}, '', false))]) {
      const response = await call();
      expect(response.status).toBe(401);
      expect(response.headers.get('Cache-Control')).toBe('no-store');
      expect(JSON.stringify(await response.json())).not.toMatch(/recipientEmail|codeHash/);
    }
    state.token = { uid: 'other', role: 'superadmin', isSuperadmin: true };
    expect((await GET(request())).status).toBe(403);
  });
  it('rejects extra/duplicate query parameters, unknown fields and oversized bodies', async () => {
    for (const query of ['?after=no', `?after=${'a'.repeat(24)}&after=${'a'.repeat(24)}`, '?email=other']) expect((await GET(request('GET', undefined, query))).status).toBe(400);
    expect((await POST(request('POST', { recipientEmail: 'a@example.test', requestId: 'create-one', admin: true }))).status).toBe(400);
    expect((await POST(request('POST', { padding: 'x'.repeat(4097) }))).status).toBe(413);
    expect((await redeem(request('POST', { padding: 'x'.repeat(2049) }))).status).toBe(413);
  });
  it('issues only once, omits hashes on listing/commands and redeems with verified Google identity', async () => {
    const input = { recipientEmail: 'owner@example.test', requestId: 'create-one' };
    const created = await POST(request('POST', input));
    expect(created.status).toBe(201);
    const result = await created.json();
    expect((await POST(request('POST', input))).status).toBe(200);
    const listing = await GET(request());
    expect(JSON.stringify(await listing.json())).not.toMatch(/codeHash|createFingerprint|"code":/);
    state.token = { uid: 'owner', email: input.recipientEmail, email_verified: false, firebase: { sign_in_provider: 'google.com' } };
    expect((await redeem(request('POST', { code: result.code, requestId: 'redeem-one' }))).status).toBe(403);
    state.token.email_verified = true;
    expect((await redeem(request('POST', { code: result.code, requestId: 'redeem-one' }))).status).toBe(200);
    state.token = { uid: 'admin' };
    const suspended = await PATCH(request('PATCH', { action: 'suspend_access', invitationId: result.invitation.id, expectedVersion: 1, requestId: 'suspend-one', reason: 'Test' }));
    expect(suspended.status).toBe(200);
    expect(JSON.stringify(await suspended.json())).not.toMatch(/codeHash|createFingerprint|"code":/);
  });
});
