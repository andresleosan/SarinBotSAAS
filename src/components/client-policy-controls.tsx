"use client";
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { apiFetch, errorMessage } from '@/lib/client/api';
import { buttonClass, fieldClass, Notice } from './app-shell';
type Policy = { blocked: boolean; futureAppointmentLimit: number; reason: string | null; inheritsLimit?: boolean };
type Props = { businessId: string; ownerUid: string; clients: { uid: string; name: string }[] };
export function ClientPolicyControls(props: Props) { return <PolicyPanel key={`${props.ownerUid}:${props.businessId}`} {...props} />; }
function PolicyPanel(props: Props) {
  const [clientUid, setClientUid] = useState('');
  return <details className="rounded-2xl border border-sarin-line bg-sarin-paper p-5">
    <summary className="cursor-pointer font-semibold">Límites y acceso de clientes</summary>
    <p className="my-3 text-sm text-sarin-muted">Se cuentan solo citas futuras activas. Cambiar el límite conserva las reservas existentes y permite seguir consultándolas o cancelándolas.</p>
    <label className="block text-sm">Aplicar a<select className={fieldClass} aria-label="Cliente o política general" value={clientUid} onChange={event => setClientUid(event.target.value)}><option value="">Todos los clientes</option>{props.clients.filter(client => client.uid !== props.ownerUid).map(client => <option key={client.uid} value={client.uid}>{client.name}</option>)}</select></label>
    <PolicyForm key={clientUid} businessId={props.businessId} clientUid={clientUid} />
  </details>;
}
function PolicyForm({ businessId, clientUid }: { businessId: string; clientUid: string }) {
  const [limit, setLimit] = useState('3'), [blocked, setBlocked] = useState(false), [reason, setReason] = useState('');
  const [loading, setLoading] = useState(true), [saving, setSaving] = useState(false), [error, setError] = useState<string | null>(null), [saved, setSaved] = useState(false);
  const [loaded, setLoaded] = useState(false), [attempt, setAttempt] = useState(0);
  const active = useRef(false), request = useRef<AbortController | null>(null);
  const url = `/api/businesses/${encodeURIComponent(businessId)}/client-policy`;
  useEffect(() => {
    active.current = true;
    setLoading(true); setLoaded(false); setError(null);
    const controller = new AbortController();
    apiFetch<{ policy: Policy }>(url + (clientUid ? `?clientUid=${encodeURIComponent(clientUid)}` : ''), { signal: controller.signal }).then(({ policy }) => {
      if (!active.current || controller.signal.aborted) return;
      setLimit(clientUid && policy.inheritsLimit ? '' : String(policy.futureAppointmentLimit)); setBlocked(policy.blocked); setLoading(false); setLoaded(true);
    }).catch(cause => { if (active.current && !controller.signal.aborted) { setError(errorMessage(cause)); setLoading(false); } });
    return () => { active.current = false; controller.abort(); request.current?.abort(); };
  }, [url, clientUid, attempt]);
  async function save(event: FormEvent) {
    event.preventDefault(); if (request.current || loading || !loaded) return;
    const controller = request.current = new AbortController();
    setSaving(true); setError(null); setSaved(false);
    try {
      await apiFetch(url, { method: 'PATCH', signal: controller.signal, body: JSON.stringify({ ...(clientUid ? { clientUid, blocked } : {}), futureAppointmentLimit: limit ? Number(limit) : null, reason }) });
      if (active.current && !controller.signal.aborted) { setSaved(true); setReason(''); }
    } catch (cause) { if (active.current && !controller.signal.aborted) setError(errorMessage(cause)); }
    finally { if (active.current && !controller.signal.aborted) setSaving(false); if (request.current === controller) request.current = null; }
  }
  return <form className="mt-4 space-y-3" onSubmit={save}>
    {error && <Notice error>{error}</Notice>}{!loaded && !loading && <button type="button" className={buttonClass} onClick={() => setAttempt(value => value + 1)}>Reintentar lectura</button>}{saved && <Notice>Política guardada.</Notice>}
    <label className="block text-sm">Máximo de citas futuras<select className={fieldClass} aria-label="Máximo de citas futuras" value={limit} disabled={loading || saving} onChange={event => { setLimit(event.target.value); setSaved(false); }}>{clientUid && <option value="">Heredar política general</option>}{Array.from({ length: 20 }, (_, index) => <option key={index} value={index + 1}>{index + 1}</option>)}</select></label>
    {clientUid && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={blocked} disabled={loading || saving} onChange={event => setBlocked(event.target.checked)} />Pausar nuevas reservas y chat de este cliente</label>}
    <label className="block text-sm">Motivo del cambio<input className={fieldClass} aria-label="Motivo del cambio" value={reason} required maxLength={300} disabled={loading || saving} onChange={event => setReason(event.target.value)} /></label>
    <button className={buttonClass} disabled={!loaded || loading || saving || !reason.trim()}>{saving ? 'Guardando…' : 'Guardar política'}</button>
  </form>;
}
