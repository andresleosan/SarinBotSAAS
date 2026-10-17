import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DecodedIdToken } from 'firebase-admin/auth';
import type { Business } from '../src/types/firestore';
import { cancelAppointment, createAppointment, createManualBlock, readAvailability } from '../src/lib/server/bookings';
import { consentedFirestore } from './consent-fixtures';
const memoryFirestore = (initial: Parameters<typeof consentedFirestore>[0] = {}) => consentedFirestore(initial, ['client', 'other', 'owner']);

const now = Date.parse('2030-01-01T12:00:00Z');
const business: Business = { id: 'business', ownerUid: 'owner', ownerEmail: 'owner@example.test', name: 'Real', slug: 'real', category: 'Barbería', timezone: 'America/Bogota', phoneWhatsApp: '573001234567', subscription: { status: 'active', trialEndsAt: 0, currentPeriodEndsAt: now + 30 * 86400000 }, sarinConfig: { onboardingCompleted: true, tone: '', customRules: '', intakeFields: [] }, resources: [{ id: 'chair', name: 'Silla', active: true }], services: [{ id: 'cut', name: 'Corte', durationMinutes: 30, bufferMinutes: 15, price: 20000, resourceIds: ['chair'] }], weeklySchedule: { 1: { isOpen: true, intervals: [{ start: '09:00', end: '11:00' }] } }, createdAt: now };
const user = { uid: 'client', email: 'client@example.test', name: 'Cliente' } as unknown as DecodedIdToken;
const input = { dateKey: '2030-01-07', startTimeStr: '09:00', serviceId: 'cut', resourceId: 'chair', clientPhone: '573001234567', intakeAnswers: {} };
const database = (value: Business = business) => memoryFirestore({ 'businesses/business': value as unknown as Record<string, unknown> });
const paidTrial = (used = 0): Business => ({ ...business, subscription: { status: 'trial', trialEndsAt: 0, currentPeriodEndsAt: 0, paidTrial: { paymentId: 'approved-receipt', activatedAt: now, appointmentLimit: 10, appointmentsUsed: used } } });
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(now); });

describe('atomic appointment writes', () => {
  it('consumes the final introductory appointment atomically across different resources and days', async () => {
    const value = paidTrial(9);
    value.resources = [...value.resources, { id: 'second', name: 'Segunda', active: true }];
    value.services = [{ ...value.services[0], resourceIds: ['chair', 'second'] }];
    const { db, rows } = database(value);
    const results = await Promise.allSettled([
      createAppointment(user, 'business', input, 'trial-one', db),
      createAppointment({ ...user, uid: 'other' }, 'business', { ...input, resourceId: 'second', dateKey: '2030-01-14' }, 'trial-two', db),
    ]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.find(result => result.status === 'rejected')).toMatchObject({ reason: { status: 402 } });
    expect(rows.get('businesses/business')?.data.subscription).toMatchObject({ paidTrial: { appointmentsUsed: 10 } });
    expect(rows.get('publicBusinesses/real')?.data.subscription).toMatchObject({ paidTrial: { appointmentsUsed: 10 } });
    expect(JSON.stringify(rows.get('publicBusinesses/real')?.data)).not.toContain('approved-receipt');
    expect([...rows.keys()].filter(path => path.includes('/appointments/'))).toHaveLength(1);
  });
  it('returns the saved tenth appointment after exhaustion without consuming another unit or refunding cancellation', async () => {
    const { db, rows } = database(paidTrial(9));
    const first = await createAppointment(user, 'business', input, 'trial-last', db);
    expect((await createAppointment(user, 'business', input, 'trial-last', db)).id).toBe(first.id);
    await cancelAppointment(user, 'business', first.id, db);
    expect(await createAppointment(user, 'business', input, 'trial-last', db)).toMatchObject({ id: first.id, status: 'cancelled_by_client' });
    await expect(createAppointment(user, 'business', { ...input, startTimeStr: '10:00' }, 'trial-last', db)).rejects.toMatchObject({ status: 409 });
    await expect(createAppointment(user, 'business', input, 'trial-new', db)).rejects.toMatchObject({ status: 402 });
    expect(rows.get('businesses/business')?.data.subscription).toMatchObject({ paidTrial: { appointmentsUsed: 10 } });
  });
  it('does not consume introductory units for invalid input, conflicts, or manual blocks', async () => {
    const { db, rows } = database(paidTrial());
    await expect(createAppointment(user, 'business', { ...input, serviceId: 'missing' }, 'invalid-service', db)).rejects.toMatchObject({ status: 400 });
    await createManualBlock({ uid: 'owner' }, 'business', { dateKey: input.dateKey, startTimeStr: '09:00', endTimeStr: '10:00', resourceId: 'chair', requestId: 'manual-block' }, db);
    await expect(createAppointment(user, 'business', input, 'blocked-slot', db)).rejects.toMatchObject({ status: 409 });
    expect(rows.get('businesses/business')?.data.subscription).toMatchObject({ paidTrial: { appointmentsUsed: 0 } });
  });
  it('rejects public scheduling for an incomplete paid draft', async () => {
    const draft = { ...paidTrial(), slug: '', sarinConfig: { ...business.sarinConfig, onboardingCompleted: false } };
    const { db } = database(draft);
    await expect(createAppointment(user, 'business', input, 'draft-appointment', db)).rejects.toMatchObject({ status: 403 });
    await expect(readAvailability(draft, input.dateKey, input.serviceId, input.resourceId, db)).rejects.toMatchObject({ status: 403 });
  });
  it('confirms only one of two simultaneous requests for an empty resource', async () => {
    const { db, rows } = database();
    const results = await Promise.allSettled([createAppointment(user, 'business', input, 'request-one', db), createAppointment({ ...user, uid: 'other' }, 'business', input, 'request-two', db)]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect([...rows.keys()].filter((path) => path.includes('/appointments/'))).toHaveLength(1);
  });
  it('returns the same appointment after a retried request', async () => {
    const { db, rows } = database();
    const first = await createAppointment(user, 'business', input, 'request-one', db);
    const second = await createAppointment(user, 'business', input, 'request-one', db);
    expect(second.id).toBe(first.id);
    expect([...rows.keys()].filter((path) => path.includes('/appointments/'))).toHaveLength(1);
  });
  it('revalidates subscription at the write boundary', async () => {
    const { db } = database({ ...business, subscription: { ...business.subscription, status: 'suspended' } });
    await expect(createAppointment(user, 'business', input, 'request-one', db)).rejects.toMatchObject({ status: 402 });
  });
  it('rejects owner operations from another tenant user', async () => {
    const { db } = database();
    await expect(createManualBlock(user, 'business', { dateKey: input.dateKey, startTimeStr: '10:00', endTimeStr: '11:00', resourceId: 'chair', requestId: 'request-block' }, db)).rejects.toMatchObject({ status: 403 });
  });
});
