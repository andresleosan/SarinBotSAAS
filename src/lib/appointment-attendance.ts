import { z } from 'zod';
import type { Appointment } from '@/types/firestore';
import { documentIdSchema, requestIdSchema } from '@/lib/server/schemas';
import { isDateKey } from '@/lib/sarin/availability';

export class AttendanceModelError extends Error {
  constructor(readonly status: 409 | 503, readonly code: string) {
    super(code);
    this.name = 'AttendanceModelError';
  }
}

const revision = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER - 1);
const timestamp = z.number().int().positive().safe();
const sourceStatus = z.enum(['confirmed', 'completed', 'no_show']);
const targetStatus = z.enum(['completed', 'no_show']);
const uid = z.string().min(1).max(128);
const metadataSchema = z.object({ revision: revision.min(1), lastEventId: documentIdSchema }).strict();

export const appointmentAttendanceCommandSchema = z.object({
  requestId: requestIdSchema,
  expectedRevision: revision,
  expectedRescheduleRevision: revision,
  expectedStatus: sourceStatus,
  status: targetStatus,
  correctionReason: z.literal('recording_error').optional(),
}).strict().refine(command => command.expectedStatus === 'confirmed'
  ? command.correctionReason === undefined
  : command.correctionReason === 'recording_error', 'El motivo debe corresponder al resultado anterior.');

/** The boundary comes exclusively from the saved occurrence, never today's catalog. */
const sourceSchema = z.object({
  dateKey: z.string().refine(isDateKey), resourceId: documentIdSchema,
  startAt: timestamp, endAt: timestamp, reservedUntilAt: timestamp, rescheduleRevision: revision,
}).strict().refine(source => {
  const start = new Date(source.startAt - 5 * 3600000);
  return Number.isFinite(start.getTime()) && start.toISOString().slice(0, 10) === source.dateKey
    && source.startAt < source.endAt && source.endAt <= source.reservedUntilAt;
}, 'No se pudo verificar el horario guardado.');

export const appointmentAttendanceEventSchema = z.object({
  schemaVersion: z.literal(1), businessId: documentIdSchema, appointmentId: documentIdSchema,
  actorUid: uid, requestId: requestIdSchema, requestFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  sequence: revision.min(1), previousStatus: sourceStatus, status: targetStatus,
  recordedAt: timestamp, reason: z.enum(['initial', 'recording_error']), legacyPreviousOutcome: z.boolean(),
  source: sourceSchema,
}).strict().refine(event => event.previousStatus !== event.status
  && event.recordedAt >= event.source.reservedUntilAt
  && (event.previousStatus === 'confirmed' ? event.reason === 'initial' && !event.legacyPreviousOutcome : event.reason === 'recording_error')
  && event.legacyPreviousOutcome === (event.previousStatus !== 'confirmed' && event.sequence === 1), 'No se pudo verificar el evento de resultado.');

export const appointmentAttendanceCursorSchema = z.string().regex(/^[1-9]\d*$/).transform(Number).pipe(revision.min(1));

export type AttendanceStatus = z.infer<typeof targetStatus>;
/** Core delivery: clearing to confirmed remains deferred until its composed integration. */
export type AttendanceTargetStatus = AttendanceStatus;
export type AttendanceSourceStatus = z.infer<typeof sourceStatus>;
export type AttendanceCommand = z.infer<typeof appointmentAttendanceCommandSchema>;
export type AppointmentAttendanceMetadata = z.infer<typeof metadataSchema>;
export type AppointmentAttendanceEvent = z.infer<typeof appointmentAttendanceEventSchema>;
export type AttendanceHistoryPage = { appointment: Appointment; events: AppointmentAttendanceEvent[]; nextBeforeRevision: number | null };
export type AttendanceUpdateResult = {
  appointment: Appointment;
  applied: { eventId: string; requestId: string; revision: number; status: AttendanceTargetStatus; recordedAt: number };
  replayed: boolean;
};

const unverifiable = () => new AttendanceModelError(503, 'ATTENDANCE_RECORD_UNVERIFIABLE');

export function readAttendanceMetadata(appointment: Appointment): AppointmentAttendanceMetadata | null {
  if (!Object.prototype.hasOwnProperty.call(appointment, 'attendance')) return null;
  const metadata = metadataSchema.safeParse(appointment.attendance);
  if (!metadata.success) throw unverifiable();
  return metadata.data;
}

/** Pure validation shared by owner UI and server; authorization and event heads stay server-side. */
export function assertAttendanceTransition(appointment: Appointment, command: AttendanceCommand, now: number): void {
  const metadata = readAttendanceMetadata(appointment);
  if (appointment.type !== 'appointment' || !sourceStatus.safeParse(appointment.status).success) {
    throw new AttendanceModelError(409, 'ATTENDANCE_UNSUPPORTED');
  }
  if (!documentIdSchema.safeParse(appointment.id).success || !documentIdSchema.safeParse(appointment.tenantId).success
    || !sourceSchema.safeParse({ dateKey: appointment.dateKey, resourceId: appointment.resourceId,
      startAt: appointment.startAt, endAt: appointment.endAt, reservedUntilAt: appointment.reservedUntilAt,
      rescheduleRevision: appointment.rescheduleRevision === undefined ? 0 : appointment.rescheduleRevision }).success
    || !timestamp.safeParse(now).success
    || (appointment.client !== undefined && (!appointment.client || !uid.safeParse(appointment.client.uid).success))) {
    throw unverifiable();
  }
  if (!appointmentAttendanceCommandSchema.safeParse(command).success) throw new AttendanceModelError(409, 'ATTENDANCE_UNSUPPORTED');
  if ((metadata?.revision ?? 0) !== command.expectedRevision
    || (appointment.rescheduleRevision ?? 0) !== command.expectedRescheduleRevision
    || appointment.status !== command.expectedStatus) throw new AttendanceModelError(409, 'ATTENDANCE_SOURCE_CHANGED');
  // Persisting MAX_SAFE_INTEGER would create a head the reader cannot accept.
  if ((metadata?.revision ?? 0) >= Number.MAX_SAFE_INTEGER - 1) throw unverifiable();
  if (appointment.status === command.status) throw new AttendanceModelError(409, 'ATTENDANCE_NO_CHANGE');
  if (now < appointment.reservedUntilAt) throw new AttendanceModelError(409, 'ATTENDANCE_TOO_EARLY');
}
