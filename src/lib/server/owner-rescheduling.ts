import 'server-only';
import { z } from 'zod';
import type { Appointment, Business, TenantService } from '@/types/firestore';
import type { ChatActor } from '@/types/chat';
import type { Database, Transaction } from '@/lib/storage/types';
import { getAdminDb } from '@/lib/firebase/admin';
import {
  ownerRescheduleAppointmentSchema, ownerRescheduleAvailabilitySchema, ownerRescheduleCommandSchema,
  ownerRescheduleProposalViewSchema, ownerRescheduleRecoverySchema,
  type OwnerRescheduleCommand, type OwnerRescheduleExpectation, type OwnerRescheduleSource,
  type OwnerRescheduleProposalView, type OwnerRescheduleRecovery, type OwnerRescheduleConfirmation,
} from '@/lib/owner-rescheduling';
import { canRescheduleSubscription, rescheduleResultSchema } from '@/lib/appointment-reschedule';
import { bookingBeneficiarySchema } from '@/lib/booking-subject';
import { getAvailableSlots, toColombiaTimestamp, toMinutes, toTimeStr } from '@/lib/sarin/availability';
import { appointmentRescheduleRevision, appointmentRescheduleFingerprint } from './appointment-rescheduling';
import { assertOwner, stableDocumentId } from './businesses';
import { assertConsent } from './consent';
import { readBookingDataPolicy } from './booking-data-policy';
import { bookingSubjectHash } from './booking-subject-consent';
import { clientPolicyKey, clientUidSchema } from './client-policy';
import { prepareBookingActionAdmission } from './booking-action-admission';
import { readVerifiedAttendanceHead } from './appointment-attendance';
import { readResourceSchedulePolicy, resourceDayScheduleFingerprint } from './resource-schedules';
import { businessConfigSchema, documentIdSchema, requestIdSchema } from './schemas';
import { HttpError } from './http';

const unverifiable = () => new HttpError(503, 'No se pudo verificar este cambio de horario.', 'OWNER_RESCHEDULE_UNVERIFIABLE');
const conflict = (code: string, message: string) => new HttpError(409, message, `OWNER_RESCHEDULE_${code}`);
const changed = () => conflict('SOURCE_CHANGED', 'La cita cambió. Consulta el origen de nuevo.');
const hash = z.string().length(64).regex(/^[a-f0-9]{64}$/);
const timestamp = z.number().int().positive().safe();
const recordSchema = ownerRescheduleProposalViewSchema.extend({
  version: z.literal(1), actorUid: clientUidSchema.refine(value => !/[\u0000-\u001f\u007f]/.test(value)),
  commandFingerprint: hash, catalogFingerprint: hash, resourceScheduleFingerprint: hash,
  createdAt: timestamp, state: z.enum(['prepared', 'closed', 'applied']), result: rescheduleResultSchema.nullable(),
  closedAt: timestamp.optional(), closedReason: z.literal('expired').optional(),
}).strict().refine(value => value.expiresAt === value.createdAt + 600000
  && (value.state === 'applied' ? value.result !== null : value.result === null)
  && (value.state === 'closed' ? value.closedAt !== undefined && value.closedAt >= value.expiresAt && value.closedReason === 'expired'
    : value.closedAt === undefined && value.closedReason === undefined));
type ProposalRecord = z.infer<typeof recordSchema>;
const proposalIdFor = (businessId: string, appointmentId: string, actorUid: string, requestId: string) => stableDocumentId('owner-reschedule', businessId, appointmentId, actorUid, requestId);
const commandFingerprint = (businessId: string, appointmentId: string, actorUid: string, command: OwnerRescheduleCommand) => bookingSubjectHash({ businessId, appointmentId, actorUid, ...command });
const proposalRef = (db: Database, businessId: string, id: string) => db.collection('businesses').doc(businessId).collection('ownerRescheduleProposals').doc(id);
const view = (record: ProposalRecord): OwnerRescheduleProposalView => ownerRescheduleProposalViewSchema.parse({
  id: record.id, businessId: record.businessId, appointmentId: record.appointmentId, requestId: record.requestId,
  sourceRevision: record.sourceRevision, sourceFingerprint: record.sourceFingerprint, expiresAt: record.expiresAt, source: record.source, target: record.target,
});

function parseRecord(data: unknown, businessId: string, id: string, owner: ChatActor): ProposalRecord {
  const parsed = recordSchema.safeParse(data);
  if (!parsed.success) throw unverifiable();
  const record = parsed.data;
  if (record.businessId !== businessId || record.id !== id) throw unverifiable();
  if (record.actorUid !== owner.uid) throw new HttpError(403, 'Esta propuesta pertenece a otra cuenta.');
  const command: OwnerRescheduleCommand = { requestId: record.requestId, sourceRevision: record.sourceRevision, sourceFingerprint: record.sourceFingerprint,
    selection: { dateKey: record.target.dateKey, startTimeStr: record.target.startTimeStr, resourceId: record.target.resourceId } };
  if (record.id !== proposalIdFor(businessId, record.appointmentId, record.actorUid, record.requestId)
    || record.commandFingerprint !== commandFingerprint(businessId, record.appointmentId, record.actorUid, command)) throw unverifiable();
  return record;
}
async function readBusiness(tx: Transaction, db: Database, businessId: string, owner: ChatActor): Promise<Business> {
  const snapshot = await tx.get(db.collection('businesses').doc(businessId));
  if (!snapshot.exists) throw new HttpError(404, 'El negocio no existe.');
  const business = snapshot.data() as Business;
  assertOwner(business, owner.uid);
  if (business.id !== businessId) throw unverifiable();
  return business;
}
async function readAppointment(tx: Transaction, db: Database, businessId: string, appointmentId: string): Promise<Appointment> {
  const snapshot = await tx.get(db.collection('businesses').doc(businessId).collection('appointments').doc(appointmentId));
  if (!snapshot.exists) throw new HttpError(404, 'La cita no existe.');
  const parsed = ownerRescheduleAppointmentSchema.safeParse(snapshot.data());
  if (!parsed.success || parsed.data.id !== appointmentId || parsed.data.tenantId !== businessId) throw unverifiable();
  const source = parsed.data;
  if (Object.prototype.hasOwnProperty.call(source, 'client') && (!source.client || !clientUidSchema.safeParse(source.client.uid).success || /[\u0000-\u001f\u007f]/.test(source.client.uid))) throw unverifiable();
  return source;
}
function currentService(business: Business, source: Appointment): TenantService | null {
  const parsed = businessConfigSchema.shape.services.element.safeParse(business.services?.find(item => item.id === source.serviceId));
  return parsed.success ? parsed.data : null;
}
async function sourceState(tx: Transaction, db: Database, business: Business, source: Appointment, now: number): Promise<OwnerRescheduleSource> {
  const revision = appointmentRescheduleRevision(source);
  if (revision >= Number.MAX_SAFE_INTEGER - 1) throw unverifiable();
  const head = await readVerifiedAttendanceHead(tx, db, business.id, source);
  const { capability } = await readBookingDataPolicy(business.id, db, tx);
  const beneficiary = source.beneficiary === undefined ? null : bookingBeneficiarySchema.safeParse(source.beneficiary);
  const restricted = capability.dataMode !== 'general' || capability.representedMinorsEnabled
    || (beneficiary !== null && (!beneficiary.success || beneficiary.data.kind !== 'self'))
    || Object.prototype.hasOwnProperty.call(source, 'subjectAuthorization') || Object.prototype.hasOwnProperty.call(source, 'representationReview');
  const reason = source.type !== 'appointment' || source.status !== 'confirmed' ? 'unsupported_source'
    : head || source.startAt <= now ? 'source_started'
    : restricted ? 'restricted_policy'
    : !currentService(business, source) ? 'service_unavailable'
    : !business.sarinConfig?.onboardingCompleted || !business.slug ? 'business_unconfigured'
    : !canRescheduleSubscription(business, now) ? 'subscription_unavailable' : null;
  return { appointment: source, expectation: { sourceRevision: revision, sourceFingerprint: appointmentRescheduleFingerprint(source) }, eligible: reason === null, reason };
}
function assertWritable(state: OwnerRescheduleSource, expectation: OwnerRescheduleExpectation, now: number) {
  if (state.expectation.sourceRevision !== expectation.sourceRevision || state.expectation.sourceFingerprint !== expectation.sourceFingerprint) throw changed();
  if (state.appointment.startAt <= now || state.reason === 'source_started') throw conflict('SOURCE_STARTED', 'La cita ya comenzó; no se puede cambiar su horario.');
  if (!state.eligible) {
    if (state.reason === 'subscription_unavailable') throw new HttpError(402, 'La suscripción no permite cambiar esta cita.');
    if (state.reason === 'business_unconfigured') throw new HttpError(403, 'El negocio todavía no está configurado.');
    throw conflict('UNSUPPORTED', state.reason === 'service_unavailable' ? 'El servicio ya no está disponible.' : 'Este cambio está disponible para citas futuras de negocios generales, sin autorizaciones sensibles.');
  }
}
function assertHorizon(dateKey: string, now: number) {
  if (toColombiaTimestamp(dateKey, '00:00') > now + 366 * 86400000) throw new HttpError(400, 'Puedes elegir una fecha hasta un año por adelantado.');
}
function targetCatalog(business: Business, source: Appointment, resourceId: string) {
  const service = currentService(business, source);
  if (!service) throw conflict('CATALOG_CHANGED', 'El servicio cambió; consulta una propuesta nueva.');
  const resource = businessConfigSchema.shape.resources.element.safeParse(business.resources?.find(item => item.id === resourceId));
  if (!resource.success || !resource.data.active || !service.resourceIds.includes(resourceId)) throw new HttpError(400, 'Selecciona un profesional disponible para este servicio.');
  return { service, resource: resource.data };
}
async function destinationContext(tx: Transaction, db: Database, business: Business, source: Appointment, dateKey: string, resourceId?: string) {
  const policy = await readResourceSchedulePolicy(tx, business.id, db);
  let query = db.collection('businesses').doc(business.id).collection('appointments').where('dateKey', '==', dateKey).where('status', '==', 'confirmed');
  if (resourceId) query = query.where('resourceId', '==', resourceId);
  const appointments = await tx.get(query);
  return { policy, appointments: appointments.docs.filter(doc => doc.id !== source.id).map(doc => doc.data() as Appointment) };
}
function recovery(record: ProposalRecord, appointment: Appointment): OwnerRescheduleRecovery {
  const parsed = ownerRescheduleRecoverySchema.safeParse({ proposal: view(record), state: record.state, appointment, result: record.result });
  if (!parsed.success) throw unverifiable();
  return parsed.data;
}

export async function readOwnerRescheduleSource(owner: ChatActor, businessId: string, appointmentId: string, db: Database = getAdminDb()): Promise<OwnerRescheduleSource> {
  documentIdSchema.parse(businessId); documentIdSchema.parse(appointmentId);
  return db.runTransaction(async tx => {
    const business = await readBusiness(tx, db, businessId, owner), source = await readAppointment(tx, db, businessId, appointmentId);
    return sourceState(tx, db, business, source, Date.now());
  });
}
export async function readOwnerRescheduleAvailability(owner: ChatActor, businessId: string, appointmentId: string, supplied: OwnerRescheduleExpectation & { dateKey: string; resourceId?: string }, db: Database = getAdminDb()) {
  documentIdSchema.parse(businessId); documentIdSchema.parse(appointmentId); const input = ownerRescheduleAvailabilitySchema.parse(supplied);
  return db.runTransaction(async tx => {
    const business = await readBusiness(tx, db, businessId, owner), source = await readAppointment(tx, db, businessId, appointmentId);
    const state = await sourceState(tx, db, business, source, Date.now()); assertWritable(state, input, Date.now());
    await assertConsent(owner.uid, 'account', undefined, db, tx);
    if (input.resourceId) targetCatalog(business, source, input.resourceId);
    const context = await destinationContext(tx, db, business, source, input.dateKey, input.resourceId), now = Date.now();
    assertWritable(state, input, now); assertHorizon(input.dateKey, now);
    return getAvailableSlots({ tenant: business, resourceSchedulePolicy: context.policy, dateKey: input.dateKey, serviceId: source.serviceId!, resourceId: input.resourceId, existingAppointments: context.appointments, now });
  });
}
export async function prepareOwnerReschedule(owner: ChatActor, businessId: string, appointmentId: string, supplied: OwnerRescheduleCommand, db: Database = getAdminDb()): Promise<{ proposal: OwnerRescheduleProposalView; replayed: boolean }> {
  documentIdSchema.parse(businessId); documentIdSchema.parse(appointmentId); const input = ownerRescheduleCommandSchema.parse(supplied); requestIdSchema.parse(input.requestId);
  const id = proposalIdFor(businessId, appointmentId, owner.uid, input.requestId), fingerprint = commandFingerprint(businessId, appointmentId, owner.uid, input), ref = proposalRef(db, businessId, id);
  return db.runTransaction(async tx => {
    const business = await readBusiness(tx, db, businessId, owner), source = await readAppointment(tx, db, businessId, appointmentId), previous = await tx.get(ref);
    if (previous.exists) {
      const record = parseRecord(previous.data(), businessId, id, owner);
      if (record.appointmentId !== appointmentId || record.commandFingerprint !== fingerprint) throw conflict('REQUEST_REUSED', 'Ese intento ya corresponde a otra selección.');
      recovery(record, source);
      return { proposal: view(record), replayed: true };
    }
    const state = await sourceState(tx, db, business, source, Date.now()); assertWritable(state, input, Date.now());
    await assertConsent(owner.uid, 'account', undefined, db, tx);
    const { selection } = input, catalog = targetCatalog(business, source, selection.resourceId);
    if (source.dateKey === selection.dateKey && source.startTimeStr === selection.startTimeStr && source.resourceId === selection.resourceId) throw conflict('NO_CHANGE', 'Selecciona un horario o profesional diferente.');
    const context = await destinationContext(tx, db, business, source, selection.dateKey, selection.resourceId);
    const admit = await prepareBookingActionAdmission(tx, db, owner.uid, businessId, 'proposal', `owner-reschedule:${input.requestId}`);
    const now = Date.now(); assertWritable(state, input, now); assertHorizon(selection.dateKey, now);
    if (!getAvailableSlots({ tenant: business, resourceSchedulePolicy: context.policy, ...selection, serviceId: catalog.service.id, existingAppointments: context.appointments, now }).some(item => item.resourceId === selection.resourceId && item.slots.includes(selection.startTimeStr))) throw new HttpError(409, 'El horario ya no está disponible. Consulta otra hora.');
    const startAt = toColombiaTimestamp(selection.dateKey, selection.startTimeStr), endAt = startAt + catalog.service.durationMinutes * 60000;
    const record: ProposalRecord = recordSchema.parse({
      version: 1, id, businessId, appointmentId, requestId: input.requestId, sourceRevision: input.sourceRevision, sourceFingerprint: input.sourceFingerprint,
      source: { dateKey: source.dateKey, startTimeStr: source.startTimeStr, endTimeStr: source.endTimeStr, startAt: source.startAt, endAt: source.endAt, reservedUntilAt: source.reservedUntilAt, resourceId: source.resourceId,
        resourceName: business.resources.find(resource => resource.id === source.resourceId && resource.active)?.name || 'Recurso anterior no disponible', priceCOP: source.price ?? null },
      target: { ...selection, serviceId: catalog.service.id, serviceName: catalog.service.name, resourceName: catalog.resource.name, endTimeStr: toTimeStr(toMinutes(selection.startTimeStr) + catalog.service.durationMinutes), startAt, endAt, reservedUntilAt: endAt + catalog.service.bufferMinutes * 60000,
        durationMinutes: catalog.service.durationMinutes, bufferMinutes: catalog.service.bufferMinutes, priceCOP: catalog.service.price },
      actorUid: owner.uid, commandFingerprint: fingerprint, catalogFingerprint: bookingSubjectHash(catalog), resourceScheduleFingerprint: resourceDayScheduleFingerprint(business, context.policy, selection.resourceId, selection.dateKey),
      createdAt: now, expiresAt: now + 600000, state: 'prepared', result: null,
    });
    admit(); tx.create(ref, record); return { proposal: view(record), replayed: false };
  });
}
export async function readOwnerRescheduleProposal(owner: ChatActor, businessId: string, proposalId: string, db: Database = getAdminDb()): Promise<OwnerRescheduleRecovery> {
  documentIdSchema.parse(businessId); documentIdSchema.parse(proposalId);
  return db.runTransaction(async tx => {
    await readBusiness(tx, db, businessId, owner);
    const snapshot = await tx.get(proposalRef(db, businessId, proposalId));
    if (!snapshot.exists) throw new HttpError(404, 'La propuesta no existe.');
    const record = parseRecord(snapshot.data(), businessId, proposalId, owner);
    return recovery(record, await readAppointment(tx, db, businessId, record.appointmentId));
  });
}
export async function confirmOwnerReschedule(owner: ChatActor, businessId: string, proposalId: string, db: Database = getAdminDb()): Promise<OwnerRescheduleConfirmation> {
  documentIdSchema.parse(businessId); documentIdSchema.parse(proposalId);
  const ref = proposalRef(db, businessId, proposalId);
  const result = await db.runTransaction(async tx => {
    const business = await readBusiness(tx, db, businessId, owner), snapshot = await tx.get(ref);
    if (!snapshot.exists) throw new HttpError(404, 'La propuesta no existe.');
    const record = parseRecord(snapshot.data(), businessId, proposalId, owner), source = await readAppointment(tx, db, businessId, record.appointmentId);
    recovery(record, source);
    if (record.state === 'applied') return { appointment: source, rescheduleResult: record.result!, replayed: true };
    if (record.state === 'closed') return null;
    const close = (now: number) => { tx.set(ref, { ...record, state: 'closed', closedAt: now, closedReason: 'expired' }); return null; };
    if (record.expiresAt <= Date.now()) return close(Date.now());
    const state = await sourceState(tx, db, business, source, Date.now()); assertWritable(state, record, Date.now());
    await assertConsent(owner.uid, 'account', undefined, db, tx);
    const target = record.target, catalog = targetCatalog(business, source, target.resourceId);
    if (bookingSubjectHash(catalog) !== record.catalogFingerprint) throw conflict('CATALOG_CHANGED', 'El servicio o profesional cambió. Revisa una propuesta nueva.');
    const context = await destinationContext(tx, db, business, source, target.dateKey, target.resourceId);
    if (resourceDayScheduleFingerprint(business, context.policy, target.resourceId, target.dateKey) !== record.resourceScheduleFingerprint) throw conflict('SCHEDULE_CHANGED', 'Los horarios cambiaron. Revisa una propuesta nueva.');
    const keys = [...new Set([`${source.dateKey}_${source.resourceId}`, `${target.dateKey}_${target.resourceId}`, ...(source.client ? [`client_${clientPolicyKey(source.client.uid)}`] : [])])];
    const lockRefs = keys.map(key => db.collection('businesses').doc(businessId).collection('bookingLocks').doc(key));
    const locks = await Promise.all(lockRefs.map(lock => tx.get(lock))), now = Date.now();
    if (record.expiresAt <= now) return close(now);
    assertWritable(state, record, now); assertHorizon(target.dateKey, now);
    if (!getAvailableSlots({ tenant: business, resourceSchedulePolicy: context.policy, dateKey: target.dateKey, resourceId: target.resourceId, serviceId: catalog.service.id, existingAppointments: context.appointments, now }).some(item => item.resourceId === target.resourceId && item.slots.includes(target.startTimeStr))) throw new HttpError(409, 'El horario ya no está disponible. Consulta otra hora.');
    const versions = locks.map(lock => {
      if (!lock.exists) return 0;
      const version = lock.data()?.version;
      if (!Number.isSafeInteger(version) || version < 0 || version >= Number.MAX_SAFE_INTEGER) throw unverifiable();
      return version as number;
    });
    const appointment: Appointment = { ...source, dateKey: target.dateKey, startTimeStr: target.startTimeStr, endTimeStr: target.endTimeStr, startAt: target.startAt, endAt: target.endAt, reservedUntilAt: target.reservedUntilAt,
      resourceId: target.resourceId, serviceName: target.serviceName, price: target.priceCOP, rescheduleRevision: record.sourceRevision + 1, lastRescheduleProposalId: record.id, rescheduledAt: now };
    const rescheduleResult = rescheduleResultSchema.parse({ proposalId: record.id, appointmentId: source.id, revision: record.sourceRevision + 1, dateKey: target.dateKey, startTimeStr: target.startTimeStr, resourceId: target.resourceId, startAt: target.startAt, endAt: target.endAt, confirmedAt: now });
    recovery({ ...record, state: 'applied', result: rescheduleResult }, appointment);
    for (const [index, lock] of lockRefs.entries()) tx.set(lock, { version: versions[index] + 1, updatedAt: now });
    tx.set(db.collection('businesses').doc(businessId).collection('appointments').doc(source.id), appointment);
    tx.set(ref, { ...record, state: 'applied', result: rescheduleResult });
    return { appointment, rescheduleResult, replayed: false };
  });
  if (!result) throw conflict('PROPOSAL_CLOSED', 'La propuesta venció y quedó cerrada. Consulta el origen de nuevo.');
  return result;
}
