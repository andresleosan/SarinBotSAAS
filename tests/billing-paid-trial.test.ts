import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DecodedIdToken } from 'firebase-admin/auth';
import type { Business } from '../src/types/firestore';
import { reviewPayment, submitReceipt } from '../src/lib/server/billing';
import { businessIdForOwner, createBusiness, publicBusiness } from '../src/lib/server/businesses';
import { businessConfigSchema } from '../src/lib/server/schemas';
import { readResponsePeriodState } from '../src/lib/server/response-periods';
import { PAID_TRIAL_PERIOD_END } from '../src/lib/paid-trial';
import { isSubscriptionAllowed } from '../src/lib/sarin/subscription';
import { memoryFirestore } from './memoryFirestore';

const now = 1_900_000_000_000;
const owner = { uid: 'first-owner', email: 'owner@example.test' } as DecodedIdToken;
const bank = { id: 'bank', bankName: 'Banco de prueba', accountType: 'Ahorros', accountNumber: 'TEST-ONLY', holderName: 'Pruebas' };
const upload = { kind: 'paid_trial' as const, bankSelected: 'bank', requestId: 'paid-trial-one', receiptDataUrl: `data:image/webp;base64,${Buffer.from('RIFFxxxxWEBPfixture').toString('base64')}` };
const config = businessConfigSchema.parse({ name: 'Negocio', slug: 'negocio-test', category: 'Servicios', phoneWhatsApp: '573001234567', resources: [{ id: 'one', name: 'Uno', active: true }], services: [{ id: 'cut', name: 'Corte', durationMinutes: 30, bufferMinutes: 0, price: 20000, resourceIds: ['one'] }], intakeFields: [], weeklySchedule: Object.fromEntries(Array.from({ length: 7 }, (_, day) => [String(day), { isOpen: true, intervals: [{ start: '09:00', end: '17:00' }] }])) });
const database = () => memoryFirestore({ 'platformSettings/main': { bankAccounts: [bank] } });
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(now); });
afterEach(() => vi.useRealTimers());

describe('paid introductory receipt lifecycle', () => {
  it('rejects unpaid configuration and invalid uploads without creating any draft', async () => {
    const { db, rows } = database();
    await expect(createBusiness(owner, config, db)).rejects.toMatchObject({ status: 402 });
    await expect(submitReceipt(owner, { ...upload, bankSelected: 'missing' }, db)).rejects.toMatchObject({ status: 409 });
    expect([...rows.keys()].filter(path => !path.startsWith('platformSettings/'))).toEqual([]);
  });
  it('creates only a private draft and fixed-price receipt before approval, idempotently', async () => {
    const { db, rows } = database();
    const [first, repeated] = await Promise.all([submitReceipt(owner, upload, db), submitReceipt(owner, upload, db)]);
    expect(first.receipt).toMatchObject({ kind: 'paid_trial', amountCOP: 5000, appointmentAllowance: 10 });
    expect(first.receipt).not.toHaveProperty('planId'); expect(first.receipt).not.toHaveProperty('periodDays');
    expect(repeated).toEqual(first);
    expect(first.business).toMatchObject({ id: businessIdForOwner(owner.uid), slug: '', subscription: { status: 'pending_payment', currentPeriodEndsAt: 0 }, sarinConfig: { onboardingCompleted: false } });
    expect(isSubscriptionAllowed(first.business, now)).toBe(false);
    expect(first.business.subscription.graceEndsAt).toBeUndefined();
    expect([...rows.keys()].filter(path => path.startsWith('businessSlugs/') || path.startsWith('publicBusinesses/'))).toEqual([]);
    await expect(submitReceipt(owner, { ...upload, requestId: 'second-request' }, db)).rejects.toMatchObject({ status: 409 });
  });
  it('approves once, configures the paid draft, excludes payment IDs publicly and cannot reset usage', async () => {
    const { db, rows } = database();
    const pending = await submitReceipt(owner, upload, db);
    const [first, replay] = await Promise.all([reviewPayment(pending.receipt.id, 'approve', undefined, db), reviewPayment(pending.receipt.id, 'approve', undefined, db)]);
    expect(replay).toEqual(first);
    expect(first.business.subscription).toMatchObject({ status: 'trial', paidTrial: { paymentId: first.receipt.id, activatedAt: now, appointmentLimit: 10, appointmentsUsed: 0 } });
    const quota = await readResponsePeriodState(first.business, db, undefined, now);
    expect(quota.current).toMatchObject({ source: 'trial', includedResponses: 700, endsAt: PAID_TRIAL_PERIOD_END });
    expect([...rows.keys()].filter(path => path.startsWith('publicBusinesses/'))).toEqual([]);
    const configured = await createBusiness(owner, config, db);
    expect(configured.subscription).toEqual(first.business.subscription);
    expect(configured.sarinConfig.onboardingCompleted).toBe(true);
    expect(publicBusiness(configured).subscription.paidTrial).not.toHaveProperty('paymentId');
    expect(rows.get(`publicBusinesses/${config.slug}`)?.data.subscription).not.toHaveProperty('lastPaymentId');
    await expect(submitReceipt(owner, { ...upload, requestId: 'purchase-again' }, db)).rejects.toMatchObject({ status: 409 });
    await expect(createBusiness(owner, { ...config, slug: 'another-slug' }, db)).rejects.toMatchObject({ status: 409 });
  });
  it('permits a first subscription receipt, immediately superseding old free-trial time', async () => {
    const { db } = database();
    const pending = await submitReceipt(owner, { ...upload, kind: 'subscription', planId: 'weekly' }, db);
    expect(pending.business.subscription.graceEndsAt).toBeUndefined();
    const approved = await reviewPayment(pending.receipt.id, 'approve', undefined, db);
    expect(approved.business.subscription.currentPeriodEndsAt).toBe(now + 7 * 86400000);
    expect(await createBusiness(owner, config, db)).toMatchObject({ slug: config.slug });
  });
  it('supersedes a paid trial immediately, preserving its purchase and usage after plan expiry', async () => {
    const { db } = database();
    const pending = await submitReceipt(owner, upload, db);
    const trial = await reviewPayment(pending.receipt.id, 'approve', undefined, db);
    const used = { ...trial.business, subscription: { ...trial.business.subscription, paidTrial: { ...trial.business.subscription.paidTrial!, appointmentsUsed: 8 } } };
    await db.collection('businesses').doc(used.id).set(used);
    const subscription = await submitReceipt(owner, { ...upload, requestId: 'plan-upgrade', kind: 'subscription', planId: 'weekly' }, db);
    expect(subscription.business.subscription.graceEndsAt).toBeUndefined();
    const approved = await reviewPayment(subscription.receipt.id, 'approve', undefined, db);
    expect(approved.business.subscription.paidTrial).toEqual(used.subscription.paidTrial);
    expect((await readResponsePeriodState(approved.business, db, undefined, now)).current).toMatchObject({ source: 'subscription', startsAt: now, endsAt: now + 7 * 86400000 });
    vi.setSystemTime(now + 8 * 86400000);
    expect(isSubscriptionAllowed(approved.business)).toBe(false);
    await expect(submitReceipt(owner, { ...upload, requestId: 'trial-again-after-plan' }, db)).rejects.toMatchObject({ status: 409 });
    const renewal = await submitReceipt(owner, { ...upload, kind: 'subscription', requestId: 'paid-plan-renewal', planId: 'weekly' }, db);
    expect(isSubscriptionAllowed(renewal.business)).toBe(true);
    const rejected = await reviewPayment(renewal.receipt.id, 'reject', 'No corresponde', db);
    expect(rejected.business.subscription.status).toBe('past_due');
    expect(isSubscriptionAllowed(rejected.business)).toBe(false);
  });
  it('cannot activate two pending introductory receipts or reset consumed units on approval replay', async () => {
    const { db, rows } = database();
    const pending = await submitReceipt(owner, upload, db);
    const other = { ...pending.receipt, id: 'duplicate-introductory-receipt' };
    await db.collection('paymentReceipts').doc(other.id).set(other);
    const results = await Promise.allSettled([reviewPayment(pending.receipt.id, 'approve', undefined, db), reviewPayment(other.id, 'approve', undefined, db)]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    const approved = results.find(result => result.status === 'fulfilled')!;
    if (approved.status !== 'fulfilled') throw new Error('Missing approved receipt');
    const used = { ...approved.value.business, subscription: { ...approved.value.business.subscription, paidTrial: { ...approved.value.business.subscription.paidTrial!, appointmentsUsed: 10 } } };
    await db.collection('businesses').doc(used.id).set(used);
    expect((await reviewPayment(approved.value.receipt.id, 'approve', undefined, db)).business.subscription.paidTrial?.appointmentsUsed).toBe(10);
    expect([...rows.keys()].filter(path => path.includes('/periods/'))).toHaveLength(1);
  });
  it('keeps a rejected introductory draft private and permits a corrected receipt without grace', async () => {
    const { db, rows } = database();
    const pending = await submitReceipt(owner, upload, db);
    await reviewPayment(pending.receipt.id, 'reject', 'No corresponde', db);
    const corrected = await submitReceipt(owner, { ...upload, requestId: 'corrected-receipt' }, db);
    expect(corrected.business.subscription).toMatchObject({ status: 'pending_payment' });
    expect(corrected.business.subscription.graceEndsAt).toBeUndefined();
    expect([...rows.keys()].some(path => path.startsWith('publicBusinesses/'))).toBe(false);
  });
  it.each([{ amountCOP: 5001 }, { appointmentAllowance: 11 }, { planId: 'weekly' }, { periodDays: 7 }])('refuses forged introductory metadata %j without changing entitlement', async (metadata) => {
    const { db, rows } = database();
    const pending = await submitReceipt(owner, upload, db);
    await db.collection('paymentReceipts').doc(pending.receipt.id).set({ ...pending.receipt, ...metadata });
    await expect(reviewPayment(pending.receipt.id, 'approve', undefined, db)).rejects.toMatchObject({ status: 409 });
    expect((rows.get(`businesses/${pending.business.id}`)?.data as unknown as Business).subscription.paidTrial).toBeUndefined();
  });
});
