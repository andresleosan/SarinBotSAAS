import { act, createElement, Suspense, type ReactNode } from 'react';
import { create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ClientPage from '@/app/b/[slug]/page';
import OnboardingPage from '@/app/dashboard/onboarding/page';
import { OwnerConfigurationProvider } from '@/components/owner-configuration-provider';
import { clientAppointmentsFixture } from './client-appointments-page-fixtures';
import type { Appointment, Business, PublicBusiness } from '@/types/firestore';
import type { BookingAdmissionCapability } from '@/lib/booking-admission';
import { BOOKING_DECLARATION_TEXT } from '@/lib/booking-declaration';

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/dashboard/onboarding',
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) => createElement('a', { href }, children),
}));

const state = vi.hoisted(() => ({
  user: { uid: 'fixture-user', displayName: 'Fixture User' } as { uid: string; displayName?: string } | null,
  authEpoch: 1,
  business: null as Business | null,
  publicBusiness: null as PublicBusiness | null,
  policyReady: true,
  policyError: null as string | null,
  capability: null as BookingAdmissionCapability | null,
  accountConsent: true,
  businessConsent: true,
  apiCalls: [] as { path: string; init?: RequestInit; uid?: string }[],
}));

const sampleAppointment: Appointment = {
  id: 'apt-existing',
  tenantId: 'fixture-biz',
  resourceId: 'res-1',
  serviceId: 'srv-1',
  serviceName: 'Corte existente',
  type: 'appointment',
  status: 'confirmed',
  dateKey: '2026-11-20',
  startAt: 2177485200000,
  endAt: 2177487000000,
  reservedUntilAt: 2177487000000,
  startTimeStr: '10:00',
  endTimeStr: '10:30',
  createdBy: 'sarin_client',
  createdAt: 2177400000000,
  client: { uid: 'fixture-user', name: 'Fixture', email: 'user@example.test', intakeAnswers: {} },
};

vi.mock('@/lib/client/api', () => ({
  apiFetch: vi.fn(async (path: string, init?: RequestInit, uid?: string) => {
    state.apiCalls.push({ path, init, uid });
    if (path.includes('/booking-declaration')) {
      if (init?.method === 'PATCH') {
        const body = JSON.parse(init.body as string);
        return {
          outcome: 'applied',
          capability: {
            configured: true,
            revision: (state.capability?.revision ?? 0) + 1,
            dataMode: 'general',
            representedMinorsEnabled: false,
            admission: body.action === 'declare' ? 'active' : 'withdrawn',
            canStartBooking: body.action === 'declare',
            canUseInference: body.action === 'declare',
          },
          origin: 'owner',
          declaration: body.action === 'declare' ? { textVersion: 'general-adults-v1', receiptId: 'receipt-test' } : null,
        };
      }
      return {
        capability: state.capability ?? {
          configured: false,
          revision: 0,
          dataMode: 'general',
          representedMinorsEnabled: false,
          admission: 'classification_required',
          canStartBooking: false,
          canUseInference: false,
        },
        origin: null,
        declaration: null,
      };
    }
    if (path === '/api/businesses' && init?.method === 'POST') {
      const payload = JSON.parse(init.body as string);
      return { business: { ...state.business, ...payload, sarinConfig: { onboardingCompleted: true, intakeFields: payload.intakeFields, tone: payload.tone, customRules: payload.customRules } } };
    }
    if (path === '/api/businesses') {
      return { business: state.business };
    }
    if (path.endsWith('/appointments/query')) {
      return clientAppointmentsFixture([sampleAppointment], path, init, uid);
    }
    if (/\/appointments\/[^/]+$/.test(path)) {
      if (init?.method === 'DELETE') {
        return { appointment: { ...sampleAppointment, status: 'cancelled_by_client' } };
      }
      return { appointment: sampleAppointment };
    }
    return { appointments: [] };
  }),
  errorMessage: (error: unknown) => error instanceof Error ? error.message : 'Error',
  ApiError: class extends Error {
    constructor(msg: string, public status: number, public code?: string) { super(msg); }
  },
}));

vi.mock('@/components/auth-provider', () => ({
  AuthGate: ({ children }: { children: ReactNode }) => children,
  useAuth: () => ({
    user: state.user,
    authEpoch: state.authEpoch,
    loading: false,
    signingOut: false,
    isCurrentSession: (uid: string, epoch: number) => Boolean(state.user && state.user.uid === uid && state.authEpoch === epoch),
    signOut: vi.fn(),
  }),
}));

vi.mock('@/components/consent-panel', () => ({
  useAccountConsent: () => ({ active: state.accountConsent }),
  ConsentPanel: () => null,
}));

vi.mock('@/hooks/useConsent', () => ({
  useConsent: () => ({ active: state.businessConsent }),
}));

vi.mock('@/hooks/useBusiness', () => ({
  useBusiness: () => ({
    business: state.business,
    loading: false,
    error: null,
    refresh: vi.fn(),
    setBusiness: vi.fn(),
  }),
}));

vi.mock('@/hooks/useBookingDataPolicy', () => ({
  useBookingDataPolicy: () => ({
    ready: state.policyReady,
    loading: !state.policyReady,
    error: state.policyError,
    refresh: vi.fn(),
    capability: state.capability,
  }),
}));

vi.mock('@/components/app-shell', () => ({
  AppShell: ({ children }: { children: ReactNode }) => createElement(OwnerConfigurationProvider, null, createElement('div', { 'data-shell': true }, children)),
  Notice: ({ children, error }: { children: ReactNode; error?: boolean }) => createElement('div', { 'data-notice': error ? 'error' : 'info' }, children),
  buttonClass: 'btn-class',
  fieldClass: 'field-class',
}));

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

describe('Booking admission UI integration', () => {
  let renderer: ReactTestRenderer;

  beforeEach(() => {
    state.user = { uid: 'fixture-user', displayName: 'Fixture User' };
    state.authEpoch = 1;
    state.accountConsent = true;
    state.businessConsent = true;
    state.policyReady = true;
    state.policyError = null;
    state.apiCalls = [];

    const closedDay = { isOpen: false, intervals: [] };
    state.business = {
      id: 'fixture-biz',
      slug: 'fixture-biz',
      name: 'Negocio Test',
      category: 'Barbería',
      phoneWhatsApp: '573001234567',
      ownerUid: 'fixture-user',
      ownerEmail: 'owner@example.test',
      timezone: 'America/Bogota',
      subscription: { status: 'active', trialEndsAt: 0, currentPeriodEndsAt: 4000000000000 },
      sarinConfig: { onboardingCompleted: true, tone: 'Claro', customRules: '', intakeFields: [] },
      resources: [{ id: 'res-1', name: 'Barbero', active: true }],
      services: [{ id: 'srv-1', name: 'Corte', durationMinutes: 30, bufferMinutes: 0, price: 25000, resourceIds: ['res-1'] }],
      weeklySchedule: { 0: closedDay, 1: closedDay, 2: closedDay, 3: closedDay, 4: closedDay, 5: closedDay, 6: closedDay },
      createdAt: 1000,
    } as Business;

    state.publicBusiness = {
      id: 'fixture-biz',
      slug: 'fixture-biz',
      name: 'Negocio Test',
      category: 'Barbería',
      phoneWhatsApp: '573001234567',
      subscription: { status: 'active', currentPeriodEndsAt: 4000000000000 },
      resources: [{ id: 'res-1', name: 'Barbero' }],
      services: [{ id: 'srv-1', name: 'Corte', durationMinutes: 30, bufferMinutes: 0, price: 25000 }],
      weeklySchedule: { 0: closedDay, 1: closedDay, 2: closedDay, 3: closedDay, 4: closedDay, 5: closedDay, 6: closedDay },
    } as unknown as PublicBusiness;

    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/api/public/businesses/')) {
        return {
          ok: true,
          json: async () => ({ business: state.publicBusiness }),
        };
      }
      return { ok: false };
    }));
  });

  afterEach(async () => {
    await act(async () => { renderer?.unmount(); });
    vi.unstubAllGlobals();
  });

  const content = () => JSON.stringify(renderer.toJSON());

  it('client island preserves appointment consultation and contact links even when booking policy fails', async () => {
    state.policyReady = false;
    state.policyError = 'La configuración de reservas requiere revisión.';
    state.capability = null;

    await act(async () => {
      renderer = create(createElement(Suspense, { fallback: null }, createElement(ClientPage, { params: Promise.resolve({ slug: 'fixture-biz' }) })));
    });

    expect(content()).toContain('La configuración de reservas requiere revisión.');
    expect(content()).toContain('573001234567');
    expect(content()).toContain('Mis citas');
    expect(content()).toContain('Corte existente');
  });

  it('client island blocks new reservations when admission is classification_required but keeps existing appointments', async () => {
    state.policyReady = true;
    state.capability = {
      configured: false,
      revision: 0,
      dataMode: 'general',
      representedMinorsEnabled: false,
      admission: 'classification_required',
      canStartBooking: false,
      canUseInference: false,
    };

    await act(async () => {
      renderer = create(createElement(Suspense, { fallback: null }, createElement(ClientPage, { params: Promise.resolve({ slug: 'fixture-biz' }) })));
    });

    expect(content()).toContain('La clasificación del negocio no permite iniciar nuevas reservas en este momento');
    expect(content()).toContain('Mis citas');
    expect(content()).toContain('Corte existente');
  });

  it('owner onboarding renders declaration component and allows manual corrective editing when policy is unreadable', async () => {
    state.policyReady = false;
    state.policyError = 'La configuración de reservas requiere revisión.';
    state.capability = null;

    await act(async () => {
      renderer = create(createElement(OnboardingPage));
    });

    expect(content()).toContain('Configuración');
    expect(content()).toContain('Mi negocio');
    expect(content()).toContain('Clasificación de reservas');
    expect(content()).toContain('La configuración de reservas requiere revisión.');
  });

  it('owner can declare general services for adults in onboarding', async () => {
    state.policyReady = true;
    state.capability = {
      configured: false,
      revision: 0,
      dataMode: 'general',
      representedMinorsEnabled: false,
      admission: 'classification_required',
      canStartBooking: false,
      canUseInference: false,
    };

    await act(async () => {
      renderer = create(createElement(OnboardingPage));
    });

    expect(content()).toContain('Requiere clasificación');
    expect(content()).toContain(BOOKING_DECLARATION_TEXT);

    const checkbox = renderer.root.findByProps({ 'aria-label': 'Acepto la declaración de clasificación' });
    expect(checkbox.props.checked).toBe(false);

    await act(async () => {
      checkbox.props.onChange({ target: { checked: true } });
    });

    const declareBtn = renderer.root.findAllByType('button').find(b => b.children.includes('Declarar servicios generales para adultos'))!;
    await act(async () => {
      await declareBtn.props.onClick();
    });

    expect(content()).toContain('Clasificación activa');
    expect(content()).toContain('receipt-test');
  });
});
