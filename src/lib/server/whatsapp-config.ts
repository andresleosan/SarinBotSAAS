import 'server-only';
import { z } from 'zod';
import type { Firestore } from 'firebase-admin/firestore';
import { getAdminDb } from '@/lib/firebase/admin';
import type { AdminWhatsAppSettings, WhatsAppBindingStatus } from '@/types/whatsapp';
import { documentIdSchema } from './schemas';
import { HttpError } from './http';

export const metaIdSchema = z.string().regex(/^\d{5,30}$/);
export const whatsAppBindingSchema = z.object({ businessId: documentIdSchema, phoneNumberId: metaIdSchema, wabaId: metaIdSchema, enabled: z.boolean() }).strict();
const storedBindingSchema = whatsAppBindingSchema.extend({ verifiedAt: z.number().int().nonnegative().nullable(), updatedAt: z.number().int().nonnegative(), lastInboundAt: z.number().int().nonnegative().optional(), lastDeliveredAt: z.number().int().nonnegative().optional() }).strict();
export type WhatsAppBinding = z.infer<typeof storedBindingSchema>;
const credentialSchema = z.record(metaIdSchema, z.object({ wabaId: metaIdSchema, accessToken: z.string().min(8).max(4096).regex(/^[!-~]+$/) }).strict());

export function readWhatsAppConfig() {
  const missingConfiguration: string[] = [];
  if (process.env.WHATSAPP_RETENTION_ENABLED !== 'true') missingConfiguration.push('WHATSAPP_RETENTION_ENABLED');
  const appSecret = process.env.WHATSAPP_APP_SECRET ?? '';
  const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN ?? '';
  if (!/^[!-~]{16,256}$/.test(appSecret)) missingConfiguration.push('WHATSAPP_APP_SECRET');
  if (!/^[!-~]{16,256}$/.test(verifyToken)) missingConfiguration.push('WHATSAPP_VERIFY_TOKEN');
  const encodedKey = process.env.WHATSAPP_CONTENT_KEY ?? '';
  const contentKey = Buffer.from(encodedKey, 'base64');
  if (contentKey.length !== 32 || contentKey.toString('base64') !== encodedKey) missingConfiguration.push('WHATSAPP_CONTENT_KEY');
  let credentials: z.infer<typeof credentialSchema> = {};
  try {
    const raw = process.env.WHATSAPP_PHONE_CREDENTIALS_JSON ?? '{}';
    if (raw.length > 100_000) throw new Error();
    credentials = credentialSchema.parse(JSON.parse(raw));
    if (Object.keys(credentials).length > 100) throw new Error();
  } catch { missingConfiguration.push('WHATSAPP_PHONE_CREDENTIALS_JSON'); }
  const graphApiVersion = process.env.WHATSAPP_GRAPH_API_VERSION || 'v25.0';
  // Only the reviewed API contract is supported; upgrades require compatibility tests.
  if (graphApiVersion !== 'v25.0') missingConfiguration.push('WHATSAPP_GRAPH_API_VERSION');
  return { enabled: process.env.WHATSAPP_ENABLED === 'true', configured: missingConfiguration.length === 0, graphApiVersion, appSecret, verifyToken, contentKey, credentials, missingConfiguration };
}

export function parseWhatsAppBinding(value: unknown): WhatsAppBinding {
  const parsed = storedBindingSchema.safeParse(value);
  if (!parsed.success) throw new HttpError(503, 'La configuración privada de WhatsApp no es válida.');
  return parsed.data;
}
export function bindingReady(binding: WhatsAppBinding, config = readWhatsAppConfig()) {
  return config.enabled && config.configured && binding.enabled && binding.verifiedAt !== null
    && config.credentials[binding.phoneNumberId]?.wabaId === binding.wabaId;
}
export async function getWhatsAppBusinessStatus(businessId: string, db: Firestore = getAdminDb()): Promise<{ ready: boolean }> {
  documentIdSchema.parse(businessId);
  if (!readWhatsAppConfig().enabled) return { ready: false };
  const index = await db.collection('whatsappBusinesses').doc(businessId).get();
  if (!index.exists) return { ready: false };
  const phoneId = metaIdSchema.safeParse(index.data()?.phoneNumberId);
  if (!phoneId.success) throw new HttpError(503, 'La configuración privada de WhatsApp no es válida.');
  const snapshot = await db.collection('whatsappNumbers').doc(phoneId.data).get();
  if (!snapshot.exists) return { ready: false };
  const binding = parseWhatsAppBinding(snapshot.data());
  return { ready: binding.businessId === businessId && bindingReady(binding) };
}
export const getBusinessWhatsAppStatus = getWhatsAppBusinessStatus;

export async function getWhatsAppSettings(db: Firestore = getAdminDb()): Promise<AdminWhatsAppSettings> {
  const config = readWhatsAppConfig();
  const documents = await db.collection('whatsappNumbers').limit(101).get();
  const bindings = documents.docs.slice(0, 100).map(document => {
    const binding = parseWhatsAppBinding(document.data());
    const credentialConfigured = config.credentials[binding.phoneNumberId]?.wabaId === binding.wabaId;
    const status: WhatsAppBindingStatus['status'] = !binding.enabled ? 'paused' : bindingReady(binding, config) ? 'ready' : !config.configured || !credentialConfigured ? 'unconfigured' : 'configured_unverified';
    return { businessId: binding.businessId, phoneNumberId: binding.phoneNumberId, wabaId: binding.wabaId, enabled: binding.enabled, credentialConfigured, status,
      lastInboundAt: binding.lastInboundAt ? new Date(binding.lastInboundAt).toISOString() : null,
      lastDeliveredAt: binding.lastDeliveredAt ? new Date(binding.lastDeliveredAt).toISOString() : null };
  });
  return { enabled: config.enabled, configured: config.configured, graphApiVersion: config.graphApiVersion, missingConfiguration: config.missingConfiguration, bindings, truncated: documents.size > 100 };
}

export async function saveWhatsAppBinding(input: z.infer<typeof whatsAppBindingSchema>, db: Firestore = getAdminDb()): Promise<AdminWhatsAppSettings> {
  const value = whatsAppBindingSchema.parse(input);
  const config = readWhatsAppConfig();
  let verifiedAt: number | null = null;
  if (value.enabled) {
    if (!config.enabled || !config.configured || config.credentials[value.phoneNumberId]?.wabaId !== value.wabaId) throw new HttpError(503, 'Configura WhatsApp y su cifrado en el servidor antes de habilitar el número.');
    try {
      const response = await fetch(`https://graph.facebook.com/${config.graphApiVersion}/${value.phoneNumberId}?fields=id,status`, {
        method: 'GET', headers: { Authorization: `Bearer ${config.credentials[value.phoneNumberId].accessToken}` }, redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw new Error();
      const reader = response.body?.getReader();
      if (!reader) throw new Error();
      const parts: Uint8Array[] = []; let size = 0;
      try {
        while (true) {
          const { value: chunk, done } = await reader.read();
          if (done) break;
          size += chunk.byteLength;
          if (size > 16_384) { await reader.cancel(); throw new Error(); }
          parts.push(chunk);
        }
      } finally { reader.releaseLock(); }
      const result = JSON.parse(Buffer.concat(parts, size).toString('utf8'));
      if (result.id !== value.phoneNumberId || result.status !== 'CONNECTED') throw new Error();
      verifiedAt = Date.now();
    } catch { throw new HttpError(503, 'Meta no confirmó que el número esté registrado y conectado.'); }
  }
  const reference = db.collection('whatsappNumbers').doc(value.phoneNumberId);
  const indexReference = db.collection('whatsappBusinesses').doc(value.businessId);
  await db.runTransaction(async transaction => {
    const [business, existing, index] = await Promise.all([transaction.get(db.collection('businesses').doc(value.businessId)), transaction.get(reference), transaction.get(indexReference)]);
    if (!business.exists) throw new HttpError(404, 'El negocio no existe.');
    const previous = existing.exists ? parseWhatsAppBinding(existing.data()) : null;
    if (previous && (previous.businessId !== value.businessId || previous.wabaId !== value.wabaId)) throw new HttpError(409, 'El número ya está vinculado a otro negocio o cuenta.');
    if (index.exists && index.data()?.phoneNumberId !== value.phoneNumberId) throw new HttpError(409, 'El negocio ya tiene otro número vinculado.');
    transaction.set(reference, { ...previous, ...value, verifiedAt, updatedAt: Date.now() });
    transaction.set(indexReference, { phoneNumberId: value.phoneNumberId });
  });
  return getWhatsAppSettings(db);
}
