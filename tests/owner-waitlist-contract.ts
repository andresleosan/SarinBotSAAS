import type { Database } from '@/lib/storage/types';
import { memoryFirestore } from './memoryFirestore';
import { waitlistFixture, waitlistNow } from './waitlist-contract';
import { joinWaitlist, waitlistDocumentId } from '@/lib/server/waitlist';
export { waitlistNow as ownerWaitlistNow };
export async function ownerWaitlistFixture(db: Database = memoryFirestore().db, mode: 'general' | 'health' = 'general', represented = false) {
  const f = await waitlistFixture(db, mode, represented);
  const state = await joinWaitlist(f.actor, f.business.id, f.input, db);
  const recordId = waitlistDocumentId(f.actor.uid, f.business.id);
  const ref = db.collection('businesses').doc(f.business.id).collection('waitlistRequests').doc(recordId);
  return { ...f, state, recordId, ref, entryId: state.request!.id };
}
