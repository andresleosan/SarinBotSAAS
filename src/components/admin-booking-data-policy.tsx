"use client";
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useAuth } from './auth-provider';
import { apiFetch, errorMessage } from '@/lib/client/api';
import type { BookingCapability, BookingDataPolicy } from '@/lib/booking-subject';
import { Notice, buttonClass, fieldClass } from './app-shell';
type PolicyView = { policy: BookingDataPolicy | null; capability: BookingCapability };
function Classification({ uid, businessId }: { uid: string; businessId: string }) {
  const version = useRef(0), pending = useRef(false), [view, setView] = useState<PolicyView | null>(null), [ready, setReady] = useState(false), [busy, setBusy] = useState(false), [attempt, setAttempt] = useState(0), [mode, setMode] = useState<'general' | 'health'>('general'), [minors, setMinors] = useState(false), [reason, setReason] = useState(''), [error, setError] = useState<string | null>(null), [saved, setSaved] = useState(false);
  function accept(value: PolicyView) {
    if (!value?.capability || !Number.isSafeInteger(value.capability.revision) || !['general', 'health'].includes(value.capability.dataMode) || typeof value.capability.representedMinorsEnabled !== 'boolean') throw new Error('No se pudo validar la clasificación.');
    setView(value); setMode(value.capability.dataMode); setMinors(value.capability.representedMinorsEnabled); setReason(''); setReady(true);
  }
  useEffect(() => {
    const abort = new AbortController(), generation = ++version.current; setReady(false); setError(null);
    apiFetch<PolicyView>(`/api/admin/booking-data-policy?businessId=${encodeURIComponent(businessId)}`, { signal: abort.signal }, uid).then(value => { if (!abort.signal.aborted && version.current === generation) accept(value); }).catch(cause => { if (!abort.signal.aborted && version.current === generation) setError(errorMessage(cause)); });
    return () => { abort.abort(); ++version.current; };
  }, [uid, businessId, attempt]);
  async function save(event: FormEvent) {
    event.preventDefault(); if (!ready || pending.current || !view || !reason.trim()) return;
    pending.current = true; setBusy(true); setReady(false); setError(null); setSaved(false); const generation = ++version.current;
    try {
      const result = await apiFetch<PolicyView>('/api/admin/booking-data-policy', { method: 'PATCH', body: JSON.stringify({ businessId, expectedRevision: view.capability.revision, dataMode: mode, representedMinorsEnabled: minors, reason: reason.trim() }) }, uid);
      if (version.current === generation) { accept(result); setSaved(true); }
    } catch (cause) { if (version.current === generation) setError(`${errorMessage(cause)} Actualiza antes de volver a guardar; el cambio podría haberse aplicado.`); }
    finally { if (version.current === generation) setBusy(false); pending.current = false; }
  }
  return <div className="space-y-4">
    <button className="min-h-11 text-sm text-sarin-blue underline" disabled={busy} onClick={() => setAttempt(value => value + 1)}>Actualizar clasificación</button>
    {error && <Notice error>{error}</Notice>}{saved && <Notice>Clasificación guardada.</Notice>}
    {!view && !error && <p role="status" className="text-sm">Consultando clasificación…</p>}
    {view && <form aria-label="Clasificación del negocio" onSubmit={save} className="space-y-4">
      <p className="text-sm text-sarin-muted">{view.capability.configured ? `Clasificación revisada · versión ${view.capability.revision}` : 'Negocio todavía sin clasificación revisada. Las capacidades de salud y menores no están habilitadas.'}</p>
      <label className="block text-sm">Clase de reservas<select aria-label="Clase de reservas" className={fieldClass} disabled={!ready || busy} value={mode} onChange={event => setMode(event.target.value as typeof mode)}><option value="general">Servicios generales</option><option value="health">Salud · formulario sin IA</option></select></label>
      <label className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" checked={minors} disabled={!ready || busy} onChange={event => setMinors(event.target.checked)} className="h-5 w-5 accent-sarin-blue" />Permitir reservas para menores por su representante</label>
      <p className="text-sm leading-6 text-sarin-muted">Antes de habilitar salud o menores, retira las preguntas libres y revisa con el negocio su identificación, autorizaciones y procedimiento de representación. Una declaración no certifica parentesco. En salud se detiene el chat y se conserva la configuración manual.</p>
      <label className="block text-sm">Motivo de la clasificación<input aria-label="Motivo de la clasificación" className={fieldClass} value={reason} maxLength={300} required disabled={!ready || busy} onChange={event => setReason(event.target.value)} /></label>
      <button className={buttonClass} disabled={!ready || busy || !reason.trim()}>Guardar clasificación</button>
      {view.policy && <p className="text-xs text-sarin-muted">Último motivo: {view.policy.reason}</p>}
    </form>}
  </div>;
}
function BusinessSelector({ uid, businesses }: { uid: string; businesses: { id: string; name: string }[] }) {
  const [chosen, setChosen] = useState(businesses[0]?.id ?? ''), businessId = businesses.some(item => item.id === chosen) ? chosen : businesses[0]?.id ?? '';
  return <section aria-labelledby="booking-classification-title" className="min-w-0 space-y-4 rounded-2xl border border-sarin-line bg-sarin-paper p-4 sm:p-5 [overflow-wrap:anywhere]"><h2 id="booking-classification-title" className="text-lg font-semibold">Salud y reservas para menores</h2><label className="block text-sm">Negocio<select aria-label="Negocio de la clasificación" className={fieldClass} value={businessId} onChange={event => setChosen(event.target.value)}>{businesses.map(item => <option key={item.id} value={item.id}>{item.name || item.id}</option>)}</select></label>{businessId ? <Classification key={businessId} uid={uid} businessId={businessId} /> : <p className="text-sm">No hay negocios para clasificar.</p>}</section>;
}
export function AdminBookingDataPolicy({ businesses }: { businesses: { id: string; name: string }[] }) {
  const { user, isSuperadmin } = useAuth(); return user && isSuperadmin ? <BusinessSelector key={user.uid} uid={user.uid} businesses={businesses} /> : null;
}
