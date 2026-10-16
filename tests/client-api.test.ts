import { afterEach, describe, expect, it, vi } from "vitest";
import { apiFetch, ApiError } from "@/lib/client/api";

vi.mock("@/lib/firebase/client", () => ({ getFirebaseClient: () => ({ auth: { currentUser: { getIdToken: async () => "synthetic-token" } } }) }));

afterEach(() => vi.unstubAllGlobals());
describe("client API error classification", () => {
  it("preserves an application quota code alongside its HTTP status", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "Capacidad agotada", code: "AI_QUOTA_EXHAUSTED" }), { status: 402 })));
    await expect(apiFetch("/api/sarin/chat")).rejects.toMatchObject({ name: "ApiError", message: "Capacidad agotada", status: 402, code: "AI_QUOTA_EXHAUSTED" });
  });
  it("keeps an ordinary failure without inventing an application code", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "No disponible", code: { unexpected: true } }), { status: 503 })));
    await expect(apiFetch("/api/sarin/chat")).rejects.toBeInstanceOf(ApiError);
    await expect(apiFetch("/api/sarin/chat")).rejects.toMatchObject({ status: 503, code: undefined });
  });
});
