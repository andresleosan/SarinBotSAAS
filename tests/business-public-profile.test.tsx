import { act, createElement } from 'react';
import { create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BusinessPublicProfile } from '@/components/business-public-profile';
import type { PublicBusinessProfile } from '@/types/firestore';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const profile: PublicBusinessProfile = {
  slug: 'demo-estudio', name: 'Estudio sintético', category: 'Peluquería',
  phoneWhatsApp: '573001234567', timezone: 'America/Bogota',
  logo: { sha256: 'a'.repeat(64) },
  socialLinks: [{ platform: 'instagram', url: 'https://www.instagram.com/demo_estudio/' }, { platform: 'website', url: 'https://example.com/' }],
  services: [
    { id: 'cut', name: 'Corte y peinado', price: 65000, durationMinutes: 45 },
    { id: 'advice', name: 'Asesoría', price: 0, durationMinutes: 30 },
  ],
  weeklySchedule: {
    0: { isOpen: false, intervals: [] },
    1: { isOpen: true, intervals: [{ start: '08:00', end: '12:00' }, { start: '14:00', end: '18:30' }] },
    6: { isOpen: true, intervals: [{ start: '09:00', end: '13:00' }] },
  },
  bookingAvailable: true,
};

function textContent(node: ReactTestInstance): string {
  return node.children.map(child => typeof child === 'string' ? child : textContent(child)).join('');
}

describe('public business profile', () => {
  let renderer: ReactTestRenderer;
  afterEach(async () => { await act(async () => renderer?.unmount()); });

  it('presents the business identity and catalog without an account or auth provider', async () => {
    await act(async () => { renderer = create(createElement(BusinessPublicProfile, { profile, onContinue: vi.fn() })); });
    expect(renderer.root.findByType('h1').children).toEqual(['Estudio sintético']);
    expect(textContent(renderer.root)).toContain('Peluquería');
    expect(textContent(renderer.root)).toContain('Corte y peinado');
    expect(renderer.root.findAllByType('input')).toHaveLength(0);
    expect(renderer.root.findAllByType('form')).toHaveLength(0);
    expect(renderer.root.findByType('img').props).toMatchObject({
      src: `/api/public/businesses/demo-estudio/logo/${'a'.repeat(64)}`,
      alt: 'Logo de Estudio sintético',
    });
  });

  it('pairs each service with its fixed COP price and duration, including a zero price', async () => {
    await act(async () => { renderer = create(createElement(BusinessPublicProfile, { profile, onContinue: vi.fn() })); });
    const catalog = renderer.root.findByProps({ 'aria-label': 'Servicios del negocio' });
    const services = catalog.findAllByType('li').map(card => ({ name: textContent(card.findByType('h3')), details: card.findAllByType('p').map(textContent) }));
    expect(services).toEqual([{ name: 'Corte y peinado', details: ['65.000 COP', '45 minutos'] }, { name: 'Asesoría', details: ['0 COP', '30 minutos'] }]);
  });

  it('shows each published service description as plain text alongside its price and duration', async () => {
    const services = [{ ...profile.services[0], description: 'Lavado y peinado.\n<strong>Texto literal</strong>' }, { ...profile.services[1], description: '' }];
    await act(async () => { renderer = create(createElement(BusinessPublicProfile, { profile: { ...profile, services }, onContinue: vi.fn() })); });
    const cards = renderer.root.findByProps({ 'aria-label': 'Servicios del negocio' }).findAllByType('li');
    expect(cards[0].findAllByType('p').map(textContent)).toEqual(['Lavado y peinado.\n<strong>Texto literal</strong>', '65.000 COP', '45 minutos']);
    expect(cards[0].findAllByType('strong')).toHaveLength(0);
    expect(cards[1].findAllByType('p').map(textContent)).toEqual(['0 COP', '30 minutos']);
  });

  it('groups categories in first appearance order, merging case and NFC equivalents without reordering services', async () => {
    const services = [
      { ...profile.services[0], category: ' Cortes ' },
      { ...profile.services[1] },
      { ...profile.services[0], id: 'color', name: 'Color completo', category: 'Coloración' },
      { ...profile.services[0], id: 'trim', name: 'Retoque de corte', category: 'cortes' },
      { ...profile.services[0], id: 'highlights', name: 'Mechas', category: 'COLORACIO\u0301N' },
      { ...profile.services[1], id: 'dry', name: 'Secado', category: '   ' },
    ];
    await act(async () => { renderer = create(createElement(BusinessPublicProfile, { profile: { ...profile, services }, onContinue: vi.fn() })); });
    const catalog = renderer.root.findByProps({ 'aria-label': 'Servicios del negocio' });
    expect(catalog.findAllByType('h3').map(textContent)).toEqual(['Cortes', 'Sin categoría', 'Coloración']);
    expect(catalog.findAllByType('ul').map(list => list.findAllByType('h4').map(textContent))).toEqual([
      ['Corte y peinado', 'Retoque de corte'], ['Asesoría', 'Secado'], ['Color completo', 'Mechas'],
    ]);
    expect(catalog.findAllByType('li')).toHaveLength(6);
  });

  it('retains the flat catalog for legacy services and empty categories', async () => {
    const services = [{ ...profile.services[0], category: '' }, { ...profile.services[1], category: '   ' }];
    await act(async () => { renderer = create(createElement(BusinessPublicProfile, { profile: { ...profile, services }, onContinue: vi.fn() })); });
    const catalog = renderer.root.findByProps({ 'aria-label': 'Servicios del negocio' });
    expect(catalog.findAllByType('ul')).toHaveLength(1);
    expect(catalog.findAllByType('h3').map(textContent)).toEqual(['Corte y peinado', 'Asesoría']);
    expect(catalog.findAllByType('h4')).toHaveLength(0);
  });

  it('shows Colombia opening hours with split intervals, closed days and unpublished days', async () => {
    await act(async () => { renderer = create(createElement(BusinessPublicProfile, { profile, onContinue: vi.fn() })); });
    const schedule = renderer.root.findByProps({ 'aria-label': 'Horario del negocio' });
    expect(textContent(schedule)).toContain('Colombia');
    const days = schedule.findAllByType('li').map(textContent);
    expect(days[0]).toBe('Lunes08:00–12:0014:00–18:30');
    expect(days[1]).toBe('MartesSin horario publicado');
    expect(days[5]).toBe('Sábado09:00–13:00');
    expect(days[6]).toBe('DomingoCerrado');
  });

  it('offers the published telephone and normalized social links', async () => {
    await act(async () => { renderer = create(createElement(BusinessPublicProfile, { profile, onContinue: vi.fn() })); });
    const contact = renderer.root.findByProps({ 'aria-label': 'Contacto del negocio' });
    const links = contact.findAllByType('a');
    expect(links.map(link => link.props.href)).toEqual(['tel:+573001234567', 'https://wa.me/573001234567', 'https://www.instagram.com/demo_estudio/', 'https://example.com/']);
    expect(links.map(textContent)).toEqual(['+573001234567', 'Escribir por WhatsApp', 'Instagram · @demo_estudio', 'Sitio web · example.com']);
    expect(links[1].props.rel).toBe('noopener noreferrer');
    expect(links[1].props.referrerPolicy).toBe('no-referrer');
  });

  it.each([{ socialLinks: [] }, { socialLinks: profile.socialLinks }])('does not publish callable links from a malformed stored phone, with social links=%j', async ({ socialLinks }) => {
    await act(async () => { renderer = create(createElement(BusinessPublicProfile, { profile: { ...profile, phoneWhatsApp: '1234-5678', socialLinks }, onContinue: vi.fn() })); });
    expect(renderer.root.findAllByType('a').map(link => link.props.href)).toEqual((socialLinks ?? []).map(link => link.url));
    expect(renderer.root.findAllByProps({ 'aria-label': 'Contacto del negocio' })).toHaveLength(socialLinks?.length ? 1 : 0);
  });

  it('continues only when the visitor chooses to reserve', async () => {
    const onContinue = vi.fn();
    await act(async () => { renderer = create(createElement(BusinessPublicProfile, { profile, onContinue })); });
    const button = renderer.root.findAllByType('button').find(item => textContent(item) === 'Reservar')!;
    expect(textContent(button)).toBe('Reservar');
    expect(onContinue).not.toHaveBeenCalled();
    await act(async () => button.props.onClick({ type: 'click' }));
    expect(onContinue.mock.calls).toEqual([[]]);
  });

  it.each([false, true])('continues with the exact service ID from each service button, grouped=%s', async grouped => {
    const onContinue = vi.fn();
    const services = [
      { ...profile.services[0], ...(grouped ? { category: 'Cortes' } : {}) },
      { ...profile.services[1] },
      { ...profile.services[0], id: 'long', name: 'Servicio extenso de cuidado y peinado con caracteres Unicode: áéíóú ñ — <texto literal>', ...(grouped ? { category: 'cortes' } : {}) },
    ];
    await act(async () => { renderer = create(createElement(BusinessPublicProfile, { profile: { ...profile, services }, onContinue })); });
    const catalog = renderer.root.findByProps({ 'aria-label': 'Servicios del negocio' });
    expect(catalog.findAllByType('button')).toHaveLength(3);
    expect(onContinue).not.toHaveBeenCalled();
    for (const name of ['Corte y peinado', 'Asesoría', 'Servicio extenso de cuidado y peinado con caracteres Unicode: áéíóú ñ — <texto literal>']) {
      const button = catalog.findByProps({ 'aria-label': `Reservar este servicio: ${name}` });
      expect(textContent(button)).toBe('Reservar este servicio');
      expect(button.props['aria-label']).toContain(textContent(button));
      await act(async () => button.props.onClick({ type: 'click' }));
    }
    expect(onContinue.mock.calls).toEqual([['cut'], ['advice'], ['long']]);
  });

  it('keeps existing appointments accessible when new bookings are paused', async () => {
    const onContinue = vi.fn();
    await act(async () => { renderer = create(createElement(BusinessPublicProfile, { profile: { ...profile, bookingAvailable: false }, onContinue })); });
    expect(textContent(renderer.root)).toContain('Las nuevas reservas están en pausa.');
    expect(renderer.root.findByProps({ 'aria-label': 'Servicios del negocio' }).findAllByType('button')).toHaveLength(0);
    const button = renderer.root.findAllByType('button').find(item => textContent(item) === 'Ver mis citas')!;
    expect(textContent(button)).toBe('Ver mis citas');
    expect(button.props.disabled).not.toBe(true);
    await act(async () => button.props.onClick({ type: 'click' }));
    expect(onContinue.mock.calls).toEqual([[]]);
  });

  it('handles unpublished catalog and optional identity details without inventing content', async () => {
    await act(async () => { renderer = create(createElement(BusinessPublicProfile, { profile: { ...profile, logo: undefined, services: [], socialLinks: [], phoneWhatsApp: '' }, onContinue: vi.fn() })); });
    expect(textContent(renderer.root)).toContain('El negocio aún no ha publicado sus servicios.');
    expect(renderer.root.findAllByType('img')).toHaveLength(0);
    expect(renderer.root.findAllByType('a')).toHaveLength(0);
  });
});
