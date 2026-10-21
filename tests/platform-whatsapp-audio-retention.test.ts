import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const auth = vi.hoisted(() => ({ getUser: vi.fn() }));
vi.mock('@/lib/firebase/admin', () => ({ getAdminDb: () => { throw new Error('Default backend forbidden'); }, getAdminAuth: () => auth }));
import { beginPlatformWhatsAppLink as begin, verifyPlatformWhatsAppLinkInbound as verify, confirmPlatformWhatsAppLink as confirm, revokePlatformWhatsAppLink as revoke, readPlatformWhatsAppLinkStatus as status, preparePlatformWhatsAppAudioRetentionIdentity as prepare, readPlatformWhatsAppAudioRetentionIdentityInTransaction as recheck } from '@/lib/server/platform-whatsapp-link';
import { ingestPlatformWhatsAppEvent as ingest } from '@/lib/server/platform-whatsapp-ingress';
import { decryptPlatformWhatsAppContent as decrypt } from '@/lib/server/platform-whatsapp-crypto';
import { listPlatformWhatsAppConversations as list } from '@/lib/server/platform-whatsapp-conversations';
import { createCloudflareDatabase } from '@/lib/storage/database';
import { configureLink, phone, token, seedConsents } from './platform-whatsapp-link-fixtures';
import { configure, incoming, key, memoryStore, now, scope } from './platform-whatsapp-test-fixtures';

const descriptor = { id: '123456789', link: 'https://api.ycloud.com/v2/whatsapp/media/download/123456789?sig=synthetic', sha256: Buffer.alloc(32, 7).toString('base64'), mimeType: 'audio/ogg; codecs=opus' };
function audio(patch = {}) { const { text: _text, ...base } = incoming(); return { ...base, kind: 'incoming_audio', audio: descriptor, customerSentAt: now - 1, ...patch }; }
const canonical = (store: ReturnType<typeof memoryStore>) => [...store.rows].find(([path, row]) => path.startsWith('platformWhatsAppEvents/') && row.recordType === 'event')!;

describe('positive encrypted audio descriptor retention only', () => {
  let store: ReturnType<typeof memoryStore>;
  beforeEach(async () => { configureLink(); auth.getUser.mockReset().mockImplementation(async uid => ({ uid, disabled: false })); store = memoryStore(); await seedConsents(store.db); });
  afterEach(() => vi.unstubAllEnvs());
  async function linked() { const challenge = await begin(token(), { phoneE164: phone, requestId: 'demo-audio-begin' }, store.db, now); await verify(incoming({ text: challenge.code }), store.db, now); return confirm(token(), { challengeId: challenge.challengeId, requestId: 'demo-audio-confirm' }, store.db, now); }
  it('retains first post-link audio in human mode with original anchors and a separate null-text preview', async () => {
    const link = await linked(), prepared = await prepare(phone, scope, store.db, now);
    expect(prepared).toMatchObject({ uid: token().uid, linkId: link.linkId, linkRevision: 1, confirmedAuthTime: token().auth_time });
    expect([...store.rows.keys()].some(path => path.startsWith('platformWhatsAppConversations/'))).toBe(false);
    const result = await ingest(audio(), configure(), store.db, now), [path, row] = canonical(store);
    expect(row).toMatchObject({ kind: 'incoming_audio', ingressDisposition: 'descriptor_retained', state: 'body_present', customerSentAt: now - 1, bodyExpiresAt: now + 86_400_000 });
    expect(decrypt(row.content, path, key)).toEqual({ customerPhone: phone, audio: descriptor, retentionAnchor: { uid: prepared!.uid, linkId: prepared!.linkId, linkRevision: prepared!.linkRevision, account: prepared!.account, support: prepared!.support } });
    const convPath = 'platformWhatsAppConversations/' + result.conversationId, conv = store.rows.get(convPath)!;
    expect(conv).toMatchObject({ mode: 'human', revision: 0, lastInboundAt: now });
    expect(decrypt(conv.contactContent, convPath, key)).toEqual({ customerPhone: phone, text: null }); expect(conv.contactContent).not.toEqual(row.content);
    const view = await list(store.db, now); expect(view.conversations[0]).toMatchObject({ customerPhone: phone, lastMessage: null, contentAvailable: true });
    expect(JSON.stringify(view)).not.toContain('retentionAnchor'); expect(JSON.stringify(view)).not.toContain(descriptor.link);
    expect((await list(store.db, now + 86_400_000)).conversations[0]).toMatchObject({ customerPhone: null, contentAvailable: false });
    const raw = JSON.stringify([...store.rows].filter(([path]) => path.startsWith('platformWhatsAppEvents/')));
    for (const value of [phone, descriptor.link, descriptor.sha256, descriptor.id, token().uid, link.linkId]) expect(raw).not.toContain(value);
    expect([...store.rows.keys()].every(path => /^(serverSettings|platformWhatsAppLinks|platformWhatsAppLinkChallenges|platformWhatsAppConversations|platformWhatsAppEvents|platformWhatsAppJobs)\//.test(path))).toBe(true);
    expect([...store.rows.values()].filter(row => row.recordType === 'control_head')).toHaveLength(1);
    expect([...store.rows.values()].some(row => row.recordType === 'job')).toBe(false);
  });
  it('uses supplied transactions and keeps current Firebase lookup outside callbacks', async () => {
    await linked(); let inCallback = false;
    const wrapped = { collection: store.db.collection.bind(store.db), runTransaction: async <T,>(callback: Parameters<typeof store.db.runTransaction<T>>[0]) => store.db.runTransaction(async tx => { inCallback = true; try { return await callback(tx); } finally { inCallback = false; } }) };
    auth.getUser.mockImplementation(async uid => { expect(inCallback).toBe(false); return { uid, disabled: false }; });
    const prepared = await prepare(phone, scope, wrapped, now); expect(prepared).not.toBeNull();
    const noNested = { collection: store.db.collection.bind(store.db), runTransaction: () => { throw new Error('Nested transaction forbidden'); } };
    await store.db.runTransaction(async tx => { expect(await recheck(prepared!, phone, scope, tx, noNested, now)).toEqual(prepared); });
    await ingest(audio(), configure(), wrapped, now);
  });
  it('retains descriptors in existing review mode without granting bot or changing revision', async () => {
    await linked(); const result = await ingest(incoming(), configure(), store.db, now);
    const convPath = 'platformWhatsAppConversations/' + result.conversationId, conv = store.rows.get(convPath)!;
    store.seed(convPath, { ...conv, mode: 'review', revision: 7 });
    await ingest(audio({ eventId: 'demo-review-audio', messageId: 'demo-review-audio', whatsappMessageId: null, occurredAt: now + 1 }), configure(), store.db, now + 1);
    const retained = [...store.rows.values()].find(row => row.kind === 'incoming_audio')!;
    expect(retained).toMatchObject({ ingressDisposition: 'descriptor_retained', state: 'body_present' });
    expect(store.rows.get(convPath)).toMatchObject({ mode: 'review', revision: 7 });
  });
  it('binds supplied-TX facts to exact original scope, phone, confirmed auth time and anchors', async () => {
    await linked(); const prepared = (await prepare(phone, scope, store.db, now))!;
    for (const changed of [{ ...prepared, confirmedAuthTime: prepared.confirmedAuthTime - 1 }, { ...prepared, linkRevision: 2 }, { ...prepared, account: { ...prepared.account, revision: 2 } }]) {
      await store.db.runTransaction(async tx => { expect(await recheck(changed, phone, scope, tx, store.db, now)).toBeNull(); });
    }
    expect(await prepare(phone, { ...scope, phoneNumberId: '99999' }, store.db, now)).toBeNull();
    expect(await prepare('+12025550102', scope, store.db, now)).toBeNull();
    await seedConsents(store.db, token().uid, 2);
    await store.db.runTransaction(async tx => { expect(await recheck(prepared, phone, scope, tx, store.db, now)).toBeNull(); });
  });
  it('denies retention when supplied ingress content key derives a different canonical conversation', async () => {
    await linked();
    await ingest(audio(), { ...configure(), contentKey: Buffer.alloc(32, 72) }, store.db, now);
    expect(canonical(store)[1]).toMatchObject({ ingressDisposition: 'control_only', state: 'body_erased', content: null });
    expect([...store.rows.keys()].some(path => path.startsWith('platformWhatsAppConversations/'))).toBe(false);
  });
  it('leaves denied source permanently control-only after linking and does not create a contact', async () => {
    await ingest(audio(), configure(), store.db, now); const [path, row] = canonical(store);
    expect(row).toMatchObject({ ingressDisposition: 'control_only', state: 'body_erased', content: null });
    expect([...store.rows.keys()].some(path => path.startsWith('platformWhatsAppConversations/'))).toBe(false);
    await linked(); expect((await ingest(audio({ eventId: 'demo-later-alias' }), configure(), store.db, now + 1)).outcome).toBe('duplicate');
    expect(store.rows.get(path)).toEqual(row); expect([...store.rows.keys()].some(path => path.startsWith('platformWhatsAppConversations/'))).toBe(false);
  });
  it.each(['disabled', 'deleted', 'revoked', 'expired', 'inactive', 'key'])('denies known %s authority without content', async fault => {
    await linked();
    if (fault === 'disabled') auth.getUser.mockResolvedValue({ uid: token().uid, disabled: true });
    if (fault === 'deleted') auth.getUser.mockRejectedValue({ code: 'auth/user-not-found' });
    if (fault === 'revoked') auth.getUser.mockResolvedValue({ uid: token().uid, disabled: false, tokensValidAfterTime: new Date(now + 1).toISOString() });
    if (fault === 'inactive') await seedConsents(store.db, token().uid, 2, false);
    if (fault === 'key') vi.stubEnv('PLATFORM_WHATSAPP_LINK_HMAC_KEY', '');
    await ingest(audio(), configure(), store.db, fault === 'expired' ? now + 2_592_000_000 : now);
    expect(canonical(store)[1]).toMatchObject({ ingressDisposition: 'control_only', content: null });
  });
  it.each(['firebase', 'marker', 'duplicate-owner', 'receipt', 'conversation'])('fails closed with 503 and no writes for %s failure/corruption', async fault => {
    await linked();
    if (fault === 'firebase') auth.getUser.mockRejectedValue(new Error('private Firebase outage'));
    if (fault === 'marker') { const entry = [...store.rows].find(([path]) => path.includes('platform_whatsapp_link_key_'))!; store.seed(entry[0], { ...entry[1], extra: true }); }
    if (fault === 'duplicate-owner') { const row = [...store.rows.values()].find(row => row.recordType === 'link_uid')!; store.seed('platformWhatsAppLinks/uid_' + 'f'.repeat(64), { ...row, uidIndex: 'f'.repeat(64) }); }
    if (fault === 'receipt') { const path = [...store.rows.keys()].find(path => path.includes('demo_receipt_account'))!; store.rows.delete(path); }
    if (fault === 'conversation') { const prepared = await prepare(phone, scope, store.db, now); store.seed('platformWhatsAppConversations/' + prepared!.conversationId, { corrupt: true }); }
    const before = structuredClone([...store.rows]); await expect(ingest(audio(), configure(), store.db, now)).rejects.toMatchObject({ status: 503 }); expect([...store.rows]).toEqual(before);
  });
  it('does not upgrade a prepared snapshot across revoke/reaccept during commit retry', async () => {
    await linked(); const prepared = await prepare(phone, scope, store.db, now); const state = await status(token(), store.db, now);
    let injected = false;
    const racing = createCloudflareDatabase(async command => { if (command.action === 'commit' && !injected) { injected = true; await revoke(token(), 'revoke_v1_' + state.revokeGeneration + '_' + randomUUID(), store.db, now); await seedConsents(store.db, token().uid, 2); } return store.transport(command); });
    await ingest(audio(), configure(), racing, now);
    expect(canonical(store)[1]).toMatchObject({ ingressDisposition: 'control_only', content: null });
    await store.db.runTransaction(async tx => { expect(await recheck(prepared!, phone, scope, tx, store.db, now)).toBeNull(); });
  });
});
