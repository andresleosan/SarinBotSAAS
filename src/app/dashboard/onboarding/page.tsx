"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Plus, Send, Trash2 } from "lucide-react";
import { SarinMark } from "@/components/sarin-brand";
import { AuthGate } from "@/components/auth-provider";
import {
  AppShell,
  Notice,
  buttonClass,
  fieldClass,
} from "@/components/app-shell";
import { useBusiness } from "@/hooks/useBusiness";
import { useDebouncedChat } from "@/hooks/useDebouncedChat";
import { apiFetch, errorMessage } from "@/lib/client/api";
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

function Configuration() {
  const { business, loading, error: businessError } = useBusiness();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [category, setCategory] = useState("");
  const [phone, setPhone] = useState("");
  const [tone, setTone] = useState("Cercano y profesional");
  const [rules, setRules] = useState("");
  const [intake, setIntake] = useState("");
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
  const [input, setInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const loadedVersion = useRef("");
  useEffect(() => {
    if (!business) return;
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
    ]);
    if (loadedVersion.current === version) return;
    loadedVersion.current = version;
    setName(business.name);
    setSlug(business.slug);
    setCategory(business.category);
    setPhone(business.phoneWhatsApp);
    setTone(business.sarinConfig.tone);
    setRules(business.sarinConfig.customRules);
    setIntake(
      business.sarinConfig.intakeFields.map((item) => item.label).join("\n"),
    );
    setResources(business.resources);
    setServices(business.services);
    setSchedule(business.weeklySchedule);
  }, [business]);
  const chat = useDebouncedChat({
    mode: "sarin_onboarding",
    tenantId: business?.id || "onboarding",
    onToolExecuted: (toolName, result) => {
      if (toolName === "guardar_estructura_negocio" && result.business) setSaved(true);
    },
  });
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSaved(false);
    setSaving(true);
    try {
      await apiFetch<{ business: Business }>("/api/businesses", {
        method: "POST",
        body: JSON.stringify({
          name,
          slug,
          category,
          phoneWhatsApp: phone,
          tone,
          customRules: rules,
          resources,
          services,
          weeklySchedule: schedule,
          intakeFields: intake
            .split("\n")
            .map((label) => label.trim())
            .filter(Boolean)
            .map(
              (label) =>
                business?.sarinConfig.intakeFields.find(
                  (field) => field.label === label,
                ) ?? {
                  key: `dato_${crypto.randomUUID()}`,
                  label,
                  required: true,
                },
            ),
        }),
      });
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
  return (
    <div className="space-y-5">
      <div>
        <p className="text-xs uppercase tracking-widest text-sarin-blue">
          Configuración
        </p>
        <h1 className="mt-2 text-3xl font-bold">
          {business ? "Así trabaja tu negocio" : "Abre tu isla privada"}
        </h1>
        <p className="mt-2 text-sm text-sarin-muted">
          Cuéntaselo a Sarin o completa los datos. Los negocios nuevos reciben 7
          días de prueba al guardar su configuración.
        </p>
      </div>
      {error && <Notice error>{error}</Notice>}
      {saved && (
        <Notice>
          Configuración guardada. Tu enlace y agenda ya están disponibles en el
          panel.
        </Notice>
      )}
      <div className="grid items-start gap-5 xl:grid-cols-[minmax(17rem,0.7fr)_minmax(0,1.3fr)]">
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
              profesionales y horarios. Revisa los datos antes de pedirle a
              Sarin que guarde la configuración.
            </p>
            {chat.messages.map((message) => (
              <div
                key={message.id}
                className={`whitespace-pre-wrap break-words rounded-xl p-3 text-sm leading-6 ${message.role === "user" ? "ml-5 bg-sarin-blue text-white" : "mr-5 bg-sarin-canvas text-sarin-ink"}`}
              >
                {message.content}
              </div>
            ))}
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
                  disabled={chat.isGenerating}
                >
                  {chat.quotaExhausted ? "Comprobar disponibilidad" : "Reintentar mensaje"}
                </button>}
              </div>
            )}
          </div>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (input.trim() && !chat.quotaExhausted) {
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
              disabled={chat.quotaExhausted}
              maxLength={8000}
              onChange={(event) => setInput(event.target.value)}
              placeholder="Cuéntale cómo trabajas…"
            />
            <button
              aria-label="Enviar mensaje"
              className={buttonClass}
              disabled={!input.trim() || chat.quotaExhausted || (Boolean(chat.error) && !chat.requestAlreadyCompleted)}
            >
              <Send className="h-4 w-4" />
            </button>
          </form>
        </section>
        <form
          className="@container min-w-0 space-y-5 rounded-2xl border border-sarin-line bg-sarin-paper p-4 sm:p-5"
          onSubmit={(event) => void save(event)}
        >
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
                  if (!business) setSlug(slugify(event.target.value));
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
              Enlace /b/
              <input
                className={fieldClass + " mt-1.5"}
                value={slug}
                readOnly={Boolean(business)}
                required
                pattern="[a-z0-9]+(-[a-z0-9]+)*"
                minLength={3}
                maxLength={70}
                onChange={(event) => setSlug(event.target.value)}
              />
              {business && (
                <span className="mt-1.5 block text-sarin-muted">
                  El enlace queda reservado a tu negocio.
                </span>
              )}
            </label>
            <label className="text-xs text-sarin-muted">
              WhatsApp (código de país y número)
              <input
                className={fieldClass + " mt-1.5"}
                value={phone}
                type="tel"
                required
                pattern="[+]?[1-9][0-9]{7,14}"
                maxLength={20}
                onChange={(event) => setPhone(event.target.value)}
              />
            </label>
          </div>
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
                <div className="grid grid-cols-2 gap-3 @min-[24rem]:grid-cols-3">
                  {(
                    [
                      ["durationMinutes", "Duración (min)", 5],
                      ["bufferMinutes", "Limpieza (min)", 0],
                      ["price", "Precio COP", 0],
                    ] as const
                  ).map(([key, label, minimum]) => (
                    <label className="text-xs text-sarin-muted" key={key}>
                      {label}
                      <input
                        className={fieldClass + " mt-1.5"}
                        type="number"
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
                    className="grid gap-x-4 py-2 @min-[32rem]:grid-cols-[8rem_minmax(0,1fr)]"
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
                      <div className="min-w-0 space-y-1">
                        {config.intervals.map((interval, intervalIndex) => (
                          <div
                            key={intervalIndex}
                            className="grid grid-cols-[minmax(0,1fr)_44px] items-center gap-1.5 @min-[24rem]:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_44px]"
                          >
                            <input
                              aria-label={`${day} apertura ${intervalIndex + 1}`}
                              className={fieldClass + " px-2!"}
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
                              className={fieldClass + " px-2!"}
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
                        <button
                          type="button"
                          className="min-h-11 text-xs text-sarin-blue"
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
                          Añadir intervalo
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
          <label className="block text-xs text-sarin-muted">
            Preguntas obligatorias para reservar (una por línea)
            <textarea
              className={fieldClass + " mt-1.5 min-h-20"}
              value={intake}
              maxLength={2000}
              onChange={(event) => setIntake(event.target.value)}
            />
          </label>
          <label className="block text-xs text-sarin-muted">
            Tono del asistente
            <input
              className={fieldClass + " mt-1.5"}
              value={tone}
              maxLength={150}
              onChange={(event) => setTone(event.target.value)}
            />
          </label>
          <label className="block text-xs text-sarin-muted">
            Indicaciones del negocio
            <textarea
              className={fieldClass + " mt-1.5 min-h-20"}
              value={rules}
              maxLength={3000}
              onChange={(event) => setRules(event.target.value)}
            />
          </label>
          <button className={buttonClass + " w-full"} disabled={saving}>
            {saving
              ? "Guardando…"
              : business
                ? "Guardar configuración"
                : "Guardar y activar mis 7 días"}
          </button>
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
