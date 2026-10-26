"use client";
import { useTeamClient } from '@/hooks/use-team-client';
export function useTeamWorkspace(input: { uid: string; authEpoch: number; businessId?: string; enabled: boolean }) {
  const { page, agenda, loading, busy, error, pending, notice, applied, current, checkBusiness, loadMemberships, requestAccess, leave, readAgenda, inspectPending, retryPending } = useTeamClient({ ...input, audience: 'member' });
  return { page, agenda, loading, busy, error, pending, notice, applied, current, checkBusiness, loadMemberships, requestAccess, leave, readAgenda, inspectPending, retryPending };
}
export type TeamWorkspaceController = ReturnType<typeof useTeamWorkspace>;
