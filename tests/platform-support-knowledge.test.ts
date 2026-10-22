import { expect, it, vi } from 'vitest';
vi.mock('@/lib/firebase/admin', () => ({ getAdminDb: () => { throw new Error('Default backend forbidden'); } }));
import { readPlatformSupportKnowledge } from '@/lib/server/platform-support-knowledge';
import { memoryStore } from './platform-whatsapp-test-fixtures';
it('projects changed public prices without serializing private settings or reading private collections', async () => {
  const s = memoryStore(); s.seed('platformSettings/main', { weeklyPriceCOP: 12345, bankAccount: 'synthetic-private-bank', privatePrompt: 'synthetic-private-prompt', tunnelStatus: { secret: 'synthetic-private-tunnel' } });
  const first = await readPlatformSupportKnowledge(s.db), serialized = JSON.stringify(first);
  expect(serialized).toContain('12345'); expect(serialized).not.toContain('synthetic-private'); expect(Object.isFrozen(first)).toBe(true);
  s.seed('platformSettings/main', { weeklyPriceCOP: 23456 });
  expect(JSON.stringify(await readPlatformSupportKnowledge(s.db))).toContain('23456');
  expect(s.seen.filter(c => c.action === 'read').every(c => c.action === 'read' && c.read.path === 'platformSettings/main')).toBe(true);
});
