import 'server-only';
import { assertConsent } from './consent';
import type { Database as Firestore, Query, Transaction } from '@/lib/storage/types';
import type { DecodedIdToken } from 'firebase-admin/auth';
import type { Business, PaymentReceipt, PlatformSettings } from '@/types/firestore';
import { getAdminDb } from '@/lib/firebase/admin';
import { BILLING_PLANS, getBillingPlan, RESPONSE_PACK } from '@/lib/billing-plans';
import { commercialPriceCOP } from '@/lib/commercial-offer';
import { canPurchasePaidTrial, PAID_TRIAL_APPOINTMENT_LIMIT, PAID_TRIAL_INCLUDED_RESPONSES, PAID_TRIAL_PERIOD_END, PAID_TRIAL_PRICE_COP } from '@/lib/paid-trial';
import { isSuperadmin } from './auth';
import { HttpError } from './http';
import { businessIdForOwner, privateBusinessDraft, publicBusiness, stableDocumentId } from './businesses';
import { approveSubscription, grantReceiptGrace } from './billing-policy';
import type { z } from 'zod';
import { receiptSchema, settingsSchema } from './schemas';
import { initializeResponsePeriods, readResponsePeriodState, responsePeriodReference } from './response-periods';
import { getWhatsAppBusinessStatus, readWhatsAppPaymentContext } from './whatsapp-config';
import { activateIntroductoryTrial } from './introductory-access';

function defaultSettings(): PlatformSettings {
  const configuredPrice = (value: string | undefined, fallback: number) => {
    const price = Number(value);
    return Number.isSafeInteger(price) && price > 0 && price <= 100000000 ? price : fallback;
  };
  return {
    companyName: 'SarinBot',
    weeklyPriceCOP: configuredPrice(process.env.WEEKLY_PRICE_COP, getBillingPlan('weekly').defaultPriceCOP),
    fortnightlyPriceCOP: configuredPrice(process.env.FORTNIGHTLY_PRICE_COP, getBillingPlan('fortnightly').defaultPriceCOP),
    monthlyPriceCOP: configuredPrice(process.env.MONTHLY_PRICE_COP, getBillingPlan('monthly').defaultPriceCOP),
    whatsappPriceCOP: getBillingPlan('whatsapp').defaultPriceCOP,
    responsePackPriceCOP: RESPONSE_PACK.defaultPriceCOP,
    graceHoursOnUpload: 24, bankAccounts: [], tunnelStatus: { isOnline: false, lastPingAt: 0 },
  };
}

export async function getSettings(db: Firestore = getAdminDb()): Promise<PlatformSettings> {
  const snapshot = await db.collection('platformSettings').doc('main').get();
  if (!snapshot.exists) return defaultSettings();
  const { trialDaysDefault: _historicalFreeTrialDays, ...settings } = snapshot.data() ?? {};
  return { ...defaultSettings(), ...settings } as PlatformSettings;
}

export async function saveSettings(input: z.infer<typeof settingsSchema>, db: Firestore = getAdminDb()): Promise<PlatformSettings> {
  const parsed = settingsSchema.parse(input);
  const reference = db.collection('platformSettings').doc('main');
  return db.runTransaction(async (transaction) => {
    const current = await transaction.get(reference);
    const previous = { ...defaultSettings(), ...current.data() } as PlatformSettings;
    const settings: PlatformSettings = {
      ...parsed,
      weeklyPriceCOP: parsed.weeklyPriceCOP ?? previous.weeklyPriceCOP,
      fortnightlyPriceCOP: parsed.fortnightlyPriceCOP ?? previous.fortnightlyPriceCOP,
      whatsappPriceCOP: parsed.whatsappPriceCOP ?? previous.whatsappPriceCOP,
      responsePackPriceCOP: parsed.responsePackPriceCOP ?? previous.responsePackPriceCOP,
      tunnelStatus: { isOnline: false, lastPingAt: 0 },
    };
    transaction.set(reference, settings);
    return settings;
  });
}

export async function readReceipts(uid?: string, db: Firestore = getAdminDb()): Promise<PaymentReceipt[]> {
  const collection = db.collection('paymentReceipts');
  const query = uid ? collection.where('ownerUid', '==', uid).orderBy('submittedAt', 'desc') : collection.orderBy('submittedAt', 'desc');
  const snapshot = await query.limit(500).get();
  return snapshot.docs.map((document) => document.data() as PaymentReceipt).sort((a, b) => b.submittedAt - a.submittedAt);
}

export async function readReceiptImage(user: DecodedIdToken, paymentId: string, db: Firestore = getAdminDb()): Promise<string> {
  const document = await db.collection('paymentReceipts').doc(paymentId).get();
  if (!document.exists) throw new HttpError(404, 'El comprobante no existe.');
  if (document.data()?.ownerUid !== user.uid && !isSuperadmin(user.uid)) throw new HttpError(403, 'No tienes acceso a este comprobante.');
  const image = await db.collection('paymentImages').doc(paymentId).get();
  if (!image.exists || typeof image.data()?.receiptDataUrl !== 'string') throw new HttpError(404, 'La imagen no está disponible.');
  return image.data()!.receiptDataUrl as string;
}

export async function submitReceipt(user: DecodedIdToken, input: z.input<typeof receiptSchema>, db: Firestore = getAdminDb()): Promise<{ receipt: PaymentReceipt; business: Business }> {
  const parsed = receiptSchema.parse(input);
  const plan = parsed.kind === 'subscription' ? getBillingPlan(parsed.planId) : undefined;
  const id = stableDocumentId(user.uid, parsed.requestId, 'receipt');
  const receiptReference = db.collection('paymentReceipts').doc(id);
  const businessReference = db.collection('businesses').doc(businessIdForOwner(user.uid));
  const settingsReference = db.collection('platformSettings').doc('main');
  return db.runTransaction(async (transaction) => {
    const [existing, businessDocument, settingsDocument] = await Promise.all([transaction.get(receiptReference), transaction.get(businessReference), transaction.get(settingsReference)]);
    if (businessDocument.exists && businessDocument.data()?.ownerUid !== user.uid) throw new HttpError(403, 'No tienes acceso a este negocio.');
    if (!businessDocument.exists && parsed.kind === 'response_pack') throw new HttpError(409, 'La ampliación requiere un plan vigente.', 'RESPONSE_PACK_UNAVAILABLE');
    const now = Date.now();
    const business = businessDocument.exists ? businessDocument.data() as Business : privateBusinessDraft(user, now);
    if (existing.exists) return { receipt: existing.data() as PaymentReceipt, business };
    await assertConsent(user.uid, 'account', undefined, db, transaction);
    if (parsed.kind === 'paid_trial' && !canPurchasePaidTrial(business.subscription)) throw new HttpError(409, 'La prueba pagada solo se puede comprar una vez.', 'PAID_TRIAL_UNAVAILABLE');
    if (plan?.id === 'whatsapp' && !(await getWhatsAppBusinessStatus(business.id)).ready) throw new HttpError(409, 'WhatsApp requiere una conexión verificada antes de contratar.', 'WHATSAPP_NOT_READY');
    const settings = { ...defaultSettings(), ...settingsDocument.data() } as PlatformSettings;
    const amountCOP = commercialPriceCOP(settings, parsed.kind, plan?.id);
    if (parsed.quotedPriceCOP !== undefined && parsed.quotedPriceCOP !== amountCOP) throw new HttpError(409, 'El precio cambió. Revisa el importe actualizado antes de enviar.', 'OFFER_PRICE_CHANGED');
    const bank = settings.bankAccounts.find((account) => account.id === parsed.bankSelected || account.bankName === parsed.bankSelected);
    if (!bank) throw new HttpError(409, 'Selecciona una cuenta bancaria configurada por el administrador.');
    if (business.subscription.lastPaymentId) {
      const previous = await transaction.get(db.collection('paymentReceipts').doc(business.subscription.lastPaymentId));
      if (previous.data()?.status === 'pending') throw new HttpError(409, 'Ya tienes un comprobante pendiente de revisión.');
    }
    const quota = parsed.kind === 'response_pack' ? await readResponsePeriodState(business, db, transaction) : undefined;
    if (quota && (!quota.current || quota.current.source === 'trial' || quota.current.endsAt <= Date.now() || business.subscription.status !== 'active')) throw new HttpError(409, 'La ampliación requiere un período pagado vigente.', 'RESPONSE_PACK_UNAVAILABLE');
    const receipt: PaymentReceipt = { id, tenantId: business.id, tenantName: business.name, ownerUid: user.uid, ownerEmail: user.email ?? '', kind: parsed.kind,
      amountCOP,
      ...(plan ? { planId: plan.id, periodDays: plan.periodDays, responseAllowance: plan.includedResponses }
        : parsed.kind === 'paid_trial' ? { appointmentAllowance: PAID_TRIAL_APPOINTMENT_LIMIT }
          : { responseAllowance: RESPONSE_PACK.responses, quotaPeriodId: quota!.current!.id }),
      bankSelected: bank.bankName, status: 'pending', submittedAt: now };
    const updatedBusiness: Business = { ...business, subscription: plan ? grantReceiptGrace(business.subscription, id, now) : { ...business.subscription, lastPaymentId: id } };
    if (quota) initializeResponsePeriods(transaction, db, quota);
    transaction.create(receiptReference, receipt);
    transaction.create(db.collection('paymentImages').doc(id), { ownerUid: user.uid, receiptDataUrl: parsed.receiptDataUrl, submittedAt: now });
    transaction.set(businessReference, updatedBusiness);
    if (business.slug) transaction.set(db.collection('publicBusinesses').doc(business.slug), publicBusiness(updatedBusiness));
    if (!businessDocument.exists) transaction.set(db.collection('users').doc(user.uid), { ownedTenantId: business.id }, { merge: true });
    return { receipt, business: updatedBusiness };
  });
}

function receiptPeriodDays(receipt: PaymentReceipt): number {
  // Receipts created before plan selection always purchased 30 days.
  if (receipt.planId === undefined && receipt.periodDays === undefined) return 30;
  const plan = BILLING_PLANS.find((candidate) => candidate.id === receipt.planId);
  if (!plan || receipt.periodDays !== plan.periodDays) throw new HttpError(409, 'El plan y la duración del comprobante no son válidos.');
  return receipt.periodDays;
}

/** Query reads do not hydrate historical receipt blobs in D1. Never fetch paymentImages here. */
export async function readPaymentReviewReceipt(transaction: Transaction, db: Firestore, paymentId: string): Promise<PaymentReceipt | null> {
  const fields = ['id', 'tenantId', 'tenantName', 'ownerUid', 'ownerEmail', 'amountCOP', 'kind', 'appointmentAllowance', 'responseAllowance', 'quotaPeriodId', 'planId', 'periodDays', 'bankSelected', 'status', 'rejectionReason', 'submittedAt', 'reviewedAt'] as const;
  const query = db.collection('paymentReceipts').where('id', '==', paymentId).limit(2) as Query & { select?: (...fields: string[]) => Query };
  // Native Firestore projection also avoids materializing historical inline image fields.
  const metadata = query.select ? query.select(...fields) : query;
  const result = await transaction.get(metadata);
  if (result.empty) return null;
  if (result.size !== 1 || result.docs[0].id !== paymentId) throw new HttpError(409, 'La identidad del comprobante cambió.');
  const receipt = result.docs[0].data() as PaymentReceipt;
  return Object.fromEntries(fields.filter(field => receipt[field] !== undefined).map(field => [field, receipt[field]])) as unknown as PaymentReceipt;
}
export async function readPaymentReviewContext(transaction: Transaction, db: Firestore, paymentId: string, now: number, manualAction?: 'approve' | 'reject') {
  const reference = db.collection('paymentReceipts').doc(paymentId);
  const metadataOnly = manualAction === undefined;
  const receipt = metadataOnly ? await readPaymentReviewReceipt(transaction, db, paymentId) : (await transaction.get(reference)).data() as PaymentReceipt | undefined;
  if (!receipt) throw new HttpError(404, 'El comprobante no existe.');
  const businessReference = db.collection('businesses').doc(receipt.tenantId);
  const businessDocument = await transaction.get(businessReference);
  if (!businessDocument.exists) throw new HttpError(404, 'El negocio no existe.');
  const business = businessDocument.data() as Business;
  // The manual endpoint's terminal replay/rejection never depended on quota or readiness.
  const needsContext = manualAction === undefined || manualAction === 'approve' && receipt.status === 'pending';
  const scopeId = `business_${business.id}`;
  const quota = needsContext ? await readResponsePeriodState(business, db, transaction, now) : { scopeId, scopeReference: db.collection('responseQuotaScopes').doc(scopeId), initialize: false, current: null, next: null };
  const whatsapp = needsContext && receipt.planId === 'whatsapp' ? await (manualAction === undefined ? readWhatsAppPaymentContext : getWhatsAppBusinessStatus)(business.id, db, transaction) : null;
  return { reference, receipt, businessReference, business, quota, whatsapp, metadataOnly };
}
export function applyPaymentReviewContext(transaction: Transaction, db: Firestore, context: Awaited<ReturnType<typeof readPaymentReviewContext>>, action: 'approve' | 'reject', reason: string | undefined, now: number): { receipt: PaymentReceipt; business: Business } {
  const { reference, receipt, businessReference, business, quota, whatsapp } = context;
  const status = action === 'approve' ? 'approved' : 'rejected';
  if (receipt.status === status) return { receipt, business };
  if (receipt.status !== 'pending') throw new HttpError(409, 'Este comprobante ya fue revisado con otra decisión.');
  const reviewed: PaymentReceipt = { ...receipt, status, reviewedAt: now, ...(action === 'reject' && reason ? { rejectionReason: reason } : {}) };
  let subscription = business.subscription;
  if (receipt.kind !== undefined && receipt.kind !== 'subscription' && receipt.kind !== 'response_pack' && receipt.kind !== 'paid_trial') throw new HttpError(409, 'El tipo de comprobante no es válido.');
  if (action === 'approve' && receipt.kind === 'paid_trial') {
    if (!canPurchasePaidTrial(subscription) || receipt.amountCOP !== PAID_TRIAL_PRICE_COP || receipt.appointmentAllowance !== PAID_TRIAL_APPOINTMENT_LIMIT || receipt.planId !== undefined || receipt.periodDays !== undefined || receipt.responseAllowance !== undefined || receipt.quotaPeriodId !== undefined) throw new HttpError(409, 'Los datos de la prueba pagada no son válidos.', 'PAID_TRIAL_UNAVAILABLE');
    subscription = activateIntroductoryTrial(subscription, { source: 'payment', paymentId: receipt.id }, now);
    initializeResponsePeriods(transaction, db, { ...quota!, current: null }, now);
    const periodId = `trial_${receipt.id}`;
    transaction.create(responsePeriodReference(db, quota!.scopeId, periodId), { id: periodId, source: 'trial', planId: null, startsAt: now, endsAt: PAID_TRIAL_PERIOD_END, includedResponses: PAID_TRIAL_INCLUDED_RESPONSES, extraResponses: 0, usedResponses: 0, reservedResponses: 0 });
  } else if (action === 'approve' && receipt.kind === 'response_pack') {
    if (receipt.responseAllowance !== RESPONSE_PACK.responses || receipt.planId !== undefined || receipt.periodDays !== undefined || !quota?.current || receipt.quotaPeriodId !== quota.current.id || quota.current.source === 'trial' || quota.current.endsAt <= now || subscription.status !== 'active') throw new HttpError(409, 'La vigencia de esta ampliación ya no está disponible. Revisa el comprobante.', 'RESPONSE_PACK_EXPIRED');
    initializeResponsePeriods(transaction, db, { ...quota, current: null }, now);
    transaction.set(responsePeriodReference(db, quota.scopeId, quota.current.id), { ...quota.current, extraResponses: quota.current.extraResponses + receipt.responseAllowance });
  } else if (action === 'approve') {
    if (receipt.planId === 'whatsapp' && !whatsapp?.ready) throw new HttpError(409, 'WhatsApp requiere una conexión verificada antes de aprobar.', 'WHATSAPP_NOT_READY');
    const periodDays = receiptPeriodDays(receipt);
    const plan = getBillingPlan(receipt.planId);
    const includedResponses = receipt.responseAllowance ?? plan.includedResponses;
    if (!Number.isSafeInteger(includedResponses) || includedResponses < 1 || includedResponses > 1_000_000) throw new HttpError(409, 'La capacidad del comprobante no es válida.');
    const startsAt = Math.max(now, subscription.currentPeriodEndsAt);
    subscription = approveSubscription(subscription, receipt.id, now, periodDays);
    initializeResponsePeriods(transaction, db, quota!, now);
    const periodId = `payment_${receipt.id}`;
    transaction.create(responsePeriodReference(db, quota!.scopeId, periodId), { id: periodId, source: 'subscription', planId: plan.id, startsAt, endsAt: subscription.currentPeriodEndsAt, includedResponses, extraResponses: 0, usedResponses: 0, reservedResponses: 0 });
  } else if (receipt.kind !== 'response_pack' && subscription.lastPaymentId === receipt.id) {
    const { graceEndsAt: _graceEndsAt, ...withoutGrace } = subscription;
    const stillPaid = subscription.status === 'active' && subscription.currentPeriodEndsAt > now;
    subscription = { ...withoutGrace, status: subscription.status === 'suspended' ? 'suspended' : stillPaid ? 'active' : subscription.currentPeriodEndsAt > 0 ? 'past_due' : subscription.paidTrial ? 'trial' : 'pending_payment' };
  }
  const updatedBusiness: Business = { ...business, subscription };
  transaction.set(reference, reviewed, context.metadataOnly ? { merge: true } : undefined);
  transaction.set(businessReference, updatedBusiness);
  if (business.slug) transaction.set(db.collection('publicBusinesses').doc(business.slug), publicBusiness(updatedBusiness));
  return { receipt: reviewed, business: updatedBusiness };
}
export async function reviewPaymentInTransaction(transaction: Transaction, db: Firestore, paymentId: string, action: 'approve' | 'reject', reason: string | undefined, now: number): Promise<{ receipt: PaymentReceipt; business: Business }> {
  const context = await readPaymentReviewContext(transaction, db, paymentId, now, action);
  return applyPaymentReviewContext(transaction, db, context, action, reason, now);
}
export async function reviewPayment(paymentId: string, action: 'approve' | 'reject', reason?: string, db: Firestore = getAdminDb()): Promise<{ receipt: PaymentReceipt; business: Business }> {
  return db.runTransaction(transaction => reviewPaymentInTransaction(transaction, db, paymentId, action, reason, Date.now()));
}
