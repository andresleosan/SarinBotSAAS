import 'server-only';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { ChatActor } from '@/types/chat';
import type { Business } from '@/types/firestore';
import type { Database, Transaction } from '@/lib/storage/types';
import { bookingSubjectCaseSchema, type BookingSubjectCase } from '@/lib/booking-subject';
import { bookingSubjectContent, type BookingSubjectDocuments, type BookingSubjectReceipt, type BookingSubjectConsentStatus } from '@/lib/booking-subject-legal';
import { getAdminDb } from '@/lib/firebase/admin';
import { readBookingDataPolicy } from './booking-data-policy';
import { assertConsent } from './consent';
import { documentIdSchema, requestIdSchema } from './schemas';
import { HttpError } from './http';
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => [key, canonical(item)]));
  return value;
}
export const bookingSubjectHash = (value: unknown) => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
export const bookingSubjectStateKey = (uid: string, businessId: string, bookingRequestId: string) => `subject_state_${bookingSubjectHash([uid, businessId, bookingRequestId])}`;
const receiptKey = (uid: string, businessId: string, caseId: string, requestId: string) => `subject_receipt_${bookingSubjectHash([uid, businessId, caseId, requestId])}`;
const count = z.number().int().nonnegative().safe(), fingerprint = z.string().regex(/^[a-f0-9]{64}$/);
const decisions = z.object({ dataAuthorized: z.boolean(), sensitiveDataAuthorized: z.boolean(), representationDeclared: z.boolean() }).strict();
export const bookingSubjectConsentInputSchema = z.object({ businessId: documentIdSchema, case: bookingSubjectCaseSchema, action: z.enum(['accept', 'revoke']), requestId: requestIdSchema, expectedRevision: count.max(Number.MAX_SAFE_INTEGER - 1), fingerprint: fingerprint.optional(), decisions: decisions.optional() }).strict();
export const bookingSubjectConsentQuerySchema = z.object({ businessId: documentIdSchema, case: bookingSubjectCaseSchema }).strict();
const stateSchema = z.object({ version: z.literal(1), scope: z.literal('booking_subject'), uid: z.string().min(1).max(128), businessId: documentIdSchema, case: bookingSubjectCaseSchema, revision: count.min(1), active: z.boolean(), fingerprint, receiptId: documentIdSchema, policyRevision: count }).strict();
const documentsSchema = z.object({ version: z.string().min(1), scope: z.literal('booking_subject'), business: z.object({ id: documentIdSchema, name: z.string(), phoneWhatsApp: z.string() }).strict(), case: bookingSubjectCaseSchema, policyRevision: count, dataMode: z.enum(['general', 'health']), dataAuthorization: z.string(), sensitiveDataAuthorization: z.string(), representationDeclaration: z.string(), notice: z.string(), alternative: z.string(), rights: z.string(), processors: z.string(), purposes: z.array(z.string()), categories: z.array(z.string()), requirements: decisions, fingerprint }).strict();
const receiptSchema = z.object({ uid: z.string(), scope: z.literal('booking_subject'), businessId: documentIdSchema, case: bookingSubjectCaseSchema, requestId: requestIdSchema, action: z.enum(['accept', 'revoke']), revision: count.min(1), occurredAt: count, policyRevision: count, decisions, documents: documentsSchema, operationHash: fingerprint }).strict();
const unavailable = () => new HttpError(503, 'No se pudo validar la autorización de esta reserva.', 'BOOKING_SUBJECT_UNAVAILABLE');
const required = () => new HttpError(428, 'Revisa y autoriza los datos de esta reserva antes de continuar.', 'BOOKING_SUBJECT_CONSENT_REQUIRED');
const changed = () => new HttpError(409, 'Este caso cambió. Inicia una nueva reserva o actualiza sus permisos.', 'BOOKING_SUBJECT_CONFLICT');
function parse<T>(schema: z.ZodType<T>, value: unknown): T { const result = schema.safeParse(value); if (!result.success) throw unavailable(); return result.data; }
async function load(user: ChatActor, businessId: string, supplied: BookingSubjectCase, db: Database, tx?: Transaction) {
  documentIdSchema.parse(businessId); const subjectCase = bookingSubjectCaseSchema.parse(supplied);
  const businessRef = db.collection('businesses').doc(businessId), stateRef = db.collection('serverSettings').doc(bookingSubjectStateKey(user.uid, businessId, subjectCase.bookingRequestId));
  const [businessDoc, classification, stateDoc] = await Promise.all([tx ? tx.get(businessRef) : businessRef.get(), readBookingDataPolicy(businessId, db, tx), tx ? tx.get(stateRef) : stateRef.get()]);
  if (!businessDoc.exists) throw new HttpError(404, 'El negocio no existe.');
  const business = businessDoc.data() as Business;
  const content = bookingSubjectContent(business, subjectCase, classification.capability), documents: BookingSubjectDocuments = { ...content, fingerprint: bookingSubjectHash(content) };
  const state = stateDoc.exists ? parse(stateSchema, stateDoc.data()) : null;
  if (state && (state.uid !== user.uid || state.businessId !== businessId || state.case.bookingRequestId !== subjectCase.bookingRequestId)) throw unavailable();
  if (state && bookingSubjectHash(state.case) !== bookingSubjectHash(subjectCase)) throw changed();
  let receipt: BookingSubjectReceipt | null = null;
  if (state) {
    const ref = db.collection('serverSettings').doc(state.receiptId), value = parse(receiptSchema, (tx ? await tx.get(ref) : await ref.get()).data());
    const { fingerprint: docHash, ...snapshot } = value.documents;
    const requirements = { dataAuthorized: snapshot.dataMode === 'health' || snapshot.case.subjectKind === 'represented_minor', sensitiveDataAuthorized: snapshot.dataMode === 'health', representationDeclared: snapshot.case.subjectKind === 'represented_minor' };
    if (value.uid !== user.uid || value.businessId !== businessId || value.scope !== state.scope || value.revision !== state.revision || value.policyRevision !== state.policyRevision || value.documents.policyRevision !== state.policyRevision || value.documents.business.id !== businessId || bookingSubjectHash(value.case) !== bookingSubjectHash(state.case) || bookingSubjectHash(value.documents.case) !== bookingSubjectHash(state.case) || docHash !== state.fingerprint || bookingSubjectHash(snapshot) !== docHash || bookingSubjectHash(snapshot.requirements) !== bookingSubjectHash(requirements) || value.action !== (state.active ? 'accept' : 'revoke') || receiptKey(user.uid, businessId, subjectCase.bookingRequestId, value.requestId) !== state.receiptId || Object.entries(requirements).some(([key, needed]) => value.decisions[key as keyof typeof requirements] !== (state.active && needed))) throw unavailable();
    const { operationHash: _operationHash, ...publicReceipt } = value; receipt = publicReceipt;
  }
  const status: BookingSubjectConsentStatus = { required: content.requirements.dataAuthorized, active: Boolean(state?.active && state.fingerprint === documents.fingerprint), revision: state?.revision ?? 0, capability: classification.capability, documents, receipt };
  return { business, subjectCase, stateRef, state, status };
}
export async function readBookingSubjectConsent(user: ChatActor, businessId: string, subjectCase: BookingSubjectCase, db: Database = getAdminDb(), tx?: Transaction): Promise<BookingSubjectConsentStatus> {
  if (tx) return (await load(user, businessId, subjectCase, db, tx)).status;
  return db.runTransaction(async transaction => (await load(user, businessId, subjectCase, db, transaction)).status);
}
export async function assertBookingSubjectConsent(tx: Transaction, user: ChatActor, business: Business, subjectCase: BookingSubjectCase, db: Database) {
  const current = await load(user, business.id, subjectCase, db, tx), status = current.status;
  if (subjectCase.subjectKind === 'represented_minor' && !status.capability.representedMinorsEnabled) throw new HttpError(409, 'El negocio no ha habilitado reservas para menores.', 'REPRESENTED_BOOKING_DISABLED');
  if (!status.required) return null;
  if (!status.active || !current.state || !status.receipt) throw required();
  return { receiptId: current.state.receiptId, fingerprint: status.documents.fingerprint, policyRevision: status.capability.revision };
}
export async function updateBookingSubjectConsent(user: ChatActor, supplied: z.input<typeof bookingSubjectConsentInputSchema>, db: Database = getAdminDb()): Promise<BookingSubjectConsentStatus> {
  const input = bookingSubjectConsentInputSchema.parse(supplied), receiptId = receiptKey(user.uid, input.businessId, input.case.bookingRequestId, input.requestId), operationHash = bookingSubjectHash(input);
  await db.runTransaction(async tx => {
    const current = await load(user, input.businessId, input.case, db, tx), receiptRef = db.collection('serverSettings').doc(receiptId), existing = await tx.get(receiptRef);
    if (existing.exists) { const saved = parse(receiptSchema, existing.data()); if (saved.operationHash !== operationHash || saved.uid !== user.uid || saved.businessId !== input.businessId || bookingSubjectHash(saved.case) !== bookingSubjectHash(input.case)) throw changed(); return; }
    if (current.status.revision !== input.expectedRevision) throw changed();
    const accepting = input.action === 'accept', needs = current.status.documents.requirements;
    if (accepting) {
      if (!current.status.required) throw new HttpError(409, 'Esta reserva no necesita autorización adicional.');
      if (input.case.subjectKind === 'represented_minor' && !current.status.capability.representedMinorsEnabled) throw new HttpError(409, 'El negocio no ha habilitado reservas para menores.');
      if (input.fingerprint !== current.status.documents.fingerprint || !input.decisions || Object.entries(needs).some(([key, needed]) => needed && !input.decisions![key as keyof typeof needs])) throw required();
      await assertConsent(user.uid, 'account', undefined, db, tx); await assertConsent(user.uid, 'business_client', current.business, db, tx);
    }
    const revision = current.status.revision + 1, receipt: BookingSubjectReceipt = { uid: user.uid, scope: 'booking_subject', businessId: input.businessId, case: input.case, requestId: input.requestId, action: input.action, revision, occurredAt: Date.now(), policyRevision: current.status.capability.revision, decisions: { dataAuthorized: accepting && needs.dataAuthorized, sensitiveDataAuthorized: accepting && needs.sensitiveDataAuthorized, representationDeclared: accepting && needs.representationDeclared }, documents: current.status.documents };
    tx.create(receiptRef, { ...receipt, operationHash }); tx.set(current.stateRef, { version: 1, scope: 'booking_subject', uid: user.uid, businessId: input.businessId, case: input.case, revision, active: accepting, fingerprint: current.status.documents.fingerprint, policyRevision: current.status.capability.revision, receiptId });
  });
  return readBookingSubjectConsent(user, input.businessId, input.case, db);
}
