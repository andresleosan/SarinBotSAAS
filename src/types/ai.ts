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
