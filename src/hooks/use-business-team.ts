"use client";
import { useOwnerAuthority } from '@/hooks/use-owner-authority';
import { useTeamClient } from '@/hooks/use-team-client';
export function useBusinessTeam(input: { businessId: string; ownerUid: string; authEpoch: number; enabled: boolean }) {
  const authority = useOwnerAuthority(input);
  const { view, loading, busy, error, pending, notice, applied, current, refresh, decide, inspectPending, retryPending } = useTeamClient({ ...input, uid: input.ownerUid, audience: 'owner', requestScope: authority.requestScope });
  return { view, loading, busy, error, pending, notice, applied, current, refresh, decide, inspectPending, retryPending,
    protected: authority.protected, revoked: authority.revoked, checkingAccess: authority.checking, accessError: authority.error, checkAccess: authority.checkAccess };
}
export type BusinessTeamController = ReturnType<typeof useBusinessTeam>;
