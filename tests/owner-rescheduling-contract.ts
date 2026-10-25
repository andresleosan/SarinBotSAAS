import type { Appointment, Business } from '@/types/firestore';
import type { Database } from '@/lib/storage/types';
import { privateBusinessDraft, publicBusiness } from '@/lib/server/businesses';
import { acceptSyntheticConsent } from './consent-fixtures';

export const ownerRescheduleNow = Date.parse('2030-01-01T12:00:00Z');
export const ownerRescheduleActor = { uid: 'demo-owner' };
export const ownerRescheduleBusiness: Business = {
  ...privateBusinessDraft(ownerRescheduleActor, ownerRescheduleNow),
  id: 'demo-owner-reschedule', slug: 'demo-owner-reschedule',
  subscription: { status: 'active', trialEndsAt: 0, currentPeriodEndsAt: ownerRescheduleNow + 30 * 86400000,
    paidTrial: { paymentId: 'demo-payment', activatedAt: ownerRescheduleNow, appointmentLimit: 10, appointmentsUsed: 1 } },
  sarinConfig: { onboardingCompleted: true, tone: '', customRules: '', intakeFields: [] },
  resources: [{ id: 'demo-chair', name: 'Profesional uno', active: true }, { id: 'demo-second', name: 'Profesional dos', active: true }],
  services: [{ id: 'demo-cut', name: 'Corte actual', durationMinutes: 30, bufferMinutes: 15, price: 25000, resourceIds: ['demo-chair', 'demo-second'] }],
  weeklySchedule: { 1: { isOpen: true, intervals: [{ start: '09:00', end: '17:00' }] } },
};
export const ownerRescheduleSource: Appointment & { historicalMetadata: { imported: boolean } } = {
  id: 'demo-source', tenantId: 'demo-owner-reschedule', dateKey: '2030-01-07', startTimeStr: '09:00', endTimeStr: '09:30',
  startAt: 1894024800000, endAt: 1894026600000, reservedUntilAt: 1894027500000,
  type: 'appointment', status: 'confirmed', resourceId: 'demo-chair', serviceId: 'demo-cut', serviceName: 'Corte anterior', price: 20000,
  client: { uid: 'demo-client', name: 'Cliente sintético', email: 'demo@example.test', phone: '573001234567', intakeAnswers: { retired_question: 'Respuesta sintética' } },
  createdBy: 'sarin_client', createdAt: ownerRescheduleNow - 86400000, historicalMetadata: { imported: true },
};
export const ownerRescheduleSelection = { dateKey: '2030-01-07', startTimeStr: '10:00', resourceId: 'demo-chair' };
export const ownerReschedulePath = `businesses/${ownerRescheduleBusiness.id}/appointments/${ownerRescheduleSource.id}`;

/** Synthetic-only shared seed for memory, D1 and Admin emulator contracts. */
export async function seedOwnerRescheduleScenario(db: Database, business = ownerRescheduleBusiness) {
  await db.collection('businesses').doc(business.id).set(business);
  await db.collection('publicBusinesses').doc(business.slug).set(publicBusiness(business));
  await db.collection('businesses').doc(business.id).collection('appointments').doc(ownerRescheduleSource.id).set(ownerRescheduleSource);
  for (const uid of ['demo-owner', 'demo-client', 'demo-other-client']) await acceptSyntheticConsent(db, uid, business);
}

/** Hand-checked transport fixture: 2030-01-07 10:00 Colombia, 30min +15min. */
export const ownerRescheduleView = {
  id: 'demo-proposal', businessId: 'demo-owner-reschedule', appointmentId: 'demo-source', requestId: 'demo-request',
  sourceRevision: 0, sourceFingerprint: 'a'.repeat(64), expiresAt: ownerRescheduleNow + 600000,
  source: { dateKey: '2030-01-07', startTimeStr: '09:00', endTimeStr: '09:30', startAt: 1894024800000, endAt: 1894026600000, reservedUntilAt: 1894027500000, resourceId: 'demo-chair', resourceName: 'Profesional uno', priceCOP: 20000 },
  target: { ...ownerRescheduleSelection, serviceId: 'demo-cut', serviceName: 'Corte actual', resourceName: 'Profesional uno', endTimeStr: '10:30', startAt: 1894028400000, endAt: 1894030200000, reservedUntilAt: 1894031100000, durationMinutes: 30, bufferMinutes: 15, priceCOP: 25000 },
};
export const ownerRescheduleResult = { proposalId: 'demo-proposal', appointmentId: 'demo-source', revision: 1, ...ownerRescheduleSelection, startAt: 1894028400000, endAt: 1894030200000, confirmedAt: ownerRescheduleNow };
