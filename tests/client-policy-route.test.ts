import { beforeEach, describe, expect, it, vi } from 'vitest';
import { memoryFirestore } from './memoryFirestore';
import { privateBusinessDraft } from '@/lib/server/businesses';
const state = vi.hoisted(() => ({ uid: 'owner', db: null as unknown }));
vi.mock('@/lib/server/auth', () => ({ requireUser: async () => ({ uid: state.uid }) }));
vi.mock('@/lib/firebase/admin', () => ({ getAdminDb: () => state.db }));
import { GET, PATCH } from '@/app/api/businesses/[id]/client-policy/route';
const context = { params: Promise.resolve({ id: 'policy' }) };
describe('owner-only client policy API', () => {
  beforeEach(() => { state.uid = 'owner'; state.db = memoryFirestore({ 'businesses/policy': { ...privateBusinessDraft({ uid: 'owner' }, Date.now()), id: 'policy' } }).db; });
  it('denies another owner and disallows unrecognized or duplicate query fields', async () => {
    state.uid = 'other';
    expect((await GET(new Request('https://sarin.test/api?clientUid=client'), context)).status).toBe(403);
    expect((await PATCH(new Request('https://sarin.test/api', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clientUid: 'client', blocked: true, reason: 'No' }) }), context)).status).toBe(403);
    state.uid = 'owner';
    for (const query of ['clientUid=a&clientUid=b', 'other=a']) expect((await GET(new Request(`https://sarin.test/api?${query}`), context)).status).toBe(400);
  });
  it('keeps configuration private and validates strict, bounded input', async () => {
    const response = await GET(new Request('https://sarin.test/api'), context);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ policy: { blocked: false, futureAppointmentLimit: 3, reason: null } });
    for (const body of [{ futureAppointmentLimit: 21, reason: 'Invalid' }, { futureAppointmentLimit: 3, reason: 'Valid', ownerUid: 'other' }, { reason: 'a'.repeat(5000) }]) {
      expect((await PATCH(new Request('https://sarin.test/api', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), context)).status).toBeGreaterThanOrEqual(400);
    }
  });
});
