export function isDateKey(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function isTimeString(value: string): boolean {
  return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
}

export function toMinutes(value: string): number {
  if (!isTimeString(value)) throw new RangeError('Hora inválida; usa HH:mm.');
  const [hour, minute] = value.split(':').map(Number);
  return hour * 60 + minute;
}

export function toTimeStr(minutes: number): string {
  return `${Math.floor(minutes / 60).toString().padStart(2, '0')}:${(minutes % 60).toString().padStart(2, '0')}`;
}

// Colombia uses UTC-05:00. Never interpret bookings in the host timezone.
export function toColombiaTimestamp(dateKey: string, time: string): number {
  if (!isDateKey(dateKey) || !isTimeString(time)) throw new RangeError('Fecha u hora inválida.');
  return Date.parse(`${dateKey}T${time}:00-05:00`);
}
