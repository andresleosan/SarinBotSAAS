import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiFetch, ApiError } from "@/lib/client/api";

const auth = vi.hoisted(() => ({ uid: 'one', switchDuringToken: false, token: null as Promise<string> | null }));
vi.mock("@/lib/firebase/client", () => ({ getFirebaseClient: () => ({ auth: { currentUser: { uid: auth.uid, getIdToken: async () => { if (auth.switchDuringToken) auth.uid = 'two'; return auth.token ?? "synthetic-token"; } } } }) }));

beforeEach(() => { auth.uid = 'one'; auth.switchDuringToken = false; auth.token = null; });
afterEach(() => vi.unstubAllGlobals());
describe("client API error classification", () => {
  it('preserves the default 403 application error body, code and retry metadata', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'Permiso denegado', code: 'OWNER_PERMISSION_DENIED' }), { status: 403, headers: { 'Retry-After': '30' } })));
    await expect(apiFetch('/api/businesses/demo/appointments', {}, 'one', () => true)).rejects.toMatchObject({ status: 403, message: 'Permiso denegado', code: 'OWNER_PERMISSION_DENIED', retryAfterSeconds: 30 });
  });
  it('observes authenticated HTTP status before awaiting the response body without changing error parsing', async () => {
    const sequence: string[] = [];
    const observed = vi.fn((status: number) => { sequence.push(`status:${status}`); });
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 403, headers: new Headers(), json: async () => { sequence.push('json'); return { error: 'Permiso denegado', code: 'OWNER_PERMISSION_DENIED' }; } })));
    await expect(apiFetch('/api/businesses/demo/appointments', {}, 'one', () => true, observed)).rejects.toMatchObject({ status: 403, code: 'OWNER_PERMISSION_DENIED' });
    expect(sequence).toEqual(['status:403', 'json']);
  });
  it('does not notify HTTP status observers after the account scope changes during fetch', async () => {
    let current = true;
    const observed = vi.fn(); const json = vi.fn(async () => ({}));
    vi.stubGlobal('fetch', vi.fn(async () => { current = false; return { ok: false, status: 403, json }; }));
    await expect(apiFetch('/api/businesses/demo/appointments', {}, 'one', () => current, observed)).rejects.toMatchObject({ status: 401, code: 'AUTH_IDENTITY_CHANGED' });
    expect(observed).not.toHaveBeenCalled(); expect(json).not.toHaveBeenCalled();
  });
  it('does not send a mutation after a same-UID session expires during token retrieval', async () => {
    let resolve!: (value: string) => void;
    auth.token = new Promise<string>(done => { resolve = done; });
    let current = true;
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}')));
    const result = apiFetch('/api/platform-whatsapp/link', { method: 'POST', body: '{}' }, 'one', () => current);
    current = false; resolve('synthetic-token');
    await expect(result).rejects.toMatchObject({ status: 401, code: 'AUTH_IDENTITY_CHANGED' });
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each(['fetch', 'json'])('does not publish an obsolete %s completion or its error', async boundary => {
    let current = true;
    const json = vi.fn(async () => { if (boundary === 'json') current = false; return { error: 'Old permission loss' }; });
    vi.stubGlobal('fetch', vi.fn(async () => {
      if (boundary === 'fetch') current = false;
      return { ok: false, status: 403, json, headers: new Headers() };
    }));
    await expect(apiFetch('/api/platform-whatsapp/link', {}, 'one', () => current)).rejects.toMatchObject({ status: 401, code: 'AUTH_IDENTITY_CHANGED' });
    expect(json).toHaveBeenCalledTimes(boundary === 'fetch' ? 0 : 1);
  });
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
