"use client";

import type { Business } from '@/types/firestore';
import type { OwnerAgendaMode, OwnerAgendaRange, OwnerAgendaSnapshot } from '@/lib/owner-agenda';
import { useEffect, useRef } from 'react';
import { agendaToday, getOwnerAgendaDayLayout, getOwnerAgendaResources, getOwnerAgendaScale, OWNER_AGENDA_PIXELS_PER_HOUR, shiftAgendaDate } from '@/lib/owner-agenda';

export type OwnerAgendaCalendarProps = {
  business: Business; mode: OwnerAgendaMode; selectedDate: string; resourceId: string | null;
  range: OwnerAgendaRange | null; snapshot: OwnerAgendaSnapshot | null; loading: boolean; error: string | null; busy: boolean;
  onModeChange: (mode: OwnerAgendaMode) => void; onDateChange: (dateKey: string) => void;
  onResourceChange: (resourceId: string | null) => void; onRefresh: () => void;
};

const controlClass = 'min-h-11 min-w-0 rounded-xl border border-sarin-line bg-white px-3 py-2 text-sm text-sarin-ink outline-none transition hover:bg-sarin-soft focus-visible:ring-2 focus-visible:ring-sarin-blue disabled:opacity-50';
const minuteLabel = (minute: number) => `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(Math.floor(minute % 60)).padStart(2, '0')}`;
const dayLabel = (date: string) => new Intl.DateTimeFormat('es-CO', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(`${date}T12:00:00Z`));

export function OwnerAgendaCalendar({ business, mode, selectedDate, resourceId, range, snapshot, loading, error, busy, onModeChange, onDateChange, onResourceChange, onRefresh }: OwnerAgendaCalendarProps) {
  const focusDate = useRef<string | null>(null);
  useEffect(() => {
    if (focusDate.current === selectedDate) {
      focusDate.current = null;
      document.getElementById('owner-agenda-day-details')?.focus();
    }
  }, [selectedDate]);
  const days = error ? [] : snapshot?.days ?? [];
  const resources = getOwnerAgendaResources(business.resources, days);
  const visibleResources = resources.filter(resource => resourceId === null || resource.id === resourceId);
  const layouts = days.map(day => day.state === 'ready' ? getOwnerAgendaDayLayout(day.dateKey, day.appointments) : { blocks: [], warnings: {} });
  const scale = range ? getOwnerAgendaScale(business.weeklySchedule, range, layouts) : { startMinute: 480, endMinute: 1080 };
  const pixels = (minute: number) => minute * OWNER_AGENDA_PIXELS_PER_HOUR / 60;
  const height = pixels(scale.endMinute - scale.startMinute);
  const hours = Array.from({ length: (scale.endMinute - scale.startMinute) / 60 + 1 }, (_, index) => scale.startMinute + index * 60);
  const columns = mode === 'week' ? (range?.dates ?? []).map(dateKey => ({ dateKey, resource: resources.find(resource => resource.id === resourceId) })) : visibleResources.map(resource => ({ dateKey: selectedDate, resource }));
  const partial = days.some(day => day.state === 'error');
  const maximum = agendaToday(Date.now() + 366 * 86400000);
  const advance = (amount: number) => { if (!busy && range) onDateChange(shiftAgendaDate(selectedDate, amount)); };
  function selectDay(date: string) {
    if (busy || range?.outsideDates.includes(date)) return;
    if (date === selectedDate) document.getElementById('owner-agenda-day-details')?.focus();
    else focusDate.current = date;
    onDateChange(date);
  }
  return <section aria-label="Agenda visual del negocio" aria-busy={loading} className="sarin-paper min-w-0 overflow-hidden rounded-2xl border border-sarin-line bg-sarin-paper text-sarin-ink [color-scheme:light]">
    <header className="space-y-4 border-b border-sarin-line p-4 sm:p-6">
      <div><h2 className="text-xl font-semibold">Tu agenda</h2><p className="mt-2 text-xs text-sarin-muted">Hora de Colombia · Se actualiza automáticamente</p></div>
      <p className="text-xs font-medium text-sarin-blue">1. Elige día o semana</p>
      <div role="group" aria-label="Controles principales de agenda" className="flex min-w-0 flex-wrap items-end gap-3">
        <div className="flex rounded-xl border border-sarin-line bg-sarin-canvas p-1">{(['day', 'week'] as const).map(value => <button key={value} type="button" aria-pressed={mode === value} disabled={busy} onClick={() => { if (!busy) onModeChange(value); }} className={'min-h-11 rounded-lg px-5 py-2 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-sarin-blue disabled:opacity-50 ' + (mode === value ? 'bg-sarin-blue text-white shadow-sm' : 'text-sarin-muted hover:bg-sarin-soft')}>{value === 'day' ? 'Día' : 'Semana'}</button>)}</div>
        <label className="min-w-0 flex-1 basis-40 text-xs text-sarin-muted">Fecha de la agenda<input aria-label="Fecha de la agenda" type="date" value={selectedDate} max={maximum} disabled={busy} onChange={event => { if (!busy) onDateChange(event.target.value); }} className={controlClass + ' mt-1 block w-full'} /></label>
        <label className="min-w-0 flex-1 basis-56 text-xs text-sarin-muted">Profesional o estación<select aria-label="Profesional o estación de la agenda" value={resourceId ?? ''} disabled={busy || !resources.length} onChange={event => { if (!busy) onResourceChange(event.target.value || null); }} className={controlClass + ' mt-1 block w-full'}>{mode === 'day' && <option value="">Todos los recursos</option>}{mode === 'week' && !resourceId && <option value="" disabled>Selecciona un recurso</option>}{resources.map(resource => <option key={resource.id} value={resource.id}>{resource.label}</option>)}</select></label>
      </div>
      <div className="flex flex-wrap items-center gap-2" aria-label="Navegación y actualización de agenda">
        <button type="button" disabled={busy || !range} className={controlClass} onClick={() => advance(mode === 'week' ? -7 : -1)}>Anterior</button>
        <button type="button" disabled={busy || !range || shiftAgendaDate(selectedDate, mode === 'week' ? 7 : 1) > maximum} className={controlClass} onClick={() => advance(mode === 'week' ? 7 : 1)}>Siguiente</button>
        <button type="button" disabled={busy} className={controlClass} onClick={() => { if (!busy) onDateChange(agendaToday(Date.now())); }}>Hoy</button>
        <button type="button" disabled={busy} className={controlClass + ' sm:ml-auto'} onClick={() => { if (!busy) onRefresh(); }}>Actualizar</button>
      </div>
    </header>
    <div className="min-w-0 space-y-4 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-xs font-medium text-sarin-blue">2. Revisa la ocupación</p><a href="#owner-agenda-day-details" className="inline-flex min-h-11 items-center text-sm font-medium text-sarin-blue underline underline-offset-4">Ver citas del día</a></div>
      <p className="text-sm leading-6 text-sarin-muted">Los espacios sin bloques indican que no hay ocupación registrada en esta vista; no garantizan disponibilidad para reservar</p>
      <p aria-live="polite" className={'text-sm ' + (partial || error ? 'text-rose-800' : 'text-sarin-muted')}>{error ?? (loading ? 'Actualizando agenda…' : partial ? mode === 'week' ? 'Semana incompleta · Actualiza para volver a consultar los días con error.' : 'No pudimos cargar este día · Actualiza para intentarlo de nuevo.' : range ? `${mode === 'week' ? 'Semana' : 'Día'} · ${dayLabel(selectedDate)}` : 'Elige una fecha válida para consultar la agenda.')}</p>
      <details className="rounded-xl border border-sarin-line bg-white px-4"><summary className="min-h-11 cursor-pointer py-3 text-sm font-medium">Cómo leer la agenda</summary><ul className="space-y-2 pb-4 text-xs leading-6 text-sarin-muted"><li>Servicio: bloque azul con la duración registrada.</li><li>Preparación: margen guardado con trama, después del servicio.</li><li>Bloqueo: tiempo reservado por el negocio, en gris.</li><li>Horario del negocio: fondo suave como contexto, sin indicar disponibilidad.</li><li>Canceladas, completadas y ausencias: se conservan en las citas del día y no ocupan el gráfico.</li><li>Solo se consultan registros iniciados en la fecha de cada columna. Un error no significa que el día esté vacío.</li></ul></details>
      {range && !error && <>
        <div className="flex flex-wrap gap-2" aria-label="Resumen de ocupación">{columns.map((column, index) => {
          const day = days.find(day => day.dateKey === column.dateKey);
          const rows = day?.state === 'ready' ? day.appointments.filter(item => !column.resource || item.resourceId === column.resource.id) : [];
          const outside = range.outsideDates.includes(column.dateKey) || day?.state === 'outside';
          const state = outside ? 'Fuera del rango consultable' : day?.state === 'error' ? `No pudimos cargar este día · ${day.message}` : day?.state === 'ready' ? `${rows.length} registros · ${rows.filter(item => item.status === 'confirmed').length} confirmados` : 'Cargando este día…';
          return <div key={`${column.dateKey}:${column.resource?.id ?? index}`} className="min-w-0 flex-1 basis-44 rounded-xl border border-sarin-line bg-white p-3 text-xs"><p className="break-words font-medium [overflow-wrap:anywhere]">{mode === 'week' ? dayLabel(column.dateKey) : column.resource?.label}</p><p className="mt-1 leading-5 text-sarin-muted">{state}</p>{mode === 'week' && <button type="button" data-agenda-day={true} aria-pressed={selectedDate === column.dateKey} disabled={busy || outside} onClick={() => selectDay(column.dateKey)} className="mt-2 min-h-11 rounded-lg px-2 py-2 text-left font-medium text-sarin-blue outline-none hover:bg-sarin-soft focus-visible:ring-2 focus-visible:ring-sarin-blue disabled:opacity-50">Ver citas · {dayLabel(column.dateKey)}</button>}</div>;
        })}</div>
        {mode === 'week' && !resourceId && <p className="text-sm text-sarin-muted">No hay un recurso seleccionado para mostrar su ocupación semanal.</p>}
        {!columns.length ? <p className="py-4 text-sm text-sarin-muted">No hay recursos para mostrar en esta vista. Consulta los registros en las citas del día.</p> : <div role="region" aria-label="Gráfico de ocupación registrada" tabIndex={0} className="max-h-[420px] min-w-0 overflow-auto rounded-xl border border-sarin-line bg-white outline-none focus-visible:ring-2 focus-visible:ring-sarin-blue lg:max-h-[640px]">
          <div aria-hidden={true} style={{ minWidth: 48 + columns.length * 180 }}>
            <div className="sticky top-0 z-20 grid border-b border-sarin-line bg-sarin-paper" style={{ gridTemplateColumns: `48px repeat(${columns.length}, minmax(180px, 1fr))` }}><div className="px-1 py-3 text-[10px] text-sarin-muted">Hora</div>{columns.map((column, index) => <div key={index} className="min-w-0 border-l border-sarin-line px-3 py-3 text-xs font-medium"><p className="break-words [overflow-wrap:anywhere]">{mode === 'week' ? dayLabel(column.dateKey) : column.resource?.label}</p>{mode === 'week' && <p className="mt-1 break-words text-sarin-muted [overflow-wrap:anywhere]">{column.resource?.label ?? 'Sin recurso'}</p>}</div>)}</div>
            <div className="grid" style={{ gridTemplateColumns: `48px repeat(${columns.length}, minmax(180px, 1fr))` }}>
              <div className="relative bg-sarin-paper" style={{ height }}>{hours.map(minute => <span key={minute} className="absolute left-1 text-[10px] tabular-nums text-sarin-muted" style={{ top: Math.min(pixels(minute - scale.startMinute), height - 14) }}>{minuteLabel(minute)}</span>)}</div>
              {columns.map((column, index) => {
                const day = days.find(day => day.dateKey === column.dateKey);
                const layout = day?.state === 'ready' ? getOwnerAgendaDayLayout(column.dateKey, day.appointments) : null;
                const blocks = column.resource ? layout?.blocks.filter(block => block.resourceId === column.resource!.id) ?? [] : [];
                const outside = range.outsideDates.includes(column.dateKey) || day?.state === 'outside';
                const schedule = business.weeklySchedule[new Date(`${column.dateKey}T12:00:00Z`).getUTCDay()];
                return <div key={index} data-agenda-column={true} className="relative min-w-0 border-l border-sarin-line" style={{ height, backgroundImage: 'repeating-linear-gradient(to bottom, transparent 0, transparent 63px, #233e7c12 63px, #233e7c12 64px)' }}>
                  {day?.state === 'ready' && schedule?.isOpen && schedule.intervals.map((interval, intervalIndex) => {
                    const start = Number(interval.start.slice(0, 2)) * 60 + Number(interval.start.slice(3));
                    const end = Number(interval.end.slice(0, 2)) * 60 + Number(interval.end.slice(3));
                    const clippedStart = Math.max(scale.startMinute, start), clippedEnd = Math.min(scale.endMinute, end);
                    return Number.isFinite(start) && Number.isFinite(end) && clippedEnd > clippedStart ? <div key={intervalIndex} className="absolute inset-x-0 bg-sarin-soft/50" style={{ top: pixels(clippedStart - scale.startMinute), height: pixels(clippedEnd - clippedStart) }} /> : null;
                  })}
                  {(outside || day?.state !== 'ready') && <p className="relative p-3 text-xs leading-6 text-sarin-muted">{outside ? 'Fuera del rango consultable' : day?.state === 'error' ? 'No pudimos cargar este día' : 'Cargando este día…'}</p>}
                  {blocks.map(block => {
                    const appointment = day?.state === 'ready' ? day.appointments.find(item => item.id === block.appointmentId) : undefined;
                    const position = { left: `calc(${block.lane * 100 / block.laneCount}% + 2px)`, width: `calc(${100 / block.laneCount}% - 4px)` };
                    return <div key={block.appointmentId}>
                      <div data-agenda-service={block.appointmentId} className={'absolute overflow-hidden rounded-sm border-l-2 px-1 text-[10px] leading-3 ' + (block.manual ? 'border-sarin-muted bg-sarin-line text-sarin-ink' : 'border-sarin-blue bg-sarin-soft text-sarin-blue')} style={{ ...position, top: pixels(block.startMinute - scale.startMinute), height: pixels(block.serviceEndMinute - block.startMinute) }}><p>{minuteLabel(block.startMinute)} · {block.manual ? 'Bloqueo de agenda' : appointment?.serviceName || 'Servicio sin registrar'}</p><p>{column.resource?.label}</p></div>
                      {block.reservedEndMinute > block.serviceEndMinute && <div data-agenda-buffer={block.appointmentId} className="absolute overflow-hidden text-[9px] text-sarin-muted" style={{ ...position, top: pixels(block.serviceEndMinute - scale.startMinute), height: pixels(block.reservedEndMinute - block.serviceEndMinute), backgroundImage: 'repeating-linear-gradient(135deg, #233e7c18 0, #233e7c18 2px, transparent 2px, transparent 6px)' }}>Preparación</div>}
                    </div>;
                  })}
                </div>;
              })}
            </div>
          </div>
        </div>}
      </>}
    </div>
  </section>;
}
