import 'server-only';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { Database } from '@/lib/storage/types';
import type { AdminCopilotQuestion } from '@/types/admin-copilot';
import { HttpError } from './http';

const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);
const stateSchema = z.object({ version: z.literal(1), events: z.array(z.object({ at: z.number().int().nonnegative().safe(), request: hashSchema, fingerprint: hashSchema }).strict()).max(60) }).strict();
const day = 86_400_000;

/** Separate administrative admission. Only hashes and timestamps are persisted. */
export async function admitAdminCopilot(uid: string, input: AdminCopilotQuestion, db: Database, now = Date.now()): Promise<void> {
  const reference = db.collection('serverSettings').doc(`admin_copilot_rate_${digest(uid)}`);
  const request = digest(input.requestId);
  const fingerprint = digest(JSON.stringify([input.question, input.businessId ?? null]));
  await db.runTransaction(async transaction => {
    const snapshot = await transaction.get(reference);
    const parsed = snapshot.exists ? stateSchema.safeParse(snapshot.data()) : { success: true as const, data: { version: 1 as const, events: [] } };
    if (!parsed.success || parsed.data.events.some(event => event.at > now)) throw new HttpError(503, 'No se pudo comprobar el límite administrativo de consultas.');
    const events = parsed.data.events.filter(event => event.at > now - day);
    const previous = events.find(event => event.request === request);
    if (previous) throw new HttpError(409, previous.fingerprint === fingerprint ? 'Esta consulta ya se recibió. Envía una nueva consulta para volver a intentarlo.' : 'Este identificador pertenece a otra consulta.', 'ADMIN_REQUEST_ALREADY_RECEIVED');
    if (events.length >= 60 || events.filter(event => event.at > now - 60_000).length >= 10) throw new HttpError(429, 'Llegaste al límite del copiloto: 10 consultas por minuto y 60 en 24 horas. El resumen sigue disponible.', 'ADMIN_COPILOT_RATE_LIMITED');
    // Failed/ambiguous calls retain their admission: retries cannot multiply cost.
    transaction.set(reference, { version: 1, events: [...events, { at: now, request, fingerprint }] });
  });
}
