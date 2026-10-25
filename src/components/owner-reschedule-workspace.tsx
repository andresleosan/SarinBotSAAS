"use client";
import { useEffect, useId, useRef, useState } from 'react';
import type { OwnerRescheduleController } from '@/hooks/use-owner-reschedule';
import type { OwnerRescheduleIneligibility, OwnerRescheduleProposalView } from '@/lib/owner-rescheduling';
import { buttonClass, fieldClass } from '@/components/app-shell';

const secondary = 'min-h-11 rounded-xl border border-sarin-line px-4 py-2 text-sm font-medium text-sarin-blue outline-none hover:bg-sarin-soft focus-visible:ring-2 focus-visible:ring-sarin-blue disabled:opacity-50';
const reasons: Record<OwnerRescheduleIneligibility, string> = {
  restricted_policy: 'Esta acción está disponible para negocios generales, sin reservas de menores ni autorizaciones sensibles. Las opciones actuales de la cita siguen disponibles en la agenda.',
  source_started: 'La cita ya comenzó o tiene un resultado de atención registrado. Su horario no se puede cambiar.',
  unsupported_source: 'Solo puedes cambiar el horario de una cita futura confirmada.',
  service_unavailable: 'El servicio original ya no está disponible. Revisa el catálogo antes de continuar.',
  subscription_unavailable: 'La suscripción actual no permite un nuevo cambio de horario. Puedes consultar los cambios anteriores.',
  business_unconfigured: 'Completa la configuración del negocio antes de cambiar el horario.',
};
const price = (amount: number | null | undefined) => amount === null || amount === undefined ? 'Precio sin registrar' : `${amount.toLocaleString('es-CO')} COP`;
const day = (key: string) => new Intl.DateTimeFormat('es-CO', { timeZone: 'UTC', dateStyle: 'long' }).format(new Date(`${key}T12:00:00Z`));
const endDay = (at: number) => new Date(at - 5 * 3600000).toISOString().slice(0, 10);
function Interval({ value }: { value: OwnerRescheduleProposalView['source'] }) {
  const ending = endDay(value.endAt);
  return <div className="min-w-0 space-y-1 text-sm [overflow-wrap:anywhere]">
    <p>{day(value.dateKey)}</p><p className="font-semibold tabular-nums">{value.startTimeStr}–{value.endTimeStr}{ending !== value.dateKey && <> · finaliza el {day(ending)}</>}</p>
    <p>{value.resourceName}</p><p>{price(value.priceCOP)}</p>
    <p className="text-xs text-sarin-muted">Preparación después de la cita: {(value.reservedUntilAt - value.endAt) / 60000} min</p>
  </div>;
}

export function OwnerRescheduleWorkspace({ controller, onClose, onViewCurrentDay }: { controller: OwnerRescheduleController; onClose: () => void; onViewCurrentDay: (dateKey: string) => void }) {
  const id = useId(), heading = useRef<HTMLHeadingElement>(null), [clock, setClock] = useState(Date.now());
  const { source, selection, proposal, recovery, stage } = controller;
  useEffect(() => { heading.current?.focus(); }, [stage]);
  useEffect(() => {
    if (!proposal || proposal.expiresAt <= Date.now()) return;
    const timer = setTimeout(() => setClock(Date.now()), proposal.expiresAt - Date.now());
    return () => clearTimeout(timer);
  }, [proposal?.id, proposal?.expiresAt]);
  const expired = !!proposal && proposal.expiresAt <= Math.max(clock, Date.now());
  const slots = controller.availability.find(item => item.resourceId === selection.resourceId)?.slots ?? [];
  const current = recovery?.appointment;
  return <section aria-labelledby={id + '-title'} aria-busy={controller.busy} className="min-w-0 space-y-5 rounded-2xl border border-sarin-blue/25 bg-white p-4 shadow-sm sm:p-6">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0"><p className="mb-1 text-xs font-medium text-sarin-blue">Misma cita · hora de Colombia</p><h2 ref={heading} id={id + '-title'} tabIndex={-1} className="rounded-lg text-xl font-semibold outline-none focus-visible:ring-2 focus-visible:ring-sarin-blue">Cambiar horario</h2></div>
      <button type="button" className={secondary} disabled={!controller.canClose} onClick={() => { if (controller.canClose) onClose(); }}>{controller.uncertain || stage === 'result' ? 'Cerrar cambio' : 'Salir sin cambiar'}</button>
    </div>
    <ol aria-label="Pasos del cambio" className="flex flex-wrap gap-x-5 gap-y-2 text-xs text-sarin-muted">
      <li className={stage === 'source' ? 'font-semibold text-sarin-blue' : ''}>1. Consultar origen</li><li className={stage === 'selection' ? 'font-semibold text-sarin-blue' : ''}>2. Elegir horario</li><li className={stage === 'review' || stage === 'result' ? 'font-semibold text-sarin-blue' : ''}>3. Revisar y confirmar</li>
    </ol>
    {controller.error && <p role="alert" className="rounded-xl bg-rose-50 p-3 text-sm text-rose-800 [overflow-wrap:anywhere]">{controller.error}</p>}
    {controller.message && <p role="status" aria-live="polite" className="rounded-xl bg-sarin-canvas p-3 text-sm">{controller.message}</p>}
    {stage === 'source' && <div className="space-y-3">
      {controller.busy && <p role="status">Consultando la cita…</p>}
      {source?.reason && <p role="status" className="rounded-xl bg-sarin-canvas p-4 text-sm leading-6">{reasons[source.reason]}</p>}
      {!controller.busy && <button type="button" className={secondary} onClick={() => void controller.loadSource()}>Consultar origen de nuevo</button>}
    </div>}
    {stage === 'selection' && source && <div className="space-y-5">
      <div className="rounded-xl bg-sarin-canvas p-4 text-sm"><p className="font-semibold">Horario actual</p><p className="mt-1 [overflow-wrap:anywhere]">{source.appointment.serviceName || 'Servicio original'} · {day(source.appointment.dateKey)} · {source.appointment.startTimeStr}–{source.appointment.endTimeStr}</p><p className="mt-1 text-xs text-sarin-muted">{price(source.appointment.price)}. Conserva el mismo servicio y los datos registrados.</p></div>
      <div className="grid min-w-0 gap-4 sm:grid-cols-2">
        <label className="min-w-0 space-y-2 text-sm" htmlFor={id + '-date'}><span>Nueva fecha</span><input id={id + '-date'} aria-label="Nueva fecha" type="date" className={fieldClass + ' min-h-11 min-w-0 w-full'} value={selection.dateKey} disabled={controller.frozen || controller.readBusy} onChange={event => controller.setSelection({ ...selection, dateKey: event.target.value, startTimeStr: '' })} /></label>
        <label className="min-w-0 space-y-2 text-sm" htmlFor={id + '-resource'}><span>Profesional</span><select id={id + '-resource'} aria-label="Profesional" className={fieldClass + ' min-h-11 min-w-0 w-full'} value={selection.resourceId} disabled={controller.frozen || controller.readBusy} onChange={event => controller.setSelection({ ...selection, resourceId: event.target.value, startTimeStr: '' })}><option value="">Elige un profesional</option>{controller.resources.map(resource => <option key={resource.id} value={resource.id}>{resource.name}</option>)}</select></label>
      </div>
      {!selection.resourceId && <p className="text-sm text-sarin-muted">Elige explícitamente un profesional disponible; no seleccionamos uno por ti.</p>}
      <button type="button" className={secondary} disabled={controller.frozen || controller.readBusy} onClick={() => void controller.loadAvailability()}>{controller.readBusy ? 'Consultando horarios…' : 'Consultar horarios'}</button>
      {controller.availabilityStatus === 'success' && !slots.length && <p role="status" className="text-sm text-sarin-muted">No hay horas disponibles para esa fecha y profesional. Elige otra opción y consulta de nuevo.</p>}
      <label className="block min-w-0 space-y-2 text-sm" htmlFor={id + '-time'}><span>Nueva hora</span><select id={id + '-time'} aria-label="Nueva hora" className={fieldClass + ' min-h-11 min-w-0 w-full'} value={selection.startTimeStr} disabled={controller.frozen || controller.availabilityStatus !== 'success'} onChange={event => controller.setSelection({ ...selection, startTimeStr: event.target.value })}><option value="">Elige una hora</option>{slots.map(time => <option key={time} value={time}>{time}</option>)}</select></label>
      <button type="button" className={buttonClass + ' min-h-11'} disabled={controller.busy || (!controller.frozen && !slots.includes(selection.startTimeStr))} onClick={() => void controller.prepare()}>{controller.frozen ? 'Reintentar la misma preparación' : 'Revisar cambio'}</button>
    </div>}
    {(stage === 'review' || stage === 'result') && proposal && <>
      <div className="grid min-w-0 gap-4 sm:grid-cols-2"><div className="min-w-0 space-y-3 rounded-xl border border-sarin-line p-4"><h3 className="font-semibold">Antes</h3><Interval value={proposal.source} /></div><div className="min-w-0 space-y-3 rounded-xl border border-sarin-blue/25 bg-sarin-soft p-4"><h3 className="font-semibold">{stage === 'result' ? 'Este cambio' : 'Propuesto'}</h3><p className="break-words text-sm font-medium">{proposal.target.serviceName}</p><Interval value={proposal.target} /><p className="text-xs text-sarin-muted">Duración: {proposal.target.durationMinutes} min</p></div></div>
      {stage === 'review' && <div className="space-y-4">
        <p className="text-sm text-sarin-muted">Esta propuesta no aparta el horario. Volveremos a comprobarlo al confirmar.</p>
        {expired && <p role="status" className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">La propuesta venció; falta comprobar el resultado. La misma confirmación recupera el cambio o verifica su cierre.</p>}
        {controller.uncertain && <p role="status" className="rounded-xl bg-amber-50 p-4 text-sm leading-6 text-amber-900"><strong>Resultado por comprobar.</strong> Conservamos la misma confirmación. Una lectura preparada o el paso del tiempo no demuestra que haya fallado. Comprueba el resultado antes de iniciar otra operación.</p>}
        <div className="flex flex-wrap gap-3"><button type="button" className={buttonClass + ' min-h-11'} disabled={controller.busy || controller.canRestart} onClick={() => void controller.confirm()}>{controller.uncertain ? 'Recuperar la misma confirmación' : expired ? 'Comprobar cierre de la propuesta' : 'Confirmar cambio'}</button><button type="button" className={secondary} disabled={controller.readBusy} onClick={() => void controller.recover()}>Consultar resultado</button>{controller.canRestart && <button type="button" className={secondary} disabled={controller.busy} onClick={() => void controller.loadSource()}>Consultar origen de nuevo</button>}</div>
      </div>}
    </>}
    {stage === 'result' && recovery && current && <div className="space-y-4" role="status" aria-live="polite">
      <p className="font-semibold text-sarin-blue">{recovery.state === 'applied' ? 'Cambio comprobado' : 'Propuesta cerrada'}</p>
      <p className="text-sm">{recovery.state === 'applied' ? 'La prueba de este cambio quedó guardada. La cita actual puede incluir modificaciones posteriores.' : 'Esta propuesta venció y quedó cerrada sin aplicar ese cambio.'}</p>
      <div className="rounded-xl bg-sarin-canvas p-4 text-sm"><h3 className="mb-2 font-semibold">Estado actual de la cita</h3><p>{day(current.dateKey)} · {current.startTimeStr}–{current.endTimeStr}</p><p>{current.status === 'cancelled_by_owner' || current.status === 'cancelled_by_client' ? 'Cancelada' : current.status === 'completed' ? 'Atendida' : current.status === 'no_show' ? 'No asistió' : 'Confirmada'}</p></div>
      <div className="flex flex-wrap gap-3"><button type="button" className={secondary} onClick={() => onViewCurrentDay(current.dateKey)}>Ver día actualizado</button><button type="button" className={secondary} onClick={() => { if (controller.canClose) onClose(); }}>Cerrar cambio</button></div>
    </div>}
    <p className="text-xs leading-5 text-sarin-muted">Este cambio no procesa cobros ni envía avisos externos.</p>
    <details className="text-xs leading-5 text-sarin-muted"><summary className="min-h-11 cursor-pointer py-3 font-medium">Qué conserva este cambio</summary><p className="pb-3">Conserva la misma cita, servicio, cuenta reservante y datos históricos. No consume otra cita del plan ni requiere volver a escribir los datos de contacto.</p></details>
  </section>;
}
