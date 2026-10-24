import { z } from 'zod';
import type { Business, DaySchedule, TenantResource } from '@/types/firestore';
import { isDateKey, isTimeString, toMinutes, toTimeStr } from '@/lib/sarin/calendar-time';

export type ScheduleInterval = { start: string; end: string };
export type ResourceWeeklySchedule = { resourceId: string; weeklySchedule: Business['weeklySchedule'] };
export type ResourceDateSchedule = { resourceId: string; dateKey: string; day: DaySchedule };
export type ScheduleClosure = { id: string; fromDateKey: string; throughDateKey: string; interval: ScheduleInterval | null; label: string } & ({ scope: 'business'; resourceId?: never } | { scope: 'resource'; resourceId: string });
export type ResourceScheduleRules = { weekly: ResourceWeeklySchedule[]; exceptions: ResourceDateSchedule[]; closures: ScheduleClosure[] };
export type ResourceSchedulePolicy = { version: 1; businessId: string; revision: number; rules: ResourceScheduleRules; updatedAt: number | null };
export type ResourceScheduleBasis = { weeklySchedule: Business['weeklySchedule']; resources: TenantResource[] };
export type ResourceScheduleCommand = { requestId: string; expectedRevision: number; expectedBasisFingerprint: string; rules: ResourceScheduleRules };
export type ResourceScheduleReceipt = { requestId: string; operationHash: string; resultRevision: number; appliedAt: number };
export type ResourceScheduleView = { businessId: string; ownerUid: string; policy: ResourceSchedulePolicy; basis: ResourceScheduleBasis; basisFingerprint: string; writesEnabled: boolean; serverNow: number; operation: ResourceScheduleReceipt | null };
export type ResourceScheduleSaveResult = ResourceScheduleView & { operation: ResourceScheduleReceipt; replayed: boolean };

const reserved = new Set(['__proto__', 'prototype', 'constructor']);
const id = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/).refine(value => !reserved.has(value) && !/[\x00-\x20\x7f]/.test(value), 'Identificador no permitido.');
const time = z.string().length(5).refine(isTimeString, 'Usa HH:mm.');
const date = z.string().length(10).refine(isDateKey, 'Fecha inválida.');
const interval = z.object({ start: time, end: time }).strict().refine(value => value.start < value.end, 'El final debe ser posterior al inicio.');
const day = z.object({ isOpen: z.boolean(), intervals: z.array(interval).max(5) }).strict().superRefine((value, context) => {
  if ((value.isOpen && value.intervals.length === 0) || (!value.isOpen && value.intervals.length !== 0)) context.addIssue({ code: 'custom', path: ['intervals'], message: value.isOpen ? 'Añade un intervalo de atención.' : 'Un día cerrado no tiene intervalos.' });
  const sorted = [...value.intervals].sort((a, b) => a.start < b.start ? -1 : a.start > b.start ? 1 : 0);
  for (let index = 1; index < sorted.length; index++) if (sorted[index].start < sorted[index - 1].end) context.addIssue({ code: 'custom', path: ['intervals'], message: 'Los intervalos se superponen.' });
});
const weeklySchedule = z.object({ '0': day, '1': day, '2': day, '3': day, '4': day, '5': day, '6': day }).strict();
const closureFields = { id, fromDateKey: date, throughDateKey: date, interval: interval.nullable(), label: z.string().max(120) };
const closure = z.discriminatedUnion('scope', [
  z.object({ ...closureFields, scope: z.literal('business') }).strict(),
  z.object({ ...closureFields, scope: z.literal('resource'), resourceId: id }).strict(),
]).refine(value => value.fromDateKey <= value.throughDateKey && Date.parse(`${value.throughDateKey}T12:00:00Z`) - Date.parse(`${value.fromDateKey}T12:00:00Z`) <= 365 * 86400000, 'El cierre debe tener entre uno y 366 días.');

export const resourceScheduleRulesSchema = z.object({
  weekly: z.array(z.object({ resourceId: id, weeklySchedule }).strict()).max(30),
  exceptions: z.array(z.object({ resourceId: id, dateKey: date, day }).strict()).max(120),
  closures: z.array(closure).max(120),
}).strict().superRefine((value, context) => {
  for (const [field, keys] of [
    ['weekly', value.weekly.map(item => item.resourceId)],
    ['exceptions', value.exceptions.map(item => `${item.resourceId}:${item.dateKey}`)],
    ['closures', value.closures.map(item => item.id)],
  ] as const) if (new Set(keys).size !== keys.length) context.addIssue({ code: 'custom', path: [field], message: 'Hay reglas repetidas.' });
});
export const resourceSchedulePolicySchema = z.object({ version: z.literal(1), businessId: id, revision: z.number().int().nonnegative().safe(), rules: resourceScheduleRulesSchema, updatedAt: z.number().int().positive().safe().nullable() }).strict().superRefine((value, context) => {
  if ((value.revision === 0) !== (value.updatedAt === null)) context.addIssue({ code: 'custom', path: ['updatedAt'], message: 'No se puede verificar la revisión del horario.' });
});

export function emptyResourceSchedulePolicy(businessId: string): ResourceSchedulePolicy {
  return { version: 1, businessId: id.parse(businessId), revision: 0, rules: { weekly: [], exceptions: [], closures: [] }, updatedAt: null };
}

export function canonicalResourceScheduleRules(rules: ResourceScheduleRules): ResourceScheduleRules {
  const ordinal = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
  const canonicalDay = (value: DaySchedule): DaySchedule => ({ isOpen: value.isOpen, intervals: value.intervals.map(item => ({ start: item.start, end: item.end })).sort((a, b) => ordinal(a.start, b.start)) });
  return {
    weekly: rules.weekly.map(item => ({ resourceId: item.resourceId, weeklySchedule: Object.fromEntries(Array.from({ length: 7 }, (_, i) => [i, canonicalDay(item.weeklySchedule[i])])) })).sort((a, b) => ordinal(a.resourceId, b.resourceId)),
    exceptions: rules.exceptions.map(item => ({ resourceId: item.resourceId, dateKey: item.dateKey, day: canonicalDay(item.day) })).sort((a, b) => ordinal(a.resourceId, b.resourceId) || ordinal(a.dateKey, b.dateKey)),
    closures: rules.closures.map(item => ({ ...item, interval: item.interval ? { start: item.interval.start, end: item.interval.end } : null })).sort((a, b) => ordinal(a.id, b.id)),
  };
}

/** Preserve each common interval boundary, including adjacent intervals. */
export function resolveResourceDaySchedule({ business, policy, resourceId, dateKey }: { business: Pick<Business, 'weeklySchedule'>; policy: ResourceSchedulePolicy; resourceId: string; dateKey: string }): DaySchedule {
  const closed = (): DaySchedule => ({ isOpen: false, intervals: [] });
  if (!isDateKey(dateKey)) return closed();
  const weekday = new Date(`${dateKey}T12:00:00Z`).getUTCDay();
  const common = business.weeklySchedule[weekday];
  if (!common?.isOpen) return closed();
  const own = policy.rules.weekly.find(item => item.resourceId === resourceId)?.weeklySchedule[weekday] ?? common;
  const individual = policy.rules.exceptions.find(item => item.resourceId === resourceId && item.dateKey === dateKey)?.day ?? own;
  if (!individual.isOpen) return closed();
  const closures = policy.rules.closures.filter(item => item.fromDateKey <= dateKey && item.throughDateKey >= dateKey && (item.scope === 'business' || item.resourceId === resourceId));
  if (closures.some(item => item.interval === null)) return closed();
  let segments = common.intervals.flatMap(commonInterval => individual.intervals.map(ownInterval => [Math.max(toMinutes(commonInterval.start), toMinutes(ownInterval.start)), Math.min(toMinutes(commonInterval.end), toMinutes(ownInterval.end))] as [number, number]).filter(([start, end]) => start < end));
  for (const item of closures) {
    const cutStart = toMinutes(item.interval!.start), cutEnd = toMinutes(item.interval!.end);
    segments = segments.flatMap(([start, end]): [number, number][] => {
      if (cutStart >= end || cutEnd <= start) return [[start, end]];
      return [...(start < cutStart ? [[start, cutStart] as [number, number]] : []), ...(cutEnd < end ? [[cutEnd, end] as [number, number]] : [])];
    });
  }
  segments.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  return { isOpen: segments.length > 0, intervals: segments.map(([start, end]) => ({ start: toTimeStr(start), end: toTimeStr(end) })) };
}
