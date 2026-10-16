import 'server-only';
import type { CloudAiProvider } from '@/types/ai';
import type { EngineTokenUsage } from '@/lib/sarin/engine';
import { HttpError } from './http';
// Official tables rechecked 2026-10-16. Units: integer nanodollars/token.
// https://api-docs.deepseek.com/quick_start/pricing/ (peak, no cache discount)
// https://ai.google.dev/gemini-api/docs/pricing (explicit Standard request)
export const AI_TARIFFS = {
  deepseek: { model: 'deepseek-flash', pricingVersion: 'deepseek-flash-verified-2026-10-15', input: 300, output: 1200, cache: 6 },
  gemini: { model: 'gemini-3.5-flash-lite', pricingVersion: 'gemini-3.5-flash-lite-standard-verified-2026-10-16', input: 300, output: 2500, cache: 30 },
} as const;
export function quotePaidCall(input: { provider: CloudAiProvider; model: string; requestBytes: number; maxOutputTokens: number }) {
  const tariff = AI_TARIFFS[input.provider];
  if (!tariff || input.model !== tariff.model || !Number.isInteger(input.requestBytes) || input.requestBytes < 1 || input.requestBytes > 128000 || !Number.isInteger(input.maxOutputTokens) || input.maxOutputTokens < 1 || input.maxOutputTokens > 4096) throw new HttpError(503, 'La llamada de IA excede la política de presupuesto.', 'AI_BUDGET_UNAVAILABLE');
  const maxInputTokens = input.requestBytes + 4096;
  return { maxTokens: maxInputTokens + input.maxOutputTokens, maxCostNanoUsd: maxInputTokens * tariff.input + input.maxOutputTokens * tariff.output, pricingVersion: tariff.pricingVersion };
}
export function paidUsageCost(provider: CloudAiProvider, usage: EngineTokenUsage): number {
  const tariff = AI_TARIFFS[provider];
  // Reserve and settle against uncached peak pricing, not an optimistic credit.
  return usage.promptTokens * tariff.input + usage.completionTokens * tariff.output;
}
