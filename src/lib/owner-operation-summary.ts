import { z } from 'zod';
import { isDateKey } from '@/lib/sarin/calendar-time';

export type OperationRange = { from: string; through: string };
export type OperationCounts = { total: number; confirmed: number; completed: number; noShow: number; cancelledByClient: number; cancelledByOwner: number; awaitingOutcome: number; confirmedEndUnverifiable: number };
export type OperationCoverage = { basis: 'stored_date_key'; invalidRecords: number; excludedManualBlocks: number };
export type OwnerOperationSummary = { businessId: string; ownerUid: string; range: OperationRange; timezone: 'America/Bogota'; serverNow: number; totals: OperationCounts; days: { dateKey: string; counts: OperationCounts }[]; coverage: OperationCoverage };
export class OperationSummaryRangeError extends Error { constructor() { super('Elige de 1 a 31 días, desde hace 365 días hasta hoy en Colombia.'); } }
export class OperationSummaryCapacityError extends Error { constructor() { super('El periodo supera el límite de consulta. Reduce las fechas.'); } }
const id = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/).refine(value => !['__proto__', 'prototype', 'constructor'].includes(value));
const uid = z.string().min(1).max(128).refine(value => !/[\x00-\x1f\x7f]/.test(value));
const date = z.string().refine(isDateKey);
const rangeSchema = z.object({ from: date, through: date }).strict();
const time = z.number().int().positive().max(8640000000000000);
const count = z.number().int().nonnegative().max(999);
const countKeys = ['total', 'confirmed', 'completed', 'noShow', 'cancelledByClient', 'cancelledByOwner', 'awaitingOutcome', 'confirmedEndUnverifiable'] as const;
const countsSchema = z.object({ total: count, confirmed: count, completed: count, noShow: count, cancelledByClient: count, cancelledByOwner: count, awaitingOutcome: count, confirmedEndUnverifiable: count }).strict().refine(value => value.total === value.confirmed + value.completed + value.noShow + value.cancelledByClient + value.cancelledByOwner && value.awaitingOutcome + value.confirmedEndUnverifiable <= value.confirmed);
const colombiaDate = (now: number) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
const addDays = (key: string, days: number) => new Date(Date.parse(`${key}T12:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
const daysIn = (range: OperationRange): string[] => Array.from({ length: Math.round((Date.parse(`${range.through}T12:00:00Z`) - Date.parse(`${range.from}T12:00:00Z`)) / 86400000) + 1 }, (_, index) => addDays(range.from, index));
export function parseOperationRange(input: { from: string; through: string }, now: number): OperationRange {
  const parsed = rangeSchema.safeParse(input);
  if (!parsed.success || !time.safeParse(now).success) throw new OperationSummaryRangeError();
  const range = parsed.data, today = colombiaDate(now);
  if (range.from > range.through || range.through > today || range.from < addDays(today, -365) || Date.parse(`${range.through}T12:00:00Z`) - Date.parse(`${range.from}T12:00:00Z`) > 30 * 86400000) throw new OperationSummaryRangeError();
  return range;
}
export function operationPresetRange(preset: 'today' | '7days' | '30days', now: number): OperationRange {
  if (!time.safeParse(now).success || !['today', '7days', '30days'].includes(preset)) throw new OperationSummaryRangeError();
  const through = colombiaDate(now), from = addDays(through, preset === 'today' ? 0 : preset === '7days' ? -6 : -29);
  return parseOperationRange({ from, through }, now);
}
export const ownerOperationSummarySchema = z.object({ businessId: id, ownerUid: uid, range: rangeSchema, timezone: z.literal('America/Bogota'), serverNow: time, totals: countsSchema, days: z.array(z.object({ dateKey: date, counts: countsSchema }).strict()).min(1).max(31), coverage: z.object({ basis: z.literal('stored_date_key'), invalidRecords: count, excludedManualBlocks: count }).strict() }).strict().superRefine((value, context) => {
  const invalid = () => context.addIssue({ code: 'custom', message: 'No se pudo verificar el resumen.' });
  try { parseOperationRange(value.range, value.serverNow); } catch { invalid(); return; }
  const dates = daysIn(value.range);
  if (dates.length !== value.days.length || value.days.some((day, index) => day.dateKey !== dates[index])) invalid();
  for (const key of countKeys) if (value.totals[key] !== value.days.reduce((sum, day) => sum + day.counts[key], 0)) invalid();
  if (value.totals.total + value.coverage.invalidRecords + value.coverage.excludedManualBlocks > 999) invalid();
});
const empty = (): OperationCounts => ({ total: 0, confirmed: 0, completed: 0, noShow: 0, cancelledByClient: 0, cancelledByOwner: 0, awaitingOutcome: 0, confirmedEndUnverifiable: 0 });
const statuses = { confirmed: 'confirmed', completed: 'completed', no_show: 'noShow', cancelled_by_client: 'cancelledByClient', cancelled_by_owner: 'cancelledByOwner' } as const;
export function summarizeOwnerOperation(input: { businessId: string; ownerUid: string; range: OperationRange; serverNow: number; records: { id: string; data: unknown }[] }): OwnerOperationSummary {
  if (input.records.length >= 1000) throw new OperationSummaryCapacityError();
  id.parse(input.businessId); uid.parse(input.ownerUid);
  const range = parseOperationRange(input.range, input.serverNow), days = daysIn(range).map(dateKey => ({ dateKey, counts: empty() }));
  const coverage: OperationCoverage = { basis: 'stored_date_key', invalidRecords: 0, excludedManualBlocks: 0 };
  for (const row of input.records) {
    const data = row.data;
    if (!data || typeof data !== 'object' || Array.isArray(data)) { coverage.invalidRecords++; continue; }
    const value = data as Record<string, unknown>;
    if (!id.safeParse(row.id).success || (Object.hasOwn(value, 'id') && (value.id !== row.id || !id.safeParse(value.id).success)) || value.tenantId !== input.businessId || typeof value.dateKey !== 'string' || !isDateKey(value.dateKey) || value.dateKey < range.from || value.dateKey > range.through) { coverage.invalidRecords++; continue; }
    if (value.type === 'manual_block') { coverage.excludedManualBlocks++; continue; }
    if (value.type !== 'appointment' || typeof value.status !== 'string' || !Object.hasOwn(statuses, value.status)) { coverage.invalidRecords++; continue; }
    const counts = days.find(day => day.dateKey === value.dateKey)!.counts;
    counts.total++; counts[statuses[value.status as keyof typeof statuses]]++;
    if (value.status === 'confirmed') {
      const { startAt, endAt, reservedUntilAt } = value;
      if (time.safeParse(startAt).success && time.safeParse(endAt).success && time.safeParse(reservedUntilAt).success && (startAt as number) < (endAt as number) && (endAt as number) <= (reservedUntilAt as number) && colombiaDate(startAt as number) === value.dateKey) { if ((reservedUntilAt as number) <= input.serverNow) counts.awaitingOutcome++; }
      else counts.confirmedEndUnverifiable++;
    }
  }
  const totals = empty(); for (const day of days) for (const key of countKeys) totals[key] += day.counts[key];
  return ownerOperationSummarySchema.parse({ businessId: input.businessId, ownerUid: input.ownerUid, range, timezone: 'America/Bogota', serverNow: input.serverNow, totals, days, coverage });
}
