import { afterEach, beforeEach, it, vi } from 'vitest';
import { createDataTestRuntime } from '../cloudflare/tests/data-runtime.mjs';
import { createCloudflareDatabase, StorageError } from '@/lib/storage/database';
import type { Database } from '@/lib/storage/types';
import type { DataReadResult, DataCommitResult } from '../shared/data-protocol';
import { subjectAdmin, verifyStructuredCases, verifySubjectBindingAndWithdrawal, verifySubjectRaces, verifyLegacyPolicyCompatibility } from './represented-booking-contract';
let runtime: Awaited<ReturnType<typeof createDataTestRuntime>>, db: Database, secondDb: Database;
beforeEach(async () => {
  vi.stubEnv('SUPERADMIN_UID', subjectAdmin.uid); runtime = await createDataTestRuntime();
  const connect = () => createCloudflareDatabase(async command => { const response = await runtime.fetch(command), value = await response.json() as DataReadResult | DataCommitResult; if (!response.ok) throw new StorageError(response.status, (value as unknown as { code: string }).code); return value; });
  db = connect(); secondDb = connect();
}, 30000);
afterEach(async () => { await runtime?.dispose(); vi.unstubAllEnvs(); });
it('real D1 confirms adult self child haircut and pediatrics once without IA usage', async () => { await verifyStructuredCases(db, secondDb); }, 60000);
it('real D1 rejects changed identity and withdrawal and validates canonical receipts', async () => { await verifySubjectBindingAndWithdrawal(db, secondDb); }, 60000);
it('real D1 serializes final quota and withdrawal across independent handles', async () => { await verifySubjectRaces(db, secondDb); }, 60000);
it('real D1 preserves legacy confirmed recovery under changed health policy', async () => { await verifyLegacyPolicyCompatibility(db, secondDb); }, 60000);
