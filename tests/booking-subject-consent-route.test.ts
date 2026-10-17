import { expect, it, vi } from 'vitest';
import { GET, POST } from '@/app/api/booking-subject-consent/route';
import { HttpError } from '@/lib/server/http';
const auth = vi.hoisted(() => ({ allowed: false }));
vi.mock('@/lib/server/auth', () => ({ requireUser: async () => { if (!auth.allowed) throw new HttpError(401, 'Inicia sesión'); return { uid: 'demo-client' }; } }));
it('requires authentication and strict case inputs without beneficiary data', async () => {
  expect((await GET(new Request('http://localhost/api/booking-subject-consent'))).status).toBe(401);
  auth.allowed = true;
  for (const query of ['?businessId=demo', '?businessId=demo&bookingRequestId=demo-case&subjectKind=self&representativeRole=parent', '?businessId=demo&bookingRequestId=demo-case&subjectKind=self&displayName=secret', '?businessId=demo&businessId=other&bookingRequestId=demo-case&subjectKind=self']) expect((await GET(new Request(`http://localhost/api/booking-subject-consent${query}`))).status).toBe(400);
  const response = await POST(new Request('http://localhost/api/booking-subject-consent', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ businessId: 'demo', case: { bookingRequestId: 'demo-case', subjectKind: 'self' }, action: 'accept', requestId: 'demo-decision', expectedRevision: 0, displayName: 'SYNTHETIC_PRIVATE_SUBJECT' }) }));
  expect(response.status).toBe(400); expect(response.headers.get('Cache-Control')).toBe('no-store');
});
