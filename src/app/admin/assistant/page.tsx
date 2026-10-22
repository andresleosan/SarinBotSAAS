"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AuthGate, useAuth } from "@/components/auth-provider";
import { AppShell } from "@/components/app-shell";
import { AdminCopilot } from "@/components/admin-copilot";
import { AdminPaymentConfirmation } from "@/components/admin-payment-confirmation";
import { AdminWhatsAppConversations } from "@/components/admin-whatsapp-conversations";
import { AdminPlatformWhatsApp } from "@/components/admin-platform-whatsapp";
import { PlatformWhatsAppLink } from "@/components/platform-whatsapp-link";
import type { AdminCopilotBusiness, AdminCopilotSource } from "@/types/admin-copilot";

function AssistantWorkspace() {
  const { user } = useAuth();
  const [businesses, setBusinesses] = useState<AdminCopilotBusiness[]>([]);
  const [payments, setPayments] = useState<AdminCopilotSource[]>([]);
  const [proposalId, setProposalId] = useState<string | null>(null);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const values = new URLSearchParams(window.location.search).getAll("paymentAction");
    setProposalId(values.length === 1 ? values[0] : values.length > 1 ? "invalid" : null);
  }, []);
  return <AppShell admin><div className="min-w-0 space-y-6">
    <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div className="min-w-0"><h1 className="text-3xl font-semibold tracking-tight">Tu asistente de administración</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-sarin-muted">Consulta con SarinBot, revisa los pendientes y decide quién atiende cada conversación.</p></div><Link href="/admin" className="inline-flex min-h-11 shrink-0 items-center self-start text-sm font-medium text-sarin-blue underline underline-offset-4">Volver al control de SarinBot</Link></header>
    <AdminCopilot onBusinessesChange={setBusinesses} onPaymentsChange={setPayments} />
    <AdminPaymentConfirmation payments={payments} proposalId={proposalId} />
    <AdminPlatformWhatsApp scope={user?.uid ?? null} />
    <PlatformWhatsAppLink />
    <AdminWhatsAppConversations businesses={businesses} />
  </div></AppShell>;
}

export default function AdminAssistantPage() {
  const { user, authEpoch, isSuperadmin, signingOut } = useAuth();
  return <AuthGate admin><AssistantWorkspace key={JSON.stringify([user?.uid ?? "signed-out", authEpoch, isSuperadmin, signingOut])} /></AuthGate>;
}
