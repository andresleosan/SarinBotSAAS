"use client";
import { useEffect, useState } from 'react';
import { buttonClass, fieldClass } from '@/components/app-shell';
import type { OwnerWaitlistOfferController } from '@/hooks/use-owner-waitlist-offer';
import { toColombiaTimestamp } from '@/lib/sarin/calendar-time';
const stamp = (value: number) => new Intl.DateTimeFormat('es-CO', {timeZone:'America/Bogota', dateStyle:'medium', timeStyle:'short'}).format(value);
const money = (value: number) => new Intl.NumberFormat('es-CO', {style:'currency',currency:'COP',maximumFractionDigits:0}).format(value);
const time = (value: number) => new Intl.DateTimeFormat('es-CO', {timeZone:'America/Bogota',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(value);
const states = {offered:'Ofrecida (estado guardado)',withdrawn:'Retirada',declined:'Rechazada',expired:'Vencida (cierre guardado)',booked:'Reserva vinculada'};
export function OwnerWaitlistOfferWorkspace({controller:c,mode,disabled=false}: {controller:OwnerWaitlistOfferController;mode:'create'|'list';disabled?:boolean}) {
  const [date,setDate]=useState(c.dateKey),[filter,setFilter]=useState(c.filter);
  useEffect(()=>{setDate(c.dateKey);setFilter(c.filter);},[c.dateKey,c.filter]);
  const context=c.context, command=c.command, service=context?.service, selection=command?.selection;
  const resource=context?.detail.availability.find(item=>item.resourceId===selection?.resourceId);
  const startAt=selection&&context?toColombiaTimestamp(context.detail.row.dateKey,selection.startTimeStr):null;
  const endAt=startAt!==null&&service?startAt+service.durationMinutes*60000:null;
  const advisoryExpiry=startAt!==null&&context?Math.min(context.detail.serverNow+600000,context.detail.row.expiresAt,startAt):null;
  const recovery=c.recovery, offer=recovery?.offer;
  const lock=disabled||c.busy||c.uncertain;
  return <section aria-label={mode==='create'?'Publicar oferta para esta solicitud':'Ofertas en Sarin'} className="min-w-0 space-y-4 break-words rounded-xl border border-sarin-line p-4">
    <h2 className="text-xl font-semibold">{mode==='create'?'Oferta para esta solicitud':'Ofertas en Sarin'}</h2>
    {mode==='list'&&<>
      <fieldset disabled={disabled||c.loading} className="grid min-w-0 grid-cols-1 items-end gap-3 sm:grid-cols-[1fr_1fr_auto]">
        <legend className="mb-2 text-sm">20 ofertas por página, por fecha y estado guardado.</legend>
        <label className="min-w-0 space-y-1"><span className="block text-sm">Fecha en Colombia</span><input aria-label="Fecha de ofertas" type="date" className={`${fieldClass} min-h-11 w-full min-w-0`} value={date} onChange={event=>setDate(event.target.value)}/></label>
        <label className="min-w-0 space-y-1"><span className="block text-sm">Estado guardado</span><select aria-label="Estado guardado de ofertas" className={`${fieldClass} min-h-11 w-full`} value={filter} onChange={event=>setFilter(event.target.value as typeof filter)}><option value="all">Todos</option><option value="offered">Ofrecidas</option><option value="booked">Reservas vinculadas</option></select></label>
        <button type="button" className={buttonClass} onClick={()=>void c.query(date,filter)}>Consultar ofertas</button>
      </fieldset>
      <p className="text-sm text-sarin-muted">El filtro usa el estado guardado. Una ofrecida puede haber vencido y seguir pendiente de cierre. La página no indica un total.</p>
      {c.page&&<div className="space-y-3"><p className="text-sm">Consultado: {stamp(c.page.serverNow)}, Colombia.</p>{c.page.rows.length===0?<p>No hay ofertas en esta consulta.</p>:<ul className="space-y-3">{c.page.rows.map(item=><li key={item.id} className="space-y-2 rounded-xl border border-sarin-line p-3"><p className="font-semibold">{item.target.serviceName} · {item.target.resourceName}</p><p>{item.target.dateKey} · {item.target.startTimeStr}–{item.target.endTimeStr}</p><p>{states[item.persistedState]}</p><button type="button" className={buttonClass} disabled={disabled||c.loading} onClick={()=>void c.openOffer(item.id)}>Ver oferta</button></li>)}</ul>}{c.page.nextCursor&&<button type="button" className={buttonClass} disabled={disabled||c.loading} onClick={()=>void c.loadOlder()}>Ver siguientes ofertas</button>}</div>}
    </>}
    {c.loading&&<p role="status">Comprobando ofertas…</p>}
    {c.error&&<p role="alert" className="break-words">{c.error}</p>}
    {c.notice&&<p role="status">{c.notice}</p>}
    {(c.busy||c.uncertain)&&<div className="space-y-3 rounded-xl border border-sarin-line p-3"><p>Operación por comprobar. Cambiar de pestaña o cerrar esta vista no deshace lo enviado.</p><div className="flex flex-wrap gap-3"><button type="button" className={buttonClass} disabled={disabled||c.loading} onClick={()=>void c.recover()}>Comprobar resultado de oferta</button><button type="button" className={buttonClass} disabled={disabled||c.busy} onClick={()=>void c.retryPending()}>{command?'Reintentar misma publicación':'Reintentar mismo cierre'}</button></div></div>}
    {mode==='create'&&context&&<>
      {!context.eligible||!service?<p>{context.reason==='restricted_policy'?'Las ofertas solo están disponibles para solicitudes propias bajo la política general.':context.reason==='disabled'?'Las nuevas ofertas no están habilitadas. Puedes comprobar y cerrar las existentes.':'Esta solicitud no permite publicar una oferta en la consulta actual.'}</p>:<>
        {!command&&<div className="space-y-3"><p>Elige un horario consultado para revisar la oferta.</p>{context.detail.availability.map(item=><div key={item.resourceId} className="flex flex-wrap gap-2">{item.slots.map(slot=><button type="button" key={slot} className={buttonClass} disabled={lock} onClick={()=>c.select(item.resourceId,slot)}>{item.resourceName} · {slot}</button>)}</div>)}</div>}
        {command&&service&&resource&&startAt!==null&&endAt!==null&&<div className="space-y-3 rounded-xl border border-sarin-line bg-sarin-paper p-4"><h3 className="font-semibold">Revisar antes de publicar</h3><p>{service.serviceName} · {money(service.priceCOP)}</p><p>{resource.resourceName} · {context.detail.row.dateKey} · {selection!.startTimeStr}–{time(endAt)}, Colombia</p><p>Duración: {service.durationMinutes} minutos. Margen: {service.bufferMinutes} minutos, hasta {time(endAt+service.bufferMinutes*60000)}.</p><p>Oferta privada y no exclusiva. No retiene el horario; el cliente debe revisar y confirmar en Sarin.</p><p>No se envía un aviso externo. Publicar no confirma una cita.</p><p className="text-sm">Plazo máximo: diez minutos desde la publicación, sin superar el inicio ni la caducidad de la solicitud. Con la consulta actual sería hasta {stamp(advisoryExpiry!)}, Colombia. El vencimiento exacto se comprueba al publicar.</p>{context.currentOffer?.usability==='expired_pending_close'&&<p>Al publicar se cerrará la oferta anterior vencida si continúa así; el servidor vuelve a comprobarlo.</p>}<button type="button" className={buttonClass} disabled={lock} onClick={()=>void c.publish()}>Publicar oferta en Sarin</button></div>}
      </>}
    </>}
    {offer&&recovery&&<div aria-label="Resultado de oferta" className="space-y-3 rounded-xl border border-sarin-line p-4"><h3 className="font-semibold">{states[offer.persistedState]}</h3><p>{offer.target.serviceName} · {offer.target.resourceName} · {money(offer.target.priceCOP)}</p><p>{offer.target.dateKey} · {offer.target.startTimeStr}–{offer.target.endTimeStr}, Colombia</p><p>Vencimiento de esta oferta: {stamp(offer.expiresAt)}, Colombia.</p>{offer.persistedState==='offered'&&<><p>{recovery.usability==='expired_pending_close'?'La oferta venció; falta comprobar el resultado':'El estado consultado no retiene el horario ni prueba que el cliente haya recibido un aviso.'}</p><div className="flex flex-wrap gap-3"><button type="button" className={buttonClass} disabled={disabled||c.loading} onClick={()=>void c.openOffer(offer.id)}>Actualizar oferta</button><button type="button" className={buttonClass} disabled={lock} onClick={()=>void c.closeOffer('withdraw')}>Retirar oferta</button>{recovery.usability==='expired_pending_close'&&<button type="button" className={buttonClass} disabled={lock} onClick={()=>void c.closeOffer('close-expired')}>Cerrar oferta vencida</button>}</div></>}{recovery.proof&&<div className="space-y-2 text-sm"><p>Constancia administrativa de reserva vinculada: {recovery.proof.appointmentId}</p><p>Confirmada: {stamp(recovery.proof.confirmedAt)}, Colombia. Esta solicitud se resolvió con esa confirmación. Esta constancia no indica el estado actual de la cita.</p></div>}</div>}
    <details className="rounded-xl border border-sarin-line p-3"><summary className="min-h-11 cursor-pointer py-2 font-semibold">Cómo funciona la oferta</summary><p>La oferta no es exclusiva ni reserva capacidad. Solo la confirmación del cliente de una oferta vinculada resuelve esa solicitud. Retirar o cerrar una oferta no cancela una cita. El reloj o un error de red no comprueban el resultado de una operación enviada.</p></details>
  </section>;
}
