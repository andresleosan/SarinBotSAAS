import { act, createElement, Suspense, type ReactNode } from 'react';
import { create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, expect, it, vi } from 'vitest';
import ClientPage from '@/app/b/[slug]/page';

const state = vi.hoisted(() => ({ user: null as { uid: string } | null }));
vi.mock('@/components/auth-provider', () => ({ useAuth: () => ({ user: state.user }), AuthGate: ({ children }: { children: ReactNode }) => children }));
vi.mock('@/components/consent-panel', () => ({ useAccountConsent: () => ({ active: false }), ConsentPanel: () => null }));
vi.mock('@/hooks/useConsent', () => ({ useConsent: () => ({ active: false }) }));
vi.mock('@/hooks/useBookingDataPolicy', () => ({ useBookingDataPolicy: () => ({ ready: false, capability: null }) }));
vi.mock('@/components/client-appointments', () => ({ ClientAppointments: () => null }));
vi.mock('next/link', () => ({ default: ({ children, href }: { children: ReactNode; href: string }) => createElement('a', { href }, children) }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const text = (node: ReactTestInstance | string): string => typeof node === 'string' ? node : node.children.map(text).join('');
let renderer: ReactTestRenderer;
afterEach(async () => { await act(async () => renderer?.unmount()); vi.unstubAllGlobals(); });

it.each([false, true])('shows the same published location before booking permissions with authenticated=%s', async authenticated => {
  state.user = authenticated ? { uid: 'demo-client' } : null;
  const business = { id: 'demo-location', slug: 'demo-location', name: 'Negocio sintético', category: 'Servicios', phoneWhatsApp: '', timezone: 'America/Bogota',
    services: [], resources: [], weeklySchedule: {}, bookingAvailable: true,
    sarinConfig: { onboardingCompleted: true, tone: '', customRules: '', intakeFields: [] },
    subscription: { status: 'active', trialEndsAt: 0, currentPeriodEndsAt: 9999999999999 },
    location: { mode: 'at_business', address: 'Calle sintética 123', instructions: 'Segundo piso' },
  };
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ business })));
  await act(async () => { renderer = create(createElement(Suspense, { fallback: null }, createElement(ClientPage, { params: Promise.resolve({ slug: 'demo-location' }) }))); });
  const section = renderer.root.findAllByType('section').find(item => text(item).includes('Ubicación y modalidad'));
  expect(section, 'Published location remains visible before booking permissions').toBeDefined();
  expect(text(section!)).toContain('En el local');
  expect(text(section!)).toContain('Calle sintética 123');
  expect(text(section!)).toContain('Segundo piso');
  const directions = section!.findByType('a');
  expect(directions.props.href).toBe('https://www.google.com/maps/search/?api=1&query=Calle%20sint%C3%A9tica%20123');
  expect(directions.props).toMatchObject({ target: '_blank', rel: 'noopener noreferrer', referrerPolicy: 'no-referrer' });
});
