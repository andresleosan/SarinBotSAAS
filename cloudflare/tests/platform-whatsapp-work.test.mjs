import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isPlatformJob, isControlHead, isWorkRecordAtPath, workText } from '../../shared/platform-whatsapp-work.ts';
import { parsePlatformWorkPolicy, platformCost } from '../../shared/platform-whatsapp-policy.ts';
import { cleanupPlatformWorkRetention } from '../src/platform-whatsapp-work-retention.ts';
import { preparePlatformAudio, startPlatformAudio } from '../src/platform-whatsapp-work-stages.ts';
import { fixture, now, scope, seed, set, get } from './platform-whatsapp-fixture.mjs';

const epoch = '00000000-0000-4000-8000-000000000001', digest = 'a'.repeat(64), sourceTime = now - 86_400_000;
function job(index = 0, received = sourceTime) {
  return { ...scope, recordType: 'job', jobId: 'job_' + index.toString(16).padStart(64, '0'), epoch, sourceEventId: 'event_' + digest, sourceKind: 'text', kind: 'control', requestFingerprint: digest, conversationId: digest, controlEpoch: epoch, controlRevision: 0, connectionRevision: 0, conversationRevision: null,
    sourceOccurredAt: received, sourceReceivedAt: received, createdAt: received, customerSentAt: received, windowExpiresAt: received + 86_400_000, bodyExpiresAt: received + 86_400_000, expiresAt: received + 2_592_000_000,
    status: 'ready', nextJobId: null, nextAttemptAt: received, leaseToken: null, leaseClaimedAt: null, leaseExpiresAt: null, processingStartedAt: null, processingDeadlineAt: null, outboxId: null, outputKind: 'none', catalogId: 'identification', catalogVersion: 1,
    bodyState: 'body_present', content: { version: 1, iv: 'A'.repeat(16), tag: 'A'.repeat(22) + '==', data: 'AAAA' }, authorityKind: 'fixed_notice', noticeId: 'identification', noticeVersion: 1,
    audioState: 'not_applicable', audioToken: null, audioLeaseToken: null, audioReservationId: null, audioStartedAt: null, audioFinishedAt: null, generationState: 'not_applicable', generationToken: null, generationLeaseToken: null, generationReservationId: null, generationStartedAt: null, generationFinishedAt: null };
}
const path = j => 'platformWhatsAppJobs/' + j.jobId;
test('native Worker uses the same closed work guards and conservative Unicode limits', () => {
  const j = job(); assert.equal(isPlatformJob(j), true); assert.equal(isWorkRecordAtPath(path(j), j), true);
  assert.equal(isWorkRecordAtPath(path(job(1)), j), false);
  for (const change of [{ extra: true }, { bodyExpiresAt: j.bodyExpiresAt + 1 }, { epoch: 'invalid' }, { uid: 'fake-notice-user' }, { nextJobId: j.jobId }, { leaseToken: epoch }]) assert.equal(isPlatformJob({ ...j, ...change }), false);
  assert.equal(workText('😀'.repeat(512), 'reply'), true); assert.equal(workText('😀'.repeat(513), 'reply'), false); assert.equal(workText('\ud800', 'reply'), false);
  assert.equal(parsePlatformWorkPolicy({}), null); assert.equal(platformCost([{ units: 1, rate: { numerator: 1, denominator: 2 } }, { units: 1, rate: { numerator: 1, denominator: 2 } }]), 2);
});
test('cleans more than fifty work bodies in bounded transactions without extending metadata', async context => {
  const env = await fixture(context), records = Array.from({ length: 51 }, (_, i) => job(i));
  await seed(env, records.map(j => set(path(j), j)));
  let changed = 0;
  for (let i = 0; i < 3; i++) { const result = await cleanupPlatformWorkRetention(env, now, 50); assert.ok(result.clearedBodies <= 20); changed += result.clearedBodies; }
  assert.equal(changed, 51);
  for (const j of records) assert.deepEqual(await get(env, path(j)), { ...j, bodyState: 'body_erased', content: null });
  assert.equal((await cleanupPlatformWorkRetention(env, now, 50)).morePending, false);
});
test('retains a poison page and honestly reports incomplete instead of deleting unchecked metadata', async context => {
  const env = await fixture(context);
  await seed(env, Array.from({ length: 50 }, (_, i) => set(path(job(i)), { ...job(i), extra: 'invalid' })));
  const result = await cleanupPlatformWorkRetention(env, now, 50);
  assert.equal(result.clearedBodies, 0); assert.equal(result.morePending, true); assert.equal(result.invalidRecords, 50);
  assert.equal((await get(env, path(job(0)))).extra, 'invalid');
});
test('preserves a newer current head while deleting an old expired epoch', async context => {
  const env = await fixture(context), old = { ...job(1, now - 2_592_000_000), bodyState: 'body_erased', content: null, status: 'cancelled', nextAttemptAt: null };
  const next = job(2, now), head = { ...scope, recordType: 'control_head', conversationId: digest, controlEpoch: '00000000-0000-4000-8000-000000000002', controlRevision: 3, connectionRevision: 0, entryState: 'initial', botAuthorityFingerprint: null, attachedConversationRevision: null, headJobId: next.jobId, tailJobId: next.jobId, currentMenuOutboxId: null, status: 'active', nextAttemptAt: null, receivedAt: now, expiresAt: now + 2_592_000_000 };
  assert.equal(isControlHead(head), true); await seed(env, [set(path(old), old), set(path(next), next), set('platformWhatsAppJobs/head_' + digest, head)]);
  await cleanupPlatformWorkRetention(env, now, 50);
  assert.equal(await get(env, path(old)), undefined); assert.deepEqual(await get(env, 'platformWhatsAppJobs/head_' + digest), head); assert.deepEqual(await get(env, path(next)), next);
});
test('replays an identical lost cleanup commit without releasing or rewriting budget counters', async context => {
  const env = await fixture(context), j = job(); await seed(env, [set(path(j), j)]);
  const database = env.SARIN_DB; let batches = 0, hide = false;
  const ambiguous = { ...env, SARIN_DB: { prepare(sql) { if (hide && sql.startsWith('SELECT fingerprint')) { hide = false; return { bind() { return { first: async () => { throw new Error('synthetic lost journal'); } }; } }; } return database.prepare(sql); }, batch: async statements => { const result = await database.batch(statements); if (++batches === 3) { hide = true; throw new Error('synthetic lost cleanup'); } return result; } } };
  const result = await cleanupPlatformWorkRetention(ambiguous, now, 50); assert.equal(result.clearedBodies, 1); assert.equal(result.failedPhases, 0); assert.equal((await get(env, path(j))).bodyState, 'body_erased');
  assert.equal((await database.prepare('SELECT COUNT(*) AS n FROM app_commits').first()).n, 2);
});
test('unprepared/missing audio attempts have no download or inference capability', async context => {
  const env = await fixture(context), lease = { jobId: job().jobId, epoch, token: epoch };
  assert.equal(await preparePlatformAudio(lease, env, now), null); assert.equal(await startPlatformAudio(lease, epoch, env, now), false);
  assert.equal((await env.SARIN_DB.prepare('SELECT COUNT(*) AS n FROM app_commits').first()).n, 0);
});
