"use client";

import { useEffect, useRef, useState } from 'react';
import { Notice, buttonClass, fieldClass } from '@/components/app-shell';
import { apiFetch, errorMessage } from '@/lib/client/api';
import { useApiPoll } from '@/lib/client/use-api-poll';
import { PlatformWhatsAppContentCache } from '@/lib/client/platform-whatsapp-content-cache';
import type { PlatformWhatsAppConnectionAction, PlatformWhatsAppConversationControlResponse, PlatformWhatsAppConversationList, PlatformWhatsAppStatus } from '@/types/platform-whatsapp';

interface Snapshot { status: PlatformWhatsAppStatus; inbox: PlatformWhatsAppConversationList }
const endpoint = '/api/admin/platform-whatsapp';
const secondaryButtonClass = 'inline-flex min-h-11 items-center justify-center rounded-[10px] border border-sarin-line px-3 py-2 text-sm font-medium text-sarin-blue transition hover:bg-sarin-soft focus-visible:outline focus-visible:outline-2 focus-visible:outline-sarin-blue disabled:opacity-50';
const date = (value: string | null) => value ? new Date(value).toLocaleString('es-CO', { timeZone: 'America/Bogota', dateStyle: 'medium', timeStyle: 'short' }) : 'Sin registro';
const titles = {
  not_configured: 'Sin configurar', configured_unverified: 'Sin verificar', receiving_human: 'Recepción para atención humana',
  automation_blocked: 'Recepción no disponible', paused: 'Recepción pausada', disconnected: 'Desconexión registrada',
};
const accessLost = (error: unknown) => !!error && typeof error === 'object' && 'status' in error && (error.status === 401 || error.status === 403);
const emptyForm = { wabaId: '', phoneE164: '', phoneNumberId: '' };
const fields = [['wabaId', 'ID de WABA'], ['phoneE164', 'Teléfono internacional'], ['phoneNumberId', 'ID del número']] as const;

export function AdminPlatformWhatsApp({ scope }: { scope: string | null }) {
  return scope ? <PlatformWorkspace key={scope} scope={scope} /> : <section aria-label="WhatsApp de SarinBot">
    <h2 className="text-xl font-semibold">WhatsApp de SarinBot</h2>
    <p>Inicia sesión con permisos de administración para consultar esta bandeja privada.</p>
  </section>;
}

function PlatformWorkspace({ scope }: { scope: string }) {
  const [authLost, setAuthLost] = useState(false);
  const authLatch = useRef(false);
  const mounted = useRef(true);
  const patch = useRef<AbortController | null>(null);
  const [pending, setPending] = useState(false);
  const conflict = useRef(false);
  const [conflictState, setConflictState] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [cache] = useState(() => new PlatformWhatsAppContentCache());
  const [, render] = useState(0);
  const expiryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function scheduleExpiry() {
    if (expiryTimer.current !== null) clearTimeout(expiryTimer.current);
    const delay = cache.nextDelay();
    expiryTimer.current = delay === null ? null : setTimeout(() => {
      cache.expire();
      if (mounted.current) render(value => value + 1);
      scheduleExpiry();
    }, delay);
  }

  function loseAccess() {
    authLatch.current = true;
    cache.clear();
    scheduleExpiry();
    patch.current?.abort();
    setAuthLost(true);
    setForm(emptyForm);
    setError(null);
    setNotice(null);
  }

  useEffect(() => {
    const page = typeof document === 'undefined' ? undefined : document;
    const browser = typeof window === 'undefined' ? undefined : window;
    const clearPreview = () => {
      cache.clear();
      scheduleExpiry();
      if (mounted.current) render(value => value + 1);
    };
    page?.addEventListener('visibilitychange', clearPreview);
    browser?.addEventListener('blur', clearPreview);
    browser?.addEventListener('focus', clearPreview);
    return () => {
      page?.removeEventListener('visibilitychange', clearPreview);
      browser?.removeEventListener('blur', clearPreview);
      browser?.removeEventListener('focus', clearPreview);
      cache.clear();
      if (expiryTimer.current !== null) clearTimeout(expiryTimer.current);
    };
  }, [cache]);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; patch.current?.abort(); };
  }, []);

  const poll = useApiPoll<Snapshot>(authLost ? null : scope, async signal => {
    const token = cache.begin();
    async function read<T>(resource: string): Promise<T> {
      try { return await apiFetch<T>(`${endpoint}/${resource}`, { signal }, scope); }
      catch (failure) {
        if (mounted.current && !signal.aborted && !authLatch.current && accessLost(failure)) loseAccess();
        throw failure;
      }
    }
    const [status, inbox] = await Promise.all([
      read<PlatformWhatsAppStatus>('status'),
      read<PlatformWhatsAppConversationList>('conversations').then(value => {
        if (authLatch.current || signal.aborted || !mounted.current) throw new Error('Lectura cancelada.');
        const sanitized = { ...value, conversations: value.conversations.map(conversation => cache.accept(conversation, token)) };
        scheduleExpiry();
        return sanitized;
      }),
    ]);
    if (authLatch.current || signal.aborted) throw new Error('Lectura cancelada.');
    conflict.current = false;
    setConflictState(false);
    return { status, inbox };
  });
  const snapshot = authLost ? null : poll.value;
  const status = snapshot?.status;
  const disabled = pending || authLost || conflictState;
  const matches = !!status?.scope && fields.every(([field]) => form[field] === status.scope![field]);

  async function mutate(resource: 'status' | 'conversations', body: Record<string, unknown>) {
    if (patch.current || authLatch.current || conflict.current || !mounted.current || !snapshot) return;
    const controller = new AbortController();
    const token = cache.begin();
    patch.current = controller;
    poll.setValue(value => value);
    setPending(true);
    setError(null);
    setNotice(null);
    try {
      const response = await apiFetch<PlatformWhatsAppStatus | PlatformWhatsAppConversationControlResponse>(`${endpoint}/${resource}`, {
        method: 'PATCH', signal: controller.signal, body: JSON.stringify({ ...body, requestId: crypto.randomUUID() }),
      }, scope);
      if (!mounted.current || authLatch.current || controller.signal.aborted) return;
      const confirmed = 'conversation' in response ? { conversation: cache.accept(response.conversation, token) } : response;
      scheduleExpiry();
      poll.setValue(value => value ? 'conversation' in confirmed
        ? { ...value, inbox: { ...value.inbox, conversations: value.inbox.conversations.map(conversation => conversation.id === confirmed.conversation.id ? confirmed.conversation : conversation) } }
        : { ...value, status: confirmed } : value);
      setNotice('Cambio guardado. Se muestra el estado confirmado.');
    } catch (failure) {
      if (!mounted.current || authLatch.current || controller.signal.aborted) return;
      if (accessLost(failure)) { poll.setValue(null); loseAccess(); return; }
      setError(errorMessage(failure));
      if (failure && typeof failure === 'object' && 'status' in failure && failure.status === 409) {
        conflict.current = true;
        setConflictState(true);
        setNotice('Otra sesión cambió el estado. Se consulta la revisión actual antes de volver a intentar.');
        poll.refresh();
      }
    } finally {
      if (patch.current === controller) { patch.current = null; if (mounted.current) setPending(false); }
    }
  }

  const connection = (action: PlatformWhatsAppConnectionAction) => { if (status) void mutate('status', { action, expectedRevision: status.connectionRevision }); };

  return <section aria-labelledby="platform-whatsapp-title" className="min-w-0 space-y-5 rounded-2xl border border-sarin-line bg-sarin-paper p-4 sm:p-6">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0"><h2 id="platform-whatsapp-title" className="text-xl font-semibold">WhatsApp de SarinBot</h2><p className="mt-1 text-sm leading-6 text-sarin-muted">Consultas dirigidas a SarinBot. El titular responde desde WhatsApp Business App. Esta bandeja solo permite atención humana y revisión.</p></div>
      <button type="button" className={`${secondaryButtonClass} shrink-0`} disabled={pending || authLost} onClick={() => { setError(null); setNotice(null); poll.refresh(); }}>Actualizar bandeja de SarinBot</button>
    </div>
    <p className="text-xs leading-6 text-sarin-muted">Actualización cada 15 segundos mientras esta página está visible, al recuperar el foco o al pulsar Actualizar. Fechas de Colombia.</p>
    {authLost && <Notice error>La sesión o sus permisos dejaron de ser válidos. Se borró la información privada de esta vista. Vuelve a iniciar sesión para consultar.</Notice>}
    {!authLost && (error || poll.error) && <Notice error>{error || poll.error}{snapshot ? ' Se conserva el último estado confirmado; actualiza para comprobar cambios.' : ''}</Notice>}
    {!authLost && notice && <Notice>{notice}</Notice>}
    {!authLost && poll.loading && !snapshot && <p role="status" className="text-sm text-sarin-muted">Consultando WhatsApp de SarinBot…</p>}
    {status && <div className="min-w-0 space-y-4 rounded-xl bg-sarin-canvas p-4">
      <h3 className="font-semibold">{titles[status.presentationState]}</h3>
      <p className="text-sm leading-6">IA deshabilitada · Envío deshabilitado. Una bandeja vacía no confirma la conexión.</p>
      <dl className="space-y-2 break-words text-sm leading-6">
        <div><dt className="font-medium">Última recepción firmada</dt><dd>{date(status.lastSignedInboundAt)} · Colombia</dd></div>
        <div><dt className="font-medium">Última respuesta del titular registrada</dt><dd>{date(status.lastHumanEchoAt)} · Colombia</dd></div>
        <div><dt className="font-medium">Verificación manual registrada</dt><dd>{date(status.connectedAt)} · Colombia</dd></div>
        <div><dt className="font-medium">Estado consultado</dt><dd>{date(status.observedAt)} · Colombia · Revisión {status.connectionRevision}</dd></div>
      </dl>
      {status.scope && <form className="min-w-0 space-y-3 border-t border-sarin-line pt-4" onSubmit={event => {
        event.preventDefault();
        if (matches && status.configured) void mutate('status', { action: 'record_connected', expectedRevision: status.connectionRevision, ...form });
      }}>
        <p className="text-sm leading-6">Para registrar la conexión, verifica manualmente los tres valores en el proveedor y escríbelos completos. Registrar esta evidencia no prueba recepción real ni coexistencia.</p>
        {fields.map(([field, label]) => <label key={field} className="block min-w-0 text-sm font-medium">
          {label}<span className="mt-1 block break-all text-xs text-sarin-muted">Configurado: {status.scope![field]}</span>
          <input className={`${fieldClass} mt-2 min-w-0 w-full`} value={form[field]} autoComplete="off" disabled={disabled} onChange={event => setForm(previous => ({ ...previous, [field]: event.target.value }))} />
        </label>)}
        <button type="submit" className={secondaryButtonClass} disabled={disabled || !matches || !status.configured}>Registrar conexión verificada</button>
      </form>}
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <button type="button" className={secondaryButtonClass} disabled={disabled || !status.scope || status.presentationState === 'paused' || status.providerConnection === 'disconnected'} onClick={() => connection('pause')}>Pausar recepción</button>
        <button type="button" className={secondaryButtonClass} disabled={disabled || !status.configured || status.providerConnection !== 'connected' || status.pausedReason === null} onClick={() => connection('resume')}>Reanudar recepción</button>
        <button type="button" className={secondaryButtonClass} disabled={disabled || !status.scope || status.providerConnection === 'disconnected'} onClick={() => connection('disconnect')}>Registrar desconexión</button>
      </div>
    </div>}
    {snapshot?.inbox.truncated && <Notice>Se muestra una lista parcial por el límite de lectura. Puede haber más consultas fuera de esta vista.</Notice>}
    {snapshot && snapshot.inbox.conversations.length === 0 && <p className="rounded-xl bg-sarin-canvas p-4 text-sm">Sin consultas de SarinBot en esta lectura. Esto no confirma que WhatsApp esté conectado.</p>}
    {!!snapshot?.inbox.conversations.length && <ul className="space-y-4">{snapshot.inbox.conversations.map(value => cache.view(value)).map(conversation => <li key={conversation.id}>
      <article aria-label="Consulta de SarinBot" className="min-w-0 space-y-3 rounded-xl border border-sarin-line p-4">
        <h3 className="break-all font-semibold">{conversation.contentAvailable ? conversation.customerPhone || 'Contacto no disponible' : 'Contacto vencido'}</h3>
        <p className="text-sm font-medium">{conversation.mode === 'human' ? 'Atención humana' : 'Necesita revisión'} · Revisión {conversation.revision}</p>
        {conversation.contentAvailable ? <p className="whitespace-pre-wrap break-words rounded-xl bg-sarin-canvas p-3 text-sm leading-6">{conversation.lastMessage || 'Sin texto disponible.'}</p>
          : <p className="text-sm text-sarin-muted">Contenido vencido o no disponible. El texto y el contacto se conservan como máximo 24 horas.</p>}
        <p className="text-xs leading-6 text-sarin-muted">Último mensaje recibido: {date(conversation.lastInboundAt)} · Colombia<br />Última respuesta del titular: {date(conversation.lastHumanAt)} · Colombia</p>
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          {conversation.mode !== 'human' && <button type="button" className={buttonClass} disabled={disabled} onClick={() => void mutate('conversations', { conversationId: conversation.id, mode: 'human', expectedRevision: conversation.revision })}>Tomar conversación</button>}
          {conversation.mode !== 'review' && <button type="button" className={secondaryButtonClass} disabled={disabled} onClick={() => void mutate('conversations', { conversationId: conversation.id, mode: 'review', expectedRevision: conversation.revision })}>Marcar para revisión</button>}
        </div>
      </article>
    </li>)}</ul>}
    {pending && !authLost && <p role="status" className="text-sm text-sarin-muted">Guardando cambio…</p>}
    <p className="border-t border-sarin-line pt-4 text-xs leading-6 text-sarin-muted">Las conversaciones de negocios y sus controles comerciales están en la sección siguiente. Aquí no se envían mensajes ni se activa un bot.</p>
  </section>;
}
