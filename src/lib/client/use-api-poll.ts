"use client";

import { useEffect, useRef, useState, type SetStateAction } from 'react';
import { startApiPolling, type ApiPollingOptions } from './api-polling';
import { errorMessage } from './api';

/** Scope masks old data during render, before effect cleanup can run after an account change. */
export function useApiPoll<T>(scope: string | null, load: (signal: AbortSignal) => Promise<T>, options: ApiPollingOptions = {}) {
  const loader = useRef(load);
  loader.current = load;
  const polling = useRef<ReturnType<typeof startApiPolling<T>> | null>(null);
  const [state, setState] = useState<{ scope: string | null; value: T | null; loading: boolean; error: string | null }>({ scope, value: null, loading: scope !== null, error: null });
  useEffect(() => {
    setState({ scope, value: null, loading: scope !== null, error: null });
    if (scope === null) return;
    const read = loader.current;
    const current = startApiPolling(read, value => setState({ scope, value, loading: false, error: null }), error => setState(previous => ({ ...previous, scope, loading: false, value: null, error: errorMessage(error) })), options);
    polling.current = current;
    return () => { current.stop(); if (polling.current === current) polling.current = null; };
  }, [scope, options.intervalMs]);
  const current = state.scope === scope ? state : { value: null, loading: scope !== null, error: null };
  return {
    ...current,
    refresh: () => polling.current?.refresh(),
    setValue: (value: SetStateAction<T | null>, update: { invalidate?: boolean } = {}) => {
      if (update.invalidate !== false) polling.current?.invalidate();
      setState(previous => previous.scope !== scope ? previous : { ...previous, value: typeof value === 'function' ? (value as (current: T | null) => T | null)(previous.value) : value });
    },
  };
}
