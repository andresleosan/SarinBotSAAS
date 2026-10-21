import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('@/lib/firebase/admin', () => ({ getAdminDb: () => { throw new Error('Default backend forbidden'); } }));
import { listPlatformWhatsAppConversations as list, applyPlatformWhatsAppConversationControl as control } from '@/lib/server/platform-whatsapp-conversations';
import { encryptPlatformWhatsAppContent as encrypt } from '@/lib/server/platform-whatsapp-crypto';
import { configure, conversation, conversationId, key, memoryStore, now } from './platform-whatsapp-test-fixtures';

const path = `platformWhatsAppConversations/${conversationId}`;
const input = { conversationId, mode: 'review', expectedRevision: 0, requestId: 'demo-control' };
beforeEach(configure); afterEach(() => vi.unstubAllEnvs());
describe('bounded private platform conversation views and controls', () => {
  it('returns empty truncated without scope and still initializes an omitted backend first', async () => {
    vi.stubEnv('PLATFORM_WHATSAPP_WABA_ID', ''); const store = memoryStore();
    expect(await list(store.db, now)).toEqual({ conversations: [], truncated: true, observedAt: new Date(now).toISOString() }); expect(store.seen).toHaveLength(0);
    await expect(list(undefined, -1)).rejects.toThrow('Default backend forbidden');
  });
  it('bounds the query to 101, returns at most 100 and filters invalid IDs, scope, records and expiry', async () => {
    const store = memoryStore();
    for (let index = 0; index < 103; index++) store.seed(`platformWhatsAppConversations/${index.toString(16).padStart(64, '0')}`, conversation({ updatedAt: now - index }));
    expect(await list(store.db, now)).toMatchObject({ truncated: true }); expect((await list(store.db, now)).conversations).toHaveLength(100);
    expect(store.seen.at(-1)).toMatchObject({ read: { path: 'platformWhatsAppConversations', filters: [{ field: 'phoneNumberId', op: '==', value: '20001' }], order: [{ field: 'updatedAt', direction: 'desc' }], limit: 101 } });
    store.rows.clear();
    store.seed(path, conversation()); store.seed('platformWhatsAppConversations/bad-id', conversation());
    store.seed(`platformWhatsAppConversations/${'b'.repeat(64)}`, conversation({ wabaId: '99999' }));
    store.seed(`platformWhatsAppConversations/${'c'.repeat(64)}`, conversation({ expiresAt: now }));
    store.seed(`platformWhatsAppConversations/${'d'.repeat(64)}`, { ...conversation(), extra: true });
    const result = await list(store.db, now); expect(result.truncated).toBe(true); expect(result.conversations.map(v => v.id)).toEqual([conversationId]);
  });
  it.each([null, '', 'x'.repeat(4096)])('presents valid nullable/empty/bounded payload text %# and tolerates extra payload properties', async text => {
    const store = memoryStore(); store.seed(path, conversation({ state: 'body_present', contactContent: encrypt({ customerPhone: '+12025550101', text, extra: true }, path, key) }));
    expect((await list(store.db, now)).conversations[0]).toMatchObject({ customerName: null, customerPhone: '+12025550101', lastMessage: text, contentAvailable: true });
  });
  it.each(['wrong-path', 'wrong-key', 'bad-phone', 'bad-text', 'astral-limit', 'missing-text', 'tampered'])('hides contact and text for %s without mutating the record', async fault => {
    const store = memoryStore();
    const payload = { customerPhone: fault === 'bad-phone' ? 'bad' : '+12025550101', ...(fault === 'missing-text' ? {} : { text: fault === 'bad-text' ? 12 : fault === 'astral-limit' ? '😀'.repeat(2049) : 'Synthetic text' }) };
    const content = encrypt(payload, fault === 'wrong-path' ? 'platformWhatsAppConversations/other' : path, fault === 'wrong-key' ? Buffer.alloc(32, 9) : key);
    if (fault === 'tampered') content.tag = Buffer.alloc(16).toString('base64');
    store.seed(path, conversation({ state: 'body_present', contactContent: content })); const before = structuredClone([...store.rows]);
    expect((await list(store.db, now)).conversations[0]).toMatchObject({ contentAvailable: false, customerPhone: null, lastMessage: null }); expect([...store.rows]).toEqual(before);
  });
  it('hides expired body at equality and permits control even with reception disabled', async () => {
    const store = memoryStore(); store.seed(path, conversation({ state: 'body_present', contactContent: encrypt({ customerPhone: '+12025550101', text: 'Synthetic' }, path, key) }));
    vi.stubEnv('PLATFORM_WHATSAPP_RECEIVE_ENABLED', 'false');
    expect((await control(input, 'demo-admin', store.db, now + 86_400_000)).contentAvailable).toBe(false);
    expect(store.rows.get(path)).toMatchObject({ revision: 1, state: 'body_present' });
  });
  it('changes only mode/revision, writes one atomic audit, and replay returns the current conversation', async () => {
    const store = memoryStore(), original = conversation({ conflictAt: now - 1 }); store.seed(path, original);
    await control(input, 'demo-admin', store.db, now + 1);
    expect(store.rows.get(path)).toEqual({ ...original, mode: 'review', revision: 1 });
    await control({ ...input, requestId: 'demo-second', mode: 'human', expectedRevision: 1 }, 'demo-admin', store.db, now + 2);
    const before = structuredClone([...store.rows]);
    expect(await control(input, 'demo-admin', store.db, now + 3)).toMatchObject({ revision: 2, mode: 'human' }); expect([...store.rows]).toEqual(before);
    const commits = store.seen.filter(c => c.action === 'commit'); expect(commits).toHaveLength(2); expect(commits.every(c => c.writes.length === 2)).toBe(true);
    await expect(control({ ...input, mode: 'human' }, 'demo-admin', store.db, now)).rejects.toMatchObject({ status: 409 });
  });
  it('checks conversation existence, scope, integrity and expiry before accepting audit replay', async () => {
    const store = memoryStore(); store.seed(path, conversation()); await control(input, 'demo-admin', store.db, now);
    for (const value of [conversation({ expiresAt: now }), conversation({ wabaId: '99999' }), { ...conversation(), extra: true }]) {
      store.seed(path, value); await expect(control(input, 'demo-admin', store.db, now)).rejects.toMatchObject({ status: 404 });
    }
    store.rows.delete(path); await expect(control(input, 'demo-admin', store.db, now)).rejects.toMatchObject({ status: 404 });
  });
  it('rejects stale revisions and bot controls without writing', async () => {
    const store = memoryStore(); store.seed(path, conversation({ revision: 2 })); const before = structuredClone([...store.rows]);
    await expect(control(input, 'demo-admin', store.db, now)).rejects.toMatchObject({ status: 409 });
    await expect(control({ ...input, mode: 'bot' }, 'demo-admin', store.db, now)).rejects.toMatchObject({ status: 400 }); expect([...store.rows]).toEqual(before);
  });
  it('fails closed on invalid audit replay and max-safe conversation records', async () => {
    const store = memoryStore(); store.seed(path, conversation()); await control(input, 'demo-admin', store.db, now);
    const [auditPath, record] = [...store.rows].find(([p]) => p.startsWith('platformWhatsAppEvents/'))!;
    store.seed(auditPath, { ...record, extra: true });
    await expect(control(input, 'demo-admin', store.db, now)).rejects.toMatchObject({ status: 503 });
    store.seed(path, conversation({ revision: Number.MAX_SAFE_INTEGER }));
    await expect(control({ ...input, expectedRevision: Number.MAX_SAFE_INTEGER }, 'demo-admin', store.db, now)).rejects.toMatchObject({ status: 404 });
  });
});
