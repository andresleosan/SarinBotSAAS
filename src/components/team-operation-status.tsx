"use client";
import { buttonClass } from '@/components/app-shell';
import type { TeamWorkspaceController } from '@/hooks/use-team-workspace';
export const teamStatus = { requested: 'Solicitud pendiente', active: 'Acceso activo', rejected: 'Solicitud rechazada', revoked: 'Acceso retirado' };
export function TeamOperationStatus({ controller }: { controller: Pick<TeamWorkspaceController, 'error'|'notice'|'pending'|'busy'|'applied'|'current'|'inspectPending'|'retryPending'> }) {
  return <div className="space-y-3">
    {controller.error && <p role="alert" className="text-sm text-rose-800">{controller.error}</p>}
    {controller.notice && <p role="status" className="text-sm text-sarin-muted">{controller.notice}</p>}
    {controller.pending && <section aria-label="Petición pendiente" className="space-y-2 rounded-xl border border-sarin-line p-3"><p>{controller.busy ? 'Esperando la misma petición…' : 'Resultado pendiente de comprobar. No puedes iniciar otra operación.'}</p><div className="flex flex-wrap gap-2"><button className={buttonClass} onClick={() => void controller.inspectPending()}>Comprobar petición</button><button className={buttonClass} disabled={controller.busy} onClick={() => void controller.retryPending()}>Reintentar la misma petición</button></div><p className="text-xs text-sarin-muted">Esta recuperación solo está disponible mientras permanezcas en esta vista.</p></section>}
    {controller.applied && <section aria-label="Constancia y estado actual" className="space-y-1 rounded-xl border border-sarin-line p-3 text-sm"><p>Constancia aplicada: revisión {controller.applied.membershipRevision}.</p><p>Estado actual: {controller.current ? teamStatus[controller.current.status] : 'no aparece en esta vista; vuelve a consultar.'}</p><p>Una constancia anterior no concede acceso nuevo.</p></section>}
  </div>;
}
