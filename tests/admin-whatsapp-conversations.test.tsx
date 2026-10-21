import { act, createElement, type ReactNode } from "react";
import { create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AdminWhatsAppConversations } from "@/components/admin-whatsapp-conversations";

const state = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock("@/lib/client/api", () => ({ apiFetch: state.api, errorMessage: (error: Error) => error.message }));
vi.mock("@/components/app-shell", () => ({ Notice: ({ children, error }: { children: ReactNode; error?: boolean }) => createElement("p", { role: error ? "alert" : "status" }, children), buttonClass: "button", fieldClass: "field" }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const text = (node: ReactTestInstance | string): string => typeof node === "string" ? node : node.children.map(text).join("");
const businesses = [{ id: "fixture", name: "Clínica sintética" }, { id: "second", name: "Taller sintético" }];
const conversation = { id: "thread-a", businessId: "fixture", phoneNumberId: "123456789", mode: "bot", revision: 2, updatedAt: "2026-10-17T14:00:00.000Z", lastInboundAt: "2026-10-17T14:00:00.000Z", lastHumanAt: null, customerName: "Persona de prueba", customerPhone: "+573000000001", lastMessage: "Quiero revisar mi cita", contentAvailable: true };

describe("administrative WhatsApp conversation handoff", () => {
  let renderer: ReactTestRenderer | undefined;
  const root = () => renderer!.root;
  const button = (label: string) => root().findAllByType("button").find(node => text(node).includes(label))!;
  const writes = () => state.api.mock.calls.filter(([, init]) => init?.method === "PATCH");
  async function mount() { await act(async () => { renderer = create(createElement(AdminWhatsAppConversations, { businesses })); }); }
  beforeEach(() => { state.api.mockReset().mockResolvedValue({ conversations: [conversation], truncated: false }); });
  afterEach(async () => { await act(async () => renderer?.unmount()); });

  it("shows the confirmed responsibility and customer context", async () => {
    await mount();
    expect(text(root())).toContain("SarinBot atiende");
    expect(text(root())).toContain("Persona de prueba");
    expect(text(root())).toContain("Quiero revisar mi cita");
    expect(text(root())).toContain("Clínica sintética");
    expect(writes()).toHaveLength(0);
  });

  it("takes control once with the expected revision and renders only the confirmed change", async () => {
    await mount();
    let resolve!: (value: unknown) => void;
    state.api.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    await act(async () => { button("Tomar conversación").props.onClick(); button("Tomar conversación").props.onClick(); });
    expect(writes()).toHaveLength(1);
    expect(JSON.parse(writes()[0][1].body)).toEqual({ conversationId: "thread-a", mode: "human", expectedRevision: 2 });
    expect(text(root())).toContain("SarinBot atiende");
    expect(button("Guardando").props.disabled).toBe(true);
    await act(async () => resolve({ conversation: { ...conversation, mode: "human", revision: 3 } }));
    expect(text(root())).toContain("Tú atiendes");
    expect(button("Devolver a SarinBot").props.disabled).toBe(false);
  });

  it("refreshes a conflict before letting the operator retry with the current revision", async () => {
    await mount();
    state.api.mockRejectedValueOnce(Object.assign(new Error("La conversación cambió"), { status: 409 }));
    state.api.mockResolvedValueOnce({ conversations: [{ ...conversation, mode: "review", revision: 7 }], truncated: false });
    await act(async () => button("Tomar conversación").props.onClick());
    expect(text(root())).toContain("Necesita revisión");
    expect(text(root())).toContain("La conversación cambió");
    state.api.mockResolvedValueOnce({ conversation: { ...conversation, mode: "human", revision: 8 } });
    await act(async () => button("Tomar conversación").props.onClick());
    expect(JSON.parse(writes()[1][1].body).expectedRevision).toBe(7);
  });

  it("can return control for new messages or leave a conversation pending review", async () => {
    state.api.mockResolvedValueOnce({ conversations: [{ ...conversation, mode: "human", revision: 3 }], truncated: false });
    await mount();
    state.api.mockResolvedValueOnce({ conversation: { ...conversation, mode: "bot", revision: 4 } });
    await act(async () => button("Devolver a SarinBot").props.onClick());
    expect(JSON.parse(writes()[0][1].body).mode).toBe("bot");
    expect(text(root())).toContain("mensajes nuevos");
    state.api.mockResolvedValueOnce({ conversation: { ...conversation, mode: "review", revision: 5 } });
    await act(async () => button("Marcar para revisión").props.onClick());
    expect(JSON.parse(writes()[1][1].body)).toEqual({ conversationId: "thread-a", mode: "review", expectedRevision: 4 });
    expect(text(root())).toContain("Necesita revisión");
  });

  it("shows unavailable content and bounded coverage explicitly", async () => {
    state.api.mockResolvedValueOnce({ conversations: [{ ...conversation, contentAvailable: false, customerName: null, customerPhone: null, lastMessage: null }], truncated: true });
    await mount();
    expect(text(root())).toContain("Contenido no disponible");
    expect(text(root())).not.toContain("Persona de prueba");
    expect(text(root())).toContain("lista parcial");
  });

  it("filters by business without treating hidden conversations as an empty global inbox", async () => {
    await mount();
    await act(async () => root().findByType("select").props.onChange({ target: { value: "second" } }));
    expect(text(root())).not.toContain("Persona de prueba");
    expect(text(root())).toContain("Sin conversaciones para este negocio");
  });

  it("keeps the confirmed mode when a mutation fails and cancels requests on unmount", async () => {
    await mount();
    state.api.mockRejectedValueOnce(new Error("No se pudo guardar"));
    await act(async () => button("Tomar conversación").props.onClick());
    expect(text(root())).toContain("SarinBot atiende");
    expect(text(root())).toContain("No se pudo guardar");
    state.api.mockImplementationOnce(() => new Promise(() => {}));
    await act(async () => button("Tomar conversación").props.onClick());
    const signal = writes().at(-1)![1].signal as AbortSignal;
    await act(async () => renderer!.unmount());
    renderer = undefined;
    expect(signal.aborted).toBe(true);
  });

  it("distinguishes failed reads from an empty inbox and permits a fresh read", async () => {
    state.api.mockRejectedValueOnce(new Error("No se pudo consultar la bandeja"));
    await mount();
    expect(text(root())).toContain("No se pudo consultar la bandeja");
    expect(text(root())).not.toContain("Todavía no hay conversaciones disponibles");
    state.api.mockResolvedValueOnce({ conversations: [], truncated: false });
    await act(async () => button("Actualizar conversaciones").props.onClick());
    expect(text(root())).toContain("Todavía no hay conversaciones disponibles");
    expect(text(root())).toContain("no confirma que WhatsApp esté conectado");
  });
});
