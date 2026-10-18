import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Appointment } from '@/types/firestore';
import { consentedFirestore } from './consent-fixtures';
import { readConsent, updateConsent } from '@/lib/server/consent';
import { appointmentRescheduleFingerprint } from '@/lib/server/appointment-rescheduling';
import { createBookingProposal, confirmBookingProposal } from '@/lib/server/booking-proposals';
import { rescheduleActor as actor, rescheduleBusiness as business, rescheduleSource as source, rescheduleSelection, rescheduleContact } from './appointment-reschedule-contract';

export const reminderNow = Date.parse('2030-01-06T14:00:00Z');
const sourcePath = `businesses/${business.id}/appointments/${source.id}`;
const occurrence = { appointmentId: source.id, sourceRevision: 0, sourceStartAt: Date.parse('2030-01-07T14:00:00Z'), offsetMinutes: 1440 as const };
function scenario(extra: Record<string, Record<string, unknown>> = {}) {
  return consentedFirestore({ [`businesses/${business.id}`]: business as unknown as Record<string, unknown>, [sourcePath]: source as unknown as Record<string, unknown>, ...extra }, [actor.uid, 'demo-other-client']);
}
async function backend() {
  const path = '../src/lib/server/appointment-reminders.ts';
  const module = await import(path).catch(() => null);
  expect(module, 'The approved reminder backend is not implemented').not.toBeNull();
  return module as typeof import('@/lib/server/appointment-reminders');
}
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(reminderNow); });
afterEach(() => vi.useRealTimers());

it('is off by default and GET creates no preference or seen receipt', async () => {
  const m = await backend(), { db, rows } = scenario(), before = structuredClone([...rows]);
  expect(await m.readAppointmentReminders(actor, business.id, db)).toEqual({ businessId: business.id, ownerUid: actor.uid, serverNow: reminderNow, preference: { enabled: false, revision: 0, status: 'disabled', offsetMinutes: 1440 }, reminders: [] });
  expect([...rows]).toEqual(before);
});

it('shows the exact 24-hour boundary with only allowlisted fields and keeps the read explicit', async () => {
  const m = await backend(), { db, rows } = scenario();
  const enabled = await m.saveReminderPreference(actor, business.id, { enabled: true, expectedRevision: 0 }, db);
  expect(enabled.preference).toEqual({ enabled: true, revision: 1, status: 'active', offsetMinutes: 1440 });
  expect(enabled.reminders).toEqual([{ ...occurrence, availableAt: reminderNow, seenAt: null }]);
  const before = structuredClone([...rows]); await m.readAppointmentReminders(actor, business.id, db); expect([...rows]).toEqual(before);
  const result = await m.markAppointmentReminderSeen(actor, business.id, occurrence, db);
  expect(result).toEqual({ reminder: { ...occurrence, availableAt: reminderNow, seenAt: reminderNow } });
  vi.setSystemTime(reminderNow + 1000);
  expect((await m.markAppointmentReminderSeen(actor, business.id, occurrence, db)).reminder.seenAt).toBe(reminderNow);
  expect((await m.readAppointmentReminders(actor, business.id, db)).reminders[0].seenAt).toBe(reminderNow);
  expect(JSON.stringify(enabled)).not.toMatch(/original@example|Nombre original|retired_question|serviceName|beneficiary|phone|price/);
});

it.each([
  ['too far', { startAt: reminderNow + 86400001 }], ['started', { startAt: reminderNow }],
  ['cancelled', { status: 'cancelled_by_owner' }], ['foreign client', { client: { ...source.client!, uid: 'demo-other-client' } }],
  ['foreign tenant', { tenantId: 'demo-other-business' }], ['manual', { type: 'manual_block' }],
] as const)('does not expose a %s appointment', async (_name, patch) => {
  const m = await backend(), { db } = scenario({ [sourcePath]: { ...source, ...patch } as unknown as Record<string, unknown> });
  expect((await m.saveReminderPreference(actor, business.id, { enabled: true, expectedRevision: 0 }, db)).reminders).toEqual([]);
});

it.each(['account', 'business_client'] as const)('suspends across withdrawn and reauthorized %s consent while the app is closed', async scope => {
  const m = await backend(), { db } = scenario();
  await m.saveReminderPreference(actor, business.id, { enabled: true, expectedRevision: 0 }, db);
  const current = await readConsent(actor.uid, scope, scope === 'account' ? undefined : business, db);
  await updateConsent(actor, { scope, ...(scope === 'business_client' ? { businessId: business.id } : {}), action: 'revoke', expectedRevision: current.revision, requestId: 'demo-reminder-withdraw' }, db);
  const { acceptSyntheticConsent } = await import('./consent-fixtures'); await acceptSyntheticConsent(db, actor.uid, business);
  const suspended = await m.readAppointmentReminders(actor, business.id, db);
  expect(suspended.preference).toMatchObject({ enabled: true, status: 'suspended', revision: 1 }); expect(suspended.reminders).toEqual([]);
  await expect(m.markAppointmentReminderSeen(actor, business.id, occurrence, db)).rejects.toMatchObject({ status: 428 });
  expect((await m.saveReminderPreference(actor, business.id, { enabled: true, expectedRevision: 1 }, db)).preference.status).toBe('active');
});

it('allows disabling without active consents and rejects an old enable after the disable', async () => {
  const m = await backend(), { db } = scenario();
  await m.saveReminderPreference(actor, business.id, { enabled: true, expectedRevision: 0 }, db);
  const current = await readConsent(actor.uid, 'account', undefined, db);
  await updateConsent(actor, { scope: 'account', action: 'revoke', expectedRevision: current.revision, requestId: 'demo-reminder-disable' }, db);
  expect((await m.saveReminderPreference(actor, business.id, { enabled: false, expectedRevision: 1 }, db)).preference).toMatchObject({ enabled: false, revision: 2, status: 'disabled' });
  await expect(m.saveReminderPreference(actor, business.id, { enabled: true, expectedRevision: 1 }, db)).rejects.toMatchObject({ status: 409 });
});

it('replaces one physical receipt for a moved occurrence and never lets a stale mark overwrite it', async () => {
  const m = await backend(), { db, rows } = scenario(); await m.saveReminderPreference(actor, business.id, { enabled: true, expectedRevision: 0 }, db);
  await m.markAppointmentReminderSeen(actor, business.id, occurrence, db);
  const changed = { ...source, startAt: source.startAt - 3600000, rescheduleRevision: 1 };
  await db.collection('businesses').doc(business.id).collection('appointments').doc(source.id).set(changed);
  expect((await m.readAppointmentReminders(actor, business.id, db)).reminders[0].seenAt).toBeNull();
  const next = { ...occurrence, sourceRevision: 1, sourceStartAt: changed.startAt };
  await m.markAppointmentReminderSeen(actor, business.id, next, db);
  await expect(m.markAppointmentReminderSeen(actor, business.id, occurrence, db)).rejects.toMatchObject({ status: 409 });
  expect([...rows.keys()].filter(path => path.includes('/reminderReceipts/'))).toHaveLength(1);
});

it.each([null, -1, 0.5, Number.MAX_SAFE_INTEGER])('fails closed on a corrupt source revision %j', async rescheduleRevision => {
  const m = await backend(), { db } = scenario({ [sourcePath]: { ...source, rescheduleRevision } });
  await expect(m.saveReminderPreference(actor, business.id, { enabled: true, expectedRevision: 0 }, db)).rejects.toMatchObject({ status: 503 });
});

it('hides absent and foreign seen sources, isolates preferences and fails on corrupt stored receipts', async () => {
  const m = await backend(), { db } = scenario(); await m.saveReminderPreference(actor, business.id, { enabled: true, expectedRevision: 0 }, db);
  expect((await m.readAppointmentReminders({ uid: 'demo-other-client' }, business.id, db)).preference.status).toBe('disabled');
  await expect(m.markAppointmentReminderSeen({ uid: 'demo-other-client' }, business.id, occurrence, db)).rejects.toMatchObject({ status: 404 });
  await expect(m.markAppointmentReminderSeen(actor, business.id, { ...occurrence, appointmentId: 'demo-missing' }, db)).rejects.toMatchObject({ status: 404 });
  await db.collection('businesses').doc(business.id).collection('reminderReceipts').doc(m.reminderReceiptId(actor.uid, business.id, source.id)).set({ version: 1, ownerUid: 'other' });
  await expect(m.readAppointmentReminders(actor, business.id, db)).rejects.toMatchObject({ status: 503 });
});

it('preserves the entire appointment fingerprint and a pending reschedule proposal when marking seen', async () => {
  const m = await backend(), { db, rows } = scenario();
  const proposal = await createBookingProposal(actor, business.id, rescheduleSelection, 'demo-reminder-pending-change', db, undefined, { appointmentId: source.id, sourceRevision: 0 });
  const fingerprint = appointmentRescheduleFingerprint(source);
  await m.saveReminderPreference(actor, business.id, { enabled: true, expectedRevision: 0 }, db); await m.markAppointmentReminderSeen(actor, business.id, occurrence, db);
  expect(rows.get(sourcePath)?.data).toEqual(source); expect(appointmentRescheduleFingerprint(rows.get(sourcePath)!.data as unknown as Appointment)).toBe(fingerprint);
  expect((await confirmBookingProposal(actor, business.id, proposal.id, rescheduleContact, db)).rescheduleRevision).toBe(1);
});

it('reports window overflow instead of silently dropping an appointment', async () => {
  const m = await backend(), extras = Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`businesses/${business.id}/appointments/demo-extra-${i}`, { ...source, id: `demo-extra-${i}` }]));
  const { db } = scenario(extras);
  await expect(m.saveReminderPreference(actor, business.id, { enabled: true, expectedRevision: 0 }, db)).rejects.toMatchObject({ status: 413 });
});

it.each(['read', 'seen'] as const)('uses a fresh clock after the final receipt read for %s', async action => {
  const m = await backend(), { db, rows } = scenario();
  await m.saveReminderPreference(actor, business.id, { enabled: true, expectedRevision: 0 }, db);
  const guarded = { collection: db.collection.bind(db), runTransaction: <T>(handler: (tx: import('@/lib/storage/types').Transaction) => Promise<T>) => db.runTransaction(raw => {
    const tx = raw as unknown as import('@/lib/storage/types').Transaction;
    return handler(new Proxy(tx, { get(target, key) {
      if (key !== 'get') return Reflect.get(target, key);
      return async (reference: import('@/lib/storage/types').DocumentReference | import('@/lib/storage/types').Query) => {
        const result = await (target.get as (value: typeof reference) => Promise<unknown>).call(target, reference);
        if ('path' in reference && String(reference.path).includes('/reminderReceipts/')) vi.setSystemTime(source.startAt);
        return result;
      };
    } }));
  }) } as unknown as import('@/lib/storage/types').Database;
  if (action === 'read') expect((await m.readAppointmentReminders(actor, business.id, guarded)).reminders).toEqual([]);
  else await expect(m.markAppointmentReminderSeen(actor, business.id, occurrence, guarded)).rejects.toMatchObject({ status: 409 });
  expect([...rows.keys()].filter(path => path.includes('/reminderReceipts/'))).toHaveLength(0);
});

it('does not silence an A to B to A occurrence with a higher revision', async () => {
  const m = await backend(), { db } = scenario(); await m.saveReminderPreference(actor, business.id, { enabled: true, expectedRevision: 0 }, db);
  await m.markAppointmentReminderSeen(actor, business.id, occurrence, db);
  const ref = db.collection('businesses').doc(business.id).collection('appointments').doc(source.id);
  await ref.set({ ...source, startAt: source.startAt - 3600000, rescheduleRevision: 1 });
  await ref.set({ ...source, rescheduleRevision: 2 });
  expect((await m.readAppointmentReminders(actor, business.id, db)).reminders).toEqual([{ ...occurrence, sourceRevision: 2, availableAt: reminderNow, seenAt: null }]);
  await expect(m.markAppointmentReminderSeen(actor, business.id, occurrence, db)).rejects.toMatchObject({ status: 409 });
});
