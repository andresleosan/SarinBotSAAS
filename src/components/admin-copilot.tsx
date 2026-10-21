"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowUpRight, RefreshCw, Send } from "lucide-react";
import { Notice, buttonClass, fieldClass } from "@/components/app-shell";
import { apiFetch, errorMessage } from "@/lib/client/api";
import type { AdminCopilotAnswer, AdminCopilotBusiness, AdminCopilotSnapshot, AdminCopilotSource } from "@/types/admin-copilot";

const quickQuestions = ["¿Qué necesita mi atención?", "¿Qué negocios están cerca de su límite?", "¿Qué pagos están pendientes?"];
const numbers = new Intl.NumberFormat("es-CO");
const secondaryButton = "inline-flex min-h-11 items-center justify-center gap-2 rounded-[10px] border border-sarin-line px-3 py-2 text-sm font-medium text-sarin-blue transition hover:bg-sarin-soft disabled:opacity-50";
const date = (value: number) => new Date(value).toLocaleString("es-CO", { timeZone: "America/Bogota", dateStyle: "medium", timeStyle: "short" });

interface Exchange { id: string; question: string; answer: AdminCopilotAnswer }

function SourceLink({ source }: { source: AdminCopilotSource }) {
  return <a href={source.href} className="inline-flex min-h-11 max-w-full items-center gap-1.5 break-words text-sm font-medium text-sarin-blue underline decoration-sarin-line underline-offset-4 hover:decoration-sarin-blue"><span className="min-w-0 break-words">{source.label}</span><ArrowUpRight aria-hidden="true" className="h-4 w-4 shrink-0" /></a>;
}

export function AdminCopilot({ onBusinessesChange }: { onBusinessesChange?: (businesses: AdminCopilotBusiness[]) => void }) {
  const [data, setData] = useState<AdminCopilotSnapshot | null>(null);
  const [businessId, setBusinessId] = useState("");
  const [question, setQuestion] = useState("");
  const [exchanges, setExchanges] = useState<Exchange[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [questionError, setQuestionError] = useState<string | null>(null);
  const mounted = useRef(false);
  const readController = useRef<AbortController | null>(null);
  const questionController = useRef<AbortController | null>(null);
  const composer = useRef<HTMLTextAreaElement | null>(null);
  const notifyBusinesses = useRef(onBusinessesChange);
  notifyBusinesses.current = onBusinessesChange;

  const refresh = useCallback(async () => {
    readController.current?.abort();
    const controller = new AbortController();
    readController.current = controller;
    setLoading(true);
    setLoadError(null);
    try {
      const response = await apiFetch<AdminCopilotSnapshot>(`/api/admin/copilot${businessId ? `?businessId=${encodeURIComponent(businessId)}` : ""}`, { signal: controller.signal });
      if (!mounted.current || controller.signal.aborted) return;
      setData(response);
      notifyBusinesses.current?.(response.businesses);
    } catch (cause) {
      if (mounted.current && !controller.signal.aborted) setLoadError(errorMessage(cause));
    } finally {
      if (mounted.current && !controller.signal.aborted) setLoading(false);
    }
  }, [businessId]);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; readController.current?.abort(); questionController.current?.abort(); };
  }, []);
  useEffect(() => { void refresh(); return () => readController.current?.abort(); }, [refresh]);

  const reading = data?.scopeBusinessId === (businessId || null) ? data : null;
  const partial = Boolean(reading && (reading.coverage.businessesTruncated || reading.coverage.paymentsTruncated || reading.coverage.allowancesUnavailable));
  const sourceById = new Map(reading?.sources.map(source => [source.id, source]));

  function changeBusiness(value: string) {
    questionController.current?.abort();
    questionController.current = null;
    setSending(false);
    setExchanges([]);
    setQuestion("");
    setQuestionError(null);
    setBusinessId(value);
  }

  async function ask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = question.trim();
    if (questionController.current || loading || !reading || !trimmed || trimmed.length > 1000) return;
    const controller = new AbortController();
    questionController.current = controller;
    const requestId = crypto.randomUUID();
    setSending(true);
    setQuestionError(null);
    try {
      const answer = await apiFetch<AdminCopilotAnswer>("/api/admin/copilot", {
        method: "POST", signal: controller.signal,
        body: JSON.stringify({ requestId, question: trimmed, ...(businessId ? { businessId } : {}) }),
      });
      if (!mounted.current || controller.signal.aborted) return;
      setExchanges(previous => [...previous.slice(-9), { id: requestId, question: trimmed, answer }]);
      setData(answer.snapshot);
      notifyBusinesses.current?.(answer.snapshot.businesses);
      setQuestion("");
    } catch (cause) {
      if (mounted.current && !controller.signal.aborted) setQuestionError(errorMessage(cause));
    } finally {
      if (questionController.current === controller) {
        questionController.current = null;
        if (mounted.current && !controller.signal.aborted) setSending(false);
      }
    }
  }

  return <div className="min-w-0 space-y-5">
    <section aria-labelledby="admin-summary-title" className="min-w-0 space-y-5 rounded-2xl border border-sarin-line bg-sarin-paper p-4 sm:p-6">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0"><h2 id="admin-summary-title" className="text-xl font-semibold">Tu operación, a la vista</h2><p className="mt-1 text-sm leading-6 text-sarin-muted">Pagos, respuestas disponibles y vencimientos de los negocios consultados.</p></div>
        <button type="button" onClick={() => void refresh()} disabled={loading || sending} className={secondaryButton + " shrink-0 self-start"}><RefreshCw aria-hidden="true" className="h-4 w-4" />{loading ? "Consultando resumen…" : "Actualizar resumen"}</button>
      </div>
      <label className="block max-w-sm text-sm font-medium">Consultar negocio<select className={fieldClass + " mt-2"} value={businessId} disabled={loading || sending || !data} onChange={event => changeBusiness(event.target.value)}><option value="">Todos los negocios consultados</option>{data?.businesses.map(business => <option key={business.id} value={business.id}>{business.name || "Sin nombre configurado"}</option>)}</select></label>
      {loadError && <Notice error>{loadError}{reading ? " Se conserva la última lectura confirmada." : ""}</Notice>}
      {loading && !reading && <p role="status" className="text-sm text-sarin-muted">Consultando datos de administración…</p>}
      {reading && <>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-5 border-y border-sarin-line py-5 sm:grid-cols-3 xl:grid-cols-5">
          {([
            ["Negocios consultados", reading.metrics.businesses], ["Pagos pendientes", reading.metrics.pendingPayments], ["Cuotas por agotarse", reading.metrics.quotaWarnings], ["Cuotas agotadas", reading.metrics.quotaExhausted], ["Próximos vencimientos", reading.metrics.expiringSubscriptions],
          ] as const).map(([label, count]) => <div key={label} className="min-w-0"><dt className="text-xs leading-5 text-sarin-muted">{label}</dt><dd className="mt-1 text-2xl font-semibold tabular-nums tracking-tight">{numbers.format(count)}</dd></div>)}
        </dl>
        <p className="text-xs leading-5 text-sarin-muted">Consulta del {date(reading.generatedAt)} · hora de Colombia. El resumen se obtiene de los registros; actualizarlo no consulta a la IA.</p>
        {partial && <div role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900"><p className="font-semibold">Cobertura parcial</p>{(reading.coverage.businessesTruncated || reading.coverage.paymentsTruncated) && <p>Se alcanzó el límite de {reading.coverage.limit} registros en {reading.coverage.businessesTruncated && reading.coverage.paymentsTruncated ? "negocios y pagos" : reading.coverage.businessesTruncated ? "negocios" : "pagos"}. Los indicadores no representan toda la operación.</p>}{reading.coverage.allowancesUnavailable > 0 && <p>{numbers.format(reading.coverage.allowancesUnavailable)} cuotas sin consultar. No se asumen como disponibles ni agotadas.</p>}</div>}
        <div><h3 className="font-semibold">Necesita tu atención</h3>{reading.attention.length === 0 ? <p className="mt-3 text-sm leading-6 text-sarin-muted">Sin pendientes en los datos consultados.{partial ? " Hay información pendiente de consultar." : ""}</p> : <ul className="mt-3 divide-y divide-sarin-line">{reading.attention.map((item, index) => <li key={`${item.sourceId}-${item.kind}-${index}`} className="flex flex-col gap-2 py-3 first:pt-0 sm:flex-row sm:items-start sm:justify-between sm:gap-5"><div className="min-w-0"><p className="break-words text-sm font-semibold">{item.title}{item.severity === "urgent" && <span className="ml-2 inline-block rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-900">Prioridad</span>}</p><p className="mt-1 break-words text-sm leading-6 text-sarin-muted">{item.detail}</p></div>{sourceById.has(item.sourceId) && <div className="min-w-0 sm:max-w-64 sm:shrink-0"><SourceLink source={sourceById.get(item.sourceId)!} /></div>}</li>)}</ul>}</div>
      </>}
    </section>

    <section aria-labelledby="admin-copilot-title" className="min-w-0 space-y-5 rounded-2xl border border-sarin-line bg-sarin-paper p-4 sm:p-6">
      <div><h2 id="admin-copilot-title" className="text-xl font-semibold">Pregúntale a SarinBot</h2><p className="mt-1 text-sm leading-6 text-sarin-muted">Consulta tu operación y abre los registros que sustentan cada respuesta. Este espacio es privado y de consulta; no modifica cuentas ni pagos.</p></div>
      <div className="flex flex-wrap gap-2" aria-label="Preguntas sugeridas">{quickQuestions.map(item => <button key={item} type="button" disabled={loading || sending || !reading} onClick={() => { setQuestion(item); setQuestionError(null); composer.current?.focus(); }} className={secondaryButton + " text-left"}>{item}</button>)}</div>
      {exchanges.length > 0 && <div role="log" aria-label="Conversación privada con SarinBot" aria-live="polite" aria-relevant="additions" className="space-y-5">{exchanges.map(exchange => <article key={exchange.id} className="space-y-3 border-t border-sarin-line pt-5"><div className="rounded-xl bg-sarin-canvas px-4 py-3"><h3 className="text-xs font-semibold text-sarin-muted">Tu consulta</h3><p className="mt-1 whitespace-pre-wrap break-words text-sm leading-6">{exchange.question}</p></div><div className="px-1"><h3 className="text-sm font-semibold text-sarin-blue">SarinBot</h3><p className="mt-2 whitespace-pre-wrap break-words text-sm leading-7">{exchange.answer.reply}</p>{exchange.answer.sources.length > 0 && <div className="mt-3"><p className="text-xs font-medium text-sarin-muted">Registros consultados</p><ul className="mt-1 flex flex-wrap gap-x-5">{exchange.answer.sources.map(source => <li className="min-w-0 max-w-full" key={source.id}><SourceLink source={source} /></li>)}</ul></div>}<p className="mt-2 text-xs text-sarin-muted">Datos del {date(exchange.answer.snapshot.generatedAt)} · Colombia</p></div></article>)}</div>}
      {questionError && <Notice error>{questionError}</Notice>}
      <form onSubmit={event => void ask(event)} className="space-y-3">
        <label htmlFor="admin-copilot-question" className="block text-sm font-medium">Tu pregunta{businessId && <span className="font-normal text-sarin-muted"> · {data?.businesses.find(item => item.id === businessId)?.name || "Negocio seleccionado"}</span>}</label>
        <textarea ref={composer} id="admin-copilot-question" name="adminQuestion" className={fieldClass + " min-h-28 resize-y"} value={question} onChange={event => setQuestion(event.target.value)} disabled={loading || sending || !reading} maxLength={1000} rows={3} placeholder="Por ejemplo: ¿qué debo revisar hoy?" aria-describedby="admin-copilot-help" />
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><p id="admin-copilot-help" className="max-w-lg text-xs leading-5 text-sarin-muted">Cada pregunta consulta los datos actuales del alcance seleccionado. La conversación permanece solo en esta sesión de la página.</p><button type="submit" disabled={loading || sending || !reading || !question.trim() || question.trim().length > 1000} className={buttonClass + " inline-flex shrink-0 items-center justify-center gap-2"}><Send aria-hidden="true" className="h-4 w-4" />{sending ? "Consultando a SarinBot…" : "Preguntar a SarinBot"}</button></div>
        {sending && <p role="status" className="text-sm text-sarin-muted">SarinBot está consultando los registros del alcance seleccionado…</p>}
      </form>
    </section>
  </div>;
}
