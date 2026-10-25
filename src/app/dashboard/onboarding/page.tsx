"use client";

import Link from 'next/link';
import { AuthGate, useAuth } from '@/components/auth-provider';
import { AppShell, Notice, buttonClass } from '@/components/app-shell';
import { BusinessLogoField } from '@/components/business-logo-field';
import { BusinessAssistantScopeNotice } from '@/components/business-assistant-scope-notice';
import { ConfigurationAssistant } from '@/components/configuration-assistant';
import { OwnerConfigurationWorkspace } from '@/components/owner-configuration-workspace';
import { useOwnerConfiguration } from '@/hooks/use-owner-configuration';
import { isSubscriptionAllowed } from '@/lib/sarin/subscription';
import { canPurchasePaidTrial } from '@/lib/paid-trial';
import type { Business } from '@/types/firestore';

function AccessGate({ business }: { business: Business | null }) {
  const trial = canPurchasePaidTrial(business?.subscription);
  return <section className="max-w-2xl space-y-4 rounded-2xl border border-sarin-line bg-sarin-paper p-5 sm:p-6">
    <h1 className="text-3xl font-bold">{trial ? 'Empieza con tu prueba pagada' : 'Elige un plan para continuar'}</h1>
    <p className="text-sm leading-6 text-sarin-muted">{trial ? 'Por $5.000 COP puedes configurar tu negocio y recibir hasta 10 citas, sin caducidad. Después, elige un plan para continuar.' : 'Revisa los planes y el estado de tus pagos para volver a configurar tu negocio y recibir nuevas citas. Tu agenda existente se conserva.'}</p>
    <Notice>{business?.subscription.paidTrial?.source === 'invitation' && business.subscription.paidTrial.accessSuspended ? 'El acceso de cortesía está suspendido. Contacta a administración; tus citas y consumo se conservan.' : business?.subscription.status === 'pending_payment' ? 'La configuración y SarinBot se habilitan después de aprobar tu comprobante o canjear una invitación. Si ya enviaste el comprobante, espera su revisión.' : 'Necesitas acceso vigente para configurar tu negocio y usar SarinBot.'}</Notice>
    <Link href="/dashboard/billing" className={buttonClass + ' inline-flex items-center'}>Ver pagos y planes</Link>
  </section>;
}

function Configuration() {
  const { user } = useAuth();
  const config = useOwnerConfiguration();
  if (config.loading) return <Notice>Cargando configuración…</Notice>;
  if (config.absent) return <AccessGate business={null} />;
  if (!config.business || !config.controller) return <div className="space-y-3"><Notice error>{config.error || 'No pudimos verificar tu acceso al negocio.'}</Notice><button type="button" className={buttonClass} onClick={config.retryAuthority}>Reintentar verificación</button></div>;
  const { business, controller } = config;
  if (!isSubscriptionAllowed(business)) return <AccessGate business={business} />;
  if (!config.policyReady || !config.capability) return <div className="space-y-3"><Notice error={Boolean(config.policyError)}>{config.policyError || 'Comprobando las opciones de configuración…'}</Notice><button type="button" className={buttonClass} onClick={config.retryPolicy}>Reintentar clasificación</button></div>;
  return <div key={`${config.authority.generation}:${user?.uid}:${business.id}`} className="max-w-4xl space-y-5">
    {business.subscription.status === 'trial' && <Notice>{business.subscription.paidTrial?.source === 'invitation' ? 'Tu prueba de cortesía incluye diez citas y 700 respuestas; sin cobro ni caducidad.' : 'Tu prueba pagada incluye la configuración y hasta 10 citas, sin caducidad.'}</Notice>}
    {!config.consentActive && <Notice>Necesitas aceptar las condiciones y autorizar los datos para editar y guardar la configuración.</Notice>}
    <OwnerConfigurationWorkspace
      business={business} capability={config.capability} policyReady={config.policyReady} consentActive={config.consentActive} controller={controller}
      assistantScope={<BusinessAssistantScopeNotice configured={business.sarinConfig.onboardingCompleted} dataMode={config.capability.dataMode} representedMinorsEnabled={config.capability.representedMinorsEnabled} faqHref="/dashboard/faq" />}
      logo={business.sarinConfig.onboardingCompleted ? <BusinessLogoField business={business} onSaved={config.onLogoSaved} /> : null}
      assistant={config.capability.dataMode === 'general' && user ? <ConfigurationAssistant uid={user.uid} business={business} enabled={config.consentActive} draft={controller.session.draft} busy={controller.writeBlocked} onDraft={next => { controller.change(next); controller.go('review'); }} /> : null}
    />
  </div>;
}

export default function OnboardingPage() {
  return <AuthGate><AppShell><Configuration /></AppShell></AuthGate>;
}
