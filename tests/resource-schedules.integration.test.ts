import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createDataTestRuntime } from '../cloudflare/tests/data-runtime.mjs';
import { createCloudflareDatabase, StorageError } from '@/lib/storage/database';
import type { DataCommand } from '../shared/data-protocol';
import { readOwnerResourceSchedules, saveOwnerResourceSchedules } from '@/lib/server/resource-schedules';
import { seedScheduleFixture, scheduleNow } from './resource-schedules-fixture';
let runtime: Awaited<ReturnType<typeof createDataTestRuntime>>;
let loseNext = false;
const commits: DataCommand[] = [];
const connect = () => createCloudflareDatabase(async command => {
  const reply = await runtime.fetch(command), data = await reply.json();
  if (!reply.ok) throw new StorageError(reply.status, data.code);
  if (command.action === 'commit' && command.writes.some(write => write.path.includes('/resourceSchedule'))) {
    commits.push(structuredClone(command));
    if (loseNext) { loseNext = false; throw new Error('Synthetic lost reply after local commit'); }
  }
  return data;
});
beforeEach(async () => { vi.spyOn(Date, 'now').mockReturnValue(scheduleNow); vi.stubEnv('SARIN_RESOURCE_SCHEDULE_WRITES_ENABLED', 'true'); loseNext = false; commits.length = 0; runtime = await createDataTestRuntime(); }, 30000);
afterEach(async () => { await runtime?.dispose(); vi.restoreAllMocks(); vi.unstubAllEnvs(); });
const rules = { weekly: [], exceptions: [], closures: [] };
async function fixture() { const db = connect(), second = connect(), f = await seedScheduleFixture(db), view = await readOwnerResourceSchedules(f.owner, f.business.id, undefined, db); return { ...f, db, second, command: { requestId: 'demo-concurrent-schedule', expectedRevision: 0, expectedBasisFingerprint: view.basisFingerprint, rules } }; }
it('twoHandlesCASAllowsExactlyOneRevision', async () => { const f = await fixture(); const outcomes = await Promise.allSettled([saveOwnerResourceSchedules(f.owner, f.business.id, f.command, f.db), saveOwnerResourceSchedules(f.owner, f.business.id, { ...f.command, requestId: 'demo-competing-schedule' }, f.second)]); expect(outcomes.filter(item => item.status === 'fulfilled')).toHaveLength(1); expect(outcomes.find(item => item.status === 'rejected')).toMatchObject({ reason: { code: 'RESOURCE_SCHEDULE_CHANGED' } }); expect((await f.operations.get()).size).toBe(1); expect((await readOwnerResourceSchedules(f.owner, f.business.id, undefined, f.db)).policy.revision).toBe(1); }, 60000);
it('sameRequestConcurrentCreatesOnePolicyAndReceipt', async () => { const f = await fixture(); const outcomes = await Promise.all([saveOwnerResourceSchedules(f.owner, f.business.id, f.command, f.db), saveOwnerResourceSchedules(f.owner, f.business.id, f.command, f.second)]); expect(outcomes.map(item => item.operation.resultRevision)).toEqual([1, 1]); expect(outcomes.filter(item => item.replayed)).toHaveLength(1); expect((await f.operations.get()).size).toBe(1); }, 60000);
it('lostCommitUsesIdenticalJournalAndReplayAfterNewerEdit', async () => { const f = await fixture(); loseNext = true; await saveOwnerResourceSchedules(f.owner, f.business.id, f.command, f.db); expect(commits).toHaveLength(2); expect(commits[1]).toEqual(commits[0]); await saveOwnerResourceSchedules(f.owner, f.business.id, { ...f.command, requestId: 'demo-following-schedule', expectedRevision: 1 }, f.second); const replay = await saveOwnerResourceSchedules(f.owner, f.business.id, f.command, f.db); expect(replay).toMatchObject({ replayed: true, operation: { resultRevision: 1 }, policy: { revision: 2 } }); expect((await f.operations.get()).size).toBe(2); }, 60000);
it('policyWritesDoNotChangeBusinessPublicAppointmentsQuotaAndCorruptionFails', async () => { const f = await fixture(); const before = (await runtime.db.prepare('SELECT path,data,blob FROM app_documents ORDER BY path').all()).results; await saveOwnerResourceSchedules(f.owner, f.business.id, f.command, f.db); const after = (await runtime.db.prepare("SELECT path,data,blob FROM app_documents WHERE path NOT LIKE '%/resourceSchedule%' ORDER BY path").all()).results; expect(after).toEqual(before); await f.policyRef.set({ version: 99 }); await expect(readOwnerResourceSchedules(f.owner, f.business.id, undefined, f.second)).rejects.toMatchObject({ code: 'RESOURCE_SCHEDULE_UNAVAILABLE' }); }, 60000);
