import 'server-only';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { Database, DocumentData, Transaction } from '@/lib/storage/types';
import { isDataJson, isDataPath } from '../../../shared/data-protocol';
import { documentIdSchema } from './schemas';
import { HttpError } from './http';

// Private operational helpers; deliberately no HTTP route or implicit default DB.
// Callers must supply the authorized database and retain the export privately.
const scopeSchema = z.object({ businessId: documentIdSchema, ownerUid: z.string().min(1).max(128).optional(), appointmentId: documentIdSchema.optional() }).strict();
type Scope = z.infer<typeof scopeSchema>;
type Row = { path: string; data: DocumentData };
export type ReminderDataExport = { version: 1; scope: Scope; documents: Row[]; sha256: string };
const exportSchema = z.object({ version: z.literal(1), scope: scopeSchema, documents: z.array(z.object({ path: z.string(), data: z.record(z.string(), z.unknown()) }).strict()), sha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict();

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, child]) => [key, canonical(child)]));
  return value;
}
function digest(scope: Scope, documents: Row[]) { return createHash('sha256').update(JSON.stringify(canonical({ version: 1, scope, documents }))).digest('hex'); }
async function collect(db: Database, tx: Transaction, scope: Scope): Promise<Row[]> {
  const rows: Row[] = [];
  for (const collection of scope.appointmentId ? ['reminderReceipts'] : ['reminderPreferences', 'reminderReceipts']) {
    const query = db.collection('businesses').doc(scope.businessId).collection(collection);
    // Keep the selection narrow; a storage overflow fails rather than truncating.
    let selection = scope.ownerUid ? query.where('ownerUid', '==', scope.ownerUid) : query;
    if (scope.appointmentId) selection = selection.where('appointmentId', '==', scope.appointmentId);
    const snapshot = await tx.get(selection);
    if (snapshot.size > 1000) throw new HttpError(413, 'Divide la exportación privada en ámbitos más pequeños.');
    for (const document of snapshot.docs) {
      const data = document.data(), path = `businesses/${scope.businessId}/${collection}/${document.id}`;
      if (!isDataPath(path, true) || !isDataJson(data) || data.businessId !== scope.businessId || typeof data.ownerUid !== 'string' || !data.ownerUid
        || scope.ownerUid && data.ownerUid !== scope.ownerUid || collection === 'reminderReceipts' && (typeof data.appointmentId !== 'string' || !data.appointmentId)
        || scope.appointmentId && data.appointmentId !== scope.appointmentId) throw new HttpError(503, 'No se pudo validar el inventario privado de recordatorios.');
      rows.push({ path, data });
    }
  }
  return rows.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
}

/** No writes. Export contains personal identifiers: never send it to ordinary clients or logs. */
export async function exportReminderData(db: Database, supplied: Scope): Promise<ReminderDataExport> {
  const scope = scopeSchema.parse(supplied);
  const documents = await db.runTransaction(tx => collect(db, tx, scope));
  return { version: 1, scope, documents, sha256: digest(scope, documents) };
}

/** Exact exported inventory must still match in one transaction before any deletion. */
export async function deleteExportedReminderData(db: Database, supplied: ReminderDataExport): Promise<{ deleted: number }> {
  const parsed = exportSchema.safeParse(supplied);
  if (!parsed.success || !isDataJson(parsed.data) || digest(parsed.data.scope, parsed.data.documents) !== parsed.data.sha256) throw new HttpError(400, 'La exportación privada no es válida.');
  const exported = parsed.data;
  if (exported.documents.length > 100) throw new HttpError(413, 'La eliminación admite hasta 100 documentos por ámbito. Divide por cuenta o cita y vuelve a exportar.');
  return db.runTransaction(async tx => {
    const current = await collect(db, tx, exported.scope);
    if (digest(exported.scope, current) !== exported.sha256) throw new HttpError(409, 'Los recordatorios cambiaron desde la exportación. Revisa una exportación nueva.');
    for (const row of current) {
      const [, businessId, collection, id] = row.path.split('/');
      tx.delete(db.collection('businesses').doc(businessId).collection(collection).doc(id));
    }
    return { deleted: current.length };
  });
}
