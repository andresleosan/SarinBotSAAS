"use client";
import { useState } from 'react';
import { AuthGate, useAuth } from '@/components/auth-provider';
import { AppShell, Notice } from '@/components/app-shell';
import { OwnerOperationSummaryPanel } from '@/components/owner-operation-summary';
import { useOwnerOperationSummary } from '@/hooks/use-owner-operation-summary';
import { useBusiness } from '@/hooks/useBusiness';
function Reports() {
  const { user, authEpoch } = useAuth(), identity = JSON.stringify([user?.uid, authEpoch]);
  const [deniedIdentity, setDeniedIdentity] = useState<string | null>(null);
  const { business, loading, error } = useBusiness({ onAccessDenied: () => setDeniedIdentity(identity) });
  const candidate = Boolean(user && business && business.ownerUid === user.uid && deniedIdentity !== identity);
  const c = useOwnerOperationSummary({ scope: business && user ? { businessId: business.id, ownerUid: user.uid, authEpoch } : null, enabled: candidate, available: !error && !loading });
  if (loading && !business) return <Notice>Verificando tu negocio…</Notice>;
  if (!candidate) return <Notice error>{error || 'No se pudo verificar tu acceso al negocio. Vuelve a Mi agenda para revisar tu cuenta.'}</Notice>;
  return <OwnerOperationSummaryPanel key={`${user!.uid}:${authEpoch}:${business!.id}`} {...c} error={error || c.error} disabled={Boolean(error || loading)} onQuery={range => void c.query(range)} onRefresh={() => void c.refresh()} onPreset={preset => void c.queryPreset(preset)} />;
}
export default function ReportsPage() { return <AuthGate><AppShell businessNavigationPath="/dashboard"><Reports /></AppShell></AuthGate>; }
