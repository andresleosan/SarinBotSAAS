import type { Database } from '@/lib/storage/types';
import { subjectFixture } from './represented-booking-contract';
import { memoryFirestore } from './memoryFirestore';
import { acceptSyntheticSubjectConsent } from './consent-fixtures';
import type { BookingSubjectCase } from '@/lib/booking-subject';

export const waitlistNow = Date.parse('2030-01-06T14:00:00Z');
export async function waitlistFixture(db: Database = memoryFirestore().db, mode: 'general' | 'health' = 'general', represented = false, authorize = true, dateKey = '2030-01-07') {
  const f = await subjectFixture(db, mode, represented);
  const business = { ...f.business, weeklySchedule: Object.fromEntries(Array.from({ length: 7 }, (_, day) => [day, { isOpen: true, intervals: [{ start: '09:00', end: '10:00' }] }])) };
  await db.collection('businesses').doc(business.id).set(business);
  const subjectCase: BookingSubjectCase = represented ? f.subjectCase : { bookingRequestId: f.subjectCase.bookingRequestId, subjectKind: 'self' };
  if (authorize) await acceptSyntheticSubjectConsent(db, f.actor, business, subjectCase, f.policy);
  for (const resourceId of ['one', 'two']) await db.collection('businesses').doc(business.id).collection('appointments').doc(`block-${resourceId}`).set({ id: `block-${resourceId}`, tenantId: business.id, dateKey, resourceId, status: 'confirmed', type: 'manual_block', startTimeStr: '09:00', endTimeStr: '10:00' });
  return { ...f, db, business, subjectCase, input: { requestId: 'waitlist-join-first', expectedRevision: 0, case: subjectCase, serviceId: 'cut', dateKey } };
}
