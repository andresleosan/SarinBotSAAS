"use client";

import { useEffect, useReducer, useRef } from 'react';
import { z } from 'zod';
import { apiFetch, ApiError, errorMessage } from '@/lib/client/api';
import { appointmentAttendanceCommandSchema, appointmentAttendanceEventSchema, assertAttendanceTransition, type AttendanceCommand, type AttendanceHistoryPage, type AttendanceStatus, type AttendanceUpdateResult } from '@/lib/appointment-attendance';
import type { Appointment } from '@/types/firestore';

export type AttendanceScope = { businessId: string; ownerUid: string; appointmentId: string; dateKey: string };
const revision = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER - 1);
const positive = z.number().int().positive().safe();
const eventId = z.string().regex(/^[a-f0-9]{64}$/);
const appointmentSchema = z.object({
  id: z.string().min(1), tenantId: z.string().min(1), dateKey: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  type: z.literal('appointment'), status: z.enum(['confirmed', 'completed', 'no_show', 'cancelled_by_client', 'cancelled_by_owner']),
  resourceId: z.string().min(1), startAt: positive, endAt: positive, reservedUntilAt: positive,
  startTimeStr: z.string(), endTimeStr: z.string(), createdAt: z.number().finite(), createdBy: z.enum(['sarin_client', 'sarin_owner', 'manual_panel']),
  rescheduleRevision: revision.optional(), attendance: z.object({ revision: revision.min(1), lastEventId: eventId }).strict().optional(),
}).passthrough().refine(appointment => appointment.startAt < appointment.endAt && appointment.endAt <= appointment.reservedUntilAt
  && (!appointment.attendance || appointment.status === 'completed' || appointment.status === 'no_show'));
const updateSchema = z.object({ appointment: appointmentSchema, applied: z.object({ eventId, requestId: z.string().min(1), revision: revision.min(1), status: z.enum(['completed', 'no_show']), recordedAt: positive }).strict(), replayed: z.boolean() }).strict();
const historySchema = z.object({ appointment: appointmentSchema, events: z.array(appointmentAttendanceEventSchema).max(20), nextBeforeRevision: revision.min(1).nullable() }).strict();
const UNKNOWN = 'El resultado es desconocido. El servidor puede haberlo guardado. Reintenta la comprobación con la misma solicitud.';
const INVALID = 'No se pudo comprobar el resultado.';

function matches(appointment: { id: string; tenantId: string; dateKey: string }, scope: AttendanceScope) {
  return appointment.id === scope.appointmentId && appointment.tenantId === scope.businessId && appointment.dateKey === scope.dateKey;
}

/** Full responses may arrive out of order for these independently versioned results. */
export function preserveNewerAppointmentResults(saved: Appointment, known: Appointment): Appointment {
  const sameOccurrence = saved.id === known.id && saved.tenantId === known.tenantId && saved.dateKey === known.dateKey
    && saved.type === known.type && saved.resourceId === known.resourceId
    && saved.startAt === known.startAt && saved.endAt === known.endAt && saved.reservedUntilAt === known.reservedUntilAt
    && (saved.rescheduleRevision ?? 0) === (known.rescheduleRevision ?? 0);
  if (!sameOccurrence) return saved;

  const version = (value: number | undefined) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0;
  const newerAttendance = !!known.attendance && version(known.attendance.revision) > version(saved.attendance?.revision);
  const newerRepresentation = !!known.representationReview && version(known.representationReview.revision) > version(saved.representationReview?.revision);
  if (!newerAttendance && !newerRepresentation) return saved;
  return {
    ...saved,
    ...(newerAttendance ? { status: known.status, attendance: known.attendance } : {}),
    ...(newerRepresentation ? { representationReview: known.representationReview } : {}),
  };
}

function parseUpdate(value: unknown, scope: AttendanceScope, command: AttendanceCommand): AttendanceUpdateResult {
  const result = updateSchema.parse(value);
  if (!matches(result.appointment, scope) || result.applied.requestId !== command.requestId || result.applied.status !== command.status
    || result.applied.revision !== command.expectedRevision + 1 || (result.appointment.attendance?.revision ?? 0) < result.applied.revision
    || (result.appointment.rescheduleRevision ?? 0) !== command.expectedRescheduleRevision || result.applied.recordedAt < result.appointment.reservedUntilAt
    || (result.appointment.attendance?.revision === result.applied.revision && (result.appointment.status !== result.applied.status || result.appointment.attendance.lastEventId !== result.applied.eventId))) throw new Error(INVALID);
  return result as AttendanceUpdateResult;
}
function parseHistory(value: unknown, scope: AttendanceScope, before?: number): AttendanceHistoryPage {
  const page = historySchema.parse(value);
  if (!matches(page.appointment, scope) || (before !== undefined && before > (page.appointment.attendance?.revision ?? 0))) throw new Error(INVALID);
  if (before === undefined && page.events.length && page.events[0].status !== page.appointment.status) throw new Error(INVALID);
  let upper = before ?? (page.appointment.attendance?.revision ?? 0) + 1;
  for (let index = 0; index < page.events.length; index++) {
    const event = page.events[index];
    if (event.businessId !== scope.businessId || event.appointmentId !== scope.appointmentId || event.source.dateKey !== scope.dateKey || event.sequence !== upper - 1
      || event.source.resourceId !== page.appointment.resourceId || event.source.startAt !== page.appointment.startAt || event.source.endAt !== page.appointment.endAt
      || event.source.reservedUntilAt !== page.appointment.reservedUntilAt || event.source.rescheduleRevision !== (page.appointment.rescheduleRevision ?? 0)
      || (index > 0 && page.events[index - 1].previousStatus !== event.status)) throw new Error(INVALID);
    upper = event.sequence;
  }
  if ((upper > 1 && page.nextBeforeRevision !== upper) || (upper <= 1 && page.nextBeforeRevision !== null)
    || (page.nextBeforeRevision !== null && page.events.length !== 20)) throw new Error(INVALID);
  return page as AttendanceHistoryPage;
}

/** A local deadline cancels waiting, without making any claim about a server commit. */
async function bounded<T>(controller: AbortController, milliseconds: number, request: () => Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort = () => {};
  try {
    const interrupted = new Promise<never>((_, reject) => {
      abort = () => reject(controller.signal.reason ?? new DOMException('Solicitud cancelada', 'AbortError'));
      controller.signal.addEventListener('abort', abort);
      timer = setTimeout(() => { reject(new Error('La consulta tardó demasiado. Inténtalo de nuevo.')); controller.abort(); }, milliseconds);
    });
    return await Promise.race([request(), interrupted]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    controller.signal.removeEventListener('abort', abort);
  }
}

function generation(key: string | null, appointment: Appointment) {
  return { key, live: true, source: appointment, appointment, busy: false, error: null as string | null, result: null as AttendanceUpdateResult | null,
    history: null as AttendanceHistoryPage | null, historyLoading: false, historyError: null as string | null,
    pending: null as { command: AttendanceCommand; body: string } | null, blocked: false, historyVersion: 0,
    write: null as AbortController | null, read: null as AbortController | null };
}
export function useAppointmentAttendance({ scope, appointment, enabled }: { scope: AttendanceScope; appointment: Appointment; enabled: boolean }) {
  const key = enabled && appointment.type === 'appointment' && matches(appointment, scope) && scope.ownerUid && scope.businessId && scope.appointmentId ? JSON.stringify([scope.ownerUid, scope.businessId, scope.dateKey, scope.appointmentId]) : null;
  const ref = useRef(generation(key, appointment));
  if (ref.current.key !== key) ref.current = generation(key, appointment);
  const current = ref.current;
  if (current.source !== appointment) { current.source = appointment; current.appointment = appointment; }
  const [, render] = useReducer(value => value + 1, 0);
  const active = () => ref.current === current && current.key !== null && current.live;
  const publish = () => { if (active()) render(); };
  useEffect(() => {
    current.live = true;
    return () => {
      current.live = false;
      current.write?.abort(); current.read?.abort();
    };
  }, [current]);
  const path = `/api/businesses/${encodeURIComponent(scope.businessId)}/appointments/${encodeURIComponent(scope.appointmentId)}/attendance`;
  const denied = (status: number, controller: AbortController) => {
    if (!active() || controller.signal.aborted || (status !== 401 && status !== 403)) return;
    current.history = null; current.historyError = `No se pudo completar la solicitud (${status}).`; current.blocked = true;
    publish(); controller.abort(new ApiError(current.historyError, status));
  };
  async function send(): Promise<AttendanceUpdateResult | null> {
    if (!active() || current.busy || !current.pending) return null;
    const pending = current.pending;
    const controller = current.write = new AbortController();
    current.busy = true; current.error = null; current.result = null; publish();
    try {
      const response = await bounded(controller, 20_000, () => apiFetch<unknown>(path, { method: 'PATCH', body: pending.body, signal: controller.signal }, scope.ownerUid,
        () => active() && !controller.signal.aborted, status => denied(status, controller)));
      if (!active() || controller.signal.aborted) return null;
      const result = parseUpdate(response, scope, pending.command);
      // Keep independently newer decisions already observed while this response was delayed.
      const known = appointmentSchema.safeParse(current.appointment);
      if (known.success && matches(known.data, scope)) {
        result.appointment = preserveNewerAppointmentResults(result.appointment, known.data as Appointment);
      }
      current.pending = null; current.appointment = result.appointment; current.result = result; current.blocked = false;
      current.historyVersion++; current.read?.abort(); current.read = null; current.history = null; current.historyLoading = false; current.historyError = null;
      publish(); return result;
    } catch (cause) {
      if (!active()) return null;
      if (cause instanceof ApiError && cause.status < 500) {
        current.pending = null; current.blocked = true;
        current.error = cause.status === 409 ? 'La cita cambió. Actualiza el historial y revisa de nuevo antes de confirmar.' : cause.status === 428 ? 'Revisa y acepta el consentimiento de tu cuenta para registrar el resultado.' : errorMessage(cause);
      } else current.error = UNKNOWN;
      publish(); return null;
    } finally {
      if (current.write === controller) { current.write = null; current.busy = false; publish(); }
    }
  }
  async function submit(status: AttendanceStatus, correctionReason?: 'recording_error') {
    if (!active() || current.busy || current.pending || current.blocked) return null;
    const command = appointmentAttendanceCommandSchema.safeParse({ requestId: crypto.randomUUID(), expectedRevision: current.appointment.attendance?.revision ?? 0,
      expectedRescheduleRevision: current.appointment.rescheduleRevision ?? 0, expectedStatus: current.appointment.status, status, ...(correctionReason ? { correctionReason } : {}) });
    if (!command.success) return null;
    try { assertAttendanceTransition(current.appointment, command.data, Date.now()); }
    catch { current.error = 'No se puede registrar todavía. Comprueba el horario y su margen de preparación guardado.'; publish(); return null; }
    current.pending = { command: command.data, body: JSON.stringify(command.data) };
    return send();
  }
  async function loadHistory(beforeRevision?: number): Promise<void> {
    if (!active() || current.busy || current.historyLoading) return;
    if (beforeRevision !== undefined && (!Number.isSafeInteger(beforeRevision) || beforeRevision <= 0 || beforeRevision !== current.history?.nextBeforeRevision)) return;
    const controller = current.read = new AbortController(), version = ++current.historyVersion;
    const previous = current.history;
    current.historyLoading = true; current.historyError = null; publish();
    try {
      const response = await bounded(controller, 10_000, () => apiFetch<unknown>(path + (beforeRevision === undefined ? '' : `?beforeRevision=${beforeRevision}`), { signal: controller.signal }, scope.ownerUid,
        () => active() && current.historyVersion === version && !controller.signal.aborted, status => denied(status, controller)));
      if (!active() || current.historyVersion !== version || controller.signal.aborted) return;
      const page = parseHistory(response, scope, beforeRevision);
      if (beforeRevision !== undefined && previous?.events.length && page.events.length
        && previous.events[previous.events.length - 1].previousStatus !== page.events[0].status) throw new Error(INVALID);
      current.history = beforeRevision === undefined ? page : { ...page, events: [...(previous?.events ?? []), ...page.events] };
      current.appointment = page.appointment;
      current.blocked = false;
      // A history snapshot cannot resolve the receipt for a previously sent command.
      if (!current.pending) current.error = null;
    } catch (cause) {
      if (active() && current.historyVersion === version) { current.historyError = cause instanceof z.ZodError ? INVALID : errorMessage(cause); if (cause instanceof ApiError && [401, 403].includes(cause.status)) current.history = null; }
    } finally {
      if (current.read === controller) { current.read = null; current.historyLoading = false; publish(); }
    }
  }
  return { busy: current.busy, error: current.error, result: current.result, history: current.history, historyLoading: current.historyLoading, historyError: current.historyError, submit, retryPending: send, loadHistory };
}
