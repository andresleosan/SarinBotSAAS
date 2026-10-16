"use client";

import { useAuth } from "@/components/auth-provider";
import { apiFetch } from "@/lib/client/api";
import { useApiPoll } from "@/lib/client/use-api-poll";
import type { Business } from "@/types/firestore";

export function useBusiness() {
  const { user } = useAuth();
  const result = useApiPoll(user?.uid ?? null, async signal => {
    const { business } = await apiFetch<{ business: Business | null }>("/api/businesses", { signal });
    if (business && business.ownerUid !== user?.uid) throw new Error("No tienes acceso a este negocio.");
    return business;
  });
  return { business: result.value, loading: result.loading, error: result.error, refresh: result.refresh, setBusiness: result.setValue };
}
