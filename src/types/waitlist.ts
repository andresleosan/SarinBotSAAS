import type { BookingSubjectCase, BookingSubjectKind, RepresentativeRole } from '@/lib/booking-subject';

export type WaitlistSuspensionReason = 'consent_changed' | 'booking_policy_changed' | 'business_unavailable' | 'client_blocked' | 'client_limit' | 'service_unavailable';
export type WaitlistRequestView = {
  id: string;
  serviceId: string;
  dateKey: string;
  resourceId: string | null;
  subjectKind: BookingSubjectKind;
  representativeRole?: RepresentativeRole;
  createdAt: number;
  expiresAt: number;
  status: 'waiting' | 'available' | 'suspended' | 'expired';
  reason?: WaitlistSuspensionReason;
  checkedAt: number | null;
};
export type WaitlistState = { businessId: string; ownerUid: string; revision: number; serverNow: number; request: WaitlistRequestView | null };
export type WaitlistJoinInput = { requestId: string; expectedRevision: number; case: BookingSubjectCase; serviceId: string; dateKey: string; resourceId?: string };
export type WaitlistCancelInput = { requestId: string; expectedRevision: number; entryId: string };
