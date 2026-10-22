import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('@/lib/firebase/admin', () => ({ getAdminDb: () => { throw new Error('Default backend forbidden'); } }));
import { createDataTestRuntime } from '../cloudflare/tests/data-runtime.mjs';
import { createCloudflareDatabase, StorageError, type DataTransport } from '@/lib/storage/database';
import { isDataPath, type DataCommand, type DataReadResult, type DataCommitResult } from '../shared/data-protocol';
import { configure, connectionPath, incoming, now, scope } from './platform-whatsapp-test-fixtures';
import { ingestPlatformWhatsAppEvent as ingest } from '@/lib/server/platform-whatsapp-ingress';
import { applyPlatformWhatsAppConnectionControl as control, getPlatformWhatsAppStatus } from '@/lib/server/platform-whatsapp-store';
import { applyPlatformWhatsAppConversationControl as conversationControl, listPlatformWhatsAppConversations } from '@/lib/server/platform-whatsapp-conversations';
import type { Database } from '@/lib/storage/types';

describe('platform domain on the real local Worker D1 fixture', () => {
  let runtime: Awaited<ReturnType<typeof createDataTestRuntime>>;
  let db: Database, second: Database;
  const seen: DataCommand[] = [];
  const transport: DataTransport = async command => {
    seen.push(structuredClone(command));
    const response = await runtime.fetch(command), body = await response.json() as DataReadResult | DataCommitResult;
    if (!response.ok) throw new StorageError(response.status, (body as unknown as { code: string }).code);
    return body;
  };
  beforeAll(async () => { runtime = await createDataTestRuntime(); }, 30_000);
  afterAll(async () => { await runtime?.dispose(); });
  beforeEach(async () => {
    configure();
    await runtime.db.exec('DELETE FROM app_documents; DELETE FROM app_commits;');
    seen.length = 0; db = createCloudflareDatabase(transport); second = createCloudflareDatabase(transport);
  });
  afterEach(() => vi.unstubAllEnvs());
  it.each(['descriptor', 'time', 'choice', 'kind'])('keeps terminal audio/choice aliases coherent and detects changed %s on real D1', async mutation => {
    const { text: _text, ...base } = incoming();
    const audio = { ...base, kind: 'incoming_audio', customerSentAt: now - 1, audio: { id: '123456789', link: 'https://api.ycloud.com/v2/whatsapp/media/download/123456789', sha256: Buffer.alloc(32, 7).toString('base64'), mimeType: 'audio/ogg; codecs=opus' } };
    const choice = { ...base, kind: 'incoming_choice', customerSentAt: null, choiceId: 'sarinbot.menu.v1:human:12345678-1234-4234-8234-123456789abc' };
    const first = mutation === 'choice' ? choice : audio;
    const results = await Promise.all([ingest(first, configure(), db, now), ingest(first, configure(), second, now)]);
    expect(results.map(result => result.outcome).sort()).toEqual(['duplicate', 'stored']);
    const before = (await db.collection('platformWhatsAppEvents').get()).docs.find(doc => doc.data().recordType === 'event')!;
    const changed = mutation === 'descriptor' ? { ...audio, audio: { ...audio.audio, link: audio.audio.link + '?sig=changed' } }
      : mutation === 'time' ? { ...audio, customerSentAt: now } : mutation === 'choice' ? { ...choice, choiceId: choice.choiceId.replace('human', 'stop') } : choice;
    expect((await ingest(changed, configure(), second, now + 1)).outcome).toBe('conflict');
    expect((await db.collection('platformWhatsAppEvents').doc(before.id).get()).data()).toEqual(before.data());
    expect((await db.collection('platformWhatsAppConversations').get()).size).toBe(0);
  });
  it('permits the platform parents including link controls and rejects children, malformed paths and unrelated fields', async () => {
    for (const parent of ['platformWhatsAppEvents', 'platformWhatsAppConversations', 'platformWhatsAppLinks', 'platformWhatsAppLinkChallenges']) {
      expect(isDataPath(parent, false)).toBe(true); expect(isDataPath(`${parent}/demo`, true)).toBe(true);
      expect(isDataPath(`${parent}/demo/children/one`, true)).toBe(false);
      await db.collection(parent).doc('demo').set({ updatedAt: 2, phoneNumberId: scope.phoneNumberId });
      expect((await second.collection(parent).doc('demo').get()).exists).toBe(true);
    }
    expect(isDataPath('platformWhatsAppOther/demo', true)).toBe(false);
    expect(isDataPath('platformWhatsAppEvents/../demo', true)).toBe(false);
    await db.collection('platformWhatsAppEvents').doc('demo').set({ recordType: 'event', kind: 'incoming_text', updatedAt: 2, phoneNumberId: scope.phoneNumberId });
    expect((await db.collection('platformWhatsAppEvents').where('recordType', '==', 'event').where('kind', '==', 'incoming_text').limit(1).get()).docs.map(doc => doc.id)).toEqual(['demo']);
    await expect(db.collection('platformWhatsAppEvents').where('privateSender', '==', 'synthetic').get()).rejects.toMatchObject({ code: 'DATA_INVALID' });
    await expect(db.collection('platformWhatsAppEvents').where('recordType', '==', 1).get()).rejects.toMatchObject({ code: 'DATA_INVALID' });
    await expect(db.collection('platformWhatsAppEvents').where('kind', '==', 1).get()).rejects.toMatchObject({ code: 'DATA_INVALID' });
    await expect(db.collection('platformWhatsAppEvents').where('updatedAt', '==', '2').get()).rejects.toMatchObject({ code: 'DATA_INVALID' });
  });
  it('filters and orders updatedAt numerically with a strict explicit bound', async () => {
    for (const [id, updatedAt] of [['a', 2], ['b', 10], ['c', 100]] as const) await db.collection('platformWhatsAppConversations').doc(id).set({ updatedAt, phoneNumberId: scope.phoneNumberId });
    const rows = await second.collection('platformWhatsAppConversations').where('updatedAt', '>=', 3).orderBy('updatedAt', 'desc').limit(1).get();
    expect(rows.docs.map(d => d.id)).toEqual(['c']);
    await expect(db.collection('platformWhatsAppConversations').orderBy('customerPhone').get()).rejects.toMatchObject({ code: 'DATA_INVALID' });
  });
  it('serializes concurrent controls from two handles and applies a repeated request only once', async () => {
    const input = { action: 'pause', expectedRevision: 0, requestId: 'demo-race-one' };
    const results = await Promise.allSettled([control(input, 'demo-admin', db, now), control({ ...input, requestId: 'demo-race-two' }, 'demo-admin', second, now)]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.find(r => r.status === 'rejected')).toMatchObject({ reason: { status: 409 } });
    expect((await db.collection('platformWhatsAppEvents').get()).size).toBe(1);
    const next = { ...input, expectedRevision: 1, requestId: 'demo-repeat' };
    await Promise.all([control(next, 'demo-admin', db, now + 1), control(next, 'demo-admin', second, now + 1)]);
    expect((await getPlatformWhatsAppStatus(db, now + 1)).connectionRevision).toBe(2);
    expect((await db.collection('platformWhatsAppEvents').get()).size).toBe(2);
  });
  it('deduplicates concurrent ingress from two handles and adds aliases with original TTL', async () => {
    const config = configure();
    const results = await Promise.all([ingest(incoming(), config, db, now), ingest(incoming(), config, second, now)]);
    expect(results.map(r => r.outcome).sort()).toEqual(['duplicate', 'stored']);
    const priorConnection = (await db.collection('serverSettings').doc('platform_whatsapp').get()).data();
    await ingest(incoming({ eventId: 'demo-second-event' }), config, second, now + 100);
    const rows = (await db.collection('platformWhatsAppEvents').get()).docs.map(d => d.data());
    expect(rows.filter(r => r.recordType === 'event')).toHaveLength(1); expect(rows.filter(r => r.recordType === 'alias')).toHaveLength(3);
    expect(rows.every(r => r.receivedAt === now && r.bodyExpiresAt === now + 86_400_000 && r.expiresAt === now + 2_592_000_000)).toBe(true);
    expect((await second.collection('serverSettings').doc('platform_whatsapp').get()).data()).toEqual(priorConnection);
    expect((await listPlatformWhatsAppConversations(second, now)).conversations[0]).toMatchObject({ revision: 0, contentAvailable: true, lastMessage: 'Synthetic private message' });
  });
  it('recomputes ingress after a deterministic CAS collision with pause, leaving no event or conversation', async () => {
    let injected = false;
    const racing = createCloudflareDatabase(async command => {
      if (command.action === 'commit' && !injected) {
        injected = true;
        await control({ action: 'pause', expectedRevision: 0, requestId: 'demo-interrupt' }, 'demo-admin', second, now);
      }
      return transport(command);
    });
    await expect(ingest(incoming(), configure(), racing, now)).rejects.toMatchObject({ status: 503 });
    expect((await db.collection('platformWhatsAppConversations').get()).size).toBe(0);
    expect((await db.collection('platformWhatsAppEvents').get()).docs.map(d => d.data().recordType)).toEqual(['control']);
    expect((await db.collection('serverSettings').doc('platform_whatsapp').get()).data()).toMatchObject({ paused: true, connectionRevision: 1 });
  });
  it('recovers a lost durable ingress response using identical ciphertext and commit UUID', async () => {
    let lost = false;
    const commits: DataCommand[] = [];
    const ambiguous = createCloudflareDatabase(async command => {
      if (command.action === 'commit') commits.push(structuredClone(command));
      const result = await transport(command);
      if (command.action === 'commit' && !lost) { lost = true; throw new TypeError('Synthetic lost response'); }
      return result;
    });
    expect((await ingest(incoming(), configure(), ambiguous, now)).outcome).toBe('stored');
    expect(commits).toHaveLength(2); expect(commits[0]).toEqual(commits[1]);
    expect((await runtime.db.prepare('SELECT COUNT(*) AS n FROM app_commits').first())?.n).toBe(1);
    expect((await db.collection('platformWhatsAppEvents').get()).size).toBe(3);
    expect((await ingest(incoming(), configure(), second, now + 1)).outcome).toBe('duplicate');
  });
  it('rolls back an entire domain commit when an injected later create collides', async () => {
    await db.collection('users').doc('demo-collision').set({ sentinel: true });
    const failing = createCloudflareDatabase(async command => transport(command.action === 'commit' ? { ...command, writes: [...command.writes, { op: 'create', path: 'users/demo-collision', data: {} }] } : command));
    await expect(ingest(incoming(), configure(), failing, now)).rejects.toMatchObject({ status: 409, code: 'DATA_EXISTS' });
    expect((await db.collection('platformWhatsAppEvents').get()).size).toBe(0);
    expect((await db.collection('platformWhatsAppConversations').get()).size).toBe(0);
    expect((await db.collection('serverSettings').doc('platform_whatsapp').get()).exists).toBe(false);
    expect((await db.collection('users').doc('demo-collision').get()).data()).toEqual({ sentinel: true });
  });
  it('recovers a lost connection-control response without duplicating the audit or revision', async () => {
    let lost = false; const commits: DataCommand[] = [];
    const ambiguous = createCloudflareDatabase(async command => {
      if (command.action === 'commit') commits.push(structuredClone(command));
      const result = await transport(command);
      if (command.action === 'commit' && !lost) { lost = true; throw new TypeError('Synthetic lost control response'); }
      return result;
    });
    const input = { action: 'pause', expectedRevision: 0, requestId: 'demo-lost-control' };
    expect((await control(input, 'demo-admin', ambiguous, now)).connectionRevision).toBe(1);
    expect(commits).toHaveLength(2); expect(commits[0]).toEqual(commits[1]);
    expect((await control(input, 'demo-admin', second, now + 1)).connectionRevision).toBe(1);
    expect((await db.collection('platformWhatsAppEvents').get()).size).toBe(1);
  });
  it('atomically resolves concurrent manual conversation controls and retains exact timestamps/content', async () => {
    const result = await ingest(incoming(), configure(), db, now), ref = db.collection('platformWhatsAppConversations').doc(result.conversationId), original = (await ref.get()).data()!;
    const base = { conversationId: result.conversationId, expectedRevision: 0, mode: 'review', requestId: 'demo-mode-one' };
    const results = await Promise.allSettled([conversationControl(base, 'demo-admin', db, now + 1), conversationControl({ ...base, requestId: 'demo-mode-two', mode: 'human' }, 'demo-admin', second, now + 1)]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1); expect(results.find(r => r.status === 'rejected')).toMatchObject({ reason: { status: 409 } });
    const updated = (await ref.get()).data()!;
    expect({ ...updated, mode: original.mode, revision: original.revision }).toEqual(original);
    expect((await db.collection('platformWhatsAppEvents').get()).docs.filter(d => d.data().recordType === 'control')).toHaveLength(1);
  });
});
