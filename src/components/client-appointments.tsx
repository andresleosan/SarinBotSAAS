"use client";

import { useEffect, useRef, useState } from "react";
import { Download } from "lucide-react";
import { Notice, buttonClass, fieldClass } from "@/components/app-shell";
import { apiFetch, errorMessage } from "@/lib/client/api";
import { useApiPoll } from "@/lib/client/use-api-poll";
import { createAppointmentImage, type AppointmentImageDetails } from "@/lib/client/appointment-image";
import type { Appointment, TenantResource, TenantService } from "@/types/firestore";

type View = "upcoming" | "history" | "calendar";
const views: { id: View; label: string }[] = [
  { id: "upcoming", label: "Próximas" },
  { id: "history", label: "Historial" },
  { id: "calendar", label: "Calendario" },
];
const knownStatuses: Appointment["status"][] = ["confirmed", "cancelled_by_client", "cancelled_by_owner", "completed", "no_show"];
const dateFormat = new Intl.DateTimeFormat("es-CO", { timeZone: "America/Bogota", day: "numeric", month: "long", year: "numeric" });
const timeFormat = new Intl.DateTimeFormat("es-CO", { timeZone: "America/Bogota", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const dateKeyFormat = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota", year: "numeric", month: "2-digit", day: "2-digit" });
function dateKey(timestamp: number): string {
  const parts = dateKeyFormat.formatToParts(timestamp);
  return ["year", "month", "day"].map(type => parts.find(part => part.type === type)?.value).join("-");
}
function canChange(appointment: Appointment, now: number): boolean {
  return appointment.status === "confirmed" && appointment.startAt > now;
}
function isHistorical(appointment: Appointment, now: number): boolean {
  return appointment.status !== "confirmed" || appointment.endAt <= now;
}
function statusLabel(appointment: Appointment, now: number): string {
  switch (appointment.status) {
    case "cancelled_by_client": return "Cancelada por ti";
    case "cancelled_by_owner": return "Cancelada por el negocio";
    case "completed": return "Completada por el negocio";
    case "no_show": return "Inasistencia registrada";
    default: return appointment.endAt <= now ? "Horario finalizado" : appointment.startAt <= now ? "En curso" : "Confirmada";
  }
}

export function ClientAppointments({ businessId, businessName, resources = [], services = [], userId, now, onRebook, rebookingEnabled = false }: { businessId: string; businessName: string; resources?: TenantResource[]; services?: TenantService[]; userId: string; now: number; onRebook?: (serviceId: string) => void; rebookingEnabled?: boolean }) {
  const [retry, setRetry] = useState(0);
  const scope = `${businessId}:${userId}`;
  const currentScope = useRef({ key: scope });
  if (currentScope.current.key !== scope) currentScope.current = { key: scope };
  const actionScope = currentScope.current;
  const appointmentRead = useApiPoll<Appointment[]>(`${scope}:${retry}`, async signal => (await apiFetch<{ appointments: Appointment[] }>(`/api/businesses/${encodeURIComponent(businessId)}/appointments?view=mine`, { signal })).appointments);
  const appointments = appointmentRead.value ?? [];
  const loading = appointmentRead.loading, readError = appointmentRead.error;
  const [view, setView] = useState<View>("upcoming");
  const [selectedDate, setSelectedDate] = useState(() => dateKey(now));
  const [confirmationId, setConfirmationId] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const pending = useRef<string | null>(null);
  const exporting = useRef<string | null>(null);
  const [exportingId, setExportingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    currentScope.current = actionScope;
    setConfirmationId(null); setPendingId(null); pending.current = null;
    exporting.current = null; setExportingId(null);
    setActionError(null); setNotice(null);
    return () => { if (currentScope.current === actionScope) currentScope.current = { key: '' }; };
  }, [scope]);

  // The query is scoped by the authenticated UID; recheck it before displaying or acting.
  const ownAppointments = appointments.filter(item => item.tenantId === businessId && item.type === "appointment" && item.client?.uid === userId && knownStatuses.includes(item.status)
    && Number.isFinite(item.startAt) && Number.isFinite(item.endAt) && item.endAt > item.startAt);
  const latest = useRef({ appointments: ownAppointments, businessName, resources, services, onRebook, rebookingEnabled, view, loading, readError });
  latest.current = { appointments: ownAppointments, businessName, resources, services, onRebook, rebookingEnabled, view, loading, readError };
  const visible = ownAppointments.filter(item => view === "calendar" ? dateKey(item.startAt) === selectedDate
    : view === "upcoming" ? item.status === "confirmed" && item.endAt > now : isHistorical(item, now))
    .sort((a, b) => view === "history" ? b.startAt - a.startAt : a.startAt - b.startAt);

  function changeView(next: View) {
    setView(next);
    setConfirmationId(null);
    setActionError(null);
  }
  function rebook(appointment: Appointment) {
    if (currentScope.current !== actionScope || pending.current || exporting.current) return;
    const current = latest.current;
    if (current.view !== "history" || !current.onRebook || !current.rebookingEnabled || current.loading || current.readError) return;
    const saved = current.appointments.find(item => item.id === appointment.id);
    if (!saved || saved.serviceId !== appointment.serviceId || !isHistorical(saved, Date.now())) return;
    const service = current.services.find(item => item.id === saved.serviceId);
    if (service) current.onRebook(service.id);
  }
  async function cancel(appointment: Appointment) {
    if (pending.current || exporting.current || appointment.client?.uid !== userId || !canChange(appointment, Date.now())) return;
    pending.current = appointment.id;
    setPendingId(appointment.id);
    setActionError(null);
    setNotice(null);
    try {
      const result = await apiFetch<{ appointment: Appointment }>(`/api/businesses/${encodeURIComponent(businessId)}/appointments`, {
        method: "PATCH", body: JSON.stringify({ appointmentId: appointment.id }),
      });
      if (currentScope.current !== actionScope) return;
      const saved = result.appointment;
      if (saved?.id !== appointment.id || saved.tenantId !== businessId || saved.client?.uid !== userId || !["cancelled_by_client", "cancelled_by_owner"].includes(saved.status)) {
        throw new Error("No se pudo confirmar la cancelación. Revisa el estado de tu cita antes de intentarlo de nuevo.");
      }
      appointmentRead.setValue(current => (current ?? []).map(item => item.id === appointment.id ? { ...item, status: saved.status } : item));
      setConfirmationId(null);
      setView("history");
      setNotice("Cita cancelada.");
    } catch (cause) { if (currentScope.current === actionScope) setActionError(errorMessage(cause)); }
    finally { if (currentScope.current === actionScope) { pending.current = null; setPendingId(null); } }
  }
  async function download(appointment: Appointment) {
    if (pending.current || exporting.current || appointment.client?.uid !== userId || !canChange(appointment, Date.now())) return;
    exporting.current = appointment.id;
    setExportingId(appointment.id); setActionError(null); setNotice(null);
    const generatedAt = Date.now();
    function details(item: Appointment): AppointmentImageDetails {
      return { businessName: latest.current.businessName, serviceName: item.serviceName || "Cita",
        resourceName: latest.current.resources.find(resource => resource.id === item.resourceId)?.name,
        startAt: item.startAt, endAt: item.endAt, generatedAt };
    }
    const snapshot = details(appointment);
    try {
      const image = await createAppointmentImage(snapshot);
      if (currentScope.current !== actionScope) return;
      const current = latest.current.appointments.find(item => item.id === appointment.id);
      if (!current || !canChange(current, Date.now()) || JSON.stringify(details(current)) !== JSON.stringify(snapshot)) {
        setActionError("La cita cambió mientras preparábamos la imagen. Revisa Mis citas antes de intentarlo de nuevo.");
        return;
      }
      const url = URL.createObjectURL(image);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `cita-${dateKey(current.startAt)}.png`;
      try { document.body.appendChild(anchor); anchor.click(); }
      finally { anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000); }
      setNotice("Imagen de la cita descargada. Consulta Mis citas para ver cambios o cancelaciones.");
    } catch (cause) { if (currentScope.current === actionScope) setActionError(errorMessage(cause)); }
    finally { if (currentScope.current === actionScope) { exporting.current = null; setExportingId(null); } }
  }

  return (
    <section id="mis-citas" aria-labelledby="my-appointments-title" className="min-w-0 scroll-mt-40 space-y-4 rounded-2xl border border-sarin-line bg-sarin-paper p-4 sm:p-5">
      <div>
        <h2 id="my-appointments-title" className="font-semibold text-sarin-ink">Mis citas</h2>
        <p className="mt-1 text-xs text-sarin-muted">Tus reservas en este negocio. Horarios de Colombia.</p>
      </div>
      <div role="group" aria-label="Ver mis citas" className="grid grid-cols-3 gap-1 rounded-xl bg-sarin-canvas p-1">
        {views.map(item => <button key={item.id} type="button" aria-pressed={view === item.id} onClick={() => changeView(item.id)}
          className={`min-h-11 min-w-0 rounded-lg px-1 text-xs font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sarin-blue sm:text-sm ${view === item.id ? "bg-sarin-blue text-white" : "text-sarin-muted hover:bg-sarin-soft"}`}>{item.label}</button>)}
      </div>
      {view === "calendar" && <label className="block space-y-2 text-sm font-medium text-sarin-ink">
        <span>Consultar mis citas por fecha</span>
        <input type="date" aria-label="Fecha de mis citas" className={`${fieldClass} min-w-0 max-w-full`} value={selectedDate} onChange={event => { setSelectedDate(event.target.value); setConfirmationId(null); }} />
      </label>}
      {readError && <div className="space-y-2"><Notice error>No pudimos cargar tus citas. {readError}</Notice>
        <button type="button" className="min-h-11 text-sm text-sarin-blue underline" onClick={() => setRetry(value => value + 1)}>Reintentar cargar citas</button></div>}
      {actionError && <Notice error>{actionError}</Notice>}
      {notice && <p role="status" className="text-sm text-sarin-blue">{notice}</p>}
      {loading && <p role="status" className="text-sm text-sarin-muted">Cargando tus citas…</p>}
      {!loading && !readError && visible.length === 0 && <p className="py-3 text-sm text-sarin-muted">
        {view === "upcoming" ? "No tienes próximas citas en este negocio." : view === "history" ? "Aún no tienes citas en tu historial." : selectedDate ? "No tienes citas para esta fecha." : "Elige una fecha para consultar tus citas."}
      </p>}
      <div className="space-y-3">
        {visible.map(appointment => {
          const currentService = services.find(service => service.id === appointment.serviceId);
          return <article key={appointment.id} className="min-w-0 space-y-3 rounded-xl border border-sarin-line bg-sarin-canvas p-3 sm:p-4">
          <div className="space-y-1">
            <h3 className="break-words font-semibold [overflow-wrap:anywhere]">{appointment.serviceName || "Cita"}</h3>
            <p className="break-words text-sm [overflow-wrap:anywhere]">{appointment.beneficiary?.kind === 'represented_minor' ? <>Para: {appointment.beneficiary.displayName} · Gestionada por {appointment.client?.name || 'tu cuenta'}</> : appointment.beneficiary?.kind === 'self' ? 'Reserva para ti' : 'Registro anterior sin beneficiario declarado'}</p>
            <p className="text-sm text-sarin-ink">{dateFormat.format(appointment.startAt)}</p>
            <p className="text-sm tabular-nums text-sarin-muted">{timeFormat.format(appointment.startAt)}–{timeFormat.format(appointment.endAt)} (Colombia)</p>
            <p className="text-xs font-semibold text-sarin-blue">{statusLabel(appointment, now)}</p>
          </div>
          {view === "history" && onRebook && currentService && <button type="button" aria-label={`Volver a reservar: ${currentService.name}`} disabled={!rebookingEnabled || loading || Boolean(readError || pendingId || exportingId)} onClick={() => rebook(appointment)} className="min-h-11 max-w-full rounded-[10px] border border-sarin-line px-3 py-2 text-left text-sm font-semibold text-sarin-blue hover:border-sarin-blue hover:bg-sarin-soft focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-sarin-blue disabled:cursor-not-allowed disabled:opacity-50">Volver a reservar</button>}
          {canChange(appointment, now) && <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
            <button type="button" disabled={Boolean(pendingId || exportingId)} className="flex min-h-11 items-center gap-2 text-sm font-medium text-sarin-blue disabled:opacity-50" onClick={() => download(appointment)}><Download className="h-4 w-4 shrink-0" />{exportingId === appointment.id ? "Preparando imagen…" : "Guardar imagen de la cita"}</button>
            {confirmationId !== appointment.id && <button type="button" disabled={Boolean(pendingId || exportingId)} className="min-h-11 text-sm text-sarin-muted underline disabled:opacity-50" onClick={() => { setConfirmationId(appointment.id); setActionError(null); setNotice(null); }}>Cancelar cita</button>}
          </div>}
          {confirmationId === appointment.id && canChange(appointment, now) && <div role="group" aria-label={`Confirmar cancelación de ${appointment.serviceName || "cita"}`} className="space-y-3 border-t border-sarin-line pt-3">
            <p className="text-sm text-sarin-ink">¿Quieres cancelar esta cita? El horario quedará libre.</p>
            <div className="flex flex-wrap gap-2">
              <button type="button" className={buttonClass} disabled={Boolean(pendingId || exportingId)} onClick={() => cancel(appointment)}>{pendingId === appointment.id ? "Cancelando…" : "Sí, cancelar cita"}</button>
              <button type="button" className="min-h-11 rounded-xl border border-sarin-line px-3 text-sm text-sarin-ink disabled:opacity-50" disabled={Boolean(pendingId)} onClick={() => { setConfirmationId(null); setActionError(null); }}>Conservar cita</button>
            </div>
          </div>}
        </article>;
        })}
      </div>
    </section>
  );
}
