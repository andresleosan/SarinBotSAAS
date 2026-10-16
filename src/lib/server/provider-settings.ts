import 'server-only';
import { z } from 'zod';
import type { Firestore } from 'firebase-admin/firestore';
import { getAdminDb } from '@/lib/firebase/admin';
import { getChatProvider, getEngineConfiguration, probeEngine } from '@/lib/sarin/engine';
import { AI_PROVIDERS, type AdminAiSettings, type AiProvider, type AiProviderSelection, type AiProviderStatus } from '@/types/ai';
import { HttpError } from './http';

export const aiProviderUpdateSchema = z.object({ provider: z.enum(AI_PROVIDERS) }).strict();
const storedSelectionSchema = aiProviderUpdateSchema.extend({ updatedAt: z.number().int().nonnegative() }).strict();

/** No process cache: the caller holds this snapshot for the complete logical turn. */
export async function getAiProviderSelection(db: Firestore = getAdminDb()): Promise<AiProviderSelection> {
  const document = await db.collection('serverSettings').doc('ai').get();
  if (!document.exists) return { provider: getChatProvider(), source: 'environment', updatedAt: null };
  const parsed = storedSelectionSchema.safeParse(document.data());
  if (!parsed.success) throw new HttpError(503, 'La selección de IA del servidor no es válida. Revisa su configuración.');
  return { ...parsed.data, source: 'admin' };
}

async function providerStatus(provider: AiProvider): Promise<AiProviderStatus> {
  const configuration = getEngineConfiguration(provider);
  if (!configuration.configured) return { provider, ...configuration, online: false, checkedAt: Date.now() };
  const health = await probeEngine(provider);
  return { provider, ...configuration, online: health.online, checkedAt: health.checkedAt, ...(health.error ? { error: health.error } : {}) };
}

export async function getAdminAiSettings(db: Firestore = getAdminDb()): Promise<AdminAiSettings> {
  const selection = await getAiProviderSelection(db);
  return { ...selection, providers: await Promise.all(AI_PROVIDERS.map(providerStatus)) };
}

export async function saveAiProvider(provider: AiProvider, db: Firestore = getAdminDb()): Promise<AiProviderSelection> {
  const selected = aiProviderUpdateSchema.parse({ provider }).provider;
  // A catalogue GET verifies credentials/model availability without generating data.
  const health = await providerStatus(selected);
  if (!health.configured || !health.online) throw new HttpError(503, health.error ?? 'El proveedor seleccionado no está disponible.');
  const saved = { provider: selected, updatedAt: Date.now() };
  await db.collection('serverSettings').doc('ai').set(saved);
  return { ...saved, source: 'admin' };
}
