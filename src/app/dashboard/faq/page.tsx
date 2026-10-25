"use client";
import { AuthGate, useAuth } from '@/components/auth-provider';
import { AppShell, Notice } from '@/components/app-shell';
import { BusinessFactualFaqEditor } from '@/components/business-factual-faq-editor';
import { useOwnerFactualFaq } from '@/hooks/use-owner-factual-faq';
import { useBusiness } from '@/hooks/useBusiness';
function FactualFaq() {
  const { user, authEpoch } = useAuth(), { business, loading, error } = useBusiness();
  const controller = useOwnerFactualFaq({ businessId: business?.id ?? '', ownerUid: user?.uid ?? '', authEpoch, enabled: Boolean(business && user && business.ownerUid === user.uid && !error && !loading) });
  if (loading) return <Notice>Verificando tu negocio…</Notice>;
  if (!business || business.ownerUid !== user?.uid || error) return <Notice error>{error || 'No se pudo verificar tu negocio. Abre Mi negocio para revisar tu acceso.'}</Notice>;
  return <BusinessFactualFaqEditor controller={controller} canEdit={Boolean(controller.view?.eligible)} />;
}
export default function FactualFaqPage() { return <AuthGate><AppShell businessNavigationPath="/dashboard/onboarding"><FactualFaq /></AppShell></AuthGate>; }
