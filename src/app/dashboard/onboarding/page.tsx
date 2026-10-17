"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Plus, Send, Trash2 } from "lucide-react";
import Link from "next/link";
import { SarinMark } from "@/components/sarin-brand";
import { WhatsAppPhoneField } from "@/components/whatsapp-phone-field";
import { TextSuggestions } from "@/components/text-suggestions";
import { BusinessLogoField } from '@/components/business-logo-field';
import { BusinessSocialFields } from '@/components/business-social-fields';
import type { BusinessSocialLink } from '@/lib/business-branding';
import { AuthGate, useAuth } from "@/components/auth-provider";
import { useAccountConsent } from '@/components/consent-panel';
import {
  AppShell,
  Notice,
  buttonClass,
  fieldClass,
} from "@/components/app-shell";
import { useBusiness } from "@/hooks/useBusiness";
import { useDebouncedChat } from "@/hooks/useDebouncedChat";
import { useBookingDataPolicy } from "@/hooks/useBookingDataPolicy";
import type { BusinessConfig } from "@/lib/server/schemas";
import { apiFetch, errorMessage } from "@/lib/client/api";
import { isSubscriptionAllowed } from "@/lib/sarin/subscription";
import { canPurchasePaidTrial } from "@/lib/paid-trial";
import { preserveServiceCatalogMetadata, SERVICE_CATEGORY_MAX_LENGTH, SERVICE_DESCRIPTION_MAX_LENGTH } from "@/lib/service-catalog";
import type {
  Business,
  DaySchedule,
  TenantResource,
  TenantService,
} from "@/types/firestore";

const days = [
  "Domingo",
  "Lunes",
  "Martes",
  "Miércoles",
  "Jueves",
  "Viernes",
  "Sábado",
];
const slugify = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 70);
function initialSchedule(): Record<number, DaySchedule> {
  return Object.fromEntries(
    days.map((_, index) => [index, { isOpen: false, intervals: [] }]),
  );
}

function ConfigurationAssistant({ uid, business, enabled, onDraft }: { uid?: string; business: Business; enabled: boolean; onDraft: (draft: BusinessConfig) => void }) {
  const [input, setInput] = useState("");
  const accountConsent = { active: enabled };
  const chat = useDebouncedChat({ actorUid: uid, enabled, mode: "sarin_onboarding", tenantId: business.id });
  function useConfigurationDraft() { if (chat.configurationDraft) onDraft(chat.configurationDraft); }
  return (
        <section className="flex min-w-0 flex-col rounded-2xl border border-sarin-line bg-sarin-paper xl:sticky xl:top-6">
          <h2 className="flex items-center gap-2 border-b border-sarin-line px-4 py-3 font-semibold">
            <SarinMark className="h-8 w-8" />
            Configurar con Sarin
          </h2>
          <div
            aria-live="polite"
            className="max-h-[28rem] min-h-36 flex-1 space-y-3 overflow-auto p-4 xl:min-h-48"
          >
            <p className="text-sm leading-relaxed text-sarin-muted">
              Describe el nombre de tu negocio, sus servicios, precios,
              profesionales y horarios. Sarin puede preparar una propuesta;
              úsala en el formulario, revísala y guarda cuando esté correcta.
            </p>
            {chat.messages.map((message) => (
              <div
                key={message.id}
                className={`whitespace-pre-wrap break-words rounded-xl p-3 text-sm leading-6 ${message.role === "user" ? "ml-5 bg-sarin-blue text-white" : "mr-5 bg-sarin-canvas text-sarin-ink"}`}
              >
                {message.content}
              </div>
            ))}
            {chat.configurationDraft && <button type="button" className={buttonClass} disabled={chat.isGenerating} onClick={useConfigurationDraft}>Usar propuesta en el formulario</button>}
            {(chat.isGenerating || chat.isWaitingBatch) && (
              <p role="status" className="text-xs text-sarin-blue">
                {chat.isGenerating
                  ? "Sarin está preparando tu configuración…"
                  : "Preparando tu mensaje…"}
              </p>
            )}
            {chat.error && (
              <div className="space-y-2">
                <Notice error={!chat.requestAlreadyCompleted}>{chat.error}</Notice>
                {!chat.requestAlreadyCompleted && <button
                  type="button"
                  className="min-h-11 text-sm text-sarin-blue underline"
                  onClick={chat.retry}
                  disabled={!accountConsent.active || chat.isGenerating}
                >
                  {chat.quotaExhausted ? "Comprobar disponibilidad" : "Reintentar mensaje"}
                </button>}
              </div>
            )}
          </div>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (accountConsent.active && input.trim() && !chat.quotaExhausted && isSubscriptionAllowed(business)) {
                chat.sendMessage(input);
                setInput("");
              }
            }}
            className="flex gap-2 border-t border-sarin-line p-3"
          >
            <input
              aria-label="Mensaje para Sarin"
              className={fieldClass}
              value={input}
              disabled={!accountConsent.active || chat.quotaExhausted}
              maxLength={8000}
              onChange={(event) => setInput(event.target.value)}
              placeholder="Cuéntale cómo trabajas…"
            />
            <button
              aria-label="Enviar mensaje"
              className={buttonClass}
              disabled={!accountConsent.active || !input.trim() || chat.quotaExhausted || (Boolean(chat.error) && !chat.requestAlreadyCompleted)}
            >
              <Send className="h-4 w-4" />
            </button>
          </form>
        </section>
  );
}

function Configuration() {
  const { user } = useAuth();
  const accountConsent = useAccountConsent();
  const { business, loading, error: businessError, setBusiness } = useBusiness();
  const policy = useBookingDataPolicy(user?.uid, business?.id);
  const health = policy.ready && policy.capability?.dataMode === "health";
  const restrictedIntake = policy.ready && (health || policy.capability?.representedMinorsEnabled === true);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [category, setCategory] = useState("");
  const [phone, setPhone] = useState("");
  const [socialLinks, setSocialLinks] = useState<BusinessSocialLink[]>([]);
  const [tone, setTone] = useState("Cercano y profesional");
  const [rules, setRules] = useState("");
  const [intake, setIntake] = useState("");
  const proposedIntake = useRef<Business['sarinConfig']['intakeFields']>([]);
  const [resources, setResources] = useState<TenantResource[]>([
    { id: "principal", name: "", active: true },
  ]);
  const [services, setServices] = useState<TenantService[]>([
    {
      id: "principal",
      name: "",
      durationMinutes: 30,
      bufferMinutes: 0,
      price: 0,
      resourceIds: ["principal"],
    },
  ]);
  const [schedule, setSchedule] = useState(initialSchedule);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const loadedVersion = useRef("");
  const loadedBusiness = useRef('');
  const baseline = useRef('');
  const latestSnapshot = useRef('');
  latestSnapshot.current = JSON.stringify([name, slug, category, phone, tone, rules, intake, resources, services, schedule, socialLinks]);
  useEffect(() => {
    if (!business?.sarinConfig.onboardingCompleted) return;
    const version = JSON.stringify([
      business.id,
      business.name,
      business.slug,
      business.category,
      business.phoneWhatsApp,
      business.sarinConfig,
      business.resources,
      business.services,
      business.weeklySchedule,
      business.socialLinks,
    ]);
    if (loadedVersion.current === version) return;
    if (loadedBusiness.current === business.id && baseline.current && baseline.current !== latestSnapshot.current) return;
    if (loadedBusiness.current !== business.id) proposedIntake.current = [];
    loadedBusiness.current = business.id;
    baseline.current = JSON.stringify([business.name, business.slug, business.category, business.phoneWhatsApp, business.sarinConfig.tone, business.sarinConfig.customRules, business.sarinConfig.intakeFields.map(item => item.label).join('\n'), business.resources, business.services, business.weeklySchedule, business.socialLinks ?? []]);
    loadedVersion.current = version;
    setName(business.name);
    setSlug(business.slug);
    setCategory(business.category);
    setPhone(business.phoneWhatsApp);
    setSocialLinks(business.socialLinks ?? []);
    setTone(business.sarinConfig.tone);
    setRules(business.sarinConfig.customRules);
    setIntake(
      business.sarinConfig.intakeFields.map((item) => item.label).join("\n"),
    );
    setResources(business.resources);
    setServices(business.services);
    setSchedule(business.weeklySchedule);
  }, [business]);
  function applyConfigurationDraft(draft: BusinessConfig) {
    setName(draft.name); setSlug(business?.slug || draft.slug); setCategory(draft.category); setPhone(draft.phoneWhatsApp);
    if (draft.socialLinks !== undefined) setSocialLinks(draft.socialLinks);
    proposedIntake.current = draft.intakeFields;
    setTone(draft.tone); setRules(draft.customRules); setIntake(draft.intakeFields.map(field => field.label).join('\n'));
    setResources(draft.resources); setServices(previous => preserveServiceCatalogMetadata(draft.services, previous)); setSchedule(draft.weeklySchedule); setSaved(false);
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!accountConsent.active || !policy.ready || !isSubscriptionAllowed(business)) return;
    setError(null);
    setSaved(false);
    setSaving(true);
    const submittedSnapshot = latestSnapshot.current;
    try {
      const response = await apiFetch<{ business: Business }>("/api/businesses", {
        method: "POST",
        body: JSON.stringify({
          name,
          slug,
          category,
          phoneWhatsApp: phone,
          socialLinks,
          tone,
          customRules: rules,
          resources,
          services,
          weeklySchedule: schedule,
          intakeFields: restrictedIntake ? [] : intake
            .split("\n")
            .map((label) => label.trim())
            .filter(Boolean)
            .map(
              (label, index) =>
                (proposedIntake.current[index]?.label === label ? proposedIntake.current[index] : undefined) ?? business?.sarinConfig.intakeFields.find(
                  (field) => field.label === label,
                ) ?? {
                  key: `dato_${crypto.randomUUID()}`,
                  label,
                  required: true,
                },
            ),
        }),
      });
      baseline.current = submittedSnapshot;
      loadedVersion.current = '';
      setBusiness(response.business);
      setSaved(true);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setSaving(false);
    }
  }
  function updateDay(index: number, next: DaySchedule) {
    setSchedule((previous) => ({ ...previous, [index]: next }));
  }
  if (loading) return <Notice>Cargando configuración…</Notice>;
  if (businessError) return <Notice error>{businessError}</Notice>;
  if (!isSubscriptionAllowed(business)) return (
    <section className="max-w-2xl space-y-4 rounded-2xl border border-sarin-line bg-sarin-paper p-5 sm:p-6">
      <h1 className="text-3xl font-bold">{canPurchasePaidTrial(business?.subscription) ? "Empieza con tu prueba pagada" : "Elige un plan para continuar"}</h1>
      <p className="text-sm leading-6 text-sarin-muted">{canPurchasePaidTrial(business?.subscription) ? "Por $5.000 COP puedes configurar tu negocio y recibir hasta 10 citas, sin caducidad. Después, elige un plan para continuar." : "Revisa los planes y el estado de tus pagos para volver a configurar tu negocio y recibir nuevas citas. Tu agenda existente se conserva."}</p>
      <Notice>{business?.subscription.paidTrial?.source === 'invitation' && business.subscription.paidTrial.accessSuspended ? 'El acceso de cortesía está suspendido. Contacta a administración; tus citas y consumo se conservan.' : business?.subscription.status === "pending_payment" ? "La configuración y Sarin se habilitan después de aprobar tu comprobante o canjear una invitación. Si ya enviaste el comprobante, espera su revisión." : "Necesitas acceso vigente para configurar tu negocio y usar Sarin."}</Notice>
      <Link href="/dashboard/billing" className={buttonClass + " inline-flex items-center"}>Ver pagos y planes</Link>
    </section>
  );
  return (
    <div className="max-w-[45rem] space-y-5 xl:max-w-5xl">
      <div>
        <p className="text-xs uppercase tracking-widest text-sarin-blue">
          Configuración
        </p>
        <h1 className="mt-2 text-3xl font-bold">
          {business?.sarinConfig.onboardingCompleted ? "Así trabaja tu negocio" : "Configura el espacio de tu negocio"}
        </h1>
        <p className="mt-2 text-sm text-sarin-muted">
          Cuéntaselo a Sarin o completa los datos.{business?.subscription.status === "trial" ? business.subscription.paidTrial?.source === 'invitation' ? " Tu prueba de cortesía incluye diez citas y 700 respuestas; sin cobro ni caducidad." : " Tu prueba pagada incluye la configuración y hasta 10 citas, sin caducidad." : ""}
        </p>
      </div>
      {error && <Notice error>{error}</Notice>}
      {saved && (
        <Notice>
          Configuración guardada. Tu enlace y agenda ya están disponibles en el
          panel.
        </Notice>
      )}
      {business && business.sarinConfig.onboardingCompleted && <BusinessLogoField business={business} onSaved={setBusiness} />}
      <div className={`grid items-start gap-5 ${policy.ready && !health ? "xl:grid-cols-[18rem_minmax(0,1fr)]" : ""}`}>
        {policy.ready && !health && business ? <ConfigurationAssistant key={`${user?.uid}:${business.id}`} uid={user?.uid} business={business} enabled={accountConsent.active} onDraft={applyConfigurationDraft} /> : <div className="space-y-2"><Notice error={Boolean(policy.error)}>{policy.error || (health ? 'Este negocio se configura manualmente. Las reservas de salud usan formulario sin IA; no incluyas información de pacientes en el catálogo.' : 'Comprobando las opciones de configuración…')}</Notice>{policy.error && <button type="button" className={buttonClass} onClick={policy.refresh}>Reintentar clasificación</button>}</div>}

        <form aria-label="Datos de tu negocio"
          className="@container min-w-0 space-y-5 rounded-2xl border border-sarin-line bg-sarin-paper p-4 sm:p-5"
          onSubmit={(event) => void save(event)}
        >
          <fieldset disabled={!accountConsent.active || !policy.ready} className="min-w-0 space-y-5">
          <h2 className="text-lg font-semibold">Datos de tu negocio</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-xs text-sarin-muted">
              Nombre
              <input
                className={fieldClass + " mt-1.5"}
                value={name}
                required
                maxLength={120}
                onChange={(event) => {
                  setName(event.target.value);
                  if (!business?.sarinConfig.onboardingCompleted) setSlug(slugify(event.target.value));
                }}
              />
            </label>
            <label className="text-xs text-sarin-muted">
              Categoría
              <input
                className={fieldClass + " mt-1.5"}
                value={category}
                required
                maxLength={100}
                onChange={(event) => setCategory(event.target.value)}
              />
            </label>
            <label className="text-xs text-sarin-muted">
              Enlace
              <input
                className={fieldClass + " mt-1.5"}
                value={slug}
                readOnly={Boolean(business?.sarinConfig.onboardingCompleted)}
                required
                pattern="[a-z0-9]+(-[a-z0-9]+)*"
                minLength={3}
                maxLength={70}
                onChange={(event) => setSlug(event.target.value)}
              />
              {business?.sarinConfig.onboardingCompleted && (
                <span className="mt-1.5 block text-sarin-muted">
                  El enlace queda reservado a tu negocio.
                </span>
              )}
            </label>
            <WhatsAppPhoneField value={phone} onChange={setPhone} />
          </div>
          <BusinessSocialFields value={socialLinks} onChange={setSocialLinks} />
          <section className="space-y-2">
            <h3 className="font-semibold">Profesionales o estaciones</h3>
            {resources.map((resource, index) => (
              <div key={resource.id} className="flex gap-2">
                <input
                  aria-label={`Nombre del recurso ${index + 1}`}
                  className={fieldClass}
                  value={resource.name}
                  required
                  maxLength={100}
                  onChange={(event) =>
                    setResources((previous) =>
                      previous.map((item) =>
                        item.id === resource.id
                          ? { ...item, name: event.target.value }
                          : item,
                      ),
                    )
                  }
                />
                <button
                  type="button"
                  aria-label="Eliminar recurso"
                  disabled={resources.length === 1}
                  className="grid h-11 w-11 shrink-0 place-items-center rounded-[10px] text-sarin-muted hover:bg-rose-50 hover:text-rose-700 disabled:opacity-30"
                  onClick={() => {
                    const rest = resources.filter(
                      (item) => item.id !== resource.id,
                    );
                    setResources(rest);
                    setServices((previous) =>
                      previous.map((service) => ({
                        ...service,
                        resourceIds: service.resourceIds.filter(
                          (id) => id !== resource.id,
                        ).length
                          ? service.resourceIds.filter(
                              (id) => id !== resource.id,
                            )
                          : rest.map((item) => item.id),
                      })),
                    );
                  }}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
            <button
              type="button"
              className="flex min-h-11 items-center gap-1 text-sm text-sarin-blue"
              onClick={() =>
                setResources((previous) => [
                  ...previous,
                  { id: crypto.randomUUID(), name: "", active: true },
                ])
              }
            >
              <Plus className="h-4 w-4" />
              Añadir recurso
            </button>
          </section>
          <section className="space-y-2">
            <h3 className="font-semibold">Servicios</h3>
            {services.map((service, index) => (
              <div
                className="space-y-3 rounded-xl border border-sarin-line p-3"
                key={service.id}
              >
                <div className="flex gap-2">
                  <input
                    aria-label={`Nombre del servicio ${index + 1}`}
                    placeholder="Nombre del servicio"
                    className={fieldClass}
                    value={service.name}
                    required
                    maxLength={120}
                    onChange={(event) =>
                      setServices((previous) =>
                        previous.map((item) =>
                          item.id === service.id
                            ? { ...item, name: event.target.value }
                            : item,
                        ),
                      )
                    }
                  />
                  <button
                    type="button"
                    aria-label="Eliminar servicio"
                    disabled={services.length === 1}
                    className="grid h-11 w-11 shrink-0 place-items-center rounded-[10px] text-sarin-muted hover:bg-rose-50 hover:text-rose-700 disabled:opacity-30"
                    onClick={() =>
                      setServices((previous) =>
                        previous.filter((item) => item.id !== service.id),
                      )
                    }
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
                <label className="block min-w-0 text-xs text-sarin-muted">
                  Descripción (opcional)
                  <textarea
                    aria-label={`Descripción del servicio ${index + 1}`}
                    aria-describedby={`service-description-help-${service.id}`}
                    className={fieldClass + " mt-1.5 min-h-20 resize-y"}
                    rows={2}
                    maxLength={SERVICE_DESCRIPTION_MAX_LENGTH}
                    value={service.description ?? ""}
                    onChange={(event) =>
                      setServices((previous) => previous.map((item) =>
                        item.id === service.id ? { ...item, description: event.target.value } : item,
                      ))
                    }
                  />
                  <span id={`service-description-help-${service.id}`} className="mt-1 block">Visible para tus clientes</span>
                </label>
                <label className="block min-w-0 text-xs text-sarin-muted">
                  Categoría (opcional)
                  <input
                    aria-label={`Categoría del servicio ${index + 1}`}
                    aria-describedby={`service-category-help-${service.id}`}
                    className={fieldClass + " mt-1.5"}
                    maxLength={SERVICE_CATEGORY_MAX_LENGTH}
                    value={service.category ?? ""}
                    onChange={(event) =>
                      setServices((previous) => previous.map((item) =>
                        item.id === service.id ? { ...item, category: event.target.value } : item,
                      ))
                    }
                  />
                  <span id={`service-category-help-${service.id}`} className="mt-1 block">Visible para tus clientes</span>
                </label>
                <div className="grid grid-cols-2 gap-3 @min-[24rem]:grid-cols-3">
                  {(
                    [
                      ["durationMinutes", "Duración (min)", 5],
                      ["bufferMinutes", "Tiempo entre citas (min)", 0],
                      ["price", "Precio COP", 0],
                    ] as const
                  ).map(([key, label, minimum]) => (
                    <label className="flex min-w-0 flex-col text-xs text-sarin-muted" key={key}>
                      <span className="mb-1.5">{label}</span>
                      <input
                        className={fieldClass + " mt-auto"}
                        type="number"
                        aria-describedby={key === "bufferMinutes" ? `service-buffer-help-${service.id}` : undefined}
                        min={minimum}
                        max={
                          key === "price"
                            ? 100000000
                            : key === "bufferMinutes"
                              ? 180
                              : 720
                        }
                        step="1"
                        required
                        value={service[key]}
                        onChange={(event) =>
                          setServices((previous) =>
                            previous.map((item) =>
                              item.id === service.id
                                ? { ...item, [key]: Number(event.target.value) }
                                : item,
                            ),
                          )
                        }
                      />
                    </label>
                  ))}
                </div>
                <p id={`service-buffer-help-${service.id}`} className="text-xs leading-relaxed text-sarin-muted">
                  El tiempo entre citas es un margen después del servicio para preparar el puesto. Usa 0 si no lo necesitas.
                </p>
                <fieldset className="flex flex-wrap gap-x-3 gap-y-1">
                  <legend className="text-xs text-sarin-muted">
                    Disponible con
                  </legend>
                  {resources.map((resource) => (
                    <label
                      className="flex min-h-11 items-center gap-2 text-xs text-sarin-ink"
                      key={resource.id}
                    >
                      <input
                        type="checkbox"
                        checked={service.resourceIds.includes(resource.id)}
                        onChange={(event) =>
                          setServices((previous) =>
                            previous.map((item) =>
                              item.id === service.id
                                ? {
                                    ...item,
                                    resourceIds: event.target.checked
                                      ? [...item.resourceIds, resource.id]
                                      : item.resourceIds.filter(
                                          (id) => id !== resource.id,
                                        ),
                                  }
                                : item,
                            ),
                          )
                        }
                      />
                      {resource.name || "Recurso sin nombre"}
                    </label>
                  ))}
                </fieldset>
              </div>
            ))}
            <button
              type="button"
              className="flex min-h-11 items-center gap-1 text-sm text-sarin-blue"
              onClick={() =>
                setServices((previous) => [
                  ...previous,
                  {
                    id: crypto.randomUUID(),
                    name: "",
                    durationMinutes: 30,
                    bufferMinutes: 0,
                    price: 0,
                    resourceIds: resources.map((item) => item.id),
                  },
                ])
              }
            >
              <Plus className="h-4 w-4" />
              Añadir servicio
            </button>
          </section>
          <section className="space-y-2">
            <h3 className="font-semibold">Horarios · Colombia</h3>
            <div className="divide-y divide-sarin-line border-y border-sarin-line">
              {days.map((day, index) => {
                const config = schedule[index] ?? {
                  isOpen: false,
                  intervals: [],
                };
                return (
                  <div
                    key={day}
                    className="grid gap-x-3 py-1 @min-[32rem]:grid-cols-[7rem_minmax(0,1fr)]"
                  >
                    <label className="flex min-h-11 items-center gap-2 self-start text-sm">
                      <input
                        type="checkbox"
                        checked={config.isOpen}
                        onChange={(event) =>
                          updateDay(index, {
                            isOpen: event.target.checked,
                            intervals: event.target.checked
                              ? config.intervals.length
                                ? config.intervals
                                : [{ start: "09:00", end: "17:00" }]
                              : [],
                          })
                        }
                      />
                      <span className="flex flex-1 items-center justify-between gap-x-2 @min-[32rem]:flex-col @min-[32rem]:items-start @min-[32rem]:justify-center">
                        <span>{day}</span>
                        <span className="text-xs text-sarin-muted">
                          {config.isOpen ? "Abierto" : "Cerrado"}
                        </span>
                      </span>
                    </label>
                    {config.isOpen && (
                      <div className="flex min-w-0 flex-wrap items-start gap-x-2 gap-y-1">
                        <div className="min-w-0 space-y-1">
                          {config.intervals.map((interval, intervalIndex) => (
                            <div
                              key={intervalIndex}
                              className="grid w-fit max-w-full grid-cols-[minmax(0,140px)_44px] items-center gap-1.5 @min-[24rem]:grid-cols-[140px_auto_140px_44px]"
                            >
                              <input
                                aria-label={`${day} apertura ${intervalIndex + 1}`}
                                className={fieldClass + " max-w-[140px] px-2! tabular-nums"}
                                type="time"
                                required
                                value={interval.start}
                                onChange={(event) =>
                                  updateDay(index, {
                                    ...config,
                                    intervals: config.intervals.map((item, i) =>
                                      i === intervalIndex
                                        ? { ...item, start: event.target.value }
                                        : item,
                                    ),
                                  })
                                }
                              />
                              <span className="hidden text-xs text-sarin-muted @min-[24rem]:inline">a</span>
                              <input
                                aria-label={`${day} cierre ${intervalIndex + 1}`}
                                className={fieldClass + " max-w-[140px] px-2! tabular-nums"}
                                type="time"
                                required
                                value={interval.end}
                                onChange={(event) =>
                                  updateDay(index, {
                                    ...config,
                                    intervals: config.intervals.map((item, i) =>
                                      i === intervalIndex
                                        ? { ...item, end: event.target.value }
                                        : item,
                                    ),
                                  })
                                }
                              />
                              <button
                                aria-label="Eliminar intervalo"
                                type="button"
                                disabled={config.intervals.length === 1}
                                className="col-start-2 row-span-2 row-start-1 grid h-11 w-11 place-items-center justify-self-end rounded-[10px] text-sarin-muted hover:bg-rose-50 hover:text-rose-700 disabled:opacity-30 @min-[24rem]:col-start-4 @min-[24rem]:row-span-1"
                                onClick={() =>
                                  updateDay(index, {
                                    ...config,
                                    intervals: config.intervals.filter(
                                      (_, i) => i !== intervalIndex,
                                    ),
                                  })
                                }
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            </div>
                          ))}
                        </div>
                        <button
                          type="button"
                          className="inline-flex min-h-11 shrink-0 items-center gap-1 rounded-[10px] px-1 text-xs text-sarin-blue transition hover:bg-sarin-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sarin-blue"
                          onClick={() =>
                            updateDay(index, {
                              ...config,
                              intervals: [
                                ...config.intervals,
                                { start: "18:00", end: "20:00" },
                              ],
                            })
                          }
                        >
                          <Plus aria-hidden="true" className="h-3.5 w-3.5" />
                          Añadir intervalo
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
          {!restrictedIntake && <section className="space-y-2">
            <label className="block text-xs text-sarin-muted">
              Preguntas obligatorias para reservar (una por línea)
              <textarea
                aria-label="Preguntas para reservar"
                className={fieldClass + " mt-1.5 min-h-20"}
                value={intake}
                maxLength={2000}
                placeholder="Escribe las preguntas que debe responder el cliente antes de reservar."
                onChange={(event) => setIntake(event.target.value)}
              />
            </label>
            <TextSuggestions
              label="Ejemplos de preguntas para reservar"
              value={intake}
              maxLength={2000}
              onChange={setIntake}
              suggestions={[
                { label: "Primera visita", value: "¿Es tu primera visita?" },
                { label: "Preferencia de profesional", value: "¿Tienes alguna preferencia de profesional?" },
                { label: "Servicio deseado", value: "¿Qué servicio te gustaría reservar?" },
                { label: "Día preferido", value: "¿Qué día prefieres para tu cita?" },
                { label: "Franja horaria", value: "¿Prefieres un horario de mañana o de tarde?" },
                { label: "Dudas del servicio", value: "¿Quieres aclarar algún detalle del servicio antes de reservar?" },
              ]}
            />
          </section>}
          {!health && <>
          <label className="block text-xs text-sarin-muted">
            Tono del asistente
            <input
              className={fieldClass + " mt-1.5"}
              value={tone}
              maxLength={150}
              onChange={(event) => setTone(event.target.value)}
            />
          </label>
          <section className="space-y-2">
            <label className="block text-xs text-sarin-muted">
              Indicaciones del negocio
              <textarea
                aria-label="Indicaciones del negocio"
                className={fieldClass + " mt-1.5 min-h-20"}
                value={rules}
                maxLength={3000}
                placeholder="Explica cómo quieres que Sarin atienda a tus clientes."
                onChange={(event) => setRules(event.target.value)}
              />
            </label>
            <TextSuggestions
              label="Ejemplos de indicaciones del negocio"
              value={rules}
              maxLength={3000}
              onChange={setRules}
              suggestions={[
                { label: "Confirmar detalles", value: "Confirma el servicio y el horario antes de reservar." },
                { label: "Ayuda del negocio", value: "Si el cliente necesita ayuda adicional, indícale cómo contactar directamente al negocio." },
                { label: "Ofrecer alternativas", value: "Si el horario solicitado no está disponible, ofrece otras opciones de la agenda." },
                { label: "Precios claros", value: "Informa el precio configurado del servicio antes de confirmar la reserva." },
                { label: "Completar información", value: "Si falta un dato para reservar, pregunta antes de continuar." },
                { label: "Datos sin configurar", value: "Si un dato del negocio no está configurado, indícalo y ofrece contactar al negocio." },
              ]}
            />
          </section>
          </>}
          <button className={buttonClass + " w-full"} disabled={saving}>
            {saving
              ? "Guardando…"
              : business?.sarinConfig.onboardingCompleted
                ? "Guardar configuración"
                : "Guardar y abrir mi agenda"}
          </button>
          </fieldset>
        </form>
      </div>
    </div>
  );
}
export default function OnboardingPage() {
  return (
    <AuthGate>
      <AppShell>
        <Configuration />
      </AppShell>
    </AuthGate>
  );
}
