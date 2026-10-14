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
          ? "Pago aprobado y suscripción extendida 30 días."
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
          <p className="text-xs uppercase tracking-widest text-emerald-400">
            Administración
          </p>
          <h1 className="mt-2 text-3xl font-bold">Negocios y pagos</h1>
          <p className="mt-2 text-sm text-slate-400">
            Revisa comprobantes y supervisa el acceso de cada negocio.
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
        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
          <p className="flex items-center gap-2 text-xs text-slate-400">
            <Cpu className="h-4 w-4" />
            Motor local
          </p>
          <p
            className={`mt-2 text-lg font-semibold ${engine.health?.status === "online" ? "text-emerald-300" : "text-amber-300"}`}
          >
            {engine.health
              ? engine.health.status === "online"
                ? "Disponible"
                : "Sin conexión"
              : "Verificando…"}
          </p>
          {engine.error && (
            <p className="mt-2 text-xs text-slate-400">{engine.error}</p>
          )}
          <button
            disabled={engine.checking}
            onClick={() => void engine.refresh()}
            className="mt-3 flex items-center gap-1 text-xs text-slate-300 disabled:opacity-50"
          >
            <RefreshCw className="h-3 w-3" />
            Comprobar conexión
          </button>
        </div>
        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
          <p className="text-xs text-slate-400">Cola de inferencia</p>
          <p className="mt-2 text-lg font-semibold">
            {engine.health?.queue
              ? `${engine.health.queue.activeSlots}/${engine.health.queue.maxSlots} en curso`
              : "Sin datos"}
          </p>
          {engine.health?.queue && (
            <p className="mt-2 text-xs text-slate-400">
              {engine.health.queue.queuedRequests} en espera ·{" "}
              {engine.health.queue.criticalQueued} de Vault
            </p>
          )}
        </div>
        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
          <p className="text-xs text-slate-400">Comprobantes pendientes</p>
          <p className="mt-2 text-3xl font-semibold text-emerald-300">
            {pending.length}
          </p>
          <button
            onClick={() => void refresh()}
            disabled={Boolean(working)}
            className="mt-3 text-xs text-slate-300 underline disabled:opacity-50"
          >
            Actualizar bandeja
          </button>
        </div>
      </section>
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
                  className="space-y-4 rounded-2xl border border-slate-800 bg-slate-900 p-5"
                  key={receipt.id}
                >
                  <div className="flex justify-between gap-3">
                    <div>
                      <h3 className="font-semibold">{receipt.tenantName}</h3>
                      <p className="mt-1 break-all text-xs text-slate-400">
                        {receipt.ownerEmail}
                      </p>
                    </div>
                    <span
                      className={`text-xs ${receipt.status === "approved" ? "text-emerald-300" : receipt.status === "rejected" ? "text-rose-300" : "text-amber-300"}`}
                    >
                      {receipt.status === "approved"
                        ? "Aprobado"
                        : receipt.status === "rejected"
                          ? "Rechazado"
                          : "Pendiente"}
                    </span>
                  </div>
                  <p className="font-mono text-sm text-emerald-300">
                    {receipt.amountCOP.toLocaleString("es-CO", {
                      style: "currency",
                      currency: "COP",
                      maximumFractionDigits: 0,
                    })}{" "}
                    · {receipt.bankSelected}
                  </p>
                  <p className="text-xs text-slate-400">
                    {new Date(receipt.submittedAt).toLocaleString("es-CO", {
                      timeZone: "America/Bogota",
                    })}
                  </p>
                  <button
                    className="flex items-center gap-2 text-sm text-slate-300 underline disabled:opacity-50"
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
                    <div className="space-y-3 border-t border-slate-800 pt-4">
                      <label className="block text-xs text-slate-400">
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
                      <div className="flex gap-2">
                        <button
                          className={
                            buttonClass +
                            " flex flex-1 items-center justify-center gap-1"
                          }
                          disabled={Boolean(working) || !images[receipt.id]}
                          onClick={() => void review(receipt.id, "approve")}
                        >
                          <Check className="h-4 w-4" />
                          Aprobar +30 días
                        </button>
                        <button
                          className="flex items-center gap-1 rounded-xl border border-rose-500/40 px-3 py-2 text-sm text-rose-300 hover:bg-rose-500/10 disabled:opacity-50"
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
                        <p className="text-xs text-slate-500">
                          Abre la captura para revisarla antes de aprobar.
                        </p>
                      )}
                    </div>
                  ) : (
                    receipt.rejectionReason && (
                      <p className="text-sm text-rose-300">
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
        <h2 className="text-xl font-semibold">Islas registradas</h2>
        {data.businesses.length === 0 ? (
          <Notice>Todavía no hay negocios registrados.</Notice>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-slate-800">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-900 text-xs text-slate-400">
                <tr>
                  <th className="p-4">Negocio</th>
                  <th className="p-4">Estado</th>
                  <th className="p-4">Fin de prueba</th>
                  <th className="p-4">Vigencia mensual</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {data.businesses.map((business) => (
                  <tr key={business.id}>
                    <td className="p-4">
                      <Link
                        href={`/b/${business.slug}`}
                        className="font-semibold text-emerald-300 hover:underline"
                      >
                        {business.name}
                      </Link>
                      <span className="mt-1 block text-xs text-slate-400">
                        {business.ownerEmail}
                      </span>
                    </td>
                    <td className="p-4 text-slate-300">
                      {business.subscription.status}
                    </td>
                    <td className="whitespace-nowrap p-4 text-slate-400">
                      {new Date(
                        business.subscription.trialEndsAt,
                      ).toLocaleDateString("es-CO", {
                        timeZone: "America/Bogota",
                      })}
                    </td>
                    <td className="whitespace-nowrap p-4 text-slate-400">
                      {new Date(
                        business.subscription.currentPeriodEndsAt,
                      ).toLocaleDateString("es-CO", {
                        timeZone: "America/Bogota",
                      })}
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
          className="space-y-5 rounded-2xl border border-slate-800 bg-slate-900 p-5 sm:p-6"
          onSubmit={(event) => void saveSettings(event)}
        >
          <h2 className="text-xl font-semibold">Datos de facturación</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="text-xs text-slate-400">
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
            <label className="text-xs text-slate-400">
              Mensualidad en COP
              <input
                required
                min="1"
                step="1"
                type="number"
                className={fieldClass + " mt-2"}
                value={settings.monthlyPriceCOP}
                onChange={(event) =>
                  setSettings({
                    ...settings,
                    monthlyPriceCOP: Number(event.target.value),
                  })
                }
              />
            </label>
          </div>
          {settings.bankAccounts.map((account) => (
            <fieldset
              className="grid gap-3 rounded-xl border border-slate-800 p-4 sm:grid-cols-2"
              key={account.id}
            >
              <legend className="px-2 text-xs text-slate-400">
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
                <label className="text-xs text-slate-400" key={key}>
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
                className="flex items-center gap-2 self-end p-2 text-sm text-rose-300"
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
            className="flex items-center gap-1 text-sm text-emerald-300"
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
