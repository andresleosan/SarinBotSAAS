"use client";

import type { Appointment, Business } from '@/types/firestore';
import type { OwnerAgendaDay } from '@/lib/owner-agenda';
import { getOwnerAgendaDayLayout, getOwnerAgendaResources } from '@/lib/owner-agenda';
import { RepresentationReviewControls } from '@/components/representation-review';
import { AppointmentAttendanceControls } from '@/components/appointment-attendance-controls';

export type OwnerAgendaAppointmentsProps = {
  business: Business; dateKey: string; day: OwnerAgendaDay | null; resourceId: string | null; saving: boolean;
  onAttendanceBusyChange: (appointmentId: string, busy: boolean) => void;
  onCancel: (appointmentId: string) => void; onSaved: (saved: Appointment) => void;
};

export function OwnerAgendaAppointments({ business, dateKey, day, resourceId, saving, onCancel, onSaved, onAttendanceBusyChange }: OwnerAgendaAppointmentsProps) {
  const appointments = day?.state === 'ready' ? day.appointments : [];
  const resources = getOwnerAgendaResources(business.resources, day ? [day] : []);
  const warnings = getOwnerAgendaDayLayout(dateKey, appointments).warnings;
  const selected = appointments.filter(item => resourceId === null || item.resourceId === resourceId).sort((a, b) =>
    (Number.isFinite(a.startAt) ? a.startAt : Infinity) - (Number.isFinite(b.startAt) ? b.startAt : Infinity) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const dateTimestamp = Date.parse(`${dateKey}T12:00:00Z`);
  const validDate = /^\d{4}-\d{2}-\d{2}$/.test(dateKey) && Number.isFinite(dateTimestamp) && new Date(dateTimestamp).toISOString().slice(0, 10) === dateKey;
  const dateLabel = validDate ? new Intl.DateTimeFormat('es-CO', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(`${dateKey}T12:00:00Z`)) : 'Elige una fecha';
  return <section aria-labelledby="owner-agenda-day-details" className="min-w-0 space-y-4">
    <div>
      <p className="mb-2 text-xs font-medium text-sarin-blue">3. Abre una cita para ver sus detalles</p>
      <h2 id="owner-agenda-day-details" tabIndex={-1} className="rounded-lg text-xl font-semibold capitalize outline-none focus-visible:ring-2 focus-visible:ring-sarin-blue">Citas del día · {dateLabel}</h2>
      <p className="mt-2 text-xs text-sarin-muted">Hora de Colombia · {resourceId === null ? 'Todos los recursos' : resources.find(item => item.id === resourceId)?.label ?? `Recurso no disponible · ${resourceId}`}</p>
    </div>
    {!validDate ? <p className="py-6 text-sm text-sarin-muted">Elige el día que quieres revisar.</p>
      : !day ? <p role="status" className="py-6 text-sm text-sarin-muted">Cargando citas del día…</p>
        : day.state === 'error' ? <div role="status" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800"><p className="font-medium">No pudimos cargar este día</p>{day.message !== 'No pudimos cargar este día' && <p className="mt-1">{day.message}</p>}</div>
          : day.state === 'outside' ? <p className="rounded-xl border border-sarin-line bg-sarin-canvas p-4 text-sm text-sarin-muted">Fuera del rango consultable</p>
            : !selected.length ? <div className="rounded-2xl border border-dashed border-sarin-line px-5 py-8 text-center"><p className="font-medium">Sin registros para este día{resourceId ? ' y recurso' : ''}.</p><p className="mt-2 text-sm text-sarin-muted">Todavía no hay citas ni bloqueos registrados en esta selección.</p></div>
              : <ol className="space-y-3">{selected.map(appointment => {
                const blocked = appointment.type === 'manual_block';
                const labels: Record<Appointment['status'], string> = { confirmed: blocked ? 'Bloqueado' : 'Confirmada', cancelled_by_client: 'Cancelada por cliente', cancelled_by_owner: 'Cancelada por negocio', completed: 'Completada', no_show: 'No asistió' };
                const status = !blocked && appointment.status === 'completed' ? 'Atendida' : !blocked && appointment.status === 'confirmed' && Number.isFinite(appointment.reservedUntilAt) && Date.now() >= appointment.reservedUntilAt ? 'Pendiente de registrar' : Object.hasOwn(labels, appointment.status) ? labels[appointment.status] : 'Estado sin reconocer';
                const cancelled = appointment.status === 'cancelled_by_client' || appointment.status === 'cancelled_by_owner';
                const resource = resources.find(item => item.id === appointment.resourceId)?.label ?? `Recurso no disponible · ${appointment.resourceId}`;
                const cardContext = { appointmentId: appointment.id, dateKey, businessId: business.id };
                return <li key={appointment.id} className="min-w-0">
                  <details className={'group rounded-2xl border border-sarin-line ' + (blocked ? 'bg-sarin-canvas' : 'bg-white')}>
                    <summary className="min-h-11 cursor-pointer rounded-2xl p-4 outline-none focus-visible:ring-2 focus-visible:ring-sarin-blue sm:p-5">
                      <span className="ml-1 inline-flex max-w-[calc(100%_-_1.5rem)] flex-wrap items-start gap-x-4 gap-y-2 align-top">
                        <span className="shrink-0 tabular-nums text-sm font-semibold">{appointment.startTimeStr || 'Hora sin registrar'}–{appointment.endTimeStr || 'sin registrar'}</span>
                        <span className="min-w-0 flex-1 basis-40"><span className={'block break-words text-sm font-semibold [overflow-wrap:anywhere] ' + (cancelled ? 'text-sarin-muted line-through' : 'text-sarin-ink')}>{blocked ? 'Bloqueo de agenda' : appointment.serviceName || 'Servicio sin registrar'}</span><span className="mt-1 block break-words text-xs text-sarin-muted [overflow-wrap:anywhere]">{resource}</span></span>
                        <span className={'rounded-full px-2.5 py-1 text-xs font-medium ' + (cancelled ? 'bg-rose-50 text-rose-700' : 'bg-sarin-soft text-sarin-blue')}>{status}</span>
                      </span>
                    </summary>
                    <div className="space-y-3 border-t border-sarin-line px-4 py-4 text-sm sm:px-5">
                      {Object.hasOwn(warnings, appointment.id) && warnings[appointment.id].map(warning => <p key={warning} className="text-amber-800">{warning}</p>)}
                      {appointment.client && <div className="space-y-1"><p className="break-words text-sarin-ink">{appointment.client.name}</p><p className="break-all text-xs text-sarin-muted">{appointment.client.phone || appointment.client.email}</p></div>}
                      {!blocked && <p className="break-words [overflow-wrap:anywhere]">{appointment.beneficiary?.kind === 'represented_minor' ? <>Para: {appointment.beneficiary.displayName} · Gestionada por {appointment.client?.name || 'la cuenta reservante'}</> : appointment.beneficiary?.kind === 'self' ? <>Para la persona que reserva · Gestionada por {appointment.client?.name || 'la cuenta reservante'}</> : 'Registro anterior sin beneficiario declarado'}</p>}
                      <RepresentationReviewControls businessId={business.id} appointment={appointment} onSaved={saved => {
                        if (saved.id === cardContext.appointmentId && saved.dateKey === cardContext.dateKey && saved.tenantId === cardContext.businessId) onSaved(saved);
                      }} />
                      {!blocked && <AppointmentAttendanceControls businessId={business.id} ownerUid={business.ownerUid} appointment={appointment} disabled={saving} onBusyChange={busy => onAttendanceBusyChange(appointment.id, busy)} onSaved={saved => {
                        if (saved.id === cardContext.appointmentId && saved.dateKey === cardContext.dateKey && saved.tenantId === cardContext.businessId) onSaved(saved);
                      }} />}
                      {appointment.status === 'confirmed' && <div className="flex justify-end border-t border-sarin-line pt-3"><button type="button" disabled={saving} onClick={() => { if (!saving) onCancel(appointment.id); }} className="min-h-11 rounded-xl border border-sarin-line px-4 py-2 text-xs font-medium text-sarin-muted transition hover:bg-rose-50 hover:text-rose-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sarin-blue disabled:opacity-50">Cancelar {blocked ? 'bloqueo' : 'cita'}</button></div>}
                    </div>
                  </details>
                </li>;
              })}</ol>}
  </section>;
}
