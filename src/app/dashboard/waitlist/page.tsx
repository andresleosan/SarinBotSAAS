"use client";
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { AuthGate, useAuth } from '@/components/auth-provider';
import { AppShell, Notice } from '@/components/app-shell';
import { OwnerWaitlistWorkspace } from '@/components/owner-waitlist-workspace';
import { useOwnerWaitlist } from '@/hooks/use-owner-waitlist';
import { useBusiness } from '@/hooks/useBusiness';
function Waitlist() {
  const { user, authEpoch } = useAuth(), router = useRouter(), identity = JSON.stringify([user?.uid, authEpoch]);
  const [deniedIdentity, setDeniedIdentity] = useState<string | null>(null);
  const { business, loading, error } = useBusiness({ onAccessDenied: () => setDeniedIdentity(identity) });
  const candidate = Boolean(user && business && business.ownerUid === user.uid && deniedIdentity !== identity);
  const c = useOwnerWaitlist({ businessId: business?.id ?? null, ownerUid: user?.uid ?? null, authEpoch, enabled: candidate, available: !error && !loading });
  if (loading && !business) return <Notice>Verificando tu negocio…</Notice>;
  if (!candidate) return <Notice error>{error || 'No se pudo verificar tu acceso a la espera. Vuelve a Mi agenda para revisar tu cuenta.'}</Notice>;
  return <div className="space-y-4">{error && <Notice error>{error}</Notice>}<OwnerWaitlistWorkspace key={`${user!.uid}:${authEpoch}:${business!.id}`} controller={c} disabled={Boolean(error || loading)} onViewAgenda={() => { if (!c.busy && !c.uncertain) router.push('/dashboard'); }} /></div>;
}
export default function WaitlistPage() { return <AuthGate><AppShell businessNavigationPath="/dashboard"><Waitlist /></AppShell></AuthGate>; }
