import 'server-only';
import { readResourceSchedulePolicy } from './resource-schedules';
import type { z } from 'zod';
import type { Appointment, Business } from '@/types/firestore';
import type { ChatActor } from '@/types/chat';
import type { Database, Transaction } from '@/lib/storage/types';
import { appointmentRescheduleAvailabilitySchema, appointmentRescheduleProposalSchema, canRescheduleSubscription, type AppointmentRescheduleView, type RescheduleResult } from '@/lib/appointment-reschedule';
import { bookingBeneficiarySchema, bookingSubjectCaseSchema, type BookingCapability, type BookingSubjectCase, type StructuredProposalContext, type ValidatedBookingSubject } from '@/lib/booking-subject';
import { getAdminDb } from '@/lib/firebase/admin';
import { getAvailableSlots, toColombiaTimestamp, toMinutes, toTimeStr } from '@/lib/sarin/availability';
import { assertConsent } from './consent';
import { readBookingDataPolicy, assertBookingIntakePolicy } from './booking-data-policy';
import { assertBookingSubjectConsent, bookingSubjectHash } from './booking-subject-consent';
import { assertClientCanReschedule, clientPolicyKey } from './client-policy';
import { businessConfigSchema, documentIdSchema, type BookingInput } from './schemas';
import { createBookingProposal } from './booking-proposals';
import { HttpError } from './http';

export type AppointmentRescheduleContext = { appointmentId: string; sourceRevision: number; case?: BookingSubjectCase };
export type AppointmentRescheduleMetadata = AppointmentRescheduleView & { sourceFingerprint: string; requestId: string };
const changed = () => new HttpError(409, 'La cita cambió. Actualiza Mis citas antes de continuar.', 'RESCHEDULE_SOURCE_CHANGED');
export function appointmentRescheduleRevision(appointment: Appointment): number {
  const revision = appointment.rescheduleRevision === undefined ? 0 : appointment.rescheduleRevision;
  if (!Number.isSafeInteger(revision) || revision < 0 || revision >= Number.MAX_SAFE_INTEGER) throw new HttpError(503, 'No se pudo validar la revisión de la cita.', 'RESCHEDULE_SOURCE_UNAVAILABLE');
  return revision;
}
export const appointmentRescheduleFingerprint = (appointment: Appointment) => bookingSubjectHash({ ...appointment, rescheduleRevision: appointmentRescheduleRevision(appointment) });
export function assertRescheduleSource(appointment: Appointment, user: ChatActor, businessId: string, context: AppointmentRescheduleContext, now: number): void {
  if (appointment.id !== context.appointmentId || appointment.tenantId !== businessId) throw new HttpError(404, 'La cita no existe.');
  if (appointment.client?.uid !== user.uid) throw new HttpError(403, 'No tienes acceso a esta cita.');
  if (appointment.type !== 'appointment' || appointment.status !== 'confirmed' || appointmentRescheduleRevision(appointment) !== context.sourceRevision) throw changed();
  if (!Number.isSafeInteger(appointment.startAt) || appointment.startAt <= now) throw new HttpError(409, 'Solo puedes cambiar citas que aún no han comenzado.', 'RESCHEDULE_SOURCE_STARTED');
}
export async function readRescheduleSource(tx: Transaction, user: ChatActor, businessId: string, context: AppointmentRescheduleContext, db: Database): Promise<Appointment> {
  const doc = await tx.get(db.collection('businesses').doc(businessId).collection('appointments').doc(context.appointmentId));
  if (!doc.exists) throw new HttpError(404, 'La cita no existe.');
  const appointment = doc.data() as Appointment;
  assertRescheduleSource(appointment, user, businessId, context, Date.now());
  return appointment;
}
export function resolveRescheduleSubject(source: Appointment, subjectCase: BookingSubjectCase | undefined, capability: BookingCapability, requestId?: string): StructuredProposalContext | undefined {
  if (source.beneficiary === undefined) {
    if (subjectCase || capability.dataMode !== 'general' || capability.representedMinorsEnabled) throw new HttpError(409, 'Contacta al negocio para cambiar esta cita anterior.', 'RESCHEDULE_LEGACY_RESTRICTED');
    return undefined;
  }
  const beneficiary = bookingBeneficiarySchema.safeParse(source.beneficiary), parsedCase = bookingSubjectCaseSchema.safeParse(subjectCase);
  if (!beneficiary.success) throw new HttpError(503, 'No se pudo validar el beneficiario de la cita.');
  if (!parsedCase.success || parsedCase.data.subjectKind !== beneficiary.data.kind || (beneficiary.data.kind === 'represented_minor' && (parsedCase.data.subjectKind !== 'represented_minor' || parsedCase.data.representativeRole !== beneficiary.data.representativeRole)) || (requestId !== undefined && parsedCase.data.bookingRequestId !== requestId) || source.subjectAuthorization?.bookingRequestId === parsedCase.data.bookingRequestId) throw new HttpError(409, 'El caso no corresponde al beneficiario de esta cita.', 'BOOKING_SUBJECT_CONFLICT');
  return { case: parsedCase.data, beneficiary: beneficiary.data };
}
export function assertRescheduleAccess(business: Business, now: number): void {
  if (!business.sarinConfig.onboardingCompleted || !business.slug) throw new HttpError(403, 'El negocio todavía no está configurado.');
  if (!canRescheduleSubscription(business, now)) throw new HttpError(402, 'La suscripción del negocio no permite cambiar esta cita.');
}
export function currentRescheduleService(business: Business, source: Appointment) {
  const service = businessConfigSchema.shape.services.element.safeParse(business.services.find(item => item.id === source.serviceId));
  if (!service.success) throw new HttpError(409, 'El servicio ya no está disponible. Contacta al negocio para cambiar tu cita.', 'RESCHEDULE_SERVICE_UNAVAILABLE');
  return service.data;
}

export async function readAppointmentRescheduleAvailability(user: ChatActor, businessId: string, supplied: z.input<typeof appointmentRescheduleAvailabilitySchema>, db: Database = getAdminDb()): Promise<ReturnType<typeof getAvailableSlots>> {
  documentIdSchema.parse(businessId); const input = appointmentRescheduleAvailabilitySchema.parse(supplied);
  return db.runTransaction(async tx => {
    const document = await tx.get(db.collection('businesses').doc(businessId));
    if (!document.exists) throw new HttpError(404, 'El negocio no existe.');
    const business = document.data() as Business, source = await readRescheduleSource(tx, user, businessId, input, db);
    await assertConsent(user.uid, 'account', undefined, db, tx); await assertConsent(user.uid, 'business_client', business, db, tx);
    const { capability } = await readBookingDataPolicy(businessId, db, tx), subject = resolveRescheduleSubject(source, input.case, capability);
    if (subject) await assertBookingSubjectConsent(tx, user, business, subject.case, db);
    await assertBookingIntakePolicy(tx, businessId, business.sarinConfig.intakeFields, db); await assertClientCanReschedule(tx, business, user.uid, db);
    const service = currentRescheduleService(business, source);
    if (input.resourceId && !business.resources.some(resource => resource.id === input.resourceId && resource.active && service.resourceIds.includes(resource.id))) throw new HttpError(400, 'Selecciona un profesional disponible para este servicio.');
    const appointments = await tx.get(db.collection('businesses').doc(businessId).collection('appointments').where('dateKey', '==', input.dateKey).where('status', '==', 'confirmed'));
    const now = Date.now(); assertRescheduleSource(source, user, businessId, input, now); assertRescheduleAccess(business, now);
    if (toColombiaTimestamp(input.dateKey, '00:00') > now + 366 * 86400000) throw new HttpError(400, 'Puedes reservar hasta un año por adelantado.');
    return getAvailableSlots({ resourceSchedulePolicy: await readResourceSchedulePolicy(tx, business.id, db), tenant: business, dateKey: input.dateKey, serviceId: service.id, resourceId: input.resourceId, existingAppointments: appointments.docs.filter(doc => doc.id !== source.id).map(doc => doc.data() as Appointment), now });
  });
}
export async function createAppointmentRescheduleProposal(user: ChatActor, businessId: string, supplied: z.input<typeof appointmentRescheduleProposalSchema>, db: Database = getAdminDb()) {
  const input = appointmentRescheduleProposalSchema.parse(supplied);
  return createBookingProposal(user, businessId, { ...input.selection, serviceId: 'reschedule' }, input.requestId, db, undefined, { appointmentId: input.appointmentId, sourceRevision: input.sourceRevision, ...(input.case ? { case: input.case } : {}) });
}

export async function rescheduleAppointmentInTransaction(tx: Transaction, user: ChatActor, business: Business, selection: Pick<BookingInput, 'dateKey' | 'startTimeStr' | 'serviceId' | 'resourceId'>, proposalId: string, metadata: AppointmentRescheduleMetadata, expiresAt: number, contact: { clientPhone: unknown; intakeAnswers: unknown; beneficiary?: unknown }, db: Database, subject?: ValidatedBookingSubject): Promise<{ appointment: Appointment; rescheduleResult: RescheduleResult } | null> {
  const context = { appointmentId: metadata.appointmentId, sourceRevision: metadata.sourceRevision }, businessRef = db.collection('businesses').doc(business.id);
  const source = await readRescheduleSource(tx, user, business.id, context, db);
  if (appointmentRescheduleFingerprint(source) !== metadata.sourceFingerprint || source.serviceId !== selection.serviceId) throw changed();
  if (source.dateKey === selection.dateKey && source.startTimeStr === selection.startTimeStr && source.resourceId === selection.resourceId) throw new HttpError(400, 'Selecciona un horario o profesional diferente.', 'RESCHEDULE_NO_CHANGE');
  const { capability } = await readBookingDataPolicy(business.id, db, tx), canonicalSubject = resolveRescheduleSubject(source, subject?.case, capability);
  if (Boolean(canonicalSubject) !== Boolean(subject) || (canonicalSubject && bookingSubjectHash(canonicalSubject.beneficiary) !== bookingSubjectHash(subject?.beneficiary))) throw new HttpError(409, 'El beneficiario cambió.', 'BOOKING_SUBJECT_CONFLICT');
  if (contact.clientPhone !== null || !contact.intakeAnswers || typeof contact.intakeAnswers !== 'object' || Array.isArray(contact.intakeAnswers) || Object.keys(contact.intakeAnswers).length) throw new HttpError(400, 'El cambio de horario conserva tus datos de contacto y respuestas.');
  if (!canonicalSubject && contact.beneficiary !== undefined) throw new HttpError(400, 'Esta cita no declara un beneficiario.');
  await assertConsent(user.uid, 'account', undefined, db, tx); await assertConsent(user.uid, 'business_client', business, db, tx);
  await assertBookingIntakePolicy(tx, business.id, business.sarinConfig.intakeFields, db);
  await assertClientCanReschedule(tx, business, user.uid, db);
  const service = currentRescheduleService(business, source);
  const keys = [...new Set([`${source.dateKey}_${source.resourceId}`, `${selection.dateKey}_${selection.resourceId}`, `client_${clientPolicyKey(user.uid)}`])];
  const lockRefs = keys.map(key => businessRef.collection('bookingLocks').doc(key));
  const [appointments, locks] = await Promise.all([
    tx.get(businessRef.collection('appointments').where('dateKey', '==', selection.dateKey).where('resourceId', '==', selection.resourceId).where('status', '==', 'confirmed')),
    Promise.all(lockRefs.map(ref => tx.get(ref))),
  ]);
  const now = Date.now();
  if (expiresAt <= now) return null;
  assertRescheduleSource(source, user, business.id, context, now); assertRescheduleAccess(business, now);
  if (toColombiaTimestamp(selection.dateKey, '00:00') > now + 366 * 86400000) throw new HttpError(400, 'Puedes reservar hasta un año por adelantado.');
  if (!getAvailableSlots({ resourceSchedulePolicy: await readResourceSchedulePolicy(tx, business.id, db), tenant: business, ...selection, existingAppointments: appointments.docs.filter(doc => doc.id !== source.id).map(doc => doc.data() as Appointment), now }).some(resource => resource.slots.includes(selection.startTimeStr))) throw new HttpError(409, 'El horario ya no está disponible. Consulta otra hora.');
  const startAt = toColombiaTimestamp(selection.dateKey, selection.startTimeStr), endAt = startAt + service.durationMinutes * 60000;
  const revision = metadata.sourceRevision + 1;
  const appointment: Appointment = { ...source, dateKey: selection.dateKey, startTimeStr: selection.startTimeStr, endTimeStr: toTimeStr(toMinutes(selection.startTimeStr) + service.durationMinutes), startAt, endAt, reservedUntilAt: endAt + service.bufferMinutes * 60000, resourceId: selection.resourceId, serviceName: service.name, price: service.price, rescheduleRevision: revision, lastRescheduleProposalId: proposalId, rescheduledAt: now };
  const rescheduleResult: RescheduleResult = { proposalId, appointmentId: source.id, revision, dateKey: appointment.dateKey, startTimeStr: appointment.startTimeStr, resourceId: appointment.resourceId, startAt, endAt, confirmedAt: now };
  for (const [index, ref] of lockRefs.entries()) tx.set(ref, { version: Number(locks[index].data()?.version ?? 0) + 1, updatedAt: now });
  tx.set(businessRef.collection('appointments').doc(source.id), appointment);
  return { appointment, rescheduleResult };
}
