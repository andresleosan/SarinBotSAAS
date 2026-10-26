"use client";
import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@/components/auth-provider';
import { TeamOperationStatus, teamStatus } from '@/components/team-operation-status';
import { buttonClass } from '@/components/app-shell';
import { useBusinessTeam, type BusinessTeamController } from '@/hooks/use-business-team';
import type { Business } from '@/types/firestore';
import type { TeamOwnerMembership, TeamOwnerDecisionCommand } from '@/lib/business-team';
type Review = { member: TeamOwnerMembership; command: TeamOwnerDecisionCommand; resourceName?: string };
export function BusinessTeamPanel({ businessId, ownerUid, business, controller }: { businessId: string; ownerUid: string; business?: Business; controller: BusinessTeamController }) {
  const [review, setReview] = useState<Review|null>(null), [resources, setResources] = useState<Record<string,string>>({});
  const reviewTitle = useRef<HTMLHeadingElement>(null), reviewTrigger = useRef<HTMLButtonElement|null>(null);
  useEffect(() => { reviewTitle.current?.focus(); }, [review?.command.requestId]);
  const activeResources = business?.id === businessId && business.ownerUid === ownerUid ? business.resources.filter(resource => resource.active) : [];
  const view = controller.view, blocked = controller.busy || controller.pending;
  function prepare(member: TeamOwnerMembership, action: 'approve'|'reject'|'revoke', trigger?: HTMLButtonElement) {
    if (!view || blocked) return;
    const resource = activeResources.find(item => item.id === resources[member.membershipId]);
    if (action === 'approve' && (!resource || !view.enabled || !view.eligible)) return;
    reviewTrigger.current = trigger ?? null;
    const common = { requestId: crypto.randomUUID(), expectedMembershipRevision: member.revision, expectedTeamRevision: view.teamRevision };
    setReview({ member: { ...member }, resourceName: resource?.name, command: action === 'approve' ? { ...common, action, resourceId: resource!.id } : { ...common, action } });
  }
  const reviewStillCurrent = review && view?.teamRevision === review.command.expectedTeamRevision && [...view.requested, ...view.active].some(member => member.membershipId === review.member.membershipId && member.revision === review.command.expectedMembershipRevision)
    && (review.command.action !== 'approve' || activeResources.some(resource => resource.id === ('resourceId' in review.command ? review.command.resourceId : null)) && view.enabled && view.eligible);
  if (controller.revoked) return <p role="alert">No se pudo verificar que sigas siendo dueño de este negocio. Vuelve a Mi negocio.</p>;
  if (controller.protected) return <section className="space-y-3"><p role="alert">El acceso a esta función está protegido. Comprueba tu acceso antes de continuar.</p>{controller.accessError && <p role="alert">{controller.accessError}</p>}<button className={buttonClass} disabled={controller.checkingAccess} onClick={() => void controller.checkAccess()}>Comprobar acceso</button></section>;
  return <div className="max-w-3xl min-w-0 space-y-5">
    <header className="space-y-2"><p className="text-xs uppercase tracking-widest text-sarin-blue">Mi negocio · Equipo</p><h1 className="text-3xl font-semibold">Equipo y accesos</h1><p className="text-sm text-sarin-muted">Revisa cada cuenta y asigna un recurso. Solicitar acceso no permite consultar la agenda.</p><a href="/dashboard/onboarding" className="inline-flex min-h-11 items-center text-sarin-blue underline">Volver a Mi negocio</a></header>
    <TeamOperationStatus controller={controller} />
    <button className={buttonClass} disabled={controller.loading} onClick={() => { setReview(null); void controller.refresh(); }}>Actualizar equipo</button>
    {controller.loading && <p role="status">Comprobando equipo…</p>}
    {view && <>
      {(!view.enabled || !view.eligible) && <p className="rounded-xl border border-sarin-line p-3 text-sm">Las nuevas aprobaciones están pausadas. Puedes revisar y retirar accesos o rechazar solicitudes.</p>}
      <section aria-label="Solicitudes" className="space-y-3"><h2 className="text-xl font-semibold">Solicitudes ({view.requested.length})</h2>{!view.requested.length && <p>No hay solicitudes pendientes.</p>}{view.requested.map(member => <article key={member.membershipId} className="min-w-0 space-y-3 rounded-xl border border-sarin-line bg-sarin-paper p-4"><h3 className="font-semibold">Solicitud pendiente</h3><details><summary className="min-h-11 cursor-pointer text-sarin-blue">Contrastar identificador de cuenta</summary><p className="break-all text-sm">UID: {member.memberUid}</p><p className="text-sm">Contrasta este identificador con la cuenta de la persona; el nombre del recurso no acredita identidad.</p></details><p className="text-sm">Permiso fijo: agenda del recurso asignado, solo lectura · versión 1.</p><label className="block text-sm">Recurso activo<select aria-label={`Recurso para ${member.membershipId}`} className="mt-2 min-h-11 w-full rounded-lg border border-sarin-line bg-sarin-paper p-2" value={resources[member.membershipId] ?? ''} disabled={blocked || !view.enabled || !view.eligible} onChange={event => { setReview(null); setResources(value => ({ ...value, [member.membershipId]: event.target.value })); }}><option value="">Elige una persona o estación</option>{activeResources.map(resource => <option key={resource.id} value={resource.id}>{resource.name}</option>)}</select></label>{!activeResources.length && <p className="text-sm">Necesitas un recurso propio activo para aprobar.</p>}<div className="flex flex-wrap gap-2"><button className={buttonClass} disabled={blocked || !view.enabled || !view.eligible || !activeResources.some(resource => resource.id === resources[member.membershipId])} onClick={event => prepare(member, 'approve', event?.currentTarget)}>Revisar aprobación</button><button className={buttonClass} disabled={blocked} onClick={event => prepare(member, 'reject', event?.currentTarget)}>Revisar rechazo</button></div></article>)}</section>
      <section aria-label="Accesos" className="space-y-3"><h2 className="text-xl font-semibold">Accesos ({view.active.length})</h2>{!view.active.length && <p>No hay accesos activos.</p>}{view.active.map(member => <article key={member.membershipId} className="min-w-0 space-y-2 rounded-xl border border-sarin-line bg-sarin-paper p-4"><details><summary className="min-h-11 cursor-pointer">Identificador de cuenta</summary><p className="break-all text-sm">UID: {member.memberUid}</p></details><p>{activeResources.find(resource => resource.id === member.resourceId)?.name ?? 'Recurso inactivo o no disponible'} · solo lectura</p><button className={buttonClass} disabled={blocked} onClick={event => prepare(member, 'revoke', event?.currentTarget)}>Revisar revocación</button></article>)}</section>
      {review && <section aria-label="Confirmación de acceso" className="space-y-3 rounded-xl border border-sarin-blue bg-sarin-paper p-4"><h2 ref={reviewTitle} tabIndex={-1} className="text-lg font-semibold">Revisa antes de confirmar</h2><p className="break-all text-sm">Cuenta: {review.member.memberUid}</p><p>Antes: {teamStatus[review.member.status]}</p><p>Después: {review.command.action === 'approve' ? `Acceso activo · ${review.resourceName} · agenda asignada solo lectura, versión 1` : review.command.action === 'revoke' ? 'Acceso retirado; no cancela reservas de clientes' : 'Solicitud rechazada'}</p><p className="text-sm">No incluye contactos, otras agendas, acciones sobre citas ni configuración.</p>{!reviewStillCurrent && <p role="alert">El estado cambió. Actualiza y vuelve a revisar.</p>}<div className="flex flex-wrap gap-2"><button className={buttonClass} disabled={blocked || !reviewStillCurrent} onClick={() => { if (!blocked && reviewStillCurrent) void controller.decide(review.member.membershipId, review.command); }}>Confirmar {review.command.action === 'approve' ? 'aprobación' : review.command.action === 'revoke' ? 'revocación' : 'rechazo'}</button><button className={buttonClass} disabled={blocked} onClick={() => { setReview(null); reviewTrigger.current?.focus(); }}>Volver sin confirmar</button></div></section>}
      <details className="rounded-xl border border-sarin-line p-4"><summary className="min-h-11 cursor-pointer font-semibold">Actividad reciente (últimos 20)</summary><ul className="space-y-3 text-sm">{view.events.map(event => <li key={event.id} className="break-all">{teamStatus[event.afterStatus]} · cuenta {event.memberUid} · {new Date(event.recordedAt).toLocaleString('es-CO')}</li>)}</ul>{!view.events.length && <p>Sin actividad registrada.</p>}</details>
    </>}
  </div>;
}
export function BusinessTeamWorkspace({ businessId, ownerUid, business }: { businessId: string; ownerUid: string; business?: Business }) {
  const auth = useAuth();
  const controller = useBusinessTeam({ businessId, ownerUid, authEpoch: auth.authEpoch, enabled: auth.user?.uid === ownerUid });
  return <BusinessTeamPanel businessId={businessId} ownerUid={ownerUid} business={business} controller={controller} />;
}
