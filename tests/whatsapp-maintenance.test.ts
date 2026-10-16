import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { memoryFirestore } from './memoryFirestore';
import { syntheticWhatsAppEnv } from './whatsapp-fixtures';
const state = vi.hoisted(() => ({ db: undefined as unknown }));
vi.mock('@/lib/firebase/admin', () => ({ getAdminDb: () => state.db }));
vi.mock('@/lib/server/chat', () => ({ runSarinChat: vi.fn(async () => { throw new Error('No inference allowed'); }) }));
vi.mock('@/lib/server/response-quota', () => ({ commitResponseQuota: vi.fn() }));
import { startWhatsAppWorker } from '@/lib/server/whatsapp-worker';
beforeEach(() => { syntheticWhatsAppEnv(); vi.stubEnv('WHATSAPP_RETENTION_ENABLED', 'false'); vi.useFakeTimers(); });
afterEach(() => {
  const scope = globalThis as typeof globalThis & { __sarinWhatsAppTimer?: ReturnType<typeof setInterval>; __sarinWhatsAppRetentionTimer?: ReturnType<typeof setInterval> };
  if (scope.__sarinWhatsAppTimer) clearInterval(scope.__sarinWhatsAppTimer);
  if (scope.__sarinWhatsAppRetentionTimer) clearInterval(scope.__sarinWhatsAppRetentionTimer);
  delete scope.__sarinWhatsAppTimer; delete scope.__sarinWhatsAppRetentionTimer;
  vi.useRealTimers(); vi.unstubAllEnvs();
});
it('keeps retention running after delivery is disabled and the content key is removed', async () => {
  const { db, rows } = memoryFirestore({ 'whatsappInbox/old': { content: { data: 'encrypted' }, bodyExpiresAt: Date.now() + 100, expiresAt: Date.now() + 100_000_000 } }); state.db = db;
  vi.stubEnv('WHATSAPP_ENABLED', 'false'); vi.stubEnv('WHATSAPP_CONTENT_KEY', ''); vi.stubEnv('WHATSAPP_RETENTION_ENABLED', 'true');
  startWhatsAppWorker();
  await vi.advanceTimersByTimeAsync(3_600_000);
  expect(rows.get('whatsappInbox/old')!.data.content).toBeNull();
});
it('stays completely inert when delivery and retention are explicitly disabled', async () => {
  state.db = undefined; vi.stubEnv('WHATSAPP_ENABLED', 'false');
  startWhatsAppWorker(); await vi.advanceTimersByTimeAsync(7_200_000);
  expect(vi.getTimerCount()).toBe(0);
});
