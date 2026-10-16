export const AI_PROVIDERS = ['ollama', 'deepseek'] as const;
export type AiProvider = typeof AI_PROVIDERS[number];

export interface AiProviderSelection {
  provider: AiProvider;
  source: 'environment' | 'admin';
  updatedAt: number | null;
}

export interface AiProviderStatus {
  provider: AiProvider;
  configured: boolean;
  model: string | null;
  online: boolean;
  checkedAt: number;
  error?: string;
}

export interface AdminAiSettings extends AiProviderSelection {
  providers: AiProviderStatus[];
}

export interface AiUsageTotals {
  calls: number;
  successfulCalls: number;
  failedCalls: number;
  usageReportedCalls: number;
  missingUsageCalls: number;
  costEstimatedCalls: number;
  unknownCostCalls: number;
  promptTokens: number;
  cacheHitTokens: number;
  cacheMissTokens: number;
  completionTokens: number;
  estimatedCostUSD: { min: number; max: number } | null;
}

export interface AiBusinessUsage extends AiUsageTotals {
  businessId: string | null;
}

export interface AdminAiUsage {
  month: string;
  timeZone: 'America/Bogota';
  provider: 'deepseek';
  /** Model covered by the published tariff, not a claim about unknown models. */
  model: 'deepseek-flash';
  pricingVersion: 'deepseek-flash-verified-2026-10-15';
  measurementStartedAt: number | null;
  coverage: 'best_effort';
  telemetryProcessStartedAt: number;
  telemetryWriteFailures: number;
  totals: AiUsageTotals;
  businesses: AiBusinessUsage[];
  truncated: boolean;
}
