"use client";

import { useRef } from 'react';
import { readOwnerAgendaRange } from '@/lib/client/owner-agenda';
import { useApiPoll } from '@/lib/client/use-api-poll';
import type { Appointment } from '@/types/firestore';
import type { OwnerAgendaRange, OwnerAgendaSnapshot } from '@/lib/owner-agenda';

export function useOwnerAgenda(input: { businessId: string | null; ownerUid: string | null; range: OwnerAgendaRange | null; enabled: boolean }): { snapshot: OwnerAgendaSnapshot | null; loading: boolean; error: string | null; refresh: () => void; replaceAppointment: (saved: Appointment) => void } {
  const { businessId, ownerUid, range, enabled } = input;
  const scope = enabled && businessId && ownerUid && range
    ? JSON.stringify([ownerUid, businessId, range.dates, range.queryDates, range.outsideDates]) : null;
  const identity = useRef({ scope });
  if (identity.current.scope !== scope) identity.current = { scope };
  const generation = identity.current;
  const pending = useRef<Promise<void> | null>(null);
  const poll = useApiPoll<OwnerAgendaSnapshot>(scope, async signal => {
    const previous = pending.current;
    let finish!: () => void;
    const completion = new Promise<void>(resolve => { finish = resolve; });
    pending.current = completion;
    try {
      // useApiPoll waits within a scope; this also closes the old cycle across an effect/scope change.
      if (previous) await previous;
      if (signal.aborted || identity.current !== generation || !businessId || !ownerUid || !range) throw new DOMException('Lectura de agenda cancelada', 'AbortError');
      return await readOwnerAgendaRange({ businessId, ownerUid, range, signal, isCurrentScope: () => identity.current === generation && !signal.aborted });
    } finally {
      finish();
      if (pending.current === completion) pending.current = null;
    }
  }, { intervalMs: 15_000, abortOnBlur: true, waitForPending: true, clearOnError: true });

  const replaceAppointment = (saved: Appointment) => {
    if (identity.current !== generation || scope === null || saved.tenantId !== businessId) return;
    const matches = (snapshot: OwnerAgendaSnapshot | null) => snapshot?.days.some(day => day.state === 'ready' && day.dateKey === saved.dateKey && day.appointments.some(item => item.id === saved.id && item.tenantId === saved.tenantId && item.dateKey === saved.dateKey));
    if (!matches(poll.value)) return;
    poll.setValue(snapshot => !snapshot || !matches(snapshot) ? snapshot : {
      ...snapshot,
      days: snapshot.days.map(day => day.state !== 'ready' || day.dateKey !== saved.dateKey ? day : {
        ...day, appointments: day.appointments.map(item => item.id === saved.id ? saved : item),
      }),
    });
  };
  return { snapshot: poll.value, loading: poll.loading, error: poll.error, refresh: poll.refresh, replaceAppointment };
}
