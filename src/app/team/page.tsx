"use client";
import { AuthGate, useAuth } from '@/components/auth-provider';
import { TeamWorkspaceShell } from '@/components/team-workspace-shell';
import { TeamWorkspace } from '@/components/team-workspace';
export default function TeamPage() { const { user, authEpoch } = useAuth(); return <AuthGate><TeamWorkspaceShell><TeamWorkspace key={JSON.stringify([user?.uid, authEpoch])} /></TeamWorkspaceShell></AuthGate>; }
