import 'server-only';
import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { readWhatsAppConfig } from './whatsapp-config';
import { HttpError } from './http';

function configured() {
  const config = readWhatsAppConfig();
  if (!config.enabled || !config.configured) throw new HttpError(503, 'WhatsApp no está habilitado y configurado.');
  return config;
}
export function verifyWhatsAppChallenge(url: URL): string {
  const config = configured();
  const token = Buffer.from(url.searchParams.get('hub.verify_token') ?? '');
  const expected = Buffer.from(config.verifyToken);
  const challenge = url.searchParams.get('hub.challenge') ?? '';
  if (url.searchParams.get('hub.mode') !== 'subscribe' || token.length !== expected.length || !timingSafeEqual(token, expected) || !/^[A-Za-z0-9_-]{1,256}$/.test(challenge)) throw new HttpError(403, 'Verificación no válida.');
  return challenge;
}
export async function readBoundedBytes(stream: ReadableStream<Uint8Array> | null, maxBytes: number): Promise<Buffer> {
  const reader = stream?.getReader();
  if (!reader) throw new HttpError(400, 'El cuerpo está vacío.');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) { await reader.cancel(); throw new HttpError(413, 'El cuerpo supera el tamaño permitido.'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks, size);
}
export async function readSignedWebhook(request: Request): Promise<unknown> {
  const config = configured();
  if (Number(request.headers.get('content-length') ?? 0) > 1_048_576) throw new HttpError(413, 'El cuerpo supera el tamaño permitido.');
  const raw = await readBoundedBytes(request.body, 1_048_576);
  const signature = /^sha256=([a-f0-9]{64})$/.exec(request.headers.get('x-hub-signature-256') ?? '');
  if (!signature || !timingSafeEqual(Buffer.from(signature[1], 'hex'), createHmac('sha256', config.appSecret).update(raw).digest())) throw new HttpError(401, 'Firma no válida.');
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw)); }
  catch { throw new HttpError(400, 'JSON no válido.'); }
}
const envelopeSchema = z.object({ iv: z.string().max(24), tag: z.string().max(24), data: z.string().max(400_000) }).strict();
export type WhatsAppCiphertext = z.infer<typeof envelopeSchema>;
export function encryptWhatsApp(value: unknown, scope: string): WhatsAppCiphertext {
  const config = configured();
  const bytes = Buffer.from(JSON.stringify(value));
  if (bytes.length > 250_000) throw new HttpError(413, 'El contenido de WhatsApp supera el límite.');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', config.contentKey, iv);
  cipher.setAAD(Buffer.from(scope));
  const data = Buffer.concat([cipher.update(bytes), cipher.final()]);
  return { iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') };
}
export function decryptWhatsApp(value: unknown, scope: string): unknown {
  const config = configured();
  const envelope = envelopeSchema.parse(value);
  const iv = Buffer.from(envelope.iv, 'base64'), tag = Buffer.from(envelope.tag, 'base64');
  if (iv.length !== 12 || tag.length !== 16) throw new Error('Invalid encrypted envelope');
  const decipher = createDecipheriv('aes-256-gcm', config.contentKey, iv);
  decipher.setAAD(Buffer.from(scope));
  decipher.setAuthTag(tag);
  const raw = Buffer.concat([decipher.update(Buffer.from(envelope.data, 'base64')), decipher.final()]);
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw));
}
