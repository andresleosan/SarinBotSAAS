"use client";

export type ApiPollingOptions = { intervalMs?: number };
/** One actual load at a time, including an abort that has not settled yet. */
export function startApiPolling<T>(load: (signal: AbortSignal) => Promise<T>, onValue: (value: T) => void, onError: (error: unknown) => void, options: ApiPollingOptions = {}) {
  const interval = options.intervalMs === 5_000 ? 5_000 : 15_000;
  let stopped = false, generation = 0, running = false, queued = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let controller: AbortController | undefined;
  const page = typeof document === 'undefined' ? undefined : document;
  const browser = typeof window === 'undefined' ? undefined : window;
  let focused = true;
  const visible = () => focused && page?.visibilityState !== 'hidden';
  function interrupt() {
    generation++;
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined; queued = false; controller?.abort();
  }
  function run() {
    if (stopped || !visible()) return;
    if (running) { queued = true; return; }
    running = true;
    const current = generation, request = controller = new AbortController();
    void (async () => {
      try {
        const value = await load(request.signal);
        if (!stopped && current === generation && !request.signal.aborted) onValue(value);
      } catch (error) {
        if (!stopped && current === generation && !request.signal.aborted) onError(error);
      } finally {
        running = false;
        if (!stopped && visible()) {
          if (queued) { queued = false; run(); }
          else if (current === generation) timer = setTimeout(refresh, interval);
        }
      }
    })();
  }
  function refresh() { interrupt(); run(); }
  const visibility = () => { if (visible()) refresh(); else interrupt(); };
  const focus = () => { focused = true; refresh(); };
  const blur = () => { focused = false; interrupt(); };
  page?.addEventListener?.('visibilitychange', visibility);
  browser?.addEventListener?.('focus', focus);
  browser?.addEventListener?.('blur', blur);
  refresh();
  return {
    refresh,
    invalidate() { interrupt(); if (!stopped && visible()) timer = setTimeout(run, interval); },
    stop() {
      stopped = true; interrupt();
      page?.removeEventListener?.('visibilitychange', visibility);
      browser?.removeEventListener?.('focus', focus);
      browser?.removeEventListener?.('blur', blur);
    },
  };
}
