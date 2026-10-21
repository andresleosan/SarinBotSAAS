import { beforeAll, afterAll, beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
const auth = vi.hoisted(() => ({ getUser: vi.fn() }));
vi.mock('@/lib/firebase/admin', () => ({ getAdminDb: () => { throw new Error('Default backend forbidden'); }, getAdminAuth: () => auth }));
import { createDataTestRuntime } from '../cloudflare/tests/data-runtime.mjs';
import { createCloudflareDatabase, StorageError, type DataTransport } from '@/lib/storage/database';
import { createPlatformWorkStore, takePlatformSendPermit } from '@/lib/server/platform-whatsapp-work-store';
import { commitPlatformAudioResult, preparePlatformAudioFallback } from '@/lib/server/platform-whatsapp-work-audio';
import { preparePlatformAudio, startPlatformAudio, finishPlatformAudio, cleanupPlatformWhatsAppRetention } from '../cloudflare/tests/platform-whatsapp-work-bridge.mjs';
import { isPlatformJob, emptyUsage } from '../shared/platform-whatsapp-work';
import { buildWorkAudioScenario } from './platform-whatsapp-work-scenario';
import { configure, connection, connectionPath, incoming, now } from './platform-whatsapp-test-fixtures';
import { configureWork, workCircuit } from './platform-whatsapp-work-fixtures';
import { ingestPlatformWhatsAppEvent as ingest } from '@/lib/server/platform-whatsapp-ingress';
import { getPlatformWhatsAppConfig } from '@/lib/server/platform-whatsapp-config';
import type { Database } from '@/lib/storage/types';
import type { DataCommand, DataReadResult, DataCommitResult } from '../shared/data-protocol';

describe('A3 actual two-handle local D1 and Worker stage transactions', () => {
  let runtime: Awaited<ReturnType<typeof createDataTestRuntime>>, db: Database, second: Database;
  const commands: DataCommand[] = [];
  const transport: DataTransport = async command => { commands.push(structuredClone(command)); const r = await runtime.fetch(command), b = await r.json() as DataReadResult | DataCommitResult; if (!r.ok) throw new StorageError(r.status, (b as unknown as { code: string }).code); return b; };
  beforeAll(async () => { runtime = await createDataTestRuntime(); }, 30_000);
  afterAll(async () => { await runtime?.dispose(); });
  beforeEach(async () => { vi.spyOn(Date, 'now').mockReturnValue(now); auth.getUser.mockReset().mockImplementation(async uid => ({ uid, disabled: false })); await runtime.db.exec('DELETE FROM app_documents; DELETE FROM app_commits;'); db = createCloudflareDatabase(transport); second = createCloudflareDatabase(transport); commands.length = 0; });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });
  const env = () => ({ SARIN_DB: runtime.db, SARIN_FILES: runtime.bucket, ...Object.fromEntries(Object.entries(process.env).filter(([k]) => k.startsWith('PLATFORM_'))) }) as Parameters<typeof preparePlatformAudio>[1];
  async function audio() { const s = await buildWorkAudioScenario(); await db.runTransaction(async tx => { await tx.get(db.collection('serverSettings').doc('platform_whatsapp')); for (const [p, row] of s.rows) { const [root, id] = p.split('/'); tx.set(db.collection(root).doc(id), row); } }); return s.lease; }
  it('double admission and claim serialize across independent handles', async () => {
    configure(); configureWork();
    await db.collection('serverSettings').doc('platform_whatsapp').set({ ...connection({ providerConnection: 'connected' }), observationStatus: 'connected', observationRevision: 0, observedAt: now });
    const c = workCircuit(); await db.collection('platformWhatsAppBudgetPeriods').doc(c.circuitId).set(c);
    let arrivals = 0, release!: () => void;
    const barrier = new Promise<void>(resolve => { release = resolve; });
    const racing: DataTransport = async command => {
      if (command.action === 'commit' && command.writes.some(w => w.op !== 'delete' && w.data.recordType === 'job') && arrivals < 2) {
        arrivals++; if (arrivals === 2) release(); await barrier;
      }
      return transport(command);
    };
    const results = await Promise.all([ingest(incoming({ customerSentAt: now }), getPlatformWhatsAppConfig(), createCloudflareDatabase(racing), now), ingest(incoming({ customerSentAt: now }), getPlatformWhatsAppConfig(), createCloudflareDatabase(racing), now)]);
    expect(arrivals).toBe(2);
    expect(results.map(r => r.outcome).sort()).toEqual(['duplicate', 'stored']);
    const leases = await Promise.all([createPlatformWorkStore(db, () => now).claimNext(), createPlatformWorkStore(second, () => now).claimNext()]);
    expect(leases.filter(Boolean)).toHaveLength(1);
    expect((await db.collection('platformWhatsAppJobs').get()).docs.filter(d => isPlatformJob(d.data()))).toHaveLength(1);
  });
  it('grants one audio prepare and inference start across two callers, commits transcript with job AAD', async () => {
    const lease = await audio(), prepared = await Promise.all([preparePlatformAudio(lease, env(), now), preparePlatformAudio(lease, env(), now)]);
    expect(prepared.filter(Boolean)).toHaveLength(1); const p = prepared.find(Boolean)!;
    const stored = (await db.collection('platformWhatsAppJobs').doc(lease.jobId).get()).data()!;
    expect(p.sourceBinding).toEqual({ conversationId: stored.conversationId, scope: { wabaId: stored.wabaId, phoneE164: stored.phoneE164, phoneNumberId: stored.phoneNumberId }, retentionAnchor: { uid: stored.uid, linkId: stored.linkId, linkRevision: stored.linkRevision, account: { revision: stored.accountRevision, fingerprint: stored.accountFingerprint, receiptId: stored.accountReceiptId }, support: { revision: stored.supportRevision, fingerprint: stored.supportFingerprint, receiptId: stored.supportReceiptId } } });
    const starts = await Promise.all([startPlatformAudio(lease, p.audioToken, env(), now), startPlatformAudio(lease, p.audioToken, env(), now)]); expect(starts.filter(Boolean)).toHaveLength(1);
    expect(await finishPlatformAudio(lease, p.audioToken, { status: 'completed', actualMicros: 1, usage: { ...emptyUsage, usageAudioMilliseconds: 1000 } }, env(), now)).toBe(true);
    expect((await db.collection('platformWhatsAppEvents').doc(p.sourceEventPath.split('/')[1]).get()).data()).toMatchObject({ state: 'body_erased', content: null });
    expect(await commitPlatformAudioResult(lease, p.audioToken, 'Synthetic transcript', 1, db, now)).toBe(true);
    expect(await commitPlatformAudioResult(lease, p.audioToken, 'Synthetic transcript', 1, second, now)).toBe(true);
    await expect(commitPlatformAudioResult(lease, p.audioToken, 'Changed transcript', 1, second, now)).rejects.toMatchObject({ status: 409 });
    expect(await preparePlatformAudio(lease, env(), now)).toBeNull();
  });
  it('fences a deterministic takeover between prepare and start before inference', async () => {
    const lease = await audio(), p = (await preparePlatformAudio(lease, env(), now))!;
    const j = (await db.collection('platformWhatsAppJobs').doc(lease.jobId).get()).data()!;
    await createPlatformWorkStore(second, () => now).cancelConversation(j.conversationId, j.conversationRevision);
    expect(await startPlatformAudio(lease, p.audioToken, env(), now)).toBe(false);
    expect(await finishPlatformAudio(lease, p.audioToken, { status: 'failed', actualMicros: 0, usage: emptyUsage }, env(), now)).toBe(false);
    expect(await commitPlatformAudioResult(lease, p.audioToken, 'Discarded transcript', 1, db, now)).toBe(false);
  });
  it('keeps uncertain audio spend and creates only one deterministic actor fallback', async () => {
    const lease = await audio(), p = (await preparePlatformAudio(lease, env(), now))!;
    expect(await startPlatformAudio(lease, p.audioToken, env(), now)).toBe(true);
    expect(await finishPlatformAudio(lease, p.audioToken, { status: 'unknown', actualMicros: null, usage: emptyUsage }, env(), now)).toBe(false);
    const fallback = await preparePlatformAudioFallback(lease, db, now); expect(fallback).not.toBeNull();
    expect(await preparePlatformAudioFallback(lease, second, now)).toBeNull();
    const work = createPlatformWorkStore(db, () => now), claim = (await work.claimSend(fallback!.outboxId))!;
    let syntheticProviderSend = 0;
    const permit = await takePlatformSendPermit(fallback!.outboxId, claim.token, db, now); if (permit) syntheticProviderSend++;
    // Acceptance followed by unavailable persistence cannot grant a second permit after restart.
    expect(await takePlatformSendPermit(fallback!.outboxId, claim.token, second, now)).toBeNull();
    const lost = createCloudflareDatabase(async command => {
      const result = await transport(command);
      if (command.action === 'commit' && command.writes.some(w => w.op !== 'delete' && w.path === 'platformWhatsAppOutbox/' + fallback!.outboxId && w.data.status === 'accepted')) throw new StorageError(503, 'DATA_UNAVAILABLE');
      return result;
    });
    await expect(createPlatformWorkStore(lost, () => now).finishSend(fallback!.outboxId, claim.token, { status: 'accepted', providerId: 'demo-lost-accepted' })).rejects.toMatchObject({ status: 503 });
    await createPlatformWorkStore(second, () => now).finishSend(fallback!.outboxId, claim.token, { status: 'accepted', providerId: 'demo-lost-accepted' });
    expect(await createPlatformWorkStore(second, () => now).claimSend(fallback!.outboxId)).toBeNull();
    expect(syntheticProviderSend).toBe(1);
    const calls = (await db.collection('platformWhatsAppBudgetCalls').get()).docs.map(d => d.data()); expect(calls.find(c => c.stage === 'audio')).toMatchObject({ status: 'uncertain', actualMicros: null });
  });
  it('retention erases all live work bodies at original equality without releasing holds', async () => {
    const lease = await audio(), p = (await preparePlatformAudio(lease, env(), now))!; await startPlatformAudio(lease, p.audioToken, env(), now);
    const before = (await db.collection('platformWhatsAppBudgetPeriods').get()).docs.map(d => d.data());
    await cleanupPlatformWhatsAppRetention(env(), { now: now + 86_400_000 });
    const jobs = (await db.collection('platformWhatsAppJobs').get()).docs.map(d => d.data()).filter(isPlatformJob); expect(jobs.every(j => j.bodyState === 'body_erased' && j.content === null)).toBe(true);
    expect((await db.collection('platformWhatsAppBudgetPeriods').get()).docs.map(d => d.data()).filter(d => d.recordType === 'budget_period')).toEqual(before.filter(d => d.recordType === 'budget_period'));
  });
  it('makes zero external calls when a send permit commit succeeds but both responses are lost', async () => {
    const lease = await audio(), p = (await preparePlatformAudio(lease, env(), now))!;
    await startPlatformAudio(lease, p.audioToken, env(), now);
    await finishPlatformAudio(lease, p.audioToken, { status: 'unknown', actualMicros: null, usage: emptyUsage }, env(), now);
    const fallback = (await preparePlatformAudioFallback(lease, db, now))!, claim = (await createPlatformWorkStore(db, () => now).claimSend(fallback.outboxId))!;
    let syntheticProviderSend = 0;
    const lost = createCloudflareDatabase(async command => {
      const result = await transport(command);
      if (command.action === 'commit' && command.writes.some(w => w.op !== 'delete' && w.path === 'platformWhatsAppOutbox/' + fallback.outboxId && w.data.status === 'started')) throw new StorageError(503, 'DATA_UNAVAILABLE');
      return result;
    });
    await expect(takePlatformSendPermit(fallback.outboxId, claim.token, lost, now).then(permit => { if (permit) syntheticProviderSend++; })).rejects.toMatchObject({ status: 503 });
    const recovered = await takePlatformSendPermit(fallback.outboxId, claim.token, second, now); if (recovered) syntheticProviderSend++;
    expect(syntheticProviderSend).toBe(0);
    expect((await db.collection('platformWhatsAppOutbox').doc(fallback.outboxId).get()).data()).toMatchObject({ status: 'started' });
  });
  it('uses the additive due/body indexes for the exact generated query expressions', async () => {
    const plans = await Promise.all([runtime.db.prepare("EXPLAIN QUERY PLAN SELECT path FROM app_documents WHERE parent = ? AND json_extract(data,'$.status') = ? AND json_extract(data,'$.nextAttemptAt') <= ? ORDER BY json_extract(data,'$.nextAttemptAt') ASC,path ASC LIMIT ?").bind('platformWhatsAppJobs', 'ready', now, 25).all(), runtime.db.prepare("EXPLAIN QUERY PLAN SELECT path FROM app_documents WHERE parent = ? AND json_extract(data,'$.bodyState') = ? AND json_extract(data,'$.bodyExpiresAt') <= ? ORDER BY json_extract(data,'$.bodyExpiresAt') ASC,path ASC LIMIT ?").bind('platformWhatsAppOutbox', 'body_present', now, 50).all()]);
    expect(JSON.stringify(plans[0])).toContain('app_platform_work_due'); expect(JSON.stringify(plans[1])).toContain('app_platform_work_body');
  });
});
