export const SUBSCRIPTION_PLAN_IDS = ['weekly', 'fortnightly', 'monthly'] as const;
export type SubscriptionPlanId = typeof SUBSCRIPTION_PLAN_IDS[number];

export const BILLING_PLANS = [
  { id: 'weekly', label: 'Semanal', periodDays: 7, priceField: 'weeklyPriceCOP', defaultPriceCOP: 20000 },
  { id: 'fortnightly', label: 'Quincenal', periodDays: 15, priceField: 'fortnightlyPriceCOP', defaultPriceCOP: 35000 },
  { id: 'monthly', label: 'Mensual', periodDays: 30, priceField: 'monthlyPriceCOP', defaultPriceCOP: 59900 },
] as const;

export function getBillingPlan(planId: SubscriptionPlanId = 'monthly') {
  const plan = BILLING_PLANS.find((candidate) => candidate.id === planId);
  if (!plan) throw new RangeError('Plan de suscripción no válido.');
  return plan;
}
