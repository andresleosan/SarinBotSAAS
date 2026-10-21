"use client";

import { usePublicCommercialOffer } from '@/lib/client/use-public-commercial-offer';

const price = (value: number) => value.toLocaleString('es-CO');

export function MarketingPricing({ endpoint }: { endpoint: string | null }) {
  const { offer, loading, error, refresh } = usePublicCommercialOffer(endpoint);
  if (!offer) return (
    <div role="status" aria-live="polite" aria-busy={loading} data-offer-state={loading ? 'loading' : 'unavailable'} className="agenda-launch-note">
      <p>{loading ? 'Consultando tarifas vigentes…' : 'Consulta el precio vigente.'}{error && ' No pudimos cargar las tarifas.'}</p>
      {endpoint && !loading && <button type="button" onClick={refresh} className="agenda-text-link min-h-11">Reintentar</button>}
    </div>
  );
  return (
    <div data-offer-state="ready">
      <ul className="agenda-steps">
        {offer.plans.map(plan => <li key={plan.id}>
          <h3>{plan.label}: ${price(plan.priceCOP)} COP</h3>
          <p>{plan.periodDays} días de acceso y {price(plan.includedResponses)} respuestas de IA. Agenda, reservas por conversación, enlace del negocio y QR.</p>
        </li>)}
      </ul>
      <p className="agenda-launch-note">Los planes se pagan por transferencia y se activan tras revisar el comprobante. Una respuesta completa de SarinBot cuenta una vez. Al agotar las respuestas, la IA se pausa; tu agenda y tus citas se conservan. Con un plan vigente puedes añadir {price(offer.responsePack.responses)} respuestas por ${price(offer.responsePack.priceCOP)} COP, válidas hasta que termine ese período. Sin cobros automáticos.</p>
    </div>
  );
}
