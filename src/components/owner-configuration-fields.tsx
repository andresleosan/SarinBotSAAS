"use client";

import type { SetStateAction } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { fieldClass } from '@/components/app-shell';
import { WhatsAppPhoneField } from '@/components/whatsapp-phone-field';
import { BusinessSocialFields } from '@/components/business-social-fields';
import { BusinessLocationEditor } from '@/components/business-location-editor';
import { TextSuggestions } from '@/components/text-suggestions';
import type { BookingCapability } from '@/lib/booking-subject';
import type { BusinessConfig } from '@/lib/server/schemas';
import type { OwnerConfigurationSection, ConfigurationIssue } from '@/lib/owner-configuration';
import { SERVICE_CATEGORY_MAX_LENGTH, SERVICE_DESCRIPTION_MAX_LENGTH } from '@/lib/service-catalog';
import type { DaySchedule } from '@/types/firestore';

const days = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
const slugify = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 70);
export function OwnerConfigurationFields({ section, draft, capability, disabled, issues, onChange, configured = false }: {
  section: OwnerConfigurationSection; draft: BusinessConfig; capability: BookingCapability; disabled: boolean; issues: ConfigurationIssue[]; onChange: (next: BusinessConfig) => void; configured?: boolean;
}) {
  const { name, slug, category, phoneWhatsApp: phone, socialLinks = [], location = null, tone, customRules: rules, resources, services, weeklySchedule: schedule } = draft;
  const health = capability.dataMode === 'health';
  const restrictedIntake = health || capability.representedMinorsEnabled;
  const intake = draft.intakeFields.map(field => field.label).join('\n');
  const update = <K extends keyof BusinessConfig>(key: K, next: SetStateAction<BusinessConfig[K]>) => {
    if (!disabled) onChange({ ...draft, [key]: typeof next === 'function' ? (next as (value: BusinessConfig[K]) => BusinessConfig[K])(draft[key]) : next });
  };
  const setSlug = (value: string) => update('slug', value);
  const setCategory = (value: string) => update('category', value);
  const setPhone = (value: string) => update('phoneWhatsApp', value);
  const setSocialLinks = (value: NonNullable<BusinessConfig['socialLinks']>) => update('socialLinks', value);
  const setLocation = (value: NonNullable<BusinessConfig['location']> | null) => update('location', value);
  const setTone = (value: string) => update('tone', value);
  const setRules = (value: string) => update('customRules', value);
  const setIntake = (value: string) => {
    const used = new Set<string>();
    update('intakeFields', (value === '' ? [] : value.split('\n')).map((label, index) => {
      const existing = draft.intakeFields.find(field => field.label === label && !used.has(field.key))
        ?? (draft.intakeFields[index] && !used.has(draft.intakeFields[index].key) ? draft.intakeFields[index] : undefined);
      const field = existing ? { ...existing, label } : { key: `dato_${crypto.randomUUID()}`, label, required: true };
      used.add(field.key);
      return field;
    }));
  };
  const setResources = (value: SetStateAction<BusinessConfig['resources']>) => update('resources', value);
  const setServices = (value: SetStateAction<BusinessConfig['services']>) => update('services', value);
  const updateDay = (index: number, value: DaySchedule) => update('weeklySchedule', { ...schedule, [index]: value });
  return <fieldset aria-label="Campos de configuración" disabled={disabled} className="@container min-w-0 space-y-5">
    {issues.filter(issue => issue.section === section).map((issue, index) => <p role="alert" key={`${issue.path}-${index}`} className="text-sm text-rose-700">{issue.message}</p>)}
    {section === 'assistant' && health && <p className="text-sm text-sarin-muted">Las reservas de salud usan formulario sin IA. No incluyas información de pacientes en el catálogo.</p>}
          {section === 'identity' && <><div className="grid gap-3 sm:grid-cols-2">
            <label className="text-xs text-sarin-muted">
              Nombre
              <input
                className={fieldClass + " mt-1.5"}
                aria-label="Nombre" data-configuration-path="name" value={name}
                required
                maxLength={120}
                onChange={(event) => {
                  onChange({ ...draft, name: event.target.value, ...(!configured ? { slug: slugify(event.target.value) } : {}) });
                }}
              />
            </label>
            <label className="text-xs text-sarin-muted">
              Categoría
              <input
                className={fieldClass + " mt-1.5"}
                aria-label="Categoría" data-configuration-path="category" value={category}
                required
                maxLength={100}
                onChange={(event) => setCategory(event.target.value)}
              />
            </label>
            <label className="text-xs text-sarin-muted">
              Enlace
              <input
                className={fieldClass + " mt-1.5"}
                aria-label="Enlace" data-configuration-path="slug" value={slug}
                readOnly={Boolean(configured)}
                required
                pattern="[a-z0-9]+(-[a-z0-9]+)*"
                minLength={3}
                maxLength={70}
                onChange={(event) => setSlug(event.target.value)}
              />
              {configured && (
                <span className="mt-1.5 block text-sarin-muted">
                  El enlace queda reservado a tu negocio.
                </span>
              )}
            </label>
            <WhatsAppPhoneField value={phone} onChange={setPhone} />
          </div>
          <details open={issues.some(issue => issue.path.startsWith('socialLinks') || issue.path.startsWith('location')) || undefined}><summary className="min-h-11 cursor-pointer py-3 text-sm text-sarin-blue">Modalidad, dirección y redes (opcional)</summary><div className="space-y-4">
          <div data-configuration-group="socialLinks"><BusinessSocialFields value={socialLinks} onChange={setSocialLinks} /></div>
          <div data-configuration-group="location"><BusinessLocationEditor value={location} onChange={setLocation} /></div>
          </div></details></>}
          {section === 'resources' && <section className="space-y-2">
            <h3 className="font-semibold">Personas o estaciones</h3>
            {resources.map((resource, index) => (
              <div key={resource.id} className="flex gap-2">
                <input
                  aria-label={`Nombre del recurso ${index + 1}`}
                  className={fieldClass}
                  data-configuration-path={`resources.${index}.name`} value={resource.name}
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
                    onChange({ ...draft, resources: rest, services: services.map(service => {
                      const remaining = service.resourceIds.filter(id => id !== resource.id);
                      return { ...service, resourceIds: remaining.length ? remaining : rest.map(item => item.id) };
                    }) });
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
          }
          {section === 'services' && <section className="space-y-2">
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
                    data-configuration-path={`services.${index}.name`} value={service.name}
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
                    data-configuration-path={`services.${index}.description`}
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
                    data-configuration-path={`services.${index}.category`}
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
                        aria-label={`${label} del servicio ${index + 1}`} data-configuration-path={`services.${index}.${key}`} value={service[key]}
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
                <fieldset tabIndex={-1} data-configuration-path={`services.${index}.resourceIds`} className="flex flex-wrap gap-x-3 gap-y-1">
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
          </section>}
          {section === 'schedule' && <section className="space-y-2">
            <h3 className="font-semibold">Horarios · Colombia</h3>
            <div className="divide-y divide-sarin-line border-y border-sarin-line">
              {days.map((day, index) => {
                const config = schedule[String(index) as keyof BusinessConfig['weeklySchedule']] ?? {
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
                                data-configuration-path={`weeklySchedule.${index}.intervals.${intervalIndex}.start`} value={interval.start}
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
                                data-configuration-path={`weeklySchedule.${index}.intervals.${intervalIndex}.end`} value={interval.end}
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
          }
          {section === 'assistant' && <>
          {!restrictedIntake && <section className="space-y-2">
            <label className="block text-xs text-sarin-muted">
              Preguntas obligatorias para reservar (una por línea)
              <textarea
                aria-label="Preguntas para reservar"
                className={fieldClass + " mt-1.5 min-h-20"}
                data-configuration-path="intakeFields" value={intake}
                maxLength={2000}
                placeholder="Escribe las preguntas que debe responder el cliente antes de reservar."
                onChange={(event) => setIntake(event.target.value)}
              />
            </label>
            <details><summary className="min-h-11 cursor-pointer py-3 text-sm text-sarin-blue">Ver ejemplos</summary><TextSuggestions
              label="Ejemplos de preguntas para reservar"
              data-configuration-path="intakeFields" value={intake}
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
            /></details>
          </section>}
          {!health && <>
          <label className="block text-xs text-sarin-muted">
            Tono del asistente
            <input
              className={fieldClass + " mt-1.5"}
              aria-label="Tono del asistente" data-configuration-path="tone" value={tone}
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
                data-configuration-path="customRules" value={rules}
                maxLength={3000}
                placeholder="Explica cómo quieres que SarinBot atienda a tus clientes."
                onChange={(event) => setRules(event.target.value)}
              />
            </label>
            <details><summary className="min-h-11 cursor-pointer py-3 text-sm text-sarin-blue">Ver ejemplos</summary><TextSuggestions
              label="Ejemplos de indicaciones del negocio"
              data-configuration-path="customRules" value={rules}
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
            /></details>
          </section>
          </>}
          </>}
  </fieldset>;
}
