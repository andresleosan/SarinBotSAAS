"use client";

import { getFirebaseClient } from "@/lib/firebase/client";

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
    public readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export async function apiFetch<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const user = getFirebaseClient().auth.currentUser;
  if (!user) throw new ApiError("Inicia sesión para continuar.", 401);
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${await user.getIdToken()}`);
  if (init.body && !headers.has("Content-Type"))
    headers.set("Content-Type", "application/json");
  const response = await fetch(path, { ...init, headers, cache: "no-store" });
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      data &&
      typeof data === "object" &&
      "error" in data &&
      typeof data.error === "string"
        ? data.error
        : data &&
            typeof data === "object" &&
            "message" in data &&
            typeof data.message === "string"
          ? data.message
          : `No se pudo completar la solicitud (${response.status}).`;
    const code = data && typeof data === "object" && "code" in data && typeof data.code === "string" && /^[A-Z0-9_]{1,80}$/.test(data.code) ? data.code : undefined;
    const retry = Number(response.headers.get('Retry-After'));
    throw new ApiError(message, response.status, code, Number.isSafeInteger(retry) && retry > 0 ? retry : undefined);
  }
  return data as T;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "Ocurrió un error inesperado. Inténtalo de nuevo.";
}
