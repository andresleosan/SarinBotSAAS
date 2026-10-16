export const AI_PROVIDERS = ['ollama', 'deepseek', 'openai'] as const;
export type AiProvider = typeof AI_PROVIDERS[number];
export type CloudAiProvider = Exclude<AiProvider, 'ollama'>;

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
  /** Present on new responses; older DeepSeek aggregates have no write detail. */
  cacheWriteTokens?: number;
  cacheWriteReportedCalls?: number;
  completionTokens: number;
  estimatedCostUSD: { min: number; max: number } | null;
}

export interface AiBusinessUsage extends AiUsageTotals {
  businessId: string | null;
}

export interface AdminAiUsage {
  month: string;
  timeZone: 'America/Bogota';
  provider: CloudAiProvider;
  /** Model covered by the published tariff, not a claim about unknown models. */
  model: 'deepseek-flash' | 'gpt-6-luna';
  pricingVersion: 'deepseek-flash-verified-2026-10-15' | 'gpt-6-luna-standard-verified-2026-10-16';
  measurementStartedAt: number | null;
  coverage: 'best_effort';
  telemetryProcessStartedAt: number;
  telemetryWriteFailures: number;
  totals: AiUsageTotals;
  businesses: AiBusinessUsage[];
  truncated: boolean;
}
