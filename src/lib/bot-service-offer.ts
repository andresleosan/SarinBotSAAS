export interface BotServicePlan {
  id: string;
  name: string;
  priceCOP: number | null;
  periodLabel?: string;
  includedResponses?: number;
  setupPriceCOP?: number;
  features: readonly string[];
}

// Chatbot service prices are independent of AgendIA's appointment subscriptions.
// Approved by the service owner on 2026-11-07, independently of appointment plans.
export const BOT_SERVICE_OFFER_IS_DRAFT = false;
export const BOT_SERVICE_PLANS: readonly BotServicePlan[] = [
  { id: 'inicio', name: 'Inicio', priceCOP: 49900, periodLabel: '30 días', includedResponses: 1000, features: [] },
  { id: 'negocio', name: 'Negocio', priceCOP: 99900, periodLabel: '30 días', includedResponses: 3000, features: [] },
  { id: 'crecimiento', name: 'Crecimiento', priceCOP: 199900, periodLabel: '30 días', includedResponses: 8000, features: [] },
  { id: 'a-medida', name: 'A medida', priceCOP: null, features: ['Chatbot y mascota personalizados para tu marca.', 'Nombre, personalidad e identidad propios.', 'Alcance, volumen e integraciones cotizados según la dificultad del proyecto.'] },
];
