"use client";
import { useEffect, useReducer, useRef } from 'react';
import { z } from 'zod';
import type { Business, TenantResource } from '@/types/firestore';
import { useOwnerAuthority } from '@/hooks/use-owner-authority';
import { ownerApiFetch, type OwnerRequestScope } from '@/lib/client/owner-request-scope';
import { ApiError, errorMessage } from '@/lib/client/api';
import {
  ownerRescheduleSourceSchema, ownerRescheduleCommandSchema, ownerRescheduleAvailabilitySchema,
  ownerRescheduleProposalViewSchema, ownerRescheduleRecoverySchema, ownerRescheduleConfirmationSchema,
  type OwnerRescheduleSource, type OwnerRescheduleTarget, type OwnerRescheduleProposalView, type OwnerRescheduleRecovery,
  type OwnerRescheduleEntry, type OwnerRescheduleCommand, type AvailabilitySlots,
} from '@/lib/owner-rescheduling';

export type OwnerRescheduleController = {
  source: OwnerRescheduleSource | null; selection: OwnerRescheduleTarget; availability: AvailabilitySlots;
  proposal: OwnerRescheduleProposalView | null; recovery: OwnerRescheduleRecovery | null;
  stage: 'source' | 'selection' | 'review' | 'result'; availabilityStatus: 'idle' | 'loading' | 'success' | 'error';
  frozen: boolean; busy: boolean; uncertain: boolean; error: string | null;
  resources: TenantResource[]; readBusy: boolean; canClose: boolean; canRestart: boolean; message: string | null;
  loadSource: () => Promise<void>; retryInitialRead: () => Promise<void>; setSelection: (target: OwnerRescheduleTarget) => void;
  loadAvailability: () => Promise<void>; prepare: () => Promise<void>; confirm: () => Promise<void>; recover: () => Promise<void>;
};
type Input = { ownerUid: string; authEpoch: number; businessId: string; entry: OwnerRescheduleEntry; enabled: boolean; business?: Pick<Business, 'resources' | 'services'>; requestScope?: OwnerRequestScope };
type Mutation = { path: string; body: string; active: boolean; ambiguous: boolean; abort: AbortController; version: number; command?: OwnerRescheduleCommand };
type Session = {
  key: string; live: boolean; entry: OwnerRescheduleEntry; initialRequested: boolean;
  source: OwnerRescheduleSource | null; selection: OwnerRescheduleTarget; availability: AvailabilitySlots;
  availabilityStatus: OwnerRescheduleController['availabilityStatus']; availableFor: string | null;
  proposal: OwnerRescheduleProposalView | null; recovery: OwnerRescheduleRecovery | null; stage: OwnerRescheduleController['stage'];
  frozen: boolean; uncertain: boolean; error: string | null; message: string | null; canRestart: boolean;
  reading: { cancel: () => void; generation: number } | null; readGeneration: number; postVersion: number;
  preparation: Mutation | null; confirmation: Mutation | null; timers: Set<ReturnType<typeof setTimeout>>;
};
const blankSelection = (): OwnerRescheduleTarget => ({ dateKey: '', resourceId: '', startTimeStr: '' });
const invalid = () => new Error('No pudimos verificar la respuesta. Comprueba el mismo cambio antes de continuar.');
const slotsSchema = z.object({ availability: z.array(z.object({ resourceId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/), resourceName: z.string(), slots: z.array(z.string().length(5).regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/)) }).strict()).refine(items => new Set(items.map(item => item.resourceId)).size === items.length) }).strict();
const selectionKey = (selection: OwnerRescheduleTarget) => JSON.stringify([selection.dateKey, selection.resourceId]);

export function useOwnerReschedule(input: Input): OwnerRescheduleController {
  const fallback = useOwnerAuthority(input), requestScope = input.requestScope ?? fallback.requestScope;
  const latest = useRef({ input, requestScope }); latest.current = { input, requestScope };
  const key = JSON.stringify([input.ownerUid, input.authEpoch, input.businessId]);
  const state = useRef<Session | null>(null), [, render] = useReducer(value => value + 1, 0);
  if (!state.current || state.current.key !== key) state.current = { key, live: true, entry: { ...input.entry }, initialRequested: false, source: null, selection: blankSelection(), availability: [], availabilityStatus: 'idle', availableFor: null, proposal: null, recovery: null, stage: 'source', frozen: false, uncertain: 'proposalId' in input.entry, error: null, message: null, canRestart: false, reading: null, readGeneration: 0, postVersion: 0, preparation: null, confirmation: null, timers: new Set() };
  const session = state.current;
  const current = () => state.current === session && session.live && latest.current.requestScope.isCurrent()
    && latest.current.requestScope.ownerUid === input.ownerUid && latest.current.requestScope.authEpoch === input.authEpoch && latest.current.requestScope.businessId === input.businessId;
  const canRead = () => current() && latest.current.input.enabled && latest.current.requestScope.canRead();
  const publish = () => { if (current()) render(); };
  const resourceOptions = () => {
    const catalog = latest.current.input.business, serviceId = session.recovery?.appointment.serviceId ?? session.source?.appointment.serviceId ?? session.proposal?.target.serviceId;
    const service = catalog?.services.find(item => item.id === serviceId);
    return catalog?.resources.filter(resource => resource.active && service?.resourceIds.includes(resource.id)) ?? [];
  };
  const cancelRead = () => { session.readGeneration++; session.reading?.cancel(); session.reading = null; };
  const dispose = () => {
    session.live = false; cancelRead(); session.preparation?.abort.abort(); session.confirmation?.abort.abort();
    session.preparation = null; session.confirmation = null; session.source = null; session.proposal = null; session.recovery = null; session.initialRequested = false;
    for (const timer of session.timers) clearTimeout(timer); session.timers.clear();
  };

  async function read<T>(path: string, init: RequestInit, parse: (raw: unknown) => T): Promise<T | undefined> {
    if (!canRead() || session.reading) return;
    const abort = new AbortController(), generation = ++session.readGeneration;
    let settled = false, cancel!: () => void;
    const interrupted = new Promise<never>((_, reject) => { cancel = () => { abort.abort(); reject(new Error('La consulta tardó demasiado. Inténtalo de nuevo.')); }; });
    const reading = { cancel, generation }; session.reading = reading; session.error = null; publish();
    const timer = setTimeout(cancel, 10000); session.timers.add(timer);
    const owns = () => current() && !settled && session.readGeneration === generation && session.reading === reading && !abort.signal.aborted;
    try {
      const raw = await Promise.race([ownerApiFetch<unknown>(latest.current.requestScope, 'read', path, { ...init, signal: abort.signal }, owns), interrupted]);
      if (!owns() || !canRead()) return;
      return parse(raw);
    } catch (error) {
      if (current() && session.readGeneration === generation) { session.error = error instanceof z.ZodError ? invalid().message : errorMessage(error); if (session.availabilityStatus === 'loading') session.availabilityStatus = 'error'; }
      return undefined;
    } finally {
      settled = true; clearTimeout(timer); session.timers.delete(timer);
      if (session.reading === reading) session.reading = null;
      publish();
    }
  }
  const sourcePath = `/api/businesses/${encodeURIComponent(input.businessId)}/appointments/${'appointmentId' in session.entry ? encodeURIComponent(session.entry.appointmentId) : ''}/owner-reschedule`;
  const proposalPath = (id: string) => `/api/businesses/${encodeURIComponent(input.businessId)}/owner-reschedule-proposals/${encodeURIComponent(id)}`;

  async function loadSource() {
    if (!canRead() || !('appointmentId' in session.entry) || session.uncertain || session.confirmation?.active || (session.frozen && !session.canRestart)) return;
    cancelRead(); session.postVersion++; session.preparation = null; session.confirmation = null;
    session.proposal = null; session.recovery = null; session.frozen = false; session.canRestart = false;
    session.source = null; session.availability = []; session.availableFor = null; session.availabilityStatus = 'idle'; session.stage = 'source'; session.message = null;
    session.initialRequested = true;
    const source = await read(sourcePath, {}, raw => {
      const parsed = ownerRescheduleSourceSchema.parse(raw);
      if (parsed.appointment.tenantId !== input.businessId || !('appointmentId' in session.entry) || parsed.appointment.id !== session.entry.appointmentId) throw invalid();
      return parsed;
    });
    if (!current() || !source) return;
    session.source = source; session.selection = { dateKey: source.appointment.dateKey, resourceId: resourceOptions().some(item => item.id === source.appointment.resourceId) ? source.appointment.resourceId : '', startTimeStr: '' };
    session.stage = source.eligible ? 'selection' : 'source'; publish();
  }
  function setSelection(target: OwnerRescheduleTarget) {
    if (!canRead() || session.frozen || session.reading || !session.source?.eligible) return;
    const changed = selectionKey(target) !== selectionKey(session.selection);
    if (!changed && target.startTimeStr && !session.availability.some(item => item.resourceId === target.resourceId && item.slots.includes(target.startTimeStr))) return;
    session.selection = { ...target, startTimeStr: changed ? '' : target.startTimeStr };
    if (changed) { session.availability = []; session.availableFor = null; session.availabilityStatus = 'idle'; }
    session.error = null; publish();
  }
  async function loadAvailability() {
    if (!canRead() || session.frozen || session.reading || !session.source?.eligible) return;
    const selection = { ...session.selection }, parsed = ownerRescheduleAvailabilitySchema.safeParse({ ...session.source.expectation, dateKey: selection.dateKey, ...(selection.resourceId ? { resourceId: selection.resourceId } : {}) });
    if (!parsed.success) { session.error = 'Elige una fecha válida y un profesional disponible.'; publish(); return; }
    session.availabilityStatus = 'loading'; session.availability = []; session.availableFor = null; session.selection.startTimeStr = '';
    const availability = await read(sourcePath + '/availability', { method: 'POST', body: JSON.stringify(parsed.data) }, raw => slotsSchema.parse(raw).availability);
    if (!current() || !availability) return;
    session.availability = availability; session.availabilityStatus = 'success'; session.availableFor = selectionKey(selection); publish();
  }
  function acceptRecovery(value: OwnerRescheduleRecovery) {
    if (value.proposal.businessId !== input.businessId || value.appointment.tenantId !== input.businessId
      || (session.proposal && JSON.stringify(value.proposal) !== JSON.stringify(session.proposal))) throw invalid();
    if (session.recovery && session.recovery.state !== 'prepared' && value.state === 'prepared') return;
    session.proposal = value.proposal; session.recovery = value; session.frozen = true; session.error = null; session.canRestart = false;
    if (value.state === 'applied' || value.state === 'closed') {
      cancelRead();
      session.postVersion++; session.preparation = null; session.confirmation = null;
      session.uncertain = false; session.stage = 'result'; session.message = null;
    } else {
      session.stage = 'review';
      // A recovered URL cannot establish whether a previous page sent confirmation.
      if ('proposalId' in session.entry || session.confirmation?.ambiguous) session.uncertain = true;
      if (value.proposal.expiresAt <= Date.now()) session.message = 'La propuesta venció; falta comprobar el resultado con la misma confirmación.';
    }
  }
  async function recover() {
    const id = session.proposal?.id ?? ('proposalId' in session.entry ? session.entry.proposalId : null);
    if (!id || !canRead()) return;
    session.initialRequested = true;
    const version = session.postVersion;
    const result = await read(proposalPath(id), {}, raw => {
      const value = ownerRescheduleRecoverySchema.parse(raw);
      if (value.proposal.id !== id) throw invalid();
      return value;
    });
    if (!current() || !result || version !== session.postVersion) return;
    try { acceptRecovery(result); } catch { session.error = invalid().message; }
    publish();
  }
  async function send(operation: Mutation, kind: 'prepare' | 'confirm') {
    if (!canRead() || !latest.current.requestScope.canStartAction() || operation.active || operation.version !== session.postVersion) return;
    operation.active = true; session.error = null; session.message = null; publish();
    const owns = () => current() && operation.version === session.postVersion && (kind === 'prepare' ? session.preparation === operation : session.confirmation === operation);
    const timer = setTimeout(() => {
      if (!owns()) return;
      operation.ambiguous = true;
      if (kind === 'confirm') session.uncertain = true;
      session.message = kind === 'confirm' ? 'Resultado por comprobar. La confirmación sigue pendiente.' : 'La preparación está tardando. Conservamos el mismo intento.'; publish();
    }, 20000); session.timers.add(timer);
    try {
      const raw = await ownerApiFetch<unknown>(latest.current.requestScope, 'write', operation.path, { method: 'POST', body: operation.body, signal: operation.abort.signal }, owns);
      if (!owns()) return;
      if (kind === 'prepare') {
        const envelope = z.object({ proposal: ownerRescheduleProposalViewSchema }).strict().parse(raw), proposal = envelope.proposal, command = operation.command!, source = session.source!.appointment;
        if (proposal.businessId !== input.businessId || proposal.appointmentId !== source.id || proposal.requestId !== command.requestId || proposal.sourceRevision !== command.sourceRevision || proposal.sourceFingerprint !== command.sourceFingerprint
          || proposal.target.dateKey !== command.selection.dateKey || proposal.target.resourceId !== command.selection.resourceId || proposal.target.startTimeStr !== command.selection.startTimeStr
          || proposal.source.startAt !== source.startAt || proposal.source.endAt !== source.endAt || proposal.source.reservedUntilAt !== source.reservedUntilAt || proposal.source.resourceId !== source.resourceId || proposal.source.priceCOP !== (source.price ?? null)) throw invalid();
        session.proposal = proposal; session.preparation = null; session.stage = 'review'; session.message = null;
      } else {
        const result = ownerRescheduleConfirmationSchema.parse(raw);
        acceptRecovery(ownerRescheduleRecoverySchema.parse({ proposal: session.proposal, state: 'applied', appointment: result.appointment, result: result.rescheduleResult }));
      }
    } catch (error) {
      if (!owns()) return;
      if (kind === 'confirm') {
        const definite = error instanceof ApiError && [400, 402, 409, 428, 429].includes(error.status);
        if (operation.ambiguous || !definite) { operation.ambiguous = true; session.uncertain = true; }
        else { session.canRestart = true; session.uncertain = false; }
      } else operation.ambiguous = true;
      session.error = error instanceof z.ZodError ? invalid().message : errorMessage(error);
    } finally {
      clearTimeout(timer); session.timers.delete(timer); operation.active = false; publish();
    }
  }
  async function prepare() {
    if (!canRead() || session.proposal || session.confirmation || !session.source?.eligible) return;
    if (session.preparation) { await send(session.preparation, 'prepare'); return; }
    if (session.frozen || session.availableFor !== selectionKey(session.selection) || session.availabilityStatus !== 'success'
      || !session.availability.some(item => item.resourceId === session.selection.resourceId && item.slots.includes(session.selection.startTimeStr))) { session.error = 'Consulta horarios y elige una hora disponible antes de revisar.'; publish(); return; }
    const parsed = ownerRescheduleCommandSchema.safeParse({ ...session.source.expectation, requestId: crypto.randomUUID(), selection: session.selection });
    if (!parsed.success) { session.error = 'Revisa la fecha, profesional y hora elegidos.'; publish(); return; }
    session.frozen = true;
    const operation: Mutation = { path: sourcePath + '/proposals', body: JSON.stringify(parsed.data), command: parsed.data, active: false, ambiguous: false, abort: new AbortController(), version: session.postVersion };
    session.preparation = operation; await send(operation, 'prepare');
  }
  async function confirm() {
    if (!canRead() || !session.proposal || session.stage === 'result' || session.preparation || session.canRestart) return;
    if (!session.confirmation) session.confirmation = { path: proposalPath(session.proposal.id) + '/confirm', body: '{"confirm":true}', active: false, ambiguous: session.uncertain, abort: new AbortController(), version: session.postVersion };
    await send(session.confirmation, 'confirm');
  }

  useEffect(() => { session.live = true; return dispose; }, [session]);
  useEffect(() => {
    if (session.reading) cancelRead();
    if (!session.initialRequested && canRead()) {
      if ('appointmentId' in session.entry) void loadSource(); else void recover();
    }
  }, [session, input.enabled, requestScope.readGeneration]);
  const visible = current() && input.enabled && requestScope.canRead();
  return {
    source: visible ? session.source : null, selection: visible ? session.selection : blankSelection(), availability: visible ? session.availability : [],
    proposal: visible ? session.proposal : null, recovery: visible ? session.recovery : null, stage: session.stage,
    availabilityStatus: session.availabilityStatus, frozen: session.frozen,
    busy: !!session.reading || !!session.preparation?.active || !!session.confirmation?.active, readBusy: !!session.reading,
    uncertain: session.uncertain, canClose: !session.uncertain && !session.confirmation?.active, canRestart: session.canRestart,
    error: visible ? session.error : null, message: visible ? session.message : null, resources: visible ? resourceOptions() : [],
    loadSource, retryInitialRead: 'proposalId' in session.entry ? recover : loadSource, setSelection, loadAvailability, prepare, confirm, recover,
  };
}
