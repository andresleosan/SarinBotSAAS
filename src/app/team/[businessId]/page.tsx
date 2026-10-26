"use client";
import { use } from 'react';
import { AuthGate, useAuth } from '@/components/auth-provider';
import { TeamWorkspaceShell } from '@/components/team-workspace-shell';
import { TeamWorkspace } from '@/components/team-workspace';
export default function AssignedTeamPage({ params }: { params: Promise<{ businessId: string }> }) { const { businessId } = use(params), { user, authEpoch } = useAuth(); return <AuthGate><TeamWorkspaceShell><TeamWorkspace key={JSON.stringify([user?.uid, authEpoch, businessId])} businessId={businessId} /></TeamWorkspaceShell></AuthGate>; }
