import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ fail: false, rows: new Map<string, Record<string, unknown>>() }));
vi.mock('@/lib/firebase/admin', () => ({ getAdminDb: () => ({ collection: (name: string) => ({ doc: (id: string) => ({ get: async () => {
  if (state.fail) throw new Error('PRIVATE-DATABASE-DETAILS');
  return { exists: state.rows.has(`${name}/${id}`), data: () => state.rows.get(`${name}/${id}`) };
} }) }) }) }));
import * as route from '@/app/api/public/commercial-offer/route';

describe('anonymous commercial offer route', () => {
  beforeEach(() => { state.fail = false; state.rows.clear(); });
  it('serves only the current public offer without requiring login or allowing writes', async () => {
    state.rows.set('platformSettings/main', { monthlyPriceCOP: 68000, bankAccounts: [{ accountNumber: 'PRIVATE-BANK' }] });
    const response = await route.GET();
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    const offer = await response.json();
    expect(offer.plans.find((plan: { id: string }) => plan.id === 'monthly').priceCOP).toBe(68000);
    expect(Object.keys(offer).sort()).toEqual(['currency', 'plans', 'responsePack', 'trial']);
    expect(JSON.stringify(offer)).not.toMatch(/PRIVATE|bankAccounts|tunnelStatus/);
    expect(route).not.toHaveProperty('POST');
  });
  it('fails safely instead of advertising a stale price when storage fails', async () => {
    state.fail = true;
    const response = await route.GET();
    expect(response.status).toBe(503);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(JSON.stringify(await response.json())).not.toMatch(/PRIVATE|59900/);
  });
});
