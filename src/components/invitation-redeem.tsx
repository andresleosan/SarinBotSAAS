"use client";

import { useEffect, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useAuth } from '@/components/auth-provider';
import { Notice, buttonClass, fieldClass } from '@/components/app-shell';
import { apiFetch, errorMessage } from '@/lib/client/api';
import type { InvitationRedemptionResult } from '@/types/invitations';
import { useAccountConsent } from './consent-panel';

export function InvitationRedeem(props: { onRedeemed: (result: InvitationRedemptionResult) => void }) {
  const { user } = useAuth();
  return user ? <Redemption key={user.uid} {...props} /> : null;
}
function Redemption({ onRedeemed }: { onRedeemed: (result: InvitationRedemptionResult) => void }) {
  const accountConsent = useAccountConsent();
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState('');
  const [requestId, setRequestId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [redeemed, setRedeemed] = useState(false);
  const active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!accountConsent.active || busy || !code.trim() || redeemed) return;
    setBusy(true); setError(null);
    try {
      const result = await apiFetch<InvitationRedemptionResult>('/api/invitations/redeem', { method: 'POST', body: JSON.stringify({ code, requestId }) });
      if (!active.current) return;
      setRedeemed(true); setCode('');
      onRedeemed(result);
    } catch (cause) { if (active.current) setError(errorMessage(cause)); }
    finally { if (active.current) setBusy(false); }
  }
  return <section className="space-y-3 rounded-2xl border border-sarin-line bg-sarin-paper p-4 sm:p-5">
    <button type="button" className="min-h-11 text-left font-semibold text-sarin-blue" aria-expanded={open} onClick={() => setOpen(!open)}>Tengo un código de invitación</button>
    {redeemed ? <><Notice>Prueba de cortesía: diez citas y 700 respuestas; sin cobro. Sin caducidad después de activarla.</Notice><Link href="/dashboard/onboarding" className="inline-flex min-h-11 items-center font-semibold text-sarin-blue underline">Configurar mi negocio</Link></> : open && <form onSubmit={submit} className="space-y-3">
      <p className="text-sm text-sarin-muted">Canjéalo con la cuenta de Google verificada a la que se asignó. Si tienes un comprobante pendiente, resuélvelo primero con administración.</p>
      <label className="block text-sm font-medium">Código de invitación<input type="text" inputMode="numeric" autoComplete="off" placeholder="000000" spellCheck={false} required maxLength={80} value={code} disabled={!accountConsent.active || busy} onChange={event => { setCode(event.target.value); setRequestId(crypto.randomUUID()); setError(null); }} className={`${fieldClass} mt-1`} /></label>
      <button type="submit" disabled={!accountConsent.active || busy || !code.trim()} className={buttonClass}>{busy ? 'Canjeando…' : 'Canjear invitación'}</button>
    </form>}
    {error && <Notice error>{error}</Notice>}
  </section>;
}
