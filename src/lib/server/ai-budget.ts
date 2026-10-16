import 'server-only';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { ChatActor, ChatMode } from '@/types/chat';
import type { CloudAiProvider } from '@/types/ai';
import type { EngineUsageObservation } from '@/lib/sarin/engine';
import type { Database } from '@/lib/storage/types';
import { getAdminDb } from '@/lib/firebase/admin';
import { isSuperadmin } from './auth';
import { documentIdSchema, requestIdSchema } from './schemas';
import { AI_TARIFFS } from './ai-pricing';
import { HttpError } from './http';
export type PaidCallContext = { businessId: string; actorUid: string; mode: ChatMode; requestId: string };
export type BudgetReservation = { id: string; callId: string; maxTokens: number; maxCostNanoUsd: number };
const count = z.number().int().nonnegative().safe(), usd = z.number().finite().min(0.000001).max(100000);
export const aiBudgetLimitsSchema = z.object({ globalDayUsd: usd, globalMonthUsd: usd, businessDayUsd: usd, businessMonthUsd: usd, globalDayTokens: count.min(1), globalMonthTokens: count.min(1), businessDayTokens: count.min(1), businessMonthTokens: count.min(1) }).strict();
export const DEFAULT_AI_BUDGET_LIMITS = { globalDayUsd: 0.5, globalMonthUsd: 8, businessDayUsd: 0.1, businessMonthUsd: 2, globalDayTokens: 20_000_000, globalMonthTokens: 300_000_000, businessDayTokens: 2_000_000, businessMonthTokens: 30_000_000 } as const;
const reason = z.string().trim().min(1).max(300);
export const aiBudgetSettingsInputSchema = z.object({ expectedVersion: count, paused: z.boolean(), limits: aiBudgetLimitsSchema, reason }).strict();
export const aiBudgetReconcileSchema = z.object({ callId: z.string().uuid(), resolution: z.enum(['keep_reserved', 'confirmed_not_charged']), reason, evidence: z.string().trim().min(1).max(500) }).strict();
const settingsSchema = z.object({ version: count.min(1), paused: z.boolean(), limits: aiBudgetLimitsSchema, reason, updatedAt: count, updatedBy: z.string().min(1).max(128) }).strict();
const periodSchema = z.object({ usedTokens: count, reservedTokens: count, usedCostNanoUsd: count, reservedCostNanoUsd: count }).strict();
const callSchema = z.object({ version: z.literal(1), id: z.string().uuid(), callId: z.string().uuid(), provider: z.enum(['deepseek', 'gemini']), model: z.string().min(1).max(100), pricingVersion: z.string().min(1).max(100), inputNanoUsdPerToken: count.min(1), outputNanoUsdPerToken: count.min(1), businessId: documentIdSchema,
  actorHash: z.string().regex(/^[a-f0-9]{64}$/), requestHash: z.string().regex(/^[a-f0-9]{64}$/), mode: z.enum(['sarin_client', 'sarin_owner_copilot', 'sarin_onboarding']), createdAt: count,
  periodIds: z.array(documentIdSchema).length(4), maxTokens: count.min(1), heldTokens: count.min(1), maxCostNanoUsd: count.min(1), status: z.enum(['reserved', 'uncertain', 'settled', 'released']), actualTokens: count.nullable(), actualCostNanoUsd: count.nullable(), settledAt: count.nullable(),
  reconciliation: z.object({ resolution: z.enum(['keep_reserved', 'confirmed_not_charged']), reason, evidence: z.string().min(1).max(500), actorHash: z.string().regex(/^[a-f0-9]{64}$/), at: count }).strict().optional(),
}).strict();
const reserveSchema = z.object({ businessId: documentIdSchema, actorUid: z.string().min(1).max(128), mode: z.enum(['sarin_client', 'sarin_onboarding', 'sarin_owner_copilot']), requestId: requestIdSchema,
  callId: z.string().uuid(), provider: z.enum(['deepseek', 'gemini']), model: z.string().min(1).max(100), maxTokens: count.min(1).max(136192), maxCostNanoUsd: count.min(1), pricingVersion: z.string().min(1).max(100) }).strict();
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const unavailable = () => new HttpError(503, 'La atención de IA está en pausa operativa. La agenda sigue disponible; contacta al negocio.', 'AI_BUDGET_UNAVAILABLE');
function parse<T>(schema: z.ZodType<T>, value: unknown): T { const result = schema.safeParse(value); if (!result.success) throw unavailable(); return result.data; }
function period(value: unknown) { return value === undefined ? { usedTokens: 0, reservedTokens: 0, usedCostNanoUsd: 0, reservedCostNanoUsd: 0 } : parse(periodSchema, value); }
function authorize(user: ChatActor) { if (!isSuperadmin(user.uid)) throw new HttpError(403, 'Forbidden'); }
function periodIds(businessId: string, now: number) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const part = (key: string) => parts.find(item => item.type === key)!.value;
  const month = `${part('year')}-${part('month')}`, day = `${month}-${part('day')}`, business = digest(businessId);
  return [`global_day_${day}`, `global_month_${month}`, `business_${business}_day_${day}`, `business_${business}_month_${month}`];
}
export async function readAdminAiBudget(user: ChatActor, db: Database = getAdminDb(), cursor?: string) {
  authorize(user);
  if (cursor !== undefined) z.string().uuid().parse(cursor);
  const collection = db.collection('aiBudgetCalls'), query = (cursor ? collection.where('id', '>', cursor) : collection).orderBy('id', 'asc').limit(51);
  const [settings, calls] = await Promise.all([db.collection('serverSettings').doc('pilotAiBudget').get(), query.get()]);
  return { configured: settings.exists, settings: settings.exists ? parse(settingsSchema, settings.data()) : null, proposedLimits: DEFAULT_AI_BUDGET_LIMITS, calls: calls.docs.slice(0, 50).map(document => parse(callSchema, document.data())), nextCursor: calls.docs.length > 50 ? calls.docs[49].id : null, gateEnabled: process.env.PILOT_AI_BUDGET_ENFORCED === 'true' };
}
export async function saveAiBudgetSettings(user: ChatActor, supplied: z.infer<typeof aiBudgetSettingsInputSchema>, db: Database = getAdminDb()) {
  authorize(user); const input = aiBudgetSettingsInputSchema.parse(supplied), ref = db.collection('serverSettings').doc('pilotAiBudget');
  return db.runTransaction(async tx => {
    const document = await tx.get(ref), previous = document.exists ? parse(settingsSchema, document.data()) : null;
    if ((previous?.version ?? 0) !== input.expectedVersion) throw new HttpError(409, 'El presupuesto cambió. Actualiza antes de guardar.', 'AI_BUDGET_SETTINGS_CONFLICT');
    const next = { version: input.expectedVersion + 1, paused: input.paused, limits: input.limits, reason: input.reason, updatedAt: Date.now(), updatedBy: user.uid };
    tx.set(ref, next); return next;
  });
}
export async function reservePaidCallBudget(supplied: PaidCallContext & { callId: string; provider: CloudAiProvider; model: string; maxTokens: number; maxCostNanoUsd: number; pricingVersion: string }, db: Database = getAdminDb(), now = Date.now()): Promise<BudgetReservation> {
  const input = reserveSchema.parse(supplied), tariff = AI_TARIFFS[input.provider];
  if (input.model !== tariff.model || input.pricingVersion !== tariff.pricingVersion) throw unavailable();
  const ref = db.collection('aiBudgetCalls').doc(input.callId), settingsRef = db.collection('serverSettings').doc('pilotAiBudget'), ids = periodIds(input.businessId, now);
  return db.runTransaction(async tx => {
    const [settingsDoc, previous, ...periods] = await Promise.all([tx.get(settingsRef), tx.get(ref), ...ids.map(id => tx.get(db.collection('aiBudgetPeriods').doc(id)))]);
    if (previous.exists) throw new HttpError(409, 'La llamada ya tiene una reserva de presupuesto.', 'AI_BUDGET_CALL_EXISTS');
    const settings = parse(settingsSchema, settingsDoc.data()); if (settings.paused) throw unavailable();
    const tokenLimits = [settings.limits.globalDayTokens, settings.limits.globalMonthTokens, settings.limits.businessDayTokens, settings.limits.businessMonthTokens];
    const costLimits = [settings.limits.globalDayUsd, settings.limits.globalMonthUsd, settings.limits.businessDayUsd, settings.limits.businessMonthUsd].map(value => Math.round(value * 1e9));
    const states = periods.map(document => period(document.data()));
    for (const [index, state] of states.entries()) if (state.usedTokens + state.reservedTokens + input.maxTokens > tokenLimits[index] || state.usedCostNanoUsd + state.reservedCostNanoUsd + input.maxCostNanoUsd > costLimits[index]) throw new HttpError(503, 'La atención de IA alcanzó el presupuesto operativo. La agenda sigue disponible; contacta al negocio.', 'AI_BUDGET_EXHAUSTED');
    for (const [index, state] of states.entries()) tx.set(db.collection('aiBudgetPeriods').doc(ids[index]), parse(periodSchema, { ...state, reservedTokens: state.reservedTokens + input.maxTokens, reservedCostNanoUsd: state.reservedCostNanoUsd + input.maxCostNanoUsd }));
    tx.create(ref, { version: 1, id: input.callId, callId: input.callId, provider: input.provider, model: input.model, pricingVersion: input.pricingVersion, inputNanoUsdPerToken: tariff.input, outputNanoUsdPerToken: tariff.output, businessId: input.businessId, actorHash: digest(input.actorUid), requestHash: digest(input.requestId), mode: input.mode, createdAt: now, periodIds: ids, maxTokens: input.maxTokens, heldTokens: input.maxTokens, maxCostNanoUsd: input.maxCostNanoUsd, status: 'reserved', actualTokens: null, actualCostNanoUsd: null, settledAt: null });
    return { id: input.callId, callId: input.callId, maxTokens: input.maxTokens, maxCostNanoUsd: input.maxCostNanoUsd };
  });
}
export async function settlePaidCallBudget(reservation: BudgetReservation, observation: EngineUsageObservation, db: Database = getAdminDb()): Promise<void> {
  const ref = db.collection('aiBudgetCalls').doc(z.string().uuid().parse(reservation.callId)), settingsRef = db.collection('serverSettings').doc('pilotAiBudget');
  await db.runTransaction(async tx => {
    const document = await tx.get(ref), call = parse(callSchema, document.data());
    if (call.callId !== observation.callId || call.provider !== observation.provider || call.maxTokens !== reservation.maxTokens || call.maxCostNanoUsd !== reservation.maxCostNanoUsd || reservation.id !== call.callId) throw unavailable();
    if (call.status === 'settled' || call.status === 'released') return;
    const settings = parse(settingsSchema, (await tx.get(settingsRef)).data());
    const unknownModel = observation.model !== call.model || (call.provider === 'gemini' && observation.serviceTier !== 'standard');
    const unexpectedModel = (observation.model !== null && observation.model !== call.model) || (call.provider === 'gemini' && observation.serviceTier != null && observation.serviceTier !== 'standard');
    const usage = observation.usage;
    const validUsage = usage !== null && [usage.promptTokens, usage.completionTokens, usage.totalTokens].every(value => Number.isSafeInteger(value) && value >= 0) && usage.totalTokens === usage.promptTokens + usage.completionTokens;
    const actualCost = validUsage && !unknownModel ? usage!.promptTokens * call.inputNanoUsdPerToken + usage!.completionTokens * call.outputNanoUsdPerToken : null;
    const exceeded = validUsage && (usage!.totalTokens > call.maxTokens || (actualCost !== null && actualCost > call.maxCostNanoUsd));
    const states = await Promise.all(call.periodIds.map(async id => period((await tx.get(db.collection('aiBudgetPeriods').doc(id))).data())));
    if (!validUsage || unknownModel) {
      const heldTokens = validUsage ? Math.max(call.heldTokens, usage!.totalTokens) : call.heldTokens;
      if (heldTokens > call.heldTokens) for (const [index, state] of states.entries()) tx.set(db.collection('aiBudgetPeriods').doc(call.periodIds[index]), parse(periodSchema, { ...state, reservedTokens: state.reservedTokens + heldTokens - call.heldTokens }));
      if (unexpectedModel || exceeded) tx.set(settingsRef, { ...settings, paused: true, version: settings.version + 1, reason: unexpectedModel ? 'unexpected_model_or_tier' : 'usage_exceeded_reserved_bound', updatedAt: Date.now(), updatedBy: 'system' });
      tx.set(ref, { ...call, status: 'uncertain', heldTokens, actualTokens: validUsage ? usage!.totalTokens : call.actualTokens }); return;
    }
    for (const [index, state] of states.entries()) tx.set(db.collection('aiBudgetPeriods').doc(call.periodIds[index]), parse(periodSchema, { usedTokens: state.usedTokens + usage!.totalTokens, usedCostNanoUsd: state.usedCostNanoUsd + actualCost!, reservedTokens: state.reservedTokens - call.heldTokens, reservedCostNanoUsd: state.reservedCostNanoUsd - call.maxCostNanoUsd }));
    if (exceeded) tx.set(settingsRef, { ...settings, paused: true, version: settings.version + 1, reason: 'usage_exceeded_reserved_bound', updatedAt: Date.now(), updatedBy: 'system' });
    tx.set(ref, { ...call, status: 'settled', actualTokens: usage!.totalTokens, actualCostNanoUsd: actualCost, settledAt: Date.now() });
  });
}
export async function reconcilePaidCallBudget(user: ChatActor, supplied: z.infer<typeof aiBudgetReconcileSchema>, db: Database = getAdminDb()) {
  authorize(user); const input = aiBudgetReconcileSchema.parse(supplied), ref = db.collection('aiBudgetCalls').doc(input.callId);
  await db.runTransaction(async tx => {
    const call = parse(callSchema, (await tx.get(ref)).data());
    if (call.reconciliation?.resolution === input.resolution && call.reconciliation.evidence === input.evidence && call.reconciliation.reason === input.reason) return;
    if (!['reserved', 'uncertain'].includes(call.status)) throw new HttpError(409, 'La llamada ya fue conciliada.');
    const states = await Promise.all(call.periodIds.map(async id => period((await tx.get(db.collection('aiBudgetPeriods').doc(id))).data())));
    if (input.resolution === 'confirmed_not_charged') for (const [index, state] of states.entries()) tx.set(db.collection('aiBudgetPeriods').doc(call.periodIds[index]), parse(periodSchema, { ...state, reservedTokens: state.reservedTokens - call.heldTokens, reservedCostNanoUsd: state.reservedCostNanoUsd - call.maxCostNanoUsd }));
    tx.set(ref, { ...call, status: input.resolution === 'confirmed_not_charged' ? 'released' : 'uncertain', reconciliation: { resolution: input.resolution, reason: input.reason, evidence: input.evidence, actorHash: digest(user.uid), at: Date.now() } });
  });
}
