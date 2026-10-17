import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiFetch, ApiError } from "@/lib/client/api";

const auth = vi.hoisted(() => ({ uid: 'one', switchDuringToken: false }));
vi.mock("@/lib/firebase/client", () => ({ getFirebaseClient: () => ({ auth: { currentUser: { uid: auth.uid, getIdToken: async () => { if (auth.switchDuringToken) auth.uid = 'two'; return "synthetic-token"; } } } }) }));

beforeEach(() => { auth.uid = 'one'; auth.switchDuringToken = false; });
afterEach(() => vi.unstubAllGlobals());
describe("client API error classification", () => {
  it('does not send a consent decision using a different current identity', async () => {
    vi.stubGlobal('fetch', vi.fn());
    await expect(apiFetch('/api/consent', { method: 'POST', body: '{}' }, 'two')).rejects.toMatchObject({ status: 401 });
    expect(fetch).not.toHaveBeenCalled();
    auth.switchDuringToken = true;
    await expect(apiFetch('/api/consent', { method: 'POST', body: '{}' }, 'one')).rejects.toMatchObject({ status: 401 });
    expect(fetch).not.toHaveBeenCalled();
  });
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
