import 'server-only';
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { DecodedIdToken } from 'firebase-admin/auth';
import type { Database, Transaction } from '@/lib/storage/types';
import type { Business, PaymentReceipt } from '@/types/firestore';
import type { PaymentActionResult, PaymentActionView, PaymentProposal, PreparePaymentInput } from '@/types/admin-payment-actions';
import { getAdminAuth, getAdminDb } from '@/lib/firebase/admin';
import { getBillingPlan, RESPONSE_PACK } from '@/lib/billing-plans';
import { PAID_TRIAL_APPOINTMENT_LIMIT, PAID_TRIAL_INCLUDED_RESPONSES, PAID_TRIAL_PRICE_COP } from '@/lib/paid-trial';
import { isAdminPaymentRecord, PAYMENT_RETENTION_MS, PAYMENT_UUID, PAYMENT_VALID_MS, type PaymentControl, type PaymentEnvelope } from '../../../shared/admin-payment-actions';
import { readPaymentReviewContext, readPaymentReviewReceipt, applyPaymentReviewContext } from './billing';
import { isSuperadmin } from './auth';
import { HttpError } from './http';
import type { PlatformActor } from '../../../shared/platform-whatsapp-authorization';
import { platformPaymentPreparationContext } from './platform-support-bot';
import { prepareWorkIdentity, readWorkAuthority, workActor, workPayload } from './platform-whatsapp-work-authority';
import { readWork } from './platform-whatsapp-work-records';
import { createPlatformWorkStore } from './platform-whatsapp-work-store';

export const paymentIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,128}(?![\s\S])/).refine(v => !['__proto__', 'constructor', 'prototype'].includes(v));
export const paymentUuidSchema = z.string().regex(PAYMENT_UUID);
const reasonSchema = z.string().refine(s => s === s.trim() && [...s].length > 0 && [...s].length <= 500 && !/[\uD800-\uDFFF]/u.test(s));
export const preparePaymentSchema = z.discriminatedUnion('action', [
  z.object({ paymentId: paymentIdSchema, action: z.literal('approve'), requestId: paymentUuidSchema }).strict(),
  z.object({ paymentId: paymentIdSchema, action: z.literal('reject'), requestId: paymentUuidSchema, rejectionReason: reasonSchema }).strict(),
]);
export const confirmPaymentSchema = z.object({ requestId: paymentUuidSchema, expectedRevision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER), confirmed: z.literal(true) }).strict();
const unavailable = () => new HttpError(503, 'La confirmación de pagos no está disponible.', 'ADMIN_PAYMENT_UNAVAILABLE');
const conflict = () => new HttpError(409, 'La propuesta cambió o caducó. Revisa una nueva propuesta.', 'ADMIN_PAYMENT_CONFLICT');
const denied = () => new HttpError(403, 'No tienes acceso a esta propuesta.');
const invalidIdentity = () => new HttpError(401, 'La sesión ya no es válida.');
const hash = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
function keys() {
  const raw = process.env.ADMIN_PAYMENT_ACTION_KEY ?? '', key = Buffer.from(raw, 'base64');
  if (key.length !== 32 || key.toString('base64') !== raw) throw unavailable();
  const derive = (purpose: string) => createHmac('sha256', key).update(JSON.stringify(['sarin/admin-payment', 1, purpose])).digest();
  return { body: derive('body'), index: derive('idempotency'), marker: derive('key-marker').toString('hex') };
}
type Keys = ReturnType<typeof keys>;
const keyed = (key: Keys, purpose: string, v: unknown) => createHmac('sha256', key.index).update(JSON.stringify(['sarin/admin-payment', 1, purpose, v])).digest('hex');
const aad = (id: string, validUntil: number) => Buffer.from(JSON.stringify(['sarin/admin-payment', 1, 'reason', 'adminPaymentActions/' + id, validUntil]));
function encrypt(reason: string, id: string, validUntil: number, key: Keys): PaymentEnvelope {
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key.body, iv);
  cipher.setAAD(aad(id, validUntil));
  const data = Buffer.concat([cipher.update(Buffer.from(JSON.stringify(reason))), cipher.final()]);
  return { version: 1, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') };
}
function decrypt(record: PaymentControl, key: Keys): string | undefined {
  if (record.action === 'approve') return undefined;
  if (record.state !== 'pending' || Date.now() >= record.validUntil || !record.reason) throw conflict();
  try {
    const cipher = createDecipheriv('aes-256-gcm', key.body, Buffer.from(record.reason.iv, 'base64'));
    cipher.setAAD(aad(record.id, record.validUntil)); cipher.setAuthTag(Buffer.from(record.reason.tag, 'base64'));
    const reason = reasonSchema.parse(JSON.parse(Buffer.concat([cipher.update(Buffer.from(record.reason.data, 'base64')), cipher.final()]).toString('utf8')));
    if (keyed(key, 'reason', reason) !== record.reasonDigest) throw unavailable();
    return reason;
  } catch (error) { if (error instanceof HttpError) throw error; throw unavailable(); }
}
function assertRole(uid: string) { if (!isSuperadmin(uid)) throw denied(); }
function authTime(actor: DecodedIdToken, recent: boolean, now = Date.now()) {
  if (!actor || typeof actor.uid !== 'string' || !actor.uid || !Number.isSafeInteger(actor.auth_time) || actor.auth_time < 0 || actor.auth_time * 1000 > now) throw invalidIdentity();
  assertRole(actor.uid);
  if (recent && now >= actor.auth_time * 1000 + PAYMENT_VALID_MS) throw new HttpError(428, 'Vuelve a autenticarte para confirmar el pago.', 'ADMIN_PAYMENT_REAUTH_REQUIRED');
}
export async function assertPaymentActor(actor: DecodedIdToken, recent = false) {
  authTime(actor, false);
  let current;
  try { current = await getAdminAuth().getUser(actor.uid); } catch { throw invalidIdentity(); }
  const cutoff = current.tokensValidAfterTime === undefined ? 0 : Date.parse(current.tokensValidAfterTime);
  if (current.uid !== actor.uid || current.disabled || !Number.isFinite(cutoff) || actor.auth_time * 1000 < cutoff) throw invalidIdentity();
  authTime(actor, recent);
}
const reference = (db: Database, id: string) => db.collection('adminPaymentActions').doc(id);
async function readRecord(tx: Transaction, db: Database, id: string) {
  const doc = await tx.get(reference(db, id)), value = doc.data();
  if (!doc.exists) return null;
  if (!isAdminPaymentRecord('adminPaymentActions/' + id, value)) throw unavailable();
  return value;
}
async function readMarker(tx: Transaction, db: Database, key: Keys, create: boolean) {
  if (keys().marker !== key.marker) throw unavailable();
  const marker = await readRecord(tx, db, 'key_marker');
  if (marker && (marker.recordType !== 'key_marker' || marker.keyDigest !== key.marker)) throw unavailable();
  if (!marker && !create) throw unavailable();
  if (!marker) {
    const existing = await tx.get(db.collection('adminPaymentActions').orderBy('expiresAt').limit(1));
    if (!existing.empty) throw unavailable();
  }
  return marker;
}
function publicProposal(record: PaymentControl, now = Date.now()): PaymentProposal {
  return { id: record.id, actorUid: record.actorUid, paymentId: record.paymentId, action: record.action, contextFingerprint: record.contextFingerprint, revision: record.revision, expiresAt: record.validUntil, state: record.state === 'pending' && now >= record.validUntil ? 'expired' : record.state };
}
type Context = Awaited<ReturnType<typeof readPaymentReviewContext>>;
const fields = (v: object, names: readonly string[]) => names.map(k => Object.hasOwn(v, k) ? [1, (v as Record<string, unknown>)[k]] : [0]);
/** Closed tuple; only effect dependencies. The quote is historical, never today's tariff. */
export function paymentContextFingerprint(context: Context, actorUid: string, action: 'approve' | 'reject', reasonDigest: string, now: number) {
  const { receipt: r, business: b, quota: q, whatsapp } = context, sub = b.subscription, trial = sub.paidTrial;
  if (r.id !== context.reference.id || b.id !== context.businessReference.id || r.tenantId !== b.id || r.ownerUid !== b.ownerUid || !r.ownerUid || r.status !== 'pending' || r.reviewedAt !== undefined || r.rejectionReason !== undefined || !Number.isSafeInteger(r.amountCOP) || r.amountCOP <= 0 || typeof b.name !== 'string') throw conflict();
  const validNumber = (n: unknown) => Number.isSafeInteger(n) && Number(n) >= 0;
  if (![b.createdAt, r.submittedAt, sub.trialEndsAt, sub.currentPeriodEndsAt].every(validNumber) || ![sub.graceEndsAt, sub.graceGrantedAt, r.periodDays, r.responseAllowance, r.appointmentAllowance].every(v => v === undefined || validNumber(v)) || trial && ![trial.activatedAt, trial.appointmentLimit, trial.appointmentsUsed].every(validNumber)) throw conflict();
  let plan;
  try { plan = getBillingPlan(r.planId); } catch { throw conflict(); }
  const quotaFields = ['id', 'source', 'planId', 'startsAt', 'endsAt', 'includedResponses', 'extraResponses', 'usedResponses', 'reservedResponses'];
  return hash(['sarin/admin-payment-context', 1, actorUid, action, reasonDigest,
    fields(r, ['id', 'tenantId', 'ownerUid', 'status', 'kind', 'amountCOP', 'planId', 'periodDays', 'responseAllowance', 'appointmentAllowance', 'quotaPeriodId', 'submittedAt']),
    [b.id, b.ownerUid, b.name.trim(), b.createdAt, fields(sub, ['status', 'trialEndsAt', 'currentPeriodEndsAt', 'graceEndsAt', 'graceGrantedAt', 'lastPaymentId']), trial ? fields(trial, ['source', 'paymentId', 'invitationId', 'activatedAt', 'appointmentLimit', 'appointmentsUsed', 'accessSuspended']) : null],
    [plan.id, plan.periodDays, plan.includedResponses, PAID_TRIAL_PRICE_COP, PAID_TRIAL_APPOINTMENT_LIMIT, PAID_TRIAL_INCLUDED_RESPONSES, RESPONSE_PACK.responses],
    [q.scopeId, q.initialize, q.current ? fields(q.current, quotaFields) : null, q.next ? fields(q.next, quotaFields) : null],
    [sub.currentPeriodEndsAt > now, (sub.graceEndsAt ?? 0) > now, q.current ? q.current.endsAt > now : null], whatsapp ?? null]);
}
function validateEffect(context: Context, db: Database, action: 'approve' | 'reject', reason: string | undefined, now: number) {
  // Same policy as the manual helper, with a write sink for a preparation preview.
  const sink: Transaction = { get: (() => { throw new Error('Payment effect attempted a late read'); }) as Transaction['get'], set() {}, create() {}, delete() {} };
  applyPaymentReviewContext(sink, db, context, action, reason, now);
}
type Guard = (tx: Transaction, now: number) => Promise<void>;
/** Internal deterministic preparation; private dispatcher supplies an exact durable guard. */
async function prepare(uid: string, input: PreparePaymentInput, db: Database, guard: Guard, channel: 'web' | 'platform') {
  const key = keys(), id = randomUUID(), requestDigest = keyed(key, 'prepare-request', [channel, uid, input.requestId]);
  const reasonDigest = keyed(key, 'reason', input.rejectionReason ?? null), inputDigest = keyed(key, 'prepare-input', [input.paymentId, input.action, reasonDigest]);
  return db.runTransaction(async tx => {
    const now = Date.now(); assertRole(uid); await guard(tx, now);
    const marker = await readMarker(tx, db, key, true), index = await readRecord(tx, db, 'request_' + requestDigest);
    if (index && index.recordType !== 'request') throw unavailable();
    if (index && now < index.expiresAt) {
      if (index.inputDigest !== inputDigest) throw conflict();
      const original = await readRecord(tx, db, index.proposalId);
      if (!original || original.recordType !== 'proposal' || original.actorUid !== uid || original.expiresAt <= now) throw conflict();
      await guard(tx, Date.now()); assertRole(uid);
      return publicProposal(original);
    }
    const context = await readPaymentReviewContext(tx, db, input.paymentId, now);
    const contextFingerprint = paymentContextFingerprint(context, uid, input.action, reasonDigest, now);
    validateEffect(context, db, input.action, input.rejectionReason, now);
    const record: PaymentControl = { version: 1, recordType: 'proposal', id, actorUid: uid, paymentId: input.paymentId, action: input.action, contextFingerprint, revision: 1, createdAt: now, validUntil: now + PAYMENT_VALID_MS, bodyExpiresAt: now + PAYMENT_VALID_MS, expiresAt: now + PAYMENT_RETENTION_MS, state: 'pending', reasonDigest, reason: input.action === 'reject' ? encrypt(input.rejectionReason!, id, now + PAYMENT_VALID_MS, key) : null, executedAt: null, confirmDigest: null, effectId: null };
    await guard(tx, Date.now());
    const writeTime = Date.now();
    assertRole(uid);
    if (writeTime >= record.validUntil || keys().marker !== key.marker || paymentContextFingerprint(context, uid, input.action, reasonDigest, writeTime) !== contextFingerprint || context.quota.next && context.quota.next.startsAt <= writeTime) throw conflict();
    if (!marker) tx.create(reference(db, 'key_marker'), { version: 1, recordType: 'key_marker', keyDigest: key.marker });
    tx.create(reference(db, id), record);
    tx.set(reference(db, 'request_' + requestDigest), { version: 1, recordType: 'request', requestDigest, inputDigest, proposalId: id, createdAt: now, expiresAt: now + PAYMENT_RETENTION_MS });
    return publicProposal(record);
  });
}
export async function preparePaymentAction(actor: DecodedIdToken, input: PreparePaymentInput, db?: Database): Promise<PaymentProposal> {
  await assertPaymentActor(actor);
  const parsed = preparePaymentSchema.parse(input);
  return prepare(actor.uid, parsed, db ?? getAdminDb(), async (_tx, now) => authTime(actor, false, now), 'web');
}
type PaymentSelection = Omit<PreparePaymentInput, 'requestId'>;
export function parsePlatformPaymentSelection(question: string): PaymentSelection | null {
  const approve = /^aprobar pago ([A-Za-z0-9_-]{1,128})(?![\s\S])/u.exec(question);
  if (approve && paymentIdSchema.safeParse(approve[1]).success) return { paymentId: approve[1], action: 'approve' };
  const reject = /^rechazar pago ([A-Za-z0-9_-]{1,128}): ([\s\S]+)(?![\s\S])/u.exec(question);
  if (reject && paymentIdSchema.safeParse(reject[1]).success && reasonSchema.safeParse(reject[2]).success) return { paymentId: reject[1], action: 'reject', rejectionReason: reject[2] };
  return null;
}
/** Only the actual source-bound private dispatcher can prepare; no token or positive authority is fabricated. */
export async function preparePlatformPaymentAction(actor: PlatformActor, selection: PaymentSelection): Promise<PaymentProposal> {
  assertRole(actor.uid);
  const source = platformPaymentPreparationContext(actor, selection), { db, lease } = source;
  const job = await createPlatformWorkStore(db).readAuthorized(lease);
  if (!job || job.kind !== 'admin_query' || job.authorityKind !== 'actor' || job.jobId !== source.requestId || JSON.stringify(workActor(job)) !== JSON.stringify(actor) || workPayload(job, Date.now())?.question !== source.question) throw denied();
  const prepared = await prepareWorkIdentity(job, db, Date.now());
  if (!prepared) throw denied();
  return prepare(actor.uid, { ...selection, requestId: source.requestId }, db, async (tx, now) => {
    source.signal.throwIfAborted();
    const current = await readWork(tx, db, 'platformWhatsAppJobs/' + job.jobId);
    if (!current || current.recordType !== 'job' || !['leased', 'reply_saved'].includes(current.status) || current.processingDeadlineAt === null || current.processingDeadlineAt <= now || current.epoch !== lease.epoch || current.leaseToken !== lease.token || current.leaseExpiresAt === null || current.leaseExpiresAt <= now || current.authorityKind !== 'actor' || JSON.stringify(workActor(current)) !== JSON.stringify(actor) || workPayload(current, now)?.question !== source.question || !await readWorkAuthority(current, prepared, tx, db, now)) throw denied();
  }, 'platform');
}
export async function confirmPaymentAction(actor: DecodedIdToken, id: string, input: { requestId: string; expectedRevision: number; confirmed: true }, db?: Database): Promise<{ receipt: PaymentReceipt; business: Business }> {
  await assertPaymentActor(actor, true);
  paymentUuidSchema.parse(id); const command = confirmPaymentSchema.parse(input), key = keys(), database = db ?? getAdminDb();
  return database.runTransaction(async tx => {
    authTime(actor, true);
    await readMarker(tx, database, key, false);
    const record = await readRecord(tx, database, id), now = Date.now();
    if (!record || record.recordType !== 'proposal' || record.expiresAt <= now) throw conflict();
    if (record.actorUid !== actor.uid) throw denied();
    if (record.revision !== command.expectedRevision) throw conflict();
    if (record.state === 'executed') {
      const receipt = await readPaymentReviewReceipt(tx, database, record.paymentId);
      const business = receipt && (await tx.get(database.collection('businesses').doc(receipt.tenantId))).data() as Business | undefined;
      if (!receipt || !business || receipt.id !== record.effectId || business.id !== receipt.tenantId || business.ownerUid !== receipt.ownerUid || receipt.status !== (record.action === 'approve' ? 'approved' : 'rejected') || receipt.reviewedAt !== record.executedAt) throw conflict();
      authTime(actor, true); return { receipt, business };
    }
    if (record.state !== 'pending' || now >= record.validUntil) throw conflict();
    const reason = decrypt(record, key);
    let context: Context;
    try { context = await readPaymentReviewContext(tx, database, record.paymentId, now); }
    catch (error) { if (error instanceof HttpError && error.status === 404 || error instanceof z.ZodError) throw conflict(); throw error; }
    if (paymentContextFingerprint(context, actor.uid, record.action, record.reasonDigest, now) !== record.contextFingerprint) throw conflict();
    const effectTime = Date.now();
    authTime(actor, true, effectTime);
    if (effectTime >= record.validUntil || keys().marker !== key.marker || paymentContextFingerprint(context, actor.uid, record.action, record.reasonDigest, effectTime) !== record.contextFingerprint || context.quota.next && context.quota.next.startsAt <= effectTime) throw conflict();
    const result = applyPaymentReviewContext(tx, database, context, record.action, reason, effectTime);
    tx.set(reference(database, id), { ...record, state: 'executed', reason: null, executedAt: effectTime, effectId: result.receipt.id, confirmDigest: keyed(key, 'confirm', [command.requestId, command.expectedRevision, true]) });
    return result;
  });
}
const safeRecords = (receipt: PaymentReceipt, business: Business) => ({ business: { id: business.id, name: business.name.trim() }, payment: { id: receipt.id, amountCOP: receipt.amountCOP, planId: receipt.planId ?? 'monthly', kind: receipt.kind ?? 'subscription', status: receipt.status } });
export function paymentActionResult(result: { receipt: PaymentReceipt; business: Business }): PaymentActionResult { return { ...safeRecords(result.receipt, result.business), effectId: result.receipt.id, reviewedAt: result.receipt.reviewedAt! }; }
export async function readPaymentAction(actor: DecodedIdToken, id: string, db?: Database): Promise<PaymentActionView> {
  await assertPaymentActor(actor); paymentUuidSchema.parse(id);
  const key = keys(), database = db ?? getAdminDb();
  return database.runTransaction(async tx => {
    await readMarker(tx, database, key, false);
    const record = await readRecord(tx, database, id);
    if (!record || record.recordType !== 'proposal' || record.expiresAt <= Date.now()) throw conflict();
    if (record.actorUid !== actor.uid) throw denied();
    const receipt = await readPaymentReviewReceipt(tx, database, record.paymentId);
    const business = receipt && (await tx.get(database.collection('businesses').doc(receipt.tenantId))).data() as Business | undefined;
    if (!receipt || !business || receipt.id !== record.paymentId || business.id !== receipt.tenantId || business.ownerUid !== receipt.ownerUid) throw conflict();
    const p = publicProposal(record), reason = p.state === 'pending' ? decrypt(record, key) : undefined;
    authTime(actor, false);
    return { proposal: { id: p.id, paymentId: p.paymentId, action: p.action, revision: p.revision, expiresAt: p.expiresAt, state: p.state }, ...safeRecords(receipt, business), effect: record.action === 'reject' ? 'Rechazar el comprobante y retirar la gracia correspondiente; se conserva la vigencia pagada existente.' : receipt.kind === 'response_pack' ? `Añadir ${RESPONSE_PACK.responses} respuestas al período vigente indicado en el comprobante.` : receipt.kind === 'paid_trial' ? `Activar la prueba pagada de ${PAID_TRIAL_APPOINTMENT_LIMIT} citas, una sola vez.` : `Activar ${receipt.periodDays ?? 30} días desde la confirmación o desde el fin pagado existente, lo que ocurra después.`, ...(reason !== undefined ? { rejectionReason: reason } : {}) };
  });
}
