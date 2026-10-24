import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Appointment } from '@/types/firestore';
import type { ChatActor } from '@/types/chat';
import type { Database, DocumentReference, Query, QuerySnapshot, Transaction } from '@/lib/storage/types';
import type { OwnerClientRecordCursor, OwnerClientRecordFilter } from '@/lib/owner-client-record';
import { ownerClientRecordPageSchema } from '@/lib/owner-client-record';
import { ownerClientRecordCursorRevision, readOwnerClientRecord } from '@/lib/server/owner-client-record';
import { makeOwnerClientRecordAppointment as make, ownerClientRecordBusinessId as businessId, ownerClientRecordUid as clientUid, ownerClientRecordResources as resources } from './owner-client-record-fixture';
import { memoryFirestore } from './memoryFirestore';

const owner = { uid: 'demo-owner' };
const collection = `businesses/${businessId}/appointments`;
const sourceId = 'demo-source';
const start = 1894024800000;
const item = (id: string, patch: Partial<Appointment> = {}) => make({ id, startAt: start, ...patch });
function scenario(appointments = [item('A')]) {
  const memory = memoryFirestore({
    [`businesses/${businessId}`]: { id: businessId, ownerUid: owner.uid, resources, subscription: { status: 'expired' } },
    [`${collection}/${sourceId}`]: item(sourceId, { startAt: start - 100000 }),
    ...Object.fromEntries(appointments.map(appointment => [`${collection}/${appointment.id}`, appointment])),
  });
  return { ...memory, db: memory.db as unknown as Database };
}
type Fixture = ReturnType<typeof scenario>;
const read = (f: Fixture, cursor?: OwnerClientRecordCursor, filter: OwnerClientRecordFilter = 'all', db = f.db, actor: ChatActor = owner) =>
  readOwnerClientRecord(actor, businessId, sourceId, { clientUid, filter, ...(cursor ? { cursor } : {}) }, db);
const cursor = (appointment: Appointment): OwnerClientRecordCursor => ({ appointmentId: appointment.id, startAt: appointment.startAt, revision: ownerClientRecordCursorRevision(appointment) });
type CapturedQuery = { path: string; cap: number; filters: [string, string, unknown][]; ordering: [string, string][] };
function observe(db: Database, transform?: (snapshot: QuerySnapshot, query: CapturedQuery) => QuerySnapshot) {
  const queries: CapturedQuery[] = [], reads: string[] = [], writes: string[] = [], querySizes: number[] = [];
  let transactions = 0;
  const observed: Database = { collection: name => db.collection(name), runTransaction: (handler, options) => db.runTransaction(async tx => {
    transactions++;
    return handler(new Proxy(tx, { get(target, key) {
      if (key === 'get') return async (reference: DocumentReference | Query) => {
        const isQuery = 'where' in reference;
        if (isQuery) queries.push(reference as unknown as CapturedQuery);
        else reads.push(reference.path);
        const result = await (target.get as (reference: DocumentReference | Query) => Promise<unknown>).call(target, reference);
        if (isQuery) querySizes.push((result as QuerySnapshot).docs.length);
        return isQuery && transform ? transform(result as QuerySnapshot, reference as unknown as CapturedQuery) : result;
      };
      if (key === 'set' || key === 'create' || key === 'delete') return () => { writes.push(key); throw new Error('Read must never write'); };
      return Reflect.get(target, key);
    } }) as Transaction);
  }, options) };
  return { db: observed, queries, reads, writes, querySizes, transactions: () => transactions };
}
async function replaceSource(f: Fixture, patch: Record<string, unknown>) { await f.db.collection('businesses').doc(businessId).collection('appointments').doc(sourceId).set({ ...item(sourceId), ...patch }); }

describe('owner account reservation read', () => {
  afterEach(() => vi.unstubAllEnvs());
  it('ownerOnlyIncludingSuperadmin', async () => {
    const f = scenario(); vi.stubEnv('SUPERADMIN_UID', 'demo-admin');
    for (const uid of ['demo-admin', clientUid, 'demo-chair', 'demo-other-owner']) await expect(read(f, undefined, 'all', f.db, { uid })).rejects.toMatchObject({ status: 403 });
    await expect(read(f)).resolves.toMatchObject({ scope: { businessId, sourceAppointmentId: sourceId, clientUid } });
    await f.db.collection('businesses').doc(businessId).set({ id: businessId, ownerUid: 'demo-new-owner', resources });
    await expect(read(f)).rejects.toMatchObject({ status: 403 });
  });
  it('sourceAppointmentProvesExactUidWithinTenant', async () => {
    const f = scenario([item('A'), item('B', { client: { ...make().client!, uid: 'demo-other-account' } })]);
    expect((await read(f)).rows.map(row => row.appointmentId)).toEqual(['A', sourceId]);
  });
  it('guessedUidCannotChooseAnotherAccount', async () => {
    const f = scenario();
    await expect(readOwnerClientRecord(owner, businessId, sourceId, { clientUid: 'demo-guessed', filter: 'all' }, f.db)).rejects.toMatchObject({ status: 404 });
  });
  it('wrongStoredIdOrTenantCannotRead', async () => {
    for (const patch of [{ id: 'other' }, { tenantId: 'other' }]) { const f = scenario(); await replaceSource(f, patch); await expect(read(f)).rejects.toMatchObject({ status: 404 }); }
    const f = scenario(); await f.db.collection('businesses').doc(businessId).set({ id: 'other', ownerUid: owner.uid, resources });
    await expect(read(f)).rejects.toMatchObject({ status: 404 });
  });
  it('manualBlockOrNoAccountCannotOpen', async () => {
    const f = scenario(); await replaceSource(f, { type: 'manual_block' }); await expect(read(f)).rejects.toMatchObject({ status: 404 });
    for (const client of [undefined, null, {}, { uid: '' }, { uid: `${clientUid}\n` }]) { await replaceSource(f, { client }); await expect(read(f)).rejects.toMatchObject({ status: 409, code: 'CLIENT_RECORD_NO_ACCOUNT' }); }
  });
  it('sameUidInAnotherTenantNeverAppears', async () => {
    const f = scenario(); await f.db.collection('businesses').doc('demo-foreign').collection('appointments').doc('foreign').set(item('foreign', { tenantId: 'demo-foreign' }));
    expect((await read(f)).rows.map(row => row.appointmentId)).toEqual(['A', sourceId]);
  });
  it('expiredPlanAndMissingNewConsentStillRead', async () => { expect((await read(scenario())).rows).toHaveLength(2); });
  it('readNeverWritesLocksPoliciesQuotaOrAudits', async () => {
    const f = scenario(), before = structuredClone(f.rows), observed = observe(f.db);
    const page = await read(f, undefined, 'all', observed.db);
    expect(ownerClientRecordPageSchema.safeParse(page).success).toBe(true);
    expect(observed.writes).toEqual([]); expect(f.rows).toEqual(before); expect(observed.transactions()).toBe(1);
    expect(observed.reads).toEqual([`businesses/${businessId}`, `${collection}/${sourceId}`]);
    expect(observed.queries.every(query => query.path === collection)).toBe(true);
    expect(JSON.stringify(page)).not.toMatch(/Synthetic|intakeAnswers|phone|email|subjectAuthorization|representationReview/);
  });
  it('completeIdAndUidStringsRejectControlsBeforeStorage', async () => {
    const f = scenario(), observed = observe(f.db);
    for (const [bid, sid] of [[`${businessId}\n`, sourceId], [businessId, `${sourceId}\n`]]) await expect(readOwnerClientRecord(owner, bid, sid, { clientUid, filter: 'all' }, observed.db)).rejects.toBeDefined();
    await expect(readOwnerClientRecord(owner, businessId, sourceId, { clientUid: `${clientUid}\n`, filter: 'all' }, observed.db)).rejects.toBeDefined();
    expect(observed.transactions()).toBe(0);
  });
});

describe('bounded compound pagination', () => {
  const rows = (count: number) => Array.from({ length: count }, (_, index) => item(`demo-${String(index).padStart(4, '0')}`, { startAt: start - index }));
  it('firstPage20PlusLookahead', async () => {
    const f = scenario(rows(30)), observed = observe(f.db), page = await read(f, undefined, 'all', observed.db);
    expect(page.rows).toHaveLength(20); expect(page.rows[0].appointmentId).toBe('demo-0000');
    expect(observed.queries.map(query => query.cap)).toEqual([21]);
    expect(observed.queries[0].ordering).toEqual([['startAt', 'desc'], ['id', 'asc']]);
    expect(observed.queries[0].filters).toEqual([['client.uid', '==', clientUid], ['type', '==', 'appointment']]);
  });
  it('fortyFiveRowsAre20_20_5', async () => {
    const appointments = rows(44), f = scenario(appointments), pages = []; let next: OwnerClientRecordCursor | undefined;
    do { const page = await read(f, next); pages.push(page); next = page.nextCursor ?? undefined; } while (next);
    expect(pages.map(page => page.rows.length)).toEqual([20, 20, 5]);
    expect(pages.flatMap(page => page.rows.map(row => row.appointmentId))).toEqual([...appointments.map(row => row.id), sourceId]);
  });
  it('moreThanTwentyEqualStartTimesDoNotDisappear', async () => {
    const ids = ['-a', 'A', 'Z', '_a', 'a', 'z', ...Array.from({ length: 22 }, (_, index) => `x${String(index).padStart(2, '0')}`)];
    const f = scenario(ids.map(id => item(id))), first = await read(f), second = await read(f, first.nextCursor!);
    expect([...first.rows, ...second.rows].map(row => row.appointmentId)).toEqual(['-a', 'A', 'Z', '_a', 'a', ...ids.slice(6), 'z', sourceId]);
  });
  it('sameDateTailPrecedesOlderTimes', async () => {
    const f = scenario([...rows(3), item('B'), item('Z')]), observed = observe(f.db);
    const page = await read(f, cursor(item('B')), 'all', observed.db);
    expect(page.rows.map(row => row.appointmentId)).toEqual(['Z', 'demo-0000', 'demo-0001', 'demo-0002', sourceId]);
    expect(observed.queries.map(query => query.cap)).toEqual([21, 19]);
    expect(observed.querySizes).toEqual([2, 3]);
    expect(observed.queries[0].filters).toContainEqual(['startAt', '==', start]); expect(observed.queries[0].filters).toContainEqual(['id', '>', 'B']);
    expect(observed.queries[0].ordering).toEqual([['id', 'asc']]);
    expect(observed.queries[1].filters).toContainEqual(['startAt', '<', start]);
  });
  it('lookaheadIsNotCursor', async () => {
    const f = scenario(rows(21)), first = await read(f), second = await read(f, first.nextCursor!);
    expect(first.nextCursor?.appointmentId).toBe('demo-0019'); expect(second.rows[0].appointmentId).toBe('demo-0020');
  });
  it('zeroLimitNeverIssued', async () => {
    const f = scenario(Array.from({ length: 45 }, (_, index) => item(`x${String(index).padStart(2, '0')}`))), first = await read(f), observed = observe(f.db);
    expect((await read(f, first.nextCursor!, 'all', observed.db)).rows).toHaveLength(20);
    expect(observed.queries.map(query => query.cap)).toEqual([21]);
  });
  it('moreThan1000RowsUseBoundedQueries', async () => {
    const f = scenario(rows(1001)), observed = observe(f.db), first = await read(f, undefined, 'all', observed.db);
    const second = await read(f, first.nextCursor!, 'all', observed.db);
    expect(second.rows[0].appointmentId).toBe('demo-0020'); expect(observed.queries.map(query => query.cap)).toEqual([21, 21, 21]);
    expect(observed.reads).toHaveLength(5); expect(observed.querySizes).toEqual([21, 0, 21]);
  });
  it('allIncludesCancelledAndFuture', async () => {
    const f = scenario([item('future', { startAt: start + 100000000000, status: 'cancelled_by_owner' }), item('cancelled', { status: 'cancelled_by_client' }), item('unknown', { status: 'legacy' as Appointment['status'] })]);
    const page = await read(f); expect(page.rows.map(row => [row.appointmentId, row.status])).toEqual([['future', 'cancelled_by_owner'], ['cancelled', 'cancelled_by_client'], ['unknown', 'unverified'], [sourceId, 'confirmed']]);
  });
  it('outcomeFilterMatchesStoredStatusExactly', async () => {
    const f = scenario([item('complete', { status: 'completed' }), item('missed', { status: 'no_show' }), item('past', { startAt: 1 })]);
    for (const [filter, id] of [['completed', 'complete'], ['no_show', 'missed']] as const) {
      const observed = observe(f.db); expect((await read(f, undefined, filter, observed.db)).rows.map(row => row.appointmentId)).toEqual([id]);
      expect(observed.queries[0].filters).toContainEqual(['status', '==', filter]);
    }
  });
});

describe('cursor integrity and unverifiable storage', () => {
  it('movedCorrectedDeletedOrForeignAnchor409', async () => {
    for (const patch of [null, { startAt: start + 1 }, { status: 'completed' }, { tenantId: 'foreign' }, { id: 'other' }, { client: { uid: 'foreign' } }, { type: 'manual_block' }, { rescheduleRevision: 1 }, { attendance: { revision: 1, lastEventId: 'demo-event' } }]) {
      const anchor = item('A'), f = scenario([anchor]), savedCursor = cursor(anchor), reference = f.db.collection('businesses').doc(businessId).collection('appointments').doc('A');
      if (patch === null) await reference.delete(); else await reference.set({ ...anchor, ...patch });
      await expect(read(f, savedCursor)).rejects.toMatchObject({ status: 409, code: 'CLIENT_RECORD_CHANGED' });
    }
    const anchor = item('A'), f = scenario([anchor]); await expect(read(f, cursor(anchor), 'completed')).rejects.toMatchObject({ status: 409, code: 'CLIENT_RECORD_CHANGED' });
  });
  it('forgedRevisionIsNotTrusted', async () => { const f = scenario(); await expect(read(f, { appointmentId: 'A', startAt: start, revision: '0'.repeat(64) })).rejects.toMatchObject({ status: 409, code: 'CLIENT_RECORD_CHANGED' }); });
  it('corruptRevisionDoesNotBecomeZero', async () => {
    for (const patch of [{ rescheduleRevision: -1 }, { rescheduleRevision: '1' }, { rescheduleRevision: null }, { rescheduleRevision: undefined }, { attendance: null }, { attendance: undefined }, { attendance: { revision: 1 } }]) {
      const corrupt = { ...item('A'), ...patch } as unknown as Appointment;
      expect(() => ownerClientRecordCursorRevision(corrupt)).toThrowError(expect.objectContaining({ status: 503, code: 'CLIENT_RECORD_UNVERIFIABLE' }));
      const f = scenario([corrupt]); await expect(read(f)).rejects.toMatchObject({ status: 503, code: 'CLIENT_RECORD_UNVERIFIABLE' });
    }
  });
  it('revisionUsesOnlyOrderedSpecTupleAndAbsentRevisionsAreZero', () => {
    // Python hashlib SHA-256 of {"id":"A","startAt":1894024800000,"status":"confirmed","rescheduleRevision":0,"attendanceRevision":0}.
    const appointment = item('A');
    expect(ownerClientRecordCursorRevision(appointment)).toBe('f88fcf06798f4c7e5274fefcffd408d979261f71c3d146099bfacad587d36fe4');
    expect(ownerClientRecordCursorRevision({ ...appointment, client: { ...appointment.client!, phone: 'different' }, price: 1 })).toBe(ownerClientRecordCursorRevision(appointment));
  });
  it('duplicateOrMisorderedRowsReject', async () => {
    for (const transform of [(snapshot: QuerySnapshot) => ({ ...snapshot, docs: [snapshot.docs[0], snapshot.docs[0]] }), (snapshot: QuerySnapshot) => ({ ...snapshot, docs: [...snapshot.docs].reverse() })]) {
      const f = scenario([item('A'), item('B')]), observed = observe(f.db, transform);
      await expect(read(f, undefined, 'all', observed.db)).rejects.toMatchObject({ status: 503, code: 'CLIENT_RECORD_UNVERIFIABLE' });
    }
  });
  it('queryErrorIsNotEmpty', async () => {
    const f = scenario(), observed = observe(f.db, () => { throw new Error('Synthetic index unavailable'); });
    await expect(read(f, undefined, 'all', observed.db)).rejects.toBeDefined();
  });
  it('missingOrderingFieldMayBeAbsentButCoverageNeverClaimsComplete', async () => {
    const f = scenario([]); await f.db.collection('businesses').doc(businessId).collection('appointments').doc('missing-start').set({ ...item('missing-start'), startAt: undefined });
    const noId = { ...item('missing-id') } as Partial<Appointment>; delete noId.id;
    await f.db.collection('businesses').doc(businessId).collection('appointments').doc('missing-id').set(noId);
    const observed = observe(f.db), page = await read(f, undefined, 'completed', observed.db);
    expect(page.rows).toEqual([]); expect(page.coverage).toEqual({ mode: 'indexed_appointments', completeness: 'not_guaranteed' }); expect(observed.queries).toHaveLength(1);
    expect((await read(f)).rows.map(row => row.appointmentId)).toEqual([sourceId]);
  });
  it('presentInvalidOrderingFieldFailsClosedWhenReturned', async () => {
    const f = scenario([item('invalid', { startAt: -1 })]); await expect(read(f)).rejects.toMatchObject({ status: 503, code: 'CLIENT_RECORD_UNVERIFIABLE' });
  });
  it('invalidLookaheadIsNeverSilentlyDropped', async () => {
    const f = scenario(Array.from({ length: 21 }, (_, index) => item(`x${String(index).padStart(2, '0')}`, index === 20 ? { rescheduleRevision: -1 } : {})));
    await expect(read(f)).rejects.toMatchObject({ status: 503, code: 'CLIENT_RECORD_UNVERIFIABLE' });
  });
  it('returnedRowsCannotEscapeScopeOrCursorOrFilter', async () => {
    for (const patch of [{ tenantId: 'foreign' }, { client: { uid: 'foreign' } }, { id: 'wrong' }, { type: 'manual_block' }, { startAt: start + 1 }]) {
      const anchor = item('A'), f = scenario([anchor, item('B')]), observed = observe(f.db, snapshot => ({ ...snapshot, docs: snapshot.docs.map(doc => ({ ...doc, data: () => ({ ...doc.data(), ...patch }) })) }));
      await expect(read(f, cursor(anchor), 'all', observed.db)).rejects.toMatchObject({ status: 503, code: 'CLIENT_RECORD_UNVERIFIABLE' });
    }
    const f = scenario([item('A', { status: 'completed' })]), observed = observe(f.db, snapshot => ({ ...snapshot, docs: snapshot.docs.map(doc => ({ ...doc, data: () => ({ ...doc.data(), status: 'confirmed' }) })) }));
    await expect(read(f, undefined, 'completed', observed.db)).rejects.toMatchObject({ status: 503, code: 'CLIENT_RECORD_UNVERIFIABLE' });
  });
});
