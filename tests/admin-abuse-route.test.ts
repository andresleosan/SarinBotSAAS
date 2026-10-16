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
});
