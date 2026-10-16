import 'server-only';
import type { ChatActor } from '@/types/chat';
import type { Database as Firestore, Transaction } from '@/lib/storage/types';
import type { Appointment, Business } from '@/types/firestore';
import { getAdminDb } from '@/lib/firebase/admin';
import { getAvailableSlots, isDateKey, toColombiaTimestamp, toMinutes, toTimeStr } from '@/lib/sarin/availability';
import { getBusinessAccess, isSubscriptionAllowed } from '@/lib/sarin/subscription';
import { HttpError } from './http';
import { assertOwner, getBusiness, publicBusiness, stableDocumentId } from './businesses';
import { documentIdSchema, type BookingInput } from './schemas';
import { assertClientCanBook, clientPolicyKey } from './client-policy';

type BlockInput = { dateKey: string; startTimeStr: string; endTimeStr: string; resourceId: string; requestId: string; motivo?: string };
function assertDate(dateKey: string) {
  if (!isDateKey(dateKey)) throw new HttpError(400, 'Fecha inválida.');
  if (toColombiaTimestamp(dateKey, '00:00') > Date.now() + 366 * 86400000) throw new HttpError(400, 'Puedes reservar hasta un año por adelantado.');
}

export async function readAppointments(businessId: string, dateKey: string, user: ChatActor, db: Firestore = getAdminDb()): Promise<Appointment[]> {
  assertDate(dateKey);
  const business = await getBusiness(businessId, db);
  let query = db.collection('businesses').doc(businessId).collection('appointments').where('dateKey', '==', dateKey);
  if (business.ownerUid !== user.uid) query = query.where('client.uid', '==', user.uid);
  const snapshot = await query.get();
  return snapshot.docs.map((document) => document.data() as Appointment).sort((a, b) => a.startAt - b.startAt);
}

export async function readAvailability(business: Business, dateKey: string, serviceId: string, resourceId?: string, db: Firestore = getAdminDb()) {
  assertDate(dateKey);
  if (!business.sarinConfig.onboardingCompleted || !business.slug) throw new HttpError(403, 'El negocio todavía no está configurado.');
  if (!isSubscriptionAllowed(business)) throw new HttpError(402, 'La suscripción del negocio está vencida.');
  const snapshot = await db.collection('businesses').doc(business.id).collection('appointments').where('dateKey', '==', dateKey).where('status', '==', 'confirmed').get();
  return getAvailableSlots({ tenant: business, dateKey, serviceId, resourceId, existingAppointments: snapshot.docs.map((document) => document.data() as Appointment) });
}

export async function createAppointment(user: ChatActor, businessId: string, input: BookingInput, requestId: string, db: Firestore = getAdminDb()): Promise<Appointment> {
  assertDate(input.dateKey);
  if (!documentIdSchema.safeParse(businessId).success) throw new HttpError(400, 'Negocio inválido.');
  const businessReference = db.collection('businesses').doc(businessId);
  return db.runTransaction(async transaction => {
    const document = await transaction.get(businessReference);
    if (!document.exists) throw new HttpError(404, 'El negocio no existe.');
    return createAppointmentInTransaction(transaction, user, document.data() as Business, input, requestId, db, Date.now());
  });
}
export async function createAppointmentInTransaction(transaction: Transaction, user: ChatActor, business: Business, input: BookingInput, requestId: string, db: Firestore, now: number): Promise<Appointment> {
  const businessId = business.id, businessReference = db.collection('businesses').doc(businessId);
  const id = stableDocumentId(user.uid, requestId, 'appointment');
  const appointmentReference = businessReference.collection('appointments').doc(id);
  const lockReference = businessReference.collection('bookingLocks').doc(`${input.dateKey}_${input.resourceId}`);
  const clientLockReference = businessReference.collection('bookingLocks').doc(`client_${clientPolicyKey(user.uid)}`);
    const [existing, lock, clientLock] = await Promise.all([transaction.get(appointmentReference), transaction.get(lockReference), transaction.get(clientLockReference)]);
    if (existing.exists) {
      const appointment = existing.data() as Appointment;
      if (appointment.client?.uid !== user.uid || appointment.startTimeStr !== input.startTimeStr || appointment.dateKey !== input.dateKey || appointment.resourceId !== input.resourceId || appointment.serviceId !== input.serviceId) throw new HttpError(409, 'Este identificador ya se utilizó para otra reserva.');
      return appointment;
    }
    if (!business.sarinConfig.onboardingCompleted || !business.slug) throw new HttpError(403, 'El negocio todavía no está configurado.');
    if (!isSubscriptionAllowed(business)) throw new HttpError(402, 'Activa una suscripción para continuar agendando.');
    assertDate(input.dateKey);
    await assertClientCanBook(transaction, business, user.uid, now, db);
    const service = business.services.find((candidate) => candidate.id === input.serviceId);
    if (!service) throw new HttpError(400, 'El servicio no existe.');
    if (business.sarinConfig.intakeFields.some((field) => field.required && !input.intakeAnswers[field.key]?.trim())) throw new HttpError(400, 'Faltan respuestas obligatorias para agendar.');
    const query = businessReference.collection('appointments').where('dateKey', '==', input.dateKey).where('resourceId', '==', input.resourceId).where('status', '==', 'confirmed');
    const snapshot = await transaction.get(query);
    const availability = getAvailableSlots({ tenant: business, dateKey: input.dateKey, serviceId: input.serviceId, resourceId: input.resourceId, existingAppointments: snapshot.docs.map((document) => document.data() as Appointment) });
    if (!availability.some((resource) => resource.slots.includes(input.startTimeStr))) throw new HttpError(409, 'El horario ya no está disponible. Consulta otra hora.');
    const startAt = toColombiaTimestamp(input.dateKey, input.startTimeStr);
    const endAt = startAt + service.durationMinutes * 60000;
    const appointment: Appointment = {
      id, tenantId: businessId, dateKey: input.dateKey, startAt, endAt,
      reservedUntilAt: endAt + service.bufferMinutes * 60000,
      startTimeStr: input.startTimeStr, endTimeStr: toTimeStr(toMinutes(input.startTimeStr) + service.durationMinutes),
      type: 'appointment', resourceId: input.resourceId, serviceId: service.id, serviceName: service.name, price: service.price,
      client: { uid: user.uid, name: typeof user.name === 'string' ? user.name : user.email ?? 'Cliente', email: user.email ?? '', phone: input.clientPhone, intakeAnswers: input.intakeAnswers },
      status: 'confirmed', createdBy: business.ownerUid === user.uid ? 'sarin_owner' : 'sarin_client', createdAt: now,
    };
    // The shared per-resource/day document prevents empty-query phantom races.
    // Every mutation of that resource/date must participate in the same lock.
    transaction.set(lockReference, { version: Number(lock.data()?.version ?? 0) + 1, updatedAt: now });
    transaction.set(clientLockReference, { version: Number(clientLock.data()?.version ?? 0) + 1, updatedAt: now });
    if (getBusinessAccess(business) === 'paid_trial') {
      const trial = business.subscription.paidTrial!;
      const updated: Business = { ...business, subscription: { ...business.subscription, paidTrial: { ...trial, appointmentsUsed: trial.appointmentsUsed + 1 } } };
      // A business-wide write serializes the final unit across every resource
      // and date, beyond the resource/day lock used for slot conflicts.
      transaction.set(businessReference, updated);
      transaction.set(db.collection('publicBusinesses').doc(business.slug), publicBusiness(updated));
    }
    transaction.create(appointmentReference, appointment);
    return appointment;
}

export async function createManualBlock(user: ChatActor, businessId: string, input: BlockInput, db: Firestore = getAdminDb()): Promise<Appointment> {
  assertDate(input.dateKey);
  const businessReference = db.collection('businesses').doc(businessId);
  const id = stableDocumentId(user.uid, input.requestId, 'block');
  const appointmentReference = businessReference.collection('appointments').doc(id);
  const lockReference = businessReference.collection('bookingLocks').doc(`${input.dateKey}_${input.resourceId}`);
  return db.runTransaction(async (transaction) => {
    const [businessDocument, existing, lock] = await Promise.all([transaction.get(businessReference), transaction.get(appointmentReference), transaction.get(lockReference)]);
    if (!businessDocument.exists) throw new HttpError(404, 'El negocio no existe.');
    const business = businessDocument.data() as Business;
    assertOwner(business, user.uid);
    if (existing.exists) {
      const appointment = existing.data() as Appointment;
      if (appointment.dateKey !== input.dateKey || appointment.startTimeStr !== input.startTimeStr || appointment.endTimeStr !== input.endTimeStr || appointment.resourceId !== input.resourceId) throw new HttpError(409, 'Este identificador ya se utilizó para otro bloqueo.');
      return appointment;
    }
    if (!business.resources.some((resource) => resource.id === input.resourceId && resource.active)) throw new HttpError(400, 'El recurso no existe o está inactivo.');
    const startAt = toColombiaTimestamp(input.dateKey, input.startTimeStr);
    const endAt = toColombiaTimestamp(input.dateKey, input.endTimeStr);
    if (startAt <= Date.now() || endAt <= startAt) throw new HttpError(400, 'El bloqueo debe ser futuro y tener duración positiva.');
    const snapshot = await transaction.get(businessReference.collection('appointments').where('dateKey', '==', input.dateKey).where('resourceId', '==', input.resourceId).where('status', '==', 'confirmed'));
    if (snapshot.docs.some((document) => { const appointment = document.data() as Appointment; return startAt < appointment.reservedUntilAt && endAt > appointment.startAt; })) throw new HttpError(409, 'El bloqueo se cruza con una cita activa.');
    const appointment: Appointment = { id, tenantId: businessId, dateKey: input.dateKey, startAt, endAt, reservedUntilAt: endAt, startTimeStr: input.startTimeStr, endTimeStr: input.endTimeStr, type: 'manual_block', resourceId: input.resourceId, serviceName: input.motivo || 'Horario bloqueado', status: 'confirmed', createdBy: 'manual_panel', createdAt: Date.now() };
    transaction.set(lockReference, { version: Number(lock.data()?.version ?? 0) + 1, updatedAt: Date.now() });
    transaction.create(appointmentReference, appointment);
    return appointment;
  });
}

export async function cancelAppointment(user: ChatActor, businessId: string, appointmentId: string, db: Firestore = getAdminDb()): Promise<Appointment> {
  const businessReference = db.collection('businesses').doc(businessId);
  const reference = businessReference.collection('appointments').doc(appointmentId);
  return db.runTransaction(async (transaction) => {
    const [businessDocument, document] = await Promise.all([transaction.get(businessReference), transaction.get(reference)]);
    if (!businessDocument.exists || !document.exists) throw new HttpError(404, 'La cita no existe.');
    const business = businessDocument.data() as Business;
    const appointment = document.data() as Appointment;
    const owner = business.ownerUid === user.uid;
    if (!owner && appointment.client?.uid !== user.uid) throw new HttpError(403, 'No tienes acceso a esta cita.');
    if (appointment.status !== 'confirmed') return appointment;
    const lockReference = businessReference.collection('bookingLocks').doc(`${appointment.dateKey}_${appointment.resourceId}`);
    const lock = await transaction.get(lockReference);
    const clientLockReference = appointment.type === 'appointment' && appointment.client?.uid ? businessReference.collection('bookingLocks').doc(`client_${clientPolicyKey(appointment.client.uid)}`) : null;
    const clientLock = clientLockReference ? await transaction.get(clientLockReference) : null;
    const cancelled: Appointment = { ...appointment, status: owner ? 'cancelled_by_owner' : 'cancelled_by_client' };
    transaction.set(reference, cancelled);
    transaction.set(lockReference, { version: Number(lock.data()?.version ?? 0) + 1, updatedAt: Date.now() });
    if (clientLockReference) transaction.set(clientLockReference, { version: Number(clientLock?.data()?.version ?? 0) + 1, updatedAt: Date.now() });
    return cancelled;
  });
}
