import { act, createElement, type ReactNode } from 'react';
import { create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import OnboardingPage from '@/app/dashboard/onboarding/page';
import { apiFetch } from '@/lib/client/api';
import type { Business } from '@/types/firestore';
import type { BusinessConfig } from '@/lib/server/schemas';
import { businessConfigSchema } from '@/lib/server/schemas';

const fixture: Business = {
  id: 'demo-location', ownerUid: 'demo-owner', ownerEmail: 'owner@example.test',
  name: 'Negocio sintético', slug: 'demo-location', category: 'Servicios', phoneWhatsApp: '573001234567',
  timezone: 'America/Bogota', subscription: { status: 'active', trialEndsAt: 0, currentPeriodEndsAt: 9999999999999 },
  sarinConfig: { onboardingCompleted: true, tone: 'Claro', customRules: '', intakeFields: [] },
  resources: [{ id: 'principal', name: 'Profesional sintético', active: true }],
  services: [{ id: 'principal', name: 'Servicio', durationMinutes: 30, bufferMinutes: 0, price: 20000, resourceIds: ['principal'] }],
  weeklySchedule: Object.fromEntries(Array.from({ length: 7 }, (_, day) => [day, { isOpen: false, intervals: [] }])), createdAt: 2000000000000,
};
const state = vi.hoisted(() => ({ business: null as Business | null, draft: undefined as BusinessConfig | undefined, setBusiness: vi.fn() }));
vi.mock('@/hooks/useBusiness', () => ({ useBusiness: () => ({ business: state.business, loading: false, error: null, setBusiness: state.setBusiness }) }));
vi.mock('@/hooks/useBookingDataPolicy', () => ({ useBookingDataPolicy: () => ({ ready: true, capability: { configured: true, revision: 1, dataMode: 'general', representedMinorsEnabled: false } }) }));
vi.mock('@/components/consent-panel', () => ({ useAccountConsent: () => ({ active: true }) }));
vi.mock('@/components/auth-provider', () => ({ AuthGate: ({ children }: { children: ReactNode }) => children, useAuth: () => ({ user: { uid: 'demo-owner' } }) }));
vi.mock('@/components/business-logo-field', () => ({ BusinessLogoField: () => null }));
vi.mock('@/components/app-shell', () => ({ AppShell: ({ children }: { children: ReactNode }) => children, Notice: ({ children }: { children: ReactNode }) => children, fieldClass: 'field', buttonClass: 'button' }));
vi.mock('@/hooks/useDebouncedChat', () => ({ useDebouncedChat: () => ({ messages: [], configurationDraft: state.draft, isGenerating: false, isWaitingBatch: false, quotaExhausted: false }) }));
vi.mock('next/link', () => ({ default: ({ children, href }: { children: ReactNode; href: string }) => createElement('a', { href }, children) }));
vi.mock('@/lib/client/api', () => ({ apiFetch: vi.fn(), errorMessage: (error: Error) => error.message }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const text = (node: ReactTestInstance | string): string => typeof node === 'string' ? node : node.children.map(text).join('');

describe('owner location publication', () => {
  let renderer: ReactTestRenderer;
  const field = (label: string) => renderer.root.findByProps({ 'aria-label': label });
  const choose = (value: string) => act(async () => field('Modalidad de atención').props.onChange({ target: { value } }));
  const change = (label: string, value: string) => act(async () => field(label).props.onChange({ target: { value } }));
  const save = () => act(async () => renderer.root.findByProps({ 'aria-label': 'Datos de tu negocio' }).props.onSubmit({ preventDefault() {} }));
  const payload = () => JSON.parse(String(vi.mocked(apiFetch).mock.calls.at(-1)?.[1]?.body));
  const update = () => act(async () => renderer.update(createElement(OnboardingPage)));
  async function mount() { await act(async () => { renderer = create(createElement(OnboardingPage)); }); }
  beforeEach(() => {
    state.business = structuredClone(fixture); state.draft = undefined; state.setBusiness.mockReset();
    vi.mocked(apiFetch).mockReset(); vi.mocked(apiFetch).mockResolvedValue({ business: fixture });
  });
  afterEach(async () => { await act(async () => renderer?.unmount()); });

  it('starts unpublished with optional fields and saves location only on explicit action', async () => {
    await mount();
    expect(field('Modalidad de atención').props.value).toBe('');
    expect(renderer.root.findAllByProps({ 'aria-label': 'Dirección del local' })).toHaveLength(0);
    expect(text(renderer.root)).toContain('Esta información se mostrará en tu ficha pública');
    await choose('at_business');
    expect(field('Dirección del local').props).toMatchObject({ maxLength: 200 });
    expect(field('Dirección del local').props.required).not.toBe(true);
    expect(field('Indicaciones de ubicación').props).toMatchObject({ maxLength: 500 });
    expect(field('Indicaciones de ubicación').props.required).not.toBe(true);
    await change('Dirección del local', 'Calle sintética 123');
    await change('Indicaciones de ubicación', 'Piso 2\nTocar el timbre');
    expect(apiFetch).not.toHaveBeenCalled();
    await save();
    expect(payload().location).toEqual({ mode: 'at_business', address: 'Calle sintética 123', instructions: 'Piso 2\nTocar el timbre' });
  });

  it('hydrates the stored location and saves owner edits', async () => {
    state.business = { ...fixture, location: { mode: 'at_business', address: 'Dirección publicada', instructions: 'Piso 1' } } as Business;
    await mount();
    expect(field('Modalidad de atención').props.value).toBe('at_business');
    expect(field('Dirección del local').props.value).toBe('Dirección publicada');
    expect(field('Indicaciones de ubicación').props.value).toBe('Piso 1');
    await change('Dirección del local', 'Dirección nueva');
    await save();
    expect(payload().location).toEqual({ mode: 'at_business', address: 'Dirección nueva', instructions: 'Piso 1' });
  });

  it('drops the onsite address when changing modality and clears the full location when unpublished', async () => {
    state.business = { ...fixture, location: { mode: 'at_business', address: 'Dirección publicada', instructions: 'Consultar al reservar' } } as Business;
    await mount(); await choose('at_client'); await save();
    expect(payload().location).toEqual({ mode: 'at_client', instructions: 'Consultar al reservar' });
    expect(renderer.root.findAllByProps({ 'aria-label': 'Dirección del local' })).toHaveLength(0);
    await choose('at_business');
    expect(field('Dirección del local').props.value).toBe('');
    await choose('online'); await save();
    expect(payload().location).toEqual({ mode: 'online', instructions: 'Consultar al reservar' });
    await choose(''); await save();
    expect(payload().location).toBeNull();
    await choose('at_business');
    expect(field('Dirección del local').props.value).toBe('');
    expect(field('Indicaciones de ubicación').props.value).toBe('');
  });

  it('ignores malformed legacy location rather than fabricating public details', async () => {
    state.business = { ...fixture, location: { mode: 'at_business', address: 123 } } as unknown as Business;
    await mount();
    expect(field('Modalidad de atención').props.value).toBe('');
    expect(apiFetch).not.toHaveBeenCalled();
    await save(); expect(payload().location).toBeNull();
  });

  it('preserves unsaved location edits when a business poll updates other published fields', async () => {
    state.business = { ...fixture, location: { mode: 'at_business', address: 'Dirección publicada' } } as Business;
    await mount(); await change('Dirección del local', 'Edición local');
    state.business = { ...state.business, name: 'Nombre remoto', location: { mode: 'online', instructions: 'Nueva modalidad remota' } } as Business;
    await update();
    expect(field('Dirección del local').props.value).toBe('Edición local');
    await save(); expect(payload().location).toEqual({ mode: 'at_business', address: 'Edición local' });
  });

  it('refreshes location from a business poll when the form has no local changes', async () => {
    await mount();
    state.business = { ...fixture, location: { mode: 'online', instructions: 'Conexión por confirmar' } } as Business;
    await update();
    expect(field('Modalidad de atención').props.value).toBe('online');
    expect(field('Indicaciones de ubicación').props.value).toBe('Conexión por confirmar');
  });

  it.each(['edit', 'remove'] as const)('preserves a local %s when an assistant proposal omits location', async action => {
    state.business = { ...fixture, location: { mode: 'at_business', address: 'Dirección publicada' } } as Business;
    state.draft = businessConfigSchema.parse({ name: fixture.name, slug: fixture.slug, category: fixture.category, phoneWhatsApp: fixture.phoneWhatsApp,
      tone: 'Claro', customRules: '', resources: fixture.resources, services: fixture.services, weeklySchedule: fixture.weeklySchedule, intakeFields: [] });
    await mount();
    if (action === 'remove') await choose(''); else await change('Dirección del local', 'Edición local');
    await act(async () => renderer.root.findAllByType('button').find(button => text(button) === 'Usar propuesta en el formulario')!.props.onClick());
    await save();
    expect(payload().location).toEqual(action === 'remove' ? null : { mode: 'at_business', address: 'Edición local' });
  });
});
