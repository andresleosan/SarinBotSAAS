import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { create } from 'react-test-renderer';
import { useOwnerAgenda } from '@/hooks/use-owner-agenda';
import { apiFetch, ApiError } from '@/lib/client/api';
import type { Appointment } from '@/types/firestore';
import type { OwnerAgendaRange } from '@/lib/owner-agenda';

vi.mock('@/lib/client/api', async importOriginal => ({ ...await importOriginal<typeof import('@/lib/client/api')>(), apiFetch: vi.fn() }));
vi.mock('@/lib/firebase/client', () => ({ getFirebaseClient: () => ({ auth: { currentUser: { uid: 'owner', getIdToken: async () => 'synthetic-token' } } }) }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const date = '2026-10-19';
const nextDate = '2026-10-20';
const range: OwnerAgendaRange = { selectedDate: date, dates: [date], queryDates: [date], outsideDates: [] };
const appointment: Appointment = { id: 'one', tenantId: 'business', dateKey: date, startAt: 1, endAt: 2, reservedUntilAt: 3, startTimeStr: '09:00', endTimeStr: '09:30', type: 'appointment', resourceId: 'resource', status: 'confirmed', createdBy: 'sarin_client', createdAt: 1 };
type Input = Parameters<typeof useOwnerAgenda>[0] & { resource?: string };
let state: ReturnType<typeof useOwnerAgenda>;
let renders: Array<ReturnType<typeof useOwnerAgenda>>;
let tree: ReturnType<typeof create> | undefined;
let page: EventTarget & { visibilityState: string };
let browser: EventTarget;
const input: Input = { businessId: 'business', ownerUid: 'owner', range, enabled: true };
function Consumer(props: Input) { state = useOwnerAgenda(props); renders.push(state); return createElement('span', null, state.snapshot?.checkedAt); }
const mount = async (props: Input = input) => { await act(async () => { tree = create(createElement(Consumer, props)); }); };
const update = async (props: Input) => { await act(async () => { tree!.update(createElement(Consumer, props)); }); };
const advance = async (ms: number) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };

beforeEach(() => {
  vi.useFakeTimers(); renders = [];
  page = Object.assign(new EventTarget(), { visibilityState: 'visible' }); browser = new EventTarget();
  vi.stubGlobal('document', page); vi.stubGlobal('window', browser);
  vi.mocked(apiFetch).mockReset().mockResolvedValue({ appointments: [appointment] });
});
afterEach(async () => { if (tree) await act(async () => tree!.unmount()); tree = undefined; vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('owner agenda scoped hook', () => {
  it('doesNotRefetchForResourceSelection', async () => {
    await mount(); expect(state.snapshot?.days[0]).toMatchObject({ state: 'ready' });
    await update({ ...input, resource: 'another-resource', range: { ...range } });
    expect(apiFetch).toHaveBeenCalledTimes(1);
  });

  it('does not refetch for selectedDate within the same week', async () => {
    vi.mocked(apiFetch).mockResolvedValue({ appointments: [] });
    const week = { ...range, dates: [date, nextDate], queryDates: [date, nextDate] };
    await mount({ ...input, range: week });
    await update({ ...input, range: { ...week, selectedDate: nextDate } });
    expect(apiFetch).toHaveBeenCalledTimes(2);
  });

  it.each(['queryDates', 'outsideDates', 'dates'] as const)('range scope includes %s', async field => {
    vi.mocked(apiFetch).mockResolvedValue({ appointments: [] });
    await mount(); const prior = vi.mocked(apiFetch).mock.calls.length;
    await update({ ...input, range: { ...range, [field]: field === 'queryDates' ? [] : [date, nextDate] } });
    expect(renders.slice(-2).some(render => render.snapshot === null)).toBe(true);
    if (field !== 'queryDates') expect(vi.mocked(apiFetch).mock.calls.length).toBeGreaterThan(prior);
    else expect(state.snapshot?.days[0].state).not.toBe('ready');
  });

  it('rangeSwitchMasksPreviousDuringRender', async () => {
    await mount(); expect(state.snapshot).not.toBeNull();
    vi.mocked(apiFetch).mockImplementation(() => new Promise(() => {}));
    const first = renders.length;
    await update({ ...input, range: { selectedDate: nextDate, dates: [nextDate], queryDates: [nextDate], outsideDates: [] } });
    expect(renders[first].snapshot).toBeNull(); expect(state.snapshot).toBeNull(); expect(state.loading).toBe(true);
  });

  it('accountSwitchRejectsLateResponse', async () => {
    let finish!: (value: unknown) => void;
    vi.mocked(apiFetch).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    await mount(); const predicate = vi.mocked(apiFetch).mock.calls[0][3]!;
    await update({ ...input, ownerUid: 'other-owner' });
    expect(predicate()).toBe(false); expect(vi.mocked(apiFetch).mock.calls[0][1]?.signal?.aborted).toBe(true);
    await act(async () => finish({ appointments: [{ ...appointment, id: 'late-private' }] }));
    expect(state.snapshot?.days[0]).toMatchObject({ state: 'ready', appointments: [{ id: 'one' }] });
    expect(apiFetch).toHaveBeenLastCalledWith(expect.any(String), expect.anything(), 'other-owner', expect.any(Function), expect.any(Function));
  });

  it('business switch masks previous values and rejects stale callbacks', async () => {
    await mount(); const replace = state.replaceAppointment;
    vi.mocked(apiFetch).mockImplementation(() => new Promise(() => {}));
    const first = renders.length; await update({ ...input, businessId: 'another-business' });
    expect(renders[first].snapshot).toBeNull();
    await act(async () => replace({ ...appointment, status: 'cancelled_by_owner' }));
    expect(state.snapshot).toBeNull();
  });

  it.each([{ enabled: false }, { ownerUid: null }, { businessId: null }, { range: null }])('null scope hides and does not read: %j', async changed => {
    await mount({ ...input, ...changed }); expect(apiFetch).not.toHaveBeenCalled(); expect(state.snapshot).toBeNull(); expect(state.loading).toBe(false);
  });

  it('hiddenPageStopsReads', async () => {
    vi.mocked(apiFetch).mockImplementation(() => new Promise(() => {}));
    await mount(); const signal = vi.mocked(apiFetch).mock.calls[0][1]?.signal;
    await act(async () => { page.visibilityState = 'hidden'; page.dispatchEvent(new Event('visibilitychange')); });
    expect(signal?.aborted).toBe(true); await advance(60_000); expect(apiFetch).toHaveBeenCalledTimes(1);
    vi.mocked(apiFetch).mockResolvedValue({ appointments: [] });
    await act(async () => { page.visibilityState = 'visible'; page.dispatchEvent(new Event('visibilitychange')); });
    expect(apiFetch).toHaveBeenCalledTimes(2); expect(state.snapshot?.days[0]).toMatchObject({ state: 'ready' });
  });

  it('blur stops reads until focus resumes them', async () => {
    await mount(); await act(async () => browser.dispatchEvent(new Event('blur')));
    await advance(30_000); expect(apiFetch).toHaveBeenCalledTimes(1);
    await act(async () => browser.dispatchEvent(new Event('focus'))); expect(apiFetch).toHaveBeenCalledTimes(2);
  });

  it('refreshWaitsForPendingCycle', async () => {
    vi.mocked(apiFetch).mockImplementationOnce(() => new Promise(() => {}));
    await mount();
    const signal = vi.mocked(apiFetch).mock.calls[0][1]?.signal;
    act(() => { state.refresh(); state.refresh(); expect(apiFetch).toHaveBeenCalledTimes(1); });
    expect(signal?.aborted).toBe(true); await advance(0);
    expect(apiFetch).toHaveBeenCalledTimes(2); expect(state.snapshot?.days[0]).toMatchObject({ state: 'ready' });
    await advance(14_999); expect(apiFetch).toHaveBeenCalledTimes(2);
    await advance(1); expect(apiFetch).toHaveBeenCalledTimes(3);
  });

  it('replaceInvalidatesOldRepresentationRead', async () => {
    await mount();
    let finish!: (value: unknown) => void;
    vi.mocked(apiFetch).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    await act(async () => state.refresh());
    const saved = { ...appointment, representationReview: { reviewedAt: 9 } } as Appointment;
    await act(async () => state.replaceAppointment(saved));
    expect(vi.mocked(apiFetch).mock.calls[1][1]?.signal?.aborted).toBe(true);
    await act(async () => finish({ appointments: [appointment] }));
    expect(state.snapshot?.days[0]).toMatchObject({ state: 'ready', appointments: [saved] });
    expect(apiFetch).toHaveBeenCalledTimes(2);
  });

  it.each([{ id: 'new' }, { tenantId: 'foreign' }, { dateKey: nextDate }])('replacement never inserts or crosses business/date: %j', async changed => {
    await mount(); const original = state.snapshot;
    await act(async () => state.replaceAppointment({ ...appointment, ...changed }));
    expect(state.snapshot).toBe(original);
  });

  it('global authorization errors clear a previous confirmed snapshot', async () => {
    await mount(); vi.mocked(apiFetch).mockRejectedValueOnce(new ApiError('No autorizado', 403));
    await act(async () => state.refresh()); expect(state.snapshot).toBeNull(); expect(state.error).toBe('No autorizado');
  });

  it.each([401, 403])('real API authorization headers clear prior snapshot even when JSON stalls: %s', async status => {
    await mount(); expect(state.snapshot).not.toBeNull();
    const actual = await vi.importActual<typeof import('@/lib/client/api')>('@/lib/client/api');
    vi.mocked(apiFetch).mockImplementation(actual.apiFetch);
    let finishBody!: (body: unknown) => void;
    const json = () => new Promise<unknown>(resolve => { finishBody = resolve; });
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status, json, headers: new Headers() })));
    await act(async () => state.refresh());
    expect(state.snapshot).toBeNull(); expect(state.error).toBe(`No se pudo completar la solicitud (${status}).`);
    await act(async () => { finishBody({ appointments: [appointment], error: 'Late body' }); });
    expect(state.snapshot).toBeNull(); expect(state.error).toBe(`No se pudo completar la solicitud (${status}).`);
  });

  it('unmount releases poll timers and visibility/focus listeners', async () => {
    const removePage = vi.spyOn(page, 'removeEventListener'); const removeBrowser = vi.spyOn(browser, 'removeEventListener');
    await mount(); await act(async () => tree!.unmount()); tree = undefined;
    expect(vi.getTimerCount()).toBe(0);
    expect(removePage).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
    expect(removeBrowser).toHaveBeenCalledWith('focus', expect.any(Function));
    expect(removeBrowser).toHaveBeenCalledWith('blur', expect.any(Function));
  });
});
