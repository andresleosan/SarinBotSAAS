"use client";
import { useApiPoll } from '@/lib/client/use-api-poll';
import { apiFetch } from '@/lib/client/api';
import type { BookingAdmissionCapability, BookingAdmissionState } from '@/lib/booking-admission';

const admissionStates = new Set<BookingAdmissionState>(['active', 'classification_required', 'withdrawn', 'administrative_review', 'transitioning']);

export function useBookingDataPolicy(uid: string | undefined, businessId: string | undefined) {
  const poll = useApiPoll<BookingAdmissionCapability>(uid && businessId ? JSON.stringify([uid, businessId]) : null, async signal => {
    const value = await apiFetch<BookingAdmissionCapability>(`/api/businesses/${encodeURIComponent(businessId!)}/booking-policy`, { signal }, uid);
    if (
      !value ||
      typeof value.configured !== 'boolean' ||
      !Number.isSafeInteger(value.revision) ||
      value.revision < 0 ||
      !['general', 'health'].includes(value.dataMode) ||
      typeof value.representedMinorsEnabled !== 'boolean' ||
      (value.admission !== undefined && !admissionStates.has(value.admission)) ||
      (value.canStartBooking !== undefined && typeof value.canStartBooking !== 'boolean') ||
      (value.canUseInference !== undefined && typeof value.canUseInference !== 'boolean')
    ) {
      throw new Error('No se pudo comprobar cómo reservar con este negocio.');
    }
    const admission: BookingAdmissionState = value.admission ?? 'active';
    const canStartBooking = value.canStartBooking ?? (admission === 'active');
    const canUseInference = value.canUseInference ?? (admission === 'active' && value.dataMode === 'general');
    return {
      ...value,
      admission,
      canStartBooking,
      canUseInference,
    };
  });
  return { capability: poll.value, loading: poll.loading, error: poll.error, ready: Boolean(poll.value && !poll.loading && !poll.error), refresh: poll.refresh };
}
