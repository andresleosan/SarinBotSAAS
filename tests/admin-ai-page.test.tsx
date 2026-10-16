import { act, createElement, type ReactNode } from "react";
import { create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AdminPage from "@/app/admin/page";

const state = vi.hoisted(() => ({ api: vi.fn(), refresh: vi.fn() }));
vi.mock("@/lib/client/api", () => ({ apiFetch: state.api, errorMessage: (error: Error) => error.message }));
vi.mock("@/components/auth-provider", () => ({ AuthGate: ({ children }: { children: ReactNode }) => children }));
vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: ReactNode }) => children,
  Notice: ({ children, error }: { children: ReactNode; error?: boolean }) => createElement("p", { role: error ? "alert" : "status" }, children),
  buttonClass: "button", fieldClass: "field",
}));
vi.mock("@/hooks/useEngineHealth", () => ({ useEngineHealth: () => ({ health: { status: "online", provider: "ollama" }, checking: false, refresh: state.refresh }) }));
vi.mock("next/link", () => ({ default: ({ children, href }: { children: ReactNode; href: string }) => createElement("a", { href }, children) }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const settings = { companyName: "Sarin", weeklyPriceCOP: 20000, fortnightlyPriceCOP: 35000, monthlyPriceCOP: 59900, trialDaysDefault: 7, graceHoursOnUpload: 24, bankAccounts: [], tunnelStatus: { isOnline: false, lastPingAt: 0 } };
function text(node: ReactTestInstance | string): string { return typeof node === "string" ? node : node.children.map(text).join(""); }
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

describe("owner AI controls", () => {
  let renderer: ReactTestRenderer;
  let ai: { provider: string; source: string; updatedAt: number | null; providers: { provider: string; configured: boolean; model: string | null; online: boolean; checkedAt: number; error?: string }[] };
  const radios = () => renderer.root.findAllByType("input").filter(input => input.props.name === "aiProvider");
  const patches = () => state.api.mock.calls.filter(([path, init]) => path === "/api/admin/ai" && init?.method === "PATCH");
  const active = () => text(renderer.root.findByProps({ "aria-label": "IA activa" }));
  const button = (label: string) => renderer.root.findAllByType("button").find(item => text(item).includes(label))!;
  async function mount() { await act(async () => { renderer = create(createElement(AdminPage)); }); }
  async function chooseDeepSeek() {
    expect(radios()).toHaveLength(2);
    await act(async () => { radios().find(input => input.props.value === "deepseek")!.props.onChange(); });
  }
  beforeEach(() => {
    ai = { provider: "ollama", source: "environment", updatedAt: null, providers: [
      { provider: "ollama", configured: true, model: "local-model", online: true, checkedAt: 1800000000000 },
      { provider: "deepseek", configured: true, model: "deepseek-flash", online: true, checkedAt: 1800000000000 },
    ] };
    state.refresh.mockReset();
    state.api.mockReset().mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === "/api/admin") return { businesses: [], receipts: [], settings };
      if (path === "/api/admin/ai" && !init?.method) return ai;
      throw new Error("Unexpected API request");
    });
  });
  afterEach(async () => { await act(async () => renderer?.unmount()); });

  it("changes AI only on explicit save and locks selection while the request is pending", async () => {
    await mount();
    await chooseDeepSeek();
    expect(patches()).toHaveLength(0);
    expect(active()).toContain("Ollama");
    const pending = deferred<unknown>();
    state.api.mockImplementationOnce(() => pending.promise);
    await act(async () => { button("Guardar IA").props.onClick(); });
    expect(JSON.parse(patches()[0][1].body)).toEqual({ provider: "deepseek" });
    expect(radios().every(input => input.props.disabled)).toBe(true);
    expect(button("Guardando").props.disabled).toBe(true);
    ai = { ...ai, provider: "deepseek", source: "admin", updatedAt: 1800000000001 };
    await act(async () => { pending.resolve({ provider: "deepseek", source: "admin", updatedAt: 1800000000001 }); });
    expect(active()).toContain("DeepSeek");
    expect(button("Guardar IA").props.disabled).toBe(true);
    expect(state.refresh).toHaveBeenCalledTimes(1);
  });

  it("retains the actual active provider after a rejected change without automatic retries", async () => {
    await mount();
    await chooseDeepSeek();
    state.api.mockRejectedValueOnce(new Error("Proveedor no disponible"));
    await act(async () => { button("Guardar IA").props.onClick(); });
    expect(active()).toContain("Ollama");
    expect(radios().find(input => input.props.checked)?.props.value).toBe("deepseek");
    expect(patches()).toHaveLength(1);
    expect(button("Guardar IA").props.disabled).toBe(false);
    expect(renderer.root.findAllByProps({ role: "alert" }).some(item => text(item).includes("Proveedor no disponible"))).toBe(true);
  });

  it("prevents selecting an unconfigured provider without asking for credentials", async () => {
    ai.providers[1] = { ...ai.providers[1], configured: false, online: false, model: null, error: "Configuración pendiente" };
    await mount();
    expect(radios()).toHaveLength(2);
    expect(radios().find(input => input.props.value === "deepseek")!.props.disabled).toBe(true);
    expect(button("Guardar IA").props.disabled).toBe(true);
    expect(renderer.root.findByProps({ "aria-labelledby": "admin-ai-title" }).findAllByType("input").every(input => input.props.type === "radio")).toBe(true);
    expect(patches()).toHaveLength(0);
  });

  it("keeps a successful saved selection when refreshing provider status fails", async () => {
    await mount();
    await chooseDeepSeek();
    state.api.mockResolvedValueOnce({ provider: "deepseek", source: "admin", updatedAt: 1800000000001 }).mockRejectedValueOnce(new Error("Estado temporalmente inaccesible"));
    await act(async () => { button("Guardar IA").props.onClick(); });
    expect(active()).toContain("DeepSeek");
    expect(patches()).toHaveLength(1);
    expect(button("Guardar IA").props.disabled).toBe(true);
    expect(renderer.root.findAllByProps({ role: "alert" }).some(item => text(item).includes("Estado temporalmente inaccesible"))).toBe(true);
  });

  it("retries a failed status read without writing provider configuration", async () => {
    state.api.mockImplementation(async (path: string) => {
      if (path === "/api/admin") return { businesses: [], receipts: [], settings };
      throw new Error("Sin acceso al estado");
    });
    await mount();
    expect(renderer.root.findAllByProps({ role: "alert" }).some(item => text(item).includes("Sin acceso al estado"))).toBe(true);
    expect(radios()).toHaveLength(0);
    state.api.mockResolvedValueOnce(ai);
    await act(async () => { button("Actualizar estado de IA").props.onClick(); });
    expect(radios()).toHaveLength(2);
    expect(patches()).toHaveLength(0);
  });
});
