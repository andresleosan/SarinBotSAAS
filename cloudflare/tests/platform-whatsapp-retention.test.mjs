import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanupPlatformWhatsAppRetention } from '../src/platform-whatsapp-retention.ts';
import { isPlatformWhatsAppEventRecord, isPlatformWhatsAppConversationRecord } from '../../shared/platform-whatsapp-records.ts';
import { executeDataCommand } from '../src/data.ts';
import { fixture, now, event, conversation, set, seed, get, read, scope, observeDatabase } from './platform-whatsapp-fixture.mjs';

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

test('executes exactly four ordered selections and conservatively marks a single full lot pending', async context => {
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
  assert.deepEqual(queries, ['platformWhatsAppEvents', 'platformWhatsAppConversations', 'platformWhatsAppEvents', 'platformWhatsAppConversations']);
  assert.deepEqual(warnings, [{ event: 'platform_whatsapp_retention_incomplete', invalidRecords: 0, failedPhases: 1 }]);
  assert.equal((await get(env, 'platformWhatsAppEvents/a')).state, 'body_present');
  assert.equal((await get(env, 'platformWhatsAppConversations/a')).contactContent, null);
  assert.equal((await executeDataCommand(read('platformWhatsAppEvents/a'), env)).revision, 2);
  assert.equal((await env.SARIN_DB.prepare('SELECT COUNT(*) AS n FROM app_commits').first()).n, 2);
});
