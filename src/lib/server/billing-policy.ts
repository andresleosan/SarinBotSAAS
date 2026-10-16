import type { Business } from '@/types/firestore';
import { BILLING_PLANS } from '@/lib/billing-plans';

type Subscription = Business['subscription'];

export function grantReceiptGrace(subscription: Subscription, paymentId: string, now: number): Subscription {
  if (subscription.status === 'suspended' || subscription.graceGrantedAt !== undefined) return { ...subscription, lastPaymentId: paymentId };
  const paid = subscription.status === 'active' && subscription.currentPeriodEndsAt > now;
  const trial = subscription.status === 'trial' && subscription.trialEndsAt > now;
  return { ...subscription, status: paid ? 'active' : trial ? 'trial' : 'past_due', graceGrantedAt: now, graceEndsAt: now + 86400000, lastPaymentId: paymentId };
}

export function approveSubscription(subscription: Subscription, paymentId: string, now: number, periodDays = 30): Subscription {
  if (!BILLING_PLANS.some((plan) => plan.periodDays === periodDays)) throw new RangeError('Duración de suscripción no válida.');
  return {
    status: 'active', trialEndsAt: subscription.trialEndsAt,
    currentPeriodEndsAt: Math.max(now, subscription.currentPeriodEndsAt) + periodDays * 86400000,
    lastPaymentId: paymentId,
  };
}
