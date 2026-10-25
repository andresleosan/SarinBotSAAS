import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Appointment, Business } from '@/types/firestore';
import type { Database, DocumentReference, Query, Transaction } from '@/lib/storage/types';
import { createAppointmentInTransaction, prepareAppointmentInTransaction } from '@/lib/server/bookings';
import { bookingDataPolicyKey } from '@/lib/server/booking-data-policy';
import { consentedFirestore } from './consent-fixtures';

const now = 1893499200000;
const user = { uid: 'demo-preparation-client', name: 'Cliente demo', email: 'demo@example.test' };
const business: Business = {
  id: 'demo-preparation-business', ownerUid: 'demo-preparation-owner', ownerEmail: 'owner@example.test',
  name: 'Negocio demo', slug: 'demo-preparation', category: 'Servicios', timezone: 'America/Bogota', phoneWhatsApp: '573001234567',
  subscription: { status: 'active', trialEndsAt: 0, currentPeriodEndsAt: now + 30 * 86400000 },
  sarinConfig: { onboardingCompleted: true, tone: '', customRules: '', intakeFields: [] },
  resources: [{ id: 'demo-chair', name: 'Silla demo', active: true }],
  services: [{ id: 'demo-cut', name: 'Corte demo', durationMinutes: 30, bufferMinutes: 15, price: 20000, resourceIds: ['demo-chair'] }],
  weeklySchedule: { 1: { isOpen: true, intervals: [{ start: '09:00', end: '11:00' }] } }, createdAt: now,
};
const input = { dateKey: '2030-01-07', startTimeStr: '09:00', serviceId: 'demo-cut', resourceId: 'demo-chair', clientPhone: '573001234567', intakeAnswers: {} };
const requestId = 'demo-preparation-request';
// Independently calculated fixture IDs and timestamps; no production builders compute expectations.
const appointmentId = '3adee741e402af7ece9877ea8ac3c2020dedba52440fa45321b1b589e5c3019b';
const root = 'businesses/demo-preparation-business';
const appointmentPath = `${root}/appointments/${appointmentId}`;
const resourceLockPath = `${root}/bookingLocks/2030-01-07_demo-chair`;
const clientKey = '30bbeabcbc238e41ee05a37c177d91fc2691e547ce46e3a5fb4003d707b438bf';
const clientLockPath = `${root}/bookingLocks/client_${clientKey}`;
const expectedAppointment: Appointment = {
  id: appointmentId, tenantId: 'demo-preparation-business', dateKey: '2030-01-07', startTimeStr: '09:00', endTimeStr: '09:30',
  startAt: 1894024800000, endAt: 1894026600000, reservedUntilAt: 1894027500000,
  type: 'appointment', resourceId: 'demo-chair', serviceId: 'demo-cut', serviceName: 'Corte demo', price: 20000,
  client: { uid: 'demo-preparation-client', name: 'Cliente demo', email: 'demo@example.test', phone: '573001234567', intakeAnswers: {} },
  status: 'confirmed', createdBy: 'sarin_client', createdAt: 1893499200000,
};
const trialBusiness = (used = 9): Business => ({ ...business, subscription: { status: 'trial', trialEndsAt: 0, currentPeriodEndsAt: 0, paidTrial: { paymentId: 'demo-paid-receipt', activatedAt: now, appointmentLimit: 10, appointmentsUsed: used } } });

type Write = { kind: 'set' | 'create' | 'delete'; path: string; data?: object };
function fixture(value = business, extra: Record<string, object> = {}, consent = true) {
  const initial = { [root]: value, [resourceLockPath]: { version: 7, updatedAt: now - 1 }, [clientLockPath]: { version: 4, updatedAt: now - 1 }, ...extra };
  const { db: memory, rows } = consentedFirestore(initial as unknown as Parameters<typeof consentedFirestore>[0], consent ? [user.uid] : []);
  const storage = memory as unknown as Database;
  const writes: Write[] = [], reads: string[] = [];
  let disallowReads = false;
  const db: Database = {
    collection: name => storage.collection(name),
    runTransaction: handler => storage.runTransaction(async original => {
      const tx: Transaction = {
        get: ((target: DocumentReference | Query) => {
          if (disallowReads) throw new Error('A read occurred after preparation');
          reads.push((target as DocumentReference).path);
          return original.get(target as DocumentReference);
        }) as Transaction['get'],
        set: (target, data, options) => { writes.push({ kind: 'set', path: target.path, data: structuredClone(data) }); return original.set(target, data, options); },
        create: (target, data) => { writes.push({ kind: 'create', path: target.path, data: structuredClone(data) }); return original.create(target, data); },
        delete: target => { writes.push({ kind: 'delete', path: target.path }); return original.delete(target); },
      };
      return handler(tx);
    }),
  };
  return { db, rows, writes, reads, disallowReads: () => { disallowReads = true; } };
}
type Fixture = ReturnType<typeof fixture>;
const state = (f: Fixture) => structuredClone([...f.rows]);
function expectedWrites(value: Business): Write[] {
  const locks: Write[] = [
    { kind: 'set', path: resourceLockPath, data: { version: 8, updatedAt: 1893499200000 } },
    { kind: 'set', path: clientLockPath, data: { version: 5, updatedAt: 1893499200000 } },
  ];
  if (value.subscription.paidTrial) {
    const subscription = { status: 'trial', trialEndsAt: 0, currentPeriodEndsAt: 0, paidTrial: { paymentId: 'demo-paid-receipt', activatedAt: 1893499200000, appointmentLimit: 10, appointmentsUsed: 10 } };
    locks.push({ kind: 'set', path: root, data: { ...value, subscription } });
    locks.push({ kind: 'set', path: 'publicBusinesses/demo-preparation', data: {
      id: 'demo-preparation-business', slug: 'demo-preparation', name: 'Negocio demo', category: 'Servicios', phoneWhatsApp: '573001234567', timezone: 'America/Bogota',
      subscription: { status: 'trial', trialEndsAt: 0, currentPeriodEndsAt: 0, paidTrial: { activatedAt: 1893499200000, appointmentLimit: 10, appointmentsUsed: 10 } },
      sarinConfig: { onboardingCompleted: true, tone: '', customRules: '', intakeFields: [] },
      resources: [{ id: 'demo-chair', name: 'Silla demo', active: true }],
      services: [{ id: 'demo-cut', name: 'Corte demo', durationMinutes: 30, bufferMinutes: 15, price: 20000, resourceIds: ['demo-chair'] }],
      weeklySchedule: { 1: { isOpen: true, intervals: [{ start: '09:00', end: '11:00' }] } },
    } });
  }
  return [...locks, { kind: 'create', path: appointmentPath, data: expectedAppointment }];
}
const wrapper = (f: Fixture, value = business, selection = input) => f.db.runTransaction(tx => createAppointmentInTransaction(tx, user, value, selection, requestId, f.db, now));
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(now); });
afterEach(() => { vi.useRealTimers(); });

describe('existing booking wrapper characterization', () => {
  it.each([['active', business], ['final paid trial unit', trialBusiness()]] as const)('retains exact saved records, lock versions, and quota writes for %s', async (_, value) => {
    const f = fixture(value);
    expect(await wrapper(f, value)).toEqual(expectedAppointment);
    expect(f.writes).toEqual(expectedWrites(value));
    expect(f.rows.get(appointmentPath)).toEqual({ version: 1, data: expectedAppointment });
    expect(f.rows.get(resourceLockPath)).toEqual({ version: 2, data: { version: 8, updatedAt: now } });
    expect(f.rows.get(clientLockPath)).toEqual({ version: 2, data: { version: 5, updatedAt: now } });
  });

  it('wrapperRetainsReplayAndContactBehavior', async () => {
    const value = trialBusiness(), f = fixture(value);
    await wrapper(f, value);
    const before = state(f), count = f.writes.length;
    const expired = { ...value, subscription: { ...value.subscription, status: 'suspended' as const } };
    expect(await wrapper(f, expired, { ...input, clientPhone: '573009999999', intakeAnswers: { ignored: 'demo' } })).toEqual(expectedAppointment);
    expect(state(f)).toEqual(before);
    expect(f.writes).toHaveLength(count);
  });

  it('sameIdDifferentSelectionStillRejects', async () => {
    const f = fixture(); await wrapper(f);
    const before = state(f), count = f.writes.length;
    await expect(wrapper(f, business, { ...input, startTimeStr: '10:00' })).rejects.toMatchObject({ status: 409 });
    expect(state(f)).toEqual(before); expect(f.writes).toHaveLength(count);
  });

  const failures: { name: string; value: Business; extra?: Record<string, object>; consent?: boolean; status: number; code?: string }[] = [
    { name: 'account permission', value: business, consent: false, status: 428, code: 'CONSENT_REQUIRED' },
    { name: 'incomplete business', value: { ...business, sarinConfig: { ...business.sarinConfig, onboardingCompleted: false } }, status: 403 },
    { name: 'exhausted quota', value: trialBusiness(10), status: 402 },
    { name: 'required intake', value: { ...business, sarinConfig: { ...business.sarinConfig, intakeFields: [{ key: 'demo-answer', label: 'Pregunta demo', required: true }] } }, status: 400 },
    { name: 'client permission', value: business, extra: { [`${root}/clientPolicies/${clientKey}`]: { version: 1, blocked: true, futureAppointmentLimit: null, reason: 'demo blocked', updatedBy: 'demo-preparation-owner', updatedAt: now } }, status: 403, code: 'CLIENT_BLOCKED' },
    { name: 'client booking limit', value: business, extra: Object.fromEntries([1, 2, 3].map(index => [`${root}/appointments/demo-future-${index}`, { ...expectedAppointment, id: `demo-future-${index}` }])), status: 409, code: 'CLIENT_BOOKING_LIMIT' },
    { name: 'occupied slot', value: business, extra: { [`${root}/appointments/demo-occupied`]: { ...expectedAppointment, id: 'demo-occupied', client: { ...expectedAppointment.client, uid: 'demo-other-client' } } }, status: 409 },
  ];
  it.each(failures)('preserves the atomic error snapshot for $name', async ({ value, extra, consent, status, code }) => {
    const f = fixture(value, extra, consent), before = state(f);
    const result = await wrapper(f, value).then(() => null, error => ({ status: error.status, ...(error.code ? { code: error.code } : {}) }));
    expect(result).toEqual({ status, ...(code ? { code } : {}) });
    expect(f.writes).toEqual([]); expect(state(f)).toEqual(before);
  });
});

describe('appointment preparation in the same transaction', () => {
  it('preparationReadsButWritesNothing', async () => {
    const value = trialBusiness(), f = fixture(value), before = state(f);
    await f.db.runTransaction(async tx => {
      const prepared = await prepareAppointmentInTransaction(tx, user, value, input, requestId, f.db, now);
      expect(prepared).toMatchObject({ kind: 'new', appointment: expectedAppointment });
      expect(f.reads.slice(0, 3)).toEqual([appointmentPath, resourceLockPath, clientLockPath]);
      expect(f.reads.slice(-2)).toEqual([`${root}/appointments`, `${root}/resourceSchedulePolicies/current`]);
      expect(f.writes).toEqual([]);
    });
    expect(state(f)).toEqual(before);
  });

  it('withoutApplyNoAppointmentQuotaOrLocks', async () => {
    const value = trialBusiness(), f = fixture(value), before = state(f);
    await f.db.runTransaction(async tx => {
      const prepared = await prepareAppointmentInTransaction(tx, user, value, input, requestId, f.db, now);
      expect(prepared.kind).toBe('new');
      // Other transaction work can choose to persist only its own terminal result.
      tx.set(f.db.collection('serverSettings').doc('demo-offer-closed'), { state: 'expired' });
    });
    const after = state(f).filter(([path]) => path !== 'serverSettings/demo-offer-closed');
    expect(after).toEqual(before);
    expect(f.rows.has(appointmentPath)).toBe(false);
    expect(f.rows.has('publicBusinesses/demo-preparation')).toBe(false);
    expect(f.rows.get(root)?.data.subscription).toMatchObject({ paidTrial: { appointmentsUsed: 9 } });
    expect(f.rows.get(resourceLockPath)?.data.version).toBe(7);
    expect(f.rows.get(clientLockPath)?.data.version).toBe(4);
  });

  it('applyPerformsSameWritesExactlyOnce', async () => {
    const value = trialBusiness(), f = fixture(value);
    await f.db.runTransaction(async tx => {
      const prepared = await prepareAppointmentInTransaction(tx, user, value, input, requestId, f.db, now);
      if (prepared.kind !== 'new') throw new Error('Expected a new appointment');
      expect(f.writes).toEqual([]);
      expect(prepared.apply()).toBeUndefined();
      expect(f.writes).toEqual(expectedWrites(value));
      expect(prepared.apply()).toBeUndefined();
      expect(f.writes).toEqual(expectedWrites(value));
    });
    expect(f.rows.get(appointmentPath)).toEqual({ version: 1, data: expectedAppointment });
    expect(f.rows.get(root)?.data.subscription).toMatchObject({ paidTrial: { appointmentsUsed: 10 } });
  });

  it('allReadsBeforeApplyAndNoReadsInsideApply', async () => {
    const f = fixture();
    await f.db.runTransaction(async tx => {
      const prepared = await prepareAppointmentInTransaction(tx, user, business, input, requestId, f.db, now);
      if (prepared.kind !== 'new') throw new Error('Expected a new appointment');
      // This final read models offer/proposal/request validation after booking reads.
      await tx.get(f.db.collection('serverSettings').doc('demo-final-clock-anchor'));
      const reads = [...f.reads];
      f.disallowReads();
      expect(prepared.apply()).toBeUndefined();
      expect(f.reads).toEqual(reads);
      expect(f.writes).toEqual(expectedWrites(business));
    });
  });

  it('bookingFailureStillAtomic', async () => {
    const value = trialBusiness(), f = fixture(value), before = state(f);
    await expect(f.db.runTransaction(async tx => {
      const prepared = await prepareAppointmentInTransaction(tx, user, value, input, requestId, f.db, now);
      if (prepared.kind !== 'new') throw new Error('Expected a new appointment');
      prepared.apply();
      throw new Error('Synthetic transaction failure before commit');
    })).rejects.toThrow('Synthetic transaction failure before commit');
    expect(state(f)).toEqual(before);
  });

  it('returns existing without apply, rechecking contact, permissions, or quota', async () => {
    const value = trialBusiness(), f = fixture(value, { [appointmentPath]: expectedAppointment }, false), before = state(f);
    await f.db.runTransaction(async tx => {
      const prepared = await prepareAppointmentInTransaction(tx, user, value, { ...input, clientPhone: '573009999999', intakeAnswers: { ignored: 'demo' } }, requestId, f.db, now);
      expect(prepared).toEqual({ kind: 'existing', appointment: expectedAppointment });
    });
    expect(f.reads).toEqual([appointmentPath, resourceLockPath, clientLockPath]);
    expect(f.writes).toEqual([]); expect(state(f)).toEqual(before);
  });

  it.each([
    { name: 'closed', policy: { version: 1, businessId: business.id, revision: 1, updatedAt: now, rules: { weekly: [], exceptions: [], closures: [{ id: 'demo-closure', scope: 'business', fromDateKey: '2030-01-07', throughDateKey: '2030-01-07', interval: null, label: '' }] } }, status: 409 },
    { name: 'corrupt', policy: { version: 99 }, status: 503, code: 'RESOURCE_SCHEDULE_UNAVAILABLE' },
    { name: 'wrong business', policy: { version: 1, businessId: 'demo-other-business', revision: 0, updatedAt: null, rules: { weekly: [], exceptions: [], closures: [] } }, status: 503, code: 'RESOURCE_SCHEDULE_UNAVAILABLE' },
  ])('policyRequiredInsidePreparationAfterS09: $name', async ({ policy, status, code }) => {
    const value = trialBusiness(), f = fixture(value, { [`${root}/resourceSchedulePolicies/current`]: policy }), before = state(f);
    const result = await f.db.runTransaction(tx => prepareAppointmentInTransaction(tx, user, value, input, requestId, f.db, now)).then(() => null, error => ({ status: error.status, ...(error.code ? { code: error.code } : {}) }));
    expect(result).toEqual({ status, ...(code ? { code } : {}) });
    expect(f.reads.slice(-2)).toEqual([`${root}/appointments`, `${root}/resourceSchedulePolicies/current`]);
    expect(f.writes).toEqual([]); expect(state(f)).toEqual(before);
  });

  it('retains structured-booking and intake policy failures inside preparation', async () => {
    const value = trialBusiness(), policy = { version: 1, businessId: business.id, revision: 1, dataMode: 'health', representedMinorsEnabled: false, reason: 'demo health', updatedAt: now, updatedBy: 'demo-admin' };
    const f = fixture(value, { [`serverSettings/${bookingDataPolicyKey(business.id)}`]: policy }), before = state(f);
    await expect(f.db.runTransaction(tx => prepareAppointmentInTransaction(tx, user, value, input, requestId, f.db, now))).rejects.toMatchObject({ status: 409, code: 'STRUCTURED_BOOKING_REQUIRED' });
    expect(f.writes).toEqual([]); expect(state(f)).toEqual(before);
  });
});
