import 'server-only';
import { createHash } from 'node:crypto';
import type { z } from 'zod';
import type { Appointment, Business } from '@/types/firestore';
import type { ChatActor } from '@/types/chat';
import type { Database, Transaction } from '@/lib/storage/types';
import {
  AttendanceModelError, appointmentAttendanceCommandSchema, appointmentAttendanceCursorSchema, appointmentAttendanceEventSchema,
  assertAttendanceTransition, readAttendanceMetadata,
  type AttendanceCommand, type AttendanceHistoryPage, type AttendanceUpdateResult, type AppointmentAttendanceEvent,
} from '@/lib/appointment-attendance';
import { getAdminDb } from '@/lib/firebase/admin';
import { assertOwner, stableDocumentId } from './businesses';
import { assertConsent } from './consent';
import { appointmentRescheduleRevision } from './appointment-rescheduling';
import { clientPolicyKey, clientUidSchema } from './client-policy';
import { documentIdSchema } from './schemas';
import { HttpError } from './http';

const unverifiable = () => new HttpError(503, 'No podemos verificar este registro; contacta con soporte.', 'ATTENDANCE_RECORD_UNVERIFIABLE');
const changed = () => new HttpError(409, 'La cita cambió. Actualiza antes de continuar.', 'ATTENDANCE_SOURCE_CHANGED');
const attendanceEventId = (businessId: string, appointmentId: string, actorUid: string, requestId: string) => stableDocumentId('attendance', businessId, appointmentId, actorUid, requestId);

export function attendanceRequestFingerprint(command: AttendanceCommand): string {
  return createHash('sha256').update(JSON.stringify([
    command.requestId, command.expectedRevision, command.expectedRescheduleRevision,
    command.expectedStatus, command.status, command.correctionReason ?? null,
  ])).digest('hex');
}

function occurrence(appointment: Appointment): AppointmentAttendanceEvent['source'] {
  let rescheduleRevision: number;
  try { rescheduleRevision = appointmentRescheduleRevision(appointment); } catch { throw unverifiable(); }
  return { dateKey: appointment.dateKey, resourceId: appointment.resourceId, startAt: appointment.startAt,
    endAt: appointment.endAt, reservedUntilAt: appointment.reservedUntilAt, rescheduleRevision };
}
function matchesOccurrence(event: AppointmentAttendanceEvent, appointment: Appointment): boolean {
  const source = occurrence(appointment);
  return (Object.keys(source) as (keyof typeof source)[]).every(key => event.source[key] === source[key]);
}
function verifiedEvent(value: unknown, eventId: string, businessId: string, appointmentId: string): AppointmentAttendanceEvent {
  const parsed = appointmentAttendanceEventSchema.safeParse(value);
  if (!parsed.success || parsed.data.businessId !== businessId || parsed.data.appointmentId !== appointmentId
    || attendanceEventId(businessId, appointmentId, parsed.data.actorUid, parsed.data.requestId) !== eventId) throw unverifiable();
  return parsed.data;
}
function metadata(appointment: Appointment) {
  try { return readAttendanceMetadata(appointment); } catch { throw unverifiable(); }
}

/** Private head verification is shared with the history reader and composed writers. */
export async function readVerifiedAttendanceHead(tx: Transaction, db: Database, businessId: string, appointment: Appointment): Promise<AppointmentAttendanceEvent | null> {
  if (!documentIdSchema.safeParse(businessId).success || !documentIdSchema.safeParse(appointment.id).success || appointment.tenantId !== businessId) throw unverifiable();
  const attendance = metadata(appointment);
  if (!attendance) return null;
  const snapshot = await tx.get(db.collection('businesses').doc(businessId).collection('attendanceEvents').doc(attendance.lastEventId));
  const head = verifiedEvent(snapshot.data(), attendance.lastEventId, businessId, appointment.id);
  if (appointment.type !== 'appointment' || head.sequence !== attendance.revision || head.status !== appointment.status || !matchesOccurrence(head, appointment)) throw unverifiable();
  // Core delivery has no clear operation or legitimate cancelled positive head.
  return head;
}

/** Private, read-only pages remain available without subscription or consent gates. */
export async function readAppointmentAttendanceHistory(owner: ChatActor, businessId: string, appointmentId: string, beforeRevision?: number, db: Database = getAdminDb()): Promise<AttendanceHistoryPage> {
  documentIdSchema.parse(businessId); documentIdSchema.parse(appointmentId);
  if (beforeRevision !== undefined && (typeof beforeRevision !== 'number' || !appointmentAttendanceCursorSchema.safeParse(String(beforeRevision)).success)) throw new HttpError(400, 'Cursor inválido.');
  const businessRef = db.collection('businesses').doc(businessId), appointmentRef = businessRef.collection('appointments').doc(appointmentId);
  return db.runTransaction(async tx => {
    const [businessDoc, appointmentDoc] = await Promise.all([tx.get(businessRef), tx.get(appointmentRef)]);
    if (!businessDoc.exists || !appointmentDoc.exists) throw new HttpError(404, 'La cita no existe.');
    const business = businessDoc.data() as Business, appointment = appointmentDoc.data() as Appointment;
    assertOwner(business, owner.uid);
    if (business.id !== businessId || appointment.id !== appointmentId || appointment.tenantId !== businessId) throw unverifiable();
    const head = await readVerifiedAttendanceHead(tx, db, businessId, appointment), revision = head?.sequence ?? 0;
    if (beforeRevision !== undefined && beforeRevision > revision) throw new HttpError(400, 'Cursor inválido.');
    let query = businessRef.collection('attendanceEvents').where('appointmentId', '==', appointmentId);
    if (beforeRevision !== undefined) query = query.where('sequence', '<', beforeRevision);
    const page = await tx.get(query.orderBy('sequence', 'desc').limit(21));
    const upperRevision = beforeRevision === undefined ? revision : beforeRevision - 1;
    // The lookahead is part of the verified chain: a short page cannot silently
    // terminate a positive revision before reaching the first real event.
    if (page.docs.length !== Math.min(21, upperRevision)) throw unverifiable();
    const events = page.docs.map((snapshot, index) => {
      const event = verifiedEvent(snapshot.data(), snapshot.id, businessId, appointmentId);
      if (event.sequence !== upperRevision - index || !matchesOccurrence(event, appointment)) throw unverifiable();
      return event;
    });
    if (beforeRevision === undefined && head && page.docs[0]?.id !== appointment.attendance!.lastEventId) throw unverifiable();
    for (let index = 1; index < events.length; index++) if (events[index - 1].previousStatus !== events[index].status) throw unverifiable();
    return { appointment, events: events.slice(0, 20), nextBeforeRevision: events.length === 21 ? events[19].sequence : null };
  });
}

function applied(eventId: string, event: AppointmentAttendanceEvent): AttendanceUpdateResult['applied'] {
  return { eventId, requestId: event.requestId, revision: event.sequence, status: event.status, recordedAt: event.recordedAt };
}
function lockVersion(value: Record<string, unknown> | undefined): number {
  const version = value && Object.prototype.hasOwnProperty.call(value, 'version') ? value.version : 0;
  if (typeof version !== 'number' || !Number.isSafeInteger(version) || version < 0 || version >= Number.MAX_SAFE_INTEGER) throw unverifiable();
  return version;
}

export async function updateAppointmentAttendance(owner: ChatActor, businessId: string, appointmentId: string, supplied: z.input<typeof appointmentAttendanceCommandSchema>, db: Database = getAdminDb()): Promise<AttendanceUpdateResult> {
  // Boundary errors stay ZodError/400; the pure typed model's 409 fallback is not
  // the public parser for malformed commands.
  documentIdSchema.parse(businessId); documentIdSchema.parse(appointmentId);
  const command = appointmentAttendanceCommandSchema.parse(supplied), requestFingerprint = attendanceRequestFingerprint(command);
  const businessRef = db.collection('businesses').doc(businessId), appointmentRef = businessRef.collection('appointments').doc(appointmentId);
  const eventId = attendanceEventId(businessId, appointmentId, owner.uid, command.requestId), eventRef = businessRef.collection('attendanceEvents').doc(eventId);
  return db.runTransaction(async tx => {
    const [businessDoc, appointmentDoc, receiptDoc] = await Promise.all([tx.get(businessRef), tx.get(appointmentRef), tx.get(eventRef)]);
    if (!businessDoc.exists || !appointmentDoc.exists) throw new HttpError(404, 'La cita no existe.');
    const business = businessDoc.data() as Business, appointment = appointmentDoc.data() as Appointment;
    assertOwner(business, owner.uid);
    if (business.id !== businessId || appointment.id !== appointmentId || appointment.tenantId !== businessId) throw unverifiable();
    const attendance = metadata(appointment), head = await readVerifiedAttendanceHead(tx, db, businessId, appointment);
    if (appointment.type !== 'appointment' || !['confirmed', 'completed', 'no_show'].includes(appointment.status)) throw new HttpError(409, 'Esta cita no admite resultados.', 'ATTENDANCE_UNSUPPORTED');
    await assertConsent(owner.uid, 'account', undefined, db, tx);
    if (receiptDoc.exists) {
      const receipt = verifiedEvent(receiptDoc.data(), eventId, businessId, appointmentId);
      if (receipt.actorUid !== owner.uid || receipt.requestId !== command.requestId || !head || !attendance
        || receipt.sequence > attendance.revision || !matchesOccurrence(receipt, appointment)) throw unverifiable();
      if (receipt.requestFingerprint !== requestFingerprint) throw new HttpError(409, 'Este identificador ya se utilizó para otro resultado.', 'ATTENDANCE_REQUEST_REUSED');
      if (receipt.sequence !== command.expectedRevision + 1 || receipt.previousStatus !== command.expectedStatus || receipt.status !== command.status
        || receipt.source.rescheduleRevision !== command.expectedRescheduleRevision || receipt.reason !== (command.correctionReason ?? 'initial')) throw unverifiable();
      return { appointment, applied: applied(eventId, receipt), replayed: true };
    }
    const source = occurrence(appointment);
    if ((attendance?.revision ?? 0) !== command.expectedRevision || source.rescheduleRevision !== command.expectedRescheduleRevision || appointment.status !== command.expectedStatus) throw changed();
    // Validate keys before using saved values as document paths. All remaining
    // transition/source/time checks run after the transaction's final reads.
    if (!documentIdSchema.safeParse(source.resourceId).success || !/^\d{4}-\d{2}-\d{2}$/.test(source.dateKey)
      || (appointment.client !== undefined && (!appointment.client || !clientUidSchema.safeParse(appointment.client.uid).success))) throw unverifiable();
    const keys = [`${source.dateKey}_${source.resourceId}`];
    if (appointment.client !== undefined) keys.push(`client_${clientPolicyKey(appointment.client.uid)}`);
    const lockRefs = keys.map(key => businessRef.collection('bookingLocks').doc(key));
    const locks = await Promise.all(lockRefs.map(ref => tx.get(ref)));
    const versions = locks.map(lock => lockVersion(lock.data()));
    const now = Date.now();
    try { assertAttendanceTransition(appointment, command, now); }
    catch (error) {
      if (error instanceof AttendanceModelError) throw new HttpError(error.status,
        error.status === 503 ? unverifiable().message : 'No se pudo registrar el resultado. Actualiza la cita y revisa su horario.', error.code);
      throw error;
    }
    const revision = (attendance?.revision ?? 0) + 1;
    const parsedEvent = appointmentAttendanceEventSchema.safeParse({ schemaVersion: 1, businessId, appointmentId, actorUid: owner.uid,
      requestId: command.requestId, requestFingerprint, sequence: revision, previousStatus: appointment.status, status: command.status,
      recordedAt: now, reason: command.correctionReason ?? 'initial', legacyPreviousOutcome: !attendance && appointment.status !== 'confirmed', source });
    if (!parsedEvent.success) throw unverifiable();
    const event = parsedEvent.data, updated: Appointment = { ...appointment, status: command.status, attendance: { revision, lastEventId: eventId } };
    tx.set(appointmentRef, updated);
    tx.create(eventRef, event);
    for (const [index, ref] of lockRefs.entries()) tx.set(ref, { ...locks[index].data(), version: versions[index] + 1, updatedAt: now });
    return { appointment: updated, applied: applied(eventId, event), replayed: false };
  });
}
