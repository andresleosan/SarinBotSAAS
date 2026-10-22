import 'server-only';
import type { Database } from '@/lib/storage/types';
import { getPlatformWhatsAppConfig } from './platform-whatsapp-config';
import { normalizePlatformWhatsAppConnection, samePlatformWhatsAppScope, assertPlatformWhatsAppNow } from './platform-whatsapp-store';
import { createPlatformYCloudClient } from './platform-ycloud-client';
import { freshWorkConnection } from './platform-whatsapp-work-authority';
const observations = new Map<string, Promise<void>>();
export async function reconcilePlatformConnection(db: Database, now = Date.now()): Promise<void> {
  assertPlatformWhatsAppNow(now);
  const config = getPlatformWhatsAppConfig(); if (!config.scope) return;
  const scope = config.scope, key = JSON.stringify(scope);
  const pending = observations;
  if (pending.has(key)) return pending.get(key)!;
  const run = async () => {
    const ref = db.collection('serverSettings').doc('platform_whatsapp');
    const before = normalizePlatformWhatsAppConnection((await ref.get()).data(), scope, now);
    if (freshWorkConnection(before, now)) return;
    let observed: { connected: boolean; observedAt: number } | null = null;
    try { observed = await createPlatformYCloudClient({ scope, apiKey: process.env.PLATFORM_YCLOUD_API_KEY ?? '', sendEnabled: false }).readAccountConnection(); } catch { /* Failed lookup removes previous usable evidence. */ }
    const finished = Date.now();
    await db.runTransaction(async tx => {
      const current = normalizePlatformWhatsAppConnection((await tx.get(ref)).data(), scope, finished);
      if (!samePlatformWhatsAppScope(before, current) || current.connectionRevision !== before.connectionRevision || current.updatedAt !== before.updatedAt) return;
      if (!observed || observed.observedAt > finished) { tx.set(ref, { ...current, updatedAt: finished, observationStatus: 'failed', observationRevision: null, observedAt: null }); return; }
      if (!observed.connected) {
        if (current.connectionRevision === Number.MAX_SAFE_INTEGER) return;
        const revision = current.connectionRevision + 1;
        tx.set(ref, { ...current, connectionRevision: revision, providerConnection: 'disconnected', paused: true, pausedReason: 'disconnected', updatedAt: finished, observationStatus: 'disconnected', observationRevision: revision, observedAt: observed.observedAt });
      } else tx.set(ref, { ...current, providerConnection: 'connected', pausedReason: current.pausedReason === 'disconnected' ? 'manual' : current.pausedReason, updatedAt: finished, observationStatus: 'connected', observationRevision: current.connectionRevision, observedAt: observed.observedAt });
    });
    if (process.env.PLATFORM_WHATSAPP_PROCESSING_ENABLED === 'true') { const { recognizePlatformWorkCancellation } = await import('./platform-whatsapp-worker'); await recognizePlatformWorkCancellation(); }
  };
  const promise = run(); pending.set(key, promise);
  try { await promise; } finally { if (pending.get(key) === promise) pending.delete(key); }
}
