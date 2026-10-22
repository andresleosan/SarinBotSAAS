"use client";

import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { buttonClass, fieldClass } from "@/components/app-shell";
import { ApiError, apiFetch, errorMessage } from "@/lib/client/api";
import { reauthenticatePlatformWhatsAppOwner } from "@/lib/client/platform-whatsapp-reauth";
import type { AdminCopilotSource } from "@/types/admin-copilot";
import type { PaymentActionResult, PaymentActionView, PreparePaymentInput } from "@/types/admin-payment-actions";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const secondary = "min-h-11 rounded-[10px] border border-sarin-line px-3 py-2 text-sm font-medium text-sarin-blue disabled:opacity-50 focus-visible:outline focus-visible:outline-2";
const money = new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 });
const date = (value: number) => new Date(value).toLocaleString("es-CO", { timeZone: "America/Bogota" });
type Props = { payments: AdminCopilotSource[]; proposalId?: string | null };
type Review = { view: PaymentActionView; requestId: string; deadline: number };
type Phase = "review" | "uncertain" | "reauth";

/** A keyed boundary drops all private drafts and callbacks when authority changes. */
export function AdminPaymentConfirmation(props: Props) {
  const auth = useAuth();
  if (!auth.user || !auth.isSuperadmin || auth.signingOut) return null;
  return <PaymentConfirmationSession key={JSON.stringify([auth.user.uid, auth.authEpoch, auth.isSuperadmin])} {...props} />;
}

function PaymentConfirmationSession({ payments, proposalId }: Props) {
  const { user, isSuperadmin, authEpoch, signingOut, isCurrentSession, invalidateSession } = useAuth();
  const uid = user!.uid;
  const current = useRef({ uid, authEpoch, isSuperadmin, signingOut, isCurrentSession });
  current.current = { uid, authEpoch, isSuperadmin, signingOut, isCurrentSession };
  const mounted = useRef(false);
  const operation = useRef<AbortController | null>(null);
  const blocked = useRef(false);
  const tuple = useRef<Review | null>(null);
  const retryPrepare = useRef<PreparePaymentInput | null>(null);
  const reauthId = useRef<string | null>(null);
  const wallMaximum = useRef(Date.now());
  const [paymentId, setPaymentId] = useState("");
  const [action, setAction] = useState<"approve" | "reject">("approve");
  const [reason, setReason] = useState("");
  const [review, setReview] = useState<Review | null>(null);
  const [result, setResult] = useState<PaymentActionResult | null>(null);
  const [phase, setPhase] = useState<Phase>("review");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, setTick] = useState(0);
  const [prepareUnknown, setPrepareUnknown] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const alert = useRef<HTMLParagraphElement>(null);
  const valid = () => mounted.current && !blocked.current && current.current.uid === uid && current.current.authEpoch === authEpoch && current.current.isSuperadmin === true && !current.current.signingOut && current.current.isCurrentSession(uid, authEpoch);
  const owns = (controller: AbortController) => valid() && operation.current === controller && !controller.signal.aborted;
  const now = () => { wallMaximum.current = Math.max(wallMaximum.current, Date.now()); return wallMaximum.current; };
  const expired = (value: Review) => now() >= value.view.proposal.expiresAt || performance.now() >= value.deadline;

  function clearPrivate() {
    tuple.current = null; retryPrepare.current = null; reauthId.current = null;
    setReview(null); setResult(null); setReason(""); setPaymentId(""); setAction("approve"); setPrepareUnknown(false); setPhase("review");
  }
  function start() {
    if (!valid() || operation.current) return null;
    const controller = new AbortController(); operation.current = controller;
    setBusy(true); setError(null); return controller;
  }
  function finish(controller: AbortController) {
    if (!owns(controller)) return;
    operation.current = null; setBusy(false);
  }
  function showProjection(view: PaymentActionView, startedWall: number, startedMono: number) {
    const previous = tuple.current;
    const same = previous?.view.proposal.id === view.proposal.id && previous.view.proposal.revision === view.proposal.revision;
    const next = { view, requestId: same ? previous.requestId : crypto.randomUUID(), deadline: Math.min(startedMono + Math.max(0, Math.min(300000, view.proposal.expiresAt - startedWall)), same ? previous.deadline : Infinity) };
    tuple.current = next; setReview(next); setResult(null); setPhase(phase === "uncertain" && same && view.proposal.state === "pending" ? "uncertain" : "review"); setReason("");
  }
  function failed(cause: unknown, controller: AbortController, confirming = false) {
    if (!owns(controller)) return;
    if (cause instanceof ApiError && (cause.status === 401 || cause.status === 403)) {
      clearPrivate(); setError("La sesión o los permisos cambiaron. Vuelve a iniciar sesión."); setBusy(false); operation.current = null; blocked.current = true; controller.abort(); invalidateSession(uid, authEpoch); return;
    }
    if (cause instanceof ApiError && cause.status === 409) {
      clearPrivate(); setError("La propuesta venció o cambiaron los datos. Consulta el pago y prepara una nueva revisión explícita."); return;
    }
    if (confirming && cause instanceof ApiError && cause.status === 428 && cause.code === "ADMIN_PAYMENT_REAUTH_REQUIRED") {
      reauthId.current = tuple.current?.view.proposal.id ?? null;
      setPhase("reauth"); setError("Verifica de nuevo tu identidad con Google y revisa la propuesta antes de confirmar."); return;
    }
    if (confirming) setPhase("uncertain");
    setError(confirming ? "No se conoce el resultado. Reintenta la misma solicitud o consulta su estado; no prepares otro pago hasta resolverlo." : errorMessage(cause));
  }
  async function read(id: string) {
    if (!uuid.test(id)) { if (valid()) setError("El enlace de propuesta no es válido."); return; }
    const controller = start(); if (!controller) return;
    const startedWall = now(), startedMono = performance.now();
    try {
      const response = await apiFetch<PaymentActionView>(`/api/admin/copilot/payment-actions?id=${id}`, { signal: controller.signal }, uid, () => owns(controller));
      if (!owns(controller)) return;
      showProjection(response, startedWall, startedMono);
    } catch (cause) { failed(cause, controller); }
    finally { finish(controller); }
  }
  useEffect(() => {
    mounted.current = true;
    const update = () => { if (valid()) setTick(value => value + 1); };
    const timer = setInterval(update, 250);
    window.addEventListener("focus", update); window.addEventListener("blur", update);
    document.addEventListener("visibilitychange", update);
    return () => { mounted.current = false; operation.current?.abort(); operation.current = null; tuple.current = null; retryPrepare.current = null; reauthId.current = null; clearInterval(timer); window.removeEventListener("focus", update); window.removeEventListener("blur", update); document.removeEventListener("visibilitychange", update); };
    // The parent key owns the identity lifecycle; callbacks capture that exact session.
  }, []);
  useEffect(() => { if (proposalId) void read(proposalId); }, [proposalId]); // read-only deep link
  useEffect(() => { if (error) alert.current?.focus(); else if (review) heading.current?.focus(); }, [error, review]);

  async function prepare(retry = false) {
    if (!valid() || phase === "uncertain") return;
    const selected = payments.find(item => item.kind === "payment" && item.id === `payment-${paymentId}`);
    const trimmed = reason.trim();
    if (!retry && (!selected || (action === "reject" && (!trimmed || [...trimmed].length > 500)))) return;
    const input = retry ? retryPrepare.current : { paymentId, action, requestId: crypto.randomUUID(), ...(action === "reject" ? { rejectionReason: trimmed } : {}) };
    if (!input) return;
    const controller = start(); if (!controller) return;
    retryPrepare.current = input; tuple.current = null; setReview(null); setResult(null); setPrepareUnknown(false);
    const startedWall = now(), startedMono = performance.now();
    try {
      const response = await apiFetch<PaymentActionView>("/api/admin/copilot/payment-actions", { method: "POST", body: JSON.stringify(input), signal: controller.signal }, uid, () => owns(controller));
      if (!owns(controller)) return;
      retryPrepare.current = null; showProjection(response, startedWall, startedMono);
    } catch (cause) {
      failed(cause, controller);
      if (owns(controller) && retryPrepare.current) setPrepareUnknown(true);
    } finally { finish(controller); }
  }
  async function confirm() {
    if (!valid() || !review || tuple.current !== review || phase === "reauth" || expired(review) || review.view.proposal.state !== "pending") return;
    const controller = start(); if (!controller) return;
    const { view, requestId } = review;
    try {
      const response = await apiFetch<PaymentActionResult>(`/api/admin/copilot/payment-actions/${view.proposal.id}/confirm`, { method: "POST", body: JSON.stringify({ requestId, expectedRevision: view.proposal.revision, confirmed: true }), signal: controller.signal }, uid, () => owns(controller));
      if (!owns(controller)) return;
      clearPrivate(); setResult(response);
    } catch (cause) { failed(cause, controller, true); }
    finally { finish(controller); }
  }
  async function reauthenticate() {
    if (!valid() || phase !== "reauth" || !reauthId.current) return;
    const id = reauthId.current, controller = start(); if (!controller) return;
    try {
      await reauthenticatePlatformWhatsAppOwner(uid, authEpoch, (expectedUid, expectedEpoch) => expectedUid === uid && expectedEpoch === authEpoch && owns(controller));
      if (!owns(controller)) return;
      const startedWall = now(), startedMono = performance.now();
      const response = await apiFetch<PaymentActionView>(`/api/admin/copilot/payment-actions?id=${id}`, { signal: controller.signal }, uid, () => owns(controller));
      if (!owns(controller)) return;
      showProjection(response, startedWall, startedMono); reauthId.current = null;
    } catch (cause) {
      if (!owns(controller)) return;
      clearPrivate(); setError(errorMessage(cause));
    } finally { finish(controller); }
  }
  const selectedPayments = payments.filter(item => item.kind === "payment");
  const isExpired = review ? expired(review) : false;
  const locked = busy || blocked.current || phase === "uncertain" || phase === "reauth" || prepareUnknown;
  const canPrepare = !locked && selectedPayments.some(item => item.id === `payment-${paymentId}`) && (action !== "reject" || (Boolean(reason.trim()) && [...reason.trim()].length <= 500));
  return <section aria-labelledby="payment-confirmation-title" className="min-w-0 space-y-4 rounded-2xl border border-sarin-line bg-sarin-paper p-4 sm:p-6">
    <h2 id="payment-confirmation-title" className="text-xl font-semibold">Revisión individual de pagos</h2>
    <p className="text-sm leading-6 text-sarin-muted">Selecciona un pago consultado, prepara una propuesta y revisa sus datos. Solo el botón de confirmación aplica la decisión. La consulta con SarinBot y abrir un enlace no confirman pagos.</p>
    <label className="block text-sm font-medium">Pago pendiente consultado<select aria-label="Pago pendiente consultado" className={fieldClass + " mt-2 min-w-0 w-full"} value={paymentId} disabled={locked} onChange={event => { if (valid()) { setPaymentId(event.target.value); setReason(""); setReview(null); tuple.current = null; setResult(null); } }}><option value="">Selecciona un pago</option>{selectedPayments.map(item => <option key={item.id} value={item.id.slice("payment-".length)}>{item.label} · {item.detail}</option>)}</select></label>
    <label className="block text-sm font-medium">Decisión<select aria-label="Decisión" className={fieldClass + " mt-2 w-full"} value={action} disabled={locked} onChange={event => { if (valid()) { setAction(event.target.value as "approve" | "reject"); setReason(""); setReview(null); tuple.current = null; } }}><option value="approve">Aprobar</option><option value="reject">Rechazar</option></select></label>
    {action === "reject" && <label className="block text-sm font-medium">Motivo del rechazo<textarea aria-label="Motivo del rechazo" className={fieldClass + " mt-2 min-h-28 w-full"} value={reason} disabled={locked} onChange={event => { if (valid()) { setReason(event.target.value); setReview(null); tuple.current = null; } }} aria-describedby="payment-reason-help" /><span id="payment-reason-help" className="mt-1 block text-xs text-sarin-muted">Obligatorio, hasta 500 caracteres. {[...reason.trim()].length}/500</span></label>}
    <button type="button" className={secondary} disabled={!canPrepare} onClick={() => void prepare()}>Preparar revisión del pago</button>
    {prepareUnknown && <button type="button" className={secondary} disabled={busy || blocked.current} onClick={() => void prepare(true)}>Reintentar la misma preparación</button>}
    {busy && <p role="status">Comprobando la solicitud…</p>}
    {error && <p ref={alert} tabIndex={-1} role="alert" className="break-words text-sm leading-6">{error}</p>}
    {review && <div className="min-w-0 space-y-3 rounded-xl border border-sarin-line p-4 [overflow-wrap:anywhere]">
      <h3 ref={heading} tabIndex={-1} className="font-semibold">Revisa antes de {review.view.proposal.action === "approve" ? "aprobar" : "rechazar"}</h3>
      <dl className="space-y-2 text-sm"><div><dt>Negocio</dt><dd className="font-semibold">{review.view.business.name}</dd></div><div><dt>Importe registrado</dt><dd>{money.format(review.view.payment.amountCOP)}</dd></div><div><dt>Plan y tipo</dt><dd>{review.view.payment.planId} · {review.view.payment.kind}</dd></div><div><dt>Efecto de la decisión</dt><dd>{review.view.effect}</dd></div><div><dt>Estado del pago</dt><dd>{review.view.payment.status}</dd></div><div><dt>Vencimiento de la propuesta (Colombia)</dt><dd>{date(review.view.proposal.expiresAt)}</dd></div>{review.view.rejectionReason && <div><dt>Motivo del rechazo</dt><dd className="whitespace-pre-wrap">{review.view.rejectionReason}</dd></div>}</dl>
      <a href={`/admin?focusPayment=${encodeURIComponent(review.view.payment.id)}#payment-${encodeURIComponent(review.view.payment.id)}`} className="inline-flex min-h-11 items-center text-sm text-sarin-blue underline">Abrir comprobante en el panel protegido</a>
      {isExpired && <p role="status">La propuesta venció. Prepara una nueva revisión explícita.</p>}
      {review.view.proposal.state !== "pending" && <p role="status">Propuesta {review.view.proposal.state}. Esta lectura no aplica otra decisión.</p>}
      <div className="flex flex-wrap gap-3"><button type="button" className={buttonClass} disabled={busy || blocked.current || isExpired || phase === "reauth" || review.view.proposal.state !== "pending"} onClick={() => void confirm()}>{phase === "uncertain" ? "Reintentar la misma confirmación" : review.view.proposal.action === "approve" ? "Confirmar aprobación de este pago" : "Confirmar rechazo de este pago"}</button><button type="button" className={secondary} disabled={busy || blocked.current || phase === "reauth"} onClick={() => void read(review.view.proposal.id)}>Consultar estado de la propuesta</button></div>
    </div>}
    {phase === "reauth" && <button type="button" className={secondary} disabled={busy} onClick={() => void reauthenticate()}>Verificar mi identidad con Google</button>}
    {result && <p role="status" className="break-words">Decisión registrada: {result.payment.status} · {result.business.name} · {money.format(result.payment.amountCOP)} · {date(result.reviewedAt)}.</p>}
  </section>;
}
