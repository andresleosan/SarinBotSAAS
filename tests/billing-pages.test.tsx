import { act, createElement, type ReactNode } from "react";
import { create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import BillingPage from "@/app/dashboard/billing/page";
import AdminPage from "@/app/admin/page";

const state = vi.hoisted(() => ({ api: vi.fn(), compress: vi.fn() }));
vi.mock("@/lib/client/api", () => ({ apiFetch: state.api, errorMessage: (error: Error) => error.message }));
vi.mock("@/lib/utils/imageCompression", () => ({ compressReceiptToWebP: state.compress }));
vi.mock("@/components/auth-provider", () => ({ AuthGate: ({ children }: { children: ReactNode }) => children }));
vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: ReactNode }) => children,
  Notice: ({ children }: { children: ReactNode }) => children,
  buttonClass: "button", fieldClass: "field",
}));
vi.mock("@/hooks/useEngineHealth", () => ({ useEngineHealth: () => ({ health: null, checking: false, refresh: vi.fn() }) }));
vi.mock("@/components/admin-ai-settings", () => ({ AdminAiSettings: () => null }));
vi.mock("@/components/admin-ai-usage", () => ({ AdminAiUsage: () => null }));
vi.mock("next/link", () => ({ default: ({ children, href }: { children: ReactNode; href: string }) => createElement("a", { href }, children) }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const settings = { companyName: "Sarin", weeklyPriceCOP: 20000, fortnightlyPriceCOP: 35000, monthlyPriceCOP: 59900, trialDaysDefault: 7, graceHoursOnUpload: 24, bankAccounts: [], tunnelStatus: { isOnline: false, lastPingAt: 0 } };
const business = { id: "business", name: "Negocio de prueba", slug: "prueba", ownerEmail: "owner@example.test", subscription: { status: "trial", trialEndsAt: 1900000000000, currentPeriodEndsAt: 1900000000000 } };
const account = { id: "bank-test", bankName: "Entidad de prueba", accountType: "Ahorros", accountNumber: "000000", holderName: "Titular sintético" };
const receipt = { id: "receipt", tenantId: "business", tenantName: business.name, ownerUid: "owner", ownerEmail: business.ownerEmail, amountCOP: 20000, bankSelected: account.bankName, status: "pending", submittedAt: 1800000000000, planId: "weekly", periodDays: 7 };
const preventDefault = () => {};
function text(node: ReactTestInstance | string): string {
  return typeof node === "string" ? node : node.children.map(text).join("");
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

describe("billing plan screens", () => {
  let renderer: ReactTestRenderer;
  let billingData: Record<string, unknown>;
  let adminData: Record<string, unknown>;
  async function mount(page = BillingPage) {
    await act(async () => { renderer = create(createElement(page)); });
  }
  const inputs = () => renderer.root.findAllByType("input");
  const plans = () => inputs().filter((input) => input.props.name === "planId");
  const buttons = () => renderer.root.findAllByType("button");
  const button = (label: string) => buttons().find((item) => text(item).includes(label))!;
  const posts = () => state.api.mock.calls.filter(([, init]) => init?.method === "POST").map(([, init]) => JSON.parse(init.body));
  async function selectImage() {
    await act(async () => { inputs().find((input) => input.props.type === "file")!.props.onChange({ target: { files: [new File(["synthetic"], "receipt.png", { type: "image/png" })] } }); });
  }
  beforeEach(() => {
    billingData = { settings, receipts: [], business };
    adminData = { settings, receipts: [], businesses: [business] };
    state.api.mockReset().mockImplementation(async (path: string, init?: RequestInit) => {
      if (init?.method === "POST") throw new Error("Conexión interrumpida");
      if (init?.method === "PATCH") return {};
      return path === "/api/admin" ? adminData : billingData;
    });
    state.compress.mockReset().mockResolvedValue(new Blob(["synthetic"]));
    vi.stubGlobal("FileReader", class {
      result = "data:image/webp;base64,c3ludGhldGlj";
      onload?: () => void;
      readAsDataURL() { this.onload?.(); }
    });
  });
  afterEach(async () => { await act(async () => renderer?.unmount()); vi.unstubAllGlobals(); });

  it("offers three accessible periods with monthly selected and no upload without bank accounts", async () => {
    await mount();
    expect(plans()).toHaveLength(3);
    expect(plans().find((input) => input.props.checked)?.props.value).toBe("monthly");
    expect(text(renderer.root)).toContain("59.900");
    expect(inputs().find((input) => input.props.type === "file")!.props.disabled).toBe(true);
    await act(async () => { plans().find((input) => input.props.value === "weekly")!.props.onChange(); });
    expect(plans().find((input) => input.props.checked)?.props.value).toBe("weekly");
    expect(text(renderer.root)).toContain("por 7 días");
    expect(button("Enviar comprobante").props.disabled).toBe(true);
  });

  it("submits only the selected plan and preserves retry identity until that selection changes", async () => {
    billingData.settings = { ...settings, bankAccounts: [account] };
    await mount();
    await selectImage();
    await act(async () => { renderer.root.findByType("form").props.onSubmit({ preventDefault }); });
    await act(async () => { renderer.root.findByType("form").props.onSubmit({ preventDefault }); });
    expect(posts()[0]).toMatchObject({ planId: "monthly", bankSelected: "bank-test" });
    expect(posts()[1].requestId).toBe(posts()[0].requestId);
    await act(async () => { plans().find((input) => input.props.value === "fortnightly")!.props.onChange(); });
    const pending = deferred<unknown>();
    state.api.mockImplementationOnce(() => pending.promise);
    await act(async () => { renderer.root.findByType("form").props.onSubmit({ preventDefault }); });
    expect(posts()[2].planId).toBe("fortnightly");
    expect(posts()[2].requestId).not.toBe(posts()[0].requestId);
    expect(posts()[2]).not.toHaveProperty("amountCOP");
    expect(posts()[2]).not.toHaveProperty("periodDays");
    expect(plans().every((input) => input.props.disabled)).toBe(true);
    expect(inputs().find((input) => input.props.type === "file")!.props.disabled).toBe(true);
    await act(async () => { pending.reject(new Error("Conexión interrumpida")); });
  });

  it("locks plan changes during image processing", async () => {
    billingData.settings = { ...settings, bankAccounts: [account] };
    const compression = deferred<Blob>();
    state.compress.mockReturnValueOnce(compression.promise);
    await mount();
    await selectImage();
    expect(plans()).toHaveLength(3);
    expect(plans().every((input) => input.props.disabled)).toBe(true);
    await act(async () => { compression.resolve(new Blob(["synthetic"])); });
    expect(plans().every((input) => !input.props.disabled)).toBe(true);
  });

  it("shows the pending receipt's saved period and amount instead of the monthly default", async () => {
    billingData.receipts = [{ ...receipt, amountCOP: 19000 }];
    billingData.settings = { ...settings, bankAccounts: [account] };
    await mount();
    expect(plans().find((input) => input.props.checked)?.props.value).toBe("weekly");
    expect(plans().every((input) => input.props.disabled)).toBe(true);
    expect(text(renderer.root)).toContain("19.000");
    expect(text(renderer.root)).toContain("por 7 días");
    expect(inputs().find((input) => input.props.type === "file")!.props.disabled).toBe(true);
    expect(button("Enviar comprobante").props.disabled).toBe(true);
  });

  it("labels receipt history by saved period and treats legacy receipts as thirty days", async () => {
    billingData.receipts = [{ ...receipt, status: "approved" }, { ...receipt, id: "old", status: "approved", planId: undefined, periodDays: undefined }];
    await mount();
    const articles = renderer.root.findAllByType("article");
    expect(text(articles[0])).toContain("Semanal · 7 días");
    expect(text(articles[1])).toContain("Mensual · 30 días");
  });

  it("edits all three administrative prices without adding bank accounts", async () => {
    await mount(AdminPage);
    const prices = inputs().filter((input) => input.props.type === "number");
    expect(prices.map((input) => input.props.value)).toEqual([20000, 35000, 59900]);
    await act(async () => { prices[0].props.onChange({ target: { value: "21000" } }); });
    await act(async () => { renderer.root.findByType("form").props.onSubmit({ preventDefault }); });
    const payload = JSON.parse(state.api.mock.calls.find(([, init]) => init?.method === "PATCH")![1].body);
    expect(payload.settings).toMatchObject({ weeklyPriceCOP: 21000, fortnightlyPriceCOP: 35000, monthlyPriceCOP: 59900, bankAccounts: [] });
  });

  it("reviews and confirms the duration from the saved receipt", async () => {
    adminData.receipts = [{ ...receipt, planId: "fortnightly", periodDays: 15, amountCOP: 35000 }];
    await mount(AdminPage);
    expect(text(renderer.root.findByType("article"))).toContain("Quincenal · 15 días");
    expect(button("Aprobar +15 días")).toBeDefined();
    state.api.mockResolvedValueOnce({ receiptDataUrl: "data:image/webp;base64,c3ludGhldGlj" });
    await act(async () => { button("Ver captura").props.onClick(); });
    state.api.mockResolvedValueOnce({ receipt: { ...receipt, status: "approved", planId: "fortnightly", periodDays: 15 }, business });
    await act(async () => { button("Aprobar +15 días").props.onClick(); });
    expect(text(renderer.root)).toContain("suscripción extendida 15 días");
  });

  it("does not invent a payment expiry date for a business without an approved payment", async () => {
    adminData.businesses = [{ ...business, subscription: { ...business.subscription, currentPeriodEndsAt: 0 } }];
    await mount(AdminPage);
    const cells = renderer.root.findByType("tbody").findAllByType("td");
    expect(text(cells[3])).toBe("Sin pago aprobado");
  });
});
