import { afterEach, describe, expect, it, vi } from 'vitest';
import { downloadICSFile, generateICSFileContent } from '@/lib/utils/icsGenerator';

const details = {
  businessName: 'Negocio de prueba',
  serviceName: 'Consulta',
  uid: 'test-calendar@alsdevstudio.com',
  startAt: Date.parse('2026-10-13T23:30:00-05:00'),
  endAt: Date.parse('2026-10-14T01:00:00-05:00'),
};
const unfold = (content: string) => content.replace(/\r\n[ \t]/g, '');

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('calendar exports', () => {
  it('exports the actual appointment timestamps in UTC across a Colombia midnight', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-17T15:00:00Z'));
    const result = generateICSFileContent(details);
    expect(result).toContain('DTSTART:20261014T043000Z\r\n');
    expect(result).toContain('DTEND:20261014T060000Z\r\n');
    expect(result).toContain('DTSTAMP:20261017T150000Z\r\n');
    expect(unfold(result)).toContain('UID:test-calendar@alsdevstudio.com\r\n');
    expect(result).toContain('SUMMARY:Consulta · Negocio de prueba\r\n');
    expect(result).toContain('STATUS:CONFIRMED\r\n');
    expect(result).toMatch(/^BEGIN:VCALENDAR\r\nVERSION:2.0\r\n/);
    expect(result).toMatch(/END:VEVENT\r\nEND:VCALENDAR\r\n$/);
    expect(result.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
  });

  it('includes only the optional professional and an honest static-copy notice in the description', () => {
    const input = { ...details, resourceName: 'Profesional sintético', notes: 'PRIVATE-NOTES', intake: 'PRIVATE-INTAKE', email: 'PRIVATE-CONTACT', beneficiaryName: 'PRIVATE-BENEFICIARY' };
    const result = unfold(generateICSFileContent(input));
    expect(result).toContain('DESCRIPTION:Profesional o estación: Profesional sintético\\n');
    expect(result).toContain('Consulta Mis citas para ver cambios o cancelaciones.');
    expect(result).toContain('Esta copia no se actualiza automáticamente.');
    expect(result).not.toMatch(/PRIVATE-|VALARM|TRIGGER|ATTENDEE|ORGANIZER|CONTACT|Recordatorio gestionado/);
    expect(unfold(generateICSFileContent(details))).not.toContain('Profesional o estación:');
  });

  it('escapes text so untrusted names cannot inject calendar properties or components', () => {
    const result = generateICSFileContent({
      ...details,
      businessName: 'Sarin;Prueba\\Local',
      serviceName: 'Pago, factura\r\nBEGIN:VEVENT\rATTENDEE:bad\nEND:VCALENDAR',
      resourceName: 'Estación;1,2\\3\r\nBEGIN:VALARM',
    });
    const unfolded = unfold(result);
    expect(unfolded).toContain('SUMMARY:Pago\\, factura\\nBEGIN:VEVENT\\nATTENDEE:bad\\nEND:VCALENDAR · Sarin\\;Prueba\\\\Local');
    expect(unfolded).toContain('Profesional o estación: Estación\\;1\\,2\\\\3\\nBEGIN:VALARM');
    expect(result.match(/\r\nBEGIN:VEVENT\r\n/g)).toHaveLength(1);
    expect(result.match(/\r\nEND:VCALENDAR\r\n/g)).toHaveLength(1);
    expect(result).not.toMatch(/\r\n(?:ATTENDEE|BEGIN:VALARM):?/);
  });

  it('folds long UTF-8 text to 75 octets without splitting Unicode characters', () => {
    const serviceName = 'á🌿漢'.repeat(50);
    const result = generateICSFileContent({ ...details, serviceName });
    expect(unfold(result)).toContain(`SUMMARY:${serviceName} · Negocio de prueba\r\n`);
    expect(result).toContain('\r\n ');
    for (const line of result.split('\r\n')) {
      expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
      expect(new TextDecoder('utf-8', { fatal: true }).decode(new TextEncoder().encode(line))).toBe(line);
    }
  });

  it.each([
    { startAt: Number.NaN },
    { startAt: Number.POSITIVE_INFINITY },
    { endAt: Number.NEGATIVE_INFINITY },
    { startAt: Date.parse('0000-12-31T23:59:00Z'), endAt: Date.parse('0001-01-01T00:01:00Z') },
    { startAt: Date.parse('9999-12-31T23:59:00Z'), endAt: Date.parse('+010000-01-01T00:01:00Z') },
    { startAt: 8.64e15 + 1, endAt: 8.64e15 + 60_001 },
    { startAt: details.startAt + 1 },
    { endAt: details.endAt + 0.5 },
  ])('rejects non-finite, out-of-range or fractional-second timestamps: %j', invalid => {
    expect(() => generateICSFileContent({ ...details, ...invalid })).toThrow();
  });

  it.each([0, -60_000, 59_000, 7 * 86_400_000 + 1000])('rejects an invalid duration of %i milliseconds', duration => {
    expect(() => generateICSFileContent({ ...details, endAt: details.startAt + duration })).toThrow();
  });

  it.each([60_000, 7 * 86_400_000])('accepts the inclusive duration boundary of %i milliseconds', duration => {
    expect(() => generateICSFileContent({ ...details, endAt: details.startAt + duration })).not.toThrow();
  });

  it('accepts whole-second times without rounding to display minutes', () => {
    const result = generateICSFileContent({ ...details, startAt: Date.parse('2026-10-18T15:00:42Z'), endAt: Date.parse('2026-10-18T15:01:42Z') });
    expect(result).toContain('DTSTART:20261018T150042Z\r\n');
    expect(result).toContain('DTEND:20261018T150142Z\r\n');
  });

  it.each(['', 'bad\r\nBEGIN:VEVENT', 'bad\nUID:another', 'bad,uid', 'bad;uid', 'bad\\uid', 'uid with spaces', 'x'.repeat(256)])('rejects an unsafe UID: %j', uid => {
    expect(() => generateICSFileContent({ ...details, uid })).toThrow();
  });

  it.each(['businessName', 'serviceName', 'resourceName'] as const)('rejects forbidden control characters in %s', field => {
    expect(() => generateICSFileContent({ ...details, [field]: 'text\u0000invalid' })).toThrow();
  });
});

function downloadDocument(click: () => void = () => undefined) {
  const anchor = { href: '', download: '', hidden: false, isConnected: false, click, remove() { this.isConnected = false; } };
  vi.stubGlobal('document', {
    createElement: () => anchor,
    body: { appendChild: () => { anchor.isConnected = true; } },
  });
  return anchor;
}

describe('calendar download', () => {
  it('downloads a calendar Blob and keeps its URL alive for 60 seconds while removing the anchor', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-18T02:30:00Z'));
    let clickedWhileConnected = false;
    const anchor = downloadDocument(() => { clickedWhileConnected = anchor.isConnected; });
    const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:synthetic-calendar');
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    downloadICSFile('BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n');
    const blob = create.mock.calls[0][0] as Blob;
    expect(blob.type).toBe('text/calendar;charset=utf-8');
    expect(await blob.text()).toBe('BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n');
    expect(anchor.href).toBe('blob:synthetic-calendar');
    expect(anchor.download).toBe('cita-2026-10-17.ics');
    expect(clickedWhileConnected).toBe(true);
    expect(anchor.isConnected).toBe(false);
    vi.advanceTimersByTime(59_999);
    expect(revoke).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(revoke).toHaveBeenCalledExactlyOnceWith('blob:synthetic-calendar');
  });

  it('uses an explicit appointment filename', () => {
    vi.useFakeTimers();
    const anchor = downloadDocument();
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:synthetic-calendar');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    downloadICSFile('calendar', 'cita-2026-11-02.ics');
    expect(anchor.download).toBe('cita-2026-11-02.ics');
    vi.runAllTimers();
  });

  it('cleans the anchor and URL when starting the download fails', () => {
    const anchor = downloadDocument(() => { throw new Error('Synthetic download failure'); });
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:synthetic-calendar');
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    expect(() => downloadICSFile('calendar')).toThrow('Synthetic download failure');
    expect(anchor.isConnected).toBe(false);
    expect(revoke).toHaveBeenCalledExactlyOnceWith('blob:synthetic-calendar');
  });

  it('releases the URL if creating the anchor fails', () => {
    vi.stubGlobal('document', { createElement: () => { throw new Error('Synthetic DOM failure'); } });
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:synthetic-calendar');
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    expect(() => downloadICSFile('calendar')).toThrow('Synthetic DOM failure');
    expect(revoke).toHaveBeenCalledExactlyOnceWith('blob:synthetic-calendar');
  });
});
