import { z } from 'zod';
import type { Appointment } from '@/types/firestore';
import { isDateKey } from '@/lib/sarin/calendar-time';

const noControls = (value: string) => !/[\x00-\x1f\x7f]/.test(value);
// Firebase identity is exact: never trim or case-fold it.
export const teamUidSchema = z.string().min(1).max(128).refine(noControls);
// A negative character test closes JS `$`'s final-newline exception.
export const teamDocumentIdSchema = z.string().min(1).max(128)
  .refine(value => !/[^A-Za-z0-9_-]/.test(value) && !['__proto__', 'prototype', 'constructor'].includes(value));
export const teamRequestIdSchema = teamDocumentIdSchema.refine(value => value.length >= 8);
export const teamBusinessSlugSchema = z.string().min(3).max(70).refine(value => noControls(value) && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value));
export const teamRevisionSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER - 1);
export const teamExpectedRevisionSchema = teamRevisionSchema.max(Number.MAX_SAFE_INTEGER - 2);
const positiveRevision = teamRevisionSchema.min(1);
const timestamp = z.number().int().nonnegative().max(8640000000000000);
const label = z.string().min(1).max(120).refine(noControls);
const hash = z.string().length(64).refine(value => !/[^a-f0-9]/.test(value));
const date = z.string().length(10).refine(isDateKey);
export const teamMembershipStatusSchema = z.enum(['requested', 'active', 'rejected', 'revoked']);
export const teamRoleSchema = z.object({ id: z.literal('own_agenda_viewer'), version: z.literal(1) }).strict();
export type TeamMembershipStatus = z.infer<typeof teamMembershipStatusSchema>;
export type TeamRole = z.infer<typeof teamRoleSchema>;
const validAssignment = (value: { status: TeamMembershipStatus; role: TeamRole | null; resourceId: string | null }) =>
  value.status === 'requested' ? value.role === null && value.resourceId === null
    : value.status !== 'active' || value.role !== null && value.resourceId !== null;

export const businessTeamMembershipSchema = z.object({
  version: z.literal(1), id: teamDocumentIdSchema, businessId: teamDocumentIdSchema, memberUid: teamUidSchema,
  status: teamMembershipStatusSchema, revision: positiveRevision, role: teamRoleSchema.nullable(),
  resourceId: teamDocumentIdSchema.nullable(), ownerUidAtApproval: teamUidSchema.nullable(), businessLabel: label,
  createdAt: timestamp, updatedAt: timestamp, lastRequestedAt: timestamp, lastEventId: teamDocumentIdSchema,
}).strict().refine(value => validAssignment(value)
  && (value.status !== 'active' || value.ownerUidAtApproval !== null)
  && (value.status !== 'requested' || value.ownerUidAtApproval === null)
  && value.createdAt <= value.lastRequestedAt && value.lastRequestedAt <= value.updatedAt);
export type BusinessTeamMembership = z.infer<typeof businessTeamMembershipSchema>;
const requestEvent = z.object({ at: timestamp, requestHash: hash }).strict();
export const businessTeamStateSchema = z.object({
  version: z.literal(1), businessId: teamDocumentIdSchema, revision: positiveRevision,
  requestedCount: z.number().int().min(0).max(30), activeCount: z.number().int().min(0).max(30),
  requestEvents: z.array(requestEvent).max(30),
}).strict().refine(value => new Set(value.requestEvents.map(event => event.requestHash)).size === value.requestEvents.length);
export type BusinessTeamState = z.infer<typeof businessTeamStateSchema>;

export const teamSelfRequestCommandSchema = z.object({ businessSlug: teamBusinessSlugSchema,
  requestId: teamRequestIdSchema, expectedMembershipRevision: teamExpectedRevisionSchema }).strict();
export const teamLeaveCommandSchema = z.object({ requestId: teamRequestIdSchema, expectedMembershipRevision: teamExpectedRevisionSchema }).strict();
const ownerCommand = { requestId: teamRequestIdSchema, expectedMembershipRevision: teamExpectedRevisionSchema, expectedTeamRevision: teamExpectedRevisionSchema };
export const teamOwnerDecisionCommandSchema = z.discriminatedUnion('action', [
  z.object({ ...ownerCommand, action: z.literal('approve'), resourceId: teamDocumentIdSchema }).strict(),
  z.object({ ...ownerCommand, action: z.enum(['reject', 'revoke']) }).strict(),
]);
export type TeamSelfRequestCommand = z.infer<typeof teamSelfRequestCommandSchema>;
export type TeamLeaveCommand = z.infer<typeof teamLeaveCommandSchema>;
export type TeamOwnerDecisionCommand = z.infer<typeof teamOwnerDecisionCommandSchema>;
export const teamAccessCanonicalCommandSchema = z.object({
  kind: z.enum(['request', 'leave', 'approve', 'reject', 'revoke']), businessId: teamDocumentIdSchema,
  actorUid: teamUidSchema, requestId: teamRequestIdSchema, expectedMembershipRevision: teamExpectedRevisionSchema,
  expectedTeamRevision: teamExpectedRevisionSchema.nullable(), resourceId: teamDocumentIdSchema.nullable(),
}).strict().refine(value => (value.kind === 'request' || value.kind === 'leave' ? value.expectedTeamRevision === null : value.expectedTeamRevision !== null)
  && (value.kind === 'approve' ? value.resourceId !== null : value.resourceId === null));
export type TeamAccessCanonicalCommand = z.infer<typeof teamAccessCanonicalCommandSchema>;
export function teamAccessCommandCanonicalString(input: TeamAccessCanonicalCommand): string {
  const value = teamAccessCanonicalCommandSchema.parse(input);
  return JSON.stringify({ kind: value.kind, businessId: value.businessId, actorUid: value.actorUid, requestId: value.requestId,
    expectedMembershipRevision: value.expectedMembershipRevision, expectedTeamRevision: value.expectedTeamRevision, resourceId: value.resourceId });
}
export function nextTeamRevision(value: number): number { return teamExpectedRevisionSchema.parse(value) + 1; }

const membershipViewFields = {
  membershipId: teamDocumentIdSchema, businessId: teamDocumentIdSchema, businessLabel: label,
  status: teamMembershipStatusSchema, revision: positiveRevision, role: teamRoleSchema.nullable(),
  resourceId: teamDocumentIdSchema.nullable(), updatedAt: timestamp,
};
export const teamSelfMembershipSchema = z.object(membershipViewFields).strict().refine(validAssignment);
export const teamOwnerMembershipSchema = z.object({ ...membershipViewFields, memberUid: teamUidSchema }).strict().refine(validAssignment);
export type TeamSelfMembership = z.infer<typeof teamSelfMembershipSchema>;
export type TeamOwnerMembership = z.infer<typeof teamOwnerMembershipSchema>;
export function toTeamSelfMembership(input: unknown): TeamSelfMembership {
  const value = businessTeamMembershipSchema.strip().parse(input);
  return teamSelfMembershipSchema.parse({ membershipId: value.id, businessId: value.businessId, businessLabel: value.businessLabel,
    status: value.status, revision: value.revision, role: value.role, resourceId: value.resourceId, updatedAt: value.updatedAt });
}
export function toTeamOwnerMembership(input: unknown): TeamOwnerMembership {
  const value = businessTeamMembershipSchema.strip().parse(input);
  return teamOwnerMembershipSchema.parse({ ...toTeamSelfMembership(value), memberUid: value.memberUid });
}
const agendaScopeSchema = z.object({ businessId: teamDocumentIdSchema, memberUid: teamUidSchema, ownerUid: teamUidSchema,
  resource: z.object({ id: teamDocumentIdSchema, active: z.boolean() }) });
/** Capability check only; server authorization must also validate gate, policy, consent and event heads. */
export function hasOwnTeamAgendaAccess(input: unknown, scope: unknown): boolean {
  const membership = businessTeamMembershipSchema.safeParse(input), checkedScope = agendaScopeSchema.safeParse(scope);
  if (!membership.success || !checkedScope.success) return false;
  const value = membership.data, current = checkedScope.data;
  return value.status === 'active' && value.businessId === current.businessId && value.memberUid === current.memberUid
    && value.ownerUidAtApproval === current.ownerUid && value.resourceId === current.resource.id && current.resource.active;
}

export const teamAppliedSchema = z.object({ requestId: teamRequestIdSchema, commandHash: hash, eventId: teamDocumentIdSchema,
  membershipRevision: positiveRevision, teamRevision: positiveRevision, recordedAt: timestamp }).strict();
export type TeamApplied = z.infer<typeof teamAppliedSchema>;
const mutationFields = { applied: teamAppliedSchema, replayed: z.boolean(), teamRevision: positiveRevision };
export const teamMutationResultSchema = z.discriminatedUnion('audience', [
  z.object({ ...mutationFields, audience: z.literal('member'), current: teamSelfMembershipSchema }).strict(),
  z.object({ ...mutationFields, audience: z.literal('owner'), current: teamOwnerMembershipSchema }).strict(),
]).refine(value => value.applied.membershipRevision <= value.current.revision && value.applied.teamRevision <= value.teamRevision
  && value.applied.recordedAt <= value.current.updatedAt);
export type TeamMutationResult = z.infer<typeof teamMutationResultSchema>;

const eventViewFields = {
  id: teamDocumentIdSchema, sequence: positiveRevision, membershipId: teamDocumentIdSchema, memberUid: teamUidSchema,
  actorUid: teamUidSchema, beforeStatus: teamMembershipStatusSchema.nullable(), afterStatus: teamMembershipStatusSchema,
  role: teamRoleSchema.nullable(), resourceId: teamDocumentIdSchema.nullable(), recordedAt: timestamp,
};
const validEventTransition = (value: { beforeStatus: TeamMembershipStatus | null; afterStatus: TeamMembershipStatus }) =>
  value.afterStatus === 'requested' ? value.beforeStatus === null || value.beforeStatus === 'rejected' || value.beforeStatus === 'revoked'
    : value.afterStatus === 'revoked' ? value.beforeStatus === 'requested' || value.beforeStatus === 'active'
      : value.beforeStatus === 'requested';
export const teamAccessEventViewSchema = z.object(eventViewFields).strict().refine(value => validAssignment({ ...value, status: value.afterStatus }) && validEventTransition(value));
export type TeamAccessEventView = z.infer<typeof teamAccessEventViewSchema>;
// Full canonical material is durable receipt evidence, independent of the resulting assignment on revoke.
export const teamAccessEventSchema = z.object({
  ...eventViewFields, version: z.literal(1), businessId: teamDocumentIdSchema, requestId: teamRequestIdSchema,
  commandHash: hash, membershipRevision: positiveRevision, command: teamAccessCanonicalCommandSchema,
}).strict().refine(value => {
  const command = value.command;
  const transitions = { request: value.afterStatus === 'requested' && (value.beforeStatus === null || value.beforeStatus === 'rejected' || value.beforeStatus === 'revoked'),
    leave: value.afterStatus === 'revoked' && (value.beforeStatus === 'requested' || value.beforeStatus === 'active'),
    approve: value.beforeStatus === 'requested' && value.afterStatus === 'active', reject: value.beforeStatus === 'requested' && value.afterStatus === 'rejected',
    revoke: value.beforeStatus === 'active' && value.afterStatus === 'revoked' };
  return validAssignment({ ...value, status: value.afterStatus }) && transitions[command.kind]
    && command.businessId === value.businessId && command.actorUid === value.actorUid && command.requestId === value.requestId
    && value.membershipRevision === command.expectedMembershipRevision + 1
    && (value.beforeStatus === null) === (command.expectedMembershipRevision === 0)
    && (command.expectedTeamRevision === null || value.sequence === command.expectedTeamRevision + 1)
    && (command.kind !== 'approve' || command.resourceId === value.resourceId)
    && (command.kind !== 'request' && command.kind !== 'leave' || value.actorUid === value.memberUid);
});
export type TeamAccessEvent = z.infer<typeof teamAccessEventSchema>;
export function toTeamAccessEventView(input: unknown): TeamAccessEventView {
  const value = teamAccessEventSchema.strip().parse(input);
  return teamAccessEventViewSchema.parse({ id: value.id, sequence: value.sequence, membershipId: value.membershipId,
    memberUid: value.memberUid, actorUid: value.actorUid, beforeStatus: value.beforeStatus, afterStatus: value.afterStatus,
    role: value.role, resourceId: value.resourceId, recordedAt: value.recordedAt });
}

const dayMs = 86400000;
const dayStart = (dateKey: string) => Date.parse(`${dateKey}T00:00:00-05:00`);
const agendaStatus = z.enum(['confirmed', 'cancelled_by_client', 'cancelled_by_owner', 'completed', 'no_show']);
const agendaRow = z.object({ id: teamDocumentIdSchema, startAt: timestamp, endAt: timestamp,
  status: agendaStatus, kind: z.enum(['appointment', 'manual_block']) }).strict().refine(value => value.startAt < value.endAt);
export const teamAgendaContextSchema = z.object({ businessId: teamDocumentIdSchema, businessName: label,
  resource: z.object({ id: teamDocumentIdSchema, name: label }).strict(), dateKey: date, checkedAt: timestamp, membershipRevision: positiveRevision }).strict();
const validAgendaDate = (value: { dateKey: string; checkedAt: number }) => {
  const today = Math.floor((value.checkedAt - 5 * 3600000) / dayMs) * dayMs + 5 * 3600000;
  return dayStart(value.dateKey) >= today && dayStart(value.dateKey) <= today + 31 * dayMs;
};
export const teamAgendaViewSchema = teamAgendaContextSchema.extend({ rows: z.array(agendaRow).max(999) }).refine(value => validAgendaDate(value)
  && new Set(value.rows.map(row => row.id)).size === value.rows.length
  && value.rows.every(row => row.startAt >= dayStart(value.dateKey) && row.endAt <= dayStart(value.dateKey) + dayMs));
export type TeamAgendaView = z.infer<typeof teamAgendaViewSchema>;
/** Validate the complete query scope, then explicitly construct the minimal DTO. Never infer missing timestamps. */
export function projectTeamAgenda(input: z.infer<typeof teamAgendaContextSchema>, appointments: readonly unknown[]): TeamAgendaView {
  const context = teamAgendaContextSchema.parse(input);
  const source = z.object({ id: teamDocumentIdSchema, tenantId: z.literal(context.businessId), resourceId: z.literal(context.resource.id),
    dateKey: z.literal(context.dateKey), startAt: timestamp, endAt: timestamp, reservedUntilAt: timestamp,
    type: z.enum(['appointment', 'manual_block']), status: agendaStatus }).refine(value => value.startAt < value.endAt
      && value.endAt <= value.reservedUntilAt && value.reservedUntilAt <= dayStart(context.dateKey) + dayMs);
  const rows = z.array(source).max(999).parse(appointments).map(value => ({
    id: value.id, startAt: value.startAt, endAt: value.endAt, status: value.status as Appointment['status'], kind: value.type,
  }));
  return teamAgendaViewSchema.parse({ businessId: context.businessId, businessName: context.businessName, resource: context.resource,
    dateKey: context.dateKey, checkedAt: context.checkedAt, membershipRevision: context.membershipRevision, rows });
}

const pageFields = { scopeUid: teamUidSchema, items: z.array(teamSelfMembershipSchema).max(20), serverNow: timestamp, applied: teamAppliedSchema.nullable() };
export const teamMembershipPageSchema = z.discriminatedUnion('mode', [
  z.object({ ...pageFields, mode: z.literal('page'), nextAfterBusinessId: teamDocumentIdSchema.nullable(), target: z.null() }).strict(),
  z.object({ ...pageFields, mode: z.literal('business'), nextAfterBusinessId: z.null(),
    target: z.object({ businessId: teamDocumentIdSchema, businessName: label }).strict().nullable() }).strict(),
]).refine(value => {
  if (!value.items.every((item, index) => item.updatedAt <= value.serverNow && (index === 0 || value.items[index - 1].businessId < item.businessId))) return false;
  if (value.mode === 'page') return value.applied === null && (value.nextAfterBusinessId === null
    || value.items.length === 20 && value.nextAfterBusinessId === value.items.at(-1)?.businessId);
  return value.items.length <= 1 && (value.target !== null || value.items.length === 0 && value.applied === null)
    && value.items.every(item => item.businessId === value.target?.businessId)
    && (!value.applied || value.items.length === 1 && value.applied.membershipRevision <= value.items[0].revision && value.applied.recordedAt <= value.items[0].updatedAt);
});
export type TeamMembershipPage = z.infer<typeof teamMembershipPageSchema>;
export const teamBusinessLookupSchema = teamMembershipPageSchema;
export const ownerBusinessTeamViewSchema = z.object({ businessId: teamDocumentIdSchema, ownerUid: teamUidSchema, teamRevision: teamRevisionSchema,
  requested: z.array(teamOwnerMembershipSchema).max(30), active: z.array(teamOwnerMembershipSchema).max(30),
  events: z.array(teamAccessEventViewSchema).max(20), serverNow: timestamp, enabled: z.boolean(), eligible: z.boolean(), applied: teamAppliedSchema.nullable() }).strict().refine(value => {
  const members = [...value.requested, ...value.active];
  return (value.teamRevision > 0 || members.length === 0 && value.events.length === 0)
    && value.requested.every(item => item.status === 'requested') && value.active.every(item => item.status === 'active')
    && members.every(item => item.businessId === value.businessId && item.updatedAt <= value.serverNow)
    && new Set(members.map(item => item.membershipId)).size === members.length && new Set(members.map(item => item.memberUid)).size === members.length
    && value.events.every((event, index) => event.sequence <= value.teamRevision && event.recordedAt <= value.serverNow && (index === 0 || value.events[index - 1].sequence > event.sequence))
    && new Set(value.events.map(event => event.id)).size === value.events.length
    && (!value.applied || value.applied.teamRevision <= value.teamRevision && value.applied.recordedAt <= value.serverNow);
});
export type OwnerBusinessTeamView = z.infer<typeof ownerBusinessTeamViewSchema>;
export const teamOwnerViewSchema = ownerBusinessTeamViewSchema;
