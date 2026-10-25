import 'server-only';
import { readResourceSchedulePolicy } from './resource-schedules';
import { z } from 'zod';
import type { ChatActor } from '@/types/chat';
import type { Appointment, Business } from '@/types/firestore';
import type { WaitlistJoinInput, WaitlistCancelInput, WaitlistRequestView, WaitlistState, WaitlistSuspensionReason } from '@/types/waitlist';
import type { Database, Transaction } from '@/lib/storage/types';
import { bookingSubjectCaseSchema } from '@/lib/booking-subject';
import { getAdminDb } from '@/lib/firebase/admin';
import { getAvailableSlots, toColombiaTimestamp } from '@/lib/sarin/availability';
import { isSubscriptionAllowed } from '@/lib/sarin/subscription';
import { stableDocumentId, assertOwner } from './businesses';
import { documentIdSchema, requestIdSchema, dateKeySchema, businessConfigSchema, weeklyScheduleSchema } from './schemas';
import { clientUidSchema, assertClientCanBook } from './client-policy';
import { readVerifiedConsentAnchor } from './consent';
import { readVerifiedBookingSubjectAnchor, bookingSubjectHash } from './booking-subject-consent';
import { assertBookingIntakePolicy } from './booking-data-policy';
import { prepareBookingActionAdmission } from './booking-action-admission';
import { HttpError } from './http';

const DAY = 86_400_000;
const count = z.number().int().nonnegative().safe();
const revision = count.max(Number.MAX_SAFE_INTEGER - 1);
const fingerprint = z.string().regex(/^[a-f0-9]{64}$/);
const anchorSchema = z.object({ revision: count.min(1), fingerprint, receiptId: documentIdSchema }).strict();
const anchorsSchema = z.object({ account: anchorSchema, business: anchorSchema, subject: anchorSchema.nullable(), policyRevision: count }).strict();
export const waitlistJoinInputSchema = z.object({ requestId: requestIdSchema, expectedRevision: revision, case: bookingSubjectCaseSchema, serviceId: documentIdSchema, dateKey: dateKeySchema, resourceId: documentIdSchema.optional() }).strict();
export const waitlistCancelInputSchema = z.object({ requestId: requestIdSchema, expectedRevision: revision, entryId: documentIdSchema }).strict();
const requestSchema = z.object({ id: documentIdSchema, case: bookingSubjectCaseSchema, serviceId: documentIdSchema, dateKey: dateKeySchema, resourceId: documentIdSchema.nullable(), createdAt: count, expiresAt: count, anchors: anchorsSchema }).strict();
export const waitlistRecordSchema = z.object({ version: z.literal(1), ownerUid: clientUidSchema, businessId: documentIdSchema, revision: count.min(1), updatedAt: count, request: requestSchema.nullable(),
  lastOperation: z.object({ requestId: requestIdSchema, operationHash: fingerprint, appliedRevision: count.min(1) }).strict() }).strict();
export type WaitlistRecord = z.infer<typeof waitlistRecordSchema>;
type ReadPrincipal = Pick<ChatActor, 'uid'>;
type SavedRequest = z.infer<typeof requestSchema>;
type Anchor = z.infer<typeof anchorSchema>;
const unavailable = () => new HttpError(503, 'No se pudo comprobar tu solicitud en la lista de espera.', 'WAITLIST_UNAVAILABLE');
const changed = () => new HttpError(409, 'La solicitud cambió. Vuelve a consultar la lista de espera.', 'WAITLIST_CHANGED');
export const waitlistDocumentId = (uid: string, businessId: string) => stableDocumentId('waitlist', businessId, uid);
export const waitlistEntryId = (uid: string, businessId: string, requestId: string) => stableDocumentId('waitlist-entry', businessId, uid, requestId);
const dateAt = (now: number) => new Date(now - 5 * 3_600_000).toISOString().slice(0, 10);
const expiry = (dateKey: string) => toColombiaTimestamp(dateKey, '00:00') + DAY;
const sameAnchor = (left: Anchor | null, right: Anchor | null) => left === null && right === null || Boolean(left && right && left.revision === right.revision && left.fingerprint === right.fingerprint && left.receiptId === right.receiptId);
function stored<T>(schema: z.ZodType<T>, value: unknown): T { const result = schema.safeParse(value); if (!result.success) throw unavailable(); return result.data; }
function validateScope(user: ChatActor, businessId: string) { clientUidSchema.parse(user.uid); documentIdSchema.parse(businessId); }
export function parseCanonicalWaitlistRecord(recordId: string, value: unknown, businessId: string): WaitlistRecord {
  const record = stored(waitlistRecordSchema, value);
  if (/[^A-Za-z0-9_-]/.test(recordId) || /[\x00-\x1f\x7f]/.test(record.ownerUid) || record.businessId !== businessId || recordId !== waitlistDocumentId(record.ownerUid, businessId)
    || record.revision !== record.lastOperation.appliedRevision || /[\x00-\x1f\x7f]/.test(record.lastOperation.requestId)
    || record.request && (/[\x00-\x1f\x7f]/.test(record.request.id) || record.request.expiresAt !== expiry(record.request.dateKey)
      || record.request.createdAt >= record.request.expiresAt || record.request.createdAt > record.updatedAt
      || record.request.id !== waitlistEntryId(record.ownerUid, businessId, record.lastOperation.requestId))) throw unavailable();
  return record;
}
async function context(tx: Transaction, user: ReadPrincipal, businessId: string, db: Database) {
  const businessRef = db.collection('businesses').doc(businessId), ref = businessRef.collection('waitlistRequests').doc(waitlistDocumentId(user.uid, businessId));
  const doc = await tx.get(ref), record = doc.exists ? parseCanonicalWaitlistRecord(ref.id, doc.data(), businessId) : null;
  if (record && (record.ownerUid !== user.uid || record.businessId !== businessId || record.revision !== record.lastOperation.appliedRevision
    || record.request && (record.request.expiresAt !== expiry(record.request.dateKey) || record.request.createdAt >= record.request.expiresAt || record.request.createdAt > record.updatedAt
      || record.request.id !== waitlistEntryId(user.uid, businessId, record.lastOperation.requestId)))) throw unavailable();
  return { businessRef, ref, record };
}
function parseBusiness(value: unknown, businessId: string): Business {
  const schema = z.object({ id: z.literal(businessId), name: z.string(), phoneWhatsApp: z.string(), slug: z.string(),
    services: z.array(businessConfigSchema.shape.services.element).max(60), resources: z.array(businessConfigSchema.shape.resources.element).max(30), weeklySchedule: weeklyScheduleSchema,
    sarinConfig: z.object({ onboardingCompleted: z.boolean(), intakeFields: businessConfigSchema.shape.intakeFields }),
    subscription: z.object({ status: z.enum(['pending_payment', 'trial', 'active', 'past_due', 'suspended']), currentPeriodEndsAt: count, graceEndsAt: count.optional() }),
  });
  stored(schema, value);
  return value as Business;
}
async function permissions(tx: Transaction, user: ReadPrincipal, business: Business, subjectCase: SavedRequest['case'], db: Database) {
  const [account, businessConsent, subject] = await Promise.all([
    readVerifiedConsentAnchor(user.uid, 'account', undefined, db, tx),
    readVerifiedConsentAnchor(user.uid, 'business_client', business, db, tx),
    readVerifiedBookingSubjectAnchor(tx, user, business.id, subjectCase, db),
  ]);
  const accountAnchor = account.active ? stored(anchorSchema, { revision: account.revision, fingerprint: account.fingerprint, receiptId: account.receiptId }) : null;
  const businessAnchor = businessConsent.active ? stored(anchorSchema, { revision: businessConsent.revision, fingerprint: businessConsent.fingerprint, receiptId: businessConsent.receiptId }) : null;
  return { account: accountAnchor, business: businessAnchor, subject: subject.status.required ? subject.anchor : null, status: subject.status,
    active: Boolean(account.active && businessConsent.active && (!subject.status.required || subject.status.active) && (subjectCase.subjectKind !== 'represented_minor' || subject.status.capability.representedMinorsEnabled)) };
}
function selectedService(business: Business, item: Pick<SavedRequest, 'serviceId' | 'resourceId'>) {
  const service = business.services.find(candidate => candidate.id === item.serviceId);
  return Boolean(service && business.resources.some(resource => resource.active && service.resourceIds.includes(resource.id) && (!item.resourceId || resource.id === item.resourceId)));
}
async function policyIssue(tx: Transaction, user: ReadPrincipal, business: Business, db: Database): Promise<WaitlistSuspensionReason | undefined> {
  let reason: WaitlistSuspensionReason | undefined;
  try { await assertBookingIntakePolicy(tx, business.id, business.sarinConfig.intakeFields, db); }
  catch (error) { if (error instanceof HttpError && error.code === 'BOOKING_FREE_INTAKE_NOT_ALLOWED') reason = 'booking_policy_changed'; else throw error; }
  try { await assertClientCanBook(tx, business, user.uid, Date.now(), db); }
  catch (error) {
    if (error instanceof HttpError && error.code === 'CLIENT_BLOCKED') reason ??= 'client_blocked';
    else if (error instanceof HttpError && error.code === 'CLIENT_BOOKING_LIMIT') reason ??= 'client_limit';
    else throw error;
  }
  return reason;
}
async function appointments(tx: Transaction, current: Awaited<ReturnType<typeof context>>, dateKey: string) {
  // Never truncate: a storage overflow must fail instead of inventing free slots.
  // Date ordering keeps the selected document set unchanged and uses the
  // existing date prefix instead of a parent/path scan over historical visits.
  const docs = await tx.get(current.businessRef.collection('appointments').where('dateKey', '==', dateKey).where('status', '==', 'confirmed').orderBy('dateKey'));
  return docs.docs.map(doc => doc.data() as Appointment);
}
function view(item: SavedRequest, status: WaitlistRequestView['status'], checkedAt: number | null, reason?: WaitlistSuspensionReason): WaitlistRequestView {
  return { id: item.id, serviceId: item.serviceId, dateKey: item.dateKey, resourceId: item.resourceId, subjectKind: item.case.subjectKind,
    ...(item.case.subjectKind === 'represented_minor' ? { representativeRole: item.case.representativeRole } : {}), createdAt: item.createdAt, expiresAt: item.expiresAt, status, ...(reason ? { reason } : {}), checkedAt };
}
const response = (user: ReadPrincipal, businessId: string, record: WaitlistRecord | null, request: WaitlistRequestView | null): WaitlistState => ({ businessId, ownerUid: user.uid, revision: record?.revision ?? 0, serverNow: Date.now(), request });
async function projectWaitlist(tx: Transaction, user: ReadPrincipal, businessId: string, current: Awaited<ReturnType<typeof context>>, db: Database): Promise<{ state: WaitlistState; availability: { resourceId: string; resourceName: string; slots: string[] }[] }> {
  const withoutSlots = (state: WaitlistState) => ({ state, availability: [] });
  const item = current.record?.request;
  if (!item) return withoutSlots(response(user, businessId, current.record, null));
  if (item.expiresAt <= Date.now()) return withoutSlots(response(user, businessId, current.record, view(item, 'expired', null)));
  const businessDoc = await tx.get(current.businessRef);
  if (!businessDoc.exists) return withoutSlots(response(user, businessId, current.record, view(item, 'suspended', null, 'business_unavailable')));
  const business = parseBusiness(businessDoc.data(), businessId);
  // Validate all evidence before classifying a legitimate suspension. Corruption
  // in one permission cannot hide behind another permission being inactive.
  const currentPermissions = await permissions(tx, user, business, item.case, db).catch(error => {
    // This case came from our immutable saved request, not this GET's caller.
    if (error instanceof HttpError && error.code === 'BOOKING_SUBJECT_CONFLICT') throw unavailable();
    throw error;
  }), issue = await policyIssue(tx, user, business, db);
  if (item.anchors.policyRevision === currentPermissions.status.capability.revision && Boolean(item.anchors.subject) !== currentPermissions.status.required) throw unavailable();
  let reason: WaitlistSuspensionReason | undefined;
  if (item.anchors.policyRevision !== currentPermissions.status.capability.revision) reason = 'booking_policy_changed';
  else if (!currentPermissions.active || !sameAnchor(item.anchors.account, currentPermissions.account) || !sameAnchor(item.anchors.business, currentPermissions.business) || !sameAnchor(item.anchors.subject, currentPermissions.subject)) reason = 'consent_changed';
  else if (!business.sarinConfig.onboardingCompleted || !business.slug || !isSubscriptionAllowed(business)) reason = 'business_unavailable';
  else if (!selectedService(business, item)) reason = 'service_unavailable';
  reason ??= issue;
  if (reason) return withoutSlots(response(user, businessId, current.record, view(item, item.expiresAt <= Date.now() ? 'expired' : 'suspended', null, item.expiresAt <= Date.now() ? undefined : reason)));
  const existingAppointments = await appointments(tx, current, item.dateKey);
  const resourceSchedulePolicy = await readResourceSchedulePolicy(tx, business.id, db), now = Date.now();
  if (item.expiresAt <= now) return withoutSlots(response(user, businessId, current.record, view(item, 'expired', null)));
  if (!isSubscriptionAllowed(business, now)) return withoutSlots(response(user, businessId, current.record, view(item, 'suspended', null, 'business_unavailable')));
  const slots = getAvailableSlots({ resourceSchedulePolicy, tenant: business, dateKey: item.dateKey, serviceId: item.serviceId, ...(item.resourceId ? { resourceId: item.resourceId } : {}), existingAppointments, now });
  return { state: response(user, businessId, current.record, view(item, slots.some(resource => resource.slots.length) ? 'available' : 'waiting', now)), availability: slots };
}
async function projection(tx: Transaction, user: ReadPrincipal, businessId: string, current: Awaited<ReturnType<typeof context>>, db: Database): Promise<WaitlistState> {
  return (await projectWaitlist(tx, user, businessId, current, db)).state;
}
/** Owner authority is checked here too; a stored data principal never authorizes a mutation. */
export async function readOwnerWaitlistProjection(tx: Transaction, owner: ChatActor, businessId: string, recordId: string, db: Database) {
  const businessRef = db.collection('businesses').doc(businessId), businessDoc = await tx.get(businessRef);
  if (!businessDoc.exists) throw new HttpError(404, 'El negocio no existe.');
  assertOwner(businessDoc.data() as Business, owner.uid);
  if (businessDoc.data()?.id !== businessId) throw unavailable();
  const ref = businessRef.collection('waitlistRequests').doc(recordId), doc = await tx.get(ref);
  if (!doc.exists) throw new HttpError(404, 'La entrada ya no está disponible.', 'OWNER_WAITLIST_ENTRY_GONE');
  const record = parseCanonicalWaitlistRecord(recordId, doc.data(), businessId);
  if (!record.request) throw new HttpError(404, 'La entrada ya no está disponible.', 'OWNER_WAITLIST_ENTRY_GONE');
  const result = await projectWaitlist(tx, { uid: record.ownerUid }, businessId, { businessRef, ref, record }, db);
  return { recordId, record, ...result };
}
function replay(record: WaitlistRecord | null, input: { requestId: string; expectedRevision: number }, operationHash: string): boolean {
  if (record?.lastOperation.requestId === input.requestId) {
    if (record.lastOperation.operationHash !== operationHash) throw changed();
    return true;
  }
  if ((record?.revision ?? 0) !== input.expectedRevision) throw changed();
  return false;
}
/** Read-only, including availability refresh; no inference, notifications or admission writes. */
export async function readWaitlist(user: ChatActor, businessId: string, db: Database = getAdminDb()): Promise<WaitlistState> {
  validateScope(user, businessId);
  return db.runTransaction(async tx => projection(tx, user, businessId, await context(tx, user, businessId, db), db));
}
export async function joinWaitlist(user: ChatActor, businessId: string, supplied: WaitlistJoinInput, db: Database = getAdminDb()): Promise<WaitlistState> {
  validateScope(user, businessId); const input = waitlistJoinInputSchema.parse(supplied), operationHash = bookingSubjectHash({ kind: 'join', ...input });
  return db.runTransaction(async tx => {
    const current = await context(tx, user, businessId, db);
    if (replay(current.record, input, operationHash)) return projection(tx, user, businessId, current, db);
    if (current.record?.request && current.record.request.expiresAt > Date.now()) throw new HttpError(409, 'Ya tienes una solicitud en este negocio. Sal de la lista antes de elegir otra.', 'WAITLIST_REQUEST_EXISTS');
    const businessDoc = await tx.get(current.businessRef);
    if (!businessDoc.exists) throw new HttpError(404, 'El negocio no existe.');
    const business = parseBusiness(businessDoc.data(), businessId), permit = await permissions(tx, user, business, input.case, db);
    if (!permit.active || !permit.account || !permit.business) throw new HttpError(428, 'Revisa los permisos actuales de tu cuenta, del negocio y de esta reserva.', 'CONSENT_REQUIRED');
    await assertBookingIntakePolicy(tx, businessId, business.sarinConfig.intakeFields, db);
    if (!business.sarinConfig.onboardingCompleted || !business.slug) throw new HttpError(403, 'El negocio todavía no está configurado.');
    if (!isSubscriptionAllowed(business)) throw new HttpError(402, 'Las nuevas reservas están en pausa.');
    await assertClientCanBook(tx, business, user.uid, Date.now(), db);
    const selection = { serviceId: input.serviceId, dateKey: input.dateKey, resourceId: input.resourceId ?? null };
    if (!selectedService(business, selection)) throw new HttpError(400, 'Selecciona un servicio y profesional disponibles.');
    const existingAppointments = await appointments(tx, current, input.dateKey);
    // The same caller requestId can be reused after a cancellation with a new
    // revision. Count that new intention while exact replay above stays free.
    const admit = await prepareBookingActionAdmission(tx, db, user.uid, businessId, 'waitlist', operationHash);
    const now = Date.now(), expiresAt = expiry(input.dateKey);
    if (input.dateKey < dateAt(now) || input.dateKey > dateAt(now + 366 * DAY) || expiresAt <= now) throw new HttpError(400, 'Elige un día entre hoy y los próximos 366 días.');
    if (!isSubscriptionAllowed(business, now)) throw new HttpError(402, 'Las nuevas reservas están en pausa.');
    const slots = getAvailableSlots({ resourceSchedulePolicy: await readResourceSchedulePolicy(tx, business.id, db), tenant: business, dateKey: input.dateKey, serviceId: input.serviceId, resourceId: input.resourceId, existingAppointments, now });
    if (slots.some(resource => resource.slots.length)) throw new HttpError(409, 'Ya hay horarios disponibles. Consulta el calendario para elegir uno.', 'WAITLIST_SLOTS_AVAILABLE');
    const request: SavedRequest = { id: waitlistEntryId(user.uid, businessId, input.requestId), case: input.case, ...selection, createdAt: now, expiresAt,
      anchors: { account: permit.account, business: permit.business, subject: permit.subject, policyRevision: permit.status.capability.revision } };
    const next: WaitlistRecord = { version: 1, ownerUid: user.uid, businessId, revision: input.expectedRevision + 1, updatedAt: now, request, lastOperation: { requestId: input.requestId, operationHash, appliedRevision: input.expectedRevision + 1 } };
    admit(); tx.set(current.ref, next);
    return response(user, businessId, next, view(request, 'waiting', now));
  });
}
export async function cancelWaitlist(user: ChatActor, businessId: string, supplied: WaitlistCancelInput, db: Database = getAdminDb()): Promise<WaitlistState> {
  validateScope(user, businessId); const input = waitlistCancelInputSchema.parse(supplied), operationHash = bookingSubjectHash({ kind: 'cancel', ...input });
  return db.runTransaction(async tx => {
    const current = await context(tx, user, businessId, db);
    if (replay(current.record, input, operationHash)) return projection(tx, user, businessId, current, db);
    if (!current.record?.request || current.record.request.id !== input.entryId) throw changed();
    const next: WaitlistRecord = { version: 1, ownerUid: user.uid, businessId, revision: input.expectedRevision + 1, updatedAt: Date.now(), request: null,
      lastOperation: { requestId: input.requestId, operationHash, appliedRevision: input.expectedRevision + 1 } };
    tx.set(current.ref, next);
    return response(user, businessId, next, null);
  });
}
