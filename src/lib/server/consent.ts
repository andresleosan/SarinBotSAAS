import 'server-only';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { getAdminDb } from '@/lib/firebase/admin';
import type { Database, Transaction } from '@/lib/storage/types';
import { consentContent, type ConsentBusiness, type ConsentDocuments, type ConsentReceipt, type ConsentScope, type ConsentStatus } from '@/lib/legal';
import type { ChatActor } from '@/types/chat';
import { documentIdSchema, requestIdSchema } from './schemas';
import { HttpError } from './http';

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0).map(([key, item]) => [key, canonical(item)]));
  return value;
}
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
export const consentStateKey = (uid: string, scope: ConsentScope, businessId: string | null = null) => `consent_state_${hash([uid, scope, businessId])}`;
const scopeSchema = z.enum(['account', 'business_client']);
const revisionSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER - 1);
const fingerprintSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const consentInputSchema = z.object({ scope: scopeSchema, businessId: documentIdSchema.optional(), action: z.enum(['accept', 'revoke']), requestId: requestIdSchema,
  expectedRevision: revisionSchema, fingerprint: fingerprintSchema.optional(), termsAccepted: z.boolean().optional(), dataAuthorized: z.boolean().optional(), preauthorization: z.string().max(2048).optional(),
}).strict().refine(value => value.scope === 'business_client' ? Boolean(value.businessId) : value.businessId === undefined);
type ConsentInput = z.input<typeof consentInputSchema>;
const stateSchema = z.object({ version: z.literal(1), uid: z.string(), scope: scopeSchema, businessId: z.string().nullable(), revision: revisionSchema, active: z.boolean(), fingerprint: fingerprintSchema, receiptId: documentIdSchema });
const proofSchema = z.object({ version: z.literal(1), nonce: z.string().regex(/^[a-f0-9]{48}$/), fingerprint: fingerprintSchema, issuedAt: z.number().int().nonnegative(), expiresAt: z.number().int().nonnegative() }).strict();
// Single-process application: restarting invalidates unclaimed 20-minute proofs,
// never persisted receipts. No anonymous database writes or identity data.
const signingState = globalThis as typeof globalThis & { __sarinConsentKey?: Buffer };
const signingKey = signingState.__sarinConsentKey ??= randomBytes(32);
const sign = (payload: string) => createHmac('sha256', signingKey).update(payload).digest('base64url');

export function consentDocuments(scope: ConsentScope, business?: ConsentBusiness): ConsentDocuments {
  const content = consentContent(scope, business && { id: business.id, name: business.name, phoneWhatsApp: business.phoneWhatsApp });
  return { ...content, fingerprint: hash(content) };
}
export const preauthorizationSchema = z.object({ termsAccepted: z.literal(true), dataAuthorized: z.literal(true), fingerprint: fingerprintSchema }).strict();
export function preauthorizeAccount(input: z.input<typeof preauthorizationSchema>) {
  const parsed = preauthorizationSchema.parse(input), documents = consentDocuments('account');
  if (parsed.fingerprint !== documents.fingerprint) throw new HttpError(409, 'Los documentos cambiaron. Revisa las decisiones otra vez.', 'CONSENT_CHANGED');
  const issuedAt = Date.now(), expiresAt = issuedAt + 20 * 60000;
  const payload = Buffer.from(JSON.stringify({ version: 1, nonce: randomBytes(24).toString('hex'), fingerprint: documents.fingerprint, issuedAt, expiresAt })).toString('base64url');
  return { token: `${payload}.${sign(payload)}`, expiresAt };
}
function proof(token: string | undefined, fingerprint: string) {
  const invalid = () => new HttpError(428, 'Revisa las dos decisiones antes de continuar. Si la sesión se reinició, inténtalo de nuevo.', 'CONSENT_REQUIRED');
  if (!token || token.length > 2048) throw invalid();
  const [payload, signature, extra] = token.split('.');
  if (!payload || !signature || extra !== undefined) throw invalid();
  const expected = Buffer.from(sign(payload)), actual = Buffer.from(signature);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) throw invalid();
  let decoded: unknown;
  try { decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')); } catch { throw invalid(); }
  const parsed = proofSchema.safeParse(decoded);
  if (!parsed.success || parsed.data.fingerprint !== fingerprint || parsed.data.issuedAt > Date.now() || parsed.data.expiresAt <= Date.now() || parsed.data.expiresAt - parsed.data.issuedAt !== 20 * 60000) throw invalid();
  return parsed.data;
}
function parsedState(value: unknown, uid: string, scope: ConsentScope, businessId: string | null) {
  if (value === undefined) return null;
  const parsed = stateSchema.safeParse(value);
  if (!parsed.success || parsed.data.uid !== uid || parsed.data.scope !== scope || parsed.data.businessId !== businessId) throw new HttpError(503, 'No se pudo validar tu autorización.');
  return parsed.data;
}
async function state(uid: string, scope: ConsentScope, business: ConsentBusiness | undefined, db: Database, tx?: Transaction) {
  const businessId = scope === 'business_client' ? business!.id : null;
  const reference = db.collection('serverSettings').doc(consentStateKey(uid, scope, businessId));
  const snapshot = tx ? await tx.get(reference) : await reference.get();
  return { reference, value: parsedState(snapshot.data(), uid, scope, businessId), businessId, documents: consentDocuments(scope, business) };
}
export async function readConsent(uid: string, scope: ConsentScope, business?: ConsentBusiness, db: Database = getAdminDb()): Promise<ConsentStatus> {
  const current = await state(uid, scope, business, db);
  const receipt = await verifiedReceipt(current, db);
  return { active: Boolean(current.value?.active && current.value.fingerprint === current.documents.fingerprint), revision: current.value?.revision ?? 0, documents: current.documents, receipt };
}
async function verifiedReceipt(current: Awaited<ReturnType<typeof state>>, db: Database, tx?: Transaction): Promise<ConsentReceipt | null> {
  if (!current.value) return null;
  const reference = db.collection('serverSettings').doc(current.value.receiptId);
  const saved = (tx ? await tx.get(reference) : await reference.get()).data() as ConsentReceipt | undefined;
  const value = current.value;
  if (!saved || saved.uid !== value.uid || saved.scope !== value.scope || saved.businessId !== value.businessId || saved.revision !== value.revision || saved.documents?.fingerprint !== value.fingerprint || saved.action !== (value.active ? 'accept' : 'revoke') || saved.termsAccepted !== value.active || saved.dataAuthorized !== value.active || !Number.isSafeInteger(saved.occurredAt) || saved.occurredAt < 0 || hash((({ fingerprint: _fingerprint, ...content }) => content)(saved.documents)) !== saved.documents.fingerprint) throw new HttpError(503, 'No se pudo recuperar la constancia.');
  return saved;
}
export async function assertConsent(uid: string, scope: ConsentScope, business?: ConsentBusiness, db: Database = getAdminDb(), tx?: Transaction): Promise<void> {
  const current = await state(uid, scope, business, db, tx);
  if (!current.value?.active || current.value.fingerprint !== current.documents.fingerprint) throw new HttpError(428, scope === 'account' ? 'Revisa y acepta las condiciones y la autorización de tu cuenta antes de nuevas operaciones.' : 'Autoriza el chat y las reservas de este negocio antes de continuar.', 'CONSENT_REQUIRED');
  await verifiedReceipt(current, db, tx);
}
/** Read-only anchor for optional features; a later reauthorization never restores an old opt-in. */
export async function readVerifiedConsentAnchor(uid: string, scope: ConsentScope, business: ConsentBusiness | undefined, db: Database, tx: Transaction) {
  const current = await state(uid, scope, business, db, tx);
  await verifiedReceipt(current, db, tx);
  return { active: Boolean(current.value?.active && current.value.fingerprint === current.documents.fingerprint), revision: current.value?.revision ?? 0,
    fingerprint: current.value?.fingerprint ?? current.documents.fingerprint, receiptId: current.value?.receiptId ?? null };
}
export async function updateConsent(user: ChatActor, supplied: ConsentInput, db: Database = getAdminDb()): Promise<ConsentStatus> {
  const input = consentInputSchema.parse(supplied), businessId = input.scope === 'business_client' ? input.businessId! : null;
  const receiptId = `consent_receipt_${hash([user.uid, input.scope, businessId, input.requestId])}`;
  const reference = db.collection('serverSettings').doc(receiptId), operationHash = hash(input);
  await db.runTransaction(async tx => {
    const businessDoc = businessId ? await tx.get(db.collection('businesses').doc(businessId)) : null;
    if (businessId && !businessDoc?.exists) throw new HttpError(404, 'El negocio no existe.');
    const business = businessDoc?.data() as ConsentBusiness | undefined;
    const current = await state(user.uid, input.scope, business, db, tx), existing = await tx.get(reference);
    // A replay returns current state below, never re-applies its old decision.
    if (existing.exists) {
      if (existing.data()?.operationHash !== operationHash) throw new HttpError(409, 'Este identificador ya se utilizó para otra decisión.');
      return;
    }
    if ((current.value?.revision ?? 0) !== input.expectedRevision) throw new HttpError(409, 'Tus permisos cambiaron en otra ventana. Vuelve a consultarlos.', 'CONSENT_CHANGED');
    const accepting = input.action === 'accept';
    if (accepting && (input.termsAccepted !== true || input.dataAuthorized !== true || input.fingerprint !== current.documents.fingerprint)) throw new HttpError(428, 'Debes revisar y marcar ambas decisiones vigentes.', 'CONSENT_REQUIRED');
    const preauthorized = accepting && input.scope === 'account' ? proof(input.preauthorization, current.documents.fingerprint) : null;
    const claimRef = preauthorized ? db.collection('serverSettings').doc(`consent_claim_${hash(preauthorized.nonce)}`) : null;
    const claim = claimRef ? await tx.get(claimRef) : null;
    if (claim?.exists) throw new HttpError(409, 'Esta decisión previa ya fue registrada. Revisa las casillas otra vez.', 'CONSENT_CHANGED');
    if (accepting && input.scope === 'business_client') await assertConsent(user.uid, 'account', undefined, db, tx);
    const profileRef = db.collection('users').doc(user.uid);
    const profile = accepting && input.scope === 'account' ? await tx.get(profileRef) : null;
    const revision = (current.value?.revision ?? 0) + 1, occurredAt = Date.now();
    const receipt: ConsentReceipt = { uid: user.uid, scope: input.scope, businessId, requestId: input.requestId, action: input.action, revision, occurredAt, preauthorizedAt: preauthorized?.issuedAt ?? null,
      termsAccepted: accepting, dataAuthorized: accepting, documents: current.documents };
    tx.create(reference, { ...receipt, operationHash });
    tx.set(current.reference, { version: 1, uid: user.uid, scope: input.scope, businessId, revision, active: accepting, fingerprint: current.documents.fingerprint, receiptId });
    if (claimRef) tx.create(claimRef, { uid: user.uid, receiptId, occurredAt });
    if (accepting && input.scope === 'account' && !profile?.exists) tx.set(profileRef, { uid: user.uid, email: user.email ?? '', displayName: typeof user.name === 'string' ? user.name : '', visitedTenants: [], createdAt: occurredAt });
  });
  const business = businessId ? (await db.collection('businesses').doc(businessId).get()).data() as ConsentBusiness : undefined;
  return readConsent(user.uid, input.scope, business, db);
}
