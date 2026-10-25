"use client";

import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@/components/auth-provider';
import { apiFetch, ApiError } from '@/lib/client/api';
import { ownerApiFetch, type OwnerRequestScope } from '@/lib/client/owner-request-scope';
import { compareOwnerClientRecordRows, ownerClientRecordInputSchema, ownerClientRecordPageSchema, type OwnerClientRecordFilter, type OwnerClientRecordPage } from '@/lib/owner-client-record';

export type OwnerClientRecordScope = {
  businessId: string; ownerUid: string; dateKey: string; sourceAppointmentId: string; clientUid: string;
};
type Snapshot = { key: string; page: OwnerClientRecordPage | null; loading: boolean; error: string | null; restart: boolean };
type Pending = { cancel: () => void };
const changedMessage = 'Los registros cambiaron. Usa Actualizar para volver al inicio.';

export function useOwnerClientRecord(input: {
  scope: OwnerClientRecordScope | null; enabled: boolean; invalidation: number; onAccessLost?: () => void; requestScope?: OwnerRequestScope;
}): {
  page: OwnerClientRecordPage | null; loading: boolean; error: string | null;
  filter: OwnerClientRecordFilter; setFilter: (value: OwnerClientRecordFilter) => void;
  loadOlder: () => Promise<void>; refresh: () => Promise<void>;
} {
  const { user, authEpoch, isCurrentSession } = useAuth();
  const scope = input.scope;
  const baseKey = JSON.stringify([scope?.businessId, scope?.ownerUid, scope?.dateKey, scope?.sourceAppointmentId, scope?.clientUid, user?.uid, authEpoch]);
  const [selection, setSelection] = useState({ key: baseKey, filter: 'all' as OwnerClientRecordFilter });
  const filter = selection.key === baseKey ? selection.filter : 'all';
  const key = JSON.stringify([baseKey, filter, input.enabled, input.invalidation, input.requestScope?.readGeneration]);
  const [snapshot, setSnapshot] = useState<Snapshot>({ key: '', page: null, loading: false, error: null, restart: false });
  const saved = useRef(snapshot);
  const pending = useRef<Pending | null>(null);
  const blocked = useRef<string | null>(null);
  const accessLost = useRef(input.onAccessLost);
  accessLost.current = input.onAccessLost;
  // Updated during render: no prior page or async callback can survive until the next effect.
  const current = useRef({ key, scope: input.scope, enabled: input.enabled, uid: user?.uid, epoch: authEpoch, isCurrentSession, requestScope: input.requestScope });
  current.current = { key, scope: input.scope, enabled: input.enabled, uid: user?.uid, epoch: authEpoch, isCurrentSession, requestScope: input.requestScope };
  const publish = useCallback((value: Snapshot) => { saved.current = value; setSnapshot(value); }, []);
  const authorized = useCallback(() => {
    const value = current.current;
    return value.enabled && value.scope !== null && value.uid === value.scope.ownerUid
      && value.isCurrentSession(value.scope.ownerUid, value.epoch) && blocked.current !== value.key
      && (!value.requestScope || (value.requestScope.ownerUid === value.scope.ownerUid && value.requestScope.businessId === value.scope.businessId && value.requestScope.isCurrent()));
  }, []);

  const read = useCallback((older: boolean): Promise<void> => {
    const active = current.current;
    if (active.key !== key || !authorized() || pending.current || !active.scope || (active.requestScope && !active.requestScope.canRead())) return Promise.resolve();
    const scope = active.scope;
    const previous = saved.current.key === key ? saved.current : null;
    const cursor = older ? previous?.page?.nextCursor : undefined;
    if (older && (!cursor || previous?.restart)) return Promise.resolve();
    const body = ownerClientRecordInputSchema.safeParse({ clientUid: scope.clientUid, filter, ...(cursor ? { cursor } : {}) });
    if (!body.success) {
      publish({ key, page: null, loading: false, error: 'No se pueden verificar las reservas de esta cuenta.', restart: false });
      return Promise.resolve();
    }
    return new Promise<void>(resolve => {
      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      let finished = false;
      const request: Pending = { cancel: () => finish(true) };
      function finish(abort = false) {
        if (finished) return;
        finished = true;
        if (timer !== undefined) clearTimeout(timer);
        if (abort) controller.abort();
        if (pending.current === request) pending.current = null;
        resolve();
      }
      const owns = () => !finished && pending.current === request && current.current.key === key && authorized();
      const loseAccess = () => {
        if (!owns()) return;
        blocked.current = key;
        publish({ key, page: null, loading: false, error: 'Ya no tienes acceso a esta consulta.', restart: false });
        finish(true);
        accessLost.current?.();
      };
      pending.current = request;
      publish({ key, page: previous?.page ?? null, loading: true, error: null, restart: previous?.restart ?? false });
      // This deadline covers token acquisition, transport and response JSON, not just fetch.
      timer = setTimeout(() => {
        if (owns()) publish({ key, page: previous?.page ?? null, loading: false, error: previous?.restart ? changedMessage : 'La consulta superó el tiempo de espera. Inténtalo de nuevo.', restart: previous?.restart ?? false });
        finish(true);
      }, 10_000);
      const path = `/api/businesses/${encodeURIComponent(scope.businessId)}/appointments/${encodeURIComponent(scope.sourceAppointmentId)}/client-record`;
      // Both handlers stay attached after cancellation: late token/body failures are consumed.
      const response = active.requestScope ? ownerApiFetch<unknown>(active.requestScope, 'read', path, { method: 'POST', body: JSON.stringify(body.data), signal: controller.signal }, owns) : apiFetch<unknown>(path, { method: 'POST', body: JSON.stringify(body.data), signal: controller.signal }, scope.ownerUid, owns,
        status => {
          if (status === 401 || status === 403) loseAccess();
          if (status === 409 && owns()) {
            publish({ key, page: previous?.page ?? null, loading: false, error: changedMessage, restart: true });
            finish(true);
          }
        });
      void response
        .then(raw => {
          if (!owns()) return;
          const parsed = ownerClientRecordPageSchema.safeParse(raw);
          if (!parsed.success) throw new Error('Unverifiable record page');
          const page = parsed.data;
          if (page.scope.businessId !== scope.businessId || page.scope.sourceAppointmentId !== scope.sourceAppointmentId
            || page.scope.clientUid !== scope.clientUid || page.filter !== filter) throw new Error('Record scope changed');
          if (cursor) {
            const ids = new Set(previous?.page?.rows.map(row => row.appointmentId));
            if (page.rows.some(row => ids.has(row.appointmentId) || compareOwnerClientRecordRows(cursor, row) >= 0)) {
              throw new ApiError(changedMessage, 409, 'CLIENT_RECORD_CHANGED');
            }
          }
          publish({ key, page, loading: false, error: null, restart: false });
        })
        .catch((cause: unknown) => {
          if (!owns()) return;
          if (cause instanceof ApiError && (cause.status === 401 || cause.status === 403)) {
            if (active.requestScope) { publish({ key, page: null, loading: false, error: 'Comprueba el acceso antes de continuar.', restart: false }); finish(true); }
            else loseAccess();
            return;
          }
          const restart = previous?.restart || (cause instanceof ApiError && cause.status === 409);
          publish({ key, page: previous?.page ?? null, loading: false, error: restart ? changedMessage : 'No se pudo verificar la consulta. Inténtalo de nuevo.', restart });
        })
        .finally(() => finish());
    });
  }, [key, filter, publish, authorized]);

  useEffect(() => {
    if (blocked.current !== key) blocked.current = null;
    publish({ key, page: null, loading: false, error: null, restart: false });
    void read(false);
    return () => { pending.current?.cancel(); };
  }, [key, publish, read]);

  const setFilter = useCallback((value: OwnerClientRecordFilter) => {
    if (current.current.key !== key || !authorized() || !['all', 'completed', 'no_show'].includes(value) || value === filter) return;
    pending.current?.cancel();
    publish({ key: '', page: null, loading: false, error: null, restart: false });
    setSelection({ key: baseKey, filter: value });
  }, [key, baseKey, filter, publish, authorized]);
  const refresh = useCallback(() => read(false), [read]);
  const loadOlder = useCallback(() => read(true), [read]);
  const visible = snapshot.key === key && authorized() && (!input.requestScope || input.requestScope.canRead());
  return { page: visible ? snapshot.page : null, loading: visible && snapshot.loading,
    error: snapshot.key === key ? snapshot.error : null, filter, setFilter, loadOlder, refresh };
}
