import { describe, expect, it } from 'vitest';
import type { Appointment } from '@/types/firestore';
import {
  AttendanceModelError, appointmentAttendanceCommandSchema, appointmentAttendanceCursorSchema,
  appointmentAttendanceEventSchema, assertAttendanceTransition, readAttendanceMetadata,
} from '@/lib/appointment-attendance';
import { attendanceAppointment, attendanceBusiness, attendanceCommand, attendanceFixture, attendanceNow } from './appointment-attendance-contract';
import { memoryFirestore } from './memoryFirestore';

const corrupt = (fields: Record<string, unknown>) => ({ ...structuredClone(attendanceAppointment), ...fields }) as Appointment;
function fails(appointment: Appointment, code: string, now = attendanceNow, command = attendanceCommand as unknown) {
  try {
    assertAttendanceTransition(appointment, command as typeof attendanceCommand, now);
    expect.fail('Expected an attendance domain error');
  } catch (error) {
    expect(error).toBeInstanceOf(AttendanceModelError);
    expect(error).toMatchObject({ code, status: code === 'ATTENDANCE_RECORD_UNVERIFIABLE' ? 503 : 409 });
  }
}
const event = () => ({
  schemaVersion: 1, businessId: 'demo-attendance-business', appointmentId: 'demo-attendance-appointment',
  actorUid: 'demo-attendance-owner', requestId: 'demo-attendance-request', requestFingerprint: 'a'.repeat(64),
  sequence: 1, previousStatus: 'confirmed', status: 'completed', recordedAt: attendanceNow,
  reason: 'initial', legacyPreviousOutcome: false,
  source: { dateKey: '2030-01-07', resourceId: 'demo-chair', startAt: Date.parse('2030-01-07T14:00:00Z'), endAt: Date.parse('2030-01-07T14:30:00Z'), reservedUntilAt: attendanceNow, rescheduleRevision: 0 },
});

describe('owner attendance model', () => {
  it('rejectsFutureAndPreservesPreparation', () => {
    for (const now of [attendanceAppointment.startAt - 1, attendanceAppointment.endAt, attendanceNow - 1]) {
      for (const status of ['completed', 'no_show']) fails(attendanceAppointment, 'ATTENDANCE_TOO_EARLY', now, { ...attendanceCommand, status });
    }
    fails(corrupt({ status: 'completed' }), 'ATTENDANCE_TOO_EARLY', attendanceNow - 1, { ...attendanceCommand, expectedStatus: 'completed', status: 'no_show', correctionReason: 'recording_error' });
  });

  it('acceptsExactlyAtReservedEnd', () => {
    for (const status of ['completed', 'no_show']) expect(() => assertAttendanceTransition(attendanceAppointment, { ...attendanceCommand, status } as typeof attendanceCommand, attendanceNow)).not.toThrow();
  });

  it('legacyZeroIsOnlyForAbsentMetadata', () => {
    expect(readAttendanceMetadata(attendanceAppointment)).toBeNull();
    for (const attendance of [undefined, null, {}, { revision: 0, lastEventId: 'demo-event' }, { revision: 1 }, { revision: 1, lastEventId: '../event' }, { revision: 1, lastEventId: 'demo-event', actorUid: 'demo-owner' }]) {
      const appointment = corrupt({ attendance });
      expect(() => readAttendanceMetadata(appointment)).toThrow(AttendanceModelError);
      fails(appointment, 'ATTENDANCE_RECORD_UNVERIFIABLE');
    }
    expect(readAttendanceMetadata(corrupt({ attendance: { revision: 1, lastEventId: 'demo-event' } }))).toEqual({ revision: 1, lastEventId: 'demo-event' });
  });

  it('legacyOutcomeCorrectionHasNoInventedActor', () => {
    const appointment = corrupt({ status: 'no_show' });
    const before = structuredClone(appointment);
    assertAttendanceTransition(appointment, { ...attendanceCommand, expectedStatus: 'no_show', correctionReason: 'recording_error' }, attendanceNow);
    expect(appointment).toEqual(before);
    expect(readAttendanceMetadata(appointment)).toBeNull();
    const saved = { ...event(), previousStatus: 'no_show', reason: 'recording_error', legacyPreviousOutcome: true };
    expect(appointmentAttendanceEventSchema.parse(saved)).toEqual(saved);
    for (const field of ['previousActorUid', 'previousRecordedAt', 'email', 'phone', 'intakeAnswers', 'beneficiary', 'price']) expect(appointmentAttendanceEventSchema.safeParse({ ...saved, [field]: 'private' }).success).toBe(false);
  });

  it('coreRejectsClearUntilIntegratedDelta', () => {
    expect(appointmentAttendanceCommandSchema.safeParse({ ...attendanceCommand, expectedStatus: 'completed', status: 'confirmed', correctionReason: 'recording_error' }).success).toBe(false);
    expect(appointmentAttendanceEventSchema.safeParse({ ...event(), previousStatus: 'completed', status: 'confirmed', reason: 'recording_error' }).success).toBe(false);
  });

  it('rejectsManualCancelledAndUnknown', () => {
    fails(corrupt({ type: 'manual_block' }), 'ATTENDANCE_UNSUPPORTED');
    for (const status of ['cancelled_by_client', 'cancelled_by_owner', 'unknown']) fails(corrupt({ status }), 'ATTENDANCE_UNSUPPORTED');
    fails(corrupt({ status: 'completed' }), 'ATTENDANCE_NO_CHANGE', attendanceNow, { ...attendanceCommand, expectedStatus: 'completed', correctionReason: 'recording_error' });
  });

  it('invalidOrMissingSavedTimesFailClosed', () => {
    for (const key of ['startAt', 'endAt', 'reservedUntilAt']) for (const value of [undefined, null, NaN, Infinity, 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) fails(corrupt({ [key]: value }), 'ATTENDANCE_RECORD_UNVERIFIABLE');
    for (const fields of [{ endAt: attendanceAppointment.startAt }, { reservedUntilAt: attendanceAppointment.endAt - 1 }, { dateKey: '2030-02-30' }, { dateKey: '2030-01-08' }, { resourceId: '../resource' }, { id: '' }, { tenantId: '../tenant' }, { rescheduleRevision: null }, { rescheduleRevision: Number.MAX_SAFE_INTEGER }]) fails(corrupt(fields), 'ATTENDANCE_RECORD_UNVERIFIABLE');
    fails(attendanceAppointment, 'ATTENDANCE_RECORD_UNVERIFIABLE', NaN);
    const midnight = corrupt({ startAt: Date.parse('2030-01-08T04:50:00Z'), endAt: Date.parse('2030-01-08T05:20:00Z'), reservedUntilAt: Date.parse('2030-01-08T05:35:00Z') });
    expect(() => assertAttendanceTransition(midnight, attendanceCommand, Date.parse('2030-01-08T05:35:00Z'))).not.toThrow();
  });

  it('deletedCatalogDoesNotRewriteHistory', async () => {
    const { db } = memoryFirestore(), fixture = await attendanceFixture(db);
    const before = structuredClone(fixture.appointment);
    await fixture.businessRef.set({ ...fixture.business, resources: [], services: [] });
    assertAttendanceTransition(fixture.appointment, attendanceCommand, attendanceNow);
    expect(fixture.appointment).toEqual(before);
    await fixture.businessRef.set({ ...fixture.business, services: [{ ...fixture.business.services[0], bufferMinutes: 0 }] });
    fails(fixture.appointment, 'ATTENDANCE_TOO_EARLY', attendanceNow - 1);
    expect((await fixture.businessRef.get()).data()?.subscription).toEqual(attendanceBusiness.subscription);
  });

  it('minorReviewAndLegacyClientFieldsArePreserved', () => {
    const appointment = structuredClone(attendanceAppointment), before = structuredClone(appointment);
    assertAttendanceTransition(appointment, attendanceCommand, attendanceNow);
    expect(appointment).toEqual(before);
    const { client: _client, ...legacy } = appointment;
    expect(() => assertAttendanceTransition(legacy, attendanceCommand, attendanceNow)).not.toThrow();
    for (const uid of ['', null, 123, 'x'.repeat(129)]) fails(corrupt({ client: { ...appointment.client, uid } }), 'ATTENDANCE_RECORD_UNVERIFIABLE');
  });

  it('strictInputRejectsActorNotesAndTimestamp', () => {
    expect(appointmentAttendanceCommandSchema.parse(attendanceCommand)).toEqual(attendanceCommand);
    for (const key of ['actorUid', 'notes', 'recordedAt', 'businessId', 'appointmentId']) expect(appointmentAttendanceCommandSchema.safeParse({ ...attendanceCommand, [key]: 'untrusted' }).success).toBe(false);
    for (const requestId of ['short', 'contains space', '../bad-request', 'x'.repeat(129)]) expect(appointmentAttendanceCommandSchema.safeParse({ ...attendanceCommand, requestId }).success).toBe(false);
    expect(appointmentAttendanceEventSchema.parse(event())).toEqual(event());
    expect(appointmentAttendanceEventSchema.safeParse({ ...event(), source: { ...event().source, price: 100 } }).success).toBe(false);
  });

  it('revisionOverflowRejects', () => {
    for (const revision of [-1, 0.5, Number.MAX_SAFE_INTEGER, Infinity]) {
      for (const field of ['expectedRevision', 'expectedRescheduleRevision']) expect(appointmentAttendanceCommandSchema.safeParse({ ...attendanceCommand, [field]: revision }).success).toBe(false);
      expect(appointmentAttendanceEventSchema.safeParse({ ...event(), sequence: revision }).success).toBe(false);
    }
    for (const value of ['0', '01', '+1', '1.0', '1e3', ' 1', '9007199254740991', '9007199254740992']) expect(appointmentAttendanceCursorSchema.safeParse(value).success).toBe(false);
    expect(appointmentAttendanceCursorSchema.parse('20')).toBe(20);
  });

  it('lastSafeRevisionNeverWritesUnreadableMetadata', () => {
    const revision = Number.MAX_SAFE_INTEGER - 1;
    const appointment = corrupt({ attendance: { revision, lastEventId: 'demo-event' } });
    expect(readAttendanceMetadata(appointment)).toEqual({ revision, lastEventId: 'demo-event' });
    fails(appointment, 'ATTENDANCE_RECORD_UNVERIFIABLE', attendanceNow, { ...attendanceCommand, expectedRevision: revision });
    expect(() => readAttendanceMetadata(corrupt({ attendance: { revision: Number.MAX_SAFE_INTEGER, lastEventId: 'demo-event' } }))).toThrow(AttendanceModelError);
  });

  it('correctionReasonDependsOnExpectedStatus', () => {
    expect(appointmentAttendanceCommandSchema.safeParse({ ...attendanceCommand, correctionReason: 'recording_error' }).success).toBe(false);
    expect(appointmentAttendanceCommandSchema.safeParse({ ...attendanceCommand, expectedStatus: 'no_show' }).success).toBe(false);
    expect(appointmentAttendanceCommandSchema.safeParse({ ...attendanceCommand, expectedStatus: 'no_show', correctionReason: 'recording_error' }).success).toBe(true);
    for (const fields of [{ expectedRevision: 1 }, { expectedRescheduleRevision: 1 }, { expectedStatus: 'no_show', correctionReason: 'recording_error' }]) fails(attendanceAppointment, 'ATTENDANCE_SOURCE_CHANGED', attendanceNow, { ...attendanceCommand, ...fields });
    for (const fields of [{ recordedAt: attendanceNow - 1 }, { reason: 'recording_error' }, { legacyPreviousOutcome: true }, { status: 'confirmed' }]) expect(appointmentAttendanceEventSchema.safeParse({ ...event(), ...fields }).success).toBe(false);
  });

  it('legacyFlagMatchesTheFirstRealCorrectionOnly', () => {
    const correction = { ...event(), previousStatus: 'no_show', reason: 'recording_error' };
    expect(appointmentAttendanceEventSchema.safeParse(correction).success).toBe(false);
    expect(appointmentAttendanceEventSchema.safeParse({ ...correction, legacyPreviousOutcome: true }).success).toBe(true);
    expect(appointmentAttendanceEventSchema.safeParse({ ...correction, sequence: 2 }).success).toBe(true);
    expect(appointmentAttendanceEventSchema.safeParse({ ...correction, sequence: 2, legacyPreviousOutcome: true }).success).toBe(false);
  });
});
