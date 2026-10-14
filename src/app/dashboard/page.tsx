"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { Calendar, Clock } from "lucide-react";
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
    if (!business || !date) return;
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
      <section className="max-w-xl space-y-5">
        <h1 className="text-3xl font-bold">Tu agenda empieza aquí</h1>
        <p className="text-slate-400">
          Configura tus servicios y horarios para abrir tu isla privada.
        </p>
        <Link
          className={buttonClass + " inline-block"}
          href="/dashboard/onboarding"
        >
          Configurar mi negocio
        </Link>
      </section>
    );
  const sub = business.subscription;
  const end =
    sub.status === "trial"
      ? sub.trialEndsAt
      : Math.max(sub.currentPeriodEndsAt, sub.graceEndsAt ?? 0);
  return (
    <div className="space-y-7">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="mb-2 text-xs uppercase tracking-widest text-emerald-400">
            Mi negocio
          </p>
          <h1 className="text-3xl font-bold">{business.name}</h1>
          <p className="mt-2 text-sm text-slate-400">
            Agenda en vivo · Hora de Colombia
          </p>
        </div>
        <label className="text-xs text-slate-400">
          Fecha
          <input
            aria-label="Fecha de la agenda"
            className={fieldClass + " mt-2"}
            type="date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
            required
          />
        </label>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-800 bg-slate-900 p-4">
        <p className="flex items-center gap-2 text-sm">
          <Clock className="h-4 w-4 text-emerald-400" />
          {isSubscriptionAllowed(business, now)
            ? `${sub.status === "trial" ? "Prueba gratis" : "Suscripción"} · ${Math.max(0, Math.ceil((end - now) / 86400000))} días de acceso`
            : "Agenda automática pausada por suscripción"}
        </p>
        <Link
          href="/dashboard/billing"
          className="text-sm text-emerald-300 underline"
        >
          Ver suscripción
        </Link>
      </div>
      {error && <Notice error>{error}</Notice>}
      <section className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
        <h2 className="font-semibold">
          Reservar tiempo para atención presencial
        </h2>
        <form
          className="mt-4 grid gap-3 sm:grid-cols-4"
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
      </section>
      <section className="space-y-4">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <Calendar className="h-5 w-5 text-emerald-400" />
          Turnos del día
        </h2>
        {agendaLoading ? (
          <Notice>Cargando agenda…</Notice>
        ) : appointments.length === 0 ? (
          <Notice>Aún no hay citas ni bloqueos para esta fecha.</Notice>
        ) : (
          appointments.map((appointment) => (
            <article
              key={appointment.id}
              className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-slate-800 bg-slate-900 p-5"
            >
              <div className="space-y-2">
                <p className="font-mono text-sm text-emerald-300">
                  {appointment.startTimeStr}–{appointment.endTimeStr}
                  <span className="ml-3 font-sans text-xs text-slate-400">
                    {
                      business.resources.find(
                        (item) => item.id === appointment.resourceId,
                      )?.name
                    }
                  </span>
                </p>
                <h3 className="font-semibold">
                  {appointment.type === "manual_block"
                    ? "Bloqueo de agenda"
                    : appointment.serviceName}
                </h3>
                {appointment.client && (
                  <p className="text-sm text-slate-400">
                    {appointment.client.name} ·{" "}
                    {appointment.client.phone || appointment.client.email}
                  </p>
                )}
                <p className="text-xs text-slate-400">{appointment.status}</p>
              </div>
              {appointment.status === "confirmed" && (
                <button
                  disabled={saving}
                  onClick={() => void cancel(appointment.id)}
                  className="rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-300 hover:border-rose-500 hover:text-rose-300 disabled:opacity-50"
                >
                  Cancelar{" "}
                  {appointment.type === "manual_block" ? "bloqueo" : "cita"}
                </button>
              )}
            </article>
          ))
        )}
      </section>
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
