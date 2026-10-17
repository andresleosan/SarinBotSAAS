"use client";
import { use, useEffect, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { Send } from 'lucide-react';
import { SarinMark } from '@/components/sarin-brand';
import { AuthGate, useAuth } from '@/components/auth-provider';
import { ConsentPanel, useAccountConsent } from '@/components/consent-panel';
import { useConsent } from '@/hooks/useConsent';
import { useBookingDataPolicy } from '@/hooks/useBookingDataPolicy';
import { StructuredBooking } from '@/components/structured-booking';
import { Notice, buttonClass, fieldClass } from '@/components/app-shell';
import { ClientAppointments } from '@/components/client-appointments';
import { BookingProposal } from '@/components/booking-proposal';
import { useDebouncedChat } from '@/hooks/useDebouncedChat';
import { useEngineHealth } from '@/hooks/useEngineHealth';
import { useApiPoll } from '@/lib/client/use-api-poll';
import { getBusinessAccess, isSubscriptionAllowed } from '@/lib/sarin/subscription';
import type { PublicBusiness, PublicBusinessProfile } from '@/types/firestore';
import { BusinessPublicProfile } from '@/components/business-public-profile';
import type { BookingCapability } from '@/lib/booking-subject';
import { businessSocialLabel, businessSocialPlatformLabels } from '@/lib/business-branding';

function GeneralBookingChat({ business, uid, permitted, now, onConfirmed, onLockedChange }: { business: PublicBusiness; uid: string; permitted: boolean; now: number; onConfirmed: () => void; onLockedChange: (locked: boolean) => void }) {
  const [input, setInput] = useState(''), end = useRef<HTMLDivElement>(null), engine = useEngineHealth();
  const chat = useDebouncedChat({ mode: 'sarin_client', tenantId: business.id, actorUid: uid, enabled: permitted, onToolExecuted: name => { if (name === 'cita_confirmada') onConfirmed(); } });
  const locked = chat.isWaitingBatch || chat.isGenerating || chat.confirming || chat.confirmationUncertain;
  useEffect(() => { onLockedChange(locked); return () => onLockedChange(false); }, [locked, onLockedChange]);
  useEffect(() => { void end.current?.scrollIntoView({ behavior: 'auto', block: 'nearest' }); }, [chat.messages, chat.isGenerating]);
  const allowed = isSubscriptionAllowed(business, now), available = allowed && !chat.quotaExhausted, canSend = permitted && available && !chat.confirming && !chat.confirmationUncertain;
  function submit(event: FormEvent) { event.preventDefault(); if (!canSend || !input.trim()) return; chat.sendMessage(input); setInput(''); }
  return <section aria-label="Asistente de reservas" className="space-y-4">
    {!available && <Notice>La atención de IA está temporalmente en pausa. Puedes consultar y cancelar tus citas o contactar directamente al establecimiento.</Notice>}
    {engine.health?.status === 'offline' && <Notice>Sarin no puede responder en este momento. <button className="min-h-11 text-sarin-blue underline" disabled={engine.checking} onClick={() => void engine.refresh()}>Comprobar conexión</button></Notice>}
    <p className="text-sm">Soy Sarin, el asistente de {business.name}. Cuéntame qué servicio necesitas y cuándo te gustaría venir.</p>
    <div aria-live="polite" className="space-y-4">
      {chat.messages.map(message => <div key={message.id} className={`whitespace-pre-wrap break-words rounded-2xl p-4 text-sm leading-relaxed ${message.role === 'user' ? 'ml-8 bg-sarin-blue text-white' : 'mr-5 border border-sarin-line bg-sarin-canvas text-sarin-ink'}`}>{message.content}</div>)}
      {(chat.isWaitingBatch || chat.isGenerating) && <p role="status" className="text-xs text-sarin-blue">{chat.isGenerating ? 'Sarin está revisando tu solicitud…' : 'Preparando tu mensaje…'}</p>}
      {chat.error && <div className="space-y-3">{!chat.quotaExhausted && <Notice error={!chat.requestAlreadyCompleted}>{chat.error}</Notice>}{!chat.requestAlreadyCompleted && !chat.confirmationUncertain && <button className="min-h-11 text-sm text-sarin-blue underline" onClick={chat.retry} disabled={chat.isGenerating || !permitted || !(allowed || getBusinessAccess(business, now) === 'trial_exhausted')}>{chat.quotaExhausted ? 'Comprobar disponibilidad' : 'Reintentar mensaje'}</button>}</div>}
      {chat.confirmationUncertain && !chat.confirming && <Notice>Falta comprobar tu cita. Recupera la confirmación con los datos que enviaste antes de cambiar de recorrido.</Notice>}
      {(permitted || chat.confirmationUncertain) && chat.proposal && <BookingProposal proposal={chat.proposal} confirming={chat.confirming || chat.isGenerating || chat.isWaitingBatch} recovering={chat.confirmationUncertain && !chat.confirming} onConfirm={chat.confirmProposal} />}
      <div ref={end} />
    </div>
    <form onSubmit={submit} className="sticky bottom-0 flex min-w-0 gap-2 border-t border-sarin-line bg-sarin-canvas py-3">
      <input aria-label="Mensaje para Sarin" className={`${fieldClass} min-w-0`} placeholder={canSend ? '¿Qué te gustaría reservar?' : 'Atención de IA temporalmente pausada'} disabled={!canSend} value={input} maxLength={8000} onChange={event => setInput(event.target.value)} />
      <button className={buttonClass} aria-label="Enviar mensaje" disabled={!canSend || !input.trim() || (Boolean(chat.error) && !chat.requestAlreadyCompleted)}><Send className="h-4 w-4" /></button>
    </form>
  </section>;
}
function BookingJourney({ business, capability, uid, permitted, policyReady, now, onConfirmed, initialServiceId, onInitialServiceHandled }: { business: PublicBusiness; capability: BookingCapability; uid: string; permitted: boolean; policyReady: boolean; now: number; onConfirmed: () => void; initialServiceId?: string; onInitialServiceHandled?: () => void }) {
  const [represented, setRepresented] = useState(false), [locked, setLocked] = useState(false), [mode, setMode] = useState<'calendar' | 'chat'>('calendar'), structuredStarted = useRef(capability.dataMode === 'health');
  const keepChat = mode === 'chat' && locked;
  const structured = !keepChat && (capability.dataMode === 'health' || represented || mode === 'calendar');
  if (capability.dataMode === 'health' || represented || (structured && permitted && policyReady)) structuredStarted.current = true;
  useEffect(() => { if (!locked && (capability.dataMode === 'health' || represented)) setMode('calendar'); }, [capability.dataMode, represented, locked]);
  const enabled = permitted && policyReady && (!represented || capability.representedMinorsEnabled), switchLocked = locked || !policyReady || !permitted;
  function selectMode(next: 'calendar' | 'chat') { if (!switchLocked && capability.dataMode === 'general' && !represented) setMode(next); }
  return <div className="space-y-5">
    {capability.dataMode === 'general' && capability.representedMinorsEnabled && <fieldset className="flex flex-wrap gap-2"><legend className="mb-2 text-sm font-medium">¿Para quién reservas?</legend><button className="min-h-11 rounded-lg border border-sarin-line px-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sarin-blue" aria-pressed={!represented} disabled={switchLocked} onClick={() => { if (!switchLocked) { setMode('calendar'); setRepresented(false); } }}>Para mí</button><button className="min-h-11 rounded-lg border border-sarin-line px-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sarin-blue" aria-pressed={represented} disabled={switchLocked} onClick={() => { if (!switchLocked) setRepresented(true); }}>Para un menor a quien represento</button></fieldset>}
    {capability.dataMode === 'general' && !represented && <fieldset className="flex flex-wrap gap-2"><legend className="mb-2 text-sm font-medium">¿Cómo prefieres reservar?</legend>{([['calendar', 'Reservar con calendario'], ['chat', 'Hablar con Sarin']] as const).map(([value, label]) => <button key={value} type="button" aria-pressed={mode === value} disabled={switchLocked} onClick={() => selectMode(value)} className={`min-h-11 max-w-full rounded-lg border px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sarin-blue disabled:opacity-50 ${mode === value ? 'border-sarin-blue bg-sarin-soft text-sarin-blue' : 'border-sarin-line'}`}>{label}</button>)}</fieldset>}
    {!enabled && <Notice>Revisa los permisos y las opciones del negocio antes de comenzar una nueva reserva. Puedes recuperar una confirmación pendiente y consultar Mis citas.</Notice>}
    {structured ? (structuredStarted.current && <StructuredBooking business={business} capability={capability} initialSubjectKind={represented ? 'represented_minor' : 'self'} initialServiceId={initialServiceId} onInitialServiceHandled={onInitialServiceHandled} enabled={enabled} onConfirmed={onConfirmed} onLockedChange={setLocked} />) : <GeneralBookingChat business={business} uid={uid} permitted={enabled && capability.dataMode === 'general' && !represented} now={now} onConfirmed={onConfirmed} onLockedChange={setLocked} />}
  </div>;
}
function Island({ slug, initialServiceId, onInitialServiceHandled }: { slug: string; initialServiceId?: string; onInitialServiceHandled?: () => void }) {
  const { user, signOut } = useAuth();
  const projection = useApiPoll<PublicBusiness | null>(slug, async signal => { const response = await fetch(`/api/public/businesses/${encodeURIComponent(slug)}`, { signal, cache: 'no-store' }); if (!response.ok) throw new Error('No pudimos consultar el negocio. Inténtalo de nuevo.'); return (await response.json() as { business: PublicBusiness | null }).business; });
  const business = projection.value, account = useAccountConsent(), businessConsent = useConsent(user?.uid, 'business_client', business ?? undefined), policy = useBookingDataPolicy(user?.uid, business?.id);
  const intentBusinessId = useRef<string | null>(null);
  if (business && initialServiceId !== undefined && intentBusinessId.current === null) intentBusinessId.current = business.id;
  const scopedServiceId = business?.id === intentBusinessId.current ? initialServiceId : undefined;
  useEffect(() => { if (business && initialServiceId !== undefined && intentBusinessId.current !== business.id) onInitialServiceHandled?.(); }, [business, initialServiceId, onInitialServiceHandled]);
  const [version, setVersion] = useState(0), [now, setNow] = useState(Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 15000); return () => clearInterval(timer); }, []);
  if (projection.loading) return <div className="mx-auto max-w-lg p-6"><Notice>Cargando negocio…</Notice></div>;
  if (!business) return <div className="mx-auto max-w-lg space-y-4 p-6"><Notice error>{projection.error || 'No encontramos este negocio. Revisa el enlace o escanea nuevamente su QR.'}</Notice><Link href="/" className="text-sarin-blue underline">Volver al inicio</Link></div>;
  return <main className="mx-auto flex min-h-dvh max-w-2xl flex-col border-x border-sarin-line bg-sarin-canvas">
    <header className="sticky top-0 z-20 border-b border-sarin-line bg-sarin-paper/95 p-4 backdrop-blur"><div className="flex items-center justify-between gap-3"><div className="flex min-w-0 items-center gap-3">{business.logo ? <img src={`/api/public/businesses/${business.slug}/logo/${business.logo.sha256}`} alt={`Logo de ${business.name}`} width={44} height={44} className="h-11 w-11 shrink-0 rounded-lg object-contain" /> : <SarinMark className="h-11 w-11 shrink-0" />}<div className="min-w-0"><h1 className="line-clamp-2 break-words font-bold leading-5 [overflow-wrap:anywhere]">{business.name}</h1><p className="mt-1 text-xs text-sarin-muted">Agenda y citas · Colombia</p></div></div><button className="min-h-11 max-w-28 shrink-0 truncate rounded-[10px] border border-sarin-line px-3 py-2 text-xs text-sarin-muted hover:bg-sarin-soft" onClick={() => void signOut()} title="Cerrar sesión">{user?.displayName?.split(' ')[0] || 'Salir'} · Salir</button></div><nav aria-label="Citas del cliente" className="mt-1 flex"><a href="#mis-citas" className="inline-flex min-h-11 items-center px-2 text-xs font-semibold text-sarin-blue">Mis citas</a></nav></header>
    <div className="space-y-5 p-4 sm:p-6">
      <ConsentPanel controller={account} title="Permisos de mi cuenta" />
      <ConsentPanel controller={businessConsent} title={`Chat y reservas con ${business.name}`} blockedReason={!account.active ? 'Primero revisa los permisos de tu cuenta. Tus citas existentes siguen disponibles abajo.' : undefined} />
      <nav aria-label="Contacto del negocio" className="flex flex-wrap gap-x-4 text-sm text-sarin-blue">{business.phoneWhatsApp && <a href={`tel:+${business.phoneWhatsApp.replace(/\D/g, '')}`} className="inline-flex min-h-11 items-center underline">+{business.phoneWhatsApp.replace(/^\+/, '')}</a>}{(business.socialLinks ?? []).map(link => <a key={link.platform} href={link.url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 max-w-full items-center break-all underline">{businessSocialPlatformLabels[link.platform]} · {businessSocialLabel(link)}</a>)}</nav>
      {projection.error && <Notice error>{projection.error}</Notice>}
      <section aria-label="Servicios del negocio" className="rounded-2xl border border-sarin-line bg-sarin-paper p-5"><h2 className="font-semibold">Servicios de {business.name}</h2><div className="mt-3 flex flex-wrap gap-2">{business.services.map(service => <span key={service.id} className="min-w-0 max-w-full break-words rounded-lg border border-sarin-line px-3 py-2 text-xs [overflow-wrap:anywhere]">{service.name} · {service.price.toLocaleString('es-CO')} COP</span>)}</div><nav className="mt-3 flex flex-wrap gap-x-5 text-xs text-sarin-blue" aria-label="Información del servicio"><Link href="/privacidad" className="inline-flex min-h-11 items-center underline">Privacidad</Link><Link href="/ayuda" className="inline-flex min-h-11 items-center underline">Ayuda</Link></nav></section>
      {!policy.ready && <div><Notice error={Boolean(policy.error)}>{policy.error || 'Comprobando las opciones de reserva…'}</Notice>{policy.error && <button className={buttonClass} onClick={policy.refresh}>Reintentar opciones de reserva</button>}</div>}
      {user && policy.capability && <BookingJourney key={`${user.uid}:${business.id}`} business={business} capability={policy.capability} uid={user.uid} permitted={account.active && businessConsent.active} policyReady={policy.ready} now={now} initialServiceId={scopedServiceId} onInitialServiceHandled={onInitialServiceHandled} onConfirmed={() => setVersion(value => value + 1)} />}
      {user && <ClientAppointments key={`${business.id}:${user.uid}:${version}`} businessId={business.id} businessName={business.name} resources={business.resources} userId={user.uid} now={now} />}
    </div>
  </main>;
}
function AnonymousProfile({ slug, onContinue }: { slug: string; onContinue: (serviceId?: string) => void }) {
  const projection = useApiPoll<PublicBusinessProfile | null>(slug, async signal => {
    const response = await fetch(`/api/public/businesses/${encodeURIComponent(slug)}?view=profile`, { signal, cache: 'no-store' });
    if (!response.ok) throw new Error('No pudimos consultar el negocio. Inténtalo de nuevo.');
    return (await response.json() as { business: PublicBusinessProfile | null }).business;
  });
  if (projection.loading) return <main className="mx-auto max-w-2xl p-6"><Notice>Cargando negocio…</Notice></main>;
  if (!projection.value) return <main className="mx-auto max-w-2xl space-y-4 p-6"><Notice error>{projection.error || 'No encontramos este negocio. Revisa el enlace o escanea nuevamente su QR.'}</Notice>{projection.error && <button className={buttonClass} onClick={projection.refresh}>Reintentar</button>}<Link href="/" className="inline-flex min-h-11 items-center text-sarin-blue underline">Volver al inicio</Link></main>;
  return <><BusinessPublicProfile profile={projection.value} onContinue={onContinue} />{projection.error && <div className="mx-auto max-w-2xl p-6"><Notice error>{projection.error}</Notice><button className={buttonClass} onClick={projection.refresh}>Actualizar negocio</button></div>}</>;
}

function BusinessEntry({ slug }: { slug: string }) {
  const { user } = useAuth();
  const uid = user?.uid ?? null;
  const [stored, setEntry] = useState<{ uid: string | null; requested: boolean; serviceId?: string }>({ uid, requested: false });
  // Only the first sign-in may claim an anonymous choice; mask it before rendering another account.
  const entry = stored.uid === uid ? stored : { uid, requested: false, serviceId: stored.uid === null && uid !== null && stored.requested ? stored.serviceId : undefined };
  if (entry !== stored) setEntry(entry);
  const handled = () => setEntry(previous => previous.uid === uid && previous.serviceId !== undefined ? { ...previous, serviceId: undefined } : previous);
  if (user) return <AuthGate><Island slug={slug} initialServiceId={entry.serviceId} onInitialServiceHandled={handled} /></AuthGate>;
  if (entry.requested) return <><div className="mx-auto max-w-2xl px-5 pt-4"><button className="min-h-11 text-sm text-sarin-blue underline focus-visible:outline-2 focus-visible:outline-offset-4" onClick={() => setEntry({ uid, requested: false })}>Volver al negocio</button></div><AuthGate><Island slug={slug} /></AuthGate></>;
  return <AnonymousProfile slug={slug} onContinue={serviceId => setEntry({ uid, requested: true, serviceId })} />;
}

export default function ClientIslandPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  return <BusinessEntry key={slug} slug={slug} />;
}
