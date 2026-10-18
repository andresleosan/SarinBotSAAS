import 'server-only';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { ChatActor } from '@/types/chat';
import type { Business, Appointment } from '@/types/firestore';
import type { Database, Transaction } from '@/lib/storage/types';
import { getAdminDb } from '@/lib/firebase/admin';
import { assertOwner, getBusiness } from './businesses';
import { HttpError } from './http';
import { assertConsent } from './consent';

export type ClientPolicy = { blocked: boolean; futureAppointmentLimit: number; reason: string | null; inheritsLimit: boolean };
export const clientUidSchema = z.string().min(1).max(128).regex(/^[^\x00-\x1f\x7f]+$/);
export const clientPolicyInputSchema = z.object({ clientUid: clientUidSchema.optional(), blocked: z.boolean().optional(), futureAppointmentLimit: z.number().int().min(1).max(20).nullable().optional(), reason: z.string().trim().min(1).max(300) }).strict();
const recordSchema = z.object({ version: z.literal(1), blocked: z.boolean(), futureAppointmentLimit: z.number().int().min(1).max(20).nullable(), reason: z.string().min(1).max(300), updatedBy: clientUidSchema, updatedAt: z.number().int().nonnegative() }).strict();
export const clientPolicyKey = (uid: string) => createHash('sha256').update(clientUidSchema.parse(uid)).digest('hex');
function parseRecord(value: unknown) {
  if (value === undefined) return undefined;
  const parsed = recordSchema.safeParse(value);
  if (!parsed.success) throw new HttpError(503, 'No se puede validar la política de reservas.');
  return parsed.data;
}
function resolvePolicy(defaultValue: unknown, overrideValue: unknown): ClientPolicy {
  const defaults = parseRecord(defaultValue), override = parseRecord(overrideValue);
  if (defaults?.blocked || defaults?.futureAppointmentLimit === null) throw new HttpError(503, 'No se puede validar la política general.');
  return { blocked: override?.blocked ?? false, futureAppointmentLimit: override?.futureAppointmentLimit ?? defaults?.futureAppointmentLimit ?? 3, reason: override?.reason ?? defaults?.reason ?? null, inheritsLimit: override?.futureAppointmentLimit == null };
}
async function readPolicy(businessId: string, uid: string, db: Database, tx?: Transaction): Promise<ClientPolicy> {
  const collection = db.collection('businesses').doc(businessId).collection('clientPolicies');
  const [defaults, override] = await Promise.all([collection.doc('defaults'), collection.doc(clientPolicyKey(uid))].map(ref => tx ? tx.get(ref) : ref.get()));
  return resolvePolicy(defaults.data(), override.data());
}
export async function readClientPolicy(businessId: string, actorUid: string, db: Database = getAdminDb()) { return readPolicy(businessId, actorUid, db); }
export async function readOwnedClientPolicy(owner: ChatActor, businessId: string, clientUid?: string, db: Database = getAdminDb()) {
  assertOwner(await getBusiness(businessId, db), owner.uid);
  if (clientUid) return readPolicy(businessId, clientUid, db);
  return resolvePolicy((await db.collection('businesses').doc(businessId).collection('clientPolicies').doc('defaults').get()).data(), undefined);
}
export async function updateClientPolicy(owner: ChatActor, businessId: string, input: z.infer<typeof clientPolicyInputSchema>, db: Database = getAdminDb()): Promise<ClientPolicy> {
  const parsed = clientPolicyInputSchema.parse(input);
  if ((!parsed.clientUid && parsed.blocked !== undefined) || (parsed.clientUid === owner.uid && parsed.blocked)) throw new HttpError(400, 'El bloqueo requiere otro cliente.');
  const businessRef = db.collection('businesses').doc(businessId), collection = businessRef.collection('clientPolicies');
  const defaultsRef = collection.doc('defaults'), ref = parsed.clientUid ? collection.doc(clientPolicyKey(parsed.clientUid)) : defaultsRef;
  return db.runTransaction(async tx => {
    const [business, defaults, previous] = await Promise.all([tx.get(businessRef), tx.get(defaultsRef), tx.get(ref)]);
    if (!business.exists) throw new HttpError(404, 'El negocio no existe.');
    assertOwner(business.data() as Business, owner.uid);
    await assertConsent(owner.uid, 'account', undefined, db, tx);
    const old = parseRecord(previous.data());
    resolvePolicy(defaults.data(), parsed.clientUid ? previous.data() : undefined);
    const next = { version: 1 as const, blocked: parsed.blocked ?? old?.blocked ?? false, futureAppointmentLimit: parsed.futureAppointmentLimit === undefined ? old?.futureAppointmentLimit ?? (parsed.clientUid ? null : 3) : parsed.futureAppointmentLimit ?? (parsed.clientUid ? null : 3), reason: parsed.reason, updatedBy: owner.uid, updatedAt: Date.now() };
    tx.set(ref, next);
    return resolvePolicy(parsed.clientUid ? defaults.data() : next, parsed.clientUid ? next : undefined);
  });
}
/** Read-only: caller writes the shared client lock after all availability reads. */
export async function assertClientCanReschedule(tx: Transaction, business: Business, actorUid: string, db: Database): Promise<void> {
  if ((await readPolicy(business.id, actorUid, db, tx)).blocked) throw new HttpError(403, 'Este negocio ha pausado tus nuevas reservas. Puedes consultar y cancelar tus citas.', 'CLIENT_BLOCKED');
}

/** Read-only: caller writes the shared client lock after all availability reads. */
export async function assertClientCanBook(tx: Transaction, business: Business, actorUid: string, now: number, db: Database): Promise<void> {
  const policy = await readPolicy(business.id, actorUid, db, tx);
  if (policy.blocked) throw new HttpError(403, 'Este negocio ha pausado tus nuevas reservas. Puedes consultar y cancelar tus citas.', 'CLIENT_BLOCKED');
  const appointments = await tx.get(db.collection('businesses').doc(business.id).collection('appointments').where('client.uid', '==', actorUid).where('status', '==', 'confirmed').where('type', '==', 'appointment').where('startAt', '>', now).limit(21));
  const count = appointments.docs.filter(doc => { const item = doc.data() as Appointment; return item.type === 'appointment' && item.status === 'confirmed' && item.startAt > now; }).length;
  if (count >= policy.futureAppointmentLimit) throw new HttpError(409, `Puedes tener hasta ${policy.futureAppointmentLimit} citas futuras activas en este negocio.`, 'CLIENT_BOOKING_LIMIT');
}
