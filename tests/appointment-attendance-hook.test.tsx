import { act, createElement, StrictMode } from 'react';
import { create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppointmentAttendance, type AttendanceScope } from '@/hooks/use-appointment-attendance';
import { apiFetch, ApiError } from '@/lib/client/api';
import type { Appointment } from '@/types/firestore';

vi.mock('@/lib/client/api', async original => ({ ...await original<typeof import('@/lib/client/api')>(), apiFetch: vi.fn() }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const appointment: Appointment = { id: 'one', tenantId: 'business', dateKey: '2030-01-07', resourceId: 'chair', startAt: 1894024800000, endAt: 1894026600000, reservedUntilAt: 1894027500000, startTimeStr: '09:00', endTimeStr: '09:30', type: 'appointment', status: 'confirmed', createdAt: 1, createdBy: 'sarin_client' };
const scope: AttendanceScope = { businessId: 'business', ownerUid: 'owner', appointmentId: 'one', dateKey: appointment.dateKey };
const eventId = 'a'.repeat(64);
function receipt(requestId: string, current: Appointment = { ...appointment, status: 'completed', attendance: { revision: 1, lastEventId: eventId } }) { return { appointment: current, applied: { eventId, requestId, revision: 1, status: 'completed', recordedAt: appointment.reservedUntilAt }, replayed: false }; }
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (value: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
type Input = Parameters<typeof useAppointmentAttendance>[0];
let state: ReturnType<typeof useAppointmentAttendance>, renders: typeof state[], tree: ReactTestRenderer | undefined;
const input: Input = { appointment, scope, enabled: true };
function Consumer(props: Input) { state = useAppointmentAttendance(props); renders.push(state); return null; }
const mount = async (props = input) => { await act(async () => { tree = create(createElement(Consumer, props)); }); };
const update = async (props: Input) => { await act(async () => tree!.update(createElement(Consumer, props))); };
const submit = async () => { await act(async () => { void state.submit('completed'); }); };
const history = { appointment, events: [], nextBeforeRevision: null };
function event(sequence: number) { return { schemaVersion: 1, businessId: scope.businessId, appointmentId: scope.appointmentId, actorUid: 'owner', requestId: `request-${sequence}`, requestFingerprint: eventId, sequence, previousStatus: sequence === 1 ? 'confirmed' : sequence % 2 ? 'no_show' : 'completed', status: sequence % 2 ? 'completed' : 'no_show', recordedAt: appointment.reservedUntilAt + sequence, reason: sequence === 1 ? 'initial' : 'recording_error', legacyPreviousOutcome: false, source: { dateKey: appointment.dateKey, resourceId: appointment.resourceId, startAt: appointment.startAt, endAt: appointment.endAt, reservedUntilAt: appointment.reservedUntilAt, rescheduleRevision: 0 } }; }
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(appointment.reservedUntilAt); renders = []; vi.mocked(apiFetch).mockReset(); });
afterEach(async () => { await act(async () => tree?.unmount()); tree = undefined; vi.useRealTimers(); });

describe('attendance commands and private reads', () => {
  it.each([
    ['explicit', false], ['explicit', true], ['inflight', false], ['inflight', true],
  ] as const)('successful %s history keeps the exact unknown command (newer=%s)', async (timing, newer) => {
    const read = deferred<unknown>();
    const write = deferred<unknown>();
    vi.mocked(apiFetch).mockImplementation((_path, init) => init?.method ? write.promise : read.promise);
    await mount();
    if (timing === 'inflight') await act(async () => { void state.loadHistory(); });
    await submit();
    const original = vi.mocked(apiFetch).mock.calls.find(call => call[1]?.method)!;
    const command = JSON.parse(String(original[1]?.body));
    await act(async () => write.reject(new Error('lost response')));
    if (timing === 'explicit') await act(async () => { void state.loadHistory(); });
    const current = newer ? { ...appointment, status: 'completed' as const, attendance: { revision: 1, lastEventId: eventId } } : appointment;
    await act(async () => read.resolve({ appointment: current, events: newer ? [event(1)] : [], nextBeforeRevision: null }));
    expect(state.history?.appointment).toEqual(current);
    expect(state.error).toContain('desconocido');
    const calls = vi.mocked(apiFetch).mock.calls.length;
    await act(async () => state.submit('no_show', newer ? 'recording_error' : undefined));
    expect(apiFetch).toHaveBeenCalledTimes(calls);
    vi.mocked(apiFetch).mockResolvedValue({ ...receipt(command.requestId), replayed: true });
    await act(async () => state.retryPending());
    expect(vi.mocked(apiFetch).mock.calls.at(-1)?.[1]?.body).toBe(original[1]?.body);
    expect(state.result?.applied.requestId).toBe(command.requestId);
    expect(state.error).toBeNull();
  });
  it('history after a write deadline does not resolve the unknown receipt', async () => {
    vi.mocked(apiFetch).mockImplementation((_path, init) => init?.method ? new Promise(() => {}) : Promise.resolve(history));
    await mount(); await submit();
    const body = vi.mocked(apiFetch).mock.calls[0][1]?.body;
    await act(async () => vi.advanceTimersByTimeAsync(20_000));
    await act(async () => state.loadHistory());
    expect(state.error).toContain('desconocido');
    vi.mocked(apiFetch).mockResolvedValue({ ...receipt(JSON.parse(String(body)).requestId), replayed: true });
    await act(async () => state.retryPending());
    expect(vi.mocked(apiFetch).mock.calls.at(-1)?.[1]?.body).toBe(body);
  });
  it('a delayed receipt keeps a newer representation revision with the same attendance revision', async () => {
    const pending = deferred<unknown>();
    const representationReview = { revision: 1, status: 'reviewed' as const, reviewedBy: 'owner', reviewedAt: appointment.reservedUntilAt + 1 };
    vi.mocked(apiFetch).mockReturnValue(pending.promise);
    await mount(); await submit();
    const command = JSON.parse(String(vi.mocked(apiFetch).mock.calls[0][1]?.body));
    const known = { ...receipt(command.requestId).appointment, representationReview };
    await update({ ...input, appointment: known });
    await act(async () => pending.resolve(receipt(command.requestId)));
    expect(state.result?.appointment.representationReview).toEqual(representationReview);
    expect(state.result?.appointment.attendance?.revision).toBe(1);
  });
  it('strictEffectReplayKeepsTheCurrentScopeUsable', async () => { vi.mocked(apiFetch).mockResolvedValue(history); await act(async () => { tree = create(createElement(StrictMode, null, createElement(Consumer, input))); }); await act(async () => state.loadHistory()); expect(state.history).toEqual(history); });
  it('historyInitiallyClosedAndFetchesOnlyOnOpen', async () => { await mount(); expect(apiFetch).not.toHaveBeenCalled(); vi.mocked(apiFetch).mockResolvedValue(history); await act(async () => state.loadHistory()); expect(state.history).toEqual(history); expect(apiFetch).toHaveBeenCalledTimes(1); });
  it('unknownWriteKeepsExactCommandForManualRetry', async () => { vi.mocked(apiFetch).mockRejectedValue(new Error('network')); await mount(); await submit(); const call = vi.mocked(apiFetch).mock.calls[0]; expect(state.error).toContain('desconocido'); await act(async () => state.submit('no_show')); expect(apiFetch).toHaveBeenCalledTimes(1); vi.mocked(apiFetch).mockResolvedValue(receipt(JSON.parse(String(call[1]?.body)).requestId)); await act(async () => state.retryPending()); expect(vi.mocked(apiFetch).mock.calls[1][1]?.body).toBe(call[1]?.body); expect(state.result?.applied.status).toBe('completed'); });
  it('newRevisionKeepsAlreadySentUnknownCommand', async () => { vi.mocked(apiFetch).mockRejectedValue(new Error('lost')); await mount(); await submit(); const body = vi.mocked(apiFetch).mock.calls[0][1]?.body; await update({ ...input, appointment: { ...appointment, status: 'no_show', attendance: { revision: 2, lastEventId: 'b'.repeat(64) } } }); await act(async () => state.retryPending()); expect(vi.mocked(apiFetch).mock.calls[1][1]?.body).toBe(body); });
  it('aDelayedReceiptNeverReplacesANewerKnownCorrection', async () => { const pending = deferred<unknown>(); vi.mocked(apiFetch).mockReturnValue(pending.promise); await mount(); await submit(); const command = JSON.parse(String(vi.mocked(apiFetch).mock.calls[0][1]?.body)); const corrected = { ...appointment, status: 'no_show' as const, attendance: { revision: 2, lastEventId: 'b'.repeat(64) } }; await update({ ...input, appointment: corrected }); await act(async () => pending.resolve(receipt(command.requestId))); expect(state.result?.applied.status).toBe('completed'); expect(state.result?.appointment).toEqual(corrected); });
  it('replayAfterCorrectionShowsAppliedAndCurrent', async () => { vi.mocked(apiFetch).mockRejectedValueOnce(new Error('lost')).mockImplementation(async (_path, init) => ({ ...receipt(JSON.parse(String(init?.body)).requestId, { ...appointment, status: 'no_show', attendance: { revision: 2, lastEventId: 'b'.repeat(64) } }), replayed: true })); await mount(); await submit(); await act(async () => state.retryPending()); expect(state.result?.appointment.status).toBe('no_show'); expect(state.result?.applied.status).toBe('completed'); });
  it('conflictClearsDraftAndRequiresRefresh', async () => { vi.mocked(apiFetch).mockRejectedValue(new ApiError('changed', 409, 'ATTENDANCE_SOURCE_CHANGED')); await mount(); await submit(); await act(async () => state.submit('no_show')); await act(async () => state.retryPending()); expect(apiFetch).toHaveBeenCalledTimes(1); vi.mocked(apiFetch).mockResolvedValue(history); await act(async () => state.loadHistory()); vi.mocked(apiFetch).mockRejectedValue(new Error('network')); await submit(); expect(apiFetch).toHaveBeenCalledTimes(3); });
  it.each(['ownerUid', 'businessId', 'dateKey', 'appointmentId'] as const)('scopeChangeMasksStateBeforeEffects %s', async field => { vi.mocked(apiFetch).mockResolvedValue(history); await mount(); await act(async () => state.loadHistory()); const start = renders.length; await update({ ...input, scope: { ...scope, [field]: 'other' } }); expect(renders[start].history).toBeNull(); expect(renders[start].result).toBeNull(); });
  it.each(['ownerUid', 'businessId', 'dateKey'] as const)('lateWriteAndLateHistoryCannotCrossAccountBusinessOrDay %s', async field => { const pending = deferred<unknown>(); vi.mocked(apiFetch).mockReturnValue(pending.promise); await mount(); await act(async () => { void state.loadHistory(); }); await submit(); const calls = [...vi.mocked(apiFetch).mock.calls]; await update({ ...input, scope: { ...scope, [field]: 'other' } }); for (const call of calls) { expect(call[1]?.signal?.aborted).toBe(true); expect(call[3]?.()).toBe(false); } await act(async () => pending.resolve(history)); expect(state.history).toBeNull(); expect(state.result).toBeNull(); });
  it.each([{ applied: { eventId: 'bad' } }, { appointment: { ...appointment, tenantId: 'foreign' } }, { appointment: { ...appointment, dateKey: '2030-01-08' } }, { applied: { requestId: 'wrong' } }, { replayed: 'true' }])('failedWriteNeverPublishesMalformedResult %j', async changed => { vi.mocked(apiFetch).mockImplementation(async (_path, init) => { const valid = receipt(JSON.parse(String(init?.body)).requestId); return { ...valid, ...changed, applied: { ...valid.applied, ...('applied' in changed ? changed.applied : {}) } }; }); await mount(); await submit(); expect(state.result).toBeNull(); expect(state.error).toContain('desconocido'); });
  it('readDeadlineTenSeconds', async () => { vi.mocked(apiFetch).mockReturnValue(new Promise(() => {})); await mount(); await act(async () => { void state.loadHistory(); }); await act(async () => vi.advanceTimersByTimeAsync(9999)); expect(state.historyLoading).toBe(true); await act(async () => vi.advanceTimersByTimeAsync(1)); expect(state.historyLoading).toBe(false); expect(state.historyError).toContain('demasiado'); expect(vi.mocked(apiFetch).mock.calls[0][1]?.signal?.aborted).toBe(true); });
  it('writeDeadlineTwentySecondsKeepsUnknownReceipt', async () => { vi.mocked(apiFetch).mockReturnValue(new Promise(() => {})); await mount(); await submit(); await act(async () => vi.advanceTimersByTimeAsync(19999)); expect(state.busy).toBe(true); await act(async () => vi.advanceTimersByTimeAsync(1)); expect(state.busy).toBe(false); expect(state.error).toContain('desconocido'); const body = vi.mocked(apiFetch).mock.calls[0][1]?.body; await act(async () => { void state.retryPending(); }); expect(vi.mocked(apiFetch).mock.calls[1][1]?.body).toBe(body); });
  it('cleansDeadlineResources', async () => { vi.mocked(apiFetch).mockResolvedValue(history); const remove = vi.spyOn(AbortSignal.prototype, 'removeEventListener'); await mount(); await act(async () => state.loadHistory()); expect(vi.getTimerCount()).toBe(0); expect(remove).toHaveBeenCalledWith('abort', expect.any(Function)); });
  it.each([401, 403])('authorizationHeadersImmediatelyMaskHistory %s', async status => { vi.mocked(apiFetch).mockResolvedValue(history); await mount(); await act(async () => state.loadHistory()); vi.mocked(apiFetch).mockImplementation((_p, _i, _u, _c, onStatus) => { onStatus?.(status); return new Promise(() => {}); }); await act(async () => { void state.loadHistory(); }); expect(state.history).toBeNull(); expect(state.historyError).not.toBeNull(); });
  it('saveInvalidatesLatePriorHistory', async () => { const read = deferred<unknown>(); vi.mocked(apiFetch).mockImplementation(async (_path, init) => init?.method ? receipt(JSON.parse(String(init.body)).requestId) : read.promise); await mount(); await act(async () => { void state.loadHistory(); }); await submit(); expect(state.result).not.toBeNull(); await act(async () => read.resolve(history)); expect(state.history).toBeNull(); });
  it('paginatesOnlyExplicitContiguousHistory', async () => { const current = { ...appointment, status: 'completed', attendance: { revision: 21, lastEventId: eventId } }; vi.mocked(apiFetch).mockResolvedValueOnce({ appointment: current, events: Array.from({ length: 20 }, (_, index) => event(21 - index)), nextBeforeRevision: 2 }).mockResolvedValueOnce({ appointment: current, events: [event(1)], nextBeforeRevision: null }); await mount(); await act(async () => state.loadHistory()); expect(state.history?.events).toHaveLength(20); await act(async () => state.loadHistory(2)); expect(state.history?.events).toHaveLength(21); expect(vi.mocked(apiFetch).mock.calls[1][0]).toContain('?beforeRevision=2'); });
  it.each(['sequence', 'businessId', 'appointmentId', 'date', 'resource', 'headStatus'] as const)('rejectsMalformedOrUnrelatedHistory %s', async field => { const bad = { ...event(1), ...(field === 'sequence' ? { sequence: 2 } : field === 'date' ? { source: { ...event(1).source, dateKey: '2030-01-08' } } : field === 'resource' ? { source: { ...event(1).source, resourceId: 'other-resource' } } : field !== 'headStatus' ? { [field]: 'foreign' } : {}) }; vi.mocked(apiFetch).mockResolvedValue({ appointment: { ...appointment, status: field === 'headStatus' ? 'no_show' : 'completed', attendance: { revision: 1, lastEventId: eventId } }, events: [bad], nextBeforeRevision: null }); await mount(); await act(async () => state.loadHistory()); expect(state.history).toBeNull(); expect(state.historyError).not.toBeNull(); });
  it('successfulWriteCleansTimersAndPreventsDuplicateConfirmations', async () => { const pending = deferred<unknown>(); vi.mocked(apiFetch).mockReturnValue(pending.promise); await mount(); await submit(); await act(async () => { void state.submit('no_show'); void state.retryPending(); }); expect(apiFetch).toHaveBeenCalledTimes(1); const requestId = JSON.parse(String(vi.mocked(apiFetch).mock.calls[0][1]?.body)).requestId; await act(async () => pending.resolve(receipt(requestId))); expect(state.result).not.toBeNull(); expect(vi.getTimerCount()).toBe(0); });
  it('ignoresLateRejectedWriteAfterLocalDeadline', async () => { const pending = deferred<unknown>(); vi.mocked(apiFetch).mockReturnValue(pending.promise); await mount(); await submit(); await act(async () => vi.advanceTimersByTimeAsync(20_000)); const error = state.error; await act(async () => pending.reject(new Error('late private response'))); expect(state.error).toBe(error); expect(state.result).toBeNull(); });
});
