"use client";
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { buttonClass, fieldClass } from '@/components/app-shell';
import { operationPresetRange, type OperationRange, type OwnerOperationSummary } from '@/lib/owner-operation-summary';
export type OwnerOperationSummaryPanelProps = {
  summary: OwnerOperationSummary | null; appliedRange: OperationRange | null; loading: boolean; error: string | null; capacityError: boolean;
  onQuery: (range: OperationRange) => void; onRefresh: () => void; onPreset: (preset: 'today' | '7days' | '30days') => void;
  disabled?: boolean;
};
export function OwnerOperationSummaryPanel({ summary, appliedRange, loading, error, capacityError, onQuery, onRefresh, onPreset, disabled = false }: OwnerOperationSummaryPanelProps) {
  const [draft, setDraft] = useState<OperationRange>(() => { try { return operationPresetRange('7days', Date.now()); } catch { return { from: '', through: '' }; } });
  const [editing, setEditing] = useState(false), focusPending = useRef(false), resultRef = useRef<HTMLElement>(null), errorRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (appliedRange && !editing) setDraft({ ...appliedRange }); }, [appliedRange?.from, appliedRange?.through, editing]);
  useEffect(() => {
    if (loading || !focusPending.current || (!summary && !error)) return;
    focusPending.current = false; if (error) errorRef.current?.focus(); else resultRef.current?.focus();
  }, [summary, error, loading]);
  const run = (action: () => void) => { focusPending.current = true; setEditing(false); action(); };
  const shown = !loading && !error ? summary : null;
  return <div className="max-w-4xl min-w-0 space-y-5">
    <div><h1 className="text-3xl font-bold">Resumen operativo</h1><p className="mt-2 text-sm text-sarin-muted">Consulta el estado actual de las citas por su fecha guardada, en Colombia.</p></div>
    <fieldset disabled={disabled} className="min-w-0 space-y-3 rounded-xl border border-sarin-line p-4"><legend className="px-1 font-semibold">Periodo de consulta</legend>
      <div className="flex flex-wrap gap-3">{([['today', 'Hoy'], ['7days', '7 días'], ['30days', '30 días']] as const).map(([preset, label]) => <button type="button" key={preset} className={buttonClass} onClick={() => run(() => onPreset(preset))}>{label}</button>)}</div>
      <div className="flex flex-wrap items-end gap-3">{(['from', 'through'] as const).map(field => <label key={field} className="min-w-0 flex-1 space-y-1"><span className="block text-sm font-medium">{field === 'from' ? 'Desde' : 'Hasta'}</span><input type="date" aria-label={field === 'from' ? 'Desde' : 'Hasta'} className={`${fieldClass} min-h-11 w-full min-w-0`} value={draft[field]} onChange={event => { setEditing(true); setDraft({ ...draft, [field]: event.target.value }); }} /></label>)}<button type="button" className={buttonClass} onClick={() => run(() => onQuery({ ...draft }))}>Consultar</button><button type="button" className={buttonClass} onClick={() => run(onRefresh)}>Actualizar</button></div>
      <p className="text-sm text-sarin-muted">Entre 1 y 31 días, desde hace 365 días hasta hoy. Editar estas fechas no cambia el periodo de los recuentos hasta consultar.</p>
    </fieldset>
    <p className="rounded-xl border border-sarin-line bg-sarin-canvas p-4 text-sm leading-6">Cuenta los registros consultables por fecha de cita. Los registros antiguos sin fecha válida pueden no aparecer. Muestra el estado actual, no un historial de cambios</p>
    {loading && <p role="status">Consultando el periodo…</p>}
    {error && <div ref={errorRef} role="alert" tabIndex={-1} className="space-y-2 rounded-xl border border-sarin-line p-4 focus-visible:outline-2 focus-visible:outline-sarin-blue"><p>{error}</p>{capacityError && <p>Reduce el periodo y vuelve a consultar. No se muestran recuentos parciales de una consulta truncada.</p>}</div>}
    {shown && <section ref={resultRef} tabIndex={-1} aria-label="Resultado del resumen operativo" className="space-y-4 rounded-xl focus-visible:outline-2 focus-visible:outline-sarin-blue">
      <div><h2 className="text-xl font-semibold">Periodo consultado: {shown.range.from} a {shown.range.through}</h2><p className="text-sm text-sarin-muted">Consultado a las {new Intl.DateTimeFormat('es-CO', { timeZone: 'America/Bogota', dateStyle: 'medium', timeStyle: 'medium' }).format(shown.serverNow)}, Colombia</p></div>
      {shown.coverage.invalidRecords > 0 && <p role="status">Hay {shown.coverage.invalidRecords} registros que no pudimos clasificar; los recuentos son parciales</p>}
      {shown.totals.total === 0 && shown.coverage.invalidRecords === 0 && <p>No hay citas clasificables en los registros consultados para este periodo</p>}
      <dl className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">{[['Citas clasificables', shown.totals.total], ['Marcadas atendidas', shown.totals.completed], ['Marcadas como ausencia', shown.totals.noShow], ['Canceladas', shown.totals.cancelledByClient + shown.totals.cancelledByOwner]].map(([label, value]) => <div key={label} className="rounded-xl border border-sarin-line bg-sarin-paper p-4"><dt className="text-sm text-sarin-muted">{label}</dt><dd className="mt-1 text-3xl font-bold">{value}</dd></div>)}</dl>
      <p>Confirmadas: {shown.totals.confirmed}. Incluye citas del periodo que aún no terminan y citas pasadas sin resultado; no significa que fueron atendidas.</p>
      <p>Terminaron sin resultado registrado: {shown.totals.awaitingOutcome}. Es un subconjunto de confirmadas y ya está incluido en el total.</p>
      {shown.totals.confirmedEndUnverifiable > 0 && <p>En {shown.totals.confirmedEndUnverifiable} citas confirmadas no pudimos verificar la hora de finalización. No se consideran terminadas automáticamente.</p>}
      <details className="rounded-xl border border-sarin-line p-3"><summary className="min-h-11 cursor-pointer py-3 font-semibold">Desglose de cancelaciones</summary><p>Por el cliente: {shown.totals.cancelledByClient}</p><p>Por el dueño: {shown.totals.cancelledByOwner}</p></details>
      <details className="rounded-xl border border-sarin-line p-3"><summary className="min-h-11 cursor-pointer py-3 font-semibold">Detalle por día</summary><div className="max-w-full overflow-x-auto"><table className="w-full text-left text-sm"><caption className="sr-only">Citas por fecha guardada y estado actual</caption><thead><tr>{['Fecha', 'Total', 'Confirmadas', 'Marcadas atendidas', 'Marcadas como ausencia', 'Canceladas'].map(label => <th scope="col" key={label} className="p-2">{label}</th>)}</tr></thead><tbody>{shown.days.map(day => <tr key={day.dateKey}>{[day.dateKey, day.counts.total, day.counts.confirmed, day.counts.completed, day.counts.noShow, day.counts.cancelledByClient + day.counts.cancelledByOwner].map((value, i) => <td key={i} className="whitespace-nowrap border-t border-sarin-line p-2">{value}</td>)}</tr>)}</tbody></table></div></details>
      <details className="rounded-xl border border-sarin-line p-3"><summary className="min-h-11 cursor-pointer py-3 font-semibold">Cómo interpretar el resumen</summary><p>Se cuenta una vez cada documento de cita clasificable por su fecha y estado actuales. Reprogramar o corregir un resultado puede cambiar un periodo anterior al actualizar. Los bloqueos manuales no son citas.</p></details>
    </section>}
    <Link href="/dashboard" className="inline-flex min-h-11 items-center rounded-lg text-sm font-semibold text-sarin-blue underline focus-visible:outline-2 focus-visible:outline-sarin-blue">Ver agenda</Link>
  </div>;
}
