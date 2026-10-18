import { z } from 'zod';
import type { Business, PublicBusiness } from '@/types/firestore';
import { getBusinessAccess } from '@/lib/sarin/subscription';
import { isDateKey } from '@/lib/sarin/availability';
import { bookingSubjectCaseSchema } from '@/lib/booking-subject';

const documentId = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
const revision = z.number().int().nonnegative().safe();
const dateKey = z.string().refine(isDateKey, 'Fecha inválida.');
const time = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
export const rescheduleSelectionSchema = z.object({ dateKey, startTimeStr: time, resourceId: documentId }).strict();
export const appointmentRescheduleAvailabilitySchema = z.object({ appointmentId: documentId, sourceRevision: revision, dateKey, resourceId: documentId.optional(), case: bookingSubjectCaseSchema.optional() }).strict();
export const appointmentRescheduleProposalSchema = z.object({ appointmentId: documentId, sourceRevision: revision, requestId: z.string().regex(/^[A-Za-z0-9_-]{8,128}$/), selection: rescheduleSelectionSchema, case: bookingSubjectCaseSchema.optional() }).strict();
export const appointmentRescheduleViewSchema = z.object({
  appointmentId: documentId, sourceRevision: revision,
  source: z.object({ dateKey, startTimeStr: time, endTimeStr: time, resourceId: documentId, resourceName: z.string().optional(), priceCOP: z.number().finite().nonnegative().optional() }).strict(),
  targetServiceId: documentId, targetResourceId: documentId,
}).strict();
export const rescheduleResultSchema = z.object({ proposalId: documentId, appointmentId: documentId, revision: revision.min(1), dateKey, startTimeStr: time, resourceId: documentId, startAt: revision, endAt: revision, confirmedAt: revision }).strict();
export type RescheduleSelection = z.infer<typeof rescheduleSelectionSchema>;
export type AppointmentRescheduleAvailabilityInput = z.infer<typeof appointmentRescheduleAvailabilitySchema>;
export type AppointmentRescheduleProposalInput = z.infer<typeof appointmentRescheduleProposalSchema>;
export type AppointmentRescheduleView = z.infer<typeof appointmentRescheduleViewSchema>;
export type RescheduleResult = z.infer<typeof rescheduleResultSchema>;

export function canRescheduleSubscription(business: Business | PublicBusiness | null | undefined, now = Date.now()): boolean {
  return ['subscription', 'paid_trial', 'trial_exhausted'].includes(getBusinessAccess(business, now));
}
