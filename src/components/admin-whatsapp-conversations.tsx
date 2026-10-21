"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Notice, buttonClass, fieldClass } from "@/components/app-shell";
import { apiFetch, errorMessage } from "@/lib/client/api";
import type { AdminWhatsAppConversation, AdminWhatsAppConversations as Conversations, WhatsAppConversationMode } from "@/types/whatsapp";

const labels: Record<WhatsAppConversationMode, string> = { bot: "Sarin atiende", human: "Tú atiendes", review: "Necesita revisión" };
const date = (value: string | null) => value ? new Date(value).toLocaleString("es-CO", { timeZone: "America/Bogota", dateStyle: "medium", timeStyle: "short" }) : "Sin registro";
const secondaryButton = "inline-flex min-h-11 items-center justify-center gap-2 rounded-[10px] border border-sarin-line px-3 py-2 text-sm font-medium text-sarin-blue transition hover:bg-sarin-soft disabled:opacity-50";

export function AdminWhatsAppConversations({ businesses }: { businesses: { id: string; name: string }[] }) {
  const [data, setData] = useState<Conversations | null>(null);
  const [businessId, setBusinessId] = useState("");
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const mounted = useRef(false);
  const readController = useRef<AbortController | null>(null);
  const writeController = useRef<AbortController | null>(null);

  const refresh = useCallback(async (preserveError = false) => {
    readController.current?.abort();
    const controller = new AbortController();
    readController.current = controller;
    setLoading(true);
    if (!preserveError) { setError(null); setNotice(null); }
    try {
      const response = await apiFetch<Conversations>("/api/admin/whatsapp/conversations", { signal: controller.signal });
      if (mounted.current && !controller.signal.aborted) setData(response);
    } catch (cause) {
      if (mounted.current && !controller.signal.aborted) setError(errorMessage(cause));
    } finally {
      if (mounted.current && !controller.signal.aborted) setLoading(false);
    }
  }, []);
  useEffect(() => {
    mounted.current = true;
    void refresh();
    return () => { mounted.current = false; readController.current?.abort(); writeController.current?.abort(); };
  }, [refresh]);

  async function changeMode(conversation: AdminWhatsAppConversation, mode: WhatsAppConversationMode) {
    if (writeController.current || loading || conversation.mode === mode) return;
    const controller = new AbortController();
    writeController.current = controller;
    setWorking(conversation.id);
    setError(null);
    setNotice(null);
    try {
      const response = await apiFetch<{ conversation: AdminWhatsAppConversation }>("/api/admin/whatsapp/conversations", {
        method: "PATCH", signal: controller.signal,
        body: JSON.stringify({ conversationId: conversation.id, mode, expectedRevision: conversation.revision }),
      });
      if (!mounted.current || controller.signal.aborted) return;
      setData(previous => previous ? { ...previous, conversations: previous.conversations.map(item => item.id === response.conversation.id ? response.conversation : item) } : previous);
      setNotice(mode === "bot" ? "Conversación devuelta a Sarin. Responderá a mensajes nuevos; no retoma los pendientes anteriores." : mode === "human" ? "Conversación tomada. Sarin queda pausado para que atiendas desde WhatsApp Business." : "Conversación marcada para revisión. Sarin queda pausado.");
    } catch (cause) {
      if (!mounted.current || controller.signal.aborted) return;
      setError(errorMessage(cause));
      if (cause && typeof cause === "object" && "status" in cause && cause.status === 409) {
        setNotice("Otra intervención cambió esta conversación. Se consulta su estado actual antes de volver a intentarlo.");
        await refresh(true);
      }
    } finally {
      if (writeController.current === controller) {
        writeController.current = null;
        if (mounted.current && !controller.signal.aborted) setWorking(null);
      }
    }
  }

  const conversations = data?.conversations.filter(item => !businessId || item.businessId === businessId) ?? [];
  const names = new Map(businesses.map(business => [business.id, business.name || "Sin nombre configurado"]));
  const businessOptions = new Map(names);
  for (const conversation of data?.conversations ?? []) {
    if (!businessOptions.has(conversation.businessId)) businessOptions.set(conversation.businessId, `Negocio: ${conversation.businessId}`);
  }
  const busy = loading || working !== null;

  return <section aria-labelledby="admin-conversations-title" className="min-w-0 space-y-5 rounded-2xl border border-sarin-line bg-sarin-paper p-4 sm:p-6">
    <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between"><div className="min-w-0"><h2 id="admin-conversations-title" className="text-xl font-semibold">Conversaciones de WhatsApp</h2><p className="mt-1 max-w-3xl text-sm leading-6 text-sarin-muted">Toma una conversación para atenderla tú, déjala en revisión o devuelve la atención a Sarin.</p></div><button type="button" onClick={() => void refresh()} disabled={busy} className={secondaryButton + " shrink-0 self-start"}><RefreshCw aria-hidden="true" className="h-4 w-4" />{loading ? "Consultando conversaciones…" : "Actualizar conversaciones"}</button></div>
    <label className="block max-w-sm text-sm font-medium">Conversaciones del negocio<select className={fieldClass + " mt-2"} value={businessId} disabled={busy} onChange={event => setBusinessId(event.target.value)}><option value="">Todos los negocios</option>{[...businessOptions].map(([id, name]) => <option value={id} key={id}>{name}</option>)}</select></label>
    {error && <Notice error>{error}{data ? " Se conserva el último estado confirmado hasta actualizarlo." : ""}</Notice>}
    {notice && <Notice>{notice}</Notice>}
    {loading && !data && <p role="status" className="text-sm text-sarin-muted">Consultando conversaciones disponibles…</p>}
    {data?.truncated && <Notice>Se muestra una lista parcial por el límite de lectura. Puede haber más conversaciones fuera de esta vista.</Notice>}
    {data && conversations.length === 0 && <div className="rounded-xl bg-sarin-canvas p-4"><p className="text-sm font-medium">{businessId ? "Sin conversaciones para este negocio en la lectura actual." : "Todavía no hay conversaciones disponibles."}</p><p className="mt-2 text-sm leading-6 text-sarin-muted">La bandeja muestra conversaciones con actividad compatible registrada. Las anteriores aparecen al recibir actividad nueva; una lista vacía no confirma que WhatsApp esté conectado.</p></div>}
    {conversations.length > 0 && <ul className="space-y-4">{conversations.map(conversation => <li key={conversation.id}><article aria-label={`Conversación con ${conversation.customerName || conversation.customerPhone || "contacto no disponible"}`} className="min-w-0 space-y-4 rounded-xl border border-sarin-line p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div className="min-w-0"><p className="break-words text-xs font-medium text-sarin-muted">{names.get(conversation.businessId) || `Negocio: ${conversation.businessId}`}</p><h3 className="mt-1 break-words font-semibold">{conversation.customerName || conversation.customerPhone || "Contacto no disponible"}</h3>{conversation.customerName && conversation.customerPhone && <p className="mt-1 break-all text-sm text-sarin-muted">{conversation.customerPhone}</p>}</div><span className={`self-start rounded-full px-3 py-1.5 text-xs font-semibold ${conversation.mode === "review" ? "bg-amber-50 text-amber-900" : conversation.mode === "human" ? "bg-sarin-canvas text-sarin-ink" : "bg-sarin-soft text-sarin-blue"}`}>{labels[conversation.mode]}</span></div>
      {conversation.contentAvailable ? <p className="whitespace-pre-wrap break-words rounded-xl bg-sarin-canvas px-3 py-2.5 text-sm leading-6">{conversation.lastMessage || "Sin texto disponible en el último mensaje."}</p> : <p className="text-sm leading-6 text-sarin-muted">Contenido no disponible. El texto y los datos de contacto pueden haber vencido por la política de conservación.</p>}
      <div className="space-y-1 text-xs leading-5 text-sarin-muted"><p>Último mensaje recibido: {date(conversation.lastInboundAt)} · Colombia</p>{conversation.lastHumanAt && <p>Última intervención humana: {date(conversation.lastHumanAt)} · Colombia</p>}</div>
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        {conversation.mode !== "human" && <button type="button" disabled={busy} onClick={() => void changeMode(conversation, "human")} className={buttonClass}>{working === conversation.id ? "Guardando…" : "Tomar conversación"}</button>}
        {conversation.mode !== "bot" && <button type="button" disabled={busy} onClick={() => void changeMode(conversation, "bot")} className={secondaryButton}>{working === conversation.id ? "Guardando…" : "Devolver a Sarin"}</button>}
        {conversation.mode !== "review" && <button type="button" disabled={busy} onClick={() => void changeMode(conversation, "review")} className={secondaryButton}>{working === conversation.id ? "Guardando…" : "Marcar para revisión"}</button>}
      </div>
    </article></li>)}</ul>}
    <p className="border-t border-sarin-line pt-4 text-xs leading-6 text-sarin-muted">Atiende los mensajes desde WhatsApp Business con coexistencia habilitada. Al devolver una conversación, Sarin responde a mensajes nuevos. Una respuesta ya aceptada por WhatsApp no se puede retirar.</p>
  </section>;
}
