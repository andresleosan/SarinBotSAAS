"use client";

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useAuth } from '@/components/auth-provider';
import { ConsentPanel, useAccountConsent } from '@/components/consent-panel';
import { useConsent, type ConsentController } from '@/hooks/useConsent';
import { apiFetch, ApiError } from '@/lib/client/api';
import { useAdminTaskAutoFocus } from '@/components/admin-task-focus-boundary';
import { useApiPoll } from '@/lib/client/use-api-poll';
import { LEGAL_VERSION, PLATFORM_SUPPORT_LEGAL_VERSION } from '@/lib/legal';
import type { SupportConversationPage, SupportConversationView, SupportMessageView, SupportNotificationState, SupportPage, SupportRecipientView } from '@/types/platform-support';
import type { PlatformWhatsAppLinkStatus } from '@/types/platform-whatsapp-link';

const button = 'min-h-11 rounded-lg border border-sarin-line px-4 py-2 text-sm text-sarin-blue disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const integer = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0;
const mono = () => performance.now();
const cursorValid = (cursor: unknown) => cursor === null || typeof cursor === 'string' && cursor.length > 0 && cursor.length <= 2048;
const invalid = () => new Error('La lectura de soporte no es coherente. Actualiza para comprobarla de nuevo.');
const stateLabels: Record<SupportNotificationState, string> = { blocked: 'Bloqueado: no se cumplen las condiciones del aviso; no se reactivará automáticamente.', pending: 'Pendiente', accepted: 'Aceptado por el proveedor; entrega sin confirmar', delivered: 'Entregado', rejected: 'Rechazado', unknown: 'Resultado desconocido', cancelled: 'Cancelado' };
type TimedMessage = SupportMessageView & { deadline: number };
export type SupportMessages = { items: TimedMessage[]; cursor: string | null; revision: number; catchingUp: boolean; states: Record<string, SupportNotificationState> };
export const emptySupportMessages = (): SupportMessages => ({ items: [], cursor: null, revision: 0, catchingUp: false, states: {} });
/** Read-start deadlines and their minima prevent repeated pages or clock rollback renewing content. */
export function mergeSupportPage(previous: SupportMessages, page: SupportPage, readStart: number): SupportMessages {
  if (!page || !Array.isArray(page.messages) || page.messages.length > 100 || !integer(page.observedAt) || !integer(page.revision) || typeof page.hasMore !== 'boolean' || !cursorValid(page.cursor) || page.hasMore && !page.cursor || !Array.isArray(page.notificationStates)) throw invalid();
  const ids = new Map(previous.items.map(item => [item.id, item]));
  const sequences = new Map(previous.items.map(item => [item.sequence, item.id]));
  const pageIds = new Set<string>();
  for (const message of page.messages) {
    if (!message || typeof message.id !== 'string' || !message.id || pageIds.has(message.id) || !integer(message.sequence) || message.sequence < 1 || !integer(message.createdAt) || !integer(message.expiresAt) || message.expiresAt < message.createdAt || !['customer', 'admin'].includes(message.author) || !(message.text === null || typeof message.text === 'string')) throw invalid();
    pageIds.add(message.id);
    const old = ids.get(message.id), occupied = sequences.get(message.sequence);
    if (occupied && occupied !== message.id || old && (old.sequence !== message.sequence || old.author !== message.author || old.createdAt !== message.createdAt || old.expiresAt !== message.expiresAt || old.text !== null && message.text !== null && old.text !== message.text)) throw invalid();
    const deadline = Math.min(old?.deadline ?? Infinity, readStart + Math.max(0, message.expiresAt - page.observedAt));
    const text = old?.text === null || message.text === null || mono() >= deadline || Date.now() >= message.expiresAt ? null : message.text;
    ids.set(message.id, { ...message, text, deadline }); sequences.set(message.sequence, message.id);
  }
  const states = { ...previous.states };
  for (const entry of page.notificationStates) {
    if (!entry || !pageIds.has(entry.messageId) || !Object.hasOwn(stateLabels, entry.state)) throw invalid();
    states[entry.messageId] = entry.state;
  }
  return { items: [...ids.values()].sort((a, b) => a.sequence - b.sequence), states, cursor: page.cursor, revision: page.revision, catchingUp: page.hasMore };
}
export function expireSupportMessages(value: SupportMessages): SupportMessages {
  return { ...value, items: value.items.map(item => item.text !== null && (Date.now() >= item.expiresAt || mono() >= item.deadline) ? { ...item, text: null } : item) };
}
type TimedConversation = SupportConversationView & { deadline: number };
export type SupportList = { items: TimedConversation[]; cursor: string | null; catchingUp: boolean; deadlines?: Record<string, number> };
export function mergeSupportList(previous: SupportList, page: SupportConversationPage, readStart: number): SupportList {
  if (!page || !Array.isArray(page.conversations) || page.conversations.length > 100 || !integer(page.observedAt) || typeof page.hasMore !== 'boolean' || !cursorValid(page.cursor) || page.hasMore && !page.cursor) throw invalid();
  const deadlines = { ...previous.deadlines };
  for (const item of previous.items) deadlines[item.id] = Math.min(deadlines[item.id] ?? Infinity, item.deadline);
  const items = new Map(previous.items.filter(item => Date.now() < item.expiresAt && mono() < item.deadline).map(item => [item.id, item]));
  const seen = new Set<string>();
  for (const item of page.conversations) {
    if (!item || !uuid.test(item.id) || seen.has(item.id) || !integer(item.revision) || !integer(item.lastSequence) || !integer(item.createdAt) || !integer(item.expiresAt) || item.createdAt > item.expiresAt) throw invalid();
    seen.add(item.id);
    const old = items.get(item.id);
    if (old && (old.createdAt !== item.createdAt || old.expiresAt !== item.expiresAt)) throw invalid();
    const deadline = Math.min(deadlines[item.id] ?? Infinity, old?.deadline ?? Infinity, readStart + Math.max(0, item.expiresAt - page.observedAt)); deadlines[item.id] = deadline;
    if (Date.now() < item.expiresAt && mono() < deadline) items.set(item.id, { ...item, deadline });
  }
  return { deadlines, items: [...items.values()].sort((a, b) => a.id.localeCompare(b.id)), cursor: page.hasMore ? page.cursor : null, catchingUp: page.hasMore };
}
function permission(controller: ConsentController, uid: string, kind: 'account' | 'platform_support') {
  const status = controller.status, receipt = status?.receipt;
  const version = kind === 'account' ? LEGAL_VERSION : PLATFORM_SUPPORT_LEGAL_VERSION;
  if (!controller.active || controller.loading || controller.error || controller.withdrawalRequested || !status || !receipt || receipt.uid !== uid || receipt.scope !== kind || receipt.action !== 'accept' || !receipt.termsAccepted || !receipt.dataAuthorized || receipt.revision !== status.revision || receipt.documents.fingerprint !== status.documents.fingerprint || receipt.documents.version !== version || status.documents.version !== version) return null;
  return [status.revision, status.documents.fingerprint, receipt.requestId, receipt.occurredAt, receipt.documents.version];
}
type Context = { scope: string; uid: string; admin: boolean; current: () => boolean; capture: () => () => boolean; fail: () => void };
// Each effect setup owns a generation. A later setup cannot revive its promises.
function useLifetime() {
  const lifetime = useRef({ active: true, generation: 0 });
  useLayoutEffect(() => {
    const generation = ++lifetime.current.generation; lifetime.current.active = true;
    return () => { if (lifetime.current.generation === generation) lifetime.current.active = false; };
  }, []);
  return {
    current: () => lifetime.current.active,
    capture: () => { const generation = lifetime.current.generation; return () => lifetime.current.active && lifetime.current.generation === generation; },
  };
}
function captureContext(context: Context): Context {
  const current = context.capture(); return { ...context, current, capture: () => current };
}
function endpoint(admin: boolean) { return admin ? '/api/admin/platform-support' : '/api/platform-support'; }
function check(context: Context, signal?: AbortSignal) { if (!context.current() || signal?.aborted) throw new Error('Lectura obsoleta.'); }
async function read<T>(context: Context, path: string, signal: AbortSignal): Promise<T> {
  context = captureContext(context);
  const result = await apiFetch<T>(path, { signal }, context.uid, () => context.current() && !signal.aborted);
  check(context, signal); return result;
}
function useExpiry(action: () => void, deadlines: number[]) {
  const latest = useRef(action); latest.current = action;
  const delay = Math.min(1_000, ...deadlines.map(deadline => Math.max(0, deadline - mono())));
  useEffect(() => { const timer = setTimeout(() => latest.current(), delay); return () => clearTimeout(timer); });
}

export function PlatformSupportChat({ admin = false, initialThread = null }: { admin?: boolean; initialThread?: string | null }) {
  const lifetime = useLifetime();
  const auth = useAuth(), account = useAccountConsent(), support = useConsent(auth.user?.uid, 'platform_support');
  const [visibility, setVisibility] = useState({ active: typeof document === 'undefined' || document.visibilityState !== 'hidden', epoch: 0 });
  const visibilityRef = useRef(visibility); visibilityRef.current = visibility;
  const [failed, setFailed] = useState<string | null>(null);
  const uid = auth.user?.uid, accountKey = uid ? permission(account, uid, 'account') : null, supportKey = uid ? permission(support, uid, 'platform_support') : null;
  const scope = uid && !auth.loading && !auth.signingOut && (!admin || auth.isSuperadmin) && auth.isCurrentSession(uid, auth.authEpoch) && accountKey && supportKey ? JSON.stringify([uid, admin ? 'admin' : 'customer', auth.isSuperadmin, auth.authEpoch, accountKey, supportKey, visibility.epoch]) : null;
  const identity = useRef(scope); identity.current = scope;
  useEffect(() => {
    const reset = (active: boolean) => { const next = { active, epoch: visibilityRef.current.epoch + 1 }; visibilityRef.current = next; setVisibility(next); };
    const blur = () => reset(false), focus = () => reset(document.visibilityState !== 'hidden'), change = () => reset(document.visibilityState !== 'hidden');
    window.addEventListener('blur', blur); window.addEventListener('focus', focus); document.addEventListener('visibilitychange', change);
    return () => { window.removeEventListener('blur', blur); window.removeEventListener('focus', focus); document.removeEventListener('visibilitychange', change); };
  }, []);
  const active = scope && visibility.active && failed !== scope;
  const activeRef = useRef(Boolean(active)); activeRef.current = Boolean(active);
  const current = () => lifetime.current() && activeRef.current && identity.current === scope && visibilityRef.current.active && visibilityRef.current.epoch === visibility.epoch && auth.isCurrentSession(uid!, auth.authEpoch);
  const context: Context | null = active ? { scope, uid: uid!, admin, current, capture: () => { const owns = lifetime.capture(); return () => owns() && current(); }, fail: () => { if (current()) { identity.current = null; setFailed(scope); } } } : null;
  return <div className="min-w-0 space-y-4 break-words">
    <p className="text-sm leading-6">Conversaciones privadas con el equipo de SarinBot. El texto permanece disponible hasta 24 horas; los controles del hilo, hasta 30 días. El texto web no se envía automáticamente a IA. No adjuntes comprobantes ni datos sensibles aquí.</p>
    <ConsentPanel controller={account} title="Permisos de cuenta" />
    <ConsentPanel controller={support} title="Permisos de soporte de SarinBot" blockedReason={!account.active ? 'Revisa primero los permisos de cuenta.' : undefined} />
    {!scope && <p role="status">Para leer o escribir, necesitamos comprobar tu sesión y tus permisos actuales de cuenta y soporte.</p>}
    {!visibility.active && <p role="status">Contenido privado borrado al salir de esta ventana. Al volver se consulta de nuevo.</p>}
    {scope && failed === scope && <div><p role="alert">No se pudo comprobar el soporte. Se borró el contenido de esta vista.</p><button type="button" className={button} onClick={() => { setFailed(null); setVisibility(value => ({ ...value, epoch: value.epoch + 1 })); }}>Volver a comprobar soporte</button></div>}
    {context && <SupportWorkspace key={scope} context={context} initialThread={initialThread} />}
  </div>;
}

function SupportWorkspace({ context, initialThread }: { context: Context; initialThread: string | null }) {
  const [selected, setSelected] = useState<string | null>(initialThread && uuid.test(initialThread) ? initialThread : null);
  const selection = useRef(selected); selection.current = selected;
  const memory = useRef<SupportList>({ items: [], cursor: null, catchingUp: false });
  const sweepCursors = useRef(new Set<string>());
  const [clock, tick] = useState(0);
  const createId = useRef<string | null>(null), createAbort = useRef<AbortController | null>(null);
  const [creation, setCreation] = useState({ busy: false, uncertain: false, review: false, notice: '' });
  useEffect(() => { if (initialThread && uuid.test(initialThread)) setSelected(initialThread); }, [initialThread]);
  useEffect(() => () => { createAbort.current?.abort(); createId.current = null; memory.current = { items: [], cursor: null, catchingUp: false }; }, []);
  const base = endpoint(context.admin);
  const poll = useApiPoll(context.scope, async signal => {
    const captured = captureContext(context);
    let value = memory.current;
    const cursors = new Set(sweepCursors.current);
    try {
      for (let page = 0; page < 3; page++) {
        const cursor = value.cursor; if (cursor) { if (cursors.has(cursor)) throw invalid(); cursors.add(cursor); }
        const start = mono();
        const result = await read<SupportConversationPage>(captured, base + '/conversations' + (cursor ? '?cursor=' + encodeURIComponent(cursor) : ''), signal);
        check(captured, signal);
        if (result.hasMore && (!result.cursor || cursors.has(result.cursor))) throw invalid();
        value = mergeSupportList(value, result, start);
        if (!value.catchingUp) { cursors.clear(); break; }
      }
      check(captured, signal); memory.current = value; sweepCursors.current = cursors; return value;
    } catch (cause) { if (captured.current() && !signal.aborted) { memory.current = { items: [], cursor: null, catchingUp: false }; context.fail(); } throw cause; }
  }, { intervalMs: 5_000, abortOnBlur: true, waitForPending: true, clearOnError: true });
  const live = poll.value?.items.filter(item => Date.now() < item.expiresAt && mono() < item.deadline) ?? [];
  useExpiry(() => {
    const retained = memory.current.items.filter(item => Date.now() < item.expiresAt && mono() < item.deadline);
    if (retained.length !== memory.current.items.length) {
      memory.current = { ...memory.current, items: retained };
      poll.setValue(previous => previous && { ...previous, items: previous.items.filter(item => Date.now() < item.expiresAt && mono() < item.deadline) }, { invalidate: false });
    }
    tick(clock + 1);
  }, live.map(item => item.deadline));
  async function createConversation() {
    if (!context.current() || context.admin || createAbort.current || creation.review) return;
    const abort = createAbort.current = new AbortController();
    const captured = captureContext(context);
    const requestId = createId.current ??= crypto.randomUUID();
    setCreation({ busy: true, uncertain: false, review: false, notice: '' });
    try {
      const value = await apiFetch<{ id: string; revision: number }>(base + '/conversations', { method: 'POST', signal: abort.signal, body: JSON.stringify({ requestId }) }, context.uid, () => captured.current() && !abort.signal.aborted);
      check(captured, abort.signal);
      if (!uuid.test(value?.id) || !integer(value.revision)) throw invalid();
      createId.current = null; setSelected(value.id); setCreation({ busy: false, uncertain: false, review: false, notice: 'Conversación creada en la web.' }); poll.refresh();
    } catch (cause) {
      if (!captured.current() || abort.signal.aborted) return;
      if (cause instanceof ApiError && [401, 403, 428].includes(cause.status)) { context.fail(); return; }
      const conflict = cause instanceof ApiError && cause.status === 409;
      if (conflict) createId.current = null;
      setCreation({ busy: false, uncertain: !conflict, review: conflict, notice: conflict ? 'La solicitud cambió. Consulta la lista antes de crear otra conversación.' : 'No sabemos si se creó. Reintenta explícitamente la misma solicitud para comprobarlo.' });
      memory.current = { items: [], cursor: null, catchingUp: false }; poll.setValue(null); setSelected(null);
    } finally { if (createAbort.current === abort) createAbort.current = null; }
  }
  if (!context.current()) return null;
  return <div className="min-w-0 space-y-5">
    {context.admin && <SupportRecipient context={context} />}
    <div className="flex flex-wrap gap-3"><button type="button" className={button} onClick={() => { memory.current.cursor = null; sweepCursors.current.clear(); poll.refresh(); }}>Actualizar lista desde el inicio</button>{!context.admin && <button type="button" className={button} disabled={creation.busy || creation.review} onClick={() => void createConversation()}>{creation.uncertain ? 'Reintentar la misma creación' : 'Crear conversación'}</button>}</div>
    {creation.review && <button type="button" className={button} disabled={!poll.value || poll.value.catchingUp} onClick={() => { if (poll.value && !poll.value.catchingUp) setCreation(value => ({ ...value, review: false, notice: 'Lista actual revisada. Crear otra conversación requiere una nueva acción.' })); }}>He revisado la lista actual</button>}
    {creation.notice && <p role="status">{creation.notice}</p>}
    {poll.loading && <p role="status">Consultando conversaciones…</p>}
    <p className="text-sm text-sarin-muted">{poll.value?.catchingUp ? 'Poniendo la lista al día; cobertura parcial, continuaremos en cinco segundos.' : 'Hilos consultados en la última lectura. El recorrido vuelve a empezar al terminar.'} Orden por identificador; no indica mensajes sin leer ni actividad reciente.</p>
    {poll.value && !live.length && <p>No hay conversaciones vigentes en esta lectura.</p>}
    <ul aria-label="Conversaciones de soporte" className="space-y-2">{live.map(item => <li key={item.id}><button type="button" aria-pressed={selected === item.id} className={`${button} w-full break-all text-left`} onClick={() => { if (Date.now() < item.expiresAt && mono() < item.deadline) setSelected(item.id); }}>Conversación {item.id} · {new Date(item.createdAt).toLocaleDateString('es-CO')}</button></li>)}</ul>
    {selected && <SupportThread key={context.scope + selected} context={{ ...context, current: () => context.current() && selection.current === selected, capture: () => { const current = context.capture(); return () => current() && selection.current === selected; } }} thread={selected} />}
  </div>;
}

function SupportThread({ context, thread }: { context: Context; thread: string }) {
  const canAutoFocus = useAdminTaskAutoFocus();
  const lifetime = useLifetime();
  const memory = useRef(emptySupportMessages());
  const sweepCursors = useRef(new Set<string>());
  const refreshSweep = useRef({ cursor: null as string | null, cursors: new Set<string>(), partial: false });
  const [draft, setDraft] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false);
  const [unseen, setUnseen] = useState(0), [clock, tick] = useState(0), [review, setReview] = useState(false);
  const textarea = useRef<HTMLTextAreaElement | null>(null), end = useRef<HTMLDivElement | null>(null);
  const operation = useRef<{ requestId: string; expectedRevision: number; digest: string } | null>(null);
  const abortWrite = useRef<AbortController | null>(null), generation = useRef(0);
  const focusAfterCommit = useRef<(() => boolean) | null>(null);
  const requestCurrent = () => lifetime.current() && context.current();
  const captureCurrent = () => { const own = lifetime.capture(), parent = context.capture(); return () => own() && parent(); };
  const path = endpoint(context.admin) + '/conversations/' + thread + '/messages';
  useEffect(() => () => { generation.current++; abortWrite.current?.abort(); abortWrite.current = null; operation.current = null; focusAfterCommit.current = null; memory.current = emptySupportMessages(); sweepCursors.current.clear(); refreshSweep.current = { cursor: null, cursors: new Set(), partial: false }; }, []);
  const poll = useApiPoll(context.scope + thread, async signal => {
    let value = expireSupportMessages(memory.current);
    const cursors = new Set(sweepCursors.current), version = generation.current, owns = captureCurrent();
    const refresh = { ...refreshSweep.current, cursors: new Set(refreshSweep.current.cursors) };
    const valid = () => owns() && !signal.aborted && generation.current === version;
    try {
      const before = value.items.length;
      // Reserve one page for new messages and two for a finite reread of existing facts.
      {
        const cursor = value.cursor; if (cursor) { if (cursors.has(cursor)) throw invalid(); cursors.add(cursor); }
        const start = mono();
        const result = await apiFetch<SupportPage>(path + (cursor ? '?cursor=' + encodeURIComponent(cursor) : ''), { signal }, context.uid, valid);
        if (!valid()) throw invalid();
        if (result.hasMore && (!result.cursor || cursors.has(result.cursor))) throw invalid();
        value = mergeSupportPage(value, result, start);
        if (!value.catchingUp) cursors.clear();
      }
      for (let page = 0; value.items.length && page < 2; page++) {
        const cursor = refresh.cursor;
        if (cursor) { if (refresh.cursors.has(cursor)) throw invalid(); refresh.cursors.add(cursor); }
        const start = mono();
        const result = await apiFetch<SupportPage>(path + (cursor ? '?cursor=' + encodeURIComponent(cursor) : ''), { signal }, context.uid, valid);
        if (!valid()) throw invalid();
        if (result.hasMore && (!result.cursor || refresh.cursors.has(result.cursor))) throw invalid();
        const incremental = { cursor: value.cursor, catchingUp: value.catchingUp, revision: value.revision };
        value = mergeSupportPage(value, result, start);
        value = { ...value, ...incremental, revision: Math.max(incremental.revision, result.revision) };
        refresh.cursor = result.hasMore ? result.cursor : null; refresh.partial = result.hasMore;
        if (!result.hasMore) { refresh.cursors.clear(); break; }
      }
      if (!valid()) throw invalid();
      value = expireSupportMessages(value);
      memory.current = value; sweepCursors.current = cursors; refreshSweep.current = refresh;
      setUnseen(count => count + Math.max(0, value.items.length - before));
      return value;
    } catch (cause) { if (valid()) { memory.current = emptySupportMessages(); operation.current = null; setDraft(''); setNotice(''); context.fail(); } throw cause; }
  }, { intervalMs: 5_000, abortOnBlur: true, waitForPending: true, clearOnError: true });
  const value = expireSupportMessages(poll.value ?? emptySupportMessages());
  useEffect(() => {
    if (busy || review || !focusAfterCommit.current) return;
    const current = focusAfterCommit.current; focusAfterCommit.current = null;
    if (current() && canAutoFocus()) textarea.current?.focus();
  }, [busy, review, notice, canAutoFocus]);
  useExpiry(() => { const expired = expireSupportMessages(memory.current); if (expired.items.some((item, index) => item.text !== memory.current.items[index]?.text)) { memory.current = expired; poll.setValue(current => current && expireSupportMessages(current), { invalidate: false }); } tick(clock + 1); }, value.items.filter(item => item.text !== null).map(item => item.deadline));
  async function send() {
    if (!requestCurrent() || abortWrite.current || busy || review || !poll.value || !draft.trim() || [...draft].length > 4096 || value.catchingUp) return;
    const abort = abortWrite.current = new AbortController(), version = ++generation.current, owns = captureCurrent();
    const current = () => owns() && !abort.signal.aborted && generation.current === version;
    const text = draft;
    setBusy(true); setNotice('');
    poll.setValue(previous => previous);
    try {
      const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
      if (!current()) return;
      const digest = Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
      if (operation.current && operation.current.digest !== digest) { setNotice('Para resolver el resultado incierto, vuelve a escribir exactamente el mismo mensaje. No se envió otra solicitud.'); return; }
      const op = operation.current ??= { requestId: crypto.randomUUID(), expectedRevision: memory.current.revision, digest };
      const result = await apiFetch<{ id: string; sequence: number; revision: number }>(path, { method: 'POST', signal: abort.signal, body: JSON.stringify({ requestId: op.requestId, expectedRevision: op.expectedRevision, text }) }, context.uid, current);
      if (!current()) return;
      if (!result || typeof result.id !== 'string' || !integer(result.sequence) || !integer(result.revision)) throw invalid();
      operation.current = null; setDraft(''); setNotice('Mensaje confirmado en la web. El aviso de WhatsApp se consulta por separado.'); focusAfterCommit.current = current; poll.refresh();
    } catch (cause) {
      if (!current()) return;
      memory.current = emptySupportMessages(); sweepCursors.current.clear(); refreshSweep.current = { cursor: null, cursors: new Set(), partial: false }; focusAfterCommit.current = null; poll.setValue(null); setDraft(''); setUnseen(0);
      if (cause instanceof ApiError && [401, 403, 428].includes(cause.status)) { operation.current = null; context.fail(); return; }
      if (cause instanceof ApiError && cause.status === 409) { operation.current = null; setReview(true); setNotice('La conversación cambió. Actualiza y revisa la nueva lectura antes de escribir y enviar una nueva operación.'); }
      else { setNotice('Resultado incierto. Se borró el texto de esta vista. Consulta la conversación y, si necesitas reintentar, vuelve a escribir exactamente el mismo mensaje; se conservará su identificador de solicitud.'); }
      poll.refresh();
    } finally { if (abortWrite.current === abort) abortWrite.current = null; if (current()) setBusy(false); }
  }
  if (!requestCurrent()) return null;
  return <section aria-label="Conversación privada seleccionada" className="min-w-0 space-y-3 border-t border-sarin-line pt-4">
    <h3 className="break-all font-semibold">Conversación {thread}</h3>
    {poll.loading && <p role="status">Consultando mensajes…</p>}
    {value.catchingUp && <p role="status">Poniendo los mensajes al día. Se leen hasta 300 por ciclo de cinco segundos.</p>}
    {refreshSweep.current.partial && <p role="status">Actualizando los avisos de mensajes anteriores; el recorrido continúa en cinco segundos.</p>}
    {poll.value && !value.items.length && <p>Esta conversación todavía no tiene mensajes en la lectura actual.</p>}
    <p aria-live="polite" aria-atomic="true" className="text-sm">{unseen > 0 ? `${unseen} mensajes nuevos consultados.` : ''}</p>
    {unseen > 0 && <button type="button" className={button} onClick={() => { end.current?.focus(); end.current?.scrollIntoView({ block: 'nearest' }); setUnseen(0); }}>Ir a los mensajes nuevos</button>}
    <ol aria-label="Mensajes consultados" className="space-y-3">{value.items.map(item => <li key={item.id} className="min-w-0 rounded-lg border border-sarin-line p-3"><p className="text-xs text-sarin-muted">{item.author === 'admin' ? 'Equipo SarinBot' : 'Cliente'} · mensaje {item.sequence} · confirmado en la web</p><p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{item.text ?? 'Texto vencido o no disponible.'}</p>{value.states[item.id] && <p className="mt-2 text-xs">Aviso de WhatsApp: {stateLabels[value.states[item.id]]}</p>}</li>)}</ol>
    <div tabIndex={-1} ref={end} aria-label="Fin de los mensajes consultados" />
    <label htmlFor="support-message" className="block font-medium">Mensaje privado</label>
    <textarea ref={textarea} id="support-message" rows={4} value={draft} autoComplete="off" aria-describedby="support-message-hint support-message-notice" disabled={busy || review} onChange={event => setDraft(event.target.value)} className="w-full min-w-0 rounded-lg border border-sarin-line p-3" />
    <p id="support-message-hint" className="text-xs">Máximo 4096 caracteres. Enter añade una línea; solo el botón Enviar envía el mensaje.</p>
    <p id="support-message-notice" role="status" className="text-sm">{notice}</p>
    {review && <button type="button" className={button} disabled={!poll.value || value.catchingUp} onClick={() => { if (requestCurrent() && poll.value && !value.catchingUp) { setReview(false); setNotice('Lectura actual revisada. Escribe de nuevo y pulsa Enviar para una nueva operación.'); } }}>He revisado la lectura actual</button>}
    <button type="button" className={button} disabled={busy || review || !poll.value || value.catchingUp || !draft.trim() || [...draft].length > 4096} onClick={() => void send()}>{busy ? 'Enviando…' : operation.current ? 'Reintentar el mismo mensaje' : 'Enviar mensaje'}</button>
  </section>;
}

function SupportRecipient({ context }: { context: Context }) {
  const lifetime = useLifetime();
  const [selected, setSelected] = useState(false), [busy, setBusy] = useState(false), [notice, setNotice] = useState('');
  const abort = useRef<AbortController | null>(null);
  const operation = useRef<{ linkId: string; expectedRevision: number; requestId: string } | null>(null);
  const current = () => lifetime.current() && context.current();
  const captureCurrent = () => { const own = lifetime.capture(), parent = context.capture(); return () => own() && parent(); };
  useEffect(() => () => { abort.current?.abort(); abort.current = null; operation.current = null; }, []);
  const poll = useApiPoll(context.scope + ':recipient', async signal => {
    const own = captureCurrent(), captured = { ...context, current: own, capture: () => own };
    try {
      const config = await read<SupportRecipientView>(captured, '/api/admin/platform-support/notifications', signal);
      if (typeof config?.configured !== 'boolean' || !integer(config.revision) || !(config.expiresAt === null || integer(config.expiresAt))) throw invalid();
      const link = await read<PlatformWhatsAppLinkStatus>(captured, '/api/platform-whatsapp/link', signal);
      if (!link || !(link.current === null || uuid.test(link.current.linkId) && integer(link.current.revision) && integer(link.current.expiresAt) && /^••••[0-9]{4}$/.test(link.current.maskedPhone))) throw invalid();
      return { config, link: link.current };
    } catch (cause) { if (own() && !signal.aborted) context.fail(); throw cause; }
  }, { intervalMs: 5_000, abortOnBlur: true, waitForPending: true, clearOnError: true });
  const data = poll.value, link = data?.link && Date.now() < data.link.expiresAt ? data.link : null;
  const linkKey = link ? JSON.stringify([link.linkId, link.revision, link.expiresAt]) : null;
  const latestLink = useRef(linkKey); latestLink.current = linkKey;
  useEffect(() => { setSelected(false); }, [linkKey]);
  const [clock, tick] = useState(0);
  useExpiry(() => tick(clock + 1), []);
  async function configure() {
    if (!current() || !selected || !link || !data || abort.current) return;
    if (operation.current && operation.current.linkId !== link.linkId) { operation.current = null; setNotice('La vinculación cambió. Revísala y vuelve a seleccionarla.'); setSelected(false); return; }
    const controller = abort.current = new AbortController(), captured = captureCurrent(), own = () => captured() && !controller.signal.aborted && latestLink.current === linkKey && Date.now() < link.expiresAt;
    const op = operation.current ??= { linkId: link.linkId, expectedRevision: data.config.revision, requestId: crypto.randomUUID() };
    setBusy(true);
    try {
      const result = await apiFetch<{ revision: number }>('/api/admin/platform-support/notifications', { method: 'PATCH', signal: controller.signal, body: JSON.stringify(op) }, context.uid, own);
      if (!own()) return;
      if (!integer(result?.revision)) throw invalid();
      operation.current = null; setSelected(false); setNotice('Destinatario guardado. Solo los nuevos mensajes podrán preparar un aviso si se cumplen las condiciones.'); poll.refresh();
    } catch (cause) {
      if (!own()) return;
      if (cause instanceof ApiError && [401, 403, 428].includes(cause.status)) { context.fail(); return; }
      if (cause instanceof ApiError && cause.status === 409) { operation.current = null; setSelected(false); poll.setValue(null); setNotice('La configuración cambió. Revisa la lectura actual y selecciona de nuevo antes de guardar.'); }
      else setNotice('Resultado incierto. Puedes reintentar explícitamente la misma selección.');
      poll.refresh();
    } finally { if (abort.current === controller) abort.current = null; if (captured() && !controller.signal.aborted) setBusy(false); }
  }
  if (!current()) return null;
  return <details className="space-y-3 rounded-lg border border-sarin-line p-3"><summary className="min-h-11 cursor-pointer">Avisos opcionales de WhatsApp al operador</summary>
    <p className="text-sm">{data?.config.configured && data.config.expiresAt !== null && Date.now() < data.config.expiresAt ? 'Hay un destinatario configurado y vigente.' : 'Sin destinatario vigente en esta lectura.'} Guardarlo no abre una ventana de WhatsApp ni activa el canal. Sin una ventana real y permisos vigentes, el aviso queda bloqueado; los avisos bloqueados no se reactivan.</p>
    {link ? <label className="flex min-h-11 items-center gap-3"><input type="checkbox" checked={selected} onChange={event => setSelected(event.target.checked)} />Usar mi vinculación actual {link.maskedPhone}</label> : <p>No hay una vinculación propia vigente. Revisa «Vincular mi WhatsApp con SarinBot».</p>}
    <button type="button" className={button} disabled={!link || !selected || busy || !data} onClick={() => void configure()}>{operation.current ? 'Reintentar la misma selección' : 'Guardar mi vinculación como destinatario'}</button><p role="status">{notice}</p>
  </details>;
}
