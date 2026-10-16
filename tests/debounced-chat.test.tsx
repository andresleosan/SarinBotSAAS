import { act, createElement } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDebouncedChat } from "@/hooks/useDebouncedChat";
import { apiFetch } from "@/lib/client/api";
import type { ChatResponse } from "@/types/chat";

vi.mock("@/lib/client/api", () => ({
  apiFetch: vi.fn(),
  errorMessage: (error: unknown) =>
    error instanceof Error ? error.message : String(error),
}));
(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
type Payload = {
  tenantId: string;
  requestId: string;
  messages: Array<{ role: string; content: string }>;
};
function payload(index: number): Payload {
  return JSON.parse(
    String(vi.mocked(apiFetch).mock.calls[index][1]?.body),
  ) as Payload;
}

describe("debounced authenticated chat lifecycle", () => {
  let renderer: ReactTestRenderer | undefined;
  let chat!: ReturnType<typeof useDebouncedChat>;
  function Harness({ tenantId = "business-1" }: { tenantId?: string }) {
    chat = useDebouncedChat({ mode: "sarin_client", tenantId });
    return null;
  }
  async function mount() {
    await act(async () => {
      renderer = create(createElement(Harness));
    });
  }
  async function advance(milliseconds = 2500) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(milliseconds);
    });
  }
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(apiFetch).mockReset();
  });
  afterEach(async () => {
    await act(async () => renderer?.unmount());
    renderer = undefined;
    vi.useRealTimers();
  });

  it("sends a burst as one user turn after 2.5 seconds from its last message", async () => {
    vi.mocked(apiFetch).mockResolvedValue({ reply: "Hola" });
    await mount();
    act(() => chat.sendMessage("Buenas"));
    await advance(1000);
    act(() => chat.sendMessage("Quiero una cita"));
    await advance(2499);
    expect(apiFetch).not.toHaveBeenCalled();
    await advance(1);
    expect(apiFetch).toHaveBeenCalledTimes(1);
    expect(payload(0).messages).toEqual([
      { role: "user", content: "Buenas\nQuiero una cita" },
    ]);
    expect(chat.messages.map((message) => message.content)).toEqual([
      "Buenas",
      "Quiero una cita",
      "Hola",
    ]);
  });

  it("waits for the running turn before processing a second burst", async () => {
    const first = deferred<ChatResponse>();
    vi.mocked(apiFetch)
      .mockImplementationOnce(() => first.promise)
      .mockResolvedValueOnce({ reply: "Segundo" });
    await mount();
    act(() => chat.sendMessage("Primero"));
    await advance();
    act(() => {
      chat.sendMessage("Después");
      chat.sendMessage("Otro dato");
    });
    await advance();
    expect(apiFetch).toHaveBeenCalledTimes(1);
    await act(async () => {
      first.resolve({ reply: "Recibido" });
    });
    expect(apiFetch).toHaveBeenCalledTimes(2);
    expect(payload(1).messages).toEqual([
      { role: "user", content: "Primero" },
      { role: "assistant", content: "Recibido" },
      { role: "user", content: "Después\nOtro dato" },
    ]);
  });

  it("retries the same request without losing a later burst", async () => {
    const first = deferred<ChatResponse>();
    vi.mocked(apiFetch)
      .mockImplementationOnce(() => first.promise)
      .mockResolvedValueOnce({ reply: "Reintentado" })
      .mockResolvedValueOnce({ reply: "Siguiente" });
    await mount();
    act(() => chat.sendMessage("Reserva"));
    await advance();
    act(() => chat.sendMessage("Un dato adicional"));
    await advance();
    await act(async () => {
      first.reject(new Error("Sin conexión"));
    });
    expect(chat.error).toBe("Sin conexión");
    expect(apiFetch).toHaveBeenCalledTimes(1);
    await act(async () => {
      chat.retry();
    });
    expect(apiFetch).toHaveBeenCalledTimes(3);
    expect(payload(1).requestId).toBe(payload(0).requestId);
    expect(payload(1).messages).toEqual(payload(0).messages);
    expect(payload(2).messages.at(-1)).toEqual({
      role: "user",
      content: "Un dato adicional",
    });
    expect(chat.error).toBeNull();
  });

  it("aborts requests and clears conversation when switching businesses", async () => {
    const first = deferred<ChatResponse>();
    vi.mocked(apiFetch).mockImplementationOnce(() => first.promise);
    await mount();
    act(() => chat.sendMessage("Privado del primer negocio"));
    await advance();
    const signal = vi.mocked(apiFetch).mock.calls[0][1]?.signal;
    await act(async () => {
      renderer?.update(createElement(Harness, { tenantId: "business-2" }));
    });
    expect(signal?.aborted).toBe(true);
    await act(async () => {
      first.resolve({ reply: "Respuesta antigua" });
    });
    expect(chat.messages).toEqual([]);
    expect(chat.isGenerating).toBe(false);
    act(() => chat.sendMessage("Pendiente"));
    await act(async () => {
      renderer?.unmount();
      renderer = undefined;
    });
    await advance();
    expect(apiFetch).toHaveBeenCalledTimes(1);
  });

  it("splits oversized bursts and bounds context without limiting later turns", async () => {
    vi.mocked(apiFetch).mockResolvedValue({ reply: "Recibido" });
    await mount();
    act(() => {
      chat.sendMessage("a".repeat(8000));
      chat.sendMessage("b".repeat(8000));
    });
    await advance();
    expect(apiFetch).toHaveBeenCalledTimes(2);
    expect(payload(0).messages.at(-1)?.content).toBe("a".repeat(8000));
    expect(payload(1).messages.at(-1)?.content).toBe("b".repeat(8000));
    for (let index = 0; index < 35; index++) {
      act(() => chat.sendMessage(`Turno ${index}`));
      await advance();
    }
    expect(payload(36).messages.length).toBeLessThanOrEqual(60);
    expect(
      chat.messages.filter((message) => message.role === "user"),
    ).toHaveLength(37);
  });

  it("pauses new messages after quota exhaustion while preserving the failed request for an explicit retry", async () => {
    vi.mocked(apiFetch).mockRejectedValueOnce(Object.assign(new Error("Capacidad agotada"), { status: 402, code: "AI_QUOTA_EXHAUSTED" }));
    await mount();
    act(() => chat.sendMessage("Quiero reservar"));
    await advance();
    expect(chat.quotaExhausted).toBe(true);
    const count = chat.messages.length;
    act(() => chat.sendMessage("No debe acumularse durante la pausa"));
    await advance(10000);
    expect(apiFetch).toHaveBeenCalledTimes(1);
    expect(chat.messages).toHaveLength(count);
    vi.mocked(apiFetch).mockResolvedValueOnce({ reply: "Podemos continuar" });
    await act(async () => chat.retry());
    expect(payload(1).requestId).toBe(payload(0).requestId);
    expect(chat.quotaExhausted).toBe(false);
    expect(chat.messages.at(-1)?.content).toBe("Podemos continuar");
  });

  it("does not confuse a transport failure with quota exhaustion", async () => {
    vi.mocked(apiFetch).mockRejectedValueOnce(Object.assign(new Error("Motor temporalmente ocupado"), { status: 429 }));
    await mount();
    act(() => chat.sendMessage("Hola"));
    await advance();
    expect(chat.error).toBe("Motor temporalmente ocupado");
    expect(chat.quotaExhausted).toBe(false);
  });

  it("does not retry an already completed turn and permits a new request", async () => {
    vi.mocked(apiFetch).mockRejectedValueOnce(Object.assign(new Error("Esta solicitud ya fue atendida"), { status: 409, code: "REQUEST_ALREADY_COMPLETED" }));
    await mount();
    act(() => chat.sendMessage("Reserva original"));
    await advance();
    expect(chat.requestAlreadyCompleted).toBe(true);
    await act(async () => chat.retry());
    expect(apiFetch).toHaveBeenCalledTimes(1);
    vi.mocked(apiFetch).mockResolvedValueOnce({ reply: "Nueva respuesta" });
    act(() => chat.sendMessage("Consulta nueva"));
    await advance();
    expect(apiFetch).toHaveBeenCalledTimes(2);
    expect(payload(1).requestId).not.toBe(payload(0).requestId);
    expect(payload(1).messages.at(-1)?.content).toBe("Consulta nueva");
    expect(chat.requestAlreadyCompleted).toBe(false);
  });
});
