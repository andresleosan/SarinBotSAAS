"use client";

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useAppointmentReschedule } from '@/hooks/useAppointmentReschedule';
import { useBookingSubjectConsent } from '@/hooks/useBookingSubjectConsent';
import { bookingBeneficiarySchema, type BookingCapability, type BookingSubjectCase } from '@/lib/booking-subject';
import { canRescheduleSubscription, type RescheduleResult } from '@/lib/appointment-reschedule';
import type { Appointment, PublicBusiness } from '@/types/firestore';
import { BookingSubjectConsent } from './booking-subject-consent';
import { buttonClass, fieldClass, Notice } from './app-shell';

type Props = { uid: string; source: Appointment; business: PublicBusiness; capability: BookingCapability; enabled: boolean; sourceCurrent: boolean; onConfirmed: (result: RescheduleResult) => void; onCancel: () => void; onLockedChange: (locked: boolean) => void };
const money = (amount: number) => amount.toLocaleString('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 });
const dateFormatter = new Intl.DateTimeFormat('es-CO', { timeZone: 'America/Bogota', day: 'numeric', month: 'long', year: 'numeric' });
const dateLabel = (dateKey: string) => dateFormatter.format(new Date(`${dateKey}T12:00:00Z`));

export function AppointmentReschedule(props: Props) {
  return <RescheduleEntry key={JSON.stringify([props.uid, props.business.id, props.source])} {...props} />;
}
function RescheduleEntry(props: Props) {
  const [requestId] = useState(() => crypto.randomUUID());
  const parsed = bookingBeneficiarySchema.safeParse(props.source.beneficiary);
  if (!parsed.success && props.source.beneficiary !== undefined) return <section aria-label="Cambiar horario" className="space-y-4 rounded-2xl border border-sarin-line bg-sarin-paper p-5"><h2 className="text-xl font-semibold">Cambiar horario</h2><Notice>No pudimos comprobar el beneficiario de esta cita. Contacta directamente al negocio para gestionar el cambio.</Notice><Contact business={props.business} /><button type="button" className={buttonClass} onClick={props.onCancel}>Volver a Mis citas</button></section>;
  if (!parsed.success) return <RescheduleForm {...props} requestId={requestId} subjectActive subjectBusy={false} subjectPanel={null} />;
  const beneficiary = parsed.data;
  const subjectCase: BookingSubjectCase = beneficiary.kind === 'self' ? { bookingRequestId: requestId, subjectKind: 'self' } : { bookingRequestId: requestId, subjectKind: 'represented_minor', representativeRole: beneficiary.representativeRole };
  return <KnownCase {...props} requestId={requestId} subjectCase={subjectCase} />;
}
function KnownCase(props: Props & { requestId: string; subjectCase: BookingSubjectCase }) {
  const subject = useBookingSubjectConsent(props.uid, props.business, props.subjectCase);
  return <RescheduleForm {...props} subjectActive={subject.active} subjectBusy={subject.busy} subjectPanel={(subject.loading || subject.error || subject.status?.required !== false) ? <BookingSubjectConsent controller={subject} enabled={props.enabled} /> : null} />;
}
function Contact({ business }: { business: PublicBusiness }) {
  return <a className="inline-flex min-h-11 items-center text-sm text-sarin-blue underline" href={`tel:+${business.phoneWhatsApp.replace(/\D/g, '')}`}>Contactar directamente al negocio</a>;
}
function RescheduleForm({ uid, source, business, capability, enabled, sourceCurrent, onConfirmed, onCancel, onLockedChange, requestId, subjectCase, subjectActive, subjectBusy, subjectPanel }: Props & { requestId: string; subjectCase?: BookingSubjectCase; subjectActive: boolean; subjectBusy: boolean; subjectPanel: ReactNode }) {
  const service = business.services.find(item => item.id === source.serviceId);
  const resources = business.resources.filter(item => item.active && service?.resourceIds.includes(item.id));
  const currentResource = resources.some(item => item.id === source.resourceId) ? source.resourceId : '';
  const policyAllowsSource = source.beneficiary !== undefined || (capability.dataMode === 'general' && !capability.representedMinorsEnabled);
  const allowed = enabled && sourceCurrent && policyAllowsSource && !subjectBusy && Boolean(service && resources.length) && canRescheduleSubscription(business) && source.type === 'appointment' && source.tenantId === business.id && source.client?.uid === uid && source.status === 'confirmed' && source.startAt > Date.now() && Number.isSafeInteger(source.rescheduleRevision ?? 0) && (source.rescheduleRevision ?? 0) >= 0 && (source.beneficiary?.kind !== 'represented_minor' || capability.representedMinorsEnabled);
  const contextKey = JSON.stringify([business.services, business.resources, business.sarinConfig.intakeFields, business.sarinConfig.onboardingCompleted, business.slug, capability, sourceCurrent]);
  const booking = useAppointmentReschedule(uid, business, source, requestId, subjectCase, allowed && subjectActive, contextKey, currentResource);
  const latest = useRef({ booking, subjectBusy, onConfirmed, onCancel }); latest.current = { booking, subjectBusy, onConfirmed, onCancel };
  const mounted = useRef(false), notified = useRef<string | null>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { onLockedChange(booking.busy || booking.uncertain || subjectBusy); return () => onLockedChange(false); }, [booking.busy, booking.uncertain, subjectBusy, onLockedChange]);
  useEffect(() => { if (booking.result && notified.current !== booking.result.proposalId) { notified.current = booking.result.proposalId; latest.current.onConfirmed(booking.result); } }, [booking.result]);
  const canSelect = allowed && subjectActive && booking.contextCurrent && !booking.frozen && !booking.busy && !booking.uncertain;
  const selection = booking.selection, proposal = booking.proposal;
  function leave() { if (mounted.current && !latest.current.booking.busy && !latest.current.booking.uncertain && !latest.current.subjectBusy) latest.current.onCancel(); }
  return <section aria-label="Cambiar horario" className="min-w-0 space-y-5 rounded-2xl border border-sarin-line bg-sarin-paper p-5 [overflow-wrap:anywhere]">
    <div><h2 className="text-xl font-semibold">Cambiar horario</h2><p className="mt-2 text-sm text-sarin-muted">Tu cita conserva su horario actual hasta que confirmes el cambio. Elige otro día, profesional y hora. Horarios de Colombia.</p></div>
    <p className="text-sm">{source.beneficiary?.kind === 'represented_minor' ? <>Para: {source.beneficiary.displayName} · Gestionada por tu cuenta de adulto. Calidad declarada: {source.beneficiary.representativeRole === 'parent' ? 'padre o madre' : 'representante legal'}.</> : source.beneficiary?.kind === 'self' ? 'Reserva para ti.' : 'Registro anterior sin beneficiario declarado.'}</p>
    {subjectPanel}
    {booking.error && <Notice error>{booking.error}</Notice>}
    {!policyAllowsSource && <Notice>Esta cita no tiene un beneficiario declarado que podamos comprobar con las opciones actuales. Contacta directamente al negocio para gestionar el cambio.</Notice>}
    {!sourceCurrent && <Notice error>La cita cambió o no pudimos comprobar su estado actual. Revisa Mis citas antes de iniciar otro cambio.</Notice>}
    {!booking.contextCurrent && <Notice error>Las opciones del negocio cambiaron. Vuelve a Mis citas e inicia el cambio con los datos actuales.</Notice>}
    {!service || !resources.length ? <Notice>El servicio o sus profesionales ya no están disponibles. Contacta directamente al negocio para gestionar tu cita.</Notice> : <>
      <section aria-label="Servicio del cambio" className="space-y-2 rounded-xl bg-sarin-soft p-4"><h3 className="font-semibold">{service.name}</h3><p className="text-sm">Precio vigente: {money(service.price)} · Duración vigente: {service.durationMinutes} minutos.</p><p className="text-xs text-sarin-muted">Se conservan el beneficiario y los datos de contacto y respuestas de tu cita.</p></section>
      {!allowed && <Notice>Revisa los permisos y las opciones actuales del negocio para cambiar el horario. Puedes consultar Mis citas o recuperar un cambio pendiente.</Notice>}
      {!proposal && subjectActive && policyAllowsSource && <div className="space-y-4">
        <label className="block text-sm">Profesional o recurso<select aria-label="Profesional del nuevo horario" className={fieldClass} value={selection.resourceId} disabled={!canSelect} onChange={event => booking.setSelection({ ...selection, resourceId: event.target.value, startTimeStr: '' })}><option value="">Cualquiera disponible</option>{resources.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label className="block text-sm">Nuevo día (Colombia)<input type="date" aria-label="Nuevo día de la cita" className={`${fieldClass} min-w-0`} value={selection.dateKey} disabled={!canSelect} onChange={event => booking.setSelection({ ...selection, dateKey: event.target.value, startTimeStr: '' })} /></label>
        <button type="button" className={buttonClass} disabled={!canSelect || !selection.dateKey || booking.availabilityStatus === 'loading'} onClick={() => void booking.loadAvailability()}>{booking.availabilityStatus === 'loading' ? 'Consultando nuevos horarios…' : 'Consultar nuevos horarios'}</button>
        {booking.availabilityStatus === 'success' && !booking.availability.some(item => item.slots.length) && <p role="status" className="text-sm text-sarin-muted">No hay horarios disponibles para esta selección. Elige otro día o profesional manualmente.</p>}
        {booking.availability.filter(item => item.slots.length).map(resource => <fieldset key={resource.resourceId} className="space-y-2"><legend className="text-sm font-medium">{resource.resourceName}</legend><div className="flex flex-wrap gap-2">{resource.slots.map(time => <button type="button" key={time} disabled={!canSelect} aria-pressed={selection.resourceId === resource.resourceId && selection.startTimeStr === time} className={`min-h-11 rounded-lg border px-3 text-sm tabular-nums disabled:opacity-50 ${selection.resourceId === resource.resourceId && selection.startTimeStr === time ? 'border-sarin-blue bg-sarin-soft text-sarin-blue' : 'border-sarin-line'}`} onClick={() => booking.setSelection({ ...selection, resourceId: resource.resourceId, startTimeStr: time })}>{time}</button>)}</div></fieldset>)}
        <button type="button" className={buttonClass} disabled={!allowed || !subjectActive || !booking.contextCurrent || booking.busy || !selection.dateKey || !selection.startTimeStr || !selection.resourceId} onClick={() => void booking.propose()}>{booking.busy ? 'Preparando cambio…' : booking.frozen ? 'Reintentar propuesta de cambio' : 'Revisar cambio de horario'}</button>
      </div>}
    </>}
    {proposal && <section aria-label="Propuesta de cambio de horario" className="space-y-4 rounded-xl border border-sarin-blue p-4">
      <h3 className="font-semibold">Revisa el cambio de tu cita</h3>
      <div className="grid gap-4 sm:grid-cols-2"><div className="space-y-1"><h4 className="font-semibold">Anterior</h4><p className="text-sm">{source.serviceName || 'Cita'}</p><p className="text-sm">{dateLabel(proposal.reschedule!.source.dateKey)} · {proposal.reschedule!.source.startTimeStr}–{proposal.reschedule!.source.endTimeStr}</p><p className="text-sm">{proposal.reschedule!.source.resourceName || business.resources.find(item => item.id === proposal.reschedule!.source.resourceId)?.name || 'Profesional anterior'}</p>{proposal.reschedule!.source.priceCOP !== undefined && <p className="text-sm">{money(proposal.reschedule!.source.priceCOP)}</p>}</div><div className="space-y-1"><h4 className="font-semibold">Propuesto</h4><p className="text-sm">{proposal.serviceName}</p><p className="text-sm">{dateLabel(proposal.dateKey)} · {proposal.startTimeStr}–{proposal.endTimeStr}</p><p className="text-sm">{proposal.resourceName}</p><p className="text-sm">{money(proposal.priceCOP)}</p></div></div>
      <p className="text-xs text-sarin-muted">La propuesta dura diez minutos y no aparta el nuevo horario. Al confirmar se comprueba otra vez y se actualiza la misma cita.</p>
      <button type="button" className={buttonClass} disabled={!allowed || !subjectActive || !booking.contextCurrent || booking.busy || booking.uncertain || Boolean(booking.result)} onClick={() => void booking.confirm()}>{booking.busy ? 'Confirmando cambio…' : 'Confirmar cambio de horario'}</button>
    </section>}
    {booking.uncertain && <div className="space-y-3 rounded-xl border border-sarin-line p-4"><p className="text-sm">Falta comprobar el cambio. Recupera esta misma confirmación antes de iniciar otra operación, incluso si retiraste el permiso.</p><button type="button" className={buttonClass} disabled={booking.busy} onClick={() => void booking.retryConfirmation()}>Recuperar cambio de horario</button></div>}
    <div className="flex flex-wrap gap-x-5 gap-y-2"><button type="button" className="min-h-11 rounded text-sm text-sarin-blue underline disabled:opacity-50" disabled={booking.busy || booking.uncertain || subjectBusy} onClick={leave}>Volver a Mis citas</button><Contact business={business} /></div>
  </section>;
}
