import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('@/lib/firebase/admin', () => ({ getAdminDb: () => { throw new Error('Default backend forbidden'); }, getAdminAuth: () => ({ getUser: async (uid: string) => ({ uid, disabled: false }) }) }));
import { createDataTestRuntime } from '../cloudflare/tests/data-runtime.mjs';
import { createCloudflareDatabase, StorageError, type DataTransport } from '@/lib/storage/database';
import type { DataCommand, DataReadResult, DataCommitResult } from '../shared/data-protocol';
import type { Database } from '@/lib/storage/types';
import { beginPlatformWhatsAppLink as begin, verifyPlatformWhatsAppLinkInbound as verify, confirmPlatformWhatsAppLink as confirm, revokePlatformWhatsAppLink as revoke, readPlatformWhatsAppLinkStatus as status } from '@/lib/server/platform-whatsapp-link';
import { configureLink, token, phone, seedConsents } from './platform-whatsapp-link-fixtures';
import { incoming, now } from './platform-whatsapp-test-fixtures';

describe('link ownership on actual local D1 with deterministic commit interleaving', () => {
  let runtime: Awaited<ReturnType<typeof createDataTestRuntime>>, db: Database, second: Database;
  const transport: DataTransport = async command => { const response = await runtime.fetch(command), body = await response.json() as DataReadResult | DataCommitResult; if (!response.ok) throw new StorageError(response.status, (body as unknown as { code: string }).code); return body; };
  beforeAll(async () => { runtime = await createDataTestRuntime(); }, 30_000);
  afterAll(async () => { await runtime?.dispose(); });
  beforeEach(async () => { configureLink(); await runtime.db.exec('DELETE FROM app_documents; DELETE FROM app_commits;'); db = createCloudflareDatabase(transport); second = createCloudflareDatabase(transport); await seedConsents(db); await seedConsents(db, 'demo-second'); });
  afterEach(() => vi.unstubAllEnvs());
  const start = (uid = token().uid, requestId = 'demo-start-1', at = now) => begin(token(uid, at), { phoneE164: phone, requestId }, db, at);
  async function proven(uid = token().uid, requestId = 'demo-start-1') { const c = await start(uid, requestId); expect(await verify(incoming({ text: c.code }), db, now)).toBe('verified'); return c; }
  function race(effect: () => Promise<unknown>) { let injected = false; return createCloudflareDatabase(async command => { if (command.action === 'commit' && !injected) { injected = true; await effect(); } return transport(command); }); }
  it('serializes two proven UIDs claiming one phone without partial owner/link rows', async () => {
    const a = await proven(), b = await proven('demo-second');
    const racing = race(() => confirm(token('demo-second'), { challengeId: b.challengeId, requestId: 'demo-confirm-b' }, second, now));
    await expect(confirm(token(), { challengeId: a.challengeId, requestId: 'demo-confirm-a' }, racing, now)).rejects.toMatchObject({ status: 409 });
    const records = (await db.collection('platformWhatsAppLinks').get()).docs.map(d => d.data());
    expect(records.filter(r => r.recordType === 'link')).toHaveLength(1); expect(records.filter(r => r.recordType === 'link_phone')).toHaveLength(1);
    expect(records.find(r => r.recordType === 'link_uid' && r.ownerUid === token().uid)?.currentLinkId).toBeNull();
    expect((await status(token('demo-second'), db, now)).current?.revision).toBe(1);
  });
  it('replays double confirmation with one durable result after handles are recreated', async () => {
    const c = await proven(), input = { challengeId: c.challengeId, requestId: 'demo-confirm-1' };
    const racing = race(() => confirm(token(), input, second, now));
    const result = await confirm(token(), input, racing, now);
    expect(await confirm(token(), input, createCloudflareDatabase(transport), now)).toEqual(result);
    expect((await db.collection('platformWhatsAppLinks').get()).docs.filter(d => d.data().recordType === 'link')).toHaveLength(1);
  });
  it('replacement racing proof or confirmation cannot revive the replaced challenge', async () => {
    const c = await start();
    const racing = race(() => begin(token(), { phoneE164: phone, requestId: 'demo-replacement' }, second, now));
    expect(await verify(incoming({ text: c.code }), racing, now)).toBe('rejected');
    await expect(confirm(token(), { challengeId: c.challengeId, requestId: 'demo-confirm-1' }, db, now)).rejects.toMatchObject({ status: 409 });
    const pending = (await status(token(), db, now)).pending!;
    expect(pending.challengeId).not.toBe(c.challengeId);
  });
  it('replacement winning against an already proven confirmation leaves the new pending proof untouched', async () => {
    const c = await proven();
    const racing = race(() => begin(token(), { phoneE164: phone, requestId: 'demo-replace-confirm' }, second, now));
    await expect(confirm(token(), { challengeId: c.challengeId, requestId: 'demo-racing-confirm' }, racing, now)).rejects.toMatchObject({ status: 409 });
    expect((await status(token(), db, now)).pending).toMatchObject({ proof: 'pending' });
    expect((await db.collection('platformWhatsAppLinks').get()).docs.filter(d => d.data().recordType === 'link_phone')).toHaveLength(0);
  });
  it('confirmation winning against revoke makes the prior generation stale without creating a revoke journal', async () => {
    const c = await proven(), generation = (await status(token(), db, now)).revokeGeneration;
    const racing = race(() => confirm(token(), { challengeId: c.challengeId, requestId: 'demo-winning-confirm' }, second, now));
    await expect(revoke(token(), 'revoke_v1_' + generation + '_' + randomUUID(), racing, now)).rejects.toMatchObject({ status: 409 });
    expect((await status(token(), db, now)).current).not.toBeNull();
    expect((await db.collection('platformWhatsAppLinkChallenges').get()).docs.filter(d => d.data().recordType === 'link_revoke_request')).toHaveLength(0);
  });
  it('the fourth issue loses a CAS race and stored rolling rate survives new handles', async () => {
    await start(); await start(token().uid, 'demo-start-2');
    const racing = race(() => begin(token(), { phoneE164: phone, requestId: 'demo-start-3' }, second, now));
    await expect(begin(token(), { phoneE164: phone, requestId: 'demo-start-4' }, racing, now)).rejects.toMatchObject({ status: 429 });
    await expect(begin(token(), { phoneE164: phone, requestId: 'demo-start-5' }, createCloudflareDatabase(transport), now)).rejects.toMatchObject({ status: 429 });
    const owner = (await db.collection('platformWhatsAppLinks').where('ownerUid', '==', token().uid).get()).docs[0].data(); expect(owner.issues).toHaveLength(3);
  });
  it('fifth proof succeeds and a racing sixth attempt cannot append or change proof', async () => {
    const c = await start(), bad = c.code.replace(/:[^:]+$/, ':' + 'A'.repeat(43));
    for (let i = 0; i < 4; i++) await verify(incoming({ text: bad, eventId: 'event' + i, messageId: 'message' + i, whatsappMessageId: null }), db, now);
    const racing = race(() => verify(incoming({ text: c.code, eventId: 'event4', messageId: 'message4', whatsappMessageId: null }), second, now));
    expect(await verify(incoming({ text: bad, eventId: 'event5', messageId: 'message5', whatsappMessageId: null }), racing, now)).toBe('rejected');
    const saved = (await db.collection('platformWhatsAppLinkChallenges').doc('challenge_' + c.challengeId).get()).data()!; expect(saved.status).toBe('verified'); expect(saved.attempts).toHaveLength(5);
    expect(await verify(incoming({ text: c.code, eventId: 'event4', messageId: 'message4', whatsappMessageId: null }), createCloudflareDatabase(transport), now)).toBe('verified');
  });
  it.each(['revoke', 'withdraw'] as const)('%s winning CAS denies confirmation and leaves no phone claim', async action => {
    const c = await proven(), generation = (await status(token(), db, now)).revokeGeneration;
    const racing = race(() => action === 'revoke' ? revoke(token(), 'revoke_v1_' + generation + '_' + randomUUID(), second, now) : seedConsents(second, token().uid, 2, false));
    await expect(confirm(token(), { challengeId: c.challengeId, requestId: 'demo-confirm' }, racing, now)).rejects.toMatchObject({ status: action === 'revoke' ? 409 : 428 });
    expect((await db.collection('platformWhatsAppLinks').get()).docs.filter(d => d.data().recordType === 'link_phone')).toHaveLength(0);
  });
  it('lost real commit response repeats identical UUID/write set and only the original invocation receives its code', async () => {
    const before = Number((await runtime.db.prepare('SELECT COUNT(*) AS n FROM app_commits').first())?.n);
    let dropped = false; const commits: DataCommand[] = [];
    const ambiguous = createCloudflareDatabase(async command => { if (command.action === 'commit') commits.push(structuredClone(command)); const result = await transport(command); if (command.action === 'commit' && !dropped) { dropped = true; throw new Error('synthetic lost response'); } return result; });
    const input = { phoneE164: phone, requestId: 'demo-lost-begin' }, c = await begin(token(), input, ambiguous, now);
    expect(commits).toHaveLength(2); expect(commits[0]).toEqual(commits[1]);
    expect((await runtime.db.prepare('SELECT COUNT(*) AS n FROM app_commits').first())?.n).toBe(before + 1);
    expect(await verify(incoming({ text: c.code }), second, now)).toBe('verified');
    await expect(begin(token(), input, createCloudflareDatabase(transport), now)).rejects.toMatchObject({ code: 'CHALLENGE_CODE_UNAVAILABLE' });
  });
  it('a late create collision rolls back marker, challenge, request and owner as one unit', async () => {
    await db.collection('users').doc('demo-collision').set({ sentinel: true });
    const broken = createCloudflareDatabase(async command => transport(command.action === 'commit' ? { ...command, writes: [...command.writes, { op: 'create', path: 'users/demo-collision', data: {} }] } : command));
    await expect(begin(token(), { phoneE164: phone, requestId: 'demo-conflict' }, broken, now)).rejects.toMatchObject({ code: 'DATA_EXISTS' });
    expect((await db.collection('platformWhatsAppLinks').get()).size).toBe(0); expect((await db.collection('platformWhatsAppLinkChallenges').get()).size).toBe(0);
    expect((await db.collection('serverSettings').get()).docs.some(d => d.id.startsWith('platform_whatsapp_link_key_'))).toBe(false);
  });
  it('cleanup racing a real confirmation preserves the new owner and all its exact revisions', async () => {
    const old = await proven(); await confirm(token(), { challengeId: old.challengeId, requestId: 'demo-old-confirm' }, db, now);
    const deadline = now + 2_592_000_000, late = deadline - 1000;
    const fresh = await begin(token('demo-second', late), { phoneE164: phone, requestId: 'demo-new-begin' }, second, late);
    await verify(incoming({ text: fresh.code }), second, late);
    const retentionModule = '../cloudflare/src/platform-whatsapp-retention.ts', fixtureModule = '../cloudflare/tests/platform-whatsapp-fixture.mjs';
    const { cleanupPlatformWhatsAppRetention } = await import(retentionModule), { observeDatabase } = await import(fixtureModule);
    let injected = false;
    const env = observeDatabase({ SARIN_DB: runtime.db, SARIN_FILES: runtime.bucket }, async (entries: { sql: string }[], run: () => Promise<unknown>) => {
      if (!injected && entries[0].sql.startsWith('DELETE FROM app_commits')) {
        injected = true; await confirm(token('demo-second', deadline), { challengeId: fresh.challengeId, requestId: 'demo-new-confirm' }, second, deadline);
      }
      return run();
    });
    const result = await cleanupPlatformWhatsAppRetention(env, { now: deadline });
    expect(injected).toBe(true); expect(result.morePending).toBe(false);
    const live = (await status(token('demo-second', deadline), db, deadline)).current!;
    const all = (await db.collection('platformWhatsAppLinks').get()).docs.map(d => d.data());
    expect(all.filter(r => r.recordType === 'link_phone')).toHaveLength(1);
    expect(all.find(r => r.recordType === 'link_phone')).toMatchObject({ linkId: live.linkId, linkRevision: live.revision, expiresAt: deadline + 2_592_000_000 });
    expect(all.find(r => r.recordType === 'link_uid' && r.ownerUid === 'demo-second')).toMatchObject({ currentLinkId: live.linkId, pendingChallengeId: null });
    expect((await status(token(undefined, deadline), db, deadline)).current).toBeNull();
  });
});
