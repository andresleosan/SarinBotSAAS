import { act, createElement, type ReactNode } from 'react';
import { create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import OnboardingPage from '@/app/dashboard/onboarding/page';
import { apiFetch } from '@/lib/client/api';
import type { Business } from '@/types/firestore';

const business: Business = {
  id: 'fixture-business', ownerUid: 'fixture-owner', ownerEmail: 'owner@example.test',
  name: 'Negocio sintético', slug: 'negocio-sintetico', category: 'Servicios', phoneWhatsApp: '573001234567',
  timezone: 'America/Bogota', subscription: { status: 'active', trialEndsAt: 0, currentPeriodEndsAt: 2200000000000 },
  sarinConfig: { onboardingCompleted: true, tone: 'Claro', customRules: 'Indicaciones propias sin cambiar.', intakeFields: [{ key: 'original', label: 'Pregunta propia', required: true }] },
  resources: [{ id: 'principal', name: 'Profesional sintético', active: true }],
  services: [{ id: 'principal', name: 'Servicio', durationMinutes: 30, bufferMinutes: 0, price: 20000, resourceIds: ['principal'] }],
  weeklySchedule: Object.fromEntries(Array.from({ length: 7 }, (_, day) => [day, { isOpen: false, intervals: [] }])), createdAt: 2000000000000,
};
const state = vi.hoisted(() => ({ business: null as Business | null, send: vi.fn() }));
vi.mock('@/hooks/useBusiness', () => ({ useBusiness: () => ({ business: state.business, loading: false, error: null, setBusiness: vi.fn() }) }));
vi.mock('@/components/business-logo-field', () => ({ BusinessLogoField: () => null }));
vi.mock('@/hooks/useDebouncedChat', () => ({ useDebouncedChat: () => ({ messages: [], isWaitingBatch: false, isGenerating: false, error: null, quotaExhausted: false, requestAlreadyCompleted: false, sendMessage: state.send }) }));
vi.mock('next/link', () => ({ default: ({ children, href }: { children: ReactNode; href: string }) => createElement('a', { href }, children) }));
vi.mock('@/components/auth-provider', () => ({ AuthGate: ({ children }: { children: ReactNode }) => children, useAuth: () => ({ user: { uid: 'fixture-owner' } }) }));
vi.mock('@/components/app-shell', () => ({ AppShell: ({ children }: { children: ReactNode }) => children, Notice: ({ children }: { children: ReactNode }) => children, fieldClass: 'field', buttonClass: 'button' }));
vi.mock('@/lib/client/api', () => ({ apiFetch: vi.fn(), errorMessage: (error: Error) => error.message }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('onboarding editable examples', () => {
  let renderer: ReactTestRenderer;
  beforeEach(() => { state.business = structuredClone(business); state.send.mockReset(); vi.mocked(apiFetch).mockReset(); vi.mocked(apiFetch).mockResolvedValue({ business }); });
  afterEach(async () => { await act(async () => renderer?.unmount()); });
  async function mount() { await act(async () => { renderer = create(createElement(OnboardingPage)); }); }

  it('keeps existing questions and instructions on load without an automatic save', async () => {
    await mount();
    expect(renderer.root.findAllByType('textarea').map(input => input.props.value)).toEqual(['Pregunta propia', 'Indicaciones propias sin cambiar.']);
    expect(vi.mocked(apiFetch)).not.toHaveBeenCalled();
  });
  it('does_not_reset_dirty_form_after_logo_poll and saves socials only explicitly', async () => {
    await mount();
    const name = () => renderer.root.findAllByType('input').find(input => input.props.value === 'Negocio sintético' || input.props.value === 'Edición sin guardar')!;
    await act(async () => name().props.onChange({ target: { value: 'Edición sin guardar' } }));
    state.business = { ...business, logo: { sha256: 'a'.repeat(64) }, socialLinks: [{ platform: 'instagram', url: 'https://instagram.com/server-new' }] };
    await act(async () => renderer.update(createElement(OnboardingPage)));
    expect(name().props.value).toBe('Edición sin guardar');
    expect(vi.mocked(apiFetch)).not.toHaveBeenCalled();
  });

  it('adds chosen examples independently and saves them only with the business form', async () => {
    await mount();
    await act(async () => renderer.root.findByProps({ 'aria-label': 'Añadir ejemplo: Primera visita' }).props.onClick());
    await act(async () => renderer.root.findByProps({ 'aria-label': 'Añadir ejemplo: Confirmar detalles' }).props.onClick());
    expect(renderer.root.findAllByType('textarea').map(input => input.props.value)).toEqual([
      'Pregunta propia\n¿Es tu primera visita?',
      'Indicaciones propias sin cambiar.\nConfirma el servicio y el horario antes de reservar.',
    ]);
    expect(vi.mocked(apiFetch)).not.toHaveBeenCalled();
    await act(async () => renderer.root.findAllByType('form')[1].props.onSubmit({ preventDefault() {} }));
    const [url, init] = vi.mocked(apiFetch).mock.calls[0];
    expect(url).toBe('/api/businesses');
    const payload = JSON.parse(init!.body as string);
    expect(payload.intakeFields).toEqual([
      { key: 'original', label: 'Pregunta propia', required: true },
      { key: expect.any(String), label: '¿Es tu primera visita?', required: true },
    ]);
    expect(payload.customRules).toBe('Indicaciones propias sin cambiar.\nConfirma el servicio y el horario antes de reservar.');
    expect(payload.phoneWhatsApp).toBe('573001234567');
  });

  it('lets the owner combine all six suggestions per field without duplicate lines or automatic saves', async () => {
    await mount();
    for (const label of ['Ejemplos de preguntas para reservar', 'Ejemplos de indicaciones del negocio']) {
      const group = () => renderer.root.findByProps({ 'aria-label': label });
      const choices = group().findAllByType('button').map(button => button.props['aria-label']);
      expect(choices).toHaveLength(3);
      for (const choice of choices) {
        await act(async () => group().findByProps({ 'aria-label': choice }).props.onClick());
        expect(group().findByProps({ 'aria-label': choice }).props.disabled).toBe(true);
        await act(async () => group().findByProps({ 'aria-label': choice }).props.onClick());
      }
      const moreChoices = group().findAllByType('option').filter(option => option.props.value).map(option => option.props.value);
      expect(moreChoices).toHaveLength(3);
      for (const choice of moreChoices) {
        await act(async () => group().findByType('select').props.onChange({ target: { value: choice } }));
        expect(group().findByType('select').props.value).toBe('');
        expect(group().findAllByType('option').find(option => option.props.value === choice)?.props.disabled).toBe(true);
        await act(async () => group().findByType('select').props.onChange({ target: { value: choice } }));
      }
    }
    const [questions, instructions] = renderer.root.findAllByType('textarea').map(input => input.props.value as string);
    expect(questions.split('\n')[0]).toBe('Pregunta propia');
    expect(instructions.split('\n')[0]).toBe('Indicaciones propias sin cambiar.');
    for (const value of [questions, instructions]) {
      expect(value.split('\n')).toHaveLength(7);
      expect(new Set(value.split('\n')).size).toBe(7);
    }
    expect(vi.mocked(apiFetch)).not.toHaveBeenCalled();
    await act(async () => renderer.root.findAllByType('form')[1].props.onSubmit({ preventDefault() {} }));
    const payload = JSON.parse(vi.mocked(apiFetch).mock.calls[0][1]!.body as string);
    expect(payload.intakeFields.map((field: { label: string }) => field.label)).toEqual(questions.split('\n'));
    expect(payload.intakeFields[0].key).toBe('original');
    expect(payload.customRules).toBe(instructions);
    expect(vi.mocked(apiFetch)).toHaveBeenCalledTimes(1);
  });

  it('requires an approved payment before showing configuration or sending onboarding messages', async () => {
    state.business = null;
    await mount();
    expect(renderer.root.findAllByType('form')).toHaveLength(0);
    expect(renderer.root.findAllByType('a').some(link => link.props.href === '/dashboard/billing')).toBe(true);
    expect(state.send).not.toHaveBeenCalled();
    await act(async () => renderer.unmount());
    state.business = { ...business, slug: '', subscription: { status: 'pending_payment', currentPeriodEndsAt: 0, trialEndsAt: 0 } };
    await mount();
    expect(renderer.root.findAllByType('form')).toHaveLength(0);
    expect(vi.mocked(apiFetch)).not.toHaveBeenCalled();
  });

  it('opens an approved private draft with blank editable business details and its first resource', async () => {
    state.business = { ...business, name: 'Negocio pendiente de configurar', slug: '', category: '', resources: [], services: [], sarinConfig: { ...business.sarinConfig, onboardingCompleted: false }, subscription: { status: 'trial', trialEndsAt: 0, currentPeriodEndsAt: 0, paidTrial: { paymentId: 'receipt', activatedAt: 1800000000000, appointmentLimit: 10, appointmentsUsed: 0 } } };
    await mount();
    expect(renderer.root.findByType('h1').children.join('')).toBe('Configura el espacio de tu negocio');
    const form = renderer.root.findAllByType('form')[1];
    const labels = form.findAllByType('label');
    const labelText = (node: ReactTestInstance | string): string => typeof node === 'string' ? node : node.children.map(labelText).join('');
    const name = labels.find(label => labelText(label).trim() === 'Nombre')!.findByType('input');
    expect(name.props.value).toBe('');
    expect(form.findByProps({ 'aria-label': 'Nombre del recurso 1' }).props.value).toBe('');
    expect(form.findByProps({ 'aria-label': 'Nombre del servicio 1' }).props.value).toBe('');
    await act(async () => name.props.onChange({ target: { value: 'Mi nuevo negocio' } }));
    const slug = labels.find(label => labelText(label).trim() === 'Enlace')!.findByType('input');
    expect(slug.props.value).toBe('mi-nuevo-negocio');
    expect(slug.props.readOnly).toBe(false);
    expect(vi.mocked(apiFetch)).not.toHaveBeenCalled();
  });

  it('asks an exhausted introductory owner to choose a plan instead of buying the trial again', async () => {
    state.business!.subscription = { status: 'trial', trialEndsAt: 0, currentPeriodEndsAt: 0, paidTrial: { paymentId: 'receipt', activatedAt: 1800000000000, appointmentLimit: 10, appointmentsUsed: 10 } };
    await mount();
    const content = JSON.stringify(renderer.toJSON());
    expect(content).toContain('Elige un plan para continuar');
    expect(content).not.toContain('$5.000');
    expect(renderer.root.findAllByType('form')).toHaveLength(0);
  });
});
