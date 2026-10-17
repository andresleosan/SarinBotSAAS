import { act, createElement, StrictMode } from 'react';
import { create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useStructuredBooking } from '@/hooks/useStructuredBooking';
import { apiFetch } from '@/lib/client/api';

vi.mock('@/lib/client/api', async original => ({ ...await original<typeof import('@/lib/client/api')>(), apiFetch: vi.fn() }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let renderer: ReactTestRenderer | undefined, booking!: ReturnType<typeof useStructuredBooking>;
type Scope = { uid?: string; businessId?: string; caseId?: string; active?: boolean };
const selected = { serviceId: 'cut', resourceId: '', dateKey: '2030-01-01', startTimeStr: '' };
const slots = [{ resourceId: 'one', resourceName: 'Ana', slots: ['09:00', '10:00'] }];
const found = { dateKey: '2030-01-03', availability: slots, fromDateKey: '2030-01-02', throughDateKey: '2030-01-15' };
const empty = { ...found, dateKey: null, availability: [] };
function Harness({ uid = 'demo-user', businessId = 'demo-business', caseId = 'demo-request', active = true }: Scope) {
  booking = useStructuredBooking(uid || undefined, { id: businessId }, { subjectKind: 'self', bookingRequestId: caseId }, active);
  return null;
}
async function mount(scope: Scope = {}, strict = false) {
  await act(async () => { renderer = create(strict ? createElement(StrictMode, null, createElement(Harness, scope)) : createElement(Harness, scope)); });
}
async function ready(resourceId = '', strict = false) {
  await mount({}, strict);
  expect(typeof booking.findNextAvailability).toBe('function');
  await act(async () => booking.setSelection({ ...selected, resourceId }));
  vi.mocked(apiFetch).mockResolvedValueOnce({ availability: [] });
  await act(async () => booking.loadAvailability());
}
function deferNext() {
  let resolve!: (data: unknown) => void;
  vi.mocked(apiFetch).mockImplementationOnce(() => new Promise(complete => { resolve = complete; }));
  let pending!: Promise<void>;
  act(() => { pending = booking.findNextAvailability(); });
  const signal = vi.mocked(apiFetch).mock.calls.at(-1)![1]!.signal as AbortSignal;
  return { resolve, pending, signal };
}
beforeEach(() => { vi.spyOn(Date, 'now').mockReturnValue(new Date('2030-01-01T12:00:00Z').getTime()); });
afterEach(async () => { await act(async () => renderer?.unmount()); renderer = undefined; vi.mocked(apiFetch).mockReset(); vi.restoreAllMocks(); });

it.each(['', 'one'])('finds the next date only on request and preserves the chosen resource %s without picking a time', async resourceId => {
  await ready(resourceId);
  expect(booking.nextAvailabilityStatus).toBe('idle');
  expect(vi.mocked(apiFetch).mock.calls).toHaveLength(1);
  const request = deferNext();
  expect(booking.nextAvailabilityStatus).toBe('loading');
  expect(vi.mocked(apiFetch).mock.calls.at(-1)).toMatchObject(['/api/businesses/demo-business/availability/next', { method: 'POST', body: JSON.stringify({ case: { subjectKind: 'self', bookingRequestId: 'demo-request' }, afterDateKey: '2030-01-01', serviceId: 'cut', ...(resourceId ? { resourceId } : {}) }) }, 'demo-user']);
  await act(async () => { request.resolve({ nextAvailability: found }); await request.pending; });
  expect(booking.nextAvailabilityStatus).toBe('found');
  expect(booking.selection).toEqual({ ...selected, resourceId, dateKey: '2030-01-03' });
  expect(booking.availability).toEqual(slots);
  expect(booking.availabilityStatus).toBe('success');
  expect(booking.nextAvailabilityRange).toEqual({ fromDateKey: '2030-01-02', throughDateKey: '2030-01-15' });
  expect(booking.proposal).toBeNull();
  expect(vi.mocked(apiFetch).mock.calls).toHaveLength(2);
});

it('retains the chosen date and exposes the checked range when the window is empty', async () => {
  await ready();
  vi.mocked(apiFetch).mockResolvedValueOnce({ nextAvailability: empty });
  await act(async () => booking.findNextAvailability());
  expect(booking.nextAvailabilityStatus).toBe('empty');
  expect(booking.nextAvailabilityRange).toEqual({ fromDateKey: '2030-01-02', throughDateKey: '2030-01-15' });
  expect(booking.selection).toEqual(selected);
  expect(booking.error).toBeNull();
});

it('rejects a delayed result from yesterday after Colombia crosses midnight and permits a fresh manual retry', async () => {
  await ready();
  vi.mocked(Date.now).mockReturnValue(new Date('2030-01-03T04:59:59Z').getTime());
  const request = deferNext();
  vi.mocked(Date.now).mockReturnValue(new Date('2030-01-03T05:00:01Z').getTime());
  await act(async () => { request.resolve({ nextAvailability: { ...found, dateKey: '2030-01-02' } }); await request.pending; });
  expect(booking.nextAvailabilityStatus).toBe('error');
  expect(booking.selection).toEqual(selected);
  expect(booking.availability).toEqual([]);
  expect(booking.nextAvailabilityRange).toBeNull();
  expect(vi.mocked(apiFetch).mock.calls).toHaveLength(2);
  vi.mocked(apiFetch).mockResolvedValueOnce({ nextAvailability: { ...found, fromDateKey: '2030-01-03', throughDateKey: '2030-01-16' } });
  await act(async () => booking.findNextAvailability());
  expect(booking.nextAvailabilityStatus).toBe('found');
  expect(booking.selection.dateKey).toBe('2030-01-03');
});

it('clears a previously chosen time when it finds a later date', async () => {
  await ready('one');
  await act(async () => booking.setSelection({ ...selected, resourceId: 'one', startTimeStr: '08:00' }));
  vi.mocked(apiFetch).mockResolvedValueOnce({ availability: [] });
  await act(async () => booking.loadAvailability());
  vi.mocked(apiFetch).mockResolvedValueOnce({ nextAvailability: found });
  await act(async () => booking.findNextAvailability());
  expect(booking.selection).toEqual({ ...selected, resourceId: 'one', dateKey: '2030-01-03' });
});

it('reports request failure separately from an empty calendar and allows retry', async () => {
  await ready();
  vi.mocked(apiFetch).mockRejectedValueOnce(new Error('La conexión falló.'));
  await act(async () => booking.findNextAvailability());
  expect(booking.nextAvailabilityStatus).toBe('error');
  expect(booking.error).toContain('La conexión falló.');
  expect(booking.nextAvailabilityRange).toBeNull();
  expect(booking.selection).toEqual(selected);
  vi.mocked(apiFetch).mockResolvedValueOnce({ nextAvailability: found });
  await act(async () => booking.findNextAvailability());
  expect(booking.nextAvailabilityStatus).toBe('found');
  expect(booking.error).toBeNull();
});

it.each([
  null, {}, { ...found, dateKey: '2030-01-01' }, { ...found, dateKey: '2030-02-30' },
  { ...found, dateKey: '2030-01-16' }, { ...found, fromDateKey: '2029-12-31' },
  { ...found, throughDateKey: '2030-01-16' }, { ...found, fromDateKey: '2030-01-16' },
  { ...found, availability: [] }, { ...found, availability: [{ ...slots[0], slots: [] }] },
  { ...found, availability: [{ ...slots[0], slots: ['24:00'] }] },
  { ...found, availability: [{ ...slots[0], resourceName: null }] },
  { ...empty, availability: slots },
])('rejects an invalid response without changing the date: %j', async payload => {
  await ready();
  vi.mocked(apiFetch).mockResolvedValueOnce({ nextAvailability: payload });
  await act(async () => booking.findNextAvailability());
  expect(booking.nextAvailabilityStatus).toBe('error');
  expect(booking.selection).toEqual(selected);
  expect(booking.availability).toEqual([]);
  expect(booking.nextAvailabilityRange).toBeNull();
});

it('rejects a response for a different explicitly chosen professional', async () => {
  await ready('one');
  vi.mocked(apiFetch).mockResolvedValueOnce({ nextAvailability: { ...found, availability: [{ ...slots[0], resourceId: 'other' }] } });
  await act(async () => booking.findNextAvailability());
  expect(booking.nextAvailabilityStatus).toBe('error');
  expect(booking.selection.resourceId).toBe('one');
});

it.each([{ serviceId: 'other' }, { resourceId: 'other' }, { dateKey: '2030-01-08' }])('aborts and discards late results after selection changes: %j', async changed => {
  await ready();
  const request = deferNext();
  await act(async () => booking.setSelection({ ...selected, ...changed }));
  expect(request.signal.aborted).toBe(true);
  await act(async () => { request.resolve({ nextAvailability: found }); await request.pending; });
  expect(booking.selection).toEqual({ ...selected, ...changed });
  expect(booking.nextAvailabilityStatus).toBe('idle');
  expect(booking.nextAvailabilityRange).toBeNull();
  expect(booking.availability).toEqual([]);
});

it.each([{ uid: 'demo-other' }, { uid: '' }, { businessId: 'demo-other' }, { caseId: 'demo-other-request' }, { active: false }])('cannot commit or restart an obsolete search after scope/permission changes: %j', async scope => {
  await ready();
  const retained = booking.findNextAvailability, retainedDaily = booking.loadAvailability, request = deferNext();
  await act(async () => renderer!.update(createElement(Harness, scope)));
  expect(request.signal.aborted).toBe(true);
  await act(async () => { request.resolve({ nextAvailability: found }); await request.pending; await retained(); await retainedDaily(); });
  expect(booking.nextAvailabilityStatus).toBe('idle');
  expect(booking.availability).toEqual([]);
  expect(vi.mocked(apiFetch).mock.calls).toHaveLength(2);
});

it('prevents duplicate searches and gives a newer daily reload ownership over a late result', async () => {
  await ready();
  const retained = booking.findNextAvailability, request = deferNext();
  await act(async () => retained());
  expect(vi.mocked(apiFetch).mock.calls).toHaveLength(2);
  vi.mocked(apiFetch).mockResolvedValueOnce({ availability: slots });
  await act(async () => booking.loadAvailability());
  expect(request.signal.aborted).toBe(true);
  await act(async () => { request.resolve({ nextAvailability: empty }); await request.pending; });
  expect(booking.nextAvailabilityStatus).toBe('idle');
  expect(booking.availability).toEqual(slots);
  expect(booking.selection.dateKey).toBe('2030-01-01');
});

it('clears a completed search on a daily reload', async () => {
  await ready();
  vi.mocked(apiFetch).mockResolvedValueOnce({ nextAvailability: empty });
  await act(async () => booking.findNextAvailability());
  vi.mocked(apiFetch).mockResolvedValueOnce({ availability: [] });
  await act(async () => booking.loadAvailability());
  expect(booking.nextAvailabilityStatus).toBe('idle');
  expect(booking.nextAvailabilityRange).toBeNull();
});

it('requires a successful empty daily read and current permission before searching', async () => {
  await mount();
  expect(typeof booking.findNextAvailability).toBe('function');
  await act(async () => booking.findNextAvailability());
  await act(async () => booking.setSelection(selected));
  await act(async () => booking.findNextAvailability());
  vi.mocked(apiFetch).mockRejectedValueOnce(new Error('No se pudo consultar'));
  await act(async () => booking.loadAvailability());
  await act(async () => booking.findNextAvailability());
  vi.mocked(apiFetch).mockResolvedValueOnce({ availability: slots });
  await act(async () => booking.loadAvailability());
  await act(async () => booking.findNextAvailability());
  expect(vi.mocked(apiFetch).mock.calls).toHaveLength(2);
});

it('retained search and daily handlers cannot modify a frozen proposal or uncertain confirmation', async () => {
  await ready();
  const retained = booking.findNextAvailability, retainedDaily = booking.loadAvailability;
  vi.mocked(apiFetch).mockResolvedValueOnce({ proposal: { id: 'demo-proposal', businessId: 'demo-business' } });
  await act(async () => booking.propose({ kind: 'self' }));
  await act(async () => { await retained(); await retainedDaily(); });
  expect(vi.mocked(apiFetch).mock.calls).toHaveLength(2);
  vi.mocked(apiFetch).mockRejectedValueOnce(new Error('Respuesta perdida'));
  await act(async () => booking.confirm('demo-proposal', { clientPhone: '573001234567', intakeAnswers: {} }));
  await act(async () => { await retained(); await retainedDaily(); });
  expect(booking.uncertain).toBe(true);
  expect(vi.mocked(apiFetch).mock.calls).toHaveLength(3);
});

it('a retained first-confirmation callback cannot begin a booking after permission is withdrawn', async () => {
  await ready();
  vi.mocked(apiFetch).mockResolvedValueOnce({ proposal: { id: 'demo-proposal', businessId: 'demo-business' } });
  await act(async () => booking.propose({ kind: 'self' }));
  const retainedConfirm = booking.confirm;
  await act(async () => renderer!.update(createElement(Harness, { active: false })));
  vi.mocked(apiFetch).mockResolvedValueOnce({ appointment: { id: 'demo-appointment', tenantId: 'demo-business', client: { uid: 'demo-user' } } });
  await act(async () => retainedConfirm('demo-proposal', { clientPhone: '573001234567', intakeAnswers: {} }));
  expect(vi.mocked(apiFetch).mock.calls).toHaveLength(2);
  expect(booking.appointment).toBeNull();
  expect(booking.uncertain).toBe(false);
});

it('aborts an in-flight search when a proposal freezes the booking', async () => {
  await ready();
  const request = deferNext();
  vi.mocked(apiFetch).mockResolvedValueOnce({ proposal: { id: 'demo-proposal', businessId: 'demo-business' } });
  await act(async () => booking.propose({ kind: 'self' }));
  expect(request.signal.aborted).toBe(true);
  await act(async () => { request.resolve({ nextAvailability: found }); await request.pending; });
  expect(booking.selection).toEqual(selected);
  expect(booking.proposal?.id).toBe('demo-proposal');
  expect(booking.nextAvailabilityStatus).toBe('idle');
});

it('a retained selection handler from a different identity cannot abort its replacement search', async () => {
  await ready();
  const retained = booking.setSelection;
  await act(async () => renderer!.update(createElement(Harness, { uid: 'demo-other' })));
  await act(async () => booking.setSelection(selected));
  vi.mocked(apiFetch).mockResolvedValueOnce({ availability: [] });
  await act(async () => booking.loadAvailability());
  const request = deferNext();
  await act(async () => retained({ ...selected, dateKey: '2030-01-07' }));
  expect(request.signal.aborted).toBe(false);
  await act(async () => { request.resolve({ nextAvailability: found }); await request.pending; });
  expect(booking.selection.dateKey).toBe('2030-01-03');
});

it('works after StrictMode effect replay and blocks retained handlers after unmount', async () => {
  await ready('', true);
  const retained = booking.findNextAvailability, request = deferNext();
  await act(async () => renderer!.unmount()); renderer = undefined;
  expect(request.signal.aborted).toBe(true);
  await act(async () => { request.resolve({ nextAvailability: found }); await request.pending; await retained(); });
  expect(vi.mocked(apiFetch).mock.calls).toHaveLength(2);
});
