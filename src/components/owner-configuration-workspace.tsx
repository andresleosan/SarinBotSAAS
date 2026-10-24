"use client";

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { buttonClass, Notice } from '@/components/app-shell';
import { OwnerConfigurationFields } from '@/components/owner-configuration-fields';
import type { OwnerConfigurationSession } from '@/components/owner-configuration-provider';
import type { BookingCapability } from '@/lib/booking-subject';
import type { BusinessConfig } from '@/lib/server/schemas';
import { configurationDifferences, configurationFingerprint, validateOwnerConfiguration, type ConfigurationDifference, type ConfigurationIssue, type OwnerConfigurationSection } from '@/lib/owner-configuration';
import type { Business } from '@/types/firestore';

export type OwnerConfigurationController = {
  session: OwnerConfigurationSession; dirty: boolean; configured: boolean; busy: boolean; writeBlocked: boolean; canSave: boolean;
  change: (next: BusinessConfig) => void; go: (section: OwnerConfigurationSection) => void; review: () => void;
  save: (reviewedExternalFingerprint?: string) => void; discard: () => void; checkOutcome: () => void; loadExternal: () => void;
};
const labels: Record<OwnerConfigurationSection, string> = { summary: 'Mi negocio', identity: 'Datos y contactos', resources: 'Personas o estaciones', services: 'Servicios', schedule: 'Horarios', assistant: 'Cómo responde Sarin', review: 'Revisión y guardado', logo: 'Logo' };
const steps: OwnerConfigurationSection[] = ['identity', 'resources', 'services', 'schedule', 'review'];
const fieldLabels: Record<string, string> = { name: 'Nombre', category: 'Categoría', slug: 'Enlace', phoneWhatsApp: 'WhatsApp', tone: 'Tono del asistente', customRules: 'Indicaciones del negocio', intakeFields: 'Preguntas para reservar', resources: 'Personas o estaciones', services: 'Servicios', socialLinks: 'Redes y sitio web', weeklySchedule: 'Horarios', location: 'Ubicación', mode: 'Modalidad', address: 'Dirección', instructions: 'Indicaciones de ubicación', durationMinutes: 'Duración (min)', bufferMinutes: 'Tiempo entre citas (min)', price: 'Precio COP', resourceIds: 'Disponible con', description: 'Descripción', label: 'Pregunta', required: 'Obligatoria', active: 'Activo', platform: 'Red', url: 'Enlace', isOpen: 'Abierto', intervals: 'Intervalos', start: 'Apertura', end: 'Cierre', id: 'Referencia', key: 'Referencia' };
const displayValue = (value: unknown): string => {
  if (value === undefined || value === null || value === '') return 'Sin configurar';
  if (typeof value === 'boolean') return value ? 'Sí' : 'No';
  if (Array.isArray(value)) return value.map(displayValue).join(' · ') || 'Sin configurar';
  if (typeof value === 'object') return Object.entries(value).map(([key, item]) => `${fieldLabels[key] ?? 'Detalle'}: ${displayValue(item)}`).join(' · ');
  if (value === 'at_business') return 'En el local';
  if (value === 'at_client') return 'A domicilio';
  if (value === 'online') return 'En línea';
  return String(value);
};
const differenceLabel = (path: string): string => {
  const parts = path.split('.');
  const position = /^\d+$/.test(parts[1] ?? '') ? ` ${Number(parts[1]) + 1}` : '';
  return `${fieldLabels[parts[0]] ?? 'Configuración'}${position}${parts.length > 2 ? ` · ${fieldLabels[parts.at(-1)!] ?? 'Detalle'}` : ''}`;
};
export function ConfigurationDifferences({ differences }: { differences: ConfigurationDifference[] }) {
  return <div className="space-y-3" aria-label="Diferencias de configuración">{differences.length === 0 ? <p>No hay diferencias en la configuración.</p> : [...new Set(differences.map(item => item.section))].map(section => <details key={section} className="min-w-0 rounded-xl border border-sarin-line p-3" open>
    <summary className="min-h-11 cursor-pointer py-2 font-semibold">{labels[section]}</summary>
    <dl className="space-y-3 text-sm">{differences.filter(item => item.section === section).map((item, index) => <div key={`${item.path}-${index}`} className="min-w-0 space-y-1 break-words"><dt className="text-sarin-muted">{differenceLabel(item.path)}</dt><dd><span className="font-medium">Antes: </span>{displayValue(item.before)}</dd><dd><span className="font-medium">Después: </span>{displayValue(item.after)}</dd></div>)}</dl>
  </details>)}</div>;
}
function ConfigurationSummary({ draft }: { draft: BusinessConfig }) {
  return <dl className="space-y-3 text-sm" aria-label="Resumen de configuración">
    <div><dt className="font-semibold">Datos y contactos</dt><dd className="break-words">{draft.name || 'Nombre pendiente'} · {draft.category || 'Categoría pendiente'}<br />{draft.slug || 'Enlace pendiente'} · {draft.phoneWhatsApp || 'WhatsApp pendiente'}</dd></div>
    <div><dt className="font-semibold">Modalidad y ubicación</dt><dd>{draft.location ? `${draft.location.mode === 'at_business' ? 'En el local' : draft.location.mode === 'at_client' ? 'A domicilio' : 'En línea'}${draft.location.mode === 'at_business' && draft.location.address ? ` · ${draft.location.address}` : ''}${draft.location.instructions ? ` · ${draft.location.instructions}` : ''}` : 'Sin publicar'}</dd></div>
    <div><dt className="font-semibold">Redes y sitio web</dt><dd className="break-words">{draft.socialLinks?.length ? draft.socialLinks.map(link => link.url).join(' · ') : 'Sin publicar'}</dd></div>
    <div><dt className="font-semibold">Personas o estaciones</dt><dd>{draft.resources.map(item => item.name || 'Sin nombre').join(', ')}</dd></div>
    <div><dt className="font-semibold">Servicios</dt><dd><ul className="space-y-1">{draft.services.map(item => <li key={item.id}>{item.name || 'Sin nombre'} · {item.durationMinutes} min · {item.price.toLocaleString('es-CO')} COP · preparación {item.bufferMinutes} min{item.description ? ` · ${item.description}` : ''}{item.category ? ` · ${item.category}` : ''}</li>)}</ul></dd></div>
    <div><dt className="font-semibold">Horarios · Colombia</dt><dd>{Object.values(draft.weeklySchedule).every(day => !day.isOpen) ? 'Todos los días cerrados. No hay disponibilidad publicada.' : <ul>{Object.entries(draft.weeklySchedule).map(([day, value]) => <li key={day}>{['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'][Number(day)]}: {value.isOpen ? value.intervals.map(interval => `${interval.start}–${interval.end}`).join(', ') : 'Cerrado'}</li>)}</ul>}</dd></div>
  </dl>;
}
export function OwnerConfigurationWorkspace({ business: _business, capability, policyReady, consentActive, controller, assistantScope, logo, assistant }: {
  business: Business; capability: BookingCapability | null; policyReady: boolean; consentActive: boolean; controller: OwnerConfigurationController; assistantScope?: ReactNode; logo: ReactNode; assistant: ReactNode;
}) {
  const { session, configured, busy, writeBlocked } = controller;
  const { section, draft } = session;
  const [mountedWithDirtyDraft] = useState(controller.dirty);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [confirmLoad, setConfirmLoad] = useState(false);
  const [reviewExternal, setReviewExternal] = useState(false);
  const [reviewedExternal, setReviewedExternal] = useState<string>();
  const [localIssues, setLocalIssues] = useState<ConfigurationIssue[]>([]);
  const root = useRef<HTMLDivElement>(null);
  const title = useRef<HTMLHeadingElement>(null);
  const errorSummary = useRef<HTMLDivElement>(null);
  const issues = session.issues.length ? session.issues : localIssues;
  const issuesKey = JSON.stringify(issues);
  const externalFingerprint = session.external ? configurationFingerprint(session.external) : undefined;
  const blocked = busy || writeBlocked || !policyReady || !capability || !consentActive;
  const health = capability?.dataMode === 'health';
  useEffect(() => { setAssistantOpen(false); title.current?.focus(); }, [section]);
  useEffect(() => { setReviewExternal(false); setReviewedExternal(undefined); }, [externalFingerprint]);
  useEffect(() => { if (issues.length && issues[0].section !== section) controller.go(issues[0].section); }, [issuesKey]); // Reveal a new validation result before attempting focus.
  useEffect(() => {
    if (!issues.length || issues[0].section !== section) return;
    const path = issues[0].path;
    const label = path === 'phoneWhatsApp' ? 'Número de WhatsApp' : path === 'location.address' ? 'Dirección del local' : path === 'location.instructions' ? 'Indicaciones de ubicación' : path.startsWith('location') ? 'Modalidad de atención' : undefined;
    const field = root.current?.querySelector<HTMLElement>(`[data-configuration-path="${path}"]`)
      ?? (label ? root.current?.querySelector<HTMLElement>(`[aria-label="${label}"]`) : null)
      ?? (path.startsWith('socialLinks') ? root.current?.querySelector<HTMLElement>('[data-configuration-group="socialLinks"] input, [data-configuration-group="socialLinks"] select, [data-configuration-group="socialLinks"] button') : null);
    if (field) { let parent = field.parentElement; while (parent && parent !== root.current) { if (parent instanceof HTMLDetailsElement) parent.open = true; parent = parent.parentElement; } field.focus(); }
    else errorSummary.current?.focus();
  }, [section, issuesKey]);
  const navigate = (next: OwnerConfigurationSection) => { setAssistantOpen(false); setLocalIssues([]); controller.go(next); };
  const continueStep = () => {
    if (blocked || !capability) return;
    const found = validateOwnerConfiguration(draft, capability, section);
    setLocalIssues(found);
    if (found.length) return;
    if (section === 'schedule') controller.review();
    else controller.go(steps[steps.indexOf(section) + 1] ?? 'review');
  };
  const save = () => {
    if (blocked || !controller.canSave || !capability) return;
    const found = validateOwnerConfiguration(draft, capability);
    setLocalIssues(found);
    if (!found.length) controller.save(reviewedExternal);
  };
  return <div ref={root} className="max-w-3xl min-w-0 space-y-5">
    <header className="space-y-2"><p className="text-xs uppercase tracking-widest text-sarin-blue">Configuración</p><h1 className="text-3xl font-bold">{configured ? 'Mi negocio' : 'Configura tu negocio'}</h1><p className="text-sm text-sarin-muted">{configured ? 'Elige una sección, revisa los cambios y guarda la configuración completa.' : 'Completa los datos y la agenda de tu negocio; revisa todo antes de guardar.'}</p></header>
    {!configured && <ol aria-label="Etapas de configuración" className="flex flex-wrap gap-3 text-sm"><li>1. Tu negocio</li><li>2. Tu agenda</li><li>3. Revisión y guardado</li></ol>}
    {controller.dirty && <p role="status" className="text-sm text-sarin-muted">{mountedWithDirtyDraft ? 'Tienes cambios sin guardar de esta visita' : 'Cambios sin guardar'}</p>}
    {session.error && <Notice error>{session.error}</Notice>}
    {session.phase === 'saved' && <Notice>Configuración guardada. Los cambios ya se reflejan en tu página de reservas.</Notice>}
    {session.pendingCommand && <section className="space-y-3 rounded-xl border border-sarin-line p-4" aria-label="Estado del guardado"><p role="status">{session.phase === 'uncertain' ? 'No pudimos confirmar el resultado de la petición. Puedes consultar la configuración actual, pero no volver a guardar desde esta sesión.' : session.pendingCommand.slow ? 'El guardado está tardando. Seguimos esperando la respuesta de esta petición' : 'Guardando configuración…'}</p><button type="button" className={buttonClass} onClick={controller.checkOutcome}>Consultar configuración actual</button>{session.pendingCommand.observedCurrent && <><p>{configurationFingerprint(session.pendingCommand.observedCurrent) === session.pendingCommand.fingerprint ? 'La configuración actual coincide con lo enviado; no pudimos confirmar el resultado de la petición' : 'La configuración actual difiere de lo enviado. Esta consulta no confirma el resultado de la petición.'}</p><ConfigurationDifferences differences={configurationDifferences(session.pendingCommand.payload, session.pendingCommand.observedCurrent)} /></>}</section>}
    {session.external && !session.pendingCommand && <section className="space-y-3 rounded-xl border border-sarin-line p-4" aria-label="Actualización externa"><p>La configuración publicada cambió en otra vista. Revisa las diferencias antes de guardar</p><div className="flex flex-wrap gap-2"><button type="button" className={buttonClass} disabled={blocked} onClick={() => setConfirmLoad(true)}>Cargar la configuración actual</button><button type="button" className={buttonClass} disabled={blocked} onClick={() => setReviewExternal(true)}>Conservar mi borrador y revisar diferencias</button></div>{confirmLoad && <div><p>Se descartarán los cambios de configuración de esta visita.</p><button type="button" className={buttonClass} disabled={blocked} onClick={() => { controller.loadExternal(); setConfirmLoad(false); }}>Descartar borrador y cargar configuración actual</button><button type="button" className={buttonClass} onClick={() => setConfirmLoad(false)}>Continuar editando</button></div>}{reviewExternal && <><ConfigurationDifferences differences={configurationDifferences(session.external, draft)} /><button type="button" className={buttonClass} disabled={blocked} onClick={() => { setReviewedExternal(externalFingerprint); controller.review(); }}>He revisado las diferencias</button></>}</section>}
    {issues.length > 0 && <div ref={errorSummary} tabIndex={-1} role="alert" className="rounded-xl border border-rose-200 p-3 text-sm text-rose-700"><p>Revisa estos campos antes de continuar:</p><ul>{issues.map((issue, index) => <li key={`${issue.path}-${index}`}><button type="button" className="min-h-11 text-left underline" onClick={() => controller.go(issue.section)}>{issue.message}</button></li>)}</ul></div>}
    {configured && <nav aria-label="Secciones de Mi negocio" className="flex flex-wrap gap-2">{([['identity', 'Datos y contactos'], ['resources', 'Servicios y recursos'], ['schedule', 'Horarios'], ['assistant', 'Cómo responde Sarin'], ['logo', 'Logo']] as const).map(([target, label]) => <button type="button" key={target} className={buttonClass} aria-current={section === target ? 'page' : undefined} onClick={() => navigate(target)}>{label}</button>)}</nav>}
    {section === 'summary' && !configured && <section className="space-y-4 rounded-2xl border border-sarin-line bg-sarin-paper p-5"><p>Ten a mano el nombre, WhatsApp, servicios, personas o estaciones y horarios de atención.</p><div className="flex flex-wrap gap-3"><button type="button" className={buttonClass} disabled={blocked} onClick={() => navigate('identity')}>Configurar manualmente</button>{policyReady && capability && !health && <button type="button" className={buttonClass} disabled={blocked} onClick={() => setAssistantOpen(true)}>Preparar con Sarin</button>}</div></section>}
    {assistantOpen && policyReady && capability && !health ? <section className="space-y-3"><button type="button" className={buttonClass} onClick={() => { setAssistantOpen(false); if (section === 'summary') controller.go('identity'); }}>Volver a la configuración manual</button>{assistant}</section> : <>
      {section === 'summary' && configured && <ConfigurationSummary draft={draft} />}
      {section !== 'summary' && section !== 'logo' && <form noValidate aria-label="Datos de tu negocio" onSubmit={event => { event.preventDefault(); if (section === 'review') save(); else continueStep(); }} className="space-y-5 rounded-2xl border border-sarin-line bg-sarin-paper p-4 sm:p-5">
        <h2 ref={title} tabIndex={-1} className="text-xl font-semibold">{!configured && ['resources', 'services', 'schedule'].includes(section) ? `Tu agenda · ${labels[section]}` : !configured && section === 'identity' ? 'Tu negocio' : labels[section]}</h2>
        {!configured && section === 'review' && <button type="button" className={buttonClass} onClick={() => navigate('schedule')}>Atrás</button>}
        {section === 'schedule' && configured && <a href="/dashboard/schedule" target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center text-sarin-blue underline">Turnos y cierres (abre en otra pestaña; tu borrador se conserva aquí)</a>}
        {configured && (section === 'resources' || section === 'services') && <nav aria-label="Servicios y recursos" className="flex flex-wrap gap-2"><button type="button" className={buttonClass} aria-current={section === 'resources' ? 'page' : undefined} onClick={() => navigate('resources')}>Personas o estaciones</button><button type="button" className={buttonClass} aria-current={section === 'services' ? 'page' : undefined} onClick={() => navigate('services')}>Servicios</button></nav>}
        {section === 'review' ? <><ConfigurationSummary draft={draft} /><p className="text-sm font-medium">Al guardar, estos datos aparecerán en tu página de reservas</p><p className="text-sm text-sarin-muted">Se guarda toda la configuración. Una edición simultánea desde otra vista puede sobrescribirse.</p><button type="button" className={buttonClass} onClick={() => navigate('assistant')}>Cómo responde Sarin</button><button type="submit" className={buttonClass} disabled={blocked || !controller.canSave || Boolean(session.external && reviewedExternal !== externalFingerprint)}>{reviewedExternal ? 'Guardar mi configuración completa sobre la actual' : 'Guardar configuración'}</button></> : <>
          {policyReady && capability ? <OwnerConfigurationFields section={section} draft={draft} capability={capability} configured={configured} disabled={blocked} issues={issues} onChange={next => { if (!blocked) controller.change(next); }} /> : <Notice>Comprobando las opciones de configuración…</Notice>}
          {section === 'assistant' && policyReady && capability && assistantScope}
          {section === 'assistant' && policyReady && capability && !health && <button type="button" className={buttonClass} disabled={blocked} onClick={() => setAssistantOpen(true)}>Preparar con Sarin</button>}
          {!configured && steps.includes(section) && <div className="flex flex-wrap gap-2"><button type="button" className={buttonClass} onClick={() => navigate(section === 'identity' ? 'summary' : steps[steps.indexOf(section) - 1])}>Atrás</button><button type="button" className={buttonClass} disabled={blocked} onClick={continueStep}>Continuar</button></div>}
        </>}
        {section !== 'review' && <button type="button" className={buttonClass} disabled={blocked} onClick={controller.review}>Revisar cambios</button>}
      </form>}
    </>}
    <section aria-label="Logo del negocio" hidden={section !== 'logo' || assistantOpen} inert={section !== 'logo' || assistantOpen} className="space-y-3 rounded-2xl border border-sarin-line bg-sarin-paper p-4"><h2 className="text-xl font-semibold">Logo</h2><p className="text-sm text-sarin-muted">El logo se guarda por separado. Cancelar esta configuración no revierte el logo guardado. Salir de esta página puede perder la selección de archivo sin guardar.</p>{logo}</section>
    {!configured && section !== 'summary' && <button type="button" className={buttonClass} onClick={() => navigate(section === 'logo' ? 'identity' : 'logo')}>{section === 'logo' ? 'Volver a los datos del negocio' : 'Logo'}</button>}
    {(section !== 'summary' || configured) && <button type="button" className={buttonClass} disabled={blocked} onClick={() => setConfirmDiscard(true)}>Cancelar edición</button>}
    {confirmDiscard && <section className="space-y-3" aria-label="Confirmar descarte"><p>¿Descartar los cambios de configuración de esta visita? El logo guardado se conserva.</p><div className="flex flex-wrap gap-2"><button type="button" className={buttonClass} onClick={() => setConfirmDiscard(false)}>Continuar editando</button><button type="button" className={buttonClass} disabled={blocked} onClick={() => { if (!blocked) { controller.discard(); setConfirmDiscard(false); } }}>Descartar cambios de configuración</button></div></section>}
  </div>;
}
