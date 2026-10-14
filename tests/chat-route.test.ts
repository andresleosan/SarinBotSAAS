import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Business } from '../src/types/firestore';
import { memoryFirestore } from './memoryFirestore';

const state = vi.hoisted(() => ({ db: undefined as unknown, complete: vi.fn() }));
vi.mock('../src/lib/firebase/admin', () => ({ getAdminDb: () => state.db }));
vi.mock('../src/lib/server/auth', async () => {
  const { HttpError } = await import('../src/lib/server/http');
  return { requireUser: async (request: Request) => { if (!request.headers.has('authorization')) throw new HttpError(401, 'Login'); return { uid: 'client', email: 'client@example.test', name: 'Cliente' }; } };
});
vi.mock('../src/lib/sarin/engine', () => ({ completeChat: state.complete }));
import { POST } from '../src/app/api/sarin/chat/route';

const now = Date.parse('2030-01-01T12:00:00Z');
const business: Business = { id: 'business', slug: 'real', ownerUid: 'owner', ownerEmail: '', name: 'Real', category: 'Barbería', phoneWhatsApp: '573001234567', timezone: 'America/Bogota', subscription: { status: 'active', trialEndsAt: 0, currentPeriodEndsAt: now + 30 * 86400000 }, sarinConfig: { onboardingCompleted: true, tone: '', customRules: '', intakeFields: [] }, resources: [{ id: 'chair', name: 'Silla', active: true }], services: [{ id: 'cut', name: 'Corte', durationMinutes: 30, bufferMinutes: 15, price: 20000, resourceIds: ['chair'] }], weeklySchedule: { 1: { isOpen: true, intervals: [{ start: '09:00', end: '11:00' }] } }, createdAt: now };
const body = { mode: 'sarin_client', tenantId: 'business', requestId: 'request-one', messages: [{ role: 'user', content: 'Agenda corte el lunes 7 a las 9.' }] };
const request = (data: unknown = body, authenticated = true) => new Request('http://localhost/api/sarin/chat', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(authenticated ? { Authorization: 'Bearer token' } : {}) }, body: JSON.stringify(data) });
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(now); state.db = memoryFirestore({ 'businesses/business': business as unknown as Record<string, unknown> }).db; state.complete.mockReset(); });
afterEach(() => vi.useRealTimers());
describe('authenticated tool orchestration', () => {
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
