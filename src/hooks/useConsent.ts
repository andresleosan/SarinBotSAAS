"use client";
import { useEffect, useRef, useState } from 'react';
import { apiFetch, errorMessage, ApiError } from '@/lib/client/api';
import { useApiPoll } from '@/lib/client/use-api-poll';
import type { ConsentBusiness, ConsentDocuments, ConsentScope, ConsentStatus } from '@/lib/legal';

export async function preauthorizationRequest(documents: ConsentDocuments, signal?: AbortSignal): Promise<{ token: string; expiresAt: number }> {
  const response = await fetch('/api/consent/preauthorize', { method: 'POST', signal, cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fingerprint: documents.fingerprint, termsAccepted: true, dataAuthorized: true }) });
  const data = await response.json();
  if (!response.ok || typeof data.token !== 'string' || !Number.isSafeInteger(data.expiresAt)) throw new Error(typeof data.error === 'string' ? data.error : 'No se pudo preparar tu autorización.');
  return data;
}
export function useConsent(uid: string | undefined, scope: ConsentScope, business?: ConsentBusiness) {
  const key = uid && (scope !== 'business_client' || business) ? JSON.stringify([uid, scope, ...(scope === 'business_client' ? [business!.id, business!.name, business!.phoneWhatsApp] : [])]) : null;
  const identity = useRef({ key });
  if (identity.current.key !== key) identity.current = { key };
  const current = identity.current;
  const request = useRef<AbortController | null>(null);
  const pending = useRef<{ key: string; body: string } | null>(null);
  const [action, setAction] = useState<{ identity: object; busy: boolean; error: string | null } | null>(null);
  const [withdrawn, setWithdrawn] = useState<object | null>(null);
  const poll = useApiPoll<ConsentStatus>(key, async signal => {
    const data = await apiFetch<ConsentStatus>(`/api/consent?scope=${scope}${scope === 'business_client' ? `&businessId=${encodeURIComponent(business!.id)}` : ''}`, { signal }, uid);
    if (typeof data?.active !== 'boolean' || !Number.isSafeInteger(data.revision) || !/^[a-f0-9]{64}$/.test(data.documents?.fingerprint ?? '')) throw new Error('No se pudieron comprobar tus permisos.');
    return data;
  });
  useEffect(() => () => { request.current?.abort(); request.current = null; pending.current = null; }, [key]);
  const ownAction = action?.identity === current ? action : null;
  const withdrawalRequested = withdrawn === current;
  const active = !withdrawalRequested && poll.value?.active === true && !poll.error && !poll.loading;
  async function decide(decision: 'accept' | 'revoke') {
    if (!key || request.current || !poll.value) return;
    const abort = request.current = new AbortController(), status = poll.value;
    const operationKey = JSON.stringify([key, decision, decision === 'revoke' ? null : status.revision, status.documents.fingerprint]);
    setAction({ identity: current, busy: true, error: null });
    if (decision === 'revoke') { setWithdrawn(current); poll.setValue(previous => previous && { ...previous, active: false }); }
    try {
      let body = pending.current?.key === operationKey ? pending.current.body : null;
      if (!body) {
        const proof = decision === 'accept' && scope === 'account' ? await preauthorizationRequest(status.documents, abort.signal) : null;
        if (identity.current !== current || abort.signal.aborted) return;
        body = JSON.stringify({ scope, ...(scope === 'business_client' ? { businessId: business!.id } : {}), action: decision, requestId: crypto.randomUUID(), expectedRevision: status.revision,
          ...(decision === 'accept' ? { fingerprint: status.documents.fingerprint, termsAccepted: true, dataAuthorized: true, ...(proof ? { preauthorization: proof.token } : {}) } : {}),
        });
        pending.current = { key: operationKey, body };
      }
      const result = await apiFetch<ConsentStatus>('/api/consent', { method: 'POST', signal: abort.signal, body }, uid);
      if (identity.current !== current || abort.signal.aborted) return;
      poll.setValue(result); pending.current = null;
      // Only a confirmed response to the user's explicit action clears the
      // withdrawal latch. Background reads cannot reopen uncertain processing.
      setWithdrawn(null);
    } catch (cause) {
      if (identity.current === current && !abort.signal.aborted) {
        setAction({ identity: current, busy: false, error: errorMessage(cause) });
        if (cause instanceof ApiError && [409, 428].includes(cause.status)) { pending.current = null; poll.refresh(); }
      }
    } finally {
      if (identity.current === current && !abort.signal.aborted) setAction(previous => previous?.identity === current ? { ...previous, busy: false } : previous);
      if (request.current === abort) request.current = null;
    }
  }
  return { active, withdrawalRequested, status: poll.value, loading: poll.loading, busy: ownAction?.busy ?? false, error: ownAction?.error ?? poll.error, decide, refresh: poll.refresh };
}
export type ConsentController = ReturnType<typeof useConsent>;
