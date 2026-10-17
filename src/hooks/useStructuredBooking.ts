"use client";
import { useEffect, useRef, useState } from 'react';
import { apiFetch, ApiError, errorMessage } from '@/lib/client/api';
import type { BookingSubjectCase, BookingBeneficiary } from '@/lib/booking-subject';
import type { BookingProposalView } from '@/types/chat';
import type { Appointment } from '@/types/firestore';
type Selection = { serviceId: string; resourceId: string; dateKey: string; startTimeStr: string };
type Slots = { resourceId: string; resourceName: string; slots: string[] }[];
export function useStructuredBooking(uid: string | undefined, business: { id: string }, subjectCase: BookingSubjectCase, subjectActive: boolean) {
  const key = uid ? JSON.stringify([uid, business.id, subjectCase]) : null, identity = useRef({ key });
  if (identity.current.key !== key) identity.current = { key };
  const current = identity.current;
  const initial = () => ({ identity: current, selection: { serviceId: '', resourceId: '', dateKey: new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(Date.now()), startTimeStr: '' }, availability: [] as Slots, proposal: null as BookingProposalView | null, appointment: null as Appointment | null, busy: false, loadingAvailability: false, frozen: false, uncertain: false, error: null as string | null });
  const [stored, setStored] = useState(initial), state = stored.identity === current ? stored : initial();
  const selection = useRef(state.selection); selection.current = state.selection;
  const availabilityRequest = useRef<AbortController | null>(null), mutation = useRef<AbortController | null>(null), proposalRequest = useRef<{ identity: object; body: string; beneficiary: BookingBeneficiary } | null>(null), confirmation = useRef<{ identity: object; path: string; body: string } | null>(null);
  const update = (patch: Partial<ReturnType<typeof initial>>) => { if (identity.current === current) setStored(previous => ({ ...(previous.identity === current ? previous : initial()), ...patch, identity: current })); };
  useEffect(() => () => { availabilityRequest.current?.abort(); mutation.current?.abort(); availabilityRequest.current = null; mutation.current = null; proposalRequest.current = null; confirmation.current = null; }, [key]);
  function setSelection(value: Selection) {
    if (proposalRequest.current?.identity === current || confirmation.current?.identity === current) return;
    availabilityRequest.current?.abort(); availabilityRequest.current = null; selection.current = value; update({ selection: value, availability: [], loadingAvailability: false, error: null });
  }
  async function loadAvailability() {
    const selected = selection.current;
    if (!uid || !subjectActive || !selected.serviceId || !selected.dateKey || state.frozen) return;
    availabilityRequest.current?.abort(); const abort = availabilityRequest.current = new AbortController(); update({ loadingAvailability: true, error: null, availability: [] });
    try {
      const data = await apiFetch<{ availability: Slots }>(`/api/businesses/${encodeURIComponent(business.id)}/availability`, { method: 'POST', signal: abort.signal, body: JSON.stringify({ case: subjectCase, dateKey: selected.dateKey, serviceId: selected.serviceId, ...(selected.resourceId ? { resourceId: selected.resourceId } : {}) }) }, uid);
      if (identity.current !== current || abort.signal.aborted || availabilityRequest.current !== abort) return;
      if (!Array.isArray(data.availability) || data.availability.some(item => typeof item.resourceId !== 'string' || !Array.isArray(item.slots) || item.slots.some(slot => !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(slot)))) throw new Error('No se pudo comprobar la disponibilidad.');
      update({ availability: data.availability });
    } catch (cause) { if (identity.current === current && !abort.signal.aborted) update({ error: errorMessage(cause) }); }
    finally { if (identity.current === current && !abort.signal.aborted && availabilityRequest.current === abort) { update({ loadingAvailability: false }); availabilityRequest.current = null; } }
  }
  async function propose(beneficiary: BookingBeneficiary) {
    if (!uid || !subjectActive || mutation.current) return;
    const body = JSON.stringify({ case: subjectCase, beneficiary, selection: selection.current }), saved = proposalRequest.current?.identity === current ? proposalRequest.current : null;
    if (saved && saved.body !== body) { update({ error: 'Inicia una nueva reserva para cambiar los datos.' }); return; }
    proposalRequest.current = { identity: current, body, beneficiary }; const abort = mutation.current = new AbortController(); update({ busy: true, frozen: true, error: null });
    try {
      const result = await apiFetch<{ proposal: BookingProposalView }>(`/api/businesses/${encodeURIComponent(business.id)}/booking-proposals`, { method: 'POST', body, signal: abort.signal }, uid);
      if (identity.current !== current || abort.signal.aborted) return;
      if (!result.proposal?.id || result.proposal.businessId !== business.id) throw new Error('No se pudo validar la propuesta.');
      update({ proposal: result.proposal });
    } catch (cause) { if (identity.current === current && !abort.signal.aborted) update({ error: errorMessage(cause) }); }
    finally { if (identity.current === current && !abort.signal.aborted) update({ busy: false }); if (mutation.current === abort) mutation.current = null; }
  }
  async function sendConfirmation(operation: NonNullable<typeof confirmation.current>) {
    if (!uid || mutation.current || operation.identity !== current) return;
    const abort = mutation.current = new AbortController(); update({ busy: true, uncertain: true, error: null });
    try {
      const result = await apiFetch<{ appointment: Appointment }>(operation.path, { method: 'POST', body: operation.body, signal: abort.signal }, uid);
      if (identity.current !== current || abort.signal.aborted) return;
      if (!result.appointment?.id || result.appointment.tenantId !== business.id || result.appointment.client?.uid !== uid) throw new Error('No se pudo comprobar la confirmación. Consulta Mis citas o recupera la respuesta.');
      confirmation.current = null; update({ appointment: result.appointment, uncertain: false });
    } catch (cause) {
      if (identity.current === current && !abort.signal.aborted) {
        update({ error: errorMessage(cause) });
        if (cause instanceof ApiError && [400, 403, 404, 409, 428].includes(cause.status)) { confirmation.current = null; update({ uncertain: false }); }
      }
    } finally { if (identity.current === current && !abort.signal.aborted) update({ busy: false }); if (mutation.current === abort) mutation.current = null; }
  }
  async function confirm(id: string, contact: { clientPhone: string; intakeAnswers: Record<string, string> }) {
    if (confirmation.current?.identity === current) return sendConfirmation(confirmation.current);
    if (!subjectActive || !state.proposal || state.proposal.id !== id || proposalRequest.current?.identity !== current || state.appointment) return;
    const operation = { identity: current, path: `/api/businesses/${encodeURIComponent(business.id)}/booking-proposals/${encodeURIComponent(id)}/confirm`, body: JSON.stringify({ confirm: true, ...contact, beneficiary: proposalRequest.current.beneficiary }) };
    confirmation.current = operation; return sendConfirmation(operation);
  }
  return { ...state, setSelection, loadAvailability, propose, confirm, retryConfirmation: async () => { if (confirmation.current?.identity === current) await sendConfirmation(confirmation.current); } };
}
