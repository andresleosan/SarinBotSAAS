import type { Business, PublicBusiness } from '@/types/firestore';

export function isSubscriptionAllowed(business: Pick<Business | PublicBusiness, 'subscription'>, now = Date.now()): boolean {
  const sub = business.subscription;
  if (sub.status === 'suspended') return false;
  if (sub.status === 'trial' && sub.trialEndsAt > now) return true;
  if (sub.status === 'active' && sub.currentPeriodEndsAt > now) return true;
  return (sub.graceEndsAt ?? 0) > now;
}
