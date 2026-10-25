import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createDataTestRuntime } from '../cloudflare/tests/data-runtime.mjs';
import { createCloudflareDatabase, StorageError } from '@/lib/storage/database';
import type { Database, DocumentReference, Transaction } from '@/lib/storage/types';
import type { DataCommand, DataReadResult, DataCommitResult } from '../shared/data-protocol';
import { prepareOwnerReschedule, readOwnerRescheduleSource, readOwnerRescheduleProposal, confirmOwnerReschedule } from '@/lib/server/owner-rescheduling';
import { createAppointment, createManualBlock, cancelAppointment } from '@/lib/server/bookings';
import { createAppointmentRescheduleProposal } from '@/lib/server/appointment-rescheduling';
import { confirmBookingProposalDetailed } from '@/lib/server/booking-proposals';
import { updateAppointmentAttendance } from '@/lib/server/appointment-attendance';
import { updateRepresentationReview } from '@/lib/server/representation-review';
import { bookingDataPolicyKey } from '@/lib/server/booking-data-policy';
import { emptyResourceSchedulePolicy } from '@/lib/resource-schedules';
import { ownerRescheduleActor as owner, ownerRescheduleBusiness as business, ownerRescheduleSource as original, ownerRescheduleSelection as selection, ownerRescheduleNow as now, ownerReschedulePath, seedOwnerRescheduleScenario, verifyOwnerRescheduleMove, verifyOwnerRescheduleRaces, verifyOwnerRescheduleReplay } from './owner-rescheduling-contract';

let runtime: Awaited<ReturnType<typeof createDataTestRuntime>>, db: Database, secondDb: Database;
let dropResponse = false;
const lostCommits: Extract<DataCommand, { action: 'commit' }>[] = [];
const connect = (instance: typeof runtime) => createCloudflareDatabase(async command => {
  const response = await instance.fetch(command), value = await response.json() as DataReadResult | DataCommitResult;
  if (!response.ok) throw new StorageError(response.status, (value as unknown as { code: string }).code);
  if (dropResponse && command.action === 'commit' && command.writes.some(write => write.path === ownerReschedulePath)) {
    lostCommits.push(structuredClone(command)); if (lostCommits.length === 1) throw new StorageError(503, 'DATA_UNAVAILABLE');
  }
  return value;
});
const sourceRef = () => db.collection('businesses').doc(business.id).collection('appointments').doc(original.id);
async function proposal(handle = db, requestId = 'demo-request') {
  const source = await readOwnerRescheduleSource(owner, business.id, original.id, handle);
  return (await prepareOwnerReschedule(owner, business.id, original.id, { ...source.expectation, requestId, selection }, handle)).proposal;
}
function pauseRead(handle: Database, matches: (path: string) => boolean) {
  let release!: () => void, enter!: () => void, used = false;
  const entered = new Promise<void>(resolve => { enter = resolve; }), resume = new Promise<void>(resolve => { release = resolve; });
  const paused: Database = { collection: name => handle.collection(name), runTransaction: (callback, options) => handle.runTransaction(tx => callback(new Proxy(tx, {
    get(target, key) {
      if (key === 'get') return async (ref: DocumentReference) => { const value = await target.get(ref); if (!used && matches(ref.path)) { used = true; enter(); await resume; } return value; };
      return Reflect.get(target, key);
    },
  }) as Transaction), options) };
  return { db: paused, entered, release };
}
beforeEach(async () => {
  vi.spyOn(Date, 'now').mockReturnValue(now); dropResponse = false; lostCommits.length = 0;
  runtime = await createDataTestRuntime(); db = connect(runtime); secondDb = connect(runtime);
}, 30000);
afterEach(async () => { await runtime?.dispose(); vi.restoreAllMocks(); });

it('owner D1 moves one ID across day/resource with all three locks and unchanged quota', async () => { await verifyOwnerRescheduleMove(db, secondDb); }, 60000);
it('owner D1 serializes two proposals of one source', async () => { await verifyOwnerRescheduleRaces(db, secondDb); }, 60000);
it('owner D1 retains original proof through later moves and cancellation', async () => { await verifyOwnerRescheduleReplay(db, secondDb); }, 60000);
it.each(['booking', 'block', 'cancel', 'client'] as const)('owner D1 serializes a destination/source %s competitor', async kind => {
  await seedOwnerRescheduleScenario(db); const prepared = await proposal();
  const competing = () => kind === 'booking' ? createAppointment({ uid: 'demo-other-client' }, business.id, { ...selection, serviceId: 'demo-cut', clientPhone: '573001111111', intakeAnswers: {} }, 'demo-competing-booking', secondDb)
    : kind === 'block' ? createManualBlock(owner, business.id, { ...selection, endTimeStr: '10:30', requestId: 'demo-competing-block' }, secondDb)
    : kind === 'cancel' ? cancelAppointment(owner, business.id, original.id, secondDb)
    : createAppointmentRescheduleProposal({ uid: 'demo-client' }, business.id, { appointmentId: original.id, sourceRevision: 0, requestId: 'demo-competing-client', selection: { ...selection, startTimeStr: '11:00' } }, secondDb)
      .then(value => confirmBookingProposalDetailed({ uid: 'demo-client' }, business.id, value.id, { clientPhone: null, intakeAnswers: {} }, secondDb));
  const results = await Promise.allSettled([confirmOwnerReschedule(owner, business.id, prepared.id, db), competing()]);
  expect(results.some(value => value.status === 'fulfilled')).toBe(true);
  const source = (await sourceRef().get()).data()!; expect(source.client).toEqual(original.client);
  if (kind === 'booking' || kind === 'block') {
    expect(results.filter(value => value.status === 'fulfilled')).toHaveLength(1);
    const rows = await db.collection('businesses').doc(business.id).collection('appointments').get();
    expect(rows.docs.map(row => row.data()).filter(row => row.status === 'confirmed' && row.resourceId === 'demo-chair' && row.startAt < 1894030200000 && row.reservedUntilAt > 1894028400000)).toHaveLength(1);
  } else if (kind === 'cancel') { expect(source.status).toBe('cancelled_by_owner'); expect(source.rescheduleRevision ?? 0).toBe(results[0].status === 'fulfilled' ? 1 : 0); }
  else { expect(source.rescheduleRevision).toBe(1); expect(['10:00', '11:00']).toContain(source.startTimeStr); expect(results.filter(value => value.status === 'fulfilled')).toHaveLength(1); }
}, 60000);

it.each(['catalog', 'schedule', 'policy'] as const)('owner D1 revalidates a concurrent %s transaction before committing', async kind => {
  await seedOwnerRescheduleScenario(db); const prepared = await proposal();
  const pause = pauseRead(db, path => path?.includes('/bookingLocks/')), moving = confirmOwnerReschedule(owner, business.id, prepared.id, pause.db);
  await pause.entered;
  try {
    await secondDb.runTransaction(async tx => {
      const businessRef = secondDb.collection('businesses').doc(business.id); const snapshot = await tx.get(businessRef);
      if (kind === 'catalog') tx.set(businessRef, { ...snapshot.data(), services: [{ ...business.services[0], price: 26000 }] });
      if (kind === 'schedule') tx.set(businessRef.collection('resourceSchedulePolicies').doc('current'), { ...emptyResourceSchedulePolicy(business.id), revision: 1, updatedAt: now });
      if (kind === 'policy') tx.set(secondDb.collection('serverSettings').doc(bookingDataPolicyKey(business.id)), { version: 1, revision: 1, businessId: business.id, dataMode: 'health', representedMinorsEnabled: false, reason: 'Prueba', updatedAt: now, updatedBy: owner.uid });
    });
  } finally { pause.release(); }
  await expect(moving).rejects.toMatchObject({ status: 409 }); expect((await sourceRef().get()).data()).toEqual(original);
  expect((await db.collection('businesses').doc(business.id).collection('bookingLocks').get()).size).toBe(0);
}, 60000);

it('owner D1 preserves real attendance and representation decisions over stale proposals', async () => {
  await seedOwnerRescheduleScenario(db); const prepared = await proposal();
  vi.mocked(Date.now).mockReturnValue(original.reservedUntilAt);
  await updateAppointmentAttendance(owner, business.id, original.id, { requestId: 'demo-attendance', expectedRevision: 0, expectedRescheduleRevision: 0, expectedStatus: 'confirmed', status: 'completed' }, secondDb);
  await expect(confirmOwnerReschedule(owner, business.id, prepared.id, db)).rejects.toMatchObject({ status: 409 });
  expect((await sourceRef().get()).data()).toMatchObject({ status: 'completed', attendance: { revision: 1 } });
  vi.mocked(Date.now).mockReturnValue(now); await seedOwnerRescheduleScenario(db);
  const second = await proposal(db, 'demo-representation');
  await sourceRef().set({ ...original, beneficiary: { kind: 'represented_minor', displayName: 'Persona sintética', representativeRole: 'parent' }, representationReview: { revision: 0, status: 'declared', reviewedBy: null, reviewedAt: null } });
  await updateRepresentationReview(owner, business.id, original.id, { expectedRevision: 0, status: 'reviewed' }, secondDb);
  await expect(confirmOwnerReschedule(owner, business.id, second.id, db)).rejects.toMatchObject({ status: 409 });
  expect((await sourceRef().get()).data()).toMatchObject({ representationReview: { revision: 1, status: 'reviewed' } });
}, 60000);

it('owner D1 retries exactly the journaled commit after response loss', async () => {
  await seedOwnerRescheduleScenario(db); const prepared = await proposal(); dropResponse = true;
  const applied = await confirmOwnerReschedule(owner, business.id, prepared.id, db);
  expect(lostCommits).toHaveLength(2); expect(lostCommits[1]).toEqual(lostCommits[0]);
  const replay = await confirmOwnerReschedule(owner, business.id, prepared.id, secondDb);
  expect(replay).toEqual({ ...applied, replayed: true }); expect(replay.appointment.rescheduleRevision).toBe(1);
  expect((await db.collection('businesses').doc(business.id).collection('ownerRescheduleProposals').get()).size).toBe(1);
}, 60000);

it('owner D1 durably closes expiry against an older confirmation and GET never invents terminal state', async () => {
  await seedOwnerRescheduleScenario(db); const prepared = await proposal();
  const pause = pauseRead(db, path => path?.includes('/bookingLocks/')), moving = confirmOwnerReschedule(owner, business.id, prepared.id, pause.db);
  await pause.entered;
  try {
    vi.mocked(Date.now).mockReturnValue(now + 600001);
    expect(await readOwnerRescheduleProposal(owner, business.id, prepared.id, secondDb)).toMatchObject({ state: 'prepared' });
    await expect(confirmOwnerReschedule(owner, business.id, prepared.id, secondDb)).rejects.toMatchObject({ code: 'OWNER_RESCHEDULE_PROPOSAL_CLOSED' });
  } finally { pause.release(); }
  await expect(moving).rejects.toMatchObject({ code: 'OWNER_RESCHEDULE_PROPOSAL_CLOSED' });
  expect(await readOwnerRescheduleProposal(owner, business.id, prepared.id, secondDb)).toMatchObject({ state: 'closed', result: null });
  expect((await sourceRef().get()).data()).toEqual(original);
}, 60000);

it('previous owner-reschedule-unaware Worker fails closed without partial appointment or fallback', async () => {
  const previous = await createDataTestRuntime({ previousOwnerRescheduleChildren: true });
  try {
    const oldDb = connect(previous); await seedOwnerRescheduleScenario(oldDb);
    await expect(proposal(oldDb)).rejects.toMatchObject({ code: 'DATA_INVALID' });
    expect((await oldDb.collection('businesses').doc(business.id).collection('appointments').doc(original.id).get()).data()).toEqual(original);
    expect((await db.collection('businesses').doc(business.id).get()).exists).toBe(false);
  } finally { await previous.dispose(); }
}, 60000);
