import { describe, expect, it } from 'vitest';
import * as team from '@/lib/business-team';
import type { Appointment } from '@/types/firestore';

const ownerA = 'ownerA', staffU = 'staffU', clientC = 'clientC', superadminS = 'superadminS', ownerB = 'ownerB';
const at = Date.parse('2026-10-25T15:00:00-05:00');
const membership = {
  version: 1 as const, id: 'membershipA', businessId: 'businessA', memberUid: staffU,
  status: 'active' as const, revision: 2, role: { id: 'own_agenda_viewer' as const, version: 1 as const },
  resourceId: 'stationA', ownerUidAtApproval: ownerA, businessLabel: 'Synthetic A',
  createdAt: at - 1000, updatedAt: at, lastRequestedAt: at - 1000, lastEventId: 'eventA',
};
const scope = { businessId: 'businessA', memberUid: staffU, ownerUid: ownerA, resource: { id: 'stationA', active: true } };
const command = { kind: 'approve' as const, businessId: 'businessA', actorUid: ownerA, requestId: 'requestA', expectedMembershipRevision: 1, expectedTeamRevision: 1, resourceId: 'stationA' };
const appointment: Appointment = {
  id: 'appointmentA', tenantId: 'businessA', dateKey: '2026-10-25', resourceId: 'stationA',
  startAt: at, endAt: at + 1800000, reservedUntilAt: at + 2400000,
  startTimeStr: '15:00', endTimeStr: '15:30', type: 'appointment', status: 'confirmed',
  serviceId: 'serviceA', serviceName: 'PRIVATE_SERVICE', price: 120000,
  client: { uid: clientC, name: 'PRIVATE_NAME', email: 'private@example.invalid', phone: '+573001234567', intakeAnswers: { private: 'PRIVATE_INTAKE' }, hasNoShowHistory: true },
  beneficiary: { kind: 'minor', firstName: 'PRIVATE_MINOR' } as unknown as Appointment['beneficiary'],
  subjectAuthorization: { receiptId: 'PRIVATE_RECEIPT', bookingRequestId: 'PRIVATE_REQUEST', policyRevision: 1 },
  representationReview: { private: 'PRIVATE_REVIEW' } as unknown as Appointment['representationReview'],
  attendance: { revision: 1, lastEventId: 'PRIVATE_ATTENDANCE' }, rescheduleRevision: 1,
  lastRescheduleProposalId: 'PRIVATE_PROPOSAL', rescheduledAt: at,
  createdBy: 'sarin_client', createdAt: at - 1000,
};
const agendaInput = { businessId: 'businessA', businessName: 'Synthetic A', resource: { id: 'stationA', name: 'Station A' }, dateKey: '2026-10-25', checkedAt: at, membershipRevision: 2 };

describe('pure business team boundaries', () => {
  it('onlyRoleVersionOneGrantsOwnAgenda', () => {
    expect(team.hasOwnTeamAgendaAccess(membership, scope)).toBe(true);
    for (const patch of [{ ownerUidAtApproval: 'ownerB' }, { resourceId: 'professionalB' }, { memberUid: clientC }, { businessId: 'businessB' }]) {
      expect(team.hasOwnTeamAgendaAccess({ ...membership, ...patch }, scope)).toBe(false);
    }
    expect(team.hasOwnTeamAgendaAccess(membership, { ...scope, resource: { id: 'stationA', active: false } })).toBe(false);
  });
  it('unknownRolesNeverInherit', () => {
    for (const role of [{ id: 'manager', version: 1 }, { id: 'own_agenda_viewer', version: 2 }, { id: 'superadmin', version: 1 }, { ...membership.role, contact: true }]) {
      expect(team.hasOwnTeamAgendaAccess({ ...membership, role }, scope)).toBe(false);
      expect(team.businessTeamMembershipSchema.safeParse({ ...membership, role }).success).toBe(false);
    }
    expect(team.hasOwnTeamAgendaAccess({ ...membership, memberUid: superadminS }, scope)).toBe(false);
  });
  it('requestedIsNotAccess', () => {
    const requested = { ...membership, status: 'requested', role: null, resourceId: null, ownerUidAtApproval: null };
    expect(team.businessTeamMembershipSchema.safeParse(requested).success).toBe(true);
    expect(team.hasOwnTeamAgendaAccess(requested, scope)).toBe(false);
    expect(team.businessTeamMembershipSchema.safeParse({ ...requested, resourceId: 'stationA' }).success).toBe(false);
    for (const status of ['rejected', 'revoked']) expect(team.hasOwnTeamAgendaAccess({ ...membership, status }, scope)).toBe(false);
    for (const patch of [{ role: null }, { resourceId: null }, { ownerUidAtApproval: null }]) expect(team.businessTeamMembershipSchema.safeParse({ ...membership, ...patch }).success).toBe(false);
  });
  it('resourceNameCannotProveAccountIdentity', () => {
    const businessB = { id: 'businessB', ownerUid: staffU };
    expect(businessB.ownerUid).toBe(staffU); // Owning B does not confer authority in A.
    expect(team.hasOwnTeamAgendaAccess(membership, { ...scope, resource: { id: 'professionalB', active: true, name: staffU } })).toBe(false);
    expect(team.hasOwnTeamAgendaAccess(membership, { ...scope, memberUid: ownerA })).toBe(false);
    expect(team.hasOwnTeamAgendaAccess(membership, { ...scope, ownerUid: ownerB })).toBe(false);
  });
  it('strictCommandsDoNotAcceptMemberUidOrRole', () => {
    const request = { businessSlug: 'synthetic-a', requestId: 'requestA', expectedMembershipRevision: 0 };
    expect(team.teamSelfRequestCommandSchema.safeParse(request).success).toBe(true);
    for (const field of ['memberUid', 'actorUid', 'role', 'resourceId']) expect(team.teamSelfRequestCommandSchema.safeParse({ ...request, [field]: staffU }).success).toBe(false);
    const decision = { action: 'approve', requestId: 'requestA', expectedMembershipRevision: 1, expectedTeamRevision: 1, resourceId: 'stationA' };
    expect(team.teamOwnerDecisionCommandSchema.safeParse(decision).success).toBe(true);
    expect(team.teamOwnerDecisionCommandSchema.safeParse({ ...decision, role: membership.role }).success).toBe(false);
    expect(team.teamOwnerDecisionCommandSchema.safeParse({ ...decision, action: 'reject' }).success).toBe(false);
    expect(team.teamLeaveCommandSchema.safeParse({ requestId: 'requestA', expectedMembershipRevision: 2, memberUid: staffU }).success).toBe(false);
    expect(team.teamSelfRequestCommandSchema.safeParse({ ...request, expectedMembershipRevision: Number.MAX_SAFE_INTEGER - 1 }).success).toBe(false);
    expect(team.teamSelfRequestCommandSchema.safeParse({ ...request, expectedMembershipRevision: Number.MAX_SAFE_INTEGER - 2 }).success).toBe(true);
  });
  it('canonicalHashCoversActorScopeRevisionAndResource', () => {
    const canonical = team.teamAccessCommandCanonicalString(command);
    expect(canonical).toBe('{"kind":"approve","businessId":"businessA","actorUid":"ownerA","requestId":"requestA","expectedMembershipRevision":1,"expectedTeamRevision":1,"resourceId":"stationA"}');
    for (const patch of [{ actorUid: staffU }, { businessId: 'businessB' }, { requestId: 'requestB' }, { expectedMembershipRevision: 2 }, { expectedTeamRevision: 2 }, { resourceId: 'professionalB' }]) expect(team.teamAccessCommandCanonicalString({ ...command, ...patch })).not.toBe(canonical);
    expect(() => team.teamAccessCommandCanonicalString({ ...command, kind: 'request' })).toThrow();
  });
  it('privateMembershipNeverSpreadToSelfDto', () => {
    const result = team.toTeamSelfMembership({ ...membership, privateProfile: 'PRIVATE_PROFILE' });
    expect(Object.keys(result).sort()).toEqual(['businessId', 'businessLabel', 'membershipId', 'resourceId', 'revision', 'role', 'status', 'updatedAt']);
    expect(team.teamSelfMembershipSchema.safeParse({ ...result, memberUid: staffU }).success).toBe(false);
    expect(team.teamSelfMembershipSchema.safeParse({ ...result, actorUid: ownerA }).success).toBe(false);
    expect(team.toTeamOwnerMembership(membership)).toEqual({ ...result, memberUid: staffU });
    const applied = { requestId: 'requestA', commandHash: 'a'.repeat(64), eventId: 'eventA', membershipRevision: 2, teamRevision: 2, recordedAt: at };
    const response = { audience: 'member', current: result, applied, replayed: false, teamRevision: 2 };
    expect(team.teamMutationResultSchema.safeParse(response).success).toBe(true);
    expect(team.teamMutationResultSchema.safeParse({ ...response, current: team.toTeamOwnerMembership(membership) }).success).toBe(false);
    expect(team.teamMutationResultSchema.safeParse({ ...response, audience: 'owner' }).success).toBe(false);
  });
  it('agendaProjectionDropsContactMinorIntakePriceServiceAndReasons', () => {
    const block = { ...appointment, id: 'blockA', type: 'manual_block' as const, serviceName: 'PRIVATE_BLOCK_REASON' };
    const view = team.projectTeamAgenda(agendaInput, [appointment, block]);
    expect(view.rows).toEqual([
      { id: 'appointmentA', startAt: at, endAt: at + 1800000, status: 'confirmed', kind: 'appointment' },
      { id: 'blockA', startAt: at, endAt: at + 1800000, status: 'confirmed', kind: 'manual_block' },
    ]);
    for (const row of view.rows) expect(Object.keys(row).sort()).toEqual(['endAt', 'id', 'kind', 'startAt', 'status']);
    expect(JSON.stringify(view)).not.toContain('PRIVATE');
    expect(team.teamAgendaViewSchema.safeParse({ ...view, rows: [{ ...view.rows[0], serviceName: 'PRIVATE' }] }).success).toBe(false);
  });
  it('unknownTimesAndScopesFailClosed', () => {
    for (const patch of [{ tenantId: 'businessB' }, { resourceId: 'professionalB' }, { dateKey: '2026-10-26' }, { startAt: NaN }, { startAt: Infinity }, { endAt: at }, { reservedUntilAt: at }, { id: 'appointmentA\n' }, { type: 'unknown' }, { status: 'unknown' }, { startAt: Date.parse('2026-10-25T04:59:59Z') }, { endAt: Date.parse('2026-10-26T05:00:01Z'), reservedUntilAt: Date.parse('2026-10-26T05:00:01Z') }]) expect(() => team.projectTeamAgenda(agendaInput, [{ ...appointment, ...patch }])).toThrow();
    for (const dateKey of ['2026-10-24', '2026-11-26', '2026-02-30', '2026-10-25\n']) expect(() => team.projectTeamAgenda({ ...agendaInput, dateKey }, [])).toThrow();
    expect(team.projectTeamAgenda({ ...agendaInput, dateKey: '2026-11-25' }, []).rows).toEqual([]);
    const manyRows = Array.from({ length: 1000 }, (_, index) => ({ ...appointment, id: `appointment_${index}` }));
    expect(() => team.projectTeamAgenda(agendaInput, manyRows)).toThrow();
    expect(team.projectTeamAgenda(agendaInput, manyRows.slice(0, 999)).rows).toHaveLength(999);
    expect(() => team.projectTeamAgenda(agendaInput, [appointment, appointment])).toThrow();
  });
  it('exactUidsAndCompleteIdsRejectControlsReservedSegmentsAndOverflow', () => {
    expect(team.businessTeamMembershipSchema.parse({ ...membership, memberUid: ' Staff U ' }).memberUid).toBe(' Staff U ');
    for (const memberUid of ['', 'a'.repeat(129), 'staffU\n', 'staffU\r', 'staffU\0', 'staffU\x7f']) expect(team.businessTeamMembershipSchema.safeParse({ ...membership, memberUid }).success).toBe(false);
    for (const id of ['a\n', '../a', '__proto__', 'prototype', 'constructor', 'a'.repeat(129)]) expect(team.businessTeamMembershipSchema.safeParse({ ...membership, id }).success).toBe(false);
    for (const patch of [{ revision: 0 }, { revision: Number.MAX_SAFE_INTEGER }, { updatedAt: at - 2000 }, { lastRequestedAt: at + 1 }]) expect(team.businessTeamMembershipSchema.safeParse({ ...membership, ...patch }).success).toBe(false);
    expect(() => team.nextTeamRevision(Number.MAX_SAFE_INTEGER - 1)).toThrow();
    expect(team.nextTeamRevision(Number.MAX_SAFE_INTEGER - 2)).toBe(Number.MAX_SAFE_INTEGER - 1);
    expect(team.businessTeamMembershipSchema.safeParse({ ...membership, createdAt: at, lastRequestedAt: at }).success).toBe(true);
  });
  it('durableEventsBindCanonicalActorScopeRevisionsAndTransition', () => {
    const event = { version: 1, id: 'eventA', businessId: 'businessA', sequence: 2, membershipId: 'membershipA', memberUid: staffU,
      actorUid: ownerA, beforeStatus: 'requested', afterStatus: 'active', role: membership.role, resourceId: 'stationA', recordedAt: at,
      requestId: 'requestA', commandHash: 'a'.repeat(64), membershipRevision: 2, command };
    expect(team.teamAccessEventSchema.safeParse(event).success).toBe(true);
    for (const patch of [{ actorUid: staffU }, { businessId: 'businessB' }, { membershipRevision: 3 }, { sequence: 3 }, { beforeStatus: 'active' }, { resourceId: 'professionalB' }]) expect(team.teamAccessEventSchema.safeParse({ ...event, ...patch }).success).toBe(false);
    expect(Object.keys(team.toTeamAccessEventView(event)).sort()).toEqual(['actorUid', 'afterStatus', 'beforeStatus', 'id', 'memberUid', 'membershipId', 'recordedAt', 'resourceId', 'role', 'sequence']);
    expect(team.teamAccessEventViewSchema.safeParse({ ...team.toTeamAccessEventView(event), commandHash: event.commandHash }).success).toBe(false);
    expect(team.teamAccessEventViewSchema.safeParse({ ...team.toTeamAccessEventView(event), beforeStatus: 'active' }).success).toBe(false);
    const requestCommand = { ...command, kind: 'request', actorUid: staffU, expectedMembershipRevision: 1, expectedTeamRevision: null, resourceId: null };
    expect(team.teamAccessEventSchema.safeParse({ ...event, beforeStatus: null, afterStatus: 'requested', actorUid: staffU, role: null, resourceId: null, command: requestCommand }).success).toBe(false);
  });
  it('membershipPagesRejectMixedModesScopeDisorderAndPrivateFields', () => {
    const self = team.toTeamSelfMembership(membership);
    const page = { scopeUid: staffU, items: [self], serverNow: at, applied: null, mode: 'page', nextAfterBusinessId: null, target: null };
    expect(team.teamMembershipPageSchema.safeParse(page).success).toBe(true);
    for (const patch of [{ items: [self, self] }, { items: [team.toTeamOwnerMembership(membership)] }, { applied: { private: true } }, { nextAfterBusinessId: 'businessA' }, { target: { businessId: 'businessA', businessName: 'Synthetic A' } }]) expect(team.teamMembershipPageSchema.safeParse({ ...page, ...patch }).success).toBe(false);
    const lookup = { ...page, mode: 'business', target: { businessId: 'businessA', businessName: 'Synthetic A' } };
    expect(team.teamMembershipPageSchema.safeParse(lookup).success).toBe(true);
    expect(team.teamMembershipPageSchema.safeParse({ ...lookup, target: { businessId: 'businessB', businessName: 'Synthetic B' } }).success).toBe(false);
    expect(team.teamMembershipPageSchema.safeParse({ ...lookup, target: null }).success).toBe(false);
    expect(team.teamMembershipPageSchema.safeParse({ ...page, serverNow: at - 1 }).success).toBe(false);
  });
  it('ownerRosterAndStateRejectCorruptCountsAudienceAndHistory', () => {
    const owner = { businessId: 'businessA', ownerUid: ownerA, teamRevision: 2, requested: [], active: [team.toTeamOwnerMembership(membership)], events: [], serverNow: at, enabled: false, eligible: false, applied: null };
    expect(team.ownerBusinessTeamViewSchema.safeParse(owner).success).toBe(true);
    for (const patch of [{ active: [team.toTeamSelfMembership(membership)] }, { requested: owner.active }, { active: [...owner.active, ...owner.active] }, { ownerUid: 'ownerA\n' }, { teamRevision: 0 }]) expect(team.ownerBusinessTeamViewSchema.safeParse({ ...owner, ...patch }).success).toBe(false);
    const state = { version: 1, businessId: 'businessA', revision: 1, requestedCount: 0, activeCount: 0, requestEvents: [] };
    expect(team.businessTeamStateSchema.safeParse(state).success).toBe(true);
    expect(team.businessTeamStateSchema.safeParse({ ...state, revision: 0 }).success).toBe(false);
    expect(team.businessTeamStateSchema.safeParse({ ...state, revision: 1, activeCount: 31 }).success).toBe(false);
    expect(team.businessTeamStateSchema.safeParse({ ...state, revision: 1, requestEvents: [{ at, requestHash: 'a'.repeat(64) }, { at, requestHash: 'a'.repeat(64) }] }).success).toBe(false);
  });
});
