"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Notice, buttonClass, fieldClass } from "@/components/app-shell";
import { apiFetch, errorMessage } from "@/lib/client/api";
import type { Business } from "@/types/firestore";
import type { AdminWhatsAppSettings, WhatsAppBindingStatus } from "@/types/whatsapp";

const labels: Record<WhatsAppBindingStatus["status"], string> = { unconfigured: "Configuración pendiente", configured_unverified: "Sin verificar", paused: "Pausado", ready: "Conectado y verificado" };
const date = (value: string | null) => value ? new Date(value).toLocaleString("es-CO", { timeZone: "America/Bogota" }) : "Sin registro";

export function AdminWhatsApp({ businesses }: { businesses: Pick<Business, "id" | "name">[] }) {
  const [data, setData] = useState<AdminWhatsAppSettings | null>(null);
  const [businessId, setBusinessId] = useState(businesses[0]?.id ?? "");
  const [phoneNumberId, setPhoneNumberId] = useState("");
  const [wabaId, setWabaId] = useState("");
  const [enabled, setEnabled] = useState(false);
  const [checking, setChecking] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const refresh = useCallback(async (signal?: AbortSignal) => {
    setChecking(true);
    setError(null);
    try {
      const response = await apiFetch<AdminWhatsAppSettings>("/api/admin/whatsapp", { signal });
      if (!signal?.aborted) setData(response);
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
  const binding = data?.bindings.find(item => item.businessId === businessId);
  useEffect(() => {
    setPhoneNumberId(binding?.phoneNumberId ?? "");
    setWabaId(binding?.wabaId ?? "");
    setEnabled(binding?.enabled ?? false);
  }, [binding, businessId]);
  const busy = checking || saving;
  const canEnable = Boolean(data?.enabled && data.configured && binding?.credentialConfigured);
  const valid = businesses.some(item => item.id === businessId) && /^\d{5,30}$/.test(phoneNumberId) && /^\d{5,30}$/.test(wabaId);
  const changed = !binding || binding.enabled !== enabled || (enabled && binding.status !== "ready");
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!data || busy || !valid || !changed || (enabled && !canEnable)) return;
    setSaving(true);
    setNotice(null);
    setError(null);
    try {
      const response = await apiFetch<AdminWhatsAppSettings>("/api/admin/whatsapp", { method: "PATCH", body: JSON.stringify({ businessId, phoneNumberId, wabaId, enabled }) });
      setData(response);
      setNotice("Vinculación guardada. El estado confirmado aparece en la lista.");
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section aria-labelledby="admin-whatsapp-title" className="space-y-5 rounded-2xl border border-sarin-line bg-sarin-paper p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="admin-whatsapp-title" className="text-xl font-semibold">WhatsApp para los negocios</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-sarin-muted">Prepara un número por negocio. La modalidad de WhatsApp solo se puede contratar cuando su conexión está verificada; el consumo de Meta es adicional.</p>
        </div>
        <button type="button" disabled={busy} onClick={() => void refresh()} className="min-h-11 text-sm text-sarin-blue disabled:opacity-50">{checking ? "Consultando WhatsApp…" : "Actualizar WhatsApp"}</button>
      </div>
      {error && <Notice error>{error}{data ? " Se conserva el último estado confirmado." : ""}</Notice>}
      {notice && <Notice>{notice}</Notice>}
      {data && <>
        <p className="text-sm font-medium">{!data.enabled ? "Automatización desactivada" : !data.configured ? "Configuración privada pendiente" : "Configuración del servidor preparada"}</p>
        {(!data.configured || !data.enabled) && <p className="text-sm text-sarin-muted">Puedes guardar una vinculación pausada. La habilitación requiere configurar y verificar el servicio en el servidor. Las credenciales no se ingresan en este panel.</p>}
        {data.bindings.length === 0 ? <Notice>Sin números vinculados. Todavía no hay una conexión de WhatsApp disponible.</Notice> : <div className="grid gap-3 sm:grid-cols-2">
          {data.bindings.map(item => <article key={item.phoneNumberId} className="space-y-2 rounded-xl border border-sarin-line p-4">
            <h3 className="font-semibold">{businesses.find(business => business.id === item.businessId)?.name ?? `Negocio: ${item.businessId}`}</h3>
            <p className={`text-sm font-medium ${item.status === "ready" ? "text-sarin-blue" : "text-sarin-muted"}`}>{labels[item.status]}</p>
            <p className="break-all text-xs text-sarin-muted">Identificador del número: {item.phoneNumberId}</p>
            <p className="text-xs text-sarin-muted">Último mensaje recibido: {date(item.lastInboundAt)}</p>
            <p className="text-xs text-sarin-muted">Última entrega confirmada: {date(item.lastDeliveredAt)}</p>
          </article>)}
        </div>}
        {data.truncated && <p className="text-xs text-sarin-muted">La lista muestra las primeras 100 vinculaciones.</p>}
        {data.usage && <div aria-label="Actividad de WhatsApp" className="space-y-3 rounded-xl bg-sarin-canvas p-4">
          <h3 className="text-sm font-semibold">Respuestas generadas en {data.usage.month} (Colombia)</h3>
          <dl className="grid gap-3 sm:grid-cols-3">
            {([["Entregados", data.usage.totals.delivered], ["Fallidos", data.usage.totals.failed], ["Resultado incierto", data.usage.totals.unknown]] as const).map(([label, count]) => <div key={label}><dt className="text-xs text-sarin-muted">{label}</dt><dd className="mt-1 text-lg font-semibold tabular-nums">{count.toLocaleString("es-CO")}</dd></div>)}
          </dl>
          {!data.usage.totals.sent && !data.usage.totals.delivered && !data.usage.totals.failed && !data.usage.totals.unknown && <p className="text-sm text-sarin-muted">Sin respuestas generadas registradas para ese mes.</p>}
          <p className="text-xs leading-5 text-sarin-muted">Estados observados de esas respuestas, aunque la entrega se confirme después. Las entregas incluyen los mensajes leídos. Los resultados inciertos todavía no tienen una confirmación definitiva.</p>
          <p className="text-xs leading-5 text-sarin-muted">Costo no calculado. Consulta el consumo y la factura en Meta; este registro de estados no es una factura ni implica costo cero. El consumo de Meta es independiente de la suscripción de Sarin.</p>
        </div>}
        {businesses.length > 0 && <form onSubmit={event => void save(event)} className="space-y-4 border-t border-sarin-line pt-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="text-sm">Negocio<select name="whatsappBusiness" className={fieldClass + " mt-2"} value={businessId} disabled={busy} onChange={event => { setBusinessId(event.target.value); setNotice(null); setError(null); }}>
              {businesses.map(business => <option key={business.id} value={business.id}>{business.name}</option>)}
            </select></label>
            <label className="text-sm">Identificador del número en Meta<input name="phoneNumberId" required inputMode="numeric" pattern="[0-9]{5,30}" maxLength={30} className={fieldClass + " mt-2"} value={phoneNumberId} disabled={busy || Boolean(binding)} onChange={event => setPhoneNumberId(event.target.value)} /></label>
            <label className="text-sm">Identificador de la cuenta de WhatsApp Business<input name="wabaId" required inputMode="numeric" pattern="[0-9]{5,30}" maxLength={30} className={fieldClass + " mt-2"} value={wabaId} disabled={busy || Boolean(binding)} onChange={event => setWabaId(event.target.value)} /></label>
          </div>
          <p className="text-xs text-sarin-muted">Estos identificadores los proporciona Meta; no son el teléfono de contacto del negocio. Guarda primero la vinculación pausada.</p>
          <label className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" name="whatsappEnabled" checked={enabled} disabled={busy || (!canEnable && !enabled)} onChange={event => setEnabled(event.target.checked)} className="h-4 w-4 accent-sarin-blue" />Habilitar tras verificar la conexión con Meta</label>
          {enabled && <p className="text-xs text-sarin-muted">Al guardar se comprobará la conexión del número. No se envía un mensaje de prueba.</p>}
          <button className={buttonClass} disabled={busy || !valid || !changed || (enabled && !canEnable)}>{saving ? "Guardando vinculación…" : "Guardar vinculación"}</button>
        </form>}
      </>}
    </section>
  );
}
