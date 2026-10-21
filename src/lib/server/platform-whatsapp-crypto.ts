import 'server-only';
import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';
import { z } from 'zod';
import type { PlatformWhatsAppCiphertext } from '../../../shared/platform-whatsapp-records';
import { HttpError } from '@/lib/server/http';

const envelopeSchema = z.object({ version: z.literal(1), iv: z.string().length(16), tag: z.string().length(24), data: z.string().min(4).max(333336) }).strict();
const invalidContent = () => new HttpError(400, 'El contenido cifrado de WhatsApp no es válido.');
function requireKey(key: Buffer): void {
  if (!Buffer.isBuffer(key) || key.length !== 32) throw new HttpError(503, 'La clave de WhatsApp de plataforma no es válida.');
}
function contentAAD(documentPath: string): Buffer {
  if (typeof documentPath !== 'string' || !documentPath.trim() || documentPath.length > 1024 || /[\x00-\x1f\x7f]/.test(documentPath)) throw invalidContent();
  return Buffer.from(JSON.stringify(['sarin/platform-whatsapp', 1, 'content', documentPath]));
}
function decodeBase64(value: string, expectedLength?: number): Buffer {
  const bytes = Buffer.from(value, 'base64');
  if (bytes.toString('base64') !== value || (expectedLength !== undefined && bytes.length !== expectedLength)) throw invalidContent();
  return bytes;
}

export function encryptPlatformWhatsAppContent(value: unknown, documentPath: string, key: Buffer): PlatformWhatsAppCiphertext {
  requireKey(key);
  const aad = contentAAD(documentPath);
  let plaintext: Buffer;
  try {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) throw invalidContent();
    plaintext = Buffer.from(serialized);
  } catch { throw invalidContent(); }
  if (plaintext.length > 250000) throw new HttpError(413, 'El contenido de WhatsApp supera el límite.');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(aad);
  const data = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return { version: 1, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') };
}

export function decryptPlatformWhatsAppContent(envelope: unknown, documentPath: string, key: Buffer): unknown {
  requireKey(key);
  const aad = contentAAD(documentPath);
  try {
    const parsed = envelopeSchema.parse(envelope);
    const iv = decodeBase64(parsed.iv, 12);
    const tag = decodeBase64(parsed.tag, 16);
    const data = decodeBase64(parsed.data);
    if (data.length > 250000) throw invalidContent();
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAAD(aad);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(data), decipher.final()]);
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(plaintext));
  } catch { throw invalidContent(); }
}

export function platformWhatsAppDigest(domain: string, parts: string[], key: Buffer): string {
  requireKey(key);
  if (typeof domain !== 'string' || !domain.length || domain.length > 128 || !Array.isArray(parts) || parts.some((part) => typeof part !== 'string')) throw invalidContent();
  const derivedKey = createHmac('sha256', key).update(JSON.stringify(['sarin/platform-whatsapp', 1, 'digest-key', domain])).digest();
  return createHmac('sha256', derivedKey).update(JSON.stringify(parts)).digest('hex');
}
