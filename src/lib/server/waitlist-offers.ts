import 'server-only';
import { HttpError } from './http';
import { z } from 'zod';
import type { ChatActor } from '@/types/chat';
import type { Business, Appointment } from '@/types/firestore';
import type { Database, Transaction, Query, QueryDocumentSnapshot } from '@/lib/storage/types';
import { getAdminDb } from '@/lib/firebase/admin';
import { getAvailableSlots, toColombiaTimestamp, toMinutes, toTimeStr } from '@/lib/sarin/availability';
import { isSubscriptionAllowed } from '@/lib/sarin/subscription';
import { ownerRescheduleAppointmentSchema } from '@/lib/owner-rescheduling';
import type { ValidatedBookingSubject } from '@/lib/booking-subject';
import { SERVICE_CATEGORY_MAX_LENGTH, SERVICE_DESCRIPTION_MAX_LENGTH } from '@/lib/service-catalog';
import {
  WaitlistOfferModelError, waitlistOfferDocumentIdSchema as id, waitlistOfferUidSchema as uid, waitlistOfferRequestIdSchema as requestId,
  waitlistOfferRevisionSchema as revision, waitlistOfferTimestampSchema as timestamp, waitlistOfferFingerprintSchema as fingerprint,
  waitlistOfferIntakeFieldsSchema, waitlistOfferSelfCaseSchema, waitlistOfferTargetSchema, waitlistOfferBookingProofSchema,
  waitlistOfferSummarySchema, waitlistOfferProposalViewSchema, ownerWaitlistOfferCommandSchema,
  type OwnerWaitlistOfferCommand, type WaitlistOfferSummary, type WaitlistOfferProposalView,
  ownerWaitlistOfferQuerySchema, ownerWaitlistOfferPageSchema, ownerWaitlistOfferRecoverySchema, clientWaitlistOfferRecoverySchema,
  ownerWaitlistOfferContextSchema, ownerWaitlistOfferResultSchema, clientWaitlistOfferCurrentSchema, waitlistOfferCloseResultSchema,
  waitlistOfferEligible, waitlistOfferExpiry, compareOwnerWaitlistOffers,
  type OwnerWaitlistOfferQuery, type OwnerWaitlistOfferPage, type OwnerWaitlistOfferRecovery, type ClientWaitlistOfferRecovery,
  type OwnerWaitlistOfferContext, type OwnerWaitlistOfferResult, type ClientWaitlistOfferCurrent, type WaitlistOfferCloseResult, type WaitlistOfferUsability,
} from '@/lib/waitlist-offers';
import { stableDocumentId, assertOwner } from './businesses';
import { bookingSubjectHash } from './booking-subject-consent';
import { waitlistDocumentId, parseCanonicalWaitlistRecord, readOwnerWaitlistProjection, readWaitlistProjectionInTransaction, type WaitlistRecord } from './waitlist';
import { readOwnerWaitlistDetailInTransaction } from './owner-waitlist';
import { readBookingDataPolicy } from './booking-data-policy';
import { readResourceSchedulePolicy, resourceDayScheduleFingerprint } from './resource-schedules';
import { assertConsent } from './consent';
import { prepareBookingActionAdmission } from './booking-action-admission';

export const waitlistOfferHeadSchema = z.object({ version: z.literal(1), businessId: id, waitlistRecordId: id, revision: revision.min(1), entryId: id, currentOfferId: id }).strict();
export type WaitlistOfferHead = z.infer<typeof waitlistOfferHeadSchema>;
export function readWaitlistOfferHead(value: unknown, scope: { businessId: string; waitlistRecordId: string }): { revision: number; entryId: string | null; currentOfferId: string | null } {
  id.parse(scope.businessId); id.parse(scope.waitlistRecordId);
  if (value === undefined) return { revision: 0, entryId: null, currentOfferId: null };
  const parsed = waitlistOfferHeadSchema.safeParse(value);
  if (!parsed.success || parsed.data.businessId !== scope.businessId || parsed.data.waitlistRecordId !== scope.waitlistRecordId) throw new WaitlistOfferModelError();
  return { revision: parsed.data.revision, entryId: parsed.data.entryId, currentOfferId: parsed.data.currentOfferId };
}
export const waitlistOfferProposalSchema = z.object({ id, requestId, createdAt: timestamp, expiresAt: timestamp, subjectCase: waitlistOfferSelfCaseSchema,
  catalogFingerprint: fingerprint, resourceScheduleFingerprint: fingerprint, policyRevision: revision,
}).strict().refine(value => value.createdAt < value.expiresAt && value.subjectCase.bookingRequestId === value.requestId);
export type WaitlistOfferProposal = z.infer<typeof waitlistOfferProposalSchema>;
const catalogLabel = z.string().min(1).max(120).refine(value => !/[\x00-\x1f\x7f]/.test(value));
export const waitlistOfferCatalogSchema = z.object({
  service: z.object({ id, name: catalogLabel, description: z.string().max(SERVICE_DESCRIPTION_MAX_LENGTH).optional(), category: z.string().max(SERVICE_CATEGORY_MAX_LENGTH).optional(),
    durationMinutes: z.number().int().min(5).max(720), bufferMinutes: z.number().int().min(0).max(180), price: z.number().finite().nonnegative().max(100_000_000), resourceIds: z.array(id).min(1).max(30),
  }).strict().refine(value => new Set(value.resourceIds).size === value.resourceIds.length),
  resource: z.object({ id, name: catalogLabel, active: z.literal(true) }).strict(), intakeFields: waitlistOfferIntakeFieldsSchema,
}).strict();
const base = {
  version: z.literal(1), id, businessId: id, waitlistRecordId: id, entryId: id, waitlistRevision: revision.min(1).max(Number.MAX_SAFE_INTEGER - 2), headRevisionAtCreation: revision.min(1),
  clientUid: uid, ownerActorUid: uid, requestId, commandFingerprint: fingerprint, requestFingerprint: fingerprint,
  dateKey: waitlistOfferTargetSchema.shape.dateKey, createdAt: timestamp, expiresAt: timestamp,
  target: waitlistOfferTargetSchema.safeExtend({ intakeFields: waitlistOfferIntakeFieldsSchema }), catalog: waitlistOfferCatalogSchema,
  catalogFingerprint: fingerprint, resourceScheduleFingerprint: fingerprint, policyRevision: revision, proposal: waitlistOfferProposalSchema.nullable(),
};
const terminal = { closedAt: timestamp, closedByUid: uid };
// Refinements also run after continuable child issues; derive without throwing
// and leave identifier rejection to the field schemas above.
const proposalIdFor = (businessId: string, offerId: string, clientUid: string, commandId: string) => stableDocumentId('waitlist-offer-proposal', businessId, offerId, clientUid, commandId);
export const waitlistOfferRecordSchema = z.discriminatedUnion('state', [
  z.object({ ...base, state: z.literal('offered'), closedAt: z.null(), closedReason: z.null(), closedByUid: z.null(), booking: z.null() }).strict(),
  z.object({ ...base, state: z.literal('withdrawn'), ...terminal, closedReason: z.literal('withdrawn'), booking: z.null() }).strict(),
  z.object({ ...base, state: z.literal('declined'), ...terminal, closedReason: z.literal('declined'), booking: z.null() }).strict(),
  z.object({ ...base, state: z.literal('expired'), ...terminal, closedReason: z.literal('expired'), booking: z.null() }).strict(),
  z.object({ ...base, state: z.literal('booked'), ...terminal, closedReason: z.literal('booked'), proposal: waitlistOfferProposalSchema, booking: waitlistOfferBookingProofSchema }).strict(),
]).refine(value => {
  const { target, catalog, proposal, booking } = value, { service, resource } = catalog;
  if (value.dateKey !== target.dateKey || value.createdAt >= value.expiresAt || value.expiresAt > Math.min(value.createdAt + 600_000, target.startAt)
    || target.serviceId !== service.id || target.serviceName !== service.name || target.resourceId !== resource.id || target.resourceName !== resource.name
    || !service.resourceIds.includes(resource.id) || target.durationMinutes !== service.durationMinutes || target.bufferMinutes !== service.bufferMinutes || target.priceCOP !== service.price
    || bookingSubjectHash(target.intakeFields) !== bookingSubjectHash(catalog.intakeFields)) return false;
  if (value.closedAt !== null && (value.closedAt < value.createdAt || proposal && value.closedAt < proposal.createdAt || value.state === 'expired' && value.closedAt < value.expiresAt)) return false;
  if (proposal && (proposal.createdAt < value.createdAt || proposal.expiresAt !== value.expiresAt || proposal.catalogFingerprint !== value.catalogFingerprint
    || proposal.resourceScheduleFingerprint !== value.resourceScheduleFingerprint || proposal.policyRevision !== value.policyRevision
    || proposal.id !== proposalIdFor(value.businessId, value.id, value.clientUid, proposal.requestId))) return false;
  if (booking && (booking.entryId !== value.entryId || booking.proposalId !== proposal?.id || booking.previousWaitlistRevision !== value.waitlistRevision
    || booking.confirmedAt !== value.closedAt || booking.confirmedAt < proposal!.createdAt || booking.confirmedAt >= value.expiresAt
    || booking.source.dateKey !== target.dateKey || booking.source.startAt !== target.startAt || booking.source.endAt !== target.endAt
    || booking.source.reservedUntilAt !== target.reservedUntilAt || booking.source.serviceId !== target.serviceId || booking.source.resourceId !== target.resourceId)) return false;
  return true;
});
export type WaitlistOfferRecord = z.infer<typeof waitlistOfferRecordSchema>;
export function waitlistOfferId(businessId: string, entryId: string, ownerUid: string, commandId: string): string {
  id.parse(businessId); id.parse(entryId); uid.parse(ownerUid); requestId.parse(commandId);
  return stableDocumentId('waitlist-offer', businessId, entryId, ownerUid, commandId);
}
export function waitlistOfferProposalId(businessId: string, offerId: string, clientUid: string, commandId: string): string {
  id.parse(businessId); id.parse(offerId); uid.parse(clientUid); requestId.parse(commandId);
  return proposalIdFor(businessId, offerId, clientUid, commandId);
}
export function waitlistOfferCommandFingerprint(businessId: string, ownerUid: string, command: OwnerWaitlistOfferCommand): string {
  id.parse(businessId); uid.parse(ownerUid);
  return bookingSubjectHash({ businessId, ownerActorUid: ownerUid, ...ownerWaitlistOfferCommandSchema.parse(command) });
}
export function waitlistOfferRequestFingerprint(record: Pick<WaitlistRecord, 'revision' | 'request'>): string {
  if (!record.request) throw new WaitlistOfferModelError();
  revision.min(1).parse(record.revision);
  return bookingSubjectHash({ revision: record.revision, request: record.request });
}
export function parseCanonicalWaitlistOffer(offerId: string, value: unknown, businessId: string): WaitlistOfferRecord {
  const parsed = waitlistOfferRecordSchema.safeParse(value);
  if (!parsed.success) throw new WaitlistOfferModelError();
  const offer = parsed.data;
  if (offer.businessId !== businessId || offer.id !== offerId || offer.id !== waitlistOfferId(businessId, offer.entryId, offer.ownerActorUid, offer.requestId)
    || offer.waitlistRecordId !== waitlistDocumentId(offer.clientUid, businessId) || offer.catalogFingerprint !== bookingSubjectHash(offer.catalog)
    || offer.commandFingerprint !== waitlistOfferCommandFingerprint(businessId, offer.ownerActorUid, { requestId: offer.requestId, entryId: offer.entryId,
      expectedWaitlistRevision: offer.waitlistRevision, expectedHeadRevision: offer.headRevisionAtCreation - 1,
      selection: { resourceId: offer.target.resourceId, startTimeStr: offer.target.startTimeStr } })) throw new WaitlistOfferModelError();
  return offer;
}
/** Rejoin can reuse entryId; revision and normalized request hash identify its incarnation. */
export function currentHeadMatchesWaitlist(head: WaitlistOfferHead, offer: WaitlistOfferRecord, current: { entryId: string; waitlistRevision: number; requestFingerprint: string } | null): boolean {
  if (head.businessId !== offer.businessId || head.waitlistRecordId !== offer.waitlistRecordId || head.entryId !== offer.entryId || head.currentOfferId !== offer.id || head.revision !== offer.headRevisionAtCreation) return false;
  return current === null ? offer.state === 'booked' : offer.entryId === current.entryId && offer.waitlistRevision === current.waitlistRevision && offer.requestFingerprint === current.requestFingerprint;
}
export function newWaitlistOfferSubject(proposal: WaitlistOfferProposal): ValidatedBookingSubject {
  const parsed = waitlistOfferProposalSchema.parse(proposal);
  return { case: parsed.subjectCase, beneficiary: { kind: 'self' }, proposalId: parsed.id, authorization: null };
}
export function projectWaitlistOfferSummary(offer: WaitlistOfferRecord): WaitlistOfferSummary {
  const { intakeFields: _fields, ...target } = offer.target;
  return waitlistOfferSummarySchema.parse({ id: offer.id, businessId: offer.businessId, waitlistRecordId: offer.waitlistRecordId, entryId: offer.entryId,
    createdAt: offer.createdAt, expiresAt: offer.expiresAt, persistedState: offer.state, target });
}
export function projectWaitlistOfferProposal(offer: WaitlistOfferRecord): WaitlistOfferProposalView | null {
  const { proposal, target } = offer;
  return proposal ? waitlistOfferProposalViewSchema.parse({ offerId: offer.id, entryId: offer.entryId, proposal: { id: proposal.id, businessId: offer.businessId,
    serviceName: target.serviceName, resourceName: target.resourceName, dateKey: target.dateKey, startTimeStr: target.startTimeStr, endTimeStr: target.endTimeStr,
    priceCOP: target.priceCOP, expiresAt: proposal.expiresAt, intakeFields: target.intakeFields, subjectCase: proposal.subjectCase } }) : null;
}

const writesEnabled = () => process.env.SARIN_WAITLIST_OFFERS_ENABLED === 'true';
const unverifiable = () => new HttpError(503, 'No se pudo verificar la oferta de espera.', 'WAITLIST_OFFER_UNVERIFIABLE');
const conflict = (code = 'OFFER_CHANGED') => new HttpError(409, 'La oferta o la solicitud cambiaron. Vuelve a consultar.', code);
const notFound = () => new HttpError(404, 'La oferta no está disponible.');
const businessRef = (db: Database, businessId: string) => db.collection('businesses').doc(businessId);
const offersRef = (db: Database, businessId: string) => businessRef(db, businessId).collection('waitlistOffers');
function scope(actor: ChatActor, businessId: string) { uid.parse(actor.uid); id.parse(businessId); }
function verified<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw unverifiable();
  return parsed.data;
}
async function guarded<T>(action: () => Promise<T>): Promise<T> {
  // This guard surrounds runTransaction, so DATA_CONFLICT reaches adapter retries.
  try { return await action(); }
  catch (error) {
    if (error instanceof HttpError && (error.status !== 503 || error.code === 'WAITLIST_OFFERS_DISABLED')) throw error;
    throw unverifiable();
  }
}
async function readBusiness(tx: Transaction, actor: ChatActor, businessId: string, access: 'owner' | 'client', db: Database): Promise<Business> {
  const doc = await tx.get(businessRef(db, businessId));
  if (!doc.exists) throw notFound();
  const raw = doc.data()!;
  if (access === 'owner') assertOwner(raw as Business, actor.uid);
  verified(z.object({ id: z.literal(businessId), ownerUid: uid }), raw);
  return raw as Business;
}
async function readOffer(tx: Transaction, businessId: string, offerId: string, db: Database): Promise<WaitlistOfferRecord> {
  const doc = await tx.get(offersRef(db, businessId).doc(offerId));
  if (!doc.exists) throw notFound();
  return parseCanonicalWaitlistOffer(offerId, doc.data(), businessId);
}
async function readRequest(tx: Transaction, businessId: string, recordId: string, db: Database): Promise<WaitlistRecord | null> {
  const doc = await tx.get(businessRef(db, businessId).collection('waitlistRequests').doc(recordId));
  return doc.exists ? parseCanonicalWaitlistRecord(recordId, doc.data(), businessId) : null;
}
async function readHead(tx: Transaction, businessId: string, recordId: string, db: Database) {
  const ref = businessRef(db, businessId).collection('waitlistOfferHeads').doc(recordId), doc = await tx.get(ref);
  const view = readWaitlistOfferHead(doc.exists ? doc.data() : undefined, { businessId, waitlistRecordId: recordId });
  if (!doc.exists) return { ref, view, head: null, offer: null };
  const head = verified(waitlistOfferHeadSchema, doc.data());
  const offerDoc = await tx.get(offersRef(db, businessId).doc(head.currentOfferId));
  if (!offerDoc.exists) throw unverifiable();
  const offer = parseCanonicalWaitlistOffer(offerDoc.id, offerDoc.data(), businessId);
  if (head.waitlistRecordId !== offer.waitlistRecordId || head.entryId !== offer.entryId || head.revision !== offer.headRevisionAtCreation) throw unverifiable();
  return { ref, view, head, offer };
}
const requestIdentity = (record: WaitlistRecord | null) => record?.request ? { entryId: record.request.id, waitlistRevision: record.revision, requestFingerprint: waitlistOfferRequestFingerprint(record) } : null;
function matchingCurrent(head: Awaited<ReturnType<typeof readHead>>, record: WaitlistRecord | null): WaitlistOfferRecord | null {
  return head.head && head.offer && currentHeadMatchesWaitlist(head.head, head.offer, requestIdentity(record)) ? head.offer : null;
}
function catalogFor(business: Business, serviceId: string, resourceId: string) {
  const service = business.services.find(item => item.id === serviceId), resource = business.resources.find(item => item.id === resourceId);
  if (!service || !resource?.active || !service.resourceIds.includes(resourceId)) return null;
  return verified(waitlistOfferCatalogSchema, { service, resource: { id: resource.id, name: resource.name, active: resource.active }, intakeFields: business.sarinConfig.intakeFields });
}
async function usability(tx: Transaction, business: Business, offer: WaitlistOfferRecord, db: Database): Promise<WaitlistOfferUsability | null> {
  if (offer.state !== 'offered') return null;
  const record = await readRequest(tx, business.id, offer.waitlistRecordId, db), head = await readHead(tx, business.id, offer.waitlistRecordId, db);
  if (!head.head) throw unverifiable();
  const same = matchingCurrent(head, record)?.id === offer.id;
  if (same && record?.request && offer.expiresAt !== waitlistOfferExpiry(offer.createdAt, record.request.expiresAt, offer.target.startAt)) throw unverifiable();
  if (Date.now() >= offer.expiresAt) return 'expired_pending_close';
  if (!same) return 'request_changed';
  // This is a read-only data principal. It cannot authorize owner/client mutation.
  const current = await readWaitlistProjectionInTransaction(tx, { uid: offer.clientUid }, business.id, db);
  const { capability } = await readBookingDataPolicy(business.id, db, tx);
  const catalog = catalogFor(business, offer.target.serviceId, offer.target.resourceId);
  const schedule = await readResourceSchedulePolicy(tx, business.id, db);
  const scheduleFingerprint = resourceDayScheduleFingerprint(business, schedule, offer.target.resourceId, offer.dateKey);
  const now = Date.now();
  if (now >= offer.expiresAt) return 'expired_pending_close';
  if (business.ownerUid !== offer.ownerActorUid || capability.revision !== offer.policyRevision || !record?.request || !waitlistOfferEligible(capability, record.request.case)) return 'policy_changed';
  const reason = current.state.request?.reason;
  if (reason === 'consent_changed') return 'consent_changed';
  if (!catalog || bookingSubjectHash(catalog) !== offer.catalogFingerprint) return 'catalog_changed';
  if (scheduleFingerprint !== offer.resourceScheduleFingerprint) return 'schedule_changed';
  if (!business.sarinConfig.onboardingCompleted || !business.slug || !isSubscriptionAllowed(business, now) || current.state.request?.status === 'suspended') return 'policy_changed';
  if (!current.availability.some(row => row.resourceId === offer.target.resourceId && row.slots.includes(offer.target.startTimeStr))) return 'slot_unavailable';
  return writesEnabled() ? 'ready' : 'disabled';
}
function ownerRecovery(actor: ChatActor, offer: WaitlistOfferRecord, status: WaitlistOfferUsability | null, now: number): OwnerWaitlistOfferRecovery {
  return verified(ownerWaitlistOfferRecoverySchema, { businessId: offer.businessId, viewerUid: actor.uid, serverNow: now, writesEnabled: writesEnabled(),
    offer: projectWaitlistOfferSummary(offer), usability: offer.state === 'offered' && now >= offer.expiresAt ? 'expired_pending_close' : status, proposal: null, proof: offer.booking });
}
async function clientRecovery(tx: Transaction, actor: ChatActor, business: Business, offer: WaitlistOfferRecord, db: Database): Promise<ClientWaitlistOfferRecovery> {
  if (offer.clientUid !== actor.uid) throw notFound();
  const status = await usability(tx, business, offer, db);
  let appointment: Appointment | null = null;
  if (offer.state === 'booked') {
    const doc = await tx.get(businessRef(db, business.id).collection('appointments').doc(offer.booking.appointmentId));
    if (!doc.exists) throw unverifiable();
    appointment = verified(ownerRescheduleAppointmentSchema, doc.data());
    if (appointment.id !== offer.booking.appointmentId || appointment.tenantId !== business.id || appointment.client?.uid !== actor.uid) throw unverifiable();
  }
  const serverNow = Date.now();
  return verified(clientWaitlistOfferRecoverySchema, { businessId: business.id, viewerUid: actor.uid, serverNow, writesEnabled: writesEnabled(),
    offer: projectWaitlistOfferSummary(offer), usability: offer.state === 'offered' && serverNow >= offer.expiresAt ? 'expired_pending_close' : status,
    proposal: projectWaitlistOfferProposal(offer), proof: offer.booking, appointment });
}
export async function createOwnerWaitlistOffer(owner: ChatActor, businessId: string, recordId: string, supplied: OwnerWaitlistOfferCommand, db: Database = getAdminDb()): Promise<OwnerWaitlistOfferResult> {
  scope(owner, businessId); id.parse(recordId); const input = ownerWaitlistOfferCommandSchema.parse(supplied);
  const offerId = waitlistOfferId(businessId, input.entryId, owner.uid, input.requestId), commandFingerprint = waitlistOfferCommandFingerprint(businessId, owner.uid, input);
  return guarded(() => db.runTransaction(async tx => {
    const business = await readBusiness(tx, owner, businessId, 'owner', db);
    const record = await readRequest(tx, businessId, recordId, db), head = await readHead(tx, businessId, recordId, db);
    const ref = offersRef(db, businessId).doc(offerId), previous = await tx.get(ref);
    if (previous.exists) {
      const offer = parseCanonicalWaitlistOffer(offerId, previous.data(), businessId);
      if (offer.ownerActorUid !== owner.uid || offer.waitlistRecordId !== recordId || offer.commandFingerprint !== commandFingerprint) throw conflict('OFFER_REQUEST_REUSED');
      if (!head.head || head.view.revision < offer.headRevisionAtCreation) throw unverifiable();
      const status = await usability(tx, business, offer, db);
      return verified(ownerWaitlistOfferResultSchema, { recovery: ownerRecovery(owner, offer, status, Date.now()), appliedHeadRevision: offer.headRevisionAtCreation, headRevision: head.view.revision, replayed: true });
    }
    if (!writesEnabled()) throw new HttpError(503, 'Las nuevas ofertas están en pausa.', 'WAITLIST_OFFERS_DISABLED');
    if (!record?.request || record.request.id !== input.entryId || record.revision !== input.expectedWaitlistRevision || head.view.revision !== input.expectedHeadRevision) throw conflict();
    if (head.view.revision >= Number.MAX_SAFE_INTEGER - 1) throw unverifiable();
    const current = await readOwnerWaitlistProjection(tx, owner, businessId, recordId, db);
    await assertConsent(owner.uid, 'account', undefined, db, tx);
    const { capability } = await readBookingDataPolicy(businessId, db, tx);
    if (!waitlistOfferEligible(capability, record.request.case)) throw conflict();
    if (current.state.request?.reason === 'consent_changed') throw new HttpError(428, 'Revisa los permisos actuales de la solicitud.', 'CONSENT_REQUIRED');
    if (!business.sarinConfig.onboardingCompleted || !business.slug) throw new HttpError(403, 'El negocio todavía no está configurado.');
    if (!isSubscriptionAllowed(business)) throw new HttpError(402, 'Las nuevas reservas están en pausa.');
    if (current.state.request?.reason === 'client_blocked') throw new HttpError(403, 'La cuenta no puede reservar en este negocio.', 'CLIENT_BLOCKED');
    if (current.state.request?.reason === 'client_limit') throw conflict('CLIENT_BOOKING_LIMIT');
    if (current.state.request?.status !== 'available') throw conflict('SLOT_UNAVAILABLE');
    if (record.request.resourceId && record.request.resourceId !== input.selection.resourceId) throw conflict('SLOT_UNAVAILABLE');
    const catalog = catalogFor(business, record.request.serviceId, input.selection.resourceId);
    if (!catalog) throw conflict('SLOT_UNAVAILABLE');
    const schedule = await readResourceSchedulePolicy(tx, businessId, db);
    const appointments = await tx.get(businessRef(db, businessId).collection('appointments').where('dateKey', '==', record.request.dateKey).where('status', '==', 'confirmed').orderBy('dateKey'));
    const admit = await prepareBookingActionAdmission(tx, db, owner.uid, businessId, 'proposal', `waitlist-offer-owner:${input.entryId}:${input.requestId}`);
    // Final clock follows every read, including admission. No read follows apply.
    const now = Date.now(), request = record.request;
    if (request.expiresAt <= now) throw conflict();
    if (!business.sarinConfig.onboardingCompleted || !business.slug) throw new HttpError(403, 'El negocio todavía no está configurado.');
    if (!isSubscriptionAllowed(business, now)) throw new HttpError(402, 'Las nuevas reservas están en pausa.');
    const slots = getAvailableSlots({ tenant: business, resourceSchedulePolicy: schedule, dateKey: request.dateKey, serviceId: request.serviceId,
      resourceId: input.selection.resourceId, existingAppointments: appointments.docs.map(doc => doc.data() as Appointment), now });
    if (!slots.some(row => row.resourceId === input.selection.resourceId && row.slots.includes(input.selection.startTimeStr))) throw conflict('SLOT_UNAVAILABLE');
    if (head.offer?.state === 'offered' && now < head.offer.expiresAt) throw conflict('OFFER_EXISTS');
    const service = catalog.service, resource = catalog.resource, startAt = toColombiaTimestamp(request.dateKey, input.selection.startTimeStr);
    const endAt = startAt + service.durationMinutes * 60000;
    const target = { serviceId: service.id, serviceName: service.name, resourceId: resource.id, resourceName: resource.name, dateKey: request.dateKey,
      startTimeStr: input.selection.startTimeStr, endTimeStr: toTimeStr(toMinutes(input.selection.startTimeStr) + service.durationMinutes), startAt, endAt,
      reservedUntilAt: endAt + service.bufferMinutes * 60000, durationMinutes: service.durationMinutes, bufferMinutes: service.bufferMinutes, priceCOP: service.price, intakeFields: catalog.intakeFields };
    const next = parseCanonicalWaitlistOffer(offerId, { version: 1, id: offerId, businessId, waitlistRecordId: recordId, entryId: input.entryId,
      waitlistRevision: record.revision, headRevisionAtCreation: head.view.revision + 1, clientUid: record.ownerUid, ownerActorUid: owner.uid,
      requestId: input.requestId, commandFingerprint, requestFingerprint: waitlistOfferRequestFingerprint(record), dateKey: request.dateKey, createdAt: now,
      expiresAt: waitlistOfferExpiry(now, request.expiresAt, startAt), target, catalog, catalogFingerprint: bookingSubjectHash(catalog),
      resourceScheduleFingerprint: resourceDayScheduleFingerprint(business, schedule, resource.id, request.dateKey), policyRevision: capability.revision,
      state: 'offered', proposal: null, booking: null, closedAt: null, closedReason: null, closedByUid: null }, businessId);
    const result = verified(ownerWaitlistOfferResultSchema, { recovery: ownerRecovery(owner, next, 'ready', now), appliedHeadRevision: next.headRevisionAtCreation, headRevision: next.headRevisionAtCreation, replayed: false });
    const nextHead = verified(waitlistOfferHeadSchema, { version: 1, businessId, waitlistRecordId: recordId, revision: next.headRevisionAtCreation, entryId: input.entryId, currentOfferId: next.id });
    const expired = head.offer?.state === 'offered' ? closedOffer(head.offer, 'expired', owner.uid, now) : null;
    admit();
    if (expired) tx.set(offersRef(db, businessId).doc(expired.id), expired);
    tx.create(ref, next); tx.set(head.ref, nextHead);
    return result;
  }));
}
export async function readOwnerWaitlistOffers(owner: ChatActor, businessId: string, supplied: OwnerWaitlistOfferQuery, db: Database = getAdminDb()): Promise<OwnerWaitlistOfferPage> {
  scope(owner, businessId); const input = ownerWaitlistOfferQuerySchema.parse(supplied);
  return guarded(() => db.runTransaction(async tx => {
    await readBusiness(tx, owner, businessId, 'owner', db);
    const cursor = input.cursor, ref = offersRef(db, businessId);
    if (cursor) {
      const doc = await tx.get(ref.doc(cursor.offerId));
      if (!doc.exists) throw conflict();
      const offer = parseCanonicalWaitlistOffer(doc.id, doc.data(), businessId);
      if (offer.dateKey !== input.dateKey || offer.createdAt !== cursor.createdAt || input.filter !== 'all' && offer.state !== input.filter) throw conflict();
    }
    const dated = ref.where('dateKey', '==', input.dateKey), base = input.filter === 'all' ? dated : dated.where('state', '==', input.filter);
    const records: WaitlistOfferRecord[] = [], seen = new Set<string>();
    const append = (docs: QueryDocumentSnapshot[], cap: number, block: 'first' | 'tail' | 'older') => {
      if (docs.length > cap) throw unverifiable();
      for (const doc of docs) {
        const offer = parseCanonicalWaitlistOffer(doc.id, doc.data(), businessId), previous = records.at(-1);
        if (offer.dateKey !== input.dateKey || input.filter !== 'all' && offer.state !== input.filter || seen.has(offer.id)
          || previous && compareOwnerWaitlistOffers(previous, offer) >= 0
          || cursor && (compareOwnerWaitlistOffers({ id: cursor.offerId, createdAt: cursor.createdAt }, offer) >= 0
            || block === 'tail' && offer.createdAt !== cursor.createdAt || block === 'older' && offer.createdAt >= cursor.createdAt)) throw unverifiable();
        seen.add(offer.id); records.push(offer);
      }
    };
    const query = async (target: Query, cap: number, block: 'first' | 'tail' | 'older') => append((await tx.get(target.limit(cap))).docs, cap, block);
    if (!cursor) await query(base.orderBy('createdAt', 'desc').orderBy('id', 'asc'), 21, 'first');
    else {
      await query(base.where('createdAt', '==', cursor.createdAt).where('id', '>', cursor.offerId).orderBy('id', 'asc'), 21, 'tail');
      if (records.length < 21) await query(base.where('createdAt', '<', cursor.createdAt).orderBy('createdAt', 'desc').orderBy('id', 'asc'), 21 - records.length, 'older');
    }
    const serverNow = Date.now();
    if (records.some(offer => offer.createdAt > serverNow)) throw unverifiable();
    const rows = records.slice(0, 20).map(projectWaitlistOfferSummary), last = rows.at(-1);
    return verified(ownerWaitlistOfferPageSchema, { businessId, viewerUid: owner.uid, serverNow, dateKey: input.dateKey, filter: input.filter, rows,
      nextCursor: records.length > 20 && last ? { offerId: last.id, createdAt: last.createdAt } : null });
  }));
}
export async function readOwnerWaitlistOffer(owner: ChatActor, businessId: string, offerId: string, db: Database = getAdminDb()): Promise<OwnerWaitlistOfferRecovery> {
  scope(owner, businessId); id.parse(offerId);
  return guarded(() => db.runTransaction(async tx => {
    const business = await readBusiness(tx, owner, businessId, 'owner', db), offer = await readOffer(tx, businessId, offerId, db);
    const status = await usability(tx, business, offer, db), now = Date.now();
    return ownerRecovery(owner, offer, status, now);
  }));
}
export async function readOwnerWaitlistOfferContext(owner: ChatActor, businessId: string, recordId: string, db: Database = getAdminDb()): Promise<OwnerWaitlistOfferContext> {
  scope(owner, businessId); id.parse(recordId);
  return guarded(() => db.runTransaction(async tx => {
    const detail = await readOwnerWaitlistDetailInTransaction(tx, owner, businessId, recordId, db);
    const business = await readBusiness(tx, owner, businessId, 'owner', db), record = await readRequest(tx, businessId, recordId, db);
    if (!record?.request) throw conflict();
    const head = await readHead(tx, businessId, recordId, db), offer = matchingCurrent(head, record);
    const { capability } = await readBookingDataPolicy(businessId, db, tx);
    const selected = business.services.find(item => item.id === record.request!.serviceId);
    const service = selected ? verified(ownerWaitlistOfferContextSchema.shape.service, { serviceId: selected.id, serviceName: selected.name, durationMinutes: selected.durationMinutes, bufferMinutes: selected.bufferMinutes, priceCOP: selected.price }) : null;
    const status = offer ? await usability(tx, business, offer, db) : null;
    const now = Date.now(), enabled = writesEnabled();
    const reason = !enabled ? 'disabled' : !waitlistOfferEligible(capability, record.request.case) ? 'restricted_policy' : detail.state !== 'available' || !service || record.request.expiresAt <= now ? 'not_available' : null;
    return verified(ownerWaitlistOfferContextSchema, { detail: { ...detail, serverNow: now }, headRevision: head.view.revision, service,
      currentOffer: offer ? ownerRecovery(owner, offer, status, now) : null,
      writesEnabled: enabled, eligible: reason === null, reason });
  }));
}
export async function readCurrentClientWaitlistOffer(client: ChatActor, businessId: string, db: Database = getAdminDb()): Promise<ClientWaitlistOfferCurrent> {
  scope(client, businessId);
  return guarded(() => db.runTransaction(async tx => {
    const business = await readBusiness(tx, client, businessId, 'client', db), recordId = waitlistDocumentId(client.uid, businessId);
    const record = await readRequest(tx, businessId, recordId, db), head = await readHead(tx, businessId, recordId, db);
    const offer = matchingCurrent(head, record);
    if (head.offer && head.offer.clientUid !== client.uid) throw unverifiable();
    const current = offer ? await clientRecovery(tx, client, business, offer, db) : null;
    const serverNow = Date.now();
    return verified(clientWaitlistOfferCurrentSchema, { businessId, viewerUid: client.uid, serverNow, headRevision: head.view.revision,
      current: current ? { ...current, serverNow, usability: offer!.state === 'offered' && serverNow >= offer!.expiresAt ? 'expired_pending_close' : current.usability } : null });
  }));
}
export async function readClientWaitlistOffer(client: ChatActor, businessId: string, offerId: string, db: Database = getAdminDb()): Promise<ClientWaitlistOfferRecovery> {
  scope(client, businessId); id.parse(offerId);
  return guarded(() => db.runTransaction(async tx => {
    const business = await readBusiness(tx, client, businessId, 'client', db), offer = await readOffer(tx, businessId, offerId, db);
    return clientRecovery(tx, client, business, offer, db);
  }));
}
function closedOffer(offer: WaitlistOfferRecord, state: 'withdrawn' | 'declined' | 'expired', actorUid: string, now: number): WaitlistOfferRecord {
  return parseCanonicalWaitlistOffer(offer.id, { ...offer, state, closedAt: now, closedReason: state, closedByUid: actorUid }, offer.businessId);
}
async function closeOffer(actor: ChatActor, businessId: string, offerId: string, access: 'owner' | 'client', action: 'withdrawn' | 'declined' | 'expired', db: Database) {
  scope(actor, businessId); id.parse(offerId);
  return guarded(() => db.runTransaction(async tx => {
    const business = await readBusiness(tx, actor, businessId, access, db), offer = await readOffer(tx, businessId, offerId, db);
    if (access === 'client' && offer.clientUid !== actor.uid) throw notFound();
    // Terminal recovery may read the current own appointment; all of it precedes writes.
    if (offer.state !== 'offered') {
      return { offer, recovery: access === 'owner' ? ownerRecovery(actor, offer, null, Date.now()) : await clientRecovery(tx, actor, business, offer, db) };
    }
    const now = Date.now();
    if (action === 'expired' && now < offer.expiresAt) throw conflict('OFFER_NOT_EXPIRED');
    const next = closedOffer(offer, action, actor.uid, now);
    const recovery = access === 'owner' ? ownerRecovery(actor, next, null, now) : verified(clientWaitlistOfferRecoverySchema, {
      businessId, viewerUid: actor.uid, serverNow: now, writesEnabled: writesEnabled(), offer: projectWaitlistOfferSummary(next), usability: null,
      proposal: projectWaitlistOfferProposal(next), proof: null, appointment: null });
    tx.set(offersRef(db, businessId).doc(offer.id), next);
    return { offer: next, recovery };
  }));
}
export async function withdrawOwnerWaitlistOffer(owner: ChatActor, businessId: string, offerId: string, db: Database = getAdminDb()): Promise<OwnerWaitlistOfferRecovery> {
  return verified(ownerWaitlistOfferRecoverySchema, (await closeOffer(owner, businessId, offerId, 'owner', 'withdrawn', db)).recovery);
}
export async function declineClientWaitlistOffer(client: ChatActor, businessId: string, offerId: string, db: Database = getAdminDb()): Promise<ClientWaitlistOfferRecovery> {
  return verified(clientWaitlistOfferRecoverySchema, (await closeOffer(client, businessId, offerId, 'client', 'declined', db)).recovery);
}
export async function closeExpiredWaitlistOffer(actor: ChatActor, businessId: string, offerId: string, access: 'owner' | 'client', db: Database = getAdminDb()): Promise<WaitlistOfferCloseResult> {
  if (access !== 'owner' && access !== 'client') throw new HttpError(400, 'Acceso inválido.');
  const { offer } = await closeOffer(actor, businessId, offerId, access, 'expired', db);
  return verified(waitlistOfferCloseResultSchema, { businessId, viewerUid: actor.uid, offerId, persistedState: offer.state, proof: offer.booking });
}
