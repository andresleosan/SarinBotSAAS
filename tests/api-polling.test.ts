import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startApiPolling } from '@/lib/client/api-polling';

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
  const poll = startApiPolling(load, () => {}, () => {});
  events.dispatchEvent(new Event('focus')); events.dispatchEvent(new Event('focus'));
  expect(load).toHaveBeenCalledTimes(1);
  pending[0]('old'); await Promise.resolve(); await Promise.resolve();
  expect(load).toHaveBeenCalledTimes(2);
  poll.stop(); pending[1]?.('done'); vi.unstubAllGlobals();
});
