"use client";

import { useEffect, useRef, useState } from 'react';
import { apiFetch, ApiError, errorMessage } from '@/lib/client/api';
import { appointmentRescheduleViewSchema, rescheduleResultSchema, type RescheduleResult } from '@/lib/appointment-reschedule';
import type { BookingSubjectCase } from '@/lib/booking-subject';
import type { AvailabilitySlots } from '@/lib/booking-availability';
import type { Appointment } from '@/types/firestore';
import type { BookingProposalView } from '@/types/chat';

type Selection = { dateKey: string; resourceId: string; startTimeStr: string };
type AvailabilityStatus = 'idle' | 'loading' | 'success' | 'error';
function validSlots(value: unknown): value is AvailabilitySlots {
  return Array.isArray(value) && value.every(item => item && typeof item.resourceId === 'string' && item.resourceId && typeof item.resourceName === 'string' && Array.isArray(item.slots) && item.slots.every((slot: unknown) => typeof slot === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(slot)));
}
const timestamp = (date: string, time: string) => Date.parse(`${date}T${time}:00-05:00`);

export function useAppointmentReschedule(uid: string | undefined, business: { id: string }, source: Appointment, requestId: string, subjectCase: BookingSubjectCase | undefined, enabled: boolean, contextKey: string, initialResourceId = source.resourceId) {
  const key = JSON.stringify([uid, business.id, source, requestId, subjectCase]), identity = useRef({ key });
  if (identity.current.key !== key) identity.current = { key };
  const current = identity.current, mounted = useRef<object | null>(null);
  const context = useRef({ identity: current, key: contextKey });
  if (context.current.identity !== current) context.current = { identity: current, key: contextKey };
  const contextCurrent = context.current.key === contextKey;
  const permission = useRef(false); permission.current = enabled && contextCurrent;
  const initial = () => ({ identity: current, selection: { dateKey: '', startTimeStr: '', resourceId: initialResourceId }, availability: [] as AvailabilitySlots, availabilityStatus: 'idle' as AvailabilityStatus, proposal: null as BookingProposalView | null, result: null as RescheduleResult | null, busy: false, frozen: false, uncertain: false, error: null as string | null });
  const [stored, setStored] = useState(initial), state = stored.identity === current ? stored : initial();
  const latest = useRef(state); latest.current = state;
  const selected = useRef(state.selection); selected.current = state.selection;
  const availabilityRequest = useRef<AbortController | null>(null), mutation = useRef<AbortController | null>(null);
  const proposalRequest = useRef<{ identity: object; body: string } | null>(null);
  const confirmation = useRef<{ identity: object; path: string; body: string; proposal: BookingProposalView; uncertain: boolean } | null>(null);
  const sourceRevision = source.rescheduleRevision ?? 0;
  const update = (patch: Partial<ReturnType<typeof initial>>) => {
    if (identity.current !== current || mounted.current !== current) return;
    const next = { ...latest.current, ...patch, identity: current }; latest.current = next; setStored(next);
  };
  useEffect(() => {
    mounted.current = current;
    return () => { mounted.current = null; availabilityRequest.current?.abort(); mutation.current?.abort(); availabilityRequest.current = null; mutation.current = null; proposalRequest.current = null; confirmation.current = null; };
  }, [key]);
  useEffect(() => {
    if (!enabled || !contextCurrent) {
      availabilityRequest.current?.abort(); availabilityRequest.current = null;
      if (!confirmation.current) { mutation.current?.abort(); mutation.current = null; update({ busy: false }); }
      update({ availability: [], availabilityStatus: 'idle' });
    }
  }, [key, enabled, contextCurrent]);
  const authorized = () => Boolean(uid && identity.current === current && mounted.current === current && permission.current && Number.isSafeInteger(sourceRevision) && sourceRevision >= 0 && source.status === 'confirmed' && source.startAt > Date.now());
  const canSelect = () => authorized() && !latest.current.frozen && !latest.current.busy && !latest.current.uncertain && !latest.current.result && !mutation.current;
  function setSelection(value: Selection) {
    if (!canSelect()) return;
    const offered = value.dateKey === selected.current.dateKey && latest.current.availabilityStatus === 'success' && latest.current.availability.some(item => item.resourceId === value.resourceId && item.slots.includes(value.startTimeStr));
    availabilityRequest.current?.abort(); availabilityRequest.current = null; selected.current = value;
    update({ selection: value, ...(!offered ? { availability: [], availabilityStatus: 'idle' as const } : {}), error: null });
  }
  async function loadAvailability() {
    const selection = selected.current;
    if (!canSelect() || !selection.dateKey) return;
    availabilityRequest.current?.abort(); const abort = availabilityRequest.current = new AbortController();
    update({ availability: [], availabilityStatus: 'loading', error: null });
    try {
      const response = await apiFetch<{ availability: AvailabilitySlots }>(`/api/businesses/${encodeURIComponent(business.id)}/reschedule/availability`, { method: 'POST', signal: abort.signal, body: JSON.stringify({ appointmentId: source.id, sourceRevision, dateKey: selection.dateKey, ...(selection.resourceId ? { resourceId: selection.resourceId } : {}), ...(subjectCase ? { case: subjectCase } : {}) }) }, uid);
      if (!canSelect() || abort.signal.aborted || availabilityRequest.current !== abort) return;
      if (!validSlots(response?.availability) || (selection.resourceId && response.availability.some(item => item.resourceId !== selection.resourceId))) throw new Error('No se pudo comprobar la disponibilidad.');
      update({ availability: response.availability, availabilityStatus: 'success' });
    } catch (cause) { if (canSelect() && !abort.signal.aborted && availabilityRequest.current === abort) update({ error: errorMessage(cause), availabilityStatus: 'error' }); }
    finally { if (identity.current === current && availabilityRequest.current === abort) availabilityRequest.current = null; }
  }
  function validProposal(proposal: BookingProposalView): boolean {
    const parsed = appointmentRescheduleViewSchema.safeParse(proposal?.reschedule);
    if (!parsed.success) return false;
    const value = parsed.data, selection = selected.current;
    return Boolean(proposal.id && proposal.businessId === business.id && value.appointmentId === source.id && value.sourceRevision === sourceRevision && value.source.dateKey === source.dateKey && value.source.startTimeStr === source.startTimeStr && value.source.endTimeStr === source.endTimeStr && value.source.resourceId === source.resourceId && (value.source.priceCOP === undefined || value.source.priceCOP === source.price) && value.targetServiceId === source.serviceId && value.targetResourceId === selection.resourceId && proposal.dateKey === selection.dateKey && proposal.startTimeStr === selection.startTimeStr && Number.isFinite(proposal.priceCOP) && proposal.priceCOP >= 0 && Number.isFinite(proposal.expiresAt) && timestamp(proposal.dateKey, proposal.endTimeStr) > timestamp(proposal.dateKey, proposal.startTimeStr) && JSON.stringify(proposal.subjectCase) === JSON.stringify(subjectCase));
  }
  async function propose() {
    if (!authorized() || mutation.current || latest.current.proposal || latest.current.result || latest.current.uncertain) return;
    const selection = selected.current;
    const body = JSON.stringify({ appointmentId: source.id, sourceRevision, requestId, selection, ...(subjectCase ? { case: subjectCase } : {}) });
    const saved = proposalRequest.current?.identity === current ? proposalRequest.current : null;
    if (saved ? saved.body !== body : latest.current.availabilityStatus !== 'success' || !latest.current.availability.some(item => item.resourceId === selection.resourceId && item.slots.includes(selection.startTimeStr))) return;
    if (selection.dateKey === source.dateKey && selection.startTimeStr === source.startTimeStr && selection.resourceId === source.resourceId) { update({ error: 'Elige un horario diferente al actual.' }); return; }
    availabilityRequest.current?.abort(); availabilityRequest.current = null;
    proposalRequest.current = { identity: current, body }; const abort = mutation.current = new AbortController(); update({ busy: true, frozen: true, error: null });
    try {
      const response = await apiFetch<{ proposal: BookingProposalView }>(`/api/businesses/${encodeURIComponent(business.id)}/reschedule/proposals`, { method: 'POST', signal: abort.signal, body }, uid);
      if (!authorized() || abort.signal.aborted) return;
      if (!validProposal(response?.proposal)) throw new Error('No se pudo validar la propuesta de cambio.');
      update({ proposal: response.proposal });
    } catch (cause) { if (identity.current === current && !abort.signal.aborted) update({ error: errorMessage(cause) }); }
    finally { if (identity.current === current && !abort.signal.aborted) update({ busy: false }); if (mutation.current === abort) mutation.current = null; }
  }
  async function sendConfirmation(operation: NonNullable<typeof confirmation.current>) {
    if (!uid || identity.current !== current || mounted.current !== current || operation.identity !== current || mutation.current) return;
    const abort = mutation.current = new AbortController(); update({ busy: true, uncertain: true, error: null });
    try {
      const response = await apiFetch<{ appointment: Appointment; rescheduleResult?: RescheduleResult }>(operation.path, { method: 'POST', signal: abort.signal, body: operation.body }, uid);
      if (identity.current !== current || mounted.current !== current || abort.signal.aborted) return;
      const parsed = rescheduleResultSchema.safeParse(response?.rescheduleResult), appointment = response?.appointment, proposal = operation.proposal;
      if (!parsed.success) throw new Error('Falta comprobar el cambio. Recupera la misma confirmación y revisa Mis citas.');
      const result = parsed.data, revision = appointment?.rescheduleRevision;
      const proofMatches = result.proposalId === proposal.id && result.appointmentId === source.id && result.revision === sourceRevision + 1
        && result.dateKey === proposal.dateKey && result.startTimeStr === proposal.startTimeStr && result.resourceId === proposal.reschedule!.targetResourceId
        && result.startAt === timestamp(proposal.dateKey, proposal.startTimeStr) && result.endAt === timestamp(proposal.dateKey, proposal.endTimeStr) && result.endAt > result.startAt;
      const currentMatches = appointment?.id === source.id && appointment.tenantId === business.id && appointment.client?.uid === uid && appointment.type === 'appointment'
        && appointment.serviceId === source.serviceId && Number.isSafeInteger(revision) && revision! >= result.revision
        && (revision !== result.revision || (appointment.dateKey === result.dateKey && appointment.startTimeStr === result.startTimeStr && appointment.endTimeStr === proposal.endTimeStr
          && appointment.resourceId === result.resourceId && appointment.startAt === result.startAt && appointment.endAt === result.endAt));
      if (!proofMatches || !currentMatches) throw new Error('No se pudo comprobar el resultado del cambio. Recupera la misma confirmación y revisa Mis citas.');
      confirmation.current = null; update({ result, uncertain: false });
    } catch (cause) {
      if (identity.current === current && !abort.signal.aborted) {
        update({ error: errorMessage(cause) });
        const terminal = cause instanceof ApiError && (cause.code === 'BOOKING_PROPOSAL_CLOSED' || (!operation.uncertain && [400, 403, 404, 409, 428].includes(cause.status)));
        if (terminal) { confirmation.current = null; update({ uncertain: false }); }
        else operation.uncertain = true;
      }
    } finally { if (identity.current === current && !abort.signal.aborted) update({ busy: false }); if (mutation.current === abort) mutation.current = null; }
  }
  async function confirm() {
    if (confirmation.current?.identity === current) return sendConfirmation(confirmation.current);
    if (!authorized() || !latest.current.proposal || latest.current.result || mutation.current || proposalRequest.current?.identity !== current) return;
    const proposal = latest.current.proposal;
    const operation = { identity: current, path: `/api/businesses/${encodeURIComponent(business.id)}/booking-proposals/${encodeURIComponent(proposal.id)}/confirm`, body: JSON.stringify({ confirm: true, clientPhone: null, intakeAnswers: {}, ...(source.beneficiary ? { beneficiary: source.beneficiary } : {}) }), proposal, uncertain: false };
    confirmation.current = operation; return sendConfirmation(operation);
  }
  return { ...state, contextCurrent, setSelection, loadAvailability, propose, confirm, retryConfirmation: async () => { if (confirmation.current?.identity === current) await sendConfirmation(confirmation.current); } };
}
