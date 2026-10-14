import type { Business } from '@/types/firestore';

type Subscription = Business['subscription'];

export function grantReceiptGrace(subscription: Subscription, paymentId: string, now: number): Subscription {
  if (subscription.status === 'suspended' || subscription.graceGrantedAt !== undefined) return { ...subscription, lastPaymentId: paymentId };
  const paid = subscription.status === 'active' && subscription.currentPeriodEndsAt > now;
  const trial = subscription.status === 'trial' && subscription.trialEndsAt > now;
  return { ...subscription, status: paid ? 'active' : trial ? 'trial' : 'past_due', graceGrantedAt: now, graceEndsAt: now + 86400000, lastPaymentId: paymentId };
}

export function approveSubscription(subscription: Subscription, paymentId: string, now: number): Subscription {
  return {
    status: 'active', trialEndsAt: subscription.trialEndsAt,
    currentPeriodEndsAt: Math.max(now, subscription.currentPeriodEndsAt) + 30 * 86400000,
    lastPaymentId: paymentId,
  };
}
