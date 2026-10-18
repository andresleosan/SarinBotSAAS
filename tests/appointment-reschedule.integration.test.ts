import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createDataTestRuntime } from '../cloudflare/tests/data-runtime.mjs';
import { createCloudflareDatabase, StorageError } from '@/lib/storage/database';
import type { Database } from '@/lib/storage/types';
import type { DataCommand, DataReadResult, DataCommitResult } from '../shared/data-protocol';
import { createBookingProposal, confirmBookingProposalDetailed } from '@/lib/server/booking-proposals';
import { rescheduleActor, rescheduleBusiness, rescheduleContact, rescheduleNow, rescheduleSelection, rescheduleSource, rescheduleSourcePath, seedRescheduleScenario, verifyRescheduleAtomicMove, verifyRescheduleCancelRace, verifyRescheduleCrossResourceLocks, verifyRescheduleDestinationRace, verifyRescheduleReplayAfterAnotherMove, verifyRescheduleSourceRace } from './appointment-reschedule-contract';

let runtime: Awaited<ReturnType<typeof createDataTestRuntime>>, db: Database, secondDb: Database;
let dropResponse = false;
const lostCommits: Extract<DataCommand, { action: 'commit' }>[] = [];
beforeEach(async () => {
  vi.spyOn(Date, 'now').mockReturnValue(rescheduleNow);
  runtime = await createDataTestRuntime();
  const connect = () => createCloudflareDatabase(async command => {
    const response = await runtime.fetch(command);
    const value = await response.json() as DataReadResult | DataCommitResult;
    if (!response.ok) throw new StorageError(response.status, (value as unknown as { code: string }).code);
    if (dropResponse && command.action === 'commit' && command.writes.some(write => write.path === rescheduleSourcePath)) {
      lostCommits.push(structuredClone(command));
      if (lostCommits.length === 1) throw new StorageError(503, 'DATA_UNAVAILABLE');
    }
    return value;
  });
  db = connect(); secondDb = connect();
  dropResponse = false; lostCommits.length = 0;
}, 30000);
afterEach(async () => { await runtime?.dispose(); vi.restoreAllMocks(); });

// The domain behavior was implemented test-first in memory; these independently
// exercise its real local storage boundary, without network or credentials.
it('real D1 atomically moves one document with deduplicated locks and same-proposal replay', async () => { await verifyRescheduleAtomicMove(db, secondDb); }, 60000);
it('real D1 updates origin destination and client locks across resource and date', async () => { await verifyRescheduleCrossResourceLocks(db, secondDb); }, 60000);
it('real D1 serializes two source-revision competitors across separate handles', async () => { await verifyRescheduleSourceRace(db, secondDb); }, 60000);
it.each(['booking', 'manual'] as const)('real D1 serializes a reschedule against a destination %s', async blocker => { await verifyRescheduleDestinationRace(db, secondDb, blocker); }, 60000);
it('real D1 serializes cancellation against a reschedule without losing the source', async () => { await verifyRescheduleCancelRace(db, secondDb); }, 60000);
it('real D1 retains original operation evidence across A to B to A and later cancellation', async () => { await verifyRescheduleReplayAfterAnotherMove(db, secondDb); }, 60000);
it('real D1 retries the identical journaled commit after a lost response', async () => {
  await seedRescheduleScenario(db);
  const proposal = await createBookingProposal(rescheduleActor, rescheduleBusiness.id, rescheduleSelection, 'demo-lost-response', db, undefined, { appointmentId: rescheduleSource.id, sourceRevision: 0 });
  dropResponse = true;
  const confirmed = await confirmBookingProposalDetailed(rescheduleActor, rescheduleBusiness.id, proposal.id, rescheduleContact, db);
  expect(lostCommits).toHaveLength(2);
  expect(lostCommits[1]).toEqual(lostCommits[0]);
  expect(confirmed.appointment).toMatchObject({ id: 'demo-original-appointment', rescheduleRevision: 1, startTimeStr: '10:00' });
  const recovered = await confirmBookingProposalDetailed(rescheduleActor, rescheduleBusiness.id, proposal.id, {} as never, secondDb);
  expect(recovered).toEqual(confirmed);
  expect((await secondDb.collection('businesses').doc(rescheduleBusiness.id).collection('appointments').get()).size).toBe(1);
  expect((await secondDb.collection('businesses').doc(rescheduleBusiness.id).get()).data()).toEqual(rescheduleBusiness);
}, 60000);
