export type ChatMode = 'sarin_onboarding' | 'sarin_client' | 'sarin_owner_copilot';
export interface ChatMessage { id: string; role: 'user' | 'assistant'; content: string; timestamp: number; }
export interface ChatToolResult { name: string; result: Record<string, unknown>; }
export interface ChatResponse { reply: string; toolResults?: ChatToolResult[]; }
