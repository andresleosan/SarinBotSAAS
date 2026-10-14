import { describe, expect, it } from 'vitest';
import { getAvailableSlots } from '../src/lib/sarin/availability';
import type { Appointment, Tenant } from '../src/types/firestore';

const tenant = {
  id: 'one', resources: [{ id: 'chair', name: 'Silla', active: true }],
  services: [{ id: 'cut', name: 'Corte', durationMinutes: 30, bufferMinutes: 15, price: 20000, resourceIds: ['chair'] }],
  weeklySchedule: { 1: { isOpen: true, intervals: [{ start: '09:00', end: '11:00' }] } },
} as unknown as Tenant;
const appointment = {
  id: 'existing', tenantId: 'one', dateKey: '2030-01-07', resourceId: 'chair',
  startTimeStr: '09:00', endTimeStr: '09:30',
  startAt: Date.parse('2030-01-07T09:00:00-05:00'), endAt: Date.parse('2030-01-07T09:30:00-05:00'),
  reservedUntilAt: Date.parse('2030-01-07T09:45:00-05:00'), status: 'confirmed',
} as Appointment;
function slots(existingAppointments: Appointment[] = [], dateKey = '2030-01-07') {
  return getAvailableSlots({ tenant, dateKey, serviceId: 'cut', existingAppointments })[0]?.slots ?? [];
}

describe('real availability boundaries', () => {
  it('keeps cleanup inside the opening interval', () => {
    expect(slots()).not.toContain('10:30');
    expect(slots()).toContain('10:15');
  });
  it('reserves the previous appointment cleanup buffer', () => {
    expect(slots([appointment])).not.toContain('09:30');
    expect(slots([appointment])).toContain('09:45');
  });
  it('ignores appointments on another date', () => {
    expect(slots([{ ...appointment, dateKey: '2030-01-08' }])).toContain('09:00');
  });
  it('ignores cancelled appointments', () => {
    expect(slots([{ ...appointment, status: 'cancelled_by_client' }])).toContain('09:00');
  });
  it('rejects normalized but invalid calendar dates', () => {
    expect(slots([], '2030-02-30')).toEqual([]);
  });
  it('rejects a zero step instead of looping forever', () => {
    expect(() => getAvailableSlots({ tenant, dateKey: '2030-01-07', serviceId: 'cut', existingAppointments: [], stepMinutes: 0 })).toThrow();
  });
});
