import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { memoryFirestore } from './memoryFirestore';
import { privateBusinessDraft } from '@/lib/server/businesses';
const state = vi.hoisted(() => ({ db: null as any, uid: 'owner' }));
vi.mock('@/lib/firebase/admin', () => ({ getAdminDb: () => state.db, getAdminAuth: () => ({ verifyIdToken: async () => ({ uid: state.uid }) }) }));
import { GET } from '@/app/api/businesses/qr-kit/route';
const request = () => new Request('https://spoofed-preview.invalid/api/businesses/qr-kit', { headers: { Authorization: 'Bearer synthetic', Host: 'attacker.invalid', Forwarded: 'host=attacker.invalid' } });
beforeEach(() => { state.uid = 'owner'; state.db = memoryFirestore().db; vi.stubEnv('SARIN_PUBLIC_BOOKING_ORIGIN', 'https://sarinbotsaas.pages.dev'); });
afterEach(() => vi.unstubAllEnvs());
describe('own booking kit', () => {
  it('issues AgendIA links only for the explicit application and the authenticated owner', async () => {
    const value = { ...privateBusinessDraft({ uid: 'owner' }, Date.now()), slug: 'barberia-norte', sarinConfig: { onboardingCompleted: true, tone: '', customRules: '', intakeFields: [] } };
    await state.db.collection('businesses').doc(value.id).set(value);
    const make = (query: string, auth = true) => new Request(`https://untrusted.invalid/api/businesses/qr-kit${query}`, { headers: { ...(auth ? { Authorization: 'Bearer synthetic' } : {}), Host: 'attacker.invalid', 'X-Forwarded-Host': 'attacker.invalid' } });
    const response = await GET(make('?application=agendia'));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toMatchObject({ bookingUrl: 'https://agendia-app.pages.dev/b/barberia-norte', business: { id: value.id } });
    for (const query of ['?application=foreign', '?application=agendia&application=agendia', '?application=agendia&origin=https://attacker.invalid']) {
      expect((await GET(make(query))).status).toBe(400);
    }
    expect((await GET(make('?application=agendia', false))).status).toBe(401);
    state.uid = 'other';
    expect((await GET(make('?application=agendia'))).status).toBe(409);
  });
  it('kit_requires_owner and completed business, without any Host fallback', async () => {
    expect((await GET(new Request('http://localhost'))).status).toBe(401);
    expect((await GET(request())).status).toBe(409);
    const value = { ...privateBusinessDraft({ uid: 'owner' }, Date.now()), slug: 'barberia-norte', sarinConfig: { onboardingCompleted: true, tone: '', customRules: '', intakeFields: [] } };
    await state.db.collection('businesses').doc(value.id).set(value);
    const response = await GET(request());
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await response.json()).toMatchObject({ bookingUrl: 'https://sarinbotsaas.pages.dev/b/barberia-norte', business: { id: value.id } });
    await state.db.collection('businesses').doc(value.id).set({ ...value, name: 'Nuevo nombre', phoneWhatsApp: '573009999999', logo: { sha256: 'a'.repeat(64) } });
    expect((await (await GET(request())).json()).bookingUrl).toBe('https://sarinbotsaas.pages.dev/b/barberia-norte');
    state.uid = 'other'; expect((await GET(request())).status).toBe(409);
    state.uid = 'owner'; vi.stubEnv('SARIN_PUBLIC_BOOKING_ORIGIN', '');
    expect((await GET(request())).status).toBe(503);
  });
});
