import 'server-only';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { Database, Transaction } from '@/lib/storage/types';
import { HttpError } from './http';
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const stateSchema = z.object({ version: z.literal(1), events: z.array(z.object({ at: z.number().int().nonnegative().safe(), request: z.string().regex(/^[a-f0-9]{64}$/) }).strict()).max(1000) }).strict();
/** Prepare read-only; caller invokes the writes after all other transaction reads. */
export async function prepareBookingActionAdmission(tx: Transaction, db: Database, uid: string, businessId: string, kind: 'authorization' | 'proposal' | 'waitlist', requestId: string, now = Date.now()): Promise<() => void> {
  const scopes = [
    { ref: db.collection('serverSettings').doc(`booking_action_uid_${hash(uid)}`), limits: [20, 120, 300] },
    { ref: db.collection('serverSettings').doc(`booking_action_business_${hash(businessId)}`), limits: [100, 500, 1000] },
  ], windows = [60000, 3600000, 86400000], request = hash([uid, businessId, kind, requestId]);
  const docs = await Promise.all(scopes.map(scope => tx.get(scope.ref))); let retry = 0;
  const updates = scopes.map((scope, index) => {
    const parsed = stateSchema.safeParse(docs[index].exists ? docs[index].data() : { version: 1, events: [] });
    if (!parsed.success || parsed.data.events.length > scope.limits[2] || parsed.data.events.some(event => event.at > now) || new Set(parsed.data.events.map(event => event.request)).size !== parsed.data.events.length) throw new HttpError(503, 'No se pudo comprobar el límite de reservas.');
    const events = parsed.data.events.filter(event => event.at > now - windows[2]);
    if (events.some(event => event.request === request)) return null;
    for (const [i, window] of windows.entries()) { const recent = events.filter(event => event.at > now - window); if (recent.length >= scope.limits[i]) retry = Math.max(retry, Math.ceil((Math.min(...recent.map(event => event.at)) + window - now) / 1000)); }
    return { ref: scope.ref, events: [...events, { request, at: now }] };
  });
  if (retry) throw new HttpError(429, 'Has iniciado muchas operaciones de reserva. Espera antes de comenzar otra. Tus citas y la retirada de permisos siguen disponibles.', 'BOOKING_ACTION_RATE_LIMITED', retry);
  return () => { for (const update of updates) if (update) tx.set(update.ref, { version: 1, events: update.events }); };
}
