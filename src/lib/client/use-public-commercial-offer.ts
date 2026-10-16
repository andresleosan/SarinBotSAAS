"use client";

import { useEffect, useRef, useState } from 'react';
import { publicCommercialOfferSchema, type PublicCommercialOffer } from '@/lib/commercial-offer';
import { startApiPolling } from '@/lib/client/api-polling';

type State = { endpoint: string | null; offer: PublicCommercialOffer | null; loading: boolean; error: string | null };

export function usePublicCommercialOffer(endpoint: string | null) {
  const [state, setState] = useState<State>({ endpoint, offer: null, loading: endpoint !== null, error: null });
  const polling = useRef<ReturnType<typeof startApiPolling<PublicCommercialOffer>> | null>(null);
  useEffect(() => {
    setState({ endpoint, offer: null, loading: endpoint !== null, error: null });
    if (!endpoint) return;
    const current = startApiPolling(async signal => {
      const response = await fetch(endpoint, { signal, cache: 'no-store', credentials: 'omit', headers: { Accept: 'application/json' } });
      if (!response.ok) throw new Error('No pudimos consultar las tarifas.');
      const result = publicCommercialOfferSchema.safeParse(await response.json());
      if (!result.success) throw new Error('No pudimos consultar las tarifas.');
      return result.data;
    }, offer => setState({ endpoint, offer, loading: false, error: null }),
    () => setState({ endpoint, offer: null, loading: false, error: 'No pudimos consultar las tarifas.' }));
    polling.current = current;
    return () => { current.stop(); if (polling.current === current) polling.current = null; };
  }, [endpoint]);
  const current = state.endpoint === endpoint ? state : { offer: null, loading: endpoint !== null, error: null };
  return { offer: current.offer, loading: current.loading, error: current.error, refresh: () => polling.current?.refresh() };
}
