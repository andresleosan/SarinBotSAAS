import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { memoryFirestore } from './memoryFirestore';
const state = vi.hoisted(() => ({ uid: 'admin', db: null as unknown }));
vi.mock('@/lib/firebase/admin', () => ({ getAdminDb: () => state.db }));
vi.mock('@/lib/server/auth', async original => {
  const actual = await original<typeof import('@/lib/server/auth')>();
  const { HttpError } = await import('@/lib/server/http');
  return { ...actual, requireSuperadmin: async () => { if (state.uid !== 'admin') throw new HttpError(403, 'Forbidden'); return { uid: state.uid }; } };
});
import { GET, PATCH } from '@/app/api/admin/abuse/route';
import { DEFAULT_AI_BUDGET_LIMITS } from '@/lib/server/ai-budget';
const request = (body: unknown) => new Request('https://sarin.test/api/admin/abuse', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
describe('private admin budget settings', () => {
  beforeEach(() => { state.db = memoryFirestore().db; state.uid = 'admin'; vi.stubEnv('SUPERADMIN_UID', 'admin'); });
  afterEach(() => vi.unstubAllEnvs());
  it('denies non-admin reads and changes; versions valid changes and rejects unknown fields', async () => {
    const input = { action: 'configure', expectedVersion: 0, paused: false, limits: DEFAULT_AI_BUDGET_LIMITS, reason: 'Synthetic setup' };
    state.uid = 'other'; expect((await GET(new Request('https://sarin.test/api'))).status).toBe(403); expect((await PATCH(request(input))).status).toBe(403);
    state.uid = 'admin'; const first = await PATCH(request(input)); expect(first.status).toBe(200); expect(first.headers.get('cache-control')).toBe('no-store');
    expect((await first.json()).settings.version).toBe(1);
    expect((await PATCH(request(input))).status).toBe(409);
    expect((await PATCH(request({ ...input, extra: true }))).status).toBe(400);
  });
  it('reads and updates one business privately and validates mutually exclusive query parameters', async () => {
    // The route uses the database directly; create only the synthetic business it needs.
    await (state.db as ReturnType<typeof memoryFirestore>['db']).collection('businesses').doc('one').set({ id: 'one', name: 'Negocio Uno' });
    await PATCH(request({ action: 'configure', expectedVersion: 0, paused: false, limits: DEFAULT_AI_BUDGET_LIMITS, reason: 'Synthetic general budget' }));
    const input = { action: 'configure_business', businessId: 'one', expectedVersion: 0, expectedSettingsVersion: 1, limits: { businessDayUsd: 0.2, businessMonthUsd: 3 }, reason: 'Synthetic individual funding' };
    const saved = await PATCH(request(input)); expect(saved.status).toBe(200);
    expect((await saved.json()).override).toMatchObject({ businessId: 'one', version: 1, updatedBy: 'admin', limits: input.limits });
    const view = await GET(new Request('https://sarin.test/api/admin/abuse?businessId=one'));
    expect(view.status).toBe(200); expect(view.headers.get('cache-control')).toBe('no-store');
    expect((await view.json()).businessId).toBe('one');
    expect((await PATCH(request(input))).status).toBe(409);
    expect((await PATCH(request({ ...input, limits: { ...input.limits, globalMonthUsd: 99 } }))).status).toBe(400);
    for (const query of ['businessId=one&businessId=two', 'businessId=one&cursor=00000000-0000-4000-8000-000000000001', 'businessId=one&extra=1', 'businessId=../one']) expect((await GET(new Request(`https://sarin.test/api/admin/abuse?${query}`))).status).toBe(400);
    state.uid = 'owner'; expect((await GET(new Request('https://sarin.test/api/admin/abuse?businessId=one'))).status).toBe(403);
    expect((await PATCH(request({ ...input, expectedVersion: 1 }))).status).toBe(403);
  });
});
