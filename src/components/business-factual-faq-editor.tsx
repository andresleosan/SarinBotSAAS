"use client";
import type { ReactNode } from 'react';
import { FACTUAL_FAQ_TOPICS, factualFaqQuestion } from '@/lib/business-factual-faq';
import type { OwnerFactualFaqController } from '@/hooks/use-owner-factual-faq';
import { Notice, buttonClass } from '@/components/app-shell';
export function BusinessFactualFaqEditor({ controller: c, canEdit }: { controller: OwnerFactualFaqController; canEdit: boolean }): ReactNode {
  const disabled = !canEdit || !c.view?.eligible || c.busy || c.uncertain;
  const changes = FACTUAL_FAQ_TOPICS.flatMap(topic => {
    const before = c.view?.state.items.find(item => item.topic === topic)?.answer, after = c.draft.find(item => item.topic === topic)?.answer;
    return before === after ? [] : [{ topic, before, after }];
  });
  return <section className="max-w-3xl space-y-5 min-w-0">
    <h1 className="text-3xl font-bold">Información para tus clientes</h1>
    <p>Estas respuestas se consultan al elegir la pregunta. No cambian tus servicios, precios, horarios o reglas de reserva.</p>
    <details className="rounded-xl border border-sarin-line p-3"><summary className="min-h-11 cursor-pointer py-3 font-semibold">Cómo preparar las respuestas</summary><p>Completa solo las preguntas pertinentes con datos del establecimiento. Cada respuesta admite hasta 400 caracteres y tres saltos de línea. Dejarla vacía retira esa respuesta. No incluyas datos de clientes, instrucciones clínicas, precios ni reglas de cancelación.</p></details>
    {!c.view && !c.error && <Notice>Consultando tus respuestas…</Notice>}
    {c.view && !c.view.eligible && <Notice>La edición requiere un negocio general configurado, sin menores habilitados y con acceso vigente.</Notice>}
    {c.view && FACTUAL_FAQ_TOPICS.map(topic => <label key={topic} className="block space-y-2"><span className="block font-semibold">{factualFaqQuestion(topic)} <span className="font-normal">(opcional)</span></span><textarea disabled={disabled} value={c.draft.find(item => item.topic === topic)?.answer ?? ''} maxLength={400} rows={4} className="w-full min-h-24 rounded-xl border border-sarin-line bg-sarin-paper p-3 focus-visible:outline-2 focus-visible:outline-sarin-blue disabled:opacity-60" onChange={event => c.setDraft([...c.draft.filter(item => item.topic !== topic), ...(event.target.value.trim() ? [{ topic, answer: event.target.value }] : [])])} /></label>)}
    {c.reviewed && <section aria-label="Revisión de respuestas" className="space-y-3 rounded-xl border border-sarin-line p-4"><h2 className="text-xl font-semibold">Revisa lo que verán tus clientes</h2>{changes.length === 0 && <p>No hay cambios en las respuestas.</p>}{changes.map(item => <div key={item.topic}><h3 className="font-semibold">{item.before === undefined ? 'Añadida' : item.after === undefined ? 'Retirada' : 'Cambiada'}: {factualFaqQuestion(item.topic)}</h3>{item.before !== undefined && <p className="whitespace-pre-wrap break-words">Antes: {item.before}</p>}{item.after !== undefined && <p className="whitespace-pre-wrap break-words">Ahora: {item.after}</p>}</div>)}<label className="flex min-h-11 items-center gap-3"><input type="checkbox" checked={c.publicationChecked} disabled={disabled} onChange={event => c.setPublicationChecked(event.target.checked)} />He revisado que son datos del establecimiento y no incluyen información de clientes</label><p>Guardar pone estas respuestas a disposición de los clientes de este recorrido.</p></section>}
    <div className="flex flex-wrap gap-3"><button type="button" className={buttonClass} disabled={disabled || !c.dirty} onClick={c.review}>Revisar respuestas</button><button type="button" className={buttonClass} disabled={disabled || !c.reviewed || !c.publicationChecked} onClick={() => void c.save()}>Guardar respuestas</button><button type="button" className={buttonClass} onClick={() => void c.load()}>Actualizar</button></div>
    {(c.busy || c.uncertain) && <div className="space-y-3"><p>El guardado pendiente se verifica con su recibo. Salir o recargar no demuestra que haya fallado.</p><button type="button" className={buttonClass} onClick={() => void c.inspectPending()}>Consultar recibo</button>{c.uncertain && <button type="button" className={buttonClass} onClick={() => void c.retryPending()}>Reintentar el mismo guardado</button>}</div>}
    {c.error && <Notice error>{c.error}</Notice>}{c.message && <p role="status">{c.message}</p>}
  </section>;
}
