import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Database } from '@/lib/storage/types';
import { POST } from '@/app/api/businesses/[id]/availability/next/route';
import { HttpError } from '@/lib/server/http';
import { memoryFirestore } from './memoryFirestore';
import { subjectAdmin, subjectFixture } from './represented-booking-contract';

const state = vi.hoisted(() => ({ actor: null as { uid: string } | null, db: null as Database | null }));
vi.mock('@/lib/server/auth', async importActual => ({ ...await importActual<typeof import('@/lib/server/auth')>(), requireUser: async () => {
  if (!state.actor) throw new HttpError(401, 'Session required'); return state.actor;
} }));
vi.mock('@/lib/firebase/admin', () => ({ getAdminDb: () => state.db }));

const body = { case: { bookingRequestId: 'demo-next-case', subjectKind: 'self' }, afterDateKey: '2026-10-17', serviceId: 'cut' };
function request(payload: unknown = body, suffix = '', headers: Record<string, string> = {}) {
  return new Request(`http://localhost/api/businesses/demo/availability/next${suffix}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(payload) });
}
const context = (id = 'demo') => ({ params: Promise.resolve({ id }) });
beforeEach(() => { state.actor = { uid: 'demo-client' }; vi.stubEnv('SUPERADMIN_UID', subjectAdmin.uid); vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-17T14:00:00Z')); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.useRealTimers(); state.actor = null; state.db = null; });

it('requires authentication before processing availability', async () => {
  state.actor = null; const result = await POST(request(), context());
  expect(result.status).toBe(401); expect(result.headers.get('cache-control')).toBe('no-store');
});

it.each([
  { payload: { ...body, secret: 'private' } },
  { payload: { ...body, afterDateKey: '2026-02-30' } },
  { payload: { ...body, case: { ...body.case, displayName: 'private' } } },
  { payload: { ...body, resourceId: '../foreign' } },
  { payload: body, suffix: '?serviceId=cut' },
  { payload: body, id: 'bad/path' },
])('rejects malformed or extraneous inputs before reading storage: %j', async ({ payload, suffix, id }) => {
  const result = await POST(request(payload, suffix), context(id));
  expect(result.status).toBe(400); expect(await result.json()).not.toHaveProperty('nextAvailability');
});

it('rejects oversized streamed and declared bodies and non JSON requests', async () => {
  expect((await POST(request({ ...body, extra: 'x'.repeat(9000) }), context())).status).toBe(413);
  expect((await POST(request(body, '', { 'content-length': '9000' }), context())).status).toBe(413);
  expect((await POST(request(body, '', { 'content-type': 'text/plain' }), context())).status).toBe(415);
});

it('returns the real search result in the frozen no-store response envelope', async () => {
  state.db = memoryFirestore().db; const f = await subjectFixture(state.db, 'general', false); state.actor = f.actor;
  const response = await POST(request(), context(f.business.id));
  expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('no-store');
  expect(await response.json()).toMatchObject({ nextAvailability: { dateKey: '2026-10-18', fromDateKey: '2026-10-18', throughDateKey: '2026-10-31', availability: [{ resourceId: 'one', slots: expect.arrayContaining(['09:00']) }, { resourceId: 'two', slots: expect.arrayContaining(['09:00']) }] } });
});

it('returns 404 for a missing business and a safe failure response when storage fails', async () => {
  state.db = memoryFirestore().db;
  expect((await POST(request(), context())).status).toBe(404);
  vi.spyOn(state.db, 'runTransaction').mockRejectedValue(new Error('PRIVATE_UPSTREAM_DETAIL'));
  const response = await POST(request(), context());
  expect(response.status).toBe(503); expect(JSON.stringify(await response.json())).not.toContain('PRIVATE_UPSTREAM_DETAIL');
});
