import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('@/lib/firebase/admin', () => ({ getAdminDb: () => { throw new Error('Default backend forbidden'); } }));
import { ingestPlatformWhatsAppEvent as ingest } from '@/lib/server/platform-whatsapp-ingress';
import { decryptPlatformWhatsAppContent as decrypt } from '@/lib/server/platform-whatsapp-crypto';
import { audit, configure, connection, connectionPath, incoming, echo, key, memoryStore, now, scope } from './platform-whatsapp-test-fixtures';
import { isPlatformWhatsAppStoredEvent, isPlatformWhatsAppConversationRecord } from '../shared/platform-whatsapp-records';

beforeEach(configure); afterEach(() => vi.unstubAllEnvs());
const events = (store: ReturnType<typeof memoryStore>) => [...store.rows].filter(([path]) => path.startsWith('platformWhatsAppEvents/'));
const canonicals = (store: ReturnType<typeof memoryStore>) => events(store).filter(([, row]) => row.recordType === 'event');
describe('authenticated normalized platform ingress', () => {
  it('stores unverified ingress atomically with separate path-bound ciphertext and no raw identifiers', async () => {
    const store = memoryStore(), result = await ingest(incoming(), configure(), store.db, now);
    expect(result.outcome).toBe('stored'); expect(result.conversationId).toMatch(/^[a-f0-9]{64}$/);
    expect(store.rows.size).toBe(5); expect(events(store)).toHaveLength(3);
    const [path, event] = canonicals(store)[0];
    // Synthetic identity vector captured from pinned 5649.f with this fixture/key.
    expect(result.conversationId).toBe('2588ec97a58e6c631c128d837531b1b56b93cd8816bfc13759f443d5e235140d');
    expect(path).toBe('platformWhatsAppEvents/event_d52855e342912b8297c0f86d4b9b0428ec175c599b6b6070e302cf84d5602703');
    expect(event).toMatchObject({ canonicalIdentity: 'b45ce44050f77da16e6899df4bc37895ff5f023db831e1a4bc8d42104ca9163a', fingerprint: '64697a901b91f2fa5429ae0e48b96a6934257b14edc64825d00f41e28e9bce62' });
    expect(events(store).map(([p]) => p.split('/')[1]).sort()).toEqual([
      'event_d52855e342912b8297c0f86d4b9b0428ec175c599b6b6070e302cf84d5602703',
      'message_458eb1cc2e2394ef8b77683e8951d8523134bdfc9513bb4bda4cc35c5bf528ae',
      'wamid_57e4679faa78fb569219d78275d69ee43a60f06bc2331cd83be77b6414ca9dbf',
    ]);
    const convPath = `platformWhatsAppConversations/${result.conversationId}`, conv = store.rows.get(convPath)!;
    expect(decrypt(event.content, path, key)).toEqual({ customerPhone: '+12025550101', text: 'Synthetic private message' });
    expect(decrypt(conv.contactContent, convPath, key)).toEqual({ customerPhone: '+12025550101', text: 'Synthetic private message' });
    expect(() => decrypt(event.content, convPath, key)).toThrow(); expect(conv.contactContent).not.toEqual(event.content);
    expect(event).toMatchObject({ connectionRevision: 0, bodyExpiresAt: now + 86_400_000, expiresAt: now + 2_592_000_000 });
    expect(conv).toMatchObject({ mode: 'human', revision: 0, lastInboundAt: now });
    expect(store.rows.get(connectionPath)).toMatchObject({ providerConnection: 'unverified', paused: false, connectionRevision: 0, lastSignedInboundAt: now });
    for (const [, row] of events(store)) expect(isPlatformWhatsAppStoredEvent(row)).toBe(true);
    expect(isPlatformWhatsAppConversationRecord(conv)).toBe(true);
    const json = JSON.stringify([...store.rows]);
    for (const secret of ['demo-event-1', 'demo-message-1', 'demo-wamid-1', '+12025550101', 'Synthetic private message', 'sourceEventType']) expect(json).not.toContain(secret);
    expect(store.seen.filter(c => c.action === 'commit')).toHaveLength(1);
  });
  it('deduplicates event, message and wamid aliases without extending TTL or changing conversation/connection', async () => {
    const store = memoryStore(), config = configure();
    await ingest(incoming(), config, store.db, now);
    const initial = structuredClone([...store.rows]), original = canonicals(store)[0][1];
    expect((await ingest(incoming(), config, store.db, now + 1)).outcome).toBe('duplicate'); expect([...store.rows]).toEqual(initial);
    expect((await ingest(incoming({ eventId: 'demo-event-2' }), config, store.db, now + 2)).outcome).toBe('duplicate');
    expect((await ingest(incoming({ eventId: 'demo-event-3', messageId: 'demo-message-3' }), config, store.db, now + 3)).outcome).toBe('duplicate');
    expect(canonicals(store)).toHaveLength(1); expect(events(store)).toHaveLength(6);
    for (const [, row] of events(store).filter(([, row]) => row.recordType === 'alias')) expect(row).toMatchObject({ receivedAt: original.receivedAt, expiresAt: original.expiresAt, bodyExpiresAt: original.bodyExpiresAt });
    for (const [path, row] of initial.filter(([path]) => !path.startsWith('platformWhatsAppEvents/'))) expect(store.rows.get(path)).toEqual(row);
  });
  it('stores repeated text with independent IDs and leaves revisions unchanged', async () => {
    const store = memoryStore(), config = configure();
    const first = await ingest(incoming({ whatsappMessageId: null }), config, store.db, now);
    await ingest(incoming({ eventId: 'demo-other-event', messageId: 'demo-other-message', whatsappMessageId: null }), config, store.db, now + 1);
    expect(canonicals(store)).toHaveLength(2); expect(events(store)).toHaveLength(4);
    expect(store.rows.get(`platformWhatsAppConversations/${first.conversationId}`)?.revision).toBe(0);
    expect(store.rows.get(connectionPath)?.connectionRevision).toBe(0);
  });
  it.each([{ text: 'Different synthetic text' }, { customerPhone: '+12025550102' }])('marks conflicts and replays the same conflict without renewing it: %j', async changes => {
    const store = memoryStore(), config = configure();
    const original = await ingest(incoming(), config, store.db, now), beforeConnection = structuredClone(store.rows.get(connectionPath));
    const conflict = await ingest(incoming(changes), config, store.db, now + 1);
    expect(conflict.outcome).toBe('conflict'); expect(canonicals(store)).toHaveLength(1);
    expect(store.rows.get(`platformWhatsAppConversations/${original.conversationId}`)).toMatchObject({ mode: 'review', revision: 1, conflictAt: now + 1, updatedAt: now });
    expect(store.rows.get(`platformWhatsAppConversations/${conflict.conversationId}`)).toMatchObject({ mode: 'review', revision: 1, conflictAt: now + 1 });
    expect(store.rows.get(connectionPath)).toEqual(beforeConnection);
    const before = structuredClone([...store.rows]); expect(await ingest(incoming(changes), config, store.db, now + 2)).toEqual(conflict); expect([...store.rows]).toEqual(before);
  });
  it('uses eventPath for a conflict with a new event ID and does not create aliases', async () => {
    const store = memoryStore(), config = configure(); await ingest(incoming(), config, store.db, now);
    const input = incoming({ eventId: 'demo-conflict-event', text: 'Changed synthetic body' });
    expect((await ingest(input, config, store.db, now + 1)).outcome).toBe('conflict');
    expect(events(store)).toHaveLength(4);
    const snapshot = structuredClone([...store.rows]); await ingest(input, config, store.db, now + 2); expect([...store.rows]).toEqual(snapshot);
  });
  it('detects multiple canonicals joined through crossed aliases', async () => {
    const store = memoryStore(), config = configure(); await ingest(incoming(), config, store.db, now);
    await ingest(incoming({ eventId: 'demo-event-2', messageId: 'demo-message-2', whatsappMessageId: 'demo-wamid-2' }), config, store.db, now);
    expect((await ingest(incoming({ eventId: 'demo-event-3', whatsappMessageId: 'demo-wamid-2' }), config, store.db, now + 1)).outcome).toBe('conflict');
    expect(canonicals(store)).toHaveLength(2);
  });
  it('preserves related conversation scope behavior when a canonical belongs to a different scope', async () => {
    const store = memoryStore(), config = configure(); const old = await ingest(incoming(), config, store.db, now);
    store.rows.delete(connectionPath);
    const other = { ...config, scope: { ...scope, wabaId: '99999' } };
    const result = await ingest(incoming({ wabaId: '99999' }), other, store.db, now + 1);
    expect(result.outcome).toBe('conflict'); expect(result.conversationId).not.toBe(old.conversationId);
    expect(store.rows.get(`platformWhatsAppConversations/${old.conversationId}`)).toMatchObject({ wabaId: scope.wabaId, mode: 'review', revision: 1 });
  });
  it.each(['missing', 'expired', 'invalid'])('fails closed for %s alias targets and commits no partial effects', async fault => {
    const store = memoryStore(), config = configure(); await ingest(incoming(), config, store.db, now);
    const [path, original] = canonicals(store)[0];
    if (fault === 'missing') store.rows.delete(path);
    else if (fault === 'invalid') store.seed(path, { ...original, extra: true });
    else store.seed(path, { ...original, receivedAt: now - 2_592_000_000, expiresAt: now, occurredAt: now - 2_592_000_000, bodyExpiresAt: now - 2_592_000_000 + 86_400_000 });
    const before = structuredClone([...store.rows]);
    await expect(ingest(incoming({ eventId: 'demo-new-event' }), config, store.db, now)).rejects.toMatchObject({ status: 503 });
    expect([...store.rows]).toEqual(before);
  });
  it('rejects invalid expired identities/conversations and corrupted conflict markers before ignoring expiry', async () => {
    const store = memoryStore(), config = configure(); const result = await ingest(incoming(), config, store.db, now);
    const convPath = `platformWhatsAppConversations/${result.conversationId}`;
    store.seed(convPath, { ...store.rows.get(convPath), expiresAt: 0, extra: true });
    await expect(ingest(incoming(), config, store.db, now)).rejects.toMatchObject({ status: 503 });
  });
  it.each(['alias', 'expired-event', 'conflict-marker'])('rejects a corrupted %s before duplicate handling with no writes', async fault => {
    const store = memoryStore(), config = configure(); await ingest(incoming(), config, store.db, now);
    if (fault === 'alias') {
      const [path, value] = events(store).find(([, row]) => row.recordType === 'alias')!; store.seed(path, { ...value, canonicalEventId: 'invalid' });
    } else if (fault === 'expired-event') {
      const [path, value] = canonicals(store)[0]; store.seed(path, { ...value, expiresAt: 0 });
    } else {
      await ingest(incoming({ text: 'Changed synthetic text' }), config, store.db, now + 1);
      const [path, value] = events(store).find(([, row]) => row.recordType === 'conflict')!; store.seed(path, { ...value, extra: true });
    }
    const before = structuredClone([...store.rows]);
    await expect(ingest(incoming(fault === 'conflict-marker' ? { text: 'Changed synthetic text' } : {}), config, store.db, now + 2)).rejects.toMatchObject({ status: 503 });
    expect([...store.rows]).toEqual(before);
  });
  it('treats a valid control occupying an identity as conflict, without replacing the control', async () => {
    const store = memoryStore(), config = configure();
    const eventPath = 'platformWhatsAppEvents/event_d52855e342912b8297c0f86d4b9b0428ec175c599b6b6070e302cf84d5602703';
    const original = audit(); store.seed(eventPath, original);
    expect((await ingest(incoming(), config, store.db, now)).outcome).toBe('conflict');
    expect(store.rows.get(eventPath)).toEqual(original); expect(events(store).filter(([, row]) => row.recordType === 'conflict')).toHaveLength(1);
    expect(store.rows.has(connectionPath)).toBe(false);
  });
  it('expires identities at equality and can store a fresh canonical after metadata expiration', async () => {
    const store = memoryStore(), config = configure(); await ingest(incoming(), config, store.db, now);
    expect((await ingest(incoming(), config, store.db, now + 2_592_000_000)).outcome).toBe('stored');
    expect(canonicals(store)[0][1]).toMatchObject({ state: 'body_erased', content: null, receivedAt: now + 2_592_000_000 });
  });
  it.each([0, -1, 1])('preserves body expiry equality boundary offset %s', async offset => {
    const store = memoryStore(); await ingest(incoming({ occurredAt: now - 86_400_000 + offset }), configure(), store.db, now);
    expect(canonicals(store)[0][1].state).toBe(offset > 0 ? 'body_present' : 'body_erased');
    expect(canonicals(store)[0][1].bodyExpiresAt).toBe(now + offset);
  });
  it('caps future body expiry at receipt time, preserves future timestamps and orders equal-time previews lexically', async () => {
    const store = memoryStore(), config = configure(); const result = await ingest(incoming({ occurredAt: now + 1000 }), config, store.db, now);
    await ingest(incoming({ occurredAt: now + 1000, eventId: 'demo-new', messageId: 'demo-new', whatsappMessageId: null, text: 'Second synthetic body' }), config, store.db, now + 10);
    const conv = store.rows.get(`platformWhatsAppConversations/${result.conversationId}`)!;
    const winner = canonicals(store).sort((a, b) => String(a[1].canonicalIdentity).localeCompare(String(b[1].canonicalIdentity))).at(-1)!;
    expect(conv.canonicalIdentity).toBe(winner[1].canonicalIdentity); expect(conv.bodyExpiresAt).toBe(winner[1].bodyExpiresAt);
    expect(store.rows.get(connectionPath)).toMatchObject({ lastSignedInboundAt: now + 1000, updatedAt: now + 10 });
    await ingest(incoming({ occurredAt: now - 1, eventId: 'demo-old', messageId: 'demo-old', whatsappMessageId: null }), config, store.db, now + 20);
    expect(store.rows.get(`platformWhatsAppConversations/${result.conversationId}`)?.contactContent).toEqual(conv.contactContent);
  });
  it.each(['whatsapp.smb.message.echoes', 'whatsapp.smb.message.created'])('stores nontext human echo %s with null text and human timestamp', async sourceEventType => {
    const store = memoryStore(); await ingest(echo({ sourceEventType }), configure(), store.db, now);
    const [path, row] = canonicals(store)[0]; expect(decrypt(row.content, path, key)).toEqual({ customerPhone: '+12025550101', text: null });
    expect(store.rows.get(connectionPath)).toMatchObject({ lastHumanEchoAt: now, lastSignedInboundAt: null });
  });
  it('checks reception then pause/disconnect before returning any duplicate', async () => {
    const store = memoryStore(), config = configure(); await ingest(incoming(), config, store.db, now);
    await expect(ingest(incoming(), { ...config, receiveEnabled: false }, store.db, now)).rejects.toMatchObject({ status: 503 });
    store.seed(connectionPath, connection({ paused: true, pausedReason: 'manual' }));
    await expect(ingest(incoming(), config, store.db, now)).rejects.toMatchObject({ status: 503 });
    store.seed(connectionPath, connection({ providerConnection: 'disconnected', paused: true, pausedReason: 'disconnected' }));
    await expect(ingest(incoming(), config, store.db, now)).rejects.toMatchObject({ status: 503 });
  });
  it.each([
    { kind: 'message_status' }, { extra: true }, { eventId: 'bad id' }, { messageId: '' }, { whatsappMessageId: undefined },
    { occurredAt: -1 }, { wabaId: '99999' }, { businessPhone: '+12025550199' }, { customerPhone: scope.phoneE164 }, { text: '' }, { text: 'x'.repeat(4097) },
  ])('rejects malformed normalized input %# before writing', async patch => {
    const store = memoryStore(); await expect(ingest(incoming(patch), configure(), store.db, now)).rejects.toMatchObject({ status: 400 }); expect(store.rows.size).toBe(0);
  });
  it.each([{ messageType: 'text', text: null }, { messageType: 'image', text: 'unexpected' }, { sourceEventType: 'unknown' }])('enforces echo text relation %#', async patch => {
    const store = memoryStore(); await expect(ingest(echo(patch), configure(), store.db, now)).rejects.toMatchObject({ status: 400 });
  });
  it('accepts the exact Zod codepoint text boundary', async () => {
    const store = memoryStore(); expect((await ingest(incoming({ text: '😀'.repeat(4096) }), configure(), store.db, now)).outcome).toBe('stored');
  });
});
