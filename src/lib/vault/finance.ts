import type { FinancialEntry, FinancialTotal } from '@/types/vault';

/** Integer cents keep 0.10 + 0.20 exact; currencies are intentionally never converted. */
export function calculateFinancialTotals(entries: readonly FinancialEntry[]): FinancialTotal[] {
  const currencies = new Map<string, { income: number; expense: number }>();
  for (const entry of entries) {
    const total = currencies.get(entry.currency) ?? { income: 0, expense: 0 };
    total[entry.kind] += Math.round(entry.amount * 100);
    currencies.set(entry.currency, total);
  }
  return [...currencies].sort(([a], [b]) => a.localeCompare(b)).map(([currency, total]) => ({
    currency, income: total.income / 100, expense: total.expense / 100, balance: (total.income - total.expense) / 100,
  }));
}
