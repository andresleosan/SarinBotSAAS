import { act, createElement } from 'react';
import { create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, expect, it, vi } from 'vitest';
import { useStructuredBooking } from '@/hooks/useStructuredBooking';
import { apiFetch } from '@/lib/client/api';
vi.mock('@/lib/client/api', async original => ({ ...await original<typeof import('@/lib/client/api')>(), apiFetch: vi.fn() }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let renderer: ReactTestRenderer | undefined, controller!: ReturnType<typeof useStructuredBooking>;
const subjectCase = { bookingRequestId: 'demo-ui-case', subjectKind: 'represented_minor' as const, representativeRole: 'parent' as const }, business = { id: 'demo-business' };
function Harness({ uid = 'demo-user', active = true }: { uid?: string; active?: boolean }) { controller = useStructuredBooking(uid, business, subjectCase, active); return null; }
afterEach(async () => { await act(async () => renderer?.unmount()); renderer = undefined; vi.mocked(apiFetch).mockReset(); });
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
