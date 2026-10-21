import { createHmac } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readYCloudWebhook as read } from '@/lib/server/ycloud-webhook';
import { HttpError } from '@/lib/server/http';

const secret = ' synthetic signing secret ';
const options = { signingSecret: secret, scope: { wabaId: '12345', phoneE164: '+15550000001' }, now: 1700000000000 };
const incomingType = 'whatsapp.inbound_message.received';
const message = () => ({ id: 'synthetic-message', wabaId: '12345', from: '+15550000002', to: '+15550000001', type: 'text', text: { body: 'synthetic text' } });
const envelope = (type = incomingType) => ({ id: 'synthetic-event', type, apiVersion: 'v2', createTime: '2020-01-01T00:00:00Z', whatsappInboundMessage: message() });
function signature(bytes: Buffer, timestamp = '1700000000') { return createHmac('sha256', secret).update(timestamp + '.').update(bytes).digest('hex'); }
function request(value: unknown, changes: Record<string, string> = {}, timestamp = '1700000000'): Request {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(JSON.stringify(value));
  return new Request('https://synthetic.invalid/webhook', { method: 'POST', body: new Uint8Array(bytes), headers: { 'Content-Type': 'application/json', 'YCloud-Signature': `t=${timestamp},s=${signature(bytes, timestamp)}`, ...changes } });
}
async function fails(promise: Promise<unknown>, status: number, message?: string) {
  await expect(promise).rejects.toBeInstanceOf(HttpError);
  await expect(promise).rejects.toMatchObject({ status, ...(message ? { message } : {}) });
}
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('YCloud authenticated normalization', () => {
  it('normalizes only public fields and does not apply signature freshness to event time', async () => {
    const value = { ...envelope(), extra: 'stripped', whatsappInboundMessage: { ...message(), extra: 'stripped', text: { body: '  \n', ignored: true } } };
    expect(await read(request(value), options)).toEqual({ provider: 'ycloud', eventId: 'synthetic-event', occurredAt: 1577836800000, wabaId: '12345', businessPhone: '+15550000001', kind: 'incoming_text', sourceEventType: incomingType, customerPhone: '+15550000002', messageId: 'synthetic-message', whatsappMessageId: null, text: '  \n' });
    expect(await read(request({ ...value, createTime: '2099-01-01T00:00:00+01:00' }), options)).toMatchObject({ occurredAt: 4070905200000 });
  });
  it.each([{ scope: { ...options.scope, phoneNumberId: '67890' } }, { scope: { ...options.scope, wabaId: '12345\n' } }, { scope: { ...options.scope, phoneE164: '+15550000001\n' } }, { signingSecret: '' }, { signingSecret: ' ' }, { signingSecret: 'a'.repeat(4097) }, { now: -1 }, { now: 1.5 }, { now: Number.MAX_SAFE_INTEGER + 1 }])('validates reader options before body or headers: %j', async (changes) => {
    await fails(read({ get headers(): never { throw new Error('headers visited'); } } as unknown as Request, { ...options, ...changes }), 503, 'La configuración del lector de YCloud no es válida.');
  });
  it('accepts safe clocks beyond record limits and defaults now with Date.now', async () => {
    const large = { ...options, now: 8640000000000001 };
    await fails(read(request(envelope()), large), 401);
    vi.spyOn(Date, 'now').mockReturnValue(options.now);
    expect(await read(request(envelope()), { signingSecret: secret, scope: options.scope })).toMatchObject({ kind: 'incoming_text' });
  });
  it.each(['application/json', 'APPLICATION/JSON', 'application/json;charset=utf-8', 'application/json ; charset=UTF-8'])('accepts exact JSON media type grammar %j', async (type) => {
    expect(await read(request(envelope(), { 'Content-Type': type }), options)).toMatchObject({ kind: 'incoming_text' });
  });
  it.each(['text/json', '', 'application/json; charset="utf-8"', 'application/json; charset=latin1', 'application/json; charset =utf-8', 'application/json; charset=utf-8; x=1'])('rejects media type %j', async (type) => {
    await fails(read(request(envelope(), { 'Content-Type': type }), options), 415, 'Se requiere contenido JSON en UTF-8.');
  });
  it.each(['01', '+1', '-1', '1.0', '1e3', ''])('rejects noncanonical declared length %j', async (length) => {
    await fails(read(request(envelope(), { 'Content-Length': length }), options), 400, 'El tamaño declarado no es válido.');
  });
  it('checks declared length before signatures and actual equality after reading', async () => {
    await fails(read(request(envelope(), { 'Content-Length': '1048577', 'YCloud-Signature': '' }), options), 413, 'El cuerpo supera el tamaño permitido.');
    await fails(read(request(envelope(), { 'Content-Length': '0', 'YCloud-Signature': '' }), options), 400, 'El tamaño declarado no coincide con el cuerpo.');
    const bytes = Buffer.from(JSON.stringify(envelope()));
    expect(await read(request(bytes, { 'Content-Length': String(bytes.length) }), options)).toMatchObject({ kind: 'incoming_text' });
  });
  it('enforces the inclusive one-MiB actual byte limit', async () => {
    const json = JSON.stringify(envelope('ignored'));
    const bytes = Buffer.from(json.padEnd(1048576, ' '));
    expect(await read(request(bytes), options)).toBeNull();
    await fails(read(request(Buffer.concat([bytes, Buffer.from(' ')])), options), 413, 'El cuerpo supera el tamaño permitido.');
  });
  it('uses a total 3000-ms body deadline', async () => {
    vi.useFakeTimers();
    const req = { headers: new Headers({ 'Content-Type': 'application/json' }), signal: new AbortController().signal, body: new ReadableStream<Uint8Array>({ pull() { return new Promise(() => {}); } }) } as Request;
    const assertion = fails(read(req, options), 408, 'Se agotó el tiempo de lectura del cuerpo.');
    void assertion.catch(() => {});
    await vi.advanceTimersByTimeAsync(2999);
    expect(req.body!.locked).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    await assertion;
    expect(req.body!.locked).toBe(false);
  });
  it.each([-300, 300])('accepts inclusive signature window at %i seconds using floored now', async (offset) => {
    const timestamp = String(1700000000 + offset);
    expect(await read(request(envelope(), {}, timestamp), { ...options, now: options.now + 999 })).toMatchObject({ kind: 'incoming_text' });
  });
  it.each([-301, 301])('rejects a signature at %i seconds', async (offset) => {
    await fails(read(request(envelope(), {}, String(1700000000 + offset)), options), 401, 'La firma de YCloud no es válida.');
  });
  it('signs original timestamp digits and supports reordered trimmed rotation signatures', async () => {
    const bytes = Buffer.from(JSON.stringify(envelope()));
    const timestamp = '001700000000';
    const sig = signature(bytes, timestamp).toUpperCase();
    expect(await read(request(bytes, { 'YCloud-Signature': `s=${'0'.repeat(64)}, s=${sig} ,t=${timestamp},s=${'1'.repeat(64)},s=${'2'.repeat(64)},s=${'3'.repeat(64)}` }), options)).toMatchObject({ kind: 'incoming_text' });
    await fails(read(request(bytes, { 'YCloud-Signature': `t=${timestamp},s=${signature(bytes)}` }), options), 401);
  });
  it.each(['', 't=1700000000', `s=${'0'.repeat(64)}`, `t=1700000000,s=${'0'.repeat(64)}`, `t=1700000000,t=1700000000,s=${'0'.repeat(64)}`, `T=1700000000,s=${'0'.repeat(64)}`, `t=1700000000,S=${'0'.repeat(64)}`, `t=1700000000,s=${'g'.repeat(64)}`, 't=1700000000000,s=' + '0'.repeat(64), 't=1700000000,s=' + '0'.repeat(63), 'x=1,t=1700000000,s=' + '0'.repeat(64), 't=1700000000,s=' + '0'.repeat(64) + ',', 'x'.repeat(1025)])('rejects malformed signature %j before JSON', async (header) => {
    await fails(read(request(Buffer.from('not JSON'), { 'YCloud-Signature': header }), options), 401, 'La firma de YCloud no es válida.');
  });
  it('rejects missing headers and six signatures even if one signature matches', async () => {
    const missing = request(envelope()); missing.headers.delete('YCloud-Signature');
    await fails(read(missing, options), 401);
    const bytes = Buffer.from(JSON.stringify(envelope()));
    await fails(read(request(bytes, { 'YCloud-Signature': 't=1700000000,' + Array(6).fill(`s=${signature(bytes)}`).join(',') }), options), 401);
  });
  it('authenticates original bytes and rejects signed malformed UTF-8, BOM and JSON', async () => {
    const bytes = Buffer.from(JSON.stringify(envelope()));
    await fails(read(request(Buffer.concat([bytes, Buffer.from(' ')]), { 'YCloud-Signature': `t=1700000000,s=${signature(bytes)}` }), options), 401);
    for (const raw of [Buffer.from([0xc3, 0x28]), Buffer.from('not JSON'), Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), bytes])]) await fails(read(request(raw), options), 400, 'JSON no válido.');
  });
  it('requires a valid envelope even for ignored types and versions', async () => {
    expect(await read(request(envelope('ignored')), options)).toBeNull();
    expect(await read(request({ ...envelope(), apiVersion: 'v1', whatsappInboundMessage: null }), options)).toBeNull();
    for (const changes of [{ id: '' }, { id: 'has space' }, { id: 'x'.repeat(257) }, { type: 'bad\n' }, { apiVersion: '' }, { apiVersion: 'v'.repeat(33) }, { createTime: '2020-01-01' }, { createTime: '2020-02-31T00:00:00Z' }]) await fails(read(request({ ...envelope('ignored'), ...changes }), options), 400, 'El evento de YCloud no es válido.');
  });
  it('filters valid inbound direction, scope, self and non-text before text parsing', async () => {
    for (const changes of [{ wabaId: '99999' }, { to: '+15550000003' }, { from: '+15550000001' }, { type: 'audio' }]) expect(await read(request({ ...envelope(), whatsappInboundMessage: { ...message(), ...changes, text: null } }), options)).toBeNull();
    await fails(read(request({ ...envelope(), whatsappInboundMessage: { ...message(), wabaId: 'bad' } }), options), 400);
  });
  it('preserves frozen Zod codepoint limits and optional wamid', async () => {
    const accepted = { ...message(), id: 'x'.repeat(256), wamid: '😀'.repeat(1024), type: 'text', text: { body: '😀'.repeat(4096) } };
    expect(await read(request({ ...envelope(), whatsappInboundMessage: accepted }), options)).toMatchObject({ whatsappMessageId: accepted.wamid, text: accepted.text.body });
    for (const changes of [{ id: '' }, { id: 'non ascii é' }, { wamid: '' }, { wamid: '😀'.repeat(1025) }, { type: '' }, { type: 'x'.repeat(65) }, { text: { body: '' } }, { text: { body: '😀'.repeat(4096) + 'x' } }, { text: undefined }]) await fails(read(request({ ...envelope(), whatsappInboundMessage: { ...message(), ...changes } }), options), 400, 'El evento de YCloud no es válido.');
  });
  it.each(['whatsapp.smb.message.echoes', 'whatsapp.smb.message.created'])('normalizes human text and media metadata for %s', async (type) => {
    const echo = { ...message(), from: '+15550000001', to: '+15550000002', wamid: 'synthetic-wamid' };
    expect(await read(request({ ...envelope(type), whatsappMessage: echo }), options)).toEqual({ provider: 'ycloud', eventId: 'synthetic-event', occurredAt: 1577836800000, wabaId: '12345', businessPhone: '+15550000001', kind: 'human_echo', sourceEventType: type, customerPhone: '+15550000002', messageId: 'synthetic-message', whatsappMessageId: 'synthetic-wamid', messageType: 'text', text: 'synthetic text' });
    expect(await read(request({ ...envelope(type), whatsappMessage: { ...echo, type: 'image', text: null, image: { url: 'https://synthetic.invalid/never-fetched' } } }), options)).toMatchObject({ kind: 'human_echo', messageType: 'image', text: null });
    await fails(read(request({ ...envelope(type), whatsappMessage: { ...echo, text: null } }), options), 400);
    for (const change of [{ wabaId: '99999' }, { from: '+15550000003' }, { to: '+15550000001' }]) expect(await read(request({ ...envelope(type), whatsappMessage: { ...echo, ...change } }), options)).toBeNull();
  });
  it.each(['accepted', 'sent', 'delivered', 'read', 'failed'])('normalizes status %s with nullable customer and optional fields', async (status) => {
    const value = { ...envelope('whatsapp.message.updated'), whatsappMessage: { id: 'synthetic-message', wabaId: '12345', from: '+15550000001', status } };
    expect(await read(request(value), options)).toEqual({ provider: 'ycloud', eventId: 'synthetic-event', occurredAt: 1577836800000, wabaId: '12345', businessPhone: '+15550000001', kind: 'message_status', sourceEventType: 'whatsapp.message.updated', customerPhone: null, messageId: 'synthetic-message', whatsappMessageId: null, status });
  });
  it('filters status scope/direction/missing fields and unknown enum', async () => {
    const status = { id: 'synthetic-message', wabaId: '12345', from: '+15550000001', status: 'read' };
    for (const change of [{ wabaId: undefined }, { from: undefined }, { wabaId: '99999' }, { from: '+15550000003' }, { to: '+15550000001' }, { status: 'unknown' }]) expect(await read(request({ ...envelope('whatsapp.message.updated'), whatsappMessage: { ...status, ...change } }), options)).toBeNull();
    expect(await read(request({ ...envelope('whatsapp.message.updated'), whatsappMessage: { ...status, to: '+15550000002', wamid: 'synthetic-wamid' } }), options)).toMatchObject({ customerPhone: '+15550000002', whatsappMessageId: 'synthetic-wamid' });
    for (const change of [{ status: '' }, { to: null }, { from: 'bad' }]) await fails(read(request({ ...envelope('whatsapp.message.updated'), whatsappMessage: { ...status, ...change } }), options), 400);
  });
  it('does not add method or Content-Encoding restrictions at the reader layer', async () => {
    const original = request(envelope(), { 'Content-Encoding': 'synthetic-ignored' });
    const changed = new Request(original.url, { method: 'PUT', headers: original.headers, body: await original.arrayBuffer() });
    expect(await read(changed, options)).toMatchObject({ kind: 'incoming_text' });
  });
});
