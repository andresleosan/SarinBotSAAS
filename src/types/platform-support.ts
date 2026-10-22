/** Safe authenticated HTTP views; no recipient identity or persisted plaintext. */
export type SupportActor = { uid: string; role: 'customer' | 'admin' };
export type SupportMessageInput = { requestId: string; expectedRevision: number; text: string };
export type SupportMessageView = { id: string; sequence: number; author: 'customer' | 'admin'; text: string | null; createdAt: number; expiresAt: number };
export type SupportNotificationState = 'blocked' | 'pending' | 'accepted' | 'delivered' | 'rejected' | 'unknown' | 'cancelled';
export type SupportPage = { messages: SupportMessageView[]; cursor: string | null; hasMore: boolean; revision: number; observedAt: number; notificationStates: Array<{ messageId: string; state: SupportNotificationState }> };
export type SupportConversationView = { id: string; revision: number; lastSequence: number; createdAt: number; expiresAt: number };
export type SupportConversationPage = { conversations: SupportConversationView[]; cursor: string | null; hasMore: boolean; observedAt: number };
export type SupportRecipientInput = { linkId: string; expectedRevision: number; requestId: string };
export type SupportRecipientView = { configured: boolean; revision: number; expiresAt: number | null };
