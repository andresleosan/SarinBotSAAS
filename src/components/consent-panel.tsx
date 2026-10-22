"use client";
import { createContext, useContext, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { consentContent, type ConsentDocuments } from '@/lib/legal';
import { preauthorizationRequest, useConsent, type ConsentController } from '@/hooks/useConsent';
import { errorMessage } from '@/lib/client/api';

const accountContext = createContext<ConsentController | null>(null);
const button = 'min-h-11 rounded-[10px] bg-sarin-blue px-4 py-3 text-sm font-semibold text-white hover:bg-[#244dd0] disabled:cursor-not-allowed disabled:opacity-50';
export function AccountConsentProvider({ uid, children, refreshVersion = 0 }: { uid?: string; children: ReactNode; refreshVersion?: number }) {
  const controller = useConsent(uid, 'account');
  const refresh = useRef(controller.refresh); refresh.current = controller.refresh;
  useEffect(() => { if (refreshVersion) refresh.current(); }, [refreshVersion]);
  return <accountContext.Provider value={controller}>{children}</accountContext.Provider>;
}
export function useAccountConsent() {
  const value = useContext(accountContext);
  if (!value) throw new Error('Falta el proveedor de permisos de cuenta.');
  return value;
}
function Links() { return <nav aria-label="Documentos para tu decisión" className="flex flex-wrap gap-x-5 text-sm text-sarin-blue"><a href="/terminos" target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center underline underline-offset-4">Términos y condiciones</a><a href="/privacidad" target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center underline underline-offset-4">Privacidad y datos</a></nav>; }
function DecisionDocuments({ documents }: { documents: ConsentDocuments }) {
  const support = documents.scope === 'platform_support';
  return <div className="space-y-3">
    {!support && <Links />}
    <details><summary className="min-h-11 cursor-pointer text-sm text-sarin-blue">{support ? 'Condiciones del soporte de SarinBot' : 'Condiciones de esta decisión'}</summary><p className="whitespace-pre-wrap text-sm leading-6">{documents.terms}</p></details>
    <details><summary className="min-h-11 cursor-pointer text-sm text-sarin-blue">{support ? 'Privacidad y datos del soporte de SarinBot' : 'Privacidad y datos de esta decisión'}</summary><p className="whitespace-pre-wrap text-sm leading-6">{documents.privacy}</p></details>
  </div>;
}
function Choices({ documents, onChoices }: { documents: Pick<ConsentDocuments, 'termsAcceptance' | 'dataAuthorization'>; onChoices: (terms: boolean, data: boolean) => void }) {
  const [terms, setTerms] = useState(false), [data, setData] = useState(false);
  return <fieldset className="space-y-3"><legend className="sr-only">Condiciones y autorización, decisiones independientes</legend>
    <label className="flex cursor-pointer items-start gap-3 text-sm leading-6"><input type="checkbox" checked={terms} onChange={event => { setTerms(event.target.checked); onChoices(event.target.checked, data); }} className="mt-1 h-5 w-5 shrink-0 accent-sarin-blue" />{documents.termsAcceptance}</label>
    <label className="flex cursor-pointer items-start gap-3 text-sm leading-6"><input type="checkbox" checked={data} onChange={event => { setData(event.target.checked); onChoices(terms, event.target.checked); }} className="mt-1 h-5 w-5 shrink-0 accent-sarin-blue" />{documents.dataAuthorization}</label>
  </fieldset>;
}
function DecisionForm({ controller, blockedReason }: { controller: ConsentController; blockedReason?: string }) {
  const [choices, setChoices] = useState(false);
  async function submit(event: FormEvent) { event.preventDefault(); if (choices && !blockedReason && !controller.busy) await controller.decide('accept'); }
  return <form onSubmit={submit} className="space-y-4">
    <Choices documents={controller.status!.documents} onChoices={(terms, data) => setChoices(terms && data)} />
    {blockedReason && <p className="text-sm text-sarin-muted">{blockedReason}</p>}
    <button aria-label="Aceptar condiciones y autorizar datos" className={button} disabled={!choices || controller.busy || Boolean(blockedReason)}>{controller.busy ? 'Guardando tu decisión…' : 'Aceptar condiciones y autorizar datos'}</button>
  </form>;
}
export function ConsentPanel({ controller, title = 'Privacidad y permisos', blockedReason }: { controller: ConsentController; title?: string; blockedReason?: string }) {
  const status = controller.status;
  function download() {
    if (!status?.receipt) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(status.receipt, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = 'sarin-constancia-autorizacion.json'; link.click(); URL.revokeObjectURL(url);
  }
  const contents = <div className="space-y-4 pt-3">
    {controller.error && <p role="alert" className="text-sm text-rose-800">{controller.error}</p>}
    {controller.loading ? <p role="status" className="text-sm text-sarin-muted">Comprobando tus permisos…</p> : <>
      {controller.withdrawalRequested && <div className="space-y-2 text-sm"><p role="status">Las nuevas operaciones están detenidas. Estamos pendientes de confirmar tu retirada de autorización.</p><button className="min-h-11 text-sarin-blue underline disabled:opacity-50" disabled={controller.busy} onClick={() => void controller.decide('revoke')}>Reintentar retirada de autorización</button></div>}
      {status && <><p className="text-sm leading-6 text-sarin-muted">{status.documents.notice}</p><DecisionDocuments documents={status.documents} />{!controller.active && <DecisionForm key={`${status.documents.scope}:${status.documents.fingerprint}:${status.revision}`} controller={controller} blockedReason={blockedReason} />}</>}
      {!status && <button className={button} onClick={controller.refresh}>Reintentar comprobación</button>}
      {status?.receipt && <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm"><span>Última decisión: {status.receipt.action === 'accept' ? 'aceptación' : 'revocación'} · {new Date(status.receipt.occurredAt).toLocaleString('es-CO')}</span><button className="min-h-11 text-sarin-blue underline" onClick={download}>Descargar mi constancia</button></div>}
      {controller.active && <><p className="text-xs leading-6 text-sarin-muted">{status?.documents.scope === 'platform_support' ? 'Retirar esta autorización detiene nuevas consultas y el acceso al texto privado de soporte de SarinBot en web y WhatsApp. No revoca por sí sola los permisos de cuenta o de negocios ni borra las constancias legales. Puedes ejercer tus derechos mediante el contacto de ALS Dev Studio.' : 'Retirar esta autorización detiene nuevas operaciones de este ámbito. Puedes consultar y cancelar citas existentes y solicitar atención sobre tus datos.'}</p><button className="min-h-11 text-sm text-sarin-blue underline disabled:opacity-50" disabled={controller.busy} onClick={() => void controller.decide('revoke')}>Retirar autorización</button></>}
    </>}
  </div>;
  return controller.active ? <details className="my-4 rounded-xl border border-sarin-line bg-sarin-paper p-4"><summary className="min-h-11 cursor-pointer text-sm font-medium">{title} · autorización vigente</summary>{contents}</details> : <section aria-label={title} className="my-4 space-y-2 rounded-xl border border-sarin-line bg-sarin-paper p-4 sm:p-5"><h2 className="text-base font-semibold">{title}</h2>{contents}</section>;
}
export function PreauthorizationChoices({ onContinue }: { onContinue: (token: string) => Promise<void> | void }) {
  const [documents, setDocuments] = useState<ConsentDocuments | null>(null), [checked, setChecked] = useState(false), [token, setToken] = useState<string | null>(null), [error, setError] = useState<string | null>(null), [busy, setBusy] = useState(false), [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const abort = new AbortController();
    setDocuments(null); setToken(null); setChecked(false); setError(null);
    fetch('/api/consent/preauthorize', { signal: abort.signal, cache: 'no-store' }).then(async response => { const data = await response.json(); if (!response.ok || !data.documents?.fingerprint) throw new Error('No se pudieron consultar los documentos.'); if (!abort.signal.aborted) setDocuments(data.documents); }).catch(cause => { if (!abort.signal.aborted) setError(errorMessage(cause)); });
    return () => abort.abort();
  }, [attempt]);
  useEffect(() => {
    setToken(null);
    if (!checked || !documents) return;
    const abort = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined;
    preauthorizationRequest(documents, abort.signal).then(proof => { if (!abort.signal.aborted) { setToken(proof.token); timer = setTimeout(() => { setToken(null); setError('Vuelve a marcar la autorización para continuar.'); }, Math.max(0, proof.expiresAt - Date.now())); } }).catch(cause => { if (!abort.signal.aborted) setError(errorMessage(cause)); });
    return () => { abort.abort(); if (timer) clearTimeout(timer); };
  }, [checked, documents]);
  return <div className="space-y-4">
    <p className="text-xs leading-6 text-sarin-muted">{consentContent('account').notice}</p>
    <Links />
    <Choices key={documents?.fingerprint ?? `loading-${attempt}`} documents={documents ?? consentContent('account')} onChoices={(terms, data) => { setChecked(terms && data); setToken(null); setError(null); }} />
    {error && <p role="alert" className="text-sm text-rose-800">{error} <button className="min-h-11 underline" onClick={() => setAttempt(value => value + 1)}>Reintentar</button></p>}
    <button aria-label="Aceptar y continuar con Google" className={`${button} w-full`} disabled={!checked || !token || busy} onClick={async () => { if (!token || !checked || busy) return; setBusy(true); try { await onContinue(token); } finally { setBusy(false); } }}>Aceptar y continuar con Google</button>
  </div>;
}
