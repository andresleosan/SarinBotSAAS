import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import { POST } from '@/app/api/whatsapp/ycloud/platform/webhook/route';
import * as diagnostic from '@/app/api/admin/platform-whatsapp/retry-diagnostic/route';
import * as status from '@/app/api/admin/platform-whatsapp/status/route';
import * as conversations from '@/app/api/admin/platform-whatsapp/conversations/route';
import { configure, memoryStore, now, scope } from './platform-whatsapp-test-fixtures';
import * as linkRoute from '@/app/api/platform-whatsapp/link/route';
import { beginPlatformWhatsAppLink as begin, readPlatformWhatsAppLinkStatus as linkStatus } from '@/lib/server/platform-whatsapp-link';
import { configureLink, token, phone, seedConsents } from './platform-whatsapp-link-fixtures';
import { createDataTestRuntime } from '../cloudflare/tests/data-runtime.mjs';
import { createCloudflareDatabase, StorageError, type DataTransport } from '@/lib/storage/database';
import type { DataReadResult, DataCommitResult } from '../shared/data-protocol';
import type { Database } from '@/lib/storage/types';

const admin = vi.hoisted(() => ({ db: vi.fn<() => Database>(() => { throw new Error('Default backend forbidden'); }), verify: vi.fn(), getUser: vi.fn() }));
vi.mock('@/lib/firebase/admin', () => ({ getAdminDb: admin.db, getAdminAuth: () => ({ verifyIdToken: admin.verify, getUser: admin.getUser }) }));
let store: ReturnType<typeof memoryStore>;
const secret = 'demo-only-signing-secret';
const nonce = 'demo-only-nonce-0123456789abcdefghij';
function signed(overrides = {}, headers = {}) {
  const body = JSON.stringify({ id: 'demo-http-event', type: 'whatsapp.inbound_message.received', apiVersion: 'v2', createTime: new Date(now).toISOString(), whatsappInboundMessage: { id: 'demo-http-message', wabaId: scope.wabaId, from: '+12025550101', to: scope.phoneE164, type: 'text', text: { body: nonce } }, ...overrides });
  const t = String(now / 1000), s = createHmac('sha256', secret).update(t + '.').update(body).digest('hex');
  return new Request('https://demo.invalid/webhook', { method: 'POST', body, headers: { 'content-type': 'application/json', 'YCloud-Signature': `t=${t},s=${s}`, ...headers } });
}
function authorized(method: string, body?: unknown) { return new Request('https://demo.invalid/admin', { method, headers: { authorization: 'Bearer demo-token', 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }); }
beforeEach(() => {
  vi.clearAllMocks(); store = memoryStore(); admin.db.mockReturnValue(store.db); admin.verify.mockResolvedValue({ uid: 'demo-admin' });
  vi.spyOn(Date, 'now').mockReturnValue(now); configure(); vi.stubEnv('SUPERADMIN_UID', 'demo-admin'); vi.stubEnv('PLATFORM_YCLOUD_DIAGNOSTIC_ENABLED', 'false'); vi.stubEnv('SARIN_MAINTENANCE', 'false');
  delete (globalThis as any)[Symbol.for('sarin.ycloud.retry-diagnostic.process')].cached;
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

it('signed ordinary ingress persists once and exposes only received on replay', async () => {
  const first = await POST(signed()); expect(first.status).toBe(200); expect(await first.json()).toEqual({ received: true });
  const before = structuredClone([...store.rows]); const replay = await POST(signed()); expect(await replay.json()).toEqual({ received: true }); expect([...store.rows]).toEqual(before);
  expect([...store.rows.keys()].some(key => key.startsWith('platformWhatsAppConversations/'))).toBe(true);
  expect(store.rows.has('serverSettings/ycloud_retry_diagnostic')).toBe(false);
});
it.each(['audio', 'interactive'])('signed %s flows through the real reader into terminal control metadata without identity effects', async type => {
  const message = { id: 'demo-a2-message', wabaId: scope.wabaId, from: '+12025550101', to: scope.phoneE164, type,
    audio: { id: '123456789', link: 'https://api.ycloud.com/v2/whatsapp/media/download/123456789', sha256: Buffer.alloc(32, 7).toString('base64'), mime_type: 'audio/ogg' },
    interactive: { type: 'button_reply', button_reply: { id: 'sarinbot.menu.v1:accept:12345678-1234-4234-8234-123456789abc', title: 'sarinbot.link.fake' } } };
  const result = await POST(signed({ whatsappInboundMessage: message })); expect(result.status).toBe(200); expect(await result.json()).toEqual({ received: true });
  const rows = [...store.rows.values()]; expect(rows.filter(row => row.recordType === 'event')).toEqual([expect.objectContaining({ kind: type === 'audio' ? 'incoming_audio' : 'incoming_choice', ingressDisposition: 'control_only', content: null })]);
  expect(rows).toHaveLength(2); expect(admin.getUser).not.toHaveBeenCalled();
  const before = structuredClone([...store.rows]); expect((await POST(signed({ whatsappInboundMessage: message }))).status).toBe(200); expect([...store.rows]).toEqual(before);
});
it('strict public MIME differs from admin JSON prefix parsing', async () => {
  const result = await POST(signed({}, { 'content-type': 'application/json-extra' })); expect(result.status).toBe(415); expect(admin.db).not.toHaveBeenCalled();
  const req = authorized('PATCH', { action: 'pause', expectedRevision: 0, requestId: 'demo-pause-http' }); req.headers.set('content-type', 'application/json-extra');
  expect((await status.PATCH(req)).status).toBe(200);
});
it.each([{ type: 'unrelated' }, { whatsappInboundMessage: { id: 'demo-message', wabaId: '99999', from: '+12025550101', to: scope.phoneE164, type: 'text', text: { body: nonce } } }])('unrelated signed company event never initializes persistence', async patch => {
  const result = await POST(signed(patch)); expect(result.status).toBe(200); expect(await result.json()).toEqual({ received: true }); expect(admin.db).not.toHaveBeenCalled(); expect(store.rows.size).toBe(0);
});
it('real admin status/list/control preserve domain shapes and verified actor', async () => {
  const initial = await status.GET(authorized('GET')); const body = await initial.json();
  expect(body).toMatchObject({ receiveEnabled: true, retentionEnabled: true, aiEnabled: false, sendEnabled: false, scope, presentationState: 'configured_unverified', audit: [] }); expect(body).not.toHaveProperty('config'); expect(body).not.toHaveProperty('signingSecret');
  const paused = await status.PATCH(authorized('PATCH', { action: 'pause', expectedRevision: 0, requestId: 'demo-pause-http' }));
  expect(await paused.json()).toMatchObject({ presentationState: 'paused', connectionRevision: 1, audit: [expect.objectContaining({ actorUid: 'demo-admin', action: 'pause' })] });
  const list = await conversations.GET(authorized('GET')); expect(await list.json()).toEqual({ conversations: [], truncated: false, observedAt: new Date(now).toISOString() });
});
it('isolated diagnostic arm/public observation/admin summary/DELETE share only singleton state', async () => {
  for (const flag of ['RECEIVE', 'RETENTION', 'AI', 'SEND']) vi.stubEnv(`PLATFORM_WHATSAPP_${flag}_ENABLED`, 'false');
  for (const [name, value] of Object.entries({ PLATFORM_YCLOUD_DIAGNOSTIC_ENABLED: 'true', PLATFORM_YCLOUD_DIAGNOSTIC_RUN_ID: '11111111-1111-4111-8111-111111111111', PLATFORM_YCLOUD_DIAGNOSTIC_EXPIRES_AT: new Date(now + 2_700_000).toISOString(), PLATFORM_YCLOUD_DIAGNOSTIC_SENDER: '+12025550101', PLATFORM_YCLOUD_DIAGNOSTIC_NONCE: nonce })) vi.stubEnv(name, value);
  expect((await diagnostic.POST(authorized('POST', {}))).status).toBe(204);
  const retry = await POST(signed()); expect(retry.status).toBe(503); expect(await retry.text()).toBe('');
  const summary = await diagnostic.GET(authorized('GET')); expect(await summary.json()).toEqual({ status: 'pinned', expiresAt: new Date(now + 2_700_000).toISOString(), requests: 1, attempts: [expect.objectContaining({ eventId: 'demo-http-event', hmacValid: true })] });
  expect([...store.rows.keys()]).toEqual(['serverSettings/ycloud_retry_diagnostic']);
  expect((await diagnostic.DELETE(authorized('DELETE'))).status).toBe(204);
  expect(store.rows.get('serverSettings/ycloud_retry_diagnostic')).toMatchObject({ status: 'closed', requests: 1, attempts: [] });
  expect((await POST(signed())).status).toBe(503); expect((await diagnostic.POST(authorized('POST', {}))).status).toBe(409);
});

it('signed reserved link control never creates ordinary records', async () => {
  const result = await POST(signed({ whatsappInboundMessage: { id: 'demo-control-message', wabaId: scope.wabaId, from: '+12025550101', to: scope.phoneE164, type: 'text', text: { body: 'sarinbot.link.unsupported' } } }));
  expect(result.status).toBe(200); expect(await result.json()).toEqual({ received: true });
  expect(store.rows.size, 'reserved controls must bypass ordinary persistence').toBe(0);
});

describe('signed link controls across real owner API, verifier and local D1', () => {
  let runtime: Awaited<ReturnType<typeof createDataTestRuntime>>, db: Database;
  const transport: DataTransport = async (command) => {
    const result = await runtime.fetch(command), body = await result.json() as DataReadResult | DataCommitResult;
    if (!result.ok)
      throw new StorageError(result.status, (body as unknown as {
        code: string;
      }).code);
    return body;
  };
  beforeAll(async () => {
    runtime = await createDataTestRuntime();
  }, 30000);
  afterAll(async () => {
    await runtime?.dispose();
  });
  beforeEach(async () => {
    configureLink();
    await runtime.db.exec('DELETE FROM app_documents; DELETE FROM app_commits;');
    db = createCloudflareDatabase(transport);
    admin.db.mockReturnValue(db);
    admin.verify.mockResolvedValue(token());
    admin.getUser.mockImplementation(async (uid) => ({ uid, disabled: false }));
    await seedConsents(db);
  });
  function control(text: string, patch: Record<string, unknown> = {}, id = 'demo-control', headers = {}) {
    return signed({ id: id + '-event', whatsappInboundMessage: { id: id + '-message', wabaId: scope.wabaId, from: phone, to: scope.phoneE164, type: 'text', text: { body: text }, ...patch } }, headers);
  }
  async function ordinarySnapshot() {
    return (await runtime.db.prepare("SELECT path,data FROM app_documents WHERE parent IN ('platformWhatsAppConversations','platformWhatsAppEvents') OR path='serverSettings/platform_whatsapp' ORDER BY path").all()).results;
  }
  async function assertReceived(req: Request) {
    const result = await POST(req);
    expect(result.status).toBe(200);
    expect(result.headers.get('cache-control')).toBe('no-store');
    expect(await result.json()).toEqual({ received: true });
  }
  const issue = () => begin(token(), { phoneE164: phone, requestId: 'demo-d1-begin' }, db, now);
  it('proves genuine issued code once without any ordinary envelope, then requires explicit web confirmation', async () => {
    const issuance = await linkRoute.POST(authorized('POST', { action: 'begin', phoneE164: phone, requestId: 'demo-d1-api-begin' }));
    expect(issuance.status).toBe(200);
    const challenge = await issuance.json() as {
      challengeId: string;
      code: string;
      expiresAt: number;
      whatsappUrl: string;
    };
    expect(challenge.whatsappUrl).toBe('https://wa.me/12025550100');
    const before = await ordinarySnapshot();
    await assertReceived(control(challenge.code));
    expect(await ordinarySnapshot()).toEqual(before);
    const state = await linkStatus(token(), db, now);
    expect(state.current).toBeNull();
    expect(state.pending?.proof).toBe('verified');
    const stored = (await db.collection('platformWhatsAppLinkChallenges').doc('challenge_' + challenge.challengeId).get()).data()!;
    expect(stored.status).toBe('verified');
    expect(stored.attempts).toHaveLength(1);
    await assertReceived(control(challenge.code));
    expect((await db.collection('platformWhatsAppLinkChallenges').doc('challenge_' + challenge.challengeId).get()).data()?.attempts).toHaveLength(1);
    expect(await ordinarySnapshot()).toEqual(before);
    const polling = await linkRoute.GET(authorized('GET'));
    expect((await polling.json()).current).toBeNull();
    expect((await linkRoute.POST(authorized('POST', { action: 'confirm', challengeId: challenge.challengeId, requestId: 'demo-d1-api-confirm', confirmed: true }))).status).toBe(200);
    expect(await ordinarySnapshot()).toEqual(before);
    await assertReceived(control('ordinary subsequent message', {}, 'demo-after-proof'));
    const conversation = (await db.collection('platformWhatsAppConversations').doc(stored.conversationId).get()).data();
    expect(conversation?.recordType).toBe('conversation');
    expect(conversation?.lastInboundAt).toBe(now);
  });
  it.each(['sarinbot.link.', 'sarinbot.link.unsupported', 'sarinbot.link.v2:unsupported', 'sarinbot.link.v1:invalid:invalid:invalid'])('consumes malformed or unsupported reserved control %s', async (text) => {
    const before = await ordinarySnapshot();
    await assertReceived(control(text));
    expect(await ordinarySnapshot()).toEqual(before);
    expect((await db.collection('platformWhatsAppLinkChallenges').limit(1).get()).empty).toBe(true);
  });
  it('rejects bound bad MAC without normal history or proof', async () => {
    const c = await issue(), bad = c.code.replace(/:[^:]+$/, ':' + 'A'.repeat(43)), before = await ordinarySnapshot();
    await assertReceived(control(bad));
    expect(await ordinarySnapshot()).toEqual(before);
    const record = (await db.collection('platformWhatsAppLinkChallenges').doc('challenge_' + c.challengeId).get()).data()!;
    expect(record.status).toBe('pending');
    expect(record.attempts).toHaveLength(1);
  });
  it.each([{ from: '+12025550102' }, { wabaId: '99999' }, { from: scope.phoneE164 }, { to: '+12025550102' }])('does not grant proof for foreign phone/scope or self-sender %j', async (patch) => {
    const c = await issue(), before = await ordinarySnapshot();
    await assertReceived(control(c.code, patch));
    expect(await ordinarySnapshot()).toEqual(before);
    const record = (await db.collection('platformWhatsAppLinkChallenges').doc('challenge_' + c.challengeId).get()).data()!;
    expect(record.status).toBe('pending');
    expect(record.attempts).toHaveLength(0);
  });
  it('keeps malformed controls consumed and genuine control unavailable without a link key, while ordinary reception works', async () => {
    const c = await issue();
    vi.stubEnv('PLATFORM_WHATSAPP_LINK_HMAC_KEY', undefined);
    const before = await ordinarySnapshot();
    await assertReceived(control('sarinbot.link.unsupported'));
    expect(await ordinarySnapshot()).toEqual(before);
    const unavailable = await POST(control(c.code));
    expect(unavailable.status).toBe(503);
    expect(await unavailable.json()).toMatchObject({ code: 'LINK_UNAVAILABLE' });
    expect(await ordinarySnapshot()).toEqual(before);
    await assertReceived(control('ordinary reception without link key', {}, 'demo-no-key'));
    expect((await ordinarySnapshot()).length).toBeGreaterThan(0);
  });
  it.each(['database', 'identity'] as const)('returns safe operational %s failure and never falls into ordinary ingestion', async (dependency) => {
    const c = await issue(), before = await ordinarySnapshot();
    if (dependency === 'database')
      admin.db.mockReturnValue(createCloudflareDatabase(async () => {
        throw new Error('synthetic private database detail');
      }));
    else
      admin.getUser.mockRejectedValue(new Error('synthetic private identity detail'));
    const result = await POST(control(c.code));
    expect(result.status).toBe(503);
    const body = await result.json();
    expect(JSON.stringify(body)).not.toContain('private');
    expect(await ordinarySnapshot()).toEqual(before);
  });
  it('rejects invalid signed-reader inputs before accessing any Database', async () => {
    const c = await issue();
    admin.db.mockClear();
    for (const headers of [{ 'YCloud-Signature': 't=1900000000,s=' + '0'.repeat(64) }, { 'content-type': 'application/json-extra' }, { 'content-length': '999999' }]) {
      expect((await POST(control(c.code, {}, 'demo-rejected', headers))).status).toBeGreaterThanOrEqual(400);
    }
    expect(admin.db).not.toHaveBeenCalled();
  });
  it('retains ordinary connection and conversation bytes across proof/rejection after prior human traffic', async () => {
    await assertReceived(control('prior human message', {}, 'demo-before-proof'));
    const c = await issue(), before = await ordinarySnapshot();
    await assertReceived(control(c.code));
    await assertReceived(control('sarinbot.link.unsupported', {}, 'demo-rejected-control'));
    expect(await ordinarySnapshot()).toEqual(before);
  });
});
