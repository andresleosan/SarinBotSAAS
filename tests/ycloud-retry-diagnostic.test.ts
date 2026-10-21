import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash, createHmac } from 'node:crypto';
import { getYCloudRetryDiagnosticConfig, getYCloudRetryDiagnosticObserver, readYCloudRetryDiagnosticSummary, closeYCloudRetryDiagnostic } from '@/lib/server/ycloud-retry-diagnostic';
import { createCloudflareDatabase, StorageError } from '@/lib/storage/database';
import { HttpError } from '@/lib/server/http';
import { memoryStore } from './platform-whatsapp-test-fixtures';

const now = 1_900_000_000_000;
const path = 'serverSettings/ycloud_retry_diagnostic';
const processKey = Symbol.for('sarin.ycloud.retry-diagnostic.process');
const config = { runId: '11111111-1111-4111-8111-111111111111', expiresAt: now + 2_700_000, signingSecret: 'demo-only-diagnostic-secret', wabaId: '10001', phoneE164: '+12025550100', sender: '+12025550101', nonce: 'demo-only-nonce-0123456789abcdefghij' };
let store: ReturnType<typeof memoryStore>;
let clock = now;
const processState = () => (globalThis as any)[processKey];
const observer = (overrides = {}, db = store.db) => getYCloudRetryDiagnosticObserver({ ...config, ...overrides }, db);
function envelope(overrides: Record<string, unknown> = {}) {
  return { id: 'demo-event-1', type: 'whatsapp.inbound_message.received', apiVersion: 'v2', createTime: new Date(now).toISOString(), whatsappInboundMessage: { id: 'demo-message-1', wabaId: config.wabaId, from: config.sender, to: config.phoneE164, type: 'text', text: { body: config.nonce } }, ...overrides };
}
function request(value: unknown = envelope(), timestamp = String(Math.floor(clock / 1000)), headers: Record<string, string> = {}) {
  const raw = Buffer.isBuffer(value) ? value : Buffer.from(JSON.stringify(value));
  const signature = createHmac('sha256', config.signingSecret).update(timestamp + '.').update(raw).digest('hex');
  return new Request('https://demo.invalid/webhook', { method: 'POST', body: new Uint8Array(raw), headers: { 'content-type': 'application/json', 'YCloud-Signature': `t=${timestamp},s=${signature}`, ...headers } });
}
function enabledEnv(overrides: Record<string, string | undefined> = {}) {
  const values = { PLATFORM_YCLOUD_DIAGNOSTIC_ENABLED: 'true', PLATFORM_WHATSAPP_RECEIVE_ENABLED: 'false', PLATFORM_WHATSAPP_RETENTION_ENABLED: 'false', PLATFORM_WHATSAPP_AI_ENABLED: 'false', PLATFORM_WHATSAPP_SEND_ENABLED: 'false', SARIN_MAINTENANCE: 'false', PLATFORM_YCLOUD_DIAGNOSTIC_EXPIRES_AT: new Date(config.expiresAt).toISOString(), PLATFORM_YCLOUD_DIAGNOSTIC_RUN_ID: config.runId, PLATFORM_YCLOUD_WEBHOOK_SECRET: config.signingSecret, PLATFORM_WHATSAPP_WABA_ID: config.wabaId, PLATFORM_WHATSAPP_PHONE_E164: config.phoneE164, PLATFORM_YCLOUD_DIAGNOSTIC_SENDER: config.sender, PLATFORM_YCLOUD_DIAGNOSTIC_NONCE: config.nonce, ...overrides };
  for (const [name, value] of Object.entries(values)) vi.stubEnv(name, value);
}
async function armed() { const value = observer(); await value.arm(); return value; }
function saved() { return store.rows.get(path)!; }
function seed(patch: Record<string, unknown>) { store.seed(path, { version: 1, runId: config.runId, bootId: processState()?.bootId ?? '22222222-2222-4222-8222-222222222222', createdAt: now, expiresAt: config.expiresAt, requests: 0, status: 'armed', attempts: [], ...patch }); }

beforeEach(() => {
  if (processState()) delete processState().cached;
  store = memoryStore(); clock = now;
  vi.spyOn(Date, 'now').mockImplementation(() => clock);
  enabledEnv({ PLATFORM_YCLOUD_DIAGNOSTIC_ENABLED: undefined });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.useRealTimers(); });

describe('diagnostic config and process cache', () => {
  it('parses isolated enabled config without checking expiry yet', () => {
    enabledEnv({ PLATFORM_YCLOUD_DIAGNOSTIC_EXPIRES_AT: new Date(now - 1).toISOString() });
    expect(getYCloudRetryDiagnosticConfig()).toEqual({ ...config, expiresAt: now - 1 });
  });
  it.each([undefined, 'false'])('disables only absent/false (%s)', flag => { vi.stubEnv('PLATFORM_YCLOUD_DIAGNOSTIC_ENABLED', flag); expect(getYCloudRetryDiagnosticConfig()).toBeNull(); });
  it.each(['', 'TRUE', '0', ' true'])('rejects malformed flag %s', flag => { enabledEnv({ PLATFORM_YCLOUD_DIAGNOSTIC_ENABLED: flag }); expect(() => getYCloudRetryDiagnosticConfig()).toThrow(expect.objectContaining({ status: 503 })); });
  it.each(['RECEIVE', 'RETENTION', 'AI', 'SEND'])('requires explicit isolated %s=false', flag => {
    enabledEnv({ [`PLATFORM_WHATSAPP_${flag}_ENABLED`]: undefined });
    expect(() => getYCloudRetryDiagnosticConfig()).toThrow(expect.objectContaining({ status: 503 }));
  });
  it.each([
    { SARIN_MAINTENANCE: 'true' }, { PLATFORM_YCLOUD_DIAGNOSTIC_EXPIRES_AT: '2030-01-01' },
    { PLATFORM_YCLOUD_DIAGNOSTIC_RUN_ID: 'bad' }, { PLATFORM_YCLOUD_WEBHOOK_SECRET: ' ' },
    { PLATFORM_WHATSAPP_WABA_ID: '1234' }, { PLATFORM_YCLOUD_DIAGNOSTIC_SENDER: config.phoneE164 },
    { PLATFORM_YCLOUD_DIAGNOSTIC_NONCE: 'x'.repeat(31) }, { PLATFORM_YCLOUD_DIAGNOSTIC_NONCE: 'x'.repeat(129) },
  ])('rejects invalid enabled configuration %j', patch => { enabledEnv(patch); expect(() => getYCloudRetryDiagnosticConfig()).toThrow(expect.objectContaining({ status: 503 })); });
  it('pins the first DB, boot and copied cache config', async () => {
    const mutable = { ...config }, second = memoryStore();
    const first = getYCloudRetryDiagnosticObserver(mutable, store.db);
    expect(getYCloudRetryDiagnosticObserver({ ...config }, second.db)).toBe(first);
    await first.arm();
    expect(saved()).toMatchObject({ runId: config.runId, bootId: processState()?.bootId, status: 'armed' });
    expect(second.rows.size).toBe(0);
    mutable.nonce = 'z'.repeat(32);
    expect(() => getYCloudRetryDiagnosticObserver(mutable, second.db)).toThrow(expect.objectContaining({ status: 503 }));
  });
  it('retains boot and cached observer across module reload', async () => {
    const first = observer(); const beforeBoot = processState()?.bootId;
    vi.resetModules();
    const reloaded = await import('@/lib/server/ycloud-retry-diagnostic');
    expect(reloaded.getYCloudRetryDiagnosticObserver({ ...config }, memoryStore().db)).toBe(first);
    expect(processState()?.bootId).toBe(beforeBoot); await first.arm(); expect(saved().bootId).toBe(beforeBoot);
  });
  it.each([{ runId: '33333333-3333-4333-8333-333333333333' }, { expiresAt: config.expiresAt - 1 }, { signingSecret: 'demo-other' }, { wabaId: '10002' }, { phoneE164: '+12025550102' }, { sender: '+12025550103' }, { nonce: 'z'.repeat(32) }])('rejects changed cached config field %j', patch => {
    observer(); expect(() => observer(patch)).toThrow(expect.objectContaining({ status: 503 }));
  });
  it.each([{ extra: true }, { sender: config.phoneE164 }, { expiresAt: 0 }, { nonce: 'short' }])('rejects invalid observer configuration %j', patch => {
    expect(() => observer(patch)).toThrow(expect.objectContaining({ status: 503 }));
  });
});

describe('durable lifecycle', () => {
  it('arms exactly once at the inclusive 45-minute boundary', async () => {
    const value = await armed();
    expect(saved()).toEqual({ version: 1, runId: config.runId, bootId: processState()?.bootId, createdAt: now, expiresAt: config.expiresAt, requests: 0, status: 'armed', attempts: [] });
    await expect(value.arm()).rejects.toMatchObject({ status: 409, message: 'Ya existe un diagnóstico; no se puede rearmar.' });
  });
  it.each([now, now - 1, now + 2_700_001])('rejects arm expiry %s', async expiresAt => { await expect(observer({ expiresAt }).arm()).rejects.toMatchObject({ status: 503 }); expect(store.rows.size).toBe(0); });
  it.each(['closed', 'aborted', 'compatible', 'invalid'])('never overwrites existing %s state', async status => {
    seed({ status }); const before = structuredClone(saved());
    await expect(observer().arm()).rejects.toMatchObject({ status: 409 }); expect(saved()).toEqual(before);
  });
  it('summary rejects absent and structurally invalid state', async () => {
    await expect(readYCloudRetryDiagnosticSummary(store.db)).rejects.toMatchObject({ status: 503 });
    seed({ requests: 33 }); await expect(readYCloudRetryDiagnosticSummary(store.db)).rejects.toMatchObject({ status: 503 });
  });
  it('summary returns only the four frozen fields including validated tuples for old boots', async () => {
    const attempt = { eventId: 'demo', bodySha256: 'a'.repeat(64), arrivalUtc: new Date(now).toISOString(), signedT: 1, hmacValid: true };
    seed({ status: 'compatible', requests: 3, bootId: '22222222-2222-4222-8222-222222222222', expiresAt: now - 1, attempts: [attempt] });
    expect(await readYCloudRetryDiagnosticSummary(store.db)).toEqual({ status: 'compatible', requests: 3, expiresAt: new Date(now - 1).toISOString(), attempts: [attempt] });
  });
  it.each([{ requests: 0.5 }, { createdAt: -1 }, { version: 2 }, { attempts: [{ eventId: 'demo', bodySha256: 'A'.repeat(64), arrivalUtc: new Date(now).toISOString(), signedT: 1, hmacValid: true }] }, { attempts: [{ eventId: 'demo', bodySha256: 'a'.repeat(64), arrivalUtc: new Date(now).toISOString(), signedT: 1, hmacValid: true, extra: true }] }])('structural reads and both close paths reject malformed data %j', async patch => {
    const value = observer(); seed(patch); const before = structuredClone(saved());
    await expect(value.read()).rejects.toMatchObject({ status: 503 });
    await expect(value.close()).rejects.toMatchObject({ status: 503 });
    await expect(closeYCloudRetryDiagnostic(store.db)).rejects.toMatchObject({ status: 503 });
    await expect(readYCloudRetryDiagnosticSummary(store.db)).rejects.toMatchObject({ status: 503 }); expect(saved()).toEqual(before);
  });
  it('admin close preserves old boot, expiry and request count but clears tuples', async () => {
    seed({ bootId: '22222222-2222-4222-8222-222222222222', expiresAt: now - 1, requests: 12, status: 'pinned', attempts: [{ eventId: 'demo', bodySha256: 'a'.repeat(64), arrivalUtc: new Date(now).toISOString(), signedT: 1, hmacValid: true }] });
    const before = structuredClone(saved()); await closeYCloudRetryDiagnostic(store.db);
    expect(saved()).toEqual({ ...before, status: 'closed', attempts: [] });
  });
  it('admin close is durable-only; next observe reads and rejects closed state', async () => {
    const value = await armed(); await closeYCloudRetryDiagnostic(store.db);
    const reads = store.seen.length;
    await expect(value.observe(request())).rejects.toMatchObject({ status: 503 });
    expect(store.seen.length).toBeGreaterThan(reads);
    await expect(value.arm()).rejects.toMatchObject({ status: 409 });
  });
  it('observer close sets local closure after its durable write', async () => {
    const value = await armed(); await value.close(); const reads = store.seen.length;
    await expect(value.observe(request())).rejects.toMatchObject({ status: 503 }); expect(store.seen.length).toBe(reads);
  });
  it.each([{ runId: '22222222-2222-4222-8222-222222222222' }, { bootId: '22222222-2222-4222-8222-222222222222' }, { expiresAt: now + 1 }, { createdAt: now + 1 }, { createdAt: now - 1 }, { status: 'pinned' }, { status: 'closed' }, { status: 'aborted' }, { unexpected: true }, { requests: -1 }])('rejects corrupt/mismatched operational state %j before writes', async patch => {
    const value = observer(); seed(patch); const before = structuredClone(saved());
    await expect(value.observe(request())).rejects.toMatchObject({ status: 503 }); expect(saved()).toEqual(before);
  });
  it('expiry fails without rewriting status and structural read still works', async () => {
    const value = await armed(); clock = config.expiresAt;
    await expect(value.observe(request())).rejects.toMatchObject({ status: 503 });
    expect(await value.read()).toMatchObject({ status: 'armed', requests: 0 });
  });
});

describe('raw authentication and request budgets', () => {
  it.each([
    [{ 'content-type': 'application/json-extra' }, 415], [{ 'content-length': '01' }, 400],
    [{ 'content-length': '3' }, 400], [{ 'content-length': '1048577' }, 413],
    [{ 'YCloud-Signature': 't=1,s=bad' }, 401], [{ 'YCloud-Signature': '' }, 401],
  ] as const)('spends a persisted request before malformed input %j', async (headers, status) => {
    const value = await armed(); await expect(value.observe(request({}, undefined, headers))).rejects.toMatchObject({ status });
    expect(saved()).toMatchObject({ requests: 1, status: 'armed', attempts: [] });
  });
  it.each([Buffer.from([0xff]), Buffer.from('\ufeff{}'), Buffer.from('{')])('rejects invalid UTF-8/BOM/JSON without tuples', async raw => {
    const value = await armed(); await expect(value.observe(request(raw))).rejects.toMatchObject({ status: 400 }); expect(saved()).toMatchObject({ requests: 1, attempts: [] });
  });
  it('uses exact raw bytes and preserves leading timestamp zeroes and uppercase signatures', async () => {
    const value = await armed(); const raw = Buffer.from(' { "unrelated":true } ');
    const req = request(raw, '000000000001'); req.headers.set('YCloud-Signature', req.headers.get('YCloud-Signature')!.replace(/s=(.*)/, (_, hex) => 's=' + hex.toUpperCase()));
    expect(await value.observe(req)).toBe(204);
    const changed = request(Buffer.concat([raw, Buffer.from(' ')]), '000000000001', { 'YCloud-Signature': request(raw, '000000000001').headers.get('YCloud-Signature')! });
    await expect(value.observe(changed)).rejects.toMatchObject({ status: 401 }); expect(saved()).toMatchObject({ requests: 2, attempts: [] });
  });
  it.each(['duplicate-t', 'six-signatures', 'extra', 'empty-token', 'oversized'])('rejects signature grammar %s', async mode => {
    const value = await armed(), req = request({}); const valid = req.headers.get('YCloud-Signature')!;
    req.headers.set('YCloud-Signature', mode === 'duplicate-t' ? valid + ',t=1' : mode === 'six-signatures' ? valid + (',' + valid.split(',')[1]).repeat(5) : mode === 'extra' ? valid + ',v=1' : mode === 'empty-token' ? valid + ',' : 'x'.repeat(1025));
    await expect(value.observe(req)).rejects.toMatchObject({ status: 401 });
  });
  it('accepts one matching signature among five', async () => {
    const value = await armed(), req = request({}); req.headers.set('YCloud-Signature', req.headers.get('YCloud-Signature')! + (',s=' + '0'.repeat(64)).repeat(4));
    expect(await value.observe(req)).toBe(204); expect(saved().requests).toBe(1);
  });
  it('enforces local total32 independently of persisted count', async () => {
    const value = await armed();
    for (let i = 0; i < 32; i++) { expect(await value.observe(request({}))).toBe(204); seed({ requests: 0 }); }
    const reads = store.seen.length;
    await expect(value.observe(request({}))).rejects.toMatchObject({ status: 503 }); expect(store.seen.length).toBe(reads); expect(saved().requests).toBe(0);
  });
  it('enforces persisted32 after local restart and counts failed first transactions locally', async () => {
    const value = observer(); seed({ requests: 32 });
    for (let i = 0; i < 32; i++) await expect(value.observe(request({}))).rejects.toMatchObject({ status: 503 });
    seed({ requests: 0 }); const reads = store.seen.length;
    await expect(value.observe(request({}))).rejects.toMatchObject({ status: 503 }); expect(store.seen.length).toBe(reads);
  });
  it('limits concurrency to two and releases it after invalid requests', async () => {
    const value = await armed(); const controllers: ReadableStreamDefaultController<Uint8Array>[] = [];
    const streamRequest = () => new Request('https://demo.invalid', { method: 'POST', headers: { 'content-type': 'application/json' }, body: new ReadableStream({ start(c) { controllers.push(c); } }), duplex: 'half' } as RequestInit);
    const first = value.observe(streamRequest()).catch((e: unknown) => e), second = value.observe(streamRequest()).catch((e: unknown) => e);
    await vi.waitFor(() => expect(saved()?.requests).toBe(2));
    await expect(value.observe(request({}))).rejects.toMatchObject({ status: 503 });
    for (const c of controllers) c.close();
    expect(await first).toMatchObject({ status: 401 }); expect(await second).toMatchObject({ status: 401 });
    expect(await value.observe(request({}))).toBe(204); expect(saved().requests).toBe(3);
  });
  it('cancels a stalled body at three seconds', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    const value = await armed(), cancel = vi.fn();
    const req = new Request('https://demo.invalid', { method: 'POST', headers: { 'content-type': 'application/json' }, body: new ReadableStream({ cancel }), duplex: 'half' } as RequestInit);
    const pending = value.observe(req).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(3001);
    expect(await pending).toMatchObject({ status: 408 }); expect(cancel).toHaveBeenCalledOnce(); expect(saved().requests).toBe(1);
  });
  it('bounds actual streamed bytes and preserves abort499', async () => {
    const value = await armed(); await expect(value.observe(request(Buffer.alloc(1_048_577)))).rejects.toMatchObject({ status: 413 });
    const controller = new AbortController(); controller.abort();
    const req = new Request(request({}), { signal: controller.signal });
    await expect(value.observe(req)).rejects.toMatchObject({ status: 499 }); expect(saved().requests).toBe(2);
  });
});

describe('candidate and retry state machine', () => {
  it.each([{ apiVersion: 'v1' }, { type: 'whatsapp.message.updated' }, { whatsappInboundMessage: { ...envelope().whatsappInboundMessage, wabaId: '99999' } }, { whatsappInboundMessage: { ...envelope().whatsappInboundMessage, to: '+12025550999' } }, { whatsappInboundMessage: { ...envelope().whatsappInboundMessage, from: '+12025550999' } }, { whatsappInboundMessage: { ...envelope().whatsappInboundMessage, type: 'image' } }, { whatsappInboundMessage: { ...envelope().whatsappInboundMessage, text: { body: 'wrong' } } }, { id: '' }])('does not pin unrelated/invalid candidate %j', async patch => {
    const value = await armed(); expect(await value.observe(request(envelope(patch)))).toBe(204); expect(saved()).toMatchObject({ status: 'armed', attempts: [], requests: 1 });
  });
  it('requires ordinary reader completeness and preserves only401 as stale', async () => {
    const value = await armed(); const event: any = envelope(); delete event.createTime;
    await expect(value.observe(request(event))).rejects.toMatchObject({ status: 503 });
    expect(await value.observe(request(envelope(), String(now / 1000 - 301)))).toBe(204);
    expect(saved()).toMatchObject({ status: 'armed', attempts: [], requests: 2 });
  });
  it('pins exact raw SHA and arrival time on first accepted candidate', async () => {
    const value = await armed(), raw = Buffer.from(JSON.stringify(envelope()));
    expect(await value.observe(request(raw))).toBe(503);
    expect(saved()).toMatchObject({ requests: 1, status: 'pinned', attempts: [{ eventId: 'demo-event-1', bodySha256: createHash('sha256').update(raw).digest('hex'), arrivalUtc: new Date(now).toISOString(), signedT: now / 1000, hmacValid: true }] });
    expect([...store.rows.keys()]).toEqual([path]);
  });
  it.each([
    [300_000, 300, 'pinned', 503], [300_001, 300, 'compatible', 204],
    [301_000, 0, 'incompatible', 204], [300_001, 0, 'inconclusive', 204],
  ] as const)('classifies elapsed%s refreshed%s as%s', async (elapsed, refresh, status, response) => {
    const value = await armed(); expect(await value.observe(request())).toBe(503); clock += elapsed;
    expect(await value.observe(request(envelope(), String(now / 1000 + refresh)))).toBe(response);
    expect(saved()).toMatchObject({ status, requests: 2 }); expect(saved().attempts).toHaveLength(2);
  });
  it('uses first signed timestamp rather than the latest retry', async () => {
    const value = await armed(); await value.observe(request()); clock += 1000;
    await value.observe(request(envelope(), String(now / 1000 + 200))); clock = now + 300_001;
    expect(await value.observe(request(envelope(), String(now / 1000 + 100)))).toBe(204); expect(saved().status).toBe('compatible');
  });
  it('sorts attempts by arrival captured before read, even with reverse completion order', async () => {
    const value = await armed(); let release!: () => void;
    const raw = Buffer.from(JSON.stringify(envelope())); const first = request(raw);
    const req = new Request(first.url, { method: 'POST', headers: first.headers, body: new ReadableStream({ start(c) { release = () => { c.enqueue(raw); c.close(); }; } }), duplex: 'half' } as RequestInit);
    const pending = value.observe(req); await vi.waitFor(() => expect(saved()?.requests).toBe(1));
    clock = now + 1000; expect(await value.observe(request(raw))).toBe(503); release(); expect(await pending).toBe(503);
    expect(saved().attempts).toEqual([expect.objectContaining({ arrivalUtc: new Date(now).toISOString() }), expect.objectContaining({ arrivalUtc: new Date(now + 1000).toISOString() })]);
  });
  it.each(['raw-collision', 'candidate-id'])('aborts on %s with existing tuples retained', async collision => {
    const value = await armed(); await value.observe(request()); const attempts = structuredClone(saved().attempts);
    expect(await value.observe(request(envelope(collision === 'raw-collision' ? { type: 'unrelated' } : { id: 'demo-event-2' })))).toBe(503);
    expect(saved()).toMatchObject({ status: 'aborted', attempts });
    await expect(value.observe(request())).rejects.toMatchObject({ status: 503 });
  });
  it.each(['compatible', 'incompatible', 'inconclusive'])('terminal%s does not append but still aborts changed raw hash', async status => {
    const value = await armed(); await value.observe(request()); seed({ ...saved(), status });
    expect(await value.observe(request())).toBe(204); expect(saved().attempts).toHaveLength(1);
    expect(await value.observe(request(envelope({ type: 'unrelated' })))).toBe(503); expect(saved().status).toBe('aborted');
  });
  it('permits unrelated distinct ID after pin without aborting', async () => {
    const value = await armed(); await value.observe(request());
    expect(await value.observe(request(envelope({ id: 'demo-other', type: 'unrelated' })))).toBe(204); expect(saved()).toMatchObject({ status: 'pinned', requests: 2 }); expect(saved().attempts).toHaveLength(1);
  });
  it('aborts the seventeenth candidate independently of request budget', async () => {
    const value = await armed(); for (let i = 0; i < 16; i++) expect(await value.observe(request())).toBe(503);
    expect(saved().attempts).toHaveLength(16); expect(await value.observe(request())).toBe(503);
    expect(saved()).toMatchObject({ status: 'aborted', requests: 17 }); expect(saved().attempts).toHaveLength(16);
  });
  it('checks expiry again after body read without persisting an attempt', async () => {
    const value = await armed(); const req = request(); const raw = new Uint8Array(await req.arrayBuffer());
    const delayed = new Request(req.url, { method: 'POST', headers: req.headers, body: new ReadableStream({ pull(c) { clock = config.expiresAt; c.enqueue(raw); c.close(); } }), duplex: 'half' } as RequestInit);
    await expect(value.observe(delayed)).rejects.toMatchObject({ status: 503 }); expect(saved()).toMatchObject({ requests: 1, attempts: [], status: 'armed' });
  });
});

describe('transaction replay, rollback and failures', () => {
  it('recomputes a CAS-lost request transaction without double increment', async () => {
    let loseCas = true;
    const db = createCloudflareDatabase(async command => {
      if (command.action === 'commit' && command.writes.some(w => w.op !== 'delete' && w.data.requests === 1) && loseCas) {
        loseCas = false; store.seed(path, { ...saved(), requests: 1 }); throw new StorageError(409, 'DATA_CONFLICT');
      }
      return store.transport(command);
    });
    const value = observer({}, db); await value.arm(); expect(await value.observe(request({}))).toBe(204);
    expect(saved()).toMatchObject({ requests: 2, attempts: [], status: 'armed' });
  });
  it('replays a lost durable request commit without spending twice', async () => {
    const value = await armed(); store.loseNextResponse(); expect(await value.observe(request({}))).toBe(204);
    expect(saved().requests).toBe(1);
    const commits = store.seen.filter(c => c.action === 'commit'); expect(commits[1]).toEqual(commits[2]);
  });
  it('rolls back a rejected attempt transaction, retaining only spent budget', async () => {
    let rejectAttempt = true;
    const db = createCloudflareDatabase(async command => {
      if (command.action === 'commit' && command.writes.some(w => w.op !== 'delete' && w.data.status === 'pinned') && rejectAttempt) throw new StorageError(400, 'DATA_INVALID');
      return store.transport(command);
    });
    const value = observer({}, db); await value.arm(); await expect(value.observe(request())).rejects.toMatchObject({ status: 400 });
    expect(saved()).toMatchObject({ requests: 1, status: 'armed', attempts: [] });
    rejectAttempt = false; expect(await value.observe(request())).toBe(503); expect(saved().attempts).toHaveLength(1);
  });
  it('preserves HttpError but closes locally after an unexpected transaction error', async () => {
    const value = await armed(); const original = store.db.runTransaction.bind(store.db);
    const tx = vi.spyOn(store.db, 'runTransaction').mockRejectedValueOnce(new HttpError(429, 'synthetic', 'DEMO', 7));
    await expect(value.observe(request({}))).rejects.toMatchObject({ status: 429, code: 'DEMO' });
    expect(await value.observe(request({}))).toBe(204);
    tx.mockRejectedValueOnce(new Error('synthetic backend failure'));
    await expect(value.observe(request({}))).rejects.toMatchObject({ status: 503, message: 'El diagnóstico no está disponible.' });
    tx.mockImplementation(original); const calls = tx.mock.calls.length;
    await expect(value.observe(request({}))).rejects.toMatchObject({ status: 503 }); expect(tx.mock.calls.length).toBe(calls);
  });
});
