import 'server-only';
import { createHash, randomInt, timingSafeEqual } from 'node:crypto';
import type { DecodedIdToken } from 'firebase-admin/auth';
import type { Database, Transaction } from '@/lib/storage/types';
import type { Business } from '@/types/firestore';
import type { CreateInvitationInput, RedeemInvitationInput, InvitationAdminCommand, InvitationRecord, InvitationSummary, InvitationPage, InvitationCreationResult, InvitationRedemptionResult, InvitationCommandResult } from '@/types/invitations';
import { getAdminDb } from '@/lib/firebase/admin';
import { PAID_TRIAL_PERIOD_END } from '@/lib/paid-trial';
import { isSuperadmin } from './auth';
import { HttpError } from './http';
import { businessIdForOwner, privateBusinessDraft, publicBusiness, stableDocumentId } from './businesses';
import { activateIntroductoryTrial } from './introductory-access';
import { createInvitationSchema, redeemInvitationSchema, invitationCommandSchema, invitationCursorSchema, normalizeInvitationEmail } from './invitation-schemas';
import { businessQuotaScope, initializeResponsePeriods, parseResponsePeriod, readResponsePeriodState, responsePeriodReference } from './response-periods';

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
const unavailable = () => new HttpError(409, 'La invitación no está disponible.', 'INVITATION_UNAVAILABLE');
function assertAdmin(user: DecodedIdToken) { if (!isSuperadmin(user.uid)) throw new HttpError(403, 'Acceso exclusivo de administración.'); }
function verifiedEmail(user: DecodedIdToken): string {
  if (user.firebase?.sign_in_provider !== 'google.com' || user.email_verified !== true || !user.email) throw new HttpError(403, 'Usa tu cuenta de Google con correo verificado para canjear la invitación.');
  return normalizeInvitationEmail(user.email);
}
function matches(record: InvitationRecord | undefined, code: string, email: string): record is InvitationRecord {
  if (!record || !/^[a-f0-9]{64}$/.test(record.codeHash)) return false;
  return timingSafeEqual(Buffer.from(record.codeHash, 'hex'), Buffer.from(sha256(code), 'hex')) && record.recipientEmail === email;
}
async function summary(record: InvitationRecord, db: Database, transaction?: Transaction): Promise<InvitationSummary> {
  const { codeHash: _hash, createFingerprint: _fingerprint, ...visible } = record;
  let usage: InvitationSummary['usage'] = null;
  if (record.redemption) {
    const businessReference = db.collection('businesses').doc(record.redemption.businessId);
    const quotaReference = responsePeriodReference(db, businessQuotaScope(record.redemption.businessId), record.redemption.trialPeriodId);
    const [business, period] = await Promise.all([transaction ? transaction.get(businessReference) : businessReference.get(), transaction ? transaction.get(quotaReference) : quotaReference.get()]);
    const trial = (business.data() as Business | undefined)?.subscription.paidTrial;
    const appointmentsUsed = trial?.source === 'invitation' && trial.invitationId === record.id && Number.isSafeInteger(trial.appointmentsUsed) ? trial.appointmentsUsed : null;
    usage = { appointmentsUsed, appointmentLimit: 10, responsesUsed: period.exists ? parseResponsePeriod(period.data()).usedResponses : null, responseLimit: 700 };
  }
  return { ...visible, codeState: record.state === 'issued' ? Date.now() >= record.expiresAt ? 'expired' : 'available' : record.state, usage };
}

export async function createInvitation(admin: DecodedIdToken, input: CreateInvitationInput, db: Database = getAdminDb()): Promise<InvitationCreationResult> {
  assertAdmin(admin);
  const parsed = createInvitationSchema.parse(input);
  const id = stableDocumentId(admin.uid, parsed.requestId, 'invitation').slice(0, 24);
  const fingerprint = sha256(JSON.stringify([parsed.recipientEmail, parsed.expiresInDays]));
  const reference = db.collection('invitations').doc(id);
  for (let attempt = 0; attempt < 32; attempt++) {
    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    const codeHash = sha256(code);
    const index = db.collection('serverSettings').doc(`invitation_code_${codeHash}`);
    const result = await db.runTransaction(async transaction => {
      const [existing, allocated] = await Promise.all([transaction.get(reference), transaction.get(index)]);
      if (existing.exists) {
        const saved = existing.data() as InvitationRecord;
        if (saved.createdBy !== admin.uid || saved.createFingerprint !== fingerprint) throw new HttpError(409, 'Esta solicitud pertenece a otra invitación.', 'INVITATION_REQUEST_CONFLICT');
        return { invitation: await summary(saved, db, transaction), code: null, replayed: true };
      }
      // Never reuse a code: expired/revoked/redeemed invitations must still be
      // distinguishable during retries and recovery.
      if (allocated.exists) return null;
      const now = Date.now();
      const record: InvitationRecord = { id, recipientEmail: parsed.recipientEmail, codeHash, maskedCode: `••••${code.slice(-2)}`, createdBy: admin.uid, createFingerprint: fingerprint,
        createdAt: now, expiresAt: now + parsed.expiresInDays * 86400000, expiresInDays: parsed.expiresInDays, version: 0, state: 'issued' };
      transaction.create(reference, record);
      transaction.create(index, { version: 1, invitationId: id, codeHash });
      return { invitation: await summary(record, db), code, replayed: false };
    });
    if (result) return result;
  }
  throw new HttpError(503, 'No pudimos generar un código disponible. Inténtalo de nuevo.', 'INVITATION_GENERATION_UNAVAILABLE');
}

export async function claimInvitationAttempt(uid: string, db: Database, now: number, email?: string): Promise<void> {
  const references = [db.collection('serverSettings').doc(`invitation_rate_${sha256(uid)}`), ...(email ? [db.collection('serverSettings').doc(`invitation_email_rate_${sha256(email)}`)] : [])];
  const limits = email ? [[60000, 5], [3600000, 20], [86400000, 50]] : [[60000, 10]];
  await db.runTransaction(async transaction => {
    const documents = await Promise.all(references.map(reference => transaction.get(reference)));
    const states = documents.map(document => {
      const saved = document.data();
      if (saved && (!Array.isArray(saved.timestamps) || saved.timestamps.length > 50 || !saved.timestamps.every((at: unknown, index: number, all: number[]) => Number.isSafeInteger(at) && (at as number) >= 0 && (at as number) <= now && (index === 0 || (at as number) >= all[index - 1])) || !Number.isSafeInteger(saved.version) || saved.version < 0)) throw new HttpError(503, 'No pudimos validar los intentos. Inténtalo más tarde.');
      return { timestamps: (saved?.timestamps ?? []).filter((at: number) => at > now - 86400000) as number[], version: saved?.version ?? 0 };
    });
    let retryAfter = 0;
    for (const state of states) for (const [window, maximum] of limits) {
      const recent = state.timestamps.filter(at => at > now - window);
      if (recent.length >= maximum) retryAfter = Math.max(retryAfter, Math.ceil((recent[recent.length - maximum] + window - now) / 1000));
    }
    if (retryAfter) throw new HttpError(429, 'Demasiados intentos. Espera antes de volver a canjear.', 'INVITATION_RATE_LIMITED', retryAfter);
    states.forEach((state, index) => transaction.set(references[index], { timestamps: [...state.timestamps, now], version: state.version + 1 }));
  });
}

export async function redeemInvitation(user: DecodedIdToken, input: RedeemInvitationInput, db: Database = getAdminDb()): Promise<InvitationRedemptionResult> {
  const email = verifiedEmail(user);
  const parsed = redeemInvitationSchema.parse(input);
  const businessReference = db.collection('businesses').doc(businessIdForOwner(user.uid));
  // Recovery is selected only by the authenticated owner, never by a guessed
  // code. Every other attempt is admitted before reading the code index.
  const recovery = await db.runTransaction(async transaction => {
    const owned = await transaction.get(businessReference);
    const business = owned.data() as Business | undefined;
    const trial = business?.subscription.paidTrial;
    if (!business || business.ownerUid !== user.uid || trial?.source !== 'invitation' || !invitationCursorSchema.safeParse(trial.invitationId).success) return null;
    const record = (await transaction.get(db.collection('invitations').doc(trial.invitationId))).data() as InvitationRecord | undefined;
    return matches(record, parsed.code, email) && record.redemption?.uid === user.uid && record.redemption.requestId === parsed.requestId ? { business, invitationId: record.id, replayed: true } : null;
  });
  if (recovery) return recovery;
  await claimInvitationAttempt(user.uid, db, Date.now(), email);
  const indexReference = /^\d{6}$/.test(parsed.code) ? db.collection('serverSettings').doc(`invitation_code_${sha256(parsed.code)}`) : null;
  const index = indexReference ? (await indexReference.get()).data() : null;
  if (indexReference && (index?.version !== 1 || index.codeHash !== sha256(parsed.code) || !invitationCursorSchema.safeParse(index.invitationId).success)) throw unavailable();
  const id = indexReference ? index!.invitationId as string : parsed.code.slice(6, 30);
  const reference = db.collection('invitations').doc(id);
  const profileReference = db.collection('users').doc(user.uid);
  return db.runTransaction(async transaction => {
    const [document, businessDocument, profile, lockedIndex] = await Promise.all([transaction.get(reference), transaction.get(businessReference), transaction.get(profileReference), indexReference ? transaction.get(indexReference) : null]);
    if (indexReference && (lockedIndex?.data()?.invitationId !== id || lockedIndex.data()?.version !== 1 || lockedIndex.data()?.codeHash !== sha256(parsed.code))) throw unavailable();
    const invitation = document.data() as InvitationRecord | undefined;
    if (!matches(invitation, parsed.code, email)) throw unavailable();
    if (businessDocument.exists && businessDocument.data()?.ownerUid !== user.uid) throw new HttpError(403, 'No tienes acceso a este negocio.');
    if (invitation.redemption) {
      if (invitation.redemption.uid !== user.uid || invitation.redemption.requestId !== parsed.requestId) throw new HttpError(409, 'La invitación ya fue canjeada.', 'INVITATION_ALREADY_REDEEMED');
      if (!businessDocument.exists || businessDocument.id !== invitation.redemption.businessId) throw new HttpError(503, 'No pudimos recuperar tu acceso.');
      return { business: businessDocument.data() as Business, invitationId: id, replayed: true };
    }
    const now = Date.now();
    if (invitation.state !== 'issued' || now >= invitation.expiresAt) throw unavailable();
    const business = businessDocument.exists ? businessDocument.data() as Business : privateBusinessDraft(user, now);
    if (profile.data()?.ownedTenantId && profile.data()?.ownedTenantId !== business.id) throw new HttpError(409, 'La cuenta ya tiene otro negocio vinculado.');
    const payment = business.subscription.lastPaymentId ? await transaction.get(db.collection('paymentReceipts').doc(business.subscription.lastPaymentId)) : null;
    if (payment?.data()?.status === 'pending') throw new HttpError(409, 'Resuelve primero el comprobante pendiente con administración.', 'PAYMENT_PENDING');
    const subscription = activateIntroductoryTrial(business.subscription, { source: 'invitation', invitationId: id }, now);
    const quota = await readResponsePeriodState(business, db, transaction, now);
    const periodId = `invitation_${id}`;
    const updated: Business = { ...business, subscription };
    const record: InvitationRecord = { ...invitation, state: 'redeemed', version: invitation.version + 1,
      redemption: { uid: user.uid, email, businessId: business.id, requestId: parsed.requestId, trialPeriodId: periodId, at: now },
      access: { state: 'active', at: now, by: user.uid, reason: 'Canje de invitación' } };
    initializeResponsePeriods(transaction, db, { ...quota, current: null });
    transaction.create(responsePeriodReference(db, quota.scopeId, periodId), { id: periodId, source: 'trial', planId: null, startsAt: now, endsAt: PAID_TRIAL_PERIOD_END, includedResponses: 700, extraResponses: 0, usedResponses: 0, reservedResponses: 0 });
    transaction.set(reference, record);
    transaction.set(businessReference, updated);
    transaction.set(profileReference, { ownedTenantId: business.id }, { merge: true });
    if (business.slug) transaction.set(db.collection('publicBusinesses').doc(business.slug), publicBusiness(updated));
    return { business: updated, invitationId: id, replayed: false };
  });
}

export async function updateInvitation(admin: DecodedIdToken, input: InvitationAdminCommand, db: Database = getAdminDb()): Promise<InvitationCommandResult> {
  assertAdmin(admin);
  const parsed = invitationCommandSchema.parse(input);
  const fingerprint = sha256(JSON.stringify(parsed));
  const commandReference = db.collection('serverSettings').doc(`invitation_command_${stableDocumentId(admin.uid, parsed.requestId)}`);
  const reference = db.collection('invitations').doc(parsed.invitationId);
  return db.runTransaction(async transaction => {
    const [command, document] = await Promise.all([transaction.get(commandReference), transaction.get(reference)]);
    if (!document.exists) throw new HttpError(404, 'La invitación no existe.');
    const saved = document.data() as InvitationRecord;
    if (command.exists) {
      if (command.data()?.fingerprint !== fingerprint) throw new HttpError(409, 'Esta solicitud pertenece a otra acción.', 'INVITATION_REQUEST_CONFLICT');
      return { invitation: await summary(saved, db, transaction), replayed: true };
    }
    if (saved.version !== parsed.expectedVersion) throw new HttpError(409, 'La invitación cambió. Actualiza antes de continuar.', 'INVITATION_STATE_CHANGED');
    const before = await summary(saved, db, transaction);
    const audit = { at: Date.now(), by: admin.uid, reason: parsed.reason };
    let updated: InvitationRecord;
    let business: Business | undefined;
    if (parsed.action === 'revoke_code') {
      if (saved.state !== 'issued') throw new HttpError(409, 'Solo puedes revocar un código sin usar.', 'INVITATION_STATE_CHANGED');
      updated = { ...saved, state: 'revoked', version: saved.version + 1, codeRevocation: audit };
    } else {
      if (saved.state !== 'redeemed' || !saved.redemption) throw new HttpError(409, 'La invitación aún no tiene acceso de cortesía.', 'INVITATION_STATE_CHANGED');
      const document = await transaction.get(db.collection('businesses').doc(saved.redemption.businessId));
      business = document.data() as Business | undefined;
      const trial = business?.subscription.paidTrial;
      if (!business || trial?.source !== 'invitation' || trial.invitationId !== saved.id) throw new HttpError(409, 'No pudimos validar el acceso de cortesía.', 'INVITATION_STATE_CHANGED');
      const accessSuspended = parsed.action === 'suspend_access';
      business = { ...business, subscription: { ...business.subscription, paidTrial: { ...trial, accessSuspended } } };
      updated = { ...saved, version: saved.version + 1, access: { ...audit, state: accessSuspended ? 'suspended' : 'active' } };
    }
    transaction.set(reference, updated);
    transaction.create(commandReference, { fingerprint, action: parsed.action, at: audit.at });
    if (business) {
      transaction.set(db.collection('businesses').doc(business.id), business);
      if (business.slug) transaction.set(db.collection('publicBusinesses').doc(business.slug), publicBusiness(business));
    }
    const { codeHash: _hash, createFingerprint: _fingerprint, ...visible } = updated;
    return { invitation: { ...before, ...visible, codeState: updated.state === 'issued' ? before.codeState : updated.state }, replayed: false };
  });
}

export async function listInvitations(admin: DecodedIdToken, after?: string, db: Database = getAdminDb()): Promise<InvitationPage> {
  assertAdmin(admin);
  let query = db.collection('invitations').orderBy('id', 'asc');
  if (after !== undefined) query = query.where('id', '>', invitationCursorSchema.parse(after));
  const result = await query.limit(51).get();
  const invitations = await Promise.all(result.docs.slice(0, 50).map(document => summary(document.data() as InvitationRecord, db)));
  return { invitations, nextCursor: result.size > 50 ? invitations.at(-1)!.id : null };
}
