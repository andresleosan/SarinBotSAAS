"use client";

import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@/components/auth-provider';
import { Notice, buttonClass, fieldClass } from '@/components/app-shell';
import { apiFetch, errorMessage } from '@/lib/client/api';
import { useApiPoll } from '@/lib/client/use-api-poll';
import type { PlatformWhatsAppBudgetView } from '@/types/platform-whatsapp-budget';

const endpoint = '/api/admin/platform-whatsapp/budget';
const money = (micros: number) => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 6 }).format(micros / 1e6);
export function AdminPlatformBudget() {
  const auth = useAuth();
  if (!auth.user || !auth.isSuperadmin || auth.signingOut) return null;
  return <BudgetEditor key={JSON.stringify([auth.user.uid, auth.authEpoch])} uid={auth.user.uid} />;
}
function BudgetEditor({ uid }: { uid: string }) {
  const [day, setDay] = useState(''), [month, setMonth] = useState('');
  const [busy, setBusy] = useState(false), [lost, setLost] = useState(false), [conflict, setConflict] = useState(false);
  const [error, setError] = useState<string | null>(null), [notice, setNotice] = useState<string | null>(null);
  const mounted = useRef(false), write = useRef<AbortController | null>(null);
  const poll = useApiPoll<PlatformWhatsAppBudgetView>(uid + ':platform-budget', signal => apiFetch(endpoint, { signal }, uid), { intervalMs: 30000, clearOnError: true, abortOnBlur: true });
  const data = lost ? null : poll.value;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; write.current?.abort(); }; }, []);
  useEffect(() => { if (data) { setDay(String(data.dayUsd)); setMonth(String(data.monthUsd)); setConflict(false); } }, [data?.version]);
  const valid = [day, month].every(value => value.trim() !== '' && Number.isFinite(Number(value)) && Number(value) >= 0 && Number(value) <= 10000 && Math.abs(Number(value) * 1e6 - Math.round(Number(value) * 1e6)) < 1e-6);
  async function save() {
    if (!data || !valid || busy || lost || conflict || write.current) return;
    const controller = new AbortController(); write.current = controller; setBusy(true); setError(null); setNotice(null);
    try {
      const next = await apiFetch<PlatformWhatsAppBudgetView>(endpoint, { method: 'PATCH', signal: controller.signal,
        body: JSON.stringify({ expectedVersion: data.version, dayUsd: Number(day), monthUsd: Number(month) }) }, uid);
      if (!mounted.current || controller.signal.aborted) return;
      poll.setValue(next); setNotice('Presupuesto guardado. Se conserva el consumo y las solicitudes en curso.');
    } catch (failure) {
      if (!mounted.current || controller.signal.aborted) return;
      setError(errorMessage(failure));
      if (failure && typeof failure === 'object' && 'status' in failure) {
        if (failure.status === 401 || failure.status === 403) { setLost(true); poll.setValue(null); setDay(''); setMonth(''); }
        if (failure.status === 409) { setConflict(true); poll.refresh(); }
      }
    } finally { if (write.current === controller) { write.current = null; if (mounted.current) setBusy(false); } }
  }
  return <section aria-labelledby="platform-budget-title" className="min-w-0 space-y-4 rounded-2xl border border-sarin-line bg-sarin-paper p-4 sm:p-6">
    <h2 id="platform-budget-title" className="text-xl font-semibold">Presupuesto del bot de WhatsApp</h2>
    <p className="text-sm text-sarin-muted">Límites en USD para las respuestas de texto de SarinBot y su envío. Día y mes calendario en UTC. Al alcanzar cualquiera se detienen nuevas llamadas. Cero pausa el bot; cambiar límites conserva el consumo.</p>
    {(error || poll.error) && <Notice error>{error || poll.error}</Notice>}
    {notice && <Notice>{notice}</Notice>}
    {lost && <Notice error>Vuelve a iniciar sesión como administrador para consultar el presupuesto.</Notice>}
    {data && <>
      {!data.configured && <Notice>Guarda los límites para configurar el presupuesto. La automatización permanece cerrada hasta completar su activación.</Notice>}
      <div className="grid gap-3 sm:grid-cols-2">{(['day', 'month'] as const).map(period => <div key={period} className="rounded-xl bg-sarin-canvas p-3 text-sm">
        <p className="font-medium">{period === 'day' ? 'Hoy' : 'Este mes'} · {data[period]} UTC</p>
        <p>Consumo confirmado: {money(data.usage[period].usedMicros)}</p><p>Reservado o pendiente de confirmar: {money(data.usage[period].heldMicros)}</p>
        {data.usage[period].blocked && <p>Bloqueado por una diferencia de costo pendiente de revisión.</p>}
      </div>)}</div>
      <form className="space-y-3" onSubmit={event => { event.preventDefault(); void save(); }}>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm font-medium">Límite diario (USD)<input name="dayUsd" type="number" min="0" max="10000" step="0.000001" value={day} disabled={busy || lost} onChange={event => setDay(event.target.value)} className={fieldClass + ' mt-1 w-full'} required /></label>
          <label className="text-sm font-medium">Límite mensual (USD)<input name="monthUsd" type="number" min="0" max="10000" step="0.000001" value={month} disabled={busy || lost} onChange={event => setMonth(event.target.value)} className={fieldClass + ' mt-1 w-full'} required /></label>
        </div>
        <button type="submit" className={buttonClass} disabled={busy || lost || conflict || !valid}>{busy ? 'Guardando…' : 'Guardar presupuesto de WhatsApp'}</button>
      </form>
    </>}
    <button type="button" className="min-h-11 text-sm text-sarin-blue underline" disabled={busy || lost} onClick={() => poll.refresh()}>Actualizar consumo</button>
  </section>;
}
