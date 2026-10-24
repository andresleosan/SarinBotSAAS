"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import {
  ArrowUpRight,
  ChevronDown,
  Clock,
  Plus,
  QrCode,
} from "lucide-react";
import { AuthGate, useAuth } from "@/components/auth-provider";
import { useAccountConsent } from '@/components/consent-panel';
import {
  AppShell,
  Notice,
  buttonClass,
  fieldClass,
} from "@/components/app-shell";
import { useBusiness } from "@/hooks/useBusiness";
import { useOwnerAgenda } from '@/hooks/use-owner-agenda';
import { OwnerAgendaCalendar } from '@/components/owner-agenda-calendar';
import { OwnerAgendaAppointments } from '@/components/owner-agenda-appointments';
import { agendaToday, getOwnerAgendaRange, getOwnerAgendaResources, type OwnerAgendaMode } from '@/lib/owner-agenda';
import { apiFetch, errorMessage } from "@/lib/client/api";
import { isSubscriptionAllowed } from "@/lib/sarin/subscription";
import { PaidTrialStatus } from "@/components/paid-trial-status";
import { ClientPolicyControls } from "@/components/client-policy-controls";
import type { Appointment } from "@/types/firestore";

function Agenda() {
  const accountConsent = useAccountConsent();
  const { business, loading, error: businessError } = useBusiness();
  const { user } = useAuth();
  const [date, setDate] = useState(() => agendaToday(Date.now()));
  const [mode, setMode] = useState<OwnerAgendaMode>('day');
  const ownerKey = JSON.stringify([user?.uid, business?.id]);
  const [resourceSelection, setResourceSelection] = useState<{ ownerKey: string; id: string | null }>({ ownerKey, id: null });
  const selectedResourceId = resourceSelection.ownerKey === ownerKey ? resourceSelection.id : null;
  const setSelectedResourceId = (id: string | null) => setResourceSelection({ ownerKey, id });
  const [now, setNow] = useState(Date.now());
  const range = getOwnerAgendaRange(date, mode, now);
  const enabled = !loading && !businessError && !!user && business?.ownerUid === user.uid && !!business?.sarinConfig.onboardingCompleted;
  const scope = JSON.stringify([user?.uid, business?.id, date, range?.dates, range?.queryDates, range?.outsideDates, enabled]);
  const scopeRef = useRef({ key: scope });
  if (scopeRef.current.key !== scope) scopeRef.current = { key: scope };
  const actionScope = scopeRef.current;
  const actionRequest = useRef<AbortController | null>(null);
  const [actionError, setActionError] = useState<{ scope: typeof actionScope; message: string } | null>(null);
  const setError = (message: string | null) => setActionError(message === null ? null : { scope: actionScope, message });
  const [saving, setSaving] = useState(false);
  const [blockStart, setBlockStart] = useState('');
  const [blockEnd, setBlockEnd] = useState('');
  const [resource, setResource] = useState('');
  const agenda = useOwnerAgenda({ businessId: business?.id ?? null, ownerUid: user?.uid ?? null, range, enabled });
  const day = agenda.snapshot?.days.find(item => item.dateKey === date) ?? null;
  const appointments = day?.state === 'ready' ? day.appointments : [];
  const resources = getOwnerAgendaResources(business?.resources ?? [], agenda.snapshot?.days ?? []);
  const rangeResolved = agenda.snapshot?.days.every(item => item.state !== 'error') ?? false;
  useEffect(() => {
    if (resources.some(item => item.id === selectedResourceId)) return;
    if (mode === 'week') {
      if (selectedResourceId === null || rangeResolved) setSelectedResourceId(resources[0]?.id ?? null);
    } else if (selectedResourceId !== null && day?.state === 'ready') setSelectedResourceId(null);
  }, [ownerKey, mode, selectedResourceId, resources.map(item => item.id).join('\0'), day?.state, rangeResolved]);
  useEffect(() => {
    setError(null); setSaving(false); setBlockStart(''); setBlockEnd(''); setResource('');
    return () => {
      actionRequest.current?.abort(); actionRequest.current = null;
      if (scopeRef.current === actionScope) scopeRef.current = { key: '' };
    };
  }, [scope]);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(id);
  }, []);
  const currentAction = (controller: AbortController) => scopeRef.current === actionScope && !controller.signal.aborted;
  async function block(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const resourceId = resource || business?.resources.find(item => item.active)?.id;
    if (!enabled || !user || !business || !range || !accountConsent.active || !resourceId || !business.resources.some(item => item.id === resourceId && item.active) || actionRequest.current) return;
    const controller = actionRequest.current = new AbortController();
    setSaving(true); setError(null);
    try {
      const response = await apiFetch<{ appointment: Appointment }>(`/api/businesses/${business.id}/appointments`, {
        method: 'POST', signal: controller.signal,
        body: JSON.stringify({ dateKey: date, startTimeStr: blockStart, endTimeStr: blockEnd, resourceId, requestId: crypto.randomUUID() }),
      }, user.uid, () => currentAction(controller));
      if (!currentAction(controller)) return;
      const saved = response?.appointment;
      if (!saved || typeof saved.id !== 'string' || !saved.id.trim() || saved.tenantId !== business.id || saved.dateKey !== date || saved.type !== 'manual_block' || saved.status !== 'confirmed' || saved.resourceId !== resourceId || saved.startTimeStr !== blockStart || saved.endTimeStr !== blockEnd) throw new Error('No se pudo comprobar el resultado. Actualiza la agenda.');
      setBlockStart(''); setBlockEnd(''); agenda.refresh();
    } catch (cause) {
      if (currentAction(controller)) setError(errorMessage(cause));
    } finally {
      if (scopeRef.current === actionScope) setSaving(false);
      if (actionRequest.current === controller) actionRequest.current = null;
    }
  }
  async function cancel(appointmentId: string) {
    if (!enabled || !user || !business || !range || !appointments.some(item => item.id === appointmentId && item.status === 'confirmed') || actionRequest.current) return;
    const controller = actionRequest.current = new AbortController();
    setSaving(true); setError(null);
    try {
      const response = await apiFetch<{ appointment: Appointment }>(`/api/businesses/${business.id}/appointments`, {
        method: 'PATCH', signal: controller.signal, body: JSON.stringify({ appointmentId }),
      }, user.uid, () => currentAction(controller));
      if (!currentAction(controller)) return;
      const saved = response?.appointment;
      if (!saved || saved.id !== appointmentId || saved.tenantId !== business.id || saved.dateKey !== date || !['cancelled_by_owner', 'cancelled_by_client', 'completed', 'no_show'].includes(saved.status)) throw new Error('No se pudo comprobar el resultado. Actualiza la agenda.');
      agenda.refresh();
    } catch (cause) {
      if (currentAction(controller)) setError(errorMessage(cause));
    } finally {
      if (scopeRef.current === actionScope) setSaving(false);
      if (actionRequest.current === controller) actionRequest.current = null;
    }
  }
  if (loading) return <Notice>Cargando tu negocio…</Notice>;
  if (businessError) return <Notice error>{businessError}</Notice>;
  if (!business || !business.sarinConfig.onboardingCompleted)
    return (
      <section className="sarin-paper relative overflow-hidden rounded-2xl border border-sarin-line bg-sarin-paper px-6 py-10 text-sarin-ink sm:px-10 sm:py-14">
        <div className="grid items-center gap-6 sm:grid-cols-[minmax(0,1fr)_180px]">
          <div className="max-w-xl">
            <p className="mb-4 tabular-nums text-xs uppercase tracking-[0.18em] text-sarin-blue">
              Un buen comienzo
            </p>
            <h1 className="text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">
              Tu próxima cita
              <br />
              empieza aquí.
            </h1>
            <p className="mt-4 max-w-md text-sm leading-7 text-sarin-muted">
              Empieza con una prueba pagada de $5.000 COP para configurar tu
              negocio y recibir hasta 10 citas, sin caducidad. Después, elige
              un plan para continuar.
            </p>
            <Link
              className={buttonClass + " mt-6 inline-flex items-center gap-2"}
              href={isSubscriptionAllowed(business, now) ? "/dashboard/onboarding" : "/dashboard/billing"}
            >
              {isSubscriptionAllowed(business, now) ? "Configurar mi negocio" : "Ver pagos y planes"} <ArrowUpRight className="h-4 w-4" />
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
  const end = Math.max(sub.currentPeriodEndsAt, sub.graceEndsAt ?? 0);
  if (!enabled) return <Notice error>No tienes acceso a la agenda de este negocio.</Notice>;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="mb-3 tabular-nums text-xs uppercase tracking-[0.18em] text-sarin-blue">
            Tu día, en orden
          </p>
          <h1 className="break-words text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">
            {business.name}
          </h1>
          <p className="mt-3 text-sm text-sarin-muted">
            Cada reserva en su lugar. Cada cliente, a tiempo.
          </p>
        </div>
        <Link
          href={"/b/" + business.slug}
          className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-sarin-line px-4 py-2 text-sm text-sarin-ink transition hover:border-sarin-blue hover:text-sarin-blue"
        >
          Ver mi isla
          <ArrowUpRight className="h-4 w-4 text-sarin-blue" />
        </Link>
      </header>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-sarin-line bg-sarin-paper px-4 py-3">
        <p className="flex items-center gap-3 text-sm">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-sarin-soft">
            <Clock className="h-4 w-4 text-sarin-blue" />
          </span>
          {isSubscriptionAllowed(business, now)
            ? sub.status === "trial" ? (sub.paidTrial?.source === 'invitation' ? "Prueba de cortesía · hasta 10 citas, sin caducidad" : "Prueba pagada · hasta 10 citas, sin caducidad") : "Suscripción" +
              " · " +
              Math.max(0, Math.ceil((end - now) / 86400000)) +
              " días de acceso"
            : "Agenda automática pausada por suscripción"}
        </p>
        <Link
          href="/dashboard/billing"
          className="inline-flex min-h-11 items-center gap-2 text-xs font-semibold text-sarin-blue underline-offset-4 hover:underline"
        >
          Ver suscripción <ArrowUpRight className="h-3.5 w-3.5" />
        </Link>
      </div>
      <PaidTrialStatus subscription={sub} />
      {day?.state === 'ready' ? <ClientPolicyControls businessId={business.id} ownerUid={business.ownerUid} clients={[...new Map(appointments.filter(item => item.client?.uid).map(item => [item.client!.uid, { uid: item.client!.uid, name: item.client!.name }])).values()]} /> : <p className="text-sm text-sarin-muted">Las políticas de clientes estarán disponibles cuando cargue el día seleccionado.</p>}
      {actionError?.scope === actionScope && <Notice error>{actionError.message}</Notice>}
      <OwnerAgendaCalendar business={business} mode={mode} selectedDate={date} resourceId={selectedResourceId} range={range} snapshot={agenda.snapshot} loading={agenda.loading} error={agenda.error} busy={saving}
        onModeChange={value => { if (!actionRequest.current) setMode(value); }}
        onDateChange={value => { if (!actionRequest.current) setDate(value); }}
        onResourceChange={value => { if (!actionRequest.current) setSelectedResourceId(value); }}
        onRefresh={agenda.refresh} />
      <div className="flex justify-end"><Link href="/dashboard/qr-kit" className="inline-flex min-h-11 items-center gap-2 text-xs font-semibold text-sarin-blue underline-offset-4 hover:underline"><QrCode className="h-4 w-4" />Compartir mi QR</Link></div>
      <OwnerAgendaAppointments key={`${user?.uid}:${business.id}:${date}`} business={business} dateKey={date} day={day} resourceId={selectedResourceId} saving={saving} onCancel={id => void cancel(id)} onSaved={saved => {
        if (scopeRef.current !== actionScope || saved.tenantId !== business.id || saved.dateKey !== date || !appointments.some(item => item.id === saved.id && item.tenantId === saved.tenantId && item.dateKey === saved.dateKey)) return;
        agenda.replaceAppointment(saved);
      }} />

      <details className="group rounded-2xl border border-sarin-line bg-sarin-paper">
        <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 [&::-webkit-details-marker]:hidden">
          <span className="flex items-center gap-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-sarin-soft">
              <Plus className="h-4 w-4 text-sarin-blue" />
            </span>
            <span>
              <span className="block text-sm font-semibold">
                Bloquear un horario
              </span>
              <span className="mt-1 block text-xs text-sarin-muted">
                Reserva tiempo para atención presencial o una pausa.
              </span>
            </span>
          </span>
          <ChevronDown className="h-4 w-4 shrink-0 text-sarin-muted transition group-open:rotate-180 motion-reduce:transition-none" />
        </summary>
        <form
          className="grid gap-3 border-t border-sarin-line px-4 py-4 sm:grid-cols-2 xl:grid-cols-4"
          onSubmit={(event) => void block(event)}
        >
          <label className="text-xs text-sarin-muted">
            Desde
            <input
              className={fieldClass + " mt-1"}
              type="time"
              value={blockStart}
              onChange={(event) => setBlockStart(event.target.value)}
              required
            />
          </label>
          <label className="text-xs text-sarin-muted">
            Hasta
            <input
              className={fieldClass + " mt-1"}
              type="time"
              value={blockEnd}
              onChange={(event) => setBlockEnd(event.target.value)}
              required
            />
          </label>
          <label className="text-xs text-sarin-muted">
            Profesional o estación
            <select
              className={fieldClass + " mt-1"}
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
              !accountConsent.active || saving || !range || !business.resources.some((item) => item.active)
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
