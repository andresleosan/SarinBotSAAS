"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import {
  Check,
  Cpu,
  Eye,
  LockKeyhole,
  Plus,
  RefreshCw,
  Trash2,
  X,
} from "lucide-react";
import { AuthGate } from "@/components/auth-provider";
import {
  AppShell,
  Notice,
  buttonClass,
  fieldClass,
} from "@/components/app-shell";
import { apiFetch, errorMessage } from "@/lib/client/api";
import { useEngineHealth } from "@/hooks/useEngineHealth";
import { AdminAiSettings } from "@/components/admin-ai-settings";
import { BILLING_PLANS, getBillingPlan } from "@/lib/billing-plans";
import type {
  Business,
  PaymentReceipt,
  PlatformSettings,
} from "@/types/firestore";

interface AdminData {
  businesses: Business[];
  receipts: PaymentReceipt[];
  settings: PlatformSettings;
}
const subscriptionLabels: Record<Business["subscription"]["status"], string> = {
  trial: "Prueba gratis",
  active: "Activa",
  past_due: "Pago pendiente",
  suspended: "Suspendida",
};
function Console() {
  const [data, setData] = useState<AdminData | null>(null);
  const [settings, setSettings] = useState<PlatformSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [working, setWorking] = useState<string | null>(null);
  const [images, setImages] = useState<Record<string, string>>({});
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const engine = useEngineHealth();
  useEffect(() => {
    const controller = new AbortController();
    void apiFetch<AdminData>("/api/admin", { signal: controller.signal })
      .then((response) => {
        setData(response);
        setSettings(response.settings);
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) setError(errorMessage(cause));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, []);
  async function refresh() {
    setWorking("refresh");
    setError(null);
    try {
      const response = await apiFetch<AdminData>("/api/admin");
      setData(response);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setWorking(null);
    }
  }
  async function viewImage(id: string) {
    if (images[id]) {
      setImages((previous) => {
        const next = { ...previous };
        delete next[id];
        return next;
      });
      return;
    }
    setWorking(id);
    setError(null);
    try {
      const response = await apiFetch<{ receiptDataUrl: string }>(
        `/api/billing?receiptId=${encodeURIComponent(id)}`,
      );
      setImages((previous) => ({ ...previous, [id]: response.receiptDataUrl }));
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setWorking(null);
    }
  }
  async function review(paymentId: string, action: "approve" | "reject") {
    setWorking(paymentId);
    setError(null);
    setNotice(null);
    try {
      const response = await apiFetch<{
        receipt: PaymentReceipt;
        business: Business;
      }>("/api/admin", {
        method: "PATCH",
        body: JSON.stringify({
          action,
          paymentId,
          rejectionReason: reasons[paymentId] || undefined,
        }),
      });
      setData((previous) =>
        previous
          ? {
              ...previous,
              receipts: previous.receipts.map((item) =>
                item.id === paymentId ? response.receipt : item,
              ),
              businesses: previous.businesses.map((item) =>
                item.id === response.business.id ? response.business : item,
              ),
            }
          : previous,
      );
      setNotice(
        action === "approve"
          ? `Pago aprobado y suscripción extendida ${response.receipt.periodDays ?? 30} días.`
          : "Comprobante rechazado.",
      );
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setWorking(null);
    }
  }
  async function saveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!settings) return;
    setWorking("settings");
    setError(null);
    setNotice(null);
    try {
      await apiFetch("/api/admin", {
        method: "PATCH",
        body: JSON.stringify({ action: "settings", settings }),
      });
      setNotice("Datos de facturación guardados.");
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setWorking(null);
    }
  }
  if (loading) return <Notice>Cargando consola…</Notice>;
  if (!data)
    return <Notice error>{error || "No se pudo cargar la consola."}</Notice>;
  const pending = data.receipts.filter((item) => item.status === "pending");
  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-widest text-sarin-blue">
            Administración
          </p>
          <h1 className="mt-2 text-3xl font-bold">Control de Sarin</h1>
          <p className="mt-2 text-sm text-sarin-muted">
            Administra las suscripciones, revisa pagos y elige la IA de los negocios.
          </p>
        </div>
        <Link
          href="/admin/vault"
          className={buttonClass + " flex items-center gap-2"}
        >
          <LockKeyhole className="h-4 w-4" />
          Abrir Sarin Vault
        </Link>
      </header>
      {error && <Notice error>{error}</Notice>}
      {notice && <Notice>{notice}</Notice>}
      <section className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-2xl border border-sarin-line bg-sarin-paper p-5">
          <p className="flex items-center gap-2 text-xs text-sarin-muted">
            <Cpu className="h-4 w-4" />
            IA del negocio
          </p>
          <p
            className={`mt-2 text-lg font-semibold ${engine.health?.status === "online" ? "text-sarin-blue" : "text-amber-800"}`}
          >
            {engine.health
              ? engine.health.status === "online"
                ? "Disponible"
                : "Sin conexión"
              : "Verificando…"}
          </p>
          <p className="mt-2 text-xs text-sarin-muted">
            {engine.health?.provider === "deepseek" ? "DeepSeek" : engine.health?.provider === "ollama" ? "IA local (Ollama)" : "Proveedor sin confirmar"}
          </p>
          {engine.error && (
            <p className="mt-2 text-xs text-sarin-muted">{engine.error}</p>
          )}
          <button
            disabled={engine.checking}
            onClick={() => void engine.refresh()}
            className="mt-3 flex min-h-11 items-center gap-1 text-xs text-sarin-blue disabled:opacity-50"
          >
            <RefreshCw className="h-3 w-3" />
            Comprobar conexión
          </button>
        </div>
        <div className="rounded-2xl border border-sarin-line bg-sarin-paper p-5">
          <p className="text-xs text-sarin-muted">Cola de inferencia</p>
          <p className="mt-2 text-lg font-semibold">
            {engine.health?.queue
              ? `${engine.health.queue.activeSlots}/${engine.health.queue.maxSlots} en curso`
              : "Sin datos"}
          </p>
          {engine.health?.queue && (
            <p className="mt-2 text-xs text-sarin-muted">
              {engine.health.queue.queuedRequests} en espera ·{" "}
              {engine.health.queue.criticalQueued} de Vault
            </p>
          )}
        </div>
        <div className="rounded-2xl border border-sarin-line bg-sarin-paper p-5">
          <p className="text-xs text-sarin-muted">Comprobantes pendientes</p>
          <p className="mt-2 text-3xl font-semibold text-sarin-blue">
            {pending.length}
          </p>
          <button
            onClick={() => void refresh()}
            disabled={Boolean(working)}
            className="mt-3 min-h-11 text-xs text-sarin-blue underline disabled:opacity-50"
          >
            Actualizar bandeja
          </button>
        </div>
      </section>
      <AdminAiSettings onSaved={() => void engine.refresh()} />
      <section className="space-y-4">
        <h2 className="text-xl font-semibold">Comprobantes de pago</h2>
        {data.receipts.length === 0 ? (
          <Notice>No hay comprobantes enviados.</Notice>
        ) : (
          <div className="grid items-start gap-4 lg:grid-cols-2">
            {[...data.receipts]
              .sort(
                (a, b) =>
                  Number(b.status === "pending") -
                    Number(a.status === "pending") ||
                  b.submittedAt - a.submittedAt,
              )
              .map((receipt) => (
                <article
                  className="space-y-4 rounded-2xl border border-sarin-line bg-sarin-paper p-5"
                  key={receipt.id}
                >
                  <div className="flex justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="break-words font-semibold">{receipt.tenantName}</h3>
                      <p className="mt-1 break-all text-xs text-sarin-muted">
                        {receipt.ownerEmail}
                      </p>
                    </div>
                    <span
                      className={`shrink-0 text-xs ${receipt.status === "approved" ? "text-sarin-blue" : receipt.status === "rejected" ? "text-rose-700" : "text-amber-800"}`}
                    >
                      {receipt.status === "approved"
                        ? "Aprobado"
                        : receipt.status === "rejected"
                          ? "Rechazado"
                          : "Pendiente"}
                    </span>
                  </div>
                  <p className="tabular-nums text-sm text-sarin-blue">
                    {receipt.amountCOP.toLocaleString("es-CO", {
                      style: "currency",
                      currency: "COP",
                      maximumFractionDigits: 0,
                    })}{" "}
                    · {receipt.bankSelected}
                  </p>
                  <p className="text-sm text-sarin-ink">
                    {getBillingPlan(receipt.planId ?? "monthly").label} · {receipt.periodDays ?? 30} días
                  </p>
                  <p className="text-xs text-sarin-muted">
                    {new Date(receipt.submittedAt).toLocaleString("es-CO", {
                      timeZone: "America/Bogota",
                    })}
                  </p>
                  <button
                    className="flex min-h-11 items-center gap-2 text-sm text-sarin-blue underline disabled:opacity-50"
                    disabled={Boolean(working)}
                    onClick={() => void viewImage(receipt.id)}
                  >
                    <Eye className="h-4 w-4" />
                    {images[receipt.id] ? "Ocultar captura" : "Ver captura"}
                  </button>
                  {images[receipt.id] && (
                    <img
                      src={images[receipt.id]}
                      alt={`Comprobante de ${receipt.tenantName}`}
                      className="max-h-96 w-full rounded-xl object-contain"
                    />
                  )}
                  {receipt.status === "pending" ? (
                    <div className="space-y-3 border-t border-sarin-line pt-4">
                      <label className="block text-xs text-sarin-muted">
                        Motivo si rechazas el comprobante
                        <input
                          className={fieldClass + " mt-2"}
                          value={reasons[receipt.id] || ""}
                          maxLength={500}
                          onChange={(event) =>
                            setReasons((previous) => ({
                              ...previous,
                              [receipt.id]: event.target.value,
                            }))
                          }
                        />
                      </label>
                      <div className="flex flex-col gap-2 sm:flex-row">
                        <button
                          className={
                            buttonClass +
                            " flex flex-1 items-center justify-center gap-1"
                          }
                          disabled={Boolean(working) || !images[receipt.id]}
                          onClick={() => void review(receipt.id, "approve")}
                        >
                          <Check className="h-4 w-4" />
                          Aprobar +{receipt.periodDays ?? 30} días
                        </button>
                        <button
                          className="flex min-h-11 items-center justify-center gap-1 rounded-[10px] border border-rose-200 px-3 py-2 text-sm text-rose-700 hover:bg-rose-50 disabled:opacity-50"
                          disabled={
                            Boolean(working) || !reasons[receipt.id]?.trim()
                          }
                          onClick={() => void review(receipt.id, "reject")}
                        >
                          <X className="h-4 w-4" />
                          Rechazar
                        </button>
                      </div>
                      {!images[receipt.id] && (
                        <p className="text-xs text-sarin-muted">
                          Abre la captura para revisarla antes de aprobar.
                        </p>
                      )}
                    </div>
                  ) : (
                    receipt.rejectionReason && (
                      <p className="text-sm text-rose-700">
                        {receipt.rejectionReason}
                      </p>
                    )
                  )}
                </article>
              ))}
          </div>
        )}
      </section>
      <section className="space-y-4">
        <h2 className="text-xl font-semibold">Negocios y suscripciones</h2>
        {data.businesses.length === 0 ? (
          <Notice>Todavía no hay negocios registrados.</Notice>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-sarin-line bg-sarin-paper">
            <table className="w-full text-left text-sm">
              <thead className="bg-sarin-canvas text-xs text-sarin-muted">
                <tr>
                  <th className="p-4">Negocio</th>
                  <th className="p-4">Estado</th>
                  <th className="p-4">Fin de prueba</th>
                  <th className="p-4">Vigencia del pago</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-sarin-line">
                {data.businesses.map((business) => (
                  <tr key={business.id}>
                    <td className="p-4">
                      <Link
                        href={`/b/${business.slug}`}
                        className="font-semibold text-sarin-blue hover:underline"
                      >
                        {business.name}
                      </Link>
                      <span className="mt-1 block text-xs text-sarin-muted">
                        {business.ownerEmail}
                      </span>
                    </td>
                    <td className="p-4 text-sarin-ink">
                      {subscriptionLabels[business.subscription.status]}
                    </td>
                    <td className="whitespace-nowrap p-4 text-sarin-muted">
                      {new Date(
                        business.subscription.trialEndsAt,
                      ).toLocaleDateString("es-CO", {
                        timeZone: "America/Bogota",
                      })}
                    </td>
                    <td className="whitespace-nowrap p-4 text-sarin-muted">
                      {business.subscription.currentPeriodEndsAt > 0 ? new Date(
                        business.subscription.currentPeriodEndsAt,
                      ).toLocaleDateString("es-CO", {
                        timeZone: "America/Bogota",
                      }) : "Sin pago aprobado"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {settings && (
        <form
          className="space-y-5 rounded-2xl border border-sarin-line bg-sarin-paper p-5 sm:p-6"
          onSubmit={(event) => void saveSettings(event)}
        >
          <h2 className="text-xl font-semibold">Datos de facturación</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="text-xs text-sarin-muted">
              Nombre comercial
              <input
                required
                maxLength={120}
                className={fieldClass + " mt-2"}
                value={settings.companyName}
                onChange={(event) =>
                  setSettings({ ...settings, companyName: event.target.value })
                }
              />
            </label>
          </div>
          <fieldset className="grid gap-4 sm:grid-cols-3" disabled={Boolean(working)}>
            <legend className="mb-3 text-sm font-semibold">Tarifas de suscripción</legend>
            {BILLING_PLANS.map((plan) => (
              <label className="text-xs text-sarin-muted" key={plan.id}>
                {plan.label} · {plan.periodDays} días, en COP
                <input
                  required
                  min="1"
                  step="1"
                  type="number"
                  className={fieldClass + " mt-2"}
                  value={settings[plan.priceField]}
                  onChange={(event) =>
                    setSettings({ ...settings, [plan.priceField]: Number(event.target.value) })
                  }
                />
              </label>
            ))}
          </fieldset>
          {settings.bankAccounts.map((account) => (
            <fieldset
              className="grid gap-3 rounded-xl border border-sarin-line p-4 sm:grid-cols-2"
              key={account.id}
            >
              <legend className="px-2 text-xs text-sarin-muted">
                Cuenta de pago
              </legend>
              {(
                [
                  ["bankName", "Banco o entidad"],
                  ["accountType", "Tipo de cuenta"],
                  ["accountNumber", "Número de cuenta"],
                  ["holderName", "Titular"],
                  ["holderDoc", "Documento del titular (opcional)"],
                ] as const
              ).map(([key, label]) => (
                <label className="text-xs text-sarin-muted" key={key}>
                  {label}
                  <input
                    required={key !== "holderDoc"}
                    maxLength={120}
                    className={fieldClass + " mt-2"}
                    value={account[key] || ""}
                    onChange={(event) =>
                      setSettings({
                        ...settings,
                        bankAccounts: settings.bankAccounts.map((item) =>
                          item.id === account.id
                            ? { ...item, [key]: event.target.value }
                            : item,
                        ),
                      })
                    }
                  />
                </label>
              ))}
              <button
                type="button"
                className="flex min-h-11 items-center gap-2 self-end rounded-[10px] p-2 text-sm text-rose-700 hover:bg-rose-50"
                onClick={() =>
                  setSettings({
                    ...settings,
                    bankAccounts: settings.bankAccounts.filter(
                      (item) => item.id !== account.id,
                    ),
                  })
                }
              >
                <Trash2 className="h-4 w-4" />
                Eliminar cuenta
              </button>
            </fieldset>
          ))}
          <button
            type="button"
            className="flex min-h-11 items-center gap-1 text-sm text-sarin-blue"
            onClick={() =>
              setSettings({
                ...settings,
                bankAccounts: [
                  ...settings.bankAccounts,
                  {
                    id: crypto.randomUUID(),
                    bankName: "",
                    accountType: "",
                    accountNumber: "",
                    holderName: "",
                  },
                ],
              })
            }
          >
            <Plus className="h-4 w-4" />
            Añadir cuenta
          </button>
          <button className={buttonClass} disabled={Boolean(working)}>
            {working === "settings" ? "Guardando…" : "Guardar facturación"}
          </button>
        </form>
      )}
    </div>
  );
}
export default function SuperAdminConsolePage() {
  return (
    <AuthGate admin>
      <AppShell admin>
        <Console />
      </AppShell>
    </AuthGate>
  );
}
