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
  async function selectImage(file: File | undefined) {
    if (!file) return;
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
    if (!image || !bank) return;
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
          ? `Comprobante recibido. Acceso preventivo hasta ${new Date(grace).toLocaleString("es-CO", { timeZone: "America/Bogota" })}. La activación mensual depende de su aprobación.`
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
          className="text-emerald-300 underline"
          href="/dashboard/onboarding"
        >
          Configuración
        </Link>
        .
      </Notice>
    );
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-widest text-emerald-400">
            Suscripción
          </p>
          <h1 className="mt-2 text-3xl font-bold">Mantén tu agenda abierta</h1>
          <p className="mt-2 text-sm text-slate-400">
            {data.business.name} · Estado: {data.business.subscription.status}
          </p>
        </div>
        <p className="text-2xl font-bold text-emerald-300">
          {data.settings.monthlyPriceCOP.toLocaleString("es-CO", {
            style: "currency",
            currency: "COP",
            maximumFractionDigits: 0,
          })}
          <span className="mt-1 block text-right text-xs font-normal text-slate-400">
            por 30 días
          </span>
        </p>
      </div>
      {error && <Notice error>{error}</Notice>}
      {notice && <Notice>{notice}</Notice>}
      <form
        onSubmit={(event) => void submit(event)}
        className="space-y-6 rounded-2xl border border-slate-800 bg-slate-900 p-5 sm:p-6"
      >
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
                className={`cursor-pointer space-y-2 rounded-xl border p-4 ${bank === account.id ? "border-emerald-500/50 bg-emerald-500/5" : "border-slate-700"}`}
              >
                <span className="flex items-center gap-2 text-sm font-semibold">
                  <input
                    type="radio"
                    name="bank"
                    value={account.id}
                    checked={bank === account.id}
                    onChange={() => setBank(account.id)}
                  />
                  {account.bankName}
                </span>
                <span className="block text-xs text-slate-400">
                  {account.accountType} · {account.holderName}
                </span>
                <span className="block font-mono text-sm">
                  {account.accountNumber}
                </span>
                {account.holderDoc && (
                  <span className="block text-xs text-slate-400">
                    {account.holderDoc}
                  </span>
                )}
                <button
                  type="button"
                  className="flex items-center gap-1 text-xs text-emerald-300"
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
          <p className="text-sm text-slate-400">
            La captura se optimiza antes de enviarla y se revisa manualmente. El
            acceso preventivo de 24 horas se aplica según el estado de tu
            suscripción.
          </p>
          <label className="flex cursor-pointer flex-col items-center gap-3 rounded-xl border border-dashed border-slate-600 p-6 text-center hover:border-emerald-500">
            <UploadCloud className="h-8 w-8 text-emerald-400" />
            <span className="text-sm">
              {compressing
                ? "Optimizando imagen…"
                : "Seleccionar captura de pago"}
            </span>
            <input
              className={fieldClass + " max-w-sm"}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              disabled={compressing || saving}
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
              <p className="text-xs text-slate-400">
                Imagen optimizada · {Math.ceil(imageSize / 1024)} KB
              </p>
            </div>
          )}
          <button
            disabled={!image || !bank || saving || compressing}
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
              className="flex flex-wrap justify-between gap-3 rounded-xl border border-slate-800 bg-slate-900 p-4"
            >
              <div>
                <p className="font-semibold">
                  {receipt.amountCOP.toLocaleString("es-CO", {
                    style: "currency",
                    currency: "COP",
                    maximumFractionDigits: 0,
                  })}
                </p>
                <p className="mt-1 text-xs text-slate-400">
                  {new Date(receipt.submittedAt).toLocaleString("es-CO", {
                    timeZone: "America/Bogota",
                  })}
                </p>
                {receipt.rejectionReason && (
                  <p className="mt-2 text-sm text-rose-300">
                    {receipt.rejectionReason}
                  </p>
                )}
              </div>
              <span
                className={`text-sm ${receipt.status === "approved" ? "text-emerald-300" : receipt.status === "rejected" ? "text-rose-300" : "text-amber-300"}`}
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
