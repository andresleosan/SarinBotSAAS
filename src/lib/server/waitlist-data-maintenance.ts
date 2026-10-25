import 'server-only';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { Database, DocumentData, Transaction, Query, QueryDocumentSnapshot, QuerySnapshot } from '@/lib/storage/types';
import { isDataJson, isDataPath } from '../../../shared/data-protocol';
import { documentIdSchema } from './schemas';
import { HttpError } from './http';
import { stableDocumentId } from './businesses';
import { ownerWaitlistMarkerSchema } from '@/lib/owner-waitlist';

// Private operational helpers, with no route, credentials or implicit database.
const scopeSchema = z.object({ businessId: documentIdSchema.refine(value => !/[\x00-\x1f\x7f]/.test(value)), ownerUid: z.string().min(1).max(128).refine(value => !/[\x00-\x1f\x7f]/.test(value)).optional() }).strict();
type Scope = z.infer<typeof scopeSchema>;
type Row = { path: string; data: DocumentData };
export type WaitlistDataExport = { version: 1; scope: Scope; documents: Row[]; sha256: string };
const exportSchema = z.object({ version: z.literal(1), scope: scopeSchema, documents: z.array(z.object({ path: z.string(), data: z.record(z.string(), z.unknown()) }).strict()), sha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict();

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, child]) => [key, canonical(child)]));
  return value;
}
function digest(scope: Scope, documents: Row[]) { return createHash('sha256').update(JSON.stringify(canonical({ version: 1, scope, documents }))).digest('hex'); }
async function collect(db: Database, tx: Transaction, scope: Scope): Promise<Row[]> {
  const collection = db.collection('businesses').doc(scope.businessId).collection('waitlistRequests');
  const validate = (id: string, data: DocumentData | undefined): Row => {
    const path = `businesses/${scope.businessId}/waitlistRequests/${id}`;
    if (!data || !isDataPath(path, true) || !isDataJson(data) || data.businessId !== scope.businessId || typeof data.ownerUid !== 'string' || !data.ownerUid
      || scope.ownerUid && data.ownerUid !== scope.ownerUid) throw new HttpError(503, 'No se pudo validar el inventario privado de espera.');
    return { path, data };
  };
  // A corrupt owner field would hide the canonical document from the query.
  if (scope.ownerUid) {
    const canonical = await tx.get(collection.doc(stableDocumentId('waitlist', scope.businessId, scope.ownerUid)));
    if (canonical.exists) validate(canonical.id, canonical.data());
  }
  // Also include tombstones and unexpected IDs in the authorized inventory.
  const requestDocs = scope.ownerUid ? await pagedDocuments(tx, collection.where('ownerUid', '==', scope.ownerUid)) : (await tx.get(collection)).docs;
  if (!scope.ownerUid && requestDocs.length > 1000) throw new HttpError(413, 'Divide la exportación privada por cuentas.');
  const documents = requestDocs.map(document => validate(document.id, document.data()));
  // Canonical record identity survives singleton deletion or replacement. Review
  // markers remain private inventory even when no current request can join them.
  const markers = db.collection('businesses').doc(scope.businessId).collection('waitlistOwnerReviews');
  const recordId = scope.ownerUid ? stableDocumentId('waitlist', scope.businessId, scope.ownerUid) : null;
  const markerDocs = recordId ? await pagedDocuments(tx, markers.where('waitlistRecordId', '==', recordId)) : (await tx.get(markers)).docs;
  if (!scope.ownerUid && documents.length + markerDocs.length > 1000) throw new HttpError(413, 'Divide la exportación privada por cuentas.');
  for (const document of markerDocs) {
    const data = document.data(), parsed = ownerWaitlistMarkerSchema.safeParse(data), path = `businesses/${scope.businessId}/waitlistOwnerReviews/${document.id}`;
    if (!parsed.success || !isDataPath(path, true) || !isDataJson(data) || parsed.data.businessId !== scope.businessId || parsed.data.entryId !== document.id
      || recordId && parsed.data.waitlistRecordId !== recordId) throw new HttpError(503, 'No se pudo validar el inventario privado de espera.');
    documents.push({ path, data });
  }
  return documents.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
}
async function pagedDocuments(tx: Transaction, base: Query): Promise<QueryDocumentSnapshot[]> {
  const documents: QueryDocumentSnapshot[] = []; let after: string | null = null;
  for (;;) {
    const query: Query = (after ? base.where('__name__', '>', after) : base).orderBy('__name__', 'asc').limit(100);
    const page: QuerySnapshot = await tx.get(query);
    if (page.docs.length > 100) throw new HttpError(503, 'Inventario privado no verificable.');
    for (const doc of page.docs) { if (after !== null && doc.id <= after) throw new HttpError(503, 'Inventario privado no verificable.'); documents.push(doc); after = doc.id; }
    if (page.docs.length < 100) return documents;
  }
}

/** Export includes personal identifiers and must stay in the private case file. */
export async function exportWaitlistData(db: Database, supplied: Scope): Promise<WaitlistDataExport> {
  const scope = scopeSchema.parse(supplied);
  const documents = await db.runTransaction(tx => collect(db, tx, scope));
  return { version: 1, scope, documents, sha256: digest(scope, documents) };
}

/** Administrative erasure also removes anti-replay tombstones; stop writers first. */
export async function deleteExportedWaitlistData(db: Database, supplied: WaitlistDataExport): Promise<{ deleted: number }> {
  const parsed = exportSchema.safeParse(supplied);
  if (!parsed.success || !isDataJson(parsed.data) || digest(parsed.data.scope, parsed.data.documents) !== parsed.data.sha256) throw new HttpError(400, 'La exportación privada no es válida.');
  const exported = parsed.data;
  if (exported.documents.length > 100) throw new HttpError(413, 'La eliminación admite hasta 100 documentos. Divide por cuenta y vuelve a exportar.');
  return db.runTransaction(async tx => {
    const current = await collect(db, tx, exported.scope);
    if (digest(exported.scope, current) !== exported.sha256) throw new HttpError(409, 'Las solicitudes cambiaron desde la exportación. Revisa una exportación nueva.');
    for (const row of current) {
      const [, businessId, collection, id] = row.path.split('/');
      tx.delete(db.collection('businesses').doc(businessId).collection(collection).doc(id));
    }
    return { deleted: current.length };
  });
}

export type WaitlistErasureProgress = { version: 1; exportSha256: string; totalCount: number; deletedCount: number; complete: boolean; basis: 'verified_batch' | 'current_inventory'; sha256: string };
type BatchOptions = { writersStopped: true; previous?: WaitlistErasureProgress };
const progressSchema = z.object({ version: z.literal(1), exportSha256: z.string().length(64).regex(/^[a-f0-9]+$/), totalCount: z.number().int().nonnegative().safe(), deletedCount: z.number().int().nonnegative().safe(), complete: z.boolean(), basis: z.enum(['verified_batch', 'current_inventory']), sha256: z.string().length(64).regex(/^[a-f0-9]+$/) }).strict();
const progressHash = (value: Omit<WaitlistErasureProgress, 'sha256'>) => createHash('sha256').update(JSON.stringify(canonical({ kind: 'waitlist-erasure-progress', ...value }))).digest('hex');
const inventoryChanged = () => new HttpError(409, 'El inventario cambió. Conserva los recibos y revisa una exportación nueva.');
function batchInput(supplied: WaitlistDataExport, options: BatchOptions) {
  if (options?.writersStopped !== true) throw new HttpError(409, 'Detén los escritores antes de borrar el inventario privado.');
  const parsed = exportSchema.safeParse(supplied);
  if (!parsed.success || !isDataJson(parsed.data) || !parsed.data.scope.ownerUid || digest(parsed.data.scope, parsed.data.documents) !== parsed.data.sha256) throw new HttpError(400, 'La exportación privada no es válida.');
  const exported = parsed.data, expectedRecordId = stableDocumentId('waitlist', exported.scope.businessId, exported.scope.ownerUid!);
  let lastPath = '';
  for (const row of exported.documents) {
    const parts = row.path.split('/');
    if (!isDataPath(row.path, true) || parts.length !== 4 || parts[0] !== 'businesses' || parts[1] !== exported.scope.businessId || row.path <= lastPath) throw new HttpError(400, 'La exportación privada no es válida.');
    if (parts[2] === 'waitlistRequests') {
      if (row.data.businessId !== exported.scope.businessId || row.data.ownerUid !== exported.scope.ownerUid) throw new HttpError(400, 'La exportación privada no es válida.');
    } else if (parts[2] === 'waitlistOwnerReviews') {
      const marker = ownerWaitlistMarkerSchema.safeParse(row.data);
      if (!marker.success || marker.data.businessId !== exported.scope.businessId || marker.data.waitlistRecordId !== expectedRecordId || marker.data.entryId !== parts[3]) throw new HttpError(400, 'La exportación privada no es válida.');
    } else throw new HttpError(400, 'La exportación privada no es válida.');
    lastPath = row.path;
  }
  let deletedCount = 0;
  if (options.previous) {
    const previous = progressSchema.safeParse(options.previous);
    if (!previous.success) throw new HttpError(400, 'El recibo de progreso no es válido.');
    const { sha256, ...body } = previous.data;
    if (progressHash(body) !== sha256 || body.exportSha256 !== exported.sha256 || body.totalCount !== exported.documents.length || body.deletedCount > body.totalCount || body.complete !== (body.deletedCount === body.totalCount)) throw new HttpError(400, 'El recibo de progreso no es válido.');
    deletedCount = body.deletedCount;
  }
  return { exported, deletedCount };
}
function progressFor(exported: WaitlistDataExport, deletedCount: number, basis: WaitlistErasureProgress['basis']): WaitlistErasureProgress {
  const body = { version: 1 as const, exportSha256: exported.sha256, totalCount: exported.documents.length, deletedCount, complete: deletedCount === exported.documents.length, basis };
  return { ...body, sha256: progressHash(body) };
}
async function batchRows(db: Database, tx: Transaction, rows: Row[]) {
  const actual: (Row | null)[] = [];
  for (let start = 0; start < rows.length; start += 4) actual.push(...await Promise.all(rows.slice(start, start + 4).map(async row => {
    const [parent, businessId, child, id] = row.path.split('/'), doc = await tx.get(db.collection(parent).doc(businessId).collection(child).doc(id));
    if (!doc.exists) return null;
    if (JSON.stringify(canonical(doc.data())) !== JSON.stringify(canonical(row.data))) throw inventoryChanged();
    return row;
  })));
  return actual;
}
async function assertLastInventory(db: Database, tx: Transaction, scope: Scope, expected: Row[]) {
  const ref = db.collection('businesses').doc(scope.businessId), recordId = stableDocumentId('waitlist', scope.businessId, scope.ownerUid!);
  const canonicalDoc = await tx.get(ref.collection('waitlistRequests').doc(recordId));
  if (canonicalDoc.exists && (canonicalDoc.data()?.ownerUid !== scope.ownerUid || canonicalDoc.data()?.businessId !== scope.businessId)) throw inventoryChanged();
  const requests = await tx.get(ref.collection('waitlistRequests').where('ownerUid', '==', scope.ownerUid!).limit(101));
  const markers = await tx.get(ref.collection('waitlistOwnerReviews').where('waitlistRecordId', '==', recordId).limit(101));
  const actual = [...requests.docs.map(doc => ({ path: `${ref.path}/waitlistRequests/${doc.id}`, data: doc.data() })), ...markers.docs.map(doc => ({ path: `${ref.path}/waitlistOwnerReviews/${doc.id}`, data: doc.data() }))].sort((a,b)=>a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  if (digest(scope, actual) !== digest(scope, expected)) throw inventoryChanged();
}
/** Private case-file workflow: each transaction verifies and deletes at most100
 * exported rows. Keep the full export and each receipt until final completion. */
export async function deleteExportedWaitlistDataBatch(db: Database, supplied: WaitlistDataExport, options: BatchOptions): Promise<WaitlistErasureProgress> {
  const { exported, deletedCount } = batchInput(supplied, options), rows = exported.documents.slice(deletedCount, deletedCount + 100);
  return db.runTransaction(async tx => {
    const actual = await batchRows(db, tx, rows);
    if (actual.some(row => row === null)) throw inventoryChanged();
    const next = deletedCount + rows.length;
    if (next === exported.documents.length) await assertLastInventory(db, tx, exported.scope, rows);
    for (const row of rows) { const [parent,businessId,child,id] = row.path.split('/'); tx.delete(db.collection(parent).doc(businessId).collection(child).doc(id)); }
    return progressFor(exported, next, 'verified_batch');
  });
}
/** Lost response recovery proves the next exported batch is wholly present or
 * absent. A partial/changed inventory never becomes a guessed success. */
export async function reconcileWaitlistDataErasure(db: Database, supplied: WaitlistDataExport, options: BatchOptions): Promise<WaitlistErasureProgress> {
  const { exported, deletedCount } = batchInput(supplied, options), rows = exported.documents.slice(deletedCount, deletedCount + 100);
  return db.runTransaction(async tx => {
    const actual = await batchRows(db, tx, rows), missing = actual.filter(row => row === null).length;
    if (missing !== 0 && missing !== rows.length) throw inventoryChanged();
    const next = missing === rows.length ? deletedCount + rows.length : deletedCount;
    if (next === exported.documents.length) await assertLastInventory(db, tx, exported.scope, []);
    return progressFor(exported, next, 'current_inventory');
  });
}
