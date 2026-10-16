export type ChatMode = 'sarin_onboarding' | 'sarin_client' | 'sarin_owner_copilot';
/** Verified by the transport: Firebase for web, signed Meta webhook for WhatsApp. */
export interface ChatActor { uid: string; email?: string; name?: string; phone?: string; }
export interface ChatMessage { id: string; role: 'user' | 'assistant'; content: string; timestamp: number; }
export interface ChatToolResult { name: string; result: Record<string, unknown>; }
export type ChatSelection = { serviceId?: string; resourceId?: string; dateKey?: string; startTimeStr?: string; proposalId?: string };
export type ChatState = { version: number; selection: ChatSelection; updatedAt: number; expiresAt: number };
export interface ChatResponse { reply: string; toolResults?: ChatToolResult[]; stateVersion?: number; }
