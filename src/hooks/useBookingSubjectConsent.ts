"use client";
import { useEffect, useRef, useState } from 'react';
import { apiFetch, ApiError, errorMessage } from '@/lib/client/api';
import { useApiPoll } from '@/lib/client/use-api-poll';
import type { ConsentBusiness } from '@/lib/legal';
import type { BookingSubjectCase, BookingSubjectDecisions } from '@/lib/booking-subject';
import type { BookingSubjectConsentStatus } from '@/lib/booking-subject-legal';
export function useBookingSubjectConsent(uid: string | undefined, business: ConsentBusiness, subjectCase: BookingSubjectCase) {
  const key = uid ? JSON.stringify([uid, business.id, business.name, business.phoneWhatsApp, subjectCase]) : null, identity = useRef({ key });
  if (identity.current.key !== key) identity.current = { key };
  const current = identity.current, request = useRef<AbortController | null>(null), pending = useRef<{ key: string; body: string } | null>(null);
  const [action, setAction] = useState<{ identity: object; busy: boolean; error: string | null } | null>(null), [withdrawn, setWithdrawn] = useState<object | null>(null);
  const validate = (status: BookingSubjectConsentStatus) => {
    if (!status || typeof status.active !== 'boolean' || typeof status.required !== 'boolean' || !Number.isSafeInteger(status.revision) || !/^[a-f0-9]{64}$/.test(status.documents?.fingerprint ?? '') || status.documents.business.id !== business.id || status.documents.case.bookingRequestId !== subjectCase.bookingRequestId || status.documents.case.subjectKind !== subjectCase.subjectKind || (subjectCase.subjectKind === 'represented_minor' && (status.documents.case.subjectKind !== 'represented_minor' || status.documents.case.representativeRole !== subjectCase.representativeRole)) || (status.receipt && status.receipt.uid !== uid)) throw new Error('No se pudieron comprobar los permisos de esta reserva.');
    return status;
  };
  const poll = useApiPoll<BookingSubjectConsentStatus>(key, async signal => {
    const query = new URLSearchParams({ businessId: business.id, ...subjectCase });
    return validate(await apiFetch<BookingSubjectConsentStatus>(`/api/booking-subject-consent?${query}`, { signal }, uid));
  });
  useEffect(() => () => { request.current?.abort(); request.current = null; pending.current = null; }, [key]);
  const ownAction = action?.identity === current ? action : null, withdrawalRequested = withdrawn === current;
  const active = !withdrawalRequested && Boolean(poll.value && (!poll.value.required || poll.value.active)) && !poll.loading && !poll.error;
  async function decide(decision: 'accept' | 'revoke', decisions?: BookingSubjectDecisions) {
    if (!key || request.current || !poll.value || (withdrawalRequested && decision === 'accept')) return;
    const abort = request.current = new AbortController(), status = poll.value;
    const operationKey = JSON.stringify([key, decision, decision === 'revoke' ? null : [status.revision, status.documents.fingerprint, decisions]]);
    setAction({ identity: current, busy: true, error: null });
    if (decision === 'revoke') { setWithdrawn(current); poll.setValue(previous => previous && { ...previous, active: false }); }
    try {
      const body = pending.current?.key === operationKey ? pending.current.body : JSON.stringify({ businessId: business.id, case: subjectCase, action: decision, requestId: crypto.randomUUID(), expectedRevision: status.revision, ...(decision === 'accept' ? { fingerprint: status.documents.fingerprint, decisions } : {}) });
      pending.current = { key: operationKey, body };
      const result = validate(await apiFetch<BookingSubjectConsentStatus>('/api/booking-subject-consent', { method: 'POST', body, signal: abort.signal }, uid));
      if (identity.current !== current || abort.signal.aborted) return;
      poll.setValue(result); pending.current = null; setWithdrawn(null);
    } catch (cause) {
      if (identity.current === current && !abort.signal.aborted) {
        setAction({ identity: current, busy: false, error: errorMessage(cause) });
        if (cause instanceof ApiError && [409, 428].includes(cause.status)) { pending.current = null; poll.refresh(); }
      }
    } finally { if (identity.current === current && !abort.signal.aborted) setAction(previous => previous?.identity === current ? { ...previous, busy: false } : previous); if (request.current === abort) request.current = null; }
  }
  function downloadReceipt() {
    if (!poll.value?.receipt) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(poll.value.receipt, null, 2)], { type: 'application/json' })), link = document.createElement('a'); link.href = url; link.download = 'sarin-autorizacion-reserva.json'; link.click(); URL.revokeObjectURL(url);
  }
  return { active, withdrawalRequested, status: poll.value, loading: poll.loading, busy: ownAction?.busy ?? false, error: ownAction?.error ?? poll.error, accept: (decisions: BookingSubjectDecisions) => decide('accept', decisions), revoke: () => decide('revoke'), refresh: poll.refresh, downloadReceipt };
}
export type BookingSubjectConsentController = ReturnType<typeof useBookingSubjectConsent>;
