import 'server-only';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { ChatActor } from '@/types/chat';
import type { Business } from '@/types/firestore';
import type { Database, DocumentSnapshot, Transaction } from '@/lib/storage/types';
import { getAdminDb } from '@/lib/firebase/admin';
import { isSubscriptionAllowed } from '@/lib/sarin/subscription';
import {
  businessTeamMembershipSchema, businessTeamStateSchema, teamAccessEventSchema, teamAccessCommandCanonicalString,
  teamDocumentIdSchema, teamUidSchema, teamRequestIdSchema, teamBusinessSlugSchema, teamSelfRequestCommandSchema,
  teamLeaveCommandSchema, teamOwnerDecisionCommandSchema, teamMutationResultSchema, teamMembershipPageSchema,
  ownerBusinessTeamViewSchema, toTeamSelfMembership, toTeamOwnerMembership, toTeamAccessEventView, nextTeamRevision,
  type BusinessTeamMembership, type BusinessTeamState, type TeamAccessEvent, type TeamAccessCanonicalCommand,
  type TeamMutationResult, type TeamSelfRequestCommand, type TeamOwnerDecisionCommand, type TeamLeaveCommand,
  type TeamApplied, type TeamMembershipPage, type OwnerBusinessTeamView,
} from '@/lib/business-team';
import { stableDocumentId, assertOwner } from './businesses';
import { assertConsent } from './consent';
import { readBookingDataPolicy } from './booking-data-policy';
import { HttpError } from './http';

const day = 86400000;
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
const stateKey = (businessId: string) => `business_team_${sha256(businessId)}`;
const uidKey = (uid: string) => `team_request_uid_${sha256(uid)}`;
const membershipKey = (businessId: string, uid: string) => stableDocumentId('business-team', businessId, uid);
const eventKey = (businessId: string, actorUid: string, requestId: string) => stableDocumentId('team-access', businessId, actorUid, requestId);
export const teamAccessEnabled = () => process.env.SARIN_TEAM_ACCESS_ENABLED === 'true';
const unavailable = (): never => { throw new HttpError(503, 'No se pudo validar el equipo del negocio.', 'TEAM_UNAVAILABLE'); };
const conflict = (code = 'TEAM_REVISION_CONFLICT'): never => { throw new HttpError(409, 'El equipo cambió. Actualiza antes de continuar.', code); };
function parsed<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value); if (!result.success) return unavailable(); return result.data;
}
const businessShape = z.object({ id: teamDocumentIdSchema, ownerUid: teamUidSchema, name: z.string().min(1).max(120).refine(v => !/[\x00-\x1f\x7f]/.test(v)),
  slug: teamBusinessSlugSchema, sarinConfig: z.object({ onboardingCompleted: z.boolean() }).passthrough(),
  resources: z.array(z.object({ id: teamDocumentIdSchema, name: z.string().min(1), active: z.boolean() }).passthrough()), subscription: z.object({ status: z.string() }).passthrough(),
}).passthrough();
async function readBusiness(tx: Transaction, businessId: string, db: Database): Promise<Business> {
  const doc = await tx.get(db.collection('businesses').doc(businessId));
  if (!doc.exists) throw new HttpError(404, 'El negocio no existe.');
  const value = parsed(businessShape, doc.data());
  if (value.id !== businessId || new Set(value.resources.map(r => r.id)).size !== value.resources.length) return unavailable();
  return value as unknown as Business;
}
function checkRates(events: BusinessTeamState['requestEvents'], now: number) {
  if (events.some(event => event.at > now)) unavailable();
}
async function readState(tx: Transaction, businessId: string, db: Database, now: number): Promise<BusinessTeamState> {
  const doc = await tx.get(db.collection('serverSettings').doc(stateKey(businessId)));
  if (doc.exists) {
    const value = parsed(businessTeamStateSchema, doc.data());
    if (value.businessId !== businessId) return unavailable(); checkRates(value.requestEvents, now); return value;
  }
  const members = await tx.get(db.collection('businessMemberships').where('businessId', '==', businessId).limit(1));
  if (!members.empty) return unavailable();
  // Zero is an internal initial snapshot only, never a valid persisted state.
  return { version: 1, businessId, revision: 0, requestedCount: 0, activeCount: 0, requestEvents: [] };
}
function checkedMembership(doc: DocumentSnapshot, businessId: string, uid: string, now: number): BusinessTeamMembership | null {
  if (!doc.exists) return null;
  const value = parsed(businessTeamMembershipSchema, doc.data());
  if (value.id !== doc.id || value.id !== membershipKey(businessId, uid) || value.businessId !== businessId || value.memberUid !== uid || value.updatedAt > now) return unavailable();
  return value;
}
function checkedEvent(doc: DocumentSnapshot, businessId: string, state: BusinessTeamState, now: number): TeamAccessEvent {
  if (!doc.exists) return unavailable();
  const value = parsed(teamAccessEventSchema, doc.data());
  if (value.id !== doc.id || value.businessId !== businessId || value.id !== eventKey(businessId, value.actorUid, value.requestId)
    || value.membershipId !== membershipKey(businessId, value.memberUid) || value.sequence > state.revision || value.recordedAt > now
    || value.commandHash !== sha256(teamAccessCommandCanonicalString(value.command))) return unavailable();
  return value;
}
async function readHead(tx: Transaction, membership: BusinessTeamMembership, state: BusinessTeamState, db: Database, now: number): Promise<TeamAccessEvent> {
  const head = checkedEvent(await tx.get(db.collection('businesses').doc(membership.businessId).collection('teamAccessEvents').doc(membership.lastEventId)), membership.businessId, state, now);
  if (head.membershipId !== membership.id || head.memberUid !== membership.memberUid || head.membershipRevision !== membership.revision
    || head.afterStatus !== membership.status || head.recordedAt !== membership.updatedAt || head.resourceId !== membership.resourceId
    || JSON.stringify(head.role) !== JSON.stringify(membership.role)
    || membership.status === 'active' && (state.activeCount < 1 || head.actorUid !== membership.ownerUidAtApproval)
    || membership.status === 'requested' && (state.requestedCount < 1 || head.recordedAt !== membership.lastRequestedAt)) return unavailable();
  return head;
}

/** Read only, in the caller's transaction. This validates persistence, not the agenda capability. */
export async function readVerifiedTeamSnapshot(tx: Transaction, businessId: string, memberUid: string, db: Database, now = Date.now()): Promise<{
  business: Business; state: BusinessTeamState; membership: BusinessTeamMembership | null; head: TeamAccessEvent | null;
}> {
  teamDocumentIdSchema.parse(businessId); teamUidSchema.parse(memberUid);
  const business = await readBusiness(tx, businessId, db), state = await readState(tx, businessId, db, now);
  const membership = checkedMembership(await tx.get(db.collection('businessMemberships').doc(membershipKey(businessId, memberUid))), businessId, memberUid, now);
  const head = membership ? await readHead(tx, membership, state, db, now) : null;
  return { business, state, membership, head };
}

async function resolveSlug(tx: Transaction, slug: string, db: Database): Promise<Business | null> {
  const doc = await tx.get(db.collection('businessSlugs').doc(slug)); if (!doc.exists) return null;
  const mapping = parsed(z.object({ businessId: teamDocumentIdSchema, ownerUid: teamUidSchema }).strict(), doc.data());
  const business = await readBusiness(tx, mapping.businessId, db);
  if (business.slug !== slug || business.ownerUid !== mapping.ownerUid) return unavailable(); return business;
}
async function eligible(tx: Transaction, business: Business, db: Database): Promise<boolean> {
  const { capability } = await readBookingDataPolicy(business.id, db, tx);
  return business.sarinConfig.onboardingCompleted && capability.configured && capability.dataMode === 'general' && !capability.representedMinorsEnabled;
}
async function assertAdmission(tx: Transaction, business: Business, memberUid: string, db: Database, now: number) {
  if (!teamAccessEnabled()) throw new HttpError(403, 'El acceso de equipo está pausado.', 'TEAM_DISABLED');
  if (!await eligible(tx, business, db)) throw new HttpError(403, 'Este negocio no admite acceso de equipo.', 'TEAM_INELIGIBLE');
  await assertConsent(memberUid, 'account', undefined, db, tx);
  await assertConsent(business.ownerUid, 'account', undefined, db, tx);
  if (!isSubscriptionAllowed(business, now)) throw new HttpError(402, 'Activa un plan para ampliar el equipo.', 'PAYMENT_REQUIRED');
}
function applied(event: TeamAccessEvent): TeamApplied {
  return { requestId: event.requestId, commandHash: event.commandHash, eventId: event.id, membershipRevision: event.membershipRevision, teamRevision: event.sequence, recordedAt: event.recordedAt };
}
async function receipt(tx: Transaction, businessId: string, actorUid: string, requestId: string, state: BusinessTeamState, db: Database, now: number): Promise<TeamAccessEvent | null> {
  const doc = await tx.get(db.collection('businesses').doc(businessId).collection('teamAccessEvents').doc(eventKey(businessId, actorUid, requestId)));
  if (!doc.exists) return null;
  const event = checkedEvent(doc, businessId, state, now);
  if (event.actorUid !== actorUid || event.requestId !== requestId) return unavailable(); return event;
}
function result(event: TeamAccessEvent, membership: BusinessTeamMembership, state: BusinessTeamState, owner: boolean, replayed: boolean): TeamMutationResult {
  if (event.membershipId !== membership.id || event.memberUid !== membership.memberUid || event.membershipRevision > membership.revision || event.recordedAt > membership.updatedAt) return unavailable();
  return parsed(teamMutationResultSchema, { audience: owner ? 'owner' : 'member', applied: applied(event), replayed, teamRevision: state.revision,
    current: owner ? toTeamOwnerMembership(membership) : toTeamSelfMembership(membership) });
}
const uidRateSchema = z.object({ version: z.literal(1), uid: teamUidSchema, requestEvents: z.array(z.object({ at: z.number().int().nonnegative().max(8640000000000000), requestHash: z.string().regex(/^[a-f0-9]{64}$/) }).strict()).max(5) }).strict()
  .refine(v => new Set(v.requestEvents.map(e => e.requestHash)).size === v.requestEvents.length);
async function rateAdmission(tx: Transaction, membership: BusinessTeamMembership | null, state: BusinessTeamState, uid: string, requestId: string, db: Database, now: number) {
  const ref = db.collection('serverSettings').doc(uidKey(uid)), doc = await tx.get(ref);
  const saved = doc.exists ? parsed(uidRateSchema, doc.data()) : { version: 1 as const, uid, requestEvents: [] };
  if (saved.uid !== uid) return unavailable(); checkRates(saved.requestEvents, now);
  const uidEvents = saved.requestEvents.filter(e => e.at > now - day), businessEvents = state.requestEvents.filter(e => e.at > now - day);
  const until = [membership && membership.lastRequestedAt + day > now ? membership.lastRequestedAt + day : 0,
    uidEvents.length >= 5 ? Math.min(...uidEvents.map(e => e.at)) + day : 0,
    businessEvents.length >= 30 ? Math.min(...businessEvents.map(e => e.at)) + day : 0];
  const retry = Math.max(...until);
  if (retry > now) throw new HttpError(429, 'Espera antes de solicitar otro acceso.', 'TEAM_REQUEST_LIMITED', Math.ceil((retry - now) / 1000));
  const event = { at: now, requestHash: sha256(JSON.stringify([uid, state.businessId, requestId])) };
  return { ref, uidState: { version: 1, uid, requestEvents: [...uidEvents, event] }, businessEvents: [...businessEvents, event] };
}
type Mutation = { actor: ChatActor; businessId: string; membershipId: string; memberUid: string; command: TeamAccessCanonicalCommand; owner: boolean };
async function mutate(tx: Transaction, input: Mutation, db: Database, now: number): Promise<TeamMutationResult> {
  const { actor, businessId, membershipId, memberUid, command, owner } = input;
  const { business, state, membership } = await readVerifiedTeamSnapshot(tx, businessId, memberUid, db, now);
  if (membershipId !== membershipKey(businessId, memberUid)) return unavailable();
  if (owner) assertOwner(business, actor.uid);
  else if (actor.uid !== memberUid) throw new HttpError(403, 'Solo puedes retirar tu propio acceso.');
  const existing = await receipt(tx, businessId, actor.uid, command.requestId, state, db, now);
  const commandHash = sha256(teamAccessCommandCanonicalString(command));
  if (existing) {
    // Target binding is separate from the canonical hash, which intentionally omits membershipId.
    if (existing.commandHash !== commandHash || existing.membershipId !== membershipId || existing.memberUid !== memberUid) return conflict('TEAM_REQUEST_REUSED');
    if (!membership) return unavailable(); return result(existing, membership, state, owner, true);
  }
  if ((membership?.revision ?? 0) !== command.expectedMembershipRevision || command.expectedTeamRevision !== null && state.revision !== command.expectedTeamRevision) return conflict();
  if (state.revision > Number.MAX_SAFE_INTEGER - 2 || (membership?.revision ?? 0) > Number.MAX_SAFE_INTEGER - 2) return unavailable();
  const kind = command.kind, before = membership?.status ?? null;
  if (kind === 'request' && business.ownerUid === memberUid || kind === 'approve' && business.ownerUid === memberUid) return conflict('TEAM_ALREADY_OWNER');
  if (kind === 'request' ? before !== null && before !== 'rejected' && before !== 'revoked'
    : kind === 'approve' || kind === 'reject' ? before !== 'requested'
      : kind === 'revoke' ? before !== 'active' : before !== 'requested' && before !== 'active') return conflict('TEAM_NO_CHANGE');
  if (kind === 'request' || kind === 'approve') await assertAdmission(tx, business, memberUid, db, now);
  if (kind === 'approve' && !business.resources.some(resource => resource.id === command.resourceId && resource.active)) return conflict('TEAM_RESOURCE_UNAVAILABLE');
  if (kind === 'request' && state.requestedCount >= 30 || kind === 'approve' && state.activeCount >= 30) return conflict('TEAM_CAPACITY');
  const rate = kind === 'request' ? await rateAdmission(tx, membership, state, memberUid, command.requestId, db, now) : null;
  const after = kind === 'request' ? 'requested' : kind === 'approve' ? 'active' : kind === 'reject' ? 'rejected' : 'revoked';
  const nextState = parsed(businessTeamStateSchema, { ...state, revision: nextTeamRevision(state.revision),
    requestedCount: state.requestedCount + (after === 'requested' ? 1 : 0) - (before === 'requested' ? 1 : 0),
    activeCount: state.activeCount + (after === 'active' ? 1 : 0) - (before === 'active' ? 1 : 0),
    requestEvents: rate?.businessEvents ?? state.requestEvents.filter(e => e.at > now - day) });
  const id = eventKey(businessId, actor.uid, command.requestId);
  const nextMembership = parsed(businessTeamMembershipSchema, { version: 1, id: membershipId, businessId, memberUid, status: after,
    revision: nextTeamRevision(membership?.revision ?? 0), role: kind === 'request' ? null : kind === 'approve' ? { id: 'own_agenda_viewer', version: 1 } : membership!.role,
    resourceId: kind === 'request' ? null : kind === 'approve' ? command.resourceId : membership!.resourceId,
    ownerUidAtApproval: kind === 'request' ? null : kind === 'approve' ? business.ownerUid : membership!.ownerUidAtApproval,
    businessLabel: kind === 'request' || kind === 'approve' ? business.name : membership!.businessLabel,
    createdAt: membership?.createdAt ?? now, updatedAt: now, lastRequestedAt: kind === 'request' ? now : membership!.lastRequestedAt, lastEventId: id });
  const event = parsed(teamAccessEventSchema, { version: 1, id, businessId, membershipId, memberUid, actorUid: actor.uid,
    requestId: command.requestId, commandHash, command, sequence: nextState.revision, membershipRevision: nextMembership.revision,
    beforeStatus: before, afterStatus: after, role: nextMembership.role, resourceId: nextMembership.resourceId, recordedAt: now });
  const response = result(event, nextMembership, nextState, owner, false);
  // Every read and validation precedes the first write, for both Firestore and D1.
  tx.set(db.collection('businessMemberships').doc(membershipId), nextMembership);
  tx.set(db.collection('serverSettings').doc(stateKey(businessId)), nextState);
  tx.create(db.collection('businesses').doc(businessId).collection('teamAccessEvents').doc(id), event);
  if (rate) tx.set(rate.ref, rate.uidState);
  return response;
}

export async function requestTeamAccess(actor: ChatActor, supplied: TeamSelfRequestCommand, db: Database = getAdminDb()): Promise<TeamMutationResult> {
  const input = teamSelfRequestCommandSchema.parse(supplied); teamUidSchema.parse(actor.uid);
  return db.runTransaction(async tx => {
    const business = await resolveSlug(tx, input.businessSlug, db); if (!business) throw new HttpError(404, 'El negocio no existe.');
    return mutate(tx, { actor, businessId: business.id, membershipId: membershipKey(business.id, actor.uid), memberUid: actor.uid, owner: false,
      command: { kind: 'request', businessId: business.id, actorUid: actor.uid, requestId: input.requestId, expectedMembershipRevision: input.expectedMembershipRevision, expectedTeamRevision: null, resourceId: null } }, db, Date.now());
  });
}
export async function decideTeamAccess(owner: ChatActor, businessId: string, membershipId: string, supplied: TeamOwnerDecisionCommand, db: Database = getAdminDb()): Promise<TeamMutationResult> {
  const input = teamOwnerDecisionCommandSchema.parse(supplied); teamUidSchema.parse(owner.uid); teamDocumentIdSchema.parse(businessId); teamDocumentIdSchema.parse(membershipId);
  return db.runTransaction(async tx => {
    const business = await readBusiness(tx, businessId, db); assertOwner(business, owner.uid);
    const doc = await tx.get(db.collection('businessMemberships').doc(membershipId)); if (!doc.exists) throw new HttpError(404, 'La membresía no existe.');
    const membership = parsed(businessTeamMembershipSchema, doc.data()); if (membership.businessId !== businessId) throw new HttpError(403, 'La membresía pertenece a otro negocio.');
    return mutate(tx, { actor: owner, businessId, membershipId, memberUid: membership.memberUid, owner: true,
      command: { kind: input.action, businessId, actorUid: owner.uid, requestId: input.requestId, expectedMembershipRevision: input.expectedMembershipRevision, expectedTeamRevision: input.expectedTeamRevision, resourceId: input.action === 'approve' ? input.resourceId : null } }, db, Date.now());
  });
}
export async function leaveTeamAccess(actor: ChatActor, membershipId: string, supplied: TeamLeaveCommand, db: Database = getAdminDb()): Promise<TeamMutationResult> {
  const input = teamLeaveCommandSchema.parse(supplied); teamUidSchema.parse(actor.uid); teamDocumentIdSchema.parse(membershipId);
  return db.runTransaction(async tx => {
    const doc = await tx.get(db.collection('businessMemberships').doc(membershipId)); if (!doc.exists) throw new HttpError(404, 'La membresía no existe.');
    const membership = parsed(businessTeamMembershipSchema, doc.data()); if (membership.memberUid !== actor.uid) throw new HttpError(403, 'Solo puedes retirar tu propio acceso.');
    return mutate(tx, { actor, businessId: membership.businessId, membershipId, memberUid: actor.uid, owner: false,
      command: { kind: 'leave', businessId: membership.businessId, actorUid: actor.uid, requestId: input.requestId, expectedMembershipRevision: input.expectedMembershipRevision, expectedTeamRevision: null, resourceId: null } }, db, Date.now());
  });
}

const ownInputSchema = z.object({ afterBusinessId: teamDocumentIdSchema.optional(), businessSlug: teamBusinessSlugSchema.optional(), requestId: teamRequestIdSchema.optional() }).strict()
  .refine(value => !(value.afterBusinessId && value.businessSlug) && (!value.requestId || Boolean(value.businessSlug)));
export async function readOwnTeamMemberships(actor: ChatActor, supplied: { afterBusinessId?: string; businessSlug?: string; requestId?: string }, db: Database = getAdminDb()): Promise<TeamMembershipPage> {
  teamUidSchema.parse(actor.uid); const input = ownInputSchema.parse(supplied);
  return db.runTransaction(async tx => {
    const now = Date.now();
    if (input.businessSlug) {
      const business = await resolveSlug(tx, input.businessSlug, db);
      if (!business) return teamMembershipPageSchema.parse({ mode: 'business', scopeUid: actor.uid, items: [], target: null, nextAfterBusinessId: null, serverNow: now, applied: null });
      const { state, membership } = await readVerifiedTeamSnapshot(tx, business.id, actor.uid, db, now);
      const event = input.requestId ? await receipt(tx, business.id, actor.uid, input.requestId, state, db, now) : null;
      if (event && (!membership || event.memberUid !== actor.uid || !['request', 'leave'].includes(event.command.kind) || event.membershipId !== membership.id || event.membershipRevision > membership.revision)) return unavailable();
      return parsed(teamMembershipPageSchema, { mode: 'business', scopeUid: actor.uid, items: membership ? [toTeamSelfMembership(membership)] : [], target: { businessId: business.id, businessName: business.name }, nextAfterBusinessId: null, serverNow: now, applied: event ? applied(event) : null });
    }
    let query = db.collection('businessMemberships').where('memberUid', '==', actor.uid).orderBy('businessId', 'asc');
    if (input.afterBusinessId) query = query.where('businessId', '>', input.afterBusinessId);
    const docs = await tx.get(query.limit(21)), members: BusinessTeamMembership[] = [];
    let previous = input.afterBusinessId ?? '';
    for (const doc of docs.docs) {
      const raw = parsed(businessTeamMembershipSchema, doc.data());
      if (raw.memberUid !== actor.uid || raw.businessId <= previous) return unavailable(); previous = raw.businessId;
      const value = checkedMembership(doc, raw.businessId, actor.uid, now); if (!value) return unavailable();
      const state = await readState(tx, raw.businessId, db, now); await readHead(tx, value, state, db, now); members.push(value);
    }
    return parsed(teamMembershipPageSchema, { mode: 'page', scopeUid: actor.uid, items: members.slice(0, 20).map(toTeamSelfMembership), target: null,
      nextAfterBusinessId: members.length > 20 ? members[19].businessId : null, serverNow: now, applied: null });
  });
}
export async function readOwnerBusinessTeam(owner: ChatActor, businessId: string, requestId?: string, db: Database = getAdminDb()): Promise<OwnerBusinessTeamView> {
  teamUidSchema.parse(owner.uid); teamDocumentIdSchema.parse(businessId); if (requestId !== undefined) teamRequestIdSchema.parse(requestId);
  return db.runTransaction(async tx => {
    const now = Date.now(), business = await readBusiness(tx, businessId, db); assertOwner(business, owner.uid);
    const state = await readState(tx, businessId, db, now), membershipCollection = db.collection('businessMemberships');
    const requested = await tx.get(membershipCollection.where('businessId', '==', businessId).where('status', '==', 'requested').limit(31));
    const active = await tx.get(membershipCollection.where('businessId', '==', businessId).where('status', '==', 'active').limit(31));
    if (requested.size >= 31 || active.size >= 31 || requested.size !== state.requestedCount || active.size !== state.activeCount) return unavailable();
    const readRows = async (docs: typeof requested, status: 'requested' | 'active') => {
      const rows: BusinessTeamMembership[] = [];
      for (const doc of docs.docs) {
        const raw = parsed(businessTeamMembershipSchema, doc.data()), value = checkedMembership(doc, businessId, raw.memberUid, now);
        if (!value || value.status !== status) return unavailable(); await readHead(tx, value, state, db, now); rows.push(value);
      }
      return rows.map(toTeamOwnerMembership);
    };
    const requestedRows = await readRows(requested, 'requested'), activeRows = await readRows(active, 'active');
    const docs = await tx.get(db.collection('businesses').doc(businessId).collection('teamAccessEvents').orderBy('sequence', 'desc').limit(20));
    const events = docs.docs.map(doc => checkedEvent(doc, businessId, state, now));
    // Only the bounded recent suffix is verified; no global history scan.
    if (events.length !== Math.min(20, state.revision) || events.some((event, index) => event.sequence !== state.revision - index)) return unavailable();
    const event = requestId ? await receipt(tx, businessId, owner.uid, requestId, state, db, now) : null;
    if (event && !['approve', 'reject', 'revoke'].includes(event.command.kind)) return unavailable();
    if (event) {
      const membership = checkedMembership(await tx.get(membershipCollection.doc(event.membershipId)), businessId, event.memberUid, now);
      if (!membership || event.membershipRevision > membership.revision || event.recordedAt > membership.updatedAt) return unavailable();
      await readHead(tx, membership, state, db, now);
    }
    return parsed(ownerBusinessTeamViewSchema, { businessId, ownerUid: business.ownerUid, teamRevision: state.revision, requested: requestedRows, active: activeRows,
      events: events.map(toTeamAccessEventView), serverNow: now, enabled: teamAccessEnabled(), eligible: await eligible(tx, business, db), applied: event ? applied(event) : null });
  });
}
