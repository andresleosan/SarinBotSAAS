import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Appointment } from '@/types/firestore';
import type { BookingSubjectCase } from '@/lib/booking-subject';
import { toColombiaTimestamp } from '@/lib/sarin/availability';
import { createAppointmentRescheduleProposal, readAppointmentRescheduleAvailability } from '@/lib/server/appointment-rescheduling';
import { confirmBookingProposalDetailed, createBookingProposal, proposalRequestKey } from '@/lib/server/booking-proposals';
import { saveBookingDataPolicy } from '@/lib/server/booking-data-policy';
import { readBookingSubjectConsent, updateBookingSubjectConsent } from '@/lib/server/booking-subject-consent';
import { memoryFirestore } from './memoryFirestore';
import { consentedFirestore, acceptSyntheticSubjectConsent } from './consent-fixtures';
import { subjectAdmin, subjectFixture } from './represented-booking-contract';
import { rescheduleActor, rescheduleBusiness, rescheduleContact, rescheduleNow, rescheduleSelection, rescheduleSource, rescheduleSourcePath } from './appointment-reschedule-contract';

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(rescheduleNow); vi.stubEnv('SUPERADMIN_UID', subjectAdmin.uid); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });
async function knownSource(mode: 'general' | 'health' = 'health', minors = true, represented = true) {
  const { db, rows } = memoryFirestore(), f = await subjectFixture(db, mode, minors, 10);
  const beneficiary = represented ? f.beneficiary : { kind: 'self' as const };
  const source: Appointment = { ...rescheduleSource, id: 'demo-known-source', tenantId: f.business.id, serviceId: 'cut', resourceId: 'one', dateKey: f.selection.dateKey, startAt: toColombiaTimestamp(f.selection.dateKey, '09:00'), endAt: toColombiaTimestamp(f.selection.dateKey, '09:30'), reservedUntilAt: toColombiaTimestamp(f.selection.dateKey, '09:30'), client: { ...rescheduleSource.client!, uid: f.actor.uid }, beneficiary,
    subjectAuthorization: { receiptId: 'demo-original-receipt', bookingRequestId: 'demo-original-case', policyRevision: 1 },
    ...(represented ? { representationReview: { revision: 7, status: 'needs_contact' as const, reviewedBy: f.owner.uid, reviewedAt: rescheduleNow - 1000 } } : {}),
  };
  await db.collection('businesses').doc(f.business.id).collection('appointments').doc(source.id).set(source);
  const requestId = `demo-change-${crypto.randomUUID()}`, subjectCase: BookingSubjectCase = represented ? { ...f.subjectCase, bookingRequestId: requestId } : { bookingRequestId: requestId, subjectKind: 'self' };
  const input = { appointmentId: source.id, sourceRevision: 0, requestId, selection: { dateKey: source.dateKey, startTimeStr: '10:00', resourceId: 'two' }, case: subjectCase };
  return { ...f, db, rows, source, beneficiary, subjectCase, input };
}

it('rejects a legacy confirmation when the durable request mapping changes its source binding', async () => {
  const { db } = consentedFirestore({ [`businesses/${rescheduleBusiness.id}`]: rescheduleBusiness as unknown as Record<string, unknown>, [rescheduleSourcePath]: rescheduleSource as unknown as Record<string, unknown> }, [rescheduleActor.uid]);
  const proposal = await createBookingProposal(rescheduleActor, rescheduleBusiness.id, rescheduleSelection, 'demo-map-integrity', db, undefined, { appointmentId: rescheduleSource.id, sourceRevision: 0 });
  const ref = db.collection('bookingProposals').doc(proposalRequestKey(rescheduleActor.uid, rescheduleBusiness.id, 'demo-map-integrity')), saved = (await ref.get()).data()!;
  await ref.set({ ...saved, reschedule: { ...saved.reschedule, sourceRevision: 8 } });
  await expect(confirmBookingProposalDetailed(rescheduleActor, rescheduleBusiness.id, proposal.id, rescheduleContact, db)).rejects.toMatchObject({ status: 503 });
  expect((await db.collection('businesses').doc(rescheduleBusiness.id).collection('appointments').doc(rescheduleSource.id).get()).data()).toEqual(rescheduleSource);
});

// Characterization of the new bounded reschedule flow, added after the first core RED/GREEN cycle.
it.each([
  ['general', false, false], ['general', true, true], ['health', false, false], ['health', true, true],
] as const)('preserves canonical subject, review and original authorization for %s/minors=%s/represented=%s', async (mode, minors, represented) => {
  const f = await knownSource(mode, minors, represented);
  if (mode === 'health' || represented) await expect(createAppointmentRescheduleProposal(f.actor, f.business.id, f.input, f.db)).rejects.toMatchObject({ status: 428 });
  await acceptSyntheticSubjectConsent(f.db, f.actor, f.business, f.subjectCase, f.policy);
  const availability = await readAppointmentRescheduleAvailability(f.actor, f.business.id, { appointmentId: f.source.id, sourceRevision: 0, dateKey: f.source.dateKey, case: f.subjectCase }, f.db);
  expect(availability.find(item => item.resourceId === 'one')?.slots).toContain('09:00');
  const proposal = await createAppointmentRescheduleProposal(f.actor, f.business.id, f.input, f.db);
  const savedProposal = (await f.db.collection('bookingProposals').doc(proposal.id).get()).data();
  expect(JSON.stringify(savedProposal)).not.toMatch(/SYNTHETIC_PRIVATE_SUBJECT|original@example|Respuesta histórica|573001234567/);
  const confirmed = await confirmBookingProposalDetailed(f.actor, f.business.id, proposal.id, { ...rescheduleContact, beneficiary: f.beneficiary }, f.db);
  expect(confirmed.appointment).toMatchObject({ id: 'demo-known-source', resourceId: 'two', startTimeStr: '10:00', client: f.source.client, beneficiary: f.beneficiary, subjectAuthorization: f.source.subjectAuthorization, createdAt: f.source.createdAt, createdBy: f.source.createdBy });
  expect(confirmed.appointment.representationReview).toEqual(f.source.representationReview);
  expect((await f.db.collection('businesses').doc(f.business.id).get()).data()?.subscription.paidTrial.appointmentsUsed).toBe(10);
  if (mode === 'health' || represented) {
    const current = await readBookingSubjectConsent(f.actor, f.business.id, f.subjectCase, f.db);
    await updateBookingSubjectConsent(f.actor, { businessId: f.business.id, case: f.subjectCase, action: 'revoke', expectedRevision: current.revision, requestId: 'demo-revoke-after-move' }, f.db);
  }
  expect(await confirmBookingProposalDetailed(f.actor, f.business.id, proposal.id, {} as never, f.db)).toEqual(confirmed);
  expect([...f.rows.keys()].filter(path => /responseQuota|aiBudget|aiUsage|chatStates/.test(path))).toHaveLength(0);
});

it('keeps current general intake questions as a catalogue snapshot without recollecting historical answers', async () => {
  const f = await knownSource('general', false, false);
  const business = { ...f.business, sarinConfig: { ...f.business.sarinConfig, intakeFields: [{ key: 'new_required', label: 'Pregunta vigente', required: true }] } };
  await f.db.collection('businesses').doc(f.business.id).set(business);
  const proposal = await createAppointmentRescheduleProposal(f.actor, f.business.id, f.input, f.db);
  expect(proposal.intakeFields).toEqual([{ key: 'new_required', label: 'Pregunta vigente', required: true }]);
  const result = await confirmBookingProposalDetailed(f.actor, f.business.id, proposal.id, { ...rescheduleContact, beneficiary: f.beneficiary }, f.db);
  expect(result.appointment.client).toEqual(f.source.client);
});

it('rejects omitted cases, altered subject kind, altered roles and reuse of the original booking case', async () => {
  const f = await knownSource();
  for (const subjectCase of [undefined, { bookingRequestId: f.input.requestId, subjectKind: 'self' }, { ...f.subjectCase, representativeRole: 'legal_guardian' }, { ...f.subjectCase, bookingRequestId: 'demo-original-case' }]) {
    await expect(createAppointmentRescheduleProposal(f.actor, f.business.id, { ...f.input, case: subjectCase } as never, f.db)).rejects.toMatchObject({ status: 409 });
  }
  await expect(createAppointmentRescheduleProposal(f.actor, f.business.id, { ...f.input, requestId: 'demo-other-request' }, f.db)).rejects.toMatchObject({ code: 'BOOKING_SUBJECT_CONFLICT' });
  expect((await f.db.collection('businesses').doc(f.business.id).collection('appointments').doc(f.source.id).get()).data()).toEqual(f.source);
});

it('rejects altered beneficiary, fresh answers and phone at confirmation without changing the source', async () => {
  const f = await knownSource(); await acceptSyntheticSubjectConsent(f.db, f.actor, f.business, f.subjectCase, f.policy);
  const proposal = await createAppointmentRescheduleProposal(f.actor, f.business.id, f.input, f.db);
  for (const body of [
    { ...rescheduleContact, beneficiary: { ...f.beneficiary, displayName: 'Other synthetic minor' } },
    { ...rescheduleContact, beneficiary: f.beneficiary, intakeAnswers: { reason: 'SYNTHETIC_PRIVATE_ANSWER' } },
    { ...rescheduleContact, beneficiary: f.beneficiary, clientPhone: '573009999999' },
  ]) await expect(confirmBookingProposalDetailed(f.actor, f.business.id, proposal.id, body, f.db)).rejects.toBeDefined();
  expect((await f.db.collection('businesses').doc(f.business.id).collection('appointments').doc(f.source.id).get()).data()).toEqual(f.source);
});

it('revalidates fresh subject withdrawal and disabling minors before confirming', async () => {
  const f = await knownSource(); await acceptSyntheticSubjectConsent(f.db, f.actor, f.business, f.subjectCase, f.policy);
  const proposal = await createAppointmentRescheduleProposal(f.actor, f.business.id, f.input, f.db);
  const current = await readBookingSubjectConsent(f.actor, f.business.id, f.subjectCase, f.db);
  await updateBookingSubjectConsent(f.actor, { businessId: f.business.id, case: f.subjectCase, action: 'revoke', expectedRevision: current.revision, requestId: 'demo-withdraw-before-change' }, f.db);
  await expect(confirmBookingProposalDetailed(f.actor, f.business.id, proposal.id, { ...rescheduleContact, beneficiary: f.beneficiary }, f.db)).rejects.toMatchObject({ status: 428 });
  await saveBookingDataPolicy(subjectAdmin, { businessId: f.business.id, expectedRevision: 1, dataMode: 'health', representedMinorsEnabled: false, reason: 'Demo restrict minors' }, f.db);
  await expect(confirmBookingProposalDetailed(f.actor, f.business.id, proposal.id, { ...rescheduleContact, beneficiary: f.beneficiary }, f.db)).rejects.toMatchObject({ code: 'REPRESENTED_BOOKING_DISABLED' });
  expect((await f.db.collection('businesses').doc(f.business.id).collection('appointments').doc(f.source.id).get()).data()).toEqual(f.source);
});

it('rejects corrupt modern request binding instead of treating it as another valid subject case', async () => {
  const f = await knownSource(); await acceptSyntheticSubjectConsent(f.db, f.actor, f.business, f.subjectCase, f.policy);
  const proposal = await createAppointmentRescheduleProposal(f.actor, f.business.id, f.input, f.db);
  const ref = f.db.collection('bookingProposals').doc(proposalRequestKey(f.actor.uid, f.business.id, f.input.requestId)), saved = (await ref.get()).data()!;
  await ref.set({ ...saved, reschedule: { ...saved.reschedule, sourceRevision: 7 } });
  await expect(confirmBookingProposalDetailed(f.actor, f.business.id, proposal.id, { ...rescheduleContact, beneficiary: f.beneficiary }, f.db)).rejects.toMatchObject({ status: 503 });
});
