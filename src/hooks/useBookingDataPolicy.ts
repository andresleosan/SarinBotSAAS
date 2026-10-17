"use client";
import { useApiPoll } from '@/lib/client/use-api-poll';
import { apiFetch } from '@/lib/client/api';
import type { BookingCapability } from '@/lib/booking-subject';
export function useBookingDataPolicy(uid: string | undefined, businessId: string | undefined) {
  const poll = useApiPoll<BookingCapability>(uid && businessId ? JSON.stringify([uid, businessId]) : null, async signal => {
    const value = await apiFetch<BookingCapability>(`/api/businesses/${encodeURIComponent(businessId!)}/booking-policy`, { signal }, uid);
    if (!value || typeof value.configured !== 'boolean' || !Number.isSafeInteger(value.revision) || value.revision < 0 || !['general', 'health'].includes(value.dataMode) || typeof value.representedMinorsEnabled !== 'boolean') throw new Error('No se pudo comprobar cómo reservar con este negocio.');
    return value;
  });
  return { capability: poll.value, loading: poll.loading, error: poll.error, ready: Boolean(poll.value && !poll.loading && !poll.error), refresh: poll.refresh };
}
