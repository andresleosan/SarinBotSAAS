import type { Business } from '@/types/firestore';
import type { Database } from '@/lib/storage/types';
import { privateBusinessDraft, publicBusiness } from '@/lib/server/businesses';
import { acceptSyntheticConsent } from './consent-fixtures';
export const scheduleNow = Date.parse('2030-01-07T14:00:00Z');
export const scheduleOwner = { uid: 'demo-s09-owner' };
export async function seedScheduleFixture(db: Database, consent = true, id = 'demo-s09') {
  const business: Business = { ...privateBusinessDraft(scheduleOwner, scheduleNow - 86400000), id, name: 'Synthetic schedule', slug: 'demo-s09', category: 'Services', phoneWhatsApp: '573001234567',
    subscription: { status: 'active', trialEndsAt: 0, currentPeriodEndsAt: scheduleNow + 86400000 }, sarinConfig: { onboardingCompleted: true, tone: '', customRules: '', intakeFields: [] },
    resources: [{ id: 'a', name: 'A', active: true }, { id: 'b', name: 'B', active: true }], services: [{ id: 's', name: 'Service', durationMinutes: 30, bufferMinutes: 15, price: 0, resourceIds: ['a', 'b'] }],
    weeklySchedule: Object.fromEntries(Array.from({ length: 7 }, (_, index) => [index, { isOpen: index === 1, intervals: index === 1 ? [{ start: '09:00', end: '12:00' }] : [] }])) };
  const ref = db.collection('businesses').doc(business.id);
  await ref.set(business); await db.collection('publicBusinesses').doc(business.slug).set(publicBusiness(business));
  if (consent) await acceptSyntheticConsent(db, scheduleOwner.uid);
  return { owner: scheduleOwner, business, ref, policyRef: ref.collection('resourceSchedulePolicies').doc('current'), operations: ref.collection('resourceScheduleOperations') };
}
