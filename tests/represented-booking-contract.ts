import { expect } from 'vitest';
import type { Database } from '@/lib/storage/types';
import type { Business } from '@/types/firestore';
import type { BookingSubjectCase } from '@/lib/booking-subject';
import { privateBusinessDraft, publicBusiness } from '@/lib/server/businesses';
import { saveBookingDataPolicy } from '@/lib/server/booking-data-policy';
import { createStructuredBookingProposal, readStructuredAvailability } from '@/lib/server/structured-booking';
import { createBookingProposal, confirmBookingProposal } from '@/lib/server/booking-proposals';
import { cancelAppointment, createAppointment } from '@/lib/server/bookings';
import { bookingSubjectStateKey, readBookingSubjectConsent, updateBookingSubjectConsent } from '@/lib/server/booking-subject-consent';
import { acceptSyntheticConsent, acceptSyntheticSubjectConsent } from './consent-fixtures';
export const subjectAdmin = { uid: 'demo-subject-admin' };
export const contact = { clientPhone: '573001234567', intakeAnswers: {} };
export async function subjectFixture(db: Database, dataMode: 'general' | 'health' = 'health', minors = true, used = 0) {
  const token = crypto.randomUUID(), owner = { uid: `demo-owner-${token}` }, actor = { uid: `demo-client-${token}`, name: 'Adulto demo' };
  const business: Business = { ...privateBusinessDraft(owner, Date.now()), id: `demo-${token}`, slug: `demo-${token}`, name: 'Negocio demo', phoneWhatsApp: contact.clientPhone,
    subscription: { status: 'trial' as const, trialEndsAt: 0, currentPeriodEndsAt: 0, paidTrial: { paymentId: 'demo-paid', activatedAt: Date.now(), appointmentLimit: 10, appointmentsUsed: used } },
    sarinConfig: { onboardingCompleted: true, tone: '', customRules: '', intakeFields: [] },
    resources: [{ id: 'one', name: 'Uno', active: true }, { id: 'two', name: 'Dos', active: true }],
    services: [{ id: 'cut', name: dataMode === 'health' ? 'Consulta demo' : 'Corte demo', durationMinutes: 30, bufferMinutes: 0, price: 20000, resourceIds: ['one', 'two'] }],
    weeklySchedule: Object.fromEntries(Array.from({ length: 7 }, (_, day) => [day, { isOpen: true, intervals: [{ start: '09:00', end: '17:00' }] }])),
  };
  await db.collection('businesses').doc(business.id).set(business); await db.collection('publicBusinesses').doc(business.slug).set(publicBusiness(business));
  await acceptSyntheticConsent(db, actor.uid, business);
  const policy = await saveBookingDataPolicy(subjectAdmin, { businessId: business.id, expectedRevision: 0, dataMode, representedMinorsEnabled: minors, reason: 'Demo contractual test' }, db);
  const subjectCase: BookingSubjectCase = { bookingRequestId: `demo-case-${token}`, subjectKind: 'represented_minor', representativeRole: 'parent' };
  const beneficiary = { kind: 'represented_minor' as const, displayName: 'SYNTHETIC_PRIVATE_SUBJECT', representativeRole: 'parent' as const };
  const selection = { serviceId: 'cut', resourceId: 'one', dateKey: new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(Date.now() + 2 * 86400000), startTimeStr: '09:00' };
  return { owner, actor, business, policy, subjectCase, beneficiary, selection };
}
export async function verifyStructuredCases(db: Database, secondDb = db) {
  for (const [mode, minors, represented] of [['general', false, false], ['general', true, true], ['health', true, true], ['health', false, false]] as const) {
    const f = await subjectFixture(db, mode, minors), subjectCase: BookingSubjectCase = represented ? f.subjectCase : { bookingRequestId: f.subjectCase.bookingRequestId, subjectKind: 'self' }, beneficiary = represented ? f.beneficiary : { kind: 'self' as const };
    const request = { case: subjectCase, beneficiary, selection: f.selection };
    if (mode === 'health' || represented) await expect(createStructuredBookingProposal(f.actor, f.business.id, request, db)).rejects.toMatchObject({ status: 428 });
    await acceptSyntheticSubjectConsent(db, f.actor, f.business, subjectCase, f.policy);
    const slots = await readStructuredAvailability(f.actor, f.business.id, { case: subjectCase, dateKey: f.selection.dateKey, serviceId: 'cut' }, secondDb);
    expect(slots[0].slots).toContain('09:00');
    const proposal = await createStructuredBookingProposal(f.actor, f.business.id, request, db);
    expect(proposal.expiresAt - Date.now()).toBeGreaterThan(590000);
    expect(await createStructuredBookingProposal(f.actor, f.business.id, request, secondDb)).toEqual(proposal);
    const allProposals = await db.collection('bookingProposals').get();
    expect(JSON.stringify(allProposals.docs.map(doc => doc.data()))).not.toContain('SYNTHETIC_PRIVATE_SUBJECT');
    const [first, replay] = await Promise.all([confirmBookingProposal(f.actor, f.business.id, proposal.id, { ...contact, beneficiary }, db), confirmBookingProposal(f.actor, f.business.id, proposal.id, { ...contact, beneficiary }, secondDb)]);
    expect(first.id).toBe(replay.id); expect(first.client?.uid).toBe(f.actor.uid); expect(first.beneficiary).toEqual(beneficiary);
    if (represented) expect(first.representationReview).toEqual({ revision: 0, status: 'declared', reviewedBy: null, reviewedAt: null });
    if (mode === 'health' || represented) expect(first.subjectAuthorization).toMatchObject({ bookingRequestId: subjectCase.bookingRequestId, policyRevision: 1 });
    else expect(first.subjectAuthorization).toBeUndefined();
    expect((await secondDb.collection('businesses').doc(f.business.id).get()).data()?.subscription.paidTrial.appointmentsUsed).toBe(1);
    expect((await secondDb.collection('businesses').doc(f.business.id).collection('appointments').get()).size).toBe(1);
    expect(JSON.stringify((await secondDb.collection('publicBusinesses').doc(f.business.slug).get()).data())).not.toContain('SYNTHETIC_PRIVATE_SUBJECT');
    if (mode === 'health' || represented) {
      const state = await readBookingSubjectConsent(f.actor, f.business.id, subjectCase, db);
      await updateBookingSubjectConsent(f.actor, { businessId: f.business.id, case: subjectCase, action: 'revoke', expectedRevision: state.revision, requestId: 'demo-revoke-after-confirm' }, db);
      expect(await confirmBookingProposal(f.actor, f.business.id, proposal.id, {} as never, secondDb)).toEqual(first);
    }
    await cancelAppointment(f.actor, f.business.id, first.id, secondDb);
    expect((await confirmBookingProposal(f.actor, f.business.id, proposal.id, {} as never, db)).status).toBe('cancelled_by_client');
  }
  for (const collection of ['responseQuotaTurns', 'aiBudgetCalls', 'aiBudgetPeriods']) expect((await db.collection(collection).get()).empty).toBe(true);
  const f = await subjectFixture(db);
  await acceptSyntheticSubjectConsent(db, f.actor, f.business, f.subjectCase, f.policy);
  const proposal = await createStructuredBookingProposal(f.actor, f.business.id, { case: f.subjectCase, beneficiary: f.beneficiary, selection: f.selection }, db);
  const ref = db.collection('bookingProposals').doc(proposal.id), beforeClose = Date.now();
  await ref.set({ ...(await ref.get()).data(), expiresAt: beforeClose - 1 });
  for (const handle of [db, secondDb]) await expect(confirmBookingProposal(f.actor, f.business.id, proposal.id, { ...contact, beneficiary: f.beneficiary }, handle)).rejects.toMatchObject({ code: 'BOOKING_PROPOSAL_CLOSED' });
  expect((await secondDb.collection('bookingProposals').doc(proposal.id).get()).data()?.closedAt).toBeGreaterThanOrEqual(beforeClose);
  expect((await secondDb.collection('businesses').doc(f.business.id).collection('appointments').get()).empty).toBe(true);
}
export async function verifySubjectBindingAndWithdrawal(db: Database, secondDb = db) {
  const f = await subjectFixture(db); await acceptSyntheticSubjectConsent(db, f.actor, f.business, f.subjectCase, f.policy);
  const request = { case: f.subjectCase, beneficiary: f.beneficiary, selection: f.selection }, proposal = await createStructuredBookingProposal(f.actor, f.business.id, request, db);
  await expect(createStructuredBookingProposal(f.actor, f.business.id, { ...request, beneficiary: { ...f.beneficiary, displayName: 'Other demo child' } }, secondDb)).rejects.toMatchObject({ status: 409 });
  await expect(createStructuredBookingProposal(f.actor, f.business.id, { ...request, selection: { ...f.selection, startTimeStr: '10:00' } }, secondDb)).rejects.toMatchObject({ status: 409 });
  await expect(confirmBookingProposal(f.actor, f.business.id, proposal.id, { ...contact, beneficiary: { ...f.beneficiary, displayName: 'Other demo child' } }, secondDb)).rejects.toMatchObject({ status: 409 });
  await expect(createStructuredBookingProposal(f.actor, f.business.id, { ...request, case: { ...f.subjectCase, representativeRole: 'legal_guardian' }, beneficiary: { ...f.beneficiary, representativeRole: 'legal_guardian' } }, secondDb)).rejects.toMatchObject({ status: 409 });
  await expect(createStructuredBookingProposal({ uid: 'demo-other' }, f.business.id, request, db)).rejects.toMatchObject({ status: 428 });
  await expect(createAppointment(f.actor, f.business.id, { ...f.selection, ...contact }, 'demo-direct-health', db)).rejects.toMatchObject({ code: 'STRUCTURED_BOOKING_REQUIRED' });
  const stateKey = bookingSubjectStateKey(f.actor.uid, f.business.id, f.subjectCase.bookingRequestId), state = (await db.collection('serverSettings').doc(stateKey).get()).data()!, receiptRef = db.collection('serverSettings').doc(state.receiptId), receipt = (await receiptRef.get()).data()!;
  const reorder = (v: any): any => Array.isArray(v) ? v.map(reorder) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().reverse().map(key => [key, reorder(v[key])])) : v;
  await receiptRef.set(reorder(receipt)); expect((await readBookingSubjectConsent(f.actor, f.business.id, f.subjectCase, secondDb)).active).toBe(true);
  await updateBookingSubjectConsent(f.actor, { businessId: f.business.id, case: f.subjectCase, action: 'revoke', expectedRevision: 1, requestId: 'demo-revoke-before-confirm' }, secondDb);
  await expect(confirmBookingProposal(f.actor, f.business.id, proposal.id, { ...contact, beneficiary: f.beneficiary }, db)).rejects.toMatchObject({ status: 428 });
  expect((await db.collection('businesses').doc(f.business.id).collection('appointments').get()).empty).toBe(true);
  await db.collection('serverSettings').doc(stateKey).set({ ...state, revision: 'corrupt' });
  await expect(readBookingSubjectConsent(f.actor, f.business.id, f.subjectCase, secondDb)).rejects.toMatchObject({ status: 503 });
}
export async function verifySubjectRaces(db: Database, secondDb = db) {
  const f = await subjectFixture(db, 'health', true, 9); await acceptSyntheticSubjectConsent(db, f.actor, f.business, f.subjectCase, f.policy);
  const otherCase = { ...f.subjectCase, bookingRequestId: `demo-next-${crypto.randomUUID()}` }; await acceptSyntheticSubjectConsent(db, f.actor, f.business, otherCase, f.policy);
  const p = await createStructuredBookingProposal(f.actor, f.business.id, { case: f.subjectCase, beneficiary: f.beneficiary, selection: f.selection }, db);
  const q = await createStructuredBookingProposal(f.actor, f.business.id, { case: otherCase, beneficiary: f.beneficiary, selection: { ...f.selection, resourceId: 'two' } }, db);
  const results = await Promise.allSettled([confirmBookingProposal(f.actor, f.business.id, p.id, { ...contact, beneficiary: f.beneficiary }, db), confirmBookingProposal(f.actor, f.business.id, q.id, { ...contact, beneficiary: f.beneficiary }, secondDb)]);
  expect(results.filter(item => item.status === 'fulfilled')).toHaveLength(1);
  expect((await db.collection('businesses').doc(f.business.id).get()).data()?.subscription.paidTrial.appointmentsUsed).toBe(10);
  const g = await subjectFixture(db); await acceptSyntheticSubjectConsent(db, g.actor, g.business, g.subjectCase, g.policy);
  const proposal = await createStructuredBookingProposal(g.actor, g.business.id, { case: g.subjectCase, beneficiary: g.beneficiary, selection: g.selection }, db);
  const race = await Promise.allSettled([confirmBookingProposal(g.actor, g.business.id, proposal.id, { ...contact, beneficiary: g.beneficiary }, db), updateBookingSubjectConsent(g.actor, { businessId: g.business.id, case: g.subjectCase, action: 'revoke', expectedRevision: 1, requestId: 'demo-concurrent-revoke' }, secondDb)]);
  expect(race[1].status).toBe('fulfilled'); const appointments = await db.collection('businesses').doc(g.business.id).collection('appointments').get(); expect(appointments.size).toBeLessThanOrEqual(1);
  if (appointments.size) expect((await confirmBookingProposal(g.actor, g.business.id, proposal.id, {} as never, secondDb)).id).toBe(appointments.docs[0].id);
  else await expect(confirmBookingProposal(g.actor, g.business.id, proposal.id, { ...contact, beneficiary: g.beneficiary }, secondDb)).rejects.toMatchObject({ status: 428 });
}
export async function verifyLegacyPolicyCompatibility(db: Database, secondDb = db) {
  const f = await subjectFixture(db, 'general', false);
  const first = await createBookingProposal(f.actor, f.business.id, f.selection, 'demo-legacy-confirmed', db);
  const saved = await confirmBookingProposal(f.actor, f.business.id, first.id, contact, db);
  const pending = await createBookingProposal(f.actor, f.business.id, { ...f.selection, startTimeStr: '10:00' }, 'demo-legacy-pending', db);
  await saveBookingDataPolicy(subjectAdmin, { businessId: f.business.id, expectedRevision: 1, dataMode: 'health', representedMinorsEnabled: false, reason: 'Demo policy switch' }, db);
  await expect(confirmBookingProposal(f.actor, f.business.id, pending.id, contact, secondDb)).rejects.toMatchObject({ code: 'STRUCTURED_BOOKING_REQUIRED' });
  expect(await confirmBookingProposal(f.actor, f.business.id, first.id, {} as never, secondDb)).toEqual(saved);
}
