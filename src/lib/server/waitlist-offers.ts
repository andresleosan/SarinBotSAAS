import 'server-only';
import { z } from 'zod';
import type { ValidatedBookingSubject } from '@/lib/booking-subject';
import { SERVICE_CATEGORY_MAX_LENGTH, SERVICE_DESCRIPTION_MAX_LENGTH } from '@/lib/service-catalog';
import {
  WaitlistOfferModelError, waitlistOfferDocumentIdSchema as id, waitlistOfferUidSchema as uid, waitlistOfferRequestIdSchema as requestId,
  waitlistOfferRevisionSchema as revision, waitlistOfferTimestampSchema as timestamp, waitlistOfferFingerprintSchema as fingerprint,
  waitlistOfferIntakeFieldsSchema, waitlistOfferSelfCaseSchema, waitlistOfferTargetSchema, waitlistOfferBookingProofSchema,
  waitlistOfferSummarySchema, waitlistOfferProposalViewSchema, ownerWaitlistOfferCommandSchema,
  type OwnerWaitlistOfferCommand, type WaitlistOfferSummary, type WaitlistOfferProposalView,
} from '@/lib/waitlist-offers';
import { stableDocumentId } from './businesses';
import { bookingSubjectHash } from './booking-subject-consent';
import { waitlistDocumentId, type WaitlistRecord } from './waitlist';

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
