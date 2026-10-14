import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DecodedIdToken } from 'firebase-admin/auth';
import type { Business } from '../src/types/firestore';
import { createAppointment, createManualBlock } from '../src/lib/server/bookings';
import { memoryFirestore } from './memoryFirestore';

const now = Date.parse('2030-01-01T12:00:00Z');
const business: Business = { id: 'business', ownerUid: 'owner', ownerEmail: 'owner@example.test', name: 'Real', slug: 'real', category: 'Barbería', timezone: 'America/Bogota', phoneWhatsApp: '573001234567', subscription: { status: 'active', trialEndsAt: 0, currentPeriodEndsAt: now + 30 * 86400000 }, sarinConfig: { onboardingCompleted: true, tone: '', customRules: '', intakeFields: [] }, resources: [{ id: 'chair', name: 'Silla', active: true }], services: [{ id: 'cut', name: 'Corte', durationMinutes: 30, bufferMinutes: 15, price: 20000, resourceIds: ['chair'] }], weeklySchedule: { 1: { isOpen: true, intervals: [{ start: '09:00', end: '11:00' }] } }, createdAt: now };
const user = { uid: 'client', email: 'client@example.test', name: 'Cliente' } as unknown as DecodedIdToken;
const input = { dateKey: '2030-01-07', startTimeStr: '09:00', serviceId: 'cut', resourceId: 'chair', clientPhone: '573001234567', intakeAnswers: {} };
const database = (value: Business = business) => memoryFirestore({ 'businesses/business': value as unknown as Record<string, unknown> });
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(now); });

describe('atomic appointment writes', () => {
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
