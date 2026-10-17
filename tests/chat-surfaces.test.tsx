import { act, createElement, Suspense, useEffect, type ReactNode } from "react";
import { create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import OnboardingPage from "@/app/dashboard/onboarding/page";
import ClientPage from "@/app/b/[slug]/page";
import DashboardPage from "@/app/dashboard/page";
vi.mock('@/components/client-policy-controls', () => ({ ClientPolicyControls: () => null }));
import { apiFetch } from "@/lib/client/api";
import type { Business } from "@/types/firestore";

const state = vi.hoisted(() => ({
  user: { uid: "fixture-client", displayName: "Fixture" },
  accountConsent: true, businessConsent: true,
  policyReady: true, policyKnown: true, minors: true, dataMode: 'general' as 'general' | 'health', chatMount: vi.fn(), structuredMount: vi.fn(), structuredUnmount: vi.fn(),
  send: vi.fn(), retry: vi.fn(),
  business: null as Business | null,
  publicSubscription: { status: "active", currentPeriodEndsAt: 2200000000000 } as Business["subscription"],
  chat: { messages: [], isWaitingBatch: false, isGenerating: false, error: null as string | null, quotaExhausted: false, requestAlreadyCompleted: false },
}));
vi.mock("@/hooks/useDebouncedChat", () => ({ useDebouncedChat: () => { state.chatMount(); return { ...state.chat, sendMessage: state.send, retry: state.retry }; } }));
vi.mock('@/hooks/useBookingDataPolicy', () => ({ useBookingDataPolicy: () => ({ ready: state.policyReady, loading: !state.policyReady, error: !state.policyReady && state.policyKnown ? 'Error temporal' : null, refresh: vi.fn(), capability: state.policyKnown ? { configured: true, revision: 1, dataMode: state.dataMode, representedMinorsEnabled: state.minors } : null }) }));
vi.mock('@/components/structured-booking', () => ({ StructuredBooking: ({ enabled }: { enabled: boolean }) => { useEffect(() => { state.structuredMount(); return () => { state.structuredUnmount(); }; }, []); return createElement('div', { 'data-enabled': enabled }, 'Reserva sin IA'); } }));
vi.mock('@/components/consent-panel', () => ({ useAccountConsent: () => ({ active: state.accountConsent }), ConsentPanel: () => null }));
vi.mock('@/hooks/useConsent', () => ({ useConsent: () => ({ active: state.businessConsent }) }));
vi.mock("@/hooks/useBusiness", () => ({ useBusiness: () => ({ business: state.business, loading: false, error: null }) }));
vi.mock("@/hooks/useEngineHealth", () => ({ useEngineHealth: () => ({ health: { status: "online" }, checking: false, refresh: vi.fn() }) }));
vi.mock("@/components/auth-provider", () => ({ AuthGate: ({ children }: { children: ReactNode }) => children, useAuth: () => ({ user: state.user, signOut: vi.fn() }) }));
vi.mock("@/components/app-shell", () => ({ AppShell: ({ children }: { children: ReactNode }) => children, Notice: ({ children }: { children: ReactNode }) => children, buttonClass: "button", fieldClass: "field" }));
vi.mock("@/lib/client/api", () => ({ apiFetch: vi.fn(), errorMessage: (error: Error) => error.message }));
vi.mock("next/link", () => ({ default: ({ children, href }: { children: ReactNode; href: string }) => createElement("a", { href }, children) }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const text = (node: ReactTestInstance | string): string => typeof node === "string" ? node : node.children.map(text).join("");

describe("chat pause surfaces", () => {
  let renderer: ReactTestRenderer;
  beforeEach(() => { state.policyReady = true; state.policyKnown = true; state.minors = true; state.dataMode = 'general'; state.chatMount.mockClear(); state.structuredMount.mockClear(); state.structuredUnmount.mockClear(); });
  beforeEach(() => { state.accountConsent = true; state.businessConsent = true; state.chat = { messages: [], isWaitingBatch: false, isGenerating: false, error: null, quotaExhausted: false, requestAlreadyCompleted: false }; state.send.mockReset(); state.retry.mockReset(); state.publicSubscription = { status: "active", trialEndsAt: 0, currentPeriodEndsAt: 2200000000000 }; state.business = { id: "fixture-business", name: "Negocio", slug: "negocio", subscription: state.publicSubscription, category: "Servicios", phoneWhatsApp: "", resources: [], services: [], sarinConfig: { onboardingCompleted: true, tone: "Claro", customRules: "", intakeFields: [] }, weeklySchedule: {} } as unknown as Business; vi.mocked(apiFetch).mockReset();
    vi.mocked(apiFetch).mockImplementation(async (path, init) => init?.method ? {} : { appointments: [{ id: "appointment", tenantId: "fixture-business", serviceName: "Cita conservada", type: "appointment", status: "confirmed", dateKey: new URL(path, "https://example.invalid").searchParams.get("date") ?? "2039-01-01", startAt: 2177485200000, endAt: 2177487000000, startTimeStr: "09:00", endTimeStr: "09:30", client: { uid: state.user.uid, name: "Fixture", email: "fixture@example.invalid", intakeAnswers: {} } }] });
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ business: { id: "fixture-business", name: "Negocio sintetico", phoneWhatsApp: "", services: [], subscription: state.publicSubscription } })));
  });
  afterEach(async () => { await act(async () => renderer?.unmount()); vi.unstubAllGlobals(); });
  it('keeps appointments and cancellation visible while new chat and booking contact require consent', async () => {
    state.businessConsent = false;
    await act(async () => { renderer = create(createElement(Suspense, { fallback: null }, createElement(ClientPage, { params: Promise.resolve({ slug: 'fixture' }) }))); });
    expect(renderer.root.findByProps({ 'aria-label': 'Mensaje para Sarin' }).props.disabled).toBe(true);
    expect(text(renderer.root)).toContain('Cita conservada');
    state.businessConsent = true;
  });
  it('never mounts chat while policy is loading or in a restricted booking flow', async () => {
    state.policyReady = false; state.policyKnown = false; state.chatMount.mockClear();
    const params = Promise.resolve({ slug: 'fixture' });
    await act(async () => { renderer = create(createElement(Suspense, { fallback: null }, createElement(ClientPage, { params }))); });
    expect(state.chatMount).not.toHaveBeenCalled(); expect(text(renderer.root)).toContain('Cita conservada');
    state.policyReady = true; state.policyKnown = true; state.dataMode = 'health';
    await act(async () => renderer.update(createElement(Suspense, { fallback: null }, createElement(ClientPage, { params }))));
    expect(state.chatMount).not.toHaveBeenCalled(); expect(text(renderer.root)).toContain('Reserva sin IA'); state.dataMode = 'general';
  });
  it('keeps the restricted controller mounted across outer withdrawals and policy errors', async () => {
    state.dataMode = 'health';
    const params = Promise.resolve({ slug: 'fixture' }), render = () => createElement(Suspense, { fallback: null }, createElement(ClientPage, { params }));
    await act(async () => { renderer = create(render()); });
    for (const change of [() => { state.accountConsent = false; }, () => { state.businessConsent = false; }, () => { state.policyReady = false; }, () => { state.minors = false; }]) {
      change(); await act(async () => renderer.update(render()));
      expect(state.structuredUnmount).not.toHaveBeenCalled();
      expect(renderer.root.findByProps({ 'data-enabled': false })).toBeTruthy();
    }
    expect(state.structuredMount).toHaveBeenCalledTimes(1); expect(state.chatMount).not.toHaveBeenCalled();
  });
  it('does not return a browser scrolling promise as an effect cleanup', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await act(async () => { renderer = create(createElement(Suspense, { fallback: null }, createElement(ClientPage, { params: Promise.resolve({ slug: 'fixture' }) })), { createNodeMock: element => element.type === 'div' ? { scrollIntoView: () => Promise.resolve() } : null }); });
      expect(errors.mock.calls.some(call => String(call[0]).includes('useEffect must not return'))).toBe(false);
    } finally { errors.mockRestore(); }
  });
  it("allows a new configuration message after the server reports the earlier turn completed", async () => {
    state.chat.error = "Solicitud ya atendida";
    state.chat.requestAlreadyCompleted = true;
    await act(async () => { renderer = create(createElement(OnboardingPage)); });
    const input = renderer.root.findAllByType("input").find((node) => node.props["aria-label"] === "Mensaje para Sarin")!;
    await act(async () => input.props.onChange({ target: { value: "Nueva consulta" } }));
    const send = renderer.root.findAllByType("button").find((node) => node.props["aria-label"] === "Enviar mensaje")!;
    expect(send.props.disabled).toBe(false);
    expect(renderer.root.findAllByType("button").filter((node) => text(node).includes("Reintentar mensaje"))).toHaveLength(0);
  });
  it("pauses public chat without removing confirmed appointments or offering a subscription to the customer", async () => {
    state.chat.error = "Quota details are private";
    state.chat.quotaExhausted = true;
    const params = Promise.resolve({ slug: "fixture" });
    await act(async () => { renderer = create(createElement(Suspense, { fallback: null }, createElement(ClientPage, { params }))); });
    const input = renderer.root.findAllByType("input").find((node) => node.props["aria-label"] === "Mensaje para Sarin")!;
    expect(input.props.disabled).toBe(true);
    expect(text(renderer.root)).toContain("Cita conservada");
    expect(renderer.root.findAllByType("a").some(node => node.props.href === "#mis-citas" && text(node) === "Mis citas")).toBe(true);
    expect(text(renderer.root)).not.toContain("Quota details are private");
    expect(renderer.root.findAllByType("a").some((node) => node.props.href === "/dashboard/billing")).toBe(false);
    expect(renderer.root.findAllByType("a").some((node) => node.props.href === "/privacidad")).toBe(true);
    expect(renderer.root.findAllByType("a").some((node) => node.props.href === "/ayuda")).toBe(true);
    const check = renderer.root.findAllByType("button").find((node) => text(node) === "Comprobar disponibilidad")!;
    await act(async () => check.props.onClick());
    expect(state.retry).toHaveBeenCalledTimes(1);
  });

  it("keeps owner cancellation available after the tenth appointment and offers a plan", async () => {
    state.business!.subscription = { status: "trial", trialEndsAt: 0, currentPeriodEndsAt: 0, paidTrial: { paymentId: "intro", activatedAt: 1800000000000, appointmentLimit: 10, appointmentsUsed: 10 } };
    await act(async () => { renderer = create(createElement(DashboardPage)); });
    expect(text(renderer.root)).toContain("10 de 10 citas utilizadas");
    expect(text(renderer.root)).toContain("Elige un plan para continuar");
    const cancel = renderer.root.findAllByType("button").find(node => text(node).includes("Cancelar cita"))!;
    expect(cancel.props.disabled).toBe(false);
    await act(async () => cancel.props.onClick());
    expect(vi.mocked(apiFetch)).toHaveBeenCalledWith("/api/businesses/fixture-business/appointments", expect.objectContaining({ method: "PATCH" }));
  });

  it("pauses new public messages after ten introductory appointments while preserving the confirmed appointment", async () => {
    state.publicSubscription = { status: "trial", trialEndsAt: 0, currentPeriodEndsAt: 0, paidTrial: { paymentId: "intro", activatedAt: 1800000000000, appointmentLimit: 10, appointmentsUsed: 10 } };
    await act(async () => { renderer = create(createElement(Suspense, { fallback: null }, createElement(ClientPage, { params: Promise.resolve({ slug: "fixture" }) }))); });
    expect(renderer.root.findByProps({ "aria-label": "Mensaje para Sarin" }).props.disabled).toBe(true);
    expect(text(renderer.root)).toContain("Cita conservada");
    expect(text(renderer.root)).not.toContain("Elige un plan");
    expect(state.send).not.toHaveBeenCalled();
  });

  it("lets the customer retry the saved tenth appointment after a network failure without sending a new message", async () => {
    state.publicSubscription = { status: "trial", trialEndsAt: 0, currentPeriodEndsAt: 0, paidTrial: { paymentId: "intro", activatedAt: 1800000000000, appointmentLimit: 10, appointmentsUsed: 10 } };
    state.chat.error = "Conexión interrumpida";
    await act(async () => { renderer = create(createElement(Suspense, { fallback: null }, createElement(ClientPage, { params: Promise.resolve({ slug: "fixture" }) }))); });
    const retry = renderer.root.findAllByType("button").find(node => text(node) === "Reintentar mensaje")!;
    expect(retry.props.disabled).toBe(false);
    expect(renderer.root.findByProps({ "aria-label": "Mensaje para Sarin" }).props.disabled).toBe(true);
    expect(renderer.root.findByProps({ "aria-label": "Enviar mensaje" }).props.disabled).toBe(true);
    await act(async () => retry.props.onClick());
    expect(state.retry).toHaveBeenCalledTimes(1);
    expect(state.send).not.toHaveBeenCalled();
  });

  it("does not display an old agenda read after changing business", async () => {
    const reads: { path: string; signal: AbortSignal; resolve: (value: unknown) => void }[] = [];
    vi.mocked(apiFetch).mockImplementation((path, init) => new Promise(resolve => reads.push({ path, signal: init!.signal as AbortSignal, resolve })));
    await act(async () => { renderer = create(createElement(DashboardPage)); });
    state.business = { ...state.business!, id: "new-business" };
    await act(async () => renderer.update(createElement(DashboardPage)));
    expect(reads[0].signal.aborted).toBe(true);
    const date = new URL(reads[0].path, "https://example.invalid").searchParams.get("date");
    await act(async () => reads[0].resolve({ appointments: [{ id: "private-old", tenantId: "fixture-business", dateKey: date, serviceName: "Private previous agenda", status: "confirmed", startAt: 2177485200000 }] }));
    expect(text(renderer.root)).not.toContain("Private previous agenda");
  });

  it("does not show an old cancellation error in another business", async () => {
    let reject!: (error: Error) => void;
    const read = vi.mocked(apiFetch).getMockImplementation()!;
    vi.mocked(apiFetch).mockImplementation((path, init) => init?.method ? new Promise((_resolve, fail) => { reject = fail; }) : read(path, init));
    await act(async () => { renderer = create(createElement(DashboardPage)); });
    const cancel = renderer.root.findAllByType("button").find(node => text(node).includes("Cancelar cita"))!;
    await act(async () => cancel.props.onClick());
    state.business = { ...state.business!, id: "new-business" };
    await act(async () => renderer.update(createElement(DashboardPage)));
    await act(async () => reject(new Error("Private previous mutation error")));
    expect(text(renderer.root)).not.toContain("Private previous mutation error");
  });
});
