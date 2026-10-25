import { act, createElement, StrictMode } from 'react';
import { create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useOwnerReschedule } from '@/hooks/use-owner-reschedule';
import { apiFetch, ApiError } from '@/lib/client/api';
import type { OwnerRescheduleEntry } from '@/lib/owner-rescheduling';
import { ownerRescheduleBusiness as business, ownerRescheduleSource as original, ownerRescheduleView as view, ownerRescheduleResult as proof, ownerRescheduleNow as now, ownerRescheduleSelection as target } from './owner-rescheduling-contract';

const auth = vi.hoisted(() => ({ user: { uid: 'demo-owner' } as { uid: string } | null, authEpoch: 1, isCurrentSession: (uid: string, epoch: number) => auth.user?.uid === uid && auth.authEpoch === epoch, invalidateSession: vi.fn() }));
vi.mock('@/components/auth-provider', () => ({ useAuth: () => auth }));
vi.mock('@/lib/client/api', async original => ({ ...await original<typeof import('@/lib/client/api')>(), apiFetch: vi.fn() }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
export const source = { appointment: original, expectation: { sourceRevision: 0, sourceFingerprint: 'a'.repeat(64) }, eligible: true, reason: null };
export const moved = { ...original, ...target, endTimeStr: '10:30', startAt: proof.startAt, endAt: proof.endAt, reservedUntilAt: view.target.reservedUntilAt, rescheduleRevision: 1, lastRescheduleProposalId: view.id, rescheduledAt: now };
let renderer: ReactTestRenderer | undefined, controller!: ReturnType<typeof useOwnerReschedule>, proposal = { ...view };
type Props = { entry?: OwnerRescheduleEntry; enabled?: boolean; ownerUid?: string; authEpoch?: number; businessId?: string };
function Harness({ entry = { appointmentId: original.id }, enabled = true, ownerUid = 'demo-owner', authEpoch = 1, businessId = business.id }: Props) { controller = useOwnerReschedule({ entry, enabled, ownerUid, authEpoch, businessId, business }); return null; }
const deferred = <T,>() => { let resolve!: (value: T) => void, reject!: (error: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
async function mount(props: Props = {}) { await act(async () => { renderer = create(createElement(Harness, props)); }); }
async function ready() { await act(async () => controller.setSelection({ ...target, startTimeStr: '' })); await act(async () => controller.loadAvailability()); await act(async () => controller.setSelection(target)); }
async function prepare() { await ready(); await act(async () => controller.prepare()); }
const writes = () => vi.mocked(apiFetch).mock.calls.filter(call => /\/(proposals|confirm)$/.test(call[0]));
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(now); auth.user = { uid: 'demo-owner' }; auth.authEpoch = 1; auth.invalidateSession.mockReset(); proposal = { ...view };
  vi.mocked(apiFetch).mockReset().mockImplementation(async (path, init) => {
    if (path.endsWith('/availability')) return { availability: [{ resourceId: 'demo-chair', resourceName: 'Profesional uno', slots: ['10:00', '11:00'] }, { resourceId: 'demo-second', resourceName: 'Profesional dos', slots: ['10:00'] }] };
    if (path.endsWith('/proposals')) { const body = JSON.parse(init!.body as string); proposal = { ...view, requestId: body.requestId }; return { proposal }; }
    if (path.endsWith('/confirm')) return { appointment: moved, rescheduleResult: proof, replayed: false };
    if (path.includes('/owner-reschedule-proposals/')) return { proposal, appointment: original, state: 'prepared', result: null };
    return source;
  });
});
afterEach(async () => { await act(async () => renderer?.unmount()); renderer = undefined; vi.useRealTimers(); });

it('development StrictMode remounts the initial read without leaving a canceled flow', async () => {
  await act(async () => { renderer = create(createElement(StrictMode, null, createElement(Harness))); });
  expect(controller.source?.appointment.id).toBe(original.id); expect(controller.stage).toBe('selection'); expect(controller.busy).toBe(false);
});

it('samePrepareBodySurvivesLostResponse', async () => {
  await mount(); await ready(); const impl = vi.mocked(apiFetch).getMockImplementation()!;
  vi.mocked(apiFetch).mockRejectedValueOnce(new Error('Respuesta perdida')); await act(async () => controller.prepare()); const first = writes()[0];
  expect(controller.frozen).toBe(true); await act(async () => { controller.setSelection({ ...target, startTimeStr: '11:00' }); await controller.loadAvailability(); });
  expect(controller.selection).toEqual(target); vi.mocked(apiFetch).mockImplementation(impl); await act(async () => controller.prepare());
  expect(writes()).toHaveLength(2); expect(writes()[1][0]).toBe(first[0]); expect(writes()[1][1]?.body).toBe(first[1]?.body);
  expect(JSON.stringify(writes())).not.toMatch(/573001234567|intakeAnswers|beneficiary|actorUid/); expect(controller.stage).toBe('review');
});
it('sameConfirmationSurvivesTimeoutAndInvalidEnvelope', async () => {
  await mount(); await prepare(); vi.mocked(apiFetch).mockResolvedValueOnce({ appointment: moved });
  await act(async () => controller.confirm()); expect(controller.uncertain).toBe(true); const first = writes().at(-1)!;
  await act(async () => controller.confirm()); const last = writes().at(-1)!;
  expect(last[0]).toBe(first[0]); expect(last[1]?.body).toBe('{"confirm":true}'); expect(controller.recovery).toMatchObject({ state: 'applied', result: proof });
});
it('expiredPreparedGetDoesNotUnlockUncertainConfirmation', async () => {
  await mount(); await prepare(); vi.mocked(apiFetch).mockRejectedValueOnce(new Error('Respuesta perdida')); await act(async () => controller.confirm());
  vi.setSystemTime(now + 600001); await act(async () => controller.recover());
  expect(controller.recovery).toMatchObject({ state: 'prepared' }); expect(controller.uncertain).toBe(true); expect(controller.canClose).toBe(false);
  await act(async () => controller.loadSource()); expect(controller.proposal?.id).toBe(view.id); expect(writes()).toHaveLength(2);
});
it('samePostClosesExpiredProposalDurably', async () => {
  await mount(); await prepare(); vi.mocked(apiFetch).mockRejectedValueOnce(new Error('Respuesta perdida')); await act(async () => controller.confirm());
  const body = writes().at(-1)![1]?.body; vi.setSystemTime(now + 600001);
  vi.mocked(apiFetch).mockRejectedValueOnce(new ApiError('Propuesta cerrada', 409, 'OWNER_RESCHEDULE_PROPOSAL_CLOSED')); await act(async () => controller.confirm());
  expect(writes().at(-1)![1]?.body).toBe(body); expect(controller.uncertain).toBe(true);
  vi.mocked(apiFetch).mockResolvedValueOnce({ proposal, appointment: original, state: 'closed', result: null }); await act(async () => controller.recover());
  expect(controller.stage).toBe('result'); expect(controller.uncertain).toBe(false); expect(controller.canClose).toBe(true);
});
it('recoveryAfterReloadDoesNotPost', async () => {
  await mount({ entry: { proposalId: view.id } }); expect(writes()).toHaveLength(0); expect(controller.proposal?.id).toBe(view.id);
  expect(vi.mocked(apiFetch).mock.calls[0][0]).toBe(`/api/businesses/${business.id}/owner-reschedule-proposals/${view.id}`);
});
it('laterCurrentAppointmentDoesNotEraseOriginalProof', async () => {
  const later = { ...original, rescheduleRevision: 2, status: 'cancelled_by_owner' };
  vi.mocked(apiFetch).mockResolvedValueOnce({ proposal: view, state: 'applied', appointment: later, result: proof }); await mount({ entry: { proposalId: view.id } });
  expect(controller.recovery).toMatchObject({ appointment: { startTimeStr: '09:00', rescheduleRevision: 2 }, result: { startTimeStr: '10:00', revision: 1 } });
});
it('ownParentLockDoesNotAbortRequest', async () => {
  await mount(); await prepare(); const pending = deferred<unknown>(); vi.mocked(apiFetch).mockReturnValueOnce(pending.promise);
  let request!: Promise<void>; await act(async () => { request = controller.confirm(); }); const call = writes().at(-1)!;
  await act(async () => renderer!.update(createElement(Harness, { enabled: false })));
  expect(call[1]?.signal?.aborted).toBe(false); expect(call[3]?.()).toBe(true);
  await act(async () => pending.resolve({ appointment: moved, rescheduleResult: proof, replayed: false })); await request;
  await act(async () => renderer!.update(createElement(Harness)));
  expect(controller.stage).toBe('result'); expect(controller.recovery?.result).toEqual(proof);
});
it('scopeChangeRejectsLateSourceAndMutation', async () => {
  const pending = deferred<unknown>(); vi.mocked(apiFetch).mockReturnValueOnce(pending.promise); await mount(); const sourceCall = vi.mocked(apiFetch).mock.calls[0];
  auth.authEpoch = 2; await act(async () => renderer!.update(createElement(Harness, { authEpoch: 2 })));
  expect(sourceCall[1]?.signal?.aborted).toBe(true); expect(sourceCall[3]?.()).toBe(false);
  await act(async () => pending.resolve(source)); expect(controller.source?.appointment.id).toBe(original.id);
  await prepare(); const writing = deferred<unknown>(); vi.mocked(apiFetch).mockReturnValueOnce(writing.promise);
  let request!: Promise<void>; await act(async () => { request = controller.confirm(); }); const call = writes().at(-1)!;
  auth.user = { uid: 'demo-other' }; auth.authEpoch = 3; await act(async () => renderer!.update(createElement(Harness, { ownerUid: 'demo-other', authEpoch: 3, businessId: 'demo-other-business' })));
  expect(call[3]?.()).toBe(false); await act(async () => writing.resolve({ appointment: moved, rescheduleResult: proof, replayed: false })); await request;
  expect(controller.recovery).toBe(null); expect(controller.source).toBe(null);
});
it('readDeadlineIsTenSeconds', async () => {
  const pending = deferred<unknown>(); vi.mocked(apiFetch).mockReturnValueOnce(pending.promise); await mount(); const call = vi.mocked(apiFetch).mock.calls[0];
  await act(async () => vi.advanceTimersByTimeAsync(10000)); expect(controller.busy).toBe(false); expect(controller.error).toBeTruthy(); expect(call[1]?.signal?.aborted).toBe(true);
  await act(async () => pending.resolve(source)); expect(controller.source).toBe(null); expect(vi.getTimerCount()).toBe(0);
});
it('mutationOnlyWarnsAfterTwentySeconds', async () => {
  await mount(); await prepare(); const pending = deferred<unknown>(); vi.mocked(apiFetch).mockReturnValueOnce(pending.promise);
  let request!: Promise<void>; await act(async () => { request = controller.confirm(); }); const call = writes().at(-1)!;
  await act(async () => vi.advanceTimersByTimeAsync(20000)); expect(call[1]?.signal?.aborted).toBe(false); expect(controller.busy).toBe(true); expect(controller.uncertain).toBe(true);
  await act(async () => pending.reject(new ApiError('Restricción posterior', 402))); await request; expect(controller.uncertain).toBe(true);
});
it('pendingPostCanBeInspectedButPreparedGetDoesNotAllowSecondPost', async () => {
  await mount(); await prepare(); const pending = deferred<unknown>(); vi.mocked(apiFetch).mockReturnValueOnce(pending.promise);
  let request!: Promise<void>; await act(async () => { request = controller.confirm(); }); const call = writes().at(-1)!;
  await act(async () => controller.recover()); await act(async () => controller.confirm()); expect(writes()).toHaveLength(2);
  expect(call[1]?.signal?.aborted).toBe(false); await act(async () => pending.resolve({ appointment: moved, rescheduleResult: proof, replayed: false })); await request;
});
it('proofInvalidatesLatePostPublication', async () => {
  await mount(); await prepare(); const pending = deferred<unknown>(); vi.mocked(apiFetch).mockReturnValueOnce(pending.promise);
  let request!: Promise<void>; await act(async () => { request = controller.confirm(); });
  vi.mocked(apiFetch).mockResolvedValueOnce({ proposal, state: 'applied', appointment: moved, result: proof }); await act(async () => controller.recover());
  expect(controller.stage).toBe('result'); expect(controller.busy).toBe(false);
  await act(async () => pending.reject(new Error('Respuesta tardía'))); await request; expect(controller.stage).toBe('result'); expect(controller.error).toBe(null);
});
it.each(['prepared', 'error'] as const)('appliedPostInvalidatesOlderRecovery (%s)', async outcome => {
  await mount(); await prepare(); const post = deferred<unknown>(), reading = deferred<unknown>();
  vi.mocked(apiFetch).mockReturnValueOnce(post.promise); let writing!: Promise<void>;
  await act(async () => { writing = controller.confirm(); });
  vi.mocked(apiFetch).mockReturnValueOnce(reading.promise); let checking!: Promise<void>;
  await act(async () => { checking = controller.recover(); });
  await act(async () => post.resolve({ appointment: moved, rescheduleResult: proof, replayed: false })); await writing;
  expect(controller.stage).toBe('result');
  await act(async () => outcome === 'prepared' ? reading.resolve({ proposal, state: 'prepared', appointment: original, result: null }) : reading.reject(new Error('Old GET failed'))); await checking;
  expect(controller.stage).toBe('result'); expect(controller.recovery?.state).toBe('applied'); expect(controller.error).toBe(null); expect(controller.busy).toBe(false);
});
it('unknownUrlRecoveryRetainsItsBarrierBeforeAnyResponse', async () => {
  const reading = deferred<unknown>(); vi.mocked(apiFetch).mockReturnValueOnce(reading.promise);
  await mount({ entry: { proposalId: view.id } }); expect(controller.canClose).toBe(false); expect(controller.uncertain).toBe(true);
  await act(async () => reading.reject(new Error('Network failed'))); expect(controller.canClose).toBe(false); expect(writes()).toHaveLength(0);
});
it('a first definite rejection can restart while an uncertain confirmation retains its tuple', async () => {
  await mount(); await prepare(); vi.mocked(apiFetch).mockRejectedValueOnce(new ApiError('Origen cambió', 409, 'OWNER_RESCHEDULE_SOURCE_CHANGED')); await act(async () => controller.confirm());
  expect(controller.uncertain).toBe(false); expect(controller.canRestart).toBe(true); await act(async () => controller.loadSource()); expect(controller.frozen).toBe(false); expect(controller.proposal).toBe(null);
});
