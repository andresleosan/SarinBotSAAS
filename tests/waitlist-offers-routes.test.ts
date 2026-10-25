import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { HttpError } from '@/lib/server/http';
import { WaitlistOfferModelError } from '@/lib/waitlist-offers';
import * as ownerCreate from '@/app/api/businesses/[id]/owner-waitlist/[recordId]/offers/route';
import * as ownerContext from '@/app/api/businesses/[id]/owner-waitlist/[recordId]/offer-context/route';
import * as ownerQuery from '@/app/api/businesses/[id]/owner-waitlist/offers/query/route';
import * as ownerRead from '@/app/api/businesses/[id]/owner-waitlist/offers/[offerId]/route';
import * as ownerWithdraw from '@/app/api/businesses/[id]/owner-waitlist/offers/[offerId]/withdraw/route';
import * as ownerClose from '@/app/api/businesses/[id]/owner-waitlist/offers/[offerId]/close-expired/route';
import * as clientCurrent from '@/app/api/businesses/[id]/waitlist/offer/route';
import * as clientRead from '@/app/api/businesses/[id]/waitlist/offers/[offerId]/route';
import * as clientProposal from '@/app/api/businesses/[id]/waitlist/offers/[offerId]/proposal/route';
import * as clientConfirm from '@/app/api/businesses/[id]/waitlist/offers/[offerId]/confirm/route';
import * as clientDecline from '@/app/api/businesses/[id]/waitlist/offers/[offerId]/decline/route';
import * as clientClose from '@/app/api/businesses/[id]/waitlist/offers/[offerId]/close-expired/route';

const state = vi.hoisted(() => ({ verify: vi.fn(), actor: { uid: 'demo-session-actor', email: 'synthetic@example.test' } }));
const domain = vi.hoisted(() => ({
  createOwnerWaitlistOffer: vi.fn(), readOwnerWaitlistOfferContext: vi.fn(), readOwnerWaitlistOffers: vi.fn(), readOwnerWaitlistOffer: vi.fn(),
  withdrawOwnerWaitlistOffer: vi.fn(), closeExpiredWaitlistOffer: vi.fn(), readCurrentClientWaitlistOffer: vi.fn(), readClientWaitlistOffer: vi.fn(),
  prepareClientWaitlistOffer: vi.fn(), confirmClientWaitlistOffer: vi.fn(), declineClientWaitlistOffer: vi.fn(),
}));
vi.mock('@/lib/firebase/admin', () => ({ getAdminAuth: () => ({ verifyIdToken: state.verify }) }));
vi.mock('@/lib/server/waitlist-offers', () => domain);
type Context = { params: Promise<{ id: string; recordId: string; offerId: string }> };
type Handler = (request: Request, context: Context) => Promise<Response> | Response;
type Route = { runtime: string; dynamic: string } & Partial<Record<'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS', Handler>>;
const createBody = { requestId: 'demo-create-offer', entryId: 'demo-entry', expectedWaitlistRevision: 1, expectedHeadRevision: 0, selection: { resourceId: 'demo-resource', startTimeStr: '09:00' } };
const confirmBody = { confirm: true, clientPhone: null, intakeAnswers: ['invalid fresh contact'] };
const cases: { route: Route; method: 'GET' | 'POST'; path: string; name: keyof typeof domain; body?: Record<string, unknown>; cap?: number; args: unknown[] }[] = [
  { route: ownerCreate, method: 'POST', path: 'owner-waitlist/demo-record/offers', name: 'createOwnerWaitlistOffer', body: createBody, cap: 2048, args: ['demo-business', 'demo-record', createBody] },
  { route: ownerContext, method: 'GET', path: 'owner-waitlist/demo-record/offer-context', name: 'readOwnerWaitlistOfferContext', args: ['demo-business', 'demo-record'] },
  { route: ownerQuery, method: 'POST', path: 'owner-waitlist/offers/query', name: 'readOwnerWaitlistOffers', body: { dateKey: '2030-01-07', filter: 'all' }, cap: 2048, args: ['demo-business', { dateKey: '2030-01-07', filter: 'all' }] },
  { route: ownerRead, method: 'GET', path: 'owner-waitlist/offers/demo-offer', name: 'readOwnerWaitlistOffer', args: ['demo-business', 'demo-offer'] },
  { route: ownerWithdraw, method: 'POST', path: 'owner-waitlist/offers/demo-offer/withdraw', name: 'withdrawOwnerWaitlistOffer', body: { withdraw: true }, cap: 1024, args: ['demo-business', 'demo-offer'] },
  { route: ownerClose, method: 'POST', path: 'owner-waitlist/offers/demo-offer/close-expired', name: 'closeExpiredWaitlistOffer', body: { closeExpired: true }, cap: 1024, args: ['demo-business', 'demo-offer', 'owner'] },
  { route: clientCurrent, method: 'GET', path: 'waitlist/offer', name: 'readCurrentClientWaitlistOffer', args: ['demo-business'] },
  { route: clientRead, method: 'GET', path: 'waitlist/offers/demo-offer', name: 'readClientWaitlistOffer', args: ['demo-business', 'demo-offer'] },
  { route: clientProposal, method: 'POST', path: 'waitlist/offers/demo-offer/proposal', name: 'prepareClientWaitlistOffer', body: { requestId: 'demo-prepare-offer' }, cap: 1024, args: ['demo-business', 'demo-offer', { requestId: 'demo-prepare-offer' }] },
  { route: clientConfirm, method: 'POST', path: 'waitlist/offers/demo-offer/confirm', name: 'confirmClientWaitlistOffer', body: confirmBody, cap: 16384, args: ['demo-business', 'demo-offer', { clientPhone: null, intakeAnswers: ['invalid fresh contact'] }] },
  { route: clientDecline, method: 'POST', path: 'waitlist/offers/demo-offer/decline', name: 'declineClientWaitlistOffer', body: { decline: true }, cap: 1024, args: ['demo-business', 'demo-offer'] },
  { route: clientClose, method: 'POST', path: 'waitlist/offers/demo-offer/close-expired', name: 'closeExpiredWaitlistOffer', body: { closeExpired: true }, cap: 1024, args: ['demo-business', 'demo-offer', 'client'] },
];
const context = (patch: Partial<{ id: string; recordId: string; offerId: string }> = {}): Context => ({ params: Promise.resolve({ id: 'demo-business', recordId: 'demo-record', offerId: 'demo-offer', ...patch }) });
const requestFor = (row: typeof cases[number], raw = row.body === undefined ? undefined : JSON.stringify(row.body), suffix = '', headers: Record<string, string> = {}) => new Request(`http://localhost/api/businesses/demo-business/${row.path}${suffix}`, {
  method: row.method, headers: { Authorization: 'Bearer synthetic', ...(row.method === 'POST' ? { 'Content-Type': 'application/json' } : {}), ...headers }, ...(raw === undefined ? {} : { body: raw }),
});
const invoke = (row: typeof cases[number], request = requestFor(row), ctx = context()) => row.route[row.method]!(request, ctx);
const resetCalls = () => { for (const mock of Object.values(domain)) mock.mockClear(); state.verify.mockClear(); };
const noDomainCalls = () => { for (const mock of Object.values(domain)) expect(mock).not.toHaveBeenCalled(); };
beforeEach(() => {
  state.verify.mockReset().mockResolvedValue(state.actor);
  for (const [name, mock] of Object.entries(domain)) mock.mockReset().mockResolvedValue({ domainResult: name, nested: { preserved: true } });
});
afterEach(() => { vi.unstubAllEnvs(); });

it.each(cases)('$method $path forwards the authenticated actor and exact command, returning the direct domain result', async row => {
  expect(row.route.runtime).toBe('nodejs'); expect(row.route.dynamic).toBe('force-dynamic');
  const result = await invoke(row);
  expect(result.status).toBe(200); expect(result.headers.get('Cache-Control')).toBe('no-store');
  expect(await result.json()).toEqual({ domainResult: row.name, nested: { preserved: true } });
  expect(state.verify).toHaveBeenCalledWith('synthetic', true);
  expect(domain[row.name]).toHaveBeenCalledExactlyOnceWith(state.actor, ...row.args);
  for (const [name, mock] of Object.entries(domain)) if (name !== row.name) expect(mock).not.toHaveBeenCalled();
});

it('uses real requireUser on every route and never forwards anonymous or expired sessions', async () => {
  for (const row of cases) {
    resetCalls(); const missing = requestFor(row); missing.headers.delete('Authorization');
    const denied = await invoke(row, missing); expect(denied.status).toBe(401); expect(denied.headers.get('Cache-Control')).toBe('no-store');
    expect(state.verify).not.toHaveBeenCalled(); noDomainCalls();
    state.verify.mockRejectedValueOnce(new Error('private-auth-payload'));
    const expired = await invoke(row); expect(expired.status).toBe(401); expect(expired.headers.get('Cache-Control')).toBe('no-store');
    expect(await expired.text()).not.toContain('private-auth-payload'); noDomainCalls();
  }
});

it('rejects every query string including a bare delimiter before calling any domain operation', async () => {
  for (const row of cases) for (const suffix of ['?', '?x=1', '?uid=other&access=owner', '?x=%00']) {
    resetCalls(); const result = await invoke(row, requestFor(row, row.body && JSON.stringify(row.body), suffix));
    expect(result.status).toBe(400); expect(result.headers.get('Cache-Control')).toBe('no-store'); noDomainCalls();
  }
});

it('validates business record and offer IDs including controls, traversal, prototype names and size', async () => {
  for (const row of cases) for (const field of ['id', ...(row.path.includes('demo-record') ? ['recordId'] : []), ...(row.path.includes('demo-offer') ? ['offerId'] : [])]) {
    for (const bad of ['', '../other', 'a/b', 'bad\n', 'bad\u0000', '__proto__', 'constructor', 'prototype', 'a'.repeat(129)]) {
      resetCalls(); const result = await invoke(row, requestFor(row), context({ [field]: bad }));
      expect(result.status).toBe(400); expect(result.headers.get('Cache-Control')).toBe('no-store'); noDomainCalls();
    }
  }
});

it('rejects identity role access and other unknown command fields without invoking the domain', async () => {
  for (const row of cases.filter(row => row.method === 'POST')) for (const field of ['uid', 'clientUid', 'ownerUid', 'actor', 'role', 'access', 'unexpected']) {
    resetCalls(); const result = await invoke(row, requestFor(row, JSON.stringify({ ...row.body, [field]: 'forged' })));
    expect(result.status).toBe(400); expect(result.headers.get('Cache-Control')).toBe('no-store'); noDomainCalls();
  }
  const invalid = [
    [cases[0], { ...createBody, selection: { ...createBody.selection, clientUid: 'forged' } }],
    [cases[0], { ...createBody, requestId: 'demo-bad\n' }],
    [cases[0], { ...createBody, expectedWaitlistRevision: Number.MAX_SAFE_INTEGER }],
    [cases[2], { dateKey: '2030-02-30', filter: 'all' }], [cases[2], { dateKey: '2030-01-07', filter: 'expired' }],
    [cases[2], { dateKey: '2030-01-07', filter: 'offered', cursor: { offerId: 'bad\n', createdAt: 1 } }],
    [cases[8], { requestId: 'short' }], [cases[9], { clientPhone: null, intakeAnswers: null }], [cases[9], { ...confirmBody, confirm: false }],
    [cases[4], { withdraw: false }], [cases[5], { closeExpired: false }], [cases[10], { decline: false }],
  ] as const;
  for (const [row, body] of invalid) { resetCalls(); expect((await invoke(row, requestFor(row, JSON.stringify(body)))).status).toBe(400); noDomainCalls(); }
});

it('enforces actual body bytes at 1024 2048 and 16384 despite missing or lying content length', async () => {
  for (const row of cases.filter(row => row.method === 'POST')) {
    const raw = JSON.stringify(row.body), exact = raw + ' '.repeat(row.cap! - Buffer.byteLength(raw));
    for (const length of [undefined, '1']) {
      resetCalls(); const headers: Record<string, string> = length ? { 'Content-Length': length } : {};
      expect((await invoke(row, requestFor(row, exact, '', headers))).status).toBe(200);
      resetCalls(); const tooLarge = await invoke(row, requestFor(row, exact + ' ', '', headers));
      expect(tooLarge.status).toBe(413); expect(tooLarge.headers.get('Cache-Control')).toBe('no-store'); noDomainCalls();
    }
    resetCalls(); const declared = await invoke(row, requestFor(row, raw, '', { 'Content-Length': String(row.cap! + 1) }));
    expect(declared.status).toBe(413); noDomainCalls();
  }
  const row = cases[9], unicode = JSON.stringify({ confirm: true, clientPhone: 'é'.repeat(9000), intakeAnswers: {} });
  expect(unicode.length).toBeLessThan(16384); expect(Buffer.byteLength(unicode)).toBeGreaterThan(16384);
  resetCalls(); expect((await invoke(row, requestFor(row, unicode))).status).toBe(413); noDomainCalls();
});

it('bounds streamed chunks and hides stream failures, malformed UTF8 JSON and content type errors', async () => {
  for (const row of [cases[0], cases[8], cases[9]]) {
    resetCalls(); let cancelled = false, chunks = 0;
    const stream = new ReadableStream<Uint8Array>({ pull(controller) { controller.enqueue(new Uint8Array(row.cap! / 2 + 1).fill(32)); chunks++; }, cancel() { cancelled = true; } });
    const streamed = new Request(`http://localhost/api/businesses/demo-business/${row.path}`, { method: 'POST', body: stream, headers: { Authorization: 'Bearer synthetic', 'Content-Type': 'application/json', 'Content-Length': '1' }, duplex: 'half' } as RequestInit);
    const result = await invoke(row, streamed); expect(result.status).toBe(413); expect(result.headers.get('Cache-Control')).toBe('no-store'); expect(cancelled).toBe(true); expect(chunks).toBeLessThanOrEqual(3); noDomainCalls();
  }
  for (const row of cases.filter(row => row.method === 'POST')) {
    for (const type of ['', 'text/plain']) { resetCalls(); const result = await invoke(row, requestFor(row, '{}', '', { 'Content-Type': type })); expect(result.status).toBe(415); expect(result.headers.get('Cache-Control')).toBe('no-store'); noDomainCalls(); }
    for (const raw of ['', '{', 'null', '[]']) { resetCalls(); const result = await invoke(row, requestFor(row, raw)); expect(result.status).toBe(400); expect(result.headers.get('Cache-Control')).toBe('no-store'); noDomainCalls(); }
  }
  resetCalls(); const broken = new ReadableStream({ start(controller) { controller.error(new Error('private-stream-payload')); } });
  const failed = await invoke(cases[9], new Request('http://localhost', { method: 'POST', headers: { Authorization: 'Bearer synthetic', 'Content-Type': 'application/json' }, body: broken, duplex: 'half' } as RequestInit));
  expect(failed.status).toBe(503); expect(failed.headers.get('Cache-Control')).toBe('no-store');
  const streamError = await failed.json(); expect(streamError.code).toBe('WAITLIST_OFFER_UNVERIFIABLE'); expect(JSON.stringify(streamError)).not.toContain('private-stream-payload'); noDomainCalls();
  resetCalls(); const invalidUtf8 = await invoke(cases[9], new Request('http://localhost', { method: 'POST', headers: { Authorization: 'Bearer synthetic', 'Content-Type': 'application/json' }, body: new Uint8Array([0xc3, 0x28]) }));
  expect(invalidUtf8.status).toBe(400); expect(invalidUtf8.headers.get('Cache-Control')).toBe('no-store'); noDomainCalls();
});

it('GET routes never mutate, reject bodies, and every unsupported method returns no-store 405', async () => {
  for (const row of cases) {
    resetCalls();
    for (const method of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const) if (method !== row.method) {
      const handler = row.route[method]; expect(handler, `${method} ${row.path}`).toBeTypeOf('function');
      const result = await handler!(new Request(`http://localhost/${row.path}`, { method }), context());
      expect(result.status).toBe(405); expect(result.headers.get('Cache-Control')).toBe('no-store'); expect(result.headers.get('Allow')).toBe(row.method); noDomainCalls();
    }
    if (row.method === 'GET') {
      const result = await invoke(row, new Request(`http://localhost/${row.path}`, { method: 'POST', headers: { Authorization: 'Bearer synthetic' }, body: 'unexpected' }));
      expect(result.status).toBe(400); expect(result.headers.get('Cache-Control')).toBe('no-store'); noDomainCalls();
    }
  }
});

it('preserves domain auth scope policy conflict and admission errors and normalizes unsafe failures', async () => {
  for (const row of cases) {
    for (const status of [403, 404, 402, 428, 429, 409, 503]) {
      domain[row.name].mockRejectedValueOnce(new HttpError(status, 'Safe domain message', 'DEMO_DOMAIN_CODE', status === 429 ? 7 : undefined));
      const result = await invoke(row); expect(result.status).toBe(status); expect(result.headers.get('Cache-Control')).toBe('no-store');
      expect(await result.json()).toEqual({ error: 'Safe domain message', code: 'DEMO_DOMAIN_CODE' });
      if (status === 429) expect(result.headers.get('Retry-After')).toBe('7');
    }
    domain[row.name].mockRejectedValueOnce(new WaitlistOfferModelError());
    const model = await invoke(row); expect(model.status).toBe(503); expect(model.headers.get('Cache-Control')).toBe('no-store'); expect((await model.json()).code).toBe('WAITLIST_OFFER_UNVERIFIABLE');
    for (const error of [new Error('private-storage-payload'), Object.assign(new Error('private-spoofed-429'), { status: 429 })]) {
      domain[row.name].mockRejectedValueOnce(error); const result = await invoke(row); expect(result.status).toBe(503); expect(result.headers.get('Cache-Control')).toBe('no-store');
      const unexpected = await result.json(); expect(unexpected.code).toBe('WAITLIST_OFFER_UNVERIFIABLE'); expect(JSON.stringify(unexpected)).not.toContain('private-');
    }
  }
});

it('forwards invalid fresh contact for replay or persisted expiry and does not blanket-gate readers or commands', async () => {
  vi.stubEnv('SARIN_WAITLIST_OFFERS_ENABLED', 'false');
  for (const row of cases) expect((await invoke(row)).status).toBe(200);
  expect(domain.confirmClientWaitlistOffer).toHaveBeenCalledWith(state.actor, 'demo-business', 'demo-offer', { clientPhone: null, intakeAnswers: ['invalid fresh contact'] });
  domain.confirmClientWaitlistOffer.mockResolvedValueOnce({ proof: { appointmentId: 'demo-saved' }, appointment: { id: 'demo-saved' }, replayed: true });
  const replay = await invoke(cases[9]); expect(replay.status).toBe(200); expect((await replay.json()).replayed).toBe(true);
  domain.confirmClientWaitlistOffer.mockRejectedValueOnce(new HttpError(409, 'Oferta cerrada.', 'OFFER_CLOSED'));
  const closed = await invoke(cases[9]); expect(closed.status).toBe(409); expect((await closed.json()).code).toBe('OFFER_CLOSED');
});
