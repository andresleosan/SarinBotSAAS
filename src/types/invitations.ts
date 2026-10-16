import type { Business } from '@/types/firestore';

export interface CreateInvitationInput { recipientEmail: string; expiresInDays?: number; requestId: string; }
export interface RedeemInvitationInput { code: string; requestId: string; }
export interface InvitationAdminCommand { action: 'revoke_code' | 'suspend_access' | 'reactivate_access'; invitationId: string; expectedVersion: number; requestId: string; reason: string; }
export interface InvitationRecord {
  id: string; codeHash: string; maskedCode: string; recipientEmail: string; createdBy: string; createFingerprint: string;
  createdAt: number; expiresAt: number; expiresInDays: number; version: number;
  state: 'issued' | 'revoked' | 'redeemed';
  redemption?: { uid: string; email: string; businessId: string; requestId: string; trialPeriodId: string; at: number };
  codeRevocation?: { at: number; by: string; reason: string };
  access?: { state: 'active' | 'suspended'; at: number; by: string; reason: string };
}
export type InvitationSummary = Omit<InvitationRecord, 'codeHash' | 'createFingerprint'> & {
  codeState: 'available' | 'expired' | 'revoked' | 'redeemed';
  usage: { appointmentsUsed: number | null; appointmentLimit: 10; responsesUsed: number | null; responseLimit: 700 } | null;
};
export interface InvitationPage { invitations: InvitationSummary[]; nextCursor: string | null; }
export interface InvitationCreationResult { invitation: InvitationSummary; code: string | null; replayed: boolean; }
export interface InvitationRedemptionResult { business: Business; invitationId: string; replayed: boolean; }
export interface InvitationCommandResult { invitation: InvitationSummary; replayed: boolean; }
