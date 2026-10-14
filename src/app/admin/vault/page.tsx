"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from "react";
import Link from "next/link";
import {
  ArrowLeft,
  CalendarArrowDown,
  ChevronDown,
  Download,
  FileText,
  HardDrive,
  LoaderCircle,
  MessageSquare,
  Paperclip,
  Plus,
  Send,
  ShieldCheck,
  Square,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { AuthGate, useAuth } from "@/components/auth-provider";
import { apiFetch, errorMessage } from "@/lib/client/api";
import { VaultDatabase } from "@/lib/vault/localDb";
import { buildVaultRequest } from "@/lib/vault/conversation";
import { calculateFinancialTotals } from "@/lib/vault/finance";
import { imageDataUrlSchema } from "@/lib/vault/schema";
import {
  blobToDataUrl,
  compressReceiptToWebP,
} from "@/lib/utils/imageCompression";
import {
  downloadICSFile,
  generateICSFileContent,
} from "@/lib/utils/icsGenerator";
import type {
  VaultAttachment,
  VaultChatResponse,
  VaultReminder,
  VaultThread,
} from "@/types/vault";
import { VaultBackupDialog } from "./vault-backup-dialog";
import { VaultMarkdown } from "./vault-markdown";

const secondaryButton =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-sarin-line bg-sarin-paper px-3 py-2 text-xs font-medium text-sarin-ink transition hover:border-sarin-blue/40 hover:bg-sarin-soft disabled:cursor-not-allowed disabled:opacity-40";
function money(amount: number, currency: string) {
  try {
    return new Intl.NumberFormat("es-CO", {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${amount.toLocaleString("es-CO")} ${currency}`;
  }
}

export default function SarinVaultPage() {
  const { user } = useAuth();
  return (
    <AuthGate admin>
      <VaultWorkspace key={user?.uid} />
    </AuthGate>
  );
}

function VaultWorkspace() {
  const { user } = useAuth();
  const database = useRef<VaultDatabase | null>(null);
  const request = useRef<AbortController | null>(null);
  const inputFile = useRef<HTMLInputElement>(null);
  const conversationEnd = useRef<HTMLDivElement>(null);
  const [threads, setThreads] = useState<VaultThread[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [attachments, setAttachments] = useState<VaultAttachment[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [reload, setReload] = useState(0);
  const [sending, setSending] = useState(false);
  const [addingImages, setAddingImages] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [health, setHealth] = useState<"checking" | "online" | "offline">(
    "checking",
  );
  const [transfer, setTransfer] = useState<"export" | "import" | null>(null);
  const current = threads.find((thread) => thread.id === selectedId) ?? null;
  const totals = useMemo(
    () => calculateFinancialTotals(current?.entries ?? []),
    [current?.entries],
  );
  const busy = sending || addingImages;

  useEffect(() => {
    if (!user) return;
    let active = true;
    const db = new VaultDatabase(user.uid);
    database.current = db;
    setLoaded(false);
    setError(null);
    void db
      .listThreads()
      .then((saved) => {
        if (active) {
          setThreads(saved);
          setSelectedId(saved[0]?.id ?? null);
          setLoaded(true);
        }
      })
      .catch((cause) => {
        if (active) setError(errorMessage(cause));
      });
    return () => {
      active = false;
      request.current?.abort();
      if (database.current === db) database.current = null;
      db.close();
    };
  }, [user, reload]);

  useEffect(() => {
    const controller = new AbortController();
    async function check() {
      if (!navigator.onLine) {
        setHealth("offline");
        return;
      }
      try {
        const result = await apiFetch<{ online: boolean }>(
          "/api/sarin/health",
          { signal: controller.signal },
        );
        if (!controller.signal.aborted)
          setHealth(result.online ? "online" : "offline");
      } catch {
        if (!controller.signal.aborted) setHealth("offline");
      }
    }
    void check();
    const timer = setInterval(() => void check(), 30_000);
    const offline = () => setHealth("offline");
    const online = () => void check();
    window.addEventListener("offline", offline);
    window.addEventListener("online", online);
    return () => {
      controller.abort();
      clearInterval(timer);
      window.removeEventListener("offline", offline);
      window.removeEventListener("online", online);
    };
  }, []);

  useEffect(() => {
    if (current?.messages.length || sending) {
      conversationEnd.current?.scrollIntoView({
        behavior: "instant",
        block: "nearest",
      });
    }
  }, [selectedId, current?.messages.length, sending]);

  async function persist(thread: VaultThread) {
    const db = database.current;
    if (!db) throw new Error("La bóveda aún no está disponible.");
    await db.saveThread(thread);
    if (database.current !== db) return;
    setThreads((previous) =>
      [thread, ...previous.filter((saved) => saved.id !== thread.id)].sort(
        (a, b) => b.updatedAt - a.updatedAt,
      ),
    );
    setSelectedId(thread.id);
  }

  async function runTurn(thread: VaultThread) {
    const db = database.current;
    if (!db) return;
    setSending(true);
    setError(null);
    setNotice(null);
    const controller = new AbortController();
    request.current = controller;
    try {
      const response = await apiFetch<VaultChatResponse>("/api/sarin/vault", {
        method: "POST",
        signal: controller.signal,
        body: JSON.stringify(buildVaultRequest(thread.messages)),
      });
      if (controller.signal.aborted || database.current !== db) return;
      const updated: VaultThread = {
        ...thread,
        updatedAt: Date.now(),
        messages: [
          ...thread.messages,
          {
            id: crypto.randomUUID(),
            role: "assistant",
            content: response.message,
            createdAt: Date.now(),
            attachments: [],
          },
        ],
        entries: [
          ...thread.entries,
          ...response.analysis.entries.map((entry) => ({
            ...entry,
            id: crypto.randomUUID(),
          })),
        ],
        reminders: [
          ...thread.reminders,
          ...response.analysis.reminders.map((reminder) => ({
            ...reminder,
            id: crypto.randomUUID(),
          })),
        ],
      };
      await persist(updated);
      setHealth("online");
    } catch (cause) {
      if (database.current === db)
        setError(
          controller.signal.aborted
            ? "Consulta detenida. Tu mensaje quedó guardado; puedes reintentarlo."
            : errorMessage(cause),
        );
    } finally {
      if (request.current === controller) {
        request.current = null;
        setSending(false);
      }
    }
  }

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !loaded || (!draft.trim() && !attachments.length)) return;
    setSending(true);
    setError(null);
    setNotice(null);
    try {
      if ((current?.messages.length ?? 0) >= 998)
        throw new Error(
          "Esta conversación está llena. Crea una nueva para continuar.",
        );
      const now = Date.now();
      const thread: VaultThread = current ?? {
        id: crypto.randomUUID(),
        title:
          draft.trim().slice(0, 80) ||
          attachments[0]?.name.slice(0, 80) ||
          "Nueva conversación",
        createdAt: now,
        updatedAt: now,
        messages: [],
        entries: [],
        reminders: [],
      };
      const updated: VaultThread = {
        ...thread,
        updatedAt: now,
        messages: [
          ...thread.messages,
          {
            id: crypto.randomUUID(),
            role: "user",
            content: draft.trim(),
            createdAt: now,
            attachments,
          },
        ],
      };
      await persist(updated);
      setDraft("");
      setAttachments([]);
      await runTurn(updated);
    } catch (cause) {
      setError(errorMessage(cause));
      setSending(false);
    }
  }

  async function attach(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    if (!files.length || busy) return;
    setAddingImages(true);
    setError(null);
    try {
      if (files.length + attachments.length > 4)
        throw new Error("Puedes adjuntar hasta cuatro imágenes por mensaje.");
      const prepared: VaultAttachment[] = [];
      for (const file of files) {
        const blob = await compressReceiptToWebP(file);
        const dataUrl = imageDataUrlSchema.parse(await blobToDataUrl(blob));
        prepared.push({
          id: crypto.randomUUID(),
          name: file.name.slice(0, 180) || "factura.webp",
          dataUrl,
        });
      }
      setAttachments((previous) => [...previous, ...prepared]);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setAddingImages(false);
      event.target.value = "";
    }
  }

  async function deleteCurrent() {
    if (
      !current ||
      !database.current ||
      busy ||
      !window.confirm(
        `¿Eliminar “${current.title}” y sus registros de este dispositivo?`,
      )
    )
      return;
    try {
      await database.current.deleteThread(current.id);
      const remaining = threads.filter((thread) => thread.id !== current.id);
      setThreads(remaining);
      setSelectedId(remaining[0]?.id ?? null);
      setDraft("");
      setAttachments([]);
      setNotice("Conversación eliminada.");
      setError(null);
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }

  async function clearVault() {
    if (
      !database.current ||
      busy ||
      !window.confirm(
        "¿Borrar toda tu bóveda de este dispositivo? Se eliminarán las conversaciones, imágenes, cuentas y recordatorios locales. Conserva una copia antes de continuar.",
      )
    )
      return;
    try {
      await database.current.clear();
      setThreads([]);
      setSelectedId(null);
      setDraft("");
      setAttachments([]);
      setError(null);
      setNotice("Bóveda borrada de este dispositivo.");
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }

  function downloadReminder(reminder: VaultReminder) {
    try {
      downloadICSFile(
        generateICSFileContent({
          businessName: "Sarin Vault",
          serviceName: reminder.title,
          dateKey: reminder.date,
          startTimeStr: reminder.time,
          durationMinutes: 15,
          notes: reminder.notes,
        }),
        `sarin-vencimiento-${reminder.date}.ics`,
      );
      setNotice(
        "Recordatorio descargado. Ábrelo para agregarlo a tu calendario (hora de Colombia).",
      );
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }

  const conversations = (
    <>
      <button
        disabled={!loaded || busy}
        onClick={() => {
          setSelectedId(null);
          setDraft("");
          setAttachments([]);
          setError(null);
          setNotice(null);
        }}
        className="flex min-h-12 w-full items-center justify-between gap-3 rounded-xl bg-sarin-blue px-4 py-3 text-sm font-semibold text-white transition hover:bg-sarin-blue/95 disabled:opacity-40"
      >
        Nueva conversación <Plus className="h-4 w-4" />
      </button>
      <nav
        aria-label="Conversaciones de la bóveda"
        className="mt-5 max-h-64 space-y-1 overflow-y-auto overscroll-contain lg:max-h-[43dvh]"
      >
        <p className="mb-3 px-2 font-mono text-xs uppercase tracking-wider text-sarin-muted">
          Conversaciones{" "}
          <span className="ml-1 text-sarin-muted">{threads.length}</span>
        </p>
        {!loaded ? (
          <p className="px-2 py-4 text-sm text-sarin-muted">Abriendo bóveda…</p>
        ) : !threads.length ? (
          <p className="px-2 py-3 text-sm leading-6 text-sarin-muted">
            Aquí encontrarás las conversaciones que guardes en este dispositivo.
          </p>
        ) : (
          threads.map((thread) => (
            <button
              key={thread.id}
              disabled={busy}
              onClick={() => {
                setSelectedId(thread.id);
                setDraft("");
                setAttachments([]);
                setError(null);
                setNotice(null);
              }}
              aria-current={selectedId === thread.id ? "page" : undefined}
              className={
                "flex min-h-12 w-full items-start gap-2.5 rounded-xl px-3 py-3 text-left text-sm transition disabled:opacity-50 " +
                (selectedId === thread.id
                  ? "bg-sarin-soft text-sarin-blue ring-1 ring-inset ring-sarin-blue/20"
                  : "text-sarin-muted hover:bg-sarin-soft")
              }
            >
              <MessageSquare className="mt-0.5 h-4 w-4 shrink-0" />
              <span className="line-clamp-2 break-words">{thread.title}</span>
            </button>
          ))
        )}
      </nav>
      <div className="mt-5 border-t border-sarin-line pt-4">
        <div className="grid grid-cols-2 gap-2">
          <button
            disabled={!loaded || busy}
            onClick={() => setTransfer("export")}
            className={secondaryButton}
          >
            <Download className="h-4 w-4" />
            Exportar
          </button>
          <button
            disabled={!loaded || busy}
            onClick={() => setTransfer("import")}
            className={secondaryButton}
          >
            <Upload className="h-4 w-4" />
            Importar
          </button>
        </div>
        <div className="mt-4 flex items-start gap-2.5 px-1">
          <HardDrive className="mt-1 h-4 w-4 shrink-0 text-sarin-blue" />
          <p className="text-xs leading-6 text-sarin-muted">
            Guardado en este navegador. Exporta una copia antes de cambiar de
            dispositivo.
          </p>
        </div>
        <button
          disabled={!loaded || busy || !threads.length}
          onClick={() => void clearVault()}
          className="mt-4 flex min-h-11 items-center gap-2 px-1 text-xs text-sarin-muted transition hover:text-rose-700 disabled:opacity-40"
        >
          <Trash2 className="h-4 w-4" />
          Borrar bóveda del dispositivo
        </button>
      </div>
    </>
  );

  const financialSummary = (
    <div className="space-y-5">
      <section
        aria-label="Cuentas de esta conversación"
        className="rounded-2xl border border-sarin-line bg-sarin-paper p-5"
      >
        <div className="mb-5 flex items-center justify-between gap-2">
          <h2 className="text-base font-semibold">Tus cuentas</h2>
          <FileText className="h-4 w-4 text-sarin-blue" />
        </div>
        {!totals.length ? (
          <div className="rounded-xl border border-dashed border-sarin-line p-4">
            <p className="text-sm leading-6 text-sarin-muted">
              Los movimientos extraídos de tus facturas aparecerán aquí.
            </p>
            <p className="mt-3 font-mono text-xs text-sarin-muted">
              Solo esta conversación
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {totals.map((total) => (
              <div
                key={total.currency}
                className="rounded-xl bg-sarin-canvas p-4"
              >
                <p className="mb-4 font-mono text-xs uppercase tracking-widest text-sarin-muted">
                  {total.currency}
                </p>
                <p className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                  <span className="text-sarin-muted">Ingresos</span>
                  <span className="break-all font-mono text-sarin-blue">
                    {money(total.income, total.currency)}
                  </span>
                </p>
                <p className="mt-3 flex flex-wrap items-baseline justify-between gap-2 text-sm">
                  <span className="text-sarin-muted">Gastos</span>
                  <span className="break-all font-mono text-sarin-ink">
                    {money(total.expense, total.currency)}
                  </span>
                </p>
                <div className="mt-4 border-t border-sarin-line pt-4">
                  <p className="text-xs text-sarin-muted">Balance</p>
                  <p
                    className={
                      "mt-1 break-all font-mono text-xl tracking-tight " +
                      (total.balance < 0
                        ? "text-amber-800"
                        : "text-sarin-blue")
                    }
                  >
                    {money(total.balance, total.currency)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
        {Boolean(current?.entries.length) && (
          <div className="mt-5 max-h-72 overflow-y-auto overscroll-contain">
            <table className="w-full table-fixed text-left text-xs">
              <caption className="sr-only">
                Movimientos de esta conversación
              </caption>
              <thead className="border-b border-sarin-line text-sarin-muted">
                <tr>
                  <th className="w-[57%] pb-3 pr-2 font-medium">Concepto</th>
                  <th className="pb-3 text-right font-medium">Importe</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-sarin-line">
                {current?.entries.map((entry) => (
                  <tr key={entry.id}>
                    <td className="py-3 pr-2 align-top">
                      <p className="break-words leading-5 text-sarin-ink">
                        {entry.description}
                      </p>
                      <p className="mt-1 break-words leading-5 text-sarin-muted">
                        {entry.date ?? "Sin fecha"} · {entry.category}
                      </p>
                    </td>
                    <td
                      className={
                        "break-all py-3 text-right align-top font-mono leading-5 " +
                        (entry.kind === "income"
                          ? "text-sarin-blue"
                          : "text-sarin-ink")
                      }
                    >
                      {entry.kind === "income" ? "+" : "−"}
                      {money(entry.amount, entry.currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <section className="rounded-2xl border border-sarin-line bg-sarin-paper p-5">
        <h2 className="mb-5 flex items-center justify-between gap-2 text-base font-semibold">
          Vencimientos
          <CalendarArrowDown className="h-4 w-4 text-sarin-blue" />
        </h2>
        {!current?.reminders.length ? (
          <p className="text-sm leading-6 text-sarin-muted">
            Adjunta una cuenta con fecha de vencimiento para preparar tu
            recordatorio.
          </p>
        ) : (
          <ul className="space-y-3">
            {current.reminders.map((reminder) => (
              <li
                key={reminder.id}
                className="rounded-xl border border-sarin-line bg-sarin-canvas p-4"
              >
                <p className="break-words text-sm font-medium text-sarin-ink">
                  {reminder.title}
                </p>
                <p className="mt-2 font-mono text-xs leading-5 text-amber-800">
                  {reminder.date} · {reminder.time}
                </p>
                <p className="mt-1 text-xs text-sarin-muted">Hora de Colombia</p>
                <button
                  onClick={() => downloadReminder(reminder)}
                  className="mt-3 inline-flex min-h-11 items-center gap-2 text-xs font-semibold text-sarin-blue underline-offset-4 hover:underline"
                >
                  <Download className="h-4 w-4" />
                  Descargar recordatorio
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
      <p className="flex items-start gap-2 px-1 text-xs leading-6 text-sarin-muted">
        <ShieldCheck className="mt-1 h-4 w-4 shrink-0 text-sarin-blue" />
        Comprueba importes y fechas extraídos antes de usarlos.
      </p>
    </div>
  );

  return (
    <main className="sarin-agenda min-h-dvh bg-sarin-canvas font-sans text-sarin-ink [color-scheme:light]">
      <div className="mx-auto max-w-[1600px] px-3 py-4 sm:px-5 lg:px-6">
        <header className="mb-5 flex flex-wrap items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-sarin-soft">
              <img
                src="/brand/sarin-face-mark.png"
                alt=""
                width={44}
                height={44}
                className="h-11 w-11 object-contain"
              />
            </div>
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">
                Sarin Vault
                <span className="ml-2 align-middle font-mono text-xs font-normal uppercase tracking-widest text-sarin-blue">
                  Privado
                </span>
              </h1>
              <p className="mt-1 text-xs text-sarin-muted">
                Un espacio para tus ideas y tus cuentas.
              </p>
            </div>
          </div>
          <div className="flex w-full flex-wrap items-center justify-between gap-3 sm:w-auto sm:justify-end">
            <span
              role="status"
              className={
                "inline-flex items-center gap-2 rounded-full border px-3 py-2 font-mono text-xs " +
                (health === "online"
                  ? "border-green-200 bg-green-50 text-green-800"
                  : health === "offline"
                    ? "border-amber-200 bg-amber-50 text-amber-800"
                    : "border-sarin-line text-sarin-muted")
              }
            >
              <span
                aria-hidden
                className={
                  "h-1.5 w-1.5 rounded-full " +
                  (health === "online"
                    ? "bg-green-600"
                    : health === "offline"
                      ? "bg-amber-400"
                      : "bg-sarin-muted")
                }
              />
              {health === "online"
                ? "Modelo disponible"
                : health === "offline"
                  ? "Modelo sin conexión"
                  : "Conectando…"}
            </span>
            <Link href="/admin" className={secondaryButton}>
              <ArrowLeft className="h-4 w-4" />
              Consola
            </Link>
          </div>
        </header>
        <div className="grid items-start gap-4 lg:grid-cols-[210px_minmax(0,1fr)] xl:grid-cols-[210px_minmax(0,1fr)_260px]">
          <aside
            className="hidden min-w-0 rounded-2xl border border-sarin-line bg-sarin-paper p-3 lg:sticky lg:top-5 lg:block"
            aria-label="Historial y copias de la bóveda"
          >
            {conversations}
          </aside>
          <details className="group min-w-0 rounded-xl border border-sarin-line bg-sarin-paper lg:hidden">
            <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-medium [&::-webkit-details-marker]:hidden">
              <span className="flex items-center gap-2">
                <MessageSquare className="h-4 w-4 text-sarin-blue" />
                Conversaciones y copias
              </span>
              <ChevronDown className="h-4 w-4 text-sarin-muted transition group-open:rotate-180 motion-reduce:transition-none" />
            </summary>
            <div className="border-t border-sarin-line p-4">{conversations}</div>
          </details>

          <section
            aria-label="Chat personal"
            className="sarin-paper flex h-[calc(100dvh-215px)] min-h-[520px] min-w-0 flex-col overflow-hidden rounded-[24px] border border-sarin-line bg-sarin-paper text-sarin-ink shadow-[0_18px_70px_-40px_#16234433] [color-scheme:light] sm:h-[calc(100dvh-170px)] lg:h-[calc(100dvh-160px)] lg:min-h-[560px]"
          >
            <div className="flex min-h-[76px] shrink-0 items-center justify-between gap-3 border-b border-sarin-line px-4 py-4 sm:px-6">
              <div className="min-w-0">
                <h2 className="truncate text-base font-semibold">
                  {current?.title ?? "Tu espacio personal"}
                </h2>
                <p className="mt-1 flex items-center gap-1.5 text-xs text-sarin-muted">
                  <ShieldCheck className="h-3.5 w-3.5 text-sarin-blue" />
                  Guardado en tu dispositivo
                </p>
              </div>
              {current && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void deleteCurrent()}
                  aria-label="Eliminar conversación"
                  title="Eliminar conversación"
                  className="grid h-11 w-11 shrink-0 place-items-center rounded-xl text-sarin-muted transition hover:bg-rose-100 hover:text-rose-700 disabled:opacity-40"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </div>
            <div
              className="min-h-0 flex-1 space-y-7 overflow-y-auto overscroll-contain px-4 py-6 sm:px-7"
              aria-busy={sending}
            >
              {!current?.messages.length && (
                <div className="mx-auto flex min-h-full max-w-lg flex-col items-center justify-center py-3 text-center">
                  <img
                    src="/brand/sarin-face-mark.png"
                    alt=""
                    width={104}
                    height={104}
                    className="mb-3 h-16 w-16 shrink-0 object-contain sm:h-28 sm:w-28"
                  />
                  <p className="mb-2 font-mono text-xs uppercase tracking-[0.16em] text-sarin-blue">
                    Hola, estoy para ayudarte
                  </p>
                  <h2 className="text-2xl font-semibold leading-tight tracking-tight sm:text-[30px]">
                    Más claridad.
                    <br />
                    Un pendiente menos.
                  </h2>
                  <p className="mt-3 max-w-sm text-sm leading-6 text-sarin-muted">
                    Revisa una factura, ordena tus gastos o pon una idea en
                    marcha.
                  </p>
                  <div className="mt-5 flex flex-wrap justify-center gap-2">
                    {[
                      "Revisar una factura",
                      "Organizar mis gastos",
                      "Planear mi presupuesto",
                    ].map((suggestion) => (
                      <button
                        disabled={!loaded}
                        key={suggestion}
                        onClick={() => setDraft(suggestion)}
                        className="min-h-10 rounded-full border border-sarin-line bg-sarin-paper px-3 py-2 text-xs text-sarin-ink transition hover:border-sarin-blue hover:bg-sarin-soft disabled:opacity-50"
                      >
                        {suggestion}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {current?.messages.map((message) => (
                <article
                  key={message.id}
                  className={
                    "mx-auto w-full max-w-[70ch] min-w-0 " +
                    (message.role === "user" ? "flex justify-end" : "")
                  }
                >
                  <div
                    className={
                      message.role === "user"
                        ? "max-w-[95%] rounded-[20px] rounded-br-md bg-sarin-soft p-4 text-sarin-ink sm:max-w-[90%]"
                        : "min-w-0 w-full"
                    }
                  >
                    <p
                      className={
                        "mb-2 flex items-center gap-2 font-mono text-xs font-medium " +
                        (message.role === "user"
                          ? "text-sarin-muted"
                          : "text-sarin-blue")
                      }
                    >
                      {message.role === "user" ? (
                        "Tú"
                      ) : (
                        <>
                          <span className="h-1.5 w-1.5 rounded-full bg-sarin-blue" />
                          Sarin
                        </>
                      )}
                    </p>
                    {message.attachments.length > 0 && (
                      <div className="mb-3 flex flex-wrap gap-2">
                        {message.attachments.map((image) => (
                          <img
                            key={image.id}
                            src={image.dataUrl}
                            alt={image.name}
                            width={104}
                            height={104}
                            className="h-24 w-24 rounded-xl border border-sarin-line bg-sarin-paper object-contain"
                            loading="lazy"
                          />
                        ))}
                      </div>
                    )}
                    {message.role === "assistant" ? (
                      <VaultMarkdown>{message.content}</VaultMarkdown>
                    ) : (
                      <p className="whitespace-pre-wrap break-words text-sm leading-7">
                        {message.content}
                      </p>
                    )}
                  </div>
                </article>
              ))}
              {sending && (
                <div
                  role="status"
                  className="mx-auto flex w-full max-w-[70ch] items-center gap-2 text-sm text-sarin-blue"
                >
                  <LoaderCircle className="h-4 w-4 animate-spin motion-reduce:animate-none" />
                  Sarin está preparando tu respuesta…
                </div>
              )}
              <div ref={conversationEnd} />
            </div>
            <div className="max-h-[65%] shrink-0 space-y-3 overflow-y-auto overscroll-contain border-t border-sarin-line bg-sarin-canvas p-3 sm:p-4">
              {error && (
                <div
                  role="alert"
                  className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800"
                >
                  <p>{error}</p>
                  {!loaded ? (
                    <button
                      onClick={() => setReload((value) => value + 1)}
                      className="mt-2 min-h-10 font-semibold underline underline-offset-4"
                    >
                      Volver a abrir la bóveda
                    </button>
                  ) : (
                    !sending &&
                    current?.messages.at(-1)?.role === "user" && (
                      <button
                        onClick={() => void runTurn(current)}
                        className="mt-2 min-h-10 font-semibold underline underline-offset-4"
                      >
                        Reintentar consulta
                      </button>
                    )
                  )}
                </div>
              )}
              {notice && (
                <p
                  role="status"
                  className="rounded-xl border border-green-200 bg-green-50 p-3 text-xs leading-5 text-green-800"
                >
                  {notice}
                </p>
              )}
              {health === "offline" && (
                <p className="flex items-start gap-2 px-1 text-xs leading-5 text-amber-800">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />
                  Modelo sin conexión. Puedes consultar lo guardado y reintentar
                  más tarde.
                </p>
              )}
              {attachments.length > 0 && (
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {attachments.map((image) => (
                    <div
                      key={image.id}
                      className="flex min-w-0 max-w-full shrink-0 items-center gap-2 rounded-xl border border-sarin-line bg-sarin-paper p-2 pr-1"
                    >
                      <img
                        src={image.dataUrl}
                        alt=""
                        width={42}
                        height={42}
                        className="h-10 w-10 shrink-0 rounded-lg object-contain"
                      />
                      <span className="max-w-[130px] truncate text-xs text-sarin-ink">
                        {image.name}
                      </span>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          setAttachments((previous) =>
                            previous.filter((item) => item.id !== image.id),
                          )
                        }
                        aria-label={"Quitar " + image.name}
                        className="grid h-11 w-11 shrink-0 place-items-center rounded-lg text-sarin-muted hover:bg-rose-50 hover:text-rose-700 disabled:opacity-40"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <form
                onSubmit={(event) => void send(event)}
                className="rounded-2xl border border-sarin-line bg-sarin-paper p-3 shadow-sm focus-within:border-sarin-blue focus-within:ring-2 focus-within:ring-sarin-blue/15"
              >
                <label htmlFor="vault-message" className="sr-only">
                  Mensaje para Sarin Vault
                </label>
                <textarea
                  id="vault-message"
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (
                      event.key === "Enter" &&
                      !event.shiftKey &&
                      !event.nativeEvent.isComposing
                    ) {
                      event.preventDefault();
                      event.currentTarget.form?.requestSubmit();
                    }
                  }}
                  disabled={!loaded || busy}
                  maxLength={16000}
                  rows={2}
                  placeholder="¿Qué resolvemos hoy?"
                  className="max-h-36 min-h-[56px] w-full resize-y bg-transparent text-sm leading-6 text-sarin-ink outline-none placeholder:text-sarin-muted disabled:opacity-60"
                />
                <div className="mt-2 flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <input
                      ref={inputFile}
                      type="file"
                      multiple
                      accept="image/jpeg,image/png,image/webp"
                      onChange={(event) => void attach(event)}
                      disabled={!loaded || busy || attachments.length >= 4}
                      className="hidden"
                      aria-label="Seleccionar imágenes de facturas"
                    />
                    <button
                      type="button"
                      disabled={!loaded || busy || attachments.length >= 4}
                      onClick={() => inputFile.current?.click()}
                      className="flex min-h-11 items-center gap-2 rounded-xl px-2 py-2 text-xs text-sarin-muted transition hover:bg-sarin-canvas disabled:opacity-40"
                    >
                      {addingImages ? (
                        <LoaderCircle className="h-4 w-4 animate-spin motion-reduce:animate-none" />
                      ) : (
                        <Paperclip className="h-4 w-4" />
                      )}
                      <span>{addingImages ? "Optimizando…" : "Adjuntar"}</span>
                    </button>
                    <span className="font-mono text-xs text-sarin-muted">
                      {attachments.length}/4
                    </span>
                  </div>
                  {sending ? (
                    <button
                      type="button"
                      onClick={() => request.current?.abort()}
                      className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-sarin-line px-3 py-2 text-sm font-semibold text-sarin-ink hover:bg-sarin-canvas"
                    >
                      <Square className="h-3.5 w-3.5" />
                      Detener
                    </button>
                  ) : (
                    <button
                      type="submit"
                      disabled={
                        !loaded ||
                        busy ||
                        (!draft.trim() && !attachments.length)
                      }
                      className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-sarin-blue px-4 py-2 text-sm font-semibold text-white transition hover:bg-sarin-blue/95 disabled:opacity-35"
                    >
                      <Send className="h-4 w-4 text-white" />
                      Enviar
                    </button>
                  )}
                </div>
              </form>
              <p className="px-1 text-center text-xs leading-5 text-sarin-muted">
                Tu consulta viaja a tu modelo local mediante una conexión
                privada.
              </p>
            </div>
          </section>

          <aside
            className="hidden min-w-0 lg:col-start-2 xl:sticky xl:top-5 xl:col-start-auto xl:block"
            aria-label="Resumen de cuentas y vencimientos"
          >
            {financialSummary}
          </aside>
          <details className="group min-w-0 rounded-xl border border-sarin-line bg-sarin-paper lg:col-start-2 xl:hidden">
            <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-medium [&::-webkit-details-marker]:hidden">
              <span className="flex items-center gap-2">
                <FileText className="h-4 w-4 text-sarin-blue" />
                Cuentas y vencimientos
                {Boolean(current?.entries.length) && (
                  <span className="rounded-full bg-sarin-soft px-2 py-0.5 font-mono text-xs text-sarin-blue">
                    {current?.entries.length}
                  </span>
                )}
              </span>
              <ChevronDown className="h-4 w-4 text-sarin-muted transition group-open:rotate-180 motion-reduce:transition-none" />
            </summary>
            <div className="border-t border-sarin-line p-3">
              {financialSummary}
            </div>
          </details>
        </div>
      </div>
      {transfer && database.current && (
        <VaultBackupDialog
          db={database.current}
          mode={transfer}
          onClose={() => setTransfer(null)}
          onImported={async () => {
            if (!database.current) return;
            const saved = await database.current.listThreads();
            setThreads(saved);
            setSelectedId(saved[0]?.id ?? null);
            setNotice(
              "Copia importada. Tus conversaciones anteriores se conservaron.",
            );
            setError(null);
          }}
        />
      )}
    </main>
  );
}
