"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch, errorMessage } from "@/lib/client/api";

interface EngineHealth {
  status: "online" | "offline";
  queue?: {
    activeSlots: number;
    queuedRequests: number;
    criticalQueued: number;
    maxSlots: number;
  };
}
export function useEngineHealth() {
  const [health, setHealth] = useState<EngineHealth | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const refresh = useCallback(async (signal?: AbortSignal) => {
    setChecking(true);
    try {
      const response = await apiFetch<EngineHealth>("/api/sarin/health", {
        signal,
      });
      if (!signal?.aborted) {
        setHealth(response);
        setError(null);
      }
    } catch (cause) {
      if (!signal?.aborted) {
        setHealth({ status: "offline" });
        setError(errorMessage(cause));
      }
    } finally {
      if (!signal?.aborted) setChecking(false);
    }
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal);
    const timer = setInterval(() => void refresh(controller.signal), 60000);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [refresh]);
  return { health, error, checking, refresh: () => refresh() };
}
