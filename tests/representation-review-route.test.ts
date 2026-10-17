import { expect, it, vi } from 'vitest';
import { PATCH } from '@/app/api/businesses/[id]/appointments/[appointmentId]/representation-review/route';
import { HttpError } from '@/lib/server/http';
const state = vi.hoisted(() => ({ allowed: false }));
vi.mock('@/lib/server/auth', () => ({ requireUser: async () => { if (!state.allowed) throw new HttpError(401, 'Session required'); return { uid: 'demo-owner' }; } }));
it('authenticates review and rejects clinical notes or caller actor timestamps', async () => {
  const context = { params: Promise.resolve({ id: 'demo', appointmentId: 'demo-appointment' }) }, request = (body: object) => new Request('http://localhost/review', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  expect((await PATCH(request({}), context)).status).toBe(401); state.allowed = true;
  for (const body of [{ expectedRevision: 0, status: 'reviewed', note: 'SYNTHETIC_PRIVATE_SUBJECT' }, { expectedRevision: 0, status: 'reviewed', reviewedBy: 'other', reviewedAt: 0 }, { expectedRevision: 0, status: 'cancelled' }]) expect((await PATCH(request(body), context)).status).toBe(400);
  expect((await PATCH(request({ note: 'x'.repeat(1100) }), context)).status).toBe(413);
});
