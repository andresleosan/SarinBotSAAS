"use client";
import { useState, type FormEvent } from 'react';
import type { BookingProposalView } from '@/types/chat';
import type { BookingInput } from '@/lib/server/schemas';
import { buttonClass, fieldClass } from './app-shell';
export function BookingProposal({ proposal, confirming, onConfirm }: { proposal: BookingProposalView; confirming: boolean; onConfirm: (id: string, contact: Pick<BookingInput, 'clientPhone' | 'intakeAnswers'>) => Promise<void> }) {
  return <ProposalForm key={proposal.id} proposal={proposal} confirming={confirming} onConfirm={onConfirm} />;
}
function ProposalForm({ proposal, confirming, onConfirm }: Parameters<typeof BookingProposal>[0]) {
  const [phone, setPhone] = useState(''), [answers, setAnswers] = useState<Record<string, string>>({});
  async function submit(event: FormEvent) { event.preventDefault(); if (confirming) return; await onConfirm(proposal.id, { clientPhone: phone, intakeAnswers: answers }); }
  return <section aria-label="Propuesta de cita" className="space-y-4 rounded-2xl border border-sarin-blue bg-sarin-paper p-5">
    <h2 className="text-lg font-semibold">Revisa tu cita</h2>
    <p className="whitespace-pre-line text-sm">{proposal.serviceName}{'\n'}{proposal.resourceName}{'\n'}{proposal.dateKey} · {proposal.startTimeStr}–{proposal.endTimeStr} (Colombia){'\n'}{proposal.priceCOP.toLocaleString('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 })}</p>
    <p className="text-sm text-sarin-muted">La propuesta dura diez minutos. El horario se comprueba nuevamente al confirmar. Tus datos se guardan con la cita.</p>
    <form className="space-y-3" onSubmit={submit}>
      <label className="block text-sm">Teléfono con indicativo de país<input aria-label="Teléfono para la cita" type="tel" className={fieldClass} required pattern="\+?[1-9][0-9]{7,14}" maxLength={16} value={phone} disabled={confirming} onChange={event => setPhone(event.target.value)} /></label>
      {proposal.intakeFields.map(field => <label key={field.key} className="block text-sm">{field.label}{field.required ? ' (obligatorio)' : ' (opcional)'}<input className={fieldClass} aria-label={field.label} value={answers[field.key] ?? ''} required={field.required} maxLength={500} disabled={confirming} onChange={event => setAnswers(previous => ({ ...previous, [field.key]: event.target.value }))} /></label>)}
      <button className={buttonClass} disabled={confirming}>{confirming ? 'Confirmando…' : 'Confirmar cita'}</button>
    </form>
  </section>;
}
