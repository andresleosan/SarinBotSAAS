"use client";
import { useEffect, useRef, useState } from 'react';
import { buttonClass, fieldClass } from '@/components/app-shell';
import type { OwnerWaitlistController } from '@/hooks/use-owner-waitlist';

type Props = { controller: OwnerWaitlistController; onViewAgenda: () => void; disabled?: boolean };
const stamp = (value: number) => new Intl.DateTimeFormat('es-CO', { timeZone: 'America/Bogota', dateStyle: 'medium', timeStyle: 'short' }).format(value);
const day = (value: string) => new Intl.DateTimeFormat('es-CO', { timeZone: 'America/Bogota', dateStyle: 'long' }).format(Date.parse(value + 'T12:00:00-05:00'));
const reasons = { consent_changed: 'Los permisos actuales del cliente requieren revisión.', booking_policy_changed: 'Cambió la política de reservas.', business_unavailable: 'Las nuevas reservas no están disponibles.', client_blocked: 'La solicitud no tiene acceso vigente a nuevas reservas.', client_limit: 'La solicitud alcanzó su límite de reservas.', service_unavailable: 'El servicio o profesional anterior ya no está disponible.' };
export function OwnerWaitlistWorkspace({ controller: c, onViewAgenda, disabled = false }: Props) {
  const [draft, setDraft] = useState(c.dateKey), [activeId, setActiveId] = useState<string | null>(null), [confirming, setConfirming] = useState(false);
  const focusPending = useRef(false), resultRef = useRef<HTMLElement>(null), errorRef = useRef<HTMLDivElement>(null);
  useEffect(() => { setDraft(c.dateKey); setActiveId(null); setConfirming(false); }, [c.dateKey]);
  const detail = c.detail?.row.recordId === activeId ? c.detail : null;
  const row = detail?.row ?? c.page?.rows.find(item => item.recordId === activeId);
  useEffect(() => {
    if (!focusPending.current || c.loading || c.busy) return;
    focusPending.current = false;
    if (c.error) errorRef.current?.focus(); else resultRef.current?.focus();
  }, [activeId, c.page, c.detail, c.error, c.loading, c.busy]);
  function run(action: () => void) { focusPending.current = true; action(); }
  const locked = disabled || c.busy;
  return <div className="max-w-4xl min-w-0 space-y-5">
    <div><h1 className="text-3xl font-bold">Solicitudes en espera</h1><p className="mt-2 text-sm text-sarin-muted">Consulta las solicitudes actuales y registra su revisión manual.</p></div>
    <fieldset disabled={locked} className="min-w-0 space-y-3 rounded-xl border border-sarin-line p-4">
      <legend className="px-1 font-semibold">Fecha de solicitudes</legend>
      <div className="grid grid-cols-1 items-end gap-3 sm:grid-cols-[1fr_auto_auto]">
        <label className="min-w-0 space-y-1"><span className="block text-sm font-medium">Fecha en Colombia</span><input type="date" aria-label="Fecha de solicitudes" aria-describedby="waitlist-date-help" className={`${fieldClass} min-h-11 w-full min-w-0`} value={draft} onChange={event => setDraft(event.target.value)} /></label>
        <button type="button" className={buttonClass} onClick={() => run(() => { setConfirming(false); if (draft === c.dateKey) void c.refresh(); else c.setDate(draft); })}>Consultar fecha</button>
        <button type="button" className={buttonClass} onClick={() => run(() => { void c.refresh(); })}>Actualizar</button>
      </div>
      <p id="waitlist-date-help" className="text-sm text-sarin-muted">Puedes consultar una fecha pasada o hasta los próximos 366 días. Editar la fecha no cambia la consulta hasta confirmarla.</p>
    </fieldset>
    <div className="space-y-2 rounded-xl border border-sarin-line p-4 text-sm leading-6">
      <p><strong>Orden de llegada (FIFO).</strong> Es el orden visual de cada solicitud; no asigna horarios ni garantiza un turno.</p>
      <p>No incluye solicitudes retiradas, reemplazadas o antiguas incompletas. La lista no es un archivo histórico ni un total de personas.</p>
    </div>
    {c.error && <div ref={errorRef} role="alert" tabIndex={-1} className="rounded-xl border border-sarin-line p-4 focus-visible:outline-2 focus-visible:outline-sarin-blue">{c.error}</div>}
    {c.notice && <p role="status" className="rounded-xl border border-sarin-line p-4 text-sm">{c.notice}</p>}
    {c.uncertain && <div className="space-y-3 rounded-xl border border-sarin-line p-4"><p>Revisión por comprobar. No envíes otra modificación mientras la anterior pueda seguir en curso. Salir no deshace una operación enviada.</p><div className="flex flex-wrap gap-3"><button type="button" className={buttonClass} disabled={locked} onClick={() => run(() => { void c.refresh(); })}>Comprobar estado actual</button><button type="button" className={buttonClass} disabled={locked} onClick={() => run(() => { void c.retryPending(); })}>Reintentar misma revisión</button></div></div>}
    {c.loading && <p role="status">Consultando la espera…</p>}
    <section ref={resultRef} tabIndex={-1} aria-label={row ? 'Solicitud seleccionada' : 'Bandeja de espera'} className="min-w-0 space-y-4 rounded-xl focus-visible:outline-2 focus-visible:outline-sarin-blue">
      {row ? <>
        <button type="button" className="inline-flex min-h-11 items-center text-sm font-semibold text-sarin-blue underline" disabled={locked} onClick={() => run(() => { setActiveId(null); setConfirming(false); c.close(); })}>Volver a solicitudes</button>
        <div className="space-y-2 rounded-xl border border-sarin-line bg-sarin-paper p-4">
          <h2 className="text-xl font-semibold">{row.serviceLabel}</h2><p>{day(row.dateKey)} · {row.resourceLabel}</p><p className="text-sm">Recibida: {stamp(row.createdAt)}, Colombia.</p>
          {row.subjectKind === 'represented_minor' && <p>Reserva gestionada por representante</p>}
          <p>{row.lifecycle === 'expired' ? 'Solicitud caducada' : 'Solicitud actual; disponibilidad pendiente de comprobar'}</p>
          <p>{row.review.reviewed ? 'Revisada' : 'Pendiente de revisión'}{row.review.updatedAt !== null ? ` · ${stamp(row.review.updatedAt)}, Colombia` : ''}</p>
          <p className="text-sm text-sarin-muted">Caduca al terminar su fecha en Colombia. Actualiza para comprobar su estado.</p>
          <button type="button" className={buttonClass} disabled={locked || c.loading} onClick={() => run(() => { void c.open(row.recordId); })}>Ver disponibilidad</button>
        </div>
        {detail && <div className="space-y-3 rounded-xl border border-sarin-line p-4">
          <h3 className="font-semibold">Estado consultado</h3><p className="text-sm text-sarin-muted">{stamp(detail.serverNow)}, Colombia. Esta consulta no es tiempo real.</p>
          <p>{detail.state === 'expired' ? 'La solicitud está caducada.' : detail.state === 'suspended' ? reasons[detail.reason!] : detail.state === 'available' ? 'Hay horarios consultables para esta solicitud.' : 'No encontramos horarios disponibles en esta consulta.'}</p>
          {detail.availability.map(resource => <div key={resource.resourceId}><p className="font-semibold">{resource.resourceName}</p><p className="break-words text-sm">{resource.slots.length ? resource.slots.join(' · ') : 'Sin horarios en esta consulta'}</p></div>)}
          <p>Esta consulta no retiene el horario. El cliente debe elegir y confirmar su reserva.</p>
          <p>El cliente debe entrar en su solicitud: Comprobar horarios → Elegir horario → revisar y confirmar. Consultar o marcar la revisión no le envía un aviso.</p>
          {confirming ? <div className="space-y-3 border-t border-sarin-line pt-3"><p>No avisa al cliente ni retira su solicitud. Solo cambia la marca privada de revisión.</p><div className="flex flex-wrap gap-3"><button type="button" className={buttonClass} disabled={locked || c.uncertain} onClick={() => run(() => { setConfirming(false); void c.setReviewed(!row.review.reviewed); })}>Confirmar revisión</button><button type="button" className={buttonClass} disabled={locked} onClick={() => setConfirming(false)}>Cancelar</button></div></div>
            : <button type="button" className={buttonClass} disabled={locked || c.loading || c.uncertain} onClick={() => setConfirming(true)}>{row.review.reviewed ? 'Volver a pendiente de revisión' : 'Marcar como revisada'}</button>}
        </div>}
        <div className="space-y-2"><p className="text-sm">En la agenda, selecciona {day(row.dateKey)}. La fecha no queda preseleccionada al abrir.</p><button type="button" className={buttonClass} disabled={locked || c.uncertain} onClick={onViewAgenda}>Abrir Mi agenda</button></div>
      </> : c.page && <>
        <div><h2 className="text-xl font-semibold">Solicitudes consultadas: {day(c.page.dateKey)}</h2><p className="mt-1 text-sm text-sarin-muted">Consultado: {stamp(c.page.serverNow)}, Colombia. Usa Actualizar para volver a comprobar.</p></div>
        {c.page.rows.length === 0 ? <p>No hay solicitudes consultables para esta fecha</p> : <ul className="space-y-3">{c.page.rows.map((item, index) => <li key={item.entryId} className="space-y-2 rounded-xl border border-sarin-line bg-sarin-paper p-4"><p className="font-semibold">{index + 1}. {item.serviceLabel}</p><p className="text-sm">{item.resourceLabel} · recibida {stamp(item.createdAt)}, Colombia</p>{item.subjectKind === 'represented_minor' && <p className="text-sm">Reserva gestionada por representante</p>}<p className="text-sm">{item.lifecycle === 'expired' ? 'Caducada' : 'Sin comprobar disponibilidad'} · {item.review.reviewed ? 'Revisada' : 'Pendiente de revisión'}</p><button type="button" className={buttonClass} disabled={locked || c.loading} onClick={() => run(() => { c.close(); setActiveId(item.recordId); setConfirming(false); })}>Revisar solicitud</button></li>)}</ul>}
        {c.page.nextCursor && <div className="space-y-2"><p className="text-sm">Hay más solicitudes. Esta página no indica un total.</p><button type="button" className={buttonClass} disabled={locked || c.loading} onClick={() => run(() => { void c.loadOlder(); })}>Ver siguientes solicitudes</button></div>}
      </>}
    </section>
    <details className="rounded-xl border border-sarin-line p-3"><summary className="min-h-11 cursor-pointer py-3 font-semibold">Cómo funciona la revisión</summary><p>La marca es reversible y privada del negocio. No reserva, no resuelve la espera y no confirma que el cliente haya recibido información. La prioridad visual no sustituye la elección y confirmación del cliente.</p></details>
  </div>;
}
