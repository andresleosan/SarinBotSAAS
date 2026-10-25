import type { Database } from '@/lib/storage/types';
import { memoryFirestore } from './memoryFirestore';
import { waitlistFixture, waitlistNow } from './waitlist-contract';
import { joinWaitlist, waitlistDocumentId, waitlistEntryId } from '@/lib/server/waitlist';
export { waitlistNow as ownerWaitlistNow };
export async function ownerWaitlistFixture(db: Database = memoryFirestore().db, mode: 'general' | 'health' = 'general', represented = false, dateKey = '2030-01-07') {
  const f = await waitlistFixture(db, mode, represented, true, dateKey);
  const state = await joinWaitlist(f.actor, f.business.id, f.input, db);
  const recordId = waitlistDocumentId(f.actor.uid, f.business.id);
  const ref = db.collection('businesses').doc(f.business.id).collection('waitlistRequests').doc(recordId);
  return { ...f, state, recordId, ref, entryId: state.request!.id };
}
export async function seedOwnerWaitlistRows(f: Awaited<ReturnType<typeof ownerWaitlistFixture>>, count = 45, ties = 25) {
  const base = (await f.ref.get()).data()!;
  const rows = [];
  for (let index = 0; index < count; index++) {
    const clientUid = `demo-waitlist-client-${index}`, requestId = `demo-fifo-request-${index}`, recordId = waitlistDocumentId(clientUid, f.business.id);
    const createdAt = base.request.createdAt + Math.max(0, index - ties + 1), entryId = waitlistEntryId(clientUid, f.business.id, requestId);
    const value = { ...base, ownerUid: clientUid, updatedAt: createdAt, request: { ...base.request, id: entryId, createdAt }, lastOperation: { requestId, operationHash: 'a'.repeat(64), appliedRevision: 1 } };
    await f.db.collection('businesses').doc(f.business.id).collection('waitlistRequests').doc(recordId).set(value);
    rows.push({ recordId, entryId, createdAt });
  }
  await f.ref.delete();
  return rows.sort((a,b)=>a.createdAt-b.createdAt||(a.entryId<b.entryId?-1:a.entryId>b.entryId?1:0));
}
