"use client";

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useAuth } from '@/components/auth-provider';
import { Notice, buttonClass, fieldClass } from '@/components/app-shell';
import { apiFetch, errorMessage } from '@/lib/client/api';
import type { InvitationAdminCommand, InvitationCreationResult, InvitationCommandResult, InvitationPage, InvitationSummary } from '@/types/invitations';

export function AdminInvitations({ onAccessChanged }: { onAccessChanged?: () => void | Promise<void> }) {
  const { user, isSuperadmin } = useAuth();
  return user && isSuperadmin ? <Invitations key={user.uid} onAccessChanged={onAccessChanged} /> : null;
}
const date = (value: number) => new Date(value).toLocaleString('es-CO', { timeZone: 'America/Bogota' });
const states = { available: 'Disponible', expired: 'Vencido', revoked: 'Revocado', redeemed: 'Canjeado' };
function Invitations({ onAccessChanged }: { onAccessChanged?: () => void | Promise<void> }) {
  const [page, setPage] = useState<InvitationPage>({ invitations: [], nextCursor: null });
  const [email, setEmail] = useState('');
  const [days, setDays] = useState(7);
  const [requestId, setRequestId] = useState('');
  const [code, setCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [command, setCommand] = useState<InvitationAdminCommand | null>(null);
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    const controller = new AbortController();
    void apiFetch<InvitationPage>('/api/admin/invitations', { signal: controller.signal }).then(value => { if (active.current && !controller.signal.aborted) setPage(value); }).catch(cause => { if (active.current && !controller.signal.aborted) setError(errorMessage(cause)); }).finally(() => { if (active.current && !controller.signal.aborted) setBusy(false); });
    return () => { active.current = false; controller.abort(); };
  }, []);
  function upsert(invitation: InvitationSummary) { setPage(previous => ({ ...previous, invitations: [invitation, ...previous.invitations.filter(item => item.id !== invitation.id)] })); }
  async function load(more = false) {
    if (busy) return;
    setBusy(true); setError(null);
    try {
      const value = await apiFetch<InvitationPage>(`/api/admin/invitations${more && page.nextCursor ? `?after=${page.nextCursor}` : ''}`);
      if (active.current) setPage(previous => more ? { ...value, invitations: [...previous.invitations, ...value.invitations.filter(item => !previous.invitations.some(old => old.id === item.id))] } : value);
    } catch (cause) { if (active.current) setError(errorMessage(cause)); }
    finally { if (active.current) setBusy(false); }
  }
  async function create(event: FormEvent) {
    event.preventDefault();
    if (busy || code || !email.trim()) return;
    setBusy(true); setError(null); setNotice(null);
    const identity = requestId || crypto.randomUUID(); setRequestId(identity);
    try {
      const result = await apiFetch<InvitationCreationResult>('/api/admin/invitations', { method: 'POST', body: JSON.stringify({ recipientEmail: email, expiresInDays: days, requestId: identity }) });
      if (!active.current) return;
      upsert(result.invitation); setCode(result.code);
      setNotice(result.replayed ? 'La invitación ya se emitió. El código no se puede recuperar: revócala y emite otra si lo perdiste.' : 'Copia el código antes de descartarlo. Solo se muestra ahora.');
    } catch (cause) { if (active.current) setError(errorMessage(cause)); }
    finally { if (active.current) setBusy(false); }
  }
  async function execute(event: FormEvent) {
    event.preventDefault();
    if (busy || !command?.reason.trim()) return;
    setBusy(true); setError(null);
    try {
      const result = await apiFetch<InvitationCommandResult>('/api/admin/invitations', { method: 'PATCH', body: JSON.stringify(command) });
      if (!active.current) return;
      upsert(result.invitation); setCommand(null); setNotice('Control de cortesía actualizado. Se conserva el consumo.');
      try { await onAccessChanged?.(); } catch { /* refreshing the parent cannot undo a confirmed command */ }
    } catch (cause) { if (active.current) setError(errorMessage(cause)); }
    finally { if (active.current) setBusy(false); }
  }
  async function copy() {
    if (!code) return;
    try { await navigator.clipboard.writeText(code); if (active.current) setNotice('Código copiado.'); }
    catch { if (active.current) setError('No pudimos copiarlo. Selecciona el código y cópialo manualmente.'); }
  }
  const actionLabel = (action: InvitationAdminCommand['action']) => action === 'revoke_code' ? 'Revocar código' : action === 'suspend_access' ? 'Suspender cortesía' : 'Reactivar cortesía';
  return <section aria-labelledby="invitations-title" className="space-y-4 rounded-2xl border border-sarin-line bg-sarin-paper p-4 sm:p-5">
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 id="invitations-title" className="text-xl font-semibold">Invitaciones de cortesía</h2><button type="button" disabled={busy} onClick={() => void load()} className="min-h-11 text-sm text-sarin-blue">Actualizar invitaciones</button></div>
    <p className="text-sm text-sarin-muted">Regalan diez citas y 700 respuestas; sin cobro ni caducidad después del canje. Cada código pertenece a un correo y permite un solo uso. No se envía automáticamente.</p>
    {error && <Notice error>{error}</Notice>}{notice && <Notice>{notice}</Notice>}
    <form onSubmit={create} className="flex flex-wrap items-end gap-3">
      <label className="min-w-0 flex-1 text-sm font-medium">Correo del invitado<input type="email" required maxLength={254} value={email} disabled={busy || Boolean(code)} onChange={event => { setEmail(event.target.value); setRequestId(crypto.randomUUID()); }} className={`${fieldClass} mt-1`} /></label>
      <label className="text-sm font-medium">Días para canjear<input type="number" min={1} max={30} required value={days} disabled={busy || Boolean(code)} onChange={event => { setDays(Number(event.target.value)); setRequestId(crypto.randomUUID()); }} className={`${fieldClass} mt-1 w-24`} /></label>
      <button className={buttonClass} type="submit" disabled={busy || Boolean(code) || !email.trim()}>Generar código de 6 dígitos</button>
    </form>
    {code && <div className="space-y-2 rounded-xl bg-sarin-soft p-3"><p className="select-all break-all font-mono text-sm">{code}</p><div className="flex flex-wrap gap-4"><button type="button" onClick={() => void copy()} className="min-h-11 font-semibold text-sarin-blue">Copiar código</button><button type="button" onClick={() => { setCode(null); setRequestId(''); setNotice(null); }} className="min-h-11 text-sm text-sarin-muted">Descartar código</button></div></div>}
    {command && <form onSubmit={execute} className="space-y-3 rounded-xl border border-sarin-line p-3"><h3 className="font-semibold">Confirmar: {actionLabel(command.action)}</h3><p className="text-sm text-sarin-muted">{command.action === 'revoke_code' ? 'El código dejará de poder canjearse.' : 'Esto cambia solo el acceso de cortesía. Conserva citas, consumo y planes contratados.'}</p><label className="block text-sm">Motivo<input required maxLength={300} value={command.reason} disabled={busy} onChange={event => setCommand({ ...command, reason: event.target.value, requestId: crypto.randomUUID() })} className={`${fieldClass} mt-1`} /></label><div className="flex flex-wrap gap-4"><button type="submit" disabled={busy || !command.reason.trim()} className={buttonClass}>Confirmar cambio</button><button type="button" disabled={busy} onClick={() => setCommand(null)} className="min-h-11 text-sarin-muted">Cancelar</button></div></form>}
    <div className="overflow-x-auto"><table className="w-full min-w-[720px] text-left text-sm"><thead><tr>{['Invitado / código', 'Canje y negocio', 'Acceso y consumo', 'Control'].map(label => <th key={label} className="p-3">{label}</th>)}</tr></thead><tbody>{page.invitations.map(item => <tr key={item.id} className="border-t border-sarin-line align-top">
      <td className="max-w-64 break-words p-3"><p>{item.recipientEmail}</p><p className="text-xs text-sarin-muted">{item.maskedCode} · {states[item.codeState]}</p><p className="text-xs text-sarin-muted">Vence: {date(item.expiresAt)}</p></td>
      <td className="max-w-64 break-words p-3">{item.redemption ? <><p>{item.redemption.email}</p><p className="text-xs">{item.redemption.businessId}</p><p className="text-xs text-sarin-muted">Activada: {date(item.redemption.at)}</p></> : 'Sin canjear'}</td>
      <td className="p-3">{item.usage ? <><p>{item.access?.state === 'suspended' ? 'Cortesía suspendida' : 'Cortesía activa'}</p><p>{item.usage.appointmentsUsed ?? 'No disponible'} / 10 citas</p><p>{item.usage.responsesUsed ?? 'No disponible'} / 700 respuestas</p></> : 'Sin consumo de cortesía'}</td>
      <td className="p-3">{(item.state === 'issued' ? ['revoke_code'] as const : item.state === 'redeemed' ? [item.access?.state === 'suspended' ? 'reactivate_access' : 'suspend_access'] as const : []).map(action => <button key={action} type="button" disabled={busy} onClick={() => setCommand({ action, invitationId: item.id, expectedVersion: item.version, requestId: crypto.randomUUID(), reason: '' })} className="min-h-11 text-left font-medium text-sarin-blue">{actionLabel(action)}</button>)}</td>
    </tr>)}</tbody></table></div>
    {!busy && page.invitations.length === 0 && <p className="text-sm text-sarin-muted">No hay invitaciones emitidas.</p>}
    {page.nextCursor && <button type="button" disabled={busy} onClick={() => void load(true)} className={buttonClass}>Cargar más invitaciones</button>}
  </section>;
}
