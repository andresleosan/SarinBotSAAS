"use client";
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@/components/auth-provider';
import { apiFetch, ApiError, errorMessage } from '@/lib/client/api';
import { factualFaqCommandCanonicalString, normalizeFactualFaqItems, ownerFactualFaqViewSchema, type FactualFaqCommand, type FactualFaqItem, type OwnerFactualFaqView } from '@/lib/business-factual-faq';

export type OwnerFactualFaqController = {
  view: OwnerFactualFaqView | null; draft: FactualFaqItem[]; dirty: boolean; busy: boolean; uncertain: boolean; error: string | null; message: string | null;
  reviewed: boolean; publicationChecked: boolean; setPublicationChecked: (checked: boolean) => void;
  setDraft: (items: FactualFaqItem[]) => void; load: () => Promise<void>; review: () => void;
  save: () => Promise<void>; inspectPending: () => Promise<void>; retryPending: () => Promise<void>;
};
type State = Pick<OwnerFactualFaqController, 'view' | 'draft' | 'dirty' | 'busy' | 'uncertain' | 'error' | 'message' | 'reviewed' | 'publicationChecked'> & { key: string };
type Pending = { command: FactualFaqCommand; hash: string; active: boolean; ambiguous: boolean };
const blank = (key: string): State => ({ key, view: null, draft: [], dirty: false, busy: false, uncertain: false, error: null, message: null, reviewed: false, publicationChecked: false });
export function useOwnerFactualFaq(input: { businessId: string; ownerUid: string; authEpoch: number; enabled: boolean; available?: boolean }): OwnerFactualFaqController {
  const auth = useAuth(), key = JSON.stringify([input.businessId, input.ownerUid, input.authEpoch, input.enabled]);
  const current = useRef({ input, auth, key }); current.current = { input, auth, key };
  const [snapshot, setSnapshot] = useState(() => blank(key)), state = useRef(snapshot);
  const pending = useRef<Pending | null>(null), denied = useRef<string | null>(null), mounted = useRef(true);
  const reading = useRef<{ cancel: () => void } | null>(null), generation = useRef(0), timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  const publish = useCallback((next: State) => { state.current = next; setSnapshot(next); }, []);
  const valid = useCallback((expected: string) => { const c = current.current; return mounted.current && c.key === expected && c.input.enabled && denied.current !== expected && c.auth.user?.uid === c.input.ownerUid && c.auth.authEpoch === c.input.authEpoch && c.auth.isCurrentSession(c.input.ownerUid, c.input.authEpoch); }, []);
  const purge = useCallback((expected: string) => { if (current.current.key !== expected) return; denied.current = expected; generation.current++; pending.current = null; publish({ ...blank(expected), error: 'Ya no tienes acceso a esta información.' }); }, [publish]);
  const adopt = useCallback((view: OwnerFactualFaqView, expected: string, proofRequired: boolean) => {
    if (view.state.businessId !== current.current.input.businessId) throw new Error('La respuesta corresponde a otro negocio.');
    const operation = pending.current;
    if (operation && view.applied) {
      if (!operation.hash || view.applied.requestId !== operation.command.requestId || view.applied.commandFingerprint !== operation.hash || view.applied.revision !== operation.command.expectedRevision + 1) throw new Error('No se pudo verificar el recibo de estas respuestas.');
      // Any earlier reader may have observed the state before this verified write.
      generation.current++; reading.current?.cancel(); reading.current = null;
      pending.current = null;
      publish({ ...blank(expected), view, draft: structuredClone(view.state.items), message: view.applied.revision < view.state.revision ? 'Las respuestas se guardaron; después hubo otra modificación. Se cargó la versión actual.' : 'Respuestas guardadas.' });
    } else if (operation) {
      if (proofRequired) throw new Error('Falta el recibo del guardado.');
      publish({ ...state.current, busy: operation.active, uncertain: !operation.active, message: 'Aún no hay recibo. La ausencia no demuestra que el guardado falló.' });
    } else {
      const old = state.current, changed = old.view && (old.view.state.revision !== view.state.revision || old.view.policyRevision !== view.policyRevision);
      publish({ ...blank(expected), view, draft: old.key === expected && old.dirty ? old.draft : structuredClone(view.state.items), dirty: old.key === expected && old.dirty, reviewed: !changed && old.reviewed, publicationChecked: !changed && old.publicationChecked, error: changed && old.dirty ? 'Las respuestas cambiaron. Conservamos tu borrador; vuelve a revisar antes de guardar.' : null });
    }
  }, [publish]);
  const load = useCallback(async () => {
    const c = current.current, expected = c.key;
    if (!valid(expected) || reading.current) return;
    const epoch = ++generation.current, abort = new AbortController(); let finished = false, cancel!: () => void;
    const canceled = new Promise<never>((_, reject) => { cancel = () => { abort.abort(); reject(new Error('La consulta superó el tiempo de espera. Inténtalo de nuevo.')); }; });
    const request = { cancel }; reading.current = request;
    const owns = () => !finished && valid(expected) && generation.current === epoch && reading.current === request;
    const timer = setTimeout(cancel, 10000), operation = pending.current;
    try {
      const raw = await Promise.race([apiFetch<unknown>(`/api/businesses/${encodeURIComponent(c.input.businessId)}/factual-faq-settings${operation ? `?requestId=${encodeURIComponent(operation.command.requestId)}` : ''}`, { signal: abort.signal }, c.input.ownerUid, owns, status => { if ((status === 401 || status === 403) && owns()) purge(expected); }), canceled]);
      if (owns()) adopt(ownerFactualFaqViewSchema.parse(raw), expected, false);
    } catch (error) { if (owns()) publish({ ...state.current, error: errorMessage(error) }); }
    finally { finished = true; clearTimeout(timer); if (reading.current === request) reading.current = null; }
  }, [valid, purge, adopt, publish]);
  useEffect(() => {
    mounted.current = true; pending.current = null; publish(blank(key)); void load();
    return () => { mounted.current = false; generation.current++; reading.current?.cancel(); reading.current = null; for (const timer of timers.current) clearTimeout(timer); timers.current.clear(); };
  }, [key, publish, load]);
  const editable = () => valid(key) && current.current.input.available !== false && state.current.key === key && state.current.view?.eligible && !pending.current && !state.current.busy;
  const setDraft = (draft: FactualFaqItem[]) => { if (editable()) publish({ ...state.current, draft: structuredClone(draft), dirty: true, reviewed: false, publicationChecked: false, error: null, message: null }); };
  const review = () => {
    if (!editable() || !state.current.dirty) return;
    try { publish({ ...state.current, draft: normalizeFactualFaqItems(state.current.draft), reviewed: true, publicationChecked: false, error: null }); }
    catch { publish({ ...state.current, reviewed: false, publicationChecked: false, error: 'Revisa las respuestas: hasta 400 caracteres, tres saltos de línea y ningún control.' }); }
  };
  const send = async (operation: Pending) => {
    const c = current.current, expected = c.key;
    if (!valid(expected) || pending.current !== operation || operation.active || !operation.hash) return;
    operation.active = true; publish({ ...state.current, busy: true, uncertain: false, error: null });
    const owns = () => valid(expected) && pending.current === operation;
    const timer = setTimeout(() => { if (owns()) publish({ ...state.current, message: 'El guardado está demorando. Sigue en curso; puedes consultar su recibo.' }); }, 20000); timers.current.add(timer);
    try {
      const raw = await apiFetch<unknown>(`/api/businesses/${encodeURIComponent(c.input.businessId)}/factual-faq-settings`, { method: 'PUT', body: JSON.stringify(operation.command) }, c.input.ownerUid, owns, status => { if ((status === 401 || status === 403) && owns()) purge(expected); });
      if (owns()) adopt(ownerFactualFaqViewSchema.parse(raw), expected, true);
    } catch (error) {
      if (!owns()) return;
      const definitive = error instanceof ApiError && [400, 402, 409, 413, 415, 428].includes(error.status) && !operation.ambiguous;
      if (definitive) pending.current = null; else operation.ambiguous = true;
      publish({ ...state.current, busy: false, uncertain: !definitive, reviewed: false, publicationChecked: false, error: errorMessage(error), view: definitive && error instanceof ApiError && error.status === 409 ? null : state.current.view });
    } finally { operation.active = false; clearTimeout(timer); timers.current.delete(timer); }
  };
  const save = async () => {
    const s = state.current, expected = key;
    if (!editable() || !s.view || !s.reviewed || !s.publicationChecked) return;
    const operation: Pending = { command: { requestId: crypto.randomUUID(), expectedRevision: s.view.state.revision, expectedPolicyRevision: s.view.policyRevision, items: normalizeFactualFaqItems(s.draft) }, hash: '', active: false, ambiguous: false };
    pending.current = operation; publish({ ...s, busy: true, error: null });
    try {
      const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(factualFaqCommandCanonicalString(operation.command)));
      if (!valid(expected) || pending.current !== operation) return;
      operation.hash = Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join(''); await send(operation);
    } catch (error) { if (valid(expected) && pending.current === operation) { pending.current = null; publish({ ...state.current, busy: false, error: errorMessage(error) }); } }
  };
  const effective = snapshot.key === key && valid(key) ? snapshot : { ...blank(key), error: denied.current === key ? 'Ya no tienes acceso a esta información.' : null };
  useEffect(() => {
    if (!effective.dirty || typeof window === 'undefined') return;
    const protect = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', protect); return () => window.removeEventListener('beforeunload', protect);
  }, [effective.dirty]);
  return { ...effective, setDraft, review, save, load, inspectPending: load, retryPending: async () => { if (pending.current && !pending.current.active) await send(pending.current); }, setPublicationChecked: checked => { if (editable() && state.current.reviewed) publish({ ...state.current, publicationChecked: checked }); } };
}
