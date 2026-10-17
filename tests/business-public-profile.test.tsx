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
    const services = catalog.findAllByType('li').map(textContent);
    expect(services).toEqual(['Corte y peinado65.000 COP45 minutos', 'Asesoría0 COP30 minutos']);
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
    expect(links.map(link => link.props.href)).toEqual(['tel:+573001234567', 'https://www.instagram.com/demo_estudio/', 'https://example.com/']);
    expect(links.map(textContent)).toEqual(['+573001234567', 'Instagram · @demo_estudio', 'Sitio web · example.com']);
    expect(links[1].props.rel).toBe('noopener noreferrer');
  });

  it('continues only when the visitor chooses to reserve', async () => {
    const onContinue = vi.fn();
    await act(async () => { renderer = create(createElement(BusinessPublicProfile, { profile, onContinue })); });
    const button = renderer.root.findByType('button');
    expect(textContent(button)).toBe('Reservar');
    expect(onContinue).not.toHaveBeenCalled();
    await act(async () => button.props.onClick());
    expect(onContinue).toHaveBeenCalledTimes(1);
  });

  it('keeps existing appointments accessible when new bookings are paused', async () => {
    const onContinue = vi.fn();
    await act(async () => { renderer = create(createElement(BusinessPublicProfile, { profile: { ...profile, bookingAvailable: false }, onContinue })); });
    expect(textContent(renderer.root)).toContain('Las nuevas reservas están en pausa.');
    const button = renderer.root.findByType('button');
    expect(textContent(button)).toBe('Ver mis citas');
    expect(button.props.disabled).not.toBe(true);
    await act(async () => button.props.onClick());
    expect(onContinue).toHaveBeenCalledTimes(1);
  });

  it('handles unpublished catalog and optional identity details without inventing content', async () => {
    await act(async () => { renderer = create(createElement(BusinessPublicProfile, { profile: { ...profile, logo: undefined, services: [], socialLinks: [], phoneWhatsApp: '' }, onContinue: vi.fn() })); });
    expect(textContent(renderer.root)).toContain('El negocio aún no ha publicado sus servicios.');
    expect(renderer.root.findAllByType('img')).toHaveLength(0);
    expect(renderer.root.findAllByType('a')).toHaveLength(0);
  });
});
