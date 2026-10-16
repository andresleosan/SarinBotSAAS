import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { syntheticWhatsAppEnv } from './whatsapp-fixtures';
import { decryptWhatsApp, encryptWhatsApp, readSignedWebhook, verifyWhatsAppChallenge } from '@/lib/server/whatsapp-security';
beforeEach(() => syntheticWhatsAppEnv());
afterEach(() => vi.unstubAllEnvs());
const signedRequest = (body: string, signature?: string) => new Request('https://example.test/api/whatsapp/webhook', { method: 'POST', body, headers: {
  'Content-Type': 'application/json', 'X-Hub-Signature-256': signature ?? `sha256=${createHmac('sha256', 'synthetic-app-secret').update(body).digest('hex')}`,
} });
describe('WhatsApp transport security', () => {
  it('echoes only a matching subscribe challenge and rejects token/mode confusion', () => {
    expect(verifyWhatsAppChallenge(new URL('https://example.test/?hub.mode=subscribe&hub.verify_token=synthetic-verify-token&hub.challenge=12345'))).toBe('12345');
    for (const query of ['hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=123', 'hub.mode=other&hub.verify_token=synthetic-verify-token&hub.challenge=123']) {
      expect(() => verifyWhatsAppChallenge(new URL(`https://example.test/?${query}`))).toThrow();
    }
  });
  it('authenticates exact bytes, not reserialized JSON', async () => {
    const body = '{ "synthetic": "ñ" }';
    expect(await readSignedWebhook(signedRequest(body))).toEqual({ synthetic: 'ñ' });
    const otherSignature = `sha256=${createHmac('sha256', 'synthetic-app-secret').update('{"synthetic":"ñ"}').digest('hex')}`;
    await expect(readSignedWebhook(signedRequest(body, otherSignature))).rejects.toMatchObject({ status: 401 });
  });
  it.each(['', 'sha256=nope', 'sha1=' + 'a'.repeat(64), 'sha256=' + 'a'.repeat(64)])('rejects missing, malformed and incorrect signatures %s', async signature => {
    await expect(readSignedWebhook(signedRequest('{}', signature))).rejects.toMatchObject({ status: 401 });
  });
  it('rejects actual oversize streamed bytes without relying on Content-Length', async () => {
    await expect(readSignedWebhook(signedRequest('x'.repeat(1_048_577)))).rejects.toMatchObject({ status: 413 });
  });
  it('fails closed when disabled or without a valid encryption key', async () => {
    vi.stubEnv('WHATSAPP_ENABLED', 'false');
    await expect(readSignedWebhook(signedRequest('{}'))).rejects.toMatchObject({ status: 503 });
    vi.stubEnv('WHATSAPP_ENABLED', 'true'); vi.stubEnv('WHATSAPP_CONTENT_KEY', '');
    await expect(readSignedWebhook(signedRequest('{}'))).rejects.toMatchObject({ status: 503 });
  });
  it('encrypts with fresh nonces and binds ciphertext to its document scope', () => {
    const body = { text: 'Synthetic private text', phone: '573001112233' };
    const first = encryptWhatsApp(body, 'inbox/one');
    const second = encryptWhatsApp(body, 'inbox/one');
    expect(first).not.toEqual(second);
    expect(JSON.stringify(first)).not.toMatch(/Synthetic|573001112233/);
    expect(decryptWhatsApp(first, 'inbox/one')).toEqual(body);
    expect(() => decryptWhatsApp(first, 'inbox/two')).toThrow();
    expect(() => decryptWhatsApp({ ...first, data: first.data.slice(0, -4) + 'AAAA' }, 'inbox/one')).toThrow();
  });
});
