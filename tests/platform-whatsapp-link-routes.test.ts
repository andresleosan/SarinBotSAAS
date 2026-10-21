import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HttpError } from '@/lib/server/http';
import * as route from '@/app/api/platform-whatsapp/link/route';
import { token, phone } from './platform-whatsapp-link-fixtures';
import { scope, now } from './platform-whatsapp-test-fixtures';
const mocks = vi.hoisted(() => ({ verify: vi.fn(), begin: vi.fn(), confirm: vi.fn(), revoke: vi.fn(), status: vi.fn(), config: vi.fn() }));
vi.mock('@/lib/firebase/admin', () => ({ getAdminAuth: () => ({ verifyIdToken: mocks.verify }), getAdminDb: () => {
    throw new Error('Default backend forbidden');
  } }));
vi.mock('@/lib/server/platform-whatsapp-link', () => ({ beginPlatformWhatsAppLink: mocks.begin, confirmPlatformWhatsAppLink: mocks.confirm, revokePlatformWhatsAppLink: mocks.revoke, readPlatformWhatsAppLinkStatus: mocks.status }));
vi.mock('@/lib/server/platform-whatsapp-config', () => ({ getPlatformWhatsAppConfig: mocks.config }));
const uuid = '11111111-1111-4111-8111-111111111111';
const revokeId = 'revoke_v1_' + uuid + '_22222222-2222-4222-8222-222222222222';
const beginBody = { action: 'begin', phoneE164: phone, requestId: 'demo-begin-request' };
const confirmBody = { action: 'confirm', challengeId: uuid, requestId: 'demo-confirm-request', confirmed: true };
const revokeBody = { requestId: revokeId };
const safe = { available: false, revokeGeneration: uuid, current: { linkId: uuid, revision: 1, expiresAt: now, maskedPhone: '••••0101' }, pending: { challengeId: uuid, revision: 2, expiresAt: now, maskedPhone: '••••0101', proof: 'verified' } };
const issued = { challengeId: uuid, code: 'demo-ephemeral-code', expiresAt: now };
const confirmed = { linkId: uuid, revision: 1, expiresAt: now };
const methods = [['GET', route.GET], ['POST', route.POST], ['DELETE', route.DELETE]] as const;
function request(method = 'POST', body: unknown = beginBody, query = '', headers = {}) {
  return new Request('https://demo.invalid/api/platform-whatsapp/link' + query, { method, headers: { authorization: 'Bearer demo-token', 'content-type': 'application/json', ...headers }, ...(method === 'GET' ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }) });
}
async function check(result: Response, status: number, body?: unknown) {
  expect(result.status).toBe(status);
  expect(result.headers.get('cache-control')).toBe('no-store');
  const value = await result.json();
  if (body !== undefined)
    expect(value).toEqual(body);
  return value;
}
function noDomainReads() {
  for (const name of ['begin', 'confirm', 'revoke', 'status', 'config'] as const)
    expect(mocks[name], name).not.toHaveBeenCalled();
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.verify.mockResolvedValue(token());
  mocks.begin.mockResolvedValue(issued);
  mocks.confirm.mockResolvedValue(confirmed);
  mocks.revoke.mockResolvedValue(undefined);
  mocks.status.mockResolvedValue(safe);
  mocks.config.mockReturnValue({ scope });
});
afterEach(() => vi.unstubAllEnvs());
describe('owner link authentication and query boundary', () => {
  it('exports only owner methods and dynamic Node runtime', () => {
    expect(Object.keys(route).sort()).toEqual(['DELETE', 'GET', 'POST', 'dynamic', 'runtime']);
    expect(route.runtime).toBe('nodejs');
    expect(route.dynamic).toBe('force-dynamic');
  });
  it.each(methods)('%s authenticates before URL/body/config/service access', async (_, handler) => {
    for (const authorization of [undefined, 'Bearer', 'Bearer a b', 'Bearer\tdemo', 'Basic demo', 'Bearer demo-token']) {
      mocks.verify.mockClear();
      if (authorization === 'Bearer demo-token')
        mocks.verify.mockRejectedValueOnce(new Error('synthetic revoked'));
      const req = { headers: new Headers(authorization ? { authorization } : {}), get url(): never {
          throw new Error('URL touched before auth');
        }, get body(): never {
          throw new Error('body touched before auth');
        } } as unknown as Request;
      await check(await handler(req), 401);
      noDomainReads();
      if (authorization === 'Bearer demo-token')
        expect(mocks.verify).toHaveBeenCalledWith('demo-token', true);
      else
        expect(mocks.verify).not.toHaveBeenCalled();
    }
  });
  it.each(methods)('%s rejects every original query entry after authentication', async (method, handler) => {
    for (const query of ['?unknown=x', '?scope=account', '?scope=account&scope=account', '?=', '?requestId=demo-request', '?action=begin&action=confirm', '?empty']) {
      await check(await handler(request(method, method === 'DELETE' ? revokeBody : beginBody, query)), 400);
      expect(mocks.verify).toHaveBeenCalledWith('demo-token', true);
      noDomainReads();
    }
  });
  it('forwards the exact decoded owner object and returns raw safe GET without freshness/config gates', async () => {
    const user = token(undefined, now - 3600000);
    mocks.verify.mockResolvedValue(user);
    await check(await route.GET(request('GET')), 200, safe);
    expect(mocks.status.mock.calls[0][0]).toBe(user);
    expect(mocks.confirm).not.toHaveBeenCalled();
    expect(mocks.config).not.toHaveBeenCalled();
  });
});
describe('strict owner control bodies', () => {
  it('returns raw begin with fixed Business destination only after issuance', async () => {
    const user = token();
    mocks.verify.mockResolvedValue(user);
    await check(await route.POST(request()), 200, { ...issued, whatsappUrl: 'https://wa.me/12025550100' });
    expect(mocks.begin.mock.calls[0][0]).toBe(user);
    expect(mocks.begin).toHaveBeenCalledWith(user, { phoneE164: phone, requestId: beginBody.requestId });
    expect(mocks.begin.mock.invocationCallOrder[0]).toBeLessThan(mocks.config.mock.invocationCallOrder[0]);
  });
  it('requires explicit confirm and passes only challenge/request IDs', async () => {
    const user = token();
    mocks.verify.mockResolvedValue(user);
    await check(await route.POST(request('POST', confirmBody)), 200, confirmed);
    expect(mocks.confirm.mock.calls[0][0]).toBe(user);
    expect(mocks.confirm).toHaveBeenCalledWith(user, { challengeId: uuid, requestId: confirmBody.requestId });
    expect(mocks.config).not.toHaveBeenCalled();
  });
  it('retries exactly the same revoke input without configuration or consent prerequisites', async () => {
    const user = token();
    mocks.verify.mockResolvedValue(user);
    vi.stubEnv('PLATFORM_WHATSAPP_LINK_HMAC_KEY', undefined);
    for (let i = 0; i < 2; i++)
      await check(await route.DELETE(request('DELETE', revokeBody)), 200, { revoked: true });
    expect(mocks.revoke.mock.calls[0][0]).toBe(user);
    expect(mocks.revoke.mock.calls[1][0]).toBe(user);
    expect(mocks.revoke.mock.calls).toEqual([[user, revokeId], [user, revokeId]]);
    expect(mocks.config).not.toHaveBeenCalled();
  });
  it.each([null, {}, [], true, 'begin', { ...beginBody, action: 'status' }, { ...beginBody, action: undefined }, { ...beginBody, phoneE164: undefined }, { ...confirmBody, challengeId: undefined }, { ...revokeBody, action: 'revoke' }])('rejects nondeclared POST %j', async (body) => {
    await check(await route.POST(request('POST', body)), 400);
    noDomainReads();
  });
  it.each(['uid', 'actorUid', 'scope', 'businessId', 'phone', 'customerPhone', 'auth_time', 'consent', 'expectedRevision', 'timestamp', 'whatsappUrl', 'code'])('rejects injected %s for every control', async (field) => {
    for (const body of [beginBody, confirmBody])
      await check(await route.POST(request('POST', { ...body, [field]: 'injected' })), 400);
    await check(await route.DELETE(request('DELETE', { ...revokeBody, [field]: 'injected' })), 400);
    noDomainReads();
  });
  it.each(['phoneE164', 'confirmed', 'challengeId'])('rejects cross-action %s injection', async (field) => {
    await check(await route.POST(request('POST', { ...beginBody, [field]: 'injected' })), 400);
    if (field !== 'challengeId' && field !== 'confirmed')
      await check(await route.POST(request('POST', { ...confirmBody, [field]: 'injected' })), 400);
    await check(await route.DELETE(request('DELETE', { ...revokeBody, [field]: 'injected' })), 400);
    noDomainReads();
  });
  it.each([undefined, false, 0, 1, 'true', null, {}])('rejects confirm flag %j', async (confirmed) => {
    await check(await route.POST(request('POST', { ...confirmBody, confirmed })), 400);
    noDomainReads();
  });
  it.each(['12025550101', ' +12025550101', '+12025550101 ', '+12025550101\n', '+012345678', '+1234567', '+1234567890123456'])('rejects nonexact phone %j', async (phoneE164) => {
    await check(await route.POST(request('POST', { ...beginBody, phoneE164 })), 400);
    noDomainReads();
  });
  it.each(['short', 'a'.repeat(129), 'demo-request\n', 'demo.request', 'demo request', '\u00e9'.repeat(8), 'revoke_v1_demo-request', revokeId])('rejects full-string request or reserved prefix %j', async (requestId) => {
    for (const body of [beginBody, confirmBody])
      await check(await route.POST(request('POST', { ...body, requestId })), 400);
    noDomainReads();
  });
  it.each(['AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA', uuid + '\n', uuid + 'x', '11111111-1111-0111-8111-111111111111', '11111111-1111-4111-7111-111111111111', 'demo'])('rejects noncanonical challenge %j', async (challengeId) => {
    await check(await route.POST(request('POST', { ...confirmBody, challengeId })), 400);
    noDomainReads();
  });
  it.each(['demo-request', revokeId + '\n', revokeId + 'x', revokeId.toUpperCase(), 'revoke_v1_' + uuid + '_demo', 'revoke_v1_11111111-1111-0111-8111-111111111111_' + uuid, 'revoke_v1_' + uuid + '_11111111-1111-4111-7111-111111111111'])('rejects noncanonical revoke %j', async (requestId) => {
    await check(await route.DELETE(request('DELETE', { requestId })), 400);
    noDomainReads();
  });
  it.each([null, {}, [], { ...revokeBody, action: 'revoke' }])('rejects invalid revoke object %j', async (body) => {
    await check(await route.DELETE(request('DELETE', body)), 400);
    noDomainReads();
  });
  it.each([null, { ...scope, phoneE164: '+12025550100?text=private' }, { ...scope, wabaId: 'invalid' }, { ...scope, phoneNumberId: 'invalid' }])('omits URL for invalid trusted scope %j', async (scope) => {
    mocks.config.mockReturnValue({ scope });
    await check(await route.POST(request()), 200, issued);
  });
  it('never reads destination configuration after failed issuance', async () => {
    mocks.begin.mockRejectedValue(new HttpError(409, 'Unavailable', 'CHALLENGE_CODE_UNAVAILABLE'));
    await check(await route.POST(request()), 409, { error: 'Unavailable', code: 'CHALLENGE_CODE_UNAVAILABLE' });
    expect(mocks.config).not.toHaveBeenCalled();
  });
});
describe('bounded shared JSON and safe error contract', () => {
  it.each([['POST', route.POST, beginBody], ['DELETE', route.DELETE, revokeBody]] as const)('%s caps declared and actual bytes without changing legacy parsing', async (method, handler, body) => {
    await check(await handler(request(method, body, '', { 'content-length': '2049' })), 413);
    await check(await handler(request(method, ' '.repeat(2049))), 413);
    noDomainReads();
    await check(await handler(request(method, body, '', { 'content-type': 'application/json-extra', 'content-length': 'invalid' })), 200);
  });
  it.each([['POST', route.POST], ['DELETE', route.DELETE]] as const)('%s rejects malformed JSON/MIME/UTF8', async (method, handler) => {
    await check(await handler(request(method, '{')), 400);
    await check(await handler(request(method, {}, '', { 'content-type': 'text/plain' })), 415);
    await check(await handler(new Request(request(method), { body: new Uint8Array([255]) })), 400);
    noDomainReads();
  });
  it.each([[401, 'LINK_AUTH_REQUIRED'], [428, 'LINK_RECENT_AUTH_REQUIRED'], [428, 'CONSENT_REQUIRED'], [409, 'LINK_CONFLICT'], [429, 'LINK_RATE_LIMITED']] as const)('preserves domain %s %s and Retry-After', async (status, code) => {
    mocks.begin.mockRejectedValue(new HttpError(status, 'synthetic domain failure', code, 9));
    const result = await route.POST(request());
    expect(result.headers.get('retry-after')).toBe('9');
    await check(result, status, { error: 'synthetic domain failure', code });
  });
  it.each(methods)('%s hides unknown operational detail', async (method, handler) => {
    const service = method === 'GET' ? mocks.status : method === 'POST' ? mocks.begin : mocks.revoke;
    service.mockRejectedValue(new Error('private synthetic detail'));
    const body = await check(await handler(request(method, method === 'DELETE' ? revokeBody : beginBody)), 503);
    expect(JSON.stringify(body)).not.toContain('private synthetic detail');
  });
});
