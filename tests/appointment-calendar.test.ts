import { describe, expect, it } from 'vitest';
import type { AppointmentCalendarDetails } from '@/lib/client/appointment-calendar';

const details: AppointmentCalendarDetails = {
  businessId: 'business-private',
  appointmentId: 'appointment-private',
  businessName: 'Negocio sintético',
  serviceName: 'Servicio sintético',
  resourceName: 'Profesional sintético',
  startAt: Date.parse('2026-10-18T09:00:00-05:00'),
  endAt: Date.parse('2026-10-18T10:00:00-05:00'),
};
const unfold = (content: string) => content.replace(/\r\n[ \t]/g, '');
const createCalendar = async (input: AppointmentCalendarDetails) => {
  const { createAppointmentCalendar } = await import('@/lib/client/appointment-calendar');
  return unfold(await createAppointmentCalendar(input));
};
const uidLine = (content: string) => content.split('\r\n').find(line => line.startsWith('UID:'));

describe('appointment calendar adapter', () => {
  it('hashes the business and appointment pair with SHA-256 without exposing their raw IDs', async () => {
    await expect(createCalendar(details)).resolves.toContain('UID:31aa64b6b54d48e9e49d0d6766cb7dc8795ea756148cbff18c74bbaee36b58c3@alsdevstudio.com\r\n');
    const result = await createCalendar(details);
    expect(result).not.toMatch(/business-private|appointment-private/);
  });

  it('keeps the UID when re-exporting a rescheduled appointment and exports its actual new times', async () => {
    const first = await createCalendar(details);
    const changed = await createCalendar({ ...details, startAt: Date.parse('2026-10-19T11:15:00-05:00'), endAt: Date.parse('2026-10-19T12:00:00-05:00') });
    expect(uidLine(changed)).toBe(uidLine(first));
    expect(changed).toContain('DTSTART:20261019T161500Z\r\n');
    expect(changed).toContain('DTEND:20261019T170000Z\r\n');
  });

  it('distinguishes businesses and appointment IDs with an unambiguous hash input', async () => {
    const original = await createCalendar(details);
    const otherBusiness = await createCalendar({ ...details, businessId: 'another-business' });
    const otherAppointment = await createCalendar({ ...details, appointmentId: 'another-appointment' });
    const delimiterLeft = await createCalendar({ ...details, businessId: 'a|b', appointmentId: 'c' });
    const delimiterRight = await createCalendar({ ...details, businessId: 'a', appointmentId: 'b|c' });
    expect(new Set([original, otherBusiness, otherAppointment].map(uidLine)).size).toBe(3);
    expect(uidLine(delimiterLeft)).not.toBe(uidLine(delimiterRight));
  });

  it('exports only allowlisted display fields and ignores private appointment extensions', async () => {
    const input = { ...details, uid: 'PRIVATE-CLIENT-UID', notes: 'PRIVATE-NOTES', intake: { answer: 'PRIVATE-INTAKE' }, clientEmail: 'PRIVATE-EMAIL', clientPhone: 'PRIVATE-PHONE', beneficiaryName: 'PRIVATE-BENEFICIARY', patient: 'PRIVATE-PATIENT' };
    const result = await createCalendar(input);
    expect(result).toContain('SUMMARY:Servicio sintético · Negocio sintético\r\n');
    expect(result).toContain('Profesional o estación: Profesional sintético');
    expect(result).not.toMatch(/PRIVATE-|ATTENDEE|ORGANIZER|CONTACT|VALARM|TRIGGER/);
  });

  it.each([{ businessId: '' }, { appointmentId: '' }, { businessId: null }, { appointmentId: 42 }])('rejects missing or malformed identity fields: %j', async invalid => {
    await expect(createCalendar({ ...details, ...invalid } as AppointmentCalendarDetails)).rejects.toThrow();
  });
});
