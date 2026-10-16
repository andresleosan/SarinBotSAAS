import 'server-only';
import type { Firestore } from 'firebase-admin/firestore';
import type { DecodedIdToken } from 'firebase-admin/auth';
import type { Business, PaymentReceipt, PlatformSettings } from '@/types/firestore';
import { getAdminDb } from '@/lib/firebase/admin';
import { BILLING_PLANS, getBillingPlan } from '@/lib/billing-plans';
import { isSuperadmin } from './auth';
import { HttpError } from './http';
import { businessIdForOwner, publicBusiness, stableDocumentId } from './businesses';
import { approveSubscription, grantReceiptGrace } from './billing-policy';
import type { z } from 'zod';
import { receiptSchema, settingsSchema } from './schemas';

function defaultSettings(): PlatformSettings {
  const configuredPrice = (value: string | undefined, fallback: number) => {
    const price = Number(value);
    return Number.isSafeInteger(price) && price > 0 && price <= 100000000 ? price : fallback;
  };
  return {
    companyName: 'Sarin Bot',
    weeklyPriceCOP: configuredPrice(process.env.WEEKLY_PRICE_COP, getBillingPlan('weekly').defaultPriceCOP),
    fortnightlyPriceCOP: configuredPrice(process.env.FORTNIGHTLY_PRICE_COP, getBillingPlan('fortnightly').defaultPriceCOP),
    monthlyPriceCOP: configuredPrice(process.env.MONTHLY_PRICE_COP, getBillingPlan('monthly').defaultPriceCOP),
    trialDaysDefault: 7, graceHoursOnUpload: 24, bankAccounts: [], tunnelStatus: { isOnline: false, lastPingAt: 0 },
  };
}

export async function getSettings(db: Firestore = getAdminDb()): Promise<PlatformSettings> {
  const snapshot = await db.collection('platformSettings').doc('main').get();
  if (!snapshot.exists) return defaultSettings();
  return { ...defaultSettings(), ...snapshot.data() } as PlatformSettings;
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
  const plan = getBillingPlan(parsed.planId);
  const id = stableDocumentId(user.uid, parsed.requestId, 'receipt');
  const receiptReference = db.collection('paymentReceipts').doc(id);
  const businessReference = db.collection('businesses').doc(businessIdForOwner(user.uid));
  const settingsReference = db.collection('platformSettings').doc('main');
  return db.runTransaction(async (transaction) => {
    const [existing, businessDocument, settingsDocument] = await Promise.all([transaction.get(receiptReference), transaction.get(businessReference), transaction.get(settingsReference)]);
    if (!businessDocument.exists || businessDocument.data()?.ownerUid !== user.uid) throw new HttpError(403, 'Primero configura tu negocio.');
    const business = businessDocument.data() as Business;
    if (existing.exists) return { receipt: existing.data() as PaymentReceipt, business };
    const settings = { ...defaultSettings(), ...settingsDocument.data() } as PlatformSettings;
    const bank = settings.bankAccounts.find((account) => account.id === parsed.bankSelected || account.bankName === parsed.bankSelected);
    if (!bank) throw new HttpError(409, 'Selecciona una cuenta bancaria configurada por el administrador.');
    if (business.subscription.lastPaymentId) {
      const previous = await transaction.get(db.collection('paymentReceipts').doc(business.subscription.lastPaymentId));
      if (previous.data()?.status === 'pending') throw new HttpError(409, 'Ya tienes un comprobante pendiente de revisión.');
    }
    const now = Date.now();
    const receipt: PaymentReceipt = { id, tenantId: business.id, tenantName: business.name, ownerUid: user.uid, ownerEmail: user.email ?? '', planId: plan.id, periodDays: plan.periodDays, amountCOP: settings[plan.priceField], bankSelected: bank.bankName, status: 'pending', submittedAt: now };
    const updatedBusiness: Business = { ...business, subscription: grantReceiptGrace(business.subscription, id, now) };
    transaction.create(receiptReference, receipt);
    transaction.create(db.collection('paymentImages').doc(id), { ownerUid: user.uid, receiptDataUrl: parsed.receiptDataUrl, submittedAt: now });
    transaction.set(businessReference, updatedBusiness);
    transaction.set(db.collection('publicBusinesses').doc(business.slug), publicBusiness(updatedBusiness));
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

export async function reviewPayment(paymentId: string, action: 'approve' | 'reject', reason?: string, db: Firestore = getAdminDb()): Promise<{ receipt: PaymentReceipt; business: Business }> {
  const reference = db.collection('paymentReceipts').doc(paymentId);
  return db.runTransaction(async (transaction) => {
    const document = await transaction.get(reference);
    if (!document.exists) throw new HttpError(404, 'El comprobante no existe.');
    const receipt = document.data() as PaymentReceipt;
    const businessReference = db.collection('businesses').doc(receipt.tenantId);
    const businessDocument = await transaction.get(businessReference);
    if (!businessDocument.exists) throw new HttpError(404, 'El negocio no existe.');
    const business = businessDocument.data() as Business;
    const status = action === 'approve' ? 'approved' : 'rejected';
    if (receipt.status === status) return { receipt, business };
    if (receipt.status !== 'pending') throw new HttpError(409, 'Este comprobante ya fue revisado con otra decisión.');
    const now = Date.now();
    const reviewed: PaymentReceipt = { ...receipt, status, reviewedAt: now, ...(action === 'reject' && reason ? { rejectionReason: reason } : {}) };
    let subscription = business.subscription;
    if (action === 'approve') subscription = approveSubscription(subscription, receipt.id, now, receiptPeriodDays(receipt));
    else if (subscription.lastPaymentId === receipt.id) {
      const { graceEndsAt: _graceEndsAt, ...withoutGrace } = subscription;
      const stillPaid = subscription.status === 'active' && subscription.currentPeriodEndsAt > now;
      const stillTrial = subscription.status === 'trial' && subscription.trialEndsAt > now;
      subscription = { ...withoutGrace, status: subscription.status === 'suspended' ? 'suspended' : stillPaid ? 'active' : stillTrial ? 'trial' : 'past_due' };
    }
    const updatedBusiness: Business = { ...business, subscription };
    transaction.set(reference, reviewed);
    transaction.set(businessReference, updatedBusiness);
    transaction.set(db.collection('publicBusinesses').doc(business.slug), publicBusiness(updatedBusiness));
    return { receipt: reviewed, business: updatedBusiness };
  });
}
