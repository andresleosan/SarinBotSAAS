import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import HomePage from '@/app/page';
import StaticHome from '../landing/app/page';
import { sarinWhatsAppUrl } from '@/lib/sarin-contact';
import { BotServicePricing } from '@/components/bot-service-pricing';
import { BOT_SERVICE_PLANS, type BotServicePlan } from '@/lib/bot-service-offer';

const links = (html: string) => [...html.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)].map(match => ({ href: match[1], label: match[2].replace(/<[^>]*>/g, '').trim() }));

describe('Sarin Bot service landing', () => {
  it('presents the chatbot service at root with contact and secondary administration access', () => {
    const html = renderToStaticMarkup(createElement(HomePage));
    expect(html).toContain('Un chatbot para atender a tus clientes.');
    expect(links(html)).toContainEqual({ href: sarinWhatsAppUrl, label: 'Cotizar mi chatbot' });
    expect(links(html)).toContainEqual({ href: '/admin', label: 'Administración' });
    expect(html).not.toMatch(/Sarin Bot Admin Hub|Prueba pagada|SarinBot Esencial|\$5\.000/);
  });

  it('exports the same service with the approved absolute administration destination', () => {
    const html = renderToStaticMarkup(createElement(StaticHome));
    expect(html).toContain('Un chatbot para atender a tus clientes.');
    expect(links(html)).toContainEqual({ href: 'https://sarinbotsaas.pages.dev/admin', label: 'Administración' });
    expect(links(html).some(link => /^\/admin|\/dashboard/.test(link.href))).toBe(false);
    const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]));
    for (const link of links(html).filter(link => link.href.startsWith('#'))) expect(ids.has(link.href.slice(1))).toBe(true);
  });

  it('uses contact-only pricing when no chatbot plans have been approved', () => {
    const html = renderToStaticMarkup(createElement(BotServicePricing, { plans: [] }));
    expect(html).toContain('Una cotización para tu negocio');
    expect(html).toContain('Consultar opciones y precios');
    expect(html).not.toMatch(/\$|COP|700 respuestas|10 citas/);
  });

  it('shows supplied chatbot prices, limits and setup charges without appointment entitlements', () => {
    const plan: BotServicePlan = { id: 'synthetic-web', name: 'Plan sintético de prueba', priceCOP: 42000, periodLabel: 'mes', includedResponses: 123, setupPriceCOP: 20000, features: ['Prestación sintética'] };
    const html = renderToStaticMarkup(createElement(BotServicePricing, { plans: [plan] }));
    expect(html).toContain('Plan sintético de prueba');
    expect(html).toContain('$42.000 COP');
    expect(html).toContain('por mes');
    expect(html).toContain('123 respuestas incluidas');
    expect(html).toContain('Configuración inicial: $20.000 COP');
    expect(html).toContain('Prestación sintética');
    expect(html).not.toContain('citas');
    expect(links(html)).toContainEqual({ href: sarinWhatsAppUrl, label: 'Consultar plan' });
  });

  it('does not assume a response allowance or an included setup when they are unspecified', () => {
    const plan: BotServicePlan = { id: 'synthetic', name: 'Plan de prueba', priceCOP: 10000, periodLabel: 'semana', features: [] };
    const html = renderToStaticMarkup(createElement(BotServicePricing, { plans: [plan] }));
    expect(html).toContain('$10.000 COP');
    expect(html).not.toMatch(/respuestas incluidas|Configuración inicial/);
  });

  it('publishes the approved response tiers and leaves custom projects quoted by scope', () => {
    expect(BOT_SERVICE_PLANS.map(plan => [plan.id, plan.priceCOP, plan.includedResponses])).toEqual([['inicio', 49900, 1000], ['negocio', 99900, 3000], ['crecimiento', 199900, 8000], ['a-medida', null, undefined]]);
    const html = renderToStaticMarkup(createElement(BotServicePricing));
    expect(html).toContain('data-offer-status="approved"');
    expect(html).not.toMatch(/Propuesta de precios|Pendiente de aprobación/);
    expect(html).toContain('según la dificultad del proyecto');
    expect(html).toContain('Cotizar según alcance');
    expect(html).toContain('Chatbot y mascota personalizados para tu marca');
    expect(html).toContain('Nombre, personalidad e identidad propios');
    expect(html).toContain('Sin cobros automáticos');
    expect(links(html).filter(link => link.label === 'Consultar plan')).toHaveLength(4);
    expect(html).not.toMatch(/ilimitad|acumula|24\/7/i);
  });
});
