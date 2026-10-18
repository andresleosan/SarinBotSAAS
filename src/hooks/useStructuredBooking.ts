"use client";
import { useEffect, useRef, useState } from 'react';
import { apiFetch, ApiError, errorMessage } from '@/lib/client/api';
import type { BookingSubjectCase, BookingBeneficiary } from '@/lib/booking-subject';
import type { BookingProposalView } from '@/types/chat';
import type { Appointment } from '@/types/firestore';
import { NEXT_AVAILABILITY_DAYS, type AvailabilitySlots, type NextAvailabilityResult } from '@/lib/booking-availability';
type Selection = { serviceId: string; resourceId: string; dateKey: string; startTimeStr: string };
type Slots = AvailabilitySlots;
type AvailabilityStatus = 'idle' | 'loading' | 'success' | 'error';
type NextAvailabilityStatus = 'idle' | 'loading' | 'found' | 'empty' | 'error';
type NextAvailabilityRange = Pick<NextAvailabilityResult, 'fromDateKey' | 'throughDateKey'>;
const colombianToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(Date.now());
function validDateKey(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
function validSlots(value: unknown): value is Slots {
  return Array.isArray(value) && value.every(item => item && typeof item.resourceId === 'string' && item.resourceId.length > 0 && typeof item.resourceName === 'string' && Array.isArray(item.slots) && item.slots.every((slot: unknown) => typeof slot === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(slot)));
}
function validNextResult(value: unknown, selected: Selection, today: string): value is NextAvailabilityResult {
  if (!value || typeof value !== 'object') return false;
  const result = value as Partial<NextAvailabilityResult>;
  if (!validDateKey(result.fromDateKey) || !validDateKey(result.throughDateKey) || result.fromDateKey <= selected.dateKey || result.fromDateKey < today || result.throughDateKey < result.fromDateKey || !validSlots(result.availability)) return false;
  const days = (Date.parse(result.throughDateKey) - Date.parse(result.fromDateKey)) / 86400000;
  if (days >= NEXT_AVAILABILITY_DAYS || (selected.resourceId && result.availability.some(item => item.resourceId !== selected.resourceId))) return false;
  return result.dateKey === null
    ? !result.availability.some(item => item.slots.length > 0)
    : validDateKey(result.dateKey) && result.dateKey >= result.fromDateKey && result.dateKey <= result.throughDateKey && result.availability.some(item => item.slots.length > 0);
}
export function useStructuredBooking(uid: string | undefined, business: { id: string }, subjectCase: BookingSubjectCase, subjectActive: boolean, initialServiceId = '', initialHint?: { dateKey: string; resourceId?: string | null }) {
  const key = uid ? JSON.stringify([uid, business.id, subjectCase]) : null, identity = useRef({ key });
  if (identity.current.key !== key) identity.current = { key };
  const current = identity.current;
  const initialService = useRef({ identity: current, serviceId: initialServiceId, dateKey: validDateKey(initialHint?.dateKey) ? initialHint.dateKey : colombianToday(), resourceId: initialHint?.resourceId ?? '' });
  const initial = () => ({ identity: current, selection: { serviceId: initialService.current.identity === current ? initialService.current.serviceId : '', resourceId: initialService.current.identity === current ? initialService.current.resourceId : '', dateKey: initialService.current.identity === current ? initialService.current.dateKey : colombianToday(), startTimeStr: '' }, availability: [] as Slots, availabilityStatus: 'idle' as AvailabilityStatus, nextAvailabilityStatus: 'idle' as NextAvailabilityStatus, nextAvailabilityRange: null as NextAvailabilityRange | null, proposal: null as BookingProposalView | null, appointment: null as Appointment | null, busy: false, frozen: false, uncertain: false, error: null as string | null });
  const [stored, setStored] = useState(initial), state = stored.identity === current ? stored : initial();
  const latest = useRef(state); latest.current = state;
  const permission = useRef(subjectActive); permission.current = subjectActive;
  const mounted = useRef<object | null>(null);
  const selection = useRef(state.selection); selection.current = state.selection;
  const availabilityRequest = useRef<AbortController | null>(null), mutation = useRef<AbortController | null>(null), proposalRequest = useRef<{ identity: object; body: string; beneficiary: BookingBeneficiary } | null>(null), confirmation = useRef<{ identity: object; path: string; body: string; uncertain: boolean } | null>(null);
  const update = (patch: Partial<ReturnType<typeof initial>>) => { if (identity.current === current && mounted.current === current) { const next = { ...latest.current, ...patch, identity: current }; latest.current = next; setStored(next); } };
  useEffect(() => {
    mounted.current = current;
    return () => { mounted.current = null; availabilityRequest.current?.abort(); mutation.current?.abort(); availabilityRequest.current = null; mutation.current = null; proposalRequest.current = null; confirmation.current = null; };
  }, [key]);
  useEffect(() => {
    if (!subjectActive) { availabilityRequest.current?.abort(); availabilityRequest.current = null; update({ availability: [], availabilityStatus: 'idle', nextAvailabilityStatus: 'idle', nextAvailabilityRange: null }); }
  }, [key, subjectActive]);
  const canReadAvailability = () => Boolean(uid && identity.current === current && mounted.current === current && permission.current && !latest.current.frozen && !latest.current.proposal && !latest.current.appointment && !latest.current.busy && !latest.current.uncertain && !mutation.current && proposalRequest.current?.identity !== current && confirmation.current?.identity !== current);
  function setSelection(value: Selection) {
    if (!canReadAvailability()) return;
    availabilityRequest.current?.abort(); availabilityRequest.current = null; selection.current = value; update({ selection: value, availability: [], availabilityStatus: 'idle', nextAvailabilityStatus: 'idle', nextAvailabilityRange: null, error: null });
  }
  async function loadAvailability() {
    const selected = selection.current;
    if (!canReadAvailability() || !selected.serviceId || !selected.dateKey) return;
    availabilityRequest.current?.abort(); const abort = availabilityRequest.current = new AbortController(); update({ availabilityStatus: 'loading', nextAvailabilityStatus: 'idle', nextAvailabilityRange: null, error: null, availability: [] });
    try {
      const data = await apiFetch<{ availability: Slots }>(`/api/businesses/${encodeURIComponent(business.id)}/availability`, { method: 'POST', signal: abort.signal, body: JSON.stringify({ case: subjectCase, dateKey: selected.dateKey, serviceId: selected.serviceId, ...(selected.resourceId ? { resourceId: selected.resourceId } : {}) }) }, uid);
      if (!canReadAvailability() || abort.signal.aborted || availabilityRequest.current !== abort) return;
      if (!validSlots(data?.availability)) throw new Error('No se pudo comprobar la disponibilidad.');
      update({ availability: data.availability, availabilityStatus: 'success' });
    } catch (cause) { if (canReadAvailability() && !abort.signal.aborted && availabilityRequest.current === abort) update({ error: errorMessage(cause), availabilityStatus: 'error' }); }
    finally { if (identity.current === current && !abort.signal.aborted && availabilityRequest.current === abort) availabilityRequest.current = null; }
  }
  async function findNextAvailability() {
    const selected = selection.current;
    if (!canReadAvailability() || !selected.serviceId || !validDateKey(selected.dateKey) || latest.current.availabilityStatus !== 'success' || latest.current.availability.some(item => item.slots.length > 0) || latest.current.nextAvailabilityStatus === 'loading') return;
    availabilityRequest.current?.abort(); const abort = availabilityRequest.current = new AbortController();
    update({ nextAvailabilityStatus: 'loading', nextAvailabilityRange: null, error: null });
    try {
      const data = await apiFetch<{ nextAvailability: NextAvailabilityResult }>(`/api/businesses/${encodeURIComponent(business.id)}/availability/next`, { method: 'POST', signal: abort.signal, body: JSON.stringify({ case: subjectCase, afterDateKey: selected.dateKey, serviceId: selected.serviceId, ...(selected.resourceId ? { resourceId: selected.resourceId } : {}) }) }, uid);
      if (!canReadAvailability() || abort.signal.aborted || availabilityRequest.current !== abort) return;
      if (!validNextResult(data?.nextAvailability, selected, colombianToday())) throw new Error('No se pudo comprobar la próxima fecha disponible. Intenta otra vez.');
      const result = data.nextAvailability, range = { fromDateKey: result.fromDateKey, throughDateKey: result.throughDateKey };
      if (result.dateKey) {
        const nextSelection = { ...selected, dateKey: result.dateKey, startTimeStr: '' }; selection.current = nextSelection;
        update({ selection: nextSelection, availability: result.availability, availabilityStatus: 'success', nextAvailabilityStatus: 'found', nextAvailabilityRange: range });
      } else update({ nextAvailabilityStatus: 'empty', nextAvailabilityRange: range });
    } catch (cause) { if (canReadAvailability() && !abort.signal.aborted && availabilityRequest.current === abort) update({ error: errorMessage(cause), nextAvailabilityStatus: 'error' }); }
    finally { if (identity.current === current && availabilityRequest.current === abort) availabilityRequest.current = null; }
  }
  async function propose(beneficiary: BookingBeneficiary) {
    if (!uid || identity.current !== current || mounted.current !== current || !permission.current || mutation.current) return;
    const body = JSON.stringify({ case: subjectCase, beneficiary, selection: selection.current }), saved = proposalRequest.current?.identity === current ? proposalRequest.current : null;
    if (saved && saved.body !== body) { update({ error: 'Inicia una nueva reserva para cambiar los datos.' }); return; }
    availabilityRequest.current?.abort(); availabilityRequest.current = null;
    proposalRequest.current = { identity: current, body, beneficiary }; const abort = mutation.current = new AbortController(); update({ busy: true, frozen: true, nextAvailabilityStatus: 'idle', nextAvailabilityRange: null, error: null });
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
        const terminal = cause instanceof ApiError && (cause.code === 'BOOKING_PROPOSAL_CLOSED' || (!operation.uncertain && [400, 403, 404, 409, 428].includes(cause.status)));
        if (terminal) { confirmation.current = null; update({ uncertain: false }); }
        else operation.uncertain = true;
      }
    } finally { if (identity.current === current && !abort.signal.aborted) update({ busy: false }); if (mutation.current === abort) mutation.current = null; }
  }
  async function confirm(id: string, contact: { clientPhone: string; intakeAnswers: Record<string, string> }) {
    if (confirmation.current?.identity === current) return sendConfirmation(confirmation.current);
    if (!uid || identity.current !== current || mounted.current !== current || !permission.current || !latest.current.proposal || latest.current.proposal.id !== id || proposalRequest.current?.identity !== current || latest.current.appointment) return;
    const operation = { identity: current, path: `/api/businesses/${encodeURIComponent(business.id)}/booking-proposals/${encodeURIComponent(id)}/confirm`, body: JSON.stringify({ confirm: true, ...contact, beneficiary: proposalRequest.current.beneficiary }), uncertain: false };
    confirmation.current = operation; return sendConfirmation(operation);
  }
  return { ...state, loadingAvailability: state.availabilityStatus === 'loading', setSelection, loadAvailability, findNextAvailability, propose, confirm, retryConfirmation: async () => { if (confirmation.current?.identity === current) await sendConfirmation(confirmation.current); } };
}
