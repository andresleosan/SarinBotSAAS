import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AttendanceCommand } from '@/lib/appointment-attendance';
import type { Database, DocumentReference, Query, Transaction } from '@/lib/storage/types';
import { HttpError } from '@/lib/server/http';
import { consentStateKey } from '@/lib/server/consent';
import { readAppointmentAttendanceHistory, updateAppointmentAttendance } from '@/lib/server/appointment-attendance';
import { GET, PATCH } from '@/app/api/businesses/[id]/appointments/[appointmentId]/attendance/route';
import { attendanceFixture, attendanceNow, attendanceOwner } from './appointment-attendance-contract';
import { memoryFirestore } from './memoryFirestore';

const session = vi.hoisted(() => ({ uid: 'demo-attendance-owner' as string | null, db: undefined as unknown as Database }));
vi.mock('@/lib/server/auth', () => ({ requireUser: async () => {
  if (!session.uid) throw new HttpError(401, 'Session required');
  return { uid: session.uid };
} }));
vi.mock('@/lib/firebase/admin', () => ({ getAdminDb: () => session.db }));

async function scenario() {
  const memory = memoryFirestore(), fixture = await attendanceFixture(memory.db);
  session.db = memory.db;
  return { ...memory, ...fixture };
}
type Fixture = Awaited<ReturnType<typeof scenario>>;
const context = (f: Fixture, id = f.business.id, appointmentId = f.appointment.id) => ({ params: Promise.resolve({ id, appointmentId }) });
const request = (body?: unknown, search = '', headers = { 'Content-Type': 'application/json' }) => new Request(`http://localhost/api/businesses/demo-attendance-business/appointments/demo-attendance-appointment/attendance${search}`, body === undefined ? undefined : { method: 'PATCH', headers, body: typeof body === 'string' ? body : JSON.stringify(body) });
const history = (f: Fixture, before?: number, db: Database = f.db) => readAppointmentAttendanceHistory(f.owner, f.business.id, f.appointment.id, before, db);
async function seed(f: Fixture, count: number, start = 1) {
  for (let sequence = start; sequence < start + count; sequence++) {
    const command: AttendanceCommand = { requestId: `demo-history-${sequence}`, expectedRevision: sequence - 1, expectedRescheduleRevision: 0,
      expectedStatus: sequence === 1 ? 'confirmed' : sequence % 2 ? 'no_show' : 'completed', status: sequence % 2 ? 'completed' : 'no_show',
      ...(sequence === 1 ? {} : { correctionReason: 'recording_error' }) };
    await updateAppointmentAttendance(f.owner, f.business.id, f.appointment.id, command, f.db);
  }
}
// Observe real transaction queries; storage failures remain failures, never empty pages.
function queryBoundary(db: Database, onQuery: (query: Query) => void): Database {
  return { collection: name => db.collection(name), runTransaction: (handler, options) => db.runTransaction(tx => handler(new Proxy(tx, {
    get(target, key) {
      if (key === 'get') return (ref: DocumentReference | Query) => {
        if ('where' in ref) onQuery(ref);
        return (target.get as (ref: DocumentReference | Query) => Promise<unknown>).call(target, ref);
      };
      return Reflect.get(target, key);
    },
  }) as Transaction), options) };
}

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(attendanceNow); session.uid = attendanceOwner.uid; });
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

describe('private attendance history', () => {
  it('historyRequiresOwnerAndNeverMutates', async () => {
    const f = await scenario(); await seed(f, 2);
    const before = structuredClone(f.rows);
    for (const uid of [f.appointment.client!.uid, 'demo-other-owner', 'demo-superadmin']) {
      vi.stubEnv('SUPERADMIN_UID', 'demo-superadmin');
      await expect(readAppointmentAttendanceHistory({ uid }, f.business.id, f.appointment.id, undefined, f.db)).rejects.toMatchObject({ status: 403 });
    }
    expect((await history(f)).events).toHaveLength(2);
    await f.businessRef.set({ ...f.business, ownerUid: 'demo-next-owner' });
    const afterTransfer = structuredClone(f.rows);
    await expect(history(f)).rejects.toMatchObject({ status: 403 });
    expect(f.rows).toEqual(afterTransfer);
    expect([...before].every(([path, row]) => path === f.businessRef.path || JSON.stringify(f.rows.get(path)) === JSON.stringify(row))).toBe(true);
  });

  it('legacyReadHasExplicitEmptyHistory', async () => {
    for (const status of ['confirmed', 'completed', 'no_show'] as const) {
      const f = await scenario(); const appointment = { ...f.appointment, status };
      await f.appointmentRef.set(appointment); const before = structuredClone(f.rows);
      expect(await history(f)).toEqual({ appointment, events: [], nextBeforeRevision: null });
      expect(f.rows).toEqual(before);
    }
  });

  it('pagesTwentyPlusLookaheadWithoutDuplicates', async () => {
    const f = await scenario(); await seed(f, 45);
    const db = queryBoundary(f.db, query => {
      const emitted = query as Query & { cap: number; filters: [string, string, unknown][]; ordering: [string, string] };
      expect(emitted.cap).toBe(21);
      expect(emitted.filters).toContainEqual(['appointmentId', '==', f.appointment.id]);
      expect(emitted.ordering).toEqual(['sequence', 'desc']);
    });
    const first = await history(f, undefined, db), second = await history(f, first.nextBeforeRevision!, db), third = await history(f, second.nextBeforeRevision!, db);
    expect([first.events.length, second.events.length, third.events.length]).toEqual([20, 20, 5]);
    expect([first.nextBeforeRevision, second.nextBeforeRevision, third.nextBeforeRevision]).toEqual([26, 6, null]);
    expect([first.events[0].sequence, first.events.at(-1)!.sequence, second.events[0].sequence, second.events.at(-1)!.sequence, third.events[0].sequence, third.events.at(-1)!.sequence]).toEqual([45, 26, 25, 6, 5, 1]);
    expect(new Set([...first.events, ...second.events, ...third.events].map(event => event.sequence)).size).toBe(45);
    expect((await history(f, 1)).events).toEqual([]);
  });

  it('gapOrForeignEventRejects', async () => {
    for (const corruption of ['missing', 'foreignTenant', 'foreignAppointment', 'brokenTransition', 'wrongSource', 'badId', 'duplicate', 'truncated'] as const) {
      const f = await scenario(); await seed(f, 4);
      const events = await f.businessRef.collection('attendanceEvents').where('sequence', '==', 2).get(), event = events.docs[0], ref = f.businessRef.collection('attendanceEvents').doc(event.id), data = event.data();
      if (corruption === 'missing') await ref.delete();
      if (corruption === 'foreignTenant') await ref.set({ ...data, businessId: 'demo-other-business' });
      if (corruption === 'foreignAppointment') await ref.set({ ...data, appointmentId: 'demo-other-appointment' });
      if (corruption === 'brokenTransition') await ref.set({ ...data, previousStatus: 'confirmed', reason: 'initial' });
      if (corruption === 'wrongSource') await ref.set({ ...data, source: { ...data.source, resourceId: 'demo-other-chair' } });
      if (corruption === 'badId') { await ref.delete(); await f.businessRef.collection('attendanceEvents').doc('demo-forged-event').set(data); }
      if (corruption === 'duplicate') await f.businessRef.collection('attendanceEvents').doc('demo-duplicate-event').set(data);
      if (corruption === 'truncated') for (const row of (await f.businessRef.collection('attendanceEvents').get()).docs) if (row.data().sequence < 4) await f.businessRef.collection('attendanceEvents').doc(row.id).delete();
      await expect(history(f)).rejects.toMatchObject({ status: 503, code: 'ATTENDANCE_RECORD_UNVERIFIABLE' });
    }
  });

  it('newHeadBetweenPagesDoesNotCorruptOlderCursor', async () => {
    const f = await scenario(); await seed(f, 45);
    const first = await history(f); await seed(f, 1, 46);
    const second = await history(f, first.nextBeforeRevision!);
    expect(second.appointment.attendance?.revision).toBe(46);
    expect(second.events.map(event => event.sequence)).toEqual(Array.from({ length: 20 }, (_, index) => 25 - index));
    expect(second.nextBeforeRevision).toBe(6);
    expect((await history(f)).events[0].sequence).toBe(46);
  });

  it('missingIndexIsErrorNotEmpty', async () => {
    const f = await scenario(); await seed(f, 1);
    const failure = new Error('synthetic missing index');
    const db = queryBoundary(f.db, () => { throw failure; });
    await expect(history(f, undefined, db)).rejects.toBe(failure);
    session.db = db;
    const response = await GET(request(), context(f));
    expect(response.status).toBe(503); expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await response.json()).not.toHaveProperty('events');
  });

  it('invalidCursorAndCorruptHeadFailWithoutReadsAsEmpty', async () => {
    const f = await scenario();
    for (const cursor of [0, -1, 1.5, Number.MAX_SAFE_INTEGER, NaN]) await expect(history(f, cursor)).rejects.toMatchObject({ status: 400 });
    await expect(history(f, 1)).rejects.toMatchObject({ status: 400 });
    await seed(f, 1); await expect(history(f, 2)).rejects.toMatchObject({ status: 400 });
    const appointment = (await f.appointmentRef.get()).data()!;
    await f.businessRef.collection('attendanceEvents').doc(appointment.attendance.lastEventId).delete();
    await expect(history(f)).rejects.toMatchObject({ status: 503 });
  });
});

describe('attendance HTTP boundary', () => {
  it('anonymous401', async () => {
    const f = await scenario(); session.uid = null;
    for (const response of [await GET(request(), context(f)), await PATCH(request(f.command), context(f))]) expect(response.status).toBe(401);
  });

  it('clientAndOtherOwner403', async () => {
    const f = await scenario(); const before = structuredClone(f.rows);
    for (const uid of [f.appointment.client!.uid, 'demo-other-owner', 'demo-superadmin']) {
      session.uid = uid; vi.stubEnv('SUPERADMIN_UID', 'demo-superadmin');
      expect((await GET(request(), context(f))).status).toBe(403);
      expect((await PATCH(request(f.command), context(f))).status).toBe(403);
    }
    expect(f.rows).toEqual(before);
  });

  it('pathAndStoredTenantCannotBeSubstituted', async () => {
    const f = await scenario();
    for (const [id, appointmentId] of [['bad/path', f.appointment.id], [f.business.id, 'bad/path']]) {
      expect((await GET(request(), context(f, id, appointmentId))).status).toBe(400);
      expect((await PATCH(request(f.command), context(f, id, appointmentId))).status).toBe(400);
    }
    expect((await GET(request(), context(f, f.business.id, 'demo-missing'))).status).toBe(404);
    for (const patch of [{ tenantId: 'demo-foreign-business' }, { id: 'demo-foreign-appointment' }]) {
      await f.appointmentRef.set({ ...f.appointment, ...patch });
      expect((await GET(request(), context(f))).status).toBe(503);
      expect((await PATCH(request(f.command), context(f))).status).toBe(503);
    }
    await f.appointmentRef.set(f.appointment); await f.businessRef.set({ ...f.business, id: 'demo-foreign-business' });
    expect((await GET(request(), context(f))).status).toBe(503);
  });

  it('strictPatchAnd2048ByteLimit', async () => {
    const f = await scenario(), json = JSON.stringify(f.command);
    expect((await PATCH(request(json + ' '.repeat(2048 - Buffer.byteLength(json))), context(f))).status).toBe(200);
    const before = structuredClone(f.rows);
    for (const body of [json + ' '.repeat(2049 - Buffer.byteLength(json)), JSON.stringify({ ...f.command, extra: 'é'.repeat(1000) })]) {
      expect((await PATCH(request(body), context(f))).status).toBe(413);
    }
    expect((await PATCH(request(json, '', { 'Content-Type': 'text/plain' }), context(f))).status).toBe(415);
    expect((await PATCH(request('{broken'), context(f))).status).toBe(400);
    expect((await PATCH(request({ ...f.command, extra: true }), context(f))).status).toBe(400);
    expect(f.rows).toEqual(before);
  });

  it('rejectsDuplicateUnknownOrMalformedCursor', async () => {
    const f = await scenario(); await seed(f, 2);
    for (const search of ['?beforeRevision=1&beforeRevision=1', '?x=1', '?beforeRevision=1&x=1', '?beforeRevision=', '?beforeRevision=0', '?beforeRevision=-1', '?beforeRevision=01', '?beforeRevision=1.0', '?beforeRevision=1e1', '?beforeRevision=%2B1', '?beforeRevision=9007199254740991', '?beforeRevision=3']) {
      expect((await GET(request(undefined, search), context(f))).status, search).toBe(400);
    }
    const response = await GET(request(undefined, '?beforeRevision=2'), context(f));
    expect(response.status).toBe(200); expect((await response.json()).events.map((event: { sequence: number }) => event.sequence)).toEqual([1]);
  });

  it('patchRejectsAnyQuery', async () => {
    const f = await scenario(); const before = structuredClone(f.rows);
    for (const search of ['?beforeRevision=1', '?x=1', '?x=']) expect((await PATCH(request(f.command, search), context(f))).status).toBe(400);
    expect(f.rows).toEqual(before);
  });

  it('noStoreOnSuccessAndErrors', async () => {
    const f = await scenario();
    const responses = [await GET(request(), context(f)), await PATCH(request(f.command), context(f)), await PATCH(request({ ...f.command, requestId: 'demo-new-request' }), context(f)), await GET(request(undefined, '?x=1'), context(f))];
    session.uid = null; responses.push(await GET(request(), context(f)));
    session.uid = 'demo-other-owner'; responses.push(await GET(request(), context(f)));
    session.uid = f.owner.uid;
    responses.push(await GET(request(), context(f, f.business.id, 'demo-missing')),
      await PATCH(request(' '.repeat(2049)), context(f)), await PATCH(request('{}', '', { 'Content-Type': 'text/plain' }), context(f)));
    await f.appointmentRef.set({ ...f.appointment, attendance: null });
    responses.push(await GET(request(), context(f)));
    expect(responses.map(response => response.status)).toEqual([200, 200, 409, 400, 401, 403, 404, 413, 415, 503]);
    for (const response of responses) expect(response.headers.get('Cache-Control')).toBe('no-store');
  });

  it('forgedOwnerTimestampAndFreeText400', async () => {
    const f = await scenario(); const before = structuredClone(f.rows);
    for (const patch of [{ actorUid: 'demo-forged' }, { recordedAt: attendanceNow }, { ownerUid: f.owner.uid }, { correctionReason: 'arbitrary text' }, { notes: 'free text' }, { expectedRevision: 0.5 }, { status: 'confirmed' }]) {
      expect((await PATCH(request({ ...f.command, ...patch }), context(f))).status).toBe(400);
    }
    expect(f.rows).toEqual(before);
  });

  it('expiredPlanAndAbsentConsentAllowHistoryButPatchPreserves428', async () => {
    const f = await scenario(); await seed(f, 1);
    await f.businessRef.set({ ...f.business, subscription: { ...f.business.subscription, status: 'expired', trialEndsAt: 1 } });
    await f.db.collection('serverSettings').doc(consentStateKey(f.owner.uid, 'account')).delete();
    const before = structuredClone(f.rows), response = await GET(request(), context(f));
    expect(response.status).toBe(200); expect((await response.json()).events).toHaveLength(1);
    const patch = await PATCH(request(f.command), context(f));
    expect(patch.status).toBe(428); expect((await patch.json()).code).toBe('CONSENT_REQUIRED');
    expect(patch.headers.get('Cache-Control')).toBe('no-store'); expect(f.rows).toEqual(before);
  });
});
