import type { AiProvider } from '@/types/ai';
import type { BusinessAccess } from '@/lib/sarin/subscription';
import type { ResponseAllowance, SubscriptionStatus } from '@/types/firestore';

export interface AdminCopilotBusiness {
  id: string;
  name: string;
  status: SubscriptionStatus;
  access: BusinessAccess;
  periodEndsAt: number | null;
  quotaState: ResponseAllowance['state'] | 'unavailable';
  remainingResponses: number | null;
  usedResponses: number | null;
}

export interface AdminCopilotSource {
  id: string;
  kind: 'business' | 'payment';
  businessId: string;
  label: string;
  detail: string;
  href: string;
}

export interface AdminCopilotAttention {
  sourceId: string;
  kind: 'payment' | 'quota_warning' | 'quota_exhausted' | 'subscription_expiring' | 'quota_unavailable';
  severity: 'warning' | 'urgent';
  title: string;
  detail: string;
}

export interface AdminCopilotCoverage {
  limit: 100;
  businessesLoaded: number;
  businessesTruncated: boolean;
  paymentsLoaded: number;
  paymentsTruncated: boolean;
  allowancesUnavailable: number;
}

export interface AdminCopilotSnapshot {
  generatedAt: number;
  timeZone: 'America/Bogota';
  scopeBusinessId: string | null;
  coverage: AdminCopilotCoverage;
  /** Bounded selector catalogue, including when one business is selected. */
  businesses: AdminCopilotBusiness[];
  metrics: {
    businesses: number;
    pendingPayments: number;
    quotaWarnings: number;
    quotaExhausted: number;
    expiringSubscriptions: number;
  };
  attention: AdminCopilotAttention[];
  sources: AdminCopilotSource[];
}

export interface AdminCopilotQuestion {
  requestId: string;
  question: string;
  businessId?: string;
}

export interface AdminCopilotAnswer {
  reply: string;
  provider: AiProvider;
  sources: AdminCopilotSource[];
  snapshot: AdminCopilotSnapshot;
}
