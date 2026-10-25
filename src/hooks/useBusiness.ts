"use client";

import { useAuth } from "@/components/auth-provider";
import { useRef } from 'react';
import { apiFetch, ApiError } from "@/lib/client/api";
import type { OwnerAccessFailure } from '@/lib/client/owner-request-scope';
import { useApiPoll } from "@/lib/client/use-api-poll";
import type { Business } from "@/types/firestore";

export function useBusiness(options?: { onAccessDenied: (failure: OwnerAccessFailure) => void }) {
  const { user, authEpoch, isCurrentSession, invalidateSession } = useAuth();
  const callbacks = useRef(options); callbacks.current = options;
  const result = useApiPoll(user ? options ? JSON.stringify([user.uid, authEpoch]) : user.uid : null, async signal => {
    const current = () => !!user && isCurrentSession(user.uid, authEpoch) && !signal.aborted;
    let reported = false;
    const denied = (status: 401 | 403, code?: string) => {
      if (!current()) return;
      reported = true; callbacks.current?.onAccessDenied({ status, source: 'owner_authority', ...(code ? { code } : {}) });
      if (status === 401) invalidateSession(user!.uid, authEpoch);
    };
    try {
      const response = options ? await apiFetch<{ business: Business | null }>("/api/businesses", { signal }, user!.uid, current, status => { if (status === 401 || status === 403) denied(status); }) : await apiFetch<{ business: Business | null }>("/api/businesses", { signal });
      if (options && (!response || !Object.hasOwn(response, 'business') || (response.business !== null && (!response.business || typeof response.business.id !== 'string' || typeof response.business.ownerUid !== 'string')))) throw new Error('No se pudo verificar el negocio.');
      const { business } = response;
      if (business && business.ownerUid !== user?.uid) { if (options) denied(403); throw new Error("No tienes acceso a este negocio."); }
      return business;
    } catch (error) {
      if (options && error instanceof ApiError && (error.status === 401 || error.status === 403) && (!reported || error.code)) denied(error.status, error.code);
      throw error;
    }
  });
  return { business: result.value, loading: result.loading, error: result.error, refresh: result.refresh, setBusiness: result.setValue };
}
