import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import type { Database } from '@/lib/storage/types';
import { HttpError } from '@/lib/server/http';
import { consentedFirestore } from './consent-fixtures';
import { rescheduleActor as actor, rescheduleBusiness as business, rescheduleSource as source } from './appointment-reschedule-contract';
const state = vi.hoisted(() => ({ db: undefined as unknown as Database }));
vi.mock('@/lib/firebase/admin', () => ({ getAdminDb: () => state.db }));
vi.mock('@/lib/server/auth', () => ({ requireUser: async (request: Request) => {
  if (request.headers.get('Authorization') !== 'Bearer synthetic') throw new HttpError(401, 'Session required');
  return { uid: 'demo-reschedule-client' };
} }));
const now = Date.parse('2030-01-06T14:00:00Z');
const occurrence = { appointmentId: source.id, sourceRevision: 0, sourceStartAt: source.startAt, offsetMinutes: 1440 };
const context = { params: Promise.resolve({ id: business.id }) };
async function routes() {
  const paths = ['../src/app/api/businesses/[id]/reminders/route.ts', '../src/app/api/businesses/[id]/reminders/preference/route.ts', '../src/app/api/businesses/[id]/reminders/seen/route.ts'];
  const modules = await Promise.all(paths.map(path => import(path).catch(() => null)));
  expect(modules.every(Boolean), 'The reminder HTTP boundaries are not implemented').toBe(true);
  return { get: modules[0]!.GET, preference: modules[1]!.PATCH, seen: modules[2]!.POST };
}
const req = (method: string, body?: unknown, options: { query?: string; auth?: boolean } = {}) => new Request(`http://localhost/api/businesses/${business.id}/reminders${options.query ?? ''}`, { method, headers: { 'Content-Type': 'application/json', ...(options.auth === false ? {} : { Authorization: 'Bearer synthetic' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(now);
  state.db = consentedFirestore({ [`businesses/${business.id}`]: business as never, [`businesses/${business.id}/appointments/${source.id}`]: source as never }, [actor.uid]).db;
});
afterEach(() => vi.useRealTimers());
it('authenticates all three boundaries before accepting input', async () => {
  const r = await routes();
  expect((await r.get(req('GET', undefined, { auth: false }), context)).status).toBe(401);
  expect((await r.preference(req('PATCH', {}, { auth: false }), context)).status).toBe(401);
  expect((await r.seen(req('POST', {}, { auth: false }), context)).status).toBe(401);
});
it('rejects query strings on every route and caller supplied identities or private fields', async () => {
  const r = await routes();
  for (const [method, route, body] of [['GET', r.get, undefined], ['PATCH', r.preference, { enabled: true, expectedRevision: 0 }], ['POST', r.seen, occurrence]] as const) {
    expect((await route(req(method, body, { query: '?x=1' }), context)).status).toBe(400);
  }
  expect((await r.preference(req('PATCH', { enabled: true, expectedRevision: 0, uid: 'other' }), context)).status).toBe(400);
  expect((await r.seen(req('POST', { ...occurrence, beneficiary: { kind: 'self' } }), context)).status).toBe(400);
  expect((await r.seen(req('POST', { ...occurrence, offsetMinutes: 120 }), context)).status).toBe(400);
});
it('bounds requests and validates expected revision before any persistence', async () => {
  const r = await routes();
  for (const expectedRevision of [-1, 0.1, null, Number.MAX_SAFE_INTEGER]) expect((await r.preference(req('PATCH', { enabled: true, expectedRevision }), context)).status).toBe(400);
  expect((await r.seen(req('POST', { ...occurrence, private: 'x'.repeat(5000) }), context)).status).toBe(413);
  expect((await r.preference(new Request('http://localhost', { method: 'PATCH', headers: { Authorization: 'Bearer synthetic', 'Content-Type': 'application/json' }, body: '{broken' }), context)).status).toBe(400);
  expect((await state.db.collection('businesses').doc(business.id).collection('reminderPreferences').get()).size).toBe(0);
});
it('serves the declared wire contract, keeps GET read only and returns original seen time on retry', async () => {
  const r = await routes();
  const initial = await r.get(req('GET'), context); expect(initial.headers.get('Cache-Control')).toBe('no-store');
  expect((await initial.json()).preference).toEqual({ enabled: false, revision: 0, status: 'disabled', offsetMinutes: 1440 });
  const enabled = await r.preference(req('PATCH', { enabled: true, expectedRevision: 0 }), context);
  expect(enabled.status).toBe(200); expect(enabled.headers.get('Cache-Control')).toBe('no-store');
  expect((await enabled.json()).reminders).toEqual([{ ...occurrence, availableAt: now, seenAt: null }]);
  const first = await r.seen(req('POST', occurrence), context); expect(first.status).toBe(200); expect(first.headers.get('Cache-Control')).toBe('no-store');
  vi.setSystemTime(now + 1000);
  expect(await (await r.seen(req('POST', occurrence), context)).json()).toEqual({ reminder: { ...occurrence, availableAt: now, seenAt: now } });
  expect((await r.preference(req('PATCH', { enabled: false, expectedRevision: 0 }), context)).status).toBe(409);
});
