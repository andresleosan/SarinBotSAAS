import type { Appointment, TenantResource } from '@/types/firestore';

/** Synthetic saved reservations matching the composed Agenda + Attendance contract. */
export const ownerClientRecordBusinessId = 'demo-record-business';
export const ownerClientRecordUid = 'demo-record-client';
export const ownerClientRecordResources: TenantResource[] = [
  { id: 'demo-chair', name: 'Demo resource', active: true },
  { id: 'demo-inactive', name: 'Previous demo resource', active: false },
];
export const ownerClientRecordAppointment: Appointment = {
  id: 'demo-record-appointment', tenantId: ownerClientRecordBusinessId, dateKey: '2030-01-07',
  startAt: 1894024800000, endAt: 1894026600000, reservedUntilAt: 1894027500000,
  startTimeStr: '09:00', endTimeStr: '09:30', type: 'appointment', status: 'confirmed',
  resourceId: 'demo-chair', serviceId: 'demo-service', serviceName: 'Synthetic service', price: 20000,
  client: { uid: ownerClientRecordUid, name: 'Synthetic representative', email: 'synthetic@example.test',
    phone: '+573000000000', intakeAnswers: { synthetic_question: 'Synthetic private answer' }, hasNoShowHistory: true },
  beneficiary: { kind: 'represented_minor', displayName: 'Synthetic minor', representativeRole: 'parent' },
  subjectAuthorization: { receiptId: 'demo-receipt', bookingRequestId: 'demo-booking-request', policyRevision: 1 },
  representationReview: { revision: 1, status: 'reviewed', reviewedBy: 'demo-owner', reviewedAt: 1894020000000 },
  createdBy: 'sarin_client', createdAt: 1893938400000,
};
export function makeOwnerClientRecordAppointment(overrides: Partial<Appointment> = {}): Appointment {
  return { ...structuredClone(ownerClientRecordAppointment), ...overrides };
}
