"use client";
import { useEffect, useRef, useState } from 'react';
import { useAuth } from './auth-provider';
import { useBookingSubjectConsent } from '@/hooks/useBookingSubjectConsent';
import { useStructuredBooking } from '@/hooks/useStructuredBooking';
import type { WaitlistBookingHint, WaitlistController } from '@/hooks/use-waitlist';
import type { BookingCapability, BookingSubjectCase, BookingBeneficiary, BookingSubjectKind, RepresentativeRole } from '@/lib/booking-subject';
import type { PublicBusiness, Appointment } from '@/types/firestore';
import { isSubscriptionAllowed } from '@/lib/sarin/subscription';
import { serviceCatalogMetadata } from '@/lib/service-catalog';
import { BookingSubjectConsent } from './booking-subject-consent';
import { BookingProposal } from './booking-proposal';
import { buttonClass, fieldClass, Notice } from './app-shell';
const bookingDateFormatter = new Intl.DateTimeFormat('es-CO', { timeZone: 'America/Bogota', day: 'numeric', month: 'long', year: 'numeric' });
const formatBookingDate = (dateKey: string) => bookingDateFormatter.format(new Date(`${dateKey}T12:00:00Z`));
export function StructuredBooking({ business, capability, enabled = true, initialSubjectKind, initialServiceId, initialBookingHint, waitlist, onInitialServiceHandled, onConfirmed, onLockedChange }: { business: PublicBusiness; capability: BookingCapability; enabled?: boolean; initialSubjectKind?: BookingSubjectKind; initialServiceId?: string; initialBookingHint?: WaitlistBookingHint; waitlist?: WaitlistController; onInitialServiceHandled?: () => void; onConfirmed: (appointment: Appointment) => void; onLockedChange?: (locked: boolean) => void }) {
  const { user } = useAuth();
  const scope = user ? JSON.stringify([user.uid, business.id, initialSubjectKind ?? 'default']) : null;
  const initialEntry = useRef<{ scope: string; serviceId: string | undefined; hint?: WaitlistBookingHint } | null>(null);
  if (scope && !initialEntry.current) initialEntry.current = { scope, serviceId: initialBookingHint?.serviceId ?? initialServiceId, hint: initialBookingHint };
  const handleInitialService = () => { if (initialEntry.current) { initialEntry.current.serviceId = undefined; initialEntry.current.hint = undefined; } onInitialServiceHandled?.(); };
  return user ? <SubjectSelector key={scope} uid={user.uid} business={business} capability={capability} enabled={enabled} initialSubjectKind={initialEntry.current?.scope === scope ? initialEntry.current.hint?.subjectKind ?? initialSubjectKind : initialSubjectKind} initialBookingHint={initialEntry.current?.scope === scope ? initialEntry.current.hint : undefined} waitlist={waitlist} initialServiceId={initialEntry.current?.scope === scope ? initialEntry.current.serviceId : undefined} onInitialServiceHandled={handleInitialService} onConfirmed={onConfirmed} onLockedChange={onLockedChange} /> : null;
}
function SubjectSelector({ uid, business, capability, enabled, initialSubjectKind, initialServiceId, initialBookingHint, waitlist, onInitialServiceHandled, onConfirmed, onLockedChange }: { uid: string; business: PublicBusiness; capability: BookingCapability; enabled: boolean; initialSubjectKind?: BookingSubjectKind; initialServiceId?: string; initialBookingHint?: WaitlistBookingHint; waitlist?: WaitlistController; onInitialServiceHandled?: () => void; onConfirmed: (appointment: Appointment) => void; onLockedChange?: (locked: boolean) => void }) {
  const [kind, setKind] = useState<BookingSubjectKind>(initialSubjectKind ?? (capability.dataMode === 'health' ? 'self' : 'represented_minor')), [role, setRole] = useState<RepresentativeRole>(initialBookingHint?.representativeRole ?? 'parent'), [caseId, setCaseId] = useState(() => crypto.randomUUID());
  const initialCaseId = useRef(caseId);
  const [locked, setLocked] = useState(false);
  useEffect(() => { onLockedChange?.(locked); return () => onLockedChange?.(false); }, [locked, onLockedChange]);
  const subjectCase: BookingSubjectCase = kind === 'self' ? { bookingRequestId: caseId, subjectKind: kind } : { bookingRequestId: caseId, subjectKind: kind, representativeRole: role };
  const generalSelf = capability.dataMode === 'general' && kind === 'self', title = generalSelf ? 'Reserva con calendario' : 'Reserva sin IA';
  return <section aria-label={title} className="min-w-0 space-y-5 [overflow-wrap:anywhere]">
    <div><h2 className="text-xl font-semibold">{title}</h2><p className="mt-2 text-sm text-sarin-muted">{generalSelf ? 'Elige el servicio, el profesional y el horario que prefieras.' : 'Elige servicio y horario. No incluyas síntomas, diagnósticos ni documentos.'}</p></div>
    {capability.dataMode === 'health' && capability.representedMinorsEnabled && <label className="block text-sm">¿Para quién reservas?<select aria-label="Destinatario de la reserva" className={fieldClass} value={kind} disabled={locked || !enabled} onChange={event => { setKind(event.target.value as BookingSubjectKind); setCaseId(crypto.randomUUID()); }}><option value="self">Para mí</option><option value="represented_minor">Para un menor a quien represento</option></select></label>}
    {kind === 'represented_minor' && <label className="block text-sm">Calidad del representante<select aria-label="Calidad del representante" className={fieldClass} value={role} disabled={locked || !enabled} onChange={event => { setRole(event.target.value as RepresentativeRole); setCaseId(crypto.randomUUID()); }}><option value="parent">Padre o madre</option><option value="legal_guardian">Representante legal</option></select></label>}
    {kind === 'represented_minor' && !capability.representedMinorsEnabled && <Notice>Este negocio no ha habilitado reservas para menores. Contacta directamente al establecimiento.</Notice>}
    <CaseBooking key={`${uid}:${business.id}:${caseId}:${kind}:${role}`} uid={uid} business={business} subjectCase={subjectCase} enabled={enabled && (kind !== 'represented_minor' || capability.representedMinorsEnabled)} initialServiceId={initialCaseId.current === caseId ? initialServiceId : undefined} initialBookingHint={initialCaseId.current === caseId ? initialBookingHint : undefined} waitlist={waitlist} onInitialServiceHandled={onInitialServiceHandled} onConfirmed={onConfirmed} onLocked={setLocked} />
    <button className="min-h-11 text-sm text-sarin-blue underline disabled:opacity-50" disabled={locked || !enabled} onClick={() => setCaseId(crypto.randomUUID())}>Iniciar otra reserva</button>
  </section>;
}
function CaseBooking({ uid, business, subjectCase, enabled, initialServiceId, initialBookingHint, waitlist, onInitialServiceHandled, onConfirmed, onLocked }: { uid: string; business: PublicBusiness; subjectCase: BookingSubjectCase; enabled: boolean; initialServiceId?: string; initialBookingHint?: WaitlistBookingHint; waitlist?: WaitlistController; onInitialServiceHandled?: () => void; onConfirmed: (appointment: Appointment) => void; onLocked: (locked: boolean) => void }) {
  const initialService = useRef({ requested: initialServiceId !== undefined, serviceId: business.services.some(item => item.id === initialServiceId) ? initialServiceId! : '' });
  const initialServiceHandled = useRef(false);
  const subject = useBookingSubjectConsent(uid, business, subjectCase), booking = useStructuredBooking(uid, business, subjectCase, enabled && subject.active && isSubscriptionAllowed(business), initialService.current.serviceId, initialBookingHint && { dateKey: initialBookingHint.dateKey, resourceId: business.resources.some(item => item.id === initialBookingHint.resourceId && item.active && business.services.find(service => service.id === initialService.current.serviceId)?.resourceIds.includes(item.id)) ? initialBookingHint.resourceId : '' }), [name, setName] = useState(''), notified = useRef<string | null>(null);
  const nextAvailabilityResult = useRef<HTMLParagraphElement>(null);
  useEffect(() => { if (booking.nextAvailabilityStatus === 'found') nextAvailabilityResult.current?.focus(); }, [booking.nextAvailabilityStatus]);
  useEffect(() => { if (initialService.current.requested && !initialServiceHandled.current) { initialServiceHandled.current = true; onInitialServiceHandled?.(); } }, [onInitialServiceHandled]);
  useEffect(() => { onLocked(booking.busy || booking.uncertain); return () => onLocked(false); }, [booking.busy, booking.uncertain, onLocked]);
  useEffect(() => { if (booking.appointment && notified.current !== booking.appointment.id) { notified.current = booking.appointment.id; onConfirmed(booking.appointment); } }, [booking.appointment, onConfirmed]);
  const selected = booking.selection, represented = subjectCase.subjectKind === 'represented_minor', canBook = enabled && isSubscriptionAllowed(business), service = business.services.find(item => item.id === selected.serviceId);
  const metadata = service ? serviceCatalogMetadata(service) : {};
  const emptyAvailability = booking.availabilityStatus === 'success' && !booking.availability.some(resource => resource.slots.length > 0), searchingNext = booking.nextAvailabilityStatus === 'loading';
  const liveJoin = useRef({ selected, booking, waitlist, canBook, subjectActive: subject.active }); liveJoin.current = { selected, booking, waitlist, canBook, subjectActive: subject.active };
  const mounted = useRef(true); useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  function joinWaitlist() {
    const current = liveJoin.current, list = current.waitlist;
    if (!mounted.current || !list || current.selected !== selected || !current.canBook || !current.subjectActive || current.booking.frozen || current.booking.busy || current.booking.uncertain
      || current.booking.availabilityStatus !== 'success' || current.booking.nextAvailabilityStatus === 'loading' || current.booking.availability.some(item => item.slots.length > 0)
      || list.busy || list.loading || list.readError || (list.request && list.request.status !== 'expired')) return;
    void list.join({ case: subjectCase, serviceId: selected.serviceId, dateKey: selected.dateKey, ...(selected.resourceId ? { resourceId: selected.resourceId } : {}) });
  }
  const beneficiary: BookingBeneficiary = represented ? { kind: 'represented_minor', displayName: name.trim(), representativeRole: subjectCase.representativeRole } : { kind: 'self' };
  return <div className="space-y-5">
    {(subject.loading || subject.error || subject.status?.required !== false) && <BookingSubjectConsent controller={subject} enabled={enabled} />}
    {booking.error && <Notice error>{booking.error}</Notice>}
    {booking.uncertain && <div className="space-y-2 rounded-xl border border-sarin-line p-4"><p className="text-sm">Falta comprobar la confirmación. Reintenta esta misma operación para recuperar lo que se guardó, incluso si retiraste el permiso.</p><button className={buttonClass} disabled={booking.busy} onClick={() => void booking.retryConfirmation()}>Recuperar confirmación</button></div>}
    {booking.appointment ? <Notice>Cita guardada. Consulta su estado y cancela si lo necesitas en Mis citas.</Notice> : enabled && subject.active && <>
      {!canBook && <Notice>El negocio tiene las nuevas reservas en pausa. Tus citas guardadas y su cancelación siguen disponibles.</Notice>}
      <div className="space-y-4">
        {represented && <label className="block text-sm">Nombre breve del menor<input aria-label="Nombre breve del menor" className={fieldClass} maxLength={80} value={name} disabled={booking.frozen} onChange={event => setName(event.target.value)} /><span className="text-xs text-sarin-muted">Solo el nombre necesario para distinguir la cita. El teléfono será del adulto.</span></label>}
        <label className="block text-sm">Servicio<select aria-label="Servicio de la reserva" className={fieldClass} value={selected.serviceId} disabled={booking.frozen || !canBook} onChange={event => booking.setSelection({ ...selected, serviceId: event.target.value, resourceId: '', startTimeStr: '' })}><option value="">Selecciona un servicio</option>{business.services.map(item => <option key={item.id} value={item.id}>{item.name} · {item.price.toLocaleString('es-CO')} COP</option>)}</select></label>
        {service && <section aria-label="Detalles del servicio" className="min-w-0 space-y-3 rounded-xl border border-sarin-line bg-sarin-soft p-4">
          {metadata.category && <p className="text-sm font-medium">{metadata.category}</p>}
          {metadata.description && <p className="whitespace-pre-wrap text-sm leading-relaxed text-sarin-muted">{metadata.description}</p>}
          <dl className="flex flex-wrap gap-x-6 gap-y-2">
            <div><dt className="text-xs text-sarin-muted">Duración</dt><dd className="text-sm font-medium">{service.durationMinutes} minutos</dd></div>
            <div><dt className="text-xs text-sarin-muted">Precio</dt><dd className="text-sm font-medium">{service.price.toLocaleString('es-CO')} COP</dd></div>
          </dl>
        </section>}
        <label className="block text-sm">Profesional o recurso<select aria-label="Recurso de la reserva" className={fieldClass} value={selected.resourceId} disabled={booking.frozen || !canBook || !service} onChange={event => booking.setSelection({ ...selected, resourceId: event.target.value, startTimeStr: '' })}><option value="">Cualquiera disponible</option>{business.resources.filter(item => item.active && service?.resourceIds.includes(item.id)).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label className="block text-sm">Día (Colombia)<input aria-label="Día de la reserva" type="date" className={`${fieldClass} min-w-0`} value={selected.dateKey} disabled={booking.frozen || !canBook} onChange={event => booking.setSelection({ ...selected, dateKey: event.target.value, startTimeStr: '' })} /></label>
        <button className={buttonClass} disabled={!canBook || !selected.serviceId || !selected.dateKey || booking.loadingAvailability || searchingNext || booking.frozen || (represented && !name.trim())} onClick={() => void booking.loadAvailability()}>{booking.loadingAvailability ? 'Consultando horarios…' : 'Consultar horarios'}</button>
        {emptyAvailability && <div className="min-w-0 space-y-3">
          {(!booking.nextAvailabilityStatus || booking.nextAvailabilityStatus === 'idle') && <p role="status" className="text-sm text-sarin-muted">No hay horarios disponibles para esta selección. Prueba otro día o profesional.</p>}
          {booking.nextAvailabilityStatus === 'empty' && booking.nextAvailabilityRange && <p role="status" className="text-sm text-sarin-muted">No encontramos horarios del {formatBookingDate(booking.nextAvailabilityRange.fromDateKey)} al {formatBookingDate(booking.nextAvailabilityRange.throughDateKey)}. Elige otro día manualmente o cambia de profesional.</p>}
          <button className={`${buttonClass} max-w-full whitespace-normal text-left`} aria-live="polite" aria-busy={searchingNext} disabled={!canBook || !selected.serviceId || !selected.dateKey || booking.loadingAvailability || searchingNext || booking.frozen || booking.uncertain || (represented && !name.trim())} onClick={() => void booking.findNextAvailability()}>{searchingNext ? 'Buscando próxima fecha…' : 'Buscar próxima fecha disponible'}</button>
        </div>}
        {emptyAvailability && waitlist && <div className="space-y-2">
          {waitlist.request && waitlist.request.status !== 'expired' ? <p className="text-sm text-sarin-muted">Ya tienes una solicitud en este negocio. Consúltala o sal de ella en <a href="#mis-citas" className="text-sarin-blue underline">Mis citas</a>.</p> : <>
            <p className="text-xs text-sarin-muted">Guarda esta búsqueda y consulta aquí si aparecen horarios. El horario se reserva cuando confirmas una cita.</p>
            <button type="button" className={`${buttonClass} max-w-full whitespace-normal text-left`} disabled={!canBook || !selected.serviceId || !selected.dateKey || booking.frozen || searchingNext || waitlist.busy || waitlist.loading || Boolean(waitlist.readError)} onClick={joinWaitlist}>{waitlist.operation === 'join' ? 'Guardando solicitud…' : 'Apuntarme a la lista de espera'}</button>
          </>}
        </div>}
        {booking.nextAvailabilityStatus === 'found' && <p ref={nextAvailabilityResult} role="status" tabIndex={-1} className="rounded-lg text-sm text-sarin-muted focus:outline-2 focus:outline-offset-4 focus:outline-sarin-blue">Hay horarios el {formatBookingDate(selected.dateKey)}. Elige la hora que prefieras.</p>}
        {booking.availability.filter(resource => resource.slots.length > 0).map(resource => <fieldset key={resource.resourceId} className="min-w-0 space-y-2"><legend className="text-sm font-medium">{resource.resourceName}</legend><div className="flex flex-wrap gap-2">{resource.slots.map(slot => <button key={slot} className={`min-h-11 rounded-lg border px-3 text-sm tabular-nums ${selected.resourceId === resource.resourceId && selected.startTimeStr === slot ? 'border-sarin-blue bg-sarin-soft text-sarin-blue' : 'border-sarin-line'}`} aria-pressed={selected.resourceId === resource.resourceId && selected.startTimeStr === slot} onClick={() => booking.setSelection({ ...selected, resourceId: resource.resourceId, startTimeStr: slot })}>{slot}</button>)}</div></fieldset>)}
        {!booking.proposal && <button className={buttonClass} disabled={booking.busy || !canBook || !selected.startTimeStr || !selected.resourceId || (represented && !name.trim())} onClick={() => void booking.propose(beneficiary)}>{booking.busy ? 'Preparando propuesta…' : 'Revisar propuesta'}</button>}
      </div>
    </>}
    {booking.proposal && !booking.appointment && <BookingProposal proposal={booking.proposal} beneficiary={beneficiary} confirming={booking.busy} recovering={booking.uncertain} disabled={!canBook || !subject.active || booking.uncertain} onConfirm={booking.confirm} />}
    <a className="inline-flex min-h-11 items-center text-sm text-sarin-blue underline" href={`tel:+${business.phoneWhatsApp.replace(/\D/g, '')}`}>Contactar directamente al negocio</a>
  </div>;
}
