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
import { isPlatformWhatsAppLinkRecord, isPlatformWhatsAppLinkPhoneRecord, isPlatformWhatsAppLinkChallengeRecord } from '../shared/platform-whatsapp-link-records';

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
  async function durableSnapshot() {
    return {
      documents: (await runtime.db.prepare('SELECT path,parent,document_id,data,updated_at,blob FROM app_documents ORDER BY path').all()).results,
      commits: (await runtime.db.prepare('SELECT request_id,fingerprint,revision,created_at FROM app_commits ORDER BY request_id').all()).results,
      revision: await runtime.db.prepare('SELECT revision FROM app_revision WHERE id=1').first(),
    };
  }
  it.each([false, true])('reclaims an expired phone before cleanup after its former owner begins again (different UID: %j)', async differentUid => {
    const first = await proven(), original = await confirm(token(), { challengeId: first.challengeId, requestId: 'demo-original-confirm' }, db, now);
    const oldPath = db.collection('platformWhatsAppLinks').doc('link_' + original.linkId), old = (await oldPath.get()).data()!;
    const deadline = original.expiresAt, ownerChallenge = await begin(token(undefined, deadline), { phoneE164: differentUid ? '+12025550102' : phone, requestId: 'demo-owner-rebegin' }, db, deadline);
    const afterBegin = (await oldPath.get()).data();
    const claimant = token(differentUid ? 'demo-second' : token().uid, deadline);
    const fresh = differentUid ? await begin(claimant, { phoneE164: phone, requestId: 'demo-claim-expired' }, second, deadline) : ownerChallenge;
    expect(await verify(incoming({ text: fresh.code }), second, deadline)).toBe('verified');
    const provenChallenge = (await db.collection('platformWhatsAppLinkChallenges').doc('challenge_' + fresh.challengeId).get()).data()!;
    const previousOwner = (await db.collection('platformWhatsAppLinks').where('ownerUid', '==', claimant.uid).limit(2).get()).docs[0].data();
    const claimed = await confirm(claimant, { challengeId: fresh.challengeId, requestId: 'demo-expired-confirm' }, second, deadline);
    expect(afterBegin).toEqual({ ...old, status: 'revoked', revision: old.revision + 1 });
    const link = (await db.collection('platformWhatsAppLinks').doc('link_' + claimed.linkId).get()).data()!;
    const owner = (await db.collection('platformWhatsAppLinks').where('ownerUid', '==', claimant.uid).limit(2).get()).docs[0].data();
    const pointer = (await db.collection('platformWhatsAppLinks').doc('phone_' + link.phoneIndex).get()).data();
    expect(owner).toEqual({ ...previousOwner, currentLinkId: claimed.linkId, pendingChallengeId: null, revision: previousOwner.revision + 1,
      revokeGeneration: expect.stringMatching(/^[0-9a-f-]{36}$/), createdAt: deadline, expiresAt: deadline + 2_592_000_000 });
    expect(owner.revokeGeneration).not.toBe(previousOwner.revokeGeneration);
    expect(pointer).toEqual({ version: 1, provider: 'ycloud', purpose: 'platform_support', wabaId: link.wabaId, phoneE164: link.phoneE164, phoneNumberId: link.phoneNumberId,
      recordType: 'link_phone', uidIndex: link.uidIndex, phoneIndex: link.phoneIndex, linkId: claimed.linkId, linkRevision: claimed.revision, createdAt: deadline, expiresAt: deadline + 2_592_000_000 });
    expect(link).toEqual({ version: 1, provider: 'ycloud', purpose: 'platform_support', wabaId: provenChallenge.wabaId, phoneE164: provenChallenge.phoneE164, phoneNumberId: provenChallenge.phoneNumberId,
      recordType: 'link', uidIndex: provenChallenge.uidIndex, phoneIndex: provenChallenge.phoneIndex, status: 'active', revision: 1,
      createdAt: deadline, validUntil: deadline + 2_592_000_000, expiresAt: deadline + 2_592_000_000, confirmedAuthTime: deadline / 1000,
      phoneSuffix: provenChallenge.phoneSuffix, conversationId: provenChallenge.conversationId, account: provenChallenge.account, support: provenChallenge.support });
    expect((await db.collection('platformWhatsAppLinkChallenges').doc('challenge_' + fresh.challengeId).get()).data()).toEqual({ ...provenChallenge, status: 'consumed', resultLinkId: claimed.linkId });
    if (differentUid) expect((await status(token(undefined, deadline), db, deadline)).pending?.challengeId).toBe(ownerChallenge.challengeId);
  });
  it.each(['duplicate', 'unbound_uid'] as const)('refuses an ambiguous or unbound displaced owner (%s) with zero durable/journal changes', async corruption => {
    const first = await proven(); await confirm(token(), { challengeId: first.challengeId, requestId: 'demo-original-confirm' }, db, now);
    const deadline = now + 2_592_000_000, late = deadline - 1000;
    const fresh = await begin(token('demo-second', late), { phoneE164: phone, requestId: 'demo-expired-challenge' }, second, late);
    expect(await verify(incoming({ text: fresh.code }), second, late)).toBe('verified');
    const incumbent = (await db.collection('platformWhatsAppLinks').where('ownerUid', '==', token().uid).limit(2).get()).docs[0];
    if (corruption === 'duplicate') await db.collection('platformWhatsAppLinks').doc('uid_' + 'f'.repeat(64)).set({ ...incumbent.data(), uidIndex: 'f'.repeat(64) });
    else await db.collection('platformWhatsAppLinks').doc(incumbent.id).set({ ...incumbent.data(), ownerUid: 'demo-unbound' });
    const before = await durableSnapshot();
    await expect(confirm(token('demo-second', deadline), { challengeId: fresh.challengeId, requestId: 'demo-corrupt-confirm' }, second, deadline)).rejects.toMatchObject({ status: 503, code: 'LINK_UNAVAILABLE' });
    expect(await durableSnapshot()).toEqual(before);
  });
  it('rolls expired-link release back completely when begin meets a late create collision', async () => {
    const first = await proven(); await confirm(token(), { challengeId: first.challengeId, requestId: 'demo-original-confirm' }, db, now);
    await db.collection('users').doc('demo-expiry-collision').set({ sentinel: true });
    const before = await durableSnapshot(), deadline = now + 2_592_000_000;
    const broken = createCloudflareDatabase(async command => transport(command.action === 'commit' ? { ...command, writes: [...command.writes, { op: 'create', path: 'users/demo-expiry-collision', data: {} }] } : command));
    await expect(begin(token(undefined, deadline), { phoneE164: phone, requestId: 'demo-expiry-collision' }, broken, deadline)).rejects.toMatchObject({ code: 'DATA_EXISTS' });
    expect(await durableSnapshot()).toEqual(before);
  });
  it('rejects expired-link revision overflow before begin changes any D1 documents, journals or revision', async () => {
    const challenge = await proven();
    const original = await confirm(token(), { challengeId: challenge.challengeId, requestId: 'demo-max-revision-confirm' }, db, now);
    const linkRef = db.collection('platformWhatsAppLinks').doc('link_' + original.linkId), savedLink = (await linkRef.get()).data()!;
    const phoneRef = db.collection('platformWhatsAppLinks').doc('phone_' + savedLink.phoneIndex), savedPhone = (await phoneRef.get()).data()!;
    const maximalLink = { ...savedLink, revision: Number.MAX_SAFE_INTEGER }, maximalPhone = { ...savedPhone, linkRevision: Number.MAX_SAFE_INTEGER };
    expect(isPlatformWhatsAppLinkRecord(maximalLink)).toBe(true);
    expect(isPlatformWhatsAppLinkPhoneRecord(maximalPhone)).toBe(true);
    await linkRef.set(maximalLink); await phoneRef.set(maximalPhone);
    const owner = (await db.collection('platformWhatsAppLinks').where('ownerUid', '==', token().uid).limit(2).get()).docs[0].data();
    expect(owner.revision).toBe(2); expect(owner.currentLinkId).toBe(original.linkId);
    const before = await durableSnapshot(), deadline = original.expiresAt;
    await expect(begin(token(undefined, deadline), { phoneE164: phone, requestId: 'demo-max-revision-begin' }, second, deadline)).rejects.toMatchObject({ status: 503, code: 'LINK_UNAVAILABLE' });
    expect(await durableSnapshot()).toEqual(before);
  });
  it('replaces a MAX_SAFE pending challenge without incrementing its revision', async () => {
    const first = await start(), ref = db.collection('platformWhatsAppLinkChallenges').doc('challenge_' + first.challengeId);
    const maximal = { ...(await ref.get()).data()!, revision: Number.MAX_SAFE_INTEGER };
    expect(isPlatformWhatsAppLinkChallengeRecord(maximal)).toBe(true); await ref.set(maximal);
    expect((await status(token(), db, now)).pending?.revision).toBe(Number.MAX_SAFE_INTEGER);
    const replacement = await start(token().uid, 'demo-max-pending-replace');
    const terminal = (await ref.get()).data();
    expect(terminal).toEqual({ ...maximal, status: 'replaced' });
    expect(isPlatformWhatsAppLinkChallengeRecord(terminal)).toBe(true);
    expect((await status(token(), db, now)).pending).toMatchObject({ challengeId: replacement.challengeId, revision: 2 });
  });
  it('rejects current-link revision overflow before revoke changes any D1 documents, journals or revision', async () => {
    const c = await proven(), original = await confirm(token(), { challengeId: c.challengeId, requestId: 'demo-max-revoke-confirm' }, db, now);
    const linkRef = db.collection('platformWhatsAppLinks').doc('link_' + original.linkId), saved = (await linkRef.get()).data()!;
    const phoneRef = db.collection('platformWhatsAppLinks').doc('phone_' + saved.phoneIndex), savedPhone = (await phoneRef.get()).data()!;
    const maximalLink = { ...saved, revision: Number.MAX_SAFE_INTEGER }, maximalPhone = { ...savedPhone, linkRevision: Number.MAX_SAFE_INTEGER };
    expect(isPlatformWhatsAppLinkRecord(maximalLink)).toBe(true); expect(isPlatformWhatsAppLinkPhoneRecord(maximalPhone)).toBe(true);
    await linkRef.set(maximalLink); await phoneRef.set(maximalPhone);
    const owner = (await db.collection('platformWhatsAppLinks').where('ownerUid', '==', token().uid).limit(2).get()).docs[0].data();
    expect(owner.revision).toBe(2);
    expect((await status(token(), second, now)).current?.revision).toBe(Number.MAX_SAFE_INTEGER);
    const before = await durableSnapshot();
    await expect(revoke(token(), 'revoke_v1_' + owner.revokeGeneration + '_' + randomUUID(), second, now)).rejects.toMatchObject({ status: 503, code: 'LINK_UNAVAILABLE' });
    expect(await durableSnapshot()).toEqual(before);
  });
  it.each(['owner', 'incumbent'] as const)('rejects MAX_SAFE link displacement by confirm (%s) with zero D1 document, journal or revision changes', async kind => {
    const c = await proven(), original = await confirm(token(), { challengeId: c.challengeId, requestId: 'demo-max-displace-original' }, db, now);
    const claimantUid = kind === 'owner' ? token().uid : 'demo-second', at = kind === 'owner' ? now : original.expiresAt;
    const issuedAt = kind === 'owner' ? now : at - 1000;
    const fresh = await begin(token(claimantUid, issuedAt), { phoneE164: phone, requestId: 'demo-max-displace-begin' }, second, issuedAt);
    expect(await verify(incoming({ text: fresh.code }), second, issuedAt)).toBe('verified');
    const linkRef = db.collection('platformWhatsAppLinks').doc('link_' + original.linkId), saved = (await linkRef.get()).data()!;
    const phoneRef = db.collection('platformWhatsAppLinks').doc('phone_' + saved.phoneIndex), savedPhone = (await phoneRef.get()).data()!;
    const maximalLink = { ...saved, revision: Number.MAX_SAFE_INTEGER }, maximalPhone = { ...savedPhone, linkRevision: Number.MAX_SAFE_INTEGER };
    expect(isPlatformWhatsAppLinkRecord(maximalLink)).toBe(true); expect(isPlatformWhatsAppLinkPhoneRecord(maximalPhone)).toBe(true);
    await linkRef.set(maximalLink); await phoneRef.set(maximalPhone);
    const owner = (await db.collection('platformWhatsAppLinks').where('ownerUid', '==', token().uid).limit(2).get()).docs[0].data();
    expect(owner.revision).toBe(kind === 'owner' ? 3 : 2);
    expect((await status(token(undefined, issuedAt), db, issuedAt)).current?.revision).toBe(Number.MAX_SAFE_INTEGER);
    const before = await durableSnapshot();
    await expect(confirm(token(claimantUid, at), { challengeId: fresh.challengeId, requestId: 'demo-max-displace-confirm' }, second, at)).rejects.toMatchObject({ status: 503, code: 'LINK_UNAVAILABLE' });
    expect(await durableSnapshot()).toEqual(before);
  });
  it('revokes a MAX_SAFE pending challenge without incrementing its revision', async () => {
    const first = await start(), ref = db.collection('platformWhatsAppLinkChallenges').doc('challenge_' + first.challengeId);
    const maximal = { ...(await ref.get()).data()!, revision: Number.MAX_SAFE_INTEGER };
    expect(isPlatformWhatsAppLinkChallengeRecord(maximal)).toBe(true); await ref.set(maximal);
    const state = await status(token(), db, now);
    expect(state.pending?.revision).toBe(Number.MAX_SAFE_INTEGER);
    await revoke(token(), 'revoke_v1_' + state.revokeGeneration + '_' + randomUUID(), second, now);
    const terminal = (await ref.get()).data();
    expect(terminal).toEqual({ ...maximal, status: 'revoked' });
    expect(isPlatformWhatsAppLinkChallengeRecord(terminal)).toBe(true);
    expect((await status(token(), db, now)).pending).toBeNull();
  });
  it('consumes a MAX_SAFE verified challenge without incrementing its revision', async () => {
    const first = await proven(), ref = db.collection('platformWhatsAppLinkChallenges').doc('challenge_' + first.challengeId);
    const maximal = { ...(await ref.get()).data()!, revision: Number.MAX_SAFE_INTEGER };
    expect(isPlatformWhatsAppLinkChallengeRecord(maximal)).toBe(true); await ref.set(maximal);
    expect((await status(token(), db, now)).pending).toMatchObject({ revision: Number.MAX_SAFE_INTEGER, proof: 'verified' });
    const result = await confirm(token(), { challengeId: first.challengeId, requestId: 'demo-max-consume-confirm' }, second, now);
    const terminal = (await ref.get()).data();
    expect(terminal).toEqual({ ...maximal, status: 'consumed', resultLinkId: result.linkId });
    expect(isPlatformWhatsAppLinkChallengeRecord(terminal)).toBe(true);
    expect((await status(token(), db, now)).current).toMatchObject({ linkId: result.linkId, revision: 1 });
  });
  it('rejects malformed controls with unavailable configuration without any D1 mutation and retains configured deduplication', async () => {
    const c = await start(), pieces = c.code.split(':'), secretBad = [...pieces], macBad = [...pieces];
    secretBad[2] += '='; macBad[3] = '';
    const before = await durableSnapshot(); vi.stubEnv('PLATFORM_WHATSAPP_LINK_HMAC_KEY', undefined);
    for (const text of [secretBad.join(':'), macBad.join(':')]) expect(await verify(incoming({ text }), second, now)).toBe('rejected');
    await expect(verify(incoming({ text: c.code }), second, now)).rejects.toMatchObject({ status: 503 });
    expect(await durableSnapshot()).toEqual(before);
    configureLink(); expect(await verify(incoming({ text: secretBad.join(':') }), second, now)).toBe('rejected');
    const counted = await durableSnapshot();
    expect(await verify(incoming({ text: secretBad.join(':') }), createCloudflareDatabase(transport), now)).toBe('rejected');
    expect(await durableSnapshot()).toEqual(counted);
    expect((await db.collection('platformWhatsAppLinkChallenges').doc('challenge_' + c.challengeId).get()).data()?.attempts).toHaveLength(1);
  });
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
