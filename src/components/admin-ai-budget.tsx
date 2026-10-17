"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { RefreshCw } from "lucide-react";
import { useAuth } from "@/components/auth-provider";
import { Notice, buttonClass, fieldClass } from "@/components/app-shell";
import { apiFetch, errorMessage } from "@/lib/client/api";
import type { AiBudgetLimits, BusinessAiBudgetView } from "@/lib/server/ai-budget";

type BusinessChoice = { id: string; name: string };
const money = (value: number) => `USD ${value.toLocaleString("es-CO", { maximumFractionDigits: 6 })}`;
const numbers = (value: number) => value.toLocaleString("es-CO");
const generalFields: [keyof AiBudgetLimits, string][] = [
  ["globalDayUsd", "Global diario (USD)"], ["globalMonthUsd", "Global mensual (USD)"],
  ["businessDayUsd", "Negocio diario por defecto (USD)"], ["businessMonthUsd", "Negocio mensual por defecto (USD)"],
  ["globalDayTokens", "Tokens globales por día"], ["globalMonthTokens", "Tokens globales por mes"],
  ["businessDayTokens", "Tokens por negocio por día"], ["businessMonthTokens", "Tokens por negocio por mes"],
];

function Usage({ label, counter, limit }: { label: string; counter: BusinessAiBudgetView["usage"]["day"]; limit: number }) {
  const used = counter.usedCostNanoUsd / 1e9, held = counter.reservedCostNanoUsd / 1e9;
  return <div className="rounded-xl border border-sarin-line p-3">
    <h4 className="text-sm font-semibold">{label}</h4>
    <p className="mt-1 text-lg font-semibold tabular-nums">{money(used + held)} <span className="text-xs font-normal text-sarin-muted">de {money(limit)}</span></p>
    <p className="mt-1 text-xs leading-5 text-sarin-muted">Registrado: {money(used)} · Reservado: {money(held)}</p>
    <p className="text-xs leading-5 text-sarin-muted">Margen: {money(Math.max(0, limit - used - held))}</p>
    <p className="text-xs leading-5 text-sarin-muted">Tokens: {numbers(counter.usedTokens)} registrados · {numbers(counter.reservedTokens)} reservados</p>
  </div>;
}

function BusinessBudget({ uid, businessId }: { uid: string; businessId: string }) {
  const version = useRef(0), busy = useRef(false);
  const [data, setData] = useState<BusinessAiBudgetView | null>(null);
  const [loading, setLoading] = useState(true), [working, setWorking] = useState(false), [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null), [notice, setNotice] = useState<string | null>(null);
  const [day, setDay] = useState(""), [month, setMonth] = useState(""), [reason, setReason] = useState("");
  const [general, setGeneral] = useState<AiBudgetLimits | null>(null), [generalReason, setGeneralReason] = useState(""), [paused, setPaused] = useState(false);
  const accept = useCallback((response: BusinessAiBudgetView) => {
    if (response.businessId !== businessId) throw new Error("La lectura corresponde a otro negocio. Actualiza el presupuesto.");
    setData(response); setDay(String(response.limits.businessDayUsd)); setMonth(String(response.limits.businessMonthUsd));
    setGeneral({ ...(response.settings?.limits ?? response.proposedLimits) }); setPaused(response.settings?.paused ?? false);
    setReason(""); setGeneralReason(""); setReady(true);
  }, [businessId]);
  const read = useCallback((signal?: AbortSignal) => apiFetch<BusinessAiBudgetView>(`/api/admin/abuse?businessId=${encodeURIComponent(businessId)}`, { signal }, uid), [businessId, uid]);
  const refresh = useCallback(async (signal?: AbortSignal) => {
    const request = ++version.current; setLoading(true); setReady(false); setError(null);
    try { const response = await read(signal); if (!signal?.aborted && request === version.current) accept(response); }
    catch (cause) { if (!signal?.aborted && request === version.current) setError(errorMessage(cause)); }
    finally { if (!signal?.aborted && request === version.current) setLoading(false); }
  }, [read, accept]);
  useEffect(() => {
    const controller = new AbortController(); void refresh(controller.signal);
    return () => { controller.abort(); ++version.current; };
  }, [refresh]);
  const canEdit = ready && !loading && !working;
  const validBusiness = !!data?.settings && reason.trim().length > 0 && [Number(day), Number(month)].every(value => Number.isFinite(value) && value >= 0.000001 && value <= 100000);
  async function save(action: "business" | "restore" | "general") {
    if (!canEdit || busy.current || !data || !general || (action !== "general" && !validBusiness) || (action === "general" && !generalReason.trim())) return;
    busy.current = true; setWorking(true); setReady(false); setError(null); setNotice(null);
    const request = ++version.current;
    try {
      if (action === "general") {
        await apiFetch("/api/admin/abuse", { method: "PATCH", body: JSON.stringify({ action: "configure", expectedVersion: data.settings?.version ?? 0, paused, limits: general, reason: generalReason.trim() }) }, uid);
        const response = await read(); if (request === version.current) accept(response);
      } else {
        const response = await apiFetch<BusinessAiBudgetView>("/api/admin/abuse", { method: "PATCH", body: JSON.stringify({ action: "configure_business", businessId, expectedVersion: data.override?.version ?? 0, expectedSettingsVersion: data.settings!.version,
          limits: action === "restore" ? null : { businessDayUsd: Number(day), businessMonthUsd: Number(month) }, reason: reason.trim() }) }, uid);
        if (request === version.current) accept(response);
      }
      if (request === version.current) setNotice(action === "restore" ? "Límites generales restaurados. El consumo se conserva." : "Límites guardados. El consumo se conserva.");
    } catch (cause) { if (request === version.current) setError(`${errorMessage(cause)} Actualiza el presupuesto antes de volver a guardar; el cambio podría haberse aplicado.`); }
    finally { if (request === version.current) setWorking(false); busy.current = false; }
  }
  function submitBusiness(event: FormEvent) { event.preventDefault(); void save("business"); }
  return <div className="space-y-4">
    <button type="button" className="flex min-h-11 items-center gap-2 text-sm text-sarin-blue disabled:opacity-50" disabled={loading || working} onClick={() => void refresh()}><RefreshCw className="h-4 w-4" aria-hidden="true" />Actualizar presupuesto</button>
    {error && <Notice error>{error}</Notice>}{notice && <Notice>{notice}</Notice>}
    {loading && <p role="status" className="text-sm text-sarin-muted">Consultando presupuesto…</p>}
    {data && <>
      {!data.gateEnabled && <Notice>El control de presupuesto todavía no está activo. Guardar límites no lo activa. Estos contadores no reconstruyen el consumo anterior; consulta también el historial de IA.</Notice>}
      {!data.settings && <Notice>Configura el presupuesto general antes de ajustar este negocio.</Notice>}
      {data.settings?.paused && <Notice>La IA está en pausa global. Subir un límite individual no la reanuda.</Notice>}
      <div className="grid gap-3 sm:grid-cols-2">
        <Usage label={`${data.name || "Negocio"} · hoy (${data.periods.day})`} counter={data.usage.day} limit={data.limits.businessDayUsd} />
        <Usage label={`${data.name || "Negocio"} · mes (${data.periods.month})`} counter={data.usage.month} limit={data.limits.businessMonthUsd} />
        <Usage label="Todos los negocios · hoy" counter={data.global.day} limit={(data.settings?.limits ?? data.proposedLimits).globalDayUsd} />
        <Usage label="Todos los negocios · mes" counter={data.global.month} limit={(data.settings?.limits ?? data.proposedLimits).globalMonthUsd} />
      </div>
      <p className="text-xs leading-6 text-sarin-muted">Hora de Colombia. Importes calculados con tarifa conservadora, no son una factura. Reservado incluye consultas pendientes de conciliación. La próxima consulta necesita reservar su importe completo y cumplir los límites de tokens.</p>
      <form aria-label="Límites del negocio" onSubmit={submitBusiness} className="space-y-3 border-t border-sarin-line pt-4">
        <h3 className="font-semibold">Límites de {data.name || "este negocio"}</h3>
        <p className="text-sm text-sarin-muted">{data.override?.limits ? "Límites personalizados" : "Límites generales heredados"}. El presupuesto global sigue aplicándose; subir este negocio no aumenta el fondo compartido.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm">Límite diario del negocio (USD)<input name="businessDayUsd" type="number" min="0.000001" max="100000" step="0.000001" required value={day} disabled={!canEdit} onChange={event => setDay(event.target.value)} className={fieldClass + " mt-1"} /></label>
          <label className="text-sm">Límite mensual del negocio (USD)<input name="businessMonthUsd" type="number" min="0.000001" max="100000" step="0.000001" required value={month} disabled={!canEdit} onChange={event => setMonth(event.target.value)} className={fieldClass + " mt-1"} /></label>
        </div>
        <p className="text-xs text-sarin-muted">Tokens heredados: {numbers((data.settings?.limits ?? data.proposedLimits).businessDayTokens)}/día y {numbers((data.settings?.limits ?? data.proposedLimits).businessMonthTokens)}/mes. Cambiar presupuesto no modifica los paquetes de respuestas.</p>
        <label className="block text-sm">Motivo del cambio<input name="businessReason" maxLength={300} required value={reason} disabled={!canEdit} onChange={event => setReason(event.target.value)} className={fieldClass + " mt-1"} /></label>
        <div className="flex flex-wrap gap-3">
          <button type="submit" disabled={!canEdit || !validBusiness} className={buttonClass}>Guardar límites del negocio</button>
          <button type="button" disabled={!canEdit || !validBusiness || !data.override?.limits} onClick={() => void save("restore")} className="min-h-11 px-2 text-sm text-sarin-blue underline disabled:opacity-50">Restaurar límites generales</button>
        </div>
      </form>
      {general && <details className="border-t border-sarin-line pt-4">
        <summary className="min-h-11 font-semibold text-sarin-blue">Presupuesto general y valores por defecto</summary>
        <form aria-label="Presupuesto general" className="mt-3 space-y-3" onSubmit={event => { event.preventDefault(); void save("general"); }}>
          <p className="text-sm text-sarin-muted">El fondo global es compartido. Los valores por defecto se aplican a negocios sin límites personalizados. No se reinicia ningún consumo al guardar.</p>
          <div className="grid gap-3 sm:grid-cols-2">{generalFields.map(([key, label]) => <label key={key} className="text-sm">{label}<input name={`general_${key}`} type="number" min={key.endsWith("Tokens") ? 1 : 0.000001} max={key.endsWith("Tokens") ? Number.MAX_SAFE_INTEGER : 100000} step={key.endsWith("Tokens") ? 1 : 0.000001} required value={general[key]} disabled={!canEdit} className={fieldClass + " mt-1"} onChange={event => setGeneral(previous => previous && ({ ...previous, [key]: Number(event.target.value) }))} /></label>)}</div>
          <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={paused} disabled={!canEdit} onChange={event => setPaused(event.target.checked)} />Pausar todas las nuevas consultas de IA</label>
          <label className="block text-sm">Motivo del cambio general<input name="generalReason" maxLength={300} required value={generalReason} disabled={!canEdit} onChange={event => setGeneralReason(event.target.value)} className={fieldClass + " mt-1"} /></label>
          <button type="submit" disabled={!canEdit || !generalReason.trim()} className={buttonClass}>Guardar presupuesto general</button>
        </form>
      </details>}
    </>}
  </div>;
}

function BudgetSelector({ uid, businesses }: { uid: string; businesses: BusinessChoice[] }) {
  const [selected, setSelected] = useState(businesses[0]?.id ?? "");
  const businessId = businesses.some(business => business.id === selected) ? selected : businesses[0]?.id;
  return <section aria-labelledby="admin-ai-budget-title" className="space-y-4 rounded-2xl border border-sarin-line bg-sarin-paper p-4 sm:p-5">
    <div><h2 id="admin-ai-budget-title" className="text-xl font-semibold">Presupuesto de IA por negocio</h2><p className="mt-1 text-sm leading-6 text-sarin-muted">Consulta el consumo y ajusta cuánto puede usar cada negocio. Al alcanzar un límite se pausa la IA; las citas existentes siguen disponibles.</p></div>
    {businessId ? <><label className="block text-sm">Negocio<select aria-label="Negocio del presupuesto" className={fieldClass + " mt-1"} value={businessId} onChange={event => setSelected(event.target.value)}>{businesses.map(business => <option key={business.id} value={business.id}>{business.name || `Pendiente de configurar (${business.id})`}</option>)}</select></label><BusinessBudget key={businessId} uid={uid} businessId={businessId} /></> : <Notice>Todavía no hay negocios para consultar.</Notice>}
  </section>;
}

export function AdminAiBudget({ businesses }: { businesses: BusinessChoice[] }) {
  const { user, isSuperadmin } = useAuth();
  return user && isSuperadmin ? <BudgetSelector key={user.uid} uid={user.uid} businesses={businesses} /> : null;
}
