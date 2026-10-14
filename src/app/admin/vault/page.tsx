'use client';

import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import Link from 'next/link';
import { ArrowLeft, CalendarArrowDown, Download, FileText, HardDrive, LoaderCircle, LockKeyhole, MessageSquare, Paperclip, Plus, Send, ShieldCheck, Square, Trash2, Upload, X } from 'lucide-react';
import { AuthGate, useAuth } from '@/components/auth-provider';
import { apiFetch, errorMessage } from '@/lib/client/api';
import { VaultDatabase } from '@/lib/vault/localDb';
import { buildVaultRequest } from '@/lib/vault/conversation';
import { calculateFinancialTotals } from '@/lib/vault/finance';
import { imageDataUrlSchema } from '@/lib/vault/schema';
import { blobToDataUrl, compressReceiptToWebP } from '@/lib/utils/imageCompression';
import { downloadICSFile, generateICSFileContent } from '@/lib/utils/icsGenerator';
import type { VaultAttachment, VaultChatResponse, VaultReminder, VaultThread } from '@/types/vault';
import { VaultBackupDialog } from './vault-backup-dialog';
import { VaultMarkdown } from './vault-markdown';

const secondaryButton = 'inline-flex items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-xs font-medium text-slate-200 transition hover:border-slate-500 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40';
function money(amount: number, currency: string) {
  try { return new Intl.NumberFormat('es-CO', { style: 'currency', currency, maximumFractionDigits: 2 }).format(amount); }
  catch { return `${amount.toLocaleString('es-CO')} ${currency}`; }
}

export default function SarinVaultPage() {
  const { user } = useAuth();
  return <AuthGate admin><VaultWorkspace key={user?.uid} /></AuthGate>;
}

function VaultWorkspace() {
  const { user } = useAuth();
  const database = useRef<VaultDatabase | null>(null);
  const request = useRef<AbortController | null>(null);
  const inputFile = useRef<HTMLInputElement>(null);
  const conversationEnd = useRef<HTMLDivElement>(null);
  const [threads, setThreads] = useState<VaultThread[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [attachments, setAttachments] = useState<VaultAttachment[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [reload, setReload] = useState(0);
  const [sending, setSending] = useState(false);
  const [addingImages, setAddingImages] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [health, setHealth] = useState<'checking' | 'online' | 'offline'>('checking');
  const [transfer, setTransfer] = useState<'export' | 'import' | null>(null);
  const current = threads.find(thread => thread.id === selectedId) ?? null;
  const totals = useMemo(() => calculateFinancialTotals(current?.entries ?? []), [current?.entries]);
  const busy = sending || addingImages;

  useEffect(() => {
    if (!user) return;
    let active = true;
    const db = new VaultDatabase(user.uid);
    database.current = db;
    setLoaded(false); setError(null);
    void db.listThreads().then(saved => {
      if (active) { setThreads(saved); setSelectedId(saved[0]?.id ?? null); setLoaded(true); }
    }).catch(cause => { if (active) setError(errorMessage(cause)); });
    return () => { active = false; request.current?.abort(); if (database.current === db) database.current = null; db.close(); };
  }, [user, reload]);

  useEffect(() => {
    const controller = new AbortController();
    async function check() {
      if (!navigator.onLine) { setHealth('offline'); return; }
      try {
        const result = await apiFetch<{ online: boolean }>('/api/sarin/health', { signal: controller.signal });
        if (!controller.signal.aborted) setHealth(result.online ? 'online' : 'offline');
      } catch { if (!controller.signal.aborted) setHealth('offline'); }
    }
    void check();
    const timer = setInterval(() => void check(), 30_000);
    const offline = () => setHealth('offline');
    const online = () => void check();
    window.addEventListener('offline', offline); window.addEventListener('online', online);
    return () => { controller.abort(); clearInterval(timer); window.removeEventListener('offline', offline); window.removeEventListener('online', online); };
  }, []);

  useEffect(() => { conversationEnd.current?.scrollIntoView({ behavior: 'instant', block: 'nearest' }); }, [selectedId, current?.messages.length, sending]);

  async function persist(thread: VaultThread) {
    const db = database.current;
    if (!db) throw new Error('La bóveda aún no está disponible.');
    await db.saveThread(thread);
    if (database.current !== db) return;
    setThreads(previous => [thread, ...previous.filter(saved => saved.id !== thread.id)].sort((a, b) => b.updatedAt - a.updatedAt));
    setSelectedId(thread.id);
  }

  async function runTurn(thread: VaultThread) {
    const db = database.current;
    if (!db) return;
    setSending(true); setError(null); setNotice(null);
    const controller = new AbortController(); request.current = controller;
    try {
      const response = await apiFetch<VaultChatResponse>('/api/sarin/vault', { method: 'POST', signal: controller.signal, body: JSON.stringify(buildVaultRequest(thread.messages)) });
      if (controller.signal.aborted || database.current !== db) return;
      const updated: VaultThread = {
        ...thread, updatedAt: Date.now(),
        messages: [...thread.messages, { id: crypto.randomUUID(), role: 'assistant', content: response.message, createdAt: Date.now(), attachments: [] }],
        entries: [...thread.entries, ...response.analysis.entries.map(entry => ({ ...entry, id: crypto.randomUUID() }))],
        reminders: [...thread.reminders, ...response.analysis.reminders.map(reminder => ({ ...reminder, id: crypto.randomUUID() }))],
      };
      await persist(updated); setHealth('online');
    } catch (cause) {
      if (database.current === db) setError(controller.signal.aborted ? 'Consulta detenida. Tu mensaje quedó guardado; puedes reintentarlo.' : errorMessage(cause));
    } finally { if (request.current === controller) { request.current = null; setSending(false); } }
  }

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !loaded || (!draft.trim() && !attachments.length)) return;
    setSending(true); setError(null); setNotice(null);
    try {
      if ((current?.messages.length ?? 0) >= 998) throw new Error('Esta conversación está llena. Crea una nueva para continuar.');
      const now = Date.now();
      const thread: VaultThread = current ?? { id: crypto.randomUUID(), title: draft.trim().slice(0, 80) || attachments[0]?.name.slice(0, 80) || 'Nueva conversación', createdAt: now, updatedAt: now, messages: [], entries: [], reminders: [] };
      const updated: VaultThread = { ...thread, updatedAt: now, messages: [...thread.messages, { id: crypto.randomUUID(), role: 'user', content: draft.trim(), createdAt: now, attachments }] };
      await persist(updated);
      setDraft(''); setAttachments([]);
      await runTurn(updated);
    } catch (cause) { setError(errorMessage(cause)); setSending(false); }
  }

  async function attach(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    if (!files.length || busy) return;
    setAddingImages(true); setError(null);
    try {
      if (files.length + attachments.length > 4) throw new Error('Puedes adjuntar hasta cuatro imágenes por mensaje.');
      const prepared: VaultAttachment[] = [];
      for (const file of files) {
        const blob = await compressReceiptToWebP(file);
        const dataUrl = imageDataUrlSchema.parse(await blobToDataUrl(blob));
        prepared.push({ id: crypto.randomUUID(), name: file.name.slice(0, 180) || 'factura.webp', dataUrl });
      }
      setAttachments(previous => [...previous, ...prepared]);
    } catch (cause) { setError(errorMessage(cause)); }
    finally { setAddingImages(false); event.target.value = ''; }
  }

  async function deleteCurrent() {
    if (!current || !database.current || busy || !window.confirm(`¿Eliminar “${current.title}” y sus registros de este dispositivo?`)) return;
    try {
      await database.current.deleteThread(current.id);
      const remaining = threads.filter(thread => thread.id !== current.id);
      setThreads(remaining); setSelectedId(remaining[0]?.id ?? null); setDraft(''); setAttachments([]); setNotice('Conversación eliminada.'); setError(null);
    } catch (cause) { setError(errorMessage(cause)); }
  }

  async function clearVault() {
    if (!database.current || busy || !window.confirm('¿Borrar toda tu bóveda de este dispositivo? Se eliminarán las conversaciones, imágenes, cuentas y recordatorios locales. Conserva una copia antes de continuar.')) return;
    try { await database.current.clear(); setThreads([]); setSelectedId(null); setDraft(''); setAttachments([]); setError(null); setNotice('Bóveda borrada de este dispositivo.'); }
    catch (cause) { setError(errorMessage(cause)); }
  }

  function downloadReminder(reminder: VaultReminder) {
    try {
      downloadICSFile(generateICSFileContent({ businessName: 'Sarin Vault', serviceName: reminder.title, dateKey: reminder.date, startTimeStr: reminder.time, durationMinutes: 15, notes: reminder.notes }), `sarin-vencimiento-${reminder.date}.ics`);
      setNotice('Recordatorio descargado. Ábrelo para agregarlo a tu calendario (hora de Colombia).');
    } catch (cause) { setError(errorMessage(cause)); }
  }

  return <main className="min-h-screen bg-slate-950 text-slate-100">
    <div className="mx-auto max-w-[1600px] px-4 py-5 sm:px-6 lg:px-8">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 pb-5">
        <div className="flex items-center gap-3"><div className="grid h-11 w-11 place-items-center rounded-2xl border border-emerald-500/30 bg-emerald-500/10"><LockKeyhole className="h-5 w-5 text-emerald-300" /></div><div><h1 className="text-2xl font-semibold tracking-tight">Sarin Vault</h1><p className="mt-0.5 text-xs text-slate-400">Tu asistente personal. Tu dispositivo. Tu modelo local.</p></div></div>
        <div className="flex flex-wrap items-center gap-3"><span role="status" className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs ${health === 'online' ? 'border-emerald-800 text-emerald-300' : health === 'offline' ? 'border-amber-900 text-amber-200' : 'border-slate-700 text-slate-300'}`}><span aria-hidden className={`h-1.5 w-1.5 rounded-full ${health === 'online' ? 'bg-emerald-400' : health === 'offline' ? 'bg-amber-400' : 'bg-slate-400'}`} />{health === 'online' ? 'Modelo disponible' : health === 'offline' ? 'Modelo sin conexión' : 'Conectando…'}</span><Link href="/admin" className={secondaryButton}><ArrowLeft className="h-4 w-4" />Consola</Link></div>
      </header>

      <div className="grid items-start gap-5 lg:grid-cols-[245px_minmax(0,1fr)] 2xl:grid-cols-[245px_minmax(0,1fr)_300px]">
        <aside className="space-y-4">
          <button disabled={!loaded || busy} onClick={() => { setSelectedId(null); setDraft(''); setAttachments([]); setError(null); setNotice(null); }} className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 px-4 py-3 text-sm font-semibold text-slate-950 transition hover:bg-emerald-400 disabled:opacity-40"><Plus className="h-4 w-4" />Nueva conversación</button>
          <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-3"><p className="px-2 py-1 text-xs font-semibold uppercase tracking-wider text-slate-400">Conversaciones <span className="ml-1 text-slate-500">{threads.length}</span></p>
            <nav aria-label="Conversaciones de la bóveda" className="mt-2 flex max-h-40 gap-2 overflow-auto lg:max-h-[46vh] lg:flex-col">
              {!loaded ? <p className="p-2 text-xs text-slate-400">Abriendo bóveda…</p> : !threads.length ? <p className="p-2 text-xs leading-relaxed text-slate-500">Tu primera conversación aparecerá aquí.</p> : threads.map(thread => <button key={thread.id} disabled={busy} onClick={() => { setSelectedId(thread.id); setDraft(''); setAttachments([]); setError(null); setNotice(null); }} aria-current={selectedId === thread.id ? 'page' : undefined} className={`flex min-w-[160px] items-start gap-2 rounded-xl p-2.5 text-left text-xs transition disabled:opacity-50 lg:min-w-0 ${selectedId === thread.id ? 'bg-emerald-950 text-emerald-200 ring-1 ring-emerald-800' : 'text-slate-300 hover:bg-slate-800'}`}><MessageSquare className="mt-0.5 h-3.5 w-3.5 shrink-0" /><span className="line-clamp-2 break-words">{thread.title}</span></button>)}
            </nav>
          </div>
          <div className="grid grid-cols-2 gap-2"><button disabled={!loaded || busy} onClick={() => setTransfer('export')} className={secondaryButton}><Download className="h-3.5 w-3.5" />Exportar</button><button disabled={!loaded || busy} onClick={() => setTransfer('import')} className={secondaryButton}><Upload className="h-3.5 w-3.5" />Importar</button></div>
          <div className="hidden rounded-2xl border border-slate-800 p-4 lg:block"><HardDrive className="mb-2 h-4 w-4 text-emerald-300" /><p className="text-xs leading-relaxed text-slate-400">Tus hilos, imágenes y cuentas se guardan en este navegador. Exporta una copia para conservarlos al cambiar de dispositivo o limpiar sus datos.</p></div>
          <button disabled={!loaded || busy || !threads.length} onClick={() => void clearVault()} className="flex items-center gap-2 px-2 text-xs text-slate-500 transition hover:text-rose-300 disabled:opacity-40"><Trash2 className="h-3.5 w-3.5" />Borrar bóveda del dispositivo</button>
        </aside>

        <section aria-label="Chat personal" className="min-w-0 overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/35">
          <div className="flex items-center justify-between gap-3 border-b border-slate-800 px-5 py-4"><div className="min-w-0"><h2 className="truncate text-sm font-semibold">{current?.title ?? 'Un espacio solo para ti'}</h2><p className="mt-1 flex items-center gap-1.5 text-[11px] text-slate-400"><ShieldCheck className="h-3 w-3 text-emerald-400" />Acceso exclusivo del administrador</p></div>{current && <button type="button" disabled={busy} onClick={() => void deleteCurrent()} aria-label="Eliminar conversación" title="Eliminar conversación" className="rounded-lg p-2 text-slate-500 transition hover:bg-rose-950 hover:text-rose-300 disabled:opacity-40"><Trash2 className="h-4 w-4" /></button>}</div>
          <div className="max-h-[60vh] min-h-[350px] space-y-6 overflow-y-auto p-4 sm:p-6" aria-busy={sending}>
            {!current?.messages.length && <div className="mx-auto flex min-h-[320px] max-w-lg flex-col justify-center"><p className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-emerald-400">Asistente personal privado</p><h2 className="text-2xl font-semibold leading-snug tracking-tight sm:text-3xl">Pon tus ideas y tus cuentas en orden.</h2><p className="mt-4 text-sm leading-7 text-slate-400">Pega un estado de cuenta, adjunta una factura o empieza con lo que necesitas resolver. Puedes revisar cobros, organizar gastos y descargar recordatorios de vencimiento.</p><div className="mt-5 flex flex-wrap gap-2">{['Revisar una factura', 'Organizar mis gastos', 'Planear mi presupuesto'].map(suggestion => <button disabled={!loaded} key={suggestion} onClick={() => setDraft(suggestion)} className="rounded-full border border-slate-700 px-3 py-1.5 text-xs text-slate-300 transition hover:border-emerald-700 hover:text-emerald-200">{suggestion}</button>)}</div></div>}
            {current?.messages.map(message => <article key={message.id} className={`min-w-0 ${message.role === 'user' ? 'ml-auto max-w-[95%] rounded-2xl rounded-tr-sm border border-slate-700 bg-slate-800/80 p-4 sm:max-w-[88%]' : 'max-w-full'}`}><p className={`mb-2 text-[11px] font-semibold uppercase tracking-wider ${message.role === 'user' ? 'text-slate-400' : 'text-emerald-400'}`}>{message.role === 'user' ? 'Tú' : 'Sarin'}</p>{message.attachments.length > 0 && <div className="mb-3 flex flex-wrap gap-2">{message.attachments.map(image => <img key={image.id} src={image.dataUrl} alt={image.name} width={120} height={120} className="h-28 w-28 rounded-xl border border-slate-700 bg-slate-950 object-contain" loading="lazy" />)}</div>}{message.role === 'assistant' ? <VaultMarkdown>{message.content}</VaultMarkdown> : <p className="whitespace-pre-wrap break-words text-sm leading-7 text-slate-100">{message.content}</p>}</article>)}
            {sending && <div role="status" className="flex items-center gap-2 text-sm text-emerald-300"><LoaderCircle className="h-4 w-4 animate-spin motion-reduce:animate-none" />Sarin está preparando tu respuesta…</div>}
            <div ref={conversationEnd} />
          </div>
          <div className="space-y-3 border-t border-slate-800 p-4">
            {error && <div role="alert" className="rounded-xl border border-rose-900/70 bg-rose-950/40 p-3 text-sm text-rose-200"><p>{error}</p>{!loaded ? <button onClick={() => setReload(value => value + 1)} className="mt-2 font-semibold underline underline-offset-4">Volver a abrir la bóveda</button> : !sending && current?.messages.at(-1)?.role === 'user' && <button onClick={() => void runTurn(current)} className="mt-2 font-semibold underline underline-offset-4">Reintentar consulta</button>}</div>}
            {notice && <p role="status" className="rounded-xl border border-emerald-900 bg-emerald-950/40 p-3 text-xs text-emerald-200">{notice}</p>}
            {health === 'offline' && <p className="text-xs leading-relaxed text-amber-200">Tu modelo no está disponible. Puedes consultar lo guardado y reintentar cuando vuelva la conexión.</p>}
            {attachments.length > 0 && <div className="flex flex-wrap gap-3">{attachments.map(image => <div key={image.id} className="relative"><img src={image.dataUrl} alt={image.name} width={76} height={76} className="h-[76px] w-[76px] rounded-xl border border-slate-600 bg-slate-950 object-contain" /><button type="button" disabled={busy} onClick={() => setAttachments(previous => previous.filter(item => item.id !== image.id))} aria-label={`Quitar ${image.name}`} className="absolute -right-2 -top-2 rounded-full border border-slate-600 bg-slate-800 p-1 text-white hover:bg-rose-950"><X className="h-3 w-3" /></button></div>)}</div>}
            <form onSubmit={event => void send(event)} className="rounded-2xl border border-slate-700 bg-slate-950/60 p-3 focus-within:border-emerald-700"><label htmlFor="vault-message" className="sr-only">Mensaje para Sarin Vault</label><textarea id="vault-message" value={draft} onChange={event => setDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} disabled={!loaded || busy} maxLength={16000} rows={3} placeholder="Escribe o pega tus cuentas aquí…" className="max-h-60 min-h-[80px] w-full resize-y bg-transparent text-sm leading-6 text-slate-100 outline-none placeholder:text-slate-500 disabled:opacity-60" /><div className="flex items-center justify-between gap-3"><div className="flex items-center gap-2"><input ref={inputFile} type="file" multiple accept="image/jpeg,image/png,image/webp" onChange={event => void attach(event)} disabled={!loaded || busy || attachments.length >= 4} className="sr-only" aria-label="Seleccionar imágenes de facturas" /><button type="button" disabled={!loaded || busy || attachments.length >= 4} onClick={() => inputFile.current?.click()} className="flex items-center gap-2 rounded-lg px-2 py-2 text-xs text-slate-300 transition hover:bg-slate-800 disabled:opacity-40">{addingImages ? <LoaderCircle className="h-4 w-4 animate-spin motion-reduce:animate-none" /> : <Paperclip className="h-4 w-4" />}<span className="hidden sm:inline">{addingImages ? 'Optimizando…' : 'Adjuntar factura'}</span></button><span className="text-[10px] text-slate-500">{attachments.length}/4 imágenes</span></div>{sending ? <button type="button" onClick={() => request.current?.abort()} className={secondaryButton}><Square className="h-3.5 w-3.5" />Detener</button> : <button type="submit" disabled={!loaded || busy || (!draft.trim() && !attachments.length)} className="inline-flex items-center gap-2 rounded-xl bg-emerald-500 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-emerald-400 disabled:opacity-30"><Send className="h-4 w-4" />Enviar</button>}</div></form>
            <p className="text-center text-[10px] leading-relaxed text-slate-500">El análisis viaja a tu modelo local mediante tu conexión privada. Comprueba los importes y las fechas extraídos antes de usarlos.</p>
          </div>
        </section>

        <aside className="min-w-0 space-y-4 lg:col-start-2 2xl:col-start-auto">
          <section className="rounded-2xl border border-slate-800 bg-slate-900/50 p-4"><div className="mb-4 flex items-center gap-2"><FileText className="h-4 w-4 text-emerald-300" /><h2 className="text-sm font-semibold">Cuentas de esta conversación</h2></div>{!totals.length ? <p className="text-xs leading-relaxed text-slate-400">Los movimientos que Sarin extraiga de tus facturas aparecerán aquí.</p> : <div className="space-y-4">{totals.map(total => <div key={total.currency} className="space-y-1.5 rounded-xl border border-slate-800 bg-slate-950/60 p-3"><p className="mb-2 text-xs font-semibold text-slate-400">{total.currency}</p><p className="flex justify-between gap-2 text-xs"><span className="text-slate-400">Ingresos</span><span className="font-mono text-emerald-300">{money(total.income, total.currency)}</span></p><p className="flex justify-between gap-2 text-xs"><span className="text-slate-400">Gastos</span><span className="font-mono text-slate-200">{money(total.expense, total.currency)}</span></p><p className="flex justify-between gap-2 border-t border-slate-800 pt-2 text-xs"><span className="text-slate-300">Balance</span><span className={`font-mono ${total.balance < 0 ? 'text-amber-200' : 'text-emerald-300'}`}>{money(total.balance, total.currency)}</span></p></div>)}</div>}
            {Boolean(current?.entries.length) && <div className="mt-4 max-h-72 overflow-auto"><table className="w-full text-left text-[11px]"><thead className="text-slate-500"><tr><th className="pb-2 pr-2 font-medium">Concepto</th><th className="pb-2 text-right font-medium">Importe</th></tr></thead><tbody className="divide-y divide-slate-800">{current?.entries.map(entry => <tr key={entry.id}><td className="py-2 pr-2"><p className="break-words text-slate-300">{entry.description}</p><p className="mt-1 text-[10px] text-slate-500">{entry.date ?? 'Sin fecha'} · {entry.category}</p></td><td className={`py-2 text-right font-mono ${entry.kind === 'income' ? 'text-emerald-300' : 'text-slate-300'}`}>{entry.kind === 'income' ? '+' : '−'}{money(entry.amount, entry.currency)}</td></tr>)}</tbody></table></div>}
          </section>
          <section className="rounded-2xl border border-slate-800 bg-slate-900/50 p-4"><h2 className="mb-3 flex items-center gap-2 text-sm font-semibold"><CalendarArrowDown className="h-4 w-4 text-emerald-300" />Vencimientos</h2>{!current?.reminders.length ? <p className="text-xs leading-relaxed text-slate-400">Adjunta una cuenta con fecha de vencimiento para crear un recordatorio.</p> : <ul className="space-y-3">{current.reminders.map(reminder => <li key={reminder.id} className="rounded-xl border border-slate-800 bg-slate-950/60 p-3"><p className="text-xs font-medium text-slate-200">{reminder.title}</p><p className="mt-1 text-[11px] text-amber-200">{reminder.date} · {reminder.time} (Colombia)</p><button onClick={() => downloadReminder(reminder)} className="mt-2 inline-flex items-center gap-1.5 text-[11px] text-emerald-300 underline-offset-4 hover:underline"><Download className="h-3 w-3" />Descargar recordatorio</button></li>)}</ul>}</section>
        </aside>
      </div>
    </div>
    {transfer && database.current && <VaultBackupDialog db={database.current} mode={transfer} onClose={() => setTransfer(null)} onImported={async () => { if (!database.current) return; const saved = await database.current.listThreads(); setThreads(saved); setSelectedId(saved[0]?.id ?? null); setNotice('Copia importada. Tus conversaciones anteriores se conservaron.'); setError(null); }} />}
  </main>;
}
