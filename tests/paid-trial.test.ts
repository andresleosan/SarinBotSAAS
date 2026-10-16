import { describe, expect, it } from 'vitest';
import type { Business } from '../src/types/firestore';
import { canPurchasePaidTrial, paidTrialRemaining, PAID_TRIAL_PERIOD_END } from '../src/lib/paid-trial';
import { getBusinessAccess, isOwnerAiAllowed, isSubscriptionAllowed } from '../src/lib/sarin/subscription';
import { publicBusiness, privateBusinessDraft } from '../src/lib/server/businesses';
import { activateIntroductoryTrial } from '../src/lib/server/introductory-access';
import { createInvitationSchema, invitationCommandSchema, normalizeInvitationEmail } from '../src/lib/server/invitation-schemas';
import type { DecodedIdToken } from 'firebase-admin/auth';

const now = 1_900_000_000_000;
const pending: Business['subscription'] = { status: 'pending_payment', trialEndsAt: now + 7 * 86400000, currentPeriodEndsAt: 0 };
const paidTrial = { ...pending, status: 'trial' as const, paidTrial: { paymentId: 'receipt', activatedAt: now, appointmentLimit: 10 as const, appointmentsUsed: 0 } };

describe('paid introductory access', () => {
  it('preserves legacy paid trial and suspends courtesy without changing usage', () => {
    expect(getBusinessAccess({ subscription: paidTrial }, now)).toBe('paid_trial');
    const courtesy = activateIntroductoryTrial(pending, { source: 'invitation', invitationId: 'private-invitation-id' }, now);
    const suspended = { ...courtesy, paidTrial: { ...courtesy.paidTrial!, source: 'invitation' as const, invitationId: 'private-invitation-id', paymentId: undefined, appointmentsUsed: 2, accessSuspended: true } };
    expect(paidTrialRemaining(suspended)).toBe(8);
    expect(getBusinessAccess({ subscription: suspended }, now)).toBe('suspended');
    expect(canPurchasePaidTrial(suspended)).toBe(false);
    expect(() => activateIntroductoryTrial(suspended, { source: 'payment', paymentId: 'other' }, now)).toThrow();
  });
  it('paid plan wins over courtesy suspension and strips private invitation references', () => {
    const courtesy = activateIntroductoryTrial(pending, { source: 'invitation', invitationId: 'private-invitation-id' }, now);
    courtesy.paidTrial = { ...courtesy.paidTrial!, source: 'invitation', invitationId: 'private-invitation-id', paymentId: undefined, accessSuspended: true };
    expect(getBusinessAccess({ subscription: { ...courtesy, status: 'active', currentPeriodEndsAt: now + 86400000 } }, now)).toBe('subscription');
    const draft = privateBusinessDraft({ uid: 'owner', email: 'private@example.test' } as DecodedIdToken, now);
    const projected = publicBusiness({ ...draft, subscription: courtesy });
    expect(projected.subscription.paidTrial).toMatchObject({ source: 'invitation', accessSuspended: true, appointmentsUsed: 0 });
    expect(JSON.stringify(projected)).not.toMatch(/private-invitation-id|private@example.test|invitationId|paymentId/);
  });
  it('validates invitation inputs and normalizes only email whitespace and case', () => {
    expect(normalizeInvitationEmail(' A+B@Example.TEST ')).toBe('a+b@example.test');
    for (const expiresInDays of [1, 30]) expect(createInvitationSchema.parse({ recipientEmail: ' A+B@Example.TEST ', requestId: 'request-one', expiresInDays }).recipientEmail).toBe('a+b@example.test');
    for (const expiresInDays of [0, 31]) expect(createInvitationSchema.safeParse({ recipientEmail: 'a@example.test', requestId: 'request-one', expiresInDays }).success).toBe(false);
    expect(createInvitationSchema.safeParse({ recipientEmail: 'a@example.test', requestId: 'request-one', role: 'admin' }).success).toBe(false);
    expect(invitationCommandSchema.safeParse({ action: 'suspend_access', invitationId: 'a'.repeat(24), requestId: 'request-one', expectedVersion: 0, reason: ' ' }).success).toBe(false);
  });
  it('does not authorize historical free trials or upload grace without a paid history', () => {
    for (const subscription of [pending, { ...pending, status: 'trial' as const }, { ...pending, status: 'past_due' as const, graceEndsAt: now + 86400000 }]) {
      expect(isSubscriptionAllowed({ subscription }, now)).toBe(false);
      expect(isOwnerAiAllowed({ subscription }, now)).toBe(false);
    }
    expect(getBusinessAccess({ subscription: pending }, now)).toBe('pending_payment');
  });
  it('allows ten appointments without time expiry but excludes owner AI', () => {
    expect(PAID_TRIAL_PERIOD_END).toBe(8640000000000000);
    expect(getBusinessAccess({ subscription: paidTrial }, now + 1000 * 86400000)).toBe('paid_trial');
    expect(paidTrialRemaining(paidTrial)).toBe(10);
    expect(isOwnerAiAllowed({ subscription: paidTrial }, now)).toBe(false);
    expect(getBusinessAccess({ subscription: { ...paidTrial, paidTrial: { ...paidTrial.paidTrial, appointmentsUsed: 10 } } }, now)).toBe('trial_exhausted');
  });
  it('uses the same entitlement on public projections without a payment identifier', () => {
    const { paymentId: _privateId, ...publicTrial } = paidTrial.paidTrial;
    expect(isSubscriptionAllowed({ subscription: { ...paidTrial, paidTrial: publicTrial } }, now)).toBe(true);
  });
  it.each([-1, 0.5, Number.NaN, 11])('fails closed for invalid usage %s', (appointmentsUsed) => {
    const subscription = { ...paidTrial, paidTrial: { ...paidTrial.paidTrial, appointmentsUsed } };
    expect(paidTrialRemaining(subscription)).toBe(0);
    expect(isSubscriptionAllowed({ subscription }, now)).toBe(false);
    expect(canPurchasePaidTrial(subscription)).toBe(false);
  });
  it('permits the purchase once and preserves a paid subscription over trial exhaustion', () => {
    expect(canPurchasePaidTrial(pending)).toBe(true);
    expect(canPurchasePaidTrial(paidTrial)).toBe(false);
    const subscription = { ...paidTrial, status: 'active' as const, currentPeriodEndsAt: now + 86400000, paidTrial: { ...paidTrial.paidTrial, appointmentsUsed: 10 } };
    expect(getBusinessAccess({ subscription }, now)).toBe('subscription');
    expect(isOwnerAiAllowed({ subscription }, now)).toBe(true);
    expect(getBusinessAccess({ subscription: { ...subscription, status: 'suspended' } }, now)).toBe('suspended');
  });
});
