export const SUBSCRIPTION_PLAN_IDS = ['weekly', 'fortnightly', 'monthly', 'whatsapp'] as const;
export type SubscriptionPlanId = typeof SUBSCRIPTION_PLAN_IDS[number];

export const BILLING_PLANS = [
  { id: 'weekly', label: 'Semanal', periodDays: 7, priceField: 'weeklyPriceCOP', defaultPriceCOP: 20000, includedResponses: 700 },
  { id: 'fortnightly', label: 'Quincenal', periodDays: 15, priceField: 'fortnightlyPriceCOP', defaultPriceCOP: 35000, includedResponses: 1500 },
  { id: 'monthly', label: 'Mensual', periodDays: 30, priceField: 'monthlyPriceCOP', defaultPriceCOP: 59900, includedResponses: 3000 },
  { id: 'whatsapp', label: 'WhatsApp', periodDays: 30, priceField: 'whatsappPriceCOP', defaultPriceCOP: 149900, includedResponses: 4500 },
] as const;
export const RESPONSE_PACK = { responses: 1000, defaultPriceCOP: 20000 } as const;

export function getBillingPlan(planId: SubscriptionPlanId = 'monthly') {
  const plan = BILLING_PLANS.find((candidate) => candidate.id === planId);
  if (!plan) throw new RangeError('Plan de suscripción no válido.');
  return plan;
}
