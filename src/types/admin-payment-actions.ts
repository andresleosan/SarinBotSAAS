export type PreparePaymentInput = { paymentId: string; action: 'approve' | 'reject'; requestId: string; rejectionReason?: string };
export type PaymentProposal = { id: string; actorUid: string; paymentId: string; action: 'approve' | 'reject'; contextFingerprint: string; revision: number; expiresAt: number; state: 'pending' | 'executed' | 'expired' | 'cancelled' };
/** HTTP projection deliberately excludes authority/fingerprint and full canonical records. */
export type PaymentActionView = {
  proposal: Pick<PaymentProposal, 'id' | 'paymentId' | 'action' | 'revision' | 'expiresAt' | 'state'>;
  business: { id: string; name: string };
  payment: { id: string; amountCOP: number; planId: string; kind: string; status: 'pending' | 'approved' | 'rejected' };
  effect: string;
  rejectionReason?: string;
};
export type PaymentActionResult = {
  business: { id: string; name: string };
  payment: { id: string; amountCOP: number; planId: string; kind: string; status: 'pending' | 'approved' | 'rejected' };
  effectId: string;
  reviewedAt: number;
};
