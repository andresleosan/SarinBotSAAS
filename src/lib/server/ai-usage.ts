import 'server-only';
import { z } from 'zod';
import type { Firestore } from 'firebase-admin/firestore';
import { getAdminDb } from '@/lib/firebase/admin';
import type { EngineUsageObservation } from '@/lib/sarin/engine';
import type { AdminAiUsage, AiUsageTotals } from '@/types/ai';

const pricingVersion = 'deepseek-flash-verified-2026-10-15' as const;
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const tokenCount = z.number().int().min(0).max(2_000_000);
const usageSchema = z.object({ promptTokens: tokenCount, cacheHitTokens: tokenCount, cacheMissTokens: tokenCount, completionTokens: tokenCount, totalTokens: z.number().int().min(0).max(4_000_000) })
  .refine(value => value.promptTokens === value.cacheHitTokens + value.cacheMissTokens && value.totalTokens === value.promptTokens + value.completionTokens);
const timestamp = z.number().int().min(0).max(8_640_000_000_000_000);
const observationSchema = z.object({ callId: z.string().uuid(), provider: z.literal('deepseek'), model: z.string().regex(/^[A-Za-z0-9_.:-]{1,100}$/).nullable(), startedAt: timestamp, finishedAt: timestamp, success: z.boolean(), usage: usageSchema.nullable() }).refine(value => value.finishedAt >= value.startedAt);
const contextSchema = z.object({ businessId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/).nullable(), mode: z.enum(['sarin_client', 'sarin_owner_copilot', 'sarin_onboarding']) });
export type AiUsageContext = z.infer<typeof contextSchema>;
export const aiUsageMonthSchema = z.string().regex(/^\d{4}-(?:0[1-9]|1[0-2])$/);
const totalsSchema = z.object({ calls: count, successfulCalls: count, failedCalls: count, usageReportedCalls: count, missingUsageCalls: count, costEstimatedCalls: count, unknownCostCalls: count, promptTokens: count, cacheHitTokens: count, cacheMissTokens: count, completionTokens: count, costNanoMin: count, costNanoMax: count });
type StoredTotals = z.infer<typeof totalsSchema>;
const emptyTotals = (): StoredTotals => ({ calls: 0, successfulCalls: 0, failedCalls: 0, usageReportedCalls: 0, missingUsageCalls: 0, costEstimatedCalls: 0, unknownCostCalls: 0, promptTokens: 0, cacheHitTokens: 0, cacheMissTokens: 0, completionTokens: 0, costNanoMin: 0, costNanoMax: 0 });
const state = globalThis as typeof globalThis & { __sarinAiUsageTelemetry?: { startedAt: number; failures: Map<string, number> } };
const telemetry = () => state.__sarinAiUsageTelemetry ??= { startedAt: Date.now(), failures: new Map() };

export function aiUsageMonth(at = Date.now()): string {
  const parts = new Intl.DateTimeFormat('en', { timeZone: 'America/Bogota', year: 'numeric', month: '2-digit' }).formatToParts(at);
  return `${parts.find(part => part.type === 'year')!.value}-${parts.find(part => part.type === 'month')!.value}`;
}

function addTotals(previous: unknown, delta: StoredTotals): StoredTotals {
  const base = previous ? totalsSchema.parse(previous) : emptyTotals();
  const combined = Object.fromEntries(Object.entries(delta).map(([key, value]) => [key, base[key as keyof StoredTotals] + value]));
  return totalsSchema.parse(combined);
}

function publicTotals(stored: unknown): AiUsageTotals {
  const { costNanoMin, costNanoMax, ...totals } = stored ? totalsSchema.parse(stored) : emptyTotals();
  return { ...totals, estimatedCostUSD: totals.costEstimatedCalls ? { min: costNanoMin / 1_000_000_000, max: costNanoMax / 1_000_000_000 } : null };
}

/** Best effort, bounded accounting; never causes the caller to retry an inference/tool. */
export async function recordAiUsage(observation: EngineUsageObservation, context: AiUsageContext, db?: Firestore): Promise<void> {
  const monitor = telemetry();
  let month = aiUsageMonth();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const event = observationSchema.parse(observation);
    const scope = contextSchema.parse(context);
    month = aiUsageMonth(event.startedAt);
    const database = db ?? getAdminDb();
    const priced = event.model === 'deepseek-flash' && event.usage !== null;
    // USD/1M tokens: 0.003 cache hit, 0.15 miss, 0.60 output off-peak;
    // peak is twice that. Integer nanodollars preserve small cached-token charges.
    // Verified against https://api-docs.deepseek.com/quick_start/pricing/ on 2026-10-15.
    const costNanoMin = priced ? event.usage!.cacheHitTokens * 3 + event.usage!.cacheMissTokens * 150 + event.usage!.completionTokens * 600 : 0;
    const delta: StoredTotals = { calls: 1, successfulCalls: Number(event.success), failedCalls: Number(!event.success), usageReportedCalls: Number(event.usage !== null), missingUsageCalls: Number(event.usage === null), costEstimatedCalls: Number(priced), unknownCostCalls: Number(!priced), promptTokens: event.usage?.promptTokens ?? 0, cacheHitTokens: event.usage?.cacheHitTokens ?? 0, cacheMissTokens: event.usage?.cacheMissTokens ?? 0, completionTokens: event.usage?.completionTokens ?? 0, costNanoMin, costNanoMax: costNanoMin * 2 };
    const pending = database.runTransaction(async transaction => {
      const ledger = database.collection('aiUsageCalls').doc(event.callId);
      if ((await transaction.get(ledger)).exists) return;
      const monthly = database.collection('aiUsageMonths').doc(month);
      const business = monthly.collection('businesses').doc(scope.businessId === null ? 'unassigned' : `business_${scope.businessId}`);
      const metadata = database.collection('aiUsageMeta').doc('main');
      const [monthDocument, businessDocument, metaDocument] = await Promise.all([transaction.get(monthly), transaction.get(business), transaction.get(metadata)]);
      const monthlyTotals = addTotals(monthDocument.data(), delta);
      const businessTotals = addTotals(businessDocument.data(), delta);
      const firstRecordedAt = metaDocument.exists ? timestamp.parse(metaDocument.data()?.measurementStartedAt) : event.startedAt;
      transaction.create(ledger, { ...event, ...scope, month, pricingVersion, costNanoMin: priced ? costNanoMin : null, costNanoMax: priced ? costNanoMin * 2 : null });
      transaction.set(monthly, monthlyTotals);
      transaction.set(business, { businessId: scope.businessId, ...businessTotals });
      if (!metaDocument.exists || event.startedAt < firstRecordedAt) transaction.set(metadata, { measurementStartedAt: Math.min(firstRecordedAt, event.startedAt) });
    }, { maxAttempts: 2 });
    // A timed-out commit may still finish. This is a failure to confirm storage,
    // not proof of a lost call; the UUID keeps any repeated recording idempotent.
    await Promise.race([pending, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Usage recording deadline exceeded')), 1500); })]);
  } catch {
    monitor.failures.set(month, (monitor.failures.get(month) ?? 0) + 1);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function readAdminAiUsage(month = aiUsageMonth(), db: Firestore = getAdminDb()): Promise<AdminAiUsage> {
  aiUsageMonthSchema.parse(month);
  const monitor = telemetry();
  const monthly = db.collection('aiUsageMonths').doc(month);
  const [meta, total, rows] = await Promise.all([db.collection('aiUsageMeta').doc('main').get(), monthly.get(), monthly.collection('businesses').limit(501).get()]);
  return {
    month, timeZone: 'America/Bogota', provider: 'deepseek', model: 'deepseek-flash', pricingVersion,
    measurementStartedAt: meta.exists ? timestamp.parse(meta.data()?.measurementStartedAt) : null,
    coverage: 'best_effort', telemetryProcessStartedAt: monitor.startedAt, telemetryWriteFailures: monitor.failures.get(month) ?? 0,
    totals: publicTotals(total.data()),
    businesses: rows.docs.slice(0, 500).map(row => ({ businessId: contextSchema.shape.businessId.parse(row.data().businessId), ...publicTotals(row.data()) })),
    truncated: rows.docs.length > 500,
  };
}
