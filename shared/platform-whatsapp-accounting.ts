import { emptyUsage, isBudgetPeriod, workInteger, type BudgetPeriod, type Usage } from './platform-whatsapp-work.ts';

/** Pure proposed aggregate; callers preserve every original hold on failure. */
export function platformSettlementPeriod(period: BudgetPeriod, maximum: number, actual: number, usage: Usage): BudgetPeriod | null {
  if (!workInteger(actual) || !workInteger(maximum) || period.heldMicros < maximum) return null;
  const updated: BudgetPeriod = {
    ...period,
    heldMicros: period.heldMicros - maximum,
    usedMicros: period.usedMicros + actual,
    overrunMicros: period.overrunMicros + Math.max(0, actual - maximum),
  };
  for (const key of Object.keys(emptyUsage) as Array<keyof Usage>) {
    if (usage[key] !== null) updated[key] = (period[key] ?? 0) + usage[key]!;
  }
  // This includes combined used+held, dimensions and every safe-integer invariant.
  return isBudgetPeriod(updated) ? updated : null;
}
