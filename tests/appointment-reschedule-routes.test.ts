import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Database } from '@/lib/storage/types';
import { HttpError } from '@/lib/server/http';
import { consentedFirestore } from './consent-fixtures';
import { rescheduleActor, rescheduleBusiness, rescheduleContact, rescheduleNow, rescheduleSource, rescheduleSourcePath } from './appointment-reschedule-contract';
import { POST as availability } from '@/app/api/businesses/[id]/reschedule/availability/route';
import { POST as propose } from '@/app/api/businesses/[id]/reschedule/proposals/route';
import { POST as confirm } from '@/app/api/businesses/[id]/booking-proposals/[proposalId]/confirm/route';

const state = vi.hoisted(() => ({ allowed: true, db: undefined as unknown as Database }));
vi.mock('@/lib/server/auth', () => ({ requireUser: async () => { if (!state.allowed) throw new HttpError(401, 'Session required'); return { uid: 'demo-reschedule-client' }; } }));
vi.mock('@/lib/firebase/admin', () => ({ getAdminDb: () => state.db }));
const context = { params: Promise.resolve({ id: 'demo-reschedule-business' }) };
const request = (body: unknown, path = 'availability') => new Request(`http://localhost/api/businesses/demo-reschedule-business/reschedule/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const availabilityBody = { appointmentId: 'demo-original-appointment', sourceRevision: 0, dateKey: '2030-01-07' };
const proposalBody = { appointmentId: 'demo-original-appointment', sourceRevision: 0, requestId: 'demo-route-reschedule', selection: { dateKey: '2030-01-07', startTimeStr: '10:00', resourceId: 'demo-chair' } };
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(rescheduleNow); state.allowed = true;
  state.db = consentedFirestore({ [`businesses/${rescheduleBusiness.id}`]: rescheduleBusiness as unknown as Record<string, unknown>, [rescheduleSourcePath]: rescheduleSource as unknown as Record<string, unknown> }, [rescheduleActor.uid]).db;
});
afterEach(() => vi.useRealTimers());

it('authenticates both endpoints before handling the payload', async () => {
  state.allowed = false;
  expect((await availability(request(availabilityBody), context)).status).toBe(401);
  expect((await propose(request(proposalBody, 'proposals'), context)).status).toBe(401);
});
it('rejects query strings and strict payloads that try to choose a service or beneficiary', async () => {
  expect((await availability(request(availabilityBody, 'availability?date=2030-01-07'), context)).status).toBe(400);
  expect((await propose(request(proposalBody, 'proposals?x=1'), context)).status).toBe(400);
  expect((await availability(request({ ...availabilityBody, serviceId: 'attacker-service' }), context)).status).toBe(400);
  expect((await propose(request({ ...proposalBody, beneficiary: { kind: 'self' } }, 'proposals'), context)).status).toBe(400);
  expect((await propose(request({ ...proposalBody, selection: { ...proposalBody.selection, serviceId: 'attacker-service' } }, 'proposals'), context)).status).toBe(400);
});
it('bounds revision, malformed JSON and body size before domain writes', async () => {
  for (const sourceRevision of [null, -1, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
    expect((await availability(request({ ...availabilityBody, sourceRevision }), context)).status).toBe(400);
  }
  expect((await propose(request({ ...proposalBody, extra: 'x'.repeat(9000) }, 'proposals'), context)).status).toBe(413);
  expect((await availability(new Request('http://localhost/api', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{broken' }), context)).status).toBe(400);
  expect((await state.db.collection('bookingProposals').get()).size).toBe(0);
});
it('uses the canonical service and leaves the original occupied until explicit confirmation', async () => {
  const response = await availability(request(availabilityBody), context);
  expect(response.status).toBe(200); expect(response.headers.get('Cache-Control')).toBe('no-store');
  expect((await response.json()).availability).toEqual([{ resourceId: 'demo-chair', resourceName: 'Profesional actual', slots: expect.arrayContaining(['09:00', '09:15', '10:00']) }]);
  const proposed = await propose(request(proposalBody, 'proposals'), context);
  expect(proposed.status).toBe(200); expect(proposed.headers.get('Cache-Control')).toBe('no-store');
  const { proposal } = await proposed.json();
  expect(proposal).toMatchObject({ priceCOP: 25000, startTimeStr: '10:00', reschedule: { appointmentId: 'demo-original-appointment', sourceRevision: 0, targetServiceId: 'demo-cut', targetResourceId: 'demo-chair' } });
  expect((await state.db.collection('businesses').doc(rescheduleBusiness.id).collection('appointments').doc(rescheduleSource.id).get()).data()).toEqual(rescheduleSource);
  const result = await confirm(request({ confirm: true, ...rescheduleContact }), { params: Promise.resolve({ id: rescheduleBusiness.id, proposalId: proposal.id }) });
  expect(result.status).toBe(200); expect(result.headers.get('Cache-Control')).toBe('no-store');
  const body = await result.json();
  expect(body.appointment).toMatchObject({ id: 'demo-original-appointment', startTimeStr: '10:00', client: rescheduleSource.client });
  expect(body.rescheduleResult).toMatchObject({ proposalId: proposal.id, appointmentId: 'demo-original-appointment', revision: 1, dateKey: '2030-01-07', startTimeStr: '10:00', resourceId: 'demo-chair', startAt: Date.parse('2030-01-07T15:00:00Z'), endAt: Date.parse('2030-01-07T15:30:00Z'), confirmedAt: rescheduleNow });
  expect(JSON.stringify(proposal)).not.toMatch(/sourceFingerprint|original@example|retired_question|573001234567/);
});
