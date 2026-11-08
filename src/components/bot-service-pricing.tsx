import { sarinWhatsAppUrl } from '@/lib/sarin-contact';
import { BOT_SERVICE_OFFER_IS_DRAFT, BOT_SERVICE_PLANS, type BotServicePlan } from '@/lib/bot-service-offer';

const price = (value: number) => `$${value.toLocaleString('es-CO')} COP`;

export function BotServicePricing({ plans = BOT_SERVICE_PLANS, draft = BOT_SERVICE_OFFER_IS_DRAFT }: { plans?: readonly BotServicePlan[]; draft?: boolean }) {
  if (!plans.length) return <div className="bot-quote">
    <h3>Una cotización para tu negocio</h3>
    <p>Definimos el precio según el canal de atención, el volumen de respuestas y la configuración que necesites.</p>
    <a className="bot-link" href={sarinWhatsAppUrl} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">Consultar opciones y precios</a>
  </div>;
  return <div data-offer-status={draft ? 'proposal' : 'approved'}>
    {draft && <p className="bot-pricing-proposal">Propuesta de precios para revisión. Pendiente de aprobación.</p>}
    <ul className="bot-plans">{plans.map(plan => <li key={plan.id}>
      <div><h3>{plan.name}</h3><p className="bot-plan-price">{plan.priceCOP === null ? 'Cotizar según alcance' : price(plan.priceCOP)}{plan.periodLabel && <span> por {plan.periodLabel}</span>}</p>{plan.setupPriceCOP !== undefined && <p className="bot-plan-detail">{plan.setupPriceCOP === 0 ? 'Configuración inicial incluida.' : `Configuración inicial: ${price(plan.setupPriceCOP)}`}</p>}</div>
      <div>{plan.includedResponses !== undefined && <p className="bot-plan-allowance">{plan.includedResponses.toLocaleString('es-CO')} respuestas incluidas</p>}{plan.features.length > 0 && <ul>{plan.features.map(feature => <li key={feature}>{feature}</li>)}</ul>}<a className="bot-link" href={sarinWhatsAppUrl} aria-label={`Consultar plan ${plan.name}`} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">Consultar plan</a></div>
    </li>)}</ul>
    <div className="bot-pricing-terms"><p>Una respuesta completa del bot cuenta una vez. Los mensajes enviados por tus clientes no consumen ese cupo. Los planes por volumen comparten el alcance acordado para tu chatbot.</p><p>La configuración y las integraciones se cotizan antes de activar el servicio. Los cargos de WhatsApp y del proveedor de IA, cuando correspondan, se cotizan por separado. Sin cobros automáticos.</p></div>
  </div>;
}
