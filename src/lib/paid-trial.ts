import type { PublicBusiness } from '@/types/firestore';

export const PAID_TRIAL_PRICE_COP = 5000;
export const PAID_TRIAL_APPOINTMENT_LIMIT = 10;
export const PAID_TRIAL_INCLUDED_RESPONSES = 700;
export const PAID_TRIAL_PERIOD_END = 8640000000000000;
type Subscription = PublicBusiness['subscription'];

export function canPurchasePaidTrial(subscription?: Subscription | null): boolean {
  if (!subscription) return true;
  return subscription.status !== 'suspended' && subscription.paidTrial === undefined &&
    !(Number.isSafeInteger(subscription.currentPeriodEndsAt) && subscription.currentPeriodEndsAt > 0);
}

export function paidTrialRemaining(subscription?: Subscription | null): number {
  const trial = subscription?.paidTrial;
  if (!trial || !Number.isSafeInteger(trial.activatedAt) || trial.activatedAt < 0 ||
      trial.appointmentLimit !== PAID_TRIAL_APPOINTMENT_LIMIT ||
      !Number.isSafeInteger(trial.appointmentsUsed) || trial.appointmentsUsed < 0 ||
      trial.appointmentsUsed > trial.appointmentLimit) return 0;
  return trial.appointmentLimit - trial.appointmentsUsed;
}
