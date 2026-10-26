"use client";
import { useState } from 'react';
import { AuthGate, useAuth } from '@/components/auth-provider';
import { AppShell, Notice } from '@/components/app-shell';
import { BusinessTeamWorkspace } from '@/components/business-team-workspace';
import { useBusiness } from '@/hooks/useBusiness';
function OwnerTeamSession() {
  const { user, authEpoch } = useAuth(), [denied, setDenied] = useState(false);
  const { business, loading, error } = useBusiness({ onAccessDenied: () => setDenied(true) });
  if (denied || business && business.ownerUid !== user?.uid) return <Notice error>No se pudo verificar tu negocio. Vuelve a Mi negocio para revisar tu acceso.</Notice>;
  if (!business) return <Notice error={Boolean(error)}>{error || (loading ? 'Verificando tu negocio…' : 'Abre Mi negocio para configurar tu negocio.')}</Notice>;
  return <>{error && <Notice error>{error}</Notice>}<BusinessTeamWorkspace key={JSON.stringify([user?.uid, authEpoch, business.id])} businessId={business.id} ownerUid={user!.uid} business={business} /></>;
}
function OwnerTeam() { const { user, authEpoch } = useAuth(); return <OwnerTeamSession key={JSON.stringify([user?.uid, authEpoch])} />; }
export default function BusinessTeamPage() { return <AuthGate><AppShell businessNavigationPath="/dashboard/onboarding"><OwnerTeam /></AppShell></AuthGate>; }
