import { expect, it, beforeEach, afterEach, vi } from 'vitest';
const firebase = vi.hoisted(() => ({ getUser: vi.fn() }));
vi.mock('@/lib/firebase/admin', () => ({ getAdminDb: () => { throw new Error('Default backend forbidden'); }, getAdminAuth: () => firebase }));
import { createSupportConversation, appendSupportMessage, readSupportMessages, listSupportConversations } from '@/lib/server/platform-support';
import { memoryStore, now } from './platform-whatsapp-test-fixtures';
import { seedConsents } from './platform-whatsapp-link-fixtures';
import { randomUUID } from 'node:crypto';
import { historicalSupport } from './fixtures/support-2026-10-18.2';
import { consentStateKey, readConsent, readVerifiedConsentAnchor } from '@/lib/server/consent';
beforeEach(() => { vi.spyOn(Date, 'now').mockReturnValue(now); firebase.getUser.mockReset().mockImplementation(async uid => ({ uid, disabled: false })); vi.stubEnv('PLATFORM_SUPPORT_KEY', Buffer.alloc(32, 43).toString('base64')); vi.stubEnv('SUPERADMIN_UID', 'demo-admin'); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });
const actor = { uid: 'demo-customer', role: 'customer' as const };
async function setup() { const s = memoryStore(); await seedConsents(s.db, actor.uid); await seedConsents(s.db, 'demo-admin'); return s; }
it('preserves legitimate old support documents as inactive and distinguishes malformed receipt corruption', async () => {
  const s = await setup(), path = 'demo_old_support', documents = historicalSupport;
  const receipt = { uid: actor.uid, scope: 'platform_support', businessId: null, requestId: 'historical', action: 'accept', revision: 4, occurredAt: now - 1, preauthorizedAt: null, termsAccepted: true, dataAuthorized: true, documents };
  await s.db.collection('serverSettings').doc(path).set(receipt);
  await s.db.collection('serverSettings').doc(consentStateKey(actor.uid, 'platform_support')).set({ version: 1, uid: actor.uid, scope: 'platform_support', businessId: null, revision: 4, active: true, fingerprint: documents.fingerprint, receiptId: path });
  expect(await readConsent(actor.uid, 'platform_support', undefined, s.db)).toMatchObject({ active: false, receipt });
  expect(await s.db.runTransaction(tx => readVerifiedConsentAnchor(actor.uid, 'platform_support', undefined, s.db, tx))).toMatchObject({ active: false, revision: 4 });
  await expect(createSupportConversation(actor.uid, randomUUID(), s.db)).rejects.toMatchObject({ status: 428 });
  expect((await s.db.collection('serverSettings').doc(path).get()).data()).toEqual(receipt);
  await s.db.collection('serverSettings').doc(path).set({ ...receipt, documents: { ...documents, notice: 'corrupt' } });
  await expect(createSupportConversation(actor.uid, randomUUID(), s.db)).rejects.toMatchObject({ status: 503 });
});
import { consentContent, LEGAL_VERSION } from '@/lib/legal';
import { isDataPath } from '../shared/data-protocol';
import { executeDataCommand } from './platform-support-worker-bridge.mjs';

it('versions web support independently while preserving account and business decisions', () => {
  expect(LEGAL_VERSION).toBe('2026-10-18.2');
  const document = consentContent('platform_support');
  expect(document.version).toBe('2026-10-21.1');
  expect(document.privacy).toContain('Cloudflare');
  expect(document.privacy).toContain('web');
  expect(document.notice).toContain('no abre');
});
it('creates a private fixed-lifetime thread with authorized idempotency and encrypted messages plus atomic blocked intent', async () => {
  const s = await setup(), request = randomUUID();
  const thread = await createSupportConversation(actor.uid, request, s.db);
  expect(thread).toEqual({ id: expect.stringMatching(/^[a-f0-9-]{36}$/), revision: 0 });
  expect(await createSupportConversation(actor.uid, request, s.db)).toEqual(thread);
  const input = { requestId: randomUUID(), expectedRevision: 0, text: '  contenido privado 😀  ' };
  const message = await appendSupportMessage(actor, thread.id, input, s.db);
  expect(message).toMatchObject({ sequence: 1, revision: 1 });
  expect(JSON.stringify([...s.rows])).not.toContain(input.text);
  const commit = s.seen.filter(c => c.action === 'commit').at(-1)!;
  expect(commit.action === 'commit' && commit.writes.map(w => w.path).sort()).toEqual(['platformSupportConversations/' + thread.id, 'platformSupportMessages/' + message.id, 'platformSupportMessages/intent_' + message.id].sort());
  expect(await readSupportMessages(actor, thread.id, null, s.db)).toMatchObject({ messages: [{ ...message, revision: undefined, author: 'customer', text: input.text }].map(({ revision: _r, ...v }) => v), notificationStates: [{ messageId: message.id, state: 'blocked' }], revision: 1, hasMore: false });
  expect(await appendSupportMessage(actor, thread.id, input, s.db)).toEqual(message);
  await expect(appendSupportMessage(actor, thread.id, { ...input, text: 'changed' }, s.db)).rejects.toMatchObject({ status: 409 });
});
it('requires independent current Firebase and immutable owner anchors before reads, cursor parsing or writes', async () => {
  const s = await setup(), thread = await createSupportConversation(actor.uid, randomUUID(), s.db);
  await expect(readSupportMessages({ uid: 'foreign', role: 'customer' }, thread.id, 'broken', s.db)).rejects.toMatchObject({ status: 403 });
  await seedConsents(s.db, actor.uid, 2, false);
  await expect(readSupportMessages(actor, thread.id, null, s.db)).rejects.toMatchObject({ status: 428 });
  await seedConsents(s.db, actor.uid, 3, true);
  await expect(readSupportMessages(actor, thread.id, null, s.db)).rejects.toMatchObject({ status: 428 });
  firebase.getUser.mockResolvedValue({ uid: actor.uid, disabled: true });
  await expect(createSupportConversation(actor.uid, randomUUID(), s.db)).rejects.toMatchObject({ status: 401 });
});
it('uses commit-order sequence, bounded high water and expired stubs without renewing replay', async () => {
  const s = await setup(), thread = await createSupportConversation(actor.uid, randomUUID(), s.db);
  const first = { requestId: randomUUID(), expectedRevision: 0, text: 'first' };
  await appendSupportMessage(actor, thread.id, first, s.db);
  for (let n = 1; n <= 100; n++) await appendSupportMessage(actor, thread.id, { requestId: randomUUID(), expectedRevision: n, text: String(n) }, s.db);
  const a = await readSupportMessages(actor, thread.id, null, s.db); expect(a.messages).toHaveLength(100); expect(a.hasMore).toBe(true); expect(a.cursor).not.toContain(actor.uid);
  await appendSupportMessage(actor, thread.id, { requestId: randomUUID(), expectedRevision: 101, text: 'later' }, s.db);
  const b = await readSupportMessages(actor, thread.id, a.cursor, s.db); expect(b.messages.map(m => m.sequence)).toEqual([101]); expect(b.hasMore).toBe(false);
  const c = await readSupportMessages(actor, thread.id, b.cursor, s.db); expect(c.messages.map(m => m.sequence)).toEqual([102]);
  vi.spyOn(Date, 'now').mockReturnValue(now + 86_400_000);
  expect((await readSupportMessages(actor, thread.id, null, s.db)).messages.every(m => m.text === null)).toBe(true);
  expect(await appendSupportMessage(actor, thread.id, first, s.db)).toMatchObject({ sequence: 1, revision: 1 });
  expect((await listSupportConversations(actor, null, s.db)).conversations).toHaveLength(1);
});
it.each(['missing', 'changed', 'missing-marker'] as const)('fails closed for %s support key without writes or WhatsApp dependency', async mode => {
  const s = await setup(), thread = await createSupportConversation(actor.uid, randomUUID(), s.db);
  if (mode === 'missing') vi.stubEnv('PLATFORM_SUPPORT_KEY', '');
  if (mode === 'changed') vi.stubEnv('PLATFORM_SUPPORT_KEY', Buffer.alloc(32, 44).toString('base64'));
  if (mode === 'missing-marker') s.rows.delete('platformSupportConversations/key_marker');
  const before = structuredClone([...s.rows]);
  await expect(appendSupportMessage(actor, thread.id, { requestId: randomUUID(), expectedRevision: 0, text: 'x' }, s.db)).rejects.toMatchObject({ status: 503 });
  expect([...s.rows]).toEqual(before);
});
it.each(['tamper', 'other-user', 'other-thread', 'role', 'expired'] as const)('rejects %s message cursor without granting private authority', async mode => {
  const s = await setup(), thread = await createSupportConversation(actor.uid, randomUUID(), s.db), page = await readSupportMessages(actor, thread.id, null, s.db);
  let reader = actor as { uid: string; role: 'customer' | 'admin' }, id = thread.id, cursor = page.cursor!;
  if (mode === 'tamper') cursor += 'x';
  if (mode === 'other-user') { await seedConsents(s.db, 'foreign'); reader = { uid: 'foreign', role: 'customer' }; }
  if (mode === 'other-thread') id = (await createSupportConversation(actor.uid, randomUUID(), s.db)).id;
  if (mode === 'role') { vi.stubEnv('SUPERADMIN_UID', actor.uid); reader = { ...actor, role: 'admin' }; }
  if (mode === 'expired') vi.spyOn(Date, 'now').mockReturnValue(now + 900_000);
  await expect(readSupportMessages(reader, id, cursor, s.db)).rejects.toMatchObject({ status: mode === 'other-user' ? 403 : 400 });
});
it('keeps 4096 multibyte codepoints exact and never silently trims or normalizes', async () => {
  const s = await setup(), thread = await createSupportConversation(actor.uid, randomUUID(), s.db), text = '😀'.repeat(4096);
  await appendSupportMessage(actor, thread.id, { requestId: randomUUID(), expectedRevision: 0, text }, s.db);
  expect((await readSupportMessages(actor, thread.id, null, s.db)).messages[0].text).toBe(text);
  for (const text of ['', '\ud800', '\udfff', '😀'.repeat(4097)]) await expect(appendSupportMessage(actor, thread.id, { requestId: randomUUID(), expectedRevision: 1, text }, s.db)).rejects.toMatchObject({ status: 400 });
});
it('never notifies admin replies and returns original revision on replay after later sequence', async () => {
  const s = await setup(), thread = await createSupportConversation(actor.uid, randomUUID(), s.db), input = { requestId: randomUUID(), expectedRevision: 0, text: 'first' };
  const first = await appendSupportMessage(actor, thread.id, input, s.db);
  vi.spyOn(Date, 'now').mockReturnValue(now + 1000);
  await appendSupportMessage({ uid: 'demo-admin', role: 'admin' }, thread.id, { requestId: randomUUID(), expectedRevision: 1, text: 'reply' }, s.db);
  vi.spyOn(Date, 'now').mockReturnValue(now + 500);
  const later = await appendSupportMessage(actor, thread.id, { requestId: randomUUID(), expectedRevision: 2, text: 'delayed' }, s.db);
  expect(later.sequence).toBe(3); expect(await appendSupportMessage(actor, thread.id, input, s.db)).toEqual(first);
  expect((await readSupportMessages(actor, thread.id, null, s.db)).notificationStates).toHaveLength(2);
});
it('terminates old threads at fixed lifetime and expired creation index allocates a distinct UUID', async () => {
  const s = await setup(), requestId = randomUUID(), thread = await createSupportConversation(actor.uid, requestId, s.db);
  vi.spyOn(Date, 'now').mockReturnValue(now + 2_592_000_000);
  await expect(readSupportMessages(actor, thread.id, null, s.db)).rejects.toMatchObject({ status: 403 });
  const next = await createSupportConversation(actor.uid, requestId, s.db); expect(next.id).not.toBe(thread.id);
});
it('finite metadata sweeps continue above 300 and freeze their upper ID against higher insertions', async () => {
  const s = await setup(), thread = await createSupportConversation(actor.uid, randomUUID(), s.db), template = s.rows.get('platformSupportConversations/' + thread.id)!;
  s.rows.delete('platformSupportConversations/' + thread.id);
  const id = (n: number) => '11111111-1111-4111-8111-' + n.toString().padStart(12, '0');
  for (let n = 1; n <= 350; n++) s.seed('platformSupportConversations/' + id(n), { ...template, id: id(n) });
  let page = await listSupportConversations(actor, null, s.db), all = [...page.conversations];
  s.seed('platformSupportConversations/' + id(999), { ...template, id: id(999) });
  s.seed('platformSupportConversations/' + id(0), { ...template, id: id(0) });
  while (page.hasMore) { page = await listSupportConversations(actor, page.cursor, s.db); all.push(...page.conversations); }
  expect(all).toHaveLength(350); expect(all.at(-1)?.id).toBe(id(350));
  expect((await listSupportConversations(actor, null, s.db)).conversations[0].id).toBe(id(0));
});
it('rejects malformed support records before accessing storage bindings', async () => {
  await expect(executeDataCommand({ action: 'commit', expectedRevision: 0, requestId: '12345678-1234-4123-8123-123456789abc', writes: [{ op: 'set', path: 'platformSupportConversations/key_marker', data: { arbitrary: true } }] }, {} as never)).rejects.toMatchObject({ status: 400 });
});
it('admits only canonical web support paths before any producer exists', () => {
  expect(isDataPath('platformSupportConversations/12345678-1234-4123-8123-123456789abc', true)).toBe(true);
  expect(isDataPath('platformSupportMessages/' + 'a'.repeat(64), true)).toBe(true);
  expect(isDataPath('platformSupportConversations/key_marker', true)).toBe(true);
  for (const path of ['platformSupportConversations/arbitrary', 'platformSupportMessages/arbitrary', 'platformSupportConversations/12345678-1234-4123-8123-123456789abc/child']) expect(isDataPath(path, true)).toBe(false);
});
