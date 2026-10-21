import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanupPlatformWhatsAppRetention } from '../src/platform-whatsapp-retention.ts';
import { isPlatformWhatsAppEventRecord, isPlatformWhatsAppConversationRecord } from '../../shared/platform-whatsapp-records.ts';
import { executeDataCommand } from '../src/data.ts';
import { fixture, now, event, conversation, set, seed, get, read, scope, observeDatabase } from './platform-whatsapp-fixture.mjs';

test('erases retained audio at original deadline and deletes exact terminal audio/choice metadata at equality', async context => {
  const env = await fixture(context);
  const audio = { ...event(), kind: 'incoming_audio', customerSentAt: null, ingressDisposition: 'descriptor_retained' };
  const receivedAt = now - 2_592_000_000;
  const denied = { ...event(receivedAt), kind: 'incoming_audio', customerSentAt: null, ingressDisposition: 'control_only', state: 'body_erased', content: null };
  const choice = { ...denied, kind: 'incoming_choice' };
  for (const row of [audio, denied, choice]) assert.equal(isPlatformWhatsAppEventRecord(row), true);
  await seed(env, [set('platformWhatsAppEvents/audio', audio), set('platformWhatsAppEvents/denied', denied), set('platformWhatsAppEvents/choice', choice)]);
  assert.deepEqual(await cleanupPlatformWhatsAppRetention(env, { now }), { clearedBodies: 1, deletedMetadata: 2, morePending: false });
  assert.deepEqual(await get(env, 'platformWhatsAppEvents/audio'), { ...audio, state: 'body_erased', content: null });
  assert.equal(await get(env, 'platformWhatsAppEvents/denied'), undefined); assert.equal(await get(env, 'platformWhatsAppEvents/choice'), undefined);
});

test('retains impossible choice ciphertext and counts malformed new variants without exposing fields', async context => {
  const env = await fixture(context), invalid = { ...event(), kind: 'incoming_choice', customerSentAt: null, ingressDisposition: 'descriptor_retained' };
  await seed(env, [set('platformWhatsAppEvents/invalid-choice', invalid)]);
  const warnings = []; context.mock.method(console, 'warn', value => warnings.push(value));
  assert.deepEqual(await cleanupPlatformWhatsAppRetention(env, { now }), { clearedBodies: 0, deletedMetadata: 0, morePending: true });
  assert.deepEqual(warnings, [{ event: 'platform_whatsapp_retention_incomplete', invalidRecords: 1, failedPhases: 0 }]);
  assert.deepEqual(await get(env, 'platformWhatsAppEvents/invalid-choice'), invalid);
});

test('bounds retained audio cleanup across two batches and replays an ambiguous original batch', async context => {
  const env = await fixture(context);
  const audio = { ...event(), kind: 'incoming_audio', customerSentAt: null, ingressDisposition: 'descriptor_retained' };
  await seed(env, Array.from({ length: 51 }, (_, index) => set('platformWhatsAppEvents/audio_' + index.toString().padStart(2, '0'), audio)));
  const database = env.SARIN_DB; let batches = 0, hideJournal = false;
  const ambiguous = { ...env, SARIN_DB: {
    prepare(sql) {
      if (hideJournal && sql.startsWith('SELECT fingerprint')) { hideJournal = false; return { bind() { return { first: async () => { throw new Error('synthetic journal response lost'); } }; } }; }
      return database.prepare(sql);
    },
    batch: async statements => { const result = await database.batch(statements); if (++batches === 3) { hideJournal = true; throw new Error('synthetic audio batch response lost'); } return result; },
  } };
  assert.deepEqual(await cleanupPlatformWhatsAppRetention(ambiguous, { now }), { clearedBodies: 50, deletedMetadata: 0, morePending: true });
  assert.equal((await get(env, 'platformWhatsAppEvents/audio_50')).state, 'body_present');
  assert.equal((await database.prepare('SELECT COUNT(*) AS n FROM app_commits').first()).n, 2);
  assert.deepEqual(await cleanupPlatformWhatsAppRetention(env, { now }), { clearedBodies: 1, deletedMetadata: 0, morePending: false });
  assert.deepEqual(await get(env, 'platformWhatsAppEvents/audio_50'), { ...audio, state: 'body_erased', content: null });
});

test('removes expired link request metadata at equality without erasing the persistent marker', async context => {
  const env = await fixture(context);
  const path = 'platformWhatsAppLinkChallenges/request_' + 'a'.repeat(64);
  const record = { ...scope, recordType: 'link_request', createdAt: now - 2_592_000_000, expiresAt: now,
    uidIndex: 'b'.repeat(64), requestDigest: 'a'.repeat(64), fingerprint: 'c'.repeat(64), action: 'begin',
    challengeId: '00000000-0000-4000-8000-000000000001', linkId: null, resultRevision: null };
  // Raw fixture insertion isolates cleanup omission from the independently tested allowlist omission.
  await env.SARIN_DB.prepare('INSERT INTO app_documents(path,parent,document_id,data,updated_at) VALUES(?,?,?,?,?)')
    .bind(path, 'platformWhatsAppLinkChallenges', path.split('/')[1], JSON.stringify(record), now).run();
  const markerPath = 'serverSettings/platform_whatsapp_link_key_' + 'd'.repeat(64);
  const marker = { version: 1, scopeDigest: 'd'.repeat(64), keyFingerprint: 'e'.repeat(64) };
  await seed(env, [set(markerPath, marker)]);
  assert.deepEqual(await cleanupPlatformWhatsAppRetention(env, { now }), { clearedBodies: 0, deletedMetadata: 1, morePending: false });
  assert.equal(await env.SARIN_DB.prepare('SELECT path FROM app_documents WHERE path=?').bind(path).first(), null);
  assert.deepEqual(await get(env, markerPath), marker);
});

test('erases both bodies at equality across scopes, preserving metadata, TTL and record revisions', async context => {
  const env = await fixture(context);
  const originalEvent = event();
  const originalConversation = conversation({ wabaId: '999999', phoneNumberId: '888888', phoneE164: '+573009999999' });
  assert.equal(isPlatformWhatsAppEventRecord(originalEvent), true);
  assert.equal(isPlatformWhatsAppConversationRecord(originalConversation), true);
  await seed(env, [set('platformWhatsAppEvents/a', originalEvent), set('platformWhatsAppConversations/b', originalConversation), set('serverSettings/platform_whatsapp', { retained: true }), set('businesses/shop', { retained: true })]);
  assert.deepEqual(await cleanupPlatformWhatsAppRetention(env, { now }), { clearedBodies: 2, deletedMetadata: 0, morePending: false });
  assert.deepEqual(await get(env, 'platformWhatsAppEvents/a'), { ...originalEvent, state: 'body_erased', content: null });
  assert.deepEqual(await get(env, 'platformWhatsAppConversations/b'), { ...originalConversation, state: 'body_erased', contactContent: null });
  assert.deepEqual(await get(env, 'serverSettings/platform_whatsapp'), { retained: true });
  assert.deepEqual(await get(env, 'businesses/shop'), { retained: true });
  assert.equal((await executeDataCommand(read('businesses/shop'), env)).revision, 3);
  const stored = await env.SARIN_DB.prepare('SELECT data,blob FROM app_documents WHERE path=?').bind('platformWhatsAppEvents/a').first();
  assert.equal(JSON.parse(stored.data).recordType, 'event'); assert.equal(stored.blob, null);
});

test('removes all stored-event metadata shapes and a conversation at expiry after body erasure', async context => {
  const env = await fixture(context);
  const receivedAt = now - 2_592_000_000;
  const metadata = { ...scope, receivedAt, expiresAt: now, conversationId: 'a'.repeat(64), fingerprint: 'a'.repeat(64) };
  const { conversationId: _unused, ...controlBase } = metadata;
  await seed(env, [set('platformWhatsAppEvents/event', event(receivedAt)),
    set('platformWhatsAppEvents/alias', { ...metadata, recordType: 'alias', state: 'metadata', canonicalEventId: 'event_' + 'a'.repeat(64), bodyExpiresAt: now }),
    set('platformWhatsAppEvents/conflict', { ...metadata, recordType: 'conflict', state: 'metadata' }),
    set('platformWhatsAppEvents/control', { ...controlBase, recordType: 'control', state: 'connection_control', updatedAt: receivedAt, actorUid: 'synthetic-actor', action: 'pause', targetId: 'platform_whatsapp', resultRevision: 2 }),
    set('platformWhatsAppConversations/a', conversation({ expiresAt: now }))]);
  assert.deepEqual(await cleanupPlatformWhatsAppRetention(env, { now }), { clearedBodies: 2, deletedMetadata: 5, morePending: false });
  assert.equal((await env.SARIN_DB.prepare('SELECT COUNT(*) AS n FROM app_documents').first()).n, 0);
  assert.equal((await executeDataCommand(read('platformWhatsAppEvents/event'), env)).revision, 5);
});

test('selects ascending expiry with a bounded full lot and leaves future bodies unchanged', async context => {
  const env = await fixture(context);
  await seed(env, [set('platformWhatsAppEvents/a', event()), set('platformWhatsAppEvents/z', event(now - 86_400_001)), set('platformWhatsAppEvents/future', event(now - 86_399_999))]);
  assert.deepEqual(await cleanupPlatformWhatsAppRetention(env, { now, batchLimit: 1 }), { clearedBodies: 1, deletedMetadata: 0, morePending: true });
  assert.equal((await get(env, 'platformWhatsAppEvents/z')).content, null);
  assert.equal((await get(env, 'platformWhatsAppEvents/a')).state, 'body_present');
  assert.equal((await get(env, 'platformWhatsAppEvents/future')).state, 'body_present');
});

test('keeps invalid ordered envelopes unchanged and reports only aggregate counts without draining', async context => {
  const env = await fixture(context);
  const invalid = event(now - 86_400_001, { content: { version: 1, iv: 'corrupt-private-envelope', tag: 'private-tag', data: 'private-data' } });
  await seed(env, [set('platformWhatsAppEvents/a', invalid), set('platformWhatsAppEvents/b', event())]);
  const warnings = []; context.mock.method(console, 'warn', value => warnings.push(value));
  assert.deepEqual(await cleanupPlatformWhatsAppRetention(env, { now, batchLimit: 1 }), { clearedBodies: 0, deletedMetadata: 0, morePending: true });
  assert.deepEqual(warnings, [{ event: 'platform_whatsapp_retention_incomplete', invalidRecords: 1, failedPhases: 0 }]);
  assert.deepEqual(await get(env, 'platformWhatsAppEvents/a'), invalid);
  assert.equal((await get(env, 'platformWhatsAppEvents/b')).state, 'body_present');
  assert.equal((await executeDataCommand(read('platformWhatsAppEvents/a'), env)).revision, 1);
});

test('rejects invalid time and batch options before storage access', async () => {
  const env = new Proxy({}, { get() { assert.fail('Invalid options touched storage'); } });
  for (const options of [{ now: -1 }, { now: 8_640_000_000_000_001 }, { now: 1.5 }, { now: NaN }, { now: Infinity }, { now: '0' }, { batchLimit: 0 }, { batchLimit: 51 }, { batchLimit: 1.5 }, { batchLimit: '1' }]) {
    await assert.rejects(cleanupPlatformWhatsAppRetention(env, options), { message: 'Invalid retention options' });
  }
});

test('accepts time endpoints, nullish defaults and unknown option keys without writes on empty lots', async context => {
  const env = await fixture(context);
  for (const options of [{ now: 0, batchLimit: 1 }, { now: 8_640_000_000_000_000, batchLimit: 50 }, { now: null, batchLimit: null, unknown: true }, {}]) {
    assert.deepEqual(await cleanupPlatformWhatsAppRetention(env, options), { clearedBodies: 0, deletedMetadata: 0, morePending: false });
  }
  assert.equal((await executeDataCommand(read('platformWhatsAppEvents/a'), env)).revision, 0);
});

test('continues later phases after three read failures and hides private error details', async context => {
  const env = await fixture(context);
  await seed(env, [set('platformWhatsAppConversations/a', conversation())]);
  let reads = 0;
  const database = env.SARIN_DB;
  const broken = { ...env, SARIN_DB: { prepare: database.prepare.bind(database), batch: async statements => {
    if (++reads <= 3) throw new Error('private-error contact ciphertext');
    return database.batch(statements);
  } } };
  const warnings = []; context.mock.method(console, 'warn', value => warnings.push(value));
  assert.deepEqual(await cleanupPlatformWhatsAppRetention(broken, { now }), { clearedBodies: 1, deletedMetadata: 0, morePending: true });
  assert.deepEqual(warnings, [{ event: 'platform_whatsapp_retention_incomplete', invalidRecords: 0, failedPhases: 1 }]);
  assert.equal((await get(env, 'platformWhatsAppConversations/a')).contactContent, null);
});

test('rereads after a real CAS conflict and preserves a concurrent record revision', async context => {
  const env = await fixture(context);
  await seed(env, [set('platformWhatsAppConversations/a', conversation())]);
  const database = env.SARIN_DB;
  let batches = 0;
  const racing = { ...env, SARIN_DB: { prepare: database.prepare.bind(database), batch: async statements => {
    // Event read, conversation read, prior-record read, then retention commit.
    if (++batches === 4) await seed(env, [set('platformWhatsAppConversations/a', conversation({ revision: 10, mode: 'human', updatedAt: 2_999_999_999 }))]);
    return database.batch(statements);
  } } };
  assert.deepEqual(await cleanupPlatformWhatsAppRetention(racing, { now }), { clearedBodies: 1, deletedMetadata: 0, morePending: false });
  const stored = await get(env, 'platformWhatsAppConversations/a');
  assert.equal(stored.revision, 10); assert.equal(stored.mode, 'human'); assert.equal(stored.updatedAt, 2_999_999_999); assert.equal(stored.contactContent, null);
  assert.equal((await executeDataCommand(read('platformWhatsAppConversations/a'), env)).revision, 3);
  assert.equal((await database.prepare('SELECT COUNT(*) AS n FROM app_commits').first()).n, 3);
});

test('replays an ambiguous committed batch with the same UUID and fingerprint after journal recovery fails', async context => {
  const env = await fixture(context);
  await seed(env, [set('platformWhatsAppEvents/a', event())]);
  const database = env.SARIN_DB;
  let batches = 0; let hideJournal = false;
  const ambiguous = { ...env, SARIN_DB: {
    prepare(sql) {
      const statement = database.prepare(sql);
      if (hideJournal && sql.startsWith('SELECT fingerprint')) {
        hideJournal = false;
        return { bind() { return { first: async () => { throw new Error('private lost journal response'); } }; } };
      }
      return statement;
    },
    batch: async statements => {
      const result = await database.batch(statements);
      if (++batches === 3) { hideJournal = true; throw new Error('private lost commit response'); }
      return result;
    },
  } };
  assert.deepEqual(await cleanupPlatformWhatsAppRetention(ambiguous, { now }), { clearedBodies: 1, deletedMetadata: 0, morePending: false });
  assert.equal((await executeDataCommand(read('platformWhatsAppEvents/a'), env)).revision, 2);
  assert.equal((await database.prepare('SELECT COUNT(*) AS n FROM app_commits').first()).n, 2);
  assert.equal((await get(env, 'platformWhatsAppEvents/a')).content, null);
});

test('bounds each of four phases to fifty confirmed writes and leaves a backlog', async context => {
  const env = await fixture(context);
  const receivedAt = now - 2_592_000_000;
  for (const collection of ['platformWhatsAppEvents', 'platformWhatsAppConversations']) {
    await seed(env, Array.from({ length: 51 }, (_, i) => set(`${collection}/row_${i.toString().padStart(2, '0')}`, collection.endsWith('Events') ? event(receivedAt) : conversation({ expiresAt: now }))));
  }
  assert.deepEqual(await cleanupPlatformWhatsAppRetention(env, { now }), { clearedBodies: 100, deletedMetadata: 100, morePending: true });
  assert.equal((await env.SARIN_DB.prepare('SELECT COUNT(*) AS n FROM app_documents').first()).n, 2);
  assert.equal((await executeDataCommand(read('platformWhatsAppEvents/row_50'), env)).revision, 6);
  assert.equal((await get(env, 'platformWhatsAppEvents/row_50')).state, 'body_present');
});

test('executes original erasure phases before bounded link control cleanup and marks a single full lot pending', async context => {
  const env = await fixture(context);
  await seed(env, [set('platformWhatsAppEvents/a', event())]);
  const queries = [];
  const observed = observeDatabase(env, async (entries, run) => {
    if (entries[0].sql === 'SELECT revision FROM app_revision WHERE id=1') queries.push(entries[1]);
    return run();
  });
  assert.deepEqual(await cleanupPlatformWhatsAppRetention(observed, { now, batchLimit: 1 }), { clearedBodies: 1, deletedMetadata: 0, morePending: true });
  assert.deepEqual(queries.map(({ values }) => values), [
    ['platformWhatsAppEvents', 'body_present', now, 1], ['platformWhatsAppConversations', 'body_present', now, 1],
    ['platformWhatsAppEvents', now, 1], ['platformWhatsAppConversations', now, 1],
    ['platformWhatsAppLinkChallenges', now, 1], ['platformWhatsAppLinks', now, 1],
  ]);
  assert.match(queries[0].sql, /ORDER BY json_extract\(data,'\$\.bodyExpiresAt'\) ASC,path ASC LIMIT \?/);
  assert.match(queries[2].sql, /ORDER BY json_extract\(data,'\$\.expiresAt'\) ASC,path ASC LIMIT \?/);
  assert.equal((await get(env, 'platformWhatsAppEvents/a')).content, null);
});

test('preserves invalid expired event and conversation rows in both phases with aggregate counts', async context => {
  const env = await fixture(context);
  const invalidEvent = event(now - 2_592_000_000, { content: { private: 'corrupt ciphertext' } });
  const invalidConversation = conversation({ expiresAt: now, purpose: 'different-purpose' });
  await seed(env, [set('platformWhatsAppEvents/a', invalidEvent), set('platformWhatsAppConversations/a', invalidConversation)]);
  const warnings = []; context.mock.method(console, 'warn', value => warnings.push(value));
  assert.deepEqual(await cleanupPlatformWhatsAppRetention(env, { now }), { clearedBodies: 0, deletedMetadata: 0, morePending: true });
  assert.deepEqual(warnings, [{ event: 'platform_whatsapp_retention_incomplete', invalidRecords: 4, failedPhases: 0 }]);
  assert.deepEqual(await get(env, 'platformWhatsAppEvents/a'), invalidEvent);
  assert.deepEqual(await get(env, 'platformWhatsAppConversations/a'), invalidConversation);
  assert.equal((await executeDataCommand(read('platformWhatsAppEvents/a'), env)).revision, 1);
});

test('retries a rolled-back commit three times with the same UUID and then completes later phases', async context => {
  const env = await fixture(context);
  await seed(env, [set('platformWhatsAppEvents/a', event()), set('platformWhatsAppConversations/a', conversation())]);
  const attempts = []; const queries = [];
  const failing = observeDatabase(env, async (entries, run, database) => {
    if (entries[0].sql === 'SELECT revision FROM app_revision WHERE id=1') queries.push(entries[1].values[0]);
    if (entries[0].sql.startsWith('DELETE FROM app_commits') && attempts.length < 3) {
      attempts.push(entries[1].values.slice(0, 3));
      // Fail after journal/revision/document statements, proving SQLite rollback.
      return database.batch([...entries.map(entry => entry.statement), database.prepare('INSERT INTO app_revision(id,revision) VALUES(1,999)')]);
    }
    return run();
  });
  const warnings = []; context.mock.method(console, 'warn', value => warnings.push(value));
  assert.deepEqual(await cleanupPlatformWhatsAppRetention(failing, { now }), { clearedBodies: 1, deletedMetadata: 0, morePending: true });
  assert.equal(attempts.length, 3);
  assert.deepEqual(attempts[1], attempts[0]); assert.deepEqual(attempts[2], attempts[0]);
  assert.deepEqual(queries, ['platformWhatsAppEvents', 'platformWhatsAppConversations', 'platformWhatsAppEvents', 'platformWhatsAppConversations', 'platformWhatsAppLinkChallenges', 'platformWhatsAppLinks']);
  assert.deepEqual(warnings, [{ event: 'platform_whatsapp_retention_incomplete', invalidRecords: 0, failedPhases: 1 }]);
  assert.equal((await get(env, 'platformWhatsAppEvents/a')).state, 'body_present');
  assert.equal((await get(env, 'platformWhatsAppConversations/a')).contactContent, null);
  assert.equal((await executeDataCommand(read('platformWhatsAppEvents/a'), env)).revision, 2);
  assert.equal((await env.SARIN_DB.prepare('SELECT COUNT(*) AS n FROM app_commits').first()).n, 2);
});

test('drains more than one bounded batch of link requests and retains malformed rows with count-only incomplete evidence', async context => {
  const env = await fixture(context);
  const data = { ...scope, recordType: 'link_request', createdAt: now - 2_592_000_000, expiresAt: now,
    uidIndex: 'b'.repeat(64), requestDigest: 'a'.repeat(64), fingerprint: 'c'.repeat(64), action: 'begin',
    challengeId: '00000000-0000-4000-8000-000000000001', linkId: null, resultRevision: null };
  await seed(env, Array.from({ length: 26 }, (_, i) => { const digest = i.toString(16).padStart(64, '0'); return set('platformWhatsAppLinkChallenges/request_' + digest, { ...data, requestDigest: digest }); }));
  const first = await cleanupPlatformWhatsAppRetention(env, { now }); assert.equal(first.morePending, true); assert.equal(first.deletedMetadata, 25);
  assert.equal((await cleanupPlatformWhatsAppRetention(env, { now })).deletedMetadata, 1);
  const corruptPath = 'platformWhatsAppLinkChallenges/request_' + 'e'.repeat(64);
  await seed(env, [set(corruptPath, { ...data, requestDigest: 'e'.repeat(64), secret: 'synthetic-private' })]);
  const warnings = []; context.mock.method(console, 'warn', v => warnings.push(v));
  assert.equal((await cleanupPlatformWhatsAppRetention(env, { now })).morePending, true);
  assert.deepEqual(warnings, [{ event: 'platform_whatsapp_retention_incomplete', invalidRecords: 1, failedPhases: 0 }]);
  assert.equal((await get(env, corruptPath)).secret, 'synthetic-private');
});

test('expired old link cleanup conditionally releases its UID but preserves a newer scoped phone owner', async context => {
  const env = await fixture(context), oldId = '00000000-0000-4000-8000-000000000001', newId = '00000000-0000-4000-8000-000000000002';
  const a = 'a'.repeat(64), b = 'b'.repeat(64), p = 'c'.repeat(64), anchor = { revision: 1, fingerprint: a, receiptId: 'demo_receipt' };
  const old = { ...scope, recordType: 'link', createdAt: now - 2_592_000_000, expiresAt: now, validUntil: now, uidIndex: a, phoneIndex: p, revision: 1, status: 'active', phoneSuffix: '0101', conversationId: a, account: anchor, support: anchor, confirmedAuthTime: (now - 2_592_000_000) / 1000 };
  const fresh = { ...old, createdAt: now, expiresAt: now + 2_592_000_000, validUntil: now + 2_592_000_000, uidIndex: b, confirmedAuthTime: now / 1000 };
  const owner = (uidIndex, currentLinkId, link) => ({ ...scope, recordType: 'link_uid', ownerUid: 'demo-' + uidIndex[0], uidIndex, revision: 1, revokeGeneration: newId, currentLinkId, pendingChallengeId: null, issues: [], createdAt: link.createdAt, expiresAt: link.expiresAt });
  const phoneRow = { ...scope, recordType: 'link_phone', uidIndex: b, phoneIndex: p, linkId: newId, linkRevision: 1, createdAt: now, expiresAt: fresh.expiresAt };
  await seed(env, [set('platformWhatsAppLinks/link_' + oldId, old), set('platformWhatsAppLinks/link_' + newId, fresh), set('platformWhatsAppLinks/uid_' + a, owner(a, oldId, old)), set('platformWhatsAppLinks/uid_' + b, owner(b, newId, fresh)), set('platformWhatsAppLinks/phone_' + p, phoneRow)]);
  const result = await cleanupPlatformWhatsAppRetention(env, { now }); assert.equal(result.morePending, false);
  assert.equal(await get(env, 'platformWhatsAppLinks/link_' + oldId), undefined); assert.equal(await get(env, 'platformWhatsAppLinks/uid_' + a), undefined);
  assert.deepEqual(await get(env, 'platformWhatsAppLinks/phone_' + p), phoneRow); assert.deepEqual(await get(env, 'platformWhatsAppLinks/link_' + newId), fresh);
});

test('retains corrupt expired ownership relationships without deleting guessed link or UID records', async context => {
  const env = await fixture(context), id = '00000000-0000-4000-8000-000000000001', a = 'a'.repeat(64), p = 'b'.repeat(64);
  const anchor = { revision: 1, fingerprint: a, receiptId: 'demo_receipt' }, createdAt = now - 2_592_000_000;
  const link = { ...scope, recordType: 'link', createdAt, expiresAt: now, validUntil: now, uidIndex: a, phoneIndex: p, revision: 1, status: 'active', phoneSuffix: '0101', conversationId: a, account: anchor, support: anchor, confirmedAuthTime: createdAt / 1000 };
  const owner = { ...scope, recordType: 'link_uid', ownerUid: 'demo-a', uidIndex: a, revision: 1, revokeGeneration: id, currentLinkId: id, pendingChallengeId: null, issues: [], createdAt, expiresAt: now };
  const corrupt = { ...scope, recordType: 'link_phone', uidIndex: a, phoneIndex: p, linkId: id, linkRevision: 2, createdAt, expiresAt: now };
  const rows = [set('platformWhatsAppLinks/link_' + id, link), set('platformWhatsAppLinks/uid_' + a, owner), set('platformWhatsAppLinks/phone_' + p, corrupt)];
  await seed(env, rows); const warnings = []; context.mock.method(console, 'warn', value => warnings.push(value));
  const result = await cleanupPlatformWhatsAppRetention(env, { now });
  assert.equal(result.morePending, true); assert.equal(result.deletedMetadata, 0);
  for (const row of rows) assert.deepEqual(await get(env, row.path), row.data);
  assert.ok(warnings[0].invalidRecords > 0);
});
