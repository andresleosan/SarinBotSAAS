import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Business } from '@/types/firestore';
import type { Database, Query, Transaction } from '@/lib/storage/types';
import { readNextStructuredAvailability } from '@/lib/server/structured-booking';
import { consentStateKey } from '@/lib/server/consent';
import { clientPolicyKey } from '@/lib/server/client-policy';
import { bookingDataPolicyKey } from '@/lib/server/booking-data-policy';
import { StorageError } from '@/lib/storage/database';
import { acceptSyntheticSubjectConsent } from './consent-fixtures';
import { memoryFirestore } from './memoryFirestore';
import { subjectAdmin, subjectFixture } from './represented-booking-contract';

beforeEach(() => {
  vi.stubEnv('SUPERADMIN_UID', subjectAdmin.uid);
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-17T14:00:00Z'));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.useRealTimers(); });

async function fixture(mode: 'general' | 'health' = 'general', minors = false) {
  const store = memoryFirestore(), f = await subjectFixture(store.db, mode, minors);
  const business: Business = { ...f.business, weeklySchedule: Object.fromEntries(Array.from({ length: 7 }, (_, day) => [day, { isOpen: true, intervals: [{ start: '09:00', end: '10:00' }] }])) };
  await store.db.collection('businesses').doc(business.id).set(business);
  const subjectCase = mode === 'health' || minors ? f.subjectCase : { bookingRequestId: 'demo-next-case', subjectKind: 'self' as const };
  const input = { case: subjectCase, afterDateKey: '2026-10-17', serviceId: 'cut' };
  const read = (overrides: Partial<typeof input> & { resourceId?: string } = {}, db: Database = store.db) => readNextStructuredAvailability(f.actor, business.id, { ...input, ...overrides }, db);
  return { ...store, ...f, business, input, read };
}
async function block(f: Awaited<ReturnType<typeof fixture>>, dateKey: string, resourceId: string, extra: Record<string, unknown> = {}) {
  await f.db.collection('businesses').doc(f.business.id).collection('appointments').doc(`block-${dateKey}-${resourceId}`).set({ tenantId: f.business.id, dateKey, resourceId, serviceId: 'cut', type: 'block', status: 'confirmed', startTimeStr: '09:00', endTimeStr: '10:00', ...extra });
}

it('skips weekly closures and confirmed blocks to return the first day with slots without mutating data', async () => {
  const f = await fixture(); f.business.weeklySchedule[0].isOpen = false;
  await f.db.collection('businesses').doc(f.business.id).set(f.business);
  await block(f, '2026-10-19', 'one'); await block(f, '2026-10-19', 'two');
  const before = structuredClone([...f.rows]);
  expect(await f.read()).toEqual({ dateKey: '2026-10-20', fromDateKey: '2026-10-18', throughDateKey: '2026-10-31', availability: [
    { resourceId: 'one', resourceName: 'Uno', slots: ['09:00', '09:15', '09:30'] },
    { resourceId: 'two', resourceName: 'Dos', slots: ['09:00', '09:15', '09:30'] },
  ] });
  expect([...f.rows]).toEqual(before);
});

it('honors existing and requested service buffers, cancellations, and the explicit professional', async () => {
  const f = await fixture(); f.business.services[0].bufferMinutes = 15;
  f.business.weeklySchedule[0].intervals = [{ start: '09:00', end: '11:00' }];
  await f.db.collection('businesses').doc(f.business.id).set(f.business);
  await block(f, '2026-10-18', 'one', { type: 'appointment', endTimeStr: '09:30' });
  await block(f, '2026-10-18', 'two', { status: 'cancelled_by_client' });
  expect((await f.read({ resourceId: 'one' })).availability).toEqual([{ resourceId: 'one', resourceName: 'Uno', slots: ['09:45', '10:00', '10:15'] }]);
  expect((await f.read()).availability.find(item => item.resourceId === 'two')?.slots[0]).toBe('09:00');
});

it('uses any available professional but searches later when the selected professional is full', async () => {
  const f = await fixture(); await block(f, '2026-10-18', 'one');
  expect(await f.read()).toMatchObject({ dateKey: '2026-10-18', availability: [{ resourceId: 'one', slots: [] }, { resourceId: 'two', slots: ['09:00', '09:15', '09:30'] }] });
  expect(await f.read({ resourceId: 'one' })).toMatchObject({ dateKey: '2026-10-19', availability: [{ resourceId: 'one', slots: ['09:00', '09:15', '09:30'] }] });
});

it('clamps a past selection to today in Colombia and excludes elapsed slots', async () => {
  vi.setSystemTime(new Date('2026-10-18T02:10:00Z'));
  const f = await fixture(); f.business.weeklySchedule[6].intervals = [{ start: '20:00', end: '22:00' }];
  await f.db.collection('businesses').doc(f.business.id).set(f.business);
  expect(await f.read({ afterDateKey: '2026-10-01', resourceId: 'one' })).toEqual({ dateKey: '2026-10-17', fromDateKey: '2026-10-17', throughDateKey: '2026-10-30', availability: [{ resourceId: 'one', resourceName: 'Uno', slots: ['21:15', '21:30'] }] });
});

it('returns an empty result after fourteen full days even when the fifteenth day is free', async () => {
  const f = await fixture();
  for (let day = 18; day <= 31; day++) await block(f, `2026-10-${day}`, 'one');
  expect(await f.read({ resourceId: 'one' })).toEqual({ dateKey: null, availability: [], fromDateKey: '2026-10-18', throughDateKey: '2026-10-31' });
});

it('advances dates across the year boundary', async () => {
  vi.setSystemTime(new Date('2026-12-31T14:00:00Z')); const f = await fixture();
  expect(await f.read({ afterDateKey: '2026-12-31' })).toMatchObject({ dateKey: '2027-01-01', fromDateKey: '2027-01-01', throughDateKey: '2027-01-14' });
});

it('clips the search at the existing 366 day horizon and rejects an interval beyond it', async () => {
  const f = await fixture();
  expect(await f.read({ afterDateKey: '2027-10-17' })).toMatchObject({ dateKey: '2027-10-18', fromDateKey: '2027-10-18', throughDateKey: '2027-10-18' });
  await expect(f.read({ afterDateKey: '2027-10-18' })).rejects.toMatchObject({ status: 400 });
});

it.each(['missing-service', 'missing-resource', 'inactive-resource', 'unassigned-resource', 'no-active-resource'] as const)('rejects an invalid catalog selection: %s', async invalid => {
  const f = await fixture();
  if (invalid === 'inactive-resource') f.business.resources[0].active = false;
  if (invalid === 'unassigned-resource') f.business.services[0].resourceIds = ['two'];
  if (invalid === 'no-active-resource') f.business.resources.forEach(resource => { resource.active = false; });
  await f.db.collection('businesses').doc(f.business.id).set(f.business);
  const input = invalid === 'missing-service' ? { serviceId: 'ghost' } : invalid === 'no-active-resource' ? {} : { resourceId: invalid === 'missing-resource' ? 'ghost' : 'one' };
  await expect(f.read(input)).rejects.toMatchObject({ status: 400 });
});

it.each(['account', 'business-client', 'configuration', 'subscription', 'blocked', 'client-limit'] as const)('enforces the existing booking guard: %s', async guard => {
  const f = await fixture(); let status = 403;
  if (guard === 'account' || guard === 'business-client') {
    await f.db.collection('serverSettings').doc(consentStateKey(f.actor.uid, guard === 'account' ? 'account' : 'business_client', guard === 'account' ? null : f.business.id)).delete(); status = 428;
  }
  if (guard === 'configuration') { f.business.sarinConfig.onboardingCompleted = false; await f.db.collection('businesses').doc(f.business.id).set(f.business); }
  if (guard === 'subscription') { f.business.subscription.status = 'suspended'; await f.db.collection('businesses').doc(f.business.id).set(f.business); status = 402; }
  if (guard === 'blocked') await f.db.collection('businesses').doc(f.business.id).collection('clientPolicies').doc(clientPolicyKey(f.actor.uid)).set({ version: 1, blocked: true, futureAppointmentLimit: null, reason: 'Demo pause', updatedBy: f.owner.uid, updatedAt: Date.now() });
  if (guard === 'client-limit') {
    for (let index = 0; index < 3; index++) await block(f, `2026-10-${20 + index}`, 'one', { type: 'appointment', client: { uid: f.actor.uid }, startAt: Date.now() + (index + 1) * 86400000 });
    status = 409;
  }
  const before = structuredClone([...f.rows]);
  await expect(f.read()).rejects.toMatchObject({ status }); expect([...f.rows]).toEqual(before);
});

it('requires current health and minor permissions and enforces the intake policy', async () => {
  const f = await fixture('health', true);
  await expect(f.read()).rejects.toMatchObject({ status: 428 });
  await acceptSyntheticSubjectConsent(f.db, f.actor, f.business, f.input.case, f.policy);
  expect(await f.read()).toMatchObject({ dateKey: '2026-10-18' });
  f.business.sarinConfig.intakeFields = [{ key: 'private', label: 'Demo', required: false }];
  await f.db.collection('businesses').doc(f.business.id).set(f.business);
  await expect(f.read()).rejects.toMatchObject({ code: 'BOOKING_FREE_INTAKE_NOT_ALLOWED' });
  f.business.sarinConfig.intakeFields = []; await f.db.collection('businesses').doc(f.business.id).set(f.business);
  const policyRef = f.db.collection('serverSettings').doc(bookingDataPolicyKey(f.business.id));
  await policyRef.set({ ...(await policyRef.get()).data(), representedMinorsEnabled: false });
  await expect(f.read()).rejects.toMatchObject({ code: 'REPRESENTED_BOOKING_DISABLED' });
});

function interceptRangeReads(db: Database, effect: (query: { filters: [string, string, unknown][]; cap: number }) => void | Promise<void>) {
  const transact = db.runTransaction.bind(db);
  vi.spyOn(db, 'runTransaction').mockImplementation(handler => transact(async tx => {
    const get = tx.get.bind(tx);
    const wrapped = { ...tx, get: async (target: Query) => {
      const query = target as Query & { filters?: [string, string, unknown][]; cap: number };
      if (query.filters?.some(([field]) => field === 'dateKey')) await effect({ filters: query.filters, cap: query.cap });
      return get(target);
    } } as Transaction;
    return handler(wrapped);
  }));
}

it('excludes a slot that starts while the appointments query is pending', async () => {
  vi.setSystemTime(new Date('2026-10-18T13:59:59Z'));
  const f = await fixture(); let entered!: () => void, release!: () => void;
  const paused = new Promise<void>(resolve => { entered = resolve; }), resumed = new Promise<void>(resolve => { release = resolve; });
  interceptRangeReads(f.db, async () => { entered(); await resumed; });
  const pending = f.read({ resourceId: 'one' });
  await paused;
  vi.setSystemTime(new Date('2026-10-18T14:00:01Z')); release();
  expect(await pending).toEqual({ dateKey: '2026-10-18', fromDateKey: '2026-10-18', throughDateKey: '2026-10-31', availability: [{ resourceId: 'one', resourceName: 'Uno', slots: ['09:15', '09:30'] }] });
});

it('bounds the confirmed appointments to one untruncated range query', async () => {
  const f = await fixture(), reads: { filters: [string, string, unknown][]; cap: number }[] = [];
  interceptRangeReads(f.db, query => { reads.push(query); });
  await f.read();
  expect(reads).toHaveLength(1);
  expect(reads[0].filters).toEqual(expect.arrayContaining([['dateKey', '>=', '2026-10-18'], ['dateKey', '<=', '2026-10-31'], ['status', '==', 'confirmed']]));
  expect(reads[0].cap).toBe(Infinity);
});

it.each([new Error('Read failed'), new StorageError(413, 'DATA_LIMIT')])('propagates storage failure instead of inventing availability or an empty result: %s', async failure => {
  const f = await fixture(); interceptRangeReads(f.db, () => { throw failure; });
  const before = structuredClone([...f.rows]);
  await expect(f.read()).rejects.toBe(failure); expect([...f.rows]).toEqual(before);
});
