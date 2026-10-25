"use client";
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@/components/auth-provider';
import { apiFetch, ApiError, errorMessage } from '@/lib/client/api';
import { operationPresetRange, ownerOperationSummarySchema, type OperationRange, type OwnerOperationSummary } from '@/lib/owner-operation-summary';
export type OwnerOperationSummaryScope = { businessId: string; ownerUid: string; authEpoch: number };
type State = { key: string; summary: OwnerOperationSummary | null; appliedRange: OperationRange | null; loading: boolean; error: string | null; capacityError: boolean };
const blank = (key: string): State => ({ key, summary: null, appliedRange: null, loading: false, error: null, capacityError: false });
export function useOwnerOperationSummary(input: { scope: OwnerOperationSummaryScope | null; enabled: boolean; available?: boolean }) {
  const auth = useAuth(), key = JSON.stringify([input.scope?.businessId, input.scope?.ownerUid, input.scope?.authEpoch, input.enabled, auth.user?.uid, auth.authEpoch]);
  const current = useRef({ input, auth, key }); current.current = { input, auth, key };
  const [snapshot, setSnapshot] = useState(() => blank(key)), state = useRef(snapshot);
  const mounted = useRef(true), blocked = useRef<string | null>(null), generation = useRef(0), pending = useRef<{ cancel: () => void } | null>(null);
  const requested = useRef<{ key: string; range: OperationRange } | null>(null), anchor = useRef<{ key: string; serverNow: number; receivedMono: number } | null>(null);
  const entryStarted = useRef({ key, started: false });
  const publish = useCallback((value: State) => { state.current = value; setSnapshot(value); }, []);
  const valid = useCallback((expected: string) => { const c = current.current, s = c.input.scope; return mounted.current && c.key === expected && c.input.enabled && blocked.current !== expected && s !== null && c.auth.user?.uid === s.ownerUid && c.auth.authEpoch === s.authEpoch && c.auth.isCurrentSession(s.ownerUid, s.authEpoch); }, []);
  const canRead = useCallback((expected: string) => valid(expected) && current.current.input.available !== false, [valid]);
  const deny = useCallback((expected: string) => { if (current.current.key !== expected) return; blocked.current = expected; generation.current++; anchor.current = null; publish({ ...blank(expected), error: 'Ya no tienes acceso a este resumen. Vuelve a verificar tu cuenta y negocio.' }); }, [publish]);
  const query = useCallback(async (range: OperationRange) => {
    const c = current.current, expected = c.key, scope = c.input.scope;
    if (!scope || !canRead(expected)) return;
    entryStarted.current = { key: expected, started: true };
    const epoch = ++generation.current; pending.current?.cancel();
    const wanted = { ...range }; requested.current = { key: expected, range: wanted };
    const abort = new AbortController(); let cancel!: () => void, finished = false;
    const canceled = new Promise<never>((_, reject) => { cancel = () => { abort.abort(); reject(new Error('La consulta superó el tiempo de espera. Inténtalo de nuevo.')); }; });
    const active = { cancel }; pending.current = active;
    const owns = () => !finished && canRead(expected) && generation.current === epoch && pending.current === active;
    publish({ ...blank(expected), loading: true });
    const timer = setTimeout(cancel, 10000);
    try {
      const params = new URLSearchParams({ from: wanted.from, through: wanted.through });
      const raw = await Promise.race([apiFetch<unknown>(`/api/businesses/${encodeURIComponent(scope.businessId)}/operation-summary?${params}`, { signal: abort.signal }, scope.ownerUid, owns, status => { if ((status === 401 || status === 403) && owns()) deny(expected); }), canceled]);
      if (!owns()) return;
      const result = ownerOperationSummarySchema.safeParse(raw);
      if (!result.success) throw new Error('No se pudo verificar el resumen recibido. Inténtalo de nuevo.');
      const summary = result.data;
      if (summary.businessId !== scope.businessId || summary.ownerUid !== scope.ownerUid) { deny(expected); return; }
      if (summary.range.from !== wanted.from || summary.range.through !== wanted.through) throw new Error('El resumen no corresponde al periodo solicitado.');
      anchor.current = { key: expected, serverNow: summary.serverNow, receivedMono: performance.now() };
      publish({ ...blank(expected), summary, appliedRange: { ...summary.range } });
    } catch (error) { if (owns()) publish({ ...blank(expected), error: errorMessage(error), capacityError: error instanceof ApiError && error.status === 413 }); }
    finally { finished = true; clearTimeout(timer); if (pending.current === active) pending.current = null; }
  }, [canRead, publish, deny]);
  const queryPreset = useCallback(async (preset: 'today' | '7days' | '30days') => {
    const expected = current.current.key;
    if (!canRead(expected)) return;
    try {
      const known = anchor.current, elapsed = known?.key === expected ? performance.now() - known.receivedMono : null;
      if (elapsed !== null && (!Number.isFinite(elapsed) || elapsed < 0)) throw new Error('No se pudo verificar la hora de consulta. Revisa el periodo.');
      const now = elapsed !== null ? Math.floor(known!.serverNow + elapsed) : Date.now();
      await query(operationPresetRange(preset, now));
    } catch (error) { if (canRead(expected)) publish({ ...blank(expected), error: errorMessage(error) }); }
  }, [canRead, query, publish]);
  useEffect(() => {
    mounted.current = true; anchor.current = null; requested.current = null; entryStarted.current = { key, started: false }; publish(blank(key));
    return () => { mounted.current = false; generation.current++; pending.current?.cancel(); pending.current = null; };
  }, [key, publish]);
  useEffect(() => {
    if (!valid(key)) return;
    if (!canRead(key)) {
      generation.current++; pending.current?.cancel(); pending.current = null;
      publish({ ...blank(key), error: 'La verificación del negocio se interrumpió. Usa Actualizar después de recuperar el acceso.' });
    } else if (entryStarted.current.key === key && !entryStarted.current.started) {
      entryStarted.current.started = true; void queryPreset('7days');
    }
  }, [key, input.available, valid, canRead, queryPreset, publish]);
  const effective = snapshot.key === key && canRead(key) ? snapshot : { ...blank(key), error: blocked.current === key ? 'Ya no tienes acceso a este resumen. Vuelve a verificar tu cuenta y negocio.' : valid(key) && !canRead(key) ? 'La verificación del negocio se interrumpió. Usa Actualizar después de recuperar el acceso.' : null };
  return { summary: effective.summary, appliedRange: effective.appliedRange, loading: effective.loading, error: effective.error, capacityError: effective.capacityError, query, queryPreset, refresh: async () => { const last = requested.current; if (last?.key === current.current.key) await query(last.range); } };
}
