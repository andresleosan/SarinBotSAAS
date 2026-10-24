import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Appointment } from '@/types/firestore';
import type { Database, DocumentReference, Query, Transaction } from '@/lib/storage/types';
import type { AttendanceCommand } from '@/lib/appointment-attendance';
import { appointmentAttendanceEventSchema } from '@/lib/appointment-attendance';
import { attendanceRequestFingerprint, readVerifiedAttendanceHead, updateAppointmentAttendance } from '@/lib/server/appointment-attendance';
import { stableDocumentId } from '@/lib/server/businesses';
import { cancelAppointment } from '@/lib/server/bookings';
import { clientPolicyKey } from '@/lib/server/client-policy';
import { consentStateKey } from '@/lib/server/consent';
import { updateRepresentationReview } from '@/lib/server/representation-review';
import { attendanceCorrectionCommand, attendanceFixture, attendanceNow } from './appointment-attendance-contract';
import { memoryFirestore } from './memoryFirestore';

async function scenario() {
  const memory = memoryFirestore(), fixture = await attendanceFixture(memory.db);
  return { ...memory, ...fixture };
}
type Fixture = Awaited<ReturnType<typeof scenario>>;
const save = (f: Fixture, command: AttendanceCommand = f.command, db: Database = f.db) => updateAppointmentAttendance(f.owner, f.business.id, f.appointment.id, command, db);
const eventId = (f: Fixture, requestId = f.command.requestId) => stableDocumentId('attendance', f.business.id, f.appointment.id, f.owner.uid, requestId);
const eventRef = (f: Fixture, requestId = f.command.requestId) => f.businessRef.collection('attendanceEvents').doc(eventId(f, requestId));
const state = (f: Fixture) => structuredClone(f.rows);
const changedPaths = (f: Fixture, before: ReturnType<typeof state>) => [...f.rows].filter(([path, row]) => row.version !== before.get(path)?.version).map(([path]) => path).sort();
const eventRows = (f: Fixture) => [...f.rows].filter(([path]) => path.includes('/attendanceEvents/'));

// Keep storage real; observe operation ordering and force an actual optimistic
// conflict through the underlying database, without manufacturing domain results.
function observe(db: Database, onRead?: (path: string, attempt: number) => Promise<void> | void): Database {
  let attempt = 0;
  return { collection: name => db.collection(name), runTransaction: (handler, options) => db.runTransaction(async tx => {
    const currentAttempt = ++attempt;
    let writing = false;
    const guarded = new Proxy(tx, { get(target, key) {
      if (key === 'get') return async (reference: DocumentReference | Query) => {
        if (writing) throw new Error('A transaction read occurred after a write');
        const result = await (target.get as (reference: DocumentReference | Query) => Promise<unknown>).call(target, reference);
        await onRead?.('path' in reference ? String(reference.path) : '', currentAttempt);
        return result;
      };
      if (key === 'set' || key === 'create' || key === 'delete') return (...args: unknown[]) => {
        writing = true;
        return (Reflect.get(target, key) as (...args: unknown[]) => unknown).apply(target, args);
      };
      return Reflect.get(target, key);
    } }) as Transaction;
    return handler(guarded);
  }, options) };
}

describe('owner attendance transaction', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(attendanceNow); });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

  it('ownerOnlyEvenForSuperadmin', async () => {
    const f = await scenario(), before = state(f);
    vi.stubEnv('SUPERADMIN_UID', 'demo-superadmin');
    for (const uid of ['demo-superadmin', f.appointment.client!.uid, 'demo-chair']) {
      await expect(updateAppointmentAttendance({ uid }, f.business.id, f.appointment.id, f.command, f.db)).rejects.toMatchObject({ status: 403 });
    }
    expect(f.rows).toEqual(before);
    await save(f);
    await f.businessRef.set({ ...f.business, ownerUid: 'demo-new-owner' });
    const afterTransfer = state(f);
    await expect(save(f)).rejects.toMatchObject({ status: 403 });
    expect(f.rows).toEqual(afterTransfer);
  });

  it('wrongTenantAndMismatchedStoredIdReject', async () => {
    for (const patch of [{ tenantId: 'demo-other-business' }, { id: 'demo-other-appointment' }]) {
      const f = await scenario(); await f.appointmentRef.set({ ...f.appointment, ...patch });
      const before = state(f);
      await expect(save(f)).rejects.toMatchObject({ status: 503, code: 'ATTENDANCE_RECORD_UNVERIFIABLE' });
      expect(f.rows).toEqual(before);
    }
    const f = await scenario(); await f.businessRef.set({ ...f.business, id: 'demo-other-business' });
    await expect(save(f)).rejects.toMatchObject({ status: 503 });
    await expect(updateAppointmentAttendance(f.owner, f.business.id, 'demo-missing-appointment', f.command, f.db)).rejects.toMatchObject({ status: 404 });
  });

  it('expiredPlanCanRecordButMissingConsentCannot', async () => {
    const f = await scenario();
    await f.businessRef.set({ ...f.business, subscription: { ...f.business.subscription, status: 'expired', trialEndsAt: 1 } });
    await save(f);
    await f.db.collection('serverSettings').doc(consentStateKey(f.owner.uid, 'account')).delete();
    const before = state(f);
    await expect(save(f, attendanceCorrectionCommand)).rejects.toMatchObject({ status: 428, code: 'CONSENT_REQUIRED' });
    await expect(save(f)).rejects.toMatchObject({ status: 428 });
    expect(f.rows).toEqual(before);
  });

  it('initialOutcomeWritesOneEventAndLocks', async () => {
    const f = await scenario(), resourceLock = f.businessRef.collection('bookingLocks').doc('2030-01-07_demo-chair');
    await resourceLock.set({ version: 4, syntheticMarker: true });
    const before = state(f), result = await save(f, f.command, observe(f.db));
    expect(result).toEqual({ appointment: { ...f.appointment, status: 'completed', attendance: { revision: 1, lastEventId: eventId(f) } },
      applied: { eventId: eventId(f), requestId: f.command.requestId, revision: 1, status: 'completed', recordedAt: attendanceNow }, replayed: false });
    const saved = (await eventRef(f).get()).data();
    expect(saved).toEqual({ schemaVersion: 1, businessId: f.business.id, appointmentId: f.appointment.id, actorUid: f.owner.uid,
      requestId: f.command.requestId, requestFingerprint: attendanceRequestFingerprint(f.command), sequence: 1,
      previousStatus: 'confirmed', status: 'completed', recordedAt: attendanceNow, reason: 'initial', legacyPreviousOutcome: false,
      source: { dateKey: '2030-01-07', resourceId: 'demo-chair', startAt: Date.parse('2030-01-07T14:00:00Z'), endAt: Date.parse('2030-01-07T14:30:00Z'), reservedUntilAt: attendanceNow, rescheduleRevision: 0 } });
    expect(appointmentAttendanceEventSchema.safeParse(saved).success).toBe(true);
    expect(changedPaths(f, before)).toEqual([f.appointmentRef.path, eventRef(f).path, resourceLock.path,
      f.businessRef.collection('bookingLocks').doc(`client_${clientPolicyKey(f.appointment.client!.uid)}`).path].sort());
    expect((await resourceLock.get()).data()).toEqual({ version: 5, syntheticMarker: true, updatedAt: attendanceNow });
    expect(result.appointment).not.toHaveProperty('events');
    expect(result.appointment).not.toHaveProperty('actorUid');
  });

  it('correctionAppendsAndPreservesPreviousEvent', async () => {
    const f = await scenario(); await save(f);
    const original = structuredClone(f.rows.get(eventRef(f).path));
    const before = state(f);
    vi.setSystemTime(attendanceNow + 1000);
    const result = await save(f, attendanceCorrectionCommand, observe(f.db));
    expect(result.appointment).toEqual({ ...f.appointment, status: 'no_show', attendance: { revision: 2, lastEventId: eventId(f, attendanceCorrectionCommand.requestId) } });
    expect(result.applied).toMatchObject({ revision: 2, status: 'no_show', recordedAt: attendanceNow + 1000 });
    expect((await eventRef(f, attendanceCorrectionCommand.requestId).get()).data()).toMatchObject({ sequence: 2, previousStatus: 'completed', status: 'no_show', reason: 'recording_error', legacyPreviousOutcome: false, actorUid: f.owner.uid });
    expect(f.rows.get(eventRef(f).path)).toEqual(original);
    expect(eventRows(f)).toHaveLength(2);
    expect(changedPaths(f, before)).toEqual([f.appointmentRef.path, eventRef(f, attendanceCorrectionCommand.requestId).path,
      f.businessRef.collection('bookingLocks').doc('2030-01-07_demo-chair').path,
      f.businessRef.collection('bookingLocks').doc(`client_${clientPolicyKey(f.appointment.client!.uid)}`).path].sort());
  });

  it('noShowNeverSetsClientPenaltyFlag', async () => {
    for (const flag of [false, undefined]) {
      const f = await scenario(), client = { ...f.appointment.client! };
      if (flag === undefined) delete client.hasNoShowHistory; else client.hasNoShowHistory = flag;
      await f.appointmentRef.set({ ...f.appointment, client });
      const result = await save(f, { ...f.command, status: 'no_show' });
      expect(result.appointment.client).toEqual(client);
      expect([...f.rows.keys()].filter(path => path.includes('/clientPolicies/'))).toEqual([]);
    }
  });

  it('counterAndPublicBusinessRemainIdentical', async () => {
    const f = await scenario();
    await f.businessRef.collection('clientPolicies').doc('defaults').set({ syntheticMarker: true });
    await f.db.collection('bookingProposals').doc('demo-proposal').set({ syntheticMarker: true });
    const before = state(f);
    await save(f); await save(f, attendanceCorrectionCommand);
    for (const [path, row] of before) if (!path.includes('/appointments/') && !path.includes('/bookingLocks/')) expect(f.rows.get(path)).toEqual(row);
    expect((await f.businessRef.get()).data()?.subscription).toEqual(f.business.subscription);
  });

  it('legacyWithoutClientDoesNotInventIdentityAndInvalidUidRejects', async () => {
    const f = await scenario(), { client: _client, ...appointment } = f.appointment;
    await f.appointmentRef.set(appointment);
    const before = state(f), result = await save(f);
    expect(result.appointment).not.toHaveProperty('client');
    expect(changedPaths(f, before)).toHaveLength(3);
    expect([...f.rows.keys()].some(path => path.includes('/bookingLocks/client_'))).toBe(false);
    for (const uid of ['', null, 123, 'x'.repeat(129), 'bad\u0000uid']) {
      const g = await scenario(); await g.appointmentRef.set({ ...g.appointment, client: { ...g.appointment.client!, uid } });
      const previous = state(g);
      await expect(save(g)).rejects.toMatchObject({ status: 503, code: 'ATTENDANCE_RECORD_UNVERIFIABLE' });
      expect(g.rows).toEqual(previous);
    }
  });

  it('legacyTerminalCorrectionStartsRealAuditOnly', async () => {
    const f = await scenario(); await f.appointmentRef.set({ ...f.appointment, status: 'no_show' });
    const result = await save(f, { ...f.command, expectedStatus: 'no_show', correctionReason: 'recording_error' });
    expect(result.applied.revision).toBe(1);
    expect((await eventRef(f).get()).data()).toMatchObject({ legacyPreviousOutcome: true, previousStatus: 'no_show', actorUid: f.owner.uid, recordedAt: attendanceNow });
  });

  it('identicalReplayWritesNothing', async () => {
    const f = await scenario(), initial = await save(f), before = state(f);
    vi.setSystemTime(attendanceNow - 1);
    expect(await save(f, f.command, observe(f.db))).toEqual({ ...initial, replayed: true });
    expect(f.rows).toEqual(before);
  });

  it('requestReuseWithOtherBodyRejects', async () => {
    const f = await scenario(); await save(f); const before = state(f);
    for (const patch of [{ status: 'no_show' as const }, { expectedRevision: 1 }, { expectedRescheduleRevision: 1 }, { expectedStatus: 'no_show' as const, correctionReason: 'recording_error' as const }]) {
      await expect(save(f, { ...f.command, ...patch })).rejects.toMatchObject({ status: 409, code: 'ATTENDANCE_REQUEST_REUSED' });
    }
    expect(f.rows).toEqual(before);
  });

  it('replayAfterCorrectionReturnsCurrentAppointmentAndOriginalAppliedReceipt', async () => {
    const f = await scenario(), original = await save(f);
    vi.setSystemTime(attendanceNow + 1000);
    const correction = await save(f, attendanceCorrectionCommand), before = state(f);
    expect(await save(f)).toEqual({ appointment: correction.appointment, applied: original.applied, replayed: true });
    expect(f.rows).toEqual(before);
  });

  it('competingResultsOnlyOneWins', async () => {
    const f = await scenario();
    const outcomes = await Promise.allSettled([save(f), save(f, { ...f.command, requestId: 'demo-competing-request', status: 'no_show' })]);
    expect(outcomes.filter(outcome => outcome.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.find(outcome => outcome.status === 'rejected')).toMatchObject({ reason: { status: 409, code: 'ATTENDANCE_SOURCE_CHANGED' } });
    expect(eventRows(f)).toHaveLength(1);
    expect((await f.appointmentRef.get()).data()?.attendance.revision).toBe(1);
  });

  it('competingCorrectionsOnlyOneWins', async () => {
    const f = await scenario(); await save(f);
    const outcomes = await Promise.allSettled([save(f, attendanceCorrectionCommand), save(f, { ...attendanceCorrectionCommand, requestId: 'demo-other-correction' })]);
    expect(outcomes.filter(outcome => outcome.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.find(outcome => outcome.status === 'rejected')).toMatchObject({ reason: { status: 409, code: 'ATTENDANCE_SOURCE_CHANGED' } });
    expect(eventRows(f)).toHaveLength(2);
    expect((await f.appointmentRef.get()).data()?.attendance.revision).toBe(2);
  });

  it('missingOrCorruptAuditHeadRejects', async () => {
    for (const patch of [null, { sequence: 2 }, { businessId: 'demo-other-business' }, { appointmentId: 'demo-other-appointment' },
      { actorUid: 'demo-other-owner' }, { requestId: 'demo-other-request' }, { status: 'no_show' }, { recordedAt: attendanceNow - 1 },
      { source: {} }, { requestFingerprint: 'invalid' }]) {
      const f = await scenario(); await save(f); const ref = eventRef(f), original = (await ref.get()).data()!;
      if (patch === null) await ref.delete(); else await ref.set({ ...original, ...patch });
      const before = state(f);
      await expect(save(f)).rejects.toMatchObject({ status: 503, code: 'ATTENDANCE_RECORD_UNVERIFIABLE' });
      await expect(save(f, attendanceCorrectionCommand)).rejects.toMatchObject({ status: 503 });
      expect(f.rows).toEqual(before);
    }
    for (const field of ['dateKey', 'resourceId', 'startAt', 'endAt', 'reservedUntilAt', 'rescheduleRevision']) {
      const f = await scenario(); await save(f); const original = (await eventRef(f).get()).data()!;
      await eventRef(f).set({ ...original, source: { ...original.source, [field]: field === 'dateKey' ? '2030-01-08' : field === 'resourceId' ? 'demo-other-resource' : original.source[field] + 1 } });
      await expect(save(f)).rejects.toMatchObject({ status: 503 });
    }
  });

  it('replayVerifiesCurrentMetadataAndOriginalReceipt', async () => {
    for (const patch of [{ attendance: null }, { status: 'cancelled_by_owner' }, { status: 'confirmed' }, { resourceId: 'demo-other-resource' }]) {
      const f = await scenario(); await save(f); const saved = (await f.appointmentRef.get()).data()!;
      await f.appointmentRef.set({ ...saved, ...patch });
      const before = state(f); await expect(save(f)).rejects.toMatchObject({ status: 503 }); expect(f.rows).toEqual(before);
    }
    const f = await scenario(); await save(f); await save(f, attendanceCorrectionCommand);
    const original = (await eventRef(f).get()).data()!;
    await eventRef(f).set({ ...original, actorUid: 'demo-other-owner' });
    await expect(save(f)).rejects.toMatchObject({ status: 503 });
  });

  it('replayRejectsCorruptOriginalReceiptDespiteValidLaterHead', async () => {
    for (const patch of [{ sequence: 3 }, { status: 'no_show' }, { actorUid: 'demo-other-owner' },
      { previousStatus: 'no_show', reason: 'recording_error', legacyPreviousOutcome: true },
      { source: { dateKey: '2030-01-07', resourceId: 'demo-other-resource', startAt: Date.parse('2030-01-07T14:00:00Z'), endAt: Date.parse('2030-01-07T14:30:00Z'), reservedUntilAt: attendanceNow, rescheduleRevision: 0 } }]) {
      const f = await scenario(); await save(f); await save(f, attendanceCorrectionCommand);
      const receipt = (await eventRef(f).get()).data()!;
      await eventRef(f).set({ ...receipt, ...patch }); const before = state(f);
      await expect(save(f)).rejects.toMatchObject({ status: 503, code: 'ATTENDANCE_RECORD_UNVERIFIABLE' });
      expect(f.rows).toEqual(before);
    }
  });

  it('staleRescheduleRevisionDoesNotApply', async () => {
    const f = await scenario(); await f.appointmentRef.set({ ...f.appointment, rescheduleRevision: 1 });
    const before = state(f);
    await expect(save(f)).rejects.toMatchObject({ status: 409, code: 'ATTENDANCE_SOURCE_CHANGED' });
    expect(f.rows).toEqual(before);
  });

  it('fingerprintIsStableAndBindsEveryCommandField', async () => {
    const f = await scenario(), command = attendanceCorrectionCommand;
    expect(attendanceRequestFingerprint(command)).toMatch(/^[a-f0-9]{64}$/);
    expect(attendanceRequestFingerprint({ correctionReason: command.correctionReason, status: command.status, expectedStatus: command.expectedStatus, expectedRescheduleRevision: 0, expectedRevision: 1, requestId: command.requestId })).toBe(attendanceRequestFingerprint(command));
    for (const patch of [{ requestId: 'demo-other-request' }, { expectedRevision: 2 }, { expectedRescheduleRevision: 2 }, { expectedStatus: 'no_show' as const }, { status: 'completed' as const }, { correctionReason: undefined }]) {
      expect(attendanceRequestFingerprint({ ...command, ...patch })).not.toBe(attendanceRequestFingerprint(command));
    }
    expect(attendanceRequestFingerprint(f.command)).toBe(attendanceRequestFingerprint({ ...f.command, correctionReason: undefined }));
  });

  it('cancellationWinnerPreventsAttendance', async () => {
    const f = await scenario(); let cancelStarted = false;
    const db = observe(f.db, async path => { if (path === f.appointmentRef.path && !cancelStarted) { cancelStarted = true; await cancelAppointment(f.owner, f.business.id, f.appointment.id, f.db); } });
    await expect(save(f, f.command, db)).rejects.toMatchObject({ status: 409 });
    expect((await f.appointmentRef.get()).data()?.status).toBe('cancelled_by_owner');
    expect(eventRows(f)).toHaveLength(0);
  });

  it('attendanceWinnerSurvivesExistingCancelNoop', async () => {
    const f = await scenario(); let started = false;
    const db = observe(f.db, async path => { if (path === f.appointmentRef.path && !started) { started = true; await save(f); } });
    const cancelled = await cancelAppointment(f.owner, f.business.id, f.appointment.id, db as typeof f.db);
    expect(cancelled.status).toBe('completed');
    expect(cancelled.attendance).toEqual({ revision: 1, lastEventId: eventId(f) });
    expect(eventRows(f)).toHaveLength(1);
  });

  it('representationReviewDoesNotLoseAttendanceAndViceVersa', async () => {
    for (const winner of ['review', 'attendance']) {
      const f = await scenario(); let started = false;
      const review = (db: Database) => updateRepresentationReview(f.owner, f.business.id, f.appointment.id, { expectedRevision: 1, status: 'needs_contact' }, db);
      const db = observe(f.db, async path => { if (path === f.appointmentRef.path && !started) { started = true; if (winner === 'review') await review(f.db); else await save(f); } });
      if (winner === 'review') await save(f, f.command, db); else await review(db);
      expect((await f.appointmentRef.get()).data()).toMatchObject({ status: 'completed', attendance: { revision: 1, lastEventId: eventId(f) }, representationReview: { revision: 2, status: 'needs_contact' }, beneficiary: f.appointment.beneficiary, subjectAuthorization: f.appointment.subjectAuthorization, client: f.appointment.client });
      expect(eventRows(f)).toHaveLength(1);
    }
  });

  it('transactionRetryRechecksTimeAndSource', async () => {
    for (const change of ['clock', 'source']) {
      vi.setSystemTime(attendanceNow);
      const f = await scenario(); let changed = false, attempts = 0;
      const db = observe(f.db, async (path, attempt) => {
        attempts = attempt;
        if (path.includes('/bookingLocks/') && !changed) {
          changed = true;
          await f.appointmentRef.set({ ...f.appointment, ...(change === 'source' ? { rescheduleRevision: 1, startAt: f.appointment.startAt + 86400000, endAt: f.appointment.endAt + 86400000, reservedUntilAt: attendanceNow + 86400000, dateKey: '2030-01-08' } : { syntheticRevision: 1 }) });
        }
        if (attempt > 1 && change === 'clock') vi.setSystemTime(attendanceNow - 1);
      });
      await expect(save(f, f.command, db)).rejects.toMatchObject({ status: 409, code: change === 'clock' ? 'ATTENDANCE_TOO_EARLY' : 'ATTENDANCE_SOURCE_CHANGED' });
      expect(attempts).toBeGreaterThan(1); expect(eventRows(f)).toHaveLength(0);
    }
  });

  it('freshClockAfterLocksAndSavedMarginIgnoreChangedCatalog', async () => {
    const f = await scenario(); await f.businessRef.set({ ...f.business, services: [], resources: [] });
    const db = observe(f.db, path => { if (path.includes('/bookingLocks/')) vi.setSystemTime(attendanceNow - 1); });
    const before = state(f);
    await expect(save(f, f.command, db)).rejects.toMatchObject({ status: 409, code: 'ATTENDANCE_TOO_EARLY' });
    expect(f.rows).toEqual(before);
    vi.setSystemTime(attendanceNow); await save(f);
    expect((await eventRef(f).get()).data()?.source.reservedUntilAt).toBe(attendanceNow);
  });

  it('corruptLockVersionsFailClosedAndAbsentVersionsStartAtZero', async () => {
    for (const key of ['2030-01-07_demo-chair', `client_${clientPolicyKey('demo-attendance-client')}`]) {
      for (const version of [null, -1, 0.5, '2', Number.MAX_SAFE_INTEGER, NaN]) {
        const f = await scenario(); await f.businessRef.collection('bookingLocks').doc(key).set({ version }); const before = state(f);
        await expect(save(f)).rejects.toMatchObject({ status: 503, code: 'ATTENDANCE_RECORD_UNVERIFIABLE' }); expect(f.rows).toEqual(before);
      }
    }
    const f = await scenario(), ref = f.businessRef.collection('bookingLocks').doc('2030-01-07_demo-chair');
    await ref.set({ syntheticMarker: true }); await save(f);
    expect((await ref.get()).data()).toEqual({ syntheticMarker: true, version: 1, updatedAt: attendanceNow });
  });

  it('publicCommandParseStays400AndHeadReaderReturnsOnlyVerifiedHead', async () => {
    const f = await scenario();
    await expect(save(f, { ...f.command, actorUid: 'demo-forged' } as AttendanceCommand)).rejects.toMatchObject({ name: 'ZodError' });
    expect(await f.db.runTransaction(tx => readVerifiedAttendanceHead(tx, f.db, f.business.id, f.appointment))).toBeNull();
    await save(f); const appointment = (await f.appointmentRef.get()).data() as Appointment;
    expect(await f.db.runTransaction(tx => readVerifiedAttendanceHead(tx, f.db, f.business.id, appointment))).toEqual((await eventRef(f).get()).data());
  });
});
