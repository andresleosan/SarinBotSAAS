import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startApiPolling } from '@/lib/client/api-polling';
import { createElement, act } from 'react';
import { create } from 'react-test-renderer';
import { useApiPoll } from '@/lib/client/use-api-poll';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

describe('bounded visible API polling', () => {
  let page: EventTarget & { visibilityState: string };
  let windowEvents: EventTarget;
  beforeEach(() => {
    vi.useFakeTimers();
    page = Object.assign(new EventTarget(), { visibilityState: 'visible' });
    windowEvents = new EventTarget();
    vi.stubGlobal('document', page);
    vi.stubGlobal('window', windowEvents);
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it('waits fifteen seconds after a completed read and never overlaps periodic requests', async () => {
    let finish!: (value: string) => void;
    const load = vi.fn(() => new Promise<string>(resolve => { finish = resolve; }));
    const value = vi.fn();
    const polling = startApiPolling(load, value, vi.fn());
    await vi.advanceTimersByTimeAsync(60_000);
    expect(load).toHaveBeenCalledTimes(1);
    finish('first');
    await vi.advanceTimersByTimeAsync(14_999);
    expect(value).toHaveBeenCalledWith('first');
    expect(load).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(load).toHaveBeenCalledTimes(2);
    polling.stop();
  });

  it('aborts on hiding, ignores the aborted result and resumes immediately when visible', async () => {
    const pending: { signal: AbortSignal; resolve: (value: string) => void }[] = [];
    const load = vi.fn((signal: AbortSignal) => new Promise<string>(resolve => pending.push({ signal, resolve })));
    const value = vi.fn();
    const polling = startApiPolling(load, value, vi.fn());
    page.visibilityState = 'hidden'; page.dispatchEvent(new Event('visibilitychange'));
    expect(pending[0].signal.aborted).toBe(true);
    pending[0].resolve('private stale value');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(value).not.toHaveBeenCalled();
    expect(load).toHaveBeenCalledTimes(1);
    page.visibilityState = 'visible'; page.dispatchEvent(new Event('visibilitychange'));
    expect(load).toHaveBeenCalledTimes(2);
    pending[1].resolve('current');
    await vi.advanceTimersByTimeAsync(0);
    expect(value).toHaveBeenCalledExactlyOnceWith('current');
    polling.stop();
  });

  it('does not read while initially hidden and refreshes on focus without replaying a stopped session', async () => {
    page.visibilityState = 'hidden';
    const load = vi.fn(async () => 'fresh');
    const value = vi.fn();
    const polling = startApiPolling(load, value, vi.fn());
    expect(load).not.toHaveBeenCalled();
    page.visibilityState = 'visible'; windowEvents.dispatchEvent(new Event('focus'));
    await vi.advanceTimersByTimeAsync(0);
    expect(value).toHaveBeenCalledWith('fresh');
    polling.stop();
    windowEvents.dispatchEvent(new Event('focus'));
    await vi.advanceTimersByTimeAsync(30_000);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('reports an error, recovers on refresh and ignores callbacks from an older account after stop', async () => {
    let stale!: (value: string) => void;
    const load = vi.fn().mockRejectedValueOnce(new Error('offline')).mockImplementationOnce(() => new Promise<string>(resolve => { stale = resolve; }));
    const error = vi.fn(), value = vi.fn();
    const polling = startApiPolling<string>(load, value, error);
    await vi.advanceTimersByTimeAsync(0);
    expect(error).toHaveBeenCalledWith(expect.objectContaining({ message: 'offline' }));
    polling.refresh();
    polling.stop();
    stale('previous account');
    await vi.advanceTimersByTimeAsync(0);
    expect(value).not.toHaveBeenCalled();
  });

  it('invalidates an older read after an authoritative mutation and resumes at the next interval', async () => {
    let finish!: (value: string) => void;
    let signal!: AbortSignal;
    const load = vi.fn((input: AbortSignal) => { signal = input; return new Promise<string>(resolve => { finish = resolve; }); });
    const value = vi.fn();
    const polling = startApiPolling(load, value, vi.fn());
    polling.invalidate();
    expect(signal.aborted).toBe(true);
    finish('before mutation');
    await vi.advanceTimersByTimeAsync(14_999);
    expect(value).not.toHaveBeenCalled();
    expect(load).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(load).toHaveBeenCalledTimes(2);
    polling.stop();
  });

  it.each([false, true])('makes blur interruption explicit independently of the five-second interval: %s', async abortOnBlur => {
    let finish!: (value: string) => void;
    const load = vi.fn((signal: AbortSignal) => new Promise<string>(resolve => { finish = resolve; }));
    const value = vi.fn(), poll = startApiPolling(load, value, vi.fn(), { intervalMs: 5_000, abortOnBlur });
    windowEvents.dispatchEvent(new Event('blur'));
    expect(load.mock.calls[0][0].aborted).toBe(abortOnBlur);
    finish('completed'); await vi.advanceTimersByTimeAsync(0);
    expect(value).toHaveBeenCalledTimes(abortOnBlur ? 0 : 1);
    poll.stop();
  });

  it.each([false, true])('makes waiting for an aborted request explicit and ignores an old finally: %s', async waitForPending => {
    const pending: Array<{ signal: AbortSignal; finish: (value: string) => void }> = [];
    const load = vi.fn((signal: AbortSignal) => new Promise<string>(finish => pending.push({ signal, finish })));
    const value = vi.fn(), poll = startApiPolling(load, value, vi.fn(), { waitForPending });
    page.visibilityState = 'hidden'; page.dispatchEvent(new Event('visibilitychange'));
    expect(pending[0].signal.aborted).toBe(true);
    page.visibilityState = 'visible'; page.dispatchEvent(new Event('visibilitychange'));
    expect(load).toHaveBeenCalledTimes(waitForPending ? 1 : 2);
    if (waitForPending) { pending[0].finish('old'); await vi.advanceTimersByTimeAsync(0); }
    else {
      pending[0].finish('old'); await vi.advanceTimersByTimeAsync(15_000);
      expect(load).toHaveBeenCalledTimes(2); expect(value).not.toHaveBeenCalled();
    }
    pending[1].finish('current'); await vi.advanceTimersByTimeAsync(0);
    expect(value).toHaveBeenCalledExactlyOnceWith('current');
    await vi.advanceTimersByTimeAsync(14_999); expect(load).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1); expect(load).toHaveBeenCalledTimes(3);
    poll.stop(); pending[2].finish('stopped'); await vi.advanceTimersByTimeAsync(0);
  });

  it.each([false, true])('preserves a confirmed same-scope value unless clearOnError is explicit: %s', async clearOnError => {
    const load = vi.fn().mockResolvedValueOnce('confirmed').mockRejectedValueOnce(Error('read failure')).mockResolvedValueOnce('recovered');
    let state!: ReturnType<typeof useApiPoll<string>>;
    function Consumer() { state = useApiPoll('same-scope', load, { clearOnError }); return createElement('span', null, state.value); }
    let tree!: ReturnType<typeof create>;
    await act(async () => { tree = create(createElement(Consumer)); });
    try {
      expect(state.value).toBe('confirmed');
      await act(async () => state.refresh());
      expect(state.value).toBe(clearOnError ? null : 'confirmed'); expect(state.error).toBe('read failure');
      await act(async () => state.refresh());
      expect(state.value).toBe('recovered'); expect(state.error).toBeNull();
    } finally { await act(async () => tree.unmount()); }
  });
});

it('allows the support five-second interval', async () => {
  vi.useFakeTimers();
  const load = vi.fn(async () => 'read');
  const poll = startApiPolling(load, () => {}, () => {}, { intervalMs: 5_000 });
  await vi.advanceTimersByTimeAsync(5_000);
  expect(load).toHaveBeenCalledTimes(2);
  poll.stop(); vi.useRealTimers();
});

it('coalesces focus refreshes until an aborted load actually settles', async () => {
  const events = new EventTarget(); vi.stubGlobal('window', events);
  const pending: Array<(value: string) => void> = [];
  const load = vi.fn(() => new Promise<string>(resolve => pending.push(resolve)));
  const poll = startApiPolling(load, () => {}, () => {}, { waitForPending: true });
  events.dispatchEvent(new Event('focus')); events.dispatchEvent(new Event('focus'));
  expect(load).toHaveBeenCalledTimes(1);
  pending[0]('old'); await Promise.resolve(); await Promise.resolve();
  expect(load).toHaveBeenCalledTimes(2);
  poll.stop(); pending[1]?.('done'); vi.unstubAllGlobals();
});
