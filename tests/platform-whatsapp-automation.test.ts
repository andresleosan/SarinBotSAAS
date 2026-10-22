import { afterEach, expect, it, vi } from 'vitest';
vi.mock('@/lib/firebase/admin', () => ({ getAdminDb: () => { throw new Error('Default backend forbidden'); } }));
import { hasDuePlatformWork } from '@/lib/server/platform-whatsapp-work-queue';
import { memoryStore, now } from './platform-whatsapp-test-fixtures';
import { workJob } from './platform-whatsapp-work-fixtures';
afterEach(() => vi.unstubAllEnvs());
it('does not authorize a wake from expired raw ready rows', async () => {
  const s = memoryStore(), then = now - 86_400_000;
  const job = workJob({ sourceOccurredAt: then, sourceReceivedAt: then, createdAt: then, customerSentAt: then, windowExpiresAt: now, bodyExpiresAt: now, expiresAt: then + 2_592_000_000 });
  s.seed('platformWhatsAppJobs/' + job.jobId, job);
  expect(await hasDuePlatformWork(s.db, now)).toBe(false);
});
