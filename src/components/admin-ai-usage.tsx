"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Notice, fieldClass } from "@/components/app-shell";
import { apiFetch, errorMessage } from "@/lib/client/api";
import type { AdminAiUsage as Usage, AiUsageTotals, CloudAiProvider } from "@/types/ai";
import type { Business } from "@/types/firestore";

const numbers = new Intl.NumberFormat("es-CO");
const dollars = new Intl.NumberFormat("es-CO", { maximumFractionDigits: 4 });
function monthInColombia(timestamp: number) {
  const parts = new Intl.DateTimeFormat("en", { timeZone: "America/Bogota", year: "numeric", month: "2-digit" }).formatToParts(timestamp);
  return `${parts.find(part => part.type === "year")!.value}-${parts.find(part => part.type === "month")!.value}`;
}
function dateInColombia(timestamp: number) {
  return new Date(timestamp).toLocaleString("es-CO", { timeZone: "America/Bogota", dateStyle: "medium", timeStyle: "short" });
}
function usd(value: number) {
  return value > 0 && value < 0.0001 ? "< USD 0,0001" : `USD ${dollars.format(value)}`;
}
function costRange(cost: AiUsageTotals["estimatedCostUSD"]) {
  if (cost === null) return "No disponible";
  return cost.min === cost.max ? usd(cost.min) : `${usd(cost.min)} – ${usd(cost.max)}`;
}

export function AdminAiUsage({ businesses }: { businesses: Pick<Business, "id" | "name">[] }) {
  const [month, setMonth] = useState(() => monthInColombia(Date.now()));
  const [provider, setProvider] = useState<CloudAiProvider>("deepseek");
  const requestVersion = useRef(0);
  const [data, setData] = useState<Usage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(async (signal?: AbortSignal) => {
    const version = ++requestVersion.current;
    setLoading(true);
    setError(null);
    try {
      const response = await apiFetch<Usage>(`/api/admin/ai/usage?month=${encodeURIComponent(month)}${provider === "openai" ? "&provider=openai" : ""}`, { signal });
      if (!signal?.aborted && version === requestVersion.current) setData(response);
    } catch (cause) {
      if (!signal?.aborted && version === requestVersion.current) setError(errorMessage(cause));
    } finally {
      if (!signal?.aborted && version === requestVersion.current) setLoading(false);
    }
  }, [month, provider]);
  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal);
    return () => { controller.abort(); ++requestVersion.current; };
  }, [refresh]);

  const reading = data?.month === month && data.provider === provider ? data : null;
  const providerName = provider === "openai" ? "OpenAI" : "DeepSeek";
  const beforeMeasurement = Boolean(reading?.measurementStartedAt && month < monthInColombia(reading.measurementStartedAt));
  const measured = reading && reading.measurementStartedAt !== null && !beforeMeasurement;
  const names = new Map(businesses.map(business => [business.id, business.name]));

  return (
    <section aria-labelledby="admin-ai-usage-title" className="space-y-4 rounded-2xl border border-sarin-line bg-sarin-paper p-4 sm:p-5">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between xl:gap-4">
        <div className="min-w-0 flex-1">
          <h2 id="admin-ai-usage-title" className="text-xl font-semibold">Consumo de {providerName}</h2>
          <p className="mt-1 text-sm leading-6 text-sarin-muted">Llamadas y tokens registrados por mes, en hora de Colombia. El costo estimado en USD no es una factura.</p>
        </div>
        <div className="flex shrink-0 flex-wrap items-end gap-3">
          <label className="text-xs text-sarin-muted">
            Proveedor
            <select aria-label="Proveedor del consumo" value={provider} className={fieldClass + " mt-1"} onChange={event => { if (event.target.value === "deepseek" || event.target.value === "openai") setProvider(event.target.value); }}>
              <option value="deepseek">DeepSeek</option>
              <option value="openai">OpenAI</option>
            </select>
          </label>
          <label className="text-xs text-sarin-muted">
            Mes de consumo
            <input type="month" value={month} max={monthInColombia(Date.now())} disabled={loading} className={fieldClass + " mt-1"} onChange={event => { if (/^\d{4}-(0[1-9]|1[0-2])$/.test(event.target.value)) setMonth(event.target.value); }} />
          </label>
          <button type="button" disabled={loading} onClick={() => void refresh()} className="flex min-h-11 items-center gap-2 text-sm text-sarin-blue disabled:opacity-50">
            <RefreshCw aria-hidden="true" className="h-4 w-4" />
            {loading ? "Consultando consumo…" : "Actualizar consumo"}
          </button>
        </div>
      </div>
      {error && <Notice error>{error}{reading ? " Se conserva la última lectura de este mes y proveedor." : ""}</Notice>}
      {loading && !reading && <p role="status" className="text-sm text-sarin-muted">Consultando el mes seleccionado…</p>}
      {reading && reading.measurementStartedAt === null && <Notice>Todavía no hay medición disponible. El contador no reconstruye usos anteriores; la ausencia de registros no significa consumo gratuito.</Notice>}
      {beforeMeasurement && <Notice>Este mes es anterior al inicio del registro. No hay historial retroactivo de consumo.</Notice>}
      {measured && (
        <>
          <dl className="grid gap-4 sm:grid-cols-3">
            <div>
              <dt className="text-xs text-sarin-muted">Llamadas al modelo</dt>
              <dd className="mt-2 text-xl font-semibold tabular-nums">{numbers.format(reading.totals.calls)}</dd>
            </div>
            <div>
              <dt className="text-xs text-sarin-muted">Tokens de entrada / salida</dt>
              <dd className="mt-2 text-xl font-semibold tabular-nums">{numbers.format(reading.totals.promptTokens)} / {numbers.format(reading.totals.completionTokens)}</dd>
            </div>
            <div>
              <dt className="text-xs text-sarin-muted">Costo estimado del uso registrado</dt>
              <dd className="mt-2 text-xl font-semibold tabular-nums text-sarin-blue">{costRange(reading.totals.estimatedCostUSD)}</dd>
            </div>
          </dl>
          <p className="text-xs leading-6 text-sarin-muted">
            Registro desde {dateInColombia(reading.measurementStartedAt!)}. Incluye las rondas de herramientas: una respuesta puede realizar varias llamadas.
            {" "}{numbers.format(reading.totals.successfulCalls)} llamadas correctas · {numbers.format(reading.totals.failedCalls)} fallidas.
            {" "}Entrada en caché: {numbers.format(reading.totals.cacheHitTokens)} tokens; sin caché: {numbers.format(reading.totals.cacheMissTokens)}.
            {provider === "openai" && <> Escrituras de caché reportadas: {numbers.format(reading.totals.cacheWriteTokens ?? 0)} tokens, incluidas en la entrada sin caché. {numbers.format(Math.max(0, reading.totals.usageReportedCalls - (reading.totals.cacheWriteReportedCalls ?? 0)))} llamadas sin detalle de escritura de caché; su costo se presenta como rango.</>}
          </p>
          {reading.totals.calls === 0 && <Notice>Sin actividad registrada en este mes desde el inicio de la medición. No se calculó un costo.</Notice>}
          {reading.businesses.length > 0 && (
            <div className="overflow-x-auto rounded-xl border border-sarin-line">
              <table className="w-full text-left text-sm">
                <caption className="sr-only">Consumo de {providerName} por negocio, {month}</caption>
                <thead className="bg-sarin-canvas text-xs text-sarin-muted">
                  <tr><th scope="col" className="p-3">Negocio</th><th scope="col" className="p-3">Llamadas</th><th scope="col" className="p-3">Tokens entrada / salida</th><th scope="col" className="p-3">Estimación USD</th></tr>
                </thead>
                <tbody className="divide-y divide-sarin-line">
                  {reading.businesses.map(row => (
                    <tr key={row.businessId === null ? "onboarding" : `business:${row.businessId}`}>
                      <td className="max-w-64 break-words p-3 font-medium">{row.businessId === null ? "Configuración inicial" : names.get(row.businessId) || `Negocio: ${row.businessId}`}</td>
                      <td className="p-3 tabular-nums">{numbers.format(row.calls)}</td>
                      <td className="whitespace-nowrap p-3 tabular-nums">{numbers.format(row.promptTokens)} / {numbers.format(row.completionTokens)}</td>
                      <td className="p-3 tabular-nums">{costRange(row.estimatedCostUSD)}{row.unknownCostCalls > 0 && <span className="mt-1 block text-xs text-amber-800">{numbers.format(row.unknownCostCalls)} sin costo estimable</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
      {reading && (reading.totals.unknownCostCalls > 0 || reading.totals.missingUsageCalls > 0 || reading.telemetryWriteFailures > 0 || reading.truncated) && (
        <div className="space-y-2 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900" role="status">
          {reading.totals.unknownCostCalls > 0 && <p>{numbers.format(reading.totals.unknownCostCalls)} llamadas sin costo estimable: faltan datos de uso o una tarifa compatible con el modelo y modo de procesamiento.</p>}
          {reading.totals.missingUsageCalls > 0 && <p>{numbers.format(reading.totals.missingUsageCalls)} llamadas sin reporte de tokens. No se asumen como consumo cero.</p>}
          {reading.truncated && <p>La tabla muestra una parte de los negocios por el límite de filas. Los totales mensuales no se recortan.</p>}
          {reading.telemetryWriteFailures > 0 && <p>{numbers.format(reading.telemetryWriteFailures)} fallos al confirmar el registro de este mes, observados desde {dateInColombia(reading.telemetryProcessStartedAt)}. Algunos registros pueden haberse guardado.</p>}
        </div>
      )}
      <p className="text-xs leading-6 text-sarin-muted">
        {provider === "openai" ? <>
          Tarifa gpt-6-luna Standard, consultada el 16 de octubre de 2026: USD por millón de tokens, entrada 0,10; entrada en caché 0,01; escritura de caché 0,125; salida 0,50. Si falta el detalle de escrituras, la entrada no recuperada de caché se estima entre 0,10 y 0,125. Con más de 272.000 tokens de entrada se aplica 2× a entrada y caché y 1,5× a salida en toda la solicitud. Solo se valora el modo Standard confirmado; no incluye recargos regionales ni impuestos. <a className="text-sarin-blue underline" href="https://developers.openai.com/api/docs/models/gpt-6-luna" target="_blank" rel="noreferrer">Tarifas oficiales de OpenAI</a>.
        </> : <>El rango en USD aplica las tarifas fuera de pico y de pico de DeepSeek, consultadas el 15 de octubre de 2026, sobre los tokens registrados.</>}
        {" "}Puede haber actividad no registrada. No incluye equipo o energía de Ollama ni cargos de Meta por WhatsApp.
      </p>
    </section>
  );
}
