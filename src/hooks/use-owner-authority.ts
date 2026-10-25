"use client";
import { useEffect, useReducer, useRef } from 'react';
import { z } from 'zod';
import { useAuth } from '@/components/auth-provider';
import { errorMessage } from '@/lib/client/api';
import { ownerApiFetch, type OwnerRequestScope, type OwnerAccessFailure } from '@/lib/client/owner-request-scope';

const businessIdentity = z.object({ business: z.object({ id: z.string().min(1), ownerUid: z.string().min(1) }).passthrough().nullable() }).strict();
type Authority = {
  key: string; live: boolean; protected: boolean; revoked: boolean; checking: boolean;
  featureCode: string | null; error: string | null; readGeneration: number;
  requestScope: OwnerRequestScope; probe: { cancel: () => void } | null;
};

/** Protection keeps this identity alive. Only authoritative loss purges its commands. */
export function useOwnerAuthority(input: { ownerUid: string; authEpoch: number; businessId: string; isCurrentWorkspace?: () => boolean }) {
  const auth = useAuth(), latest = useRef(auth); latest.current = auth;
  const key = JSON.stringify([input.ownerUid, input.authEpoch, input.businessId]);
  const state = useRef<Authority | null>(null), [, render] = useReducer(value => value + 1, 0);
  if (!state.current || state.current.key !== key) {
    const record: Authority = { key, live: true, protected: false, revoked: false, checking: false, featureCode: null, error: null, readGeneration: 0, requestScope: null as unknown as OwnerRequestScope, probe: null };
    const current = () => state.current === record && record.live && !record.revoked
      && (input.isCurrentWorkspace?.() ?? true)
      && latest.current.user?.uid === input.ownerUid && latest.current.authEpoch === input.authEpoch
      && latest.current.isCurrentSession(input.ownerUid, input.authEpoch);
    const deny = (failure: OwnerAccessFailure) => {
      if (!current()) return;
      if (failure.status === 401 || failure.source === 'owner_authority') {
        record.revoked = true; record.readGeneration++; record.featureCode = null; record.probe?.cancel();
        if (failure.status === 401) latest.current.invalidateSession(input.ownerUid, input.authEpoch);
      } else {
        if (!record.protected) record.readGeneration++;
        record.protected = true;
        if (failure.code) record.featureCode = failure.code;
      }
      render();
    };
    record.requestScope = { ownerUid: input.ownerUid, authEpoch: input.authEpoch, businessId: input.businessId, isCurrent: current, get readGeneration() { return record.readGeneration; }, canRead: () => current() && !record.protected, canStartAction: () => current() && !record.protected, onAccessDenied: deny };
    state.current = record;
  }
  const record = state.current, scope = record.requestScope;
  useEffect(() => {
    record.live = true;
    return () => { record.live = false; record.probe?.cancel(); };
  }, [record]);

  async function checkAccess(): Promise<void> {
    if (!scope.isCurrent() || record.probe) return;
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined, settled = false;
    let cancel!: () => void;
    const interrupted = new Promise<never>((_, reject) => { cancel = () => { controller.abort(); reject(new Error('No pudimos comprobar el acceso. Inténtalo de nuevo.')); }; });
    const probe = { cancel }; record.probe = probe; record.checking = true; record.error = null; render();
    timer = setTimeout(cancel, 10000);
    try {
      const response = await Promise.race([ownerApiFetch<unknown>(scope, 'authority', '/api/businesses', { signal: controller.signal }, () => !settled && record.probe === probe), interrupted]);
      if (!scope.isCurrent() || settled || controller.signal.aborted) return;
      const result = businessIdentity.safeParse(response);
      if (!result.success) throw new Error('No pudimos verificar la respuesta de acceso.');
      if (!result.data.business || result.data.business.id !== input.businessId || result.data.business.ownerUid !== input.ownerUid) {
        scope.onAccessDenied({ status: 403, source: 'owner_authority' }); return;
      }
      record.protected = false; record.readGeneration++; record.error = null;
    } catch (error) {
      if (scope.isCurrent()) record.error = errorMessage(error);
    } finally {
      settled = true; if (timer) clearTimeout(timer);
      if (record.probe === probe) { record.probe = null; record.checking = false; }
      if (state.current === record && record.live) render();
    }
  }
  return { requestScope: scope, protected: record.protected, revoked: record.revoked, checking: record.checking, featureCode: record.featureCode, error: record.error, checkAccess };
}
