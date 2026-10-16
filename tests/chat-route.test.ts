import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Business } from '../src/types/firestore';
import { memoryFirestore } from './memoryFirestore';

const state = vi.hoisted(() => ({ db: undefined as unknown, complete: vi.fn(), userName: 'Cliente', whatsappReady: false }));
vi.mock('../src/lib/firebase/admin', () => ({ getAdminDb: () => state.db }));
vi.mock('../src/lib/server/whatsapp-config', () => ({ getWhatsAppBusinessStatus: async () => ({ ready: state.whatsappReady }) }));
vi.mock('../src/lib/server/auth', async () => {
  const { HttpError } = await import('../src/lib/server/http');
  return { requireUser: async (request: Request) => { if (!request.headers.has('authorization')) throw new HttpError(401, 'Login'); return { uid: 'client', email: 'client@example.test', name: state.userName }; } };
});
vi.mock('../src/lib/sarin/engine', async (importOriginal) => ({ ...await importOriginal<typeof import('../src/lib/sarin/engine')>(), completeChat: state.complete }));
import { POST } from '../src/app/api/sarin/chat/route';
import { cancelAppointment } from '../src/lib/server/bookings';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { readAdminAiUsage } from '../src/lib/server/ai-usage';
import { runSarinChat } from '../src/lib/server/chat';
import { getResponseQuota } from '../src/lib/server/response-quota';

const now = Date.parse('2030-01-01T12:00:00Z');
const business: Business = { id: 'business', slug: 'real', ownerUid: 'owner', ownerEmail: '', name: 'Real', category: 'Barbería', phoneWhatsApp: '573001234567', timezone: 'America/Bogota', subscription: { status: 'active', trialEndsAt: 0, currentPeriodEndsAt: now + 30 * 86400000 }, sarinConfig: { onboardingCompleted: true, tone: '', customRules: '', intakeFields: [] }, resources: [{ id: 'chair', name: 'Silla', active: true }], services: [{ id: 'cut', name: 'Corte', durationMinutes: 30, bufferMinutes: 15, price: 20000, resourceIds: ['chair'] }], weeklySchedule: { 1: { isOpen: true, intervals: [{ start: '09:00', end: '11:00' }] } }, createdAt: now };
const body = { mode: 'sarin_client', tenantId: 'business', requestId: 'request-one', messages: [{ role: 'user' as const, content: 'Agenda corte el lunes 7 a las 9.' }] };
const request = (data: unknown = body, authenticated = true) => new Request('http://localhost/api/sarin/chat', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(authenticated ? { Authorization: 'Bearer token' } : {}) }, body: JSON.stringify(data) });
const bookingCall = () => ({ role: 'assistant', content: null, tool_calls: [{ id: 'call-book', type: 'function', function: { name: 'crear_cita', arguments: JSON.stringify({ dateKey: '2030-01-07', startTimeStr: '09:00', serviceId: 'cut', resourceId: 'chair', clientPhone: '573001234567', intakeAnswers: {} }) } }] });
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(now); vi.stubEnv('SARIN_CHAT_PROVIDER', 'ollama'); state.db = memoryFirestore({ 'businesses/business': business as unknown as Record<string, unknown> }).db; state.complete.mockReset(); state.userName = 'Cliente'; state.whatsappReady = false; });
function prepareWhatsApp(planId = 'whatsapp', endsAt = now + 86400000) {
  state.whatsappReady = true;
  state.db = memoryFirestore({
    'businesses/business': business as unknown as Record<string, unknown>,
    'responseQuotaScopes/business_business': { initializedAt: now },
    'responseQuotaScopes/business_business/periods/current': { id: 'current', source: 'subscription', planId, startsAt: now - 1000, endsAt, includedResponses: 4500, extraResponses: 0, usedResponses: 0, reservedResponses: 0 },
  }).db;
}
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });
describe('authenticated tool orchestration', () => {
  it.each(['deepseek', 'gemini'] as const)('records every %s tool round under the business without repeating a booking after a failed explanation', async provider => {
    const { db, rows } = memoryFirestore({ 'businesses/business': business as unknown as Record<string, unknown>, 'serverSettings/ai': { provider, updatedAt: now } }); state.db = db;
    const usage = { promptTokens: 10, cacheHitTokens: 0, cacheMissTokens: 10, completionTokens: 5, totalTokens: 15 };
    const first = { callId: '00000000-0000-4000-8000-000000000001', provider, model: provider === 'gemini' ? 'gemini-3.5-flash-lite' : 'deepseek-flash', serviceTier: 'standard', startedAt: now, finishedAt: now + 1, success: true, usage };
    state.complete.mockImplementationOnce(async (_messages, _tools, options) => {
      await options.onUsage?.(first);
      return bookingCall();
    }).mockImplementationOnce(async (_messages, _tools, options) => {
      await options.onUsage?.({ ...first, callId: '00000000-0000-4000-8000-000000000002', success: false, usage: null });
      throw new Error('provider failed after committed tool');
    });
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect((await response.json()).reply).toContain('Tu cita está confirmada');
    const recorded = await readAdminAiUsage('2030-01', db, provider);
    expect(recorded.totals).toMatchObject({ calls: 2, successfulCalls: 1, failedCalls: 1, missingUsageCalls: 1 });
    expect(recorded.businesses[0]).toMatchObject({ businessId: 'business', calls: 2 });
    expect([...rows.keys()].filter(key => key.startsWith('businesses/business/appointments/'))).toHaveLength(1);
    expect(JSON.stringify([...rows.entries()].filter(([key]) => key.startsWith('aiUsage')))).not.toMatch(/client@example|573001234567|Corte|Agenda corte/);
  });
  it.each(['deepseek', 'gemini'] as const)('attributes initial %s onboarding to the unassigned bucket and omits a meter for Ollama', async provider => {
    const { db } = memoryFirestore({ 'serverSettings/ai': { provider, updatedAt: now } }); state.db = db;
    state.complete.mockImplementationOnce(async (_messages, _tools, options) => {
      await options.onUsage?.({ callId: '00000000-0000-4000-8000-000000000003', provider, model: provider === 'gemini' ? 'gemini-3.5-flash-lite' : 'deepseek-flash', startedAt: now, finishedAt: now + 1, success: true, usage: null });
      return { role: 'assistant', content: 'Describe tu negocio.' };
    }).mockResolvedValue({ role: 'assistant', content: 'Describe tu negocio.' });
    expect((await POST(request({ ...body, mode: 'sarin_onboarding', tenantId: '' }))).status).toBe(200);
    expect((await readAdminAiUsage('2030-01', db, provider)).businesses[0]).toMatchObject({ businessId: null, calls: 1 });
    await db.collection('serverSettings').doc('ai').set({ provider: 'ollama', updatedAt: now + 1 });
    expect((await POST(request({ ...body, mode: 'sarin_onboarding', tenantId: '', requestId: 'next-local-turn' }))).status).toBe(200);
    expect(state.complete.mock.calls.at(-1)?.[2]?.onUsage).toBeUndefined();
  });
  it('returns one persisted booking when recording the final explanation fails', async () => {
    const { db, rows } = memoryFirestore({ 'businesses/business': business as unknown as Record<string, unknown>, 'serverSettings/ai': { provider: 'deepseek', updatedAt: now } }); state.db = db;
    const failuresBefore = (await readAdminAiUsage('2030-01', db)).telemetryWriteFailures;
    state.complete.mockResolvedValueOnce(bookingCall()).mockImplementationOnce(async (_messages, _tools, options) => {
      expect([...rows.keys()].filter(key => key.startsWith('businesses/business/appointments/'))).toHaveLength(1);
      const unavailable = vi.spyOn(db, 'runTransaction').mockRejectedValue(new Error('synthetic storage outage'));
      try {
        await options.onUsage?.({ callId: '00000000-0000-4000-8000-000000000004', provider: 'deepseek', model: 'deepseek-flash', startedAt: now, finishedAt: now + 1, success: true, usage: null });
      } finally { unavailable.mockRestore(); }
      return { role: 'assistant', content: 'Explicación de la reserva.' };
    });
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect((await response.json()).toolResults[0].result.appointment.status).toBe('confirmed');
    expect(state.complete).toHaveBeenCalledTimes(2);
    expect([...rows.keys()].filter(key => key.startsWith('businesses/business/appointments/'))).toHaveLength(1);
    expect((await readAdminAiUsage('2030-01', db)).telemetryWriteFailures).toBe(failuresBefore + 1);
    expect([...rows.keys()].filter(key => key.startsWith('aiUsageCalls/'))).toHaveLength(0);
  });
  it.each(['deepseek', 'gemini'] as const)('keeps %s across the tool loop while a later turn observes an admin switch', async provider => {
    const { db } = memoryFirestore({ 'businesses/business': business as unknown as Record<string, unknown>, 'serverSettings/ai': { provider, updatedAt: now } });
    state.db = db;
    state.complete.mockImplementationOnce(async () => {
      await db.collection('serverSettings').doc('ai').set({ provider: 'ollama', updatedAt: now + 1 });
      return bookingCall();
    }).mockResolvedValue({ role: 'assistant', content: 'Consulta completada.' });
    expect((await POST(request())).status).toBe(200);
    expect(state.complete.mock.calls.map(call => call[2]?.provider)).toEqual([provider, provider]);
    expect((await POST(request({ ...body, requestId: 'second-provider-turn' }))).status).toBe(200);
    expect(state.complete.mock.calls.at(-1)?.[2]?.provider).toBe('ollama');
  });
  it('uses the private selection for onboarding as well as booking chat', async () => {
    state.db = memoryFirestore({ 'serverSettings/ai': { provider: 'deepseek', updatedAt: now } }).db;
    state.complete.mockResolvedValue({ role: 'assistant', content: 'Describe tu negocio.' });
    expect((await POST(request({ ...body, mode: 'sarin_onboarding', tenantId: '' }))).status).toBe(200);
    expect(state.complete.mock.calls[0][2]?.provider).toBe('deepseek');
  });
  it.each(['unsupported', 'openai'])('refuses the invalid persisted provider %s before inference or tools run', async provider => {
    state.db = memoryFirestore({ 'businesses/business': business as unknown as Record<string, unknown>, 'serverSettings/ai': { provider, updatedAt: now } }).db;
    state.complete.mockResolvedValue(bookingCall());
    expect((await POST(request())).status).toBe(503);
    expect(state.complete).not.toHaveBeenCalled();
  });
  it('rejects unauthenticated inference before calling the local engine', async () => {
    expect((await POST(request(body, false))).status).toBe(401);
    expect(state.complete).not.toHaveBeenCalled();
  });
  it('rejects client-supplied tenant configuration', async () => {
    expect((await POST(request({ ...body, tenantOverride: business }))).status).toBe(400);
    expect(state.complete).not.toHaveBeenCalled();
  });
  it('rejects another client entering owner copilot mode', async () => {
    expect((await POST(request({ ...body, mode: 'sarin_owner_copilot' }))).status).toBe(403);
    expect(state.complete).not.toHaveBeenCalled();
  });
  it('actually commits a tool reservation and feeds its result back to the model', async () => {
    state.complete.mockResolvedValueOnce({ role: 'assistant', content: null, tool_calls: [{ id: 'call1', type: 'function', function: { name: 'crear_cita', arguments: JSON.stringify({ dateKey: '2030-01-07', startTimeStr: '09:00', serviceId: 'cut', resourceId: 'chair', clientPhone: '573001234567', intakeAnswers: {} }) } }] }).mockResolvedValueOnce({ role: 'assistant', content: 'Tu cita está confirmada.' });
    const response = await POST(request());
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.toolResults[0].result.appointment.client.uid).toBe('client');
    expect(data.toolResults[0].result.appointment.status).toBe('confirmed');
    expect(state.complete.mock.calls[1][0].some((message: { role: string }) => message.role === 'tool')).toBe(true);
  });
  it.each(['contradictory explanation', 'empty explanation', 'failed explanation'])('confirms persisted booking details despite a %s', async (explanation) => {
    const memory = memoryFirestore({ 'businesses/business': business as unknown as Record<string, unknown> });
    state.db = memory.db;
    state.complete.mockResolvedValueOnce(bookingCall());
    if (explanation === 'failed explanation') state.complete.mockRejectedValueOnce(new Error('offline'));
    else state.complete.mockResolvedValueOnce({ role: 'assistant', content: explanation === 'empty explanation' ? null : 'Confirmada para Persona Inventada, Masaje, 2030-01-09 a las 15:00.' });
    const response = await POST(request({ ...body, messages: [{ role: 'user', content: 'Confirma el corte el 7 de enero a las 09:00. Llámame Persona Inventada.' }] }));
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.reply).toMatch(/confirmada/i);
    expect(data.reply).toContain('Cliente: Cliente');
    expect(data.reply).toContain('Corte');
    expect(data.reply).toContain('2030-01-07');
    expect(data.reply).toContain('09:00');
    expect(data.reply).toContain('09:30');
    expect(data.reply).toContain('Colombia');
    expect(data.reply).not.toMatch(/Persona Inventada|Masaje|2030-01-09|15:00|offline/);
    expect(data.toolResults[0].result.appointment.client.name).toBe('Cliente');
    const stored = [...memory.rows.entries()].filter(([path]) => path.includes('/appointments/'));
    expect(stored).toHaveLength(1);
    expect(stored[0][1].data).toEqual(data.toolResults[0].result.appointment);
    expect(state.complete).toHaveBeenCalledTimes(2);
  });
  it('preserves literal name and service characters for the plain-text chat renderer', async () => {
    state.userName = 'Cliente <QA>_[uno]';
    const namedBusiness = { ...business, services: [{ ...business.services[0], name: 'Corte <QA>_[dos]' }] };
    state.db = memoryFirestore({ 'businesses/business': namedBusiness as unknown as Record<string, unknown> }).db;
    state.complete.mockResolvedValueOnce(bookingCall()).mockResolvedValueOnce({ role: 'assistant', content: 'Confirmada.' });
    const response = await POST(request());
    const data = await response.json();
    expect(response.headers.get('Content-Type')).toContain('application/json');
    expect(data.reply).toContain('Cliente: Cliente <QA>_[uno]');
    expect(data.reply).toContain('Servicio: Corte <QA>_[dos]');
    expect(data.reply).not.toContain('\\');
    expect(data.toolResults[0].result.appointment.client.name).toBe('Cliente <QA>_[uno]');
    expect(data.toolResults[0].result.appointment.serviceName).toBe('Corte <QA>_[dos]');
  });
  it.each([
    { actor: 'client', explanationFails: false }, { actor: 'client', explanationFails: true },
    { actor: 'owner', explanationFails: false }, { actor: 'owner', explanationFails: true },
  ])('does not reconfirm an idempotent booking cancelled by $actor when explanationFails=$explanationFails', async ({ actor, explanationFails }) => {
    const memory = memoryFirestore({ 'businesses/business': business as unknown as Record<string, unknown> });
    state.db = memory.db;
    state.complete.mockResolvedValueOnce(bookingCall()).mockResolvedValueOnce({ role: 'assistant', content: 'Confirmada.' });
    const saved = await (await POST(request())).json();
    await cancelAppointment({ uid: actor } as DecodedIdToken, business.id, saved.toolResults[0].result.appointment.id, memory.db);
    state.complete.mockResolvedValueOnce(bookingCall());
    if (explanationFails) state.complete.mockRejectedValueOnce(new Error('offline'));
    else state.complete.mockResolvedValueOnce({ role: 'assistant', content: 'Tu nueva cita está confirmada.' });
    const response = await POST(request());
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.reply).toMatch(/cancelada/i);
    expect(data.reply).not.toMatch(/confirmada|offline/i);
    expect(data.reply).toContain('2030-01-07');
    expect(data.toolResults[0].result.appointment.status).toBe(`cancelled_by_${actor}`);
    expect([...memory.rows.keys()].filter(path => path.includes('/appointments/'))).toHaveLength(1);
  });
  it('preserves the model explanation for availability queries without a booking', async () => {
    state.complete.mockResolvedValueOnce({ role: 'assistant', content: null, tool_calls: [{ id: 'availability', type: 'function', function: { name: 'consultar_disponibilidad', arguments: JSON.stringify({ dateKey: '2030-01-07', serviceId: 'cut', resourceId: 'chair' }) } }] })
      .mockResolvedValueOnce({ role: 'assistant', content: 'Hay horarios disponibles. ¿Cuál prefieres?' });
    const response = await POST(request());
    const data = await response.json();
    expect(response.status).toBe(200);
    expect(data.reply).toBe('Hay horarios disponibles. ¿Cuál prefieres?');
    expect(data.toolResults[0].result.availability[0].slots).toContain('09:00');
  });
  it('reports tunnel failures as errors without fabricated success', async () => {
    state.complete.mockRejectedValue(new Error('offline'));
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(await response.json()).not.toHaveProperty('reply');
  });
  it('replays a completed booking without another inference or quota charge', async () => {
    const memory = memoryFirestore({ 'businesses/business': business as unknown as Record<string, unknown> });
    state.db = memory.db;
    const call = (startTimeStr: string) => ({ role: 'assistant', content: null, tool_calls: [{ id: 'call-book', type: 'function', function: { name: 'crear_cita', arguments: JSON.stringify({ dateKey: '2030-01-07', startTimeStr, serviceId: 'cut', resourceId: 'chair', clientPhone: '573001234567', intakeAnswers: {} }) } }] });
    state.complete.mockResolvedValueOnce(call('09:00')).mockResolvedValueOnce({ role: 'assistant', content: 'Confirmada.' }).mockResolvedValueOnce(call('10:00')).mockResolvedValueOnce({ role: 'assistant', content: 'Resultado recibido.' });
    const saved = await (await POST(request())).json();
    const retry = await POST(request());
    expect([...memory.rows.keys()].filter((path) => path.includes('/appointments/'))).toHaveLength(1);
    expect(state.complete).toHaveBeenCalledTimes(2);
    expect(await retry.json()).toMatchObject({ toolResults: [{ result: { appointment: { id: saved.toolResults[0].result.appointment.id } } }] });
  });
  it('rejects reuse of a completed request identifier with another message before inference', async () => {
    state.complete.mockResolvedValue({ role: 'assistant', content: 'Puedes consultar los horarios.' });
    expect((await POST(request())).status).toBe(200);
    const reused = await POST(request({ ...body, messages: [{ role: 'user', content: 'Ahora reserva un servicio diferente.' }] }));
    expect(reused.status).toBe(409);
    expect(state.complete).toHaveBeenCalledTimes(1);
  });
  it('holds one quota unit across tool rounds and returns it when inference fails before a result', async () => {
    state.complete.mockRejectedValueOnce(new Error('synthetic offline'));
    expect((await POST(request())).status).toBe(503);
    expect((await getResponseQuota('business')).currentPeriod).toMatchObject({ usedResponses: 0, reservedResponses: 0 });
    state.complete.mockResolvedValueOnce(bookingCall()).mockResolvedValueOnce({ role: 'assistant', content: 'Reserva completada.' });
    expect((await POST(request())).status).toBe(200);
    expect((await getResponseQuota('business')).currentPeriod).toMatchObject({ usedResponses: 1, reservedResponses: 0 });
  });
  it('does not charge an empty model response without any verified tool result', async () => {
    state.complete.mockResolvedValue({ role: 'assistant', content: '  <think>internal only</think>  ' });
    expect((await POST(request())).status).toBe(503);
    expect((await getResponseQuota('business')).currentPeriod).toMatchObject({ usedResponses: 0, reservedResponses: 0 });
  });
  it('stops an exhausted business before the model can execute a booking', async () => {
    state.db = memoryFirestore({
      'businesses/business': business as unknown as Record<string, unknown>,
      'responseQuotaScopes/business_business': { initializedAt: now },
      'responseQuotaScopes/business_business/periods/current': { id: 'current', source: 'subscription', planId: 'monthly', startsAt: now - 1000, endsAt: now + 86400000, includedResponses: 3000, extraResponses: 0, usedResponses: 3000, reservedResponses: 0 },
    }).db;
    state.complete.mockResolvedValue(bookingCall());
    const response = await POST(request());
    expect(response.status).toBe(402);
    expect(await response.json()).toMatchObject({ code: 'AI_QUOTA_EXHAUSTED' });
    expect(state.complete).not.toHaveBeenCalled();
  });
  it('keeps the reserved unit and returned result when quota completion temporarily fails', async () => {
    const memory = memoryFirestore({ 'businesses/business': business as unknown as Record<string, unknown> });
    state.db = memory.db;
    let outage: ReturnType<typeof vi.spyOn> | undefined;
    state.complete.mockImplementationOnce(async () => {
      outage = vi.spyOn(memory.db, 'runTransaction').mockRejectedValue(new Error('synthetic accounting failure'));
      return { role: 'assistant', content: 'Atendemos de nueve a once.' };
    });
    const first = await POST(request());
    expect(first.status).toBe(200);
    expect((await getResponseQuota('business')).currentPeriod).toMatchObject({ usedResponses: 0, reservedResponses: 1 });
    outage?.mockRestore();
    const retry = await POST(request());
    expect(await retry.json()).toMatchObject({ reply: 'Atendemos de nueve a once.' });
    expect(state.complete).toHaveBeenCalledTimes(1);
    expect((await getResponseQuota('business')).currentPeriod).toMatchObject({ usedResponses: 1, reservedResponses: 0 });
  });
  it('does not regenerate a completed plain reply after the volatile cache expires', async () => {
    state.complete.mockResolvedValue({ role: 'assistant', content: 'Atendemos desde las nueve.' });
    expect((await POST(request())).status).toBe(200);
    vi.setSystemTime(now + 16 * 60000);
    const repeated = await POST(request());
    expect(repeated.status).toBe(409);
    expect(await repeated.json()).toMatchObject({ code: 'REQUEST_ALREADY_COMPLETED' });
    expect(state.complete).toHaveBeenCalledTimes(1);
    expect((await getResponseQuota('business')).currentPeriod).toMatchObject({ usedResponses: 1 });
  });
  it('requires durable delivery preparation before accepting a WhatsApp turn', async () => {
    state.complete.mockResolvedValue({ role: 'assistant', content: 'Hola.' });
    await expect(runSarinChat({ user: { uid: 'wa_verified', phone: '573009876543' }, body: { ...body, mode: 'sarin_client' }, channel: 'whatsapp' })).rejects.toMatchObject({ status: 503 });
    expect(state.complete).not.toHaveBeenCalled();
  });
  it('persists the WhatsApp reply before quota completion and binds the booking to its verified sender', async () => {
    prepareWhatsApp();
    state.complete.mockResolvedValueOnce(bookingCall()).mockResolvedValueOnce({ role: 'assistant', content: 'Confirmada.' });
    let prepared: unknown;
    const response = await runSarinChat({
      user: { uid: 'wa_verified', name: 'Cliente WhatsApp', phone: '573009876543' },
      body: { ...body, mode: 'sarin_client' }, channel: 'whatsapp',
      onResponse: async (result, reservation) => {
        prepared = { result, reservation };
        expect((await getResponseQuota('business')).currentPeriod).toMatchObject({ usedResponses: 0, reservedResponses: 1 });
      },
    });
    expect(prepared).toMatchObject({ result: { reply: response.reply }, reservation: { scopeId: expect.any(String) } });
    expect(response.toolResults?.[0].result).toMatchObject({ appointment: { client: { uid: 'wa_verified', phone: '573009876543' } } });
    expect((await getResponseQuota('business')).currentPeriod).toMatchObject({ usedResponses: 1, reservedResponses: 0 });
  });
  it('retries WhatsApp delivery preparation from memory without another model call or quota unit', async () => {
    prepareWhatsApp();
    state.complete.mockResolvedValue({ role: 'assistant', content: 'Atendemos desde las nueve.' });
    const input = { user: { uid: 'wa_verified', phone: '573009876543' }, body: { ...body, mode: 'sarin_client' as const }, channel: 'whatsapp' as const };
    await expect(runSarinChat({ ...input, onResponse: async () => { throw new Error('synthetic outbox failure'); } })).rejects.toThrow('synthetic outbox failure');
    expect((await getResponseQuota('business')).currentPeriod).toMatchObject({ usedResponses: 0, reservedResponses: 1 });
    let persistedReply = '';
    const replay = await runSarinChat({ ...input, onResponse: async (response) => { persistedReply = response.reply; } });
    expect(replay.reply).toBe('Atendemos desde las nueve.');
    expect(persistedReply).toBe(replay.reply);
    expect(state.complete).toHaveBeenCalledTimes(1);
    expect((await getResponseQuota('business')).currentPeriod).toMatchObject({ usedResponses: 1, reservedResponses: 0 });
  });
  it('denies administrative modes to WhatsApp even for a matching owner identifier', async () => {
    await expect(runSarinChat({ user: { uid: 'owner', phone: '573009876543' }, body: { ...body, mode: 'sarin_owner_copilot' }, channel: 'whatsapp', onResponse: async () => {} })).rejects.toMatchObject({ status: 403 });
    expect(state.complete).not.toHaveBeenCalled();
  });
  it.each(['unlinked', 'monthly', 'expired'])('rejects WhatsApp before inference when entitlement is %s', async condition => {
    prepareWhatsApp(condition === 'monthly' ? 'monthly' : 'whatsapp', condition === 'expired' ? now - 1 : now + 86400000);
    if (condition === 'unlinked') state.whatsappReady = false;
    state.complete.mockResolvedValue({ role: 'assistant', content: 'Hola.' });
    await expect(runSarinChat({ user: { uid: 'wa_verified', phone: '573009876543' }, body: { ...body, mode: 'sarin_client' }, channel: 'whatsapp', onResponse: async () => {} })).rejects.toMatchObject({ status: 402 });
    expect(state.complete).not.toHaveBeenCalled();
  });
  it('does not reconfirm a cancelled owner block when replaying the original response', async () => {
    state.complete.mockResolvedValueOnce({ role: 'assistant', content: null, tool_calls: [{ id: 'block', type: 'function', function: { name: 'bloquear_horario', arguments: JSON.stringify({ dateKey: '2030-01-07', startTimeStr: '09:00', endTimeStr: '10:00', resourceId: 'chair', motivo: 'Descanso' }) } }] }).mockResolvedValueOnce({ role: 'assistant', content: 'Bloqueado.' });
    const input = { user: { uid: 'owner' }, body: { ...body, mode: 'sarin_owner_copilot' as const } };
    const saved = await runSarinChat(input);
    const appointment = saved.toolResults?.[0].result.appointment as { id: string };
    await cancelAppointment({ uid: 'owner' }, business.id, appointment.id, state.db as Parameters<typeof cancelAppointment>[3]);
    const replay = await runSarinChat(input);
    expect(replay.reply).toMatch(/cancelado/i);
    expect(replay.reply).not.toContain('quedó bloqueado');
    expect(state.complete).toHaveBeenCalledTimes(2);
  });
});
