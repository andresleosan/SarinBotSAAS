"use client";
import { useState } from 'react';
import { useAuth } from '@/components/auth-provider';
import { useClientFactualFaq } from '@/hooks/use-client-factual-faq';
export function BusinessFactualFaqPanel({ businessId, uid, enabled }: { businessId: string; uid: string; enabled: boolean }) {
  const { authEpoch } = useAuth(), c = useClientFactualFaq({ businessId, uid, authEpoch, enabled });
  const [opened, setOpened] = useState(false);
  if (!enabled) return null;
  return <details className="min-w-0 rounded-xl border border-sarin-line p-3" open={opened} onToggle={event => { const open = event.currentTarget.open; if (open === opened) return; setOpened(open); if (open) void c.loadTopics(); else c.clear(); }}>
    <summary className="min-h-11 cursor-pointer rounded-lg py-3 font-semibold focus-visible:outline-2 focus-visible:outline-sarin-blue">Información del negocio</summary>
    {opened && <div className="space-y-3 pt-3"><p className="text-sm">Elige una pregunta para consultar la respuesta publicada por el establecimiento.</p>
      {c.loading && <p role="status">Consultando información…</p>}
      {c.topics?.topics.map(item => <button key={item.topic} data-faq-topic={item.topic} type="button" className="block min-h-11 w-full rounded-lg border border-sarin-line p-3 text-left focus-visible:outline-2 focus-visible:outline-sarin-blue" onClick={() => void c.choose(item.topic)}>{item.question}</button>)}
      {c.topics?.topics.length === 0 && <p>El negocio no ha añadido respuestas para este recorrido.</p>}
      {c.answer && <section className="space-y-2 rounded-lg bg-sarin-canvas p-3"><h3 className="font-semibold">{c.answer.question}</h3><p className="text-sm text-sarin-muted">Respuesta publicada por el negocio</p><p data-faq-answer={true} className="whitespace-pre-wrap break-words">{c.answer.answer}</p></section>}
      {c.error && <p role="status">{c.error}</p>}<button type="button" className="min-h-11 rounded-lg px-3 font-semibold text-sarin-blue focus-visible:outline-2 focus-visible:outline-sarin-blue" onClick={() => void c.loadTopics()}>Actualizar información</button>
    </div>}
  </details>;
}
