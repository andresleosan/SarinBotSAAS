import { expect, it, vi } from 'vitest';
import { POST as availability } from '@/app/api/businesses/[id]/availability/route';
import { POST as proposal } from '@/app/api/businesses/[id]/booking-proposals/route';
import { HttpError } from '@/lib/server/http';
const auth = vi.hoisted(() => ({ allowed: false }));
vi.mock('@/lib/server/auth', () => ({ requireUser: async () => { if (!auth.allowed) throw new HttpError(401, 'Session required'); return { uid: 'demo-client' }; } }));
it('requires authentication and strictly bounds structured POST inputs', async () => {
  const context = { params: Promise.resolve({ id: 'demo' }) };
  const request = (body: object, query = '') => new Request(`http://localhost/api/businesses/demo/availability${query}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  expect((await availability(request({}), context)).status).toBe(401); auth.allowed = true;
  expect((await availability(request({ case: { bookingRequestId: 'demo-case', subjectKind: 'self' }, dateKey: '2030-01-01', serviceId: 'cut', clinical: 'secret' }), context)).status).toBe(400);
  expect((await proposal(request({ beneficiary: { kind: 'self' }, secret: 'x'.repeat(9000) }), context)).status).toBe(413);
  expect((await availability(request({}, '?serviceId=s'), context)).status).toBe(400);
});
