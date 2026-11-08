import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { memoryFirestore } from './memoryFirestore';
import { consentedFirestore } from './consent-fixtures';
import { privateBusinessDraft, createBusiness, businessIdForOwner } from '@/lib/server/businesses';
import { createAppointment, createManualBlock, prepareAppointmentInTransaction } from '@/lib/server/bookings';
import { createBookingProposal } from '@/lib/server/booking-proposals';
import { createStructuredBookingProposal } from '@/lib/server/structured-booking';
import { rescheduleAppointmentInTransaction } from '@/lib/server/appointment-rescheduling';
import { prepareOwnerReschedule, confirmOwnerReschedule } from '@/lib/server/owner-rescheduling';
import { joinWaitlist } from '@/lib/server/waitlist';
import { createOwnerWaitlistOffer } from '@/lib/server/waitlist-offers';
import { updateBookingSubjectConsent } from '@/lib/server/booking-subject-consent';
import { readTeamAssignedAgenda } from '@/lib/server/team-agenda';
import { requestTeamAccess, decideTeamAccess } from '@/lib/server/business-team';
import { teamFixture } from './business-team-contract';
import { toColombiaTimestamp } from '@/lib/sarin/calendar-time';
import { bookingDataPolicyKey } from '@/lib/server/booking-data-policy';
import { ensureBookingAdmissionProtocol } from '@/lib/server/booking-admission';
import type { BookingPolicyV2 } from '@/lib/booking-admission';
import type { Business } from '@/types/firestore';

const owner = { uid: 'demo-owner' }, client = { uid: 'demo-client' }, teamMember = { uid: 'demo-member' };
const businessId = businessIdForOwner(owner.uid);

function baseBusiness(): Business {
  const draft = privateBusinessDraft(owner, 1);
  return {
    ...draft,
    id: businessId,
    name: 'Demo Domain Salón',
    slug: 'demo-domain-salon',
    phoneWhatsApp: '573001234567',
    subscription: {
      status: 'active',
      trialEndsAt: Date.now() + 86400000 * 30,
      currentPeriodEndsAt: Date.now() + 86400000 * 30,
    },
    resources: [
      { id: 'res-1', name: 'Barbero 1', active: true },
      { id: 'res-2', name: 'Barbero 2', active: true },
    ],
    services: [
      { id: 'srv-1', name: 'Corte General', durationMinutes: 30, bufferMinutes: 0, price: 30000, resourceIds: ['res-1', 'res-2'] },
    ],
    sarinConfig: {
      onboardingCompleted: true,
      tone: 'friendly',
      customRules: '',
      intakeFields: [{ key: 'notes', label: 'Notas', required: false }],
    },
    weeklySchedule: {
      '0': { isOpen: true, intervals: [{ start: '08:00', end: '18:00' }] },
      '1': { isOpen: true, intervals: [{ start: '08:00', end: '18:00' }] },
      '2': { isOpen: true, intervals: [{ start: '08:00', end: '18:00' }] },
      '3': { isOpen: true, intervals: [{ start: '08:00', end: '18:00' }] },
      '4': { isOpen: true, intervals: [{ start: '08:00', end: '18:00' }] },
      '5': { isOpen: true, intervals: [{ start: '08:00', end: '18:00' }] },
      '6': { isOpen: true, intervals: [{ start: '08:00', end: '18:00' }] },
    },
  };
}

function activePolicy(): BookingPolicyV2 {
  return {
    version: 2,
    businessId,
    revision: 1,
    dataMode: 'general',
    representedMinorsEnabled: false,
    origin: 'owner',
    reason: 'Active general adult declaration',
    declaration: { ownerUid: owner.uid, textVersion: 'v1', receiptId: 'receipt-1' },
    status: 'active',
    updatedAt: Date.now(),
    updatedBy: owner.uid,
  };
}

describe('R0-POLICY-B4 domain entry admission guards', () => {
  beforeEach(() => {
    vi.stubEnv('SUPERADMIN_UID', 'demo-admin');
    vi.stubEnv('SARIN_TEAM_ACCESS_ENABLED', 'true');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('rejects new appointment creation when business admission is not active', async () => {
    const business = baseBusiness();
    const withdrawn: BookingPolicyV2 = { ...activePolicy(), status: 'withdrawn' };
    const { db } = consentedFirestore({
      [`businesses/${businessId}`]: business as any,
      [`serverSettings/${bookingDataPolicyKey(businessId)}`]: withdrawn,
    }, [client.uid, owner.uid]);

    await expect(createAppointment(client, businessId, {
      dateKey: '2026-12-01',
      startTimeStr: '10:00',
      serviceId: 'srv-1',
      resourceId: 'res-1',
      clientPhone: '573001234567',
      intakeAnswers: { notes: 'Sin alergias' },
    }, 'req-book-1', db)).rejects.toMatchObject({
      status: 409,
      code: 'BOOKING_DECLARATION_WITHDRAWN',
    });

    // Zero appointments created
    const appointments = await db.collection('businesses').doc(businessId).collection('appointments').get();
    expect(appointments.empty).toBe(true);
  });

  it('rejects new booking proposal when business admission is not active', async () => {
    const business = baseBusiness();
    const suspended: BookingPolicyV2 = { ...activePolicy(), status: 'suspended', origin: 'admin', declaration: null, reason: 'Admin review' };
    const { db } = consentedFirestore({
      [`businesses/${businessId}`]: business as any,
      [`serverSettings/${bookingDataPolicyKey(businessId)}`]: suspended,
    }, [client.uid, owner.uid]);

    await expect(createBookingProposal(client, businessId, {
      dateKey: '2026-12-01',
      startTimeStr: '10:00',
      serviceId: 'srv-1',
      resourceId: 'res-1',
    }, 'req-prop-1', db)).rejects.toMatchObject({
      status: 409,
      code: 'BOOKING_ADMIN_REVIEW_REQUIRED',
    });
  });

  it('rejects waitlist join when business admission is not active', async () => {
    const business = baseBusiness();
    const withdrawn: BookingPolicyV2 = { ...activePolicy(), status: 'withdrawn' };
    const { db } = consentedFirestore({
      [`businesses/${businessId}`]: business as any,
      [`serverSettings/${bookingDataPolicyKey(businessId)}`]: withdrawn,
    }, [client.uid, owner.uid]);

    await expect(joinWaitlist(client, businessId, {
      requestId: 'req-wait-1',
      expectedRevision: 0,
      case: { bookingRequestId: 'req-wait-1', subjectKind: 'self' },
      serviceId: 'srv-1',
      dateKey: '2026-12-01',
      resourceId: 'res-1',
    }, db)).rejects.toMatchObject({
      status: 409,
      code: 'BOOKING_DECLARATION_WITHDRAWN',
    });
  });

  it('rejects subject consent acceptance when business admission is not active', async () => {
    const business = baseBusiness();
    const withdrawn: BookingPolicyV2 = { ...activePolicy(), status: 'withdrawn' };
    const { db } = consentedFirestore({
      [`businesses/${businessId}`]: business as any,
      [`serverSettings/${bookingDataPolicyKey(businessId)}`]: withdrawn,
    }, [client.uid, owner.uid]);

    await expect(updateBookingSubjectConsent(client, {
      businessId,
      case: { bookingRequestId: 'case-req-1', subjectKind: 'represented_minor', representativeRole: 'parent' },
      action: 'accept',
      requestId: 'req-accept-1',
      expectedRevision: 0,
      fingerprint: 'a'.repeat(64),
      decisions: { dataAuthorized: true, sensitiveDataAuthorized: false, representationDeclared: true },
    }, db)).rejects.toMatchObject({
      status: 409,
      code: 'BOOKING_DECLARATION_WITHDRAWN',
    });
  });

  it('allows manual block by owner without client data even when admission is withdrawn', async () => {
    const business = baseBusiness();
    const withdrawn: BookingPolicyV2 = { ...activePolicy(), status: 'withdrawn' };
    const { db } = consentedFirestore({
      [`businesses/${businessId}`]: business as any,
      [`serverSettings/${bookingDataPolicyKey(businessId)}`]: withdrawn,
    }, [owner.uid]);

    const block = await createManualBlock(owner, businessId, {
      dateKey: '2026-12-01',
      startTimeStr: '14:00',
      endTimeStr: '15:00',
      resourceId: 'res-1',
      requestId: 'req-block-1',
      motivo: 'Almuerzo personal',
    }, db);

    expect(block.status).toBe('confirmed');
    expect(block.type).toBe('manual_block');
  });

  it('allows corrective business configuration with corrupt policy when clearing or preserving intake', async () => {
    const business = baseBusiness();
    const { db } = consentedFirestore({
      [`businesses/${businessId}`]: business as any,
      [`serverSettings/${bookingDataPolicyKey(businessId)}`]: { corrupt: true },
    }, [owner.uid]);

    // Clearing all intake fields succeeds despite corrupt policy
    const cleared = await createBusiness(owner, {
      slug: business.slug,
      name: 'Nuevo Nombre Corregido',
      category: business.category,
      phoneWhatsApp: business.phoneWhatsApp,
      tone: business.sarinConfig.tone,
      customRules: business.sarinConfig.customRules,
      intakeFields: [],
      resources: business.resources,
      services: business.services,
      weeklySchedule: business.weeklySchedule as any,
    }, db);
    expect(cleared.name).toBe('Nuevo Nombre Corregido');
    expect(cleared.sarinConfig.intakeFields).toEqual([]);

    // Preserving exact previous intake fields succeeds despite corrupt policy
    business.sarinConfig.intakeFields = [{ key: 'f1', label: 'Campo 1', required: true }];
    const { db: db2 } = consentedFirestore({
      [`businesses/${businessId}`]: business as any,
      [`serverSettings/${bookingDataPolicyKey(businessId)}`]: { corrupt: true },
    }, [owner.uid]);

    const preserved = await createBusiness(owner, {
      slug: business.slug,
      name: 'Otro Nombre',
      category: business.category,
      phoneWhatsApp: business.phoneWhatsApp,
      tone: business.sarinConfig.tone,
      customRules: business.sarinConfig.customRules,
      intakeFields: [{ key: 'f1', label: 'Campo 1', required: true }],
      resources: business.resources,
      services: business.services,
      weeklySchedule: business.weeklySchedule as any,
    }, db2);
    expect(preserved.name).toBe('Otro Nombre');

    // Adding/modifying intake fields when policy is corrupt is rejected
    await expect(createBusiness(owner, {
      slug: business.slug,
      name: 'Intento Nuevo Campo',
      category: business.category,
      phoneWhatsApp: business.phoneWhatsApp,
      tone: business.sarinConfig.tone,
      customRules: business.sarinConfig.customRules,
      intakeFields: [{ key: 'newField', label: 'Nuevo', required: false }],
      resources: business.resources,
      services: business.services,
      weeklySchedule: business.weeklySchedule as any,
    }, db2)).rejects.toMatchObject({
      status: 503,
      code: 'BOOKING_POLICY_UNAVAILABLE',
    });
  });

  it('preserves team agenda reading for assigned resources even when booking admission is withdrawn', async () => {
    const memory = memoryFirestore();
    const db = memory.db;
    const f = await teamFixture(db);
    const req = await requestTeamAccess(f.member, f.request, db);
    await decideTeamAccess(f.owner, f.business.id, req.current.membershipId, {
      action: 'approve',
      requestId: 'demo-appr-001',
      expectedMembershipRevision: 1,
      expectedTeamRevision: 1,
      resourceId: 'demo-chair',
    }, db);

    // Set business booking admission policy to withdrawn
    await db.collection('serverSettings').doc(bookingDataPolicyKey(f.business.id)).set({
      ...activePolicy(),
      businessId: f.business.id,
      status: 'withdrawn',
    });

    const targetDate = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    const startAt = toColombiaTimestamp(targetDate, '10:00');
    const endAt = startAt + 1800000;

    // Add appointment
    await db.collection('businesses').doc(f.business.id).collection('appointments').doc('app-1').set({
      id: 'app-1',
      tenantId: f.business.id,
      dateKey: targetDate,
      startTimeStr: '10:00',
      endTimeStr: '10:30',
      resourceId: 'demo-chair',
      serviceId: 'srv-1',
      serviceName: 'Corte',
      price: 30000,
      type: 'appointment',
      status: 'confirmed',
      startAt,
      endAt,
      reservedUntilAt: endAt,
      createdAt: Date.now() - 100000,
      createdBy: 'sarin_client',
    });

    const agenda = await readTeamAssignedAgenda(f.member, f.business.id, targetDate, db);
    expect(agenda.businessId).toBe(f.business.id);
    expect(agenda.resource.id).toBe('demo-chair');
    expect(agenda.rows).toHaveLength(1);
    expect(agenda.rows[0].id).toBe('app-1');
  });
});
