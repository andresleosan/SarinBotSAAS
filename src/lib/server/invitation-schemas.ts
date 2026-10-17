import { z } from 'zod';
import { requestIdSchema } from './schemas';

export const normalizeInvitationEmail = (email: string) => email.trim().toLowerCase();
export const invitationCursorSchema = z.string().regex(/^[a-f0-9]{24}$/);
export const createInvitationSchema = z.object({
  recipientEmail: z.string().transform(normalizeInvitationEmail).pipe(z.email().max(254)),
  expiresInDays: z.number().int().min(1).max(30).default(7), requestId: requestIdSchema,
}).strict();
export const redeemInvitationSchema = z.object({
  code: z.string().trim().regex(/^(?:\d{6}|SARIN-[a-f0-9]{24}-[A-Za-z0-9_-]{32})$/), requestId: requestIdSchema,
}).strict();
export const invitationCommandSchema = z.object({
  action: z.enum(['revoke_code', 'suspend_access', 'reactivate_access']), invitationId: invitationCursorSchema,
  expectedVersion: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), requestId: requestIdSchema,
  reason: z.string().trim().min(1).max(300),
}).strict();
