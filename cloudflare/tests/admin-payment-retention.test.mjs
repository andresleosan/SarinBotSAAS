import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanupAdminPaymentRetention } from '../src/admin-payment-retention.ts';
import { isAdminPaymentRecord, PAYMENT_RETENTION_MS, PAYMENT_VALID_MS } from '../../shared/admin-payment-actions.ts';
import { isDataPath } from '../../shared/data-protocol.ts';
import { executeDataCommand } from '../src/data.ts';
import { runtimeEnvironment, publicBuildArguments } from '../src/router.ts';
import { fixture, now, seed, get, set, read } from './platform-whatsapp-fixture.mjs';
const id = '11111111-1111-4111-8111-111111111111';
const proposal = (proposalId = id, createdAt = now - PAYMENT_VALID_MS) => ({ version: 1, recordType: 'proposal', id: proposalId, actorUid: 'demo-admin', paymentId: 'demo-payment', action: 'reject', contextFingerprint: 'a'.repeat(64), revision: 1, createdAt, validUntil: createdAt + PAYMENT_VALID_MS, bodyExpiresAt: createdAt + PAYMENT_VALID_MS, expiresAt: createdAt + PAYMENT_RETENTION_MS, state: 'pending', reasonDigest: 'b'.repeat(64), reason: { version: 1, iv: 'A'.repeat(16), tag: 'A'.repeat(22) + '==', data: 'AAAA' }, executedAt: null, confirmDigest: null, effectId: null });
test('strict paths, variants, exact retention and ephemeral bodies reject extra private fields', async t => {
  const env = await fixture(t), valid = proposal();
  assert.equal(isAdminPaymentRecord('adminPaymentActions/' + id, valid), true);
  for (const path of ['arbitrary', 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA', 'request_' + 'a'.repeat(63), id + '\n']) assert.equal(isDataPath('adminPaymentActions/' + path, true), false);
  for (const change of [{ privateImage: 'secret' }, { expiresAt: now }, { validUntil: now + 1 }, { actorUid: '' }, { action: 'approve' }, { state: 'executed' }]) {
    assert.equal(isAdminPaymentRecord('adminPaymentActions/' + id, { ...valid, ...change }), false);
    await assert.rejects(seed(env, [set('adminPaymentActions/' + id, { ...valid, ...change })]), { code: 'DATA_INVALID' });
  }
  await assert.rejects(executeDataCommand({ action: 'read', read: { kind: 'query', path: 'adminPaymentActions', filters: [], order: [], limit: 50 } }, env), { code: 'DATA_INVALID' });
});
test('body equality erases reason; 30 day cleanup deletes only controls and preserves marker and receipt', async t => {
  const env = await fixture(t);
  await seed(env, [set('adminPaymentActions/' + id, proposal()), set('adminPaymentActions/key_marker', { version: 1, recordType: 'key_marker', keyDigest: 'c'.repeat(64) }), set('paymentReceipts/demo-payment', { synthetic: true })]);
  assert.deepEqual(await cleanupAdminPaymentRetention(env, now), { clearedBodies: 1, deletedMetadata: 0, morePending: false, invalidRecords: 0, failedPhases: 0 });
  assert.equal((await get(env, 'adminPaymentActions/' + id)).reason, null);
  assert.equal((await get(env, 'adminPaymentActions/' + id)).state, 'expired');
  const end = proposal().expiresAt;
  assert.equal((await cleanupAdminPaymentRetention(env, end)).deletedMetadata, 1);
  assert.equal(await get(env, 'adminPaymentActions/' + id), undefined);
  assert.ok(await get(env, 'adminPaymentActions/key_marker')); assert.ok(await get(env, 'paymentReceipts/demo-payment'));
  const { revision } = await executeDataCommand(read('adminPaymentActions/key_marker'), env);
  await assert.rejects(executeDataCommand({ action: 'commit', expectedRevision: revision, requestId: crypto.randomUUID(), writes: [{ op: 'delete', path: 'adminPaymentActions/key_marker' }] }, env), { code: 'DATA_INVALID' });
});
test('bounded cleanup reports more than one batch and corrupt pages honestly require repair', async t => {
  const env = await fixture(t);
  await seed(env, Array.from({ length: 51 }, (_, i) => { const value = '00000000-0000-4000-8000-' + i.toString().padStart(12, '0'); return set('adminPaymentActions/' + value, proposal(value)); }));
  assert.equal((await cleanupAdminPaymentRetention(env, now)).morePending, true);
  assert.equal((await cleanupAdminPaymentRetention(env, now)).clearedBodies, 1);
  const corrupt = { ...proposal(), privateSnapshot: 'synthetic-invalid' };
  await env.SARIN_DB.prepare('INSERT INTO app_documents(path,parent,document_id,data,updated_at) VALUES(?,?,?,?,?)').bind('adminPaymentActions/' + id, 'adminPaymentActions', id, JSON.stringify(corrupt), now).run();
  const result = await cleanupAdminPaymentRetention(env, now, 1);
  assert.equal(result.morePending, true); assert.equal(result.invalidRecords, 1); assert.equal(result.clearedBodies, 0);
  assert.deepEqual(await get(env, 'adminPaymentActions/' + id), corrupt);
});
test('optional dedicated key passes only into runtime and is absent by default', () => {
  const configured = { FIREBASE_ADMIN_PROJECT_ID: 'synthetic-project', FIREBASE_ADMIN_CLIENT_EMAIL: 'synthetic@example.test', FIREBASE_ADMIN_PRIVATE_KEY: 'synthetic-key', SUPERADMIN_UID: 'demo-admin', SARIN_TUNNEL_URL: 'https://ia-sarin.alsdevstudio.com/v1/chat/completions', OLLAMA_MAIN_MODEL: 'synthetic-model', CF_ACCESS_CLIENT_ID: 'synthetic-id', CF_ACCESS_CLIENT_SECRET: 'synthetic-secret' };
  assert.equal(runtimeEnvironment(configured).ADMIN_PAYMENT_ACTION_KEY, undefined);
  assert.equal(runtimeEnvironment({ ...configured, ADMIN_PAYMENT_ACTION_KEY: 'dedicated-synthetic-key' }).ADMIN_PAYMENT_ACTION_KEY, 'dedicated-synthetic-key');
  const publicValues = { NEXT_PUBLIC_FIREBASE_API_KEY: 'synthetic-public', NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: 'synthetic.example.test', NEXT_PUBLIC_FIREBASE_PROJECT_ID: 'synthetic-project', NEXT_PUBLIC_FIREBASE_APP_ID: 'synthetic-app' };
  assert.equal(JSON.stringify(publicBuildArguments({ ...publicValues, ADMIN_PAYMENT_ACTION_KEY: 'dedicated-synthetic-key' })).includes('dedicated-synthetic-key'), false);
});
