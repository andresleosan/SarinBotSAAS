"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { Copy, UploadCloud } from "lucide-react";
import { AuthGate } from "@/components/auth-provider";
import {
  AppShell,
  Notice,
  buttonClass,
  fieldClass,
} from "@/components/app-shell";
import { apiFetch, errorMessage } from "@/lib/client/api";
import { compressReceiptToWebP } from "@/lib/utils/imageCompression";
import { BILLING_PLANS, RESPONSE_PACK, getBillingPlan, type SubscriptionPlanId } from "@/lib/billing-plans";
import { ResponseQuota, quotaDate } from "@/components/response-quota";
import { PaidTrialStatus } from "@/components/paid-trial-status";
import { canPurchasePaidTrial, PAID_TRIAL_PRICE_COP, PAID_TRIAL_APPOINTMENT_LIMIT, PAID_TRIAL_INCLUDED_RESPONSES } from "@/lib/paid-trial";
import { isSubscriptionAllowed } from "@/lib/sarin/subscription";
import type {
  Business,
  PaymentReceipt,
  PlatformSettings,
  ResponseAllowance,
} from "@/types/firestore";

interface BillingData {
  settings: PlatformSettings;
  receipts: PaymentReceipt[];
  business: Business | null;
  allowance: ResponseAllowance | null;
  whatsappAvailable: boolean;
}
const subscriptionLabels: Record<Business["subscription"]["status"], string> = {
  pending_payment: "Pendiente de pago aprobado",
  trial: "Prueba pagada",
  active: "Activa",
  past_due: "Pago pendiente",
  suspended: "Suspendida",
};
function readDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      typeof reader.result === "string"
        ? resolve(reader.result)
        : reject(new Error("No se pudo leer la imagen."));
    reader.onerror = () => reject(new Error("No se pudo leer la imagen."));
    reader.readAsDataURL(blob);
  });
}

function Billing() {
  const [data, setData] = useState<BillingData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [bank, setBank] = useState("");
  const [image, setImage] = useState("");
  const [imageSize, setImageSize] = useState(0);
  const [compressing, setCompressing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [requestId, setRequestId] = useState("");
  const [planId, setPlanId] = useState<SubscriptionPlanId>("monthly");
  const [purchaseKind, setPurchaseKind] = useState<"paid_trial" | "subscription" | "response_pack">("subscription");
  const pendingReceipt = data?.receipts.find((receipt) => receipt.status === "pending");
  const canBuyTrial = canPurchasePaidTrial(data?.business?.subscription);
  const selectedKind = pendingReceipt ? pendingReceipt.kind ?? "subscription" : purchaseKind === "paid_trial" && !canBuyTrial ? "subscription" : purchaseKind;
  const period = data?.allowance?.currentPeriod;
  const canBuyPack = Boolean(period && period.source !== "trial" && period.endsAt > Date.now() && data?.business?.subscription.status === "active" && data.allowance && ["active", "warning", "exhausted"].includes(data.allowance.state));
  const formLocked = saving || compressing || refreshing || Boolean(pendingReceipt);
  const uploadDisabled = formLocked || !data?.settings.bankAccounts.length || (selectedKind === "paid_trial" && !canBuyTrial) || (selectedKind === "response_pack" && !canBuyPack) || (selectedKind === "subscription" && planId === "whatsapp" && !data?.whatsappAvailable);
  useEffect(() => {
    const controller = new AbortController();
    void apiFetch<BillingData>("/api/billing", { signal: controller.signal })
      .then((response) => {
        setData(response);
        if (canPurchasePaidTrial(response.business?.subscription)) setPurchaseKind("paid_trial");
        setBank(response.settings.bankAccounts[0]?.id || "");
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) setError(errorMessage(cause));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, []);
  function selectPlan(nextPlan: SubscriptionPlanId) {
    if (formLocked || nextPlan === planId || (nextPlan === "whatsapp" && !data?.whatsappAvailable)) return;
    setPlanId(nextPlan);
    setRequestId(crypto.randomUUID());
    setNotice(null);
  }
  function selectPurchaseKind(kind: "paid_trial" | "subscription" | "response_pack") {
    if (formLocked || kind === purchaseKind || (kind === "response_pack" && !canBuyPack) || (kind === "paid_trial" && !canBuyTrial)) return;
    setPurchaseKind(kind);
    setRequestId(crypto.randomUUID());
    setNotice(null);
    setError(null);
  }
  async function refreshBilling() {
    if (saving || compressing || refreshing) return;
    setRefreshing(true);
    setError(null);
    try {
      setData(await apiFetch<BillingData>("/api/billing"));
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setRefreshing(false);
    }
  }
  async function selectImage(file: File | undefined) {
    if (!file || uploadDisabled) return;
    setImage("");
    setNotice(null);
    setError(null);
    setCompressing(true);
    try {
      const compressed = await compressReceiptToWebP(file);
      if (compressed.size > 150 * 1024)
        throw new Error(
          "La captura sigue siendo muy grande. Recórtala y vuelve a intentar.",
        );
      setImage(await readDataUrl(compressed));
      setImageSize(compressed.size);
      setRequestId(crypto.randomUUID());
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setCompressing(false);
    }
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!image || !bank || uploadDisabled) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const response = await apiFetch<{
        receipt: PaymentReceipt;
        business: Business;
        allowance?: ResponseAllowance;
      }>("/api/billing", {
        method: "POST",
        body: JSON.stringify({
          bankSelected: bank,
          kind: selectedKind,
          ...(selectedKind === "subscription" ? { planId } : {}),
          receiptDataUrl: image,
          requestId,
        }),
      });
      setData((previous) =>
        previous
          ? {
              ...previous,
              business: response.business,
              allowance: response.allowance ?? null,
              receipts: [
                response.receipt,
                ...previous.receipts.filter(
                  (item) => item.id !== response.receipt.id,
                ),
              ],
            }
          : previous,
      );
      setImage("");
      const grace = response.business.subscription.graceEndsAt;
      setNotice(
        selectedKind === "subscription" && grace && grace > Date.now()
          ? `Comprobante recibido. Acceso preventivo hasta ${new Date(grace).toLocaleString("es-CO", { timeZone: "America/Bogota" })}. La activación del período elegido depende de su aprobación.`
          : "Comprobante recibido y pendiente de revisión.",
      );
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setSaving(false);
    }
  }
  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setNotice("Número de cuenta copiado.");
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }
  if (loading) return <Notice>Cargando suscripción…</Notice>;
  if (!data)
    return (
      <Notice error>{error || "No se pudo cargar la suscripción."}</Notice>
    );
  const selectedPlan = getBillingPlan(pendingReceipt ? pendingReceipt.planId ?? "monthly" : planId);
  const selectedDays = pendingReceipt ? pendingReceipt.periodDays ?? 30 : selectedPlan.periodDays;
  const selectedPrice = pendingReceipt?.amountCOP ?? (selectedKind === "paid_trial" ? PAID_TRIAL_PRICE_COP : selectedKind === "response_pack" ? data.settings.responsePackPriceCOP : data.settings[selectedPlan.priceField]);
  const selectedResponses = pendingReceipt?.responseAllowance ?? (selectedKind === "paid_trial" ? PAID_TRIAL_INCLUDED_RESPONSES : selectedKind === "response_pack" ? RESPONSE_PACK.responses : selectedPlan.includedResponses);
  const purchaseDescription = selectedKind === "paid_trial" ? `Prueba pagada · configuración y ${pendingReceipt?.appointmentAllowance ?? PAID_TRIAL_APPOINTMENT_LIMIT} citas · sin caducidad` : selectedKind === "response_pack" ? `Ampliación de ${selectedResponses.toLocaleString("es-CO")} respuestas` : `${selectedPlan.label} · ${selectedDays} días`;
  const formatPrice = (price: number) => price.toLocaleString("es-CO", {
    style: "currency", currency: "COP", maximumFractionDigits: 0,
  });
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div>
          <p className="text-xs uppercase tracking-widest text-sarin-blue">
            Suscripción
          </p>
          <h1 className="mt-1 text-3xl font-bold">Mantén tu agenda abierta</h1>
          <p className="mt-1 text-sm text-sarin-muted">
            {data.business?.sarinConfig?.onboardingCompleted ? data.business.name + " · " : ""}Estado: {data.business ? subscriptionLabels[data.business.subscription.status] : "Pendiente de pago aprobado"}
          </p>
        </div>
        <div className="flex flex-col items-start sm:items-end">
          <p className="text-2xl font-bold text-sarin-blue">
            {formatPrice(selectedPrice)}
            <span className="block text-xs font-normal text-sarin-muted sm:text-right">
              {selectedKind === "paid_trial" ? "COP · pago único" : selectedKind === "response_pack" ? "COP por ampliación" : `COP por ${selectedDays} días`}
            </span>
          </p>
          <button type="button" className="min-h-11 text-left text-sm text-sarin-blue underline disabled:opacity-50 sm:text-right" disabled={saving || compressing || refreshing} onClick={() => void refreshBilling()}>{refreshing ? "Actualizando consumo…" : "Actualizar consumo y comprobantes"}</button>
        </div>
      </div>
      {error && <Notice error>{error}</Notice>}
      {notice && <Notice>{notice}</Notice>}
      {data.business && <PaidTrialStatus subscription={data.business.subscription} />}
      {data.business && !data.business.sarinConfig?.onboardingCompleted && isSubscriptionAllowed(data.business) && <Link href="/dashboard/onboarding" className="inline-flex min-h-11 items-center text-sm font-semibold text-sarin-blue underline">Continuar con la configuración</Link>}
      <ResponseQuota allowance={data.allowance} />
      <form
        onSubmit={(event) => void submit(event)}
        className="space-y-4 rounded-2xl border border-sarin-line bg-sarin-paper p-4 sm:p-5"
      >
        <fieldset className="space-y-2" disabled={formLocked}>
          <legend className="font-semibold">¿Qué quieres pagar?</legend>
          <div className="flex flex-wrap gap-x-4 gap-y-0 text-sm">
            {(canBuyTrial || selectedKind === "paid_trial") && <label className="flex min-h-11 items-center gap-2"><input type="radio" name="purchaseKind" value="paid_trial" checked={selectedKind === "paid_trial"} disabled={formLocked || !canBuyTrial} onChange={() => selectPurchaseKind("paid_trial")} className="accent-sarin-blue" />Prueba pagada · $5.000 COP</label>}
            <label className="flex min-h-11 items-center gap-2"><input type="radio" name="purchaseKind" value="subscription" checked={selectedKind === "subscription"} disabled={formLocked} onChange={() => selectPurchaseKind("subscription")} className="accent-sarin-blue" />Elegir un plan</label>
            <label className="flex min-h-11 items-center gap-2"><input type="radio" name="purchaseKind" value="response_pack" checked={selectedKind === "response_pack"} disabled={formLocked || !canBuyPack} onChange={() => selectPurchaseKind("response_pack")} className="accent-sarin-blue" />Ampliar {RESPONSE_PACK.responses.toLocaleString("es-CO")} respuestas</label>
          </div>
          {!canBuyPack && !pendingReceipt && <p className="text-xs text-sarin-muted">Las ampliaciones requieren una suscripción activa; no se aplican a la prueba pagada.</p>}
        </fieldset>
        {selectedKind === "subscription" ? <fieldset className="space-y-2" disabled={formLocked}>
          <legend className="font-semibold">Elige tu período</legend>
          <div className="grid gap-2 sm:grid-cols-3 sm:gap-3">
            {BILLING_PLANS.filter((plan) => plan.id !== "whatsapp" || data.whatsappAvailable || selectedPlan.id === "whatsapp").map((plan) => (
              <label
                key={plan.id}
                className={`min-w-0 rounded-xl border p-3 ${formLocked ? "cursor-default" : "cursor-pointer"} ${selectedPlan.id === plan.id ? "border-sarin-blue bg-sarin-soft" : "border-sarin-line"} focus-within:ring-2 focus-within:ring-sarin-blue focus-within:ring-offset-2`}
              >
                <span className="flex items-center gap-2 text-sm font-semibold">
                  <input
                    type="radio"
                    name="planId"
                    value={plan.id}
                    checked={selectedPlan.id === plan.id}
                    disabled={formLocked || (plan.id === "whatsapp" && !data.whatsappAvailable)}
                    onChange={() => selectPlan(plan.id)}
                    className="accent-sarin-blue"
                  />
                  {plan.label}
                </span>
                <span className="mt-2 block text-lg font-semibold tabular-nums text-sarin-blue">
                  {formatPrice(pendingReceipt && selectedPlan.id === plan.id ? selectedPrice : data.settings[plan.priceField])}
                </span>
                <span className="mt-1 block text-xs text-sarin-muted">
                  COP · {plan.periodDays} días
                </span>
                <span className="mt-1 block text-xs font-medium text-sarin-ink">{plan.includedResponses.toLocaleString("es-CO")} respuestas</span>
                {plan.id === "whatsapp" && <span className="mt-1 block text-xs text-sarin-muted">{data.whatsappAvailable ? "Web + WhatsApp · consumo de Meta adicional" : "Conexión no disponible. Este plan no se puede contratar."}</span>}
              </label>
            ))}
          </div>
          <p className="text-xs text-sarin-muted">
            Una renovación comienza después de tu suscripción pagada actual. Al pasar de la prueba pagada a un plan, la suscripción empieza al aprobar el pago.
          </p>
        </fieldset> : selectedKind === "paid_trial" ? <div className="space-y-2 rounded-xl border border-sarin-line bg-sarin-canvas p-3">
          <h2 className="font-semibold">{purchaseDescription}</h2>
          <p className="text-sm text-sarin-muted">Compra única. Se activa al aprobar el comprobante y termina al utilizar las 10 citas. Después, elige un plan para continuar.</p>
          <p className="text-sm text-sarin-muted">Incluye {PAID_TRIAL_INCLUDED_RESPONSES} respuestas de IA en total como límite de uso, independiente de las citas. Las ampliaciones requieren un plan vigente.</p>
        </div> : <div className="space-y-1 rounded-xl border border-sarin-line bg-sarin-canvas p-3">
          <h2 className="font-semibold">{purchaseDescription} · {formatPrice(selectedPrice)} COP</h2>
          <p className="text-sm text-sarin-muted">No extiende la vigencia. Se activa tras aprobar el comprobante{period && (!pendingReceipt || pendingReceipt.quotaPeriodId === period.id) ? ` y vence el ${quotaDate(period.endsAt)}` : " en el período indicado al enviar el pago"}. No hay cobros automáticos.</p>
        </div>}
        {pendingReceipt && (
          <Notice>
            Tu comprobante de {purchaseDescription.toLowerCase()}
            {" "}y {formatPrice(selectedPrice)} COP está pendiente de revisión. Espera la
            revisión antes de enviar otro pago.
          </Notice>
        )}
        {!data.whatsappAvailable && <p className="text-xs text-sarin-muted">Sarin WhatsApp está en preparación y todavía no se puede contratar. Para mayor volumen, solicita una cotización a medida.</p>}
        <div className="space-y-2">
          <h2 className="font-semibold">Datos para tu transferencia</h2>
          {data.settings.bankAccounts.length === 0 ? (
            <Notice>
              El administrador aún no ha configurado las cuentas de pago.
            </Notice>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2 sm:gap-3">
              {data.settings.bankAccounts.map((account) => (
                <label
                  key={account.id}
                  className={`cursor-pointer space-y-1 rounded-xl border p-3 ${bank === account.id ? "border-sarin-blue bg-sarin-soft" : "border-sarin-line"}`}
                >
                  <span className="flex items-center gap-2 text-sm font-semibold">
                    <input
                      type="radio"
                      name="bank"
                      value={account.id}
                      checked={bank === account.id}
                      disabled={formLocked}
                      onChange={() => {
                        if (formLocked || bank === account.id) return;
                        setBank(account.id);
                        setRequestId(crypto.randomUUID());
                      }}
                    />
                    {account.bankName}
                  </span>
                  <span className="block text-xs text-sarin-muted">
                    {account.accountType} · {account.holderName}
                  </span>
                  <span className="block break-all tabular-nums text-sm">
                    {account.accountNumber}
                  </span>
                  {account.holderDoc && (
                    <span className="block text-xs text-sarin-muted">
                      {account.holderDoc}
                    </span>
                  )}
                  <button
                    type="button"
                    className="flex min-h-11 items-center gap-1 text-xs text-sarin-blue"
                    onClick={() => void copy(account.accountNumber)}
                  >
                    <Copy className="h-3.5 w-3.5" />
                    Copiar número
                  </button>
                </label>
              ))}
            </div>
          )}
        </div>
        <div className="space-y-2">
          <h2 className="font-semibold">Envía el comprobante</h2>
          <p className="text-sm font-medium text-sarin-ink">
            {purchaseDescription} · {formatPrice(selectedPrice)} COP
          </p>
          <p className="text-sm text-sarin-muted">
            La captura se optimiza antes de enviarla y se revisa manualmente.{" "}
            {selectedKind === "subscription" && (data.business?.subscription.currentPeriodEndsAt ?? 0) > 0 ? "El acceso preventivo de renovación se aplica según el estado de tu suscripción." : "El acceso se habilita únicamente después de aprobar el pago."}
          </p>
          <label className="grid cursor-pointer grid-cols-[24px_minmax(0,1fr)] items-center gap-x-3 gap-y-2 rounded-xl border border-dashed border-sarin-line bg-sarin-canvas p-3 hover:border-sarin-blue sm:p-4">
            <UploadCloud className="h-6 w-6 text-sarin-blue" />
            <span className="text-sm">
              {compressing
                ? "Optimizando imagen…"
                : "Seleccionar captura de pago"}
            </span>
            <input
              className={fieldClass + " col-span-2 min-w-0 sm:col-span-1 sm:col-start-2"}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              disabled={uploadDisabled}
              onChange={(event) => void selectImage(event.target.files?.[0])}
            />
          </label>
          {image && (
            <div className="space-y-2">
              <img
                src={image}
                alt="Vista previa del comprobante seleccionado"
                className="max-h-72 w-full rounded-xl object-contain"
              />
              <p className="text-xs text-sarin-muted">
                Imagen optimizada · {Math.ceil(imageSize / 1024)} KB
              </p>
            </div>
          )}
          <button
            disabled={!image || !bank || uploadDisabled}
            className={buttonClass + " w-full"}
          >
            {saving ? "Enviando comprobante…" : "Enviar comprobante"}
          </button>
        </div>
      </form>
      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Tus comprobantes</h2>
        {data.receipts.length === 0 ? (
          <Notice>Todavía no has enviado comprobantes.</Notice>
        ) : (
          data.receipts.map((receipt) => (
            <article
              key={receipt.id}
              className="flex flex-wrap justify-between gap-2 rounded-xl border border-sarin-line bg-sarin-paper p-3"
            >
              <div>
                <p className="font-semibold">
                  {receipt.amountCOP.toLocaleString("es-CO", {
                    style: "currency",
                    currency: "COP",
                    maximumFractionDigits: 0,
                  })}
                </p>
                <p className="mt-1 text-sm text-sarin-muted">
                  {receipt.kind === "paid_trial" ? `Prueba pagada · ${receipt.appointmentAllowance ?? PAID_TRIAL_APPOINTMENT_LIMIT} citas · sin caducidad` : receipt.kind === "response_pack" ? `Ampliación · ${(receipt.responseAllowance ?? 0).toLocaleString("es-CO")} respuestas` : `${getBillingPlan(receipt.planId ?? "monthly").label} · ${receipt.periodDays ?? 30} días`}
                </p>
                <p className="mt-1 text-xs text-sarin-muted">
                  {new Date(receipt.submittedAt).toLocaleString("es-CO", {
                    timeZone: "America/Bogota",
                  })}
                </p>
                {receipt.rejectionReason && (
                  <p className="mt-2 text-sm text-rose-700">
                    {receipt.rejectionReason}
                  </p>
                )}
              </div>
              <span
                className={`text-sm ${receipt.status === "approved" ? "text-sarin-blue" : receipt.status === "rejected" ? "text-rose-700" : "text-amber-800"}`}
              >
                {receipt.status === "approved"
                  ? "Aprobado"
                  : receipt.status === "rejected"
                    ? "Rechazado"
                    : "Pendiente de revisión"}
              </span>
            </article>
          ))
        )}
      </section>
    </div>
  );
}
export default function BillingPage() {
  return (
    <AuthGate>
      <AppShell>
        <Billing />
      </AppShell>
    </AuthGate>
  );
}
