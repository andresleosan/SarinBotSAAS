"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import {
  ArrowUpRight,
  Calendar,
  ChevronDown,
  Clock,
  Plus,
  QrCode,
} from "lucide-react";
import { AuthGate } from "@/components/auth-provider";
import {
  AppShell,
  Notice,
  buttonClass,
  fieldClass,
} from "@/components/app-shell";
import { useBusiness } from "@/hooks/useBusiness";
import { getFirebaseClient } from "@/lib/firebase/client";
import { apiFetch, errorMessage } from "@/lib/client/api";
import { isSubscriptionAllowed } from "@/lib/sarin/subscription";
import type { Appointment } from "@/types/firestore";

function today() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Bogota",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function Agenda() {
  const { business, loading, error: businessError } = useBusiness();
  const [date, setDate] = useState(today);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [agendaLoading, setAgendaLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [blockStart, setBlockStart] = useState("");
  const [blockEnd, setBlockEnd] = useState("");
  const [resource, setResource] = useState("");
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    setAppointments([]);
    if (!business || !date) {
      setAgendaLoading(false);
      return;
    }
    setAgendaLoading(true);
    setError(null);
    return onSnapshot(
      query(
        collection(
          getFirebaseClient().db,
          "businesses",
          business.id,
          "appointments",
        ),
        where("dateKey", "==", date),
      ),
      (snapshot) => {
        setAppointments(
          snapshot.docs
            .map((item) => ({ ...item.data(), id: item.id }) as Appointment)
            .sort((a, b) => a.startAt - b.startAt),
        );
        setAgendaLoading(false);
      },
      (cause) => {
        setError(errorMessage(cause));
        setAgendaLoading(false);
      },
    );
  }, [business, date]);
  async function block(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!business) return;
    setSaving(true);
    setError(null);
    try {
      await apiFetch(`/api/businesses/${business.id}/appointments`, {
        method: "POST",
        body: JSON.stringify({
          dateKey: date,
          startTimeStr: blockStart,
          endTimeStr: blockEnd,
          resourceId:
            resource || business.resources.find((item) => item.active)?.id,
          requestId: crypto.randomUUID(),
        }),
      });
      setBlockStart("");
      setBlockEnd("");
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setSaving(false);
    }
  }
  async function cancel(appointmentId: string) {
    if (!business) return;
    setSaving(true);
    setError(null);
    try {
      await apiFetch(`/api/businesses/${business.id}/appointments`, {
        method: "PATCH",
        body: JSON.stringify({ appointmentId }),
      });
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setSaving(false);
    }
  }
  if (loading) return <Notice>Cargando tu negocio…</Notice>;
  if (businessError) return <Notice error>{businessError}</Notice>;
  if (!business)
    return (
      <section className="sarin-paper relative overflow-hidden rounded-[28px] border border-white/10 bg-[#f5f8fb] px-6 py-10 text-[#16314f] sm:px-10 sm:py-14">
        <div className="grid items-center gap-6 sm:grid-cols-[minmax(0,1fr)_180px]">
          <div className="max-w-xl">
            <p className="mb-4 font-mono text-xs uppercase tracking-[0.18em] text-[#25704e]">
              Un buen comienzo
            </p>
            <h1 className="text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">
              Tu próxima cita
              <br />
              empieza aquí.
            </h1>
            <p className="mt-4 max-w-md text-sm leading-7 text-[#536b83]">
              Configura tus servicios, profesionales y horarios. Después,
              comparte tu isla privada y deja que Sarin te ayude a organizar la
              agenda.
            </p>
            <Link
              className={buttonClass + " mt-6 inline-flex items-center gap-2"}
              href="/dashboard/onboarding"
            >
              Configurar mi negocio <ArrowUpRight className="h-4 w-4" />
            </Link>
          </div>
          <img
            src="/brand/sarin-welcome.png"
            alt=""
            width={180}
            height={180}
            className="mx-auto h-36 w-36 object-contain sm:h-44 sm:w-44"
          />
        </div>
      </section>
    );
  const sub = business.subscription;
  const end =
    sub.status === "trial"
      ? sub.trialEndsAt
      : Math.max(sub.currentPeriodEndsAt, sub.graceEndsAt ?? 0);
  const selectedDate = date ? new Date(date + "T12:00:00-05:00") : null;
  const dateLabel =
    selectedDate && Number.isFinite(selectedDate.getTime())
      ? new Intl.DateTimeFormat("es-CO", {
          timeZone: "America/Bogota",
          weekday: "long",
          day: "numeric",
          month: "long",
        }).format(selectedDate)
      : "Elige una fecha";
  const confirmed = appointments.filter(
    (appointment) =>
      appointment.status === "confirmed" && appointment.type === "appointment",
  ).length;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="mb-3 font-mono text-xs uppercase tracking-[0.18em] text-emerald-300">
            Tu día, en orden
          </p>
          <h1 className="break-words text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">
            {business.name}
          </h1>
          <p className="mt-3 text-sm text-slate-400">
            Cada reserva en su lugar. Cada cliente, a tiempo.
          </p>
        </div>
        <Link
          href={"/b/" + business.slug}
          className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-700 px-4 py-2 text-sm text-slate-200 transition hover:border-emerald-500/50 hover:text-emerald-200"
        >
          Ver mi isla
          <ArrowUpRight className="h-4 w-4 text-emerald-300" />
        </Link>
      </header>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-700/70 bg-slate-900/60 px-4 py-3">
        <p className="flex items-center gap-3 text-sm">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-emerald-500/10">
            <Clock className="h-4 w-4 text-emerald-300" />
          </span>
          {isSubscriptionAllowed(business, now)
            ? (sub.status === "trial" ? "Prueba gratis" : "Suscripción") +
              " · " +
              Math.max(0, Math.ceil((end - now) / 86400000)) +
              " días de acceso"
            : "Agenda automática pausada por suscripción"}
        </p>
        <Link
          href="/dashboard/billing"
          className="inline-flex min-h-10 items-center gap-2 text-xs font-semibold text-emerald-300 underline-offset-4 hover:underline"
        >
          Ver suscripción <ArrowUpRight className="h-3.5 w-3.5" />
        </Link>
      </div>
      {error && <Notice error>{error}</Notice>}

      <section
        className="sarin-paper overflow-hidden rounded-[24px] border border-white/10 bg-[#f5f8fb] text-[#16314f] shadow-[0_18px_70px_-40px_#0009] [color-scheme:light]"
        aria-label="Agenda del negocio"
      >
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[#dce5ee] px-4 py-5 sm:px-7 sm:py-6">
          <div>
            <h2 className="flex items-center gap-2.5 text-xl font-semibold">
              <Calendar className="h-5 w-5 text-[#25704e]" />
              Tu agenda
            </h2>
            <p className="mt-2 text-sm capitalize text-[#536b83]">
              {dateLabel}
            </p>
            <p className="mt-1 font-mono text-xs text-[#536b83]">
              Hora de Colombia · Actualización en vivo
            </p>
          </div>
          <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
            <button
              type="button"
              className="min-h-11 rounded-xl border border-[#cbd8e4] bg-white px-4 py-2 text-sm font-medium text-[#304e6b] transition hover:bg-[#eaf2fb]"
              onClick={() => setDate(today())}
            >
              Hoy
            </button>
            <label className="min-w-0 flex-1 sm:flex-none">
              <span className="sr-only">Fecha de la agenda</span>
              <input
                aria-label="Fecha de la agenda"
                className="min-h-11 w-full min-w-0 rounded-xl border border-[#cbd8e4] bg-white px-3 py-2 text-sm text-[#304e6b] outline-none focus:border-[#4d9bff] focus:ring-2 focus:ring-[#4d9bff]/15 sm:w-auto"
                type="date"
                value={date}
                onChange={(event) => setDate(event.target.value)}
                required
              />
            </label>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#dce5ee] px-4 py-3 sm:px-7">
          <p className="text-xs text-[#536b83]">
            {agendaLoading
              ? "Actualizando turnos…"
              : confirmed === 1
                ? "1 cita confirmada"
                : confirmed + " citas confirmadas"}
          </p>
          <Link
            href="/dashboard/qr-kit"
            className="inline-flex min-h-10 items-center gap-2 text-xs font-semibold text-[#25704e] underline-offset-4 hover:underline"
          >
            <QrCode className="h-4 w-4" />
            Compartir mi QR
          </Link>
        </div>

        <div className="px-4 sm:px-7">
          {agendaLoading ? (
            <div
              role="status"
              className="flex min-h-60 items-center justify-center gap-3 text-sm text-[#536b83]"
            >
              <Clock className="h-4 w-4" />
              Cargando agenda…
            </div>
          ) : !date ? (
            <div className="py-14 text-center">
              <Calendar className="mx-auto mb-4 h-8 w-8 text-[#6d8297]" />
              <h3 className="text-lg font-semibold">
                Elige el día que quieres revisar
              </h3>
              <p className="mt-2 text-sm text-[#536b83]">
                Puedes volver a la fecha actual con el botón Hoy.
              </p>
            </div>
          ) : appointments.length === 0 ? (
            <div className="mx-auto max-w-lg py-12 text-center sm:py-16">
              <div className="mx-auto mb-5 grid h-16 w-16 place-items-center rounded-2xl border border-[#d5e6dd] bg-[#e5f4eb]">
                <Calendar className="h-7 w-7 text-[#25704e]" />
              </div>
              <h3 className="text-xl font-semibold tracking-tight">
                Hay espacio para lo que viene.
              </h3>
              <p className="mt-3 text-sm leading-7 text-[#536b83]">
                Todavía no hay citas ni bloqueos para este día. Comparte tu
                enlace o tu QR para que tus clientes encuentren su próximo
                horario.
              </p>
              <div className="mt-6 flex flex-wrap justify-center gap-3">
                <Link
                  href="/dashboard/qr-kit"
                  className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-[#0d2746] px-4 py-2.5 text-sm font-semibold text-[#f5f8fb] transition hover:bg-[#164675]"
                >
                  <QrCode className="h-4 w-4 text-[#65d49d]" />
                  Abrir mi kit QR
                </Link>
                <Link
                  href="/dashboard/onboarding"
                  className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-[#cbd8e4] px-4 py-2.5 text-sm font-medium text-[#304e6b] transition hover:bg-white"
                >
                  Revisar horarios
                  <ArrowUpRight className="h-4 w-4" />
                </Link>
              </div>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-[64px_minmax(0,1fr)] gap-3 border-b border-[#dce5ee] py-4 font-mono text-xs uppercase tracking-wide text-[#536b83] sm:grid-cols-[88px_minmax(0,1fr)] sm:gap-5">
                <span>Hora</span>
                <span>Servicio y cliente</span>
              </div>
              <ol className="divide-y divide-[#dce5ee]">
                {appointments.map((appointment) => {
                  const cancelled =
                    appointment.status === "cancelled_by_client" ||
                    appointment.status === "cancelled_by_owner";
                  const blocked = appointment.type === "manual_block";
                  const labels: Record<Appointment["status"], string> = {
                    confirmed: blocked ? "Bloqueado" : "Confirmada",
                    cancelled_by_client: "Cancelada por cliente",
                    cancelled_by_owner: "Cancelada por negocio",
                    completed: "Completada",
                    no_show: "No asistió",
                  };
                  const badgeClass = cancelled
                    ? "bg-[#f6e8ed] text-[#8d4c60]"
                    : appointment.status === "no_show"
                      ? "bg-[#fff0d5] text-[#8f681d]"
                      : appointment.status === "completed"
                        ? "bg-[#e4eefb] text-[#306ca2]"
                        : blocked
                          ? "bg-[#e4edf5] text-[#4d6882]"
                          : "bg-[#e1f3e8] text-[#24724d]";
                  return (
                    <li
                      key={appointment.id}
                      className="grid grid-cols-[64px_minmax(0,1fr)] gap-3 py-5 sm:grid-cols-[88px_minmax(0,1fr)] sm:gap-5"
                    >
                      <div className="pt-4">
                        <time
                          dateTime={
                            appointment.dateKey +
                            "T" +
                            appointment.startTimeStr +
                            ":00-05:00"
                          }
                          className="font-mono text-base font-medium tracking-tight text-[#16314f] sm:text-lg"
                        >
                          {appointment.startTimeStr}
                        </time>
                        <p className="mt-1 font-mono text-xs text-[#536b83]">
                          {appointment.endTimeStr}
                        </p>
                      </div>
                      <article
                        className={
                          "min-w-0 rounded-2xl border p-4 sm:p-5 " +
                          (blocked
                            ? "border-[#d3dfe9] bg-[#eaf0f6]"
                            : "border-[#dce5ee] bg-white")
                        }
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="break-words font-mono text-xs text-[#536b83]">
                            {
                              business.resources.find(
                                (item) => item.id === appointment.resourceId,
                              )?.name
                            }
                          </p>
                          <span
                            className={
                              "rounded-full px-2.5 py-1 text-xs font-medium " +
                              badgeClass
                            }
                          >
                            {labels[appointment.status]}
                          </span>
                        </div>
                        <h3
                          className={
                            "mt-3 break-words text-base font-semibold leading-6 " +
                            (cancelled
                              ? "text-[#536b83] line-through decoration-[#a9bbc9]"
                              : "text-[#16314f]")
                          }
                        >
                          {blocked
                            ? "Bloqueo de agenda"
                            : appointment.serviceName}
                        </h3>
                        {appointment.client && (
                          <div className="mt-2 space-y-1">
                            <p className="break-words text-sm text-[#445f79]">
                              {appointment.client.name}
                            </p>
                            <p className="break-all text-xs text-[#536b83]">
                              {appointment.client.phone ||
                                appointment.client.email}
                            </p>
                          </div>
                        )}
                        {appointment.status === "confirmed" && (
                          <div className="mt-4 flex justify-end border-t border-[#e5ecf2] pt-3">
                            <button
                              disabled={saving}
                              onClick={() => void cancel(appointment.id)}
                              className="min-h-10 rounded-lg px-2 py-2 text-xs font-medium text-[#536b83] transition hover:bg-rose-50 hover:text-rose-700 disabled:opacity-50"
                            >
                              Cancelar {blocked ? "bloqueo" : "cita"}
                            </button>
                          </div>
                        )}
                      </article>
                    </li>
                  );
                })}
              </ol>
            </>
          )}
        </div>
      </section>

      <details className="group rounded-2xl border border-slate-700/70 bg-slate-900/60">
        <summary className="flex min-h-16 cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 [&::-webkit-details-marker]:hidden">
          <span className="flex items-center gap-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-emerald-500/10">
              <Plus className="h-4 w-4 text-emerald-300" />
            </span>
            <span>
              <span className="block text-sm font-semibold">
                Bloquear un horario
              </span>
              <span className="mt-1 block text-xs text-slate-400">
                Reserva tiempo para atención presencial o una pausa.
              </span>
            </span>
          </span>
          <ChevronDown className="h-4 w-4 shrink-0 text-slate-400 transition group-open:rotate-180 motion-reduce:transition-none" />
        </summary>
        <form
          className="grid gap-4 border-t border-slate-700/70 px-5 py-5 sm:grid-cols-2 xl:grid-cols-4"
          onSubmit={(event) => void block(event)}
        >
          <label className="text-xs text-slate-400">
            Desde
            <input
              className={fieldClass + " mt-2"}
              type="time"
              value={blockStart}
              onChange={(event) => setBlockStart(event.target.value)}
              required
            />
          </label>
          <label className="text-xs text-slate-400">
            Hasta
            <input
              className={fieldClass + " mt-2"}
              type="time"
              value={blockEnd}
              onChange={(event) => setBlockEnd(event.target.value)}
              required
            />
          </label>
          <label className="text-xs text-slate-400">
            Profesional o estación
            <select
              className={fieldClass + " mt-2"}
              value={
                resource ||
                business.resources.find((item) => item.active)?.id ||
                ""
              }
              onChange={(event) => setResource(event.target.value)}
            >
              {business.resources
                .filter((item) => item.active)
                .map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
            </select>
          </label>
          <button
            disabled={
              saving || !date || !business.resources.some((item) => item.active)
            }
            className={buttonClass + " self-end"}
          >
            {saving ? "Guardando…" : "Bloquear horario"}
          </button>
        </form>
      </details>
    </div>
  );
}
export default function BusinessDashboardPage() {
  return (
    <AuthGate>
      <AppShell>
        <Agenda />
      </AppShell>
    </AuthGate>
  );
}
