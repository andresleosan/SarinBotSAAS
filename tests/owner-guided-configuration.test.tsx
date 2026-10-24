import { act, createElement, type ReactNode } from 'react';
import { create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import OnboardingPage from '@/app/dashboard/onboarding/page';
import { OwnerConfigurationProvider } from '@/components/owner-configuration-provider';
import { apiFetch, ApiError } from '@/lib/client/api';
import { OwnerConfigurationWorkspace } from '@/components/owner-configuration-workspace';
import type { Business } from '@/types/firestore';

const state = vi.hoisted(() => ({ business: null as Business | null, error: null as string | null, uid: 'owner', epoch: 1, ready: true, consent: true, health: false, minors: false, refresh: vi.fn() }));
vi.mock('@/hooks/useBusiness', () => ({ useBusiness: () => ({ business: state.business, loading: false, error: state.error, refresh: state.refresh, setBusiness: vi.fn() }) }));
vi.mock('@/hooks/useBookingDataPolicy', () => ({ useBookingDataPolicy: () => ({ ready: state.ready, error: null, refresh: vi.fn(), capability: { configured: true, revision: 1, dataMode: state.health ? 'health' : 'general', representedMinorsEnabled: state.minors } }) }));
vi.mock('@/components/consent-panel', () => ({ useAccountConsent: () => ({ active: state.consent }) }));
vi.mock('@/components/auth-provider', () => ({ AuthGate: ({ children }: { children: ReactNode }) => children, useAuth: () => ({ user: { uid: state.uid }, authEpoch: state.epoch, isCurrentSession: (uid: string, epoch: number) => uid === state.uid && epoch === state.epoch }) }));
vi.mock('@/components/app-shell', () => ({ AppShell: ({ children }: { children: ReactNode }) => children, Notice: ({ children }: { children: ReactNode }) => createElement('p', {}, children), fieldClass: 'field', buttonClass: 'button' }));
vi.mock('@/components/business-logo-field', () => ({ BusinessLogoField: () => createElement('input', { 'aria-label': 'Logo privado' }) }));
vi.mock('@/hooks/useDebouncedChat', () => ({ useDebouncedChat: () => ({ messages: [], isGenerating: false, isWaitingBatch: false }) }));
vi.mock('next/link', () => ({ default: ({ children, href }: { children: ReactNode; href: string }) => createElement('a', { href }, children) }));
vi.mock('@/lib/client/api', () => ({ apiFetch: vi.fn(), ApiError: class ApiError extends Error { constructor(message: string, public status: number) { super(message); } }, errorMessage: (error: Error) => error.message }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const fixture: Business = {
  id: 'demo-business', ownerUid: 'owner', ownerEmail: 'owner@example.test', name: 'Negocio', slug: 'demo-business', category: 'Servicios', phoneWhatsApp: '573001234567', timezone: 'America/Bogota',
  subscription: { status: 'active', trialEndsAt: 0, currentPeriodEndsAt: 9999999999999 },
  sarinConfig: { onboardingCompleted: true, tone: 'Claro', customRules: 'Conservar', intakeFields: [{ key: 'q1', label: 'Pregunta', required: false }] },
  resources: [{ id: 'r1', name: 'Recurso', active: true }], services: [{ id: 's1', name: 'Servicio', price: 25000, durationMinutes: 30, bufferMinutes: 0, resourceIds: ['r1'] }],
  weeklySchedule: Object.fromEntries(Array.from({ length: 7 }, (_, day) => [day, { isOpen: false, intervals: [] }])), createdAt: 1,
};
describe('owner guided configuration integration', () => {
  let renderer: ReactTestRenderer;
  beforeEach(() => { state.business = structuredClone(fixture); state.error = null; state.uid = 'owner'; state.epoch = 1; state.ready = true; state.consent = true; state.health = false; state.minors = false; state.refresh.mockClear(); vi.mocked(apiFetch).mockReset().mockImplementation(async (_path, init) => { if (init?.method !== 'POST') return { business: state.business }; const payload = JSON.parse(String(init.body)); const next = { ...state.business!, ...payload, sarinConfig: { onboardingCompleted: true, tone: payload.tone, customRules: payload.customRules, intakeFields: payload.intakeFields } }; return { business: next }; }); });
  afterEach(async () => { await act(async () => renderer?.unmount()); });
  const view = (show = true) => createElement(OwnerConfigurationProvider, { children: show ? createElement(OnboardingPage) : null });
  const workspace = () => renderer.root.findByType(OwnerConfigurationWorkspace);
  const control = () => workspace().props.controller;
  const posts = () => vi.mocked(apiFetch).mock.calls.filter(([, init]) => init?.method === 'POST');
  const mount = () => act(async () => { renderer = create(view()); });
  const update = () => act(async () => renderer.update(view()));
  it('does not mount an AI conversation until the owner explicitly chooses it', async () => {
    await act(async () => { renderer = create(createElement(OwnerConfigurationProvider, { children: createElement(OnboardingPage) })); });
    expect(renderer.root.findAllByProps({ 'aria-label': 'Mensaje para SarinBot' })).toHaveLength(0);
  });

  it('verifies ownership with a fresh read before rendering private configuration or logo', async () => {
    let resolve!: (value: unknown) => void;
    vi.mocked(apiFetch).mockReturnValueOnce(new Promise(done => { resolve = done; }));
    await mount();
    expect(renderer.root.findAllByType(OwnerConfigurationWorkspace)).toHaveLength(0);
    expect(renderer.root.findAllByProps({ 'aria-label': 'Logo privado' })).toHaveLength(0);
    await act(async () => resolve({ business: fixture }));
    expect(workspace().props.business.name).toBe('Negocio');
  });

  it('saves a complete configuration and preserves unedited sections and identifiers', async () => {
    await mount();
    await act(async () => control().go('services'));
    const before = control().session.draft;
    await act(async () => control().change({ ...before, services: [{ ...before.services[0], price: 35000 }] }));
    expect(posts()).toHaveLength(0);
    await act(async () => control().review());
    await act(async () => control().save());
    expect(posts()).toHaveLength(1);
    const payload = JSON.parse(String(posts()[0][1]?.body));
    expect(payload).toMatchObject({ name: 'Negocio', slug: 'demo-business', category: 'Servicios', phoneWhatsApp: '573001234567', tone: 'Claro', customRules: 'Conservar', intakeFields: [{ key: 'q1', label: 'Pregunta', required: false }], resources: [{ id: 'r1', name: 'Recurso', active: true }], services: [{ id: 's1', price: 35000, resourceIds: ['r1'] }] });
    expect(payload.weeklySchedule).toEqual(fixture.weeklySchedule);
    expect(state.refresh).toHaveBeenCalledTimes(1);
    const labels = renderer.root.findAllByType('button').map(button => button.children.join(''));
    expect(labels.join(' ')).not.toMatch(/Publicar|Guardar borrador/);
  });

  it('retains the draft and section across SPA back while requiring a new verification', async () => {
    await mount();
    await act(async () => control().change({ ...control().session.draft, name: 'Edicion privada' }));
    await act(async () => control().go('services'));
    await act(async () => renderer.update(view(false)));
    let resolve!: (value: unknown) => void;
    vi.mocked(apiFetch).mockReturnValueOnce(new Promise(done => { resolve = done; }));
    await update();
    expect(renderer.root.findAllByType(OwnerConfigurationWorkspace)).toHaveLength(0);
    expect(renderer.root.findAllByProps({ 'aria-label': 'Logo privado' })).toHaveLength(0);
    await act(async () => resolve({ business: fixture }));
    expect(control().session.draft.name).toBe('Edicion privada');
    expect(control().session.section).toBe('services');
  });

  it('masks a cached owner immediately on a poll error and uses a typed probe without parsing text', async () => {
    await mount();
    await act(async () => control().change({ ...control().session.draft, name: 'Borrador protegido' }));
    state.error = 'Mensaje opaco sin codigo de estado';
    vi.mocked(apiFetch).mockRejectedValueOnce(new ApiError('Acceso retirado', 403));
    await update();
    expect(renderer.root.findAllByType(OwnerConfigurationWorkspace)).toHaveLength(0);
    expect(renderer.root.findAllByProps({ 'aria-label': 'Logo privado' })).toHaveLength(0);
    state.error = null;
    await update();
    expect(control().session.draft.name).toBe('Negocio');
  });

  it('keeps a network-protected draft hidden until both the fresh probe and poll recover', async () => {
    await mount();
    await act(async () => control().change({ ...control().session.draft, name: 'Borrador protegido' }));
    state.error = '403 en texto no demuestra perdida de propiedad';
    vi.mocked(apiFetch).mockRejectedValueOnce(new Error('Sin red'));
    await update();
    expect(renderer.root.findAllByType(OwnerConfigurationWorkspace)).toHaveLength(0);
    await act(async () => renderer.root.findAllByType('button').find(button => button.children.join('').startsWith('Reintentar verific'))!.props.onClick());
    expect(renderer.root.findAllByType(OwnerConfigurationWorkspace)).toHaveLength(0);
    state.error = null;
    await update();
    expect(control().session.draft.name).toBe('Borrador protegido');
  });

  it('does not treat the stale original poll cache as a publication after a fresher entry read', async () => {
    vi.mocked(apiFetch).mockResolvedValueOnce({ business: { ...fixture, name: 'Publicado mas reciente' } });
    await mount();
    expect(control().session.draft.name).toBe('Publicado mas reciente');
    expect(control().session.external).toBeNull();
    await act(async () => control().change({ ...control().session.draft, name: 'Mi edicion' }));
    await update();
    expect(control().session.external).toBeNull();
  });

  it('observes a real external publication without silently overwriting local changes', async () => {
    await mount();
    await act(async () => control().change({ ...control().session.draft, name: 'Mi edicion' }));
    state.business = { ...fixture, name: 'Otra vista' };
    await update();
    expect(control().session.draft.name).toBe('Mi edicion');
    expect(control().session.external.name).toBe('Otra vista');
    await act(async () => control().save());
    expect(posts()).toHaveLength(0);
  });

  it('does not give a new auth session the previous draft', async () => {
    await mount();
    await act(async () => control().change({ ...control().session.draft, name: 'Secreto de otra sesion' }));
    state.epoch = 2;
    await update();
    expect(control().session.draft.name).toBe('Negocio');
  });

  it('keeps the logo save independent from a dirty aggregate configuration', async () => {
    await mount();
    await act(async () => control().change({ ...control().session.draft, name: 'Mi edicion' }));
    state.business = { ...fixture, logo: { sha256: 'a'.repeat(64) } };
    await update();
    expect(control().session.draft.name).toBe('Mi edicion');
    expect(control().session.external).toBeNull();
  });

  it('keeps the editor and AI unmounted when policy is not ready', async () => {
    state.ready = false;
    await mount();
    expect(renderer.root.findAllByType(OwnerConfigurationWorkspace)).toHaveLength(0);
    expect(renderer.root.findAllByProps({ 'aria-label': 'Mensaje para SarinBot' })).toHaveLength(0);
    expect(posts()).toHaveLength(0);
  });

  it.each(['pending_payment', 'suspended'] as const)('preserves the %s commercial gate without an active editor', async status => {
    state.business = { ...fixture, subscription: { status, trialEndsAt: 0, currentPeriodEndsAt: 0 } };
    await mount();
    expect(renderer.root.findAllByType(OwnerConfigurationWorkspace)).toHaveLength(0);
    expect(renderer.root.findAllByType('a').some(link => link.props.href === '/dashboard/billing')).toBe(true);
    expect(posts()).toHaveLength(0);
  });
  it('purges a same-session deleted business before a late successful POST can return', async () => {
    await mount();
    await act(async () => control().change({ ...control().session.draft, name: 'Edicion enviada' }));
    let resolvePost!: (value: unknown) => void;
    vi.mocked(apiFetch).mockImplementation(async (_path, init) => {
      if (init?.method === 'POST') return new Promise(done => { resolvePost = done; });
      return { business: state.business };
    });
    await act(async () => control().save());
    expect(control().busy).toBe(true);
    state.business = null;
    await update();
    expect(renderer.root.findAllByType(OwnerConfigurationWorkspace)).toHaveLength(0);
    expect(renderer.root.findAllByProps({ 'aria-label': 'Logo privado' })).toHaveLength(0);
    await act(async () => resolvePost({ business: { ...fixture, name: 'Edicion enviada' } }));
    expect(renderer.root.findAllByType(OwnerConfigurationWorkspace)).toHaveLength(0);
    state.business = fixture;
    await update();
    expect(control().session.draft.name).toBe('Negocio');
    expect(control().session.pendingCommand).toBeNull();
  });

  it.each(['paid', 'invitation'] as const)('preserves valid %s trial access without changing its limits', async source => {
    const paidTrial: NonNullable<Business['subscription']['paidTrial']> = source === 'invitation'
      ? { source: 'invitation', invitationId: 'synthetic', accessSuspended: false, activatedAt: 1, appointmentLimit: 10, appointmentsUsed: 0 }
      : { source: 'payment', paymentId: 'synthetic', activatedAt: 1, appointmentLimit: 10, appointmentsUsed: 0 };
    state.business = { ...fixture, subscription: { status: 'trial', trialEndsAt: 0, currentPeriodEndsAt: 0, paidTrial } };
    await mount();
    expect(control().writeBlocked).toBe(false);
    expect(workspace().props.business.subscription.paidTrial.appointmentLimit).toBe(10);
    expect(posts()).toHaveLength(0);
  });

  it.each(['health', 'minors'] as const)('excludes restricted intake from the aggregate %s payload', async policy => {
    state.health = policy === 'health'; state.minors = policy === 'minors';
    await mount();
    await act(async () => control().save());
    expect(JSON.parse(String(posts()[0][1]?.body)).intakeFields).toEqual([]);
    expect(JSON.parse(String(posts()[0][1]?.body)).tone).toBe('Claro');
    expect(JSON.parse(String(posts()[0][1]?.body)).customRules).toBe('Conservar');
  });

  it('blocks aggregate commands when consent is absent', async () => {
    state.consent = false;
    await mount();
    expect(control().writeBlocked).toBe(true);
    await act(async () => control().change({ ...control().session.draft, name: 'No autorizado' }));
    await act(async () => control().save());
    expect(control().session.draft.name).toBe('Negocio');
    expect(posts()).toHaveLength(0);
  });

  it('revokes a wrong-owner observation even when the cached business tuple is unchanged', async () => {
    await mount();
    await act(async () => control().change({ ...control().session.draft, name: 'Borrador anterior' }));
    state.business = { ...fixture, ownerUid: 'another-owner' };
    await update();
    expect(renderer.root.findAllByType(OwnerConfigurationWorkspace)).toHaveLength(0);
    state.business = fixture;
    await update();
    expect(renderer.root.findAllByType(OwnerConfigurationWorkspace)).toHaveLength(0);
    await act(async () => renderer.root.findAllByType('button').find(button => button.children.join('').startsWith('Reintentar verific'))!.props.onClick());
    expect(control().session.draft.name).toBe('Negocio');
  });

});
