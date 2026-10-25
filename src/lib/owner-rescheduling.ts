import { z } from 'zod';
import type { Appointment } from '@/types/firestore';
import { rescheduleSelectionSchema, rescheduleResultSchema } from '@/lib/appointment-reschedule';
import { isDateKey, toColombiaTimestamp } from '@/lib/sarin/calendar-time';

const noControls = (value: string) => !/[\u0000-\u001f\u007f]/.test(value);
const id = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/).refine(noControls);
const requestId = z.string().regex(/^[A-Za-z0-9_-]{8,128}$/).refine(noControls);
const revision = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER - 1);
const sourceRevision = revision.max(Number.MAX_SAFE_INTEGER - 2);
const timestamp = z.number().int().positive().safe();
const hash = z.string().regex(/^[a-f0-9]{64}$/).length(64);
const dateKey = z.string().refine(isDateKey);
const time = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/).length(5);
const endTime = z.union([time, z.literal('24:00')]);
const expectationSchema = z.object({ sourceRevision, sourceFingerprint: hash }).strict();

/** Saved times are verified in Colombia, independently of the current catalog. */
function validInterval(value: { dateKey: string; startTimeStr: string; endTimeStr: string; startAt: number; endAt: number; reservedUntilAt: number }): boolean {
  if (!isDateKey(value.dateKey) || !Number.isFinite(new Date(value.endAt).getTime())) return false;
  const end = new Date(value.endAt - 5 * 3600000);
  return value.startAt === toColombiaTimestamp(value.dateKey, value.startTimeStr)
    && value.startAt < value.endAt && value.endAt <= value.reservedUntilAt
    && (value.endTimeStr === '24:00'
      ? value.endAt === toColombiaTimestamp(value.dateKey, '00:00') + 86400000
      : value.endTimeStr === end.toISOString().slice(11, 16) && end.getUTCSeconds() === 0 && end.getUTCMilliseconds() === 0);
}
const intervalShape = { dateKey, startTimeStr: time, endTimeStr: endTime, startAt: timestamp, endAt: timestamp, reservedUntilAt: timestamp, resourceId: id };

export const ownerRescheduleAppointmentSchema = z.object({
  ...intervalShape, id, tenantId: id, type: z.enum(['appointment', 'manual_block']),
  status: z.enum(['confirmed', 'cancelled_by_client', 'cancelled_by_owner', 'completed', 'no_show']),
  serviceId: id.optional(), serviceName: z.string().optional(), price: z.number().finite().nonnegative().optional(),
  rescheduleRevision: revision.optional(), lastRescheduleProposalId: id.optional(), rescheduledAt: timestamp.optional(),
}).passthrough().refine(validInterval, 'No se pudo verificar el horario guardado.').transform(value => value as unknown as Appointment);

export const ownerRescheduleCommandSchema = expectationSchema.extend({ requestId, selection: rescheduleSelectionSchema }).strict();
export const ownerRescheduleAvailabilitySchema = expectationSchema.extend({ dateKey, resourceId: id.optional() }).strict();
export const ownerRescheduleSourceSchema = z.object({
  appointment: ownerRescheduleAppointmentSchema, expectation: expectationSchema,
  eligible: z.boolean(), reason: z.enum(['restricted_policy', 'source_started', 'unsupported_source', 'service_unavailable', 'subscription_unavailable', 'business_unconfigured']).nullable(),
}).strict().refine(value => value.expectation.sourceRevision === (value.appointment.rescheduleRevision ?? 0)
  && value.eligible === (value.reason === null), 'No se pudo verificar el origen.');

export const ownerRescheduleProposalViewSchema = z.object({
  id, businessId: id, appointmentId: id, requestId, sourceRevision, sourceFingerprint: hash, expiresAt: timestamp,
  source: z.object({ ...intervalShape, resourceName: z.string().min(1), priceCOP: z.number().finite().nonnegative().nullable() }).strict().refine(validInterval),
  target: z.object({ ...intervalShape, serviceId: id, serviceName: z.string().min(1), resourceName: z.string().min(1),
    durationMinutes: z.number().int().positive().safe(), bufferMinutes: z.number().int().nonnegative().safe(), priceCOP: z.number().finite().nonnegative(),
  }).strict().refine(value => validInterval(value) && value.endAt - value.startAt === value.durationMinutes * 60000
    && value.reservedUntilAt - value.endAt === value.bufferMinutes * 60000),
}).strict();

function currentMatchesProof(appointment: Appointment, result: z.infer<typeof rescheduleResultSchema>) {
  const currentRevision = appointment.rescheduleRevision ?? 0;
  return appointment.id === result.appointmentId && currentRevision >= result.revision
    && result.startAt > 0 && result.endAt > result.startAt
    && result.startAt === toColombiaTimestamp(result.dateKey, result.startTimeStr)
    && (currentRevision > result.revision || (appointment.dateKey === result.dateKey && appointment.resourceId === result.resourceId
      && appointment.startAt === result.startAt && appointment.endAt === result.endAt));
}
export const ownerRescheduleRecoverySchema = z.object({
  proposal: ownerRescheduleProposalViewSchema, state: z.enum(['prepared', 'closed', 'applied']),
  appointment: ownerRescheduleAppointmentSchema, result: rescheduleResultSchema.nullable(),
}).strict().refine(value => {
  if (value.appointment.id !== value.proposal.appointmentId || value.appointment.tenantId !== value.proposal.businessId) return false;
  if (value.state !== 'applied') return value.result === null;
  const result = value.result, target = value.proposal.target;
  return result !== null && result.proposalId === value.proposal.id && result.revision === value.proposal.sourceRevision + 1
    && result.dateKey === target.dateKey && result.resourceId === target.resourceId && result.startTimeStr === target.startTimeStr
    && result.startAt === target.startAt && result.endAt === target.endAt && currentMatchesProof(value.appointment, result);
}, 'No se pudo verificar la prueba del cambio.');
export const ownerRescheduleConfirmationSchema = z.object({
  appointment: ownerRescheduleAppointmentSchema, rescheduleResult: rescheduleResultSchema, replayed: z.boolean(),
}).strict().refine(value => currentMatchesProof(value.appointment, value.rescheduleResult), 'No se pudo verificar el resultado.');

export type OwnerRescheduleExpectation = z.infer<typeof expectationSchema>;
export type OwnerRescheduleTarget = z.infer<typeof rescheduleSelectionSchema>;
export type OwnerRescheduleCommand = z.infer<typeof ownerRescheduleCommandSchema>;
export type OwnerRescheduleSource = z.infer<typeof ownerRescheduleSourceSchema>;
export type OwnerRescheduleIneligibility = NonNullable<OwnerRescheduleSource['reason']>;
export type OwnerRescheduleProposalView = z.infer<typeof ownerRescheduleProposalViewSchema>;
export type OwnerRescheduleRecovery = z.infer<typeof ownerRescheduleRecoverySchema>;
export type OwnerRescheduleConfirmation = z.infer<typeof ownerRescheduleConfirmationSchema>;
export type OwnerRescheduleEntry = { appointmentId: string } | { proposalId: string };
export type AvailabilitySlots = { resourceId: string; resourceName: string; slots: string[] }[];

export function parseOwnerRescheduleReference(search: string): { proposalId: string | null; error: string | null } {
  const values = new URLSearchParams(search).getAll('ownerReschedule');
  if (!values.length) return { proposalId: null, error: null };
  if (values.length !== 1 || !id.safeParse(values[0]).success) return { proposalId: null, error: 'El enlace de cambio de horario no es válido.' };
  return { proposalId: values[0], error: null };
}
