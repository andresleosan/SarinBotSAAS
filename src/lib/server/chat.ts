import 'server-only';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { getAdminDb } from '@/lib/firebase/admin';
import type { ChatActor, ChatResponse } from '@/types/chat';
import type { Business, Appointment } from '@/types/firestore';
import { runInSarinQueue } from '@/lib/sarin/queue';
import { getBusinessAccess, isOwnerAiAllowed, isSubscriptionAllowed } from '@/lib/sarin/subscription';
import { reserveResponseQuota, commitResponseQuota, releaseResponseQuota, getResponseQuota, type ResponseQuotaReservation } from './response-quota';
import { getWhatsAppBusinessStatus } from './whatsapp-config';
import { HttpError } from './http';
import { runUserInference } from './inference';
import { enforceInferenceAdmission } from './inference-rate-limit';
import { readClientPolicy } from './client-policy';
import { readChatState, saveChatState } from './chat-state';
import { interpretChat } from './chat-intent';
import { renderChatReply, appointmentStatusLabel } from './chat-replies';
import { assertOwner, getBusiness, getOwnedBusiness, stableDocumentId } from './businesses';
import { readAppointments, readAvailability } from './bookings';
import { chatSchema } from './schemas';
import { createBookingProposal, recoverBookingProposal } from './booking-proposals';

interface CachedResponse { fingerprint: string; response: ChatResponse; reservation: ResponseQuotaReservation; expiresAt: number; }
const responses = new WeakMap<ReturnType<typeof getAdminDb>, Map<string, CachedResponse>>();
function cachedResponse(db: ReturnType<typeof getAdminDb>, key: string) {
  const entries = responses.get(db);
  if (!entries) return undefined;
  for (const [id, entry] of entries) if (entry.expiresAt <= Date.now()) entries.delete(id);
  return entries.get(key);
}
function rememberResponse(db: ReturnType<typeof getAdminDb>, key: string, value: CachedResponse) {
  const entries = responses.get(db) ?? new Map<string, CachedResponse>(); responses.set(db, entries);
  for (const [id, entry] of entries) if (entry.expiresAt <= Date.now()) entries.delete(id);
  while (entries.size >= 100) entries.delete(entries.keys().next().value!);
  entries.set(key, value);
}
// Read-only recovery for mutations saved by the previous published contract.
// This path never creates another appointment and preserves its current status.
async function recoverLegacyMutation(user: ChatActor, body: z.infer<typeof chatSchema>, business: Business): Promise<ChatResponse | null> {
  if (body.mode === 'sarin_onboarding') return null;
  const recovered = await recoverBookingProposal(user, business.id, body.requestId);
  if (recovered) return recovered.appointment ? { reply: `Cita: ${appointmentStatusLabel(recovered.appointment.status)}. Consulta los datos en Mis citas.`, toolResults: [{ name: 'cita_confirmada', result: { appointment: recovered.appointment } }] } : { reply: 'Revisa esta propuesta. La reserva requiere pulsar Confirmar cita.', proposal: recovered.proposal };
  const name = body.mode === 'sarin_owner_copilot' ? 'bloquear_horario' : 'crear_cita';
  const id = stableDocumentId(user.uid, stableDocumentId(body.requestId, name), name === 'crear_cita' ? 'appointment' : 'block');
  const document = await getAdminDb().collection('businesses').doc(business.id).collection('appointments').doc(id).get();
  if (!document.exists) return null;
  const appointment = document.data() as Appointment;
  if (appointment.tenantId !== business.id || (name === 'crear_cita' ? appointment.client?.uid !== user.uid : business.ownerUid !== user.uid)) throw new HttpError(403, 'No tienes acceso a esta operación.');
  return { reply: `${appointment.type === 'manual_block' ? 'Bloqueo' : 'Cita'}: ${appointmentStatusLabel(appointment.status)}. No se creó una nueva reserva.\n${appointment.serviceName} · ${appointment.dateKey} ${appointment.startTimeStr}–${appointment.endTimeStr} (Colombia).`, toolResults: [{ name, result: { appointment } }] };
}
export async function runSarinChat({ user, body: suppliedBody, signal, channel = 'web', onResponse }: {
  user: ChatActor; body: z.infer<typeof chatSchema>; signal?: AbortSignal; channel?: 'web' | 'whatsapp';
  onResponse?: (response: ChatResponse, reservation: ResponseQuotaReservation) => Promise<void>;
}): Promise<ChatResponse> {
  const body = chatSchema.parse(suppliedBody), db = getAdminDb();
  if (channel === 'whatsapp' && (body.mode !== 'sarin_client' || !/^\+?[1-9]\d{7,14}$/.test(user.phone ?? ''))) throw new HttpError(403, 'Canal o remitente no autorizado.');
  if (channel === 'whatsapp' && !onResponse) throw new HttpError(503, 'La entrega de WhatsApp no está preparada.');
  let business = body.mode === 'sarin_onboarding' ? await getOwnedBusiness(user.uid) : await getBusiness(body.tenantId);
  if (!business) throw new HttpError(402, 'Activa tu acceso para continuar.', 'PAYMENT_REQUIRED');
  const assertAccess = async () => {
    if (body.mode !== 'sarin_client') assertOwner(business!, user.uid);
    if (body.mode === 'sarin_client' && (!business!.sarinConfig.onboardingCompleted || !business!.slug)) throw new HttpError(403, 'El negocio todavía no está configurado.');
    if (body.mode === 'sarin_owner_copilot' && !isOwnerAiAllowed(business)) throw new HttpError(402, 'El copiloto requiere una suscripción vigente.', 'OWNER_AI_REQUIRES_SUBSCRIPTION');
    if (!isSubscriptionAllowed(business) && !(body.mode === 'sarin_client' && getBusinessAccess(business) === 'trial_exhausted')) throw new HttpError(402, 'Activa el acceso de pago para continuar.', 'PAYMENT_REQUIRED');
    if (body.mode === 'sarin_client' && (await readClientPolicy(business!.id, user.uid, db)).blocked) throw new HttpError(403, 'Este negocio ha pausado tus nuevas consultas. Puedes consultar y cancelar tus citas.', 'CLIENT_BLOCKED');
    if (channel === 'whatsapp') {
      const [allowance, binding] = await Promise.all([getResponseQuota(business!.id), getWhatsAppBusinessStatus(business!.id)]);
      if (!binding.ready || !allowance.currentPeriod || allowance.currentPeriod.planId !== 'whatsapp' || allowance.currentPeriod.endsAt <= Date.now()) throw new HttpError(402, 'WhatsApp requiere un número conectado y su plan vigente.', 'WHATSAPP_UNAVAILABLE');
    }
  };
  await assertAccess();
  const cacheKey = stableDocumentId(body.mode === 'sarin_onboarding' ? 'onboarding' : business.id, user.uid, body.mode, body.requestId, channel);
  // Legacy payloads retain their exact historical fingerprint for durable replay.
  const fingerprint = createHash('sha256').update(JSON.stringify({ mode: body.mode, tenantId: body.tenantId, messages: body.stateVersion === undefined ? body.messages : [body.messages.at(-1)!], ...(body.stateVersion === undefined ? {} : { stateVersion: body.stateVersion }) })).digest('hex');
  await enforceInferenceAdmission({ businessId: business.id, actorUid: user.uid, mode: body.mode, requestId: body.requestId, fingerprint, channel }, db);
  return runUserInference(user.uid, () => runInSarinQueue(async () => {
    business = await getBusiness(business!.id); await assertAccess();
    const cached = cachedResponse(db, cacheKey);
    if (cached) {
      if (cached.fingerprint !== fingerprint) throw new HttpError(409, 'Este identificador ya se utilizó para otro mensaje.', 'AI_REQUEST_CONFLICT');
      const response = await recoverLegacyMutation(user, body, business) ?? structuredClone(cached.response);
      await onResponse?.(response, cached.reservation);
      try { await commitResponseQuota(cached.reservation); } catch { /* keep held unit */ }
      return response;
    }
    const scope = { actorUid: user.uid, businessId: business.id, mode: body.mode, channel };
    const state = await readChatState(scope, db);
    // Durable replay is recognized before comparing a version advanced by that turn.
    const quota = await reserveResponseQuota({ businessId: business.id, actorUid: user.uid, mode: body.mode, requestId: body.requestId, fingerprint, channel });
    if (quota.kind === 'replay') {
      const recovered = await recoverLegacyMutation(user, body, business);
      if (recovered) { await onResponse?.(recovered, quota.reservation); try { await commitResponseQuota(quota.reservation); } catch { /* keep held unit */ } return recovered; }
      throw new HttpError(409, 'Esta solicitud ya fue atendida. Revisa la conversación o envía un mensaje nuevo.', 'REQUEST_ALREADY_COMPLETED');
    }
    let response: ChatResponse;
    try {
      if (body.stateVersion !== undefined && body.stateVersion !== state.version) throw new HttpError(409, 'La selección cambió. Reintenta para usar los datos actuales.', 'CHAT_STATE_CONFLICT');
      const interpreted = await interpretChat({ mode: body.mode, message: body.messages.at(-1)!.content, business, state, signal, requestId: body.requestId, actorUid: user.uid });
      business = await getBusiness(business.id); await assertAccess();
      const selection = interpreted.selection, data: Record<string, unknown> = { ...selection };
      switch (interpreted.intent) {
        case 'booking':
          if (selection.serviceId && selection.resourceId && selection.dateKey && selection.startTimeStr && channel === 'web') data.proposal = await createBookingProposal(user, business.id, { serviceId: selection.serviceId, resourceId: selection.resourceId, dateKey: selection.dateKey, startTimeStr: selection.startTimeStr }, body.requestId);
          break;
        case 'availability':
          if (selection.dateKey && selection.serviceId) data.availability = await readAvailability(business, selection.dateKey, selection.serviceId, selection.resourceId);
          break;
        case 'own_appointments': {
          const snapshot = await db.collection('businesses').doc(business.id).collection('appointments').where('client.uid', '==', user.uid).get();
          data.appointments = snapshot.docs.map(doc => doc.data() as Appointment).filter(item => item.tenantId === business!.id && item.client?.uid === user.uid && item.type === 'appointment'); break;
        }
        case 'owner_agenda': if (selection.dateKey) data.appointments = await readAppointments(business.id, selection.dateKey, user); break;
        case 'owner_usage': data.remainingResponses = (await getResponseQuota(business.id)).currentPeriod?.remainingResponses; break;
        case 'configure_business': data.hasDraft = Boolean(interpreted.configurationDraft); break;
      }
      response = renderChatReply({ intent: interpreted.intent, business, data });
      if (data.proposal) response.proposal = data.proposal as ChatResponse['proposal'];
      if (interpreted.configurationDraft) response.configurationDraft = interpreted.configurationDraft;
      try { response.stateVersion = (await saveChatState(scope, state.version, selection, db)).version; }
      catch (error) { if (!data.proposal) throw error; /* durable proposal remains recoverable without another model call */ }
    } catch (error) {
      try { await releaseResponseQuota(quota.reservation); } catch { /* cannot create free capacity */ }
      throw error;
    }
    rememberResponse(db, cacheKey, { fingerprint, response: structuredClone(response), reservation: quota.reservation, expiresAt: Date.now() + 15 * 60 * 1000 });
    await onResponse?.(response, quota.reservation);
    try { await commitResponseQuota(quota.reservation, response); } catch { /* retain original unit; never repeat interpretation */ }
    return response;
  }, 'NORMAL', { signal }));
}
