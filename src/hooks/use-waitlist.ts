"use client";
import { useEffect, useRef, useState } from 'react';
import { apiFetch, ApiError, errorMessage } from '@/lib/client/api';
import type { WaitlistState, WaitlistJoinInput, WaitlistRequestView } from '@/types/waitlist';

export type WaitlistSelection = Omit<WaitlistJoinInput, 'requestId' | 'expectedRevision'>;
export type WaitlistBookingHint = Pick<WaitlistRequestView, 'serviceId' | 'dateKey' | 'resourceId' | 'subjectKind' | 'representativeRole'>;
type Context = { canJoin: boolean; actionsLocked: boolean; acquireAction: () => boolean; releaseAction: () => void };
const safeId = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
export function validWaitlistDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
const positive = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) > 0;
function validState(value: WaitlistState, businessId: string, userId: string): boolean {
  if (!value || typeof value !== 'object' || Object.keys(value).some(key => !['businessId', 'ownerUid', 'revision', 'serverNow', 'request'].includes(key))
    || value.businessId !== businessId || value.ownerUid !== userId || !Number.isSafeInteger(value.revision) || value.revision < 0 || !positive(value.serverNow)) return false;
  const item = value.request;
  if (item === null) return true;
  if (!item || typeof item !== 'object' || value.revision < 1 || Object.keys(item).some(key => !['id', 'serviceId', 'dateKey', 'resourceId', 'subjectKind', 'representativeRole', 'createdAt', 'expiresAt', 'status', 'reason', 'checkedAt'].includes(key))
    || !safeId(item.id) || !safeId(item.serviceId) || !(item.resourceId === null || safeId(item.resourceId)) || !validWaitlistDate(item.dateKey)
    || !positive(item.createdAt) || !positive(item.expiresAt) || item.expiresAt <= item.createdAt || item.createdAt > value.serverNow
    || !['waiting', 'available', 'suspended', 'expired'].includes(item.status)) return false;
  if (item.subjectKind === 'self' ? item.representativeRole !== undefined : item.subjectKind !== 'represented_minor' || !['parent', 'legal_guardian'].includes(item.representativeRole ?? '')) return false;
  if (item.status === 'suspended' ? !['consent_changed', 'booking_policy_changed', 'business_unavailable', 'client_blocked', 'client_limit', 'service_unavailable'].includes(item.reason ?? '') : item.reason !== undefined) return false;
  return (item.checkedAt === null || (positive(item.checkedAt) && item.checkedAt <= value.serverNow))
    && (!['waiting', 'available'].includes(item.status) || item.checkedAt !== null);
}
function message(cause: unknown) {
  const text = errorMessage(cause);
  return /^(?:Failed to fetch|NetworkError when attempting to fetch resource\.?|Load failed|fetch failed)$/i.test(text)
    ? 'No pudimos conectar con SarinBot. Revisa tu conexión e inténtalo de nuevo.' : text;
}
export function useWaitlist(businessId: string, userId: string, context: Context) {
  const key = JSON.stringify([businessId, userId]), identity = useRef({ key });
  if (identity.current.key !== key) identity.current = { key };
  const current = identity.current, mounted = useRef<object | null>(null), conditions = useRef(context); conditions.current = context;
  const initial = () => ({ identity: current, data: null as WaitlistState | null, receivedAt: 0, loading: true, readError: null as string | null,
    actionError: null as string | null, operation: null as 'join' | 'cancel' | null, reconciling: false, uncertain: false });
  const [stored, setStored] = useState(initial), state = stored.identity === current ? stored : initial(), latest = useRef(state); latest.current = state;
  const reading = useRef<AbortController | null>(null), mutation = useRef<AbortController | null>(null), release = useRef<(() => void) | null>(null);
  const live = () => identity.current === current && mounted.current === current;
  function update(patch: Partial<ReturnType<typeof initial>>) { if (live()) { const next = { ...latest.current, ...patch, identity: current }; latest.current = next; setStored(next); } }
  const clock = () => latest.current.data ? latest.current.data.serverNow + Math.max(0, performance.now() - latest.current.receivedAt) : Date.now();
  async function read(reconcile = false) {
    if (!live() || mutation.current) return;
    reading.current?.abort(); const abort = reading.current = new AbortController();
    update({ loading: true, readError: null });
    try {
      const result = await apiFetch<WaitlistState>(`/api/businesses/${encodeURIComponent(businessId)}/waitlist`, { signal: abort.signal }, userId);
      if (!live() || abort.signal.aborted || reading.current !== abort) return;
      if (!validState(result, businessId, userId) || (latest.current.data && result.revision < latest.current.data.revision)) throw new Error('No pudimos comprobar tu lista de espera. Inténtalo de nuevo.');
      update({ data: result, receivedAt: performance.now(), loading: false, readError: null, reconciling: false, uncertain: false,
        ...(latest.current.uncertain ? { actionError: null } : {}) });
      release.current?.(); release.current = null;
    } catch (cause) { if (live() && !abort.signal.aborted && reading.current === abort) update({ loading: false, readError: message(cause), ...(reconcile ? { reconciling: true } : {}) }); }
    finally { if (reading.current === abort) reading.current = null; }
  }
  useEffect(() => {
    mounted.current = current; void read();
    return () => { if (mounted.current === current) mounted.current = null; reading.current?.abort(); mutation.current?.abort(); reading.current = null; mutation.current = null; release.current?.(); release.current = null; };
  }, [key]);
  const observedRevision = state.data?.revision, observedEntry = state.data?.request?.id;
  function availableAction() {
    const value = latest.current;
    return live() && !mutation.current && !reading.current && !value.loading && !value.readError && !value.reconciling && Boolean(value.data) && observedRevision === value.data?.revision;
  }
  async function mutate(operation: 'join' | 'cancel', input: WaitlistSelection | null) {
    if (!availableAction() || conditions.current.actionsLocked) return;
    const data = latest.current.data!, request = data.request;
    if (operation === 'join' ? !input || !conditions.current.canJoin || (request !== null && request.expiresAt > clock()) : !request || request.id !== observedEntry) return;
    if (!conditions.current.acquireAction()) return;
    release.current = conditions.current.releaseAction;
    const abort = mutation.current = new AbortController(), requestId = crypto.randomUUID();
    const body = operation === 'join' ? { ...input!, requestId, expectedRevision: data.revision } : { requestId, expectedRevision: data.revision, entryId: request!.id };
    update({ operation, actionError: null, uncertain: false });
    let reconcile = false;
    try {
      const result = await apiFetch<WaitlistState>(`/api/businesses/${encodeURIComponent(businessId)}/waitlist${operation === 'cancel' ? '/cancel' : ''}`, { method: 'POST', signal: abort.signal, body: JSON.stringify(body) }, userId);
      if (!live() || abort.signal.aborted) return;
      if (!validState(result, businessId, userId) || result.revision <= data.revision || (operation === 'cancel' ? result.request !== null : !result.request
        || result.request.serviceId !== input!.serviceId || result.request.dateKey !== input!.dateKey || result.request.resourceId !== (input!.resourceId ?? null)
        || result.request.subjectKind !== input!.case.subjectKind || result.request.representativeRole !== ('representativeRole' in input!.case ? input!.case.representativeRole : undefined))) throw new Error('No pudimos confirmar el cambio de tu lista de espera.');
      update({ data: result, receivedAt: performance.now(), readError: null });
    } catch (cause) {
      if (live() && !abort.signal.aborted) { reconcile = true; update({ actionError: message(cause), uncertain: !(cause instanceof ApiError) || cause.status >= 500, reconciling: true }); }
    } finally {
      if (live() && mutation.current === abort) { mutation.current = null; update({ operation: null }); if (reconcile) await read(true); if (!latest.current.reconciling) { release.current?.(); release.current = null; } }
    }
  }
  const expiry = state.data?.request?.expiresAt ?? null;
  useEffect(() => {
    if (expiry === null) return;
    const page = typeof document === 'undefined' ? undefined : document;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const clear = () => { if (timer !== undefined) clearTimeout(timer); timer = undefined; };
    function schedule() {
      clear(); if (!live() || page?.visibilityState === 'hidden') return;
      const delay = expiry! - clock(); if (delay <= 0) { update({}); return; }
      timer = setTimeout(() => { timer = undefined; update({}); if (expiry! > clock()) schedule(); }, Math.min(delay, 2147483647));
    }
    const visibility = () => { if (page?.visibilityState !== 'hidden') update({}); schedule(); };
    page?.addEventListener?.('visibilitychange', visibility); schedule();
    return () => { clear(); page?.removeEventListener?.('visibilitychange', visibility); };
  }, [key, expiry, state.data, state.receivedAt]);
  const item = !state.loading && !state.readError && !state.reconciling ? state.data?.request ?? null : null;
  const request: WaitlistRequestView | null = item && item.expiresAt <= clock() ? { ...item, status: 'expired', reason: undefined } : item;
  return { data: state.data, request, loading: state.loading, readError: state.readError, actionError: state.actionError,
    busy: state.operation !== null || state.reconciling, reconciling: state.reconciling, operation: state.operation,
    join: (input: WaitlistSelection) => mutate('join', input), cancel: () => mutate('cancel', null), refresh: () => read(state.reconciling),
    canResume: (candidate: WaitlistRequestView, revision: number) => Boolean(availableAction() && conditions.current.canJoin && !conditions.current.actionsLocked
      && latest.current.data?.revision === revision && latest.current.data.request === candidate && candidate.status === 'available' && candidate.expiresAt > clock()) };
}
export type WaitlistController = ReturnType<typeof useWaitlist>;
