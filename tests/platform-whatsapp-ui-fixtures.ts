import type { PlatformWhatsAppConversationList, PlatformWhatsAppConversationView, PlatformWhatsAppStatus } from '@/types/platform-whatsapp';

export const statusFixture = (overrides: Partial<PlatformWhatsAppStatus> = {}): PlatformWhatsAppStatus => ({
  receiveEnabled: true, retentionEnabled: true, aiEnabled: false, sendEnabled: false,
  configured: true, missingConfiguration: [],
  scope: { wabaId: '111111', phoneE164: '+573000000001', phoneNumberId: '222222' },
  providerConnection: 'connected', connectionRevision: 4,
  lastSignedInboundAt: '2026-10-21T15:00:00.000Z', lastHumanEchoAt: null, lastDeliveryAt: null,
  connectedAt: null, connectedBy: null, pausedReason: null,
  presentationState: 'receiving_human', observedAt: '2026-10-21T15:00:00.000Z', audit: [], ...overrides,
});
export const conversationFixture = (overrides: Partial<PlatformWhatsAppConversationView> = {}): PlatformWhatsAppConversationView => ({
  id: 'a'.repeat(64), mode: 'review', revision: 7, updatedAt: '2026-10-21T15:00:00.000Z',
  lastInboundAt: '2026-10-21T15:00:00.000Z', lastHumanAt: null, customerName: null,
  customerPhone: '+573000000002', lastMessage: 'Consulta sintética\nSegunda línea', contentAvailable: true,
  contentObservedAt: '2026-10-21T15:00:00.000Z', contentExpiresAt: '2026-10-21T15:00:10.000Z', ...overrides,
});
export const inboxFixture = (conversations = [conversationFixture()], truncated = false): PlatformWhatsAppConversationList => ({ conversations, truncated, observedAt: '2026-10-21T15:00:00.000Z' });
export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
