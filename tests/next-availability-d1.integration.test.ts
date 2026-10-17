import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import { createDataTestRuntime } from '../cloudflare/tests/data-runtime.mjs';
import { createCloudflareDatabase, StorageError } from '@/lib/storage/database';
import type { DataReadResult, DataCommitResult } from '../shared/data-protocol';
import type { Database } from '@/lib/storage/types';
import { readNextStructuredAvailability } from '@/lib/server/structured-booking';
import { subjectAdmin, subjectFixture } from './represented-booking-contract';

let runtime: Awaited<ReturnType<typeof createDataTestRuntime>>, db: Database;
beforeAll(async () => {
  runtime = await createDataTestRuntime();
  db = createCloudflareDatabase(async command => {
    const response = await runtime.fetch(command);
    const result = await response.json() as DataReadResult | DataCommitResult | { code: string };
    if (!response.ok) throw new StorageError(response.status, (result as { code: string }).code);
    return result as DataReadResult | DataCommitResult;
  });
}, 30_000);
afterAll(async () => { await runtime?.dispose(); });
afterEach(() => vi.unstubAllEnvs());

// Integration verification of the TDD-covered domain through actual local D1/Workerd.
it('searches the bounded date range on real D1 without including other tenants or writing data', async () => {
  vi.stubEnv('SUPERADMIN_UID', subjectAdmin.uid);
  const f = await subjectFixture(db, 'general', false);
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(Date.now());
  const shifted = (days: number) => new Date(Date.parse(`${today}T12:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
  const business = { ...f.business, weeklySchedule: Object.fromEntries(Array.from({ length: 7 }, (_, day) => [day, { isOpen: true, intervals: [{ start: '09:00', end: '10:00' }] }])) };
  await db.collection('businesses').doc(business.id).set(business);
  for (const resourceId of ['one', 'two']) {
    await db.collection('businesses').doc(business.id).collection('appointments').doc(`block-${resourceId}`).set({ tenantId: business.id, dateKey: shifted(1), resourceId, status: 'confirmed', type: 'manual_block', startTimeStr: '09:00', endTimeStr: '10:00' });
    await db.collection('businesses').doc('demo-other-next-business').collection('appointments').doc(`foreign-${resourceId}`).set({ tenantId: 'demo-other-next-business', dateKey: shifted(2), resourceId, status: 'confirmed', type: 'manual_block', startTimeStr: '09:00', endTimeStr: '10:00' });
  }
  const before = await runtime.db.prepare('SELECT COUNT(*) AS count FROM app_documents').first();
  const result = await readNextStructuredAvailability(f.actor, business.id, { case: { bookingRequestId: f.subjectCase.bookingRequestId, subjectKind: 'self' }, afterDateKey: today, serviceId: 'cut' }, db);
  expect(result).toMatchObject({ dateKey: shifted(2), fromDateKey: shifted(1), throughDateKey: shifted(14) });
  expect(result.availability.every(resource => resource.slots.length > 0)).toBe(true);
  expect(await runtime.db.prepare('SELECT COUNT(*) AS count FROM app_documents').first()).toEqual(before);
  expect((await db.collection('bookingProposals').get()).size).toBe(0);
}, 30_000);
