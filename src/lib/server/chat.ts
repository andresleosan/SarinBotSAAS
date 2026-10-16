import 'server-only';
import { createHash } from 'node:crypto';
import { getAdminDb } from '@/lib/firebase/admin';
import { reserveResponseQuota, commitResponseQuota, releaseResponseQuota, getResponseQuota } from './response-quota';
import { getWhatsAppBusinessStatus } from './whatsapp-config';
import type { ResponseQuotaReservation } from './response-quota';
import type { ChatActor, ChatResponse } from '@/types/chat';
import { z } from 'zod';
import { HttpError } from '@/lib/server/http';
import { runUserInference } from '@/lib/server/inference';
import { getAiProviderSelection } from '@/lib/server/provider-settings';
import { recordAiUsage } from '@/lib/server/ai-usage';
import { assertOwner, createBusiness, getBusiness, getOwnedBusiness, stableDocumentId } from '@/lib/server/businesses';
import { createAppointment, createManualBlock, readAppointments, readAvailability } from '@/lib/server/bookings';
import { availabilitySchema, bookingSchema, businessConfigSchema, chatSchema } from '@/lib/server/schemas';
import { completeChat, type EngineMessage } from '@/lib/sarin/engine';
import { runInSarinQueue } from '@/lib/sarin/queue';
import { isSubscriptionAllowed } from '@/lib/sarin/subscription';
import { buildSarinClientPrompt, buildSarinOnboardingPrompt, buildSarinOwnerCopilotPrompt } from '@/lib/sarin/prompts';
import { escalationSchema, ownerBlockToolSchema, SARIN_CLIENT_TOOLS, SARIN_COPILOT_TOOLS, SARIN_ONBOARDING_TOOLS, summarySchema } from '@/lib/sarin/tools';
import type { Appointment, Business } from '@/types/firestore';

interface ToolResult { name: string; result: Record<string, unknown>; }
const cleanReply = (value: string | null) => (value ?? '').replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/<think>[\s\S]*$/gi, '').trim();

interface CachedResponse { fingerprint: string; response: ChatResponse; reservation: ResponseQuotaReservation; expiresAt: number; }
const responses = new WeakMap<ReturnType<typeof getAdminDb>, Map<string, CachedResponse>>();
function cachedResponse(db: ReturnType<typeof getAdminDb>, key: string) {
  const entries = responses.get(db);
  if (!entries) return undefined;
  for (const [id, entry] of entries) if (entry.expiresAt <= Date.now()) entries.delete(id);
  return entries.get(key);
}
function rememberResponse(db: ReturnType<typeof getAdminDb>, key: string, value: CachedResponse) {
  const entries = responses.get(db) ?? new Map<string, CachedResponse>();
  responses.set(db, entries);
  for (const [id, entry] of entries) if (entry.expiresAt <= Date.now()) entries.delete(id);
  while (entries.size >= 100) entries.delete(entries.keys().next().value!);
  entries.set(key, value);
}

async function recoverMutation(user: ChatActor, body: z.infer<typeof chatSchema>, business: Business | null): Promise<ChatResponse | null> {
  if (!business || body.mode === 'sarin_onboarding') return null;
  const tools = body.mode === 'sarin_owner_copilot' ? ['bloquear_horario'] : ['crear_cita'];
  for (const name of tools) {
    const id = stableDocumentId(user.uid, stableDocumentId(body.requestId, name), name === 'crear_cita' ? 'appointment' : 'block');
    const snapshot = await getAdminDb().collection('businesses').doc(business.id).collection('appointments').doc(id).get();
    if (!snapshot.exists) continue;
    const appointment = snapshot.data() as Appointment;
    if (appointment.tenantId !== business.id || (name === 'crear_cita' ? appointment.client?.uid !== user.uid : business.ownerUid !== user.uid)) throw new HttpError(403, 'No tienes acceso a esta operación.');
    const toolResults = [{ name, result: { appointment } }];
    return { reply: verifiedReply(toolResults), toolResults };
  }
  return null;
}

function bookingReply(results: ToolResult[]): string | undefined {
  const appointment = results.findLast((result) => result.name === 'crear_cita' && result.result.appointment)?.result.appointment as Appointment | undefined;
  if (!appointment) return undefined;
  const text = (value: string) => value.replace(/\s+/g, ' ');
  const status = appointment.status === 'confirmed' ? 'Tu cita está confirmada.'
    : ['cancelled_by_client', 'cancelled_by_owner'].includes(appointment.status) ? 'Esta cita está cancelada. No se creó una nueva reserva.'
      : 'No se creó una nueva reserva. Consulta el estado de esta cita en la agenda.';
  return [status,
    appointment.serviceName ? `Servicio: ${text(appointment.serviceName)}` : null,
    `Fecha: ${appointment.dateKey}. Hora: ${appointment.startTimeStr}–${appointment.endTimeStr} (Colombia).`,
    appointment.client?.name ? `Cliente: ${text(appointment.client.name)}` : null,
    ...(appointment.status === 'confirmed' ? ['Puedes consultar sus datos y descargar el recordatorio en la agenda.'] : []),
  ].filter(Boolean).join('\n\n');
}

function verifiedReply(results: ToolResult[]): string {
  const booking = bookingReply(results);
  if (booking) return booking;
  if (results.some((result) => result.name === 'guardar_estructura_negocio' && result.result.business)) return 'La configuración de tu negocio quedó guardada.';
  const block = results.findLast(result => result.name === 'bloquear_horario' && result.result.appointment)?.result.appointment as Appointment | undefined;
  if (block) return block.status === 'confirmed' ? 'El horario quedó bloqueado en tu agenda.' : block.status === 'cancelled_by_owner' ? 'Este bloqueo está cancelado. No se creó un nuevo bloqueo.' : 'Consulta el estado de este bloqueo en la agenda.';
  return 'Revisa el resultado de la consulta. El motor no pudo generar una explicación adicional.';
}

export async function runSarinChat({ user, body: suppliedBody, signal, channel = 'web', onResponse }: {
  user: ChatActor;
  body: z.infer<typeof chatSchema>;
  signal?: AbortSignal;
  channel?: 'web' | 'whatsapp';
  onResponse?: (response: ChatResponse, reservation: ResponseQuotaReservation) => Promise<void>;
}): Promise<ChatResponse> {
    const body = chatSchema.parse(suppliedBody);
    if (channel === 'whatsapp' && (body.mode !== 'sarin_client' || !/^\+?[1-9]\d{7,14}$/.test(user.phone ?? ''))) throw new HttpError(403, 'Canal o remitente no autorizado.');
    if (channel === 'whatsapp' && !onResponse) throw new HttpError(503, 'La entrega de WhatsApp no está preparada.');
    let business: Business | null = body.mode === 'sarin_onboarding' ? await getOwnedBusiness(user.uid) : await getBusiness(body.tenantId);
    const assertWhatsAppAccess = async () => {
      if (channel !== 'whatsapp') return;
      const [allowance, binding] = await Promise.all([getResponseQuota(business!.id), getWhatsAppBusinessStatus(business!.id)]);
      const current = allowance.currentPeriod;
      if (!binding.ready || !current || current.planId !== 'whatsapp' || current.endsAt <= Date.now()) throw new HttpError(402, 'WhatsApp requiere un número conectado y su plan vigente.', 'WHATSAPP_UNAVAILABLE');
    };
    await assertWhatsAppAccess();
    if (body.mode === 'sarin_owner_copilot') assertOwner(business!, user.uid);
    if (business && !isSubscriptionAllowed(business)) throw new HttpError(402, 'La agenda automática está en pausa por renovación de la suscripción.');
    const tools = body.mode === 'sarin_onboarding' ? SARIN_ONBOARDING_TOOLS : body.mode === 'sarin_owner_copilot' ? SARIN_COPILOT_TOOLS : SARIN_CLIENT_TOOLS;
    const system = body.mode === 'sarin_onboarding' ? buildSarinOnboardingPrompt() : body.mode === 'sarin_owner_copilot' ? buildSarinOwnerCopilotPrompt(business!) : buildSarinClientPrompt(business!);
    const messages: EngineMessage[] = [{ role: 'system', content: system }, ...body.messages];
    const toolResults: ToolResult[] = [];
    const { provider } = await getAiProviderSelection();

    const db = getAdminDb();
    const scope = body.mode === 'sarin_onboarding' ? 'onboarding' : business!.id;
    const cacheKey = stableDocumentId(scope, user.uid, body.mode, body.requestId, channel);
    const fingerprint = createHash('sha256').update(JSON.stringify({ mode: body.mode, tenantId: body.tenantId, messages: body.messages })).digest('hex');
    const execute = async (): Promise<ChatResponse> => {
      for (let round = 0; round < 4; round++) {
        // A request can spend time queued: entitlement is checked again after
        // waiting and before each subsequent model/tool round.
        if (business) {
          business = await getBusiness(business.id);
          if (!isSubscriptionAllowed(business)) throw new HttpError(402, 'La suscripción del negocio venció.');
          if (body.mode === 'sarin_owner_copilot') assertOwner(business, user.uid);
        }
        await assertWhatsAppAccess();
        let assistant;
        try {
          const usageContext = { businessId: business?.id ?? null, mode: body.mode };
          assistant = await completeChat(messages, tools, {
            signal: signal, provider,
            ...(provider !== 'ollama' ? { onUsage: (observation) => recordAiUsage(observation, usageContext) } : {}),
          });
        }
        catch (error) {
          // A model explanation can fail after a committed mutation. Return its
          // verified result so the browser never retries an already saved action.
          if (toolResults.some((result) => result.result.appointment || result.result.business)) return { reply: verifiedReply(toolResults), toolResults };
          throw error;
        }
        if (!assistant.tool_calls?.length) {
          const content = cleanReply(assistant.content);
          if (!content && !toolResults.length) throw new HttpError(503, 'La IA no devolvió una respuesta. Puedes intentarlo de nuevo.');
          return { reply: bookingReply(toolResults) ?? (content || verifiedReply(toolResults)), toolResults };
        }
        messages.push(assistant);
        for (const call of assistant.tool_calls) {
          if (signal?.aborted) throw new DOMException('Solicitud cancelada.', 'AbortError');
          let result: Record<string, unknown>;
          try {
            if (!tools.some((tool) => tool.function.name === call.function.name)) throw new HttpError(403, 'La herramienta no está habilitada en este modo.');
            let args: unknown;
            try { args = JSON.parse(call.function.arguments); } catch { throw new HttpError(400, 'Argumentos de herramienta inválidos.'); }
            if (business) {
              business = await getBusiness(business.id);
              if (!isSubscriptionAllowed(business)) throw new HttpError(402, 'La suscripción del negocio venció.');
            }
            // A retry may produce different model arguments. Bind the mutation
            // to the authenticated turn, not model output, so it cannot create
            // another appointment after an already committed request.
            const mutationId = stableDocumentId(body.requestId, call.function.name);
            switch (call.function.name) {
              case 'guardar_estructura_negocio': {
                business = await createBusiness(user, businessConfigSchema.parse(args));
                result = { business }; break;
              }
              case 'consultar_disponibilidad': {
                const input = availabilitySchema.parse(args);
                result = { dateKey: input.dateKey, availability: await readAvailability(business!, input.dateKey, input.serviceId, input.resourceId) }; break;
              }
              case 'crear_cita':
                result = { appointment: await createAppointment(user, business!.id, bookingSchema.parse(channel === 'whatsapp' ? { ...(args as Record<string, unknown>), clientPhone: user.phone } : args), mutationId) }; break;
              case 'escalar_a_humano': {
                const input = escalationSchema.parse(args);
                result = { whatsappUrl: `https://wa.me/${business!.phoneWhatsApp.replace(/\D/g, '')}?text=${encodeURIComponent(input.resumenDuda)}` }; break;
              }
              case 'bloquear_horario': {
                assertOwner(business!, user.uid);
                result = { appointment: await createManualBlock(user, business!.id, { ...ownerBlockToolSchema.parse(args), requestId: mutationId }) }; break;
              }
              case 'resumen_agenda_dia': {
                assertOwner(business!, user.uid);
                const input = summarySchema.parse(args);
                const appointments = await readAppointments(business!.id, input.dateKey, user);
                result = { dateKey: input.dateKey, appointments, estimatedRevenueCOP: appointments.filter((appointment) => appointment.type === 'appointment' && ['confirmed', 'completed'].includes(appointment.status)).reduce((sum, appointment) => sum + (appointment.price ?? 0), 0) }; break;
              }
              default: throw new HttpError(400, 'Herramienta desconocida.');
            }
          } catch (error) {
            if (error instanceof z.ZodError) result = { error: 'Los argumentos están incompletos o son inválidos. Solicita los datos que faltan.' };
            else if (error instanceof HttpError && error.status < 500) result = { error: error.message, status: error.status };
            else throw error;
          }
          toolResults.push({ name: call.function.name, result });
          messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) });
        }
      }
      return { reply: verifiedReply(toolResults), toolResults };
    };

    return runUserInference(user.uid, () => runInSarinQueue(async () => {
      const cached = cachedResponse(db, cacheKey);
      if (cached) {
        if (cached.fingerprint !== fingerprint) throw new HttpError(409, 'Este identificador ya se utilizó para otro mensaje.');
        const response = await recoverMutation(user, body, business) ?? structuredClone(cached.response);
        await onResponse?.(response, cached.reservation);
        // A previous result may have reached the user before the quota commit
        // was acknowledged. Retry only that idempotent commit, never inference.
        try { await commitResponseQuota(cached.reservation); } catch { /* the reserved unit remains held */ }
        return response;
      }
      const quota = await reserveResponseQuota({ businessId: business?.id ?? null, actorUid: user.uid, mode: body.mode, requestId: body.requestId, fingerprint, channel });
      if (quota.kind === 'replay') {
        const recovered = await recoverMutation(user, body, business);
        if (recovered) { await onResponse?.(recovered, quota.reservation); return recovered; }
        throw new HttpError(409, 'Esta solicitud ya fue atendida. Revisa la conversación y envía un mensaje nuevo si necesitas continuar.', 'REQUEST_ALREADY_COMPLETED');
      }
      let response: ChatResponse;
      try {
        response = await execute();
      } catch (error) {
        if (toolResults.some(result => result.result.appointment || result.result.business)) response = { reply: verifiedReply(toolResults), toolResults };
        else {
          try { await releaseResponseQuota(quota.reservation); } catch { /* failure cannot turn into another free reservation */ }
          throw error;
        }
      }
      rememberResponse(db, cacheKey, { fingerprint, response: structuredClone(response), reservation: quota.reservation, expiresAt: Date.now() + 15 * 60 * 1000 });
      // WhatsApp durably encrypts its outbox and quota handle before this unit
      // is completed. A failed write retains the unit and the in-memory result.
      await onResponse?.(response, quota.reservation);
      // Once a response or mutation exists, a metering outage must not make
      // the browser repeat the operation. An unconfirmed unit stays reserved.
      try { await commitResponseQuota(quota.reservation, response); } catch { /* retained for reconciliation, no provider retry */ }
      return response;
    }, 'NORMAL', { signal }));
}
