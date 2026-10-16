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
import { BILLING_PLANS, getBillingPlan, type SubscriptionPlanId } from "@/lib/billing-plans";
import type {
  Business,
  PaymentReceipt,
  PlatformSettings,
} from "@/types/firestore";

interface BillingData {
  settings: PlatformSettings;
  receipts: PaymentReceipt[];
  business: Business | null;
}
const subscriptionLabels: Record<Business["subscription"]["status"], string> = {
  trial: "Prueba gratis",
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
  const [requestId, setRequestId] = useState("");
  const [planId, setPlanId] = useState<SubscriptionPlanId>("monthly");
  const pendingReceipt = data?.receipts.find((receipt) => receipt.status === "pending");
  const formLocked = saving || compressing || Boolean(pendingReceipt);
  const uploadDisabled = formLocked || !data?.settings.bankAccounts.length;
  useEffect(() => {
    const controller = new AbortController();
    void apiFetch<BillingData>("/api/billing", { signal: controller.signal })
      .then((response) => {
        setData(response);
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
    if (formLocked || nextPlan === planId) return;
    setPlanId(nextPlan);
    setRequestId(crypto.randomUUID());
    setNotice(null);
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
      }>("/api/billing", {
        method: "POST",
        body: JSON.stringify({
          bankSelected: bank,
          planId,
          receiptDataUrl: image,
          requestId,
        }),
      });
      setData((previous) =>
        previous
          ? {
              ...previous,
              business: response.business,
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
        grace && grace > Date.now()
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
  if (!data.business)
    return (
      <Notice>
        Configura primero tu negocio en{" "}
        <Link
          className="text-sarin-blue underline"
          href="/dashboard/onboarding"
        >
          Configuración
        </Link>
        .
      </Notice>
    );
  const selectedPlan = getBillingPlan(pendingReceipt ? pendingReceipt.planId ?? "monthly" : planId);
  const selectedDays = pendingReceipt ? pendingReceipt.periodDays ?? 30 : selectedPlan.periodDays;
  const selectedPrice = pendingReceipt?.amountCOP ?? data.settings[selectedPlan.priceField];
  const formatPrice = (price: number) => price.toLocaleString("es-CO", {
    style: "currency", currency: "COP", maximumFractionDigits: 0,
  });
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-widest text-sarin-blue">
            Suscripción
          </p>
          <h1 className="mt-2 text-3xl font-bold">Mantén tu agenda abierta</h1>
          <p className="mt-2 text-sm text-sarin-muted">
            {data.business.name} · Estado: {subscriptionLabels[data.business.subscription.status]}
          </p>
        </div>
        <p className="text-2xl font-bold text-sarin-blue">
          {formatPrice(selectedPrice)}
          <span className="mt-1 block text-right text-xs font-normal text-sarin-muted">
            COP por {selectedDays} días
          </span>
        </p>
      </div>
      {error && <Notice error>{error}</Notice>}
      {notice && <Notice>{notice}</Notice>}
      <form
        onSubmit={(event) => void submit(event)}
        className="space-y-6 rounded-2xl border border-sarin-line bg-sarin-paper p-5 sm:p-6"
      >
        <fieldset className="space-y-3" disabled={formLocked}>
          <legend className="font-semibold">Elige tu período</legend>
          <div className="grid gap-3 sm:grid-cols-3">
            {BILLING_PLANS.map((plan) => (
              <label
                key={plan.id}
                className={`min-w-0 rounded-xl border p-4 ${formLocked ? "cursor-default" : "cursor-pointer"} ${selectedPlan.id === plan.id ? "border-sarin-blue bg-sarin-soft" : "border-sarin-line"} focus-within:ring-2 focus-within:ring-sarin-blue focus-within:ring-offset-2`}
              >
                <span className="flex items-center gap-2 text-sm font-semibold">
                  <input
                    type="radio"
                    name="planId"
                    value={plan.id}
                    checked={selectedPlan.id === plan.id}
                    disabled={formLocked}
                    onChange={() => selectPlan(plan.id)}
                    className="accent-sarin-blue"
                  />
                  {plan.label}
                </span>
                <span className="mt-3 block text-lg font-semibold tabular-nums text-sarin-blue">
                  {formatPrice(pendingReceipt && selectedPlan.id === plan.id ? selectedPrice : data.settings[plan.priceField])}
                </span>
                <span className="mt-1 block text-xs text-sarin-muted">
                  COP · {plan.periodDays} días
                </span>
              </label>
            ))}
          </div>
          <p className="text-xs text-sarin-muted">
            La prueba gratuita inicial de 7 días no cambia al elegir un período de pago.
          </p>
        </fieldset>
        {pendingReceipt && (
          <Notice>
            Tu comprobante {selectedPlan.label.toLowerCase()} por {selectedDays} días
            {" "}y {formatPrice(selectedPrice)} COP está pendiente de revisión. Espera la
            revisión antes de enviar otro pago.
          </Notice>
        )}
        <h2 className="font-semibold">Datos para tu transferencia</h2>
        {data.settings.bankAccounts.length === 0 ? (
          <Notice>
            El administrador aún no ha configurado las cuentas de pago.
          </Notice>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {data.settings.bankAccounts.map((account) => (
              <label
                key={account.id}
                className={`cursor-pointer space-y-2 rounded-xl border p-4 ${bank === account.id ? "border-sarin-blue bg-sarin-soft" : "border-sarin-line"}`}
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
        <div className="space-y-3">
          <h2 className="font-semibold">Envía el comprobante</h2>
          <p className="text-sm font-medium text-sarin-ink">
            {selectedPlan.label} · {selectedDays} días · {formatPrice(selectedPrice)} COP
          </p>
          <p className="text-sm text-sarin-muted">
            La captura se optimiza antes de enviarla y se revisa manualmente. El
            acceso preventivo de 24 horas se aplica según el estado de tu
            suscripción.
          </p>
          <label className="flex cursor-pointer flex-col items-center gap-3 rounded-xl border border-dashed border-sarin-line bg-sarin-canvas p-4 text-center hover:border-sarin-blue sm:p-6">
            <UploadCloud className="h-8 w-8 text-sarin-blue" />
            <span className="text-sm">
              {compressing
                ? "Optimizando imagen…"
                : "Seleccionar captura de pago"}
            </span>
            <input
              className={fieldClass + " max-w-sm"}
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
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Tus comprobantes</h2>
        {data.receipts.length === 0 ? (
          <Notice>Todavía no has enviado comprobantes.</Notice>
        ) : (
          data.receipts.map((receipt) => (
            <article
              key={receipt.id}
              className="flex flex-wrap justify-between gap-3 rounded-xl border border-sarin-line bg-sarin-paper p-4"
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
                  {getBillingPlan(receipt.planId ?? "monthly").label} · {receipt.periodDays ?? 30} días
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
