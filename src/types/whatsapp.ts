export interface WhatsAppBindingStatus {
  businessId: string;
  phoneNumberId: string;
  wabaId: string;
  enabled: boolean;
  credentialConfigured: boolean;
  status: 'unconfigured' | 'configured_unverified' | 'paused' | 'ready';
  lastInboundAt: string | null;
  lastDeliveredAt: string | null;
}
export interface AdminWhatsAppSettings {
  enabled: boolean;
  configured: boolean;
  graphApiVersion: string;
  missingConfiguration: string[];
  bindings: WhatsAppBindingStatus[];
  truncated: boolean;
  usage?: WhatsAppUsage;
}
export interface WhatsAppUsageCounters {
  sent: number; delivered: number; read: number; failed: number; unknown: number;
  serviceDelivered: number; utilityDelivered: number; marketingDelivered: number; otherDelivered: number;
  freeDelivered: number; regularDelivered: number; unknownPricingDelivered: number;
}
export interface WhatsAppUsage {
  month: string;
  timeZone: 'America/Bogota';
  source: 'meta_webhooks';
  cohort: 'generated_month';
  invoice: false;
  estimatedCostCOP: null;
  totals: WhatsAppUsageCounters;
  businesses: ({ businessId: string } & WhatsAppUsageCounters)[];
  truncated: boolean;
}

export type WhatsAppConversationMode = 'bot' | 'human' | 'review';
export interface AdminWhatsAppConversation {
  id: string;
  businessId: string;
  phoneNumberId: string;
  mode: WhatsAppConversationMode;
  revision: number;
  updatedAt: string;
  lastInboundAt: string | null;
  lastHumanAt: string | null;
  customerName: string | null;
  customerPhone: string | null;
  lastMessage: string | null;
  contentAvailable: boolean;
}
export interface AdminWhatsAppConversations {
  conversations: AdminWhatsAppConversation[];
  truncated: boolean;
}
