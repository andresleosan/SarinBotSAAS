"use client";
import { useState, type FormEvent } from 'react';
import type { BookingSubjectDecisions } from '@/lib/booking-subject';
import type { BookingSubjectConsentController } from '@/hooks/useBookingSubjectConsent';
import { buttonClass, Notice } from './app-shell';
function SubjectChoices({ controller }: { controller: BookingSubjectConsentController }) {
  const [choices, setChoices] = useState<BookingSubjectDecisions>({ dataAuthorized: false, sensitiveDataAuthorized: false, representationDeclared: false }), documents = controller.status!.documents, needs = documents.requirements;
  const ready = Object.entries(needs).every(([key, needed]) => !needed || choices[key as keyof BookingSubjectDecisions]);
  async function submit(event: FormEvent) { event.preventDefault(); if (ready && !controller.busy && !controller.withdrawalRequested) await controller.accept(choices); }
  const labels = { dataAuthorized: documents.dataAuthorization, sensitiveDataAuthorized: documents.sensitiveDataAuthorization, representationDeclared: documents.representationDeclaration };
  return <form onSubmit={submit} className="space-y-4"><fieldset className="space-y-3"><legend className="sr-only">Decisiones de esta reserva</legend>{(Object.keys(needs) as (keyof BookingSubjectDecisions)[]).filter(key => needs[key]).map(key => <label key={key} className="flex min-h-11 cursor-pointer items-start gap-3 text-sm leading-6"><input type="checkbox" aria-label={labels[key]} checked={choices[key]} onChange={event => setChoices(previous => ({ ...previous, [key]: event.target.checked }))} className="mt-1 h-5 w-5 shrink-0 accent-sarin-blue" />{labels[key]}</label>)}</fieldset><button className={buttonClass} aria-label="Autorizar esta reserva" disabled={!ready || controller.busy || controller.withdrawalRequested}>{controller.busy ? 'Guardando decisión…' : 'Autorizar esta reserva'}</button></form>;
}
export function BookingSubjectConsent({ controller }: { controller: BookingSubjectConsentController }) {
  const status = controller.status;
  if (controller.loading) return <p role="status">Comprobando permisos de esta reserva…</p>;
  return <section aria-label="Permisos de esta reserva" className="space-y-4 rounded-2xl border border-sarin-line bg-sarin-paper p-4 text-sm leading-6 [overflow-wrap:anywhere]">
    <h3 className="text-base font-semibold">Permisos de esta reserva</h3>
    {controller.error && <Notice error>{controller.error}</Notice>}
    {status && <><p>{status.documents.notice}</p><p className="text-sarin-muted">{status.documents.processors}</p><p>{status.documents.alternative}</p><details><summary className="min-h-11 cursor-pointer text-sarin-blue">Derechos y conservación</summary><p>{status.documents.rights}</p></details><a href="/privacidad" target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center text-sarin-blue underline">Privacidad y datos</a>
      {status.required && !controller.active && !controller.withdrawalRequested && <SubjectChoices key={`${status.documents.fingerprint}:${status.revision}`} controller={controller} />}
      {controller.active && status.required && <button className="min-h-11 text-sarin-blue underline disabled:opacity-50" disabled={controller.busy} onClick={() => void controller.revoke()}>Retirar autorización de esta reserva</button>}
      {status.receipt && <button className="min-h-11 text-sarin-blue underline" onClick={controller.downloadReceipt}>Descargar constancia de esta reserva</button>}
    </>}
    {controller.withdrawalRequested && <div><p role="status">Nuevas operaciones detenidas; falta confirmar tu retirada. Tus citas guardadas siguen disponibles.</p><button className="min-h-11 text-sarin-blue underline" disabled={controller.busy} onClick={() => void controller.revoke()}>Reintentar retirada</button></div>}
    {!status && <button className={buttonClass} onClick={controller.refresh}>Reintentar permisos</button>}
  </section>;
}
