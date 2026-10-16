import { describe, expect, it } from 'vitest';
import { readChatState, saveChatState } from '@/lib/server/chat-state';
import { memoryFirestore } from './memoryFirestore';
const scope = { actorUid: 'synthetic-client', businessId: 'business', mode: 'sarin_client' as const, channel: 'web' as const };
describe('authoritative chat selection', () => {
  it('isolates scopes and applies a transactional version without transcripts', async () => {
    const { db, rows } = memoryFirestore();
    expect((await readChatState(scope, db, 1000)).version).toBe(0);
    const results = await Promise.allSettled([saveChatState(scope, 0, { serviceId: 'cut' }, db, 1000), saveChatState(scope, 0, { serviceId: 'other' }, db, 1000)]);
    expect(results.filter(value => value.status === 'fulfilled')).toHaveLength(1);
    expect(results.find(value => value.status === 'rejected')).toMatchObject({ reason: { code: 'CHAT_STATE_CONFLICT' } });
    for (const changed of [{ actorUid: 'other' }, { businessId: 'other' }, { mode: 'sarin_onboarding' as const }, { channel: 'whatsapp' as const }]) expect((await readChatState({ ...scope, ...changed }, db, 1000)).selection).toEqual({});
    expect(JSON.stringify([...rows])).not.toMatch(/synthetic-client|messages|phone|content/);
  });
  it('expires selections after 24h without reusing an old version or accepting unknown data', async () => {
    const { db } = memoryFirestore();
    const first = await saveChatState(scope, 0, { serviceId: 'cut' }, db, 1000);
    const expired = await readChatState(scope, db, 1000 + 86400000);
    expect(expired.selection).toEqual({}); expect(expired.version).toBeGreaterThan(first.version);
    await expect(saveChatState(scope, first.version, {}, db, 1000 + 86400000)).rejects.toMatchObject({ status: 409 });
    await expect(saveChatState(scope, expired.version, { phone: 'private' } as never, db, 1000 + 86400000)).rejects.toBeDefined();
  });
});
