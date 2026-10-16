import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Firestore } from 'firebase-admin/firestore';
import { getAdminDb } from '@/lib/firebase/admin';
import type { Business, ResponseAllowance } from '@/types/firestore';
import type { ChatResponse } from '@/types/chat';
import { isSubscriptionAllowed } from '@/lib/sarin/subscription';
import { HttpError } from './http';
import { documentIdSchema, requestIdSchema } from './schemas';
import { initializeResponsePeriods, parseResponsePeriod, publicResponsePeriod, readResponsePeriodState, responsePeriodReference, type StoredResponsePeriod } from './response-periods';

const hash = (...parts: unknown[]) => createHash('sha256').update(JSON.stringify(parts)).digest('hex');
const requestSchema = z.object({ businessId: documentIdSchema.nullable(), actorUid: z.string().min(1).max(256), mode: z.enum(['sarin_client', 'sarin_owner_copilot', 'sarin_onboarding']), requestId: requestIdSchema, fingerprint: z.string().regex(/^[a-f0-9]{64}$/), channel: z.enum(['web', 'whatsapp']) }).strict();
export type ResponseQuotaInput = z.infer<typeof requestSchema>;
export interface ResponseQuotaReservation { reservationId: string; scopeId: string; periodId: string; attemptId: string; }
export type ResponseQuotaResult = { kind: 'reserved'; reservation: ResponseQuotaReservation } | { kind: 'replay'; reservation: ResponseQuotaReservation; response: null };

export async function getResponseQuota(businessId: string, db: Firestore = getAdminDb()): Promise<ResponseAllowance> {
  documentIdSchema.parse(businessId);
  const document = await db.collection('businesses').doc(businessId).get();
  if (!document.exists) throw new HttpError(404, 'El negocio no existe.');
  const business = document.data() as Business;
  const state = await readResponsePeriodState(business, db);
  const period = state.current && publicResponsePeriod(state.current);
  const allowed = isSubscriptionAllowed(business) && period && (period.endsAt > Date.now() || (business.subscription.graceEndsAt ?? 0) > Date.now());
  return { businessId, currentPeriod: period, nextPeriod: state.next && publicResponsePeriod(state.next), warningThresholdPercent: 80,
    state: business.subscription.status === 'suspended' ? 'suspended' : !allowed ? 'expired' : period.remainingResponses === 0 ? 'exhausted' : period.usedResponses >= (period.includedResponses + period.extraResponses) * 0.8 ? 'warning' : 'active' };
}

export async function reserveResponseQuota(input: ResponseQuotaInput, db: Firestore = getAdminDb()): Promise<ResponseQuotaResult> {
  const request = requestSchema.parse(input);
  if (request.businessId === null && request.mode !== 'sarin_onboarding') throw new HttpError(403, 'Primero configura tu negocio.');
  // Onboarding keeps the same turn identity when its tool creates the business.
  const reservationId = hash(request.mode === 'sarin_onboarding' ? null : request.businessId, request.actorUid, request.mode, request.channel, request.requestId);
  const reference = db.collection('responseQuotaTurns').doc(reservationId);
  return db.runTransaction(async transaction => {
    const previous = await transaction.get(reference);
    if (previous.exists) {
      const saved = previous.data()!;
      if (saved.fingerprint !== request.fingerprint) throw new HttpError(409, 'Este identificador pertenece a otra consulta.', 'AI_REQUEST_CONFLICT');
      const reservation: ResponseQuotaReservation = { reservationId, scopeId: saved.scopeId, periodId: saved.periodId, attemptId: saved.attemptId };
      if (saved.status === 'completed') return { kind: 'replay', reservation, response: null };
      if (saved.status === 'reserved') throw new HttpError(409, 'La respuesta anterior sigue pendiente de confirmación.', 'AI_RESPONSE_PENDING');
      if (saved.status !== 'released') throw new HttpError(503, 'No se pudo validar la capacidad de respuestas.');
    }
    let scopeId: string;
    let period: StoredResponsePeriod;
    let initialState: Awaited<ReturnType<typeof readResponsePeriodState>> | undefined;
    if (request.businessId) {
      const businessDocument = await transaction.get(db.collection('businesses').doc(request.businessId));
      if (!businessDocument.exists) throw new HttpError(404, 'El negocio no existe.');
      const business = businessDocument.data() as Business;
      if (request.mode !== 'sarin_client' && business.ownerUid !== request.actorUid) throw new HttpError(403, 'Esta operación es exclusiva del dueño del negocio.');
      if (!isSubscriptionAllowed(business)) throw new HttpError(402, 'La suscripción está vencida.', 'SUBSCRIPTION_EXPIRED');
      initialState = await readResponsePeriodState(business, db, transaction);
      if (!initialState.current || (initialState.current.endsAt <= Date.now() && (business.subscription.graceEndsAt ?? 0) <= Date.now())) throw new HttpError(402, 'No hay una vigencia disponible.', 'SUBSCRIPTION_EXPIRED');
      scopeId = initialState.scopeId;
      period = initialState.current;
    } else {
      scopeId = `onboarding_${hash(request.actorUid)}`;
      const existing = await transaction.get(responsePeriodReference(db, scopeId, 'initial'));
      period = existing.exists ? parseResponsePeriod(existing.data()) : { id: 'initial', source: 'trial', planId: null, startsAt: Date.now(), endsAt: 8_640_000_000_000_000, includedResponses: 30, extraResponses: 0, usedResponses: 0, reservedResponses: 0 };
    }
    if (period.usedResponses + period.reservedResponses >= period.includedResponses + period.extraResponses) throw new HttpError(402, 'Se agotaron las respuestas de IA. La agenda continúa disponible.', 'AI_QUOTA_EXHAUSTED');
    const reservation: ResponseQuotaReservation = { reservationId, scopeId, periodId: period.id, attemptId: randomUUID() };
    if (initialState) initializeResponsePeriods(transaction, db, { ...initialState, current: null });
    transaction.set(responsePeriodReference(db, scopeId, period.id), { ...period, reservedResponses: period.reservedResponses + 1 });
    transaction.set(reference, { ...reservation, fingerprint: request.fingerprint, status: 'reserved', startedAt: Date.now(), mode: request.mode, channel: request.channel });
    return { kind: 'reserved', reservation };
  });
}

async function settle(reservation: ResponseQuotaReservation, completion: boolean, db: Firestore): Promise<void> {
  const turn = db.collection('responseQuotaTurns').doc(reservation.reservationId);
  await db.runTransaction(async transaction => {
    const document = await transaction.get(turn);
    if (!document.exists) throw new HttpError(409, 'La reserva de respuesta no existe.');
    const saved = document.data()!;
    if (saved.attemptId !== reservation.attemptId || saved.scopeId !== reservation.scopeId || saved.periodId !== reservation.periodId) throw new HttpError(409, 'La reserva de respuesta cambió.', 'AI_REQUEST_CONFLICT');
    if (saved.status === 'released' && completion) throw new HttpError(409, 'La reserva de respuesta ya fue liberada.', 'AI_REQUEST_CONFLICT');
    if (saved.status === 'completed' || saved.status === 'released') return;
    if (saved.status !== 'reserved') throw new HttpError(503, 'La reserva de respuesta no es válida.');
    const reference = responsePeriodReference(db, reservation.scopeId, reservation.periodId);
    const period = parseResponsePeriod((await transaction.get(reference)).data());
    if (period.reservedResponses < 1) throw new HttpError(503, 'El contador de respuestas no es válido.');
    transaction.set(reference, { ...period, reservedResponses: period.reservedResponses - 1, usedResponses: period.usedResponses + Number(completion) });
    transaction.set(turn, { ...saved, status: completion ? 'completed' : 'released', finishedAt: Date.now() });
  });
}

export async function commitResponseQuota(reservation: ResponseQuotaReservation, _response?: ChatResponse, db: Firestore = getAdminDb()): Promise<void> {
  // Replies and tool arguments remain out of persistent quota accounting.
  await settle(reservation, true, db);
}
export async function releaseResponseQuota(reservation: ResponseQuotaReservation, db: Firestore = getAdminDb()): Promise<void> { await settle(reservation, false, db); }
