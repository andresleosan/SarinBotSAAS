import { describe, expect, it } from 'vitest';
import { generateICSFileContent } from '@/lib/utils/icsGenerator';

describe('calendar exports', () => {
  it('uses explicit Bogotá UTC time, escaped content and required metadata', () => {
    const result = generateICSFileContent({ businessName: 'Sarin;Privado', serviceName: 'Pago, factura\nBEGIN:VEVENT', dateKey: '2026-10-13', startTimeStr: '23:30', durationMinutes: 90 });
    expect(result).toContain('DTSTART:20261014T043000Z');
    expect(result).toContain('DTEND:20261014T060000Z');
    expect(result).toContain('UID:'); expect(result).toContain('DTSTAMP:');
    expect(result).toContain('Pago\\, factura\\nBEGIN:VEVENT');
    expect(result.match(/\r\nBEGIN:VEVENT\r\n/g)).toHaveLength(1);
    for (const line of result.split('\r\n')) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
  });
  it('rejects normalized impossible dates and invalid times', () => {
    for (const dateKey of ['2026-02-30', 'bad']) expect(() => generateICSFileContent({ businessName:'x',serviceName:'y',dateKey,startTimeStr:'09:00',durationMinutes:30 })).toThrow();
    expect(() => generateICSFileContent({ businessName:'x',serviceName:'y',dateKey:'2026-10-13',startTimeStr:'25:00',durationMinutes:30 })).toThrow();
  });
});
