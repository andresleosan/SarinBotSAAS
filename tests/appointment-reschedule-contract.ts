import type { Appointment, Business } from '@/types/firestore';
import { expect } from 'vitest';
import type { Database } from '@/lib/storage/types';
import { privateBusinessDraft, publicBusiness } from '@/lib/server/businesses';
import { createBookingProposal, confirmBookingProposal, confirmBookingProposalDetailed } from '@/lib/server/booking-proposals';
import { cancelAppointment, createAppointment, createManualBlock, readAvailability } from '@/lib/server/bookings';
import { clientPolicyKey } from '@/lib/server/client-policy';
import { readConsent, updateConsent } from '@/lib/server/consent';
import { acceptSyntheticConsent } from './consent-fixtures';

export const rescheduleNow = Date.parse('2030-01-01T12:00:00Z');
export const rescheduleActor = { uid: 'demo-reschedule-client', name: 'Nombre actual', email: 'current@example.test' };
export const rescheduleBusiness: Business = {
  ...privateBusinessDraft({ uid: 'demo-reschedule-owner' }, rescheduleNow),
  id: 'demo-reschedule-business',
  slug: 'demo-reschedule-business',
  subscription: { status: 'active', trialEndsAt: 0, currentPeriodEndsAt: rescheduleNow + 30 * 86400000 },
  sarinConfig: { onboardingCompleted: true, tone: '', customRules: '', intakeFields: [] },
  resources: [{ id: 'demo-chair', name: 'Profesional actual', active: true }],
  services: [{ id: 'demo-cut', name: 'Corte actual', durationMinutes: 30, bufferMinutes: 15, price: 25000, resourceIds: ['demo-chair'] }],
  weeklySchedule: { 1: { isOpen: true, intervals: [{ start: '09:00', end: '17:00' }] } },
};
export const rescheduleSource: Appointment & { historicalMetadata: { imported: boolean } } = {
  id: 'demo-original-appointment', tenantId: 'demo-reschedule-business',
  dateKey: '2030-01-07', startTimeStr: '09:00', endTimeStr: '09:30',
  startAt: Date.parse('2030-01-07T14:00:00Z'), endAt: Date.parse('2030-01-07T14:30:00Z'), reservedUntilAt: Date.parse('2030-01-07T14:45:00Z'),
  type: 'appointment', status: 'confirmed', resourceId: 'demo-chair', serviceId: 'demo-cut', serviceName: 'Corte anterior', price: 20000,
  client: { uid: 'demo-reschedule-client', name: 'Nombre original', email: 'original@example.test', phone: '573001234567', intakeAnswers: { retired_question: 'Respuesta histórica' }, hasNoShowHistory: true },
  createdBy: 'sarin_client', createdAt: rescheduleNow - 86400000,
  historicalMetadata: { imported: true },
};
export const rescheduleSelection = { serviceId: 'demo-cut', resourceId: 'demo-chair', dateKey: '2030-01-07', startTimeStr: '10:00' };
export const rescheduleContact = { clientPhone: null, intakeAnswers: {} };
export const rescheduleSourcePath = `businesses/${rescheduleBusiness.id}/appointments/${rescheduleSource.id}`;

/** Test-only local storage seed. All identity and contact values are synthetic. */
export async function seedRescheduleScenario(db: Database, business = rescheduleBusiness) {
  await db.collection('businesses').doc(business.id).set(business);
  await db.collection('publicBusinesses').doc(business.slug).set(publicBusiness(business));
  await db.collection('businesses').doc(business.id).collection('appointments').doc(rescheduleSource.id).set(rescheduleSource);
  for (const uid of [rescheduleActor.uid, 'demo-reschedule-owner', 'demo-other-client']) await acceptSyntheticConsent(db, uid, business);
}

/** Shared memory/D1 characterization of the final atomic mutation and replay. */
export async function verifyRescheduleAtomicMove(db: Database, secondDb = db) {
  await seedRescheduleScenario(db);
  const businessRef = db.collection('businesses').doc(rescheduleBusiness.id), sourceRef = businessRef.collection('appointments').doc(rescheduleSource.id);
  const proposal = await createBookingProposal(rescheduleActor, rescheduleBusiness.id, rescheduleSelection, 'demo-atomic-move', db, undefined, { appointmentId: rescheduleSource.id, sourceRevision: 0 });
  expect((await secondDb.collection('businesses').doc(rescheduleBusiness.id).collection('appointments').doc(rescheduleSource.id).get()).data()).toEqual(rescheduleSource);
  expect(proposal.reschedule).toEqual({ appointmentId: 'demo-original-appointment', sourceRevision: 0, source: { dateKey: '2030-01-07', startTimeStr: '09:00', endTimeStr: '09:30', resourceId: 'demo-chair', resourceName: 'Profesional actual', priceCOP: 20000 }, targetServiceId: 'demo-cut', targetResourceId: 'demo-chair' });
  expect(JSON.stringify((await db.collection('bookingProposals').doc(proposal.id).get()).data())).not.toMatch(/original@example|573001234567|Respuesta histórica|historicalMetadata/);
  const [first, replay] = await Promise.all([confirmBookingProposal(rescheduleActor, rescheduleBusiness.id, proposal.id, rescheduleContact, db), confirmBookingProposal(rescheduleActor, rescheduleBusiness.id, proposal.id, rescheduleContact, secondDb)]);
  expect(first).toEqual(replay);
  expect(first).toMatchObject({ id: 'demo-original-appointment', startTimeStr: '10:00', rescheduleRevision: 1, lastRescheduleProposalId: proposal.id });
  expect(first.client).toEqual(rescheduleSource.client);
  expect(first.createdAt).toBe(rescheduleSource.createdAt);
  expect(first.createdBy).toBe('sarin_client');
  expect(first).toMatchObject({ historicalMetadata: { imported: true } });
  expect((await sourceRef.get()).data()).toEqual(first);
  expect((await businessRef.get()).data()).toEqual(rescheduleBusiness);
  expect((await businessRef.collection('appointments').get()).size).toBe(1);
  const availability = await readAvailability(rescheduleBusiness, '2030-01-07', 'demo-cut', 'demo-chair', secondDb);
  expect(availability[0].slots).toContain('09:00');
  expect(availability[0].slots).not.toContain('10:00');
  expect((await businessRef.collection('bookingLocks').doc('2030-01-07_demo-chair').get()).data()).toMatchObject({ version: 1 });
  expect((await businessRef.collection('bookingLocks').doc(`client_${clientPolicyKey(rescheduleActor.uid)}`).get()).data()).toMatchObject({ version: 1 });
  expect((await businessRef.collection('bookingLocks').get()).size).toBe(2);
}

export async function verifyRescheduleCrossResourceLocks(db: Database, secondDb = db) {
  const business: Business = { ...rescheduleBusiness, resources: [...rescheduleBusiness.resources, { id: 'demo-second-chair', name: 'Segundo profesional', active: true }], services: [{ ...rescheduleBusiness.services[0], resourceIds: ['demo-chair', 'demo-second-chair'] }] };
  await seedRescheduleScenario(db, business);
  const businessRef = db.collection('businesses').doc(business.id), locks = businessRef.collection('bookingLocks');
  await locks.doc('2030-01-07_demo-chair').set({ version: 7, updatedAt: rescheduleNow - 1 });
  await locks.doc(`client_${clientPolicyKey(rescheduleActor.uid)}`).set({ version: 4, updatedAt: rescheduleNow - 1 });
  const proposal = await createBookingProposal(rescheduleActor, business.id, { ...rescheduleSelection, resourceId: 'demo-second-chair', dateKey: '2030-01-14' }, 'demo-cross-resource-move', db, undefined, { appointmentId: rescheduleSource.id, sourceRevision: 0 });
  const moved = await confirmBookingProposal(rescheduleActor, business.id, proposal.id, rescheduleContact, secondDb);
  expect(moved).toMatchObject({ id: 'demo-original-appointment', dateKey: '2030-01-14', resourceId: 'demo-second-chair', rescheduleRevision: 1 });
  expect((await locks.doc('2030-01-07_demo-chair').get()).data()).toMatchObject({ version: 8 });
  expect((await locks.doc('2030-01-14_demo-second-chair').get()).data()).toMatchObject({ version: 1 });
  expect((await locks.doc(`client_${clientPolicyKey(rescheduleActor.uid)}`).get()).data()).toMatchObject({ version: 5 });
  expect((await locks.get()).size).toBe(3);
  expect((await businessRef.collection('appointments').get()).size).toBe(1);
}

export async function verifyRescheduleSourceRace(db: Database, secondDb = db) {
  await seedRescheduleScenario(db);
  const p = await createBookingProposal(rescheduleActor, rescheduleBusiness.id, rescheduleSelection, 'demo-source-race-first', db, undefined, { appointmentId: rescheduleSource.id, sourceRevision: 0 });
  const q = await createBookingProposal(rescheduleActor, rescheduleBusiness.id, { ...rescheduleSelection, startTimeStr: '11:00' }, 'demo-source-race-second', secondDb, undefined, { appointmentId: rescheduleSource.id, sourceRevision: 0 });
  const results = await Promise.allSettled([confirmBookingProposal(rescheduleActor, rescheduleBusiness.id, p.id, rescheduleContact, db), confirmBookingProposal(rescheduleActor, rescheduleBusiness.id, q.id, rescheduleContact, secondDb)]);
  expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
  expect(results.find(result => result.status === 'rejected')).toMatchObject({ reason: { status: 409 } });
  const appointments = await secondDb.collection('businesses').doc(rescheduleBusiness.id).collection('appointments').get();
  expect(appointments.size).toBe(1);
  expect(appointments.docs[0].data()).toMatchObject({ id: 'demo-original-appointment', rescheduleRevision: 1, client: rescheduleSource.client });
  const finished = await Promise.all([p, q].map(proposal => db.collection('bookingProposals').doc(proposal.id).get()));
  expect(finished.filter(item => item.data()?.appointmentId === rescheduleSource.id)).toHaveLength(1);
}

export async function verifyRescheduleDestinationRace(db: Database, secondDb = db, blocker: 'booking' | 'manual' = 'booking') {
  await seedRescheduleScenario(db);
  const proposal = await createBookingProposal(rescheduleActor, rescheduleBusiness.id, rescheduleSelection, 'demo-destination-race', db, undefined, { appointmentId: rescheduleSource.id, sourceRevision: 0 });
  const competingWrite = blocker === 'booking'
    ? () => createAppointment({ uid: 'demo-other-client' }, rescheduleBusiness.id, { ...rescheduleSelection, clientPhone: '573001111111', intakeAnswers: {} }, 'demo-destination-booking', secondDb)
    : () => createManualBlock({ uid: 'demo-reschedule-owner' }, rescheduleBusiness.id, { dateKey: '2030-01-07', startTimeStr: '10:00', endTimeStr: '10:30', resourceId: 'demo-chair', requestId: 'demo-destination-block' }, secondDb);
  const results = await Promise.allSettled([confirmBookingProposal(rescheduleActor, rescheduleBusiness.id, proposal.id, rescheduleContact, db), competingWrite()]);
  expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
  expect(results.find(result => result.status === 'rejected')).toMatchObject({ reason: { status: 409 } });
  const appointments = await db.collection('businesses').doc(rescheduleBusiness.id).collection('appointments').get();
  const occupied = appointments.docs.map(doc => doc.data() as Appointment).filter(item => item.status === 'confirmed' && item.dateKey === '2030-01-07' && item.resourceId === 'demo-chair' && item.startAt < Date.parse('2030-01-07T15:30:00Z') && item.reservedUntilAt > Date.parse('2030-01-07T15:00:00Z'));
  expect(occupied).toHaveLength(1);
  const source = appointments.docs.find(doc => doc.id === rescheduleSource.id)!.data();
  expect(source.client).toEqual(rescheduleSource.client);
  expect(source.startTimeStr).toBe(results[0].status === 'fulfilled' ? '10:00' : '09:00');
  expect(appointments.size).toBe(results[0].status === 'fulfilled' ? 1 : 2);
}

export async function verifyRescheduleCancelRace(db: Database, secondDb = db) {
  await seedRescheduleScenario(db);
  const proposal = await createBookingProposal(rescheduleActor, rescheduleBusiness.id, rescheduleSelection, 'demo-cancel-source-race', db, undefined, { appointmentId: rescheduleSource.id, sourceRevision: 0 });
  const results = await Promise.allSettled([confirmBookingProposal(rescheduleActor, rescheduleBusiness.id, proposal.id, rescheduleContact, db), cancelAppointment(rescheduleActor, rescheduleBusiness.id, rescheduleSource.id, secondDb)]);
  expect(results[1].status).toBe('fulfilled');
  const appointments = await db.collection('businesses').doc(rescheduleBusiness.id).collection('appointments').get();
  expect(appointments.size).toBe(1);
  const source = appointments.docs[0].data();
  expect(source).toMatchObject({ id: 'demo-original-appointment', status: 'cancelled_by_client', client: rescheduleSource.client });
  expect(source.startTimeStr).toBe(results[0].status === 'fulfilled' ? '10:00' : '09:00');
  expect(source.rescheduleRevision ?? 0).toBe(results[0].status === 'fulfilled' ? 1 : 0);
}

export async function verifyRescheduleReplayAfterAnotherMove(db: Database, secondDb = db) {
  await seedRescheduleScenario(db);
  const p = await createBookingProposal(rescheduleActor, rescheduleBusiness.id, rescheduleSelection, 'demo-replay-first-move', db, undefined, { appointmentId: rescheduleSource.id, sourceRevision: 0 });
  const stale = await createBookingProposal(rescheduleActor, rescheduleBusiness.id, { ...rescheduleSelection, startTimeStr: '11:00' }, 'demo-stale-before-return', secondDb, undefined, { appointmentId: rescheduleSource.id, sourceRevision: 0 });
  const first = await confirmBookingProposalDetailed(rescheduleActor, rescheduleBusiness.id, p.id, rescheduleContact, db);
  expect(first.rescheduleResult).toEqual({ proposalId: p.id, appointmentId: 'demo-original-appointment', revision: 1, dateKey: '2030-01-07', startTimeStr: '10:00', resourceId: 'demo-chair', startAt: Date.parse('2030-01-07T15:00:00Z'), endAt: Date.parse('2030-01-07T15:30:00Z'), confirmedAt: rescheduleNow });
  const q = await createBookingProposal(rescheduleActor, rescheduleBusiness.id, { ...rescheduleSelection, startTimeStr: '09:00' }, 'demo-replay-return-move', secondDb, undefined, { appointmentId: rescheduleSource.id, sourceRevision: 1 });
  await confirmBookingProposal(rescheduleActor, rescheduleBusiness.id, q.id, rescheduleContact, secondDb);
  await expect(confirmBookingProposal(rescheduleActor, rescheduleBusiness.id, stale.id, rescheduleContact, db)).rejects.toMatchObject({ status: 409 });
  const state = await readConsent(rescheduleActor.uid, 'account', undefined, db);
  await updateConsent(rescheduleActor, { scope: 'account', action: 'revoke', requestId: 'demo-replay-withdraw-account', expectedRevision: state.revision }, db);
  const replay = await confirmBookingProposalDetailed(rescheduleActor, rescheduleBusiness.id, p.id, {} as never, secondDb);
  expect(replay.rescheduleResult).toEqual(first.rescheduleResult);
  expect(replay.appointment).toMatchObject({ id: 'demo-original-appointment', startTimeStr: '09:00', rescheduleRevision: 2, lastRescheduleProposalId: q.id });
  await cancelAppointment(rescheduleActor, rescheduleBusiness.id, rescheduleSource.id, secondDb);
  const cancelledReplay = await confirmBookingProposalDetailed(rescheduleActor, rescheduleBusiness.id, p.id, {} as never, db);
  expect(cancelledReplay.rescheduleResult).toEqual(first.rescheduleResult);
  expect(cancelledReplay.appointment).toMatchObject({ status: 'cancelled_by_client', startTimeStr: '09:00', rescheduleRevision: 2 });
  const proposal = (await db.collection('bookingProposals').doc(p.id).get()).data()!;
  expect(proposal.rescheduleResult).toEqual(first.rescheduleResult);
  expect(proposal).not.toHaveProperty('appointment');
  expect(JSON.stringify(proposal.rescheduleResult)).not.toMatch(/client|phone|beneficiary|intake|historicalMetadata/);
}
