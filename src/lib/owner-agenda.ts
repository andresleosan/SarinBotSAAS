import type { Appointment, Business, TenantResource } from '@/types/firestore';

export type OwnerAgendaMode = 'day' | 'week';
export type OwnerAgendaRange = { selectedDate: string; dates: string[]; queryDates: string[]; outsideDates: string[] };
export type OwnerAgendaResource = { id: string; label: string; kind: 'active' | 'inactive' | 'unknown' };
export type OwnerAgendaBlock = { appointmentId: string; resourceId: string; startMinute: number; serviceEndMinute: number; reservedEndMinute: number; lane: number; laneCount: number; manual: boolean };
export type OwnerAgendaDay = { dateKey: string; state: 'ready'; appointments: Appointment[] } | { dateKey: string; state: 'error'; message: string } | { dateKey: string; state: 'outside' };
export type OwnerAgendaSnapshot = { days: OwnerAgendaDay[]; checkedAt: number };
export type OwnerAgendaDayLayout = { blocks: OwnerAgendaBlock[]; warnings: Record<string, string[]> };

export const OWNER_AGENDA_PIXELS_PER_HOUR = 64;

const DAY_MS = 86400000;
const MINUTE_MS = 60000;
const colombiaDate = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit',
});
const colombiaTime = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Bogota', calendar: 'iso8601', numberingSystem: 'latn',
  year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  second: '2-digit', fractionalSecondDigits: 3, hourCycle: 'h23',
});

// A UTC-shaped coordinate for the actual Bogotá wall clock, including historical offsets.
function wallTimestamp(value: number): number | null {
  if (!Number.isFinite(value) || !Number.isFinite(new Date(value).getTime())) return null;
  const parts = Object.fromEntries(colombiaTime.formatToParts(value).map(part => [part.type, part.value]));
  const day = dateTimestamp(`${parts.year.padStart(4, '0')}-${parts.month}-${parts.day}`);
  if (day === null) return null;
  return day + Number(parts.hour) * 60 * MINUTE_MS + Number(parts.minute) * MINUTE_MS + Number(parts.second) * 1000 + Number(parts.fractionalSecond);
}

function dateTimestamp(dateKey: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return null;
  const timestamp = Date.parse(`${dateKey}T00:00:00Z`);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === dateKey ? timestamp : null;
}

function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function agendaToday(now: number): string {
  return colombiaDate.format(now);
}

export function shiftAgendaDate(dateKey: string, days: number): string {
  const timestamp = dateTimestamp(dateKey);
  if (timestamp === null || !Number.isInteger(days)) throw new RangeError('Fecha no válida');
  return new Date(timestamp + days * DAY_MS).toISOString().slice(0, 10);
}

export function getOwnerAgendaRange(dateKey: string, mode: OwnerAgendaMode, now: number): OwnerAgendaRange | null {
  const timestamp = dateTimestamp(dateKey);
  if (timestamp === null || !Number.isFinite(now)) return null;
  const maximum = agendaToday(now + 366 * DAY_MS);
  if (dateKey > maximum) return null;
  const mondayOffset = (new Date(timestamp).getUTCDay() + 6) % 7;
  const first = mode === 'week' ? shiftAgendaDate(dateKey, -mondayOffset) : dateKey;
  const dates = Array.from({ length: mode === 'week' ? 7 : 1 }, (_, index) => shiftAgendaDate(first, index));
  return { selectedDate: dateKey, dates, queryDates: dates.filter(date => date <= maximum), outsideDates: dates.filter(date => date > maximum) };
}

export function getOwnerAgendaResources(resources: TenantResource[], days: OwnerAgendaDay[]): OwnerAgendaResource[] {
  const used = new Set(days.flatMap(day => day.state === 'ready' ? day.appointments.map(item => item.resourceId) : []));
  const active: OwnerAgendaResource[] = resources.filter(resource => resource.active).map(resource => ({ id: resource.id, label: resource.name, kind: 'active' }));
  const known = new Map(resources.map(resource => [resource.id, resource]));
  const historical = [...used].filter(id => !known.get(id)?.active).sort(compareIds).map((id): OwnerAgendaResource => {
    const resource = known.get(id);
    return resource
      ? { id, label: `${resource.name} · Inactivo`, kind: 'inactive' }
      : { id, label: `Recurso no disponible · ${id}`, kind: 'unknown' };
  });
  return [...active, ...historical];
}

export function getOwnerAgendaDayLayout(dateKey: string, appointments: Appointment[]): OwnerAgendaDayLayout {
  const blocks: OwnerAgendaBlock[] = [];
  const warnings: Record<string, string[]> = {};
  const timestamp = dateTimestamp(dateKey);
  const warn = (id: string, message: string) => {
    // IDs are server data; define an own property even for names such as __proto__.
    if (!Object.hasOwn(warnings, id)) Object.defineProperty(warnings, id, { value: [], enumerable: true });
    warnings[id].push(message);
  };
  const clipMinute = (value: number) => Math.max(0, Math.min(1440, value));
  const ordered = [...appointments].sort((a, b) => {
    const aStart = Number.isFinite(a.startAt) ? a.startAt : Infinity;
    const bStart = Number.isFinite(b.startAt) ? b.startAt : Infinity;
    return aStart - bStart || compareIds(a.id, b.id);
  });
  for (const item of ordered) {
    const manual = item.type === 'manual_block';
    if (timestamp === null || !Number.isFinite(item.startAt) || !Number.isFinite(item.endAt) || item.endAt <= item.startAt) {
      warn(item.id, 'Horario no verificable');
      continue;
    }
    let reservedEnd = item.endAt;
    if (!manual) {
      if (Number.isFinite(item.reservedUntilAt) && item.reservedUntilAt >= item.endAt) reservedEnd = item.reservedUntilAt;
      else warn(item.id, 'Margen no registrado');
    }
    const startWall = wallTimestamp(item.startAt);
    const endWall = wallTimestamp(item.endAt);
    const reservedWall = wallTimestamp(reservedEnd);
    // A fixed 24-hour graphic cannot faithfully represent an interval across an offset change.
    if (startWall === null || endWall === null || reservedWall === null ||
      endWall - startWall !== item.endAt - item.startAt || reservedWall - endWall !== reservedEnd - item.endAt) {
      warn(item.id, 'Horario no verificable');
      continue;
    }
    const startMinute = (startWall - timestamp) / MINUTE_MS;
    const serviceEndMinute = (endWall - timestamp) / MINUTE_MS;
    const reservedEndMinute = (reservedWall - timestamp) / MINUTE_MS;
    if (reservedEndMinute <= 0 || startMinute >= 1440) {
      warn(item.id, 'Horario no verificable');
      continue;
    }
    if (startMinute < 0 || reservedEndMinute > 1440) warn(item.id, 'El registro continúa fuera de este día');
    if (item.status !== 'confirmed') continue;
    blocks.push({ appointmentId: item.id, resourceId: item.resourceId, startMinute: clipMinute(startMinute), serviceEndMinute: clipMinute(serviceEndMinute), reservedEndMinute: clipMinute(reservedEndMinute), lane: 0, laneCount: 1, manual });
  }

  const byResource = new Map<string, OwnerAgendaBlock[]>();
  for (const block of blocks) {
    const resourceBlocks = byResource.get(block.resourceId) ?? [];
    resourceBlocks.push(block);
    byResource.set(block.resourceId, resourceBlocks);
  }
  for (const resourceBlocks of byResource.values()) {
    let group: OwnerAgendaBlock[] = [];
    let laneEnds: number[] = [];
    let groupEnd = -Infinity;
    const finishGroup = () => {
      for (const block of group) block.laneCount = laneEnds.length;
    };
    for (const block of resourceBlocks) {
      if (block.startMinute >= groupEnd) {
        finishGroup();
        group = [];
        laneEnds = [];
      }
      const freeLane = laneEnds.findIndex(end => end <= block.startMinute);
      block.lane = freeLane === -1 ? laneEnds.length : freeLane;
      laneEnds[block.lane] = block.reservedEndMinute;
      group.push(block);
      groupEnd = Math.max(...laneEnds);
    }
    finishGroup();
  }
  return { blocks, warnings };
}

function scheduleMinute(time: string): number | null {
  if (time === '24:00') return 1440;
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)) return null;
  const [hour, minute] = time.split(':').map(Number);
  return hour * 60 + minute;
}

export function getOwnerAgendaScale(schedule: Business['weeklySchedule'], range: OwnerAgendaRange, layouts: OwnerAgendaDayLayout[]): { startMinute: number; endMinute: number } {
  const starts: number[] = [];
  const ends: number[] = [];
  for (const date of range.dates) {
    const timestamp = dateTimestamp(date);
    if (timestamp === null) continue;
    const day = schedule[new Date(timestamp).getUTCDay()];
    if (!day?.isOpen) continue;
    for (const interval of day.intervals) {
      const start = scheduleMinute(interval.start);
      const end = scheduleMinute(interval.end);
      if (start !== null && end !== null && end > start) {
        starts.push(start);
        ends.push(end);
      }
    }
  }
  for (const layout of layouts) {
    for (const block of layout.blocks) {
      starts.push(block.startMinute);
      ends.push(block.reservedEndMinute);
    }
  }
  if (!starts.length) return { startMinute: 480, endMinute: 1080 };
  return { startMinute: Math.max(0, Math.floor(Math.min(...starts) / 60) * 60), endMinute: Math.min(1440, Math.ceil(Math.max(...ends) / 60) * 60) };
}

export function rejectDuplicateAgendaIds(days: OwnerAgendaDay[]): OwnerAgendaDay[] {
  const datesById = new Map<string, Set<string>>();
  for (const day of days) {
    if (day.state !== 'ready') continue;
    for (const appointment of day.appointments) {
      const dates = datesById.get(appointment.id) ?? new Set<string>();
      dates.add(day.dateKey);
      datesById.set(appointment.id, dates);
    }
  }
  const affected = new Set([...datesById.values()].filter(dates => dates.size > 1).flatMap(dates => [...dates]));
  return days.map(day => affected.has(day.dateKey) ? { dateKey: day.dateKey, state: 'error', message: 'La agenda cambió; actualiza' } : day);
}
