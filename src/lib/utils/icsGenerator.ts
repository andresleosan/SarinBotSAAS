export function generateICSFileContent(params: {
  businessName: string;
  serviceName: string;
  dateKey: string; // "YYYY-MM-DD"
  startTimeStr: string; // "14:30"
  durationMinutes: number;
  notes?: string;
}): string {
  const { businessName, serviceName, dateKey, startTimeStr, durationMinutes, notes = '' } = params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(startTimeStr) || !Number.isInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > 7 * 1440) throw new Error('Fecha, hora o duración no válida.');
  const date = new Date(`${dateKey}T12:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== dateKey) throw new Error('Fecha no válida.');
  // Colombia has no daylight saving time; exports are unambiguous on every device.
  const startDate = new Date(`${dateKey}T${startTimeStr}:00-05:00`);
  const endDate = new Date(startDate.getTime() + durationMinutes * 60000);
  const formatICSDate = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const escape = (text: string) => text.replace(/\\/g, '\\\\').replace(/\r\n|\r|\n/g, '\\n').replace(/;/g, '\\;').replace(/,/g, '\\,');
  // RFC 5545: fold by UTF-8 octets, preserving complete Unicode characters.
  const fold = (line: string) => {
    const lines: string[] = []; let part = ''; let bytes = 0;
    for (const char of line) {
      const size = new TextEncoder().encode(char).length;
      if (bytes + size > 75) { lines.push(part); part = ' '; bytes = 1; }
      part += char; bytes += size;
    }
    lines.push(part); return lines.join('\r\n');
  };
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Sarin Bot//Agenda Inteligente//ES',
    'BEGIN:VEVENT',
    `UID:${crypto.randomUUID()}@sarin.local`,
    `DTSTAMP:${formatICSDate(new Date())}`,
    `SUMMARY:${escape(`${serviceName} · ${businessName}`)}`,
    `DTSTART:${formatICSDate(startDate)}`,
    `DTEND:${formatICSDate(endDate)}`,
    `DESCRIPTION:${escape(notes || 'Recordatorio gestionado por Sarin Bot.')}`,
    'STATUS:CONFIRMED',
    'END:VEVENT',
    'END:VCALENDAR',
  ].map(fold).join('\r\n') + '\r\n';
}

export function downloadICSFile(content: string, filename = 'sarin-recordatorio.ics') {
  const url = URL.createObjectURL(new Blob([content], { type: 'text/calendar;charset=utf-8' }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = filename; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
