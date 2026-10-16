"use client";

import { use, useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { Send } from "lucide-react";
import { SarinMark } from "@/components/sarin-brand";
import { AuthGate, useAuth } from "@/components/auth-provider";
import { Notice, buttonClass, fieldClass } from "@/components/app-shell";
import { ClientAppointments } from "@/components/client-appointments";
import { useDebouncedChat } from "@/hooks/useDebouncedChat";
import { useEngineHealth } from "@/hooks/useEngineHealth";
import { useApiPoll } from "@/lib/client/use-api-poll";
import { getBusinessAccess, isSubscriptionAllowed } from "@/lib/sarin/subscription";
import type { PublicBusiness } from "@/types/firestore";
import { businessSocialLabel, businessSocialPlatformLabels } from '@/lib/business-branding';

function Island({ slug }: { slug: string }) {
  const { user, signOut } = useAuth();
  const projection = useApiPoll<PublicBusiness | null>(slug, async signal => {
    const response = await fetch(`/api/public/businesses/${encodeURIComponent(slug)}`, { signal, cache: 'no-store' });
    if (!response.ok) throw new Error('No pudimos consultar el negocio. Inténtalo de nuevo.');
    const data = await response.json() as { business: PublicBusiness | null };
    return data.business;
  });
  const business = projection.value, loading = projection.loading, error = projection.error;
  const [input, setInput] = useState("");
  const [now, setNow] = useState(Date.now());
  const end = useRef<HTMLDivElement>(null);
  const engine = useEngineHealth();
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 15000);
    return () => clearInterval(timer);
  }, []);
  const chat = useDebouncedChat({
    mode: "sarin_client",
    tenantId: business?.id || "",
  });
  useEffect(() => {
    end.current?.scrollIntoView({ behavior: "auto", block: "nearest" });
  }, [chat.messages, chat.isGenerating]);
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (
      !input.trim() ||
      !business ||
      chat.quotaExhausted ||
      !isSubscriptionAllowed(business, Date.now())
    )
      return;
    chat.sendMessage(input);
    setInput("");
  }
  if (loading)
    return (
      <div className="mx-auto max-w-lg p-6">
        <Notice>Cargando negocio…</Notice>
      </div>
    );
  if (!business)
    return (
      <div className="mx-auto max-w-lg space-y-4 p-6">
        <Notice error>
          {error ||
            "No encontramos este negocio. Revisa el enlace o escanea nuevamente su QR."}
        </Notice>
        <Link href="/" className="text-sarin-blue underline">
          Volver al inicio
        </Link>
      </div>
    );
  const allowed = isSubscriptionAllowed(business, now);
  const retryAllowed = allowed || getBusinessAccess(business, now) === "trial_exhausted";
  const chatAllowed = allowed && !chat.quotaExhausted;
  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col border-x border-sarin-line bg-sarin-canvas">
      <header className="sticky top-0 z-20 border-b border-sarin-line bg-sarin-paper/95 p-4 backdrop-blur">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            {business.logo ? <img src={`/api/public/businesses/${business.slug}/logo/${business.logo.sha256}`} alt={`Logo de ${business.name}`} width={44} height={44} className="h-11 w-11 shrink-0 rounded-lg object-contain" /> : <SarinMark className="h-11 w-11 shrink-0" />}
            <div className="min-w-0">
              <h1 className="line-clamp-2 break-words font-bold leading-5 [overflow-wrap:anywhere]">{business.name}</h1>
              <p
                className={`mt-1 text-xs ${engine.health?.status === "online" && chatAllowed ? "text-sarin-blue" : "text-sarin-muted"}`}
              >
                {!chatAllowed
                  ? "Atención de IA en pausa"
                  : engine.health
                    ? engine.health.status === "online"
                      ? "Sarin disponible"
                      : "Sarin sin conexión"
                    : "Comprobando conexión…"}
              </p>
            </div>
          </div>
          <button
            className="min-h-11 max-w-28 shrink-0 truncate rounded-[10px] border border-sarin-line px-3 py-2 text-xs text-sarin-muted hover:bg-sarin-soft hover:text-sarin-blue"
            onClick={() => void signOut()}
            title="Cerrar sesión"
          >
            {user?.displayName?.split(" ")[0] || "Salir"} · Salir
          </button>
        </div>
        <nav aria-label="Citas del cliente" className="mt-1 flex">
          <a
            href="#mis-citas"
            className="flex min-h-11 items-center rounded-[10px] px-2 text-xs font-semibold text-sarin-blue hover:bg-sarin-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sarin-blue"
          >
            Mis citas
          </a>
        </nav>
      </header>
      <div className="flex-1 space-y-5 p-4 sm:p-6">
        <nav aria-label="Contacto del negocio" className="flex flex-wrap gap-x-4 text-sm text-sarin-blue">
          {business.phoneWhatsApp && <a href={`tel:+${business.phoneWhatsApp.replace(/\D/g, '')}`} className="inline-flex min-h-11 items-center underline">+{business.phoneWhatsApp.replace(/^\+/, '')}</a>}
          {(business.socialLinks ?? []).map(link => <a key={link.platform} href={link.url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 max-w-full items-center break-all underline">{businessSocialPlatformLabels[link.platform]} · {businessSocialLabel(link)}</a>)}
        </nav>
        {error && <Notice error>{error}</Notice>}
        {!chatAllowed && (
          <Notice>
            La atención de IA está temporalmente en pausa. Contacta
            directamente al establecimiento para reservar.
            {business.phoneWhatsApp && (
              <>
                {" "}
                <a
                  className="text-sarin-blue underline"
                  href={`https://wa.me/${business.phoneWhatsApp.replace(/\D/g, "")}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Contactar negocio
                </a>
              </>
            )}
          </Notice>
        )}
        {engine.health?.status === "offline" && (
          <div className="space-y-2">
            <Notice>
              Sarin no puede responder en este momento. Tu mensaje se conserva
              si necesitas reintentarlo.
            </Notice>
            <button
              className="min-h-11 text-xs text-sarin-blue underline"
              disabled={engine.checking}
              onClick={() => void engine.refresh()}
            >
              Comprobar conexión
            </button>
          </div>
        )}
        <section className="rounded-2xl border border-sarin-line bg-sarin-paper p-5">
          <p className="mb-2 text-sm font-semibold text-sarin-blue">
            Hola, {user?.displayName?.split(" ")[0] || "bienvenido"}.
          </p>
          <p className="text-sm leading-relaxed text-sarin-ink">
            Soy Sarin, el asistente de {business.name}. Cuéntame qué servicio
            necesitas y cuándo te gustaría venir.
          </p>
          {business.services.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-2">
              {business.services.map((service) => (
                <span
                  className="min-w-0 max-w-full break-words rounded-lg border border-sarin-line px-2.5 py-1.5 text-xs text-sarin-muted [overflow-wrap:anywhere]"
                  key={service.id}
                >
                  {service.name} ·{" "}
                  {service.price.toLocaleString("es-CO", {
                    style: "currency",
                    currency: "COP",
                    maximumFractionDigits: 0,
                  })}
                </span>
              ))}
            </div>
          )}
          <nav aria-label="Información del servicio" className="mt-3 flex flex-wrap gap-x-5 text-xs text-sarin-blue">
            <Link href="/privacidad" className="inline-flex min-h-11 items-center underline underline-offset-4">Privacidad</Link>
            <Link href="/ayuda" className="inline-flex min-h-11 items-center underline underline-offset-4">Ayuda</Link>
          </nav>
        </section>
        <div aria-live="polite" className="space-y-4">
          {chat.messages.map((message) => (
            <div
              className={`whitespace-pre-wrap break-words rounded-2xl p-4 text-sm leading-relaxed ${message.role === "user" ? "ml-8 bg-sarin-blue text-white" : "mr-5 border border-sarin-line bg-sarin-canvas text-sarin-ink"}`}
              key={message.id}
            >
              {message.content}
            </div>
          ))}
          {(chat.isWaitingBatch || chat.isGenerating) && (
            <p role="status" className="text-xs text-sarin-blue">
              {chat.isGenerating
                ? "Sarin está revisando tu solicitud…"
                : "Preparando tu mensaje…"}
            </p>
          )}
          {chat.error && (
            <div className="space-y-3">
              {!chat.quotaExhausted && <Notice error={!chat.requestAlreadyCompleted}>{chat.error}</Notice>}
              {!chat.requestAlreadyCompleted && <button
                className="min-h-11 text-sm text-sarin-blue underline"
                onClick={chat.retry}
                disabled={chat.isGenerating || !retryAllowed}
              >
                {chat.quotaExhausted ? "Comprobar disponibilidad" : "Reintentar mensaje"}
              </button>}
            </div>
          )}
          <div ref={end} />
        </div>
        {user && <ClientAppointments key={`${business.id}:${user.uid}`} businessId={business.id} businessName={business.name} resources={business.resources} userId={user.uid} now={now} />}
      </div>
      <form
        onSubmit={submit}
        className="sticky bottom-0 flex gap-2 border-t border-sarin-line bg-sarin-canvas p-3"
      >
        <input
          className={fieldClass}
          aria-label="Mensaje para Sarin"
          placeholder={
            chatAllowed
              ? "¿Qué te gustaría reservar?"
              : "Atención de IA temporalmente pausada"
          }
          disabled={!chatAllowed}
          value={input}
          maxLength={8000}
          onChange={(event) => setInput(event.target.value)}
        />
        <button
          className={buttonClass}
          aria-label="Enviar mensaje"
          disabled={!chatAllowed || !input.trim() || (Boolean(chat.error) && !chat.requestAlreadyCompleted)}
        >
          <Send className="h-4 w-4" />
        </button>
      </form>
    </main>
  );
}
export default function ClientIslandPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = use(params);
  return (
    <AuthGate>
      <Island slug={slug} />
    </AuthGate>
  );
}
