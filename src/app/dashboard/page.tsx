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
import { useResourceSchedules } from '@/hooks/use-resource-schedules';
import { useOwnerAgenda } from '@/hooks/use-owner-agenda';
import { preserveNewerAppointmentResults } from '@/hooks/use-appointment-attendance';
import { OwnerAgendaCalendar } from '@/components/owner-agenda-calendar';
import { OwnerAgendaAppointments } from '@/components/owner-agenda-appointments';
import { OwnerClientRecordPanel } from '@/components/owner-client-record-panel';
import { OwnerRescheduleBoundary } from '@/components/owner-reschedule-boundary';
import { useOwnerAuthority } from '@/hooks/use-owner-authority';
import { ownerApiFetch } from '@/lib/client/owner-request-scope';
import type { OwnerRescheduleEntry } from '@/lib/owner-rescheduling';
import type { OwnerAgendaSnapshot } from '@/lib/owner-agenda';
import type { OwnerClientRecordScope } from '@/hooks/use-owner-client-record';
import { agendaToday, getOwnerAgendaRange, getOwnerAgendaResources, type OwnerAgendaMode } from '@/lib/owner-agenda';
import { errorMessage } from "@/lib/client/api";
import { isSubscriptionAllowed } from "@/lib/sarin/subscription";
import { PaidTrialStatus } from "@/components/paid-trial-status";
import { ClientPolicyControls } from "@/components/client-policy-controls";
import type { Appointment, Business } from "@/types/firestore";

function OwnerSetup({ business, now }: { business: Business | null; now: number }) {
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
}

function OwnerDashboardWorkspace({ business, businessError, isCurrentWorkspace }: { business: Business; businessError: string | null; isCurrentWorkspace: () => boolean }) {
  const accountConsent = useAccountConsent();
  const { user, authEpoch } = useAuth();
  const authority = useOwnerAuthority({ ownerUid: business.ownerUid, authEpoch, businessId: business.id, isCurrentWorkspace });
  const requestScope = authority.requestScope;
  const [rescheduleEntry, setRescheduleEntry] = useState<OwnerRescheduleEntry | null>(null);
  const rescheduleRef = useRef<OwnerRescheduleEntry | null>(null); rescheduleRef.current = rescheduleEntry;
  const rescheduleLocked = useRef(false);
  const [date, setDate] = useState(() => agendaToday(Date.now()));
  const [mode, setMode] = useState<OwnerAgendaMode>('day');
  const ownerKey = JSON.stringify([user?.uid, business?.id]);
  const [resourceSelection, setResourceSelection] = useState<{ ownerKey: string; id: string | null }>({ ownerKey, id: null });
  const selectedResourceId = resourceSelection.ownerKey === ownerKey ? resourceSelection.id : null;
  const setSelectedResourceId = (id: string | null) => setResourceSelection({ ownerKey, id });
  const [now, setNow] = useState(Date.now());
  const range = getOwnerAgendaRange(date, mode, now);
  const enabled = !!user && business.ownerUid === user.uid && !!business.sarinConfig.onboardingCompleted;
  const schedules = useResourceSchedules({ businessId: business.id, ownerUid: user?.uid ?? null, authEpoch, mode: 'read', enabled, requestScope });
  const scope = JSON.stringify([user?.uid, business?.id, date, range?.dates, range?.queryDates, range?.outsideDates, enabled, authEpoch]);
  const scopeRef = useRef({ key: scope });
  if (scopeRef.current.key !== scope) scopeRef.current = { key: scope };
  const actionScope = scopeRef.current;
  type RecordSelection = { authority: typeof actionScope; scope: OwnerClientRecordScope; invalidation: number };
  const [recordSelection, setRecordSelection] = useState<RecordSelection | null>(null);
  const recordSelectionRef = useRef<RecordSelection | null>(null);
  const navigationOwner = JSON.stringify([user?.uid, business.id, authEpoch]);
  const [recordNavigation, setRecordNavigation] = useState<{ owner: string; appointmentId: string; dateKey: string } | null>(null);
  const navigationGeneration = useRef({ target: recordNavigation, scope: actionScope });
  if (navigationGeneration.current.target !== recordNavigation) navigationGeneration.current = { target: recordNavigation, scope: actionScope };
  const actionRequest = useRef<AbortController | null>(null);
  const [actionError, setActionError] = useState<{ scope: typeof actionScope; message: string } | null>(null);
  const setError = (message: string | null) => setActionError(message === null ? null : { scope: actionScope, message });
  const [saving, setSaving] = useState(false);
  const attendanceRegistry = useRef({ owner: navigationOwner, ids: new Set<string>() });
  if (attendanceRegistry.current.owner !== navigationOwner) attendanceRegistry.current = { owner: navigationOwner, ids: new Set<string>() };
  const registry = attendanceRegistry.current;
  const [attendancePending, setAttendancePending] = useState<{ registry: typeof registry; count: number } | null>(null);
  const combinedBusy = saving || (attendancePending?.registry === registry && attendancePending.count > 0);
  const actionsBusy = combinedBusy || rescheduleEntry !== null;
  const pendingAttendance = () => requestScope.isCurrent() && attendanceRegistry.current === registry && registry.ids.size > 0;
  const onAttendanceBusyChange = (appointmentId: string, busy: boolean) => {
    if (!requestScope.isCurrent() || attendanceRegistry.current !== registry) return;
    if (busy) registry.ids.add(appointmentId); else registry.ids.delete(appointmentId);
    setAttendancePending(previous => previous?.registry === registry && previous.count === registry.ids.size ? previous : { registry, count: registry.ids.size });
  };
  const [blockStart, setBlockStart] = useState('');
  const [blockEnd, setBlockEnd] = useState('');
  const [resource, setResource] = useState('');
  const agenda = useOwnerAgenda({ businessId: business.id, ownerUid: user?.uid ?? null, range, enabled, requestScope });
  // Keep writer cards mounted through provisional protection and its fresh read.
  const heldAgenda = useRef<{ snapshot: OwnerAgendaSnapshot | null; holding: boolean }>({ snapshot: null, holding: false });
  if (authority.protected) heldAgenda.current.holding = true;
  if (!authority.protected && !enabled) heldAgenda.current.holding = false;
  if (!authority.protected && agenda.snapshot && !agenda.loading && agenda.snapshot.days.every(item => item.state !== 'error')) heldAgenda.current.holding = false;
  if (!heldAgenda.current.holding && agenda.snapshot) heldAgenda.current.snapshot = agenda.snapshot;
  const snapshot = heldAgenda.current.holding ? heldAgenda.current.snapshot : agenda.snapshot;
  const day = snapshot?.days.find(item => item.dateKey === date) ?? null;
  const appointments = day?.state === 'ready' ? day.appointments : [];
  const appointmentSnapshots = useRef({ scope: actionScope, source: appointments, rows: new Map(appointments.map(item => [item.id, item])) });
  if (appointmentSnapshots.current.scope !== actionScope || appointmentSnapshots.current.source !== appointments) {
    appointmentSnapshots.current = { scope: actionScope, source: appointments, rows: new Map(appointments.map(item => [item.id, item])) };
  }
  const recordSource = recordSelection?.authority === actionScope && enabled ? appointments.find(item => item.id === recordSelection.scope.sourceAppointmentId && item.tenantId === recordSelection.scope.businessId && item.dateKey === recordSelection.scope.dateKey && item.type === 'appointment' && item.client?.uid === recordSelection.scope.clientUid) : undefined;
  const selectedRecord = recordSource ? recordSelection : null;
  // Mask a departed scope/source during render; an earlier private page cannot return on a later visit.
  recordSelectionRef.current = selectedRecord;
  useEffect(() => { if (recordSelection && !selectedRecord) setRecordSelection(null); }, [recordSelection, selectedRecord]);
  const invalidateRecord = (known: Appointment) => {
    const selected = recordSelectionRef.current;
    if (!selected || selected.authority !== actionScope || known.client?.uid !== selected.scope.clientUid) return;
    const next = { ...selected, invalidation: selected.invalidation + 1 };
    recordSelectionRef.current = next;
    setRecordSelection(next);
  };
  const activeNavigation = recordNavigation?.owner === navigationOwner && recordNavigation.dateKey === date && mode === 'day' ? recordNavigation : null;
  useEffect(() => {
    if (!recordNavigation) return;
    if (!activeNavigation || navigationGeneration.current.scope !== actionScope) { setRecordNavigation(null); return; }
    if (agenda.loading || day?.state !== 'ready') return;
    const canonical = appointments.find(item => item.id === activeNavigation.appointmentId && item.tenantId === business?.id && item.dateKey === date);
    if (canonical) {
      const card = Array.from(document.querySelectorAll<HTMLDetailsElement>('[data-owner-appointment-id]')).find(node => node.dataset.ownerAppointmentId === canonical.id && node.dataset.ownerAppointmentBusiness === canonical.tenantId && node.dataset.ownerAppointmentDate === canonical.dateKey);
      if (card) { card.open = true; card.querySelector<HTMLElement>('summary')?.focus(); }
    } else setError('La cita ya no está en este día. Puede haber cambiado; actualiza la agenda.');
    setRecordNavigation(null);
  }, [recordNavigation, activeNavigation, actionScope, agenda.loading, day, appointments, business?.id, date]);
  const resources = getOwnerAgendaResources(business.resources, snapshot?.days ?? []);
  const rangeResolved = snapshot?.days.every(item => item.state !== 'error') ?? false;
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
  const currentAction = (controller: AbortController) => requestScope.isCurrent() && scopeRef.current === actionScope && !controller.signal.aborted;
  async function block(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const resourceId = resource || business?.resources.find(item => item.active)?.id;
    if (scopeRef.current !== actionScope || !requestScope.canStartAction() || rescheduleRef.current || !enabled || !user || !range || !accountConsent.active || !resourceId || !business.resources.some(item => item.id === resourceId && item.active) || actionRequest.current || pendingAttendance()) return;
    const controller = actionRequest.current = new AbortController();
    setSaving(true); setError(null);
    try {
      const response = await ownerApiFetch<{ appointment: Appointment }>(requestScope, 'write', `/api/businesses/${business.id}/appointments`, {
        method: 'POST', signal: controller.signal,
        body: JSON.stringify({ dateKey: date, startTimeStr: blockStart, endTimeStr: blockEnd, resourceId, requestId: crypto.randomUUID() }),
      }, () => currentAction(controller));
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
    if (scopeRef.current !== actionScope || !requestScope.canStartAction() || rescheduleRef.current || !enabled || !user || !range || !appointments.some(item => item.id === appointmentId && item.status === 'confirmed') || actionRequest.current || pendingAttendance()) return;
    const controller = actionRequest.current = new AbortController();
    setSaving(true); setError(null);
    try {
      const response = await ownerApiFetch<{ appointment: Appointment }>(requestScope, 'write', `/api/businesses/${business.id}/appointments`, {
        method: 'PATCH', signal: controller.signal, body: JSON.stringify({ appointmentId }),
      }, () => currentAction(controller));
      if (!currentAction(controller)) return;
      const saved = response?.appointment;
      if (!saved || saved.id !== appointmentId || saved.tenantId !== business.id || saved.dateKey !== date || !['cancelled_by_owner', 'cancelled_by_client', 'completed', 'no_show'].includes(saved.status)) throw new Error('No se pudo comprobar el resultado. Actualiza la agenda.');
      const known = appointmentSnapshots.current.scope === actionScope ? appointmentSnapshots.current.rows.get(appointmentId) : undefined;
      if (known) invalidateRecord(known);
      agenda.refresh();
    } catch (cause) {
      if (currentAction(controller)) setError(errorMessage(cause));
    } finally {
      if (scopeRef.current === actionScope) setSaving(false);
      if (actionRequest.current === controller) actionRequest.current = null;
    }
  }
  const renderContent = () => {
    if (!business.sarinConfig.onboardingCompleted) return <OwnerSetup business={business} now={now} />;
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
        <OwnerAgendaCalendar business={business} scheduleContext={schedules.view ? { state: 'ready', view: schedules.view } : { state: schedules.phase === 'loading' ? 'loading' : 'error' }} mode={mode} selectedDate={date} resourceId={selectedResourceId} range={range} snapshot={agenda.snapshot} loading={agenda.loading} error={agenda.error} busy={combinedBusy}
          onModeChange={value => { if (requestScope.canRead() && scopeRef.current === actionScope && !actionRequest.current && !pendingAttendance()) setMode(value); }}
          onDateChange={value => { if (requestScope.canRead() && scopeRef.current === actionScope && !actionRequest.current && !pendingAttendance()) setDate(value); }}
          onResourceChange={value => { if (requestScope.canRead() && scopeRef.current === actionScope && !actionRequest.current && !pendingAttendance()) setSelectedResourceId(value); }}
          onRefresh={() => { if (requestScope.canRead() && scopeRef.current === actionScope && !actionRequest.current && !pendingAttendance()) agenda.refresh(); }} />
        <div className="flex flex-wrap justify-end gap-x-5">{[['/dashboard/reports', 'Resumen operativo'], ['/dashboard/waitlist', 'Solicitudes en espera']].map(([href, label]) => <Link key={href} href={href} aria-disabled={actionsBusy || !enabled} onClick={event => { if (!requestScope.canRead() || scopeRef.current !== actionScope || actionRequest.current || pendingAttendance() || rescheduleRef.current || combinedBusy) event.preventDefault(); }} className="inline-flex min-h-11 items-center text-xs font-semibold text-sarin-blue underline-offset-4 hover:underline aria-disabled:opacity-50">{label}</Link>)}<Link href="/dashboard/qr-kit" className="inline-flex min-h-11 items-center gap-2 text-xs font-semibold text-sarin-blue underline-offset-4 hover:underline"><QrCode className="h-4 w-4" />Compartir mi QR</Link></div>
        <OwnerAgendaAppointments key={`${user?.uid}:${business.id}:${date}`} business={business} dateKey={date} day={day} resourceId={selectedResourceId} saving={actionsBusy} requestScope={requestScope}
          canManageAttendance={id => requestScope.canStartAction() && scopeRef.current === actionScope && !rescheduleRef.current && !actionRequest.current && [...registry.ids].every(pending => pending === id)}
          onReschedule={appointmentId => {
            if (!requestScope.canStartAction() || scopeRef.current !== actionScope || actionRequest.current || pendingAttendance() || rescheduleRef.current) return;
            const known = appointmentSnapshots.current.rows.get(appointmentId);
            if (!known || known.type !== 'appointment' || known.status !== 'confirmed' || known.tenantId !== business.id || known.dateKey !== date) return;
            const entry = { appointmentId }; rescheduleRef.current = entry; setRescheduleEntry(entry);
          }} onAttendanceBusyChange={onAttendanceBusyChange} onCancel={id => void cancel(id)} onOpenClientRecord={appointment => {
          if (!requestScope.canRead() || rescheduleRef.current || scopeRef.current !== actionScope || !enabled || actionRequest.current || pendingAttendance() || !user) return;
          const known = appointmentSnapshots.current.scope === actionScope ? appointmentSnapshots.current.rows.get(appointment.id) : undefined;
          const uid = known?.client?.uid;
          if (known !== appointment || known.type !== 'appointment' || known.tenantId !== business.id || known.dateKey !== date || typeof uid !== 'string' || uid.length < 1 || uid.length > 128 || /[\x00-\x1f\x7f]/.test(uid)) return;
          const next = { authority: actionScope, scope: { businessId: business.id, ownerUid: user.uid, dateKey: date, sourceAppointmentId: known.id, clientUid: uid }, invalidation: 0 };
          recordSelectionRef.current = next;
          setRecordSelection(next);
        }} onSaved={saved => {
          if (scopeRef.current !== actionScope || saved.tenantId !== business.id || saved.dateKey !== date || !appointments.some(item => item.id === saved.id && item.tenantId === saved.tenantId && item.dateKey === saved.dateKey)) return;
          const latest = appointmentSnapshots.current;
          if (latest.scope !== actionScope) return;
          const known = latest.rows.get(saved.id);
          const replacement = known ? preserveNewerAppointmentResults(saved, known) : saved;
          // Update synchronously so two accepted responses in one render batch also compose.
          latest.rows.set(saved.id, replacement);
          if (known) invalidateRecord(known);
          agenda.replaceAppointment(replacement);
        }} />
        {selectedRecord && <OwnerClientRecordPanel scope={selectedRecord.scope} requestScope={requestScope} contextName={recordSource?.client?.name} disabled={actionsBusy} invalidation={selectedRecord.invalidation} onClose={() => {
          if (recordSelectionRef.current !== selectedRecord) return;
          recordSelectionRef.current = null;
          setRecordSelection(null);
        }} onOpenAppointment={target => {
          if (!requestScope.canRead() || rescheduleRef.current || scopeRef.current !== actionScope || recordSelectionRef.current !== selectedRecord || !enabled || actionRequest.current || pendingAttendance()) return;
          recordSelectionRef.current = null;
          setRecordSelection(null);
          setRecordNavigation({ owner: navigationOwner, appointmentId: target.appointmentId, dateKey: target.dateKey });
          setMode('day'); setDate(target.dateKey); setSelectedResourceId(null);
        }} />}

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
                !accountConsent.active || actionsBusy || !range || !business.resources.some((item) => item.active)
              }
              className={buttonClass + " self-end"}
            >
              {saving ? "Guardando…" : "Bloquear horario"}
            </button>
          </form>
        </details>
      </div>
    );
  };
  if (authority.revoked || !requestScope.isCurrent()) return <Notice error>No tienes acceso a la agenda de este negocio.</Notice>;
  const protectedView = authority.protected;
  return <div className="space-y-6">
    {businessError && <Notice error>{businessError}</Notice>}
    {authority.protected && <section role="status" className="space-y-3 rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900"><p>Necesitamos comprobar el acceso a este negocio. Los cambios pendientes se conservan.</p>{authority.error && <p>{authority.error}</p>}<button type="button" className={buttonClass} disabled={authority.checking} onClick={() => void authority.checkAccess()}>{authority.checking ? 'Comprobando acceso…' : 'Comprobar acceso'}</button></section>}
    {!authority.protected && heldAgenda.current.holding && <p role="status" className="text-sm text-sarin-muted">Conservamos las citas anteriores mientras se actualiza la agenda. Puedes comprobar el resultado de tu cambio; consulta los errores del calendario y actualiza para revisar la ocupación vigente.</p>}
    {!authority.protected && authority.featureCode && <p role="status" className="text-sm text-sarin-muted">El acceso al negocio está comprobado. La función anterior puede seguir restringida; su petición no se reenvió.</p>}
    <div hidden={protectedView} inert={protectedView || undefined}>
      <OwnerRescheduleBoundary businessId={business.id} ownerUid={business.ownerUid} authEpoch={authEpoch} business={business} requestScope={requestScope} entry={rescheduleEntry}
        onEntryChange={entry => {
          if (!requestScope.isCurrent()) return;
          if (entry === null) { if (rescheduleLocked.current) return; rescheduleRef.current = null; setRescheduleEntry(null); return; }
          if (!requestScope.canStartAction() || actionRequest.current || pendingAttendance() || rescheduleRef.current) return;
          rescheduleRef.current = entry; setRescheduleEntry(entry);
        }} onLockedChange={locked => { if (requestScope.isCurrent()) rescheduleLocked.current = locked; }}
        onApplied={() => {
          if (!requestScope.isCurrent()) return;
          recordSelectionRef.current = null; setRecordSelection(null);
          heldAgenda.current = { snapshot: null, holding: false }; agenda.invalidateAndRefresh();
        }} onViewCurrentDay={dateKey => { if (!requestScope.canRead() || actionRequest.current || pendingAttendance()) return; setMode('day'); setDate(dateKey); setSelectedResourceId(null); }} />
    </div>
    <div hidden={protectedView} inert={protectedView || undefined}>{renderContent()}</div>
  </div>;
}
function OwnerDashboardSession() {
  const { user, authEpoch } = useAuth();
  const [revoked, setRevoked] = useState(false);
  const owned = useBusiness({ onAccessDenied: failure => { if (failure.status === 401 || failure.source === 'owner_authority') setRevoked(true); } });
  const verified = useRef<Business | null>(null);
  if (!owned.loading && !owned.error) verified.current = owned.business;
  if (revoked) verified.current = null;
  const business = !owned.loading && !owned.error ? owned.business : verified.current;
  const candidateKey = JSON.stringify([user?.uid, authEpoch, business?.id, business?.ownerUid, revoked]);
  const candidate = useRef({ key: candidateKey });
  if (candidate.current.key !== candidateKey) candidate.current = { key: candidateKey };
  const generation = candidate.current;
  if (revoked || (business && business.ownerUid !== user?.uid)) return <Notice error>No tienes acceso a la agenda de este negocio.</Notice>;
  if (owned.loading && !business) return <Notice>Cargando tu negocio…</Notice>;
  if (owned.error && !business) return <Notice error>{owned.error}</Notice>;
  if (!business) return <OwnerSetup business={null} now={Date.now()} />;
  return <OwnerDashboardWorkspace key={JSON.stringify([user?.uid, authEpoch, business.id])} business={business} businessError={owned.error} isCurrentWorkspace={() => candidate.current === generation} />;
}
function Agenda() {
  const { user, authEpoch } = useAuth();
  return <OwnerDashboardSession key={JSON.stringify([user?.uid, authEpoch])} />;
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
