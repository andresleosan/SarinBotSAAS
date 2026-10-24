"use client";
import { AuthGate, useAuth } from '@/components/auth-provider';
import { AppShell, Notice } from '@/components/app-shell';
import { ResourceScheduleWorkspace } from '@/components/resource-schedule-workspace';
import { useResourceSchedules } from '@/hooks/use-resource-schedules';
import { useBusiness } from '@/hooks/useBusiness';
function Schedule() {
  const { user, authEpoch } = useAuth(), { business, loading, error } = useBusiness();
  const controller = useResourceSchedules({ businessId: business?.id ?? null, ownerUid: user?.uid ?? null, authEpoch, mode: 'edit', enabled: Boolean(business && user && business.ownerUid === user.uid) });
  if (loading) return <Notice>Verificando tu negocio…</Notice>;
  if (!business || business.ownerUid !== user?.uid) return <Notice error>{error || 'No se pudo verificar tu negocio. Abre Mi negocio para revisar tu acceso.'}</Notice>;
  return <ResourceScheduleWorkspace controller={controller} />;
}
export default function SchedulePage() { return <AuthGate><AppShell businessNavigationPath="/dashboard/onboarding"><Schedule /></AppShell></AuthGate>; }
