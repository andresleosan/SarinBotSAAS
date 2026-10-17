import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BusinessPublicProfile } from '@/components/business-public-profile';
import type { PublicBusinessProfile } from '@/types/firestore';

const profile: PublicBusinessProfile = {
  slug: 'demo-location', name: 'Negocio sintético', category: 'Servicios', phoneWhatsApp: '',
  timezone: 'America/Bogota', services: [], weeklySchedule: {}, bookingAvailable: true,
};
function render(location?: unknown) {
  return renderToStaticMarkup(createElement(BusinessPublicProfile, {
    profile: { ...profile, location } as PublicBusinessProfile, onContinue() {},
  }));
}
afterEach(() => vi.unstubAllGlobals());

describe('public business location', () => {
  it('publishes the onsite address as plain text and an encoded external Maps search', () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    const html = render({ mode: 'at_business', address: 'Calle 7 # 8-9, Bogotá & Norte', instructions: 'Piso 2\nTocar el timbre' });
    expect(html).toContain('Ubicación y modalidad');
    expect(html).toContain('En el local');
    expect(html).toContain('Calle 7 # 8-9, Bogotá &amp; Norte');
    expect(html).toContain('Piso 2\nTocar el timbre');
    expect(html).toContain('href="https://www.google.com/maps/search/?api=1&amp;query=Calle%207%20%23%208-9%2C%20Bogot%C3%A1%20%26%20Norte"');
    expect(html).toContain('target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer"');
    expect(html).toContain('Cómo llegar');
    expect(html).not.toContain('<iframe');
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    [{ mode: 'at_business', instructions: 'Dirección por confirmar' }, 'En el local'],
    [{ mode: 'at_client', instructions: 'Consulta nuestra zona de cobertura' }, 'A domicilio'],
    [{ mode: 'online', instructions: 'Recibirás las instrucciones al reservar' }, 'En línea'],
  ])('publishes modality without inventing a map when no business address applies', (location, label) => {
    const html = render(location);
    expect(html).toContain(label);
    expect(html).toContain(location.instructions);
    expect(html).not.toContain('Cómo llegar');
    expect(html).not.toContain('google.com/maps');
  });

  it('renders address and instructions as escaped text without turning URLs into links', () => {
    const html = render({ mode: 'at_business', address: '<script>alert("dirección")</script>', instructions: '<img src=x onerror=alert(1)>\nhttps://example.test/instrucciones' });
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).toContain('https://example.test/instrucciones');
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('href="https://example.test');
    expect(html).toContain('whitespace-pre-wrap');
    expect(html).toContain('[overflow-wrap:anywhere]');
  });

  it.each([undefined, null, {}, 'Dirección antigua', { mode: 'unknown' }, { mode: 'at_business', address: 123 }, { mode: 'online', instructions: ['inválido'] }])('hides absent or malformed legacy location', location => {
    const html = render(location);
    expect(html).not.toContain('Ubicación y modalidad');
    expect(html).not.toContain('Cómo llegar');
  });
});
