import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { registerHooks } from 'node:module';
import { hasPotentialPlatformWork } from '../src/platform-whatsapp-wake.ts';
import { cleanupPlatformWorkRetention } from '../src/platform-whatsapp-work-retention.ts';
import { isPlatformJob, isWorkRecordAtPath } from '../../shared/platform-whatsapp-work.ts';
import { fixture, now, scope, event, seed, set, get } from './platform-whatsapp-fixture.mjs';
const epoch = '00000000-0000-4000-8000-000000000001', digest = 'a'.repeat(64);
const platform = 'data:text/javascript,' + encodeURIComponent('export class DurableObject { constructor(ctx, env) { this.ctx = ctx; this.env = env; } } export class WorkerEntrypoint extends DurableObject {}');
const hooks = registerHooks({ resolve(specifier, options, next) {
  if (specifier === 'cloudflare:workers') return { url: platform, shortCircuit: true };
  try { return next(specifier, options); } catch (error) { if (specifier.startsWith('.') && options.parentURL?.includes('@cloudflare')) return next(`${specifier}.js`, options); throw error; }
} });
const { default: worker } = await import('../src/index.ts'); hooks.deregister();
function ready() {
  return { ...scope, recordType: 'job', jobId: 'job_' + digest, epoch, sourceEventId: 'event_' + digest, sourceKind: 'text', kind: 'control', requestFingerprint: digest, conversationId: digest, controlEpoch: epoch, controlRevision: 0, connectionRevision: 7, conversationRevision: null, sourceOccurredAt: now, sourceReceivedAt: now, createdAt: now, customerSentAt: now, windowExpiresAt: now + 86400000, bodyExpiresAt: now + 86400000, expiresAt: now + 2592000000, status: 'ready', nextJobId: null, nextAttemptAt: now, leaseToken: null, leaseClaimedAt: null, leaseExpiresAt: null, processingStartedAt: null, processingDeadlineAt: null, outboxId: null, outputKind: 'none', catalogId: 'identification', catalogVersion: 1, bodyState: 'body_present', content: { version: 1, iv: 'A'.repeat(16), tag: 'A'.repeat(22) + '==', data: 'AAAA' }, authorityKind: 'fixed_notice', noticeId: 'identification', noticeVersion: 1, audioState: 'not_applicable', audioToken: null, audioLeaseToken: null, audioReservationId: null, audioStartedAt: null, audioFinishedAt: null, generationState: 'not_applicable', generationToken: null, generationLeaseToken: null, generationReservationId: null, generationStartedAt: null, generationFinishedAt: null };
}
function flags(env) {
  return { ...env, PLATFORM_WHATSAPP_PROCESSING_ENABLED: 'true', PLATFORM_WHATSAPP_WABA_ID: scope.wabaId, PLATFORM_WHATSAPP_PHONE_E164: scope.phoneE164, PLATFORM_WHATSAPP_PHONE_NUMBER_ID: scope.phoneNumberId, PLATFORM_WHATSAPP_SEND_ENABLED: 'true', PLATFORM_WHATSAPP_SEND_DAILY_BUDGET_MICROS: '100', PLATFORM_WHATSAPP_TARIFF_POLICY: JSON.stringify({ version: 'synthetic-v1', sendEvidence: { version: 'synthetic-v1', currency: 'USD', timezone: 'UTC', category: 'service', destinationScope: 'all_e164', rate: { numerator: 1, denominator: 1 } }, audio: { numerator: 1, denominator: 1 }, generationInput: { numerator: 300, denominator: 1000 }, generationOutput: { numerator: 1200, denominator: 1000 }, send: { numerator: 1, denominator: 1 }, maximumInputTokens: 132096, maximumOutputTokens: 4096 }) };
}
test('Worker wake requires strict source/head/window/scope and permits refreshing stale observation without granting effect authority', async context => {
  const env = flags(await fixture(context)), job = ready(); assert.equal(isPlatformJob(job), true);
  assert.equal(await hasPotentialPlatformWork(env, now), false);
  const head = { ...scope, recordType: 'control_head', conversationId: digest, controlEpoch: epoch, controlRevision: 0, connectionRevision: 7, entryState: 'initial', botAuthorityFingerprint: null, attachedConversationRevision: null, headJobId: job.jobId, tailJobId: job.jobId, currentMenuOutboxId: null, status: 'active', nextAttemptAt: null, receivedAt: now, expiresAt: now + 2592000000 };
  const connection = { ...scope, recordType: 'connection', connectionRevision: 7, providerConnection: 'connected', paused: false, pausedReason: null, updatedAt: now, connectedAt: now, connectedRevision: 7, lastSignedInboundAt: now, lastHumanEchoAt: null, lastDeliveryAt: null, observationStatus: 'failed', observationRevision: null, observedAt: null };
  await seed(env, [set('platformWhatsAppJobs/' + job.jobId, job), set('platformWhatsAppJobs/head_' + digest, head), set('platformWhatsAppEvents/' + job.sourceEventId, event(now, { customerSentAt: now })), set('serverSettings/platform_whatsapp', connection)]);
  assert.equal(await hasPotentialPlatformWork(env, now), true);
  let wakes = 0; context.mock.method(Date, 'now', () => now);
  env.SARIN_APP = { idFromName: name => { assert.equal(name, 'sarin-global-app'); return name; }, get: () => ({ startAndWaitForPorts: async () => { wakes++; } }) };
  await worker.scheduled({}, env); assert.equal(wakes, 1);
  await worker.scheduled({}, { ...env, WHATSAPP_ENABLED: 'true' }); assert.equal(wakes, 2);
  for (const patch of [{ PLATFORM_WHATSAPP_PROCESSING_ENABLED: 'false' }, { SARIN_MAINTENANCE: 'true' }, { PLATFORM_WHATSAPP_SEND_DAILY_BUDGET_MICROS: '0' }, { PLATFORM_WHATSAPP_WABA_ID: '999999' }]) assert.equal(await hasPotentialPlatformWork({ ...env, ...patch }, now), false);
  assert.equal(await hasPotentialPlatformWork(env, now + 86400000), false);
  await seed(env, [set('platformWhatsAppJobs/' + job.jobId, { ...job, extra: 'poison' })]); assert.equal(await hasPotentialPlatformWork(env, now), false);
  await worker.scheduled({}, env); assert.equal(wakes, 2);
  await seed(env, [set('platformWhatsAppJobs/' + job.jobId, { ...job, status: 'leased', processingStartedAt: now, processingDeadlineAt: now + 120000, leaseToken: epoch, leaseClaimedAt: now, leaseExpiresAt: now + 60000, nextAttemptAt: now + 60000 })]);
  assert.equal(await hasPotentialPlatformWork(env, now + 60000), true); assert.equal(await hasPotentialPlatformWork(env, now + 120000), false);
  assert.equal(await hasPotentialPlatformWork({ ...env, SARIN_DB: { prepare() { throw new Error('synthetic failure'); } } }, now), false);
});
test('alias cleanup drains >50 strict records without touching successor and preserves poison as incomplete', async context => {
  const env = await fixture(context), alias = index => ({ ...scope, recordType: 'provider_alias', providerId: 'synthetic-' + index, outboxId: epoch, jobId: 'job_' + digest, epoch, expiresAt: now });
  const path = a => 'platformWhatsAppOutbox/provider_' + createHash('sha256').update(JSON.stringify(['sarin/platform-whatsapp', 1, 'provider-alias', a.wabaId, a.phoneE164, a.phoneNumberId, a.providerId])).digest('hex');
  const aliases = Array.from({ length: 51 }, (_, i) => alias(i)); for (const a of aliases) assert.equal(isWorkRecordAtPath(path(a), a), true);
  const successor = { ...alias('successor'), expiresAt: now + 1 };
  await seed(env, [...aliases.map(a => set(path(a), a)), set(path(successor), successor)]);
  let deleted = 0; for (let i = 0; i < 3; i++) { const result = await cleanupPlatformWorkRetention(env, now, 50); assert.ok(result.deletedMetadata <= 20); deleted += result.deletedMetadata; }
  assert.equal(deleted, 51); assert.deepEqual(await get(env, path(successor)), successor);
  const poison = alias('poison'); await seed(env, [set(path(poison), { ...poison, extra: 'invalid' }), set('platformWhatsAppOutbox/provider_' + 'b'.repeat(64), alias('wrong-digest'))]);
  const result = await cleanupPlatformWorkRetention(env, now, 50); assert.equal(result.morePending, true); assert.equal(result.invalidRecords, 2); assert.equal(result.deletedMetadata, 0);
});
