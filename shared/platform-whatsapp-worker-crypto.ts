import { workExact, workObject } from './platform-whatsapp-work.ts';

const encoder = new TextEncoder();
const invalid = () => new Error('Invalid platform content');
export function audioBase64(bytes: Uint8Array): string {
  let binary = ''; for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192)); return btoa(binary);
}
export function decodeAudioBase64(value: unknown, length?: number): Uint8Array<ArrayBuffer> {
  if (typeof value !== 'string' || value.length > 333336) throw invalid();
  const binary = atob(value); const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
  if (audioBase64(bytes) !== value || (length !== undefined && bytes.length !== length)) throw invalid(); return bytes;
}
export async function decryptPlatformWorkerContent(envelope: unknown, documentPath: string, configuredKey: string): Promise<unknown> {
  if (typeof documentPath !== 'string' || !documentPath.trim() || documentPath.length > 1024 || /[\x00-\x1f\x7f]/.test(documentPath)) throw invalid();
  if (!workObject(envelope) || !workExact(envelope, ['version', 'iv', 'tag', 'data']) || envelope.version !== 1 || typeof envelope.data !== 'string' || envelope.data.length < 4) throw invalid();
  const raw = decodeAudioBase64(configuredKey, 32), iv = decodeAudioBase64(envelope.iv, 12), tag = decodeAudioBase64(envelope.tag, 16), data = decodeAudioBase64(envelope.data);
  if (data.length > 250000) throw invalid();
  const combined = new Uint8Array(data.length + tag.length); combined.set(data); combined.set(tag, data.length);
  const key = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['decrypt']);
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv, tagLength: 128, additionalData: encoder.encode(JSON.stringify(['sarin/platform-whatsapp', 1, 'content', documentPath])) }, key, combined);
  return JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(plaintext));
}
export async function platformWorkerDigest(domain: string, parts: string[], configuredKey: string): Promise<string> {
  if (typeof domain !== 'string' || !domain.length || domain.length > 128 || !Array.isArray(parts) || parts.some(p => typeof p !== 'string')) throw invalid();
  const sign = async (key: Uint8Array<ArrayBuffer>, value: unknown) => crypto.subtle.sign('HMAC', await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']), encoder.encode(JSON.stringify(value)));
  const derived = new Uint8Array(await sign(decodeAudioBase64(configuredKey, 32), ['sarin/platform-whatsapp', 1, 'digest-key', domain]));
  return Array.from(new Uint8Array(await sign(derived, parts)), n => n.toString(16).padStart(2, '0')).join('');
}
