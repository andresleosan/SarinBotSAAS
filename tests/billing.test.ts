import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Business, PaymentReceipt } from '../src/types/firestore';
import { reviewPayment } from '../src/lib/server/billing';
import { memoryFirestore } from './memoryFirestore';

const now = Date.parse('2030-01-01T12:00:00Z');
const business: Business = { id: 'business', ownerUid: 'owner', ownerEmail: '', name: 'Real', category: 'Servicios', phoneWhatsApp: '573001234567', timezone: 'America/Bogota', slug: 'real', subscription: { status: 'past_due', trialEndsAt: 0, currentPeriodEndsAt: 0, graceGrantedAt: now - 86400000, graceEndsAt: now, lastPaymentId: 'receipt' }, sarinConfig: { onboardingCompleted: true, tone: '', customRules: '', intakeFields: [] }, resources: [], services: [], weeklySchedule: {}, createdAt: now };
const receipt: PaymentReceipt = { id: 'receipt', tenantId: 'business', tenantName: 'Real', ownerUid: 'owner', ownerEmail: '', amountCOP: 49900, bankSelected: 'Banco real', submittedAt: now, status: 'pending' };
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(now); });
const database = () => memoryFirestore({ 'businesses/business': business as unknown as Record<string, unknown>, 'paymentReceipts/receipt': receipt as unknown as Record<string, unknown> });
describe('payment review transaction', () => {
  it('cannot extend a subscription twice under simultaneous approvals', async () => {
    const { db, rows } = database();
    await Promise.all([reviewPayment('receipt', 'approve', undefined, db), reviewPayment('receipt', 'approve', undefined, db)]);
    const result = rows.get('businesses/business')!.data as unknown as Business;
    expect(result.subscription.currentPeriodEndsAt).toBe(now + 30 * 86400000);
    expect(result.subscription.status).toBe('active');
    expect(rows.get('paymentReceipts/receipt')!.data.status).toBe('approved');
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
});
