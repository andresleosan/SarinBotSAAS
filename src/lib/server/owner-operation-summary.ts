import 'server-only';
import type { Business } from '@/types/firestore';
import type { ChatActor } from '@/types/chat';
import type { Database } from '@/lib/storage/types';
import { getAdminDb } from '@/lib/firebase/admin';
import { StorageError } from '@/lib/storage/database';
import { parseOperationRange, summarizeOwnerOperation, OperationSummaryRangeError, OperationSummaryCapacityError, type OperationRange, type OwnerOperationSummary } from '@/lib/owner-operation-summary';
import { assertOwner } from './businesses';
import { documentIdSchema } from './schemas';
import { HttpError } from './http';

export async function readOwnerOperationSummary(user: ChatActor, businessId: string, range: OperationRange, db: Database = getAdminDb()): Promise<OwnerOperationSummary> {
  documentIdSchema.parse(businessId);
  try {
    return await db.runTransaction(async tx => {
      const ref = db.collection('businesses').doc(businessId), business = await tx.get(ref);
      if (!business.exists || business.data()?.id !== businessId) throw new HttpError(404, 'El negocio no existe.');
      assertOwner(business.data() as Business, user.uid);
      const requested = parseOperationRange(range, Date.now());
      const rows = await tx.get(ref.collection('appointments').where('dateKey', '>=', requested.from).where('dateKey', '<=', requested.through).orderBy('dateKey', 'asc').limit(1000));
      return summarizeOwnerOperation({ businessId, ownerUid: user.uid, range: requested, serverNow: Date.now(), records: rows.docs.map(doc => ({ id: doc.id, data: doc.data() })) });
    });
  } catch (error) {
    if (error instanceof OperationSummaryRangeError) throw new HttpError(400, error.message, 'OPERATION_SUMMARY_INVALID_RANGE');
    if (error instanceof OperationSummaryCapacityError) throw new HttpError(413, error.message, 'OPERATION_SUMMARY_RANGE_TOO_LARGE');
    if (error instanceof StorageError) throw new HttpError(error.status === 413 ? 413 : 503, 'No se pudo completar la consulta. Inténtalo de nuevo o reduce el periodo.', error.code);
    throw error;
  }
}
