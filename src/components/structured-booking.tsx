"use client";
import { useEffect, useRef, useState } from 'react';
import { useAuth } from './auth-provider';
import { useBookingSubjectConsent } from '@/hooks/useBookingSubjectConsent';
import { useStructuredBooking } from '@/hooks/useStructuredBooking';
import type { BookingCapability, BookingSubjectCase, BookingBeneficiary, BookingSubjectKind, RepresentativeRole } from '@/lib/booking-subject';
import type { PublicBusiness, Appointment } from '@/types/firestore';
import { isSubscriptionAllowed } from '@/lib/sarin/subscription';
import { BookingSubjectConsent } from './booking-subject-consent';
import { BookingProposal } from './booking-proposal';
import { buttonClass, fieldClass, Notice } from './app-shell';
export function StructuredBooking({ business, capability, enabled = true, onConfirmed, onLockedChange }: { business: PublicBusiness; capability: BookingCapability; enabled?: boolean; onConfirmed: (appointment: Appointment) => void; onLockedChange?: (locked: boolean) => void }) {
  const { user } = useAuth();
  return user ? <SubjectSelector key={`${user.uid}:${business.id}`} uid={user.uid} business={business} capability={capability} enabled={enabled} onConfirmed={onConfirmed} onLockedChange={onLockedChange} /> : null;
}
function SubjectSelector({ uid, business, capability, enabled, onConfirmed, onLockedChange }: { uid: string; business: PublicBusiness; capability: BookingCapability; enabled: boolean; onConfirmed: (appointment: Appointment) => void; onLockedChange?: (locked: boolean) => void }) {
  const [kind, setKind] = useState<BookingSubjectKind>(capability.dataMode === 'health' ? 'self' : 'represented_minor'), [role, setRole] = useState<RepresentativeRole>('parent'), [caseId, setCaseId] = useState(() => crypto.randomUUID());
  const [locked, setLocked] = useState(false);
  useEffect(() => { onLockedChange?.(locked); return () => onLockedChange?.(false); }, [locked, onLockedChange]);
  const subjectCase: BookingSubjectCase = kind === 'self' ? { bookingRequestId: caseId, subjectKind: kind } : { bookingRequestId: caseId, subjectKind: kind, representativeRole: role };
  return <section aria-label="Reserva sin IA" className="min-w-0 space-y-5 [overflow-wrap:anywhere]">
    <div><h2 className="text-xl font-semibold">Reserva sin IA</h2><p className="mt-2 text-sm text-sarin-muted">Elige servicio y horario. No incluyas síntomas, diagnósticos ni documentos.</p></div>
    {capability.dataMode === 'health' && capability.representedMinorsEnabled && <label className="block text-sm">¿Para quién reservas?<select aria-label="Destinatario de la reserva" className={fieldClass} value={kind} disabled={locked || !enabled} onChange={event => { setKind(event.target.value as BookingSubjectKind); setCaseId(crypto.randomUUID()); }}><option value="self">Para mí</option><option value="represented_minor">Para un menor a quien represento</option></select></label>}
    {kind === 'represented_minor' && <label className="block text-sm">Calidad del representante<select aria-label="Calidad del representante" className={fieldClass} value={role} disabled={locked || !enabled} onChange={event => { setRole(event.target.value as RepresentativeRole); setCaseId(crypto.randomUUID()); }}><option value="parent">Padre o madre</option><option value="legal_guardian">Representante legal</option></select></label>}
    {kind === 'represented_minor' && !capability.representedMinorsEnabled && <Notice>Este negocio no ha habilitado reservas para menores. Contacta directamente al establecimiento.</Notice>}
    <CaseBooking key={`${uid}:${business.id}:${caseId}:${kind}:${role}`} uid={uid} business={business} subjectCase={subjectCase} enabled={enabled && (kind !== 'represented_minor' || capability.representedMinorsEnabled)} onConfirmed={onConfirmed} onLocked={setLocked} />
    <button className="min-h-11 text-sm text-sarin-blue underline disabled:opacity-50" disabled={locked || !enabled} onClick={() => setCaseId(crypto.randomUUID())}>Iniciar otra reserva</button>
  </section>;
}
function CaseBooking({ uid, business, subjectCase, enabled, onConfirmed, onLocked }: { uid: string; business: PublicBusiness; subjectCase: BookingSubjectCase; enabled: boolean; onConfirmed: (appointment: Appointment) => void; onLocked: (locked: boolean) => void }) {
  const subject = useBookingSubjectConsent(uid, business, subjectCase), booking = useStructuredBooking(uid, business, subjectCase, enabled && subject.active), [name, setName] = useState(''), notified = useRef<string | null>(null);
  useEffect(() => { onLocked(booking.busy || booking.uncertain); return () => onLocked(false); }, [booking.busy, booking.uncertain, onLocked]);
  useEffect(() => { if (booking.appointment && notified.current !== booking.appointment.id) { notified.current = booking.appointment.id; onConfirmed(booking.appointment); } }, [booking.appointment, onConfirmed]);
  const selected = booking.selection, represented = subjectCase.subjectKind === 'represented_minor', canBook = enabled && isSubscriptionAllowed(business), service = business.services.find(item => item.id === selected.serviceId);
  const beneficiary: BookingBeneficiary = represented ? { kind: 'represented_minor', displayName: name.trim(), representativeRole: subjectCase.representativeRole } : { kind: 'self' };
  return <div className="space-y-5">
    <BookingSubjectConsent controller={subject} enabled={enabled} />
    {booking.error && <Notice error>{booking.error}</Notice>}
    {booking.uncertain && <div className="space-y-2 rounded-xl border border-sarin-line p-4"><p className="text-sm">Falta comprobar la confirmación. Reintenta esta misma operación para recuperar lo que se guardó, incluso si retiraste el permiso.</p><button className={buttonClass} disabled={booking.busy} onClick={() => void booking.retryConfirmation()}>Recuperar confirmación</button></div>}
    {booking.appointment ? <Notice>Cita guardada. Consulta su estado y cancela si lo necesitas en Mis citas.</Notice> : enabled && subject.active && <>
      {!canBook && <Notice>El negocio tiene las nuevas reservas en pausa. Tus citas guardadas y su cancelación siguen disponibles.</Notice>}
      <div className="space-y-4">
        {represented && <label className="block text-sm">Nombre breve del menor<input aria-label="Nombre breve del menor" className={fieldClass} maxLength={80} value={name} disabled={booking.frozen} onChange={event => setName(event.target.value)} /><span className="text-xs text-sarin-muted">Solo el nombre necesario para distinguir la cita. El teléfono será del adulto.</span></label>}
        <label className="block text-sm">Servicio<select aria-label="Servicio de la reserva" className={fieldClass} value={selected.serviceId} disabled={booking.frozen || !canBook} onChange={event => booking.setSelection({ ...selected, serviceId: event.target.value, resourceId: '', startTimeStr: '' })}><option value="">Selecciona un servicio</option>{business.services.map(item => <option key={item.id} value={item.id}>{item.name} · {item.price.toLocaleString('es-CO')} COP</option>)}</select></label>
        <label className="block text-sm">Profesional o recurso<select aria-label="Recurso de la reserva" className={fieldClass} value={selected.resourceId} disabled={booking.frozen || !canBook || !service} onChange={event => booking.setSelection({ ...selected, resourceId: event.target.value, startTimeStr: '' })}><option value="">Cualquiera disponible</option>{business.resources.filter(item => item.active && service?.resourceIds.includes(item.id)).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label className="block text-sm">Día (Colombia)<input aria-label="Día de la reserva" type="date" className={`${fieldClass} min-w-0`} value={selected.dateKey} disabled={booking.frozen || !canBook} onChange={event => booking.setSelection({ ...selected, dateKey: event.target.value, startTimeStr: '' })} /></label>
        <button className={buttonClass} disabled={!canBook || !selected.serviceId || !selected.dateKey || booking.loadingAvailability || booking.frozen || (represented && !name.trim())} onClick={() => void booking.loadAvailability()}>{booking.loadingAvailability ? 'Consultando horarios…' : 'Consultar horarios'}</button>
        {booking.availability.map(resource => <fieldset key={resource.resourceId} className="min-w-0 space-y-2"><legend className="text-sm font-medium">{resource.resourceName}</legend><div className="flex flex-wrap gap-2">{resource.slots.map(slot => <button key={slot} className={`min-h-11 rounded-lg border px-3 text-sm tabular-nums ${selected.resourceId === resource.resourceId && selected.startTimeStr === slot ? 'border-sarin-blue bg-sarin-soft text-sarin-blue' : 'border-sarin-line'}`} aria-pressed={selected.resourceId === resource.resourceId && selected.startTimeStr === slot} onClick={() => booking.setSelection({ ...selected, resourceId: resource.resourceId, startTimeStr: slot })}>{slot}</button>)}{resource.slots.length === 0 && <p className="text-sm text-sarin-muted">Sin horarios disponibles ese día.</p>}</div></fieldset>)}
        {!booking.proposal && <button className={buttonClass} disabled={booking.busy || !canBook || !selected.startTimeStr || !selected.resourceId || (represented && !name.trim())} onClick={() => void booking.propose(beneficiary)}>{booking.busy ? 'Preparando propuesta…' : 'Revisar propuesta'}</button>}
      </div>
    </>}
    {booking.proposal && !booking.appointment && <BookingProposal proposal={booking.proposal} beneficiary={beneficiary} confirming={booking.busy} disabled={!enabled || !subject.active || booking.uncertain} onConfirm={booking.confirm} />}
    <a className="inline-flex min-h-11 items-center text-sm text-sarin-blue underline" href={`tel:+${business.phoneWhatsApp.replace(/\D/g, '')}`}>Contactar directamente al negocio</a>
  </div>;
}
