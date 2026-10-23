import { act, createElement, type ReactNode } from "react";
import { create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AdminCopilot } from "@/components/admin-copilot";
import AdminAssistantPage from "@/app/admin/assistant/page";
import type { AdminCopilotSnapshot } from "@/types/admin-copilot";

const state = vi.hoisted(() => ({ api: vi.fn(), uid: "admin-a", admin: true }));
vi.mock("@/lib/client/api", () => ({ apiFetch: state.api, errorMessage: (error: Error) => error.message }));
vi.mock("@/components/auth-provider", () => ({ useAuth: () => ({ user: { uid: state.uid }, isSuperadmin: state.admin, authEpoch: 1, signingOut: false, isCurrentSession: (uid: string) => uid === state.uid, invalidateSession: vi.fn() }), AuthGate: ({ admin, children }: { admin?: boolean; children: ReactNode }) => admin && !state.admin ? createElement("p", null, "Acceso restringido") : children }));
vi.mock("@/components/app-shell", () => ({ AppShell: ({ children }: { children: ReactNode }) => children, Notice: ({ children, error }: { children: ReactNode; error?: boolean }) => createElement("p", { role: error ? "alert" : "status" }, children), buttonClass: "button", fieldClass: "field" }));
vi.mock("next/link", () => ({ default: ({ children, href }: { children: ReactNode; href: string }) => createElement("a", { href }, children) }));
vi.mock("next/navigation", () => ({ usePathname: () => '/admin/assistant', useSearchParams: () => '', useRouter: () => ({ push: vi.fn() }) }));
// The owner-link panel has its own real-provider suite; keep this copilot fixture's API contract scoped.
vi.mock("@/components/platform-whatsapp-link", () => ({ PlatformWhatsAppLink: () => createElement("section", { "aria-label": "Owner link fixture" }) }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const text = (node: ReactTestInstance | string): string => typeof node === "string" ? node : node.children.map(text).join("");
const source = { id: "business-fixture", kind: "business" as const, businessId: "fixture", label: "Clínica sintética", detail: "Revisar cuota", href: "/admin#business-fixture" };
function snapshot(): AdminCopilotSnapshot {
  return {
    generatedAt: 1792252800000, timeZone: "America/Bogota", scopeBusinessId: null,
    coverage: { limit: 100, businessesLoaded: 2, businessesTruncated: false, paymentsLoaded: 1, paymentsTruncated: false, allowancesUnavailable: 0 },
    businesses: [
      { id: "fixture", name: "Clínica sintética", status: "active", access: "subscription", periodEndsAt: null, quotaState: "warning", remainingResponses: 8, usedResponses: 92 },
      { id: "second", name: "Taller sintético", status: "active", access: "subscription", periodEndsAt: null, quotaState: "active", remainingResponses: 100, usedResponses: 0 },
    ],
    metrics: { businesses: 2, pendingPayments: 1, quotaWarnings: 1, quotaExhausted: 0, expiringSubscriptions: 0 },
    attention: [{ sourceId: source.id, kind: "quota_warning", severity: "warning", title: "Pocas respuestas disponibles", detail: "Clínica sintética: 8 respuestas" }], sources: [source],
  };
}

describe("private administrative copilot", () => {
  let renderer: ReactTestRenderer | undefined;
  let data: AdminCopilotSnapshot;
  const root = () => renderer!.root;
  const button = (label: string) => root().findAllByType("button").find(node => text(node).includes(label))!;
  async function mount() { await act(async () => { renderer = create(createElement(AdminCopilot)); }); }
  beforeEach(() => {
    data = snapshot(); state.uid = "admin-a"; state.admin = true; state.api.mockReset().mockResolvedValue(data);
    vi.stubGlobal('window', { location: { pathname: '/admin/assistant', search: '', hash: '' }, addEventListener: vi.fn(), removeEventListener: vi.fn() });
    vi.stubGlobal('document', { addEventListener: vi.fn(), removeEventListener: vi.fn(), visibilityState: 'visible' });
  });
  afterEach(async () => { await act(async () => renderer?.unmount()); vi.unstubAllGlobals(); });

  it("renders the real snapshot and actionable sources without consuming AI", async () => {
    await mount();
    expect(root().findAllByType("dd").map(text)).toEqual(["2", "1", "1", "0", "0"]);
    expect(text(root())).toContain("Pocas respuestas disponibles");
    expect(root().findAllByType("a").some(node => node.props.href === "/admin#business-fixture")).toBe(true);
    expect(state.api.mock.calls.every(([, init]) => !init.method)).toBe(true);
  });

  it("makes limited coverage and unavailable quotas visible without inventing a global all-clear", async () => {
    data.coverage.businessesTruncated = true;
    data.coverage.allowancesUnavailable = 1;
    data.attention = [];
    await mount();
    expect(text(root())).toContain("Cobertura parcial");
    expect(text(root())).toContain("cuotas sin consultar");
    expect(text(root())).toContain("Sin pendientes en los datos consultados");
  });

  it("submits one read-only question with an id and displays a plain answer and server sources", async () => {
    await mount();
    await act(async () => root().findByType("textarea").props.onChange({ target: { value: "  ¿Quién necesita atención?  " } }));
    let resolve!: (value: unknown) => void;
    state.api.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    await act(async () => {
      root().findByType("form").props.onSubmit({ preventDefault() {} });
      root().findByType("form").props.onSubmit({ preventDefault() {} });
    });
    const writes = state.api.mock.calls.filter(([, init]) => init?.method === "POST");
    expect(writes).toHaveLength(1);
    expect(JSON.parse(writes[0][1].body)).toEqual({ requestId: expect.any(String), question: "¿Quién necesita atención?" });
    expect(button("Consultando").props.disabled).toBe(true);
    await act(async () => resolve({ reply: "Revisa Clínica sintética. <script>alert(1)</script>", provider: "deepseek", sources: [source], snapshot: data }));
    expect(text(root())).toContain("Revisa Clínica sintética. <script>alert(1)</script>");
    expect(root().findAllByType("script")).toHaveLength(0);
    expect(root().findAllByType("textarea")[0].props.value).toBe("");
    expect(root().findAllByType("a").some(node => text(node).includes(source.label) && node.props.href === source.href)).toBe(true);
  });

  it("changes the data scope and clears old private conversation before showing another business", async () => {
    await mount();
    const selected = { ...data, scopeBusinessId: "fixture", metrics: { ...data.metrics, businesses: 1, pendingPayments: 0 } };
    state.api.mockResolvedValueOnce(selected);
    await act(async () => root().findByType("select").props.onChange({ target: { value: "fixture" } }));
    expect(state.api.mock.calls.at(-1)?.[0]).toBe("/api/admin/copilot?businessId=fixture");
    expect(root().findAllByType("dd").map(text).slice(0, 2)).toEqual(["1", "0"]);
    await act(async () => root().findByType("textarea").props.onChange({ target: { value: "¿Cómo va este negocio?" } }));
    state.api.mockResolvedValueOnce({ reply: "Consulta de Clínica", provider: "deepseek", sources: [], snapshot: selected });
    await act(async () => root().findByType("form").props.onSubmit({ preventDefault() {} }));
    expect(JSON.parse(state.api.mock.calls.at(-1)![1].body).businessId).toBe("fixture");
    state.api.mockResolvedValueOnce(data);
    await act(async () => root().findByType("select").props.onChange({ target: { value: "" } }));
    expect(text(root())).not.toContain("Consulta de Clínica");
  });

  it("keeps an unsent question after failure and exposes a retryable error", async () => {
    await mount();
    await act(async () => root().findByType("textarea").props.onChange({ target: { value: "¿Qué pagos faltan?" } }));
    state.api.mockRejectedValueOnce(new Error("No se pudo consultar la IA"));
    await act(async () => root().findByType("form").props.onSubmit({ preventDefault() {} }));
    expect(root().findByType("textarea").props.value).toBe("¿Qué pagos faltan?");
    expect(root().findAllByProps({ role: "alert" }).map(text).join("")).toContain("No se pudo consultar la IA");
    expect(button("Preguntar a SarinBot").props.disabled).toBe(false);
  });

  it("shows loading failure without invented zero metrics and can refresh", async () => {
    state.api.mockRejectedValueOnce(new Error("Lectura temporalmente indisponible"));
    await mount();
    expect(root().findAllByType("dd")).toHaveLength(0);
    expect(text(root())).toContain("Lectura temporalmente indisponible");
    await act(async () => button("Actualizar resumen").props.onClick());
    expect(root().findAllByType("dd")).toHaveLength(5);
  });

  it("aborts active reads and questions when unmounted", async () => {
    await mount();
    await act(async () => root().findByType("textarea").props.onChange({ target: { value: "¿Qué falta?" } }));
    state.api.mockImplementationOnce(() => new Promise(() => {}));
    await act(async () => root().findByType("form").props.onSubmit({ preventDefault() {} }));
    const signal = state.api.mock.calls.at(-1)![1].signal as AbortSignal;
    await act(async () => renderer!.unmount());
    renderer = undefined;
    expect(signal.aborted).toBe(true);
  });

  it("prepares a suggested question without sending it automatically", async () => {
    await mount();
    await act(async () => button("¿Qué pagos están pendientes?").props.onClick());
    expect(root().findByType("textarea").props.value).toBe("¿Qué pagos están pendientes?");
    expect(state.api.mock.calls.filter(([, init]) => init.method === "POST")).toHaveLength(0);
    await act(async () => root().findByType("textarea").props.onChange({ target: { value: "   " } }));
    expect(button("Preguntar a SarinBot").props.disabled).toBe(true);
    await act(async () => root().findByType("form").props.onSubmit({ preventDefault() {} }));
    expect(state.api.mock.calls.filter(([, init]) => init.method === "POST")).toHaveLength(0);
  });

  it("discards a response for an old business after the scope changes", async () => {
    await mount();
    let resolveOld!: (value: unknown) => void;
    state.api.mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; }));
    await act(async () => root().findByType("select").props.onChange({ target: { value: "fixture" } }));
    const oldSignal = state.api.mock.calls.at(-1)![1].signal as AbortSignal;
    state.api.mockResolvedValueOnce({ ...data, scopeBusinessId: "second", attention: [], sources: [], metrics: { ...data.metrics, businesses: 1, pendingPayments: 0 } });
    await act(async () => root().findByType("select").props.onChange({ target: { value: "second" } }));
    await act(async () => resolveOld({ ...data, scopeBusinessId: "fixture" }));
    expect(oldSignal.aborted).toBe(true);
    expect(root().findAllByType("dd").map(text).slice(0, 2)).toEqual(["1", "0"]);
    expect(text(root())).not.toContain("Pocas respuestas disponibles");
  });

  it("does not mount private requests when the administrator gate denies access", async () => {
    state.admin = false;
    await act(async () => { renderer = create(createElement(AdminAssistantPage)); });
    expect(text(root())).toContain("Acceso restringido");
    expect(state.api).not.toHaveBeenCalled();
  });

  it("clears private data and ignores a late answer when the account identity changes", async () => {
    state.api.mockImplementation(async (path: string) => path === "/api/admin/whatsapp/conversations" ? { conversations: [], truncated: false } : data);
    await act(async () => { renderer = create(createElement(AdminAssistantPage)); });
    await act(async () => root().findByType("textarea").props.onChange({ target: { value: "Pregunta privada de la cuenta A" } }));
    let resolveOld!: (value: unknown) => void;
    state.api.mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; }));
    await act(async () => root().findByType("form").props.onSubmit({ preventDefault() {} }));
    const signal = state.api.mock.calls.at(-1)![1].signal as AbortSignal;
    const previous = data;
    data = { ...data, businesses: [], attention: [], sources: [], metrics: { businesses: 0, pendingPayments: 0, quotaWarnings: 0, quotaExhausted: 0, expiringSubscriptions: 0 } };
    state.uid = "admin-b";
    await act(async () => renderer!.update(createElement(AdminAssistantPage)));
    await act(async () => resolveOld({ reply: "Respuesta privada de la cuenta A", provider: "deepseek", sources: [source], snapshot: previous }));
    expect(signal.aborted).toBe(true);
    expect(text(root())).not.toContain("Respuesta privada de la cuenta A");
    expect(text(root())).not.toContain("Clínica sintética");
    expect(root().findByType("textarea").props.value).toBe("");
  });
});
