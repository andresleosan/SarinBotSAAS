import { describe, expect, it } from 'vitest';
import { grantReceiptGrace, approveSubscription } from '../src/lib/server/billing-policy';
import type { Business } from '../src/types/firestore';

const now = Date.parse('2030-01-01T00:00:00Z');
const day = 86400000;
const expired: Business['subscription'] = { status: 'trial', trialEndsAt: now - day, currentPeriodEndsAt: now - day };

describe('subscription payment policy', () => {
  it('grants one 24h preventive window to an expired business', () => {
    expect(grantReceiptGrace(expired, 'r1', now)).toMatchObject({ status: 'past_due', graceEndsAt: now + day, graceGrantedAt: now, lastPaymentId: 'r1' });
  });
  it('cannot extend grace by uploading another receipt after expiration', () => {
    const first = grantReceiptGrace(expired, 'r1', now);
    expect(grantReceiptGrace(first, 'r2', now + 2 * day).graceEndsAt).toBe(now + day);
  });
  it('cannot unlock an explicitly suspended business', () => {
    expect(grantReceiptGrace({ ...expired, status: 'suspended' }, 'r1', now).status).toBe('suspended');
  });
  it('adds thirty days after the existing paid period', () => {
    expect(approveSubscription({ ...expired, status: 'active', currentPeriodEndsAt: now + 5 * day }, 'r1', now).currentPeriodEndsAt).toBe(now + 35 * day);
  });
  it.each([7, 15, 30])('extends an active subscription by the purchased %i days without losing remaining time', (periodDays) => {
    const result = approveSubscription({ ...expired, status: 'active', currentPeriodEndsAt: now + 5 * day }, 'plan-receipt', now, periodDays);
    expect(result.currentPeriodEndsAt).toBe(now + (5 + periodDays) * day);
    expect(result.trialEndsAt).toBe(expired.trialEndsAt);
  });
  it.each([0, -7, 7.5, 365, Number.NaN])('rejects an unsupported purchased duration %s', (periodDays) => {
    expect(() => approveSubscription(expired, 'plan-receipt', now, periodDays)).toThrow();
  });
  it('removes used grace only after an approved payment', () => {
    const result = approveSubscription(grantReceiptGrace(expired, 'r1', now), 'r1', now);
    expect(result).toMatchObject({ status: 'active', currentPeriodEndsAt: now + 30 * day });
    expect(result.graceGrantedAt).toBeUndefined();
    expect(result.graceEndsAt).toBeUndefined();
  });
});
