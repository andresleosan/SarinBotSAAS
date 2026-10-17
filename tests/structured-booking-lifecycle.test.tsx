import { act, createElement } from 'react';
import { create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, expect, it, vi } from 'vitest';
import { useStructuredBooking } from '@/hooks/useStructuredBooking';
import { apiFetch, ApiError } from '@/lib/client/api';
vi.mock('@/lib/client/api', async original => ({ ...await original<typeof import('@/lib/client/api')>(), apiFetch: vi.fn() }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let renderer: ReactTestRenderer | undefined, controller!: ReturnType<typeof useStructuredBooking>;
const subjectCase = { bookingRequestId: 'demo-ui-case', subjectKind: 'represented_minor' as const, representativeRole: 'parent' as const }, business = { id: 'demo-business' };
function Harness({ uid = 'demo-user', active = true, businessId = business.id, requestId = subjectCase.bookingRequestId, initialServiceId }: { uid?: string; active?: boolean; businessId?: string; requestId?: string; initialServiceId?: string }) { controller = useStructuredBooking(uid, { id: businessId }, { ...subjectCase, bookingRequestId: requestId }, active, initialServiceId); return null; }
afterEach(async () => { await act(async () => renderer?.unmount()); renderer = undefined; vi.mocked(apiFetch).mockReset(); });
it('distinguishes unsearched, loading, successful empty and failed availability', async () => {
  let resolve!: (value: unknown) => void;
  vi.mocked(apiFetch).mockImplementationOnce(() => new Promise(complete => { resolve = complete; })).mockRejectedValueOnce(new Error('No se pudo consultar'));
  await act(async () => { renderer = create(createElement(Harness)); });
  expect(controller.availabilityStatus).toBe('idle');
  await act(async () => controller.setSelection({ dateKey: '2030-01-01', serviceId: 'one', resourceId: '', startTimeStr: '' }));
  let pending!: Promise<void>;
  act(() => { pending = controller.loadAvailability(); });
  expect(controller.availabilityStatus).toBe('loading');
  await act(async () => { resolve({ availability: [] }); await pending; });
  expect(controller.availabilityStatus).toBe('success');
  expect(controller.availability).toEqual([]);
  await act(async () => controller.loadAvailability());
  expect(controller.availabilityStatus).toBe('error');
  expect(controller.error).toBe('No se pudo consultar');
});

it.each([
  { serviceId: 'two' },
  { resourceId: 'other' },
  { dateKey: '2030-01-02' },
])('clears completed and late empty searches when selection changes: %j', async changed => {
  const reads: { signal: AbortSignal; resolve: (data: unknown) => void }[] = [];
  vi.mocked(apiFetch).mockResolvedValueOnce({ availability: [] }).mockImplementation((_path, init) => new Promise(resolve => reads.push({ signal: init!.signal as AbortSignal, resolve })));
  await act(async () => { renderer = create(createElement(Harness)); });
  const selected = { dateKey: '2030-01-01', serviceId: 'one', resourceId: 'r', startTimeStr: '' };
  await act(async () => controller.setSelection(selected));
  await act(async () => controller.loadAvailability());
  expect(controller.availabilityStatus).toBe('success');
  await act(async () => controller.setSelection({ ...selected, ...changed }));
  expect(controller.availabilityStatus).toBe('idle');
  let pending!: Promise<void>;
  act(() => { pending = controller.loadAvailability(); });
  await act(async () => controller.setSelection(selected));
  expect(reads[0].signal.aborted).toBe(true);
  await act(async () => { reads[0].resolve({ availability: [] }); await pending; });
  expect(controller.availabilityStatus).toBe('idle');
  expect(controller.availability).toEqual([]);
});

it.each([
  { uid: 'demo-other-user' },
  { businessId: 'demo-other-business' },
  { requestId: 'demo-other-case' },
])('clears successful availability and the initial service when booking identity changes: %j', async changed => {
  vi.mocked(apiFetch).mockResolvedValue({ availability: [] });
  await act(async () => { renderer = create(createElement(Harness, { initialServiceId: 'one' })); });
  expect(controller.selection).toMatchObject({ serviceId: 'one', resourceId: '', startTimeStr: '' });
  await act(async () => controller.loadAvailability());
  expect(controller.availabilityStatus).toBe('success');
  await act(async () => renderer!.update(createElement(Harness, { initialServiceId: 'one', ...changed })));
  expect(controller.availabilityStatus).toBe('idle');
  expect(controller.selection).toMatchObject({ serviceId: '', resourceId: '', startTimeStr: '' });
  expect(controller.availability).toEqual([]);
});
it('late availability cannot replace changed service or account', async () => {
  const reads: { signal: AbortSignal; resolve: (data: unknown) => void }[] = [];
  vi.mocked(apiFetch).mockImplementation((_path, init) => new Promise(resolve => reads.push({ signal: init!.signal as AbortSignal, resolve })));
  await act(async () => { renderer = create(createElement(Harness)); });
  await act(async () => controller.setSelection({ dateKey: '2030-01-01', serviceId: 'one', resourceId: 'r', startTimeStr: '' }));
  let pending!: Promise<void>; act(() => { pending = controller.loadAvailability(); });
  await act(async () => controller.setSelection({ dateKey: '2030-01-01', serviceId: 'two', resourceId: 'r', startTimeStr: '' })); expect(reads[0].signal.aborted).toBe(true);
  await act(async () => { reads[0].resolve({ availability: [{ resourceId: 'r', resourceName: 'Old', slots: ['09:00'] }] }); await pending; }); expect(controller.availability).toEqual([]);
  act(() => { pending = controller.loadAvailability(); }); await act(async () => renderer!.update(createElement(Harness, { uid: 'demo-other' })));
  await act(async () => { reads[1].resolve({ availability: [{ resourceId: 'r', resourceName: 'Old', slots: ['10:00'] }] }); await pending; }); expect(controller.availability).toEqual([]);
});
it('lost confirmation retries original proposal and contact after permission withdrawal', async () => {
  const p = { id: 'demo-proposal', businessId: 'demo-business' }, appointment = { id: 'demo-appointment', tenantId: 'demo-business', client: { uid: 'demo-user' } };
  vi.mocked(apiFetch).mockResolvedValueOnce({ proposal: p }).mockRejectedValueOnce(new Error('Respuesta perdida')).mockResolvedValueOnce({ appointment });
  await act(async () => { renderer = create(createElement(Harness)); });
  await act(async () => controller.setSelection({ dateKey: '2030-01-01', serviceId: 'one', resourceId: 'r', startTimeStr: '09:00' }));
  await act(async () => controller.propose({ kind: 'represented_minor', displayName: 'SYNTHETIC_PRIVATE_SUBJECT', representativeRole: 'parent' }));
  await act(async () => controller.confirm(p.id, { clientPhone: '573001234567', intakeAnswers: {} })); expect(controller.uncertain).toBe(true);
  const original = vi.mocked(apiFetch).mock.calls[1]; await act(async () => renderer!.update(createElement(Harness, { active: false })));
  await act(async () => controller.retryConfirmation()); const replay = vi.mocked(apiFetch).mock.calls[2]; expect(replay[0]).toBe(original[0]); expect(replay[1]?.body).toBe(original[1]?.body); expect(replay[2]).toBe('demo-user'); expect(controller.appointment).toEqual(appointment);
});
it('keeps an uncertain original through generic conflicts until a durable terminal close', async () => {
  const proposal = { id: 'demo-proposal', businessId: business.id };
  vi.mocked(apiFetch).mockResolvedValueOnce({ proposal }).mockRejectedValueOnce(new Error('lost response')).mockRejectedValueOnce(new ApiError('conflict', 409, 'DATA_CONFLICT')).mockRejectedValueOnce(new ApiError('closed', 409, 'BOOKING_PROPOSAL_CLOSED'));
  await act(async () => { renderer = create(createElement(Harness)); });
  await act(async () => controller.propose({ kind: 'represented_minor', displayName: 'Demo', representativeRole: 'parent' }));
  await act(async () => controller.confirm(proposal.id, { clientPhone: '573001234567', intakeAnswers: {} }));
  await act(async () => controller.retryConfirmation());
  expect(controller.uncertain).toBe(true);
  await act(async () => controller.retryConfirmation());
  expect(controller.uncertain).toBe(false);
  expect(vi.mocked(apiFetch).mock.calls.slice(1).every(call => call[1]?.body === vi.mocked(apiFetch).mock.calls[1][1]?.body)).toBe(true);
});
