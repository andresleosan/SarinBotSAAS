import { act, createElement, StrictMode } from 'react';
import { create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useAppointmentReschedule } from '@/hooks/useAppointmentReschedule';
import { apiFetch, ApiError } from '@/lib/client/api';
import type { Appointment } from '@/types/firestore';
import type { BookingProposalView } from '@/types/chat';
import type { BookingSubjectCase } from '@/lib/booking-subject';
vi.mock('@/lib/client/api', async original => ({ ...await original<typeof import('@/lib/client/api')>(), apiFetch: vi.fn() }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const source: Appointment = { id: 'demo-visit', tenantId: 'demo-shop', type: 'appointment', status: 'confirmed', serviceId: 'cut', resourceId: 'old-chair', dateKey: '2030-01-02', startTimeStr: '09:00', endTimeStr: '09:30', startAt: Date.parse('2030-01-02T14:00:00Z'), endAt: Date.parse('2030-01-02T14:30:00Z'), reservedUntilAt: Date.parse('2030-01-02T14:30:00Z'), price: 30000, client: { uid: 'demo-client', name: 'Demo', email: '', phone: '573000000000', intakeAnswers: { old: 'preserve' } }, beneficiary: { kind: 'represented_minor', displayName: 'Demo menor', representativeRole: 'parent' }, createdBy: 'sarin_client', createdAt: 1 };
const subjectCase: BookingSubjectCase = { bookingRequestId: 'demo-change', subjectKind: 'represented_minor', representativeRole: 'parent' };
const selection = { dateKey: '2030-01-03', resourceId: 'new-chair', startTimeStr: '10:00' };
const proposal: BookingProposalView = { id: 'demo-proposal', businessId: 'demo-shop', serviceName: 'Corte actual', resourceName: 'Silla actual', dateKey: selection.dateKey, startTimeStr: '10:00', endTimeStr: '10:40', priceCOP: 40000, expiresAt: 9999999999999, intakeFields: [], subjectCase, reschedule: { appointmentId: source.id, sourceRevision: 0, source: { dateKey: source.dateKey, startTimeStr: source.startTimeStr, endTimeStr: source.endTimeStr, resourceId: source.resourceId, priceCOP: source.price }, targetServiceId: 'cut', targetResourceId: 'new-chair' } };
const evidence = { proposalId: proposal.id, appointmentId: source.id, revision: 1, ...selection, startAt: Date.parse('2030-01-03T15:00:00Z'), endAt: Date.parse('2030-01-03T15:40:00Z'), confirmedAt: Date.parse('2030-01-01T15:00:00Z') };
let renderer: ReactTestRenderer | undefined, controller!: ReturnType<typeof useAppointmentReschedule>;
type Props = { uid?: string; active?: boolean; contextKey?: string; appointment?: Appointment; caseValue?: BookingSubjectCase; requestId?: string };
function Harness({ uid = 'demo-client', active = true, contextKey = 'catalog-1', appointment = source, caseValue = subjectCase, requestId = 'demo-change' }: Props) { controller = useAppointmentReschedule(uid, { id: 'demo-shop' }, appointment, requestId, caseValue, active, contextKey); return null; }
async function mount() { await act(async () => { renderer = create(createElement(StrictMode, null, createElement(Harness))); }); }
async function prepare() { await act(async () => controller.setSelection(selection)); await act(async () => controller.loadAvailability()); await act(async () => controller.propose()); }
beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(evidence.confirmedAt); vi.mocked(apiFetch).mockReset().mockImplementation(async path => path.endsWith('/availability') ? { availability: [{ resourceId: selection.resourceId, resourceName: 'Silla', slots: ['10:00'] }] } : { proposal }); });
afterEach(async () => { await act(async () => renderer?.unmount()); renderer = undefined; vi.useRealTimers(); });

it('starts with no new day or time, uses dedicated daily availability and freezes the source and proposal without sending private source data', async () => {
  await mount(); expect(controller.selection).toEqual({ dateKey: '', startTimeStr: '', resourceId: source.resourceId }); expect(apiFetch).not.toHaveBeenCalled();
  await prepare(); expect(controller.proposal).toEqual(proposal);
  const calls = vi.mocked(apiFetch).mock.calls;
  expect(calls[0][0]).toBe('/api/businesses/demo-shop/reschedule/availability'); expect(JSON.parse(calls[0][1]!.body as string)).toEqual({ appointmentId: source.id, sourceRevision: 0, dateKey: selection.dateKey, resourceId: selection.resourceId, case: subjectCase });
  expect(JSON.parse(calls[1][1]!.body as string)).toEqual({ appointmentId: source.id, sourceRevision: 0, requestId: 'demo-change', selection, case: subjectCase });
  expect(JSON.stringify(calls)).not.toMatch(/573000000000|preserve|Demo menor|serviceId|intakeAnswers/);
  await act(async () => controller.setSelection({ ...selection, startTimeStr: '11:00' })); expect(controller.selection).toEqual(selection);
});

it('recovers the identical confirmation despite permission and catalog withdrawal and accepts later current state only beside immutable operation proof', async () => {
  await mount(); await prepare();
  vi.mocked(apiFetch).mockRejectedValueOnce(new Error('Respuesta perdida'));
  await act(async () => controller.confirm()); expect(controller.uncertain).toBe(true);
  const original = vi.mocked(apiFetch).mock.calls.at(-1)!;
  expect(JSON.parse(original[1]!.body as string)).toEqual({ confirm: true, clientPhone: null, intakeAnswers: {}, beneficiary: source.beneficiary });
  await act(async () => renderer!.update(createElement(StrictMode, null, createElement(Harness, { active: false, contextKey: 'catalog-2' }))));
  const later = { ...source, rescheduleRevision: 2, dateKey: '2030-01-05', status: 'cancelled_by_owner' };
  vi.mocked(apiFetch).mockResolvedValueOnce({ appointment: later, rescheduleResult: evidence });
  await act(async () => controller.retryConfirmation());
  expect(controller.result).toEqual(evidence); expect(controller.uncertain).toBe(false);
  const retried = vi.mocked(apiFetch).mock.calls.at(-1)!; expect(retried[0]).toBe(original[0]); expect(retried[1]!.body).toBe(original[1]!.body);
});

it.each(['appointment', 'revision', 'resource', 'time', 'proposal', 'missing'])('rejects malformed or unrelated immutable confirmation evidence: %s', async changed => {
  await mount(); await prepare();
  const wrong = { ...evidence, ...(changed === 'appointment' ? { appointmentId: 'other' } : changed === 'revision' ? { revision: 2 } : changed === 'resource' ? { resourceId: 'other' } : changed === 'time' ? { endAt: evidence.endAt + 1 } : changed === 'proposal' ? { proposalId: 'other' } : {}) };
  vi.mocked(apiFetch).mockResolvedValueOnce({ appointment: { ...source, ...selection, startAt: evidence.startAt, endAt: evidence.endAt, rescheduleRevision: 1 }, ...(changed !== 'missing' ? { rescheduleResult: wrong } : {}) });
  await act(async () => controller.confirm()); expect(controller.result).toBeNull(); expect(controller.uncertain).toBe(true);
});

it('finishes only with immutable proof and a consistent current record for that operation revision', async () => {
  await mount(); await prepare();
  vi.mocked(apiFetch).mockResolvedValueOnce({ appointment: { ...source, ...selection, endTimeStr: '10:40', startAt: evidence.startAt, endAt: evidence.endAt, rescheduleRevision: 1 }, rescheduleResult: evidence });
  await act(async () => controller.confirm()); expect(controller.result).toEqual(evidence); expect(controller.uncertain).toBe(false);
});

it.each(['service', 'type', 'end-time'])('rejects a hybrid current record beside otherwise valid operation proof: %s', async changed => {
  await mount(); await prepare();
  const appointment = { ...source, ...selection, endTimeStr: '10:40', startAt: evidence.startAt, endAt: evidence.endAt, rescheduleRevision: 1, ...(changed === 'service' ? { serviceId: 'other' } : changed === 'type' ? { type: 'manual_block' as const } : { endTimeStr: '09:30' }) };
  vi.mocked(apiFetch).mockResolvedValueOnce({ appointment, rescheduleResult: evidence }); await act(async () => controller.confirm()); expect(controller.result).toBeNull(); expect(controller.uncertain).toBe(true);
});

it.each(['catalog', 'permission', 'selection', 'account', 'unmount'])('discards a late availability read after %s and rejects retained operations', async change => {
  let finish!: (value: unknown) => void; let signal!: AbortSignal;
  vi.mocked(apiFetch).mockImplementation((_path, init) => { signal = init!.signal as AbortSignal; return new Promise(resolve => { finish = resolve; }); });
  await mount(); await act(async () => controller.setSelection(selection)); const retained = controller.propose;
  let pending!: Promise<void>; await act(async () => { pending = controller.loadAvailability(); });
  if (change === 'catalog') await act(async () => renderer!.update(createElement(StrictMode, null, createElement(Harness, { contextKey: 'catalog-2' }))));
  if (change === 'permission') await act(async () => renderer!.update(createElement(StrictMode, null, createElement(Harness, { active: false }))));
  if (change === 'account') await act(async () => renderer!.update(createElement(StrictMode, null, createElement(Harness, { uid: 'other' }))));
  if (change === 'selection') await act(async () => controller.setSelection({ ...selection, dateKey: '2030-01-04', startTimeStr: '' }));
  if (change === 'unmount') { await act(async () => renderer!.unmount()); renderer = undefined; }
  expect(signal.aborted).toBe(true); await act(async () => { finish({ availability: [{ resourceId: 'new-chair', resourceName: 'Old', slots: ['10:00'] }] }); await pending; });
  expect(controller.availability).toEqual([]); const before = vi.mocked(apiFetch).mock.calls.length; await act(async () => retained()); expect(apiFetch).toHaveBeenCalledTimes(before);
});

it('retains an uncertain operation through generic conflicts until durable terminal closure', async () => {
  await mount(); await prepare(); vi.mocked(apiFetch).mockRejectedValueOnce(new Error('lost')).mockRejectedValueOnce(new ApiError('conflict', 409, 'DATA_CONFLICT')).mockRejectedValueOnce(new ApiError('closed', 409, 'BOOKING_PROPOSAL_CLOSED'));
  await act(async () => controller.confirm()); await act(async () => controller.retryConfirmation()); expect(controller.uncertain).toBe(true);
  await act(async () => controller.retryConfirmation()); expect(controller.uncertain).toBe(false); expect(controller.result).toBeNull();
});
