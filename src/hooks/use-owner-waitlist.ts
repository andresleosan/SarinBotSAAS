"use client";
import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@/components/auth-provider';
import { apiFetch, errorMessage } from '@/lib/client/api';
import { ownerWaitlistPageSchema, ownerWaitlistDetailSchema, ownerWaitlistReviewResultSchema, ownerWaitlistReviewStateSchema, parseOwnerWaitlistDate, compareOwnerWaitlistRows, type OwnerWaitlistPage, type OwnerWaitlistDetail, type OwnerWaitlistReviewCommand, type OwnerWaitlistReviewResult, type OwnerWaitlistCursor } from '@/lib/owner-waitlist';

type Input = { businessId: string | null; ownerUid: string | null; authEpoch: number; enabled: boolean; available?: boolean };
type State = { key: string; dateKey: string; page: OwnerWaitlistPage | null; detail: OwnerWaitlistDetail | null; loading: boolean; busy: boolean; uncertain: boolean; error: string | null; notice: string | null };
type Pending = { key: string; dateKey: string; recordId: string; command: OwnerWaitlistReviewCommand; attempt: number; cancel?: () => void };
const today = () => new Date(Date.now() - 5 * 3_600_000).toISOString().slice(0, 10);
const blank = (key: string, dateKey: string): State => ({ key, dateKey, page: null, detail: null, loading: false, busy: false, uncertain: false, error: null, notice: null });

export function useOwnerWaitlist(input: Input) {
  const auth = useAuth(), key = JSON.stringify([input.businessId, input.ownerUid, input.authEpoch, input.enabled, auth.user?.uid, auth.authEpoch]);
  const current = useRef({ input, auth, key }); current.current = { input, auth, key };
  const view = useRef({ key, dateKey: today() });
  if (view.current.key !== key) view.current = { key, dateKey: today() };
  const [snapshot, setSnapshot] = useState(() => blank(key, view.current.dateKey)), state = useRef(snapshot);
  const mounted = useRef(true), blocked = useRef<string | null>(null), generation = useRef(0), started = useRef({ key, value: false });
  const reading = useRef<{ cancel: () => void } | null>(null), pending = useRef<Pending | null>(null), selected = useRef<string | null>(null);
  function valid(expected: string) {
    const c = current.current, s = c.input;
    return mounted.current && c.key === expected && s.enabled && blocked.current !== expected && Boolean(s.businessId && s.ownerUid) && c.auth.user?.uid === s.ownerUid && c.auth.authEpoch === s.authEpoch && c.auth.isCurrentSession(s.ownerUid!, s.authEpoch);
  }
  const canRead = (expected: string) => valid(expected) && current.current.input.available !== false;
  function publish(value: State) { if (mounted.current && value.key === current.current.key) { state.current = value; setSnapshot(value); } }
  function patch(value: Partial<State>) { const expected = current.current.key; publish({ ...(state.current.key === expected ? state.current : blank(expected, view.current.dateKey)), ...value, key: expected, dateKey: view.current.dateKey }); }
  function cancelRead() { generation.current++; reading.current?.cancel(); reading.current = null; }
  function deny(expected: string) {
    if (current.current.key !== expected) return;
    blocked.current = expected; cancelRead(); pending.current?.cancel?.(); pending.current = null; selected.current = null;
    publish({ ...blank(expected, view.current.dateKey), error: 'Ya no tienes acceso a esta espera. Vuelve a verificar tu cuenta y negocio.' });
  }
  const base = () => `/api/businesses/${encodeURIComponent(current.current.input.businessId!)}/owner-waitlist`;
  async function read<T>(path: string, init: RequestInit, decode: (value: unknown) => T, accept: (value: T) => void) {
    const expected = current.current.key, dateKey = view.current.dateKey;
    if (!canRead(expected)) return;
    cancelRead(); const epoch = generation.current, abort = new AbortController(); let finished = false;
    let reject!: (error: Error) => void;
    const canceled = new Promise<never>((_, no) => { reject = no; });
    const active = { cancel: () => { abort.abort(); reject(new Error('La consulta superó el tiempo de espera. Inténtalo de nuevo.')); } }; reading.current = active;
    const owns = () => !finished && canRead(expected) && view.current.dateKey === dateKey && generation.current === epoch && reading.current === active;
    patch({ loading: true, error: null });
    const timer = setTimeout(active.cancel, 10000);
    try {
      const raw = await Promise.race([apiFetch<unknown>(path, { ...init, signal: abort.signal }, current.current.input.ownerUid!, owns, status => { if ((status === 401 || status === 403) && owns()) deny(expected); }), canceled]);
      if (owns()) accept(decode(raw));
    } catch (error) { if (owns()) patch({ loading: false, error: errorMessage(error) }); }
    finally { finished = true; clearTimeout(timer); if (reading.current === active) reading.current = null; }
  }
  async function readPage(cursor?: OwnerWaitlistCursor) {
    const expected = current.current.key, dateKey = view.current.dateKey;
    if (!canRead(expected)) return;
    try { parseOwnerWaitlistDate(dateKey, Date.now()); } catch { cancelRead(); patch({ loading: false, page: null, detail: null, error: 'Elige una fecha válida hasta los próximos 366 días.' }); return; }
    started.current = { key: expected, value: true };
    await read(base() + '/query', { method: 'POST', body: JSON.stringify({ dateKey, ...(cursor ? { cursor } : {}) }) }, raw => {
      const result = ownerWaitlistPageSchema.safeParse(raw), scope = current.current.input;
      if (!result.success) throw new Error('No se pudo verificar la bandeja recibida.');
      const value = result.data;
      if (value.businessId !== scope.businessId || value.ownerUid !== scope.ownerUid) { deny(expected); throw new Error('El ámbito cambió.'); }
      if (value.dateKey !== dateKey || cursor && value.rows.some(row => compareOwnerWaitlistRows(cursor, row) >= 0)) throw new Error('La página no corresponde a la consulta.');
      for (const row of value.rows) {
        const prior = state.current.page?.rows.find(old => old.entryId === row.entryId);
        if (prior && row.review.revision < prior.review.revision) throw new Error('La revisión recibida es anterior a la ya comprobada.');
      }
      return value;
    }, page => { selected.current = null; patch({ page, detail: null, loading: false, error: null }); });
  }
  async function open(recordId: string) {
    const expected = current.current.key, dateKey = view.current.dateKey, unknown = pending.current;
    if (!canRead(expected)) return;
    selected.current = recordId;
    await read(base() + '/' + encodeURIComponent(recordId), {}, raw => {
      const parsed = ownerWaitlistDetailSchema.safeParse(raw), scope = current.current.input;
      if (!parsed.success) throw new Error('No se pudo verificar el detalle recibido.');
      const result = parsed.data;
      if (result.businessId !== scope.businessId || result.ownerUid !== scope.ownerUid) { deny(expected); throw new Error('El ámbito cambió.'); }
      if (result.row.recordId !== recordId) throw new Error('El detalle no corresponde a la solicitud.');
      const prior = state.current.detail?.row;
      if (prior?.entryId === result.row.entryId && result.row.review.revision < prior.review.revision) throw new Error('El detalle recibido es anterior a la revisión comprobada.');
      const p = pending.current, matching = p && p === unknown && p.key === expected && p.recordId === recordId;
      const replacement = matching && result.row.waitlistRevision > p.command.expectedWaitlistRevision;
      const newer = matching && result.row.entryId === p.command.entryId && result.row.waitlistRevision === p.command.expectedWaitlistRevision && result.row.review.revision > p.command.expectedReviewRevision;
      if (result.row.dateKey !== dateKey && !replacement && !(matching && p.dateKey === result.row.dateKey)) throw new Error('La solicitud no corresponde a la fecha seleccionada.');
      if (replacement || newer) {
        p!.cancel?.(); pending.current = null;
        patch({ busy: false, uncertain: false, notice: 'Se comprobó el estado actual. No es una constancia de la operación pendiente.' });
      }
      return result;
    }, result => {
      const review = result.row.review;
      const page = state.current.page ? { ...state.current.page, rows: state.current.page.rows.map(row => row.entryId === result.row.entryId ? { ...row, review } : row) } : null;
      patch({ page, detail: result.row.dateKey === dateKey ? result : null, loading: false, error: null, uncertain: Boolean(pending.current) });
    });
  }
  function accepted(result: OwnerWaitlistReviewResult) {
    const page = state.current.page ? { ...state.current.page, rows: state.current.page.rows.map(row => row.entryId === result.entryId ? { ...row, review: result.review } : row) } : null;
    const detail = state.current.detail?.row.entryId === result.entryId ? { ...state.current.detail, row: { ...state.current.detail.row, review: result.review } } : state.current.detail;
    patch({ page, detail, busy: false, loading: false, uncertain: false, error: null, notice: 'Revisión actualizada. No se avisó al cliente ni se retiró la solicitud.' });
  }
  async function send(p: Pending) {
    if (!canRead(p.key) || pending.current !== p || state.current.busy) return;
    cancelRead(); const attempt = ++p.attempt, abort = new AbortController(); let finished = false, reject!: (error: Error) => void;
    const canceled = new Promise<never>((_, no) => { reject = no; });
    const cancel = () => { abort.abort(); reject(new Error('No se pudo confirmar la revisión. Comprueba el estado o reintenta la misma operación.')); };
    p.cancel = cancel;
    const owns = () => !finished && valid(p.key) && pending.current === p && p.attempt === attempt;
    patch({ busy: true, loading: false, error: null, notice: null });
    const timer = setTimeout(cancel, 20000);
    try {
      const raw = await Promise.race([apiFetch<unknown>(base() + '/' + encodeURIComponent(p.recordId) + '/review', { method: 'PATCH', body: JSON.stringify(p.command), signal: abort.signal }, current.current.input.ownerUid!, owns, status => { if ((status === 401 || status === 403) && owns()) deny(p.key); }), canceled]);
      if (!owns()) return;
      const parsed = ownerWaitlistReviewResultSchema.safeParse(raw), scope = current.current.input;
      if (!parsed.success) throw new Error('No se pudo verificar la respuesta de revisión.');
      const value = parsed.data;
      if (value.businessId !== scope.businessId || value.ownerUid !== scope.ownerUid || value.recordId !== p.recordId || value.entryId !== p.command.entryId || value.waitlistRevision !== p.command.expectedWaitlistRevision
        || value.review.revision !== p.command.expectedReviewRevision + 1 || value.review.reviewed !== p.command.reviewed) throw new Error('No se pudo verificar el resultado de esta operación.');
      cancelRead(); pending.current = null; accepted(value);
    } catch (error) { if (owns()) patch({ busy: false, loading: false, uncertain: true, error: errorMessage(error) }); }
    finally { finished = true; clearTimeout(timer); if (p.cancel === cancel) p.cancel = undefined; }
  }
  async function setReviewed(reviewed: boolean) {
    const expected = current.current.key, detail = state.current.detail;
    if (!canRead(expected) || state.current.key !== expected || state.current.busy || pending.current || !detail || detail.row.dateKey !== view.current.dateKey) return;
    const row = detail.row;
    const p: Pending = { key: expected, dateKey: row.dateKey, recordId: row.recordId, attempt: 0, command: { requestId: crypto.randomUUID(), entryId: row.entryId, expectedWaitlistRevision: row.waitlistRevision, expectedReviewRevision: row.review.revision, reviewed } };
    pending.current = p; await send(p);
  }
  function setDate(dateKey: string) {
    const expected = current.current.key;
    if (!canRead(expected) || dateKey === view.current.dateKey) return;
    cancelRead(); pending.current?.cancel?.(); selected.current = null; view.current = { key: expected, dateKey };
    publish({ ...blank(expected, dateKey), uncertain: Boolean(pending.current) }); void readPage();
  }
  async function reconcilePending(p: Pending) {
    await read(base() + '/' + encodeURIComponent(p.recordId) + '/review', {}, raw => {
      const parsed = ownerWaitlistReviewStateSchema.safeParse(raw), scope = current.current.input;
      if (!parsed.success) throw new Error('No se pudo verificar el estado actual de la revisión.');
      const value = parsed.data;
      if (value.businessId !== scope.businessId || value.ownerUid !== scope.ownerUid || value.recordId !== p.recordId) throw new Error('La comprobación no corresponde a esta solicitud.');
      if (value.waitlistRevision < p.command.expectedWaitlistRevision) throw new Error('La comprobación recibida es anterior a la solicitud.');
      return value;
    }, value => {
      if (pending.current !== p) { patch({ loading: false }); return; }
      const incarnationChanged = value.waitlistRevision > p.command.expectedWaitlistRevision;
      const markerAdvanced = value.waitlistRevision === p.command.expectedWaitlistRevision && value.entryId === p.command.entryId && value.review !== null && value.review.revision > p.command.expectedReviewRevision;
      if (!incarnationChanged && !markerAdvanced) { patch({ loading: false, uncertain: true, notice: 'La operación sigue por comprobar. La misma revisión no descarta una escritura pendiente.' }); return; }
      p.cancel?.(); pending.current = null;
      if (incarnationChanged) {
        selected.current = null;
        patch({ page: null, detail: null, loading: false, busy: false, uncertain: false, error: null, notice: 'Se comprobó el estado actual: la solicitud cambió o fue retirada. No es una constancia de la operación pendiente. Actualiza la bandeja para continuar.' });
      } else {
        const review = value.review!;
        const page = state.current.page ? { ...state.current.page, rows: state.current.page.rows.map(row => row.entryId === value.entryId ? { ...row, review } : row) } : null;
        const detail = state.current.detail?.row.entryId === value.entryId ? { ...state.current.detail, row: { ...state.current.detail.row, review } } : state.current.detail;
        patch({ page, detail, loading: false, busy: false, uncertain: false, error: null, notice: 'Se comprobó el estado actual. No es una constancia de la operación pendiente.' });
      }
    });
  }
  async function refresh() { const p = pending.current; if (p?.key === current.current.key) await reconcilePending(p); else if (selected.current) await open(selected.current); else await readPage(); }
  async function retryPending() { if (pending.current) await send(pending.current); }
  function close() { cancelRead(); selected.current = null; patch({ detail: null, loading: false }); }
  async function loadOlder() { const cursor = state.current.page?.nextCursor; if (cursor && !state.current.loading) await readPage(cursor); }
  useEffect(() => {
    mounted.current = true; cancelRead(); pending.current?.cancel?.(); pending.current = null; selected.current = null; started.current = { key, value: false };
    publish(blank(key, view.current.dateKey));
    if (canRead(key)) void readPage();
    return () => { mounted.current = false; cancelRead(); pending.current?.cancel?.(); };
    // Identity owns the controller; its own busy flag never participates.
  }, [key]);
  useEffect(() => {
    if (!valid(key)) return;
    if (input.available === false) {
      cancelRead(); pending.current?.cancel?.(); patch({ page: null, detail: null, loading: false, busy: false, uncertain: Boolean(pending.current), error: 'La verificación del negocio se interrumpió. Usa Actualizar cuando se recupere.' });
    } else if (started.current.key === key && !started.current.value) void readPage();
  }, [key, input.available]);
  const effective = snapshot.key === key && canRead(key) ? snapshot : { ...blank(key, view.current.dateKey), error: blocked.current === key ? 'Ya no tienes acceso a esta espera. Vuelve a verificar tu cuenta y negocio.' : null };
  return { dateKey: effective.dateKey, page: effective.page, detail: effective.detail, loading: effective.loading, busy: effective.busy, uncertain: effective.uncertain, error: effective.error, notice: effective.notice, setDate, refresh, loadOlder, open, close, setReviewed, retryPending };
}
export type OwnerWaitlistController = ReturnType<typeof useOwnerWaitlist>;
