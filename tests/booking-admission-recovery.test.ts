import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ db: undefined as unknown, engine: vi.fn() }));
vi.mock('@/lib/firebase/admin', () => ({ getAdminDb: () => state.db }));
vi.mock('@/lib/sarin/engine', async original => ({ ...await original<typeof import('@/lib/sarin/engine')>(), completeChat: state.engine }));
import { memoryFirestore } from './memoryFirestore';
import { consentedFirestore } from './consent-fixtures';
import { privateBusinessDraft } from '@/lib/server/businesses';
import { createAppointment, cancelAppointment, readAppointments } from '@/lib/server/bookings';
import { createBookingProposal, confirmBookingProposalDetailed, recoverBookingProposal } from '@/lib/server/booking-proposals';
import { readBookingSubjectConsent, updateBookingSubjectConsent, readStoredBookingSubjectEvidence, bookingSubjectStateKey } from '@/lib/server/booking-subject-consent';
import { bookingDataPolicyKey } from '@/lib/server/booking-data-policy';
import { runSarinChat } from '@/lib/server/chat';
import type { BookingPolicyV2 } from '@/lib/booking-admission';
import type { Business, Appointment } from '@/types/firestore';

const owner = { uid: 'demo-owner' }, client = { uid: 'demo-client' };
const businessId = 'demo-recovery-biz';

function baseBusiness(): Business {
  const draft = privateBusinessDraft(owner, 1);
  return {
    ...draft,
    id: businessId,
    name: 'Demo Recovery Salón',
    slug: 'demo-recovery-salon',
    phoneWhatsApp: '573001234567',
    subscription: {
      status: 'active',
      trialEndsAt: Date.now() + 86400000 * 30,
      currentPeriodEndsAt: Date.now() + 86400000 * 30,
    },
    resources: [{ id: 'res-1', name: 'Barbero 1', active: true }],
    services: [{ id: 'srv-1', name: 'Corte General', durationMinutes: 30, bufferMinutes: 0, price: 30000, resourceIds: ['res-1'] }],
    sarinConfig: {
      onboardingCompleted: true,
      tone: 'friendly',
      customRules: '',
      intakeFields: [],
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

describe('R0-POLICY-B4 independent durable recovery', () => {
  beforeEach(() => {
    vi.stubEnv('SUPERADMIN_UID', 'demo-admin');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('allows reading, cancelling and recovering a confirmed appointment when policy is withdrawn or corrupt', async () => {
    const business = baseBusiness();
    const policy = activePolicy();
    const { db } = consentedFirestore({
      [`businesses/${businessId}`]: business as any,
      [`serverSettings/${bookingDataPolicyKey(businessId)}`]: policy,
    }, [client.uid, owner.uid]);

    // 1. Create confirmed appointment while active
    const appointment = await createAppointment(client, businessId, {
      dateKey: '2026-12-05',
      startTimeStr: '10:00',
      serviceId: 'srv-1',
      resourceId: 'res-1',
      clientPhone: '573001234567',
      intakeAnswers: {},
    }, 'req-rec-1', db);
    expect(appointment.status).toBe('confirmed');

    // 2. Policy becomes corrupt / illegible
    await db.collection('serverSettings').doc(bookingDataPolicyKey(businessId)).set({ corrupt: true });

    // 3. Reading appointments succeeds
    const list = await readAppointments(businessId, '2026-12-05', client, db);
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(appointment.id);

    // 4. Cancelling appointment succeeds without failing with policy error
    const cancelled = await cancelAppointment(client, businessId, appointment.id, db);
    expect(cancelled.status).toBe('cancelled_by_client');

    // 5. Replay of same requestId returns the existing appointment with its cancelled status
    const replayed = await createAppointment(client, businessId, {
      dateKey: '2026-12-05',
      startTimeStr: '10:00',
      serviceId: 'srv-1',
      resourceId: 'res-1',
      clientPhone: '573001234567',
      intakeAnswers: {},
    }, 'req-rec-1', db);
    expect(replayed.id).toBe(appointment.id);
    expect(replayed.status).toBe('cancelled_by_client');
  });

  it('separates stored booking subject evidence from current policy readability and permits revocation', async () => {
    const business = baseBusiness();
    const policy: BookingPolicyV2 = { ...activePolicy(), origin: 'admin', declaration: null, dataMode: 'health', representedMinorsEnabled: true };
    const minorCase = { bookingRequestId: 'case-minor-1', subjectKind: 'represented_minor' as const, representativeRole: 'parent' as const };
    const { db } = consentedFirestore({
      [`businesses/${businessId}`]: business as any,
      [`serverSettings/${bookingDataPolicyKey(businessId)}`]: policy,
    }, [client.uid, owner.uid]);

    // 1. Accept subject consent while policy is valid
    const statusBefore = await readBookingSubjectConsent(client, businessId, minorCase, db);
    expect(statusBefore.documents).not.toBeNull();
    const accepted = await updateBookingSubjectConsent(client, {
      businessId,
      case: minorCase,
      action: 'accept',
      requestId: 'req-acc-1',
      expectedRevision: statusBefore.revision,
      fingerprint: statusBefore.documents!.fingerprint,
      decisions: { dataAuthorized: true, sensitiveDataAuthorized: true, representationDeclared: true },
    }, db);
    expect(accepted.active).toBe(true);

    // 2. Corrupt the business policy
    await db.collection('serverSettings').doc(bookingDataPolicyKey(businessId)).set({ corrupt: true });

    // 3. Stored evidence remains independently readable and verified
    const evidence = await readStoredBookingSubjectEvidence(client, businessId, minorCase, db);
    expect(evidence.state?.active).toBe(true);
    expect(evidence.receipt?.requestId).toBe('req-acc-1');

    // 4. Consent query returns stored status without failing
    const readAfter = await readBookingSubjectConsent(client, businessId, minorCase, db);
    expect(readAfter.receipt?.requestId).toBe('req-acc-1');

    // 5. Revoking consent succeeds even when policy is corrupt
    const revoked = await updateBookingSubjectConsent(client, {
      businessId,
      case: minorCase,
      action: 'revoke',
      requestId: 'req-rev-1',
      expectedRevision: readAfter.revision,
    }, db);
    expect(revoked.active).toBe(false);

    // 6. Corrupt receipt fails closed (does not simulate empty history or authorization)
    const stateDoc = (await db.collection('serverSettings').doc(bookingSubjectStateKey(client.uid, businessId, minorCase.bookingRequestId)).get()).data()!;
    await db.collection('serverSettings').doc(stateDoc.receiptId).set({ corrupt: true });
    await expect(readStoredBookingSubjectEvidence(client, businessId, minorCase, db)).rejects.toMatchObject({
      status: 503,
      code: 'BOOKING_SUBJECT_UNAVAILABLE',
    });
  });

  it('chat denied does not return cached text or pending proposal but recovers durable confirmed appointment', async () => {
    const business = baseBusiness();
    const policy = activePolicy();
    const { db } = consentedFirestore({
      [`businesses/${businessId}`]: business as any,
      [`serverSettings/${bookingDataPolicyKey(businessId)}`]: policy,
    }, [client.uid, owner.uid]);

    state.db = db;
    // 1. Create and confirm a proposal
    const proposal = await createBookingProposal(client, businessId, {
      dateKey: '2026-12-10',
      startTimeStr: '11:00',
      serviceId: 'srv-1',
      resourceId: 'res-1',
    }, 'req-chat-prop-1', db);

    const confirmation = await confirmBookingProposalDetailed(client, businessId, proposal.id, {
      clientPhone: '573001234567',
      intakeAnswers: {},
    }, db);
    expect(confirmation.appointment.status).toBe('confirmed');

    // 2. Policy becomes withdrawn
    await db.collection('serverSettings').doc(bookingDataPolicyKey(businessId)).set({ ...policy, status: 'withdrawn' });

    // 3. Chat with same requestId recovers the confirmed appointment without new inference
    const recovered = await runSarinChat({
      user: client,
      body: {
        mode: 'sarin_client',
        tenantId: businessId,
        requestId: 'req-chat-prop-1',
        messages: [{ role: 'user', content: 'Quiero mi cita' }],
      },
      channel: 'web',
    });
    expect(recovered.reply).toContain('Cita: Activa');

    // 4. Chat with same requestId but different content / messages conflicts
    await expect(runSarinChat({
      user: client,
      body: {
        mode: 'sarin_client',
        tenantId: businessId,
        requestId: 'req-chat-prop-1',
        messages: [{ role: 'user', content: 'Mensaje completamente diferente' }],
      },
      channel: 'web',
    })).rejects.toMatchObject({
      status: 409,
      code: 'AI_REQUEST_CONFLICT',
    });

    // 5. A pending proposal without appointment is never recovered as a confirmed appointment; chat fails with admission error
    await db.collection('serverSettings').doc(bookingDataPolicyKey(businessId)).set(policy);
    await createBookingProposal(client, businessId, {
      dateKey: '2026-12-10',
      startTimeStr: '14:00',
      serviceId: 'srv-1',
      resourceId: 'res-1',
    }, 'req-pending-only', db);

    await db.collection('serverSettings').doc(bookingDataPolicyKey(businessId)).set({ ...policy, status: 'withdrawn' });

    await expect(runSarinChat({
      user: client,
      body: {
        mode: 'sarin_client',
        tenantId: businessId,
        requestId: 'req-pending-only',
        messages: [{ role: 'user', content: 'Ver propuesta' }],
      },
      channel: 'web',
    })).rejects.toMatchObject({
      status: 409,
      code: 'BOOKING_DECLARATION_WITHDRAWN',
    });
  });
});
