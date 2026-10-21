import { randomUUID, createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const auth = vi.hoisted(() => ({ getUser: vi.fn() }));
vi.mock('@/lib/firebase/admin', () => ({ getAdminDb: () => { throw new Error('Default backend forbidden'); }, getAdminAuth: () => auth }));
import { beginPlatformWhatsAppLink as begin, verifyPlatformWhatsAppLinkInbound as verify, confirmPlatformWhatsAppLink as confirm, readPlatformWhatsAppLinkStatus as status, revokePlatformWhatsAppLink as revoke, resolvePlatformWhatsAppActor as resolve, assertPlatformWhatsAppAuthorization as authorize } from '@/lib/server/platform-whatsapp-link';
import { configureLink, phone, token, seedConsents } from './platform-whatsapp-link-fixtures';
import { incoming, memoryStore, now, scope } from './platform-whatsapp-test-fixtures';
import { ingestPlatformWhatsAppEvent } from '@/lib/server/platform-whatsapp-ingress';
import { getPlatformWhatsAppConfig } from '@/lib/server/platform-whatsapp-config';
import { isPlatformWhatsAppLinkRecord } from '../shared/platform-whatsapp-link-records';

describe('durable platform linking', () => {
  let store: ReturnType<typeof memoryStore>;
  beforeEach(async () => { configureLink(); auth.getUser.mockReset().mockImplementation(async uid => ({ uid, disabled: false })); store = memoryStore(); await seedConsents(store.db); });
  afterEach(() => vi.unstubAllEnvs());
  const start = (requestId = 'demo-begin-1', at = now) => begin(token(undefined, at), { phoneE164: phone, requestId }, store.db, at);
  async function linked() { const challenge = await start(); expect(await verify(incoming({ text: challenge.code }), store.db, now)).toBe('verified'); const result = await confirm(token(), { challengeId: challenge.challengeId, requestId: 'demo-confirm-1' }, store.db, now); return { ...challenge, ...result }; }
  it('stores only the raw-byte secret hash, creates no history and requires explicit web confirmation', async () => {
    const challenge = await start(), [prefix, id, secret, mac] = challenge.code.split(':');
    expect(prefix).toBe('sarinbot.link.v1'); expect(id).toBe(challenge.challengeId); expect(secret).toMatch(/^[A-Za-z0-9_-]{43}$/); expect(mac).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(secret, 'base64url')).toHaveLength(32); expect(challenge.expiresAt).toBe(now + 600_000);
    const row = store.rows.get('platformWhatsAppLinkChallenges/challenge_' + id)!;
    expect(row.secretHash).toBe(createHash('sha256').update(Buffer.from(secret, 'base64url')).digest('hex'));
    expect(JSON.stringify([...store.rows])).not.toContain(secret); expect(JSON.stringify([...store.rows])).not.toContain(mac); expect(JSON.stringify([...store.rows])).not.toContain(phone);
    await expect(confirm(token(), { challengeId: id, requestId: 'demo-confirm-1' }, store.db, now)).rejects.toMatchObject({ status: 409 });
    expect(await verify(incoming({ text: challenge.code }), store.db, now)).toBe('verified');
    expect((await status(token(), store.db, now)).current).toBeNull();
    expect([...store.rows.keys()].every(p => p.startsWith('serverSettings/') || p.startsWith('platformWhatsAppLinks/') || p.startsWith('platformWhatsAppLinkChallenges/'))).toBe(true);
  });
  it.each([undefined, -1, now / 1000 + 1, 1.5, '1900000000'])('rejects invalid auth_time %j before reads', async authTime => {
    const before = store.seen.length;
    await expect(begin({ ...token(), auth_time: authTime } as never, { phoneE164: phone, requestId: 'demo-invalid' }, store.db, now)).rejects.toMatchObject({ status: 401 });
    expect(store.seen).toHaveLength(before);
  });
  it('labels only current enabled nonrevoked stale authentication as recoverable recent-auth-required', async () => {
    const old = token(undefined, now - 301_000), input = { phoneE164: phone, requestId: 'demo-stale-auth' }, before = store.seen.length;
    await expect(begin(old, input, store.db, now)).rejects.toMatchObject({ status: 428, code: 'LINK_RECENT_AUTH_REQUIRED' });
    for (const override of [{ disabled: true }, { uid: 'demo-other' }, { tokensValidAfterTime: new Date(now).toISOString() }]) {
      auth.getUser.mockResolvedValue({ uid: old.uid, disabled: false, ...override });
      await expect(begin(old, input, store.db, now)).rejects.toMatchObject({ status: 401, code: 'LINK_AUTH_REQUIRED' });
    }
    auth.getUser.mockRejectedValue({ code: 'auth/user-not-found' });
    await expect(begin(old, input, store.db, now)).rejects.toMatchObject({ status: 401, code: 'LINK_AUTH_REQUIRED' });
    expect(store.seen).toHaveLength(before);
  });
  it('rejects a path-mismatched expired phone record before key-independent owner status or revoke', async () => {
    const result = await linked(), owner = (await status(token(), store.db, now));
    const entry = [...store.rows].find(([, value]) => value.recordType === 'link_phone')!;
    store.seed(entry[0], { ...entry[1], phoneIndex: 'f'.repeat(64) });
    await expect(status(token(), store.db, now + 2_592_000_000)).rejects.toMatchObject({ status: 503 });
    await expect(revoke(token(undefined, now + 2_592_000_000), 'revoke_v1_' + owner.revokeGeneration + '_' + randomUUID(), store.db, now + 2_592_000_000)).rejects.toMatchObject({ status: 503 });
    expect(result.linkId).toBe(owner.current?.linkId);
  });
  it('validates expired ownership relationships and future issue dates before omitting stale state', async () => {
    await linked();
    const [path, original] = [...store.rows].find(([, value]) => value.recordType === 'link_phone')!;
    store.seed(path, { ...original, createdAt: Number(original.createdAt) + 1, expiresAt: Number(original.expiresAt) + 1 });
    await expect(status(token(), store.db, now + 2_592_000_000)).rejects.toMatchObject({ status: 503 });
    store.seed(path, original);
    const [ownerPath, owner] = [...store.rows].find(([, value]) => value.recordType === 'link_uid')!;
    store.seed(ownerPath, { ...owner, createdAt: now + 1000, issues: [{ issuedAt: now + 1000, expiresAt: now + 3_601_000 }] });
    await expect(start('demo-future-state')).rejects.toMatchObject({ status: 503 });
  });
  it.each([{ disabled: true }, { disabled: undefined }, { uid: 'demo-other' }, { tokensValidAfterTime: 'invalid' }, { tokensValidAfterTime: new Date(now + 1).toISOString() }])('rejects current-user corruption or revocation %j before durable reads', async override => {
    auth.getUser.mockResolvedValue({ uid: token().uid, disabled: false, ...override }); const before = store.seen.length;
    await expect(start()).rejects.toMatchObject({ status: 401 }); expect(store.seen).toHaveLength(before);
  });
  it('accepts cutoff equality and the five-minute boundary; status needs current but not recent auth', async () => {
    auth.getUser.mockResolvedValue({ uid: token().uid, disabled: false, tokensValidAfterTime: new Date(now - 300_000).toISOString() });
    await begin(token(undefined, now - 300_000), { phoneE164: phone, requestId: 'demo-boundary' }, store.db, now);
    expect((await status(token(), store.db, now + 300_001)).pending).not.toBeNull();
  });
  it('fails closed for unavailable Firebase without leaking its error', async () => {
    auth.getUser.mockRejectedValue(new Error('synthetic private error'));
    await expect(start()).rejects.toMatchObject({ status: 503 }); expect(store.seen.filter(c => c.action === 'commit')).toHaveLength(4);
  });
  it('cannot recover a begin code on HTTP replay, but an identical lost commit retains invocation code', async () => {
    store.loseNextResponse(); const first = await start();
    await expect(start()).rejects.toMatchObject({ status: 409, code: 'CHALLENGE_CODE_UNAVAILABLE' });
    await expect(begin(token(), { phoneE164: '+12025550102', requestId: 'demo-begin-1' }, store.db, now)).rejects.toMatchObject({ status: 409 });
    expect(await verify(incoming({ text: first.code }), store.db, now)).toBe('verified');
  });
  it('retains current link across challenge replacement, bounds three issues and expires rolling rates at equality', async () => {
    const current = await linked(); await start('demo-begin-2', now + 1); await start('demo-begin-3', now + 2);
    await expect(start('demo-begin-4', now + 3)).rejects.toMatchObject({ status: 429 });
    expect((await status(token(), store.db, now + 3)).current?.linkId).toBe(current.linkId);
    await start('demo-begin-4', now + 3_600_000);
  });
  it('deduplicates overlapping aliases and lets the fifth distinct attempt succeed but never a sixth', async () => {
    const c = await start(), bad = c.code.replace(/:[^:]+$/, ':' + 'A'.repeat(43));
    for (let i = 0; i < 4; i++) expect(await verify(incoming({ text: bad, eventId: 'event' + i, messageId: 'message' + i, whatsappMessageId: 'wamid' + i }), store.db, now)).toBe('rejected');
    expect(await verify(incoming({ text: bad, eventId: 'event-extra', messageId: 'message0', whatsappMessageId: null }), store.db, now)).toBe('rejected');
    expect(await verify(incoming({ text: c.code, eventId: 'event4', messageId: 'message4', whatsappMessageId: null }), store.db, now)).toBe('verified');
    expect(await verify(incoming({ text: c.code, eventId: 'event5', messageId: 'message5', whatsappMessageId: null }), store.db, now)).toBe('rejected');
    expect(store.rows.get('platformWhatsAppLinkChallenges/challenge_' + c.challengeId)?.attempts).toHaveLength(5);
  });
  it('rejects reserved controls, unknown challenges and foreign scope/phone without consuming attempts', async () => {
    const c = await start();
    for (const extra of [{ customerPhone: '+12025550102' }, { customerPhone: scope.phoneE164 }, { wabaId: '99999' }, { businessPhone: '+12025550102' }]) expect(await verify(incoming({ text: c.code, ...extra }), store.db, now)).toBe('rejected');
    for (const text of ['sarinbot.link.v2:bad', 'sarinbot.link.', 'sarinbot.link.v1:bad']) expect(await verify(incoming({ text }), store.db, now)).toBe('rejected');
    expect(store.rows.get('platformWhatsAppLinkChallenges/challenge_' + c.challengeId)?.attempts).toHaveLength(0);
    vi.stubEnv('PLATFORM_WHATSAPP_LINK_HMAC_KEY', undefined);
    expect(await verify(incoming({ text: 'sarinbot.link.v2:bad' }), store.db, now)).toBe('rejected');
    expect(await verify(incoming(), store.db, now)).toBe('not_control');
  });
  it('requires exact live anchors and rejects old confirm replay after reacceptance', async () => {
    const result = await linked(); await seedConsents(store.db, token().uid, 2);
    await expect(confirm(token(), { challengeId: result.challengeId, requestId: 'demo-confirm-1' }, store.db, now)).rejects.toMatchObject({ status: 409 });
  });
  it('supports key-independent status/revoke and accepted replay cannot revoke a later link', async () => {
    await linked(); const s = await status(token(), store.db, now), requestId = 'revoke_v1_' + s.revokeGeneration + '_' + randomUUID();
    vi.stubEnv('PLATFORM_WHATSAPP_LINK_HMAC_KEY', undefined); await seedConsents(store.db, token().uid, 2, false);
    expect(await status(token(), store.db, now)).toMatchObject({ available: false, current: { maskedPhone: '••••0101' } });
    await revoke(token(), requestId, store.db, now); await revoke(token(), requestId, store.db, now);
    configureLink(); await seedConsents(store.db, token().uid, 3); const c = await start('demo-begin-2'); await verify(incoming({ text: c.code }), store.db, now); await confirm(token(), { challengeId: c.challengeId, requestId: 'demo-confirm-2' }, store.db, now);
    await revoke(token(), requestId, store.db, now); expect((await status(token(), store.db, now)).current).not.toBeNull();
    await expect(revoke(token(), 'revoke_v1_' + s.revokeGeneration + '_' + randomUUID(), store.db, now)).rejects.toMatchObject({ status: 409 });
  });
  it('resolves identity only after ordinary canonical ingress but always denies automation and reuses supplied tx', async () => {
    const link = await linked(), row = store.rows.get('platformWhatsAppLinks/link_' + link.linkId)!;
    if (!isPlatformWhatsAppLinkRecord(row)) throw new Error('Invalid synthetic link');
    expect(await resolve(phone, row.conversationId, store.db, now)).toBeNull();
    await ingestPlatformWhatsAppEvent(incoming(), getPlatformWhatsAppConfig(), store.db, now);
    const actor = await resolve(phone, row.conversationId, store.db, now); expect(actor).toMatchObject({ uid: token().uid, linkId: link.linkId, linkRevision: 1 });
    const db = { ...store.db, runTransaction: async () => { throw new Error('Nested transaction forbidden'); } };
    await store.db.runTransaction(async tx => { await expect(authorize(actor!, tx, db, now)).rejects.toMatchObject({ status: 403 }); });
    expect(await resolve(phone, row.conversationId, store.db, now + 2_592_000_000)).toBeNull();
  });
  it('blocks missing marker with any control, changed key even after controls expire, and colliding owner records', async () => {
    await start(); const marker = [...store.rows.keys()].find(p => p.includes('platform_whatsapp_link_key_'))!; const saved = store.rows.get(marker)!;
    store.rows.delete(marker); await expect(start('demo-begin-2')).rejects.toMatchObject({ status: 503 }); store.seed(marker, saved);
    vi.stubEnv('PLATFORM_WHATSAPP_LINK_HMAC_KEY', Buffer.alloc(32, 20).toString('base64')); await expect(start('demo-begin-2')).rejects.toMatchObject({ status: 503 });
    const owner = [...store.rows].find(([, r]) => r.recordType === 'link_uid')!; store.seed('platformWhatsAppLinks/uid_' + 'f'.repeat(64), owner[1]);
    await expect(status(token(), store.db, now)).rejects.toMatchObject({ status: 503 });
  });
  it('keeps persistent marker protection after all customer controls are gone and cannot bootstrap over foreign controls', async () => {
    await start();
    for (const path of [...store.rows.keys()]) if (path.startsWith('platformWhatsAppLink')) store.rows.delete(path);
    vi.stubEnv('PLATFORM_WHATSAPP_LINK_HMAC_KEY', Buffer.alloc(32, 20).toString('base64'));
    await expect(start('demo-begin-2')).rejects.toMatchObject({ status: 503 });
    configureLink(); const marker = [...store.rows.keys()].find(p => p.includes('platform_whatsapp_link_key_'))!; store.rows.delete(marker);
    store.seed('platformWhatsAppLinkChallenges/demo-foreign', { expiresAt: 0 });
    await expect(start('demo-begin-2')).rejects.toMatchObject({ status: 503 });
    expect((await status(token(), store.db, now)).available).toBe(false);
  });
  it('never writes on missing consent, reserved request namespace, or no-op/stale-generation revoke', async () => {
    await seedConsents(store.db, token().uid, 2, false); let before = store.seen.filter(c => c.action === 'commit').length;
    await expect(start()).rejects.toMatchObject({ code: 'CONSENT_REQUIRED' });
    await expect(start('revoke_v1_reserved')).rejects.toMatchObject({ status: 400 });
    const rejected = 'revoke_v1_' + randomUUID() + '_' + randomUUID();
    await expect(revoke(token(), rejected, store.db, now)).rejects.toMatchObject({ status: 409 });
    expect(store.seen.filter(c => c.action === 'commit')).toHaveLength(before);
    await seedConsents(store.db, token().uid, 3); await start(); before = store.seen.filter(c => c.action === 'commit').length;
    await expect(revoke(token(), rejected, store.db, now)).rejects.toMatchObject({ status: 409 });
    expect(store.seen.filter(c => c.action === 'commit')).toHaveLength(before);
  });
  it('enforces ten-minute equality before cleanup, confirms only its UID, and rejects noncanonical secret/MAC', async () => {
    const c = await start();
    await seedConsents(store.db, 'demo-other');
    await expect(confirm(token('demo-other'), { challengeId: c.challengeId, requestId: 'demo-other-confirm' }, store.db, now)).rejects.toMatchObject({ status: 409 });
    const pieces = c.code.split(':');
    for (const index of [2, 3]) { const changed = [...pieces]; changed[index] += '='; expect(await verify(incoming({ text: changed.join(':'), eventId: 'bad' + index, messageId: 'bad' + index, whatsappMessageId: null }), store.db, now)).toBe('rejected'); }
    expect(await verify(incoming({ text: c.code }), store.db, now + 599_999)).toBe('verified');
    await expect(confirm(token(undefined, now + 600_000), { challengeId: c.challengeId, requestId: 'demo-late-confirm' }, store.db, now + 600_000)).rejects.toMatchObject({ status: 409 });
    expect((await status(token(), store.db, now + 600_000)).pending).toBeNull();
  });
  it('checks Firebase before opening its own transactions and propagates operational inbound failure', async () => {
    let inside = false;
    const db = { ...store.db, runTransaction: async <T,>(callback: Parameters<typeof store.db.runTransaction<T>>[0]) => store.db.runTransaction(async tx => { inside = true; try { return await callback(tx); } finally { inside = false; } }) };
    auth.getUser.mockImplementation(async uid => { if (inside) throw new Error('Firebase inside callback'); return { uid, disabled: false }; });
    const c = await begin(token(), { phoneE164: phone, requestId: 'demo-outside-auth' }, db, now);
    expect(await verify(incoming({ text: c.code }), db, now)).toBe('verified');
    auth.getUser.mockRejectedValue(new Error('synthetic unavailable'));
    await expect(verify(incoming({ text: c.code }), db, now)).rejects.toMatchObject({ status: 503 });
  });
  it('denies a forged bot conversation and identity after confirmed authentication is revoked', async () => {
    const result = await linked(), row = store.rows.get('platformWhatsAppLinks/link_' + result.linkId)!;
    if (!isPlatformWhatsAppLinkRecord(row)) throw new Error('Invalid fixture');
    await ingestPlatformWhatsAppEvent(incoming(), getPlatformWhatsAppConfig(), store.db, now);
    const path = 'platformWhatsAppConversations/' + row.conversationId, saved = store.rows.get(path)!;
    store.seed(path, { ...saved, mode: 'bot' }); expect(await resolve(phone, row.conversationId, store.db, now)).toBeNull();
    store.seed(path, saved); auth.getUser.mockResolvedValue({ uid: token().uid, disabled: false, tokensValidAfterTime: new Date(now + 1).toISOString() });
    expect(await resolve(phone, row.conversationId, store.db, now + 1)).toBeNull();
  });
  it('fails identity and inbound proof closed when a second owner record collides with the same UID', async () => {
    const result = await linked(), row = store.rows.get('platformWhatsAppLinks/link_' + result.linkId)!;
    if (!isPlatformWhatsAppLinkRecord(row)) throw new Error('Invalid fixture');
    await ingestPlatformWhatsAppEvent(incoming(), getPlatformWhatsAppConfig(), store.db, now);
    const pending = await start('demo-second-pending');
    const owner = [...store.rows.values()].find(v => v.recordType === 'link_uid')!;
    store.seed('platformWhatsAppLinks/uid_' + 'f'.repeat(64), { ...owner, uidIndex: 'f'.repeat(64) });
    expect(await resolve(phone, row.conversationId, store.db, now)).toBeNull();
    await expect(verify(incoming({ text: pending.code }), store.db, now)).rejects.toMatchObject({ status: 503 });
  });
  it('allows four revokes with a carry-in link plus three fresh issues and retains rates after revoke', async () => {
    await linked(); const later = now + 3_600_000;
    const remove = async () => { const s = await status(token(undefined, later), store.db, later); await revoke(token(undefined, later), 'revoke_v1_' + s.revokeGeneration + '_' + randomUUID(), store.db, later); };
    await remove();
    for (let i = 0; i < 3; i++) { await start('demo-hour-' + i, later); await remove(); }
    await expect(start('demo-hour-4', later)).rejects.toMatchObject({ status: 429 });
  });
});
