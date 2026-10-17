import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { memoryFirestore } from './memoryFirestore';
import { subjectAdmin, subjectFixture, verifyStructuredCases, verifySubjectBindingAndWithdrawal, verifySubjectRaces, verifyLegacyPolicyCompatibility } from './represented-booking-contract';
import { createStructuredBookingProposal } from '@/lib/server/structured-booking';
import { acceptSyntheticSubjectConsent } from './consent-fixtures';
import { confirmBookingProposal } from '@/lib/server/booking-proposals';
import { saveBookingDataPolicy } from '@/lib/server/booking-data-policy';
beforeEach(() => vi.stubEnv('SUPERADMIN_UID', subjectAdmin.uid));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.useRealTimers(); });
it('structured health proposal never calls engine or response quota and preserves client uid', async () => { await verifyStructuredCases(memoryFirestore().db); });
it('name and representative change cannot reuse a case or a withdrawn permission', async () => { await verifySubjectBindingAndWithdrawal(memoryFirestore().db); });
it('two confirmations and concurrent withdrawal create at most one appointment and final quota', async () => { await verifySubjectRaces(memoryFirestore().db); });
it('pending legacy proposal cannot bypass current health policy and confirmed v1 replay survives', async () => { await verifyLegacyPolicyCompatibility(memoryFirestore().db); });
it('structured proposals reject changed policy catalogue expiry and free-form intake', async () => {
  const { db } = memoryFirestore(), f = await subjectFixture(db); await acceptSyntheticSubjectConsent(db, f.actor, f.business, f.subjectCase, f.policy);
  const proposal = await createStructuredBookingProposal(f.actor, f.business.id, { case: f.subjectCase, beneficiary: f.beneficiary, selection: f.selection }, db);
  const payload = { clientPhone: '573001234567', intakeAnswers: {}, beneficiary: f.beneficiary };
  await expect(confirmBookingProposal(f.actor, f.business.id, proposal.id, { ...payload, intakeAnswers: { clinical: 'SYNTHETIC_PRIVATE_SUBJECT' } }, db)).rejects.toMatchObject({ status: 400 });
  await db.collection('businesses').doc(f.business.id).set({ ...f.business, services: [{ ...f.business.services[0], price: 50000 }] });
  await expect(confirmBookingProposal(f.actor, f.business.id, proposal.id, payload, db)).rejects.toMatchObject({ status: 409 });
  await db.collection('businesses').doc(f.business.id).set(f.business);
  vi.useFakeTimers(); vi.setSystemTime(proposal.expiresAt);
  await expect(confirmBookingProposal(f.actor, f.business.id, proposal.id, payload, db)).rejects.toMatchObject({ code: 'BOOKING_PROPOSAL_CLOSED' });
});
it('a committed expiry closes the proposal against an older in-flight confirmation', async () => {
  const { db, rows } = memoryFirestore(), f = await subjectFixture(db);
  await acceptSyntheticSubjectConsent(db, f.actor, f.business, f.subjectCase, f.policy);
  const proposal = await createStructuredBookingProposal(f.actor, f.business.id, { case: f.subjectCase, beneficiary: f.beneficiary, selection: f.selection }, db);
  const contact = { clientPhone: '573001234567', intakeAnswers: {}, beneficiary: f.beneficiary };
  let release!: () => void, entered!: () => void;
  const paused = new Promise<void>(resolve => { entered = resolve; }), resume = new Promise<void>(resolve => { release = resolve; });
  const transact = db.runTransaction.bind(db); let first = true;
  vi.spyOn(db, 'runTransaction').mockImplementation(handler => transact(async tx => {
    const result = await handler(tx);
    if (first) { first = false; entered(); await resume; }
    return result;
  }));
  const slow = confirmBookingProposal(f.actor, f.business.id, proposal.id, contact, db).catch(error => error);
  await paused;
  try {
    vi.spyOn(Date, 'now').mockReturnValue(proposal.expiresAt + 1);
    await expect(confirmBookingProposal(f.actor, f.business.id, proposal.id, contact, db)).rejects.toMatchObject({ code: 'BOOKING_PROPOSAL_CLOSED' });
    expect(rows.get(`bookingProposals/${proposal.id}`)?.data.closedAt).toBe(proposal.expiresAt + 1);
  } finally { release(); }
  expect(await slow).toMatchObject({ code: 'BOOKING_PROPOSAL_CLOSED' });
  expect((await db.collection('businesses').doc(f.business.id).collection('appointments').get()).size).toBe(0);
  expect((await db.collection('businesses').doc(f.business.id).get()).data()?.subscription.paidTrial.appointmentsUsed).toBe(0);
  vi.restoreAllMocks();
});
it('a changed policy or another business cannot reuse an existing authorization', async () => {
  const { db } = memoryFirestore(), f = await subjectFixture(db); await acceptSyntheticSubjectConsent(db, f.actor, f.business, f.subjectCase, f.policy);
  const input = { case: f.subjectCase, beneficiary: f.beneficiary, selection: f.selection }, proposal = await createStructuredBookingProposal(f.actor, f.business.id, input, db);
  await saveBookingDataPolicy(subjectAdmin, { businessId: f.business.id, expectedRevision: 1, dataMode: 'health', representedMinorsEnabled: true, reason: 'Demo operational review' }, db);
  await expect(confirmBookingProposal(f.actor, f.business.id, proposal.id, { clientPhone: '573001234567', intakeAnswers: {}, beneficiary: f.beneficiary }, db)).rejects.toMatchObject({ status: 428 });
  await acceptSyntheticSubjectConsent(db, f.actor, f.business, f.subjectCase, { ...f.policy, revision: 2 });
  await expect(confirmBookingProposal(f.actor, f.business.id, proposal.id, { clientPhone: '573001234567', intakeAnswers: {}, beneficiary: f.beneficiary }, db)).rejects.toMatchObject({ code: 'BOOKING_PROPOSAL_CHANGED' });
  const other = await subjectFixture(db);
  await expect(createStructuredBookingProposal(f.actor, other.business.id, input, db)).rejects.toMatchObject({ status: 428 });
});
