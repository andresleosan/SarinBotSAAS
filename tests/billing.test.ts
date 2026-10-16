import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DecodedIdToken } from 'firebase-admin/auth';
import type { Business, PaymentReceipt } from '../src/types/firestore';
import { getSettings, reviewPayment, saveSettings, submitReceipt } from '../src/lib/server/billing';
import { businessIdForOwner } from '../src/lib/server/businesses';
import { settingsSchema } from '../src/lib/server/schemas';
import { memoryFirestore } from './memoryFirestore';
import { getResponseQuota } from '@/lib/server/response-quota';
const whatsapp = vi.hoisted(() => ({ ready: false }));
vi.mock('@/lib/server/whatsapp-config', () => ({ getWhatsAppBusinessStatus: async () => ({ ready: whatsapp.ready }) }));

const now = Date.parse('2030-01-01T12:00:00Z');
const business: Business = { id: 'business', ownerUid: 'owner', ownerEmail: '', name: 'Real', category: 'Servicios', phoneWhatsApp: '573001234567', timezone: 'America/Bogota', slug: 'real', subscription: { status: 'past_due', trialEndsAt: 0, currentPeriodEndsAt: 0, graceGrantedAt: now - 86400000, graceEndsAt: now, lastPaymentId: 'receipt' }, sarinConfig: { onboardingCompleted: true, tone: '', customRules: '', intakeFields: [] }, resources: [], services: [], weeklySchedule: {}, createdAt: now };
const receipt: PaymentReceipt = { id: 'receipt', tenantId: 'business', tenantName: 'Real', ownerUid: 'owner', ownerEmail: '', amountCOP: 49900, bankSelected: 'Banco real', submittedAt: now, status: 'pending' };
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(now); whatsapp.ready = false; for (const key of ['WEEKLY_PRICE_COP', 'FORTNIGHTLY_PRICE_COP', 'MONTHLY_PRICE_COP']) vi.stubEnv(key, ''); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });
const database = () => memoryFirestore({ 'businesses/business': business as unknown as Record<string, unknown>, 'paymentReceipts/receipt': receipt as unknown as Record<string, unknown> });
const owner = { uid: 'owner', email: 'owner@example.test' } as DecodedIdToken;
const upload = { bankSelected: 'bank', requestId: 'request-plan', receiptDataUrl: `data:image/webp;base64,${Buffer.from('RIFFxxxxWEBPfixture').toString('base64')}` };
const bank = { id: 'bank', bankName: 'Banco de prueba', accountType: 'Ahorros', accountNumber: 'TEST-ONLY', holderName: 'Pruebas' };
function submissionDatabase() {
  const owned = { ...business, id: businessIdForOwner(owner.uid), subscription: { status: 'trial', trialEndsAt: now + 7 * 86400000, currentPeriodEndsAt: 0 } };
  return memoryFirestore({ [`businesses/${owned.id}`]: owned, 'platformSettings/main': { bankAccounts: [bank] } });
}

describe('billing plan settings and receipt snapshots', () => {
  it('rejects a stale subscription quote before creating any draft or upload and accepts legacy clients at the current price', async () => {
    const { db, rows } = memoryFirestore({ 'platformSettings/main': { bankAccounts: [bank], monthlyPriceCOP: 65000 } });
    const before = structuredClone([...rows]);
    await expect(submitReceipt(owner, { ...upload, quotedPriceCOP: 59900 }, db)).rejects.toMatchObject({ status: 409, code: 'OFFER_PRICE_CHANGED' });
    expect([...rows]).toEqual(before);
    expect((await submitReceipt(owner, upload, db)).receipt.amountCOP).toBe(65000);
  });
  it('returns an accepted quoted receipt unchanged after the administrator changes prices', async () => {
    const { db } = submissionDatabase();
    const first = await submitReceipt(owner, { ...upload, quotedPriceCOP: 59900 }, db);
    await db.collection('platformSettings').doc('main').set({ bankAccounts: [bank], monthlyPriceCOP: 65000 });
    expect((await submitReceipt(owner, { ...upload, quotedPriceCOP: 59900 }, db)).receipt).toEqual(first.receipt);
  });
  it('rejects a stale pack quote without writes and keeps the introductory price fixed', async () => {
    const { db, rows } = submissionDatabase();
    const id = businessIdForOwner(owner.uid);
    await db.collection('businesses').doc(id).set({ ...business, id, subscription: { status: 'active', trialEndsAt: 0, currentPeriodEndsAt: now + 86400000 } });
    await db.collection('platformSettings').doc('main').set({ bankAccounts: [bank], responsePackPriceCOP: 23000 });
    const before = structuredClone([...rows]);
    await expect(submitReceipt(owner, { ...upload, kind: 'response_pack', quotedPriceCOP: 20000 }, db)).rejects.toMatchObject({ code: 'OFFER_PRICE_CHANGED' });
    expect([...rows]).toEqual(before);
    expect((await submitReceipt(owner, { ...upload, kind: 'response_pack', quotedPriceCOP: 23000 }, db)).receipt.amountCOP).toBe(23000);
    expect((await submitReceipt(owner, { ...upload, kind: 'paid_trial' }, memoryFirestore({ 'platformSettings/main': { bankAccounts: [bank] } }).db)).receipt.amountCOP).toBe(5000);
  });
  it('returns all default tariffs without creating settings and preserves a legacy monthly tariff', async () => {
    const memory = memoryFirestore();
    expect(await getSettings(memory.db)).toMatchObject({ weeklyPriceCOP: 20000, fortnightlyPriceCOP: 35000, monthlyPriceCOP: 59900, graceHoursOnUpload: 24 });
    expect(await getSettings(memory.db)).not.toHaveProperty('trialDaysDefault');
    expect(memory.rows.size).toBe(0);
    await memory.db.collection('platformSettings').doc('main').set({ monthlyPriceCOP: 49900 });
    expect(await getSettings(memory.db)).toMatchObject({ weeklyPriceCOP: 20000, fortnightlyPriceCOP: 35000, monthlyPriceCOP: 49900 });
  });
  it('omits historical free-trial settings on reads and removes them only on an explicit settings save', async () => {
    const { db, rows } = memoryFirestore({ 'platformSettings/main': { trialDaysDefault: 7, monthlyPriceCOP: 59900 } });
    expect(await getSettings(db)).not.toHaveProperty('trialDaysDefault');
    expect(rows.get('platformSettings/main')?.data.trialDaysDefault).toBe(7);
    const settings = settingsSchema.parse({ companyName: 'Pruebas', monthlyPriceCOP: 59900, bankAccounts: [bank] });
    expect(await saveSettings(settings, db)).not.toHaveProperty('trialDaysDefault');
    expect(rows.get('platformSettings/main')?.data).not.toHaveProperty('trialDaysDefault');
  });
  it('uses validated environment overrides consistently for all tariffs', async () => {
    const { db } = memoryFirestore();
    vi.stubEnv('WEEKLY_PRICE_COP', '21000'); vi.stubEnv('FORTNIGHTLY_PRICE_COP', '36000'); vi.stubEnv('MONTHLY_PRICE_COP', '61000');
    expect(await getSettings(db)).toMatchObject({ weeklyPriceCOP: 21000, fortnightlyPriceCOP: 36000, monthlyPriceCOP: 61000 });
    vi.stubEnv('WEEKLY_PRICE_COP', '1.5'); vi.stubEnv('FORTNIGHTLY_PRICE_COP', '-1'); vi.stubEnv('MONTHLY_PRICE_COP', '100000001');
    expect(await getSettings(db)).toMatchObject({ weeklyPriceCOP: 20000, fortnightlyPriceCOP: 35000, monthlyPriceCOP: 59900 });
  });
  it('preserves existing weekly and fortnightly prices when an older admin saves monthly settings', async () => {
    const { db } = memoryFirestore({ 'platformSettings/main': { weeklyPriceCOP: 21000, fortnightlyPriceCOP: 36000, monthlyPriceCOP: 59900 } });
    const legacy = settingsSchema.parse({ companyName: 'Pruebas', monthlyPriceCOP: 61000, bankAccounts: [bank] });
    expect(await saveSettings(legacy, db)).toMatchObject({ weeklyPriceCOP: 21000, fortnightlyPriceCOP: 36000, monthlyPriceCOP: 61000 });
    expect(await saveSettings(legacy, memoryFirestore().db)).toMatchObject({ weeklyPriceCOP: 20000, fortnightlyPriceCOP: 35000, monthlyPriceCOP: 61000 });
  });
  it.each([
    { planId: 'weekly' as const, periodDays: 7, amountCOP: 20000 },
    { planId: 'fortnightly' as const, periodDays: 15, amountCOP: 35000 },
    { planId: 'monthly' as const, periodDays: 30, amountCOP: 59900 },
  ])('snapshots $planId pricing and duration and applies it once after prices change', async ({ planId, periodDays, amountCOP }) => {
    const { db, rows } = submissionDatabase();
    const [first, retry] = await Promise.all([submitReceipt(owner, { ...upload, planId }, db), submitReceipt(owner, { ...upload, planId }, db)]);
    expect(first.receipt).toMatchObject({ planId, periodDays, amountCOP, status: 'pending' });
    expect(retry.receipt).toEqual(first.receipt);
    expect(first.business.subscription).toMatchObject({ trialEndsAt: now + 7 * 86400000 });
    expect(first.business.subscription.graceEndsAt).toBeUndefined();
    expect([...rows.keys()].filter(path => path.startsWith('paymentReceipts/'))).toHaveLength(1);
    await db.collection('platformSettings').doc('main').set({ bankAccounts: [bank], weeklyPriceCOP: 25000, fortnightlyPriceCOP: 45000, monthlyPriceCOP: 70000 });
    const changedRetry = await submitReceipt(owner, { ...upload, planId: planId === 'weekly' ? 'monthly' : 'weekly' }, db);
    expect(changedRetry.receipt).toEqual(first.receipt);
    const [approved, repeated] = await Promise.all([reviewPayment(first.receipt.id, 'approve', undefined, db), reviewPayment(first.receipt.id, 'approve', undefined, db)]);
    expect(approved.receipt).toMatchObject({ planId, periodDays, amountCOP, status: 'approved' });
    expect(approved.business.subscription.currentPeriodEndsAt).toBe(now + periodDays * 86400000);
    expect(repeated.business.subscription.currentPeriodEndsAt).toBe(approved.business.subscription.currentPeriodEndsAt);
    expect(approved.business.subscription.trialEndsAt).toBe(now + 7 * 86400000);
  });
  it('treats an older upload without a plan as a new monthly receipt', async () => {
    const { db } = submissionDatabase();
    expect((await submitReceipt(owner, upload, db)).receipt).toMatchObject({ planId: 'monthly', periodDays: 30, amountCOP: 59900 });
  });
});
describe('commercial response periods and packs', () => {
  it('starts paid periods immediately and queues later renewals without resetting current quota', async () => {
    const { db } = submissionDatabase();
    const first = await submitReceipt(owner, { ...upload, planId: 'weekly' }, db);
    await reviewPayment(first.receipt.id, 'approve', undefined, db);
    let allowance = await getResponseQuota(first.business.id, db);
    expect(allowance.currentPeriod).toMatchObject({ source: 'subscription', planId: 'weekly', includedResponses: 700, startsAt: now, endsAt: now + 7 * 86400000 });
    expect(allowance.nextPeriod).toBeNull();
    const second = await submitReceipt(owner, { ...upload, requestId: 'second-period', planId: 'fortnightly' }, db);
    await reviewPayment(second.receipt.id, 'approve', undefined, db);
    allowance = await getResponseQuota(first.business.id, db);
    expect(allowance.currentPeriod?.planId).toBe('weekly');
    expect(allowance.nextPeriod).toMatchObject({ planId: 'fortnightly', startsAt: now + 7 * 86400000, endsAt: now + 22 * 86400000 });
    vi.setSystemTime(now + 7 * 86400000);
    allowance = await getResponseQuota(first.business.id, db);
    expect(allowance.currentPeriod).toMatchObject({ planId: 'fortnightly', includedResponses: 1500, startsAt: now + 7 * 86400000, endsAt: now + 22 * 86400000, usedResponses: 0 });
  });
  it('snapshots a pack into the paid period and grants it once without extending time or grace', async () => {
    const { db } = submissionDatabase();
    const id = businessIdForOwner(owner.uid);
    const paid = { ...business, id, subscription: { status: 'active', trialEndsAt: now - 86400000, currentPeriodEndsAt: now + 30 * 86400000 } };
    await db.collection('businesses').doc(id).set(paid);
    const first = await submitReceipt(owner, { ...upload, kind: 'response_pack' }, db);
    expect(first.receipt).toMatchObject({ kind: 'response_pack', amountCOP: 20000, responseAllowance: 1000, quotaPeriodId: 'initial' });
    expect(first.receipt.planId).toBeUndefined(); expect(first.receipt.periodDays).toBeUndefined();
    expect(first.business.subscription.graceEndsAt).toBeUndefined();
    expect((await getResponseQuota(id, db)).currentPeriod?.extraResponses).toBe(0);
    await db.collection('platformSettings').doc('main').set({ bankAccounts: [bank], responsePackPriceCOP: 30000 });
    await Promise.all([reviewPayment(first.receipt.id, 'approve', undefined, db), reviewPayment(first.receipt.id, 'approve', undefined, db)]);
    const result = await getResponseQuota(id, db);
    expect(result.currentPeriod).toMatchObject({ extraResponses: 1000, includedResponses: 3000, endsAt: now + 30 * 86400000 });
    expect((await db.collection('paymentReceipts').doc(first.receipt.id).get()).data()?.amountCOP).toBe(20000);
  });
  it('refuses packs for trials and refuses approval after the purchased period expires', async () => {
    const { db } = submissionDatabase();
    await expect(submitReceipt(owner, { ...upload, kind: 'response_pack' }, db)).rejects.toMatchObject({ status: 409 });
    const id = businessIdForOwner(owner.uid);
    await db.collection('businesses').doc(id).set({ ...business, id, subscription: { status: 'active', trialEndsAt: now - 86400000, currentPeriodEndsAt: now + 86400000 } });
    const first = await submitReceipt(owner, { ...upload, kind: 'response_pack' }, db);
    vi.setSystemTime(now + 86400000);
    await expect(reviewPayment(first.receipt.id, 'approve', undefined, db)).rejects.toMatchObject({ status: 409 });
    expect((await db.collection('paymentReceipts').doc(first.receipt.id).get()).data()?.status).toBe('pending');
    expect((await getResponseQuota(id, db)).currentPeriod?.extraResponses).toBe(0);
  });
  it('does not sell or approve WhatsApp until the server confirms a verified connection', async () => {
    const { db } = submissionDatabase();
    await expect(submitReceipt(owner, { ...upload, planId: 'whatsapp' }, db)).rejects.toMatchObject({ status: 409 });
    whatsapp.ready = true;
    const first = await submitReceipt(owner, { ...upload, planId: 'whatsapp' }, db);
    expect(first.receipt).toMatchObject({ planId: 'whatsapp', amountCOP: 149900, periodDays: 30, responseAllowance: 4500 });
    whatsapp.ready = false;
    await expect(reviewPayment(first.receipt.id, 'approve', undefined, db)).rejects.toMatchObject({ status: 409 });
    expect((await db.collection('paymentReceipts').doc(first.receipt.id).get()).data()?.status).toBe('pending');
  });
});
describe('payment review transaction', () => {
  it('cannot extend a subscription twice under simultaneous approvals', async () => {
    const { db, rows } = database();
    await Promise.all([reviewPayment('receipt', 'approve', undefined, db), reviewPayment('receipt', 'approve', undefined, db)]);
    const result = rows.get('businesses/business')!.data as unknown as Business;
    expect(result.subscription.currentPeriodEndsAt).toBe(now + 30 * 86400000);
    expect(result.subscription.status).toBe('active');
    expect(rows.get('paymentReceipts/receipt')!.data.status).toBe('approved');
    expect(rows.get('paymentReceipts/receipt')!.data.amountCOP).toBe(49900);
    expect(rows.get('paymentReceipts/receipt')!.data).not.toHaveProperty('planId');
    expect(rows.get('publicBusinesses/real')!.data).not.toHaveProperty('ownerUid');
  });
  it('revokes preventive grace after rejection and keeps its consumption marker', async () => {
    const { db, rows } = database();
    await reviewPayment('receipt', 'reject', 'No se reconoce el pago.', db);
    const result = rows.get('businesses/business')!.data as unknown as Business;
    expect(result.subscription.graceEndsAt).toBeUndefined();
    expect(result.subscription.graceGrantedAt).toBeDefined();
    expect(rows.get('paymentReceipts/receipt')!.data.status).toBe('rejected');
  });
  it('rejects a contradictory second decision', async () => {
    const { db } = database();
    await reviewPayment('receipt', 'approve', undefined, db);
    await expect(reviewPayment('receipt', 'reject', undefined, db)).rejects.toMatchObject({ status: 409 });
  });
  it.each([
    { planId: 'weekly' }, { periodDays: 7 }, { planId: 'yearly', periodDays: 365 },
    { planId: 'weekly', periodDays: 30 }, { planId: 'monthly', periodDays: 0 },
    { planId: 'fortnightly', periodDays: 15.5 },
  ])('refuses inconsistent stored plan metadata without modifying receipts or entitlement: %j', async (metadata) => {
    const { db, rows } = memoryFirestore({ 'businesses/business': business as unknown as Record<string, unknown>, 'paymentReceipts/receipt': { ...receipt, ...metadata } });
    await expect(reviewPayment('receipt', 'approve', undefined, db)).rejects.toMatchObject({ status: 409 });
    expect(rows.get('paymentReceipts/receipt')!.data.status).toBe('pending');
    expect(rows.get('businesses/business')!.data.subscription).toEqual(business.subscription);
  });
});
