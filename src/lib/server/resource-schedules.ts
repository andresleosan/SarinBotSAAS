import 'server-only';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { Business } from '@/types/firestore';
import type { ChatActor } from '@/types/chat';
import type { Database, Transaction } from '@/lib/storage/types';
import { getAdminDb } from '@/lib/firebase/admin';
import { canonicalResourceScheduleRules, emptyResourceSchedulePolicy, resolveResourceDaySchedule, resourceScheduleBasisSchema, resourceSchedulePolicySchema, resourceScheduleReceiptSchema, resourceScheduleRulesSchema, type ResourceScheduleBasis, type ResourceScheduleCommand, type ResourceSchedulePolicy, type ResourceScheduleRules, type ResourceScheduleSaveResult, type ResourceScheduleView } from '@/lib/resource-schedules';
import { isSubscriptionAllowed } from '@/lib/sarin/subscription';
import { assertOwner, stableDocumentId } from './businesses';
import { assertConsent } from './consent';
import { documentIdSchema, requestIdSchema } from './schemas';
import { HttpError } from './http';

const unavailable = () => new HttpError(503, 'No se pueden verificar los horarios. Inténtalo de nuevo.', 'RESOURCE_SCHEDULE_UNAVAILABLE');
export const scheduleBusinessIdSchema = documentIdSchema.refine(value => !['__proto__', 'prototype', 'constructor'].includes(value) && !/[\x00-\x1f\x7f]/.test(value));
export const scheduleRequestIdSchema = requestIdSchema.refine(value => !/[\x00-\x1f\x7f]/.test(value));
export const resourceScheduleCommandSchema = z.object({ requestId: scheduleRequestIdSchema, expectedRevision: z.number().int().nonnegative().safe(), expectedBasisFingerprint: z.string().length(64).regex(/^[a-f0-9]+$/), rules: resourceScheduleRulesSchema }).strict();
const storedReceiptSchema = z.object({ ...resourceScheduleReceiptSchema.shape, version: z.literal(1), businessId: scheduleBusinessIdSchema, actorUid: z.string().min(1).max(128) }).strict();
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => [key, canonical(item)]));
  return value;
}
const serialized = (value: unknown) => JSON.stringify(canonical(value));
const hash = (value: unknown) => createHash('sha256').update(serialized(value)).digest('hex');
export const resourceScheduleOperationHash = (command: ResourceScheduleCommand) => hash({ ...command, rules: canonicalResourceScheduleRules(command.rules) });
function basisFor(business: Business): ResourceScheduleBasis {
  if (!business.weeklySchedule || typeof business.weeklySchedule !== 'object' || Array.isArray(business.weeklySchedule) || !Array.isArray(business.resources)) throw unavailable();
  const parsed = resourceScheduleBasisSchema.safeParse({ weeklySchedule: Object.fromEntries(Array.from({ length: 7 }, (_, i) => [i, business.weeklySchedule[i] ?? { isOpen: false, intervals: [] }])), resources: business.resources.map(item => ({ id: item.id, name: item.name, active: item.active })) });
  if (!parsed.success) throw unavailable();
  return parsed.data;
}
export function resourceScheduleBasisFingerprint(basis: ResourceScheduleBasis): string {
  return hash({ weeklySchedule: basis.weeklySchedule, resources: basis.resources.map(item => ({ id: item.id, name: item.name, active: item.active })).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0) });
}
export function resourceDayScheduleFingerprint(business: Business, policy: ResourceSchedulePolicy, resourceId: string, dateKey: string): string {
  if (policy.businessId !== business.id) throw unavailable();
  return hash({ v: 1, resourceId, dateKey, policyRevision: policy.revision, effectiveDay: resolveResourceDaySchedule({ business, policy, resourceId, dateKey }) });
}
export async function readResourceSchedulePolicy(tx: Transaction, businessId: string, db: Database): Promise<ResourceSchedulePolicy> {
  scheduleBusinessIdSchema.parse(businessId);
  try {
    const snapshot = await tx.get(db.collection('businesses').doc(businessId).collection('resourceSchedulePolicies').doc('current'));
    if (!snapshot.exists) return emptyResourceSchedulePolicy(businessId);
    const parsed = resourceSchedulePolicySchema.safeParse(snapshot.data());
    if (!parsed.success || parsed.data.businessId !== businessId) throw unavailable();
    return { ...parsed.data, rules: canonicalResourceScheduleRules(parsed.data.rules) };
  } catch { throw unavailable(); }
}
function validateContext(next: ResourceScheduleRules, previous: ResourceScheduleRules, business: Business, now: number) {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  const last = new Date(Date.parse(`${today}T12:00:00Z`) + 366 * 86400000).toISOString().slice(0, 10);
  const changed = (value: unknown, prior: unknown) => serialized(value) !== serialized(prior);
  const active = (id: string) => { if (!business.resources.some(resource => resource.id === id && resource.active)) throw new HttpError(400, 'Las reglas nuevas requieren un recurso activo.', 'RESOURCE_SCHEDULE_RESOURCE_INVALID'); };
  const horizon = (date: string) => { if (date < today || date > last) throw new HttpError(400, 'Elige una fecha desde hoy y dentro de los próximos 366 días.', 'RESOURCE_SCHEDULE_DATE_INVALID'); };
  for (const item of next.weekly) if (changed(item, previous.weekly.find(old => old.resourceId === item.resourceId))) active(item.resourceId);
  for (const item of next.exceptions) if (changed(item, previous.exceptions.find(old => old.resourceId === item.resourceId && old.dateKey === item.dateKey))) { active(item.resourceId); horizon(item.dateKey); }
  for (const item of next.closures) {
    const prior = previous.closures.find(old => old.id === item.id);
    if (!changed(item, prior)) continue;
    if (prior && prior.fromDateKey < today) throw new HttpError(400, 'Retira el cierre anterior y crea uno nuevo desde hoy.', 'RESOURCE_SCHEDULE_DATE_INVALID');
    if (item.scope === 'resource') active(item.resourceId);
    horizon(item.fromDateKey); horizon(item.throughDateKey);
  }
}
const enabled = () => process.env.SARIN_RESOURCE_SCHEDULE_WRITES_ENABLED === 'true';
function view(business: Business, policy: ResourceSchedulePolicy, operation: ResourceScheduleView['operation']): ResourceScheduleView {
  const basis = basisFor(business);
  return { businessId: business.id, ownerUid: business.ownerUid, policy, basis, basisFingerprint: resourceScheduleBasisFingerprint(basis), writesEnabled: enabled(), serverNow: Date.now(), operation };
}
async function context(tx: Transaction, user: ChatActor, businessId: string, requestId: string | undefined, db: Database) {
  const businessRef = db.collection('businesses').doc(businessId);
  const operationRef = requestId ? businessRef.collection('resourceScheduleOperations').doc(stableDocumentId(user.uid, requestId, 'resource-schedule')) : null;
  const businessSnapshot = await tx.get(businessRef);
  if (!businessSnapshot.exists) throw new HttpError(404, 'El negocio no existe.');
  const business = businessSnapshot.data() as Business;
  if (business.id !== businessId) throw unavailable();
  assertOwner(business, user.uid);
  const policy = await readResourceSchedulePolicy(tx, businessId, db);
  const snapshot = operationRef ? await tx.get(operationRef) : null;
  let operation: ResourceScheduleView['operation'] = null;
  if (snapshot?.exists) {
    const parsed = storedReceiptSchema.safeParse(snapshot.data());
    if (!parsed.success || parsed.data.actorUid !== user.uid || parsed.data.businessId !== businessId || parsed.data.requestId !== requestId || parsed.data.resultRevision > policy.revision) throw unavailable();
    operation = resourceScheduleReceiptSchema.parse({ requestId: parsed.data.requestId, operationHash: parsed.data.operationHash, resultRevision: parsed.data.resultRevision, appliedAt: parsed.data.appliedAt });
  }
  return { business, policy, operation, operationRef };
}
export async function readOwnerResourceSchedules(user: ChatActor, businessId: string, requestId?: string, db: Database = getAdminDb()): Promise<ResourceScheduleView> {
  scheduleBusinessIdSchema.parse(businessId); if (requestId !== undefined) scheduleRequestIdSchema.parse(requestId);
  return db.runTransaction(async tx => { const current = await context(tx, user, businessId, requestId, db); return view(current.business, current.policy, current.operation); });
}
export async function saveOwnerResourceSchedules(user: ChatActor, businessId: string, supplied: ResourceScheduleCommand, db: Database = getAdminDb()): Promise<ResourceScheduleSaveResult> {
  scheduleBusinessIdSchema.parse(businessId);
  const parsed = resourceScheduleCommandSchema.parse(supplied), command = { ...parsed, rules: canonicalResourceScheduleRules(parsed.rules) };
  const operationHash = resourceScheduleOperationHash(command);
  return db.runTransaction(async tx => {
    const current = await context(tx, user, businessId, command.requestId, db);
    const state = view(current.business, current.policy, current.operation);
    if (current.operation) {
      if (current.operation.operationHash !== operationHash) throw new HttpError(409, 'Ese identificador pertenece a otra revisión.', 'RESOURCE_SCHEDULE_REQUEST_REUSED');
      return { ...state, operation: current.operation, replayed: true };
    }
    if (!enabled()) throw new HttpError(503, 'La edición de horarios todavía no está habilitada.', 'SCHEDULE_WRITES_DISABLED');
    if (!isSubscriptionAllowed(current.business)) throw new HttpError(402, 'Necesitas acceso vigente para editar horarios.');
    if (!current.business.sarinConfig.onboardingCompleted) throw new HttpError(409, 'Completa primero la configuración de tu negocio.', 'BUSINESS_NOT_CONFIGURED');
    await assertConsent(user.uid, 'account', undefined, db, tx);
    if (current.policy.revision !== command.expectedRevision) throw new HttpError(409, 'Los horarios cambiaron. Vuelve a revisarlos.', 'RESOURCE_SCHEDULE_CHANGED');
    if (state.basisFingerprint !== command.expectedBasisFingerprint) throw new HttpError(409, 'La apertura o los recursos cambiaron. Vuelve a revisarlos.', 'BUSINESS_SCHEDULE_CHANGED');
    if (current.policy.revision >= Number.MAX_SAFE_INTEGER) throw unavailable();
    const now = Date.now(); validateContext(command.rules, current.policy.rules, current.business, now);
    const policy: ResourceSchedulePolicy = { version: 1, businessId, revision: current.policy.revision + 1, rules: command.rules, updatedAt: now };
    const operation = { requestId: command.requestId, operationHash, resultRevision: policy.revision, appliedAt: now };
    tx.set(db.collection('businesses').doc(businessId).collection('resourceSchedulePolicies').doc('current'), policy);
    tx.create(current.operationRef!, { version: 1, businessId, actorUid: user.uid, ...operation });
    return { ...state, policy, operation, serverNow: now, replayed: false };
  });
}
