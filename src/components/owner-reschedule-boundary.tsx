"use client";
import { Suspense, useEffect, useRef } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import type { Appointment, Business } from '@/types/firestore';
import type { RescheduleResult } from '@/lib/appointment-reschedule';
import { parseOwnerRescheduleReference, type OwnerRescheduleEntry } from '@/lib/owner-rescheduling';
import type { OwnerRequestScope } from '@/lib/client/owner-request-scope';
import { useOwnerReschedule } from '@/hooks/use-owner-reschedule';
import { OwnerRescheduleWorkspace } from '@/components/owner-reschedule-workspace';

type Props = {
  businessId: string; ownerUid: string; authEpoch: number; entry: OwnerRescheduleEntry | null;
  onApplied: (value: { appointment: Appointment; rescheduleResult: RescheduleResult }) => void;
  onLockedChange: (locked: boolean) => void; onEntryChange: (entry: OwnerRescheduleEntry | null) => void;
  business?: Pick<Business, 'resources' | 'services'>; requestScope?: OwnerRequestScope; enabled?: boolean;
  onViewCurrentDay?: (dateKey: string) => void;
};
type Flow = { key: string; entry: OwnerRescheduleEntry; proposalId: string | null; writtenId: string | null; external: { href: string; id: string } | null };

function ActiveFlow(props: Props & { flow: Flow; onPrepared: (id: string) => void; onRestart: () => void; close: () => void }) {
  const callbacks = useRef(props); callbacks.current = props;
  const controller = useOwnerReschedule({ ownerUid: props.ownerUid, authEpoch: props.authEpoch, businessId: props.businessId, business: props.business, requestScope: props.requestScope, entry: props.flow.entry, enabled: props.enabled !== false });
  const reported = useRef(new Set<string>());
  useEffect(() => { callbacks.current.onLockedChange(!controller.canClose); }, [controller.canClose]);
  useEffect(() => () => callbacks.current.onLockedChange(false), []);
  useEffect(() => {
    if (controller.proposal) callbacks.current.onPrepared(controller.proposal.id);
    else if ('appointmentId' in props.flow.entry && props.flow.writtenId) callbacks.current.onRestart();
  }, [controller.proposal?.id]);
  useEffect(() => {
    const recovery = controller.recovery, current = callbacks.current;
    if (recovery?.state !== 'applied' || !recovery.result || (current.requestScope && !current.requestScope.isCurrent())) return;
    const key = JSON.stringify([recovery.proposal.id, recovery.result.revision, recovery.result.confirmedAt]);
    if (reported.current.has(key)) return;
    reported.current.add(key); current.onApplied({ appointment: recovery.appointment, rescheduleResult: recovery.result });
  }, [controller.recovery]);
  return <OwnerRescheduleWorkspace controller={controller} onClose={() => { if (controller.canClose) callbacks.current.close(); }} onViewCurrentDay={value => callbacks.current.onViewCurrentDay?.(value)} />;
}

function Boundary(props: Props) {
  const search = useSearchParams().toString(), pathname = usePathname() ?? '/dashboard', router = useRouter();
  const navigation = useRef({ search, pathname, router }); navigation.current = { search, pathname, router };
  const callbacks = useRef(props); callbacks.current = props;
  const reference = parseOwnerRescheduleReference(search), identity = JSON.stringify([props.ownerUid, props.authEpoch, props.businessId]);
  const serial = useRef(0), active = useRef<Flow | null>(null), closing = useRef(false);
  if (!props.entry) active.current = null;
  else if (!active.current || !active.current.key.startsWith(identity + ':')) active.current = { key: identity + ':' + ++serial.current, entry: { ...props.entry }, proposalId: 'proposalId' in props.entry ? props.entry.proposalId : null, writtenId: null, external: null };
  const flow = active.current;
  if (flow && reference.proposalId && reference.proposalId !== flow.proposalId && !('proposalId' in flow.entry && flow.entry.proposalId === reference.proposalId)) {
    flow.external = { id: reference.proposalId, href: `${pathname}?${search}` };
  }
  const permitted = props.enabled !== false && !!props.businessId && !!props.ownerUid && (!props.requestScope || props.requestScope.canRead());
  useEffect(() => {
    if (!reference.proposalId) { closing.current = false; return; }
    if (closing.current || !permitted || props.entry || reference.error) return;
    callbacks.current.onEntryChange({ proposalId: reference.proposalId });
  }, [identity, reference.proposalId, reference.error, permitted, props.entry]);

  function prepared(id: string) {
    if (active.current !== flow || !flow || (callbacks.current.requestScope && !callbacks.current.requestScope.isCurrent())) return;
    flow.proposalId = id;
    if (flow.writtenId === id) return;
    flow.writtenId = id;
    const current = navigation.current, query = new URLSearchParams(current.search), existing = parseOwnerRescheduleReference(current.search);
    if (existing.proposalId === id && !existing.error) return;
    query.delete('ownerReschedule'); query.set('ownerReschedule', id);
    current.router.replace(`${current.pathname}?${query.toString()}`, { scroll: false });
  }
  function close() {
    if (!flow || active.current !== flow || (callbacks.current.requestScope && !callbacks.current.requestScope.isCurrent())) return;
    closing.current = true;
    const current = navigation.current, query = new URLSearchParams(current.search); query.delete('ownerReschedule');
    current.router.replace(current.pathname + (query.size ? '?' + query.toString() : ''), { scroll: false });
    callbacks.current.onEntryChange(null);
  }
  function restart() {
    if (!flow || active.current !== flow || !('appointmentId' in flow.entry) || (callbacks.current.requestScope && !callbacks.current.requestScope.isCurrent())) return;
    const prior = flow.proposalId; flow.proposalId = null; flow.writtenId = null;
    const current = navigation.current, query = new URLSearchParams(current.search), existing = parseOwnerRescheduleReference(current.search);
    // An earlier router.replace may still be settling; supersede our own pending
    // reference as well, while retaining a different external reference.
    if (!prior || existing.error || (existing.proposalId !== null && existing.proposalId !== prior)) return;
    query.delete('ownerReschedule'); current.router.replace(current.pathname + (query.size ? '?' + query.toString() : ''), { scroll: false });
  }
  return <>
    {reference.error && <p role="alert" className="rounded-xl bg-rose-50 p-4 text-sm text-rose-800">{reference.error}</p>}
    {flow?.external && <p role="status" className="rounded-xl border border-sarin-line bg-sarin-canvas p-4 text-sm">Hay otro enlace de cambio de horario. Conservamos el cambio abierto. <a href={flow.external.href} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center font-medium text-sarin-blue underline">Abrir el otro enlace en una pestaña nueva</a></p>}
    {flow && <ActiveFlow key={flow.key} {...props} enabled={permitted} flow={flow} onPrepared={prepared} onRestart={restart} close={close} />}
  </>;
}
export function OwnerRescheduleBoundary(props: Props) {
  return <Suspense fallback={<p role="status" className="text-sm text-sarin-muted">Cargando el cambio de horario…</p>}><Boundary {...props} /></Suspense>;
}
