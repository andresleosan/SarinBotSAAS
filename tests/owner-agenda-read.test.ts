import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as api from '@/lib/client/api';
import { readOwnerAgendaRange } from '@/lib/client/owner-agenda';
import type { OwnerAgendaRange } from '@/lib/owner-agenda';

const auth = vi.hoisted(() => ({ uid: 'owner', token: null as Promise<string> | null }));
vi.mock('@/lib/firebase/client', () => ({ getFirebaseClient: () => ({ auth: { currentUser: { uid: auth.uid, getIdToken: () => auth.token ?? Promise.resolve('synthetic-token') } } }) }));

const dates = ['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25'];
const week: OwnerAgendaRange = { selectedDate: dates[3], dates, queryDates: dates, outsideDates: [] };
const day: OwnerAgendaRange = { selectedDate: dates[0], dates: [dates[0]], queryDates: [dates[0]], outsideDates: [] };
const TIMEOUT = 'La consulta de este día tardó demasiado. Actualiza para intentarlo de nuevo';
const empty = () => new Response(JSON.stringify({ appointments: [] }));
const record = (dateKey = dates[0], id = 'historical') => ({ id, tenantId: 'business', dateKey, startAt: 'bad historical time', resourceId: 'deleted', status: 'old-status', privateFutureField: { retain: true } });
const read = (range = day, controller = new AbortController(), isCurrentScope = () => true) => readOwnerAgendaRange({ businessId: 'business', ownerUid: 'owner', range, signal: controller.signal, isCurrentScope });
const flush = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => {
  vi.useFakeTimers(); auth.uid = 'owner'; auth.token = null;
  vi.stubGlobal('fetch', vi.fn(async () => empty()));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('owner agenda bounded range reader', () => {
  it('readsAtMostSevenDatesWithTwoInFlight', async () => {
    let active = 0, maximum = 0;
    const releases: Array<() => void> = [];
    vi.mocked(fetch).mockImplementation(() => {
      active++; maximum = Math.max(maximum, active);
      return new Promise<Response>(resolve => releases.push(() => { active--; resolve(empty()); }));
    });
    const calls = vi.spyOn(api, 'apiFetch');
    const result = read(week); await flush();
    expect(fetch).toHaveBeenCalledTimes(2);
    for (let index = 0; index < 7; index++) { releases[index](); await flush(); }
    const snapshot = await result;
    expect(maximum).toBe(2); expect(calls).toHaveBeenCalledTimes(7);
    expect(calls.mock.calls.map(call => call[0])).toEqual(dates.map(date => `/api/businesses/business/appointments?date=${date}`));
    for (const [, init, uid, current] of calls.mock.calls) {
      expect(init?.signal).toBeInstanceOf(AbortSignal); expect(uid).toBe('owner'); expect(current?.()).toBe(true);
    }
    expect(snapshot.days).toEqual(dates.map(dateKey => ({ dateKey, state: 'ready', appointments: [] })));
    expect(snapshot.checkedAt).toBe(Date.now());
  });

  it('preserves all records and unknown historical fields without truncation', async () => {
    const appointments = Array.from({ length: 200 }, (_, index) => record(dates[0], String(index)));
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ appointments })));
    expect((await read()).days[0]).toEqual({ dateKey: dates[0], state: 'ready', appointments });
  });

  it('does not query dates outside the navigable range', async () => {
    const result = await read({ ...week, queryDates: dates.slice(0, 2), outsideDates: dates.slice(2) });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(result.days.slice(2)).toEqual(dates.slice(2).map(dateKey => ({ dateKey, state: 'outside' })));
  });

  it('oneDayFailureIsNotEmpty', async () => {
    vi.mocked(fetch).mockImplementation(async path => String(path).endsWith(dates[1]) ? new Response('{}', { status: 500 }) : empty());
    const result = await read(week);
    expect(result.days[1]).toEqual({ dateKey: dates[1], state: 'error', message: 'No pudimos cargar este día' });
    expect(result.days.filter(day => day.state === 'ready')).toHaveLength(6);
  });

  it.each([null, {}, { appointments: null }, { appointments: {} }, { appointments: [null] }, { appointments: [{ ...record(), id: ' ' }] }])('invalidEnvelopeRejectsDay: %j', async body => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify(body)));
    expect((await read()).days[0]).toMatchObject({ state: 'error', message: 'No pudimos cargar este día' });
  });

  it.each([{ tenantId: 'foreign' }, { dateKey: dates[1] }])('foreignTenantOrDateRejectsDay: %j', async changed => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ appointments: [record(), { ...record(), ...changed }] })));
    expect((await read()).days[0]).toMatchObject({ state: 'error' });
  });

  it('duplicate IDs across dates reject every affected day', async () => {
    vi.mocked(fetch).mockImplementation(async path => {
      const dateKey = String(path).split('=')[1];
      return new Response(JSON.stringify({ appointments: [record(dateKey)] }));
    });
    expect((await read(week)).days).toEqual(dates.map(dateKey => ({ dateKey, state: 'error', message: 'La agenda cambió; actualiza' })));
  });

  it.each([401, 403])('unauthorizedAbortsWholeCycle: %s', async status => {
    const signals: AbortSignal[] = [];
    vi.mocked(fetch).mockImplementation(async (_, init) => {
      signals.push(init!.signal!);
      return signals.length === 1 ? new Response('{}', { status }) : new Promise<Response>(() => {});
    });
    await expect(read(week)).rejects.toMatchObject({ status });
    expect(fetch).toHaveBeenCalledTimes(2); expect(signals.every(signal => signal.aborted)).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('abortStopsQueuedDates', async () => {
    const controller = new AbortController();
    vi.mocked(fetch).mockImplementation(() => new Promise<Response>(() => {}));
    const result = read(week, controller); const rejected = expect(result).rejects.toMatchObject({ name: 'AbortError' });
    await flush(); controller.abort(); await rejected;
    expect(fetch).toHaveBeenCalledTimes(2); expect(vi.getTimerCount()).toBe(0);
  });

  it('dailyDeadlineIsTenSeconds', async () => {
    vi.mocked(fetch).mockImplementation(() => new Promise<Response>(() => {}));
    let settled = false; const result = read().then(value => { settled = true; return value; });
    await vi.advanceTimersByTimeAsync(9_999); expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect((await result).days[0]).toEqual({ dateKey: dates[0], state: 'error', message: TIMEOUT });
    expect(vi.mocked(fetch).mock.calls[0][1]?.signal?.aborted).toBe(true);
  });

  it('timeoutIsPartialNotEmpty', async () => {
    vi.mocked(fetch).mockImplementation(async path => String(path).endsWith(dates[0]) ? new Promise<Response>(() => {}) : empty());
    const result = read(week); await vi.advanceTimersByTimeAsync(10_000);
    const snapshot = await result;
    expect(snapshot.days[0]).toMatchObject({ state: 'error', message: TIMEOUT });
    expect(snapshot.days.filter(day => day.state === 'ready')).toHaveLength(6);
  });

  it('sevenHungDaysFinishInFourWaves', async () => {
    let active = 0, maximum = 0;
    vi.mocked(fetch).mockImplementation((_, init) => {
      active++; maximum = Math.max(maximum, active);
      init!.signal!.addEventListener('abort', () => active--, { once: true });
      return new Promise<Response>(() => {});
    });
    let settled = false;
    const result = read(week).then(value => { settled = true; return value; });
    await vi.advanceTimersByTimeAsync(39_999); expect(settled).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(7);
    await vi.advanceTimersByTimeAsync(1);
    expect((await result).days.every(day => day.state === 'error')).toBe(true);
    expect(maximum).toBe(2); expect(active).toBe(0); expect(vi.getTimerCount()).toBe(0);
  });

  it('scopeAbortIsGlobalNotDailyTimeout', async () => {
    let current = true;
    vi.mocked(fetch).mockImplementation(async () => { current = false; return empty(); });
    await expect(read(week, new AbortController(), () => current)).rejects.toMatchObject({ status: 401, code: 'AUTH_IDENTITY_CHANGED' });
    // The second worker reaches apiFetch's identity check after the first fetch changed scope.
    expect(fetch).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
  });

  it('unauthorizedCancelsOtherDeadlines', async () => {
    let deny!: (response: Response) => void;
    vi.mocked(fetch).mockImplementationOnce(() => new Promise<Response>(resolve => { deny = resolve; })).mockImplementation(() => new Promise<Response>(() => {}));
    const result = read(week); const rejected = expect(result).rejects.toMatchObject({ status: 403 });
    await flush(); await vi.advanceTimersByTimeAsync(5_000);
    deny(new Response('{}', { status: 403 })); await rejected;
    expect(fetch).toHaveBeenCalledTimes(2); expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['token', 'json'])('deadlineCoversPendingTokenAndJson: %s', async boundary => {
    if (boundary === 'token') auth.token = new Promise<string>(() => {});
    else vi.mocked(fetch).mockResolvedValue({ ok: true, json: () => new Promise(() => {}) } as unknown as Response);
    const result = read(); await vi.advanceTimersByTimeAsync(10_000);
    expect((await result).days[0]).toMatchObject({ state: 'error', message: TIMEOUT });
    expect(fetch).toHaveBeenCalledTimes(boundary === 'token' ? 0 : 1); expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['resolve', 'reject'])('lateIgnoredAbortResultCannotPublish: %s', async outcome => {
    let finish!: (response: Response) => void, fail!: (error: Error) => void;
    vi.mocked(fetch).mockImplementation(() => new Promise<Response>((resolve, reject) => { finish = resolve; fail = reject; }));
    const publish = vi.fn(); const result = read().then(value => { publish(value); return value; });
    await vi.advanceTimersByTimeAsync(10_000); const snapshot = await result;
    if (outcome === 'resolve') finish(empty()); else fail(new Error('late rejection'));
    await flush(); expect(publish).toHaveBeenCalledExactlyOnceWith(snapshot);
    expect(snapshot.days[0]).toMatchObject({ state: 'error', message: TIMEOUT }); expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['ready', 'timeout', 'abort'])('timersAndListenersAreReleased: %s', async outcome => {
    const added = vi.spyOn(AbortSignal.prototype, 'addEventListener');
    const removed = vi.spyOn(AbortSignal.prototype, 'removeEventListener');
    if (outcome !== 'ready') vi.mocked(fetch).mockImplementation(() => new Promise<Response>(() => {}));
    const controller = new AbortController(); const result = read(day, controller);
    const observed = result.catch(error => error); await flush();
    if (outcome === 'abort') controller.abort();
    if (outcome === 'timeout') await vi.advanceTimersByTimeAsync(10_000);
    await observed;
    expect(vi.getTimerCount()).toBe(0);
    const listeners = added.mock.calls.filter(call => call[0] === 'abort').map(call => call[1]);
    const detached = removed.mock.calls.filter(call => call[0] === 'abort').map(call => call[1]);
    expect(listeners.length).toBeGreaterThan(0);
    for (const listener of listeners) expect(detached).toContain(listener);
  });
});
