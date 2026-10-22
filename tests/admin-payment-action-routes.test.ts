import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Database } from '@/lib/storage/types';
import { memoryFirestore } from './memoryFirestore';
const state = vi.hoisted(() => ({ db: null as Database | null, getUser: vi.fn(), verifyIdToken: vi.fn(), databaseCalls: 0 }));
vi.mock('@/lib/firebase/admin', () => ({ getAdminDb: () => { state.databaseCalls++; if (!state.db) throw new Error('Default remote database forbidden'); return state.db; }, getAdminAuth: () => state }));
import { GET, POST } from '@/app/api/admin/copilot/payment-actions/route';
import { POST as confirm } from '@/app/api/admin/copilot/payment-actions/[id]/confirm/route';
const now = Date.parse('2030-01-01T12:00:00Z'), uid = 'demo-admin', requestId = '11111111-1111-4111-8111-111111111111';
const body = { paymentId: 'demo-payment', action: 'approve', requestId };
beforeEach(() => {
  vi.spyOn(Date, 'now').mockReturnValue(now); vi.stubEnv('SUPERADMIN_UID', uid); vi.stubEnv('ADMIN_PAYMENT_ACTION_KEY', Buffer.alloc(32, 2).toString('base64'));
  state.verifyIdToken.mockReset().mockResolvedValue({ uid, auth_time: now / 1000 }); state.getUser.mockReset().mockResolvedValue({ uid, disabled: false }); state.databaseCalls = 0;
  state.db = memoryFirestore({ 'businesses/demo-business': { id: 'demo-business', ownerUid: 'demo-owner', name: 'Demo', createdAt: 1, subscription: { status: 'past_due', trialEndsAt: 0, currentPeriodEndsAt: 0 } }, 'paymentReceipts/demo-payment': { id: 'demo-payment', tenantId: 'demo-business', ownerUid: 'demo-owner', status: 'pending', submittedAt: 1, amountCOP: 49000, ownerEmail: 'private@example.test', receiptImageUrl: 'private-image' } }).db;
});
afterEach(() => { state.db = null; vi.restoreAllMocks(); vi.unstubAllEnvs(); });
function request(method: string, input?: unknown, query = '', auth = true) { return new Request('http://local.test/api/admin/copilot/payment-actions' + query, { method, headers: { ...(auth ? { Authorization: 'Bearer synthetic' } : {}), 'Content-Type': 'application/json' }, ...(input === undefined ? {} : { body: typeof input === 'string' ? input : JSON.stringify(input) }) }); }
const noStore = (response: Response, status: number) => { expect(response.status).toBe(status); expect(response.headers.get('Cache-Control')).toBe('no-store'); };
it.each(['GET', 'POST', 'CONFIRM'])('authenticates before %s query/body/target reads', async kind => {
  const r = kind === 'GET' ? await GET(request('GET', undefined, '?id=bad', false)) : kind === 'POST' ? await POST(request('POST', '{bad', '?unknown=1', false)) : await confirm(request('POST', '{bad', '?unknown=1', false), { params: Promise.resolve({ id: 'bad' }) });
  noStore(r, 401); expect(state.databaseCalls).toBe(0);
});
it.each(['foreign', 'disabled', 'deleted', 'cutoff'])('rejects current %s identity before preparation', async mode => {
  if (mode === 'foreign') state.verifyIdToken.mockResolvedValue({ uid: 'other', auth_time: now / 1000 });
  if (mode === 'disabled') state.getUser.mockResolvedValue({ uid, disabled: true });
  if (mode === 'deleted') state.getUser.mockRejectedValue(new Error('deleted'));
  if (mode === 'cutoff') state.getUser.mockResolvedValue({ uid, tokensValidAfterTime: new Date(now + 1000).toISOString() });
  noStore(await POST(request('POST', body)), mode === 'foreign' ? 403 : 401); expect(state.databaseCalls).toBe(0);
});
it.each(['', '?id=bad', `?id=${requestId}&id=${requestId}`, `?id=${requestId}&extra=1`])('rejects strict original GET query %s', async query => { noStore(await GET(request('GET', undefined, query)), 400); expect(state.databaseCalls).toBe(0); });
it.each([{ ...body, actorUid: uid }, { ...body, amountCOP: 1 }, { ...body, rejectionReason: 'unexpected' }, { ...body, action: 'reject', rejectionReason: '' }, { ...body, action: 'reject', rejectionReason: ' x ' }, { ...body, requestId: requestId.toUpperCase().replace('1', 'A') }])('rejects extra/invalid preparation fields', async value => { noStore(await POST(request('POST', value)), 400); expect(state.databaseCalls).toBe(0); });
it('prepares without effect, GET remains read-only, explicit POST confirms with safe projection', async () => {
  const response = await POST(request('POST', body)); noStore(response, 200); const view = await response.json();
  expect(view).toMatchObject({ proposal: { state: 'pending' }, business: { id: 'demo-business' }, payment: { amountCOP: 49000 } });
  const before = await state.db!.collection('paymentReceipts').doc('demo-payment').get(); expect(before.data()?.status).toBe('pending');
  const read = await GET(request('GET', undefined, '?id=' + view.proposal.id)); noStore(read, 200);
  expect(JSON.stringify(await read.json())).not.toMatch(/private-|ownerEmail|actorUid|contextFingerprint/);
  expect((await state.db!.collection('paymentReceipts').doc('demo-payment').get()).data()?.status).toBe('pending');
  const confirmed = await confirm(request('POST', { requestId, expectedRevision: 1, confirmed: true }), { params: Promise.resolve({ id: view.proposal.id }) }); noStore(confirmed, 200);
  const result = await confirmed.json(); expect(result).toMatchObject({ payment: { status: 'approved' }, effectId: 'demo-payment', reviewedAt: now });
  expect(JSON.stringify(result)).not.toMatch(/private-|ownerEmail|actorUid|contextFingerprint/);
});
it('requires real recent authentication and preserves the exact 428 code', async () => {
  const view = await (await POST(request('POST', body))).json();
  state.verifyIdToken.mockResolvedValue({ uid, auth_time: now / 1000 - 300, iat: now / 1000 });
  const result = await confirm(request('POST', { requestId, expectedRevision: 1, confirmed: true }), { params: Promise.resolve({ id: view.proposal.id }) });
  noStore(result, 428); expect(await result.json()).toMatchObject({ code: 'ADMIN_PAYMENT_REAUTH_REQUIRED' });
});
it.each([{ requestId, expectedRevision: 0, confirmed: true }, { requestId, expectedRevision: 1, confirmed: false }, { requestId, expectedRevision: 1, confirmed: true, paymentId: 'other' }])('rejects changed confirmation schema', async input => {
  noStore(await confirm(request('POST', input), { params: Promise.resolve({ id: requestId }) }), 400);
});
it('returns 409 for an otherwise valid stale revision', async () => {
  const view = await (await POST(request('POST', body))).json();
  noStore(await confirm(request('POST', { requestId, expectedRevision: 2, confirmed: true }), { params: Promise.resolve({ id: view.proposal.id }) }), 409);
});
it('reports changed context 409 and missing key 503 without losing no-store', async () => {
  const view = await (await POST(request('POST', body))).json();
  const ref = state.db!.collection('paymentReceipts').doc('demo-payment'), value = (await ref.get()).data(); await ref.set({ ...value, amountCOP: 49001 });
  noStore(await confirm(request('POST', { requestId, expectedRevision: 1, confirmed: true }), { params: Promise.resolve({ id: view.proposal.id }) }), 409);
  vi.stubEnv('ADMIN_PAYMENT_ACTION_KEY', ''); noStore(await GET(request('GET', undefined, '?id=' + view.proposal.id)), 503);
});
