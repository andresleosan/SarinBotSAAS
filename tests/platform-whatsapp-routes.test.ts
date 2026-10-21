import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { HttpError } from '@/lib/server/http';
import * as status from '@/app/api/admin/platform-whatsapp/status/route';
import * as conversations from '@/app/api/admin/platform-whatsapp/conversations/route';
import * as diagnostic from '@/app/api/admin/platform-whatsapp/retry-diagnostic/route';
import * as webhook from '@/app/api/whatsapp/ycloud/platform/webhook/route';

const mocks = vi.hoisted(() => ({
  verify: vi.fn(), database: vi.fn(), status: vi.fn(), connection: vi.fn(), list: vi.fn(), control: vi.fn(),
  config: vi.fn(), observer: vi.fn(), summary: vi.fn(), close: vi.fn(), arm: vi.fn(), observe: vi.fn(),
  normalConfig: vi.fn(), guard: vi.fn(), reader: vi.fn(), ingress: vi.fn(),
}));
// Keep real requireSuperadmin/readJson/apiError and real R3a schemas; isolate only external/domain effects.
vi.mock('@/lib/firebase/admin', () => ({ getAdminAuth: () => ({ verifyIdToken: mocks.verify }), getAdminDb: mocks.database }));
vi.mock('@/lib/server/platform-whatsapp-store', async importOriginal => ({ ...await importOriginal<object>(), getPlatformWhatsAppStatus: mocks.status, applyPlatformWhatsAppConnectionControl: mocks.connection }));
vi.mock('@/lib/server/platform-whatsapp-conversations', () => ({ listPlatformWhatsAppConversations: mocks.list, applyPlatformWhatsAppConversationControl: mocks.control }));
vi.mock('@/lib/server/ycloud-retry-diagnostic', () => ({ getYCloudRetryDiagnosticConfig: mocks.config, getYCloudRetryDiagnosticObserver: mocks.observer, readYCloudRetryDiagnosticSummary: mocks.summary, closeYCloudRetryDiagnostic: mocks.close }));
vi.mock('@/lib/server/platform-whatsapp-config', () => ({ getPlatformWhatsAppConfig: mocks.normalConfig, requirePlatformWhatsAppReception: mocks.guard }));
vi.mock('@/lib/server/ycloud-webhook', () => ({ readYCloudWebhook: mocks.reader }));
vi.mock('@/lib/server/platform-whatsapp-ingress', () => ({ ingestPlatformWhatsAppEvent: mocks.ingress }));

const db = { synthetic: true };
const normal = { scope: { wabaId: '10001', phoneE164: '+12025550100', phoneNumberId: '20001' }, signingSecret: 'demo-only-secret' };
const statusBody = { presentationState: 'configured_unverified', receiveEnabled: true };
const listBody = { conversations: [], truncated: false, observedAt: '2030-01-01T00:00:00.000Z' };
const view = { id: 'a'.repeat(64), mode: 'human', revision: 1 };
const connectionBody = { action: 'pause', expectedRevision: 0, requestId: 'demo-request-1' };
const conversationBody = { conversationId: 'a'.repeat(64), mode: 'review', expectedRevision: 0, requestId: 'demo-request-2' };
const adminMethods = [['status GET', status.GET], ['status PATCH', status.PATCH], ['conversations GET', conversations.GET], ['conversations PATCH', conversations.PATCH], ['diagnostic GET', diagnostic.GET], ['diagnostic POST', diagnostic.POST], ['diagnostic DELETE', diagnostic.DELETE]] as const;
function request(method = 'POST', body: unknown = {}, headers: Record<string, string> = {}) {
  return new Request('https://demo.invalid/api?cursor=untrusted', { method, ...(method === 'GET' ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }), headers: { authorization: 'Bearer demo-token', 'content-type': 'application/json', ...headers } });
}
async function response(result: Response, expectedStatus: number, body: unknown) {
  expect(result.status).toBe(expectedStatus); expect(result.headers.get('cache-control')).toBe('no-store');
  if (body === null) expect(await result.text()).toBe(''); else expect(await result.json()).toEqual(body);
}
beforeEach(() => {
  vi.resetAllMocks(); vi.stubEnv('SUPERADMIN_UID', 'demo-admin');
  mocks.verify.mockResolvedValue({ uid: 'demo-admin' }); mocks.database.mockReturnValue(db);
  mocks.status.mockResolvedValue(statusBody); mocks.connection.mockResolvedValue(statusBody); mocks.list.mockResolvedValue(listBody); mocks.control.mockResolvedValue(view);
  mocks.config.mockReturnValue(null); mocks.normalConfig.mockReturnValue(normal); mocks.reader.mockResolvedValue(null);
  mocks.observer.mockReturnValue({ arm: mocks.arm, observe: mocks.observe }); mocks.observe.mockResolvedValue(204);
  mocks.summary.mockResolvedValue({ status: 'armed', expiresAt: '2030-01-01T00:00:00.000Z', requests: 0, attempts: [] });
});
afterEach(() => vi.unstubAllEnvs());

describe('admin authentication before all parsing and effects', () => {
  it.each(adminMethods)('%s rejects missing auth before reading body/config/database', async (_, handler) => {
    const req = { headers: new Headers(), get body(): never { throw new Error('body touched before auth'); } } as unknown as Request;
    await response(await handler(req), 401, { error: 'Inicia sesión para continuar.' });
    for (const [name, mock] of Object.entries(mocks)) expect(mock, name).not.toHaveBeenCalled();
  });
  it.each(adminMethods)('%s checks revocation and exact UID', async (_, handler) => {
    mocks.verify.mockRejectedValueOnce(new Error('revoked synthetic token'));
    await response(await handler(request()), 401, { error: 'La sesión expiró. Vuelve a iniciar sesión.' });
    expect(mocks.verify).toHaveBeenCalledWith('demo-token', true);
    mocks.verify.mockResolvedValueOnce({ uid: 'other-demo-admin' });
    await response(await handler(request()), 403, { error: 'Forbidden' });
    vi.stubEnv('SUPERADMIN_UID', undefined);
    await response(await handler(request()), 403, { error: 'Forbidden' });
    for (const [name, mock] of Object.entries(mocks)) if (name !== 'verify') expect(mock, name).not.toHaveBeenCalled();
  });
  it.each(['Bearer', 'Bearer a b', 'Basic demo', 'Bearer\tdemo'])('rejects malformed bearer %s', async authorization => {
    await response(await status.GET(request('GET', {}, { authorization })), 401, { error: 'Inicia sesión para continuar.' }); expect(mocks.verify).not.toHaveBeenCalled();
  });
});

describe('admin exact envelopes and body bounds', () => {
  it('exports only the frozen handlers and dynamic Node runtime', () => {
    for (const [route, methods] of [[status, ['GET', 'PATCH']], [conversations, ['GET', 'PATCH']], [diagnostic, ['DELETE', 'GET', 'POST']], [webhook, ['POST']]] as const) {
      expect(route.runtime).toBe('nodejs'); expect(route.dynamic).toBe('force-dynamic');
      expect(Object.keys(route).sort()).toEqual([...methods, 'dynamic', 'runtime'].sort());
    }
  });
  it('returns direct status/list without accepting query controls', async () => {
    await response(await status.GET(request('GET')), 200, statusBody); expect(mocks.status).toHaveBeenCalledWith();
    await response(await conversations.GET(request('GET')), 200, listBody); expect(mocks.list).toHaveBeenCalledWith();
  });
  it('passes only parsed controls and the verified actor', async () => {
    await response(await status.PATCH(request('PATCH', connectionBody)), 200, statusBody); expect(mocks.connection).toHaveBeenCalledWith(connectionBody, 'demo-admin');
    await response(await conversations.PATCH(request('PATCH', conversationBody)), 200, { conversation: view }); expect(mocks.control).toHaveBeenCalledWith(conversationBody, 'demo-admin');
  });
  it.each([[status.PATCH, connectionBody], [conversations.PATCH, conversationBody]] as const)('rejects injected actor/config/bot fields in closed controls', async (handler, body) => {
    for (const patch of [{ actorUid: 'demo-other' }, { mode: 'bot' }, { signingSecret: 'demo' }, { receiveEnabled: true }]) {
      await response(await handler(request('PATCH', { ...body, ...patch })), 400, { error: 'Datos no válidos. Revisa los campos enviados.' });
    }
    expect(mocks.connection).not.toHaveBeenCalled(); expect(mocks.control).not.toHaveBeenCalled();
  });
  it.each([[status.PATCH, connectionBody, 2048], [conversations.PATCH, conversationBody, 2048], [diagnostic.POST, {}, 64]] as const)('applies actual and declared admin bounds', async (handler, body, bound) => {
    await response(await handler(request('POST', body, { 'content-length': String(bound + 1) })), 413, { error: 'El contenido supera el tamaño permitido.' });
    await response(await handler(request('POST', ' '.repeat(bound + 1))), 413, { error: 'El contenido supera el tamaño permitido.' });
    expect(mocks.config).not.toHaveBeenCalled(); expect(mocks.connection).not.toHaveBeenCalled(); expect(mocks.control).not.toHaveBeenCalled();
  });
  it('preserves permissive admin MIME/length semantics', async () => {
    await response(await status.PATCH(request('PATCH', connectionBody, { 'content-type': 'APPLICATION/JSON-extra', 'content-length': '01' })), 200, statusBody);
    await response(await status.PATCH(request('PATCH', connectionBody, { 'content-length': 'invalid' })), 200, statusBody);
  });
  it('retains admin JSON, UTF-8 and MIME error messages', async () => {
    await response(await status.PATCH(request('PATCH', '{')), 400, { error: 'JSON no válido.' });
    await response(await status.PATCH(request('PATCH', {}, { 'content-type': 'text/plain' })), 415, { error: 'Se requiere contenido JSON.' });
    const req = new Request(request('PATCH'), { body: new Uint8Array([255]) });
    await response(await status.PATCH(req), 400, { error: 'JSON no válido.' });
  });
  it('reads summary without config or observer initialization', async () => {
    const summary = { status: 'pinned', expiresAt: '2030-01-01T00:00:00.000Z', requests: 1, attempts: [{ eventId: 'demo', bodySha256: 'a'.repeat(64), arrivalUtc: '2030-01-01T00:00:00.000Z', signedT: 1, hmacValid: true }] };
    mocks.summary.mockResolvedValue(summary); await response(await diagnostic.GET(request('GET')), 200, summary);
    expect(mocks.summary).toHaveBeenCalledWith(db); expect(mocks.config).not.toHaveBeenCalled(); expect(mocks.observer).not.toHaveBeenCalled();
  });
  it('arms only empty strict object, then config and database', async () => {
    await response(await diagnostic.POST(request('POST', { runId: 'demo' })), 400, { error: 'Datos no válidos. Revisa los campos enviados.' }); expect(mocks.config).not.toHaveBeenCalled();
    await response(await diagnostic.POST(request()), 503, { error: 'El diagnóstico está deshabilitado.' }); expect(mocks.database).not.toHaveBeenCalled();
    const config = { synthetic: true }; mocks.config.mockReturnValue(config);
    await response(await diagnostic.POST(request()), 204, null); expect(mocks.observer).toHaveBeenCalledWith(config, db); expect(mocks.arm).toHaveBeenCalledOnce();
  });
  it('DELETE ignores body and closes durable state without observer/config', async () => {
    await response(await diagnostic.DELETE(request('DELETE', 'not JSON', { 'content-type': 'text/plain', 'content-length': '999999' })), 204, null);
    expect(mocks.close).toHaveBeenCalledWith(db); expect(mocks.config).not.toHaveBeenCalled(); expect(mocks.observer).not.toHaveBeenCalled();
  });
  it.each([
    [new HttpError(409, 'demo-conflict', 'DEMO', 9), 409, { error: 'demo-conflict', code: 'DEMO' }, '9'],
    [Object.assign(new Error('demo-rate'), { status: 429 }), 429, { error: 'demo-rate' }, '5'],
    [new z.ZodError([]), 400, { error: 'Datos no válidos.' }, null],
    [Object.assign(new Error(), { name: 'AbortError' }), 499, { error: 'Solicitud cancelada.' }, null],
    [new Error('private synthetic detail'), 503, { error: 'Servicio temporalmente no disponible. Revisa la configuración o inténtalo de nuevo.' }, null],
  ] as const)('maps domain errors using existing formatter', async (error, code, body, retry) => {
    mocks.status.mockRejectedValueOnce(error); const result = await status.GET(request('GET')); expect(result.headers.get('retry-after')).toBe(retry); await response(result, code, body);
  });
});

describe('public diagnostic precedence and ordinary dispatch', () => {
  it('does not fall back when diagnostic configuration is invalid', async () => {
    mocks.config.mockImplementation(() => { throw new HttpError(503, 'El diagnóstico no está disponible.'); });
    await response(await webhook.POST(request()), 503, { error: 'El diagnóstico no está disponible.' });
    expect(mocks.normalConfig).not.toHaveBeenCalled(); expect(mocks.database).not.toHaveBeenCalled(); expect(mocks.reader).not.toHaveBeenCalled();
  });
  it.each([204, 503])('active diagnostic returns bare%s and never normal ingress', async code => {
    const config = { synthetic: true }, req = request(); mocks.config.mockReturnValue(config); mocks.observe.mockResolvedValue(code);
    await response(await webhook.POST(req), code, null); expect(mocks.observe).toHaveBeenCalledWith(req); expect(mocks.observer).toHaveBeenCalledWith(config, db);
    expect(mocks.normalConfig).not.toHaveBeenCalled(); expect(mocks.reader).not.toHaveBeenCalled(); expect(mocks.ingress).not.toHaveBeenCalled();
  });
  it.each([null, { kind: 'message_status' }])('ordinary null/status acknowledges with no database', async event => {
    mocks.reader.mockResolvedValue(event); const req = request();
    await response(await webhook.POST(req), 200, { received: true }); expect(mocks.guard).toHaveBeenCalledWith(normal);
    expect(mocks.reader).toHaveBeenCalledWith(req, { signingSecret: normal.signingSecret, scope: { wabaId: '10001', phoneE164: '+12025550100' } });
    expect(mocks.database).not.toHaveBeenCalled(); expect(mocks.ingress).not.toHaveBeenCalled();
  });
  it.each(['incoming_text', 'human_echo'])('dispatches%s only after signed reader and hides outcome', async kind => {
    const event = { kind }; mocks.reader.mockResolvedValue(event);
    for (const outcome of ['stored', 'duplicate', 'conflict']) {
      mocks.ingress.mockResolvedValue({ outcome }); await response(await webhook.POST(request()), 200, { received: true });
      expect(mocks.ingress).toHaveBeenLastCalledWith(event, normal, db);
    }
    expect(mocks.reader.mock.invocationCallOrder[0]).toBeLessThan(mocks.database.mock.invocationCallOrder[0]);
  });
  it('reception guard and authentication failures prevent DB/ingress', async () => {
    mocks.guard.mockImplementationOnce(() => { throw new HttpError(503, 'demo-disabled'); });
    await response(await webhook.POST(request()), 503, { error: 'demo-disabled' }); expect(mocks.reader).not.toHaveBeenCalled();
    mocks.reader.mockRejectedValueOnce(new HttpError(401, 'La firma de YCloud no es válida.'));
    await response(await webhook.POST(request()), 401, { error: 'La firma de YCloud no es válida.' }); expect(mocks.database).not.toHaveBeenCalled(); expect(mocks.ingress).not.toHaveBeenCalled();
  });
});
