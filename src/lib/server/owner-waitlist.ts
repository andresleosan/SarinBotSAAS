import 'server-only';
import type { ChatActor } from '@/types/chat';
import type { Business } from '@/types/firestore';
import type { Database, Transaction, Query, QueryDocumentSnapshot } from '@/lib/storage/types';
import { z } from 'zod';
import { getAdminDb } from '@/lib/firebase/admin';
import { StorageError } from '@/lib/storage/database';
import { OwnerWaitlistModelError, ownerWaitlistCursorSchema, ownerWaitlistDetailSchema, ownerWaitlistQuerySchema, ownerWaitlistPageSchema, ownerWaitlistReviewCommandSchema, ownerWaitlistMarkerSchema, markerMatchesWaitlistRevision, readOwnerWaitlistReview, projectOwnerWaitlistRow, parseOwnerWaitlistDate, compareOwnerWaitlistRows, type OwnerWaitlistDetail, type OwnerWaitlistPage, type OwnerWaitlistQuery, type OwnerWaitlistReviewCommand, type OwnerWaitlistReviewResult, type OwnerWaitlistReviewState } from '@/lib/owner-waitlist';
import { readOwnerWaitlistProjection, parseCanonicalWaitlistRecord, type WaitlistRecord } from './waitlist';
import { assertOwner } from './businesses';
import { assertConsent } from './consent';
import { bookingSubjectHash } from './booking-subject-consent';
import { HttpError } from './http';

const unverifiable = () => new HttpError(503, 'No se pudo verificar la espera. Vuelve a consultar.', 'OWNER_WAITLIST_UNVERIFIABLE');
const changed = () => new HttpError(409, 'La solicitud cambió. Vuelve a consultar.', 'OWNER_WAITLIST_CHANGED');
const exactId = ownerWaitlistCursorSchema.shape.recordId;
async function ownerBusiness(tx: Transaction, owner: ChatActor, businessId: string, db: Database): Promise<Business> {
  const doc = await tx.get(db.collection('businesses').doc(businessId));
  if (!doc.exists) throw new HttpError(404, 'El negocio no existe.');
  const raw = doc.data()!;
  assertOwner(raw as Business, owner.uid);
  const catalogItem = z.object({ id: exactId, name: z.string().min(1).max(120) });
  if (!z.object({ id: z.literal(businessId), services: z.array(catalogItem).max(60), resources: z.array(catalogItem).max(30) }).safeParse(raw).success) throw unverifiable();
  return raw as Business;
}
async function guarded<T>(action: () => Promise<T>): Promise<T> {
  try { return await action(); }
  catch (error) {
    if (error instanceof OwnerWaitlistModelError || error instanceof StorageError || error instanceof HttpError && error.status === 503) throw unverifiable();
    throw error;
  }
}
export async function readOwnerWaitlistPage(owner: ChatActor, businessId: string, supplied: OwnerWaitlistQuery, db: Database = getAdminDb()): Promise<OwnerWaitlistPage> {
  exactId.parse(businessId); const input = ownerWaitlistQuerySchema.parse(supplied);
  return guarded(() => db.runTransaction(async tx => {
    const business = await ownerBusiness(tx, owner, businessId, db), ref = db.collection('businesses').doc(businessId);
    try { parseOwnerWaitlistDate(input.dateKey, Date.now()); } catch { throw new HttpError(400, 'Elige una fecha válida hasta los próximos 366 días.'); }
    const cursor = input.cursor;
    if (cursor) {
      const anchor = await tx.get(ref.collection('waitlistRequests').doc(cursor.recordId));
      if (!anchor.exists) throw changed();
      const record = parseCanonicalWaitlistRecord(cursor.recordId, anchor.data(), businessId);
      if (!record.request || record.request.dateKey !== input.dateKey || record.request.id !== cursor.entryId || record.request.createdAt !== cursor.createdAt) throw changed();
    }
    const base = ref.collection('waitlistRequests').where('request.dateKey', '==', input.dateKey);
    const records: { recordId: string; record: WaitlistRecord }[] = [], seen = new Set<string>();
    const append = (documents: QueryDocumentSnapshot[], limit: number, block: 'first' | 'tail' | 'after') => {
      if (documents.length > limit) throw unverifiable();
      for (const doc of documents) {
        const record = parseCanonicalWaitlistRecord(doc.id, doc.data(), businessId), item = record.request;
        if (!item || item.dateKey !== input.dateKey || seen.has(doc.id)) throw unverifiable();
        const row = { createdAt: item.createdAt, entryId: item.id }, previous = records.at(-1)?.record.request;
        if (previous && compareOwnerWaitlistRows({ createdAt: previous.createdAt, entryId: previous.id }, row) >= 0
          || cursor && (compareOwnerWaitlistRows(cursor, row) >= 0 || block === 'tail' && item.createdAt !== cursor.createdAt || block === 'after' && item.createdAt <= cursor.createdAt)) throw unverifiable();
        // Validate every document including lookahead before publishing a page.
        projectOwnerWaitlistRow(doc.id, record, business, { revision: 0, reviewed: false, updatedAt: null }, Date.now());
        seen.add(doc.id); records.push({ recordId: doc.id, record });
      }
    };
    const query = async (target: Query, limit: number, block: 'first' | 'tail' | 'after') => append((await tx.get(target.limit(limit))).docs, limit, block);
    if (!cursor) await query(base.orderBy('request.createdAt', 'asc').orderBy('request.id', 'asc'), 21, 'first');
    else {
      await query(base.where('request.createdAt', '==', cursor.createdAt).where('request.id', '>', cursor.entryId).orderBy('request.id', 'asc'), 21, 'tail');
      if (records.length < 21) await query(base.where('request.createdAt', '>', cursor.createdAt).orderBy('request.createdAt', 'asc').orderBy('request.id', 'asc'), 21 - records.length, 'after');
    }
    const returned = records.slice(0, 20), reviews: ReturnType<typeof readOwnerWaitlistReview>[] = [];
    for (let start = 0; start < returned.length; start += 4) {
      reviews.push(...await Promise.all(returned.slice(start, start + 4).map(async item => {
        const entryId = item.record.request!.id, marker = await tx.get(ref.collection('waitlistOwnerReviews').doc(entryId));
        return readOwnerWaitlistReview(marker.exists ? marker.data() : undefined, { businessId, recordId: item.recordId, entryId, waitlistRevision: item.record.revision });
      })));
    }
    const serverNow = Date.now(), rows = returned.map((item, i) => projectOwnerWaitlistRow(item.recordId, item.record, business, reviews[i], serverNow)), last = rows.at(-1);
    const result = ownerWaitlistPageSchema.safeParse({ businessId, ownerUid: owner.uid, dateKey: input.dateKey, serverNow, rows,
      nextCursor: records.length > 20 && last ? { recordId: last.recordId, entryId: last.entryId, createdAt: last.createdAt } : null, coverage: 'current_indexed_requests' });
    if (!result.success) throw unverifiable();
    return result.data;
  }));
}
export async function updateOwnerWaitlistReview(owner: ChatActor, businessId: string, recordId: string, supplied: OwnerWaitlistReviewCommand, db: Database = getAdminDb()): Promise<OwnerWaitlistReviewResult> {
  exactId.parse(businessId); exactId.parse(recordId); const input = ownerWaitlistReviewCommandSchema.parse(supplied);
  const operationHash = bookingSubjectHash({ businessId, recordId, actorUid: owner.uid, ...input });
  return guarded(() => db.runTransaction(async tx => {
    await ownerBusiness(tx, owner, businessId, db);
    const ref = db.collection('businesses').doc(businessId), doc = await tx.get(ref.collection('waitlistRequests').doc(recordId));
    if (!doc.exists) throw changed();
    const record = parseCanonicalWaitlistRecord(recordId, doc.data(), businessId);
    if (!record.request || record.request.id !== input.entryId || record.revision !== input.expectedWaitlistRevision) throw changed();
    const markerRef = ref.collection('waitlistOwnerReviews').doc(input.entryId), marker = await tx.get(markerRef);
    const review = readOwnerWaitlistReview(marker.exists ? marker.data() : undefined, { businessId, recordId, entryId: input.entryId, waitlistRevision: record.revision });
    await assertConsent(owner.uid, 'account', undefined, db, tx);
    const storedMarker = marker.exists ? ownerWaitlistMarkerSchema.parse(marker.data()) : null;
    const previous = storedMarker && markerMatchesWaitlistRevision(storedMarker, record.revision) ? storedMarker : null;
    const result = (current: typeof review, replayed: boolean): OwnerWaitlistReviewResult => ({ businessId, ownerUid: owner.uid, recordId, entryId: input.entryId, waitlistRevision: record.revision, review: current, replayed });
    if (previous?.lastOperation.requestId === input.requestId) {
      if (previous.lastOperation.operationHash !== operationHash) throw new HttpError(409, 'Ese identificador corresponde a otra revisión.', 'OWNER_WAITLIST_REQUEST_REUSED');
      return result(review, true);
    }
    if (review.revision !== input.expectedReviewRevision) throw changed();
    if (review.reviewed === input.reviewed) throw new HttpError(409, 'La revisión ya tiene ese valor.', 'OWNER_WAITLIST_NO_CHANGE');
    if (review.revision >= Number.MAX_SAFE_INTEGER - 1) throw unverifiable();
    const next = { revision: review.revision + 1, reviewed: input.reviewed, updatedAt: Date.now() };
    const value = ownerWaitlistMarkerSchema.safeParse({ version: 2, businessId, waitlistRecordId: recordId, entryId: input.entryId, waitlistRevision: record.revision, ...next, actorUid: owner.uid,
      lastOperation: { requestId: input.requestId, operationHash, appliedRevision: next.revision } });
    if (!value.success) throw unverifiable();
    tx.set(markerRef, value.data);
    return result(next, false);
  }));
}
export async function readOwnerWaitlistDetail(owner: ChatActor, businessId: string, recordId: string, db: Database = getAdminDb()): Promise<OwnerWaitlistDetail> {
  ownerWaitlistCursorSchema.shape.recordId.parse(businessId); ownerWaitlistCursorSchema.shape.recordId.parse(recordId);
  return guarded(() => db.runTransaction(async tx => {
    const current = await readOwnerWaitlistProjection(tx, owner, businessId, recordId, db);
    const businessRef = db.collection('businesses').doc(businessId), business = (await tx.get(businessRef)).data() as Business;
    const item = current.record.request!;
    const marker = await tx.get(businessRef.collection('waitlistOwnerReviews').doc(item.id));
    const review = readOwnerWaitlistReview(marker.exists ? marker.data() : undefined, { businessId, recordId, entryId: item.id, waitlistRevision: current.record.revision });
    const serverNow = current.state.serverNow, request = current.state.request!;
    const row = projectOwnerWaitlistRow(recordId, current.record, business, review, serverNow);
    const result = ownerWaitlistDetailSchema.safeParse({ businessId, ownerUid: owner.uid, serverNow, row, state: request.status, ...(request.reason ? { reason: request.reason } : {}), availability: current.availability });
    if (!result.success) throw unverifiable();
    return result.data;
  }));
}
/** Minimal current-state fence, including canonical withdrawal tombstones. */
export async function readOwnerWaitlistReviewState(owner: ChatActor, businessId: string, recordId: string, db: Database = getAdminDb()): Promise<OwnerWaitlistReviewState> {
  exactId.parse(businessId); exactId.parse(recordId);
  return guarded(() => db.runTransaction(async tx => {
    await ownerBusiness(tx, owner, businessId, db);
    const ref = db.collection('businesses').doc(businessId), doc = await tx.get(ref.collection('waitlistRequests').doc(recordId));
    if (!doc.exists) throw new HttpError(404, 'No se pudo recuperar la entrada.', 'OWNER_WAITLIST_ENTRY_GONE');
    const record = parseCanonicalWaitlistRecord(recordId, doc.data(), businessId), entryId = record.request?.id ?? null;
    let review: OwnerWaitlistReviewState['review'] = null;
    if (entryId) {
      const marker = await tx.get(ref.collection('waitlistOwnerReviews').doc(entryId));
      review = readOwnerWaitlistReview(marker.exists ? marker.data() : undefined, { businessId, recordId, entryId, waitlistRevision: record.revision });
    }
    return { businessId, ownerUid: owner.uid, recordId, waitlistRevision: record.revision, entryId, review, serverNow: Date.now() };
  }));
}
