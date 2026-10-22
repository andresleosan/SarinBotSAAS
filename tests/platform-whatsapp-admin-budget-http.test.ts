import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const f = vi.hoisted(() => ({ allowed: true, read: vi.fn(), save: vi.fn() }));
vi.mock('@/lib/server/auth', () => ({ requireSuperadmin: async () => { if (!f.allowed) { const { HttpError } = await import('@/lib/server/http'); throw new HttpError(403, 'Forbidden'); } return { uid: 'demo-admin' }; } }));
vi.mock('@/lib/server/platform-whatsapp-admin-budget', async importOriginal => ({ ...await importOriginal<typeof import('@/lib/server/platform-whatsapp-admin-budget')>(), readPlatformAdminBudget: f.read, savePlatformAdminBudget: f.save }));
import { GET, PATCH } from '@/app/api/admin/platform-whatsapp/budget/route';
beforeEach(() => { f.allowed = true; f.read.mockReset(); f.save.mockReset(); });
afterEach(() => vi.restoreAllMocks());
it('denies reads and writes before accessing budget storage', async () => {
  f.allowed = false;
  expect((await GET(new Request('https://synthetic.invalid/api/admin/platform-whatsapp/budget'))).status).toBe(403);
  expect((await PATCH(new Request('https://synthetic.invalid/api/admin/platform-whatsapp/budget', { method: 'PATCH', body: '{}' }))).status).toBe(403);
  expect(f.read).not.toHaveBeenCalled(); expect(f.save).not.toHaveBeenCalled();
});
it('validates bounded input and returns only the confirmed administrative view with no caching', async () => {
  f.save.mockResolvedValue({ configured: true, version: 1, dayUsd: 0.25, monthUsd: 3 });
  const request = (body: unknown) => new Request('https://synthetic.invalid/api/admin/platform-whatsapp/budget', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  expect((await PATCH(request({ expectedVersion: 0, dayUsd: -1, monthUsd: 3 }))).status).toBe(400);
  expect(f.save).not.toHaveBeenCalled();
  const response = await PATCH(request({ expectedVersion: 0, dayUsd: 0.25, monthUsd: 3 }));
  expect(response.status).toBe(200); expect(response.headers.get('Cache-Control')).toBe('no-store');
  expect(f.save).toHaveBeenCalledWith('demo-admin', { expectedVersion: 0, dayUsd: 0.25, monthUsd: 3 });
});
