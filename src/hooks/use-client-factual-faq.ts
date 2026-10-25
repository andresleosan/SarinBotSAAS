"use client";
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@/components/auth-provider';
import { apiFetch, ApiError } from '@/lib/client/api';
import { clientFactualFaqAnswerSchema, clientFactualFaqTopicsSchema, type ClientFactualFaqAnswer, type ClientFactualFaqTopics, type FactualFaqTopic } from '@/lib/business-factual-faq';
export type ClientFactualFaqController = {
  topics: ClientFactualFaqTopics | null; answer: ClientFactualFaqAnswer | null; loading: boolean; error: string | null;
  loadTopics: () => Promise<void>; choose: (topic: FactualFaqTopic) => Promise<void>; clear: () => void;
};
type State = Pick<ClientFactualFaqController, 'topics' | 'answer' | 'loading' | 'error'> & { key: string };
const blank = (key: string): State => ({ key, topics: null, answer: null, loading: false, error: null });
export function useClientFactualFaq(input: { businessId: string; uid: string; authEpoch: number; enabled: boolean }): ClientFactualFaqController {
  const auth = useAuth(), key = JSON.stringify([input.businessId, input.uid, input.authEpoch, input.enabled]);
  const current = useRef({ input, auth, key }); current.current = { input, auth, key };
  const [snapshot, setSnapshot] = useState(() => blank(key)), state = useRef(snapshot), generation = useRef(0);
  const denied = useRef<string | null>(null), mounted = useRef(true), request = useRef<{ cancel: () => void } | null>(null);
  const publish = useCallback((next: State) => { state.current = next; setSnapshot(next); }, []);
  const valid = useCallback((expected: string) => { const c = current.current; return mounted.current && c.key === expected && c.input.enabled && denied.current !== expected && c.auth.user?.uid === c.input.uid && c.auth.authEpoch === c.input.authEpoch && c.auth.isCurrentSession(c.input.uid, c.input.authEpoch); }, []);
  const clear = useCallback(() => { generation.current++; request.current?.cancel(); request.current = null; publish(blank(current.current.key)); }, [publish]);
  useEffect(() => { mounted.current = true; clear(); return () => { mounted.current = false; generation.current++; request.current?.cancel(); request.current = null; }; }, [key, clear]);
  const read = useCallback(async (topic?: FactualFaqTopic) => {
    const c = current.current, expected = c.key, topics = state.current.key === expected ? state.current.topics : null;
    if (!valid(expected) || (topic && (!topics || !topics.topics.some(item => item.topic === topic)))) return;
    generation.current++; request.current?.cancel();
    const epoch = generation.current, abort = new AbortController(); let cancel!: () => void, finished = false;
    const canceled = new Promise<never>((_, reject) => { cancel = () => { abort.abort(); reject(new Error('La consulta superó el tiempo de espera.')); }; });
    const active = { cancel }; request.current = active;
    const owns = () => !finished && valid(expected) && generation.current === epoch && request.current === active;
    publish({ ...blank(expected), topics: topic ? topics : null, loading: true });
    const timer = setTimeout(cancel, 10000);
    try {
      const path = `/api/businesses/${encodeURIComponent(c.input.businessId)}/factual-faq${topic ? `/${topic}?revision=${topics!.revision}` : ''}`;
      const raw = await Promise.race([apiFetch<unknown>(path, { signal: abort.signal }, c.input.uid, owns, status => {
        if ([401, 403, 428].includes(status) && owns()) { denied.current = expected; generation.current++; publish({ ...blank(expected), error: 'Revisa tus permisos para consultar esta información.' }); }
      }), canceled]);
      if (!owns()) return;
      if (topic) {
        const answer = clientFactualFaqAnswerSchema.parse(raw);
        if (answer.businessId !== c.input.businessId || answer.topic !== topic || answer.revision !== topics!.revision) throw new Error('Foreign answer');
        publish({ ...blank(expected), topics, answer });
      } else {
        const list = clientFactualFaqTopicsSchema.parse(raw);
        if (list.businessId !== c.input.businessId) throw new Error('Foreign topics');
        publish({ ...blank(expected), topics: list });
      }
    } catch (error) {
      if (!owns()) return;
      if (error instanceof ApiError && error.status === 409) {
        publish({ ...blank(expected), error: 'La información cambió. Vuelve a elegir una pregunta.' });
        return 'changed' as const;
      }
      publish({ ...blank(expected), topics: topic ? topics : null, error: error instanceof Error && error.message.includes('tiempo de espera') ? error.message : 'No se pudo consultar la información. Inténtalo de nuevo o contacta al negocio.' });
    } finally { finished = true; clearTimeout(timer); if (request.current === active) request.current = null; }
  }, [valid, publish]);
  const loadTopics = useCallback(async () => { await read(); }, [read]);
  const choose = useCallback(async (topic: FactualFaqTopic) => {
    const expected = current.current.key, result = await read(topic);
    if (result === 'changed' && valid(expected)) {
      const epoch = generation.current; await loadTopics();
      if (valid(expected) && generation.current === epoch + 1 && !state.current.error) publish({ ...state.current, error: 'La información cambió. Vuelve a elegir una pregunta.' });
    }
  }, [read, valid, loadTopics, publish]);
  const effective = snapshot.key === key && valid(key) ? snapshot : { ...blank(key), error: denied.current === key ? 'Revisa tus permisos para consultar esta información.' : null };
  return { ...effective, loadTopics, choose, clear };
}
