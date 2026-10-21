import { createCipheriv, createDecipheriv } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { encryptPlatformWhatsAppContent as encrypt, decryptPlatformWhatsAppContent as decrypt, platformWhatsAppDigest as digest } from '@/lib/server/platform-whatsapp-crypto';
import { HttpError } from '@/lib/server/http';

const key = Buffer.alloc(32, 7);
const path = 'platformWhatsAppEvents/synthetic';
const vector = { version: 1, iv: 'AwMDAwMDAwMDAwMD', tag: '7wRbFIkEtUdMyeefZhCNTA==', data: 'XtzXZiJcfHhYMzoynz+aeIRfwpI=' };
const invalidMessage = 'El contenido cifrado de WhatsApp no es válido.';
function errorStatus(action: () => unknown, status: number, message?: string) {
  try { action(); throw new Error('unexpected acceptance'); }
  catch (error) { expect(error).toBeInstanceOf(HttpError); expect(error).toMatchObject({ status, ...(message ? { message } : {}) }); }
}
function authenticated(bytes: Buffer) {
  const iv = Buffer.alloc(12, 3);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from('["sarin/platform-whatsapp",1,"content","platformWhatsAppEvents/synthetic"]'));
  const data = Buffer.concat([cipher.update(bytes), cipher.final()]);
  return { version: 1, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') };
}

describe('platform content cryptography', () => {
  it('decrypts a fixed independent AES-GCM vector with the original key and exact AAD', () => {
    expect(decrypt(vector, path, key)).toEqual({ text: 'synthetic' });
  });
  it('encrypts interoperable JSON with fresh 12-byte IV and 16-byte tag', () => {
    const value = { text: 'synthetic 😀', omitted: undefined, nested: [1, null, true] };
    const envelope = encrypt(value, path, key);
    expect(Object.keys(envelope).sort()).toEqual(['data', 'iv', 'tag', 'version']);
    expect(envelope.version).toBe(1);
    expect(Buffer.from(envelope.iv, 'base64')).toHaveLength(12);
    expect(Buffer.from(envelope.tag, 'base64')).toHaveLength(16);
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'base64'));
    decipher.setAAD(Buffer.from('["sarin/platform-whatsapp",1,"content","platformWhatsAppEvents/synthetic"]'));
    decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
    expect(JSON.parse(Buffer.concat([decipher.update(Buffer.from(envelope.data, 'base64')), decipher.final()]).toString())).toEqual({ text: 'synthetic 😀', nested: [1, null, true] });
    expect(decrypt(envelope, path, key)).toEqual({ text: 'synthetic 😀', nested: [1, null, true] });
    expect(encrypt(value, path, key).iv).not.toBe(envelope.iv);
  });
  it('binds exact path, key, ciphertext and authentication tag', () => {
    for (const changedPath of [path + '/', ' ' + path, path.toUpperCase()]) errorStatus(() => decrypt(vector, changedPath, key), 400, invalidMessage);
    errorStatus(() => decrypt(vector, path, Buffer.alloc(32, 8)), 400, invalidMessage);
    for (const field of ['iv', 'tag', 'data'] as const) {
      const bytes = Buffer.from(vector[field], 'base64'); bytes[0] ^= 1;
      errorStatus(() => decrypt({ ...vector, [field]: bytes.toString('base64') }, path, key), 400, invalidMessage);
    }
    expect(decrypt(encrypt(null, ' // synthetic// ', key), ' // synthetic// ', key)).toBeNull();
  });
  it.each(['', ' ', 'x\n', 'x\0', 'x\x7f', 'x'.repeat(1025), 1])('rejects invalid path %j', (badPath) => {
    errorStatus(() => encrypt({}, badPath as string, key), 400, invalidMessage);
    errorStatus(() => decrypt(vector, badPath as string, key), 400, invalidMessage);
  });
  it('accepts a 1024-unit path without normalization', () => {
    const boundary = 'x'.repeat(1024);
    expect(decrypt(encrypt(false, boundary, key), boundary, key)).toBe(false);
  });
  it('validates Buffer keys before path, payload or digest arguments', () => {
    const explosive = { toJSON() { throw new Error('payload visited'); } };
    for (const badKey of [Buffer.alloc(31), Buffer.alloc(33), new Uint8Array(32), null]) {
      for (const action of [() => encrypt(explosive, '', badKey as Buffer), () => decrypt(null, '', badKey as Buffer), () => digest('', [], badKey as Buffer)]) errorStatus(action, 503, 'La clave de WhatsApp de plataforma no es válida.');
    }
  });
  it('rejects serialization failures but preserves ordinary JSON semantics', () => {
    const circular: Record<string, unknown> = {}; circular.self = circular;
    for (const value of [undefined, () => 1, Symbol('synthetic'), 1n, circular, { toJSON() { throw new Error('synthetic'); } }]) errorStatus(() => encrypt(value, path, key), 400, invalidMessage);
    expect(decrypt(encrypt(NaN, path, key), path, key)).toBeNull();
  });
  it('counts UTF-8 plaintext bytes with inclusive 250000-byte limit', () => {
    const boundary = 'é'.repeat(124999);
    expect(decrypt(encrypt(boundary, path, key), path, key)).toBe(boundary);
    errorStatus(() => encrypt(boundary + 'x', path, key), 413, 'El contenido de WhatsApp supera el límite.');
    errorStatus(() => decrypt(authenticated(Buffer.alloc(250001, 32)), path, key), 400, invalidMessage);
  });
  it('requires a closed envelope and canonical base64', () => {
    for (const envelope of [null, { ...vector, extra: true }, { ...vector, version: 2 }, { ...vector, iv: vector.iv + '\n' }, { ...vector, tag: vector.tag.slice(0, -2) + '__' }, { ...vector, tag: vector.tag.slice(0, -3) + 'B==' }, { ...vector, data: vector.data.slice(0, -1) }, { ...vector, data: '' }, { ...vector, data: 'A'.repeat(333340) }]) errorStatus(() => decrypt(envelope, path, key), 400, invalidMessage);
  });
  it('rejects authenticated malformed UTF-8/JSON and preserves decoder BOM behavior', () => {
    for (const bytes of [Buffer.from([0xc3, 0x28, 0x20]), Buffer.from('not json')]) errorStatus(() => decrypt(authenticated(bytes), path, key), 400, invalidMessage);
    expect(decrypt(authenticated(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('{}')])), path, key)).toEqual({});
  });
  it('derives digest subkeys by domain and retains ordered JSON parts', () => {
    expect(digest('event', ['synthetic', '1'], key)).toBe('a826c6f7dc09e73df17894fe5a2102faa0bbde6293d0e1207ea373b7acc102d2');
    const baseline = digest('event', ['a', 'b'], key);
    for (const result of [digest('event ', ['a', 'b'], key), digest('other', ['a', 'b'], key), digest('event', ['b', 'a'], key), digest('event', ['ab'], key), digest('event', ['a', 'b'], Buffer.alloc(32, 8))]) expect(result).not.toBe(baseline);
    expect(digest(' ', ['x'.repeat(300000)], key)).toMatch(/^[a-f0-9]{64}$/);
    expect(digest('d'.repeat(128), [], key)).toMatch(/^[a-f0-9]{64}$/);
    expect(digest('sparse', Array(2), key)).toMatch(/^[a-f0-9]{64}$/);
  });
  it('rejects invalid digest arguments without adding per-part limits', () => {
    for (const [domain, parts] of [['', []], ['d'.repeat(129), []], [1, []], ['d', null], ['d', [1]], ['d', [undefined]]]) errorStatus(() => digest(domain as string, parts as string[], key), 400, invalidMessage);
  });
});
