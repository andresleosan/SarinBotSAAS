import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Business, Appointment } from '@/types/firestore';

const state = vi.hoisted(() => ({ rows: new Map<string, Record<string, unknown>>(), queries: [] as { path: string; filters: unknown[][] }[] }));
vi.mock('@/lib/firebase/admin', () => ({ getAdminDb: () => ({ collection: (path: string) => collection(path) }) }));
vi.mock('@/lib/server/auth', () => ({ requireUser: async (request: Request) => {
  if (request.headers.get('Authorization') !== 'Bearer synthetic-client') { const { HttpError } = await import('@/lib/server/http'); throw new HttpError(401, 'Sign in'); }
  return { uid: 'client' };
} }));
vi.mock('@/lib/server/bookings', () => ({ readAppointments: vi.fn(async () => []), cancelAppointment: vi.fn(), createManualBlock: vi.fn() }));
function collection(path: string, filters: unknown[][] = []) {
  return {
    doc: (id: string) => ({ collection: (name: string) => collection(`${path}/${id}/${name}`), get: async () => ({ exists: state.rows.has(`${path}/${id}`), data: () => state.rows.get(`${path}/${id}`) }) }),
    where: (...filter: unknown[]) => collection(path, [...filters, filter]),
    get: async () => {
      state.queries.push({ path, filters });
      const rows = [...state.rows].filter(([key, row]) => key.startsWith(`${path}/`) && key.slice(path.length + 1).indexOf('/') === -1 && filters.every(([field, , value]) => (field as string).split('.').reduce((current: any, part) => current?.[part], row) === value));
      return { docs: rows.map(([key, row]) => ({ id: key.split('/').at(-1), data: () => row })) };
    },
  };
}
import { GET as publicGet } from '@/app/api/public/businesses/[slug]/route';
import { GET as appointmentsGet } from '@/app/api/businesses/[id]/appointments/route';

describe('business reads without browser database access', () => {
  beforeEach(() => { state.rows.clear(); state.queries.length = 0; });
  it('serves only a public projection without login and strips private subscription fields', async () => {
    state.rows.set('publicBusinesses/shop', { id: 'business', slug: 'shop', name: 'Public', ownerUid: 'private-owner', ownerEmail: 'private@email.invalid', createdAt: 123, subscription: { status: 'active', trialEndsAt: 0, currentPeriodEndsAt: 123, lastPaymentId: 'private-payment', paidTrial: { paymentId: 'private-receipt', activatedAt: 1, appointmentLimit: 10, appointmentsUsed: 2 } }, sarinConfig: { onboardingCompleted: true, tone: '', customRules: '', intakeFields: [] }, resources: [], services: [], weeklySchedule: {} });
    const response = await publicGet(new Request('https://sarinbotsaas.pages.dev/api/public/businesses/shop'), { params: Promise.resolve({ slug: 'shop' }) });
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    const data = await response.json();
    expect(data.business).toMatchObject({ id: 'business', name: 'Public' });
    expect(JSON.stringify(data)).not.toMatch(/private-owner|private@email|private-payment|private-receipt|createdAt/);
  });
  it('returns an explicit missing public business and rejects invalid slugs', async () => {
    expect(await (await publicGet(new Request('https://public.invalid'), { params: Promise.resolve({ slug: 'missing' }) })).json()).toEqual({ business: null });
    const bad = await publicGet(new Request('https://public.invalid'), { params: Promise.resolve({ slug: '../private' }) });
    expect(bad.status).toBe(400);
  });
  it('returns the entire client history and future appointments filtered by UID and tenant, never other clients or blocks', async () => {
    state.rows.set('businesses/business', { id: 'business' } as Business as unknown as Record<string, unknown>);
    for (let index = 0; index < 525; index++) state.rows.set(`businesses/business/appointments/own${index}`, { id: `own${index}`, tenantId: 'business', type: 'appointment', client: { uid: 'client' }, startAt: index } as Appointment as unknown as Record<string, unknown>);
    state.rows.set('businesses/business/appointments/foreign', { tenantId: 'business', type: 'appointment', client: { uid: 'other' } });
    state.rows.set('businesses/business/appointments/block', { tenantId: 'business', type: 'manual_block', client: { uid: 'client' } });
    state.rows.set('businesses/business/appointments/wrong-tenant', { tenantId: 'other-business', type: 'appointment', client: { uid: 'client' } });
    const response = await appointmentsGet(new Request('https://public.invalid/api/businesses/business/appointments?view=mine', { headers: { Authorization: 'Bearer synthetic-client' } }), { params: Promise.resolve({ id: 'business' }) });
    expect(response.status).toBe(200);
    expect((await response.json()).appointments).toHaveLength(525);
    expect(state.queries).toContainEqual({ path: 'businesses/business/appointments', filters: [['client.uid', '==', 'client']] });
  });
  it('requires login and rejects ambiguous, duplicate or unsupported appointment query parameters', async () => {
    const context = { params: Promise.resolve({ id: 'business' }) };
    expect((await appointmentsGet(new Request('https://public.invalid?view=mine'), context)).status).toBe(401);
    for (const query of ['view=all', 'view=mine&date=2026-10-16', 'view=mine&view=mine', 'date=2026-10-16&date=2026-10-17', 'date=invalid', 'view=mine&uid=other']) {
      const response = await appointmentsGet(new Request(`https://public.invalid?${query}`, { headers: { Authorization: 'Bearer synthetic-client' } }), context);
      expect(response.status, query).toBe(400);
    }
  });
});
