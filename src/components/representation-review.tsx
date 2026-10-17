"use client";
import { useEffect, useRef, useState } from 'react';
import { useAuth } from './auth-provider';
import { apiFetch, errorMessage } from '@/lib/client/api';
import type { Appointment } from '@/types/firestore';
const labels = { declared: 'Representación declarada', reviewed: 'Revisión realizada por el negocio', needs_contact: 'Pendiente de contactar al reservante' };
function Review({ uid, businessId, appointment, onSaved }: { uid: string; businessId: string; appointment: Appointment; onSaved: (appointment: Appointment) => void }) {
  const generation = useRef(0), pending = useRef(false), [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null), [blocked, setBlocked] = useState(false), [current, setCurrent] = useState(appointment);
  useEffect(() => { setCurrent(appointment); setBlocked(false); }, [appointment]);
  useEffect(() => () => { ++generation.current; }, []);
  function accept(saved: Appointment) {
    if (saved.id !== appointment.id || saved.tenantId !== businessId || saved.client?.uid !== appointment.client?.uid || saved.beneficiary?.kind !== 'represented_minor' || !saved.representationReview || !Object.hasOwn(labels, saved.representationReview.status)) throw new Error('No se pudo comprobar la revisión. Actualiza la agenda.');
    setCurrent(saved); setBlocked(false); onSaved(saved);
  }
  async function perform(status?: 'reviewed' | 'needs_contact') {
    if (pending.current || (status && blocked)) return; pending.current = true; setBusy(true); setError(null); const version = ++generation.current;
    try {
      if (status) { const response = await apiFetch<{ appointment: Appointment }>(`/api/businesses/${encodeURIComponent(businessId)}/appointments/${encodeURIComponent(appointment.id)}/representation-review`, { method: 'PATCH', body: JSON.stringify({ expectedRevision: current.representationReview!.revision, status }) }, uid); if (generation.current === version) accept(response.appointment); }
      else { const response = await apiFetch<{ appointments: Appointment[] }>(`/api/businesses/${encodeURIComponent(businessId)}/appointments?date=${encodeURIComponent(appointment.dateKey)}`, {}, uid), saved = response.appointments.find(item => item.id === appointment.id); if (!saved) throw new Error('La cita no está disponible.'); if (generation.current === version) accept(saved); }
    } catch (cause) { if (generation.current === version) { setError(errorMessage(cause)); setBlocked(true); } }
    finally { if (generation.current === version) setBusy(false); pending.current = false; }
  }
  return <section aria-label="Revisión de representación" className="mt-3 space-y-2 border-t border-sarin-line pt-3 text-sm"><p className="font-medium">{labels[current.representationReview!.status]}</p><p className="text-xs leading-5 text-sarin-muted">La revisión humana no certifica parentesco ni sustituye el consentimiento médico. Contacta al reservante si hay dudas.</p>{error && <p role="alert" className="text-rose-800">{error}</p>}<div className="flex flex-wrap gap-3"><button aria-label="Marcar representación pendiente de contacto" className="min-h-11 text-sarin-blue underline disabled:opacity-50" disabled={busy || blocked} onClick={() => void perform('needs_contact')}>Necesita contacto</button><button className="min-h-11 text-sarin-blue underline disabled:opacity-50" disabled={busy || blocked} onClick={() => void perform('reviewed')}>Registrar revisión realizada</button>{blocked && <button className="min-h-11 text-sarin-blue underline" disabled={busy} onClick={() => void perform()}>Actualizar revisión</button>}</div></section>;
}
export function RepresentationReviewControls(props: { businessId: string; appointment: Appointment; onSaved: (appointment: Appointment) => void }) {
  const { user } = useAuth(); return user && props.appointment.tenantId === props.businessId && props.appointment.beneficiary?.kind === 'represented_minor' && props.appointment.representationReview ? <Review key={`${user.uid}:${props.businessId}:${props.appointment.id}`} uid={user.uid} {...props} /> : null;
}
