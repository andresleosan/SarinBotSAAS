import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';
import { memoryFirestore } from './memoryFirestore';
import { privateBusinessDraft, publicBusiness } from '@/lib/server/businesses';
const state = vi.hoisted(() => ({ db: null as any }));
vi.mock('@/lib/firebase/admin', () => ({ getAdminDb: () => state.db, getAdminAuth: () => ({ verifyIdToken: async () => ({ uid: 'owner' }) }) }));
import { POST } from '@/app/api/businesses/logo/route';
import { GET } from '@/app/api/public/businesses/[slug]/logo/[sha256]/route';
beforeEach(() => { const business = { ...privateBusinessDraft({ uid: 'owner' }, Date.now()), slug: 'synthetic', sarinConfig: { onboardingCompleted: true, tone: '', customRules: '', intakeFields: [] }, subscription: { status: 'active' as const, trialEndsAt: 0, currentPeriodEndsAt: Date.now() + 86400000 } }; state.db = memoryFirestore({ [`businesses/${business.id}`]: business, 'publicBusinesses/synthetic': publicBusiness(business) }).db; });
afterEach(() => vi.unstubAllEnvs());
describe('business logo HTTP boundaries', () => {
  const request = (input: unknown, auth = true) => new Request('http://localhost/api/businesses/logo', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: 'Bearer synthetic' } : {}) }, body: JSON.stringify(input) });
  it('requires login, strict shape and streaming body limits', async () => {
    expect((await POST(request({}, false))).status).toBe(401);
    expect((await POST(request({ logoDataUrl: null, expectedSha256: null, businessId: 'other' }))).status).toBe(400);
    expect((await POST(request({ padding: 'x'.repeat(3 * 1024 * 1024) }))).status).toBe(413);
  });
  it('serves only the current normalized WebP with safe same-origin headers', async () => {
    const png = await sharp({ create: { width: 16, height: 16, channels: 3, background: 'blue' } }).png().toBuffer();
    const saved = await POST(request({ logoDataUrl: `data:image/png;base64,${png.toString('base64')}`, expectedSha256: null }));
    expect(saved.status).toBe(200);
    const { business } = await saved.json();
    const response = await GET(new Request('http://localhost'), { params: Promise.resolve({ slug: 'synthetic', sha256: business.logo.sha256 }) });
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('image/webp');
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(response.headers.get('Cross-Origin-Resource-Policy')).toBe('same-origin');
    expect(response.headers.has('Access-Control-Allow-Origin')).toBe(false);
  });
});
