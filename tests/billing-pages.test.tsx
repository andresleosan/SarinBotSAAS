vi.mock('@/components/consent-panel', () => ({ useAccountConsent: () => ({ active: true }) }));
import { act, createElement, type ReactNode } from "react";
import { create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import BillingPage from "@/app/dashboard/billing/page";
import AdminPage from "@/app/admin/page";
import { ApiError } from "@/lib/client/api";

const state = vi.hoisted(() => ({ api: vi.fn(), compress: vi.fn() }));
vi.mock("@/lib/client/api", () => ({ apiFetch: state.api, errorMessage: (error: Error) => error.message, ApiError: class extends Error { constructor(message: string, public status: number, public code?: string) { super(message); } } }));
vi.mock("@/lib/utils/imageCompression", () => ({ compressReceiptToWebP: state.compress }));
vi.mock("@/components/auth-provider", () => ({ AuthGate: ({ children }: { children: ReactNode }) => children, useAuth: () => ({ user: { uid: 'owner' } }) }));
vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: ReactNode }) => children,
  Notice: ({ children }: { children: ReactNode }) => children,
  buttonClass: "button", fieldClass: "field",
}));
vi.mock("@/hooks/useEngineHealth", () => ({ useEngineHealth: () => ({ health: null, checking: false, refresh: vi.fn() }) }));
vi.mock("@/components/admin-ai-settings", () => ({ AdminAiSettings: () => null }));
vi.mock("@/components/admin-ai-usage", () => ({ AdminAiUsage: () => null }));
vi.mock("@/components/admin-whatsapp", () => ({ AdminWhatsApp: () => null }));
vi.mock("@/components/admin-invitations", () => ({ AdminInvitations: () => null }));
vi.mock("@/components/invitation-redeem", () => ({ InvitationRedeem: () => null }));
vi.mock("next/link", () => ({ default: ({ children, href }: { children: ReactNode; href: string }) => createElement("a", { href }, children) }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const settings = { companyName: "Sarin", weeklyPriceCOP: 20000, fortnightlyPriceCOP: 35000, monthlyPriceCOP: 59900, whatsappPriceCOP: 149900, responsePackPriceCOP: 20000, graceHoursOnUpload: 24, bankAccounts: [], tunnelStatus: { isOnline: false, lastPingAt: 0 } };
const business = { id: "business", name: "Negocio de prueba", slug: "prueba", ownerEmail: "owner@example.test", subscription: { status: "active", trialEndsAt: 1900000000000, currentPeriodEndsAt: 1900000000000 } };
const account = { id: "bank-test", bankName: "Entidad de prueba", accountType: "Ahorros", accountNumber: "000000", holderName: "Titular sintético" };
const receipt = { id: "receipt", tenantId: "business", tenantName: business.name, ownerUid: "owner", ownerEmail: business.ownerEmail, amountCOP: 20000, bankSelected: account.bankName, status: "pending", submittedAt: 1800000000000, planId: "weekly", periodDays: 7 };
const quotaPeriod = { id: "period-paid", source: "subscription", planId: "monthly", startsAt: 1800000000000, endsAt: 1900000000000, includedResponses: 3000, extraResponses: 0, usedResponses: 2400, reservedResponses: 0, remainingResponses: 600 };
const allowance = { businessId: "business", currentPeriod: quotaPeriod, nextPeriod: null, state: "warning", warningThresholdPercent: 80 };
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
    billingData = { settings: { ...settings, whatsappPriceCOP: 149900, responsePackPriceCOP: 20000 }, receipts: [], business, allowance: null, whatsappAvailable: false };
    adminData = { settings, receipts: [], businesses: [business], allowances: {} };
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

  it("refreshes an obsolete quote, keeps the selected image and bank, and waits for a second explicit submission", async () => {
    billingData.settings = { ...settings, bankAccounts: [account] };
    await mount();
    await selectImage();
    state.api.mockRejectedValueOnce(new ApiError("El precio cambió. Revisa el importe actualizado antes de enviar.", 409, "OFFER_PRICE_CHANGED"));
    billingData = { ...billingData, settings: { ...settings, bankAccounts: [account], monthlyPriceCOP: 65000 } };
    await act(async () => { renderer.root.findByType("form").props.onSubmit({ preventDefault }); });
    expect(posts()).toHaveLength(1);
    expect(posts()[0].quotedPriceCOP).toBe(59900);
    expect(text(renderer.root)).toContain("65.000");
    expect(text(renderer.root)).toContain("El precio cambió");
    expect(button("Enviar comprobante").props.disabled).toBe(false);
    await act(async () => { renderer.root.findByType("form").props.onSubmit({ preventDefault }); });
    expect(posts()[1]).toMatchObject({ quotedPriceCOP: 65000, receiptDataUrl: posts()[0].receiptDataUrl, bankSelected: "bank-test", requestId: posts()[0].requestId });
  });

  it("blocks a repeated upload when refreshing a changed price fails until an explicit refresh succeeds", async () => {
    billingData.settings = { ...settings, bankAccounts: [account] };
    await mount();
    await selectImage();
    state.api.mockRejectedValueOnce(new ApiError("El precio cambió", 409, "OFFER_PRICE_CHANGED")).mockRejectedValueOnce(new Error("Sin conexión"));
    await act(async () => { renderer.root.findByType("form").props.onSubmit({ preventDefault }); });
    expect(button("Enviar comprobante").props.disabled).toBe(true);
    expect(text(renderer.root)).toContain("actualizar las tarifas");
    await act(async () => { button("Actualizar consumo").props.onClick(); });
    expect(button("Enviar comprobante").props.disabled).toBe(false);
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

  it("edits administrative subscription and pack prices without adding bank accounts", async () => {
    await mount(AdminPage);
    const prices = inputs().filter((input) => input.props.type === "number");
    expect(prices.map((input) => input.props.value)).toEqual([20000, 35000, 59900, 149900, 20000]);
    await act(async () => { prices[0].props.onChange({ target: { value: "21000" } }); });
    await act(async () => { renderer.root.findByType("form").props.onSubmit({ preventDefault }); });
    const payload = JSON.parse(state.api.mock.calls.find(([, init]) => init?.method === "PATCH")![1].body);
    expect(payload.settings).toMatchObject({ weeklyPriceCOP: 21000, fortnightlyPriceCOP: 35000, monthlyPriceCOP: 59900, whatsappPriceCOP: 149900, responsePackPriceCOP: 20000, bankAccounts: [] });
    expect(payload.settings).not.toHaveProperty("trialDaysDefault");
  });

  it("shows commercial administration without a personal chat entry point", async () => {
    await mount(AdminPage);
    expect(text(renderer.root)).toContain("Negocios y suscripciones");
    expect(text(renderer.root)).toContain("Comprobantes de pago");
    expect(renderer.root.findAllByType("a").some(link => link.props.href === "/admin/vault")).toBe(false);
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
  it("labels complimentary trial status in both owner and administrator screens", async () => {
    const courtesy = { ...business, subscription: { status: 'trial', trialEndsAt: 0, currentPeriodEndsAt: 0, paidTrial: { source: 'invitation', invitationId: 'synthetic', accessSuspended: false, activatedAt: 1800000000000, appointmentLimit: 10, appointmentsUsed: 0 } } };
    billingData.business = courtesy;
    await mount();
    expect(text(renderer.root)).toContain('Estado: Prueba de cortesía');
    await act(async () => renderer.unmount());
    adminData.businesses = [courtesy];
    await mount(AdminPage);
    expect(text(renderer.root.findByType('tbody').findAllByType('td')[1])).toBe('Prueba de cortesía');
  });

  it("labels an approved private draft and its receipt without inventing a subscription expiry", async () => {
    adminData.businesses = [{ ...business, name: "", slug: "", subscription: { status: "trial", trialEndsAt: 0, currentPeriodEndsAt: 0, paidTrial: { paymentId: "intro", activatedAt: 1800000000000, appointmentLimit: 10, appointmentsUsed: 0 } } }];
    adminData.receipts = [{ ...receipt, tenantName: "", kind: "paid_trial", amountCOP: 5000, appointmentAllowance: 10, status: "approved", planId: undefined, periodDays: undefined }];
    await mount(AdminPage);
    expect(text(renderer.root.findByType("h3"))).toBe("Pendiente de configurar");
    const cells = renderer.root.findByType("tbody").findAllByType("td");
    expect(text(cells[3])).toBe("Prueba pagada sin caducidad");
    state.api.mockResolvedValueOnce({ receiptDataUrl: "data:image/webp;base64,c3ludGhldGlj" });
    await act(async () => button("Ver captura").props.onClick());
    expect(renderer.root.findByType("img").props.alt).toBe("Comprobante de Pendiente de configurar");
  });

  it("shows the current commercial period and a warning without exposing an unavailable WhatsApp purchase", async () => {
    billingData.allowance = { ...allowance, nextPeriod: { ...quotaPeriod, id: "renewal", startsAt: 1900000000000, endsAt: 1902592000000, usedResponses: 0, remainingResponses: 3000 } };
    await mount();
    const meter = renderer.root.findAll((node) => node.props.role === "progressbar");
    expect(meter).toHaveLength(1);
    expect(meter[0].props["aria-valuenow"]).toBe(80);
    expect(text(renderer.root)).toContain("600 respuestas disponibles");
    expect(text(renderer.root)).toContain("Renovación programada");
    expect(text(renderer.root)).toContain("80%");
    expect(plans().map((input) => input.props.value)).toEqual(["weekly", "fortnightly", "monthly"]);
    expect(text(renderer.root)).toContain("700 respuestas");
  });

  it("does not turn an absent allowance into zero consumption", async () => {
    await mount();
    expect(renderer.root.findAll((node) => node.props.role === "progressbar")).toHaveLength(0);
    expect(text(renderer.root)).toContain("Consumo no disponible");
  });

  it("submits a response pack without a subscription plan and changes retry identity when purchase kind changes", async () => {
    billingData.allowance = allowance;
    billingData.settings = { ...settings, bankAccounts: [account], responsePackPriceCOP: 20000 };
    await mount();
    await selectImage();
    await act(async () => { renderer.root.findByType("form").props.onSubmit({ preventDefault }); });
    const pack = inputs().find((input) => input.props.name === "purchaseKind" && input.props.value === "response_pack");
    expect(pack).toBeDefined();
    await act(async () => { pack!.props.onChange(); });
    await act(async () => { renderer.root.findByType("form").props.onSubmit({ preventDefault }); });
    expect(posts()[1]).toMatchObject({ kind: "response_pack", bankSelected: "bank-test" });
    expect(posts()[1]).not.toHaveProperty("planId");
    expect(posts()[1]).not.toHaveProperty("amountCOP");
    expect(posts()[1]).not.toHaveProperty("responseAllowance");
    expect(posts()[1].requestId).not.toBe(posts()[0].requestId);
    expect(text(renderer.root)).toContain("No extiende la vigencia");
  });

  it("keeps an exhausted paid allowance eligible for a pack but prevents purchases for a trial", async () => {
    billingData.allowance = { ...allowance, state: "exhausted", currentPeriod: { ...quotaPeriod, usedResponses: 3000, remainingResponses: 0 } };
    await mount();
    expect(text(renderer.root)).toContain("La atención de IA está pausada");
    expect(inputs().find((input) => input.props.value === "response_pack")?.props.disabled).toBe(false);
    await act(async () => renderer.unmount());
    billingData.allowance = { ...allowance, state: "active", currentPeriod: { ...quotaPeriod, source: "trial", planId: null, includedResponses: 700, usedResponses: 0, remainingResponses: 700 } };
    await mount();
    expect(inputs().find((input) => input.props.value === "response_pack")?.props.disabled).toBe(true);
  });

  it("keeps a pending pack distinct from a renewal in the owner screen and admin approval", async () => {
    const pack = { ...receipt, kind: "response_pack", planId: undefined, periodDays: undefined, responseAllowance: 1000, quotaPeriodId: "period-paid" };
    billingData.receipts = [pack];
    billingData.allowance = allowance;
    await mount();
    expect(text(renderer.root)).toContain("1.000 respuestas");
    expect(text(renderer.root)).not.toContain("por 30 días");
    expect(button("Enviar comprobante").props.disabled).toBe(true);
    await act(async () => renderer.unmount());
    adminData.receipts = [pack];
    adminData.allowances = { business: allowance };
    await mount(AdminPage);
    expect(button("Aprobar +1.000 respuestas")).toBeDefined();
    state.api.mockResolvedValueOnce({ receiptDataUrl: "data:image/webp;base64,c3ludGhldGlj" });
    await act(async () => { button("Ver captura").props.onClick(); });
    state.api.mockResolvedValueOnce({ receipt: { ...pack, status: "approved" }, business, allowance: { ...allowance, state: "active", currentPeriod: { ...quotaPeriod, extraResponses: 1000, remainingResponses: 1600 } } });
    await act(async () => { button("Aprobar +1.000 respuestas").props.onClick(); });
    expect(text(renderer.root)).toContain("ampliación de 1.000 respuestas");
    expect(text(renderer.root)).not.toContain("suscripción extendida 30 días");
  });

  it("refreshes usage without treating reserved responses as free or displaying a warning below eighty percent", async () => {
    billingData.allowance = { ...allowance, state: "active", currentPeriod: { ...quotaPeriod, usedResponses: 2370, reservedResponses: 30, remainingResponses: 600 } };
    await mount();
    expect(renderer.root.findAll((node) => node.props.role === "progressbar")[0].props["aria-valuenow"]).toBe(79);
    expect(text(renderer.root)).not.toContain("Has alcanzado el 80%");
    expect(text(renderer.root)).toContain("30 respuestas reservadas o pendientes de confirmación");
    billingData.allowance = { ...allowance, state: "exhausted", currentPeriod: { ...quotaPeriod, usedResponses: 3000, remainingResponses: 0 } };
    const refresh = button("Actualizar consumo");
    expect(refresh).toBeDefined();
    await act(async () => refresh.props.onClick());
    expect(text(renderer.root)).toContain("0 respuestas disponibles");
  });

  it("does not sell a pack during preventive access even when old responses remain", async () => {
    billingData.business = { ...business, subscription: { ...business.subscription, status: "past_due", graceEndsAt: 1900000000000 } };
    billingData.allowance = { ...allowance, state: "active" };
    await mount();
    expect(inputs().find(input => input.props.value === "response_pack")?.props.disabled).toBe(true);
  });

  it("accepts the first introductory payment before a business is configured", async () => {
    billingData.business = null;
    billingData.settings = { ...settings, bankAccounts: [account] };
    await mount();
    expect(text(renderer.root)).toContain("5.000");
    expect(text(renderer.root)).toContain("10 citas");
    expect(text(renderer.root)).toContain("sin caducidad");
    expect(inputs().find(input => input.props.value === "paid_trial")?.props.checked).toBe(true);
    expect(inputs().find(input => input.props.type === "file")?.props.disabled).toBe(false);
    await selectImage();
    await act(async () => renderer.root.findByType("form").props.onSubmit({ preventDefault }));
    expect(posts()[0]).toMatchObject({ kind: "paid_trial", bankSelected: account.id });
    expect(posts()[0]).not.toHaveProperty("planId");
    expect(posts()[0]).not.toHaveProperty("periodDays");
    expect(posts()[0]).not.toHaveProperty("amountCOP");
  });

  it("keeps an introductory receipt pending without promising preventive access or thirty days", async () => {
    billingData.business = { ...business, subscription: { status: "pending_payment", trialEndsAt: 0, currentPeriodEndsAt: 0 } };
    billingData.receipts = [{ ...receipt, kind: "paid_trial", amountCOP: 5000, appointmentAllowance: 10, planId: undefined, periodDays: undefined }];
    await mount();
    expect(text(renderer.root)).toContain("pendiente de revisión");
    expect(text(renderer.root)).not.toContain("por 30 días");
    expect(text(renderer.root)).not.toContain("24 horas");
    expect(button("Enviar comprobante").props.disabled).toBe(true);
  });

  it("shows consumed introductory appointments and requires a plan after ten without a repurchase", async () => {
    billingData.business = { ...business, subscription: { status: "trial", trialEndsAt: 0, currentPeriodEndsAt: 0, paidTrial: { paymentId: "intro", activatedAt: 1800000000000, appointmentLimit: 10, appointmentsUsed: 10 } } };
    billingData.allowance = { ...allowance, state: "expired", currentPeriod: { ...quotaPeriod, source: "trial", endsAt: 8640000000000000, includedResponses: 700, usedResponses: 0, remainingResponses: 700 } };
    await mount();
    expect(text(renderer.root)).toContain("10 de 10 citas utilizadas");
    expect(text(renderer.root)).toContain("Elige un plan para continuar");
    expect(inputs().find(input => input.props.value === "paid_trial")).toBeUndefined();
    expect(inputs().find(input => input.props.value === "response_pack")?.props.disabled).toBe(true);
    expect(text(renderer.root)).not.toContain("275760");
    expect(text(renderer.root)).toContain("Prueba finalizada");
    expect(text(renderer.root)).toContain("700 respuestas sin utilizar");
    expect(text(renderer.root)).toContain("no amplían las 10 citas");
    expect(text(renderer.root)).not.toContain("Vencida");
    expect(text(renderer.root)).not.toContain("Esta vigencia terminó");
    expect(text(renderer.root)).not.toContain("700 respuestas disponibles");
  });

  it("approves introductory receipts as ten appointments without extending a subscription", async () => {
    const introductory = { ...receipt, kind: "paid_trial", amountCOP: 5000, appointmentAllowance: 10, planId: undefined, periodDays: undefined };
    adminData.receipts = [introductory];
    await mount(AdminPage);
    expect(text(renderer.root.findByType("article"))).toContain("10 citas");
    expect(button("Aprobar prueba de 10 citas")).toBeDefined();
    state.api.mockResolvedValueOnce({ receiptDataUrl: "data:image/webp;base64,c3ludGhldGlj" });
    await act(async () => button("Ver captura").props.onClick());
    state.api.mockResolvedValueOnce({ receipt: { ...introductory, status: "approved" }, business });
    await act(async () => button("Aprobar prueba de 10 citas").props.onClick());
    expect(text(renderer.root)).toContain("prueba pagada de 10 citas activada");
    expect(text(renderer.root)).not.toContain("suscripción extendida 30 días");
  });
});
