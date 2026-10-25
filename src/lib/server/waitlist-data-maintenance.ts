import 'server-only';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { Database, DocumentData, Transaction } from '@/lib/storage/types';
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
  const snapshot = await tx.get(scope.ownerUid ? collection.where('ownerUid', '==', scope.ownerUid) : collection);
  if (snapshot.size > 1000) throw new HttpError(413, 'Divide la exportación privada por cuentas.');
  const documents = snapshot.docs.map(document => validate(document.id, document.data()));
  // Canonical record identity survives singleton deletion or replacement. Review
  // markers remain private inventory even when no current request can join them.
  const markers = db.collection('businesses').doc(scope.businessId).collection('waitlistOwnerReviews');
  const recordId = scope.ownerUid ? stableDocumentId('waitlist', scope.businessId, scope.ownerUid) : null;
  const markerSnapshot = await tx.get(recordId ? markers.where('waitlistRecordId', '==', recordId) : markers);
  if (documents.length + markerSnapshot.size > 1000) throw new HttpError(413, 'Divide la exportación privada por cuentas.');
  for (const document of markerSnapshot.docs) {
    const data = document.data(), parsed = ownerWaitlistMarkerSchema.safeParse(data), path = `businesses/${scope.businessId}/waitlistOwnerReviews/${document.id}`;
    if (!parsed.success || !isDataPath(path, true) || !isDataJson(data) || parsed.data.businessId !== scope.businessId || parsed.data.entryId !== document.id
      || recordId && parsed.data.waitlistRecordId !== recordId) throw new HttpError(503, 'No se pudo validar el inventario privado de espera.');
    documents.push({ path, data });
  }
  return documents.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
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
