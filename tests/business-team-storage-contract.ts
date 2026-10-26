import { expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import type { Database, DocumentReference, Query, Transaction } from '@/lib/storage/types';
import { decideTeamAccess, leaveTeamAccess, readOwnerBusinessTeam, readVerifiedTeamSnapshot, requestTeamAccess } from '@/lib/server/business-team';
import { readTeamAssignedAgenda } from '@/lib/server/team-agenda';
import { bookingDataPolicyKey } from '@/lib/server/booking-data-policy';
import { consentStateKey } from '@/lib/server/consent';
import { acceptSyntheticConsent } from './consent-fixtures';
import { teamFixture, teamNow } from './business-team-contract';

export const teamStateId = (businessId: string) => `business_team_${createHash('sha256').update(businessId).digest('hex')}`;
export const teamAppointment = (businessId: string, id = 'demo-private-appointment') => ({ id, tenantId: businessId, dateKey: '2030-01-07', resourceId: 'demo-chair', startAt: teamNow, endAt: teamNow + 1800000, reservedUntilAt: teamNow + 1800000, type: 'manual_block', status: 'confirmed', serviceName: 'PRIVATE BLOCK REASON', price: 999, client: { uid: 'demo-private-client', name: 'PRIVATE CONTACT', email: 'PRIVATE EMAIL' }, beneficiary: { kind: 'represented_minor' }, intakeAnswers: { private: 'PRIVATE INTAKE' } });
export const approval = (teamRevision = 1, requestId = 'demo-storage-approve') => ({ action: 'approve' as const, requestId, expectedMembershipRevision: 1, expectedTeamRevision: teamRevision, resourceId: 'demo-chair' });
export async function requestedTeam(db: Database, id = 'demo-storage-team') {
  const f = await teamFixture(db, id);
  const request = await requestTeamAccess(f.member, f.request, db);
  return { ...f, db, membershipId: request.current.membershipId, request };
}
export async function activeTeam(db: Database, id?: string) {
  const f = await requestedTeam(db, id), command = approval();
  const approved = await decideTeamAccess(f.owner, f.business.id, f.membershipId, command, db);
  return { ...f, command, approved };
}
export async function assertTeamIntegrity(db: Database, businessId: string) {
  const roster = await readOwnerBusinessTeam({ uid: 'demo-team-owner' }, businessId, undefined, db);
  const state = (await db.collection('serverSettings').doc(teamStateId(businessId)).get()).data()!;
  expect(state).toMatchObject({ revision: roster.teamRevision, activeCount: roster.active.length, requestedCount: roster.requested.length });
  expect(roster.events.map(event => event.sequence)).toEqual(Array.from({ length: Math.min(20, roster.teamRevision) }, (_, i) => roster.teamRevision - i));
  for (const row of [...roster.active, ...roster.requested]) {
    const snapshot = await db.runTransaction(tx => readVerifiedTeamSnapshot(tx, businessId, row.memberUid, db));
    expect(snapshot.head).toMatchObject({ membershipId: row.membershipId, membershipRevision: row.revision, afterStatus: row.status });
  }
  return roster;
}

/** Real storage transaction, with only a scheduling barrier after an actual membership read. */
export function pauseMembershipRead(db: Database, membershipId: string, runReadTransaction = db.runTransaction.bind(db)) {
  let resume!: () => void, reached!: () => void, used = false;
  const paused = new Promise<void>(resolve => { reached = resolve; });
  const released = new Promise<void>(resolve => { resume = resolve; });
  const observed: Database = { collection: name => db.collection(name), runTransaction: handler => runReadTransaction(async tx => handler(new Proxy(tx, {
    get(target, key) {
      if (key === 'get') return async (ref: DocumentReference | Query) => {
        const value = await target.get(ref as DocumentReference);
        if (!used && 'path' in ref && ref.path === `businessMemberships/${membershipId}`) { used = true; reached(); await released; }
        return value;
      };
      const value = Reflect.get(target, key); return typeof value === 'function' ? value.bind(target) : value;
    },
  }) as Transaction)) };
  return { observed, paused, resume };
}

export function registerTeamStorageCases(backend: string, handles: () => { db: Database; second: Database }, readTransaction?: () => Database['runTransaction']) {
  it(`${backend}: approval racing owner revocation yields one coherent current state`, async () => {
    const { db, second } = handles(), f = await requestedTeam(db);
    const outcomes = await Promise.allSettled([
      decideTeamAccess(f.owner, f.business.id, f.membershipId, approval(), db),
      decideTeamAccess(f.owner, f.business.id, f.membershipId, { action: 'revoke', requestId: 'demo-approve-revoke-race', expectedMembershipRevision: 2, expectedTeamRevision: 2 }, second),
    ]);
    expect(outcomes[0].status).toBe('fulfilled');
    if (outcomes[1].status === 'rejected') expect(outcomes[1].reason).toMatchObject({ status: 409 });
    const roster = await assertTeamIntegrity(db, f.business.id), revoked = outcomes[1].status === 'fulfilled';
    expect(roster.teamRevision).toBe(revoked ? 3 : 2); expect(roster.active).toHaveLength(revoked ? 0 : 1);
    const member = (await db.collection('businessMemberships').doc(f.membershipId).get()).data()!;
    expect(member).toMatchObject({ revision: roster.teamRevision, status: revoked ? 'revoked' : 'active' });
    expect((await db.collection('businesses').doc(f.business.id).collection('teamAccessEvents').get()).size).toBe(roster.teamRevision);
  }, 30000);

  it(`${backend}: concurrent approval and withdrawal serialize one revision and one head`, async () => {
    const { db, second } = handles(), f = await requestedTeam(db);
    const outcomes = await Promise.allSettled([
      decideTeamAccess(f.owner, f.business.id, f.membershipId, approval(), db),
      leaveTeamAccess(f.member, f.membershipId, { requestId: 'demo-racing-leave', expectedMembershipRevision: 1 }, second),
    ]);
    expect(outcomes.filter(item => item.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.find(item => item.status === 'rejected')).toMatchObject({ reason: { status: 409 } });
    const roster = await assertTeamIntegrity(second, f.business.id);
    expect(roster.teamRevision).toBe(2);
    const member = (await db.collection('businessMemberships').doc(f.membershipId).get()).data()!;
    expect(member.revision).toBe(2); expect(['active', 'revoked']).toContain(member.status);
    expect((await db.collection('businesses').doc(f.business.id).collection('teamAccessEvents').get()).size).toBe(2);
  }, 30000);

  it(`${backend}: revoke and leave compete on active membership; old approval replay never restores access`, async () => {
    const { db, second } = handles(), f = await activeTeam(db);
    const outcomes = await Promise.allSettled([
      decideTeamAccess(f.owner, f.business.id, f.membershipId, { action: 'revoke', requestId: 'demo-racing-revoke', expectedMembershipRevision: 2, expectedTeamRevision: 2 }, db),
      leaveTeamAccess(f.member, f.membershipId, { requestId: 'demo-racing-leave', expectedMembershipRevision: 2 }, second),
    ]);
    expect(outcomes.filter(item => item.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.find(item => item.status === 'rejected')).toMatchObject({ reason: { status: 409 } });
    const replay = await decideTeamAccess(f.owner, f.business.id, f.membershipId, f.command, second);
    expect(replay).toMatchObject({ replayed: true, applied: f.approved.applied, teamRevision: 3, current: { status: 'revoked', revision: 3 } });
    const roster = await assertTeamIntegrity(db, f.business.id);
    expect(roster.active).toEqual([]); expect(roster.requested).toEqual([]); expect(roster.teamRevision).toBe(3);
    expect((await db.collection('businesses').doc(f.business.id).collection('teamAccessEvents').get()).size).toBe(3);
  }, 30000);

  it(`${backend}: stale actor access changes are rechecked; DTO contains only assigned safe fields`, async () => {
    const { db, second } = handles(), f = await activeTeam(db);
    const appointments = db.collection('businesses').doc(f.business.id).collection('appointments');
    await appointments.doc('demo-private-appointment').set(teamAppointment(f.business.id));
    await appointments.doc('demo-other-resource').set({ ...teamAppointment(f.business.id, 'demo-other-resource'), resourceId: 'demo-other-chair' });
    const view = await readTeamAssignedAgenda(f.member, f.business.id, '2030-01-07', db);
    expect(view.rows).toEqual([{ id: 'demo-private-appointment', startAt: teamNow, endAt: teamNow + 1800000, status: 'confirmed', kind: 'manual_block' }]);
    expect(JSON.stringify(view)).not.toMatch(/PRIVATE|client|beneficiary|price|serviceName|intake/);
    const policyRef = second.collection('serverSettings').doc(bookingDataPolicyKey(f.business.id)), policy = (await policyRef.get()).data()!;
    for (const changed of [{ ...f.business, ownerUid: 'demo-next-owner' }, { ...f.business, resources: [{ id: 'demo-chair', name: 'Chair', active: false }] }]) {
      await second.collection('businesses').doc(f.business.id).set(changed);
      await expect(readTeamAssignedAgenda(f.member, f.business.id, '2030-01-07', db)).rejects.toMatchObject({ status: 403 });
    }
    await second.collection('businesses').doc(f.business.id).set(f.business);
    for (const changed of [{ ...policy, dataMode: 'health' }, { ...policy, representedMinorsEnabled: true }, null]) {
      if (changed) await policyRef.set(changed); else await policyRef.delete();
      await expect(readTeamAssignedAgenda(f.member, f.business.id, '2030-01-07', db)).rejects.toMatchObject({ status: 403 });
    }
    await policyRef.set(policy);
    for (const actor of [f.member, f.owner]) {
      const ref = second.collection('serverSettings').doc(consentStateKey(actor.uid, 'account')), saved = (await ref.get()).data()!;
      await ref.delete(); await expect(readTeamAssignedAgenda(f.member, f.business.id, '2030-01-07', db)).rejects.toMatchObject({ status: 428 }); await ref.set(saved);
    }
    await leaveTeamAccess(f.member, f.membershipId, { requestId: 'demo-storage-leave', expectedMembershipRevision: 2 }, second);
    await expect(readTeamAssignedAgenda(f.member, f.business.id, '2030-01-07', db)).rejects.toMatchObject({ status: 403 });
  }, 30000);

  for (const change of ['revoke', 'owner', 'policy', 'resource'] as const) {
    it(`${backend}: agenda paused after membership read stays on a valid snapshot during ${change}`, async () => {
      const { db, second } = handles(), f = await activeTeam(db);
      await db.collection('businesses').doc(f.business.id).collection('appointments').doc('demo-private-appointment').set(teamAppointment(f.business.id));
      const barrier = pauseMembershipRead(db, f.membershipId, readTransaction?.());
      const pending = readTeamAssignedAgenda(f.member, f.business.id, '2030-01-07', barrier.observed);
      await barrier.paused;
      try {
        if (change === 'revoke') await leaveTeamAccess(f.member, f.membershipId, { requestId: 'demo-paused-leave', expectedMembershipRevision: 2 }, second);
        if (change === 'owner') await second.collection('businesses').doc(f.business.id).set({ ...f.business, ownerUid: 'demo-next-owner' });
        if (change === 'resource') await second.collection('businesses').doc(f.business.id).set({ ...f.business, resources: [{ id: 'demo-chair', name: 'Chair', active: false }] });
        if (change === 'policy') {
          const ref = second.collection('serverSettings').doc(bookingDataPolicyKey(f.business.id)); await ref.set({ ...(await ref.get()).data()!, dataMode: 'health' });
        }
      } finally { barrier.resume(); }
      const outcome = await pending.then(value => ({ value }), error => ({ error }));
      if ('error' in outcome) expect(outcome.error).toMatchObject({ status: 403 });
      else expect(outcome.value).toMatchObject({ membershipRevision: 2, resource: { id: 'demo-chair' }, rows: [{ id: 'demo-private-appointment', kind: 'manual_block' }] });
      await expect(readTeamAssignedAgenda(f.member, f.business.id, '2030-01-07', db)).rejects.toMatchObject({ status: 403 });
    }, 30000);
  }
}
