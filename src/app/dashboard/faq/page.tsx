"use client";
import { useState } from 'react';
import { AuthGate, useAuth } from '@/components/auth-provider';
import { AppShell, Notice } from '@/components/app-shell';
import { BusinessFactualFaqEditor } from '@/components/business-factual-faq-editor';
import { useOwnerFactualFaq } from '@/hooks/use-owner-factual-faq';
import { useBusiness } from '@/hooks/useBusiness';
function FactualFaq() {
  const { user, authEpoch } = useAuth(), identity = JSON.stringify([user?.uid, authEpoch]);
  const [deniedIdentity, setDeniedIdentity] = useState<string | null>(null);
  const { business, loading, error } = useBusiness({ onAccessDenied: () => setDeniedIdentity(identity) });
  const denied = deniedIdentity === identity;
  const controller = useOwnerFactualFaq({ businessId: business?.id ?? '', ownerUid: user?.uid ?? '', authEpoch, enabled: Boolean(!denied && business && user && business.ownerUid === user.uid), available: !error && !loading });
  if (loading) return <Notice>Verificando tu negocio…</Notice>;
  if (denied || !business || business.ownerUid !== user?.uid || error) return <Notice error>{error || 'No se pudo verificar tu negocio. Abre Mi negocio para revisar tu acceso.'}</Notice>;
  return <BusinessFactualFaqEditor controller={controller} canEdit={Boolean(controller.view?.eligible)} />;
}
export default function FactualFaqPage() { return <AuthGate><AppShell businessNavigationPath="/dashboard/onboarding"><FactualFaq /></AppShell></AuthGate>; }
