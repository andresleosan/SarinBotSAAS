import { z } from 'zod';
import { isDateKey, isTimeString } from '@/lib/sarin/calendar-time';

const DAY = 86_400_000;
const controls = /[\x00-\x1f\x7f]/;
const id = z.string().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/).refine(value => !controls.test(value) && !['__proto__', 'prototype', 'constructor'].includes(value));
const uid = z.string().min(1).max(128).refine(value => !controls.test(value));
const requestId = id.refine(value => value.length >= 8);
const integer = z.number().int().nonnegative().safe();
const revision = integer.max(Number.MAX_SAFE_INTEGER - 1);
const time = integer.max(8_640_000_000_000_000);
const date = z.string().refine(isDateKey);
const label = z.string().min(1).max(120).refine(value => !controls.test(value));
const endOfDate = (key: string) => Date.parse(`${key}T00:00:00-05:00`) + DAY;
const colombiaDate = (now: number) => new Date(now - 5 * 3_600_000).toISOString().slice(0, 10);

export class OwnerWaitlistModelError extends Error {
  constructor() { super('No se pudo verificar la solicitud de espera.'); }
}
export const ownerWaitlistCursorSchema = z.object({ recordId: id, entryId: id, createdAt: time }).strict();
export const ownerWaitlistQuerySchema = z.object({ dateKey: date, cursor: ownerWaitlistCursorSchema.optional() }).strict();
export const ownerWaitlistReviewCommandSchema = z.object({ requestId, entryId: id, expectedWaitlistRevision: integer.min(1), expectedReviewRevision: revision, reviewed: z.boolean() }).strict();
export const ownerWaitlistReviewSchema = z.object({ revision, reviewed: z.boolean(), updatedAt: time.nullable() }).strict()
  .refine(value => value.revision === 0 ? !value.reviewed && value.updatedAt === null : value.updatedAt !== null);
const markerFields = {
  businessId: id, waitlistRecordId: id, entryId: id, revision: revision.min(1), reviewed: z.boolean(), updatedAt: time, actorUid: uid,
  lastOperation: z.object({ requestId, operationHash: z.string().regex(/^[a-f0-9]{64}$/).refine(value => value.length === 64), appliedRevision: revision.min(1) }).strict(),
};
export const ownerWaitlistMarkerSchema = z.union([
  z.object({ version: z.literal(2), ...markerFields, waitlistRevision: integer.min(1) }).strict(),
  z.object({ version: z.literal(1), ...markerFields }).strict(),
]).refine(value => value.revision === value.lastOperation.appliedRevision);
export function markerMatchesWaitlistRevision(marker: z.infer<typeof ownerWaitlistMarkerSchema>, waitlistRevision: number): boolean {
  // Legacy markers can prove only the first incarnation. Rejoining with the
  // same client requestId retains its entryId but advances waitlist revision.
  const incarnation = marker.version === 2 ? marker.waitlistRevision : 1;
  if (incarnation > waitlistRevision) throw new OwnerWaitlistModelError();
  return incarnation === waitlistRevision;
}
export const ownerWaitlistRowSchema = z.object({
  recordId: id, entryId: id, waitlistRevision: integer.min(1), dateKey: date, createdAt: time, expiresAt: time,
  subjectKind: z.enum(['self', 'represented_minor']), serviceLabel: label, resourceLabel: label,
  lifecycle: z.enum(['unchecked', 'expired']), review: ownerWaitlistReviewSchema,
}).strict().refine(value => value.createdAt < value.expiresAt && value.expiresAt === endOfDate(value.dateKey));

export type OwnerWaitlistCursor = z.infer<typeof ownerWaitlistCursorSchema>;
export type OwnerWaitlistQuery = z.infer<typeof ownerWaitlistQuerySchema>;
export type OwnerWaitlistReviewCommand = z.infer<typeof ownerWaitlistReviewCommandSchema>;
export type OwnerWaitlistReview = z.infer<typeof ownerWaitlistReviewSchema>;
export type OwnerWaitlistRow = z.infer<typeof ownerWaitlistRowSchema>;
export function compareOwnerWaitlistRows(a: Pick<OwnerWaitlistRow, 'createdAt' | 'entryId'>, b: Pick<OwnerWaitlistRow, 'createdAt' | 'entryId'>): number {
  return a.createdAt - b.createdAt || (a.entryId < b.entryId ? -1 : a.entryId > b.entryId ? 1 : 0);
}
export function parseOwnerWaitlistDate(value: string, now: number): string {
  if (!date.safeParse(value).success || !time.safeParse(now).success || value > colombiaDate(now + 366 * DAY)) throw new OwnerWaitlistModelError();
  return value;
}
export const ownerWaitlistPageSchema = z.object({
  businessId: id, ownerUid: uid, dateKey: date, serverNow: time, rows: z.array(ownerWaitlistRowSchema).max(20),
  nextCursor: ownerWaitlistCursorSchema.nullable(), coverage: z.literal('current_indexed_requests'),
}).strict().superRefine((value, context) => {
  const invalid = () => context.addIssue({ code: 'custom', message: 'Bandeja no verificable.' });
  try { parseOwnerWaitlistDate(value.dateKey, value.serverNow); } catch { invalid(); }
  if (new Set(value.rows.map(row => row.recordId)).size !== value.rows.length || new Set(value.rows.map(row => row.entryId)).size !== value.rows.length) invalid();
  if (value.rows.some((row, index) => row.dateKey !== value.dateKey || row.lifecycle !== (row.expiresAt <= value.serverNow ? 'expired' : 'unchecked') || index > 0 && compareOwnerWaitlistRows(value.rows[index - 1], row) >= 0)) invalid();
  if (value.nextCursor) {
    const last = value.rows.at(-1);
    if (value.rows.length !== 20 || !last || last.recordId !== value.nextCursor.recordId || last.entryId !== value.nextCursor.entryId || last.createdAt !== value.nextCursor.createdAt) invalid();
  }
});
const availabilitySchema = z.array(z.object({ resourceId: id, resourceName: label, slots: z.array(z.string().refine(isTimeString)).max(288).refine(values => values.every((value, i) => !i || values[i - 1] < value)) }).strict()).max(30)
  .refine(values => new Set(values.map(value => value.resourceId)).size === values.length);
export const ownerWaitlistDetailSchema = z.object({
  businessId: id, ownerUid: uid, serverNow: time, row: ownerWaitlistRowSchema,
  state: z.enum(['waiting', 'available', 'suspended', 'expired']),
  reason: z.enum(['consent_changed', 'booking_policy_changed', 'business_unavailable', 'client_blocked', 'client_limit', 'service_unavailable']).optional(),
  availability: availabilitySchema,
}).strict().refine(value => {
  const expired = value.row.expiresAt <= value.serverNow;
  if (value.row.lifecycle !== (expired ? 'expired' : 'unchecked') || (value.state === 'expired') !== expired || (value.state === 'suspended') !== Boolean(value.reason)) return false;
  if (['suspended', 'expired'].includes(value.state)) return value.availability.length === 0;
  return (value.state === 'available') === value.availability.some(resource => resource.slots.length > 0);
});
export const ownerWaitlistReviewResultSchema = z.object({ businessId: id, ownerUid: uid, recordId: id, entryId: id, waitlistRevision: integer.min(1), review: ownerWaitlistReviewSchema, replayed: z.boolean() }).strict();
export const ownerWaitlistReviewStateSchema = z.object({ businessId: id, ownerUid: uid, recordId: id, waitlistRevision: integer.min(1), entryId: id.nullable(), review: ownerWaitlistReviewSchema.nullable(), serverNow: time }).strict()
  .refine(value => (value.entryId === null) === (value.review === null));
export type OwnerWaitlistPage = z.infer<typeof ownerWaitlistPageSchema>;
export type OwnerWaitlistDetail = z.infer<typeof ownerWaitlistDetailSchema>;
export type OwnerWaitlistReviewResult = z.infer<typeof ownerWaitlistReviewResultSchema>;
export type OwnerWaitlistReviewState = z.infer<typeof ownerWaitlistReviewStateSchema>;

export function readOwnerWaitlistReview(value: unknown, scope: { businessId: string; recordId: string; entryId: string; waitlistRevision: number }): OwnerWaitlistReview {
  if (value === undefined) return { revision: 0, reviewed: false, updatedAt: null };
  const parsed = ownerWaitlistMarkerSchema.safeParse(value);
  if (!parsed.success || parsed.data.businessId !== scope.businessId || parsed.data.waitlistRecordId !== scope.recordId || parsed.data.entryId !== scope.entryId) throw new OwnerWaitlistModelError();
  if (!markerMatchesWaitlistRevision(parsed.data, scope.waitlistRevision)) return { revision: 0, reviewed: false, updatedAt: null };
  return { revision: parsed.data.revision, reviewed: parsed.data.reviewed, updatedAt: parsed.data.updatedAt };
}
type ProjectionRecord = { revision: number; request: { id: string; dateKey: string; createdAt: number; expiresAt: number; serviceId: string; resourceId: string | null; case: { subjectKind: 'self' | 'represented_minor' } } | null };
export function projectOwnerWaitlistRow(recordId: string, record: ProjectionRecord, business: { id: string; services: { id: string; name: string }[]; resources: { id: string; name: string }[] }, review: OwnerWaitlistReview, serverNow: number): OwnerWaitlistRow {
  const item = record.request;
  if (!item) throw new OwnerWaitlistModelError();
  const parsed = ownerWaitlistRowSchema.safeParse({
    recordId, entryId: item.id, waitlistRevision: record.revision, dateKey: item.dateKey, createdAt: item.createdAt, expiresAt: item.expiresAt,
    subjectKind: item.case.subjectKind, serviceLabel: (business.services.find(service => service.id === item.serviceId)?.name ?? 'Servicio anterior').slice(0, 120),
    resourceLabel: item.resourceId === null ? 'Cualquiera elegible' : (business.resources.find(resource => resource.id === item.resourceId)?.name ?? 'Recurso anterior').slice(0, 120),
    lifecycle: item.expiresAt <= serverNow ? 'expired' : 'unchecked', review,
  });
  if (!parsed.success) throw new OwnerWaitlistModelError();
  return parsed.data;
}
