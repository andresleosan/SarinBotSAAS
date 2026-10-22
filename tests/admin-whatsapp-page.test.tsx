import { act, createElement, type ReactNode } from "react";
vi.mock('@/components/admin-invitations', () => ({ AdminInvitations: () => null }));
import { create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AdminPage from "@/app/admin/page";
vi.mock('@/components/admin-platform-budget', () => ({ AdminPlatformBudget: () => null }));
import type { AdminWhatsAppSettings } from "@/types/whatsapp";

const state = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock("@/lib/client/api", () => ({ apiFetch: state.api, errorMessage: (error: Error) => error.message }));
vi.mock("@/components/auth-provider", () => ({ AuthGate: ({ children }: { children: ReactNode }) => children }));
vi.mock("@/components/app-shell", () => ({ AppShell: ({ children }: { children: ReactNode }) => children, Notice: ({ children }: { children: ReactNode }) => children, buttonClass: "button", fieldClass: "field" }));
vi.mock("@/hooks/useEngineHealth", () => ({ useEngineHealth: () => ({ health: null, checking: false, refresh: vi.fn() }) }));
vi.mock("@/components/admin-ai-settings", () => ({ AdminAiSettings: () => null }));
vi.mock("@/components/admin-ai-usage", () => ({ AdminAiUsage: () => null }));
vi.mock("next/link", () => ({ default: ({ children, href }: { children: ReactNode; href: string }) => createElement("a", { href }, children) }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const settings = { companyName: "Sarin", weeklyPriceCOP: 20000, fortnightlyPriceCOP: 35000, monthlyPriceCOP: 59900, whatsappPriceCOP: 149900, responsePackPriceCOP: 20000, trialDaysDefault: 7, graceHoursOnUpload: 24, bankAccounts: [], tunnelStatus: { isOnline: false, lastPingAt: 0 } };
const business = { id: "fixture", name: "Negocio sintético", slug: "fixture", ownerEmail: "owner@example.test", subscription: { status: "trial", trialEndsAt: 1900000000000, currentPeriodEndsAt: 0 } };
const text = (node: ReactTestInstance | string): string => typeof node === "string" ? node : node.children.map(text).join("");
describe("administrative WhatsApp preparation", () => {
  let renderer: ReactTestRenderer;
  let data: AdminWhatsAppSettings;
  const section = () => renderer.root.findAllByType("section").find(node => node.props["aria-labelledby"] === "admin-whatsapp-title");
  const inputs = () => section()!.findAllByType("input");
  const button = (label: string) => section()!.findAllByType("button").find(node => text(node).includes(label))!;
  const writes = () => state.api.mock.calls.filter(([, init]) => init?.method === "PATCH");
  async function mount() { await act(async () => { renderer = create(createElement(AdminPage)); }); }
  beforeEach(() => {
    data = { enabled: false, configured: false, graphApiVersion: "v25.0", missingConfiguration: ["WHATSAPP_APP_SECRET"], bindings: [], truncated: false };
    state.api.mockReset().mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === "/api/admin" && !init?.method) return { settings, businesses: [business, { ...business, id: "second", name: "Segundo negocio" }], receipts: [], allowances: {} };
      if (path === "/api/admin/whatsapp" && !init?.method) return data;
      throw new Error("Unexpected request");
    });
  });
  afterEach(async () => { await act(async () => renderer?.unmount()); });
  it("shows preparation without claiming connectivity or allowing enablement when server configuration is absent", async () => {
    await mount();
    expect(section()).toBeDefined();
    expect(text(section()!)).toContain("Sin números vinculados");
    expect(inputs().some(input => input.props.type === "password")).toBe(false);
    expect(inputs().find(input => input.props.name === "whatsappEnabled")?.props.disabled).toBe(true);
    expect(writes()).toHaveLength(0);
  });
  it("saves only a paused identifier binding and does not send secrets or auto-enable", async () => {
    await mount();
    await act(async () => {
      inputs().find(input => input.props.name === "phoneNumberId")!.props.onChange({ target: { value: "123456789" } });
      inputs().find(input => input.props.name === "wabaId")!.props.onChange({ target: { value: "987654321" } });
    });
    const saved = { ...data, bindings: [{ businessId: "fixture", phoneNumberId: "123456789", wabaId: "987654321", enabled: false, credentialConfigured: false, status: "paused" as const, lastInboundAt: null, lastDeliveredAt: null }] };
    let resolve!: (value: AdminWhatsAppSettings) => void;
    state.api.mockImplementationOnce(() => new Promise<AdminWhatsAppSettings>(done => { resolve = done; }));
    await act(async () => section()!.findByType("form").props.onSubmit({ preventDefault() {} }));
    expect(JSON.parse(writes()[0][1].body)).toEqual({ businessId: "fixture", phoneNumberId: "123456789", wabaId: "987654321", enabled: false });
    expect(button("Guardando").props.disabled).toBe(true);
    await act(async () => resolve(saved));
    expect(text(section()!)).toContain("Vinculación guardada");
    expect(text(section()!)).toContain("Pausado");
  });
  it("retains the server's unverified state after a rejected explicit enable request", async () => {
    data = { ...data, enabled: true, configured: true, missingConfiguration: [], bindings: [{ businessId: "fixture", phoneNumberId: "123456789", wabaId: "987654321", enabled: false, credentialConfigured: true, status: "configured_unverified", lastInboundAt: null, lastDeliveredAt: null }] };
    await mount();
    await act(async () => inputs().find(input => input.props.name === "whatsappEnabled")!.props.onChange({ target: { checked: true } }));
    expect(writes()).toHaveLength(0);
    state.api.mockRejectedValueOnce(new Error("Meta no confirmó la conexión"));
    await act(async () => section()!.findByType("form").props.onSubmit({ preventDefault() {} }));
    expect(text(section()!)).toContain("Sin verificar");
    expect(text(section()!)).not.toContain("Conectado y verificado");
    expect(writes()).toHaveLength(1);
  });

  it("clears unsaved identifiers when choosing a different business", async () => {
    await mount();
    await act(async () => inputs().find(input => input.props.name === "phoneNumberId")!.props.onChange({ target: { value: "123456789" } }));
    await act(async () => section()!.findByType("select").props.onChange({ target: { value: "second" } }));
    expect(inputs().find(input => input.props.name === "phoneNumberId")?.props.value).toBe("");
    expect(button("Guardar vinculación").props.disabled).toBe(true);
  });

  it("shows recorded deliveries and uncertain outcomes without turning unavailable Meta cost into zero", async () => {
    data.usage = { month: "2026-10", timeZone: "America/Bogota", source: "meta_webhooks", cohort: "generated_month", invoice: false, estimatedCostCOP: null, truncated: false, businesses: [], totals: { sent: 15, delivered: 12, read: 7, failed: 2, unknown: 1, serviceDelivered: 12, utilityDelivered: 0, marketingDelivered: 0, otherDelivered: 0, freeDelivered: 2, regularDelivered: 10, unknownPricingDelivered: 0 } };
    await mount();
    const usage = section()!.findAll(node => node.props["aria-label"] === "Actividad de WhatsApp");
    expect(usage).toHaveLength(1);
    expect(usage[0].findAllByType("dd").map(text)).toEqual(["12", "2", "1"]);
    expect(text(usage[0])).toContain("Costo no calculado");
    expect(text(usage[0])).not.toContain("$0");
  });
});
vi.mock('@/components/admin-ai-budget', () => ({ AdminAiBudget: () => null }));
vi.mock('@/components/admin-booking-data-policy', () => ({ AdminBookingDataPolicy: () => null }));
