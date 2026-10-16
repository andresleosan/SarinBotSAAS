import 'server-only';
import type { Business } from '@/types/firestore';
import { canPurchasePaidTrial, PAID_TRIAL_APPOINTMENT_LIMIT } from '@/lib/paid-trial';
import { HttpError } from './http';

export function activateIntroductoryTrial(subscription: Business['subscription'], origin: { source: 'payment'; paymentId: string } | { source: 'invitation'; invitationId: string }, now: number): Business['subscription'] {
  if (!canPurchasePaidTrial(subscription)) throw new HttpError(409, 'La prueba solo se puede activar una vez.', 'PAID_TRIAL_UNAVAILABLE');
  return { status: 'trial', trialEndsAt: subscription.trialEndsAt, currentPeriodEndsAt: subscription.currentPeriodEndsAt,
    ...(origin.source === 'payment' ? { lastPaymentId: origin.paymentId } : subscription.lastPaymentId ? { lastPaymentId: subscription.lastPaymentId } : {}),
    paidTrial: { activatedAt: now, appointmentLimit: PAID_TRIAL_APPOINTMENT_LIMIT, appointmentsUsed: 0,
      ...(origin.source === 'payment' ? origin : { ...origin, accessSuspended: false }) },
  };
}
