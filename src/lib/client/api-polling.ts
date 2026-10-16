"use client";

/** One visible read at a time. A stopped scope can never publish a late response. */
export function startApiPolling<T>(load: (signal: AbortSignal) => Promise<T>, onValue: (value: T) => void, onError: (error: unknown) => void) {
  let stopped = false;
  let generation = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let controller: AbortController | undefined;
  const page = typeof document === 'undefined' ? undefined : document;
  const browser = typeof window === 'undefined' ? undefined : window;
  const visible = () => page?.visibilityState !== 'hidden';
  function interrupt() {
    generation++;
    if (timer !== undefined) clearTimeout(timer);
    controller?.abort();
  }
  function refresh() {
    interrupt();
    if (stopped || !visible()) return;
    const current = generation;
    const request = controller = new AbortController();
    void (async () => {
      try {
        const value = await load(request.signal);
        if (!stopped && current === generation && !request.signal.aborted) onValue(value);
      } catch (error) {
        if (!stopped && current === generation && !request.signal.aborted) onError(error);
      } finally {
        if (!stopped && current === generation && visible()) timer = setTimeout(refresh, 15_000);
      }
    })();
  }
  const visibility = () => { if (visible()) refresh(); else interrupt(); };
  page?.addEventListener?.('visibilitychange', visibility);
  browser?.addEventListener?.('focus', refresh);
  refresh();
  return {
    refresh,
    invalidate() {
      interrupt();
      if (!stopped && visible()) timer = setTimeout(refresh, 15_000);
    },
    stop() {
      stopped = true;
      interrupt();
      page?.removeEventListener?.('visibilitychange', visibility);
      browser?.removeEventListener?.('focus', refresh);
    },
  };
}
