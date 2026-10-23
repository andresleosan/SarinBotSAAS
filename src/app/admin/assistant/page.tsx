"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AuthGate, useAuth } from "@/components/auth-provider";
import { AppShell } from "@/components/app-shell";
import { AdminPlatformSupport } from "@/components/admin-platform-support";
import { AdminCopilot } from "@/components/admin-copilot";
import { AdminPaymentConfirmation } from "@/components/admin-payment-confirmation";
import { AdminWhatsAppConversations } from "@/components/admin-whatsapp-conversations";
import { AdminPlatformWhatsApp } from "@/components/admin-platform-whatsapp";
import { PlatformWhatsAppLink } from "@/components/platform-whatsapp-link";
import { AdminNavigationBoundary } from "@/components/admin-navigation-boundary";
import { AdminModulePanel } from "@/components/admin-module-panel";
import { getAdminSectionItems, type AdminLocation } from "@/lib/admin-navigation";
import type { AdminCopilotBusiness, AdminCopilotSource } from "@/types/admin-copilot";

function AssistantWorkspace({ location }: { location: AdminLocation }) {
  const { user } = useAuth();
  const [businesses, setBusinesses] = useState<AdminCopilotBusiness[]>([]);
  const [payments, setPayments] = useState<AdminCopilotSource[]>([]);
  // Only entry to this authority-scoped workspace may initialize sensitive children.
  const entry = useRef(location);
  const navigated = useRef(false);
  const sensitiveNotice = useRef<HTMLDivElement>(null);
  const recoveryNotice = useRef<HTMLDivElement>(null);
  const supportHeading = useRef<HTMLDivElement>(null);
  const laterTarget = Boolean((location.proposalId || location.supportThread) && (navigated.current || location.key !== entry.current.key));
  const targetHref = location.proposalId
    ? `/admin/assistant?paymentAction=${encodeURIComponent(location.proposalId)}`
    : location.supportThread ? `/admin/assistant?support=${encodeURIComponent(location.supportThread)}` : null;
  useEffect(() => {
    if (location.key !== entry.current.key) navigated.current = true;
    if (location.error) recoveryNotice.current?.focus();
    else if (laterTarget) sensitiveNotice.current?.focus();
    else if (location.targetId === "soporte-web" && !location.supportThread) {
      supportHeading.current?.querySelector<HTMLHeadingElement>("h2")?.focus();
    }
  }, [location.key, location.error, location.targetId, location.supportThread, laterTarget]);
  return <AppShell admin adminLocation={location}><div className="min-w-0 space-y-6">
    <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div className="min-w-0"><h1 className="text-3xl font-semibold tracking-tight">Tu asistente de administración</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-sarin-muted">Consulta con SarinBot, revisa los pendientes y decide quién atiende cada conversación.</p></div><Link href="/admin" className="inline-flex min-h-11 shrink-0 items-center self-start text-sm font-medium text-sarin-blue underline underline-offset-4">Volver al control de SarinBot</Link></header>
    <nav aria-label="Tareas del asistente y atención" className="flex flex-wrap gap-2">
      {getAdminSectionItems("attention").map(item => <Link key={item.id} href={item.href} scroll={false} aria-current={location.section === item.id ? "page" : undefined} className={`inline-flex min-h-11 items-center rounded-[10px] px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sarin-blue ${location.section === item.id ? "bg-sarin-soft font-semibold text-sarin-blue" : "text-sarin-muted underline"}`}>{item.label}</Link>)}
    </nav>
    {location.error && <div ref={recoveryNotice} role="alert" tabIndex={-1} className="rounded-xl border border-sarin-line p-4 text-sm leading-6"><p>{location.error}</p><Link href="/admin/assistant?section=query" scroll={false} className="inline-flex min-h-11 items-center text-sarin-blue underline">Ir a Consulta</Link></div>}
    {laterTarget && targetHref && <div ref={sensitiveNotice} id="assistant-sensitive-notice" role="status" tabIndex={-1} className="rounded-xl border border-sarin-line p-4 text-sm leading-6"><p>Se conserva la tarea que tienes abierta. Abre este enlace en otra pestaña para revisar el destino sin descartarla</p><a href={targetHref} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center text-sarin-blue underline">Abrir destino en otra pestaña</a></div>}
    <AdminModulePanel id="assistant-query" active={location.section === "query"} title="Consulta" description="Consulta los registros de los negocios con SarinBot sin modificar cuentas ni pagos.">
      <AdminCopilot onBusinessesChange={setBusinesses} onPaymentsChange={setPayments} />
    </AdminModulePanel>
    <AdminModulePanel id="assistant-payments" active={location.section === "payments"} title="Revisión de pagos" description="Revisa una propuesta y confirma la decisión solo mediante su acción explícita.">
      <AdminPaymentConfirmation payments={payments} proposalId={entry.current.proposalId} />
    </AdminModulePanel>
    <AdminModulePanel id="assistant-platform-whatsapp" active={location.section === "platform-whatsapp"} title="WhatsApp de Sarin" description="Administra las conversaciones y el vínculo del canal de plataforma.">
      <p className="mb-4 rounded-xl bg-sarin-soft p-3 text-sm text-sarin-blue">Ámbito: plataforma Sarin.</p>
      <AdminPlatformWhatsApp scope={user?.uid ?? null} />
      <PlatformWhatsAppLink />
    </AdminModulePanel>
    <AdminModulePanel id="assistant-business-whatsapp" active={location.section === "business-whatsapp"} title="Conversaciones de negocios" description="Consulta y atiende conversaciones de los negocios consultados.">
      <p className="mb-4 rounded-xl bg-sarin-soft p-3 text-sm text-sarin-blue">Ámbito: negocios.</p>
      <AdminWhatsAppConversations businesses={businesses} />
    </AdminModulePanel>
    <div ref={supportHeading}>
      <AdminModulePanel id="assistant-web-support" active={location.section === "web-support"} title="Soporte web" description="Abre explícitamente el soporte privado de plataforma o continúa la consulta actual.">
        <AdminPlatformSupport initialThread={entry.current.supportThread} />
      </AdminModulePanel>
    </div>
  </div></AppShell>;
}

export default function AdminAssistantPage() {
  const { user, authEpoch, isSuperadmin, signingOut } = useAuth();
  return <AuthGate admin>{user && isSuperadmin && !signingOut && <AdminNavigationBoundary>{({ location }) => <AssistantWorkspace key={JSON.stringify([user.uid, authEpoch, isSuperadmin, signingOut])} location={location} />}</AdminNavigationBoundary>}</AuthGate>;
}
