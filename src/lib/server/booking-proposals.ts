import 'server-only';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { getAdminDb } from '@/lib/firebase/admin';
import type { Database } from '@/lib/storage/types';
import type { Business, Appointment } from '@/types/firestore';
import type { ChatActor, BookingProposalView } from '@/types/chat';
import { isSubscriptionAllowed } from '@/lib/sarin/subscription';
import { getAvailableSlots, toColombiaTimestamp, toMinutes, toTimeStr } from '@/lib/sarin/availability';
import { stableDocumentId } from './businesses';
import { assertClientCanBook } from './client-policy';
import { createAppointmentInTransaction } from './bookings';
import { businessConfigSchema, bookingSchema, documentIdSchema, requestIdSchema, type BookingInput } from './schemas';
import { HttpError } from './http';
const selectionSchema = bookingSchema.pick({ dateKey: true, startTimeStr: true, serviceId: true, resourceId: true });
const proposalSchema = z.object({ version: z.literal(1), id: documentIdSchema, businessId: documentIdSchema, actorUid: z.string().min(1).max(128), selection: selectionSchema,
  service: businessConfigSchema.shape.services.element, resource: businessConfigSchema.shape.resources.element, intakeFields: businessConfigSchema.shape.intakeFields,
  createdAt: z.number().int().nonnegative(), expiresAt: z.number().int().nonnegative(), appointmentId: documentIdSchema.nullable(),
}).strict();
type Proposal = z.infer<typeof proposalSchema>;
export const proposalRequestKey = (uid: string, businessId: string, requestId: string) => `request_${stableDocumentId('proposal-request', businessId, uid, requestId)}`;
function parse(value: unknown): Proposal {
  const parsed = proposalSchema.safeParse(value); if (!parsed.success) throw new HttpError(503, 'No se pudo validar la propuesta de reserva.'); return parsed.data;
}
function view(proposal: Proposal): BookingProposalView {
  return { id: proposal.id, businessId: proposal.businessId, serviceName: proposal.service.name, resourceName: proposal.resource.name, dateKey: proposal.selection.dateKey, startTimeStr: proposal.selection.startTimeStr,
    endTimeStr: toTimeStr(toMinutes(proposal.selection.startTimeStr) + proposal.service.durationMinutes), priceCOP: proposal.service.price, expiresAt: proposal.expiresAt, intakeFields: proposal.intakeFields };
}
export async function createBookingProposal(user: ChatActor, businessId: string, input: Pick<BookingInput, 'dateKey' | 'startTimeStr' | 'serviceId' | 'resourceId'>, requestId: string, db: Database = getAdminDb()): Promise<BookingProposalView> {
  documentIdSchema.parse(businessId); requestIdSchema.parse(requestId);
  const selection = selectionSchema.parse(input), now = Date.now(), id = randomBytes(24).toString('base64url');
  if (toColombiaTimestamp(selection.dateKey, '00:00') > now + 366 * 86400000) throw new HttpError(400, 'Puedes reservar hasta un año por adelantado.');
  const businessRef = db.collection('businesses').doc(businessId), collection = db.collection('bookingProposals'), requestRef = collection.doc(proposalRequestKey(user.uid, businessId, requestId));
  return db.runTransaction(async tx => {
    const [businessDoc, mapping] = await Promise.all([tx.get(businessRef), tx.get(requestRef)]);
    if (mapping.exists) {
      const saved = mapping.data()!;
      if (saved.actorUid !== user.uid || saved.businessId !== businessId || JSON.stringify(saved.selection) !== JSON.stringify(selection)) throw new HttpError(409, 'La solicitud pertenece a otra propuesta.');
      return view(parse((await tx.get(collection.doc(documentIdSchema.parse(saved.proposalId)))).data()));
    }
    if (!businessDoc.exists) throw new HttpError(404, 'El negocio no existe.');
    const business = businessDoc.data() as Business;
    if (!business.sarinConfig.onboardingCompleted || !business.slug) throw new HttpError(403, 'El negocio todavía no está configurado.');
    if (!isSubscriptionAllowed(business)) throw new HttpError(402, 'Activa una suscripción para continuar.');
    await assertClientCanBook(tx, business, user.uid, now, db);
    const service = business.services.find(item => item.id === selection.serviceId), resource = business.resources.find(item => item.id === selection.resourceId && item.active);
    if (!service || !resource || !service.resourceIds.includes(resource.id)) throw new HttpError(400, 'Selecciona un servicio y profesional del negocio.');
    const appointments = await tx.get(businessRef.collection('appointments').where('dateKey', '==', selection.dateKey).where('resourceId', '==', selection.resourceId).where('status', '==', 'confirmed'));
    if (!getAvailableSlots({ tenant: business, ...selection, existingAppointments: appointments.docs.map(doc => doc.data() as Appointment) }).some(item => item.slots.includes(selection.startTimeStr))) throw new HttpError(409, 'El horario ya no está disponible.');
    const proposal: Proposal = proposalSchema.parse({ version: 1, id, businessId, actorUid: user.uid, selection, service, resource, intakeFields: business.sarinConfig.intakeFields, createdAt: now, expiresAt: now + 600000, appointmentId: null });
    tx.create(collection.doc(id), proposal); tx.create(requestRef, { actorUid: user.uid, businessId, selection, proposalId: id });
    return view(proposal);
  });
}
export async function confirmBookingProposal(user: ChatActor, businessId: string, proposalId: string, contact: Pick<BookingInput, 'clientPhone' | 'intakeAnswers'>, db: Database = getAdminDb()): Promise<Appointment> {
  documentIdSchema.parse(businessId); documentIdSchema.parse(proposalId);
  const ref = db.collection('bookingProposals').doc(proposalId), businessRef = db.collection('businesses').doc(businessId);
  return db.runTransaction(async tx => {
    const [document, businessDoc] = await Promise.all([tx.get(ref), tx.get(businessRef)]);
    if (!document.exists) throw new HttpError(404, 'La propuesta no existe.');
    const proposal = parse(document.data());
    if (proposal.businessId !== businessId) throw new HttpError(404, 'La propuesta no existe.');
    if (proposal.actorUid !== user.uid) throw new HttpError(403, 'Esta propuesta pertenece a otra cuenta.');
    if (proposal.appointmentId) {
      const appointment = (await tx.get(businessRef.collection('appointments').doc(proposal.appointmentId))).data() as Appointment | undefined;
      if (!appointment || appointment.client?.uid !== user.uid || appointment.tenantId !== businessId) throw new HttpError(503, 'No se pudo recuperar la cita.');
      return appointment;
    }
    const now = Date.now();
    if (proposal.expiresAt <= now) throw new HttpError(409, 'La propuesta venció. Consulta otra vez la disponibilidad.', 'BOOKING_PROPOSAL_EXPIRED');
    if (!businessDoc.exists) throw new HttpError(404, 'El negocio no existe.');
    const business = businessDoc.data() as Business;
    const service = businessConfigSchema.shape.services.element.safeParse(business.services.find(item => item.id === proposal.selection.serviceId)), resource = businessConfigSchema.shape.resources.element.safeParse(business.resources.find(item => item.id === proposal.selection.resourceId));
    const current = { service: service.success ? service.data : null, resource: resource.success ? resource.data : null, intakeFields: businessConfigSchema.shape.intakeFields.parse(business.sarinConfig.intakeFields) };
    if (JSON.stringify(current) !== JSON.stringify({ service: proposal.service, resource: proposal.resource, intakeFields: proposal.intakeFields })) throw new HttpError(409, 'El catálogo cambió. Solicita una propuesta actualizada.', 'BOOKING_PROPOSAL_CHANGED');
    const input = bookingSchema.parse({ ...proposal.selection, clientPhone: contact.clientPhone, intakeAnswers: contact.intakeAnswers });
    if (Object.keys(input.intakeAnswers).some(key => !proposal.intakeFields.some(field => field.key === key))) throw new HttpError(400, 'Las respuestas no corresponden a los campos de esta propuesta.');
    const appointment = await createAppointmentInTransaction(tx, user, business, input, `proposal-${proposal.id}`, db, now);
    tx.set(ref, { ...proposal, appointmentId: appointment.id });
    return appointment;
  });
}
export async function recoverBookingProposal(user: ChatActor, businessId: string, requestId: string, db: Database = getAdminDb()): Promise<{ proposal: BookingProposalView; appointment?: Appointment } | null> {
  const mapping = (await db.collection('bookingProposals').doc(proposalRequestKey(user.uid, businessId, requestId)).get()).data();
  if (!mapping) return null;
  if (mapping.actorUid !== user.uid || mapping.businessId !== businessId) throw new HttpError(403, 'La propuesta pertenece a otra cuenta.');
  const proposal = parse((await db.collection('bookingProposals').doc(documentIdSchema.parse(mapping.proposalId)).get()).data());
  if (proposal.actorUid !== user.uid || proposal.businessId !== businessId) throw new HttpError(503, 'No se pudo validar la propuesta.');
  const appointment = proposal.appointmentId ? (await db.collection('businesses').doc(businessId).collection('appointments').doc(proposal.appointmentId).get()).data() as Appointment | undefined : undefined;
  if (proposal.appointmentId && (!appointment || appointment.client?.uid !== user.uid || appointment.tenantId !== businessId)) throw new HttpError(503, 'No se pudo recuperar la cita.');
  return { proposal: view(proposal), ...(appointment ? { appointment } : {}) };
}
