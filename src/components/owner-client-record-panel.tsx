"use client";

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useOwnerClientRecord, type OwnerClientRecordScope } from '@/hooks/use-owner-client-record';
import { ownerClientRecordBeneficiaryLabel, ownerClientRecordEndLabel, ownerClientRecordStatusLabel } from '@/lib/owner-client-record';
import type { OwnerRequestScope } from '@/lib/client/owner-request-scope';

export type OwnerClientRecordPanelProps = {
  scope: OwnerClientRecordScope; contextName?: string; disabled: boolean; invalidation: number;
  onClose: () => void; onOpenAppointment: (target: { appointmentId: string; dateKey: string }) => void;
  requestScope?: OwnerRequestScope;
};
const dateFormat = new Intl.DateTimeFormat('es-CO', { timeZone: 'America/Bogota', year: 'numeric', month: 'short', day: 'numeric' });
const timeFormat = new Intl.DateTimeFormat('es-CO', { timeZone: 'America/Bogota', hour: '2-digit', minute: '2-digit' });
const buttonClass = 'min-h-11 rounded-xl border border-sarin-line px-4 py-2 text-sm text-sarin-blue hover:bg-sarin-soft disabled:opacity-50';

export function OwnerClientRecordPanel(props: OwnerClientRecordPanelProps) {
  const { scope } = props;
  const key = JSON.stringify([scope.businessId, scope.ownerUid, scope.dateKey, scope.sourceAppointmentId, scope.clientUid]);
  const [closed, setClosed] = useState<string | null>(null);
  useEffect(() => { setClosed(value => value === key ? value : null); }, [key]);
  const hidden = closed === key;
  const callbacks = useRef(props);
  callbacks.current = props;
  const close = useCallback(() => { setClosed(key); callbacks.current.onClose(); }, [key]);
  const record = useOwnerClientRecord({ scope: props.scope, enabled: !props.disabled && !hidden, invalidation: props.invalidation, onAccessLost: close, requestScope: props.requestScope });
  const closeButton = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const live = useRef({ key, disabled: props.disabled, loading: record.loading, hidden });
  live.current = { key, disabled: props.disabled, loading: record.loading, hidden };
  useEffect(() => {
    if (hidden) return;
    const openingElement = document.activeElement as HTMLElement | null;
    closeButton.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); close(); }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      if (openingElement?.isConnected) openingElement.focus();
    };
  }, [key, hidden, close]);
  if (hidden) return null;
  const busy = props.disabled || record.loading;
  return <section role="dialog" aria-labelledby={titleId} className="space-y-5 rounded-2xl border border-sarin-line bg-sarin-paper p-5 sm:p-6">
    <div className="flex items-start justify-between gap-4">
      <div><p className="text-xs text-sarin-muted">Cuenta de esta reserva</p><h2 id={titleId} className="text-xl font-semibold text-sarin-ink">Reservas de esta cuenta</h2>
        {props.contextName && <p className="mt-1 break-words text-sm text-sarin-muted">Contexto de la tarjeta: {props.contextName}</p>}</div>
      <button ref={closeButton} type="button" className={buttonClass} onClick={close}>Cerrar</button>
    </div>
    <div className="space-y-2 rounded-xl bg-sarin-soft p-4 text-sm leading-6 text-sarin-muted">
      <p>La cuenta puede gestionar reservas para personas distintas</p>
      <p>Esta consulta muestra reservas con fecha verificable. Algunos registros antiguos incompletos pueden no aparecer</p>
      <p>Los registros pueden cambiar; Actualizar vuelve al inicio</p>
    </div>
    <details className="text-sm leading-6 text-sarin-muted"><summary className="min-h-11 cursor-pointer py-2 text-sarin-blue">Cómo interpretar esta consulta</summary>
      <p>Se muestran reservas de la misma cuenta en este negocio. Un resultado guardado corresponde a esa reserva; la cuenta puede representar a beneficiarios distintos. Cada página se comprueba por separado y puede cambiar entre consultas.</p>
    </details>
    <div role="group" aria-label="Filtrar por resultado guardado" className="flex flex-wrap gap-2">
      {([{ value: 'all', label: 'Todas' }, { value: 'completed', label: 'Atendidas' }, { value: 'no_show', label: 'No asistió' }] as const).map(item =>
        <button key={item.value} type="button" className={buttonClass} aria-pressed={record.filter === item.value} disabled={busy} onClick={() => { if (!busy) record.setFilter(item.value); }}>{item.label}</button>)}
    </div>
    <div aria-live="polite" aria-busy={record.loading} className="space-y-4">
      {record.loading && <p role="status" className="text-sm text-sarin-muted">Consultando reservas…</p>}
      {record.error && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{record.error}</p>}
      {record.page && <>
        <p className="text-sm text-sarin-muted">Más recientes por fecha de reserva · Hora de Colombia</p>
        {record.page.rows.length === 0 ? <p className="text-sm text-sarin-muted">No hay reservas verificables para este filtro</p> :
          <ul className="space-y-3">{record.page.rows.map(row => <li key={row.appointmentId} className="space-y-2 rounded-xl border border-sarin-line p-4 text-sm">
            <p className="font-medium text-sarin-ink">{dateFormat.format(row.startAt)} · {timeFormat.format(row.startAt)}{row.endAt !== null ? ` – ${timeFormat.format(row.endAt)}` : ''}</p>
            {ownerClientRecordEndLabel(row.endAt) && <p className="text-sarin-muted">{ownerClientRecordEndLabel(row.endAt)}</p>}
            <p className="break-words text-sarin-muted">{row.resourceLabel}</p>
            <p>Resultado guardado: {ownerClientRecordStatusLabel(row.status, row.startAt, Date.now())}</p>
            <p className="text-sarin-muted">{ownerClientRecordBeneficiaryLabel(row.beneficiaryKind)}</p>
            <button type="button" disabled={busy} className={buttonClass} onClick={() => {
              const current = live.current;
              if (current.key === key && !current.disabled && !current.loading && !current.hidden) callbacks.current.onOpenAppointment({ appointmentId: row.appointmentId, dateKey: row.dateKey });
            }}>Ver en agenda</button>
          </li>)}</ul>}
      </>}
    </div>
    <div className="flex flex-wrap gap-2">
      {record.page?.nextCursor && <button type="button" disabled={busy} className={buttonClass} onClick={() => { if (!busy) void record.loadOlder(); }}>Ver reservas anteriores</button>}
      {record.page && <button type="button" disabled={busy} className={buttonClass} onClick={() => { if (!busy) void record.refresh(); }}>Volver al inicio</button>}
      <button type="button" disabled={busy} className={buttonClass} onClick={() => { if (!busy) void record.refresh(); }}>Actualizar</button>
    </div>
  </section>;
}
