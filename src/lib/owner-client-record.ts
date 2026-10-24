import { z } from 'zod';
import { bookingBeneficiarySchema } from '@/lib/booking-subject';

// Client-safe equivalents of server ID/UID boundaries. Test the whole string:
// JavaScript's `$` also matches before a final newline.
const documentId = z.string().min(1).max(128).refine(value => !/[^A-Za-z0-9_-]/.test(value));
const noControls = (value: string) => !/[\x00-\x1f\x7f]/.test(value);
const clientUid = z.string().min(1).max(128).refine(noControls);
const timestamp = z.number().int().positive().safe().refine(value => Number.isFinite(new Date(value).getTime()));
const filterSchema = z.enum(['all', 'completed', 'no_show']);
const statusSchema = z.enum(['confirmed', 'cancelled_by_client', 'cancelled_by_owner', 'completed', 'no_show', 'unverified']);
const beneficiaryKindSchema = z.enum(['self', 'represented_minor', 'undeclared', 'unverified']);
const resourceName = z.string().min(1).max(120).refine(value => value.trim().length > 0 && noControls(value));
const resourceSchema = z.object({ id: documentId, name: resourceName, active: z.boolean() });
const cursorSchema = z.object({
  appointmentId: documentId, startAt: timestamp,
  revision: z.string().length(64).refine(value => !/[^a-f0-9]/.test(value)),
}).strict();
const colombiaDate = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Bogota', calendar: 'iso8601', numberingSystem: 'latn',
  year: 'numeric', month: '2-digit', day: '2-digit',
});
function dateKeyFromStart(startAt: number): string {
  const parts = Object.fromEntries(colombiaDate.formatToParts(startAt).map(part => [part.type, part.value]));
  return `${parts.year.padStart(4, '0')}-${parts.month}-${parts.day}`;
}
const rowSchema = z.object({
  appointmentId: documentId, dateKey: z.string(), startAt: timestamp, endAt: timestamp.nullable(),
  status: statusSchema, resourceLabel: z.string().min(1).max(120).refine(value => value.trim().length > 0 && noControls(value)),
  beneficiaryKind: beneficiaryKindSchema,
}).strict().refine(row => timestamp.safeParse(row.startAt).success && row.dateKey === dateKeyFromStart(row.startAt)
  && (row.endAt === null || row.endAt >= row.startAt), 'No se pudo verificar la fecha guardada.');

export type OwnerClientRecordFilter = z.infer<typeof filterSchema>;
export type OwnerClientRecordCursor = z.infer<typeof cursorSchema>;
export type OwnerClientRecordRow = z.infer<typeof rowSchema>;
export type OwnerClientRecordPage = z.infer<typeof ownerClientRecordPageSchema>;
export type OwnerClientRecordProjectionContext = {
  businessId: string; clientUid: string; resources: readonly unknown[];
};

export const ownerClientRecordInputSchema = z.object({
  clientUid, filter: filterSchema, cursor: cursorSchema.optional(),
}).strict();

/** Descending saved start time, then ordinal ASCII IDs; independent of locale. */
export function compareOwnerClientRecordRows(
  a: Pick<OwnerClientRecordRow, 'appointmentId' | 'startAt'>,
  b: Pick<OwnerClientRecordRow, 'appointmentId' | 'startAt'>,
): number {
  if (a.startAt !== b.startAt) return a.startAt > b.startAt ? -1 : 1;
  return a.appointmentId < b.appointmentId ? -1 : a.appointmentId > b.appointmentId ? 1 : 0;
}

export const ownerClientRecordPageSchema = z.object({
  scope: z.object({ businessId: documentId, sourceAppointmentId: documentId, clientUid }).strict(),
  filter: filterSchema, checkedAt: timestamp, rows: z.array(rowSchema).max(20), nextCursor: cursorSchema.nullable(),
  coverage: z.object({ mode: z.literal('indexed_appointments'), completeness: z.literal('not_guaranteed') }).strict(),
}).strict().superRefine((page, context) => {
  const seen = new Set<string>();
  for (let index = 0; index < page.rows.length; index++) {
    const row = page.rows[index];
    if (seen.has(row.appointmentId) || (index > 0 && compareOwnerClientRecordRows(page.rows[index - 1], row) >= 0)) {
      context.addIssue({ code: 'custom', path: ['rows', index], message: 'Orden de reservas no verificable.' });
    }
    seen.add(row.appointmentId);
    if (page.filter !== 'all' && row.status !== page.filter) {
      context.addIssue({ code: 'custom', path: ['rows', index, 'status'], message: 'El resultado no corresponde al filtro.' });
    }
  }
  const last = page.rows.at(-1);
  if (page.nextCursor && (page.rows.length !== 20 || !last
    || page.nextCursor.appointmentId !== last.appointmentId || page.nextCursor.startAt !== last.startAt)) {
    context.addIssue({ code: 'custom', path: ['nextCursor'], message: 'Cursor de reservas no verificable.' });
  }
});

export class OwnerClientRecordModelError extends Error {
  readonly status = 503;
  readonly code = 'CLIENT_RECORD_UNVERIFIABLE';
  constructor() {
    super('No se pueden verificar las reservas de esta cuenta.');
    this.name = 'OwnerClientRecordModelError';
  }
}
const storedCoreSchema = z.object({
  id: documentId, tenantId: documentId, type: z.literal('appointment'), client: z.object({ uid: clientUid }), startAt: timestamp,
  endAt: z.unknown().optional(), status: z.unknown().optional(), resourceId: z.unknown().optional(), beneficiary: z.unknown().optional(),
});

function resourceLabel(name: string, active: boolean): string {
  if (active) return name;
  const suffix = ' · Inactivo';
  let prefix = '';
  // Iterating code points never clips between a UTF-16 surrogate pair.
  for (const character of name) {
    if (prefix.length + character.length > 120 - suffix.length) break;
    prefix += character;
  }
  return prefix + suffix;
}

/** Catalog must come from the same business whose canonical ID is in context. */
export function projectOwnerClientRecordRow(
  canonicalDocumentId: string, raw: unknown, context: OwnerClientRecordProjectionContext,
): OwnerClientRecordRow {
  const parsed = storedCoreSchema.safeParse(raw);
  if (!parsed.success || !documentId.safeParse(canonicalDocumentId).success
    || !documentId.safeParse(context.businessId).success || !clientUid.safeParse(context.clientUid).success
    || parsed.data.id !== canonicalDocumentId || parsed.data.tenantId !== context.businessId || parsed.data.client.uid !== context.clientUid) {
    throw new OwnerClientRecordModelError();
  }
  const saved = parsed.data;
  const end = timestamp.safeParse(saved.endAt);
  const status = statusSchema.safeParse(saved.status);
  const beneficiary = bookingBeneficiarySchema.safeParse(saved.beneficiary);
  const resource = context.resources.map(item => resourceSchema.safeParse(item))
    .find(item => item.success && item.data.id === saved.resourceId);
  return {
    appointmentId: canonicalDocumentId,
    dateKey: dateKeyFromStart(saved.startAt),
    startAt: saved.startAt,
    endAt: end.success && end.data >= saved.startAt ? end.data : null,
    status: status.success ? status.data : 'unverified',
    resourceLabel: resource?.success ? resourceLabel(resource.data.name, resource.data.active) : 'Recurso anterior',
    beneficiaryKind: !Object.hasOwn(saved, 'beneficiary') ? 'undeclared' : beneficiary.success ? beneficiary.data.kind : 'unverified',
  };
}

export function ownerClientRecordStatusLabel(status: OwnerClientRecordRow['status'], startAt: number, now: number): string {
  if (status === 'confirmed') return startAt < now ? 'Confirmada · sin resultado registrado' : 'Confirmada';
  return {
    cancelled_by_client: 'Cancelada por cliente', cancelled_by_owner: 'Cancelada por propietario',
    completed: 'Atendida', no_show: 'No asistió', unverified: 'Dato no verificable',
  }[status];
}
export function ownerClientRecordBeneficiaryLabel(kind: OwnerClientRecordRow['beneficiaryKind']): string {
  return { self: 'Para sí', represented_minor: 'Representante de un menor', undeclared: 'Sin declaración guardada', unverified: 'Dato no verificable' }[kind];
}
export function ownerClientRecordEndLabel(endAt: OwnerClientRecordRow['endAt']): string | null {
  return endAt === null ? 'Fin no verificable' : null;
}
