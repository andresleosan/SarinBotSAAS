import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import * as domain from '@/lib/server/business-team';
import { stableDocumentId } from '@/lib/server/businesses';
import { bookingDataPolicyKey } from '@/lib/server/booking-data-policy';
import { consentStateKey } from '@/lib/server/consent';
import { acceptSyntheticConsent } from './consent-fixtures';
import { memoryFirestore } from './memoryFirestore';
import { teamFixture, teamNow } from './business-team-contract';
import type { Database, Transaction } from '@/lib/storage/types';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const statePath = (id: string) => `serverSettings/business_team_${hash(id)}`;
const memberId = (businessId: string, uid: string) => stableDocumentId('business-team', businessId, uid);
const entries = (memory: ReturnType<typeof memoryFirestore>) => structuredClone([...memory.rows]);
async function setup() { const memory = memoryFirestore(); return { ...memory, ...await teamFixture(memory.db) }; }
async function requested(f: Awaited<ReturnType<typeof setup>>) { return domain.requestTeamAccess(f.member, f.request, f.db); }
async function approved(f: Awaited<ReturnType<typeof setup>>) {
  const request = await requested(f);
  const command = { action: 'approve' as const, requestId: 'demo-approve-000', expectedMembershipRevision: 1, expectedTeamRevision: 1, resourceId: 'demo-chair' };
  return { result: await domain.decideTeamAccess(f.owner, f.business.id, request.current.membershipId, command, f.db), command };
}
describe('transactional business team', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(teamNow); vi.stubEnv('SARIN_TEAM_ACCESS_ENABLED', 'true'); });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });
  it('receiptAndMembershipAndCountersCommitTogether', async () => {
    const f = await setup(), before = entries(f), result = await requested(f);
    expect(result).toMatchObject({ audience: 'member', replayed: false, teamRevision: 1, current: { status: 'requested', revision: 1, role: null, resourceId: null } });
    expect(f.rows.get(statePath(f.business.id))?.data).toMatchObject({ revision: 1, requestedCount: 1, activeCount: 0 });
    expect(f.rows.get(`businessMemberships/${result.current.membershipId}`)?.data).toMatchObject({ memberUid: f.member.uid, lastRequestedAt: teamNow });
    expect(f.rows.get(`businesses/${f.business.id}/teamAccessEvents/${result.applied.eventId}`)?.data).toMatchObject({ actorUid: f.member.uid, sequence: 1, command: { kind: 'request' } });
    expect([...f.rows.keys()].filter(path => !before.some(([old]) => old === path))).toHaveLength(4);
    const saved = entries(f); expect(await requested(f)).toMatchObject({ replayed: true, applied: result.applied }); expect(entries(f)).toEqual(saved);
  });
  it('allTransitionsAndNewRequestIdsAgainstSameStateReturnNoChange', async () => {
    const f = await setup(); const first = await requested(f), id = first.current.membershipId;
    await expect(domain.requestTeamAccess(f.member, { ...f.request, requestId: 'demo-new-request', expectedMembershipRevision: 1 }, f.db)).rejects.toMatchObject({ status: 409, code: 'TEAM_NO_CHANGE' });
    await expect(domain.decideTeamAccess(f.owner, f.business.id, id, { action: 'revoke', requestId: 'demo-invalid-revoke', expectedMembershipRevision: 1, expectedTeamRevision: 1 }, f.db)).rejects.toMatchObject({ code: 'TEAM_NO_CHANGE' });
    await domain.decideTeamAccess(f.owner, f.business.id, id, { action: 'reject', requestId: 'demo-reject-000', expectedMembershipRevision: 1, expectedTeamRevision: 1 }, f.db);
    expect(f.rows.get(statePath(f.business.id))?.data).toMatchObject({ revision: 2, requestedCount: 0, activeCount: 0 });
    vi.setSystemTime(teamNow + 86400000);
    const again = await domain.requestTeamAccess(f.member, { ...f.request, requestId: 'demo-rerequest-000', expectedMembershipRevision: 2 }, f.db);
    expect(again.current).toMatchObject({ status: 'requested', revision: 3, role: null, resourceId: null });
    await domain.leaveTeamAccess(f.member, id, { requestId: 'demo-leave-000', expectedMembershipRevision: 3 }, f.db);
    expect(f.rows.get(`businessMemberships/${id}`)?.data).toMatchObject({ createdAt: teamNow, lastRequestedAt: teamNow + 86400000, status: 'revoked' });
  });
  it('ownerUidAndBusinessAlwaysRevalidated', async () => {
    const f = await setup(); await approved(f); const id = memberId(f.business.id, f.member.uid);
    await f.db.collection('businesses').doc(f.business.id).set({ ...f.business, ownerUid: 'demo-new-owner' });
    await expect(domain.readOwnerBusinessTeam(f.owner, f.business.id, undefined, f.db)).rejects.toMatchObject({ status: 403 });
    await expect(domain.decideTeamAccess(f.owner, f.business.id, id, { action: 'approve', requestId: 'demo-approve-000', expectedMembershipRevision: 1, expectedTeamRevision: 1, resourceId: 'demo-chair' }, f.db)).rejects.toMatchObject({ status: 403 });
    await expect(domain.requestTeamAccess(f.member, f.request, f.db)).rejects.toMatchObject({ status: 503 });
  });
  it('requestCannotAssignRoleResourceOrOtherUid', async () => {
    const f = await setup(); for (const field of ['memberUid', 'resourceId', 'role']) await expect(domain.requestTeamAccess(f.member, { ...f.request, [field]: 'demo-other' }, f.db)).rejects.toBeDefined();
    expect([...f.rows.keys()].some(path => path.startsWith('businessMemberships/'))).toBe(false);
    await expect(domain.requestTeamAccess(f.owner, f.request, f.db)).rejects.toMatchObject({ status: 409, code: 'TEAM_ALREADY_OWNER' });
  });
  it('memberCannotApproveSelf', async () => {
    const f = await setup(), request = await requested(f);
    await expect(domain.decideTeamAccess(f.member, f.business.id, request.current.membershipId, { action: 'approve', requestId: 'demo-self-approve', expectedMembershipRevision: 1, expectedTeamRevision: 1, resourceId: 'demo-chair' }, f.db)).rejects.toMatchObject({ status: 403 });
    await expect(domain.leaveTeamAccess({ uid: 'demo-other' }, request.current.membershipId, { requestId: 'demo-stolen-leave', expectedMembershipRevision: 1 }, f.db)).rejects.toMatchObject({ status: 403 });
  });
  it('sameIdOtherCommand409IncludingAnotherMembershipWithIdenticalHash', async () => {
    const f = await setup(); await approved(f);
    await expect(domain.requestTeamAccess(f.member, { ...f.request, expectedMembershipRevision: 1 }, f.db)).rejects.toMatchObject({ status: 409, code: 'TEAM_REQUEST_REUSED' });
    const other = { uid: 'demo-other' }; await acceptSyntheticConsent(f.db, other.uid);
    const request = await domain.requestTeamAccess(other, { ...f.request, requestId: 'demo-request-other' }, f.db);
    await expect(domain.decideTeamAccess(f.owner, f.business.id, request.current.membershipId, { action: 'approve', requestId: 'demo-approve-000', expectedMembershipRevision: 1, expectedTeamRevision: 1, resourceId: 'demo-chair' }, f.db)).rejects.toMatchObject({ status: 409, code: 'TEAM_REQUEST_REUSED' });
  });
  it('replayAfterRevocationStaysRevoked', async () => {
    const f = await setup(), { command, result } = await approved(f), id = result.current.membershipId;
    await domain.decideTeamAccess(f.owner, f.business.id, id, { action: 'revoke', requestId: 'demo-revoke-000', expectedMembershipRevision: 2, expectedTeamRevision: 2 }, f.db);
    vi.stubEnv('SARIN_TEAM_ACCESS_ENABLED', 'false'); await f.db.collection('businesses').doc(f.business.id).set({ ...f.business, subscription: { ...f.business.subscription, status: 'suspended' } });
    expect(await domain.decideTeamAccess(f.owner, f.business.id, id, command, f.db)).toMatchObject({ replayed: true, applied: result.applied, current: { status: 'revoked', revision: 3 } });
    expect(await requested(f)).toMatchObject({ replayed: true, current: { status: 'revoked' } });
    expect((await domain.readOwnTeamMemberships(f.member, { businessSlug: f.business.slug, requestId: f.request.requestId }, f.db)).applied?.membershipRevision).toBe(1);
  });
  it('requestApproveRevokeThenRerequestBefore24hIsLimited', async () => {
    const f = await setup(), { result } = await approved(f), id = result.current.membershipId;
    vi.setSystemTime(teamNow + 1000); await domain.leaveTeamAccess(f.member, id, { requestId: 'demo-leave-000', expectedMembershipRevision: 2 }, f.db);
    const before = entries(f); vi.setSystemTime(teamNow + 86400000 - 1);
    await expect(domain.requestTeamAccess(f.member, { ...f.request, requestId: 'demo-rerequest-000', expectedMembershipRevision: 3 }, f.db)).rejects.toMatchObject({ status: 429, retryAfterSeconds: 1 }); expect(entries(f)).toEqual(before);
    vi.setSystemTime(teamNow + 86400000); expect(await domain.requestTeamAccess(f.member, { ...f.request, requestId: 'demo-rerequest-000', expectedMembershipRevision: 3 }, f.db)).toMatchObject({ current: { status: 'requested', revision: 4, role: null, resourceId: null } });
    expect(f.rows.get(statePath(f.business.id))?.data.requestEvents).toHaveLength(1);
  });
  it('missingStateWithExistingMemberFails503', async () => {
    const f = await setup(); await requested(f); f.rows.delete(statePath(f.business.id));
    await expect(domain.readOwnerBusinessTeam(f.owner, f.business.id, undefined, f.db)).rejects.toMatchObject({ status: 503 });
    await expect(requested(f)).rejects.toMatchObject({ status: 503 });
  });
  it('corruptCounterHeadOrFutureRateEventFailsClosed', async () => {
    for (const corrupt of ['zero', 'head', 'future', 'operator', 'hash', 'sequence', 'revision']) {
      const f = await setup(), result = await requested(f), state = f.rows.get(statePath(f.business.id))!.data;
      const event = f.rows.get(`businesses/${f.business.id}/teamAccessEvents/${result.applied.eventId}`)!.data;
      if (corrupt === 'zero') state.requestedCount = 0;
      if (corrupt === 'head') event.resourceId = 'demo-chair';
      if (corrupt === 'future') state.requestEvents = [{ at: teamNow + 1, requestHash: 'a'.repeat(64) }];
      if (corrupt === 'operator') event.actorUid = 'demo-other';
      if (corrupt === 'hash') event.commandHash = 'b'.repeat(64);
      if (corrupt === 'sequence') event.sequence = 2;
      if (corrupt === 'revision') state.revision = 0;
      await expect(requested(f), corrupt).rejects.toMatchObject({ status: 503 });
    }
  });
  it('gatePolicyConsentPlanAndResourceEnforcedWhileExitRemainsAvailable', async () => {
    for (const mode of ['gate', 'policy', 'consent', 'plan']) {
      const f = await setup();
      if (mode === 'gate') vi.stubEnv('SARIN_TEAM_ACCESS_ENABLED', 'false');
      if (mode === 'policy') f.rows.get(`serverSettings/${bookingDataPolicyKey(f.business.id)}`)!.data.dataMode = 'health';
      if (mode === 'consent') f.rows.get(`serverSettings/${consentStateKey(f.member.uid, 'account')}`)!.data.active = false;
      if (mode === 'plan') await f.db.collection('businesses').doc(f.business.id).set({ ...f.business, subscription: { ...f.business.subscription, status: 'suspended' } });
      await expect(requested(f)).rejects.toBeDefined(); vi.stubEnv('SARIN_TEAM_ACCESS_ENABLED', 'true');
    }
    const f = await setup(), result = await requested(f);
    await f.db.collection('businesses').doc(f.business.id).set({ ...f.business, resources: [{ ...f.business.resources[0], active: false }] });
    await expect(domain.decideTeamAccess(f.owner, f.business.id, result.current.membershipId, { action: 'approve', requestId: 'demo-inactive-resource', expectedMembershipRevision: 1, expectedTeamRevision: 1, resourceId: 'demo-chair' }, f.db)).rejects.toMatchObject({ status: 409 });
    vi.stubEnv('SARIN_TEAM_ACCESS_ENABLED', 'false'); f.rows.get(`serverSettings/${consentStateKey(f.member.uid, 'account')}`)!.data.active = false;
    expect(await domain.leaveTeamAccess(f.member, result.current.membershipId, { requestId: 'demo-leave-disabled', expectedMembershipRevision: 1 }, f.db)).toMatchObject({ current: { status: 'revoked' } });
  });
  it('requestBySlugDoesNotEnumerateAccountsAndOwnerEventsAreMinimal', async () => {
    const f = await setup(); await approved(f);
    const unknown = await domain.readOwnTeamMemberships({ uid: 'demo-other' }, { businessSlug: f.business.slug }, f.db);
    expect(unknown).toMatchObject({ mode: 'business', items: [], target: { businessId: f.business.id, businessName: 'Demo team' } });
    const own = await domain.readOwnTeamMemberships(f.member, {}, f.db); expect(own.items).toHaveLength(1); expect(own.items[0]).not.toHaveProperty('memberUid');
    const roster = await domain.readOwnerBusinessTeam(f.owner, f.business.id, 'demo-approve-000', f.db);
    expect(roster).toMatchObject({ teamRevision: 2, requested: [], active: [{ memberUid: f.member.uid }], applied: { membershipRevision: 2 } });
    expect(roster.events.map(e => e.sequence)).toEqual([2, 1]); expect(roster.events[0]).not.toHaveProperty('commandHash'); expect(roster.events[0]).not.toHaveProperty('command');
  });
  it('pendingLimitThirtyAndOwnerRosterDetectsCounterDrift', async () => {
    const f = await setup();
    for (let i = 0; i < 30; i++) {
      const actor = { uid: `demo-pending-${i}` }; await acceptSyntheticConsent(f.db, actor.uid);
      await domain.requestTeamAccess(actor, { ...f.request, requestId: `demo-pending-request-${i}` }, f.db);
    }
    const other = { uid: 'demo-pending-overflow' }; await acceptSyntheticConsent(f.db, other.uid); const before = entries(f);
    await expect(domain.requestTeamAccess(other, { ...f.request, requestId: 'demo-pending-overflow' }, f.db)).rejects.toMatchObject({ status: 409, code: 'TEAM_CAPACITY' }); expect(entries(f)).toEqual(before);
    const roster = await domain.readOwnerBusinessTeam(f.owner, f.business.id, undefined, f.db);
    expect(roster.requested).toHaveLength(30); expect(roster.events.map(e => e.sequence)).toEqual(Array.from({ length: 20 }, (_, i) => 30 - i));
    f.rows.get(statePath(f.business.id))!.data.requestedCount = 29;
    await expect(domain.readOwnerBusinessTeam(f.owner, f.business.id, undefined, f.db)).rejects.toMatchObject({ status: 503 });
  });
  it('twoApprovalsRespectThirtyActive', async () => {
    const f = await setup(); let teamRevision = 0;
    for (let i = 0; i < 29; i++) {
      const actor = { uid: `demo-active-${i}` }; await acceptSyntheticConsent(f.db, actor.uid);
      const request = await domain.requestTeamAccess(actor, { ...f.request, requestId: `demo-active-request-${i}` }, f.db); teamRevision++;
      await domain.decideTeamAccess(f.owner, f.business.id, request.current.membershipId, { action: 'approve', requestId: `demo-active-approve-${i}`, expectedMembershipRevision: 1, expectedTeamRevision: teamRevision, resourceId: 'demo-chair' }, f.db); teamRevision++;
    }
    vi.setSystemTime(teamNow + 86400000);
    const targets: string[] = [];
    for (let i = 0; i < 2; i++) {
      const actor = { uid: `demo-racing-${i}` }; await acceptSyntheticConsent(f.db, actor.uid);
      const request = await domain.requestTeamAccess(actor, { ...f.request, requestId: `demo-racing-request-${i}` }, f.db); targets.push(request.current.membershipId); teamRevision++;
    }
    const decisions = targets.map((id, i) => domain.decideTeamAccess(f.owner, f.business.id, id, { action: 'approve', requestId: `demo-racing-approve-${i}`, expectedMembershipRevision: 1, expectedTeamRevision: teamRevision, resourceId: 'demo-chair' }, f.db));
    const results = await Promise.allSettled(decisions); expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    const losingIndex = results.findIndex(r => r.status === 'rejected');
    expect((results[losingIndex] as PromiseRejectedResult).reason).toMatchObject({ status: 409 });
    await expect(domain.decideTeamAccess(f.owner, f.business.id, targets[losingIndex], { action: 'approve', requestId: `demo-racing-approve-${losingIndex}`, expectedMembershipRevision: 1, expectedTeamRevision: teamRevision + 1, resourceId: 'demo-chair' }, f.db)).rejects.toMatchObject({ status: 409, code: 'TEAM_CAPACITY' });
    expect(f.rows.get(statePath(f.business.id))?.data).toMatchObject({ requestedCount: 1, activeCount: 30 });
  });
  it('uidAndBusinessAdmissionLimitsHaveExact24HourBoundary', async () => {
    const f = await setup();
    for (let i = 0; i < 5; i++) { const fixture = await teamFixture(f.db, `demo-rate-${i}`); await domain.requestTeamAccess(f.member, fixture.request, f.db); }
    const before = entries(f);
    await expect(requested(f)).rejects.toMatchObject({ status: 429, retryAfterSeconds: 86400 }); expect(entries(f)).toEqual(before);
    vi.setSystemTime(teamNow + 86400000); expect(await requested(f)).toMatchObject({ current: { status: 'requested' } });
    const g = await setup();
    for (let i = 0; i < 30; i++) {
      const actor = { uid: `demo-business-rate-${i}` }; await acceptSyntheticConsent(g.db, actor.uid);
      const request = await domain.requestTeamAccess(actor, { ...g.request, requestId: `demo-business-request-${i}` }, g.db);
      await domain.decideTeamAccess(g.owner, g.business.id, request.current.membershipId, { action: 'reject', requestId: `demo-business-reject-${i}`, expectedMembershipRevision: 1, expectedTeamRevision: 2 * i + 1 }, g.db);
    }
    const saved = entries(g); await expect(requested(g)).rejects.toMatchObject({ status: 429, retryAfterSeconds: 86400 }); expect(entries(g)).toEqual(saved);
    vi.setSystemTime(teamNow + 2 * 86400000); expect(await requested(g)).toMatchObject({ current: { status: 'requested' } });
  });
  it('atomicRollbackAndLostCommitResponseDoNotDuplicateReceipt', async () => {
    const f = await setup(), before = entries(f);
    const failing: Database = { collection: f.db.collection.bind(f.db), runTransaction: handler => f.db.runTransaction(async tx => { await handler(tx); throw new Error('synthetic-before-commit'); }) };
    await expect(domain.requestTeamAccess(f.member, f.request, failing)).rejects.toThrow('synthetic-before-commit'); expect(entries(f)).toEqual(before);
    let lose = true;
    const lost: Database = { collection: f.db.collection.bind(f.db), runTransaction: async handler => { const response = await f.db.runTransaction(handler); if (lose) { lose = false; throw new Error('synthetic-lost-response'); } return response; } };
    await expect(domain.requestTeamAccess(f.member, f.request, lost)).rejects.toThrow('synthetic-lost-response');
    const committed = entries(f); expect(await domain.requestTeamAccess(f.member, f.request, lost)).toMatchObject({ replayed: true, current: { revision: 1 } }); expect(entries(f)).toEqual(committed);
  });
  it('allReadsPrecedeWritesAndExitNeverConsultsUidAdmission', async () => {
    const f = await setup();
    const strict: Database = { collection: f.db.collection.bind(f.db), runTransaction: handler => f.db.runTransaction(async (tx: Transaction) => {
      let wrote = false;
      const wrapped = { get: async (target: Parameters<Transaction['get']>[0]) => { if (wrote) throw new Error('read-after-write'); return tx.get(target); },
        set: (...args: Parameters<Transaction['set']>) => { wrote = true; return tx.set(...args); },
        create: (...args: Parameters<Transaction['create']>) => { wrote = true; return tx.create(...args); },
        delete: (...args: Parameters<Transaction['delete']>) => { wrote = true; return tx.delete(...args); } } as unknown as Transaction;
      return handler(wrapped);
    }) };
    const request = await domain.requestTeamAccess(f.member, f.request, strict);
    await domain.decideTeamAccess(f.owner, f.business.id, request.current.membershipId, { action: 'approve', requestId: 'demo-strict-approve', expectedMembershipRevision: 1, expectedTeamRevision: 1, resourceId: 'demo-chair' }, strict);
    f.rows.get(`serverSettings/team_request_uid_${hash(f.member.uid)}`)!.data.requestEvents = [{ at: teamNow + 1000, requestHash: 'a'.repeat(64) }];
    expect(await domain.leaveTeamAccess(f.member, request.current.membershipId, { requestId: 'demo-strict-leave', expectedMembershipRevision: 2 }, strict)).toMatchObject({ current: { status: 'revoked' } });
  });
  it('ownPaginationUsesExactAccountAndBusinessOrderingWithLookahead', async () => {
    const f = await setup();
    for (let i = 0; i < 22; i++) {
      vi.setSystemTime(teamNow + Math.floor(i / 5) * 86400000);
      const fixture = await teamFixture(f.db, `demo-page-${String(i).padStart(2, '0')}`); await domain.requestTeamAccess(f.member, fixture.request, f.db);
    }
    const first = await domain.readOwnTeamMemberships(f.member, {}, f.db); expect(first.items).toHaveLength(20); expect(first.nextAfterBusinessId).toBe('demo-page-19');
    const second = await domain.readOwnTeamMemberships(f.member, { afterBusinessId: 'demo-page-19' }, f.db); expect(second.items.map(i => i.businessId)).toEqual(['demo-page-20', 'demo-page-21']); expect(second.nextAfterBusinessId).toBeNull();
    await expect(domain.readOwnTeamMemberships(f.member, { requestId: 'demo-request-000' }, f.db)).rejects.toBeDefined();
    expect((await domain.readOwnTeamMemberships({ uid: 'demo-other' }, {}, f.db)).items).toEqual([]);
  });
  it('revisionOverflowFails503BeforeAnyWrite', async () => {
    const f = await setup(), request = await requested(f); f.rows.get(statePath(f.business.id))!.data.revision = Number.MAX_SAFE_INTEGER - 1;
    const before = entries(f);
    await expect(domain.leaveTeamAccess(f.member, request.current.membershipId, { requestId: 'demo-overflow-leave', expectedMembershipRevision: 1 }, f.db)).rejects.toMatchObject({ status: 503 }); expect(entries(f)).toEqual(before);
  });
  it('ownerReceiptForInactiveMemberRequiresCurrentCanonicalHead', async () => {
    const f = await setup(), request = await requested(f), id = request.current.membershipId;
    await domain.decideTeamAccess(f.owner, f.business.id, id, { action: 'reject', requestId: 'demo-rejected-receipt', expectedMembershipRevision: 1, expectedTeamRevision: 1 }, f.db);
    f.rows.get(`businessMemberships/${id}`)!.data.lastEventId = 'demo-missing-head';
    await expect(domain.readOwnerBusinessTeam(f.owner, f.business.id, 'demo-rejected-receipt', f.db)).rejects.toMatchObject({ status: 503 });
  });
  it('ownerRecentEventHeadCannotOmitLatestCommittedMutation', async () => {
    const f = await setup(), request = await requested(f);
    const rejected = await domain.decideTeamAccess(f.owner, f.business.id, request.current.membershipId, { action: 'reject', requestId: 'demo-head-reject', expectedMembershipRevision: 1, expectedTeamRevision: 1 }, f.db);
    f.rows.delete(`businesses/${f.business.id}/teamAccessEvents/${rejected.applied.eventId}`);
    await expect(domain.readOwnerBusinessTeam(f.owner, f.business.id, undefined, f.db)).rejects.toMatchObject({ status: 503 });
  });
  it('ownerCanRejectRevokeAndReadWithoutGatePlanOrFreshConsent', async () => {
    for (const action of ['reject', 'revoke'] as const) {
      const f = await setup(); const request = action === 'reject' ? await requested(f) : (await approved(f)).result;
      const rev = action === 'reject' ? 1 : 2;
      vi.stubEnv('SARIN_TEAM_ACCESS_ENABLED', 'false');
      await f.db.collection('businesses').doc(f.business.id).set({ ...f.business, subscription: { ...f.business.subscription, status: 'suspended' } });
      f.rows.get(`serverSettings/${consentStateKey(f.owner.uid, 'account')}`)!.data.active = false;
      f.rows.get(`serverSettings/${bookingDataPolicyKey(f.business.id)}`)!.data.dataMode = 'health';
      expect(await domain.readOwnerBusinessTeam(f.owner, f.business.id, undefined, f.db)).toMatchObject({ enabled: false, eligible: false });
      expect(await domain.decideTeamAccess(f.owner, f.business.id, request.current.membershipId, { action, requestId: `demo-disabled-${action}`, expectedMembershipRevision: rev, expectedTeamRevision: rev }, f.db)).toMatchObject({ current: { status: action === 'reject' ? 'rejected' : 'revoked' } });
      vi.stubEnv('SARIN_TEAM_ACCESS_ENABLED', 'true');
    }
  });
  it('approvalRequiresBothCurrentConsentsAndRejectsCurrentOwnerTarget', async () => {
    for (const which of ['member', 'owner'] as const) {
      const f = await setup(), request = await requested(f);
      f.rows.get(`serverSettings/${consentStateKey(f[which].uid, 'account')}`)!.data.active = false;
      const before = entries(f);
      await expect(domain.decideTeamAccess(f.owner, f.business.id, request.current.membershipId, { action: 'approve', requestId: 'demo-consent-approve', expectedMembershipRevision: 1, expectedTeamRevision: 1, resourceId: 'demo-chair' }, f.db)).rejects.toMatchObject({ status: 428 }); expect(entries(f)).toEqual(before);
    }
    const f = await setup(), request = await requested(f);
    await f.db.collection('businesses').doc(f.business.id).set({ ...f.business, ownerUid: f.member.uid });
    await expect(domain.decideTeamAccess(f.member, f.business.id, request.current.membershipId, { action: 'approve', requestId: 'demo-became-owner', expectedMembershipRevision: 1, expectedTeamRevision: 1, resourceId: 'demo-chair' }, f.db)).rejects.toMatchObject({ status: 409, code: 'TEAM_ALREADY_OWNER' });
  });
  it('corruptUidRateStateAndCrossBusinessTargetFailWithoutWrites', async () => {
    const f = await setup();
    await f.db.collection('serverSettings').doc(`team_request_uid_${hash(f.member.uid)}`).set({ version: 1, uid: f.member.uid, requestEvents: [{ at: teamNow + 1, requestHash: 'a'.repeat(64) }] });
    const before = entries(f); await expect(requested(f)).rejects.toMatchObject({ status: 503 }); expect(entries(f)).toEqual(before);
    const g = await setup(), request = await requested(g), other = await teamFixture(g.db, 'demo-other-business');
    await expect(domain.decideTeamAccess(g.owner, other.business.id, request.current.membershipId, { action: 'approve', requestId: 'demo-cross-business', expectedMembershipRevision: 1, expectedTeamRevision: 0, resourceId: 'demo-chair' }, g.db)).rejects.toMatchObject({ status: 403 });
  });
});
