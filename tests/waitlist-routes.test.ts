import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import type { Database } from '@/lib/storage/types';
import { HttpError } from '@/lib/server/http';
import { subjectAdmin } from './represented-booking-contract';
import { waitlistFixture, waitlistNow } from './waitlist-contract';
const state = vi.hoisted(() => ({ db: undefined as unknown as Database, uid: '' }));
vi.mock('@/lib/firebase/admin', () => ({ getAdminDb: () => state.db }));
vi.mock('@/lib/server/auth', () => ({ isSuperadmin: () => true, requireUser: async (request: Request) => {
  if (request.headers.get('Authorization') !== 'Bearer synthetic') throw new HttpError(401, 'Session required');
  return { uid: state.uid };
} }));
let f: Awaited<ReturnType<typeof waitlistFixture>>;
async function routes() {
  const paths = ['../src/app/api/businesses/[id]/waitlist/route.ts', '../src/app/api/businesses/[id]/waitlist/cancel/route.ts'];
  const modules = await Promise.all(paths.map(path => import(path).catch(() => null)));
  expect(modules.every(Boolean), 'The waitlist HTTP boundaries are not implemented').toBe(true);
  return { get: modules[0]!.GET, join: modules[0]!.POST, cancel: modules[1]!.POST };
}
const request = (method: string, body?: unknown, auth = true, query = '') => new Request(`http://localhost/api/businesses/demo/waitlist${query}`, { method, headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: 'Bearer synthetic' } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
const context = () => ({ params: Promise.resolve({ id: f.business.id }) });
beforeEach(async () => { vi.useFakeTimers(); vi.setSystemTime(waitlistNow); vi.stubEnv('SUPERADMIN_UID', subjectAdmin.uid); f = await waitlistFixture(); state.db = f.db; state.uid = f.actor.uid; });
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });
it('requires session on every boundary and forbids query and identity injection', async () => {
  const r = await routes();
  for (const [method, handler, body] of [['GET', r.get, undefined], ['POST', r.join, f.input], ['POST', r.cancel, { requestId: 'waitlist-cancel-route', expectedRevision: 1, entryId: 'entry' }]] as const) {
    expect((await handler(request(method, body, false), context())).status).toBe(401);
    expect((await handler(request(method, body, true, '?uid=other'), context())).status).toBe(400);
  }
  expect((await r.join(request('POST', { ...f.input, uid: 'other' }), context())).status).toBe(400);
  expect((await r.join(request('POST', { ...f.input, case: { ...f.input.case, displayName: 'private' } }), context())).status).toBe(400);
});
it('bounds bodies, strict mutation fields, IDs and revisions before persistence', async () => {
  const r = await routes();
  for (const expectedRevision of [-1, 0.1, null, Number.MAX_SAFE_INTEGER]) expect((await r.join(request('POST', { ...f.input, expectedRevision }), context())).status).toBe(400);
  expect((await r.join(request('POST', { ...f.input, freeText: 'x'.repeat(9000) }), context())).status).toBe(413);
  expect((await r.cancel(request('POST', { requestId: 'waitlist-cancel-route', expectedRevision: 1, entryId: '../entry' }), context())).status).toBe(400);
  expect((await r.join(new Request('http://localhost', { method: 'POST', headers: { Authorization: 'Bearer synthetic', 'Content-Type': 'application/json' }, body: '{bad' }), context())).status).toBe(400);
  expect((await f.db.collection('businesses').doc(f.business.id).collection('waitlistRequests').get()).size).toBe(0);
});
it('returns the direct no-store DTO and preserves replay versus stale intent semantics', async () => {
  const r = await routes(), initial = await r.get(request('GET'), context());
  expect(initial.status).toBe(200); expect(initial.headers.get('Cache-Control')).toBe('no-store'); expect((await initial.json()).request).toBeNull();
  const joined = await r.join(request('POST', f.input), context()); expect(joined.status).toBe(200); expect(joined.headers.get('Cache-Control')).toBe('no-store');
  const body = await joined.json(); expect(body).toMatchObject({ businessId: f.business.id, ownerUid: f.actor.uid, revision: 1, request: { status: 'waiting' } });
  const cancelled = await r.cancel(request('POST', { expectedRevision: 1, requestId: 'waitlist-cancel-route', entryId: body.request.id }), context());
  expect(cancelled.status).toBe(200); expect(cancelled.headers.get('Cache-Control')).toBe('no-store'); expect((await cancelled.json()).request).toBeNull();
  expect((await r.join(request('POST', f.input), context())).status).toBe(409);
});
