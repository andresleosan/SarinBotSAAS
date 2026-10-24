import { act, createElement, useEffect, type ReactNode } from 'react';
import { create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import OnboardingPage from '@/app/dashboard/onboarding/page';
import { OwnerConfigurationProvider } from '@/components/owner-configuration-provider';
import { OwnerConfigurationWorkspace } from '@/components/owner-configuration-workspace';
import { apiFetch } from '@/lib/client/api';
import type { Business } from '@/types/firestore';

const state = vi.hoisted(() => ({ business: null as Business | null, uid: 'owner', epoch: 1, ready: true, policyError: null as string | null, capability: true, consent: true, health: false, minors: false, chatMount: vi.fn(), send: vi.fn(), refresh: vi.fn() }));
vi.mock('@/hooks/useBusiness', () => ({ useBusiness: () => ({ business: state.business, loading: false, error: null, refresh: state.refresh, setBusiness: vi.fn() }) }));
vi.mock('@/hooks/useBookingDataPolicy', () => ({ useBookingDataPolicy: () => ({ ready: state.ready, error: state.policyError, refresh: vi.fn(), capability: state.capability ? { configured: true, revision: 1, dataMode: state.health ? 'health' : 'general', representedMinorsEnabled: state.minors } : null }) }));
vi.mock('@/components/consent-panel', () => ({ useAccountConsent: () => ({ active: state.consent }) }));
vi.mock('@/components/auth-provider', () => ({ AuthGate: ({ children }: { children: ReactNode }) => children, useAuth: () => ({ user: { uid: state.uid }, authEpoch: state.epoch, isCurrentSession: (uid: string, epoch: number) => uid === state.uid && epoch === state.epoch }) }));
vi.mock('@/components/app-shell', () => ({ AppShell: ({ children }: { children: ReactNode }) => children, Notice: ({ children }: { children: ReactNode }) => createElement('p', {}, children), fieldClass: 'field', buttonClass: 'button' }));
vi.mock('@/components/business-logo-field', () => ({ BusinessLogoField: () => null }));
vi.mock('@/hooks/useDebouncedChat', () => ({ useDebouncedChat: () => { useEffect(() => { state.chatMount(); }, []); return { messages: [], isGenerating: false, isWaitingBatch: false, sendMessage: state.send }; } }));
vi.mock('next/link', () => ({ default: ({ children, href }: { children: ReactNode; href: string }) => createElement('a', { href }, children) }));
vi.mock('@/lib/client/api', () => ({ apiFetch: vi.fn(), ApiError: class ApiError extends Error { constructor(message: string, public status: number) { super(message); } }, errorMessage: (error: Error) => error.message }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const text = (node: ReactTestInstance | string): string => typeof node === 'string' ? node : node.children.map(text).join('');
const fixture: Business = {
  id: 'demo-business', ownerUid: 'owner', ownerEmail: 'owner@example.test', name: 'Negocio sintético', slug: 'demo-business', category: 'Servicios', phoneWhatsApp: '573001234567', timezone: 'America/Bogota',
  subscription: { status: 'active', trialEndsAt: 0, currentPeriodEndsAt: 9999999999999 },
  sarinConfig: { onboardingCompleted: true, tone: 'Claro', customRules: 'Conservar', intakeFields: [] },
  resources: [{ id: 'r1', name: 'Recurso', active: true }], services: [{ id: 's1', name: 'Servicio', price: 25000, durationMinutes: 30, bufferMinutes: 0, resourceIds: ['r1'] }],
  location: { mode: 'at_business', address: 'Calle sintética 1', instructions: 'Entrada publicada' },
  weeklySchedule: Object.fromEntries(Array.from({ length: 7 }, (_, day) => [day, { isOpen: false, intervals: [] }])), createdAt: 1,
};

describe('business assistant scope real configuration integration', () => {
  let renderer: ReactTestRenderer;
  const view = () => createElement(OwnerConfigurationProvider, { children: createElement(OnboardingPage) });
  const mount = () => act(async () => { renderer = create(view()); });
  const update = () => act(async () => renderer.update(view()));
  const workspace = () => renderer.root.findByType(OwnerConfigurationWorkspace);
  const control = () => workspace().props.controller;
  const go = (section: string) => act(async () => control().go(section));
  const scopes = () => renderer.root.findAllByType('details').filter(node => node.findAllByType('summary').some(summary => text(summary) === 'Información y alcance de Sarin'));
  const scope = () => { expect(scopes()).toHaveLength(1); return scopes()[0]; };
  const posts = () => vi.mocked(apiFetch).mock.calls.filter(([, init]) => init?.method === 'POST');
  const expectNoEffects = () => { expect(state.chatMount).not.toHaveBeenCalled(); expect(state.send).not.toHaveBeenCalled(); expect(posts()).toHaveLength(0); };
  beforeEach(() => {
    state.business = structuredClone(fixture); state.uid = 'owner'; state.epoch = 1; state.ready = true; state.policyError = null; state.capability = true; state.consent = true; state.health = false; state.minors = false;
    state.chatMount.mockClear(); state.send.mockClear(); state.refresh.mockClear();
    vi.mocked(apiFetch).mockReset().mockImplementation(async () => ({ business: state.business }));
  });
  afterEach(async () => { await act(async () => renderer?.unmount()); });

  it('scopeIsInAssistantSection', async () => {
    await mount();
    expect(scopes()).toHaveLength(0);
    const nav = renderer.root.findByProps({ 'aria-label': 'Secciones de Mi negocio' });
    await act(async () => nav.findAllByType('button').find(button => text(button) === 'Cómo responde Sarin')!.props.onClick());
    expect(scopes()).toHaveLength(1);
    expect(renderer.root.findByProps({ 'aria-label': 'Datos de tu negocio' }).findAllByType('details')).toContain(scopes()[0]);
    expect(scopes()[0].props.open).toBeUndefined();
    expectNoEffects();
    await go('identity');
    expect(scopes()).toHaveLength(0);
  });

  it.each(['loading', 'error', 'missing capability'])('policyLoadingOrErrorDoesNotMountScope: %s', async condition => {
    await mount(); await go('assistant');
    expect(scopes()).toHaveLength(1);
    state.ready = condition === 'missing capability';
    state.policyError = condition === 'error' ? 'Clasificación no disponible' : null;
    state.capability = condition !== 'missing capability';
    await update();
    expect(scopes()).toHaveLength(0);
    expect(renderer.root.findAllByType(OwnerConfigurationWorkspace)).toHaveLength(0);
    expect(text(renderer.root)).toContain(state.policyError || 'Comprobando las opciones de configuración');
    expectNoEffects();
  });

  it('healthScopeHasNoChatEffect', async () => {
    state.health = true; state.minors = true;
    await mount(); await go('assistant');
    expect(scopes()).toHaveLength(1);
    expect(text(scopes()[0])).toContain('reservas mediante formulario, sin IA');
    expect(text(scopes()[0])).toContain('Las reservas para menores usan el formulario');
    expect(text(scopes()[0])).not.toContain('Confirmar cita');
    expect(renderer.root.findAllByType('button').filter(button => text(button) === 'Preparar con Sarin')).toHaveLength(0);
    expectNoEffects();
  });

  it('policyChangeReplacesScope', async () => {
    await mount(); await go('assistant');
    expect(text(scope())).toContain('Sarin utiliza la configuración guardada');
    state.health = true; state.minors = true;
    await update();
    expect(text(scopes()[0])).toContain('reservas mediante formulario, sin IA');
    expect(text(scopes()[0])).not.toContain('Sarin utiliza la configuración guardada');
    state.health = false; state.minors = false;
    await update();
    expect(text(scopes()[0])).toContain('Sarin utiliza la configuración guardada');
    expect(text(scopes()[0])).not.toContain('Las reservas para menores');
    expectNoEffects();
  });

  it('unsavedEditDoesNotSendOrSave', async () => {
    await mount(); await go('identity');
    await act(async () => renderer.root.findByProps({ 'aria-label': 'Indicaciones de ubicación' }).props.onChange({ target: { value: 'Ubicación aún privada' } }));
    await go('assistant');
    await act(async () => renderer.root.findAllByType('textarea').find(node => node.props['data-configuration-path'] === 'customRules')!.props.onChange({ target: { value: 'Indicaciones aún privadas' } }));
    expect(control().dirty).toBe(true);
    expect(control().session.draft.location.instructions).toBe('Ubicación aún privada');
    expect(control().session.draft.customRules).toBe('Indicaciones aún privadas');
    expect(workspace().props.business.location.instructions).toBe('Entrada publicada');
    expect(text(scope())).toContain('Los cambios que todavía estás editando no se utilizan hasta guardar.');
    expect(text(scopes()[0])).not.toMatch(/Ubicación aún privada|Indicaciones aún privadas/);
    expect(scopes()[0].findByType('summary').props.onClick).toBeUndefined();
    expectNoEffects();
  });

  it('usesSavedOnboardingStateAndKeepsConsentAndSessionGates', async () => {
    state.business!.sarinConfig.onboardingCompleted = false;
    await mount(); await go('assistant');
    expect(text(scope())).toContain('Al guardar la configuración se actualiza tu página de reservas.');
    state.consent = false;
    await update();
    expect(control().writeBlocked).toBe(true);
    expect(renderer.root.findAllByType('button').find(button => text(button) === 'Preparar con Sarin')!.props.disabled).toBe(true);
    expectNoEffects();
    state.uid = 'different-owner'; state.epoch = 2;
    await update();
    expect(scopes()).toHaveLength(0);
    expectNoEffects();
  });
});
