"use client";

import { use, useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { collection, doc, onSnapshot, query, where } from "firebase/firestore";
import { CalendarCheck, Download, Send } from "lucide-react";
import { SarinMark } from "@/components/sarin-brand";
import { AuthGate, useAuth } from "@/components/auth-provider";
import { Notice, buttonClass, fieldClass } from "@/components/app-shell";
import { useDebouncedChat } from "@/hooks/useDebouncedChat";
import { useEngineHealth } from "@/hooks/useEngineHealth";
import { getFirebaseClient } from "@/lib/firebase/client";
import { errorMessage } from "@/lib/client/api";
import { isSubscriptionAllowed } from "@/lib/sarin/subscription";
import { generateICSFileContent } from "@/lib/utils/icsGenerator";
import type { Appointment, PublicBusiness } from "@/types/firestore";

function Island({ slug }: { slug: string }) {
  const { user, signOut } = useAuth();
  const [business, setBusiness] = useState<PublicBusiness | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [input, setInput] = useState("");
  const [now, setNow] = useState(Date.now());
  const end = useRef<HTMLDivElement>(null);
  const engine = useEngineHealth();
  useEffect(() => {
    setBusiness(null);
    setLoading(true);
    setError(null);
    return onSnapshot(
      doc(getFirebaseClient().db, "publicBusinesses", slug),
      (snapshot) => {
        setBusiness(
          snapshot.exists() ? (snapshot.data() as PublicBusiness) : null,
        );
        setLoading(false);
      },
      (cause) => {
        setError(errorMessage(cause));
        setLoading(false);
      },
    );
  }, [slug]);
  useEffect(() => {
    setAppointments([]);
    if (!business || !user) return;
    return onSnapshot(
      query(
        collection(
          getFirebaseClient().db,
          "businesses",
          business.id,
          "appointments",
        ),
        where("client.uid", "==", user.uid),
      ),
      (snapshot) => {
        setAppointments(
          snapshot.docs
            .map((item) => ({ ...item.data(), id: item.id }) as Appointment)
            .filter((item) => item.status === "confirmed")
            .sort((a, b) => a.startAt - b.startAt),
        );
      },
      (cause) => setError(errorMessage(cause)),
    );
  }, [business, user]);
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
      !isSubscriptionAllowed(business, Date.now())
    )
      return;
    chat.sendMessage(input);
    setInput("");
  }
  function download(appointment: Appointment) {
    if (!business) return;
    const calendar = generateICSFileContent({
      businessName: business.name,
      serviceName: appointment.serviceName || "Cita",
      dateKey: appointment.dateKey,
      startTimeStr: appointment.startTimeStr,
      durationMinutes: (appointment.endAt - appointment.startAt) / 60000,
      notes: appointment.client
        ? Object.entries(appointment.client.intakeAnswers)
            .map(([key, value]) => `${key}: ${value}`)
            .join("\n")
        : "",
    });
    const url = URL.createObjectURL(
      new Blob([calendar], { type: "text/calendar;charset=utf-8" }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `cita-${appointment.id}.ics`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
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
  const future = appointments.filter((item) => item.endAt > now);
  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col border-x border-sarin-line bg-sarin-canvas">
      <header className="sticky top-0 z-20 border-b border-sarin-line bg-sarin-paper/95 p-4 backdrop-blur">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <SarinMark className="h-11 w-11" />
            <div className="min-w-0">
              <h1 className="truncate font-bold">{business.name}</h1>
              <p
                className={`mt-1 text-xs ${engine.health?.status === "online" && allowed ? "text-sarin-blue" : "text-sarin-muted"}`}
              >
                {!allowed
                  ? "Agenda en pausa"
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
      </header>
      <div className="flex-1 space-y-5 p-4 sm:p-6">
        {error && <Notice error>{error}</Notice>}
        {!allowed && (
          <Notice>
            La agenda automática está temporalmente en pausa. Contacta
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
              <Notice error>{chat.error}</Notice>
              <button
                className="min-h-11 text-sm text-sarin-blue underline"
                onClick={chat.retry}
                disabled={chat.isGenerating || !allowed}
              >
                Reintentar mensaje
              </button>
            </div>
          )}
          <div ref={end} />
        </div>
        {future.length > 0 && (
          <section className="space-y-3">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-sarin-blue">
              <CalendarCheck className="h-4 w-4" />
              Tus próximas citas
            </h2>
            {future.map((appointment) => (
              <article
                key={appointment.id}
                className="space-y-3 rounded-2xl border border-sarin-blue/20 bg-sarin-soft p-4"
              >
                <h3 className="font-semibold">{appointment.serviceName}</h3>
                <p className="text-sm text-sarin-ink">
                  {appointment.dateKey} · {appointment.startTimeStr}–
                  {appointment.endTimeStr} (Colombia)
                </p>
                <button
                  className="flex min-h-11 items-center gap-2 text-sm font-semibold text-sarin-blue"
                  onClick={() => download(appointment)}
                >
                  <Download className="h-4 w-4" />
                  Guardar en mi calendario
                </button>
              </article>
            ))}
          </section>
        )}
      </div>
      <form
        onSubmit={submit}
        className="sticky bottom-0 flex gap-2 border-t border-sarin-line bg-sarin-canvas p-3"
      >
        <input
          className={fieldClass}
          aria-label="Mensaje para Sarin"
          placeholder={
            allowed
              ? "¿Qué te gustaría reservar?"
              : "Agenda temporalmente pausada"
          }
          disabled={!allowed}
          value={input}
          maxLength={8000}
          onChange={(event) => setInput(event.target.value)}
        />
        <button
          className={buttonClass}
          aria-label="Enviar mensaje"
          disabled={!allowed || !input.trim() || Boolean(chat.error)}
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
