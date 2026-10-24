import type { Appointment, Business } from '@/types/firestore';
import type { Database } from '@/lib/storage/types';
import { privateBusinessDraft, publicBusiness } from '@/lib/server/businesses';
import { acceptSyntheticConsent } from './consent-fixtures';

export const attendanceNow = Date.parse('2030-01-07T14:45:00Z');
export const attendanceOwner = { uid: 'demo-attendance-owner' };
export const attendanceBusiness: Business = {
  ...privateBusinessDraft(attendanceOwner, attendanceNow - 86400000),
  id: 'demo-attendance-business', slug: 'demo-attendance-business', name: 'Demo attendance',
  subscription: { status: 'trial', trialEndsAt: attendanceNow + 86400000, currentPeriodEndsAt: 0,
    paidTrial: { source: 'invitation', invitationId: 'demo-invitation', activatedAt: attendanceNow - 86400000, appointmentLimit: 10, appointmentsUsed: 1, accessSuspended: false } },
  sarinConfig: { onboardingCompleted: true, tone: '', customRules: '', intakeFields: [] },
  resources: [{ id: 'demo-chair', name: 'Demo resource', active: true }],
  services: [{ id: 'demo-service', name: 'Demo service', durationMinutes: 30, bufferMinutes: 15, price: 20000, resourceIds: ['demo-chair'] }],
  weeklySchedule: { 1: { isOpen: true, intervals: [{ start: '09:00', end: '17:00' }] } },
};
export const attendanceAppointment: Appointment = {
  id: 'demo-attendance-appointment', tenantId: attendanceBusiness.id, dateKey: '2030-01-07',
  startTimeStr: '09:00', endTimeStr: '09:30', startAt: Date.parse('2030-01-07T14:00:00Z'),
  endAt: Date.parse('2030-01-07T14:30:00Z'), reservedUntilAt: attendanceNow,
  type: 'appointment', status: 'confirmed', resourceId: 'demo-chair', serviceId: 'demo-service', serviceName: 'Demo service', price: 20000,
  client: { uid: 'demo-attendance-client', name: 'Demo representative', email: 'demo@example.test', intakeAnswers: { demo_question: 'Synthetic answer' }, hasNoShowHistory: true },
  beneficiary: { kind: 'represented_minor', displayName: 'Demo beneficiary', representativeRole: 'parent' },
  subjectAuthorization: { receiptId: 'demo-subject-receipt', bookingRequestId: 'demo-booking-request', policyRevision: 1 },
  representationReview: { revision: 1, status: 'reviewed', reviewedBy: attendanceOwner.uid, reviewedAt: attendanceNow - 3600000 },
  createdBy: 'sarin_client', createdAt: attendanceNow - 86400000,
};
export const attendanceCommand = {
  requestId: 'demo-attendance-request', expectedRevision: 0, expectedRescheduleRevision: 0,
  expectedStatus: 'confirmed' as const, status: 'completed' as const,
};

/** Synthetic local fixture shared by memory, D1 and route characterizations. */
export async function attendanceFixture(db: Database) {
  const business = structuredClone(attendanceBusiness), appointment = structuredClone(attendanceAppointment);
  const owner = { ...attendanceOwner }, command = { ...attendanceCommand };
  const businessRef = db.collection('businesses').doc(business.id), appointmentRef = businessRef.collection('appointments').doc(appointment.id);
  await businessRef.set(business);
  await db.collection('publicBusinesses').doc(business.slug).set(publicBusiness(business));
  await appointmentRef.set(appointment);
  await acceptSyntheticConsent(db, owner.uid);
  return { owner, business, appointment, command, businessRef, appointmentRef };
}
