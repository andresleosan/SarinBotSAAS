import type { PlatformWhatsAppScope } from '../../shared/platform-whatsapp-records';

export type PlatformWhatsAppConnectionAction = 'pause' | 'resume' | 'disconnect' | 'record_connected';
export type PlatformWhatsAppPresentationState = 'disconnected' | 'paused' | 'not_configured' | 'configured_unverified' | 'receiving_human' | 'automation_blocked';
export interface PlatformWhatsAppAuditView {
  action: PlatformWhatsAppConnectionAction | 'human' | 'review';
  actorUid: string;
  at: string;
  expiresAt: string;
  revision: number;
}
export interface PlatformWhatsAppStatus {
  receiveEnabled: boolean;
  retentionEnabled: boolean;
  aiEnabled: false;
  sendEnabled: false;
  configured: boolean;
  missingConfiguration: string[];
  scope: PlatformWhatsAppScope | null;
  providerConnection: 'unverified' | 'connected' | 'disconnected';
  connectionRevision: number;
  lastSignedInboundAt: string | null;
  lastHumanEchoAt: string | null;
  lastDeliveryAt: null;
  connectedAt: string | null;
  connectedBy: string | null;
  pausedReason: null | 'manual' | 'disconnected';
  presentationState: PlatformWhatsAppPresentationState;
  observedAt: string;
  audit: PlatformWhatsAppAuditView[];
}
interface PlatformWhatsAppControlRequest { expectedRevision: number; requestId: string }
export type PlatformWhatsAppConnectionControl = PlatformWhatsAppControlRequest & (
  | { action: 'pause' | 'resume' | 'disconnect' }
  | ({ action: 'record_connected' } & PlatformWhatsAppScope)
);
export interface PlatformWhatsAppConversationControl extends PlatformWhatsAppControlRequest {
  conversationId: string;
  mode: 'human' | 'review';
}
export interface PlatformWhatsAppConversationView {
  id: string;
  mode: 'human' | 'review';
  revision: number;
  updatedAt: string;
  lastInboundAt: string | null;
  lastHumanAt: string | null;
  customerName: null;
  customerPhone: string | null;
  lastMessage: string | null;
  contentAvailable: boolean;
  contentExpiresAt: string;
  contentObservedAt: string;
}
export interface PlatformWhatsAppConversationList {
  conversations: PlatformWhatsAppConversationView[];
  truncated: boolean;
  observedAt: string;
}
export interface PlatformWhatsAppConversationControlResponse { conversation: PlatformWhatsAppConversationView }
export interface PlatformWhatsAppIngressResult { outcome: 'stored' | 'duplicate' | 'conflict'; conversationId: string }
