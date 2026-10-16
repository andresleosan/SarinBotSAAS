import type { Business, PublicBusiness } from '@/types/firestore';
import { paidTrialRemaining } from '@/lib/paid-trial';

type SubscriptionBusiness = Pick<Business | PublicBusiness, 'subscription'>;
export type BusinessAccess = 'pending_payment' | 'paid_trial' | 'trial_exhausted' | 'subscription' | 'expired' | 'suspended';

export function getBusinessAccess(business?: SubscriptionBusiness | null, now = Date.now()): BusinessAccess {
  if (!business) return 'pending_payment';
  const sub = business.subscription;
  if (sub.status === 'suspended') return 'suspended';
  const paidHistory = Number.isSafeInteger(sub.currentPeriodEndsAt) && sub.currentPeriodEndsAt > 0;
  if (paidHistory && ((sub.status === 'active' && sub.currentPeriodEndsAt > now) ||
      ((sub.status === 'active' || sub.status === 'past_due') && (sub.graceEndsAt ?? 0) > now))) return 'subscription';
  if (sub.status === 'trial' && sub.paidTrial) return paidTrialRemaining(sub) > 0 ? 'paid_trial' : 'trial_exhausted';
  return sub.status === 'pending_payment' ? 'pending_payment' : 'expired';
}

export function isOwnerAiAllowed(business?: SubscriptionBusiness | null, now = Date.now()): boolean {
  return getBusinessAccess(business, now) === 'subscription';
}

export function isSubscriptionAllowed(business?: SubscriptionBusiness | null, now = Date.now()): boolean {
  const access = getBusinessAccess(business, now);
  return access === 'paid_trial' || access === 'subscription';
}
