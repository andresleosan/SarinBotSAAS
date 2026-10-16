import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Business } from '../src/types/firestore';
import { memoryFirestore } from './memoryFirestore';

const state = vi.hoisted(() => ({ db: undefined as unknown, complete: vi.fn(), userName: 'Cliente' }));
vi.mock('../src/lib/firebase/admin', () => ({ getAdminDb: () => state.db }));
vi.mock('../src/lib/server/auth', async () => {
  const { HttpError } = await import('../src/lib/server/http');
  return { requireUser: async (request: Request) => { if (!request.headers.has('authorization')) throw new HttpError(401, 'Login'); return { uid: 'client', email: 'client@example.test', name: state.userName }; } };
});
vi.mock('../src/lib/sarin/engine', async (importOriginal) => ({ ...await importOriginal<typeof import('../src/lib/sarin/engine')>(), completeChat: state.complete }));
import { POST } from '../src/app/api/sarin/chat/route';
import { cancelAppointment } from '../src/lib/server/bookings';
import type { DecodedIdToken } from 'firebase-admin/auth';

const now = Date.parse('2030-01-01T12:00:00Z');
const business: Business = { id: 'business', slug: 'real', ownerUid: 'owner', ownerEmail: '', name: 'Real', category: 'Barbería', phoneWhatsApp: '573001234567', timezone: 'America/Bogota', subscription: { status: 'active', trialEndsAt: 0, currentPeriodEndsAt: now + 30 * 86400000 }, sarinConfig: { onboardingCompleted: true, tone: '', customRules: '', intakeFields: [] }, resources: [{ id: 'chair', name: 'Silla', active: true }], services: [{ id: 'cut', name: 'Corte', durationMinutes: 30, bufferMinutes: 15, price: 20000, resourceIds: ['chair'] }], weeklySchedule: { 1: { isOpen: true, intervals: [{ start: '09:00', end: '11:00' }] } }, createdAt: now };
const body = { mode: 'sarin_client', tenantId: 'business', requestId: 'request-one', messages: [{ role: 'user', content: 'Agenda corte el lunes 7 a las 9.' }] };
const request = (data: unknown = body, authenticated = true) => new Request('http://localhost/api/sarin/chat', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(authenticated ? { Authorization: 'Bearer token' } : {}) }, body: JSON.stringify(data) });
const bookingCall = () => ({ role: 'assistant', content: null, tool_calls: [{ id: 'call-book', type: 'function', function: { name: 'crear_cita', arguments: JSON.stringify({ dateKey: '2030-01-07', startTimeStr: '09:00', serviceId: 'cut', resourceId: 'chair', clientPhone: '573001234567', intakeAnswers: {} }) } }] });
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(now); vi.stubEnv('SARIN_CHAT_PROVIDER', 'ollama'); state.db = memoryFirestore({ 'businesses/business': business as unknown as Record<string, unknown> }).db; state.complete.mockReset(); state.userName = 'Cliente'; });
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });
describe('authenticated tool orchestration', () => {
  it('keeps one provider across the tool loop while a later turn observes an admin switch', async () => {
    const { db } = memoryFirestore({ 'businesses/business': business as unknown as Record<string, unknown>, 'serverSettings/ai': { provider: 'deepseek', updatedAt: now } });
    state.db = db;
    state.complete.mockImplementationOnce(async () => {
      await db.collection('serverSettings').doc('ai').set({ provider: 'ollama', updatedAt: now + 1 });
      return bookingCall();
    }).mockResolvedValue({ role: 'assistant', content: 'Consulta completada.' });
    expect((await POST(request())).status).toBe(200);
    expect(state.complete.mock.calls.map(call => call[2]?.provider)).toEqual(['deepseek', 'deepseek']);
    expect((await POST(request({ ...body, requestId: 'second-provider-turn' }))).status).toBe(200);
    expect(state.complete.mock.calls.at(-1)?.[2]?.provider).toBe('ollama');
  });
  it('uses the private selection for onboarding as well as booking chat', async () => {
    state.db = memoryFirestore({ 'serverSettings/ai': { provider: 'deepseek', updatedAt: now } }).db;
    state.complete.mockResolvedValue({ role: 'assistant', content: 'Describe tu negocio.' });
    expect((await POST(request({ ...body, mode: 'sarin_onboarding', tenantId: '' }))).status).toBe(200);
    expect(state.complete.mock.calls[0][2]?.provider).toBe('deepseek');
  });
  it('refuses an invalid persisted provider before inference or tools run', async () => {
    state.db = memoryFirestore({ 'businesses/business': business as unknown as Record<string, unknown>, 'serverSettings/ai': { provider: 'unsupported', updatedAt: now } }).db;
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
  it('cannot commit a second changed booking when the same HTTP request is retried', async () => {
    const memory = memoryFirestore({ 'businesses/business': business as unknown as Record<string, unknown> });
    state.db = memory.db;
    const call = (startTimeStr: string) => ({ role: 'assistant', content: null, tool_calls: [{ id: 'call-book', type: 'function', function: { name: 'crear_cita', arguments: JSON.stringify({ dateKey: '2030-01-07', startTimeStr, serviceId: 'cut', resourceId: 'chair', clientPhone: '573001234567', intakeAnswers: {} }) } }] });
    state.complete.mockResolvedValueOnce(call('09:00')).mockResolvedValueOnce({ role: 'assistant', content: 'Confirmada.' }).mockResolvedValueOnce(call('10:00')).mockResolvedValueOnce({ role: 'assistant', content: 'Resultado recibido.' });
    await POST(request());
    const retry = await POST(request());
    expect([...memory.rows.keys()].filter((path) => path.includes('/appointments/'))).toHaveLength(1);
    expect((await retry.json()).toolResults[0].result.status).toBe(409);
  });
});
