import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Business } from '@/types/firestore';
import { reserveResponseQuota, commitResponseQuota, releaseResponseQuota, getResponseQuota } from '@/lib/server/response-quota';
import { memoryFirestore } from './memoryFirestore';

const now = Date.parse('2030-01-01T12:00:00Z');
const day = 86400000;
const business: Business = { id: 'business', ownerUid: 'owner', ownerEmail: 'owner@example.test', name: 'Fixture', category: 'Services', phoneWhatsApp: '573001234567', timezone: 'America/Bogota', slug: 'fixture', subscription: { status: 'trial', trialEndsAt: now + 7 * day, currentPeriodEndsAt: 0 }, sarinConfig: { onboardingCompleted: true, tone: '', customRules: '', intakeFields: [] }, resources: [], services: [], weeklySchedule: {}, createdAt: now };
const input = { businessId: 'business', actorUid: 'client', mode: 'sarin_client' as const, channel: 'web' as const, requestId: 'request-one', fingerprint: 'a'.repeat(64) };
const memory = () => memoryFirestore({ 'businesses/business': business as unknown as Record<string, unknown> });
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(now); });
afterEach(() => { vi.useRealTimers(); });

describe('response quota reservations', () => {
  it('reserves one response for a full turn and commits it once without storing conversation content', async () => {
    const { db, rows } = memory();
    const first = await reserveResponseQuota(input, db);
    expect(first.kind).toBe('reserved');
    expect((await getResponseQuota('business', db)).currentPeriod).toMatchObject({ includedResponses: 700, usedResponses: 0, reservedResponses: 1, remainingResponses: 699 });
    await commitResponseQuota(first.reservation, { reply: 'Private reply must not persist', toolResults: [] }, db);
    await commitResponseQuota(first.reservation, undefined, db);
    expect((await getResponseQuota('business', db)).currentPeriod).toMatchObject({ usedResponses: 1, reservedResponses: 0, remainingResponses: 699 });
    expect(await reserveResponseQuota(input, db)).toMatchObject({ kind: 'replay', response: null });
    expect(JSON.stringify([...rows.entries()])).not.toContain('Private reply');
  });
  it('rejects simultaneous duplicate execution and changed request bodies, then permits a released failure to retry', async () => {
    const { db } = memory();
    const attempts = await Promise.allSettled([reserveResponseQuota(input, db), reserveResponseQuota(input, db)]);
    expect(attempts.filter(value => value.status === 'fulfilled')).toHaveLength(1);
    expect(attempts.find(value => value.status === 'rejected')).toMatchObject({ reason: { status: 409, code: 'AI_RESPONSE_PENDING' } });
    await expect(reserveResponseQuota({ ...input, fingerprint: 'b'.repeat(64) }, db)).rejects.toMatchObject({ status: 409, code: 'AI_REQUEST_CONFLICT' });
    const first = attempts.find(value => value.status === 'fulfilled');
    if (first?.status !== 'fulfilled') throw new Error('Expected one reservation');
    await releaseResponseQuota(first.value.reservation, db);
    const retry = await reserveResponseQuota(input, db);
    expect(retry.kind).toBe('reserved');
    await commitResponseQuota(retry.reservation, undefined, db);
    expect((await getResponseQuota('business', db)).currentPeriod).toMatchObject({ usedResponses: 1, reservedResponses: 0 });
  });
  it('allows only one concurrent caller to reserve the final response and shares the balance with the owner copilot', async () => {
    const { db } = memory();
    const first = await reserveResponseQuota(input, db);
    await releaseResponseQuota(first.reservation, db);
    await db.collection('responseQuotaScopes').doc(first.reservation.scopeId).collection('periods').doc(first.reservation.periodId).set({ ...(await db.collection('responseQuotaScopes').doc(first.reservation.scopeId).collection('periods').doc(first.reservation.periodId).get()).data(), usedResponses: 699 });
    const attempts = await Promise.allSettled([
      reserveResponseQuota({ ...input, requestId: 'last-client' }, db),
      reserveResponseQuota({ ...input, actorUid: 'owner', mode: 'sarin_owner_copilot', requestId: 'last-owner' }, db),
    ]);
    expect(attempts.filter(value => value.status === 'fulfilled')).toHaveLength(1);
    expect(attempts.find(value => value.status === 'rejected')).toMatchObject({ reason: { status: 402, code: 'AI_QUOTA_EXHAUSTED' } });
    expect((await getResponseQuota('business', db)).state).toBe('exhausted');
  });
  it('offers thirty lifetime onboarding replies before a business without restarting the counter', async () => {
    const { db } = memoryFirestore();
    for (let index = 0; index < 30; index++) {
      const next = await reserveResponseQuota({ ...input, businessId: null, actorUid: 'new-owner', mode: 'sarin_onboarding', requestId: `onboard-${index}` }, db);
      await commitResponseQuota(next.reservation, undefined, db);
    }
    vi.setSystemTime(now + 90 * day);
    await expect(reserveResponseQuota({ ...input, businessId: null, actorUid: 'new-owner', mode: 'sarin_onboarding', requestId: 'onboard-extra' }, db)).rejects.toMatchObject({ status: 402 });
    await expect(reserveResponseQuota({ ...input, businessId: null }, db)).rejects.toMatchObject({ status: 403 });
  });
  it('does not reset a trial through reads, grace, or an owner configuration change', async () => {
    const { db, rows } = memory();
    expect((await getResponseQuota('business', db)).currentPeriod?.includedResponses).toBe(700);
    expect(rows.size).toBe(1);
    const first = await reserveResponseQuota(input, db);
    await commitResponseQuota(first.reservation, undefined, db);
    vi.setSystemTime(now + 8 * day);
    await db.collection('businesses').doc('business').set({ ...business, name: 'Changed', subscription: { ...business.subscription, graceEndsAt: now + 9 * day } });
    expect((await getResponseQuota('business', db)).currentPeriod).toMatchObject({ includedResponses: 700, usedResponses: 1 });
    const next = await reserveResponseQuota({ ...input, requestId: 'grace-request' }, db);
    await commitResponseQuota(next.reservation, undefined, db);
    expect((await getResponseQuota('business', db)).currentPeriod?.usedResponses).toBe(2);
  });
  it('replays an onboarding turn from its original scope after that turn creates the business', async () => {
    const { db } = memoryFirestore();
    const setup = { ...input, businessId: null, actorUid: 'owner', mode: 'sarin_onboarding' as const };
    const first = await reserveResponseQuota(setup, db);
    await db.collection('businesses').doc('business').set(business as unknown as Record<string, unknown>);
    await commitResponseQuota(first.reservation, { reply: 'Guardado.' }, db);
    expect(await reserveResponseQuota({ ...setup, businessId: 'business' }, db)).toMatchObject({ kind: 'replay', reservation: first.reservation, response: null });
    expect((await getResponseQuota('business', db)).currentPeriod?.usedResponses).toBe(0);
  });
  it('warns at eighty percent and never frees a pending response just because time passed', async () => {
    const { db } = memory();
    const first = await reserveResponseQuota(input, db);
    await releaseResponseQuota(first.reservation, db);
    const reference = db.collection('responseQuotaScopes').doc(first.reservation.scopeId).collection('periods').doc(first.reservation.periodId);
    await reference.set({ ...(await reference.get()).data(), usedResponses: 559 });
    expect((await getResponseQuota('business', db)).state).toBe('active');
    const next = await reserveResponseQuota({ ...input, requestId: 'warning-response' }, db);
    await commitResponseQuota(next.reservation, undefined, db);
    expect((await getResponseQuota('business', db)).state).toBe('warning');
    await reserveResponseQuota({ ...input, requestId: 'pending-response' }, db);
    vi.setSystemTime(now + 86400000);
    await expect(reserveResponseQuota({ ...input, requestId: 'pending-response' }, db)).rejects.toMatchObject({ code: 'AI_RESPONSE_PENDING' });
    expect((await getResponseQuota('business', db)).currentPeriod?.reservedResponses).toBe(1);
  });
  it('does not let an old handle release a newer attempt or another actor reuse a completed turn', async () => {
    const { db } = memory();
    const first = await reserveResponseQuota(input, db);
    await releaseResponseQuota(first.reservation, db);
    const second = await reserveResponseQuota(input, db);
    await expect(releaseResponseQuota(first.reservation, db)).rejects.toMatchObject({ code: 'AI_REQUEST_CONFLICT' });
    await commitResponseQuota(second.reservation, undefined, db);
    const another = await reserveResponseQuota({ ...input, actorUid: 'another-client' }, db);
    expect(another.kind).toBe('reserved');
    expect((await getResponseQuota('business', db)).currentPeriod).toMatchObject({ usedResponses: 1, reservedResponses: 1 });
    await expect(reserveResponseQuota({ ...input, actorUid: 'stranger', mode: 'sarin_owner_copilot' }, db)).rejects.toMatchObject({ status: 403 });
  });
  it('cannot commit a released reservation but can settle an in-flight turn against its original expired period', async () => {
    const { db } = memory();
    const released = await reserveResponseQuota(input, db);
    await releaseResponseQuota(released.reservation, db);
    await expect(commitResponseQuota(released.reservation, undefined, db)).rejects.toMatchObject({ status: 409 });
    const inFlight = await reserveResponseQuota({ ...input, requestId: 'long-response' }, db);
    vi.setSystemTime(now + 8 * day);
    await commitResponseQuota(inFlight.reservation, undefined, db);
    expect(await getResponseQuota('business', db)).toMatchObject({ state: 'expired', currentPeriod: { usedResponses: 1, reservedResponses: 0 } });
  });
  it('recognizes a legacy paid subscription even when its end equals the old trial end', async () => {
    const { db } = memoryFirestore({ 'businesses/business': { ...business, subscription: { ...business.subscription, status: 'active', currentPeriodEndsAt: business.subscription.trialEndsAt } } });
    expect((await getResponseQuota('business', db)).currentPeriod).toMatchObject({ source: 'legacy', includedResponses: 3000, endsAt: business.subscription.trialEndsAt });
  });
});
