import { act, createElement, type ReactNode } from 'react';
import { create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import OnboardingPage from '@/app/dashboard/onboarding/page';
import { apiFetch } from '@/lib/client/api';
import type { Business } from '@/types/firestore';

const business: Business = {
  id: 'fixture-business', ownerUid: 'fixture-owner', ownerEmail: 'owner@example.test',
  name: 'Negocio sintético', slug: 'negocio-sintetico', category: 'Servicios', phoneWhatsApp: '573001234567',
  timezone: 'America/Bogota', subscription: { status: 'trial', trialEndsAt: 2200000000000, currentPeriodEndsAt: 0 },
  sarinConfig: { onboardingCompleted: true, tone: 'Claro', customRules: 'Indicaciones propias sin cambiar.', intakeFields: [{ key: 'original', label: 'Pregunta propia', required: true }] },
  resources: [{ id: 'principal', name: 'Profesional sintético', active: true }],
  services: [{ id: 'principal', name: 'Servicio', durationMinutes: 30, bufferMinutes: 0, price: 20000, resourceIds: ['principal'] }],
  weeklySchedule: Object.fromEntries(Array.from({ length: 7 }, (_, day) => [day, { isOpen: false, intervals: [] }])), createdAt: 2000000000000,
};
vi.mock('@/hooks/useBusiness', () => ({ useBusiness: () => ({ business, loading: false, error: null }) }));
vi.mock('@/hooks/useDebouncedChat', () => ({ useDebouncedChat: () => ({ messages: [], isWaitingBatch: false, isGenerating: false, error: null, quotaExhausted: false, requestAlreadyCompleted: false }) }));
vi.mock('@/components/auth-provider', () => ({ AuthGate: ({ children }: { children: ReactNode }) => children }));
vi.mock('@/components/app-shell', () => ({ AppShell: ({ children }: { children: ReactNode }) => children, Notice: ({ children }: { children: ReactNode }) => children, fieldClass: 'field', buttonClass: 'button' }));
vi.mock('@/lib/client/api', () => ({ apiFetch: vi.fn(), errorMessage: (error: Error) => error.message }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('onboarding editable examples', () => {
  let renderer: ReactTestRenderer;
  beforeEach(() => { vi.mocked(apiFetch).mockReset(); vi.mocked(apiFetch).mockResolvedValue({ business }); });
  afterEach(async () => { await act(async () => renderer?.unmount()); });
  async function mount() { await act(async () => { renderer = create(createElement(OnboardingPage)); }); }

  it('keeps existing questions and instructions on load without an automatic save', async () => {
    await mount();
    expect(renderer.root.findAllByType('textarea').map(input => input.props.value)).toEqual(['Pregunta propia', 'Indicaciones propias sin cambiar.']);
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
      expect(choices).toHaveLength(6);
      for (const choice of choices) {
        await act(async () => group().findByProps({ 'aria-label': choice }).props.onClick());
        expect(group().findByProps({ 'aria-label': choice }).props.disabled).toBe(true);
        await act(async () => group().findByProps({ 'aria-label': choice }).props.onClick());
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
});
