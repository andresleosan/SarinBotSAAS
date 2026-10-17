import { act, createElement, Suspense, type ReactNode } from 'react';
import { create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import ClientPage from '@/app/b/[slug]/page';
import { BusinessPublicProfile } from '@/components/business-public-profile';
import { apiFetch } from '@/lib/client/api';
import { bookingSubjectContent } from '@/lib/booking-subject-legal';
import type { PublicBusiness } from '@/types/firestore';
import type { BookingSubjectCase } from '@/lib/booking-subject';

const state = vi.hoisted(() => ({ user: null as { uid: string; displayName: string } | null, accountActive: true, businessActive: false, policyReady: true, health: false }));
vi.mock('@/components/auth-provider', () => ({ useAuth: () => ({ user: state.user, signOut: vi.fn() }), AuthGate: ({ children }: { children: ReactNode }) => state.user ? children : createElement('p', null, 'Acceso con Google') }));
vi.mock('@/components/consent-panel', () => ({ useAccountConsent: () => ({ active: state.accountActive }), ConsentPanel: () => null }));
vi.mock('@/hooks/useConsent', () => ({ useConsent: () => ({ active: state.businessActive }) }));
vi.mock('@/hooks/useBookingDataPolicy', () => ({ useBookingDataPolicy: () => ({ ready: state.policyReady, error: null, refresh: vi.fn(), capability: { configured: true, revision: 1, dataMode: state.health ? 'health' : 'general', representedMinorsEnabled: false } }) }));
vi.mock('@/components/client-appointments', () => ({ ClientAppointments: () => createElement('section', { 'aria-label': 'Mis citas' }, 'Citas existentes') }));
vi.mock('@/hooks/useDebouncedChat', () => ({ useDebouncedChat: () => { throw new Error('Selecting a public service must not mount chat'); } }));
vi.mock('@/hooks/useEngineHealth', () => ({ useEngineHealth: () => { throw new Error('Selecting a public service must not mount inference health'); } }));
vi.mock('@/lib/client/api', async original => ({ ...await original<typeof import('@/lib/client/api')>(), apiFetch: vi.fn() }));
vi.mock('next/link', () => ({ default: ({ children, href }: { children: ReactNode; href: string }) => createElement('a', { href }, children) }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const fixture = { id: 'demo-business', slug: 'shop', name: 'Negocio sintético', category: 'Servicios', phoneWhatsApp: '573000000000', timezone: 'America/Bogota', services: [{ id: 'haircut', name: 'Corte clásico', price: 25000, durationMinutes: 30, bufferMinutes: 5, resourceIds: ['one'] }, { id: 'advice', name: 'Asesoría', price: 0, durationMinutes: 15, bufferMinutes: 0, resourceIds: ['one'] }], resources: [{ id: 'one', name: 'Profesional', active: true }], weeklySchedule: { 1: { isOpen: true, intervals: [{ start: '09:00', end: '17:00' }] } }, sarinConfig: { onboardingCompleted: true, tone: '', customRules: '', intakeFields: [] }, subscription: { status: 'active', trialEndsAt: 0, currentPeriodEndsAt: 9999999999999 } } as PublicBusiness;
let currentBusiness: PublicBusiness, renderer: ReactTestRenderer | undefined, params: Promise<{ slug: string }>;
const page = () => createElement(Suspense, { fallback: null }, createElement(ClientPage, { params }));
const update = () => act(async () => renderer!.update(page()));
const serviceSelect = () => renderer!.root.findByProps({ 'aria-label': 'Servicio de la reserva' });
async function start(serviceId?: string) { await act(async () => renderer!.root.findByType(BusinessPublicProfile).props.onContinue(serviceId)); }
async function login(uid = 'demo-client') { state.user = { uid, displayName: 'Cliente sintético' }; await update(); }
beforeEach(() => {
  state.user = null; state.accountActive = true; state.businessActive = false; state.policyReady = true; state.health = false;
  currentBusiness = { ...fixture }; params = Promise.resolve({ slug: 'shop' });
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ business: { ...currentBusiness, bookingAvailable: true } })));
  vi.mocked(apiFetch).mockImplementation(async path => {
    if (!path.startsWith('/api/booking-subject-consent?')) throw new Error('Preselection must not request availability or mutate bookings');
    const query = new URL(path, 'http://localhost').searchParams;
    const subjectCase: BookingSubjectCase = { bookingRequestId: query.get('bookingRequestId')!, subjectKind: 'self' };
    const capability = { configured: true, revision: 1, dataMode: state.health ? 'health' as const : 'general' as const, representedMinorsEnabled: false };
    return { required: state.health, active: false, revision: 0, capability, receipt: null, documents: { ...bookingSubjectContent(currentBusiness, subjectCase, capability), fingerprint: 'a'.repeat(64) } };
  });
});
afterEach(async () => { await act(async () => renderer?.unmount()); renderer = undefined; vi.useRealTimers(); vi.unstubAllGlobals(); vi.mocked(apiFetch).mockReset(); });
async function render() { await act(async () => { renderer = create(page()); }); }

it('carries a public service through sign-in and both prior consent gates without starting a booking', async () => {
  await render(); await start('haircut'); await login();
  expect(renderer!.root.findAllByProps({ 'aria-label': 'Servicio de la reserva' })).toHaveLength(0);
  state.businessActive = true; state.accountActive = false; await update();
  expect(renderer!.root.findAllByProps({ 'aria-label': 'Servicio de la reserva' })).toHaveLength(0);
  state.accountActive = true; state.policyReady = false; await update();
  expect(renderer!.root.findAllByProps({ 'aria-label': 'Servicio de la reserva' })).toHaveLength(0);
  state.policyReady = true; await update();
  expect(serviceSelect().props.value).toBe('haircut');
  expect(renderer!.root.findByProps({ 'aria-label': 'Recurso de la reserva' }).props.value).toBe('');
  expect(renderer!.root.findByProps({ 'aria-label': 'Detalles del servicio' })).toBeTruthy();
  expect(vi.mocked(apiFetch).mock.calls.every(([path, init]) => path.startsWith('/api/booking-subject-consent?') && !init?.method)).toBe(true);
});

it('consumes the entry choice once and leaves manual changes and new reservations in control', async () => {
  await render(); await start('haircut'); state.businessActive = true; await login();
  expect(serviceSelect().props.value).toBe('haircut');
  await act(async () => serviceSelect().props.onChange({ target: { value: 'advice' } })); await update();
  expect(serviceSelect().props.value).toBe('advice');
  await act(async () => renderer!.root.findAllByType('button').find(button => button.children.join('') === 'Iniciar otra reserva')!.props.onClick());
  expect(serviceSelect().props.value).toBe('');
});

it.each(['account', 'logout', 'business'] as const)('discards an unconsumed anonymous choice on %s change', async change => {
  await render(); await start('haircut'); await login();
  if (change === 'account') await login('demo-other-client');
  if (change === 'logout') { state.user = null; await update(); await start(); await login(); }
  if (change === 'business') { currentBusiness = { ...fixture, id: 'demo-other-business', slug: 'other' }; params = Promise.resolve({ slug: 'other' }); await update(); }
  state.businessActive = true; await update();
  expect(serviceSelect().props.value).toBe('');
});

it('discards the choice when returning to the profile and using the generic reserve action', async () => {
  await render(); await start('haircut');
  await act(async () => renderer!.root.findAllByType('button').find(button => button.children.join('') === 'Volver al negocio')!.props.onClick());
  await start(); state.businessActive = true; await login();
  expect(serviceSelect().props.value).toBe('');
});

it('discards an unconsumed choice when the business behind the same link changes', async () => {
  vi.useFakeTimers();
  await render(); await start('haircut'); await login();
  currentBusiness = { ...fixture, id: 'demo-replacement-business', name: 'Otro negocio detrás del mismo enlace' };
  await act(async () => { await vi.advanceTimersByTimeAsync(15000); });
  state.businessActive = true; await update();
  expect(serviceSelect().props.value).toBe('');
});

it('revalidates the public service against the current authenticated catalog', async () => {
  await render(); await start('haircut'); currentBusiness = { ...fixture, services: [fixture.services[1]] }; state.businessActive = true; await login();
  expect(serviceSelect().props.value).toBe('');
});

it('keeps the health subject authorization before displaying the preselected service', async () => {
  await render(); await start('haircut'); state.health = true; state.businessActive = true; await login();
  expect(renderer!.root.findAllByProps({ 'aria-label': 'Servicio de la reserva' })).toHaveLength(0);
  expect(renderer!.root.findAllByProps({ 'aria-label': 'Permisos de esta reserva' })).toHaveLength(1);
});
