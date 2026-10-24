"use client";

import { apiFetch, ApiError } from '@/lib/client/api';
import { rejectDuplicateAgendaIds, type OwnerAgendaDay, type OwnerAgendaRange, type OwnerAgendaSnapshot } from '@/lib/owner-agenda';
import type { Appointment } from '@/types/firestore';

const DAY_ERROR = 'No pudimos cargar este día';
const DAY_TIMEOUT = 'La consulta de este día tardó demasiado. Actualiza para intentarlo de nuevo';
class DailyDeadline extends Error {}

function appointmentsFromEnvelope(value: unknown, businessId: string, dateKey: string): Appointment[] {
  if (!value || typeof value !== 'object' || !('appointments' in value) || !Array.isArray(value.appointments)) throw new Error(DAY_ERROR);
  for (const item of value.appointments) {
    if (!item || typeof item !== 'object' || typeof item.id !== 'string' || !item.id.trim() || item.tenantId !== businessId || item.dateKey !== dateKey) throw new Error(DAY_ERROR);
  }
  // History may contain unknown states, resources and malformed times. Preserve it for the canonical list.
  return value.appointments as Appointment[];
}

export async function readOwnerAgendaRange(input: { businessId: string; ownerUid: string; range: OwnerAgendaRange; signal: AbortSignal; isCurrentScope: () => boolean }): Promise<OwnerAgendaSnapshot> {
  const { businessId, ownerUid, range, signal, isCurrentScope } = input;
  if (range.queryDates.length > 7) throw new RangeError('El rango de la agenda supera siete días');
  const cycle = new AbortController();
  const cancel = () => cycle.abort(signal.reason);
  signal.addEventListener('abort', cancel);
  if (signal.aborted) cancel();
  const assertCurrent = () => {
    if (cycle.signal.aborted) throw cycle.signal.reason;
    if (!isCurrentScope()) throw new ApiError('La cuenta cambió. Vuelve a revisar tus permisos.', 401, 'AUTH_IDENTITY_CHANGED');
  };
  const results = new Map<string, OwnerAgendaDay>();
  let index = 0;

  async function readDay(dateKey: string): Promise<OwnerAgendaDay> {
    const child = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let abort: () => void = () => {};
    try {
      assertCurrent();
      const interrupted = new Promise<never>((_, reject) => {
        abort = () => { child.abort(cycle.signal.reason); reject(cycle.signal.reason); };
        cycle.signal.addEventListener('abort', abort);
        timer = setTimeout(() => {
          reject(new DailyDeadline(DAY_TIMEOUT));
          child.abort();
        }, 10_000);
      });
      // The race observes late rejection as well as resolution even when a token provider ignores abort.
      const response = await Promise.race([
        apiFetch<unknown>(`/api/businesses/${encodeURIComponent(businessId)}/appointments?date=${dateKey}`, { signal: child.signal }, ownerUid, () => !cycle.signal.aborted && !child.signal.aborted && isCurrentScope()),
        interrupted,
      ]);
      assertCurrent();
      return { dateKey, state: 'ready', appointments: appointmentsFromEnvelope(response, businessId, dateKey) };
    } catch (error) {
      if (error instanceof ApiError && (error.status === 401 || error.status === 403)) child.abort(error);
      throw error;
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      cycle.signal.removeEventListener('abort', abort);
    }
  }

  async function worker() {
    while (!cycle.signal.aborted && index < range.queryDates.length) {
      const dateKey = range.queryDates[index++];
      try {
        assertCurrent();
        results.set(dateKey, await readDay(dateKey));
      } catch (error) {
        if (cycle.signal.aborted) throw cycle.signal.reason;
        if (!isCurrentScope() || (error instanceof ApiError && (error.status === 401 || error.status === 403))) {
          const failure = !isCurrentScope() && !(error instanceof ApiError)
            ? new ApiError('La cuenta cambió. Vuelve a revisar tus permisos.', 401, 'AUTH_IDENTITY_CHANGED') : error;
          cycle.abort(failure);
          throw failure;
        }
        results.set(dateKey, { dateKey, state: 'error', message: error instanceof DailyDeadline ? DAY_TIMEOUT : DAY_ERROR });
      }
    }
  }

  try {
    await Promise.allSettled([worker(), worker()]);
    assertCurrent();
    const outside = new Set(range.outsideDates);
    const days = range.dates.map((dateKey): OwnerAgendaDay => outside.has(dateKey)
      ? { dateKey, state: 'outside' }
      : results.get(dateKey) ?? { dateKey, state: 'error', message: DAY_ERROR });
    return { days: rejectDuplicateAgendaIds(days), checkedAt: Date.now() };
  } finally {
    signal.removeEventListener('abort', cancel);
  }
}
