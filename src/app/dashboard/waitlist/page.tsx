"use client";
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { AuthGate, useAuth } from '@/components/auth-provider';
import { AppShell, Notice } from '@/components/app-shell';
import { OwnerWaitlistWorkspace } from '@/components/owner-waitlist-workspace';
import { OwnerWaitlistOfferWorkspace } from '@/components/owner-waitlist-offer-workspace';
import { useOwnerWaitlist } from '@/hooks/use-owner-waitlist';
import { useOwnerWaitlistOffer } from '@/hooks/use-owner-waitlist-offer';
import { useBusiness } from '@/hooks/useBusiness';
function Waitlist() {
  const { user, authEpoch } = useAuth(), router = useRouter(), identity = JSON.stringify([user?.uid, authEpoch]);
  const [deniedIdentity, setDeniedIdentity] = useState<string | null>(null);
  const [tab, setTab] = useState<'requests'|'offers'>('requests');
  const { business, loading, error } = useBusiness({ onAccessDenied: () => setDeniedIdentity(identity) });
  const candidate = Boolean(user && business && business.ownerUid === user.uid && deniedIdentity !== identity);
  const c = useOwnerWaitlist({ businessId: business?.id ?? null, ownerUid: user?.uid ?? null, authEpoch, enabled: candidate, available: !error && !loading });
  const offers = useOwnerWaitlistOffer({ businessId: business?.id ?? null, ownerUid: user?.uid ?? null, authEpoch, enabled: candidate, available: !error && !loading, otherActionPending: c.busy || c.uncertain });
  if (loading && !business) return <Notice>Verificando tu negocio…</Notice>;
  if (!candidate) return <Notice error>{error || 'No se pudo verificar tu acceso a la espera. Vuelve a Mi agenda para revisar tu cuenta.'}</Notice>;
  return <div className="space-y-4">{error && <Notice error>{error}</Notice>}
    <div role="tablist" aria-label="Espera del negocio" className="flex flex-wrap gap-3">
      <button type="button" role="tab" id="waitlist-requests-tab" aria-controls="waitlist-requests-panel" aria-selected={tab === 'requests'} className="min-h-11 rounded-xl border border-sarin-line px-4 py-2 font-semibold" onClick={() => setTab('requests')}>Solicitudes</button>
      <button type="button" role="tab" id="waitlist-offers-tab" aria-controls="waitlist-offers-panel" aria-selected={tab === 'offers'} className="min-h-11 rounded-xl border border-sarin-line px-4 py-2 font-semibold" onClick={() => setTab('offers')}>Ofertas</button>
    </div>
    <div role="tabpanel" id="waitlist-requests-panel" aria-labelledby="waitlist-requests-tab" hidden={tab !== 'requests'}><OwnerWaitlistWorkspace key={`${user!.uid}:${authEpoch}:${business!.id}`} controller={c} offerController={offers} disabled={Boolean(error || loading)} onViewAgenda={() => { if (!c.busy && !c.uncertain && !offers.busy && !offers.uncertain) router.push('/dashboard'); }} /></div>
    <div role="tabpanel" id="waitlist-offers-panel" aria-labelledby="waitlist-offers-tab" hidden={tab !== 'offers'}><OwnerWaitlistOfferWorkspace controller={offers} mode="list" disabled={Boolean(error || loading)} /></div>
  </div>;
}
export default function WaitlistPage() { return <AuthGate><AppShell businessNavigationPath="/dashboard"><Waitlist /></AppShell></AuthGate>; }
