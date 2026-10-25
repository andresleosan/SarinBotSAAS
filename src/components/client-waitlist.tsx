"use client";
import { useEffect, useRef, type ReactNode } from 'react';
import { ListChecks } from 'lucide-react';
import { Notice } from '@/components/app-shell';
import type { WaitlistController } from '@/hooks/use-waitlist';
import type { TenantService, TenantResource } from '@/types/firestore';
import type { WaitlistRequestView } from '@/types/waitlist';
const dateFormat = new Intl.DateTimeFormat('es-CO', { timeZone: 'America/Bogota', day: 'numeric', month: 'long', year: 'numeric' });
const actionClass = 'min-h-11 max-w-full rounded text-left text-sm font-semibold text-sarin-blue underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-sarin-blue disabled:cursor-not-allowed disabled:opacity-50';
export function ClientWaitlist(props: { controller: WaitlistController; services: TenantService[]; resources: TenantResource[]; actionsLocked: boolean; canResume: boolean; onChoose: (request: WaitlistRequestView, revision: number) => void; offerContent?: ReactNode }) {
  const { controller, services, resources, actionsLocked, canResume } = props, current = useRef(props); current.current = props;
  const mounted = useRef(true); useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const section = useRef<HTMLElement>(null), settledRevision = useRef<number | null>(null);
  useEffect(() => {
    const revision = controller.data?.revision;
    if (revision === undefined || controller.busy || controller.loading || controller.readError) return;
    if (settledRevision.current !== null && settledRevision.current !== revision) { section.current?.focus({ preventScroll: true }); section.current?.scrollIntoView({ behavior: 'auto', block: 'center' }); }
    settledRevision.current = revision;
  }, [controller.data?.revision, controller.busy, controller.loading, controller.readError]);
  const item = controller.request, disabled = actionsLocked || controller.busy || controller.loading;
  function choose() {
    const latest = current.current;
    if (!mounted.current || !item || latest.actionsLocked || !latest.canResume || latest.controller.busy || latest.controller.loading || latest.controller.readError
      || latest.controller.data?.revision !== controller.data?.revision || latest.controller.request !== item || item.status !== 'available') return;
    latest.onChoose(item, latest.controller.data!.revision);
  }
  const service = services.find(value => value.id === item?.serviceId), resource = resources.find(value => value.id === item?.resourceId);
  return <section ref={section} tabIndex={-1} aria-labelledby="client-waitlist-title" className="min-w-0 scroll-mt-40 space-y-3 rounded-xl border border-sarin-line bg-sarin-canvas p-3 sm:p-4 [overflow-wrap:anywhere] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-sarin-blue">
    <div className="flex items-center gap-2"><ListChecks aria-hidden="true" className="h-4 w-4 shrink-0" /><h3 id="client-waitlist-title" className="text-sm font-semibold">Lista de espera</h3></div>
    <p className="text-xs leading-relaxed text-sarin-muted">Consulta aquí si aparecen horarios. El horario se reserva cuando confirmas una cita.</p>
    {props.offerContent}
    {controller.operation && <p role="status" className="text-sm text-sarin-muted">{controller.operation === 'join' ? 'Guardando solicitud…' : 'Saliendo de la lista…'}</p>}
    {controller.reconciling && <p role="status" className="text-sm text-sarin-muted">Comprobando si se guardó el cambio…</p>}
    {controller.loading && !controller.reconciling && <p role="status" className="text-sm text-sarin-muted">Comprobando tu lista de espera…</p>}
    {controller.actionError && <Notice error>{controller.actionError}</Notice>}
    {controller.readError && <div className="space-y-1"><Notice error>No pudimos comprobar tu lista de espera. {controller.readError}</Notice><button type="button" className={actionClass} disabled={Boolean(controller.operation)} onClick={() => controller.refresh()}>Reintentar lista de espera</button></div>}
    {!controller.loading && !controller.readError && !controller.reconciling && !controller.operation && <>
      {item ? <div className="space-y-2 rounded-xl border border-sarin-line bg-sarin-paper p-3">
        <h4 className="text-sm font-semibold">{service?.name ?? 'Servicio no disponible'}</h4>
        <p className="text-sm text-sarin-muted">{dateFormat.format(new Date(`${item.dateKey}T12:00:00Z`))} (Colombia)</p>
        <p className="text-sm text-sarin-muted">{item.resourceId === null ? 'Cualquiera disponible' : resource?.name ?? 'Profesional no disponible'}</p>
        <p className="text-xs text-sarin-muted">{item.subjectKind === 'represented_minor' ? 'Para un menor a quien representas' : 'Para ti'}</p>
        <p role="status" className="text-sm text-sarin-ink">{item.status === 'available' ? 'Hay horarios disponibles. Elige uno para revisar tu reserva.' : item.status === 'waiting' ? 'Aún no hay horarios para esta búsqueda.' : item.status === 'expired' ? 'La fecha de esta solicitud ya pasó.' : item.reason === 'service_unavailable' ? 'Esta opción ya no está disponible. Puedes salir de la lista y elegir otra.' : 'Esta solicitud está en pausa. Revisa tus permisos y las opciones actuales del negocio. Para crear otra solicitud, sal primero de esta lista.'}</p>
        {item.status !== 'expired' && <p className="text-xs leading-relaxed text-sarin-muted">La solicitud permanece hasta que salgas de la lista o termine este día, incluso si reservas una cita.</p>}
        <div className="flex flex-wrap gap-x-5 gap-y-1">
          {item.status !== 'expired' && <button type="button" className={actionClass} disabled={disabled} onClick={() => controller.refresh()}>Comprobar horarios</button>}
          {item.status === 'available' && <button type="button" className={actionClass} disabled={disabled || !canResume} onClick={choose}>Elegir horario</button>}
          <button type="button" className={actionClass} disabled={disabled} onClick={() => controller.cancel()}>Salir de la lista</button>
        </div>
      </div> : <p className="text-sm text-sarin-muted">No tienes una solicitud en este negocio. Puedes apuntarte cuando una búsqueda de horarios no encuentre disponibilidad.</p>}
    </>}
  </section>;
}
