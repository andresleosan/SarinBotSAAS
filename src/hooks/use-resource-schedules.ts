"use client";
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@/components/auth-provider';
import { apiFetch, ApiError, errorMessage } from '@/lib/client/api';
import { canonicalResourceScheduleRules, resourceScheduleCommandText, resourceScheduleRulesSchema, resourceScheduleViewSchema, resourceScheduleSaveResultSchema, type ResourceScheduleView, type ResourceScheduleRules, type ResourceScheduleCommand } from '@/lib/resource-schedules';

export type ResourceSchedulePhase = 'loading' | 'ready' | 'review' | 'saving' | 'uncertain' | 'conflict' | 'error';
export type ResourceScheduleController = {
  view: ResourceScheduleView | null; draft: ResourceScheduleRules | null; phase: ResourceSchedulePhase;
  dirty: boolean; error: string | null; message: string | null;
  setRules: (rules: ResourceScheduleRules) => void; review: () => void; save: () => Promise<void>;
  refresh: () => Promise<void>; inspectPending: () => Promise<void>; retryPending: () => Promise<void>; discard: () => void;
};
type State = Pick<ResourceScheduleController, 'view' | 'draft' | 'phase' | 'dirty' | 'error' | 'message'> & { key: string; reviewed: string | null };
type Pending = { command: ResourceScheduleCommand; hash: string; active: boolean };
const blank = (key: string): State => ({ key, view: null, draft: null, phase: 'loading', dirty: false, error: null, message: null, reviewed: null });
const fingerprint = (view: ResourceScheduleView, rules: ResourceScheduleRules) => JSON.stringify([view.policy.revision, view.basisFingerprint, canonicalResourceScheduleRules(rules)]);

export function useResourceSchedules(input: { businessId: string | null; ownerUid: string | null; authEpoch: number; mode: 'read' | 'edit'; enabled: boolean }): ResourceScheduleController {
  const auth = useAuth();
  const key = JSON.stringify([input.businessId, input.ownerUid, input.authEpoch, input.mode, input.enabled, auth.user?.uid, auth.authEpoch]);
  const current = useRef({ input, auth, key }); current.current = { input, auth, key };
  const [snapshot, setSnapshot] = useState<State>(() => blank(key));
  const state = useRef(snapshot), generation = useRef(0), blocked = useRef<string | null>(null);
  const pending = useRef<Pending | null>(null), reading = useRef<{ cancel: () => void } | null>(null);
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  const publish = useCallback((value: State) => { state.current = value; setSnapshot(value); }, []);
  const authorized = useCallback((expected: string) => { const c = current.current; return c.key === expected && c.input.enabled && Boolean(c.input.businessId && c.input.ownerUid) && c.input.authEpoch === c.auth.authEpoch && c.auth.user?.uid === c.input.ownerUid && c.auth.isCurrentSession(c.input.ownerUid!, c.input.authEpoch) && blocked.current !== expected; }, []);
  const purge = useCallback((expected: string) => { if (current.current.key !== expected) return; blocked.current = expected; generation.current++; pending.current = null; publish({ ...blank(expected), phase: 'error', error: 'Ya no tienes acceso a estos horarios.' }); }, [publish]);
  const adopt = useCallback((view: ResourceScheduleView, expected: string, receipt: boolean) => {
    const old = state.current, operation = pending.current;
    if (receipt && operation) {
      if (view.operation?.requestId !== operation.command.requestId || view.operation.operationHash !== operation.hash || view.operation.resultRevision !== operation.command.expectedRevision + 1) throw new Error('No se pudo verificar el recibo del cambio.');
      pending.current = null;
      publish({ ...blank(expected), view, draft: current.current.input.mode === 'edit' ? structuredClone(view.policy.rules) : null, phase: 'ready', message: view.operation.resultRevision < view.policy.revision ? 'Este cambio se aplicó; después hubo otra modificación. Se cargó la revisión actual.' : 'Horarios guardados.' });
    } else if (operation) {
      publish({ ...old, phase: operation.active ? 'saving' : 'uncertain', message: 'Aún no hay recibo. Espera o reintenta la misma petición después de un error.' });
    } else {
      const conflict = old.key === expected && old.dirty && old.view && (old.view.policy.revision !== view.policy.revision || old.view.basisFingerprint !== view.basisFingerprint);
      publish({ ...blank(expected), view, draft: current.current.input.mode === 'edit' ? old.key === expected && old.dirty ? old.draft : structuredClone(view.policy.rules) : null, dirty: old.key === expected && old.dirty, phase: conflict ? 'conflict' : old.dirty && old.phase === 'review' ? 'review' : 'ready', reviewed: conflict ? null : old.reviewed, error: conflict ? 'Los horarios o la apertura cambiaron. Conservamos tu borrador; carga la versión actual antes de editar de nuevo.' : null });
    }
  }, [publish]);
  const read = useCallback(async () => {
    const c = current.current, expected = c.key, epoch = generation.current;
    if (!authorized(expected) || reading.current) return;
    const abort = new AbortController(); let finished = false, timer: ReturnType<typeof setTimeout> | undefined;
    let cancel!: () => void;
    const canceled = new Promise<never>((_, reject) => { cancel = () => { abort.abort(); reject(new Error('La consulta superó el tiempo de espera. Inténtalo de nuevo.')); }; });
    const request = { cancel }; reading.current = request;
    const owns = () => !finished && generation.current === epoch && authorized(expected) && reading.current === request;
    timer = setTimeout(cancel, 10_000);
    try {
      const operation = pending.current;
      const path = `/api/businesses/${encodeURIComponent(c.input.businessId!)}/resource-schedules${operation ? `?requestId=${encodeURIComponent(operation.command.requestId)}` : ''}`;
      const raw = await Promise.race([apiFetch<unknown>(path, { signal: abort.signal }, c.input.ownerUid!, owns, status => { if ((status === 401 || status === 403) && owns()) purge(expected); }), canceled]);
      if (!owns()) return;
      const parsed = resourceScheduleViewSchema.parse(raw);
      if (parsed.ownerUid !== c.input.ownerUid || parsed.businessId !== c.input.businessId) { purge(expected); return; }
      adopt(parsed, expected, Boolean(operation && parsed.operation));
    } catch (error) {
      if (owns()) publish({ ...(state.current.key === expected ? state.current : blank(expected)), view: c.input.mode === 'read' ? null : state.current.view, phase: pending.current ? pending.current.active ? 'saving' : 'uncertain' : 'error', error: errorMessage(error) });
    } finally { finished = true; if (timer) clearTimeout(timer); if (reading.current === request) reading.current = null; }
  }, [adopt, authorized, publish, purge]);
  useEffect(() => {
    generation.current++; pending.current = null; publish(blank(key)); void read();
    return () => { generation.current++; reading.current?.cancel(); reading.current = null; for (const timer of timers.current) clearTimeout(timer); timers.current.clear(); };
  }, [key, publish, read]);
  const editable = () => authorized(key) && input.mode === 'edit' && state.current.key === key && state.current.view && !pending.current && !['conflict', 'loading', 'error'].includes(state.current.phase);
  const setRules = (rules: ResourceScheduleRules) => { if (!editable()) return; publish({ ...state.current, draft: structuredClone(rules), dirty: true, reviewed: null, phase: 'ready', error: null, message: null }); };
  const review = () => {
    if (!editable() || !state.current.draft || !state.current.dirty) return;
    const parsed = resourceScheduleRulesSchema.safeParse(state.current.draft);
    if (!parsed.success) { publish({ ...state.current, error: 'Revisa las fechas y los intervalos: usa horas válidas, ordenadas y sin solapamientos.' }); return; }
    publish({ ...state.current, draft: canonicalResourceScheduleRules(parsed.data), reviewed: fingerprint(state.current.view!, parsed.data), phase: 'review', error: null });
  };
  const send = async (operation: Pending) => {
    const c = current.current, expected = c.key, epoch = generation.current;
    if (!authorized(expected) || c.input.mode !== 'edit' || operation.active || pending.current !== operation) return;
    operation.active = true; publish({ ...state.current, phase: 'saving', error: null, message: null });
    const owns = () => authorized(expected) && generation.current === epoch && pending.current === operation;
    const timer = setTimeout(() => { if (owns()) publish({ ...state.current, message: 'El guardado está demorando. La petición sigue en curso; espera o consulta su recibo.' }); }, 20_000); timers.current.add(timer);
    try {
      const raw = await apiFetch<unknown>(`/api/businesses/${encodeURIComponent(c.input.businessId!)}/resource-schedules`, { method: 'PUT', body: JSON.stringify(operation.command) }, c.input.ownerUid!, owns, status => { if ((status === 401 || status === 403) && owns()) purge(expected); });
      if (!owns()) return;
      const result = resourceScheduleSaveResultSchema.parse(raw);
      if (result.businessId !== c.input.businessId || result.ownerUid !== c.input.ownerUid) { purge(expected); return; }
      adopt(result, expected, true);
    } catch (error) {
      if (!owns()) return;
      const known = error instanceof ApiError && (error.status === 402 || error.status === 428 || error.status === 400 || error.status === 409 || error.code === 'SCHEDULE_WRITES_DISABLED');
      if (known) pending.current = null;
      publish({ ...state.current, phase: known ? error instanceof ApiError && error.status === 409 ? 'conflict' : 'ready' : 'uncertain', reviewed: null, error: errorMessage(error) });
    } finally { operation.active = false; clearTimeout(timer); timers.current.delete(timer); }
  };
  const save = async () => {
    const s = state.current;
    if (!editable() || s.phase !== 'review' || !s.view?.writesEnabled || !s.draft || s.reviewed !== fingerprint(s.view, s.draft)) return;
    const operation: Pending = { command: { requestId: crypto.randomUUID(), expectedRevision: s.view.policy.revision, expectedBasisFingerprint: s.view.basisFingerprint, rules: canonicalResourceScheduleRules(s.draft) }, hash: '', active: false };
    pending.current = operation; publish({ ...s, phase: 'saving' });
    try {
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(resourceScheduleCommandText(operation.command)));
      if (!authorized(key) || pending.current !== operation) return;
      operation.hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join(''); await send(operation);
    } catch (error) { if (authorized(key) && pending.current === operation) { pending.current = null; publish({ ...state.current, phase: 'ready', error: errorMessage(error) }); } }
  };
  const effective = snapshot.key === key && (authorized(key) || blocked.current === key) ? snapshot : blank(key);
  useEffect(() => {
    if (!effective.dirty || typeof window === 'undefined') return;
    const protect = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', protect); return () => window.removeEventListener('beforeunload', protect);
  }, [effective.dirty]);
  return { ...effective, setRules, review, save, refresh: read, inspectPending: read, retryPending: async () => { if (input.mode === 'edit' && pending.current && !pending.current.active) await send(pending.current); }, discard: () => { if (!authorized(key) || input.mode !== 'edit' || pending.current || !state.current.view) return; publish({ ...state.current, draft: structuredClone(state.current.view.policy.rules), dirty: false, reviewed: null, phase: 'ready', error: null, message: null }); } };
}
