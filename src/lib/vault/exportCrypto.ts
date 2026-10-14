import { z } from 'zod';
import type { VaultBackup } from '@/types/vault';
import { MAX_BACKUP_BYTES, MAX_IMPORT_BYTES, vaultBackupSchema } from './schema';

const ITERATIONS = 310_000;
const envelopeSchema = z.object({
  format: z.literal('sarin-vault-encrypted'), version: z.literal(1),
  cipher: z.literal('AES-GCM'), kdf: z.literal('PBKDF2-SHA256'), iterations: z.literal(ITERATIONS),
  salt: z.string().length(24).regex(/^[A-Za-z0-9+/]{22}==$/),
  iv: z.string().length(16).regex(/^[A-Za-z0-9+/]{16}$/),
  ciphertext: z.string().min(24).max(MAX_IMPORT_BYTES).regex(/^[A-Za-z0-9+/]+={0,2}$/),
}).strict();

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return btoa(binary);
}
function fromBase64(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}
async function deriveKey(password: string, salt: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  if (password.length < 12 || password.length > 1024) throw new Error('Usa una contraseña de entre 12 y 1024 caracteres.');
  if (!globalThis.crypto?.subtle) throw new Error('El cifrado necesita HTTPS y un navegador actualizado.');
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
export async function encodeVaultBackup(value: VaultBackup, password?: string): Promise<string> {
  const backup = vaultBackupSchema.parse(value);
  const plain = JSON.stringify(backup);
  const bytes = new TextEncoder().encode(plain);
  if (bytes.byteLength > MAX_BACKUP_BYTES) throw new Error('La bóveda supera 50 MB. Exporta menos conversaciones.');
  if (!password) return plain;
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt);
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes);
  return JSON.stringify({ format: 'sarin-vault-encrypted', version: 1, cipher: 'AES-GCM', kdf: 'PBKDF2-SHA256', iterations: ITERATIONS, salt: toBase64(salt), iv: toBase64(iv), ciphertext: toBase64(new Uint8Array(encrypted)) });
}
export async function decodeVaultBackup(text: string, password?: string): Promise<VaultBackup> {
  if (text.length > MAX_IMPORT_BYTES || new TextEncoder().encode(text).byteLength > MAX_IMPORT_BYTES) throw new Error('La copia supera el tamaño permitido.');
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new Error('El archivo no contiene una copia JSON válida.'); }
  if (typeof value === 'object' && value !== null && 'format' in value && value.format === 'sarin-vault-encrypted') {
    const parsed = envelopeSchema.safeParse(value);
    if (!parsed.success) throw new Error('El formato cifrado no es válido o no es compatible.');
    if (!password) throw new Error('Escribe la contraseña de esta copia.');
    try {
      const envelope = parsed.data;
      const salt = fromBase64(envelope.salt);
      const iv = fromBase64(envelope.iv);
      const encrypted = fromBase64(envelope.ciphertext);
      if (salt.length !== 16 || iv.length !== 12 || encrypted.length > MAX_BACKUP_BYTES + 16) throw new Error();
      const key = await deriveKey(password, salt);
      const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, encrypted);
      value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(decrypted));
    } catch { throw new Error('Contraseña incorrecta o copia dañada.'); }
  } else if (new TextEncoder().encode(text).byteLength > MAX_BACKUP_BYTES) throw new Error('La copia supera 50 MB.');
  const backup = vaultBackupSchema.safeParse(value);
  if (!backup.success) throw new Error('La copia contiene datos no válidos. No se importó ningún dato.');
  return backup.data;
}
