import type { Database } from '@/lib/storage/types';
import { waitlistFixture } from './waitlist-contract';
import { memoryFirestore } from './memoryFirestore';
import { acceptSyntheticConsent } from './consent-fixtures';
import { joinWaitlist, waitlistDocumentId, parseCanonicalWaitlistRecord } from '@/lib/server/waitlist';

/** Synthetic general/self fixture; join while blocked, then free one resource. */
export async function waitlistOffersFixture(db: Database = memoryFirestore().db) {
  const f = await waitlistFixture(db);
  const business = { ...f.business, services: f.business.services.map(service => ({ ...service, bufferMinutes: 15, price: 25000 })),
    subscription: { ...f.business.subscription, paidTrial: { ...f.business.subscription.paidTrial!, appointmentsUsed: 1 } } };
  await db.collection('businesses').doc(business.id).set(business);
  await acceptSyntheticConsent(db, f.owner.uid, business);
  const other = await waitlistFixture(db);
  const secondOwner = other.owner, secondClient = other.actor;
  const secondBusiness = { ...other.business, services: other.business.services.map(service => ({ ...service, bufferMinutes: 15, price: 25000 })),
    subscription: { ...other.business.subscription, paidTrial: { ...other.business.subscription.paidTrial!, appointmentsUsed: 1 } } };
  await db.collection('businesses').doc(secondBusiness.id).set(secondBusiness);
  await acceptSyntheticConsent(db, secondOwner.uid, secondBusiness);
  await acceptSyntheticConsent(db, secondClient.uid, business);
  const first = await joinWaitlist(f.actor, business.id, f.input, db);
  const second = await joinWaitlist(secondClient, business.id, { ...f.input, requestId: 'demo-second-join', case: { bookingRequestId: 'demo-second-case', subjectKind: 'self' } }, db);
  await db.collection('businesses').doc(business.id).collection('appointments').doc('block-one').delete();
  const recordId = waitlistDocumentId(f.actor.uid, business.id);
  const record = parseCanonicalWaitlistRecord(recordId, (await db.collection('businesses').doc(business.id).collection('waitlistRequests').doc(recordId).get()).data(), business.id);
  return { ...f, business, secondOwner, secondClient, secondBusiness, first, second, recordId, record };
}
