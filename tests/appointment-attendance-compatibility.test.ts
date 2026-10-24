import { afterEach, expect, it, vi } from 'vitest';
import { createDataTestRuntime } from '../cloudflare/tests/data-runtime.mjs';
import { createCloudflareDatabase, StorageError } from '@/lib/storage/database';
import type { DataCommitResult, DataReadResult } from '../shared/data-protocol';
import { readAppointmentAttendanceHistory, updateAppointmentAttendance } from '@/lib/server/appointment-attendance';
import { cancelAppointment, readAppointments } from '@/lib/server/bookings';
import { attendanceFixture, attendanceNow } from './appointment-attendance-contract';

afterEach(() => { vi.restoreAllMocks(); });
it('actual previous-allowlist Worker fails closed for new attendance app with zero SQL writes', async () => {
  vi.spyOn(Date, 'now').mockReturnValue(attendanceNow);
  const runtime = await createDataTestRuntime({ previousBusinessChildren: true });
  const db = createCloudflareDatabase(async command => {
    const response = await runtime.fetch(command), value = await response.json() as DataReadResult | DataCommitResult;
    if (!response.ok) throw new StorageError(response.status, (value as unknown as { code: string }).code);
    return value;
  });
  const state = async () => Promise.all(['app_documents', 'app_commits', 'app_revision'].map(async table => (await runtime.db.prepare(`SELECT * FROM ${table} ORDER BY 1`).all()).results));
  try {
    const f = await attendanceFixture(db), prior = await state();
    await expect(updateAppointmentAttendance(f.owner, f.business.id, f.appointment.id, f.command, db)).rejects.toThrow();
    await expect(readAppointmentAttendanceHistory(f.owner, f.business.id, f.appointment.id, undefined, db)).rejects.toThrow();
    expect(await state()).toEqual(prior);
    // An explicit mixed commit proves the old Worker rejects before applying
    // an earlier appointment/lock write; the rejection is not supplied by a mock.
    const revision = prior[2][0].revision;
    const response = await runtime.fetch({ action: 'commit', expectedRevision: revision, requestId: crypto.randomUUID(), writes: [
      { op: 'set', path: f.appointmentRef.path, data: { ...f.appointment, status: 'completed' } },
      { op: 'set', path: `${f.businessRef.path}/bookingLocks/2030-01-07_demo-chair`, data: { version: 1 } },
      { op: 'create', path: `${f.businessRef.path}/attendanceEvents/demo-event`, data: { sequence: 1 } },
    ] });
    expect(response.status).toBe(400); expect((await response.json()).code).toBe('DATA_INVALID');
    expect(await state()).toEqual(prior);
  } finally { await runtime.dispose(); }
}, 60000);

it('unchanged daily reader and terminal cancel preserve attendance and private events', async () => {
  vi.spyOn(Date, 'now').mockReturnValue(attendanceNow);
  const runtime = await createDataTestRuntime();
  const db = createCloudflareDatabase(async command => {
    const response = await runtime.fetch(command), value = await response.json() as DataReadResult | DataCommitResult;
    if (!response.ok) throw new StorageError(response.status, (value as unknown as { code: string }).code);
    return value;
  });
  try {
    const f = await attendanceFixture(db), result = await updateAppointmentAttendance(f.owner, f.business.id, f.appointment.id, f.command, db);
    const prior = (await runtime.db.prepare('SELECT * FROM app_documents ORDER BY path').all()).results;
    const daily = await readAppointments(f.business.id, f.appointment.dateKey, f.owner, db);
    expect(daily).toEqual([result.appointment]);
    expect(daily[0]).not.toHaveProperty('actorUid'); expect(daily[0]).not.toHaveProperty('events'); expect(daily[0]).not.toHaveProperty('reason');
    expect(await cancelAppointment(f.owner, f.business.id, f.appointment.id, db)).toEqual(result.appointment);
    expect((await runtime.db.prepare('SELECT * FROM app_documents ORDER BY path').all()).results).toEqual(prior);
  } finally { await runtime.dispose(); }
}, 60000);
