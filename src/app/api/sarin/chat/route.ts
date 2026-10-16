import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireUser } from '@/lib/server/auth';
import { apiError, HttpError, readJson } from '@/lib/server/http';
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

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;
interface ToolResult { name: string; result: Record<string, unknown>; }
const cleanReply = (value: string | null) => (value ?? '').replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/<think>[\s\S]*$/gi, '').trim();

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
  if (results.some((result) => result.name === 'bloquear_horario' && result.result.appointment)) return 'El horario quedó bloqueado en tu agenda.';
  return 'Revisa el resultado de la consulta. El motor no pudo generar una explicación adicional.';
}

export async function POST(request: Request) {
  try {
    const user = await requireUser(request);
    const body = await readJson(request, chatSchema, 96 * 1024);
    let business: Business | null = body.mode === 'sarin_onboarding' ? await getOwnedBusiness(user.uid) : await getBusiness(body.tenantId);
    if (body.mode === 'sarin_owner_copilot') assertOwner(business!, user.uid);
    if (business && !isSubscriptionAllowed(business)) throw new HttpError(402, 'La agenda automática está en pausa por renovación de la suscripción.');
    const tools = body.mode === 'sarin_onboarding' ? SARIN_ONBOARDING_TOOLS : body.mode === 'sarin_owner_copilot' ? SARIN_COPILOT_TOOLS : SARIN_CLIENT_TOOLS;
    const system = body.mode === 'sarin_onboarding' ? buildSarinOnboardingPrompt() : body.mode === 'sarin_owner_copilot' ? buildSarinOwnerCopilotPrompt(business!) : buildSarinClientPrompt(business!);
    const messages: EngineMessage[] = [{ role: 'system', content: system }, ...body.messages];
    const toolResults: ToolResult[] = [];
    const { provider } = await getAiProviderSelection();

    const response = await runUserInference(user.uid, () => runInSarinQueue(async () => {
      for (let round = 0; round < 4; round++) {
        // A request can spend time queued: entitlement is checked again after
        // waiting and before each subsequent model/tool round.
        if (business) {
          business = await getBusiness(business.id);
          if (!isSubscriptionAllowed(business)) throw new HttpError(402, 'La suscripción del negocio venció.');
          if (body.mode === 'sarin_owner_copilot') assertOwner(business, user.uid);
        }
        let assistant;
        try {
          const usageContext = { businessId: business?.id ?? null, mode: body.mode };
          assistant = await completeChat(messages, tools, {
            signal: request.signal, provider,
            ...(provider === 'deepseek' ? { onUsage: (observation) => recordAiUsage(observation, usageContext) } : {}),
          });
        }
        catch (error) {
          // A model explanation can fail after a committed mutation. Return its
          // verified result so the browser never retries an already saved action.
          if (toolResults.some((result) => result.result.appointment || result.result.business)) return { reply: verifiedReply(toolResults), toolResults };
          throw error;
        }
        if (!assistant.tool_calls?.length) return { reply: bookingReply(toolResults) ?? (cleanReply(assistant.content) || verifiedReply(toolResults)), toolResults };
        messages.push(assistant);
        for (const call of assistant.tool_calls) {
          if (request.signal.aborted) throw new DOMException('Solicitud cancelada.', 'AbortError');
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
                result = { appointment: await createAppointment(user, business!.id, bookingSchema.parse(args), mutationId) }; break;
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
    }, 'NORMAL', { signal: request.signal }));
    return NextResponse.json(response, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return apiError(error); }
}
