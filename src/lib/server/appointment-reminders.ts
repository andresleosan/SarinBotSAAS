import 'server-only';
import { z } from 'zod';
import type { Appointment, Business } from '@/types/firestore';
import type { ChatActor } from '@/types/chat';
import type { AppointmentReminder, AppointmentReminders, ReminderOccurrence } from '@/types/appointment-reminders';
import type { Database, Transaction } from '@/lib/storage/types';
import { getAdminDb } from '@/lib/firebase/admin';
import { stableDocumentId } from './businesses';
import { documentIdSchema } from './schemas';
import { clientUidSchema } from './client-policy';
import { readVerifiedConsentAnchor } from './consent';
import { HttpError } from './http';

const OFFSET = 1440 as const;
const DAY = 86_400_000;
const MAX_REMINDERS = 100;
const count = z.number().int().nonnegative().safe();
const sourceRevision = count.max(Number.MAX_SAFE_INTEGER - 1);
export const reminderPreferenceInputSchema = z.object({ enabled: z.boolean(), expectedRevision: count.max(Number.MAX_SAFE_INTEGER - 1) }).strict();
export const reminderOccurrenceSchema = z.object({ appointmentId: documentIdSchema, sourceRevision, sourceStartAt: count, offsetMinutes: z.literal(OFFSET) }).strict();
const anchorSchema = z.object({ revision: count.min(1), fingerprint: z.string().regex(/^[a-f0-9]{64}$/), receiptId: documentIdSchema }).strict();
const anchorsSchema = z.object({ account: anchorSchema, business: anchorSchema }).strict();
const preferenceSchema = z.object({ version: z.literal(1), ownerUid: clientUidSchema, businessId: documentIdSchema, revision: count.min(1), enabled: z.boolean(), offsetMinutes: z.literal(OFFSET), updatedAt: count, anchors: anchorsSchema.nullable() }).strict();
const receiptSchema = reminderOccurrenceSchema.extend({ version: z.literal(1), ownerUid: clientUidSchema, businessId: documentIdSchema, seenAt: count }).strict();
export { preferenceSchema as reminderPreferenceRecordSchema, receiptSchema as reminderReceiptRecordSchema };
type Preference = z.infer<typeof preferenceSchema>;
const unavailable = () => new HttpError(503, 'No se pudieron comprobar tus recordatorios.', 'REMINDERS_UNAVAILABLE');
const inactive = () => new HttpError(428, 'Activa los recordatorios con tus permisos actuales antes de continuar.', 'REMINDERS_INACTIVE');
const stale = () => new HttpError(409, 'La cita o el recordatorio cambiaron. Actualiza Mis citas.', 'REMINDER_CHANGED');
export const reminderPreferenceId = (uid: string, businessId: string) => stableDocumentId('reminder-preference', businessId, uid);
export const reminderReceiptId = (uid: string, businessId: string, appointmentId: string) => stableDocumentId('reminder-seen', businessId, uid, appointmentId, String(OFFSET));

function parseStored<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value); if (!result.success) throw unavailable(); return result.data;
}
async function context(tx: Transaction, user: ChatActor, businessId: string, db: Database) {
  const businessRef = db.collection('businesses').doc(businessId);
  const preferenceRef = businessRef.collection('reminderPreferences').doc(reminderPreferenceId(user.uid, businessId));
  const [businessDoc, preferenceDoc] = await Promise.all([tx.get(businessRef), tx.get(preferenceRef)]);
  if (!businessDoc.exists) throw new HttpError(404, 'El negocio no existe.');
  const business = businessDoc.data() as Business;
  if (business.id !== businessId) throw unavailable();
  const preference = preferenceDoc.exists ? parseStored(preferenceSchema, preferenceDoc.data()) : null;
  if (preference && (preference.ownerUid !== user.uid || preference.businessId !== businessId || (preference.enabled && !preference.anchors))) throw unavailable();
  return { business, businessRef, preference, preferenceRef };
}
async function currentAnchors(tx: Transaction, user: ChatActor, business: Business, db: Database) {
  const [account, businessAnchor] = await Promise.all([
    readVerifiedConsentAnchor(user.uid, 'account', undefined, db, tx),
    readVerifiedConsentAnchor(user.uid, 'business_client', business, db, tx),
  ]);
  if (!account.active || !businessAnchor.active) return null;
  return parseStored(anchorsSchema, { account: { revision: account.revision, fingerprint: account.fingerprint, receiptId: account.receiptId },
    business: { revision: businessAnchor.revision, fingerprint: businessAnchor.fingerprint, receiptId: businessAnchor.receiptId } });
}
const sameAnchors = (a: Preference['anchors'], b: Preference['anchors']) => Boolean(a && b && a.account.revision === b.account.revision && a.account.fingerprint === b.account.fingerprint && a.account.receiptId === b.account.receiptId
  && a.business.revision === b.business.revision && a.business.fingerprint === b.business.fingerprint && a.business.receiptId === b.business.receiptId);
function occurrence(appointment: Appointment): ReminderOccurrence {
  return parseStored(reminderOccurrenceSchema, { appointmentId: appointment.id, sourceRevision: appointment.rescheduleRevision === undefined ? 0 : appointment.rescheduleRevision, sourceStartAt: appointment.startAt, offsetMinutes: OFFSET });
}
const sameOccurrence = (a: ReminderOccurrence, b: ReminderOccurrence) => a.appointmentId === b.appointmentId && a.sourceRevision === b.sourceRevision && a.sourceStartAt === b.sourceStartAt && a.offsetMinutes === b.offsetMinutes;
const isOwn = (appointment: Appointment, uid: string, businessId: string) => appointment.tenantId === businessId && appointment.type === 'appointment' && appointment.client?.uid === uid;
const inWindow = (start: number, now: number) => now < start && start <= now + DAY;
function seenReceipt(value: unknown, user: ChatActor, businessId: string, item: ReminderOccurrence) {
  if (value === undefined) return null;
  const receipt = parseStored(receiptSchema, value);
  if (receipt.ownerUid !== user.uid || receipt.businessId !== businessId || receipt.appointmentId !== item.appointmentId || receipt.offsetMinutes !== item.offsetMinutes) throw unavailable();
  return sameOccurrence(receipt, item) ? receipt.seenAt : null;
}
async function projection(tx: Transaction, user: ChatActor, current: Awaited<ReturnType<typeof context>>, db: Database, preference = current.preference, knownAnchors?: Preference['anchors']): Promise<AppointmentReminders> {
  let status: AppointmentReminders['preference']['status'] = 'disabled';
  if (preference?.enabled) status = sameAnchors(preference.anchors, knownAnchors === undefined ? await currentAnchors(tx, user, current.business, db) : knownAnchors) ? 'active' : 'suspended';
  let reminders: AppointmentReminder[] = [];
  if (status === 'active') {
    const queryNow = Date.now();
    const appointments = await tx.get(current.businessRef.collection('appointments').where('client.uid', '==', user.uid).where('status', '==', 'confirmed').where('type', '==', 'appointment')
      .where('startAt', '>', queryNow).where('startAt', '<=', queryNow + DAY).orderBy('startAt').limit(MAX_REMINDERS + 1));
    if (appointments.size > MAX_REMINDERS) throw new HttpError(413, 'Hay demasiadas citas en esta consulta. Contacta al negocio.', 'REMINDER_LIMIT');
    const items = appointments.docs.flatMap(doc => {
      const appointment = doc.data() as Appointment;
      if (!isOwn(appointment, user.uid, current.business.id) || appointment.status !== 'confirmed') return [];
      if (appointment.id !== doc.id) throw unavailable();
      return [occurrence(appointment)];
    });
    const receipts = await Promise.all(items.map(item => tx.get(current.businessRef.collection('reminderReceipts').doc(reminderReceiptId(user.uid, current.business.id, item.appointmentId)))));
    const now = Date.now();
    reminders = items.flatMap((item, index) => inWindow(item.sourceStartAt, now) ? [{ ...item, availableAt: item.sourceStartAt - DAY, seenAt: seenReceipt(receipts[index].data(), user, current.business.id, item) }] : []);
  }
  return { businessId: current.business.id, ownerUid: user.uid, serverNow: Date.now(), preference: { enabled: preference?.enabled ?? false, revision: preference?.revision ?? 0, status, offsetMinutes: OFFSET }, reminders };
}
function validateScope(user: ChatActor, businessId: string) { clientUidSchema.parse(user.uid); documentIdSchema.parse(businessId); }

/** No writes, background dispatch or booking/AI admission are performed by reads. */
export async function readAppointmentReminders(user: ChatActor, businessId: string, db: Database = getAdminDb()): Promise<AppointmentReminders> {
  validateScope(user, businessId);
  return db.runTransaction(async tx => projection(tx, user, await context(tx, user, businessId, db), db));
}
export async function saveReminderPreference(user: ChatActor, businessId: string, supplied: z.input<typeof reminderPreferenceInputSchema>, db: Database = getAdminDb()): Promise<AppointmentReminders> {
  validateScope(user, businessId); const input = reminderPreferenceInputSchema.parse(supplied);
  return db.runTransaction(async tx => {
    const current = await context(tx, user, businessId, db);
    if ((current.preference?.revision ?? 0) !== input.expectedRevision) throw new HttpError(409, 'Los recordatorios cambiaron en otra ventana. Vuelve a consultarlos.', 'REMINDER_PREFERENCE_CHANGED');
    const anchors = input.enabled ? await currentAnchors(tx, user, current.business, db) : null;
    if (input.enabled && !anchors) throw inactive();
    const next: Preference = { version: 1, ownerUid: user.uid, businessId, revision: input.expectedRevision + 1, enabled: input.enabled, offsetMinutes: OFFSET, updatedAt: Date.now(), anchors };
    const response = await projection(tx, user, current, db, next, anchors);
    tx.set(current.preferenceRef, { ...next, updatedAt: response.serverNow });
    return response;
  });
}
export async function markAppointmentReminderSeen(user: ChatActor, businessId: string, supplied: ReminderOccurrence, db: Database = getAdminDb()): Promise<{ reminder: AppointmentReminder }> {
  validateScope(user, businessId); const input = reminderOccurrenceSchema.parse(supplied);
  return db.runTransaction(async tx => {
    const current = await context(tx, user, businessId, db);
    const source = await tx.get(current.businessRef.collection('appointments').doc(input.appointmentId));
    const appointment = source.data() as Appointment | undefined;
    if (!appointment || !isOwn(appointment, user.uid, businessId) || appointment.id !== input.appointmentId) throw new HttpError(404, 'La cita no existe.');
    if (appointment.status !== 'confirmed' || !sameOccurrence(occurrence(appointment), input)) throw stale();
    if (!current.preference?.enabled || !sameAnchors(current.preference.anchors, await currentAnchors(tx, user, current.business, db))) throw inactive();
    const reference = current.businessRef.collection('reminderReceipts').doc(reminderReceiptId(user.uid, businessId, input.appointmentId));
    const saved = await tx.get(reference), seenAt = seenReceipt(saved.data(), user, businessId, input), now = Date.now();
    if (!inWindow(input.sourceStartAt, now)) throw stale();
    if (seenAt !== null) return { reminder: { ...input, availableAt: input.sourceStartAt - DAY, seenAt } };
    tx.set(reference, { version: 1, ownerUid: user.uid, businessId, ...input, seenAt: now });
    return { reminder: { ...input, availableAt: input.sourceStartAt - DAY, seenAt: now } };
  });
}
