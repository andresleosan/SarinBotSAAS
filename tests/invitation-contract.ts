import { expect, vi } from 'vitest';
import type { DecodedIdToken } from 'firebase-admin/auth';
import type { Database } from '@/lib/storage/types';
import type { BusinessConfig } from '@/lib/server/schemas';
import { createInvitation, listInvitations, redeemInvitation, updateInvitation } from '@/lib/server/invitations';
import { createBusiness, businessIdForOwner } from '@/lib/server/businesses';
import { createAppointment, cancelAppointment, readAppointments } from '@/lib/server/bookings';
import { getResponseQuota } from '@/lib/server/response-quota';
import { businessQuotaScope, responsePeriodReference } from '@/lib/server/response-periods';
import { submitReceipt, reviewPayment } from '@/lib/server/billing';
import { acceptSyntheticConsent } from './consent-fixtures';

export async function verifyInvitationLifecycle(db: Database, config: BusinessConfig, dateKey: string) {
  const suffix = crypto.randomUUID();
  const admin = { uid: `invite-admin-${suffix}` } as DecodedIdToken;
  const owner = { uid: `invite-owner-${suffix}`, email: `owner-${suffix}@example.test`, email_verified: true, firebase: { sign_in_provider: 'google.com' } } as DecodedIdToken;
  vi.stubEnv('SUPERADMIN_UID', admin.uid);
  try {
    await acceptSyntheticConsent(db, owner.uid);
    const one = await createInvitation(admin, { recipientEmail: owner.email!, requestId: 'create-one' }, db);
    const two = await createInvitation(admin, { recipientEmail: owner.email!, requestId: 'create-two' }, db);
    const results = await Promise.allSettled([one, two].map(value => redeemInvitation(owner, { code: value.code!, requestId: 'redeem-one' }, db)));
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    const winnerIndex = results.findIndex(result => result.status === 'fulfilled');
    const issued = [one, two][winnerIndex];
    const usedRecord = (await db.collection('invitations').doc(issued.invitation.id).get()).data()!;
    expect(usedRecord.state).toBe('redeemed');
    expect((await db.collection('invitations').doc([one, two][1 - winnerIndex].invitation.id).get()).data()?.state).toBe('issued');
    const business = await createBusiness(owner, { ...config, slug: `invitation-${suffix}` }, db);
    const periods = db.collection('responseQuotaScopes').doc(businessQuotaScope(business.id)).collection('periods');
    expect((await periods.get()).size).toBe(1);
    const periodReference = responsePeriodReference(db, businessQuotaScope(business.id), usedRecord.redemption.trialPeriodId);
    await periodReference.set({ ...(await periodReference.get()).data(), usedResponses: 7 });
    const actor = { uid: `client-${suffix}` };
    await acceptSyntheticConsent(db, actor.uid, business);
    const bookingInput = { dateKey, startTimeStr: '11:00', serviceId: config.services[0].id, resourceId: config.resources[0].id, clientPhone: '573001234567', intakeAnswers: {} };
    const appointment = await createAppointment(actor, business.id, bookingInput, 'booking-one', db);
    const command = { invitationId: issued.invitation.id, expectedVersion: 1, requestId: 'suspend-one', reason: 'Prueba sintética', action: 'suspend_access' as const };
    await updateInvitation(admin, command, db);
    expect((await getResponseQuota(business.id, db)).state).toBe('suspended');
    await expect(createAppointment(actor, business.id, { ...bookingInput, startTimeStr: '13:00' }, 'booking-blocked', db)).rejects.toMatchObject({ status: 402 });
    expect((await readAppointments(business.id, dateKey, actor, db)).map(item => item.id)).toContain(appointment.id);
    await cancelAppointment(actor, business.id, appointment.id, db);
    const recovered = await redeemInvitation(owner, { code: issued.code!, requestId: 'redeem-one' }, db);
    expect(recovered.business.subscription.paidTrial).toMatchObject({ accessSuspended: true, appointmentsUsed: 1 });
    const reactivated = await updateInvitation(admin, { ...command, action: 'reactivate_access', expectedVersion: 2, requestId: 'reactivate-one' }, db);
    expect(reactivated.invitation.usage).toMatchObject({ appointmentsUsed: 1, responsesUsed: 7 });
    const upload = { bankSelected: 'bank', requestId: 'paid-weekly', kind: 'subscription' as const, planId: 'weekly' as const, receiptDataUrl: `data:image/webp;base64,${Buffer.from('RIFFxxxxWEBPfixture').toString('base64')}` };
    const receipt = await submitReceipt(owner, upload, db);
    const approved = await reviewPayment(receipt.receipt.id, 'approve', undefined, db);
    expect(approved.business.subscription.paidTrial).toMatchObject({ appointmentsUsed: 1 });
    await updateInvitation(admin, { ...command, expectedVersion: 3, requestId: 'suspend-again' }, db);
    expect((await getResponseQuota(business.id, db)).state).toBe('active');
    expect((await listInvitations(admin, undefined, db)).invitations.find(item => item.id === issued.invitation.id)?.usage).toMatchObject({ appointmentsUsed: 1, responsesUsed: 7 });

    const other = { ...owner, uid: `race-${suffix}`, email: `race-${suffix}@example.test` };
    await acceptSyntheticConsent(db, other.uid);
    const racing = await createInvitation(admin, { recipientEmail: other.email, requestId: 'create-race' }, db);
    const race = await Promise.allSettled([redeemInvitation(other, { code: racing.code!, requestId: 'redeem-race' }, db), submitReceipt(other, { ...upload, kind: 'paid_trial', planId: undefined, requestId: 'receipt-race' }, db)]);
    expect(race.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    const stored = (await db.collection('businesses').doc(businessIdForOwner(other.uid)).get()).data()!;
    expect(Boolean(stored.subscription.paidTrial)).toBe(race[0].status === 'fulfilled');
  } finally { vi.unstubAllEnvs(); }
}
