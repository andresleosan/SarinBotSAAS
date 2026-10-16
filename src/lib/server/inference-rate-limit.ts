import 'server-only';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { Database } from '@/lib/storage/types';
import { HttpError } from './http';
import { documentIdSchema, requestIdSchema } from './schemas';

const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const hash = (...parts: unknown[]) => digest(JSON.stringify(parts));
const fingerprintSchema = z.string().regex(/^[a-f0-9]{64}$/);
const inputSchema = z.object({ actorUid: z.string().min(1).max(256), businessId: documentIdSchema, channel: z.enum(['web', 'whatsapp']), requestId: requestIdSchema, fingerprint: fingerprintSchema }).strict();
const admissionSchema = inputSchema.extend({ mode: z.enum(['sarin_client', 'sarin_onboarding', 'sarin_owner_copilot']) });
export type AdmissionInput = z.infer<typeof admissionSchema>;
const stateSchema = z.object({ version: z.literal(1), events: z.array(z.object({ at: z.number().int().nonnegative().safe(), request: fingerprintSchema, fingerprint: fingerprintSchema }).strict()).max(1000) }).strict()
  .refine(value => {
    const fingerprints = new Map<string, string>();
    return value.events.every(event => {
      const previous = fingerprints.get(event.request); fingerprints.set(event.request, event.fingerprint);
      return previous === undefined || previous === event.fingerprint;
    });
  });
const windows = [{ duration: 60_000, limit: 10 }, { duration: 3_600_000, limit: 60 }, { duration: 86_400_000, limit: 120 }] as const;
const unavailable = () => new HttpError(503, 'No se pudo comprobar el límite de consultas. Intenta de nuevo más tarde.');
const conflict = () => new HttpError(409, 'Este identificador pertenece a otra consulta.', 'AI_REQUEST_CONFLICT');

/** Global per-client admission, not commercial capacity. Only hashes and bounded timestamps persist. */
export async function enforceClientInferenceRateLimit(input: z.infer<typeof inputSchema>, db: Database, now = Date.now()): Promise<void> {
  return enforceInferenceAdmission({ ...inputSchema.parse(input), mode: 'sarin_client' }, db, now);
}
export async function enforceInferenceAdmission(input: AdmissionInput, db: Database, now = Date.now()): Promise<void> {
  const request = admissionSchema.parse(input);
  if (!Number.isSafeInteger(now) || now < 0) throw unavailable();
  const scopes = [
    { ref: db.collection('serverSettings').doc(`client_rate_${digest(request.actorUid)}`), limits: windows },
    { ref: db.collection('serverSettings').doc(`inference_tenant_${hash(request.actorUid, request.businessId)}`), limits: windows },
    { ref: db.collection('serverSettings').doc(`inference_business_${digest(request.businessId)}`), limits: windows.map((window, index) => ({ duration: window.duration, limit: [30, 300, 1000][index] })) },
  ];
  const quotaTurn = db.collection('responseQuotaTurns').doc(hash(request.mode === 'sarin_onboarding' ? null : request.businessId, request.actorUid, request.mode, request.channel, request.requestId));
  const requestHash = digest(request.requestId);
  // Bind the ID across businesses and channels too, without retaining either in the rate document.
  const fingerprint = request.mode === 'sarin_client' ? hash(request.fingerprint, request.businessId, request.channel) : hash(request.fingerprint, request.businessId, request.channel, request.mode);
  await db.runTransaction(async transaction => {
    const snapshots = await Promise.all(scopes.map(scope => transaction.get(scope.ref)));
    const turn = await transaction.get(quotaTurn);
    if (turn.exists) {
      const prior = turn.data()!;
      if (prior.fingerprint !== request.fingerprint) throw conflict();
      // These states cannot start another provider call in the quota contract.
      // Recognize them even after a restart or expiry of the bounded rate window.
      if (prior.status === 'completed' || prior.status === 'reserved') return;
      if (prior.status !== 'released') throw unavailable();
    }
    // A released/missing durable turn may call the provider again. Reusing its
    // identifier must not bypass admission after repeated provider failures.
    let retryAfter = 0;
    const updates = scopes.map((scope, index) => {
      const snapshot = snapshots[index], parsed = snapshot.exists ? stateSchema.safeParse(snapshot.data()) : { success: true as const, data: { version: 1 as const, events: [] } };
      if (!parsed.success || parsed.data.events.length > scope.limits[2].limit || parsed.data.events.some(event => event.at > now)) throw unavailable();
      const events = parsed.data.events.filter(event => event.at > now - windows[2].duration);
      // The tenant-wide document sees IDs from different clients; global UID
      // state alone binds the request identifier to its authenticated payload.
      if (index < 2 && events.some(event => event.request === requestHash && event.fingerprint !== fingerprint)) throw conflict();
      for (const window of scope.limits) {
        const recent = events.filter(event => event.at > now - window.duration);
        if (recent.length >= window.limit) retryAfter = Math.max(retryAfter, Math.ceil((Math.min(...recent.map(event => event.at)) + window.duration - now) / 1000));
      }
      return { scope, events };
    });
    if (retryAfter) throw new HttpError(429, `Llegaste al límite de consultas. Espera ${retryAfter} segundos antes de enviar otro mensaje.`, 'CLIENT_RATE_LIMITED', retryAfter);
    for (const [index, { scope, events }] of updates.entries()) transaction.set(scope.ref, { version: 1, events: [...events, { at: now, request: index === 2 ? hash(request.actorUid, request.requestId) : requestHash, fingerprint }] });
  });
}
