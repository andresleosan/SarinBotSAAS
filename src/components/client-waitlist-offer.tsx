"use client";
import type { ClientWaitlistOfferController } from '@/hooks/use-client-waitlist-offer';
import { BookingProposal } from '@/components/booking-proposal';
import { Notice } from '@/components/app-shell';
const dateTime = new Intl.DateTimeFormat('es-CO', { timeZone: 'America/Bogota', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const action = 'min-h-11 max-w-full rounded text-left text-sm font-semibold text-sarin-blue underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-sarin-blue disabled:opacity-50';
export function ClientWaitlistOffer({ controller: c, actionsLocked = false, now }: { controller: ClientWaitlistOfferController; actionsLocked?: boolean; now: number }) {
  const value = c.recovery, offer = value?.offer, offered = offer?.persistedState === 'offered';
  const expired = Boolean(offer && (now >= offer.expiresAt || value!.usability === 'expired_pending_close'));
  const appointment = value?.appointment;
  const appointmentStatus = appointment?.status === 'cancelled_by_client' ? 'Cancelada por ti' : appointment?.status === 'cancelled_by_owner' ? 'Cancelada por el negocio' : appointment?.status === 'completed' ? 'Completada por el negocio' : appointment?.status === 'no_show' ? 'Inasistencia registrada' : 'Confirmada';
  return <section aria-label="Ofertas de tu lista de espera" className="min-w-0 space-y-3 rounded-xl border border-sarin-line bg-sarin-paper p-3 [overflow-wrap:anywhere]">
    <h4 className="text-sm font-semibold">Ofertas en Sarin</h4>
    {!value && <><button type="button" className={action} disabled={actionsLocked || c.loading} onClick={() => c.check()}>Comprobar ofertas</button>{c.checked && !c.loading && !c.error && <p className="text-sm text-sarin-muted">No hay una oferta actual para tu solicitud.</p>}</>}
    {c.loading && <p role="status" className="text-sm text-sarin-muted">Comprobando ofertas…</p>}
    {c.error && <Notice error>{c.error}</Notice>}
    {c.notice && <p role="status" className="text-sm text-sarin-muted">{c.notice}</p>}
    {offer && <>
      <p className="text-sm font-medium">{offer.target.serviceName} · {offer.target.resourceName}</p>
      <p className="text-sm">{offer.target.dateKey} · {offer.target.startTimeStr}–{offer.target.endTimeStr} (Colombia)</p>
      {offered && <>
        <p className="text-xs text-sarin-muted">Esta oferta no es exclusiva y no aparta el horario. Rechazarla conserva tu solicitud en la lista de espera.</p>
        <p className="text-xs text-sarin-muted">Vigente hasta {dateTime.format(offer.expiresAt)} (Colombia).</p>
        {expired && <p role="status" className="text-sm">La oferta venció; falta comprobar el resultado. El servidor verifica su vigencia al confirmar.</p>}
        {c.uncertain && <p role="status" className="text-sm">Falta comprobar el resultado. Conservamos la misma confirmación; no inicies otra reserva.</p>}
        {!value!.proposal && <button type="button" className={action} disabled={c.busy || actionsLocked || !value!.writesEnabled || value!.usability !== 'ready' || expired} onClick={() => c.review()}>Revisar esta oferta</button>}
        {value!.proposal && <BookingProposal proposal={value!.proposal.proposal} beneficiary={{ kind: 'self' }} confirming={c.busy} recovering={c.uncertain}
          disabled={actionsLocked || (!c.uncertain && (!value!.writesEnabled || value!.usability !== 'ready' || expired))}
          validityText={`Vigente hasta ${dateTime.format(offer.expiresAt)} (Colombia). El horario y la vigencia se comprueban nuevamente al confirmar. Tus datos se guardan con la cita.`} onConfirm={c.confirm} />}
        <div className="flex flex-wrap gap-x-5 gap-y-1">
          <button type="button" className={action} disabled={c.loading} onClick={() => c.recover()}>Comprobar resultado</button>
          <button type="button" className={action} disabled={actionsLocked} onClick={() => c.decline()}>Rechazar oferta</button>
          {expired && <button type="button" className={action} disabled={actionsLocked} onClick={() => c.closeExpired()}>Cerrar oferta vencida</button>}
          {!c.busy && !c.uncertain && <button type="button" className={action} onClick={c.dismiss}>Volver sin aceptar</button>}
        </div>
        {!value!.writesEnabled && <p className="text-xs text-sarin-muted">Las nuevas aceptaciones están en pausa. Puedes comprobar o cerrar esta oferta.</p>}
      </>}
      {offer.persistedState === 'booked' && value!.proof && appointment && <div className="space-y-2" role="status">
        <p className="text-sm font-semibold">Esta solicitud se resolvió con esta confirmación.</p>
        <p className="text-xs text-sarin-muted">Confirmación original: {dateTime.format(value!.proof.source.startAt)} (Colombia). Comprobante: {value!.proof.appointmentId}.</p>
        <p className="text-sm">Cita actual: {dateTime.format(appointment.startAt)} (Colombia) · {appointmentStatus}.</p>
        <p className="text-xs text-sarin-muted">Consulta Mis citas para ver los cambios y el estado actual. Cambiar o cancelar esta cita no reabre la solicitud.</p>
      </div>}
      {offer.persistedState !== 'offered' && offer.persistedState !== 'booked' && <p role="status" className="text-sm">{offer.persistedState === 'declined' ? 'Oferta rechazada.' : offer.persistedState === 'withdrawn' ? 'El negocio retiró esta oferta.' : 'Se comprobó el cierre de la oferta vencida.'} Tu solicitud de espera se conserva según su estado y fecha.</p>}
      {!offered && <button type="button" className={action} disabled={c.loading || actionsLocked} onClick={() => c.check()}>Comprobar ofertas</button>}
    </>}
  </section>;
}
