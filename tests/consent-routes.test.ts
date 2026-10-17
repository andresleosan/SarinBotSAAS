import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { memoryFirestore } from './memoryFirestore';
const state = vi.hoisted(() => ({ db: undefined as unknown }));
vi.mock('@/lib/firebase/admin', () => ({ getAdminDb: () => state.db }));
vi.mock('@/lib/server/auth', async () => { const { HttpError } = await import('@/lib/server/http'); return { requireUser: async (req: Request) => { if (req.headers.get('authorization') !== 'Bearer synthetic') throw new HttpError(401, 'Login'); return { uid: 'client', email: 'client@example.test' }; }, isSuperadmin: () => false }; });
import { GET, POST } from '@/app/api/consent/route';
import { GET as documents, POST as preauthorize } from '@/app/api/consent/preauthorize/route';
import { GET as session } from '@/app/api/session/route';
const request = (body?: unknown, auth = true, origin = 'http://localhost') => new Request('http://localhost/api/consent', { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', Origin: origin, ...(auth ? { Authorization: 'Bearer synthetic' } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
beforeEach(() => { state.db = memoryFirestore().db; });
afterEach(() => vi.unstubAllEnvs());
describe('consent HTTP boundaries', () => {
  it('serves public account documents without collecting identity and rejects invalid choices/origin', async () => {
    const result = await documents(); expect(result.headers.get('cache-control')).toBe('no-store');
    const { documents: doc } = await result.json();
    expect(doc.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect((await preauthorize(request({ fingerprint: doc.fingerprint, termsAccepted: true, dataAuthorized: false }, false))).status).toBe(400);
    expect((await preauthorize(request({ fingerprint: doc.fingerprint, termsAccepted: true, dataAuthorized: true }, false, 'https://foreign.test'))).status).toBe(403);
    expect((await preauthorize(request({ fingerprint: doc.fingerprint, termsAccepted: true, dataAuthorized: true }, false))).status).toBe(200);
  });
  it('authenticates reads and mutations and rejects caller-selected UID/time and malformed scopes', async () => {
    expect((await GET(request(undefined, false))).status).toBe(401);
    expect((await POST(request({}, false))).status).toBe(401);
    expect((await POST(request({ scope: 'account', action: 'accept', uid: 'other', occurredAt: 1 }))).status).toBe(400);
    expect((await GET(new Request('http://localhost/api/consent?scope=business_client', { headers: { Authorization: 'Bearer synthetic' } }))).status).toBe(400);
  });
  it('accepts the browser Host origin when Next constructs an internal localhost URL', async () => {
    const { documents: doc } = await (await documents()).json();
    const request = new Request('http://localhost:3042/api/consent/preauthorize', { method: 'POST', headers: { 'Content-Type': 'application/json', Host: '127.0.0.1:3042', Origin: 'http://127.0.0.1:3042' }, body: JSON.stringify({ fingerprint: doc.fingerprint, termsAccepted: true, dataAuthorized: true }) });
    expect((await preauthorize(request)).status).toBe(200);
  });
  it('uses the configured public origin through Pages instead of trusting its rewritten backend Host or forwarded headers', async () => {
    vi.stubEnv('NODE_ENV', 'production'); vi.stubEnv('SARIN_PUBLIC_BOOKING_ORIGIN', 'https://sarinbotsaas.pages.dev');
    const { documents: doc } = await (await documents()).json();
    const body = JSON.stringify({ fingerprint: doc.fingerprint, termsAccepted: true, dataAuthorized: true });
    const make = (origin: string) => new Request('http://internal:3000/api/consent/preauthorize', { method: 'POST', headers: { 'Content-Type': 'application/json', Host: 'runtime.synthetic.internal', Origin: origin, 'X-Forwarded-Host': 'foreign.test' }, body });
    expect((await preauthorize(make('https://sarinbotsaas.pages.dev'))).status).toBe(200);
    expect((await preauthorize(make('https://foreign.test'))).status).toBe(403);
  });
  it('session inspection never creates or modifies a profile before explicit acceptance', async () => {
    const db = state.db as ReturnType<typeof memoryFirestore>['db'];
    expect((await session(request())).status).toBe(200);
    expect((await db.collection('users').doc('client').get()).exists).toBe(false);
    await db.collection('users').doc('client').set({ uid: 'client', isSuperadmin: true, displayName: 'Preserved' });
    await session(request());
    expect((await db.collection('users').doc('client').get()).data()).toEqual({ uid: 'client', isSuperadmin: true, displayName: 'Preserved' });
  });
});
