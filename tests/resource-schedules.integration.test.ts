import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createDataTestRuntime } from '../cloudflare/tests/data-runtime.mjs';
import { createCloudflareDatabase, StorageError } from '@/lib/storage/database';
import type { DataCommand } from '../shared/data-protocol';
import { readOwnerResourceSchedules, saveOwnerResourceSchedules } from '@/lib/server/resource-schedules';
import { seedScheduleFixture, scheduleNow } from './resource-schedules-fixture';
import { acceptSyntheticConsent } from './consent-fixtures';
import { createBookingProposal, confirmBookingProposalDetailed } from '@/lib/server/booking-proposals';
import { businessIdForOwner, createBusiness } from '@/lib/server/businesses';
import { businessConfigSchema } from '@/lib/server/schemas';
let runtime: Awaited<ReturnType<typeof createDataTestRuntime>>;
let loseNext = false;
let intercept: ((command: DataCommand) => Promise<void>) | null = null;
const commits: DataCommand[] = [];
const connect = () => createCloudflareDatabase(async command => {
  await intercept?.(command);
  const reply = await runtime.fetch(command), data = await reply.json();
  if (!reply.ok) throw new StorageError(reply.status, data.code);
  if (command.action === 'commit' && command.writes.some(write => write.path.includes('/resourceSchedule'))) {
    commits.push(structuredClone(command));
    if (loseNext) { loseNext = false; throw new Error('Synthetic lost reply after local commit'); }
  }
  return data;
});
beforeEach(async () => { vi.spyOn(Date, 'now').mockReturnValue(scheduleNow); vi.stubEnv('SARIN_RESOURCE_SCHEDULE_WRITES_ENABLED', 'true'); intercept = null; loseNext = false; commits.length = 0; runtime = await createDataTestRuntime(); }, 30000);
afterEach(async () => { await runtime?.dispose(); vi.restoreAllMocks(); vi.unstubAllEnvs(); });
const rules = { weekly: [], exceptions: [], closures: [] };
async function fixture() { const db = connect(), second = connect(), f = await seedScheduleFixture(db), view = await readOwnerResourceSchedules(f.owner, f.business.id, undefined, db); return { ...f, db, second, command: { requestId: 'demo-concurrent-schedule', expectedRevision: 0, expectedBasisFingerprint: view.basisFingerprint, rules } }; }
it('twoHandlesCASAllowsExactlyOneRevision', async () => { const f = await fixture(); const outcomes = await Promise.allSettled([saveOwnerResourceSchedules(f.owner, f.business.id, f.command, f.db), saveOwnerResourceSchedules(f.owner, f.business.id, { ...f.command, requestId: 'demo-competing-schedule' }, f.second)]); expect(outcomes.filter(item => item.status === 'fulfilled')).toHaveLength(1); expect(outcomes.find(item => item.status === 'rejected')).toMatchObject({ reason: { code: 'RESOURCE_SCHEDULE_CHANGED' } }); expect((await f.operations.get()).size).toBe(1); expect((await readOwnerResourceSchedules(f.owner, f.business.id, undefined, f.db)).policy.revision).toBe(1); }, 60000);
it('sameRequestConcurrentCreatesOnePolicyAndReceipt', async () => { const f = await fixture(); const outcomes = await Promise.all([saveOwnerResourceSchedules(f.owner, f.business.id, f.command, f.db), saveOwnerResourceSchedules(f.owner, f.business.id, f.command, f.second)]); expect(outcomes.map(item => item.operation.resultRevision)).toEqual([1, 1]); expect(outcomes.filter(item => item.replayed)).toHaveLength(1); expect((await f.operations.get()).size).toBe(1); }, 60000);
it('lostCommitUsesIdenticalJournalAndReplayAfterNewerEdit', async () => { const f = await fixture(); loseNext = true; await saveOwnerResourceSchedules(f.owner, f.business.id, f.command, f.db); expect(commits).toHaveLength(2); expect(commits[1]).toEqual(commits[0]); await saveOwnerResourceSchedules(f.owner, f.business.id, { ...f.command, requestId: 'demo-following-schedule', expectedRevision: 1 }, f.second); const replay = await saveOwnerResourceSchedules(f.owner, f.business.id, f.command, f.db); expect(replay).toMatchObject({ replayed: true, operation: { resultRevision: 1 }, policy: { revision: 2 } }); expect((await f.operations.get()).size).toBe(2); }, 60000);
it('policyWritesDoNotChangeBusinessPublicAppointmentsQuotaAndCorruptionFails', async () => { const f = await fixture(); const before = (await runtime.db.prepare('SELECT path,data,blob FROM app_documents ORDER BY path').all()).results; await saveOwnerResourceSchedules(f.owner, f.business.id, f.command, f.db); const after = (await runtime.db.prepare("SELECT path,data,blob FROM app_documents WHERE path NOT LIKE '%/resourceSchedule%' ORDER BY path").all()).results; expect(after).toEqual(before); await f.policyRef.set({ version: 99 }); await expect(readOwnerResourceSchedules(f.owner, f.business.id, undefined, f.second)).rejects.toMatchObject({ code: 'RESOURCE_SCHEDULE_UNAVAILABLE' }); }, 60000);

function pauseCommit(predicate: (command: Extract<DataCommand, { action: 'commit' }>) => boolean) {
  let release!: () => void, entered!: () => void, paused = false;
  const ready = new Promise<void>(resolve => { entered = resolve; }), wait = new Promise<void>(resolve => { release = resolve; });
  intercept = async command => { if (!paused && command.action === 'commit' && predicate(command)) { paused = true; entered(); await wait; } };
  return { ready, release };
}
async function proposed() {
  const db = connect(), second = connect(), f = await seedScheduleFixture(db, true, businessIdForOwner('demo-s09-owner'));
  await acceptSyntheticConsent(db, f.owner.uid, f.business);
  const business = { ...f.business, subscription: { status: 'trial' as const, trialEndsAt: 0, currentPeriodEndsAt: 0, paidTrial: { paymentId: 'demo-paid', activatedAt: scheduleNow, appointmentLimit: 10 as const, appointmentsUsed: 0 } } };
  await f.ref.set(business);
  const proposal = await createBookingProposal(f.owner, business.id, { dateKey: '2030-01-07', startTimeStr: '10:00', serviceId: 's', resourceId: 'a' }, 'demo-race-proposal', db);
  const state = await readOwnerResourceSchedules(f.owner, business.id, undefined, second);
  const command = { requestId: 'demo-race-closure', expectedRevision: 0, expectedBasisFingerprint: state.basisFingerprint, rules: { weekly: [], exceptions: [], closures: [{ id: 'closed', scope: 'business' as const, fromDateKey: '2030-01-07', throughDateKey: '2030-01-07', interval: null, label: '' }] } };
  return { ...f, business, db, second, proposal, command };
}
const contact = { clientPhone: '573001234567', intakeAnswers: {} };
it('scheduleRaceClosureFirstRejectsConfirmationWithoutQuotaUse', async () => {
  const f = await proposed(), barrier = pauseCommit(command => command.writes.some(row => row.path.includes('/appointments/')));
  const pending = confirmBookingProposalDetailed(f.owner, f.business.id, f.proposal.id, contact, f.db).then(value => ({ value }), error => ({ error }));
  await Promise.race([barrier.ready, pending.then(result => { if ('error' in result) throw result.error; })]);
  await saveOwnerResourceSchedules(f.owner, f.business.id, f.command, f.second); barrier.release();
  expect(await pending).toMatchObject({ error: { status: 409 } });
  expect((await f.ref.collection('appointments').get()).size).toBe(0);
  expect((await f.ref.get()).data()?.subscription).toMatchObject({ paidTrial: { appointmentsUsed: 0 } });
  expect((await f.db.collection('bookingProposals').doc(f.proposal.id).get()).data()?.appointmentId).toBeNull();
}, 60000);
it('scheduleRacePreservesCommittedExistingAppointment', async () => {
  const f = await proposed(), barrier = pauseCommit(command => command.writes.some(row => row.path.includes('/resourceSchedulePolicies/')));
  const pending = saveOwnerResourceSchedules(f.owner, f.business.id, f.command, f.second); await barrier.ready;
  const first = await confirmBookingProposalDetailed(f.owner, f.business.id, f.proposal.id, contact, f.db); barrier.release(); await pending;
  expect(await confirmBookingProposalDetailed(f.owner, f.business.id, f.proposal.id, contact, f.db)).toEqual(first);
  expect((await f.ref.collection('appointments').get()).size).toBe(1);
  expect((await f.ref.get()).data()?.subscription).toMatchObject({ paidTrial: { appointmentsUsed: 1 } });
  expect((await f.policyRef.get()).data()?.revision).toBe(1);
}, 60000);
it('commonScheduleRaceRechecksAvailability', async () => {
  const f = await proposed(), barrier = pauseCommit(command => command.writes.some(row => row.path.includes('/appointments/')));
  const pending = confirmBookingProposalDetailed(f.owner, f.business.id, f.proposal.id, contact, f.db).then(value => ({ value }), error => ({ error })); await Promise.race([barrier.ready, pending.then(result => { if ('error' in result) throw result.error; })]);
  const config = businessConfigSchema.parse({ name: f.business.name, slug: f.business.slug, category: f.business.category, phoneWhatsApp: f.business.phoneWhatsApp, resources: f.business.resources, services: f.business.services, intakeFields: [], weeklySchedule: { ...f.business.weeklySchedule, 1: { isOpen: false, intervals: [] } } });
  await createBusiness(f.owner, config, f.second); barrier.release();
  expect(await pending).toMatchObject({ error: { status: 409 } });
  expect((await f.ref.collection('appointments').get()).size).toBe(0);
}, 60000);
