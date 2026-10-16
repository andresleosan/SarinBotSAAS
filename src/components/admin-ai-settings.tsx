"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Notice, buttonClass } from "@/components/app-shell";
import { apiFetch, errorMessage } from "@/lib/client/api";
import type { AdminAiSettings as AiSettings, AiProvider, AiProviderSelection } from "@/types/ai";

const providerLabels: Record<AiProvider, string> = {
  ollama: "IA local (Ollama)",
  deepseek: "DeepSeek",
  gemini: "Gemini · Clientes",
};
const providers: AiProvider[] = ["ollama", "deepseek", "gemini"];

export function AdminAiSettings({ onSaved }: { onSaved?: () => void }) {
  const [data, setData] = useState<AiSettings | null>(null);
  const [selected, setSelected] = useState<AiProvider | null>(null);
  const [checking, setChecking] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const refresh = useCallback(async (signal?: AbortSignal) => {
    setChecking(true);
    setError(null);
    try {
      const response = await apiFetch<AiSettings>("/api/admin/ai", { signal });
      if (!signal?.aborted) {
        setData(response);
        setSelected(response.provider);
      }
    } catch (cause) {
      if (!signal?.aborted) setError(errorMessage(cause));
    } finally {
      if (!signal?.aborted) setChecking(false);
    }
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal);
    return () => controller.abort();
  }, [refresh]);

  const selectedStatus = data?.providers.find(item => item.provider === selected);
  const busy = checking || saving;
  async function save() {
    if (!data || !selected || busy || selected === data.provider || !selectedStatus?.configured) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const response = await apiFetch<AiProviderSelection>("/api/admin/ai", {
        method: "PATCH",
        body: JSON.stringify({ provider: selected }),
      });
      setData(previous => previous ? { ...previous, ...response } : previous);
      setSelected(response.provider);
      setNotice(`IA guardada: ${providerLabels[response.provider]}. Se usará en los próximos mensajes de los negocios.`);
      onSaved?.();
      await refresh();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section aria-labelledby="admin-ai-title" className="space-y-4 rounded-2xl border border-sarin-line bg-sarin-paper p-4 sm:p-5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div className="min-w-0 flex-1">
          <h2 id="admin-ai-title" className="text-xl font-semibold">IA para los negocios</h2>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-sarin-muted">Elige la IA para todos los negocios y su configuración inicial. El cambio se aplica a los próximos mensajes; una respuesta en curso mantiene la IA anterior. Si falla, no se usa otra automáticamente.</p>
        </div>
        <button type="button" disabled={busy} onClick={() => void refresh()} className="flex min-h-11 shrink-0 items-center gap-2 text-sm text-sarin-blue disabled:opacity-50">
          <RefreshCw aria-hidden="true" className="h-4 w-4" />
          {checking ? "Comprobando IA…" : "Actualizar estado de IA"}
        </button>
      </div>
      {error && <Notice error>{error}</Notice>}
      {notice && <Notice>{notice}</Notice>}
      {data && (
        <>
          <p aria-label="IA activa" role="status" className="rounded-xl bg-sarin-soft px-3 py-2 text-sm font-semibold text-sarin-ink">En uso para los negocios: {providerLabels[data.provider]}</p>
          <fieldset disabled={busy}>
            <legend className="mb-2 text-sm font-medium">Seleccionar IA</legend>
            <div className="grid items-start gap-3 md:grid-cols-3">
              {providers.map(provider => {
                const status = data.providers.find(item => item.provider === provider);
                return (
                  <label key={provider} className={`block min-w-0 space-y-2 rounded-xl border p-3 ${selected === provider ? "border-sarin-blue bg-sarin-soft" : "border-sarin-line"}`}>
                    <span className="flex items-center gap-2 font-semibold">
                      <input type="radio" name="aiProvider" value={provider} checked={selected === provider} disabled={busy || !status?.configured} onChange={() => { if (!busy && status?.configured) { setSelected(provider); setNotice(null); setError(null); } }} className="h-4 w-4 accent-sarin-blue focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sarin-blue" />
                      {providerLabels[provider]}
                    </span>
                    {data.provider === provider && <span className="inline-flex rounded-full bg-sarin-soft px-2 py-1 text-xs font-semibold text-sarin-blue">En uso</span>}
                    <span className="block text-sm text-sarin-muted">
                      {!status ? "Sin comprobar" : !status.configured ? "Configuración pendiente" : status.online ? "Configurada · Conexión verificada" : "Configurada · Sin conexión"}
                    </span>
                    {status?.model && <span className="block break-words text-xs text-sarin-muted">Modelo: {status.model}</span>}
                    {status?.error && <span className="block text-sm text-amber-800">{status.error}</span>}
                    {provider === "deepseek" && <span className="block text-xs leading-6 text-sarin-muted">DeepSeek recibe los mensajes, el contexto del negocio y los resultados de las herramientas para generar respuestas. Su uso puede generar cargos en tu cuenta de DeepSeek.</span>}
                    {provider === "gemini" && <span className="block text-xs leading-6 text-sarin-muted">API de pago para conversaciones reales. Google recibe los mensajes y el contexto del negocio. Requiere facturación verificada; comprobar la conexión no confirma el saldo.</span>}
                  </label>
                );
              })}
            </div>
          </fieldset>
          <div className="flex flex-col items-start gap-3 border-t border-sarin-line pt-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="max-w-3xl text-xs leading-5 text-sarin-muted">Las credenciales de los proveedores se administran en el servidor.</p>
            <button type="button" className={buttonClass + " shrink-0"} disabled={busy || !selectedStatus?.configured || selected === data.provider} onClick={() => void save()}>{saving ? "Guardando IA…" : "Guardar IA"}</button>
          </div>
          <section aria-labelledby="admin-gemini-test-title" className="space-y-3 border-t border-sarin-line pt-4">
            <div className="flex flex-wrap items-center gap-2">
              <h3 id="admin-gemini-test-title" className="font-semibold">Gemini · Pruebas</h3>
              <span className="rounded-full border border-sarin-line px-2 py-1 text-xs font-medium text-sarin-muted">Solo pruebas</span>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0 space-y-1">
                <p aria-label="Estado de Gemini de pruebas" className="text-sm font-medium">
                  {!data.geminiTest ? "Sin comprobar" : data.geminiTest.configured ? "Clave configurada" : "Sin configurar"}
                </p>
                {data.geminiTest?.configured && <p className="text-sm text-sarin-muted">Conexión sin comprobar</p>}
                {data.geminiTest?.model && <p className="break-words text-xs text-sarin-muted">Modelo: {data.geminiTest.model}</p>}
                {data.geminiTest?.error && <p className="text-sm text-amber-800">{data.geminiTest.error}</p>}
              </div>
              <a href="https://aistudio.google.com/" target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 shrink-0 items-center self-start rounded-lg px-2 text-sm text-sarin-blue hover:bg-sarin-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sarin-blue">Abrir AI Studio<span className="sr-only"> (nueva pestaña)</span></a>
            </div>
            <p className="max-w-3xl text-xs leading-5 text-sarin-muted">Conexión separada para pruebas con datos ficticios. Para usar el nivel gratuito, utiliza un proyecto sin facturación y una clave propia. Sarin no comprueba su plan ni su cuota.</p>
            <p className="max-w-3xl text-xs leading-5 text-sarin-muted">Este perfil no atiende a los negocios. Actualizar su estado solo revisa la configuración guardada; no envía mensajes a Google.</p>
          </section>
        </>
      )}
    </section>
  );
}
