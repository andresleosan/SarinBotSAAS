export function generateICSFileContent(params: {
  businessName: string;
  serviceName: string;
  resourceName?: string;
  startAt: number;
  endAt: number;
  uid: string;
}): string {
  const { businessName, serviceName, resourceName, startAt, endAt, uid } = params;
  const validTimestamp = (value: number) => Number.isSafeInteger(value) && value % 1000 === 0 && value >= -62135596800000 && value <= 253402300799000;
  if (![startAt, endAt].every(validTimestamp) || endAt - startAt < 60_000 || endAt - startAt > 7 * 86_400_000) throw new Error('Fecha, hora o duración no válida.');
  if (typeof uid !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._@+-]{0,254}$/.test(uid)) throw new Error('Identificador de calendario no válido.');
  if ([businessName, serviceName, ...(resourceName === undefined ? [] : [resourceName])].some(value => typeof value !== 'string' || /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(value))) throw new Error('Texto de calendario no válido.');
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
    `UID:${uid}`,
    `DTSTAMP:${formatICSDate(new Date())}`,
    `SUMMARY:${escape(`${serviceName} · ${businessName}`)}`,
    `DTSTART:${formatICSDate(new Date(startAt))}`,
    `DTEND:${formatICSDate(new Date(endAt))}`,
    `DESCRIPTION:${escape(`${resourceName ? `Profesional o estación: ${resourceName}\n` : ''}Consulta Mis citas para ver cambios o cancelaciones. Esta copia no se actualiza automáticamente.`)}`,
    'STATUS:CONFIRMED',
    'END:VEVENT',
    'END:VCALENDAR',
  ].map(fold).join('\r\n') + '\r\n';
}

export function downloadICSFile(content: string, filename?: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: 'text/calendar;charset=utf-8' }));
  let anchor: HTMLAnchorElement | undefined;
  let started = false;
  try {
    anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename ?? `cita-${new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())}.ics`;
    anchor.hidden = true;
    document.body.appendChild(anchor);
    anchor.click();
    started = true;
  } finally {
    try {
      anchor?.remove();
    } finally {
      if (started) setTimeout(() => URL.revokeObjectURL(url), 60_000);
      else URL.revokeObjectURL(url);
    }
  }
}
