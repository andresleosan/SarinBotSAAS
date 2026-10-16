import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DecodedIdToken } from 'firebase-admin/auth';
import type { Business, PaymentReceipt } from '../src/types/firestore';
import { getSettings, reviewPayment, saveSettings, submitReceipt } from '../src/lib/server/billing';
import { businessIdForOwner } from '../src/lib/server/businesses';
import { settingsSchema } from '../src/lib/server/schemas';
import { memoryFirestore } from './memoryFirestore';

const now = Date.parse('2030-01-01T12:00:00Z');
const business: Business = { id: 'business', ownerUid: 'owner', ownerEmail: '', name: 'Real', category: 'Servicios', phoneWhatsApp: '573001234567', timezone: 'America/Bogota', slug: 'real', subscription: { status: 'past_due', trialEndsAt: 0, currentPeriodEndsAt: 0, graceGrantedAt: now - 86400000, graceEndsAt: now, lastPaymentId: 'receipt' }, sarinConfig: { onboardingCompleted: true, tone: '', customRules: '', intakeFields: [] }, resources: [], services: [], weeklySchedule: {}, createdAt: now };
const receipt: PaymentReceipt = { id: 'receipt', tenantId: 'business', tenantName: 'Real', ownerUid: 'owner', ownerEmail: '', amountCOP: 49900, bankSelected: 'Banco real', submittedAt: now, status: 'pending' };
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(now); for (const key of ['WEEKLY_PRICE_COP', 'FORTNIGHTLY_PRICE_COP', 'MONTHLY_PRICE_COP']) vi.stubEnv(key, ''); });
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
  it('returns all default tariffs without creating settings and preserves a legacy monthly tariff', async () => {
    const memory = memoryFirestore();
    expect(await getSettings(memory.db)).toMatchObject({ weeklyPriceCOP: 20000, fortnightlyPriceCOP: 35000, monthlyPriceCOP: 59900, trialDaysDefault: 7, graceHoursOnUpload: 24 });
    expect(memory.rows.size).toBe(0);
    await memory.db.collection('platformSettings').doc('main').set({ monthlyPriceCOP: 49900 });
    expect(await getSettings(memory.db)).toMatchObject({ weeklyPriceCOP: 20000, fortnightlyPriceCOP: 35000, monthlyPriceCOP: 49900 });
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
    expect(first.business.subscription).toMatchObject({ trialEndsAt: now + 7 * 86400000, graceEndsAt: now + 86400000 });
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
