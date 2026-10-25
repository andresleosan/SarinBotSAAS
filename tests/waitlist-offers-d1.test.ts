import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createDataTestRuntime } from '../cloudflare/tests/data-runtime.mjs';
import { createCloudflareDatabase, StorageError } from '@/lib/storage/database';
import type { Database } from '@/lib/storage/types';
import type { DataCommand, DataCommitResult, DataReadResult } from '../shared/data-protocol';
import { subjectAdmin } from './represented-booking-contract';
import { confirmClientWaitlistOffer } from '@/lib/server/waitlist-offers';
import { raceContact, raceFixture, registerWaitlistOfferRaces, verifyRecovery } from './waitlist-offers-race-contract';

let runtime: Awaited<ReturnType<typeof createDataTestRuntime>>, db: Database, second: Database;
let loseReply = false;
const journals: Extract<DataCommand, { action: 'commit' }>[] = [];
beforeEach(async () => {
  vi.stubEnv('SUPERADMIN_UID', subjectAdmin.uid); vi.stubEnv('SARIN_WAITLIST_OFFERS_ENABLED', 'true');
  runtime = await createDataTestRuntime(); loseReply = false; journals.length = 0;
  const connect = () => createCloudflareDatabase(async command => {
    const response = await runtime.fetch(command), result = await response.json() as DataReadResult | DataCommitResult;
    if (!response.ok) throw new StorageError(response.status, (result as unknown as { code: string }).code);
    if (loseReply && command.action === 'commit' && command.writes.some(w => w.op !== 'delete' && w.path.includes('/waitlistOffers/') && w.data.state === 'booked')) {
      journals.push(structuredClone(command));
      if (journals.length === 1) throw new StorageError(503, 'DATA_UNAVAILABLE');
    }
    return result;
  });
  db = connect(); second = connect();
}, 30000);
afterEach(async () => { await runtime?.dispose(); vi.restoreAllMocks(); vi.unstubAllEnvs(); });

registerWaitlistOfferRaces('d1', () => ({ db, second }));
it('lost response after actual D1 booked commit retries the exact journal and retains original proof/current appointment with one quota', async () => {
  const f = await raceFixture(db, second); loseReply = true;
  const result = await confirmClientWaitlistOffer(f.actor, f.business.id, f.offerId, raceContact, db);
  expect(journals).toHaveLength(2); expect(journals[1]).toEqual(journals[0]);
  expect(journals[0].writes.filter(w => w.path.includes('/appointments/'))).toHaveLength(1);
  expect(journals[0].writes.filter(w => w.path === f.requestRef.path)).toHaveLength(1);
  const replay = await confirmClientWaitlistOffer(f.actor, f.business.id, f.offerId, { clientPhone: null, intakeAnswers: null }, second);
  expect(replay).toEqual({ ...result, replayed: true });
  loseReply = false;
  await verifyRecovery(f, result);
}, 60000);
