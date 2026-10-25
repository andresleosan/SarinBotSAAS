import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Appointment, Business } from '@/types/firestore';
import type { Database } from '@/lib/storage/types';
import { readOwnerRescheduleSource, readOwnerRescheduleAvailability, prepareOwnerReschedule, readOwnerRescheduleProposal, confirmOwnerReschedule } from '@/lib/server/owner-rescheduling';
import { clientPolicyKey } from '@/lib/server/client-policy';
import { bookingDataPolicyKey } from '@/lib/server/booking-data-policy';
import { readConsent, updateConsent } from '@/lib/server/consent';
import { publicBusiness } from '@/lib/server/businesses';
import { emptyResourceSchedulePolicy } from '@/lib/resource-schedules';
import { memoryFirestore } from './memoryFirestore';
import { ownerRescheduleActor as owner, ownerRescheduleBusiness as business, ownerRescheduleSource as original, ownerRescheduleSelection as selection, ownerRescheduleNow as now, seedOwnerRescheduleScenario } from './owner-rescheduling-contract';

let db: Database;
const businessRef = () => db.collection('businesses').doc(business.id);
const sourceRef = () => businessRef().collection('appointments').doc(original.id);
const read = () => readOwnerRescheduleSource(owner, business.id, original.id, db);
const setSource = (patch: object) => sourceRef().set({ ...original, ...patch });
const setBusiness = (patch: Partial<Business>) => businessRef().set({ ...business, ...patch });
async function command(requestId = 'demo-request', target = selection) { return { ...(await read()).expectation, requestId, selection: target }; }
async function prepare(requestId = 'demo-request', target = selection) { return prepareOwnerReschedule(owner, business.id, original.id, await command(requestId, target), db); }
const confirm = (id: string) => confirmOwnerReschedule(owner, business.id, id, db);
const recover = (id: string) => readOwnerRescheduleProposal(owner, business.id, id, db);
async function policy(patch: object) {
  await db.collection('serverSettings').doc(bookingDataPolicyKey(business.id)).set({ version: 1, revision: 1, businessId: business.id, dataMode: 'general', representedMinorsEnabled: false, reason: 'Clasificación sintética', updatedAt: now, updatedBy: owner.uid, ...patch });
}
async function immutableSnapshots() { return [(await businessRef().get()).data(), (await db.collection('publicBusinesses').doc(business.slug).get()).data()]; }

beforeEach(async () => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(now); db = memoryFirestore().db; await seedOwnerRescheduleScenario(db); });
afterEach(() => vi.useRealTimers());

describe('owner authority and source scope', () => {
  it('ownerCannotBeReplacedByClientSuperadminOrResource', async () => {
    for (const uid of ['demo-client', 'demo-superadmin', 'demo-chair']) {
      await expect(readOwnerRescheduleSource({ uid }, business.id, original.id, db)).rejects.toMatchObject({ status: 403 });
      await expect(prepareOwnerReschedule({ uid }, business.id, original.id, await command(), db)).rejects.toMatchObject({ status: 403 });
    }
  });
  it('wrongTenantOrActorCannotReadReceipt', async () => {
    const { proposal } = await prepare();
    await expect(readOwnerRescheduleProposal({ uid: 'demo-client' }, business.id, proposal.id, db)).rejects.toMatchObject({ status: 403 });
    await setSource({ tenantId: 'demo-other' });
    await expect(recover(proposal.id)).rejects.toMatchObject({ status: 503 });
  });
  it('generalLegacyAndSelfAreEligible', async () => {
    expect(await read()).toMatchObject({ eligible: true, reason: null, expectation: { sourceRevision: 0 } });
    await setSource({ beneficiary: { kind: 'self' } });
    expect(await read()).toMatchObject({ eligible: true });
  });
  it('healthMinorFlagSensitiveAuthorizationAndRepresentationAreClosed', async () => {
    for (const patch of [{ dataMode: 'health' }, { representedMinorsEnabled: true }]) {
      await policy(patch); expect(await read()).toMatchObject({ eligible: false, reason: 'restricted_policy' });
      await expect(prepare()).rejects.toMatchObject({ status: 409, code: 'OWNER_RESCHEDULE_UNSUPPORTED' });
    }
    await policy({});
    for (const patch of [{ beneficiary: { kind: 'represented_minor', displayName: 'Persona sintética', representativeRole: 'parent' } }, { subjectAuthorization: {} }, { representationReview: {} }]) {
      await setSource(patch); expect(await read()).toMatchObject({ eligible: false, reason: 'restricted_policy' });
    }
  });
  it('malformedPolicyDoesNotDefaultToGeneral', async () => { await policy({ revision: 'bad' }); await expect(read()).rejects.toMatchObject({ status: 503 }); });
  it('historicalReadDoesNotRequirePlanOrConsent', async () => {
    await setBusiness({ subscription: { status: 'suspended', currentPeriodEndsAt: 0, trialEndsAt: 0 } });
    const status = await readConsent(owner.uid, 'account', undefined, db);
    await updateConsent(owner, { scope: 'account', action: 'revoke', requestId: 'demo-revoke', expectedRevision: status.revision }, db);
    expect(await read()).toMatchObject({ eligible: false, reason: 'subscription_unavailable' });
  });
  it('newMoveNeedsOwnerConsentAndRescheduleSubscription', async () => {
    for (const status of ['suspended', 'past_due'] as const) {
      await setBusiness({ subscription: { status, currentPeriodEndsAt: 0, trialEndsAt: 0 } }); await expect(prepare()).rejects.toMatchObject({ status: 402 });
    }
    await setBusiness({});
    const status = await readConsent(owner.uid, 'account', undefined, db);
    await updateConsent(owner, { scope: 'account', action: 'revoke', requestId: 'demo-revoke', expectedRevision: status.revision }, db);
    await expect(prepare()).rejects.toMatchObject({ status: 428 });
  });
  it.each([0, 10])('paidTrialAndExhaustedTrialRemainEligible (%i used)', async appointmentsUsed => {
    await setBusiness({ subscription: { ...business.subscription, status: 'trial', currentPeriodEndsAt: 0, paidTrial: { ...business.subscription.paidTrial!, appointmentsUsed } } });
    expect(await read()).toMatchObject({ eligible: true }); await prepare();
  });
  it('blockedClientDoesNotGrantOrRemoveOwnerAuthority', async () => {
    await businessRef().collection('clientPolicies').doc(clientPolicyKey('demo-client')).set({ version: 1, blocked: true, futureAppointmentLimit: null, reason: 'Prueba', updatedBy: owner.uid, updatedAt: now });
    const { proposal } = await prepare(); expect((await confirm(proposal.id)).appointment.startTimeStr).toBe('10:00');
  });
});

describe('review and idempotent preparation', () => {
  it('preparationDoesNotMoveHoldOrConsumeQuota', async () => {
    const snapshots = await immutableSnapshots(), { proposal } = await prepare();
    expect((await sourceRef().get()).data()).toEqual(original); expect(await immutableSnapshots()).toEqual(snapshots);
    expect((await businessRef().collection('bookingLocks').get()).size).toBe(0);
    expect((await readOwnerRescheduleAvailability(owner, business.id, original.id, { ...(await read()).expectation, dateKey: selection.dateKey, resourceId: selection.resourceId }, db))[0].slots).toContain('10:00');
    const saved = (await businessRef().collection('ownerRescheduleProposals').doc(proposal.id).get()).data()!;
    for (const key of ['client', 'beneficiary', 'intakeAnswers', 'appointment', 'intakeFields']) expect(saved).not.toHaveProperty(key);
    expect(JSON.stringify(saved)).not.toMatch(/demo@example|573001234567|Respuesta sintética|historicalMetadata/);
    expect(saved).toHaveProperty('actorUid', 'demo-owner'); expect(proposal).not.toHaveProperty('actorUid');
  });
  it('sameCommandKeepsProposalIdAndExpiry', async () => {
    const input = await command(), first = await prepareOwnerReschedule(owner, business.id, original.id, input, db);
    vi.setSystemTime(now + 900000);
    const second = await prepareOwnerReschedule(owner, business.id, original.id, input, db);
    expect(second).toEqual({ proposal: first.proposal, replayed: true }); expect(first.proposal.expiresAt).toBe(now + 600000);
  });
  it('requestReuseWithChangedTargetFails', async () => {
    await prepare(); await expect(prepare('demo-request', { ...selection, startTimeStr: '11:00' })).rejects.toMatchObject({ status: 409, code: 'OWNER_RESCHEDULE_REQUEST_REUSED' });
  });
  it('freshServiceSameIdDefinesReviewedTarget', async () => {
    await setBusiness({ services: [{ ...business.services[0], durationMinutes: 45, bufferMinutes: 10, price: 30000 }] });
    expect((await prepare()).proposal).toMatchObject({ source: { priceCOP: 20000, endTimeStr: '09:30' }, target: { serviceId: 'demo-cut', durationMinutes: 45, bufferMinutes: 10, priceCOP: 30000, endTimeStr: '10:45' } });
  });
  it('removedOriginResourceCanMoveToActiveTarget', async () => {
    await setBusiness({ resources: [business.resources[1]] });
    const { proposal } = await prepare('demo-removed', { ...selection, resourceId: 'demo-second' });
    expect(proposal.source.resourceName).toBe('Recurso anterior no disponible');
    expect((await confirm(proposal.id)).appointment.resourceId).toBe('demo-second');
  });
  it('inactiveOrUnassignedTargetAndRemovedServiceFail', async () => {
    await setBusiness({ resources: business.resources.map(resource => ({ ...resource, active: false })) }); await expect(prepare()).rejects.toMatchObject({ status: 400 });
    await setBusiness({ services: [{ ...business.services[0], resourceIds: ['demo-second'] }] }); await expect(prepare()).rejects.toMatchObject({ status: 400 });
    await setBusiness({ services: [] }); expect(await read()).toMatchObject({ eligible: false, reason: 'service_unavailable' }); await expect(prepare()).rejects.toMatchObject({ status: 409 });
  });
});

describe('atomic move and stale reviews', () => {
  it('sameIdSameClientAndMetadataSurviveMove', async () => {
    const snapshots = await immutableSnapshots(), { proposal } = await prepare(), applied = await confirm(proposal.id);
    expect(applied.appointment).toMatchObject({ id: 'demo-source', rescheduleRevision: 1, serviceId: 'demo-cut', serviceName: 'Corte actual', price: 25000, client: original.client, historicalMetadata: { imported: true }, createdAt: original.createdAt, createdBy: original.createdBy });
    expect(applied.rescheduleResult).toMatchObject({ proposalId: proposal.id, revision: 1, startAt: 1894028400000, endAt: 1894030200000 });
    expect(await immutableSnapshots()).toEqual(snapshots); expect((await businessRef().collection('appointments').get()).size).toBe(1);
    await confirm(proposal.id); expect(await immutableSnapshots()).toEqual(snapshots);
    expect((await db.collection('publicBusinesses').doc(business.slug).get()).data()).toEqual(publicBusiness(business));
  });
  it('originDestinationAndClientLocksAreDeduplicated', async () => {
    const { proposal } = await prepare(); await confirm(proposal.id);
    const locks = await businessRef().collection('bookingLocks').get(); expect(locks.size).toBe(2);
    expect((await businessRef().collection('bookingLocks').doc('2030-01-07_demo-chair').get()).data()).toMatchObject({ version: 1 });
    expect((await businessRef().collection('bookingLocks').doc(`client_${clientPolicyKey('demo-client')}`).get()).data()).toMatchObject({ version: 1 });
  });
  it('clientlessSourceDoesNotInventClientLock', async () => {
    const { client: _client, ...source } = original; await sourceRef().set(source);
    const { proposal } = await prepare(); await confirm(proposal.id); expect((await businessRef().collection('bookingLocks').get()).size).toBe(1);
  });
  it.each(['', null, 3, 'demo-client\n', 'demo\u0000client', 'demo\u007fclient'])('presentCorruptClientUidNeverSkipsOrChangesClientLock (%j)', async uid => {
    await setSource({ client: { ...original.client, uid } }); await expect(read()).rejects.toMatchObject({ status: 503 });
    expect((await businessRef().collection('bookingLocks').get()).size).toBe(0);
  });
  it('sourceFingerprintChangeRejectsEvenAtSameRevision', async () => {
    const { proposal } = await prepare(); await setSource({ historicalMetadata: { imported: false } });
    await expect(confirm(proposal.id)).rejects.toMatchObject({ status: 409, code: 'OWNER_RESCHEDULE_SOURCE_CHANGED' }); expect((await sourceRef().get()).data()?.startTimeStr).toBe('09:00');
  });
  it('catalogChangeRejectsReviewedProposal', async () => {
    const { proposal } = await prepare(); await setBusiness({ services: [{ ...business.services[0], price: 26000 }] });
    await expect(confirm(proposal.id)).rejects.toMatchObject({ status: 409, code: 'OWNER_RESCHEDULE_CATALOG_CHANGED' });
  });
  it('resourceScheduleChangeRejectsEvenIfTargetStillFits', async () => {
    const { proposal } = await prepare();
    await businessRef().collection('resourceSchedulePolicies').doc('current').set({ ...emptyResourceSchedulePolicy(business.id), revision: 1, updatedAt: now });
    await expect(confirm(proposal.id)).rejects.toMatchObject({ status: 409, code: 'OWNER_RESCHEDULE_SCHEDULE_CHANGED' });
  });
  it('outsideScheduleAndBufferConflictCannotOverride', async () => {
    await expect(prepare('demo-outside', { ...selection, startTimeStr: '17:00' })).rejects.toMatchObject({ status: 409 });
    const { proposal } = await prepare(); await businessRef().collection('appointments').doc('demo-conflict').set({ ...original, id: 'demo-conflict', startTimeStr: '10:30', endTimeStr: '11:00', startAt: 1894030200000, endAt: 1894032000000, reservedUntilAt: 1894032000000 });
    await expect(confirm(proposal.id)).rejects.toMatchObject({ status: 409 }); expect((await sourceRef().get()).data()).toEqual(original);
  });
  it('sourceOrTargetStartedDuringTransactionFails', async () => {
    vi.setSystemTime(original.startAt - 300000);
    const { proposal } = await prepare(); vi.setSystemTime(original.startAt); expect(await read()).toMatchObject({ reason: 'source_started' });
    await expect(confirm(proposal.id)).rejects.toMatchObject({ status: 409, code: 'OWNER_RESCHEDULE_SOURCE_STARTED' });
    await setSource({ startTimeStr: '11:00', endTimeStr: '11:30', startAt: 1894032000000, endAt: 1894033800000, reservedUntilAt: 1894034700000 });
    vi.setSystemTime(1894028100000); // 09:55 Colombia: source 11:00, target 10:00.
    const target = await prepare('demo-target-started'); vi.setSystemTime(1894028460000);
    await expect(confirm(target.proposal.id)).rejects.toMatchObject({ status: 409 });
  });
  it('maxRevisionAndCorruptLockFailClosed', async () => {
    await setSource({ rescheduleRevision: Number.MAX_SAFE_INTEGER - 1 }); await expect(prepare()).rejects.toMatchObject({ status: 503 });
    await setSource({}); const { proposal } = await prepare();
    for (const version of ['0', -1, Number.MAX_SAFE_INTEGER, null]) {
      await businessRef().collection('bookingLocks').doc('2030-01-07_demo-chair').set({ version }); await expect(confirm(proposal.id)).rejects.toMatchObject({ status: 503 });
    }
    expect((await sourceRef().get()).data()).toEqual(original);
  });
  it('invalidConfirmedAttendanceHeadFailsWithoutReset', async () => { await setSource({ attendance: { revision: 1, lastEventId: 'demo-missing' } }); await expect(read()).rejects.toMatchObject({ status: 503 }); expect((await sourceRef().get()).data()).toHaveProperty('attendance'); });
});

describe('durable receipts and expiry', () => {
  it('appliedReplayReturnsOriginalProofAndCurrentAppointment', async () => {
    const { proposal } = await prepare(), first = await confirm(proposal.id), replay = await confirm(proposal.id);
    expect(replay).toEqual({ ...first, replayed: true }); expect(await recover(proposal.id)).toMatchObject({ state: 'applied', result: first.rescheduleResult });
  });
  it('replayAfterLaterMoveOrCancellationDoesNotMoveBack', async () => {
    const first = await prepare(), applied = await confirm(first.proposal.id), second = await prepare('demo-second-request', { ...selection, startTimeStr: '11:00' });
    await confirm(second.proposal.id); const replay = await confirm(first.proposal.id);
    expect(replay.appointment).toMatchObject({ startTimeStr: '11:00', rescheduleRevision: 2 }); expect(replay.rescheduleResult).toEqual(applied.rescheduleResult);
    await sourceRef().set({ ...(await sourceRef().get()).data(), status: 'cancelled_by_owner' });
    expect((await recover(first.proposal.id)).appointment.status).toBe('cancelled_by_owner');
  });
  it('ownerTransferRevokesOldActorRecovery', async () => {
    const { proposal } = await prepare(); await setBusiness({ ownerUid: 'demo-new-owner' });
    await expect(recover(proposal.id)).rejects.toMatchObject({ status: 403 });
    await expect(readOwnerRescheduleProposal({ uid: 'demo-new-owner' }, business.id, proposal.id, db)).rejects.toMatchObject({ status: 403 });
  });
  it('replayCanBeReadAfterPlanExpiryOrConsentWithdrawal', async () => {
    const { proposal } = await prepare(); await confirm(proposal.id); await setBusiness({ subscription: { status: 'suspended', trialEndsAt: 0, currentPeriodEndsAt: 0 } });
    const status = await readConsent(owner.uid, 'account', undefined, db); await updateConsent(owner, { scope: 'account', action: 'revoke', requestId: 'demo-revoke', expectedRevision: status.revision }, db);
    expect(await confirm(proposal.id)).toMatchObject({ replayed: true }); expect(await recover(proposal.id)).toMatchObject({ state: 'applied' });
  });
  it('expiryClosesProposalWithoutMovingSource', async () => {
    const { proposal } = await prepare(); vi.setSystemTime(now + 600000);
    await expect(confirm(proposal.id)).rejects.toMatchObject({ status: 409, code: 'OWNER_RESCHEDULE_PROPOSAL_CLOSED' });
    expect(await recover(proposal.id)).toMatchObject({ state: 'closed', result: null }); expect((await sourceRef().get()).data()).toEqual(original);
    expect((await businessRef().collection('bookingLocks').get()).size).toBe(0);
  });
  it('expiryClosureConflictsWithOlderConfirmation', async () => {
    const { proposal } = await prepare(); vi.setSystemTime(now + 600000);
    await Promise.allSettled([confirm(proposal.id), confirm(proposal.id)]);
    expect(await recover(proposal.id)).toMatchObject({ state: 'closed', result: null }); expect((await sourceRef().get()).data()).toEqual(original);
  });
  it('recoveryGetNeverClosesOrConfirms', async () => {
    const { proposal } = await prepare(); const before = (await businessRef().collection('ownerRescheduleProposals').doc(proposal.id).get()).data();
    vi.setSystemTime(now + 900000); expect(await recover(proposal.id)).toMatchObject({ state: 'prepared', result: null });
    expect((await businessRef().collection('ownerRescheduleProposals').doc(proposal.id).get()).data()).toEqual(before);
  });
});
