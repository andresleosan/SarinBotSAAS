import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Database } from '@/lib/storage/types';
const firebase = vi.hoisted(() => ({ db: null as Database | null, getUser: vi.fn() }));
vi.mock('@/lib/firebase/admin', () => ({ getAdminDb: () => { if (!firebase.db) throw new Error('Default backend forbidden'); return firebase.db; }, getAdminAuth: () => firebase }));
import { createDataTestRuntime } from '../cloudflare/tests/data-runtime.mjs';
import { createCloudflareDatabase, StorageError, type DataTransport } from '@/lib/storage/database';
import { createSupportConversation, appendSupportMessage, readSupportMessages } from '@/lib/server/platform-support';
import { seedConsents } from './platform-whatsapp-link-fixtures';
import { now } from './platform-whatsapp-test-fixtures';
import { cleanupPlatformWhatsAppRetention, cleanupPlatformSupportRetention, observeDatabase } from './platform-support-worker-bridge.mjs';
import { buildSupportScenario } from './platform-support-fixtures';
import { buildWorkAudioScenario } from './platform-whatsapp-work-scenario';
import { readPlatformWhatsAppLinkStatus, preparePlatformWhatsAppAudioRetentionIdentity } from '@/lib/server/platform-whatsapp-link';
import { configurePlatformSupportRecipient } from '@/lib/server/platform-support-notifications';
import { token, phone } from './platform-whatsapp-link-fixtures';
import { historicalSupport } from './fixtures/support-2026-10-18.2';
import { consentStateKey } from '@/lib/server/consent';
import { preparePlatformAudio } from '../cloudflare/tests/platform-whatsapp-work-bridge.mjs';
import { getPlatformWhatsAppConfig } from '@/lib/server/platform-whatsapp-config';
import { createPlatformWorkStore, takePlatformSendPermit } from '@/lib/server/platform-whatsapp-work-store';
import { supportNotificationText } from '../shared/platform-whatsapp-work';
import { ingestPlatformWhatsAppEvent } from '@/lib/server/platform-whatsapp-ingress';
let runtime: Awaited<ReturnType<typeof createDataTestRuntime>>, db: Database, second: Database;
const transport: DataTransport = async command => { const response = await runtime.fetch(command), value = await response.json(); if (!response.ok) throw new StorageError(response.status, value.code); return value; };
beforeAll(async () => { runtime = await createDataTestRuntime(); }, 30000);
afterAll(async () => { await runtime?.dispose(); });
beforeEach(async () => { vi.spyOn(Date, 'now').mockReturnValue(now); firebase.getUser.mockReset().mockImplementation(async uid => ({ uid, disabled: false })); vi.stubEnv('PLATFORM_SUPPORT_KEY', Buffer.alloc(32, 43).toString('base64')); await runtime.db.exec('DELETE FROM app_documents; DELETE FROM app_commits;'); db = createCloudflareDatabase(transport); second = createCloudflareDatabase(transport); firebase.db = db; await seedConsents(db, 'demo-web'); });
afterEach(() => { firebase.db = null; vi.restoreAllMocks(); vi.unstubAllEnvs(); });
const actor = { uid: 'demo-web', role: 'customer' as const };
const barrier = () => { let release!: () => void; const promise = new Promise<void>(r => { release = r; }); return { promise, release }; };
async function seed(rows: Map<string, Record<string, unknown>>) { await db.runTransaction(async tx => { await tx.get(db.collection('serverSettings').doc('platform_whatsapp')); for (const [path, value] of rows) { const [root, id] = path.split('/'); tx.set(db.collection(root).doc(id), value); } }); }
async function configured() {
  vi.stubEnv('SUPERADMIN_UID', 'demo-link-user'); const s = await buildSupportScenario(); await seed(s.rows);
  const link = (await readPlatformWhatsAppLinkStatus(token(), db)).current!;
  await configurePlatformSupportRecipient(token(), { linkId: link.linkId, expectedRevision: 0, requestId: randomUUID() }, db);
  return { thread: await createSupportConversation(actor.uid, randomUUID(), db), work: createPlatformWorkStore(db), event: s.event };
}
it.each(['open', 'closed'] as const)('newer retained audio cannot shadow or renew the original text window (%s) on real D1', async window => {
  const s = await configured(), later = now + (window === 'open' ? 1000 : 86_400_000);
  vi.spyOn(Date, 'now').mockReturnValue(later);
  const connection = db.collection('serverSettings').doc('platform_whatsapp');
  await connection.set({ ...(await connection.get()).data()!, observedAt: later, updatedAt: later });
  const { text: _text, ...base } = s.event();
  await ingestPlatformWhatsAppEvent({ ...base, kind: 'incoming_audio', occurredAt: later, customerSentAt: later, audio: { id: '123456789', link: 'https://api.ycloud.com/v2/whatsapp/media/download/123456789', sha256: Buffer.alloc(32, 7).toString('base64'), mimeType: 'audio/ogg; codecs=opus' } }, getPlatformWhatsAppConfig(), db, later);
  const audio = (await db.collection('platformWhatsAppEvents').get()).docs.find(d => d.data().kind === 'incoming_audio')!.data();
  expect(audio).toMatchObject({ state: 'body_present', ingressDisposition: 'descriptor_retained', receivedAt: later });
  const message = await appendSupportMessage(actor, s.thread.id, { requestId: randomUUID(), expectedRevision: 0, text: 'private web question' }, db);
  expect((await readSupportMessages(actor, s.thread.id, null, db)).notificationStates).toEqual([{ messageId: message.id, state: window === 'open' ? 'pending' : 'blocked' }]);
  const notice = (await db.collection('platformWhatsAppJobs').get()).docs.find(d => d.data().kind === 'operator_notification')?.data();
  if (window === 'closed') expect(notice).toBeUndefined();
  else {
    expect(notice).toMatchObject({ sourceKind: 'text', sourceReceivedAt: now, customerSentAt: now, windowExpiresAt: now + 86_400_000, bodyExpiresAt: now + 86_400_000 });
    expect((await db.collection('platformWhatsAppEvents').doc(notice!.sourceEventId).get()).data()).toMatchObject({ kind: 'incoming_text', state: 'body_present' });
  }
});
it.each(['valid-old', 'malformed'] as const)('real Node and Worker classify %s support documents without historical rewrite', async mode => {
  const s = await buildWorkAudioScenario(); await seed(s.rows);
  const key = consentStateKey('demo-link-user', 'platform_support'), current = (await db.collection('serverSettings').doc(key).get()).data()!, receipt = (await db.collection('serverSettings').doc(current.receiptId).get()).data()!;
  const old = { ...receipt, documents: mode === 'malformed' ? { ...historicalSupport, notice: 'corrupt' } : historicalSupport };
  await db.collection('serverSettings').doc(current.receiptId).set(old); await db.collection('serverSettings').doc(key).set({ ...current, fingerprint: historicalSupport.fingerprint });
  const env = { SARIN_DB: runtime.db, SARIN_FILES: runtime.bucket, ...Object.fromEntries(Object.entries(process.env).filter(([k]) => k.startsWith('PLATFORM_'))) };
  const node = preparePlatformWhatsAppAudioRetentionIdentity(phone, getPlatformWhatsAppConfig().scope!, db, now), worker = preparePlatformAudio(s.lease, env, now);
  if (mode === 'valid-old') { const values = await Promise.all([node, worker]); expect(values).toEqual([null, null]); }
  else await Promise.all([expect(node).rejects.toMatchObject({ status: 503 }), expect(worker).rejects.toMatchObject({ status: 503 })]);
  expect((await db.collection('serverSettings').doc(current.receiptId).get()).data()).toEqual(old);
});
it('real D1 serializes two web notices on one WA head and one-use permits retain unknown without retry', async () => {
  const { thread, work } = await configured();
  const first = await appendSupportMessage(actor, thread.id, { requestId: randomUUID(), expectedRevision: 0, text: 'first confidential' }, db);
  await appendSupportMessage(actor, thread.id, { requestId: randomUUID(), expectedRevision: 1, text: 'second confidential' }, second);
  const lease = (await work.claimNext())!, job = (await work.readAuthorized(lease))!;
  expect(job.supportNotification?.messageId).toBe(first.id); expect(job.nextJobId).not.toBeNull();
  const out = await work.saveReply(lease, supportNotificationText(job.supportNotification!)), claim = (await work.claimSend(out.outboxId))!;
  expect(await takePlatformSendPermit(out.outboxId, claim.token, db)).toMatchObject({ buttons: [], text: supportNotificationText(job.supportNotification!) });
  expect(await takePlatformSendPermit(out.outboxId, claim.token, second)).toBeNull();
  await work.finishSend(out.outboxId, claim.token, { status: 'unknown' });
  expect((await readSupportMessages(actor, thread.id, null, db)).notificationStates[0].state).toBe('unknown');
  expect(await createPlatformWorkStore(second).claimSend(out.outboxId)).toBeNull();
  const next = (await work.claimNext())!; expect(next.jobId).toBe(job.nextJobId);
});
it.each(['recipient', 'config'] as const)('real two-handle %s race cannot commit stale positive recipient proof', async kind => {
  const { thread } = await configured(), entered = barrier(), resume = barrier(); let paused = false;
  const racing = createCloudflareDatabase(async command => { if (!paused && command.action === 'commit' && command.writes.some(w => w.op !== 'delete' && w.data.kind === 'operator_notification')) { paused = true; entered.release(); await resume.promise; } return transport(command); });
  const pending = appendSupportMessage(actor, thread.id, { requestId: randomUUID(), expectedRevision: 0, text: 'atomic recipient' }, racing).catch(e => e);
  await entered.promise;
  if (kind === 'recipient') await seedConsents(second, 'demo-link-user', 2, false);
  else { const ref = second.collection('platformSettings').doc('platform_support_recipient'), row = (await ref.get()).data()!; await ref.set({ ...row, revision: row.revision + 1 }); }
  resume.release(); const result = await pending;
  if (kind === 'config') { expect(result).toMatchObject({ status: 409 }); expect((await db.collection('platformSupportMessages').get()).size).toBe(0); }
  else { expect(result).toMatchObject({ sequence: 1 }); expect((await readSupportMessages(actor, thread.id, null, db)).notificationStates[0].state).toBe('blocked'); }
  expect((await db.collection('platformWhatsAppJobs').get()).docs.some(d => d.data().kind === 'operator_notification')).toBe(false);
});
it('real D1 commits message and intent together and serializes two handles without duplicate sequences', async () => {
  const thread = await createSupportConversation(actor.uid, randomUUID(), db);
  const input = { requestId: randomUUID(), expectedRevision: 0, text: 'atomic synthetic' };
  const results = await Promise.allSettled([appendSupportMessage(actor, thread.id, input, db), appendSupportMessage(actor, thread.id, { ...input, requestId: randomUUID() }, second)]);
  expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
  const page = await readSupportMessages(actor, thread.id, null, db); expect(page.messages).toHaveLength(1); expect(page.notificationStates).toEqual([{ messageId: page.messages[0].id, state: 'blocked' }]);
});
it('real D1 consent barrier aborts both message and intent without Firebase calls inside callback', async () => {
  const thread = await createSupportConversation(actor.uid, randomUUID(), db), entered = barrier(), resume = barrier(); let paused = false;
  const racing = createCloudflareDatabase(async command => { if (!paused && command.action === 'commit' && command.writes.some(w => w.path.startsWith('platformSupportMessages/'))) { paused = true; entered.release(); await resume.promise; } return transport(command); });
  const pending = appendSupportMessage(actor, thread.id, { requestId: randomUUID(), expectedRevision: 0, text: 'must never persist' }, racing);
  await entered.promise; await seedConsents(second, actor.uid, 2, false); resume.release();
  await expect(pending).rejects.toMatchObject({ status: 428 });
  expect((await db.collection('platformSupportMessages').get()).size).toBe(0);
});
it('real D1 retention erases >50 bodies at equality, preserves sequence stubs and never deletes key marker', async () => {
  const thread = await createSupportConversation(actor.uid, randomUUID(), db);
  for (let n = 0; n < 51; n++) await appendSupportMessage(actor, thread.id, { requestId: randomUUID(), expectedRevision: n, text: 'synthetic body' }, db);
  const env = { SARIN_DB: runtime.db, SARIN_FILES: runtime.bucket };
  const a = await cleanupPlatformWhatsAppRetention(env, { now: now + 86_400_000 });
  expect(a.clearedBodies).toBe(50); expect(a.morePending).toBe(true);
  const b = await cleanupPlatformWhatsAppRetention(env, { now: now + 86_400_000 }); expect(b.clearedBodies).toBe(1);
  vi.spyOn(Date, 'now').mockReturnValue(now + 86_400_000);
  expect((await readSupportMessages(actor, thread.id, null, db)).messages.every(m => m.text === null)).toBe(true);
  for (let n = 0; n < 4; n++) await cleanupPlatformWhatsAppRetention(env, { now: now + 2_592_000_000 });
  expect((await db.collection('platformSupportMessages').get()).size).toBe(0);
  expect((await db.collection('platformSupportConversations').doc('key_marker').get()).exists).toBe(true);
}, 30000);
it('real D1 corrupt poison remains incomplete and bounded instead of falsely complete or deleted', async () => {
  const thread = await createSupportConversation(actor.uid, randomUUID(), db), message = await appendSupportMessage(actor, thread.id, { requestId: randomUUID(), expectedRevision: 0, text: 'body' }, db), path = 'platformSupportMessages/' + message.id;
  const row = (await db.collection('platformSupportMessages').doc(message.id).get()).data()!;
  const corrupt = { ...row, arbitrary: true };
  await runtime.db.prepare('UPDATE app_documents SET data=? WHERE path=?').bind(JSON.stringify(corrupt), path).run();
  const result = await cleanupPlatformSupportRetention({ SARIN_DB: runtime.db, SARIN_FILES: runtime.bucket }, now + 86_400_000, 1);
  expect(result).toMatchObject({ morePending: true, invalidRecords: 1, clearedBodies: 0 });
  expect((await db.collection('platformSupportMessages').doc(message.id).get()).data()).toEqual(corrupt);
});
it('real D1 cleanup CAS rereads and preserves a fresh successor recipient at the same singleton path', async () => {
  await configured(); const entered = barrier(), resume = barrier(); let paused = false;
  const env = observeDatabase({ SARIN_DB: runtime.db, SARIN_FILES: runtime.bucket }, async (entries: Array<{ sql: string; values: unknown[] }>, execute: () => Promise<unknown>) => {
    if (!paused && entries.some(e => e.sql.startsWith('DELETE FROM app_documents') && e.values[0] === 'platformSettings/platform_support_recipient')) { paused = true; entered.release(); await resume.promise; }
    return execute();
  });
  const cleaning = cleanupPlatformSupportRetention(env, now + 2_592_000_000);
  await entered.promise;
  const ref = second.collection('platformSettings').doc('platform_support_recipient'), old = (await ref.get()).data()!, successor = { ...old, revision: old.revision + 1, createdAt: now + 2_592_000_000, expiresAt: now + 2 * 2_592_000_000 };
  await ref.set(successor); resume.release(); await cleaning;
  expect((await ref.get()).data()).toEqual(successor);
});
