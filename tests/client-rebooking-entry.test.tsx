import { act, createElement, Suspense, type ReactNode } from 'react';
import { create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import ClientPage from '@/app/b/[slug]/page';
import { ClientAppointments } from '@/components/client-appointments';
import { BookingProposal } from '@/components/booking-proposal';
import { apiFetch } from '@/lib/client/api';
import { bookingSubjectContent } from '@/lib/booking-subject-legal';
import type { PublicBusiness } from '@/types/firestore';
import type { BookingSubjectCase } from '@/lib/booking-subject';
import type { WaitlistState } from '@/types/waitlist';

const state = vi.hoisted(() => ({ user: { uid: 'demo-client', displayName: 'Cliente sintético' } as { uid: string; displayName: string } | null, account: true, business: true, ready: true, health: false, minors: false, chatLock: '' }));
vi.mock('@/components/auth-provider', () => ({ useAuth: () => ({ user: state.user, signOut: vi.fn() }), AuthGate: ({ children }: { children: ReactNode }) => state.user ? children : null }));
vi.mock('@/components/consent-panel', () => ({ useAccountConsent: () => ({ active: state.account }), ConsentPanel: () => null }));
vi.mock('@/hooks/useConsent', () => ({ useConsent: () => ({ active: state.business }) }));
vi.mock('@/hooks/useBookingDataPolicy', () => ({ useBookingDataPolicy: () => ({ ready: state.ready, error: null, refresh: vi.fn(), capability: { configured: true, revision: 1, dataMode: state.health ? 'health' : 'general', representedMinorsEnabled: state.minors } }) }));
vi.mock('@/components/client-appointments', () => ({ ClientAppointments: () => createElement('section', { 'aria-label': 'Mis citas' }) }));
vi.mock('@/hooks/useDebouncedChat', () => ({ useDebouncedChat: () => ({ messages: [], isWaitingBatch: state.chatLock === 'waiting', isGenerating: state.chatLock === 'generating', confirming: state.chatLock === 'confirming', confirmationUncertain: state.chatLock === 'uncertain', quotaExhausted: false, proposal: null, error: null, sendMessage: vi.fn() }) }));
vi.mock('@/hooks/useEngineHealth', () => ({ useEngineHealth: () => ({ health: { status: 'online' }, refresh: vi.fn() }) }));
vi.mock('@/lib/client/api', async original => ({ ...await original<typeof import('@/lib/client/api')>(), apiFetch: vi.fn() }));
vi.mock('next/link', () => ({ default: ({ children, href }: { children: ReactNode; href: string }) => createElement('a', { href }, children) }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const fixture = { id: 'demo-business', slug: 'shop', name: 'Negocio sintético', category: 'Servicios', phoneWhatsApp: '573000000000', timezone: 'America/Bogota', services: [{ id: 'haircut', name: 'Corte vigente', price: 42000, durationMinutes: 40, bufferMinutes: 5, resourceIds: ['one'] }, { id: 'advice', name: 'Asesoría gratuita', price: 0, durationMinutes: 15, bufferMinutes: 0, resourceIds: ['one'] }], resources: [{ id: 'one', name: 'Profesional vigente', active: true }], weeklySchedule: {}, sarinConfig: { onboardingCompleted: true, tone: '', customRules: '', intakeFields: [] }, subscription: { status: 'active', trialEndsAt: 0, currentPeriodEndsAt: 9999999999999 } } as PublicBusiness;
let business: PublicBusiness, renderer: ReactTestRenderer | undefined, params: Promise<{ slug: string }>;
let waitlistState: WaitlistState;
const text = (node: ReactTestInstance | string): string => typeof node === 'string' ? node : node.children.map(text).join('');
const page = () => createElement(Suspense, { fallback: null }, createElement(ClientPage, { params }));
const update = () => act(async () => renderer!.update(page()));
const history = () => renderer!.root.findByType(ClientAppointments);
const field = (label: string) => renderer!.root.findByProps({ 'aria-label': label });
const button = (label: string) => renderer!.root.findAllByType('button').find(item => text(item) === label)!;
const rebook = (id = 'haircut') => act(async () => history().props.onRebook(id));
const caseIds = () => vi.mocked(apiFetch).mock.calls.filter(([path]) => path.startsWith('/api/booking-subject-consent?')).map(([path]) => new URL(path, 'http://localhost').searchParams.get('bookingRequestId'));
async function render() { await act(async () => { renderer = create(page()); }); }
async function choose(label: string, value: string) { await act(async () => field(label).props.onChange({ target: { value } })); }

beforeEach(() => {
  state.user = { uid: 'demo-client', displayName: 'Cliente sintético' }; state.account = true; state.business = true; state.ready = true; state.health = false; state.minors = false; state.chatLock = '';
  business = { ...fixture }; params = Promise.resolve({ slug: 'shop' });
  waitlistState = { businessId: business.id, ownerUid: 'demo-client', revision: 0, serverNow: Date.now(), request: null };
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ business })));
  vi.mocked(apiFetch).mockImplementation(async path => {
    if (path.endsWith('/waitlist')) return waitlistState;
    if (!path.startsWith('/api/booking-subject-consent?')) throw new Error('A fresh booking entry must only read its subject consent');
    const query = new URL(path, 'http://localhost').searchParams;
    const kind = query.get('subjectKind') as BookingSubjectCase['subjectKind'];
    const subjectCase: BookingSubjectCase = kind === 'represented_minor'
      ? { bookingRequestId: query.get('bookingRequestId')!, subjectKind: kind, representativeRole: 'parent' }
      : { bookingRequestId: query.get('bookingRequestId')!, subjectKind: 'self' };
    const capability = { configured: true, revision: 1, dataMode: state.health ? 'health' as const : 'general' as const, representedMinorsEnabled: state.minors };
    return { required: state.health || kind === 'represented_minor', active: false, revision: 0, capability, receipt: null, documents: { ...bookingSubjectContent(business, subjectCase, capability), fingerprint: 'a'.repeat(64) } };
  });
});
afterEach(async () => { await act(async () => renderer?.unmount()); renderer = undefined; vi.useRealTimers(); vi.unstubAllGlobals(); vi.mocked(apiFetch).mockReset(); });

it('starts a fresh calendar case with current catalog data and no historical booking details or automatic mutations', async () => {
  await render();
  expect(history().props.services).toEqual(business.services);
  expect(history().props.rebookingEnabled).toBe(true);
  const before = caseIds().at(-1);
  await choose('Servicio de la reserva', 'advice');
  await choose('Recurso de la reserva', 'one');
  await choose('Día de la reserva', '2030-02-02');
  await rebook();
  expect(field('Servicio de la reserva').props.value).toBe('haircut');
  expect(field('Recurso de la reserva').props.value).toBe('');
  expect(field('Día de la reserva').props.value).not.toBe('2030-02-02');
  expect(text(field('Detalles del servicio'))).toContain('42.000 COP');
  expect(text(field('Detalles del servicio'))).toContain('40 minutos');
  expect(caseIds().at(-1)).not.toBe(before);
  expect(renderer!.root.findAllByProps({ 'aria-pressed': true }).map(text)).not.toContain('Hablar con SarinBot');
  expect(vi.mocked(apiFetch).mock.calls.every(([path, init]) => (path.startsWith('/api/booking-subject-consent?') || path.endsWith('/waitlist')) && !init?.method)).toBe(true);
});

it('consumes each history choice once and does not restore it after manual changes or another case', async () => {
  await render(); await rebook('advice');
  expect(field('Servicio de la reserva').props.value).toBe('advice');
  expect(text(field('Detalles del servicio'))).toContain('0 COP');
  const first = caseIds().at(-1);
  await choose('Servicio de la reserva', 'haircut'); await update();
  expect(field('Servicio de la reserva').props.value).toBe('haircut');
  expect(caseIds().at(-1)).toBe(first);
  await act(async () => button('Iniciar otra reserva').props.onClick());
  expect(field('Servicio de la reserva').props.value).toBe('');
  await rebook('advice');
  expect(field('Servicio de la reserva').props.value).toBe('advice');
  expect(caseIds().at(-1)).not.toBe(first);
});

it.each(['account', 'business', 'ready', 'subscription'] as const)('blocks new history entry at the %s gate without remounting the current case', async gate => {
  vi.useFakeTimers(); await render(); await choose('Servicio de la reserva', 'advice');
  const retained = history().props.onRebook, initial = caseIds().at(-1);
  if (gate === 'subscription') { business = { ...fixture, subscription: { ...fixture.subscription, status: 'suspended' } }; await act(async () => { await vi.advanceTimersByTimeAsync(15000); }); }
  else { state[gate] = false; await update(); }
  expect(history().props.rebookingEnabled).toBe(false);
  await act(async () => retained('haircut'));
  expect(caseIds().at(-1)).toBe(initial);
  if (gate === 'subscription') expect(field('Servicio de la reserva').props.value).toBe('advice');
  else { state[gate] = true; await update(); expect(field('Servicio de la reserva').props.value).toBe('advice'); }
});

it('rejects a removed service against the current catalog even through a retained callback', async () => {
  vi.useFakeTimers(); await render();
  const retained = history().props.onRebook, initial = caseIds().at(-1);
  business = { ...fixture, services: [fixture.services[1]] };
  await act(async () => { await vi.advanceTimersByTimeAsync(15000); });
  await act(async () => retained('haircut'));
  expect(field('Servicio de la reserva').props.value).toBe('');
  expect(caseIds().at(-1)).toBe(initial);
});

it('preserves the current case and blocks rebooking while the catalog cannot be refreshed', async () => {
  vi.useFakeTimers(); await render(); await choose('Servicio de la reserva', 'advice');
  const retained = history().props.onRebook, initial = caseIds().at(-1);
  vi.mocked(fetch).mockRejectedValueOnce(new Error('Fallo sintético de lectura'));
  await act(async () => { await vi.advanceTimersByTimeAsync(15000); });
  expect(history().props.rebookingEnabled).toBe(false);
  await act(async () => retained('haircut'));
  expect(caseIds().at(-1)).toBe(initial);
  expect(field('Servicio de la reserva').props.value).toBe('advice');
});

it('preserves an uncertain structured confirmation and its exact retry while rebooking is blocked', async () => {
  await render(); await rebook();
  const subjectRead = vi.mocked(apiFetch).getMockImplementation()!;
  const proposal = { id: 'demo-proposal', businessId: business.id, serviceName: 'Corte vigente', resourceName: 'Profesional vigente', dateKey: '2030-01-01', startTimeStr: '09:00', endTimeStr: '09:40', priceCOP: 42000, intakeFields: [] };
  const confirmations: { path: string; body: string }[] = [];
  let finishProposal!: (value: unknown) => void;
  vi.mocked(apiFetch).mockImplementation(async (path, init, uid) => {
    if (path.endsWith('/availability')) return { availability: [{ resourceId: 'one', resourceName: 'Profesional vigente', slots: ['09:00'] }] };
    if (path.endsWith('/booking-proposals')) return new Promise(resolve => { finishProposal = resolve; });
    if (path.endsWith('/confirm')) { confirmations.push({ path, body: init!.body as string }); throw new Error('Respuesta sintética perdida'); }
    return subjectRead(path, init, uid);
  });
  await act(async () => button('Consultar horarios').props.onClick());
  await act(async () => button('09:00').props.onClick());
  const retained = history().props.onRebook, initial = caseIds().at(-1);
  await act(async () => button('Revisar propuesta').props.onClick());
  expect(history().props.rebookingEnabled).toBe(false);
  await act(async () => retained('advice'));
  expect(caseIds().at(-1)).toBe(initial);
  await act(async () => finishProposal({ proposal }));
  expect(history().props.rebookingEnabled).toBe(true);
  await act(async () => renderer!.root.findByType(BookingProposal).props.onConfirm(proposal.id, { clientPhone: '573000000000', intakeAnswers: {} }));
  expect(history().props.rebookingEnabled).toBe(false);
  state.business = false; state.ready = false; await update();
  await act(async () => retained('advice'));
  expect(caseIds().at(-1)).toBe(initial);
  expect(renderer!.root.findAllByType(BookingProposal)).toHaveLength(1);
  await act(async () => button('Recuperar confirmación').props.onClick());
  expect(confirmations).toHaveLength(2);
  expect(confirmations[1]).toEqual(confirmations[0]);
});

it.each(['waiting', 'generating', 'confirming', 'uncertain'])('preserves the chat operation while %s and starts the calendar only after unlocking', async lock => {
  await render(); const retained = history().props.onRebook;
  await act(async () => button('Hablar con SarinBot').props.onClick());
  state.chatLock = lock; await update();
  expect(history().props.rebookingEnabled).toBe(false);
  await act(async () => retained('haircut'));
  expect(field('Asistente de reservas')).toBeTruthy();
  expect(renderer!.root.findAllByProps({ 'aria-label': 'Servicio de la reserva' })).toHaveLength(0);
  state.chatLock = ''; await update(); await rebook();
  expect(field('Servicio de la reserva').props.value).toBe('haircut');
});

it.each(['account', 'business'] as const)('discards the history choice and stale callback after a %s identity change', async identity => {
  vi.useFakeTimers(); await render(); await rebook();
  const retained = history().props.onRebook;
  if (identity === 'account') { state.user = { uid: 'demo-other', displayName: 'Otra cuenta' }; await update(); }
  else { business = { ...fixture, id: 'demo-other-business' }; await act(async () => { await vi.advanceTimersByTimeAsync(15000); }); }
  await act(async () => retained('haircut'));
  expect(field('Servicio de la reserva').props.value).toBe('');
});

it('starts a new health authorization and does not inherit a minor or other prior beneficiary', async () => {
  state.health = true; state.minors = true; await render();
  await choose('Destinatario de la reserva', 'represented_minor');
  const before = caseIds().at(-1);
  await rebook();
  expect(field('Destinatario de la reserva').props.value).toBe('self');
  expect(caseIds().at(-1)).not.toBe(before);
  expect(field('Permisos de esta reserva')).toBeTruthy();
  expect(renderer!.root.findAllByProps({ 'aria-label': 'Servicio de la reserva' })).toHaveLength(0);
});

function availableWaitlist(represented = false) {
  const checkedAt = Date.now();
  waitlistState = { ...waitlistState, serverNow: checkedAt, revision: 1, request: { id: 'demo-entry', serviceId: 'haircut', dateKey: '2030-02-02', resourceId: 'one', subjectKind: represented ? 'represented_minor' : 'self', ...(represented ? { representativeRole: 'legal_guardian' as const } : {}), createdAt: checkedAt, expiresAt: Date.parse('2030-02-03T05:00:00Z'), status: 'available', checkedAt } };
}
it('resumes a waitlist with fresh case and one-shot exact hints while leaving the request intact', async () => {
  vi.useFakeTimers(); vi.setSystemTime(waitlistState.serverNow + 1);
  availableWaitlist(); await render(); const before = caseIds().at(-1);
  expect(typeof history().props.onWaitlistChoose).toBe('function');
  await act(async () => history().props.onWaitlistChoose(history().props.waitlist.request, 1));
  expect(field('Servicio de la reserva').props.value).toBe('haircut'); expect(field('Día de la reserva').props.value).toBe('2030-02-02'); expect(field('Recurso de la reserva').props.value).toBe('one');
  expect(caseIds().at(-1)).not.toBe(before); expect(button('Revisar propuesta').props.disabled).toBe(true);
  expect(vi.mocked(apiFetch).mock.calls.every(([_path, init]) => !init?.method)).toBe(true);
  expect(history().props.waitlist.request.id).toBe('demo-entry');
  await act(async () => button('Iniciar otra reserva').props.onClick()); expect(field('Servicio de la reserva').props.value).toBe(''); expect(field('Día de la reserva').props.value).not.toBe('2030-02-02');
});
it('resumes represented waitlist through a new subject authorization with its role and no inherited name', async () => {
  state.minors = true; availableWaitlist(true); await render(); const before = caseIds().at(-1);
  expect(typeof history().props.onWaitlistChoose).toBe('function');
  await act(async () => history().props.onWaitlistChoose(history().props.waitlist.request, 1));
  expect(field('Calidad del representante').props.value).toBe('legal_guardian'); expect(field('Permisos de esta reserva')).toBeTruthy(); expect(caseIds().at(-1)).not.toBe(before);
  expect(renderer!.root.findAllByProps({ 'aria-label': 'Nombre breve del menor' })).toHaveLength(0);
  expect(vi.mocked(apiFetch).mock.calls.every(([_path, init]) => !init?.method)).toBe(true);
});
it.each(['account', 'business', 'ready', 'subscription', 'catalog'] as const)('blocks a retained waitlist continuation after %s gate changes', async gate => {
  vi.useFakeTimers(); availableWaitlist(); await render(); expect(typeof history().props.onWaitlistChoose).toBe('function');
  const retained = history().props.onWaitlistChoose, request = history().props.waitlist.request, before = caseIds().at(-1);
  if (gate === 'subscription') { business = { ...fixture, subscription: { ...fixture.subscription, status: 'suspended' } }; await act(async () => vi.advanceTimersByTimeAsync(15000)); }
  else if (gate === 'catalog') { business = { ...fixture, resources: [] }; await act(async () => vi.advanceTimersByTimeAsync(15000)); }
  else { state[gate] = false; await update(); }
  await act(async () => retained(request, 1)); expect(caseIds().at(-1)).toBe(before);
});
it('does not resume an any-professional request when no current service resource remains active', async () => {
  vi.useFakeTimers(); availableWaitlist(); waitlistState.request!.resourceId = null; await render();
  const retained = history().props.onWaitlistChoose, request = history().props.waitlist.request, before = caseIds().at(-1);
  business = { ...fixture, resources: fixture.resources.map(resource => ({ ...resource, active: false })) };
  await act(async () => vi.advanceTimersByTimeAsync(15000));
  await act(async () => retained(request, 1)); expect(caseIds().at(-1)).toBe(before);
});
