import { z } from 'zod';
import type { PlatformSettings, SubscriptionPlanId } from '@/types/firestore';
import { BILLING_PLANS, getBillingPlan, RESPONSE_PACK } from '@/lib/billing-plans';
import { PAID_TRIAL_APPOINTMENT_LIMIT, PAID_TRIAL_INCLUDED_RESPONSES, PAID_TRIAL_PRICE_COP } from '@/lib/paid-trial';

const priceSchema = z.number().int().min(1).max(100000000);
const planSchema = z.object({
  id: z.enum(['weekly', 'fortnightly', 'monthly']), label: z.string(),
  periodDays: z.number().int(), includedResponses: z.number().int(), priceCOP: priceSchema,
}).strict().superRefine((value, context) => {
  const plan = getBillingPlan(value.id);
  if (value.label !== plan.label || value.periodDays !== plan.periodDays || value.includedResponses !== plan.includedResponses)
    context.addIssue({ code: 'custom', message: 'La oferta comercial no es válida.' });
});

export const publicCommercialOfferSchema = z.object({
  currency: z.literal('COP'),
  trial: z.object({ priceCOP: z.literal(PAID_TRIAL_PRICE_COP), appointmentLimit: z.literal(PAID_TRIAL_APPOINTMENT_LIMIT),
    includedResponses: z.literal(PAID_TRIAL_INCLUDED_RESPONSES), expiresByDays: z.literal(false) }).strict(),
  plans: z.array(planSchema).length(3).refine(plans => new Set(plans.map(plan => plan.id)).size === 3),
  responsePack: z.object({ responses: z.literal(RESPONSE_PACK.responses), priceCOP: priceSchema }).strict(),
}).strict();
export type PublicCommercialOffer = z.infer<typeof publicCommercialOfferSchema>;

export function commercialPriceCOP(settings: PlatformSettings, kind: 'subscription' | 'response_pack' | 'paid_trial', planId?: SubscriptionPlanId): number {
  const value = kind === 'paid_trial' ? PAID_TRIAL_PRICE_COP
    : kind === 'response_pack' ? settings.responsePackPriceCOP : settings[getBillingPlan(planId).priceField];
  const result = priceSchema.safeParse(value);
  if (!result.success) throw new RangeError('La configuración de tarifas no es válida.');
  return result.data;
}

export function buildPublicCommercialOffer(settings: PlatformSettings): PublicCommercialOffer {
  return publicCommercialOfferSchema.parse({
    currency: 'COP',
    trial: { priceCOP: PAID_TRIAL_PRICE_COP, appointmentLimit: PAID_TRIAL_APPOINTMENT_LIMIT,
      includedResponses: PAID_TRIAL_INCLUDED_RESPONSES, expiresByDays: false },
    plans: BILLING_PLANS.filter(plan => plan.id !== 'whatsapp').map(plan => ({
      id: plan.id, label: plan.label, periodDays: plan.periodDays, includedResponses: plan.includedResponses,
      priceCOP: commercialPriceCOP(settings, 'subscription', plan.id),
    })),
    responsePack: { responses: RESPONSE_PACK.responses, priceCOP: commercialPriceCOP(settings, 'response_pack') },
  });
}
