import 'server-only';
import type { ChatActor } from '@/types/chat';
import type { Business } from '@/types/firestore';
import type { Database } from '@/lib/storage/types';
import { getAdminDb } from '@/lib/firebase/admin';
import { StorageError } from '@/lib/storage/database';
import { OwnerWaitlistModelError, ownerWaitlistCursorSchema, ownerWaitlistDetailSchema, readOwnerWaitlistReview, projectOwnerWaitlistRow, type OwnerWaitlistDetail } from '@/lib/owner-waitlist';
import { readOwnerWaitlistProjection } from './waitlist';
import { HttpError } from './http';

const unverifiable = () => new HttpError(503, 'No se pudo verificar la espera. Vuelve a consultar.', 'OWNER_WAITLIST_UNVERIFIABLE');
async function guarded<T>(action: () => Promise<T>): Promise<T> {
  try { return await action(); }
  catch (error) {
    if (error instanceof OwnerWaitlistModelError || error instanceof StorageError || error instanceof HttpError && error.status === 503) throw unverifiable();
    throw error;
  }
}
export async function readOwnerWaitlistDetail(owner: ChatActor, businessId: string, recordId: string, db: Database = getAdminDb()): Promise<OwnerWaitlistDetail> {
  ownerWaitlistCursorSchema.shape.recordId.parse(businessId); ownerWaitlistCursorSchema.shape.recordId.parse(recordId);
  return guarded(() => db.runTransaction(async tx => {
    const current = await readOwnerWaitlistProjection(tx, owner, businessId, recordId, db);
    const businessRef = db.collection('businesses').doc(businessId), business = (await tx.get(businessRef)).data() as Business;
    const item = current.record.request!;
    const marker = await tx.get(businessRef.collection('waitlistOwnerReviews').doc(item.id));
    const review = readOwnerWaitlistReview(marker.exists ? marker.data() : undefined, { businessId, recordId, entryId: item.id });
    const serverNow = current.state.serverNow, request = current.state.request!;
    const row = projectOwnerWaitlistRow(recordId, current.record, business, review, serverNow);
    const result = ownerWaitlistDetailSchema.safeParse({ businessId, ownerUid: owner.uid, serverNow, row, state: request.status, ...(request.reason ? { reason: request.reason } : {}), availability: current.availability });
    if (!result.success) throw unverifiable();
    return result.data;
  }));
}
