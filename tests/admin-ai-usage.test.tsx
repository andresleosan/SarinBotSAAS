import { act, createElement, type ReactNode } from "react";
vi.mock('@/components/admin-invitations', () => ({ AdminInvitations: () => null }));
vi.mock('@/components/admin-ai-budget', () => ({ AdminAiBudget: () => null }));
import { create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AdminPage from "@/app/admin/page";
vi.mock('@/components/admin-platform-budget', () => ({ AdminPlatformBudget: () => null }));
vi.mock("@/components/admin-whatsapp", () => ({ AdminWhatsApp: () => null }));
import type { AdminAiUsage, AiUsageTotals } from "@/types/ai";

const state = vi.hoisted(() => ({ api: vi.fn(), search: new URLSearchParams('module=intelligence&section=usage') }));
vi.mock("@/lib/client/api", () => ({ apiFetch: state.api, errorMessage: (error: Error) => error.message }));
vi.mock("@/components/auth-provider", () => ({ AuthGate: ({ children }: { children: ReactNode }) => children, useAuth: () => ({ user: { uid: 'demo-admin' }, isSuperadmin: true, authEpoch: 1, signingOut: false }) }));
vi.mock('next/navigation', () => ({ usePathname: () => '/admin', useSearchParams: () => state.search, useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: ReactNode }) => children,
  Notice: ({ children, error }: { children: ReactNode; error?: boolean }) => createElement("p", { role: error ? "alert" : "status" }, children),
  buttonClass: "button", fieldClass: "field",
}));
vi.mock("@/components/admin-ai-settings", () => ({ AdminAiSettings: () => null }));
vi.mock("@/hooks/useEngineHealth", () => ({ useEngineHealth: () => ({ health: null, checking: false, refresh: vi.fn() }) }));
vi.mock("next/link", () => ({ default: ({ children, href }: { children: ReactNode; href: string }) => createElement("a", { href }, children) }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const empty: AiUsageTotals = { calls: 0, successfulCalls: 0, failedCalls: 0, usageReportedCalls: 0, missingUsageCalls: 0, costEstimatedCalls: 0, unknownCostCalls: 0, promptTokens: 0, cacheHitTokens: 0, cacheMissTokens: 0, completionTokens: 0, estimatedCostUSD: null };
const counted: AiUsageTotals = { calls: 3, successfulCalls: 3, failedCalls: 0, usageReportedCalls: 3, missingUsageCalls: 0, costEstimatedCalls: 3, unknownCostCalls: 0, promptTokens: 10000, cacheHitTokens: 1000, cacheMissTokens: 9000, completionTokens: 1000, estimatedCostUSD: { min: 0.0035, max: 0.007 } };
const settings = { companyName: "Sarin", weeklyPriceCOP: 20000, fortnightlyPriceCOP: 35000, monthlyPriceCOP: 59900, trialDaysDefault: 7, graceHoursOnUpload: 24, bankAccounts: [], tunnelStatus: { isOnline: false, lastPingAt: 0 } };
const business = { id: "synthetic-business", name: "Barbería sintética", slug: "synthetic", ownerEmail: "owner@example.test", subscription: { status: "trial", trialEndsAt: 1900000000000, currentPeriodEndsAt: 0 } };
function text(node: ReactTestInstance | string): string { return typeof node === "string" ? node : node.children.map(text).join(""); }
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

describe("monthly administrative AI usage", () => {
  let renderer: ReactTestRenderer;
  let usage: AdminAiUsage;
  function panel() {
    const panels = renderer.root.findAllByProps({ "aria-labelledby": "admin-ai-usage-title" });
    expect(panels).toHaveLength(1);
    return panels[0];
  }
  const reload = () => panel().findAllByType("button").find(item => text(item).includes("Actualizar consumo"))!;
  const summary = () => panel().findByType("dl").findAllByType("dd").map(text);
  async function mount() {
    await act(async () => { renderer = create(createElement(AdminPage)); });
    expect(renderer.root.find(node => node.type === 'section' && node.props.id === 'admin-usage').props.hidden).toBe(false);
  }
  beforeEach(() => {
    vi.stubGlobal('window', { location: { pathname: '/admin', search: '?module=intelligence&section=usage', hash: '' }, addEventListener: vi.fn(), removeEventListener: vi.fn() });
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-16T02:00:00Z"));
    usage = { month: "2026-10", timeZone: "America/Bogota", provider: "deepseek", model: "deepseek-flash", pricingVersion: "deepseek-flash-verified-2026-10-15", measurementStartedAt: Date.parse("2026-10-15T23:00:00Z"), coverage: "best_effort", telemetryProcessStartedAt: Date.parse("2026-10-15T23:00:00Z"), telemetryWriteFailures: 0, totals: counted, businesses: [], truncated: false };
    state.api.mockReset().mockImplementation(async (path: string) => {
      if (path === "/api/admin") return { businesses: [business], receipts: [], settings };
      if (path.startsWith("/api/admin/ai/usage?month=")) return usage;
      throw new Error("Unexpected API request");
    });
  });
  afterEach(async () => { await act(async () => renderer?.unmount()); vi.useRealTimers(); vi.unstubAllGlobals(); });

  it("renders server estimates and joins business names without exposing additional identity data", async () => {
    usage.businesses = [
      { businessId: business.id, ...counted },
      { businessId: "unavailable-business", ...empty },
      { businessId: null, ...empty },
    ];
    await mount();
    expect(summary()).toEqual(["3", "10.000 / 1.000", "USD 0,0035 – USD 0,007"]);
    const rows = panel().findByType("tbody").findAllByType("tr");
    expect(rows.map(row => text(row.findAllByType("td")[0]))).toEqual(["Barbería sintética", "Negocio: unavailable-business", "Configuración inicial"]);
    expect(text(panel())).not.toContain("owner@example.test");
    expect(state.api.mock.calls.every(([path, init]) => ["/api/admin", "/api/admin/ai/usage?month=2026-10"].includes(path) && !init?.method)).toBe(true);
  });

  it("distinguishes missing measurement from a measured month without activity", async () => {
    usage = { ...usage, measurementStartedAt: null, totals: empty };
    await mount();
    expect(text(panel())).toContain("Todavía no hay medición");
    expect(panel().findAllByType("dl")).toHaveLength(0);
    expect(text(panel())).not.toContain("USD 0");
    usage = { ...usage, measurementStartedAt: Date.parse("2026-10-01T05:00:00Z") };
    await act(async () => { reload().props.onClick(); });
    expect(summary()).toEqual(["0", "0 / 0", "No disponible"]);
    expect(text(panel())).toContain("Sin actividad registrada");
  });

  it("does not present pre-counter history or the previous month's numbers as a new month", async () => {
    await mount();
    const pending = deferred<AdminAiUsage>();
    state.api.mockImplementationOnce(() => pending.promise);
    await act(async () => { panel().findByProps({ type: "month" }).props.onChange({ target: { value: "2026-09" } }); });
    expect(panel().findAllByType("dl")).toHaveLength(0);
    expect(state.api.mock.calls.at(-1)?.[0]).toBe("/api/admin/ai/usage?month=2026-09");
    await act(async () => { pending.resolve({ ...usage, month: "2026-09", totals: empty }); });
    expect(text(panel())).toContain("Este mes es anterior al inicio del registro");
    expect(panel().findAllByType("dl")).toHaveLength(0);
  });

  it("labels incomplete cost data and write confirmation failures without turning unknown cost into zero", async () => {
    usage = { ...usage, telemetryWriteFailures: 2, truncated: true, totals: { ...counted, calls: 5, failedCalls: 2, missingUsageCalls: 2, costEstimatedCalls: 0, unknownCostCalls: 5, estimatedCostUSD: null } };
    await mount();
    expect(summary()[2]).toBe("No disponible");
    expect(text(panel())).toContain("5 llamadas sin costo estimable");
    expect(text(panel())).toContain("2 llamadas sin reporte de tokens");
    expect(text(panel())).toContain("2 fallos al confirmar el registro");
    expect(text(panel())).toContain("La tabla muestra una parte de los negocios");
    expect(text(panel())).toContain("Los totales mensuales no se recortan");
    expect(text(panel())).not.toMatch(/USD 0|llamadas perdidas/);
  });

  it("preserves the last successful reading on refresh failure and retries only the read endpoint", async () => {
    await mount();
    state.api.mockRejectedValueOnce(new Error("No se pudo consultar el consumo"));
    await act(async () => { reload().props.onClick(); });
    expect(summary()[0]).toBe("3");
    expect(panel().findAllByProps({ role: "alert" }).some(item => text(item).includes("No se pudo consultar el consumo"))).toBe(true);
    usage = { ...usage, totals: { ...counted, calls: 4 } };
    await act(async () => { reload().props.onClick(); });
    expect(summary()[0]).toBe("4");
    expect(state.api.mock.calls.every(([, init]) => !init?.method)).toBe(true);
  });

  it("does not round a positive sub-cent estimate down to free usage", async () => {
    usage = { ...usage, totals: { ...counted, estimatedCostUSD: { min: 0.0000001, max: 0.0000001 } } };
    await mount();
    expect(summary()[2]).toBe("< USD 0,0001");
  });

  it("keeps the latest DeepSeek refresh when an earlier request finishes late", async () => {
    await mount();
    const refresh = reload().props.onClick;
    const previous = deferred<AdminAiUsage>();
    state.api.mockImplementationOnce(() => previous.promise);
    await act(async () => { refresh(); });
    const latest = deferred<AdminAiUsage>();
    state.api.mockImplementationOnce(() => latest.promise);
    await act(async () => { refresh(); });
    await act(async () => { latest.resolve({ ...usage, totals: { ...counted, calls: 7 } }); });
    expect(summary()[0]).toBe("7");
    await act(async () => { previous.resolve({ ...usage, totals: { ...counted, calls: 3 } }); });
    expect(summary()[0]).toBe("7");
    expect(text(panel().findByType("h2"))).toBe("Consumo de DeepSeek");
    expect(state.api.mock.calls.every(([, init]) => !init?.method)).toBe(true);
  });

  it("reads Gemini history without selecting the active AI or accepting a late DeepSeek refresh", async () => {
    await mount();
    const previous = deferred<AdminAiUsage>();
    state.api.mockImplementationOnce(() => previous.promise);
    await act(async () => { reload().props.onClick(); });
    const selected = deferred<AdminAiUsage>();
    state.api.mockImplementationOnce(() => selected.promise);
    await act(async () => { panel().findByProps({ "aria-label": "Proveedor del consumo" }).props.onChange({ target: { value: "gemini" } }); });
    expect(panel().findAllByType("dl")).toHaveLength(0);
    expect(text(panel().findByType("h2"))).toBe("Consumo de Gemini · Clientes");
    expect(state.api.mock.calls.at(-1)?.[0]).toBe("/api/admin/ai/usage?month=2026-10&provider=gemini");
    await act(async () => { selected.resolve({ ...usage, provider: "gemini", model: "gemini-3.5-flash-lite", pricingVersion: "gemini-3.5-flash-lite-standard-verified-2026-10-16", totals: { ...counted, calls: 7, estimatedCostUSD: { min: 0.000459, max: 0.000459 } } }); });
    expect(summary()).toEqual(["7", "10.000 / 1.000", "USD 0,0005"]);
    await act(async () => { previous.resolve({ ...usage, totals: { ...counted, calls: 99 } }); });
    expect(summary()[0]).toBe("7");
    expect(text(panel())).toContain("La salida incluye los tokens de razonamiento");
    expect(text(panel())).toContain("sin descontar créditos ni beneficios de planes de Google");
    expect(state.api.mock.calls.every(([, init]) => !init?.method)).toBe(true);
  });

  it("keeps Gemini without measurement separate from existing DeepSeek totals", async () => {
    await mount();
    state.api.mockResolvedValueOnce({ ...usage, provider: "gemini", model: "gemini-3.5-flash-lite", pricingVersion: "gemini-3.5-flash-lite-standard-verified-2026-10-16", measurementStartedAt: null, totals: empty });
    await act(async () => { panel().findByProps({ "aria-label": "Proveedor del consumo" }).props.onChange({ target: { value: "gemini" } }); });
    expect(text(panel())).toContain("Todavía no hay medición");
    expect(panel().findAllByType("dl")).toHaveLength(0);
    expect(text(panel())).not.toContain("USD 0");
  });
});
vi.mock('@/components/admin-booking-data-policy', () => ({ AdminBookingDataPolicy: () => null }));
