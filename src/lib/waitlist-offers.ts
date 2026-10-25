import { z } from 'zod';
import type { BookingCapability, BookingSubjectCase } from '@/lib/booking-subject';
import { ownerWaitlistDetailSchema } from '@/lib/owner-waitlist';
import { ownerRescheduleAppointmentSchema } from '@/lib/owner-rescheduling';
import { isDateKey, toColombiaTimestamp } from '@/lib/sarin/calendar-time';

const clean = (value: string) => !/[\x00-\x1f\x7f]/.test(value);
export const waitlistOfferDocumentIdSchema = z.string().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/).refine(value => clean(value) && !['__proto__', 'prototype', 'constructor'].includes(value));
export const waitlistOfferUidSchema = z.string().min(1).max(128).refine(clean);
export const waitlistOfferRequestIdSchema = waitlistOfferDocumentIdSchema.refine(value => value.length >= 8);
export const waitlistOfferRevisionSchema = z.number().int().nonnegative().safe().max(Number.MAX_SAFE_INTEGER - 1);
export const waitlistOfferTimestampSchema = z.number().int().nonnegative().safe().max(8_640_000_000_000_000);
export const waitlistOfferFingerprintSchema = z.string().length(64).regex(/^[a-f0-9]{64}$/);
const id = waitlistOfferDocumentIdSchema, uid = waitlistOfferUidSchema, requestId = waitlistOfferRequestIdSchema;
const revision = waitlistOfferRevisionSchema, timestamp = waitlistOfferTimestampSchema;
const incrementable = revision.max(Number.MAX_SAFE_INTEGER - 2);
const date = z.string().refine(isDateKey);
const time = z.string().length(5).regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
const endTime = z.union([time, z.literal('24:00')]);
const label = z.string().min(1).max(120).refine(clean);
const price = z.number().finite().nonnegative().max(100_000_000);
export const waitlistOfferIntakeFieldsSchema = z.array(z.object({ key: id, label, required: z.boolean() }).strict()).max(20)
  .refine(fields => new Set(fields.map(field => field.key)).size === fields.length);
export const waitlistOfferSelfCaseSchema = z.object({ bookingRequestId: requestId, subjectKind: z.literal('self') }).strict();
export const waitlistOfferStateSchema = z.enum(['offered', 'withdrawn', 'declined', 'expired', 'booked']);
export const waitlistOfferUsabilitySchema = z.enum(['ready', 'consent_changed', 'request_changed', 'policy_changed', 'catalog_changed', 'schedule_changed', 'slot_unavailable', 'expired_pending_close', 'disabled']);
export const waitlistOfferTargetSchema = z.object({
  serviceId: id, serviceName: label, resourceId: id, resourceName: label, dateKey: date,
  startTimeStr: time, endTimeStr: endTime, startAt: timestamp, endAt: timestamp, reservedUntilAt: timestamp,
  durationMinutes: z.number().int().min(5).max(720), bufferMinutes: z.number().int().min(0).max(180), priceCOP: price,
}).strict().refine(value => {
  if (!isDateKey(value.dateKey) || !time.safeParse(value.startTimeStr).success || !endTime.safeParse(value.endTimeStr).success) return false;
  const midnight = toColombiaTimestamp(value.dateKey, '00:00');
  return value.startAt === toColombiaTimestamp(value.dateKey, value.startTimeStr)
    && value.endAt === (value.endTimeStr === '24:00' ? midnight + 86_400_000 : toColombiaTimestamp(value.dateKey, value.endTimeStr))
    && value.endAt - value.startAt === value.durationMinutes * 60_000
    && value.reservedUntilAt - value.endAt === value.bufferMinutes * 60_000 && value.reservedUntilAt <= midnight + 86_400_000;
});
export const ownerWaitlistOfferCommandSchema = z.object({ requestId, entryId: id, expectedWaitlistRevision: incrementable.min(1), expectedHeadRevision: incrementable,
  selection: z.object({ resourceId: id, startTimeStr: time }).strict(),
}).strict();
export const waitlistOfferProposalCommandSchema = z.object({ requestId }).strict();
// Fresh contact is validated after booked replay has been considered.
export const waitlistOfferConfirmCommandSchema = z.object({ confirm: z.literal(true), clientPhone: z.unknown(), intakeAnswers: z.unknown() }).strict();
export const waitlistOfferWithdrawCommandSchema = z.object({ withdraw: z.literal(true) }).strict();
export const waitlistOfferDeclineCommandSchema = z.object({ decline: z.literal(true) }).strict();
export const waitlistOfferCloseExpiredCommandSchema = z.object({ closeExpired: z.literal(true) }).strict();
export const waitlistOfferSummarySchema = z.object({ id, businessId: id, waitlistRecordId: id, entryId: id, createdAt: timestamp, expiresAt: timestamp,
  persistedState: waitlistOfferStateSchema, target: waitlistOfferTargetSchema,
}).strict().refine(value => value.createdAt < value.expiresAt && value.expiresAt <= Math.min(value.createdAt + 600_000, value.target.startAt));
export const waitlistOfferBookingProofSchema = z.object({ appointmentId: id, proposalId: id, entryId: id, previousWaitlistRevision: incrementable.min(1), resolvedWaitlistRevision: revision.min(2), confirmedAt: timestamp,
  source: z.object({ dateKey: date, startAt: timestamp, endAt: timestamp, reservedUntilAt: timestamp, resourceId: id, serviceId: id }).strict(),
}).strict().refine(value => isDateKey(value.source.dateKey) && value.resolvedWaitlistRevision === value.previousWaitlistRevision + 1 && value.confirmedAt < value.source.startAt
  && value.source.startAt < value.source.endAt && value.source.endAt <= value.source.reservedUntilAt
  && value.source.startAt >= toColombiaTimestamp(value.source.dateKey, '00:00') && value.source.reservedUntilAt <= toColombiaTimestamp(value.source.dateKey, '00:00') + 86_400_000);
const bookingProposalViewSchema = z.object({ id, businessId: id, serviceName: label, resourceName: label, dateKey: date, startTimeStr: time, endTimeStr: endTime,
  priceCOP: price, expiresAt: timestamp, intakeFields: waitlistOfferIntakeFieldsSchema, subjectCase: waitlistOfferSelfCaseSchema,
}).strict();
export const waitlistOfferProposalViewSchema = z.object({ offerId: id, entryId: id, proposal: bookingProposalViewSchema }).strict();
const recoveryShape = { businessId: id, viewerUid: uid, serverNow: timestamp, writesEnabled: z.boolean(), offer: waitlistOfferSummarySchema,
  usability: waitlistOfferUsabilitySchema.nullable(), proposal: waitlistOfferProposalViewSchema.nullable(), proof: waitlistOfferBookingProofSchema.nullable() };
type RecoveryFields = z.infer<z.ZodObject<typeof recoveryShape>>;
function validRecovery(value: RecoveryFields): boolean {
  const { offer, proposal, proof } = value, target = offer.target;
  if (offer.businessId !== value.businessId || offer.createdAt > value.serverNow || (offer.persistedState === 'offered') !== (value.usability !== null)
    || (offer.persistedState === 'booked') !== (proof !== null)) return false;
  if (proof && (proof.entryId !== offer.entryId || proof.confirmedAt < offer.createdAt || proof.confirmedAt >= offer.expiresAt || proof.confirmedAt > value.serverNow
    || proof.source.dateKey !== target.dateKey || proof.source.resourceId !== target.resourceId || proof.source.serviceId !== target.serviceId
    || proof.source.startAt !== target.startAt || proof.source.endAt !== target.endAt || proof.source.reservedUntilAt !== target.reservedUntilAt)) return false;
  if (proposal) {
    const p = proposal.proposal;
    if (proposal.offerId !== offer.id || proposal.entryId !== offer.entryId || p.businessId !== offer.businessId || p.expiresAt !== offer.expiresAt
      || p.dateKey !== target.dateKey || p.startTimeStr !== target.startTimeStr || p.endTimeStr !== target.endTimeStr
      || p.serviceName !== target.serviceName || p.resourceName !== target.resourceName || p.priceCOP !== target.priceCOP || proof && proof.proposalId !== p.id) return false;
  }
  return true;
}
export const waitlistOfferRecoverySchema = z.object(recoveryShape).strict().refine(validRecovery);
export const ownerWaitlistOfferRecoverySchema = z.object({ ...recoveryShape, proposal: z.null() }).strict().refine(validRecovery);
export const clientWaitlistOfferRecoverySchema = z.object({ ...recoveryShape, appointment: ownerRescheduleAppointmentSchema.nullable() }).strict().refine(value => validRecovery(value)
  && (value.offer.persistedState === 'booked' ? value.proof !== null && value.appointment !== null && value.appointment.id === value.proof.appointmentId
    && value.appointment.tenantId === value.businessId && value.appointment.client?.uid === value.viewerUid : value.appointment === null));
export const ownerWaitlistOfferContextSchema = z.object({ detail: ownerWaitlistDetailSchema, headRevision: revision, currentOffer: ownerWaitlistOfferRecoverySchema.nullable(),
  writesEnabled: z.boolean(), eligible: z.boolean(), reason: z.enum(['restricted_policy', 'not_available', 'disabled']).nullable(),
}).strict().refine(value => value.eligible === (value.reason === null) && (!value.eligible || value.writesEnabled && value.detail.state === 'available' && value.detail.row.subjectKind === 'self')
  && (value.reason !== 'disabled' || !value.writesEnabled) && (!value.currentOffer || value.currentOffer.businessId === value.detail.businessId
    && value.currentOffer.viewerUid === value.detail.ownerUid && value.currentOffer.serverNow === value.detail.serverNow && value.currentOffer.writesEnabled === value.writesEnabled));
export const ownerWaitlistOfferResultSchema = z.object({ recovery: ownerWaitlistOfferRecoverySchema, appliedHeadRevision: revision.min(1), headRevision: revision.min(1), replayed: z.boolean() }).strict()
  .refine(value => value.appliedHeadRevision <= value.headRevision && (value.replayed || value.appliedHeadRevision === value.headRevision));
export const clientWaitlistOfferCurrentSchema = z.object({ businessId: id, viewerUid: uid, serverNow: timestamp, headRevision: revision, current: clientWaitlistOfferRecoverySchema.nullable() }).strict()
  .refine(value => !value.current || value.headRevision > 0 && value.current.businessId === value.businessId && value.current.viewerUid === value.viewerUid && value.current.serverNow === value.serverNow);
export const ownerWaitlistOfferCursorSchema = z.object({ offerId: id, createdAt: timestamp }).strict();
export const ownerWaitlistOfferQuerySchema = z.object({ dateKey: date, filter: z.enum(['all', 'offered', 'booked']), cursor: ownerWaitlistOfferCursorSchema.optional() }).strict();
export function compareOwnerWaitlistOffers(a: Pick<WaitlistOfferSummary, 'createdAt' | 'id'>, b: Pick<WaitlistOfferSummary, 'createdAt' | 'id'>): number {
  return b.createdAt - a.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}
export const ownerWaitlistOfferPageSchema = z.object({ businessId: id, viewerUid: uid, serverNow: timestamp, dateKey: date, filter: ownerWaitlistOfferQuerySchema.shape.filter,
  rows: z.array(waitlistOfferSummarySchema).max(20), nextCursor: ownerWaitlistOfferCursorSchema.nullable(),
}).strict().refine(value => {
  if (new Set(value.rows.map(row => row.id)).size !== value.rows.length || value.rows.some((row, index) => row.businessId !== value.businessId || row.target.dateKey !== value.dateKey
    || row.createdAt > value.serverNow || value.filter !== 'all' && row.persistedState !== value.filter || index > 0 && compareOwnerWaitlistOffers(value.rows[index - 1], row) >= 0)) return false;
  const last = value.rows.at(-1);
  return !value.nextCursor || value.rows.length === 20 && last?.id === value.nextCursor.offerId && last.createdAt === value.nextCursor.createdAt;
});
export const waitlistOfferCloseResultSchema = z.object({ businessId: id, viewerUid: uid, offerId: id, persistedState: waitlistOfferStateSchema, proof: waitlistOfferBookingProofSchema.nullable() }).strict()
  .refine(value => (value.persistedState === 'booked') === (value.proof !== null));
export const waitlistOfferConfirmationSchema = z.object({ proof: waitlistOfferBookingProofSchema, appointment: ownerRescheduleAppointmentSchema, replayed: z.boolean() }).strict()
  .refine(value => value.appointment.id === value.proof.appointmentId);

export type WaitlistOfferState = z.infer<typeof waitlistOfferStateSchema>;
export type WaitlistOfferUsability = z.infer<typeof waitlistOfferUsabilitySchema>;
export type WaitlistOfferTarget = z.infer<typeof waitlistOfferTargetSchema>;
export type WaitlistOfferSummary = z.infer<typeof waitlistOfferSummarySchema>;
export type WaitlistOfferBookingProof = z.infer<typeof waitlistOfferBookingProofSchema>;
export type WaitlistOfferProposalView = z.infer<typeof waitlistOfferProposalViewSchema>;
export type WaitlistOfferRecovery = z.infer<typeof waitlistOfferRecoverySchema>;
export type OwnerWaitlistOfferRecovery = z.infer<typeof ownerWaitlistOfferRecoverySchema>;
export type ClientWaitlistOfferRecovery = z.infer<typeof clientWaitlistOfferRecoverySchema>;
export type OwnerWaitlistOfferContext = z.infer<typeof ownerWaitlistOfferContextSchema>;
export type OwnerWaitlistOfferResult = z.infer<typeof ownerWaitlistOfferResultSchema>;
export type ClientWaitlistOfferCurrent = z.infer<typeof clientWaitlistOfferCurrentSchema>;
export type OwnerWaitlistOfferCursor = z.infer<typeof ownerWaitlistOfferCursorSchema>;
export type OwnerWaitlistOfferQuery = z.infer<typeof ownerWaitlistOfferQuerySchema>;
export type OwnerWaitlistOfferPage = z.infer<typeof ownerWaitlistOfferPageSchema>;
export type WaitlistOfferCloseResult = z.infer<typeof waitlistOfferCloseResultSchema>;
export type WaitlistOfferConfirmation = z.infer<typeof waitlistOfferConfirmationSchema>;
export type OwnerWaitlistOfferCommand = z.infer<typeof ownerWaitlistOfferCommandSchema>;
export class WaitlistOfferModelError extends Error { constructor() { super('No se pudo verificar la oferta de espera.'); } }
export function waitlistOfferExpiry(createdAt: number, requestExpiresAt: number, startAt: number): number {
  if (![createdAt, requestExpiresAt, startAt].every(value => timestamp.safeParse(value).success)) throw new WaitlistOfferModelError();
  const expiresAt = Math.min(createdAt + 600_000, requestExpiresAt, startAt);
  if (expiresAt <= createdAt) throw new WaitlistOfferModelError();
  return expiresAt;
}
/** This boundary is not a substitute for transactional authorization/availability. */
export function waitlistOfferEligible(capability: BookingCapability, subjectCase: BookingSubjectCase): boolean {
  return capability.configured && capability.dataMode === 'general' && !capability.representedMinorsEnabled && subjectCase.subjectKind === 'self';
}
