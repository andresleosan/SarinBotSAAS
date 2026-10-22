import { act, createElement, type ReactNode } from "react";
import { create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AdminAssistantPage from "@/app/admin/assistant/page";
import { AdminPaymentConfirmation } from "@/components/admin-payment-confirmation";
import { ApiError } from "@/lib/client/api";
import type { PaymentActionView } from "@/types/admin-payment-actions";

const state = vi.hoisted(() => ({ api: vi.fn(), realApi: false, idToken: vi.fn(), invalidate: vi.fn(), popup: vi.fn(), token: vi.fn(), uid: "admin-a" as string | null, admin: true, epoch: 1, signingOut: false }));
vi.mock("@/lib/client/api", async importOriginal => { const actual = await importOriginal<typeof import("@/lib/client/api")>(); return { ...actual, apiFetch: (path: string, init?: RequestInit, expectedUid?: string, isCurrentScope?: () => boolean) => state.realApi ? actual.apiFetch(path, init, expectedUid, isCurrentScope) : state.api(path, init, expectedUid, isCurrentScope) }; });
vi.mock("firebase/auth", () => ({ GoogleAuthProvider: class {}, reauthenticateWithPopup: state.popup }));
vi.mock("@/lib/firebase/client", () => ({ getFirebaseClient: () => ({ auth: { currentUser: state.uid ? { uid: state.uid, providerData: [{ providerId: "google.com" }], getIdTokenResult: state.token, getIdToken: state.idToken } : null } }) }));
vi.mock("@/components/auth-provider", () => ({ useAuth: () => ({ user: state.uid ? { uid: state.uid } : null, isSuperadmin: state.admin, authEpoch: state.epoch, signingOut: state.signingOut, invalidateSession: state.invalidate, isCurrentSession: (uid: string, epoch: number) => uid === state.uid && epoch === state.epoch && !state.signingOut }), AuthGate: ({ children }: { children: ReactNode }) => state.admin && state.uid && !state.signingOut ? children : createElement("p", null, "Acceso restringido") }));
vi.mock("@/components/app-shell", () => ({ AppShell: ({ children }: { children: ReactNode }) => children, Notice: ({ children, error }: { children: ReactNode; error?: boolean }) => createElement("p", { role: error ? "alert" : "status" }, children), buttonClass: "button", fieldClass: "field" }));
vi.mock("next/link", () => ({ default: ({ children, href }: { children: ReactNode; href: string }) => createElement("a", { href }, children) }));
vi.mock("@/components/platform-whatsapp-link", () => ({ PlatformWhatsAppLink: () => null }));
vi.mock("@/components/admin-platform-whatsapp", () => ({ AdminPlatformWhatsApp: () => null }));
vi.mock("@/components/admin-whatsapp-conversations", () => ({ AdminWhatsAppConversations: () => null }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const id = "11111111-1111-4111-8111-111111111111";
const text = (node: ReactTestInstance | string): string => typeof node === "string" ? node : node.children.map(text).join("");
const source = { id: "payment-fixture", kind: "payment" as const, businessId: "business-fixture", label: "Pago sintético", detail: "Pendiente", href: "/admin?focusPayment=fixture#payment-fixture" };
const snapshot = { generatedAt: 1792252800000, timeZone: "America/Bogota", scopeBusinessId: null, coverage: { limit: 100, businessesLoaded: 0, businessesTruncated: false, paymentsLoaded: 1, paymentsTruncated: false, allowancesUnavailable: 0 }, businesses: [], metrics: { businesses: 0, pendingPayments: 1, quotaWarnings: 0, quotaExhausted: 0, expiringSubscriptions: 0 }, attention: [{ sourceId: source.id, kind: "payment", severity: "urgent", title: "Pago pendiente", detail: "Revisar" }], sources: [source] };
let view: PaymentActionView;
let renderer: ReactTestRenderer | undefined;
const root = () => renderer!.root;
const button = (label: string) => root().findAllByType("button").find(node => text(node).includes(label))!;
async function mount() { await act(async () => { renderer = create(createElement(AdminAssistantPage)); }); }
beforeEach(() => {
  Object.assign(state, { uid: "admin-a", admin: true, epoch: 1, signingOut: false });
  view = { proposal: { id, paymentId: "fixture", action: "approve", revision: 1, expiresAt: Date.now() + 300000, state: "pending" }, business: { id: "business-fixture", name: "Negocio sintético" }, payment: { id: "fixture", amountCOP: 89000, planId: "monthly", kind: "subscription", status: "pending" }, effect: "El período empieza al confirmar o desde el final pagado vigente." };
  vi.stubGlobal("window", { location: { search: `?paymentAction=${id}` }, addEventListener: vi.fn(), removeEventListener: vi.fn() });
  state.api.mockReset().mockImplementation(async (path: string) => path.startsWith("/api/admin/copilot/payment-actions") ? view : snapshot);
  state.popup.mockReset().mockImplementation(async () => ({ user: { uid: state.uid, getIdTokenResult: state.token } }));
  state.token.mockReset().mockResolvedValue({});
  state.realApi = false; state.idToken.mockReset().mockResolvedValue("synthetic-token"); state.invalidate.mockReset();
  vi.stubGlobal("document", { addEventListener: vi.fn(), removeEventListener: vi.fn(), visibilityState: "visible" });
});
afterEach(async () => { await act(async () => renderer?.unmount()); renderer = undefined; vi.unstubAllGlobals(); vi.useRealTimers(); });
describe("explicit administrative payment confirmation", () => {
  it("opens an opaque proposal link with a read-only GET and renders its review without preparing or confirming", async () => {
    await mount();
    expect(state.api.mock.calls.some(([path]) => path === `/api/admin/copilot/payment-actions?id=${id}`)).toBe(true);
    expect(text(root())).toContain("Negocio sintético");
    expect(button("Confirmar aprobación")).toBeDefined();
    expect(state.api.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(0);
  });
});

const posts = () => state.api.mock.calls.filter(([, init]) => init?.method === "POST");
const confirms = () => posts().filter(([path]) => path.endsWith("/confirm"));
const select = (label: string, value: string) => act(async () => root().findByProps({ "aria-label": label }).props.onChange({ target: { value } }));
const click = (label: string) => act(async () => button(label).props.onClick());
const deferred = <T,>() => { let resolve!: (value: T) => void; let reject!: (cause: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const result = () => ({ business: view.business, payment: { ...view.payment, status: "approved" }, effectId: "effect-fixture", reviewedAt: Date.now() });

describe("payment interaction and recovery", () => {
  it("selects a consulted pending payment and only explicit preparation creates the server review", async () => {
    window.location.search = "";
    await mount();
    await select("Pago pendiente consultado", "fixture");
    expect(posts()).toHaveLength(0);
    expect(button("Preparar revisión").props.disabled).toBe(false);
    await click("Preparar revisión");
    expect(JSON.parse(posts()[0][1].body)).toEqual({ paymentId: "fixture", action: "approve", requestId: expect.stringMatching(/^[a-f0-9-]{36}$/) });
    expect(text(root())).toContain(view.effect);
    expect(confirms()).toHaveLength(0);
    expect(root().findAllByType("a").some(node => node.props.href === source.href)).toBe(true);
    expect(root().findAllByType("img")).toHaveLength(0);
  });
  it("does not prepare from model questions, suggested questions or selection; confirmation is outside forms", async () => {
    await mount();
    await click("¿Qué pagos están pendientes?");
    expect(posts()).toHaveLength(0);
    const confirmButton = button("Confirmar aprobación");
    expect(confirmButton.props.type).toBe("button");
    let parent = confirmButton.parent;
    while (parent) { expect(parent.type).not.toBe("form"); parent = parent.parent; }
    state.api.mockResolvedValueOnce({ reply: "Revisa el pago", provider: "deepseek", sources: [source], snapshot });
    await act(async () => root().findByType("form").props.onSubmit({ preventDefault() {} }));
    expect(confirms()).toHaveLength(0);
    expect(posts().map(([path]) => path)).toEqual(["/api/admin/copilot"]);
  });
  it("validates rejection by Unicode codepoints and sends only a trimmed reason", async () => {
    window.location.search = ""; await mount();
    await select("Pago pendiente consultado", "fixture"); await select("Decisión", "reject");
    await select("Motivo del rechazo", "   "); expect(button("Preparar revisión").props.disabled).toBe(true);
    await click("Preparar revisión"); expect(posts()).toHaveLength(0);
    await select("Motivo del rechazo", "😀".repeat(501)); expect(button("Preparar revisión").props.disabled).toBe(true);
    await select("Motivo del rechazo", `  ${"😀".repeat(500)}  `); expect(button("Preparar revisión").props.disabled).toBe(false);
    view = { ...view, proposal: { ...view.proposal, action: "reject" }, rejectionReason: "😀".repeat(500) };
    await click("Preparar revisión");
    expect(JSON.parse(posts()[0][1].body).rejectionReason).toBe("😀".repeat(500));
    expect(text(root())).toContain(view.rejectionReason);
    expect(button("Confirmar rechazo")).toBeDefined();
  });
  it("blocks duplicate clicks synchronously and applies only the captured server proposal revision", async () => {
    await mount(); const pending = deferred<unknown>(); state.api.mockReturnValueOnce(pending.promise);
    const callback = button("Confirmar aprobación").props.onClick;
    await act(async () => { callback(); callback(); });
    expect(confirms()).toHaveLength(1);
    expect(JSON.parse(confirms()[0][1].body)).toEqual({ requestId: expect.any(String), expectedRevision: 1, confirmed: true });
    expect(button("Confirmar aprobación").props.disabled).toBe(true);
    await act(async () => pending.resolve(result()));
    expect(text(root())).toContain("Decisión registrada: approved");
    expect(button("Confirmar aprobación")).toBeUndefined();
    await act(async () => callback()); expect(confirms()).toHaveLength(1);
  });
  it("keeps the same request tuple after an unknown result and an explicit pending-state read", async () => {
    await mount(); state.api.mockRejectedValueOnce(new TypeError("lost response"));
    await click("Confirmar aprobación");
    const original = confirms()[0][1].body;
    expect(button("Preparar revisión").props.disabled).toBe(true);
    await click("Consultar estado");
    expect(confirms()).toHaveLength(1);
    state.api.mockResolvedValueOnce(result()); await click("Reintentar la misma confirmación");
    expect(confirms()[1][1].body).toBe(original);
  });
  it("retries an uncertain preparation with exactly the same request body", async () => {
    window.location.search = ""; await mount(); await select("Pago pendiente consultado", "fixture");
    state.api.mockRejectedValueOnce(new TypeError("lost preparation")); await click("Preparar revisión");
    expect(button("Preparar revisión").props.disabled).toBe(true);
    await click("Reintentar la misma preparación");
    expect(posts()[1][1].body).toBe(posts()[0][1].body);
    expect(confirms()).toHaveLength(0);
  });
  it("invalidates a 409 proposal and old confirm callback until another explicit preparation", async () => {
    await mount(); const old = button("Confirmar aprobación").props.onClick;
    state.api.mockRejectedValueOnce(new ApiError("changed", 409)); await click("Confirmar aprobación");
    expect(button("Confirmar aprobación")).toBeUndefined(); expect(text(root())).toContain("nueva revisión explícita");
    await act(async () => old()); expect(confirms()).toHaveLength(1);
    await select("Pago pendiente consultado", "fixture"); await click("Preparar revisión");
    expect(confirms()).toHaveLength(1); expect(button("Confirmar aprobación")).toBeDefined();
  });
  it("requires real Google reauthentication after 428 and a fresh human click after reloading", async () => {
    await mount(); state.api.mockRejectedValueOnce(new ApiError("old auth", 428, "ADMIN_PAYMENT_REAUTH_REQUIRED"));
    await click("Confirmar aprobación");
    expect(button("Confirmar aprobación").props.disabled).toBe(true);
    await click("Verificar mi identidad");
    expect(state.popup).toHaveBeenCalledTimes(1); expect(state.token).toHaveBeenCalledWith(true);
    expect(state.api.mock.calls.filter(([path]) => path.includes("payment-actions?id="))).toHaveLength(2);
    expect(confirms()).toHaveLength(1); expect(button("Confirmar aprobación").props.disabled).toBe(false);
    state.api.mockResolvedValueOnce(result()); await click("Confirmar aprobación"); expect(confirms()).toHaveLength(2);
  });
  it.each(["cancel", "wrong uid"])("clears stale confirmation capability when real reauthentication returns %s", async mode => {
    await mount(); state.api.mockRejectedValueOnce(new ApiError("old auth", 428, "ADMIN_PAYMENT_REAUTH_REQUIRED")); await click("Confirmar aprobación");
    if (mode === "cancel") state.popup.mockRejectedValueOnce(new Error("cancel"));
    else state.popup.mockResolvedValueOnce({ user: { uid: "other-account", getIdTokenResult: state.token } });
    await click("Verificar mi identidad");
    expect(button("Confirmar aprobación")).toBeUndefined(); expect(text(root())).not.toContain("Negocio sintético");
    expect(state.token).not.toHaveBeenCalled(); expect(confirms()).toHaveLength(1);
    expect(root().findAllByProps({ role: "alert" })).toHaveLength(1);
  });
  it("uses absolute expiry equality to disable the visible proposal without another server read", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval", "performance"] });
    view.proposal.expiresAt = Date.now() + 1000; await mount();
    expect(button("Confirmar aprobación").props.disabled).toBe(false);
    await act(async () => vi.advanceTimersByTime(1000));
    expect(button("Confirmar aprobación").props.disabled).toBe(true);
    await click("Confirmar aprobación"); expect(confirms()).toHaveLength(0);
  });
  it("counts response latency from read start and survives wall-clock rollback and backgrounding", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval", "performance"] });
    const pending = deferred<PaymentActionView>();
    state.api.mockImplementation((path: string) => path.includes("payment-actions") ? pending.promise : Promise.resolve(snapshot));
    view.proposal.expiresAt = Date.now() + 1000; await mount();
    await act(async () => vi.advanceTimersByTime(800));
    vi.setSystemTime(Date.now() - 60000);
    await act(async () => pending.resolve(view));
    expect(button("Confirmar aprobación").props.disabled).toBe(false);
    await act(async () => vi.advanceTimersByTime(200));
    expect(button("Confirmar aprobación").props.disabled).toBe(true);
    await click("Confirmar aprobación"); expect(confirms()).toHaveLength(0);
  });
  it.each([401, 403])("clears all private draft/review on identity error %s", async status => {
    await mount(); await select("Pago pendiente consultado", "fixture"); await select("Decisión", "reject"); await select("Motivo del rechazo", "PRIVATE REASON");
    state.api.mockRejectedValueOnce(new ApiError("identity", status)); await click("Preparar revisión");
    expect(text(root())).not.toContain("Negocio sintético"); expect(root().findAllByProps({ "aria-label": "Motivo del rechazo" })).toHaveLength(0);
    expect(button("Preparar revisión").props.disabled).toBe(true); expect(confirms()).toHaveLength(0);
    expect(state.invalidate).toHaveBeenCalledWith("admin-a", 1);
  });
  it.each(["logout", "uid", "role", "epoch", "signingOut"])("ignores a late confirmation and old callback/finally on %s change", async change => {
    await mount(); const pending = deferred<unknown>(); state.api.mockReturnValueOnce(pending.promise);
    const callback = button("Confirmar aprobación").props.onClick; await act(async () => callback());
    const signal = confirms()[0][1].signal as AbortSignal;
    if (change === "logout") state.uid = null;
    if (change === "uid") state.uid = "admin-b";
    if (change === "role") state.admin = false;
    if (change === "epoch") state.epoch++;
    if (change === "signingOut") state.signingOut = true;
    await act(async () => renderer!.update(createElement(AdminAssistantPage)));
    await act(async () => { pending.resolve({ ...result(), business: { id: "old", name: "PRIVATE OLD RESULT" } }); callback(); });
    expect(signal.aborted).toBe(true); expect(text(root())).not.toContain("PRIVATE OLD RESULT"); expect(confirms()).toHaveLength(1);
  });
  it("fences a late Google popup after account replacement", async () => {
    await mount(); state.api.mockRejectedValueOnce(new ApiError("old auth", 428, "ADMIN_PAYMENT_REAUTH_REQUIRED")); await click("Confirmar aprobación");
    const popup = deferred<unknown>(); state.popup.mockReturnValueOnce(popup.promise); await click("Verificar mi identidad");
    state.uid = "admin-b"; await act(async () => renderer!.update(createElement(AdminAssistantPage)));
    const count = state.api.mock.calls.length;
    await act(async () => popup.resolve({ user: { uid: "admin-a", getIdTokenResult: state.token } }));
    expect(state.api.mock.calls).toHaveLength(count); expect(state.token).not.toHaveBeenCalled(); expect(confirms()).toHaveLength(1);
  });
  it("provides focus targets for reviews/errors and wraps long content as plain text", async () => {
    view.business.name = "<script>" + "LongName".repeat(80);
    const focus = vi.fn(); await act(async () => { renderer = create(createElement(AdminAssistantPage), { createNodeMock: element => element.type === "h3" || element.type === "p" ? { focus } : null }); });
    expect(focus).toHaveBeenCalled(); expect(root().findAllByType("script")).toHaveLength(0); expect(text(root())).toContain(view.business.name);
    state.api.mockRejectedValueOnce(new ApiError("changed", 409)); await click("Confirmar aprobación");
    expect(focus.mock.calls.length).toBeGreaterThan(1); expect(root().findByProps({ role: "alert" }).props.tabIndex).toBe(-1);
  });
  it("rejects malformed or duplicate opaque IDs locally without a proposal read", async () => {
    window.location.search = `?paymentAction=${id}&paymentAction=${id}`; await mount();
    expect(state.api.mock.calls.some(([path]) => path.includes("payment-actions"))).toBe(false);
    expect(text(root())).toContain("enlace de propuesta no es válido");
  });
});

describe("real HTTP client session fences", () => {
  async function mountPanel() { await act(async () => { renderer = create(createElement(AdminPaymentConfirmation, { payments: [], proposalId: id })); }); }
  it("blocks a confirmation POST when epoch changes during token retrieval", async () => {
    state.realApi = true;
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => view }); vi.stubGlobal("fetch", fetch);
    await mountPanel();
    const token = deferred<string>(); state.idToken.mockReturnValueOnce(token.promise);
    await click("Confirmar aprobación"); state.epoch++;
    await act(async () => renderer!.update(createElement(AdminPaymentConfirmation, { payments: [], proposalId: id })));
    await act(async () => token.resolve("obsolete-token"));
    expect(fetch.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(0);
  });
  it("discards a late confirmation JSON body after account replacement and aborts the old operation", async () => {
    state.realApi = true;
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => view }); vi.stubGlobal("fetch", fetch);
    await mountPanel();
    const json = deferred<unknown>(); fetch.mockResolvedValueOnce({ ok: true, json: () => json.promise });
    await click("Confirmar aprobación");
    const signal = fetch.mock.calls.find(([, init]) => init?.method === "POST")![1].signal as AbortSignal;
    state.uid = "admin-b";
    await act(async () => renderer!.update(createElement(AdminPaymentConfirmation, { payments: [], proposalId: id })));
    await act(async () => json.resolve({ ...result(), business: { id: "old", name: "PRIVATE OLD JSON" } }));
    expect(signal.aborted).toBe(true); expect(text(root())).not.toContain("PRIVATE OLD JSON"); expect(text(root())).not.toContain("Decisión registrada");
  });
});

describe("payment product labels", () => {
  it.each([
    { kind: "paid_trial", label: "Prueba pagada" },
    { kind: "response_pack", label: "Paquete de respuestas" },
  ])("reviews and records $kind as its actual product without inventing a subscription plan", async ({ kind, label }) => {
    view.payment = { ...view.payment, kind, planId: null };
    view.effect = "Efecto autorizado por el servidor para este producto.";
    await mount();
    const details = root().findAllByType("dd").map(text);
    expect(details).toContain(label);
    expect(details.join(" ")).not.toMatch(/monthly|null|undefined|paid_trial|response_pack/);
    expect(confirms()).toHaveLength(0);
    state.api.mockResolvedValueOnce(result());
    await click("Confirmar aprobación");
    const outcome = root().findAllByProps({ role: "status" }).map(text).find(value => value.includes("Decisión registrada"));
    expect(outcome).toContain(label);
    expect(outcome).not.toMatch(/monthly|null|undefined|paid_trial|response_pack/);
  });

  it("preserves the server's monthly plan for a legacy subscription in review and result", async () => {
    await mount();
    expect(root().findAllByType("dd").map(text).join(" ")).toContain("monthly");
    state.api.mockResolvedValueOnce(result());
    await click("Confirmar aprobación");
    expect(root().findAllByProps({ role: "status" }).map(text).join(" ")).toContain("monthly");
  });
});
