import type { SubscriptionPlanId } from '@/lib/billing-plans';
export type { SubscriptionPlanId } from '@/lib/billing-plans';

export interface PlatformSettings {
  companyName: string;
  weeklyPriceCOP: number;
  fortnightlyPriceCOP: number;
  monthlyPriceCOP: number;
  whatsappPriceCOP: number;
  responsePackPriceCOP: number;
  graceHoursOnUpload: number;
  bankAccounts: {
    id: string;
    bankName: string;
    accountType: string;
    accountNumber: string;
    holderName: string;
    holderDoc?: string;
  }[];
  tunnelStatus: {
    isOnline: boolean;
    lastPingAt: number;
  };
}

export interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  photoURL?: string;
  role: 'superadmin' | 'user';
  isSuperadmin?: boolean;
  ownedTenantId?: string;
  visitedTenants: string[];
  createdAt: number;
}

export type SubscriptionStatus =
  | 'pending_payment'
  | 'trial'
  | 'active'
  | 'past_due'
  | 'suspended';

export interface IntakeField {
  key: string;
  label: string;
  required: boolean;
}

export interface TenantResource {
  id: string;
  name: string;
  active: boolean;
}

export interface TenantService {
  id: string;
  name: string;
  durationMinutes: number;
  bufferMinutes: number;
  price: number;
  resourceIds: string[];
}

export interface DaySchedule {
  isOpen: boolean;
  intervals: { start: string; end: string }[];
}

export interface IntroductoryTrialUsage {
  activatedAt: number;
  appointmentLimit: 10;
  appointmentsUsed: number;
}
export type IntroductoryTrial = IntroductoryTrialUsage & (
  { source?: 'payment'; paymentId: string; invitationId?: never; accessSuspended?: never } |
  { source: 'invitation'; invitationId: string; accessSuspended: boolean; paymentId?: never }
);

export interface Business {
  id: string;
  slug: string;
  ownerUid: string;
  ownerEmail: string;
  name: string;
  category: string;
  phoneWhatsApp: string;
  timezone: 'America/Bogota';
  subscription: {
    status: SubscriptionStatus;
    trialEndsAt: number;
    currentPeriodEndsAt: number;
    graceEndsAt?: number;
    graceGrantedAt?: number;
    lastPaymentId?: string;
    paidTrial?: IntroductoryTrial;
  };
  sarinConfig: {
    onboardingCompleted: boolean;
    tone: string;
    customRules: string;
    intakeFields: IntakeField[];
  };
  resources: TenantResource[];
  services: TenantService[];
  weeklySchedule: {
    [dayOfWeek: number]: DaySchedule;
  };
  createdAt: number;
}

/** Existing module terminology; Business is the canonical persisted model. */
export type Tenant = Business;
export type PublicBusiness = Omit<Business, 'ownerUid' | 'ownerEmail' | 'createdAt' | 'subscription'> & {
  subscription: Pick<Business['subscription'], 'status' | 'trialEndsAt' | 'currentPeriodEndsAt' | 'graceEndsAt'> & {
    paidTrial?: IntroductoryTrialUsage & { source?: 'payment' | 'invitation'; accessSuspended?: boolean };
  };
};

export interface TenantClientMemory {
  uid: string;
  displayName: string;
  email: string;
  phone?: string;
  knownIntakeData: Record<string, string>;
  totalAppointments: number;
  noShowCount: number;
  lastAppointmentAt?: number;
}

export interface Appointment {
  id: string;
  tenantId: string;
  dateKey: string; // "YYYY-MM-DD"
  startAt: number;
  endAt: number;
  /** Includes preparation/cleaning buffer; endAt remains the service end. */
  reservedUntilAt: number;
  startTimeStr: string; // "14:30"
  endTimeStr: string; // "15:15"
  type: 'appointment' | 'manual_block';
  resourceId: string;
  serviceId?: string;
  serviceName?: string;
  price?: number;
  client?: {
    uid: string;
    name: string;
    email: string;
    phone?: string;
    intakeAnswers: Record<string, string>;
    hasNoShowHistory?: boolean;
  };
  status: 'confirmed' | 'cancelled_by_client' | 'cancelled_by_owner' | 'completed' | 'no_show';
  createdBy: 'sarin_client' | 'sarin_owner' | 'manual_panel';
  createdAt: number;
}

export interface PaymentReceipt {
  id: string;
  tenantId: string;
  tenantName: string;
  ownerUid: string;
  ownerEmail: string;
  amountCOP: number;
  kind?: 'subscription' | 'response_pack' | 'paid_trial';
  appointmentAllowance?: number;
  responseAllowance?: number;
  quotaPeriodId?: string;
  /** Absent only on historical monthly receipts; new receipts snapshot both. */
  planId?: SubscriptionPlanId;
  periodDays?: number;
  bankSelected: string;
  /** Image content lives separately in paymentImages/{id}, never in list queries. */
  receiptDataUrl?: string;
  receiptImageUrl?: string;
  status: 'pending' | 'approved' | 'rejected';
  rejectionReason?: string;
  submittedAt: number;
  reviewedAt?: number;
}

export type PaymentRequest = PaymentReceipt;

export interface ResponseQuotaPeriod {
  id: string;
  source: 'trial' | 'subscription' | 'legacy';
  planId: SubscriptionPlanId | null;
  startsAt: number;
  endsAt: number;
  includedResponses: number;
  extraResponses: number;
  usedResponses: number;
  reservedResponses: number;
  remainingResponses: number;
}

export interface ResponseAllowance {
  businessId: string;
  currentPeriod: ResponseQuotaPeriod | null;
  nextPeriod: ResponseQuotaPeriod | null;
  state: 'active' | 'warning' | 'exhausted' | 'expired' | 'suspended';
  warningThresholdPercent: 80;
}
