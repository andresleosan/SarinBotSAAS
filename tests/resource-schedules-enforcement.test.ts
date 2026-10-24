import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Database, Transaction } from '@/lib/storage/types';
import { createAppointment, createManualBlock, readAvailability } from '@/lib/server/bookings';
import { createBookingProposal, confirmBookingProposalDetailed } from '@/lib/server/booking-proposals';
import { readStructuredAvailability, readNextStructuredAvailability } from '@/lib/server/structured-booking';
import { createAppointmentRescheduleProposal, readAppointmentRescheduleAvailability } from '@/lib/server/appointment-rescheduling';
import { joinWaitlist, readWaitlist } from '@/lib/server/waitlist';
import { memoryFirestore } from './memoryFirestore';
import { acceptSyntheticConsent } from './consent-fixtures';
import { scheduleNow, seedScheduleFixture } from './resource-schedules-fixture';
const selection = { dateKey: '2030-01-07', startTimeStr: '10:00', serviceId: 's', resourceId: 'a' };
const contact = { clientPhone: '573001234567', intakeAnswers: {} };
const subjectCase = { bookingRequestId: 'demo-enforcement-case', subjectKind: 'self' as const };
beforeEach(() => { vi.spyOn(Date, 'now').mockReturnValue(scheduleNow); });
afterEach(() => { vi.restoreAllMocks(); });
async function fixture() {
  const memory = memoryFirestore(), db = memory.db as unknown as Database, f = await seedScheduleFixture(db);
  await acceptSyntheticConsent(db, f.owner.uid, f.business);
  const close = () => f.policyRef.set({ version: 1, businessId: f.business.id, revision: 1, updatedAt: scheduleNow, rules: { weekly: [], exceptions: [], closures: [{ id: 'closed', scope: 'business', fromDateKey: selection.dateKey, throughDateKey: selection.dateKey, interval: null, label: '' }] } });
  return { ...f, ...memory, db, close };
}
it('allAvailabilityPathsHonorResourceClosedDay', async () => {
  const f = await fixture(); await f.close();
  expect((await readAvailability(f.business, selection.dateKey, 's', 'a', f.db))[0].slots).toEqual([]);
  expect((await readStructuredAvailability(f.owner, f.business.id, { case: subjectCase, dateKey: selection.dateKey, serviceId: 's', resourceId: 'a' }, f.db))[0].slots).toEqual([]);
  await expect(createBookingProposal(f.owner, f.business.id, selection, 'demo-closed-proposal', f.db)).rejects.toMatchObject({ status: 409 });
  await expect(createAppointment(f.owner, f.business.id, { ...selection, ...contact }, 'demo-closed-booking', f.db)).rejects.toMatchObject({ status: 409 });
});
it('readAvailabilityUsesFreshCommonBusinessAndCorruptPolicyFailsExplicitly', async () => {
  const f = await fixture(); await f.ref.set({ ...f.business, weeklySchedule: {} });
  expect(await readAvailability(f.business, selection.dateKey, 's', 'a', f.db)).toEqual([]);
  await f.policyRef.set({ version: 99 });
  await expect(readAvailability(f.business, selection.dateKey, 's', 'a', f.db)).rejects.toMatchObject({ status: 503, code: 'RESOURCE_SCHEDULE_UNAVAILABLE' });
});
it('nextSkipsClosedDateWithoutExtraPolicyReadPerDay', async () => {
  const f = await fixture(); await f.close(); let reads = 0;
  const db: Database = { ...f.db, collection: f.db.collection.bind(f.db), runTransaction: callback => f.db.runTransaction(tx => callback({ ...tx, get: (async (ref: { path?: string }) => { if (ref.path?.endsWith('/resourceSchedulePolicies/current')) reads++; return tx.get(ref as never); }) as unknown as Transaction['get'] })) };
  expect(await readNextStructuredAvailability(f.owner, f.business.id, { case: subjectCase, afterDateKey: '2030-01-06', serviceId: 's', resourceId: 'a' }, db)).toMatchObject({ dateKey: '2030-01-14' });
  expect(reads).toBe(1);
});
it('waitlistDoesNotReportClosedSlotAvailable', async () => {
  const f = await fixture(); await f.close();
  const state = await joinWaitlist(f.owner, f.business.id, { requestId: 'demo-wait-closed', expectedRevision: 0, case: subjectCase, dateKey: selection.dateKey, serviceId: 's', resourceId: 'a' }, f.db);
  expect(state.request?.status).toBe('waiting');
  expect((await readWaitlist(f.owner, f.business.id, f.db)).request?.status).toBe('waiting');
});
it('proposalBeforeClosureCannotConfirmAfterClosure', async () => {
  const f = await fixture(), proposal = await createBookingProposal(f.owner, f.business.id, selection, 'demo-proposed-open', f.db); await f.close();
  const before = structuredClone([...f.rows]);
  await expect(confirmBookingProposalDetailed(f.owner, f.business.id, proposal.id, contact, f.db)).rejects.toMatchObject({ status: 409 });
  expect([...f.rows]).toEqual(before);
});
it('clientRescheduleDestinationRevalidatesPolicy', async () => {
  const f = await fixture(), source = await createAppointment(f.owner, f.business.id, { ...selection, ...contact }, 'demo-source-booking', f.db);
  const input = { appointmentId: source.id, sourceRevision: 0, requestId: 'demo-move-booking', selection: { dateKey: selection.dateKey, resourceId: 'a', startTimeStr: '11:00' } };
  const proposal = await createAppointmentRescheduleProposal(f.owner, f.business.id, input, f.db); await f.close();
  expect((await readAppointmentRescheduleAvailability(f.owner, f.business.id, { appointmentId: source.id, sourceRevision: 0, dateKey: selection.dateKey, resourceId: 'a' }, f.db))[0].slots).toEqual([]);
  await expect(confirmBookingProposalDetailed(f.owner, f.business.id, proposal.id, { clientPhone: null, intakeAnswers: {} }, f.db)).rejects.toMatchObject({ status: 409 });
  expect((await f.ref.collection('appointments').doc(source.id).get()).data()).toEqual(source);
  await expect(createAppointmentRescheduleProposal(f.owner, f.business.id, { ...input, requestId: 'demo-move-after-closure' }, f.db)).rejects.toMatchObject({ status: 409 });
});
it('closurePreservesCommittedAppointmentAndItsReplay', async () => {
  const f = await fixture(), proposal = await createBookingProposal(f.owner, f.business.id, selection, 'demo-replay-open', f.db);
  const first = await confirmBookingProposalDetailed(f.owner, f.business.id, proposal.id, contact, f.db); await f.close();
  expect(await confirmBookingProposalDetailed(f.owner, f.business.id, proposal.id, contact, f.db)).toEqual(first);
});
it('manualBlockOutsideShiftRetainsContract', async () => {
  const f = await fixture(); await f.close();
  expect(await createManualBlock(f.owner, f.business.id, { dateKey: selection.dateKey, startTimeStr: '18:00', endTimeStr: '19:00', resourceId: 'a', requestId: 'demo-outside-block' }, f.db)).toMatchObject({ type: 'manual_block', startTimeStr: '18:00' });
});
