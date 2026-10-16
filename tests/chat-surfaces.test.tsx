import { act, createElement, Suspense, type ReactNode } from "react";
import { create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import OnboardingPage from "@/app/dashboard/onboarding/page";
import ClientPage from "@/app/b/[slug]/page";

const state = vi.hoisted(() => ({
  user: { uid: "fixture-client", displayName: "Fixture" },
  send: vi.fn(), retry: vi.fn(),
  chat: { messages: [], isWaitingBatch: false, isGenerating: false, error: null as string | null, quotaExhausted: false, requestAlreadyCompleted: false },
}));
vi.mock("@/hooks/useDebouncedChat", () => ({ useDebouncedChat: () => ({ ...state.chat, sendMessage: state.send, retry: state.retry }) }));
vi.mock("@/hooks/useBusiness", () => ({ useBusiness: () => ({ business: null, loading: false, error: null }) }));
vi.mock("@/hooks/useEngineHealth", () => ({ useEngineHealth: () => ({ health: { status: "online" }, checking: false, refresh: vi.fn() }) }));
vi.mock("@/components/auth-provider", () => ({ AuthGate: ({ children }: { children: ReactNode }) => children, useAuth: () => ({ user: state.user, signOut: vi.fn() }) }));
vi.mock("@/components/app-shell", () => ({ AppShell: ({ children }: { children: ReactNode }) => children, Notice: ({ children }: { children: ReactNode }) => children, buttonClass: "button", fieldClass: "field" }));
vi.mock("@/lib/client/api", () => ({ apiFetch: vi.fn(), errorMessage: (error: Error) => error.message }));
vi.mock("@/lib/firebase/client", () => ({ getFirebaseClient: () => ({ db: {} }) }));
vi.mock("firebase/firestore", () => ({
  doc: () => ({ kind: "business" }), collection: () => ({ kind: "appointments" }), where: vi.fn(), query: (reference: unknown) => reference,
  onSnapshot: (reference: { kind: string }, callback: (snapshot: unknown) => void) => {
    callback(reference.kind === "business" ? { exists: () => true, data: () => ({ id: "fixture-business", name: "Negocio sintético", phoneWhatsApp: "", services: [], subscription: { status: "active", currentPeriodEndsAt: 2200000000000 } }) } : { docs: [{ id: "appointment", data: () => ({ serviceName: "Cita conservada", status: "confirmed", dateKey: "2039-01-01", startAt: 2177485200000, endAt: 2177487000000, startTimeStr: "09:00", endTimeStr: "09:30" }) }] });
    return () => {};
  },
}));
vi.mock("next/link", () => ({ default: ({ children, href }: { children: ReactNode; href: string }) => createElement("a", { href }, children) }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const text = (node: ReactTestInstance | string): string => typeof node === "string" ? node : node.children.map(text).join("");

describe("chat pause surfaces", () => {
  let renderer: ReactTestRenderer;
  beforeEach(() => { state.chat = { messages: [], isWaitingBatch: false, isGenerating: false, error: null, quotaExhausted: false, requestAlreadyCompleted: false }; state.send.mockReset(); state.retry.mockReset(); });
  afterEach(async () => { await act(async () => renderer?.unmount()); });
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
    expect(text(renderer.root)).not.toContain("Quota details are private");
    expect(renderer.root.findAllByType("a").some((node) => node.props.href === "/dashboard/billing")).toBe(false);
    const check = renderer.root.findAllByType("button").find((node) => text(node) === "Comprobar disponibilidad")!;
    await act(async () => check.props.onClick());
    expect(state.retry).toHaveBeenCalledTimes(1);
  });
});
