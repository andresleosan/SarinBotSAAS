"use client";

import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@/components/auth-provider';
import { useAppointmentAttendance } from '@/hooks/use-appointment-attendance';
import type { AttendanceStatus } from '@/lib/appointment-attendance';
import type { Appointment } from '@/types/firestore';
import type { OwnerRequestScope } from '@/lib/client/owner-request-scope';

export type AppointmentAttendanceControlsProps = { businessId: string; ownerUid: string; appointment: Appointment; disabled: boolean; onSaved: (appointment: Appointment) => void; onBusyChange: (busy: boolean) => void; requestScope?: OwnerRequestScope; canStart?: () => boolean };
const buttonClass = 'min-h-11 rounded-xl border border-sarin-line px-4 py-2 text-sm text-sarin-blue outline-none focus-visible:ring-2 focus-visible:ring-sarin-blue disabled:opacity-50';
function label(status: Appointment['status']) { return status === 'completed' ? 'Atendida' : status === 'no_show' ? 'No asistió' : status === 'confirmed' ? 'Pendiente de registrar' : 'Cancelada'; }
function timestamp(value: number) { return new Intl.DateTimeFormat('es-CO', { timeZone: 'America/Bogota', dateStyle: 'medium', timeStyle: 'short' }).format(value); }

function Controls({ businessId, ownerUid, appointment, disabled, onSaved, onBusyChange, enabled, requestScope, canStart }: AppointmentAttendanceControlsProps & { enabled: boolean }) {
  const attendance = useAppointmentAttendance({ scope: { businessId, ownerUid, appointmentId: appointment.id, dateKey: appointment.dateKey }, appointment, enabled, requestScope });
  const [draft, setDraft] = useState<{ signature: string; status: AttendanceStatus } | null>(null);
  const [correction, setCorrection] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const newer = (left: Appointment, right: Appointment) => (left.attendance?.revision ?? 0) > (right.attendance?.revision ?? 0)
    || ((left.attendance?.revision ?? 0) === (right.attendance?.revision ?? 0) && (left.rescheduleRevision ?? 0) > (right.rescheduleRevision ?? 0));
  const current = [attendance.result?.appointment, attendance.history?.appointment].reduce<Appointment>((latest, candidate) => candidate && newer(candidate, latest) ? candidate : latest, appointment);
  const signature = JSON.stringify([current.status, current.attendance?.revision ?? 0, current.rescheduleRevision ?? 0, current.startAt, current.endAt, current.reservedUntilAt, current.resourceId]);
  const proposal = draft?.signature === signature ? draft.status : null;
  const callback = useRef({ onSaved, onBusyChange, canStart }); callback.current = { onSaved, onBusyChange, canStart };
  const lifecycle = useRef({ active: true, busy: false, reported: false });
  const review = useRef<HTMLDivElement>(null);
  useEffect(() => { if (proposal) review.current?.focus(); }, [proposal]);
  useEffect(() => {
    const token = lifecycle.current; token.active = true;
    return () => { token.active = false; if (token.reported) { token.busy = false; token.reported = false; callback.current.onBusyChange(false); } };
  }, []);
  useEffect(() => {
    const value = attendance.busy || attendance.hasPending;
    if (lifecycle.current.reported === value) return;
    lifecycle.current.reported = value; callback.current.onBusyChange(value);
  }, [attendance.busy, attendance.hasPending]);
  async function perform(retry = false) {
    const token = lifecycle.current;
    if (disabled || token.busy || (!retry && !proposal) || callback.current.canStart?.() === false) return;
    token.busy = true; token.reported = true; callback.current.onBusyChange(true);
    try {
      const result = await (retry ? attendance.retryPending() : attendance.submit(proposal!, current.status === 'confirmed' ? undefined : 'recording_error'));
      if (!token.active) return;
      setDraft(null); setCorrection(false);
      if (result) callback.current.onSaved(result.appointment);
    } finally { if (token.active && token.busy) { token.busy = false; token.reported = attendance.hasPending; callback.current.onBusyChange(token.reported); } }
  }
  const tooEarly = !Number.isFinite(current.reservedUntilAt) || Date.now() < current.reservedUntilAt;
  const terminal = current.status === 'completed' || current.status === 'no_show';
  const unsupported = current.status !== 'confirmed' && !terminal;
  const unknown = attendance.error?.includes('desconocido') ?? false;
  const blocked = disabled || attendance.busy || tooEarly || unsupported || unknown || !!attendance.error;
  const choose = (status: AttendanceStatus) => { if (!blocked) setDraft({ signature, status }); };
  const refresh = () => { if (!disabled && !attendance.busy) { setDraft(null); setCorrection(false); void attendance.loadHistory(); } };
  return <section aria-label="Resultado de asistencia" aria-busy={attendance.busy} className="space-y-3 border-t border-sarin-line pt-3">
    <p className="font-medium">{label(current.status)}</p>
    {terminal && !current.attendance && <p className="text-xs text-sarin-muted">Resultado anterior sin auditoría registrada</p>}
    <p className="text-xs leading-5 text-sarin-muted">Registrar el resultado no implica un cobro. Puedes registrar el resultado cuando terminen el servicio y su margen de preparación.</p>
    <details className="text-xs text-sarin-muted"><summary className="min-h-11 cursor-pointer py-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sarin-blue">Cómo funciona el registro</summary><p className="pb-3">Se usa el horario y margen de preparación guardado en esta cita. No confirma pagos ni envía mensajes. Las correcciones conservan el historial privado.</p></details>
    {tooEarly && <p className="text-xs text-amber-800">El servicio o su margen de preparación guardado aún no ha terminado.</p>}
    {!unsupported && <>
      {terminal && !correction && !proposal && <button type="button" className={buttonClass} disabled={blocked} onClick={() => { if (!blocked) setCorrection(true); }}>Corregir resultado</button>}
      {(!terminal || correction) && !proposal && <div className="space-y-2"><p>{terminal ? 'Error al registrar · Elige el resultado correcto' : '1. Registra qué ocurrió'}</p><div className="flex flex-wrap gap-2">{(['completed', 'no_show'] as const).filter(status => status !== current.status).map(status => <button key={status} type="button" className={buttonClass} disabled={blocked} onClick={() => choose(status)}>{label(status)}</button>)}</div></div>}
      {proposal && <div ref={review} tabIndex={-1} className="space-y-3 rounded-xl bg-sarin-soft p-3 outline-none focus-visible:ring-2 focus-visible:ring-sarin-blue"><p className="font-medium">2. Revisa antes de confirmar</p><p className="break-words">{current.serviceName || 'Servicio sin registrar'} · {current.dateKey} · {current.startTimeStr}–{current.endTimeStr} · Hora de Colombia</p><p>De {label(current.status)} a {label(proposal)}</p>{terminal && <p>Motivo: Error al registrar</p>}<div className="flex flex-wrap gap-2"><button type="button" className={buttonClass} disabled={blocked} onClick={() => void perform()}>Confirmar resultado</button><button type="button" className={buttonClass} disabled={disabled || attendance.busy} onClick={() => setDraft(null)}>Volver</button></div></div>}
    </>}
    <div aria-live="polite" aria-atomic="true">{attendance.busy ? <p role="status">Comprobando resultado…</p> : attendance.error ? <p className="text-rose-800">{attendance.error}</p> : attendance.result ? <div className="text-sm"><p>Resultado registrado: {label(attendance.result.applied.status)} · {timestamp(attendance.result.applied.recordedAt)}</p>{(attendance.result.replayed || attendance.result.applied.status !== current.status) && <p>{attendance.result.replayed ? 'Comprobación de la solicitud original. ' : ''}Estado actual: {label(current.status)}.</p>}</div> : null}</div>
    {unknown && <button type="button" className={buttonClass} disabled={disabled || attendance.busy} onClick={() => void perform(true)}>Reintentar comprobación</button>}
    {attendance.error && !unknown && <button type="button" className={buttonClass} disabled={disabled || attendance.busy || attendance.historyLoading} onClick={refresh}>Actualizar y revisar</button>}
    <details aria-label="Historial de resultados" onToggle={event => { const open = event.currentTarget.open; setHistoryOpen(open); if (open && !attendance.history && !disabled && !attendance.busy) void attendance.loadHistory(); }}>
      <summary className="min-h-11 cursor-pointer py-3 font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-sarin-blue">Historial de resultados</summary>
      {historyOpen && <div className="space-y-3 pb-2">{attendance.historyLoading && <p role="status">Cargando historial…</p>}{attendance.historyError && <p role="alert" className="text-rose-800">{attendance.historyError}</p>}{attendance.history && <>{!attendance.history.events.length ? <p className="text-xs text-sarin-muted">Sin auditoría registrada</p> : <ol className="space-y-3">{attendance.history.events.map(event => <li key={event.sequence} className="text-xs leading-5"><p>De {label(event.previousStatus)} a {label(event.status)}</p><p>{event.actorUid === ownerUid ? 'Tú' : 'Otro propietario del negocio'} · {timestamp(event.recordedAt)} · {event.reason === 'recording_error' ? 'Error al registrar' : 'Registro inicial'}</p>{event.legacyPreviousOutcome && <p>Resultado anterior sin auditoría registrada</p>}</li>)}</ol>}{attendance.history.nextBeforeRevision !== null && <button type="button" className={buttonClass} disabled={disabled || attendance.busy || attendance.historyLoading} onClick={() => { if (!disabled && !attendance.busy) void attendance.loadHistory(attendance.history!.nextBeforeRevision!); }}>Ver cambios anteriores</button>}</>}<button type="button" className={buttonClass} disabled={disabled || attendance.busy || attendance.historyLoading} onClick={refresh}>Actualizar historial</button></div>}
    </details>
  </section>;
}

export function AppointmentAttendanceControls(props: AppointmentAttendanceControlsProps) {
  const { user, authEpoch } = useAuth();
  const enabled = !!user && user.uid === props.ownerUid && props.appointment.type === 'appointment' && props.appointment.tenantId === props.businessId
    && !!props.businessId && !!props.appointment.id && /^\d{4}-\d{2}-\d{2}$/.test(props.appointment.dateKey);
  if (!enabled) return null;
  return <Controls key={JSON.stringify([props.ownerUid, authEpoch, props.businessId, props.appointment.dateKey, props.appointment.id])} {...props} enabled={enabled} />;
}
