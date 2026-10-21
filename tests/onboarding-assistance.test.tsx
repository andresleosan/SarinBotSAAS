vi.mock('@/components/consent-panel', () => ({ useAccountConsent: () => ({ active: true }) }));
import { act, createElement, type ReactNode } from 'react';
import { create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import OnboardingPage from '@/app/dashboard/onboarding/page';
import { apiFetch } from '@/lib/client/api';
import type { Business } from '@/types/firestore';
import type { BusinessConfig } from '@/lib/server/schemas';
import { businessConfigSchema } from '@/lib/server/schemas';

const business: Business = {
  id: 'fixture-business', ownerUid: 'fixture-owner', ownerEmail: 'owner@example.test',
  name: 'Negocio sintético', slug: 'negocio-sintetico', category: 'Servicios', phoneWhatsApp: '573001234567',
  timezone: 'America/Bogota', subscription: { status: 'active', trialEndsAt: 0, currentPeriodEndsAt: 2200000000000 },
  sarinConfig: { onboardingCompleted: true, tone: 'Claro', customRules: 'Indicaciones propias sin cambiar.', intakeFields: [{ key: 'original', label: 'Pregunta propia', required: true }] },
  resources: [{ id: 'principal', name: 'Profesional sintético', active: true }],
  services: [{ id: 'principal', name: 'Servicio', durationMinutes: 30, bufferMinutes: 0, price: 20000, resourceIds: ['principal'] }],
  weeklySchedule: Object.fromEntries(Array.from({ length: 7 }, (_, day) => [day, { isOpen: false, intervals: [] }])), createdAt: 2000000000000,
};
const state = vi.hoisted(() => ({ business: null as Business | null, send: vi.fn(), draft: undefined as BusinessConfig | undefined, health: false, chatMount: vi.fn() }));
vi.mock('@/hooks/useBookingDataPolicy', () => ({ useBookingDataPolicy: () => ({ ready: true, loading: false, error: null, refresh: vi.fn(), capability: { configured: true, revision: 1, dataMode: state.health ? 'health' : 'general', representedMinorsEnabled: state.health } }) }));
vi.mock('@/hooks/useBusiness', () => ({ useBusiness: () => ({ business: state.business, loading: false, error: null, setBusiness: vi.fn() }) }));
vi.mock('@/components/business-logo-field', () => ({ BusinessLogoField: () => null }));
vi.mock('@/hooks/useDebouncedChat', () => ({ useDebouncedChat: () => { state.chatMount(); return { messages: [], isWaitingBatch: false, isGenerating: false, error: null, quotaExhausted: false, requestAlreadyCompleted: false, sendMessage: state.send, configurationDraft: state.draft }; } }));
vi.mock('next/link', () => ({ default: ({ children, href }: { children: ReactNode; href: string }) => createElement('a', { href }, children) }));
vi.mock('@/components/auth-provider', () => ({ AuthGate: ({ children }: { children: ReactNode }) => children, useAuth: () => ({ user: { uid: 'fixture-owner' } }) }));
vi.mock('@/components/app-shell', () => ({ AppShell: ({ children }: { children: ReactNode }) => children, Notice: ({ children }: { children: ReactNode }) => children, fieldClass: 'field', buttonClass: 'button' }));
vi.mock('@/lib/client/api', () => ({ apiFetch: vi.fn(), errorMessage: (error: Error) => error.message }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('onboarding editable examples', () => {
  let renderer: ReactTestRenderer;
  beforeEach(() => { state.health = false; state.chatMount.mockClear(); });
  beforeEach(() => { state.business = structuredClone(business); state.draft = undefined; state.send.mockReset(); vi.mocked(apiFetch).mockReset(); vi.mocked(apiFetch).mockResolvedValue({ business }); });
  afterEach(async () => { await act(async () => renderer?.unmount()); });
  async function mount() { await act(async () => { renderer = create(createElement(OnboardingPage)); }); }
  function questionsAndInstructions() { return ['Preguntas para reservar', 'Indicaciones del negocio'].map(label => renderer.root.findByProps({ 'aria-label': label }).props.value as string); }
  it('health owner can configure manually without mounting AI or free intake', async () => {
    state.health = true; await mount(); expect(state.chatMount).not.toHaveBeenCalled();
    expect(renderer.root.findAllByProps({ 'aria-label': 'Mensaje para SarinBot' })).toHaveLength(0);
    const form = renderer.root.findByProps({ 'aria-label': 'Datos de tu negocio' });
    await act(async () => form.props.onSubmit({ preventDefault() {} }));
    expect(JSON.parse(String(vi.mocked(apiFetch).mock.calls[0][1]?.body)).intakeFields).toEqual([]); expect(state.send).not.toHaveBeenCalled();
  });
  it('applies a proposed configuration only on explicit action and preserves optional intake metadata', async () => {
    const draft = businessConfigSchema.parse({ name: 'Propuesta nueva', category: business.category, slug: business.slug, phoneWhatsApp: business.phoneWhatsApp, tone: 'Claro', customRules: '', services: business.services, resources: business.resources, weeklySchedule: business.weeklySchedule, intakeFields: [{ key: 'optional_note', label: 'Nota opcional', required: false }] }); state.draft = draft;
    await mount(); expect(vi.mocked(apiFetch)).not.toHaveBeenCalled();
    await act(async () => renderer.root.findAllByType('button').find(button => button.children.join('') === 'Usar propuesta en el formulario')!.props.onClick());
    expect(vi.mocked(apiFetch)).not.toHaveBeenCalled();
    await act(async () => renderer.root.findAllByType('form')[1].props.onSubmit({ preventDefault() {} }));
    const payload = JSON.parse(String(vi.mocked(apiFetch).mock.calls[0][1]?.body));
    expect(payload.name).toBe('Propuesta nueva'); expect(payload.intakeFields).toEqual(draft.intakeFields);
  });

  it('edits optional public service details locally and includes them only in an explicit save', async () => {
    state.business!.services = [{ ...business.services[0], description: 'Descripción publicada', category: 'Cortes' } as Business['services'][number]];
    await mount();
    const description = () => renderer.root.findByProps({ 'aria-label': 'Descripción del servicio 1' });
    const category = () => renderer.root.findByProps({ 'aria-label': 'Categoría del servicio 1' });
    expect(description().props.value).toBe('Descripción publicada');
    expect(category().props.value).toBe('Cortes');
    expect(description().props).toMatchObject({ maxLength: 300 });
    expect(category().props).toMatchObject({ maxLength: 60 });
    expect(description().props.required).not.toBe(true);
    expect(category().props.required).not.toBe(true);
    for (const field of [description(), category()]) {
      const help = renderer.root.findByProps({ id: field.props['aria-describedby'] });
      expect(help.children.join('')).toBe('Visible para tus clientes');
    }
    await act(async () => description().props.onChange({ target: { value: 'Lavado y peinado; incluye <texto literal>.' } }));
    await act(async () => category().props.onChange({ target: { value: 'Cuidado del cabello' } }));
    expect(vi.mocked(apiFetch)).not.toHaveBeenCalled();
    await act(async () => renderer.root.findByProps({ 'aria-label': 'Datos de tu negocio' }).props.onSubmit({ preventDefault() {} }));
    const payload = JSON.parse(String(vi.mocked(apiFetch).mock.calls[0][1]?.body));
    expect(payload.services).toEqual([{ ...business.services[0], description: 'Lavado y peinado; incluye <texto literal>.', category: 'Cuidado del cabello' }]);
  });

  it('allows the owner to clear service metadata while keeping the service bookable', async () => {
    state.business!.services = [{ ...business.services[0], description: 'Descripción publicada', category: 'Cortes' } as Business['services'][number]];
    await mount();
    for (const label of ['Descripción del servicio 1', 'Categoría del servicio 1']) {
      await act(async () => renderer.root.findByProps({ 'aria-label': label }).props.onChange({ target: { value: '' } }));
    }
    await act(async () => renderer.root.findByProps({ 'aria-label': 'Datos de tu negocio' }).props.onSubmit({ preventDefault() {} }));
    const payload = JSON.parse(String(vi.mocked(apiFetch).mock.calls[0][1]?.body));
    expect(payload.services).toEqual([{ ...business.services[0], description: '', category: '' }]);
  });

  it('keeps explicit metadata clears in the saved payload after applying an assistant proposal that omits them', async () => {
    state.business!.services = [{ ...business.services[0], description: 'Descripción publicada', category: 'Cortes' }];
    state.draft = businessConfigSchema.parse({ name: business.name, category: business.category, slug: business.slug, phoneWhatsApp: business.phoneWhatsApp, tone: 'Claro', customRules: '',
      services: [{ ...business.services[0], name: 'Servicio renombrado' }], resources: business.resources, weeklySchedule: business.weeklySchedule, intakeFields: [] });
    await mount();
    for (const label of ['Descripción del servicio 1', 'Categoría del servicio 1']) {
      await act(async () => renderer.root.findByProps({ 'aria-label': label }).props.onChange({ target: { value: '' } }));
    }
    await act(async () => renderer.root.findAllByType('button').find(button => button.children.join('') === 'Usar propuesta en el formulario')!.props.onClick());
    expect(vi.mocked(apiFetch)).not.toHaveBeenCalled();
    await act(async () => renderer.root.findByProps({ 'aria-label': 'Datos de tu negocio' }).props.onSubmit({ preventDefault() {} }));
    const payload = JSON.parse(String(vi.mocked(apiFetch).mock.calls[0][1]?.body));
    expect(payload.services).toEqual([{ ...business.services[0], name: 'Servicio renombrado', description: '', category: '' }]);
  });

  it('preserves stored service metadata by ID when an assistant proposal omits it', async () => {
    state.business!.services = [{ ...business.services[0], description: 'Conserva la descripción', category: 'Cortes' } as Business['services'][number]];
    state.draft = businessConfigSchema.parse({ name: business.name, category: business.category, slug: business.slug, phoneWhatsApp: business.phoneWhatsApp, tone: 'Claro', customRules: '',
      services: [{ ...business.services[0], name: 'Servicio renombrado', price: 35000 }], resources: business.resources, weeklySchedule: business.weeklySchedule, intakeFields: [] });
    await mount();
    await act(async () => renderer.root.findAllByType('button').find(button => button.children.join('') === 'Usar propuesta en el formulario')!.props.onClick());
    await act(async () => renderer.root.findByProps({ 'aria-label': 'Datos de tu negocio' }).props.onSubmit({ preventDefault() {} }));
    const payload = JSON.parse(String(vi.mocked(apiFetch).mock.calls[0][1]?.body));
    expect(payload.services).toEqual([{ ...business.services[0], name: 'Servicio renombrado', price: 35000, description: 'Conserva la descripción', category: 'Cortes' }]);
  });

  it('keeps local metadata edits when applying a proposal with reordered services and no metadata', async () => {
    const otherService = { ...business.services[0], id: 'secondary', name: 'Servicio secundario', description: 'Segunda descripción', category: 'Otros' };
    state.business!.services = [{ ...business.services[0], description: 'Primera descripción', category: 'Cortes' } as Business['services'][number], otherService];
    state.draft = businessConfigSchema.parse({ name: business.name, category: business.category, slug: business.slug, phoneWhatsApp: business.phoneWhatsApp, tone: 'Claro', customRules: '',
      services: [{ ...business.services[0], id: 'secondary', name: 'Segundo actualizado' }, { ...business.services[0], name: 'Primero actualizado' }], resources: business.resources, weeklySchedule: business.weeklySchedule, intakeFields: [] });
    await mount();
    await act(async () => renderer.root.findByProps({ 'aria-label': 'Descripción del servicio 1' }).props.onChange({ target: { value: 'Descripción local sin guardar' } }));
    await act(async () => renderer.root.findByProps({ 'aria-label': 'Categoría del servicio 1' }).props.onChange({ target: { value: 'Edición local' } }));
    await act(async () => renderer.root.findAllByType('button').find(button => button.children.join('') === 'Usar propuesta en el formulario')!.props.onClick());
    expect(renderer.root.findByProps({ 'aria-label': 'Descripción del servicio 2' }).props.value).toBe('Descripción local sin guardar');
    expect(renderer.root.findByProps({ 'aria-label': 'Categoría del servicio 2' }).props.value).toBe('Edición local');
    await act(async () => renderer.root.findByProps({ 'aria-label': 'Datos de tu negocio' }).props.onSubmit({ preventDefault() {} }));
    const payload = JSON.parse(String(vi.mocked(apiFetch).mock.calls[0][1]?.body));
    expect(payload.services.map((service: { id: string; description: string; category: string }) => [service.id, service.description, service.category])).toEqual([
      ['secondary', 'Segunda descripción', 'Otros'], ['principal', 'Descripción local sin guardar', 'Edición local'],
    ]);
    expect(vi.mocked(apiFetch)).toHaveBeenCalledTimes(1);
  });

  it('keeps existing questions and instructions on load without an automatic save', async () => {
    await mount();
    expect(questionsAndInstructions()).toEqual(['Pregunta propia', 'Indicaciones propias sin cambiar.']);
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
    expect(questionsAndInstructions()).toEqual([
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
    const [questions, instructions] = questionsAndInstructions();
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
