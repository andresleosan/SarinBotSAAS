import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createDataTestRuntime } from '../cloudflare/tests/data-runtime.mjs';
import { createCloudflareDatabase, StorageError } from '@/lib/storage/database';
import type { Database } from '@/lib/storage/types';
import type { DataCommand, DataCommitResult, DataReadResult } from '../shared/data-protocol';
import { seedFactualFaqScenario, factualFaqNow, syntheticFaqItems } from './business-factual-faq-contract';
import { readOwnerFactualFaq, saveOwnerFactualFaq, readClientFactualFaqTopics } from '@/lib/server/business-factual-faq';
import { bookingDataPolicyKey } from '@/lib/server/booking-data-policy';
let runtime: Awaited<ReturnType<typeof createDataTestRuntime>>, db: Database, second: Database;
let before: ((command: DataCommand) => Promise<void>) | undefined, after: ((command: DataCommand) => Promise<void>) | undefined;
const connect = () => createCloudflareDatabase(async command => { await before?.(command); const response = await runtime.fetch(command), value = await response.json() as DataReadResult | DataCommitResult; if (!response.ok) throw new StorageError(response.status, (value as unknown as { code: string }).code); await after?.(command); return value; });
beforeEach(async () => { vi.spyOn(Date, 'now').mockReturnValue(factualFaqNow); before = undefined; after = undefined; runtime = await createDataTestRuntime(); db = connect(); second = connect(); }, 30000);
afterEach(async () => { await runtime?.dispose(); vi.restoreAllMocks(); });
const command = (requestId = 'demo-faq-d1-one', expectedRevision = 0) => ({ requestId, expectedRevision, expectedPolicyRevision: 1, items: syntheticFaqItems });
const faqCommit = (c: DataCommand) => c.action === 'commit' && c.writes.some(w => w.path.includes('/factualFaq/'));
it('concurrentOwnerCommandsOnlyApplyOneRevisionAndOneAtomicReceipt', async () => { const f = await seedFactualFaqScenario(db); const results = await Promise.allSettled([saveOwnerFactualFaq(f.owner, f.business.id, command(), db), saveOwnerFactualFaq(f.owner, f.business.id, command('demo-faq-d1-rival'), second)]); expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1); expect(results.find(r => r.status === 'rejected')).toMatchObject({ reason: { status: 409, code: 'FACTUAL_FAQ_CHANGED' } }); expect((await f.stateRef.get()).data()?.revision).toBe(1); expect((await f.operations.get()).docs).toHaveLength(1); expect((await f.ref.get()).data()).toEqual(f.business); }, 60000);
it('lostCommitResponseRetriesIdenticalJournalAndReplayKeepsLaterState', async () => { const f = await seedFactualFaqScenario(db); const commits: DataCommand[] = []; let lost = false; after = async c => { if (faqCommit(c)) { commits.push(structuredClone(c)); if (!lost) { lost = true; throw new Error('Synthetic lost response after commit'); } } }; try { await saveOwnerFactualFaq(f.owner, f.business.id, command(), db); } catch (error) { expect(error).toBeInstanceOf(Error); } expect(lost).toBe(true); const found = await readOwnerFactualFaq(f.owner, f.business.id, command().requestId, second); expect(found.applied?.revision).toBe(1); expect(found.state.revision).toBe(1); const replay = await saveOwnerFactualFaq(f.owner, f.business.id, command(), second); expect(replay.applied).toEqual(found.applied); expect(commits.length).toBeGreaterThan(0); for (const c of commits) expect(c).toEqual(commits[0]); after = undefined; await saveOwnerFactualFaq(f.owner, f.business.id, { ...command('demo-faq-d1-later', 1), items: [] }, db); const old = await saveOwnerFactualFaq(f.owner, f.business.id, command(), second); expect(old.state.revision).toBe(2); expect(old.applied).toEqual(found.applied); expect((await f.operations.get()).docs).toHaveLength(2); }, 60000);
it('policyRaceRetriesClientReadAndFailsClosed', async () => { const f = await seedFactualFaqScenario(db); await saveOwnerFactualFaq(f.owner, f.business.id, command(), db); let changed = false; const ref = second.collection('serverSettings').doc(bookingDataPolicyKey(f.business.id)); after = async c => { if (!changed && c.action === 'read' && c.read.kind === 'document' && c.read.path === ref.path) { changed = true; const policy = (await ref.get()).data()!; await ref.set({ ...policy, revision: 2, dataMode: 'health' }); } }; await expect(readClientFactualFaqTopics(f.client, f.business.id, db)).rejects.toMatchObject({ status: 409, code: 'FACTUAL_FAQ_UNSUPPORTED' }); expect(changed).toBe(true); }, 60000);
it('failedCASNeverWritesHalfStateAndReceiptAndWorkerRejectsUnknownChild', async () => { const f = await seedFactualFaqScenario(db); await expect(saveOwnerFactualFaq(f.owner, f.business.id, { ...command(), expectedPolicyRevision: 0 }, db)).rejects.toMatchObject({ status: 409 }); expect((await f.stateRef.get()).exists).toBe(false); expect((await f.operations.get()).docs).toHaveLength(0); const denied = await runtime.fetch({ action: 'read', read: { kind: 'document', path: ['businesses', f.business.id, 'factualFaqPublic', 'current'].join('/') } }); expect(denied.status).toBe(400); }, 60000);

it('previousWorkerRejectsFaqBeforeAnyPartialWrite', async () => {
  await runtime.dispose(); runtime = await createDataTestRuntime({ previousFactualFaqChildren: true }); db = connect();
  const f = await seedFactualFaqScenario(db);
  await expect(saveOwnerFactualFaq(f.owner, f.business.id, command(), db)).rejects.toBeDefined();
  const rows = (await runtime.db.prepare("SELECT path FROM app_documents WHERE path LIKE '%/factualFaq/%' OR path LIKE '%/factualFaqOperations/%'").all()).results;
  expect(rows).toEqual([]);
  const schedules = await runtime.fetch({ action: 'read', read: { kind: 'document', path: `businesses/${f.business.id}/resourceSchedulePolicies/current` } });
  expect(schedules.status).toBe(200);
}, 60000);
