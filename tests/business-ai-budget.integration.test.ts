import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createDataTestRuntime } from '../cloudflare/tests/data-runtime.mjs';
import { createCloudflareDatabase, StorageError } from '@/lib/storage/database';
import type { DataCommitResult, DataReadResult } from '../shared/data-protocol';
import type { Database } from '@/lib/storage/types';
import type { Business } from '@/types/firestore';
import { DEFAULT_AI_BUDGET_LIMITS, readBusinessAiBudget, reservePaidCallBudget, saveAiBudgetSettings, saveBusinessAiBudgetSettings, settlePaidCallBudget } from '@/lib/server/ai-budget';
import { AI_TARIFFS, quotePaidCall } from '@/lib/server/ai-pricing';

const now = Date.parse('2030-04-10T15:00:00Z');
const admin = { uid: 'synthetic-budget-admin' };
const quote = quotePaidCall({ provider: 'deepseek', model: 'deepseek-flash', requestBytes: 4000, maxOutputTokens: 4096 });
const oneCallUsd = quote.maxCostNanoUsd / 1e9;
const call = (businessId: string) => ({ ...quote, businessId, actorUid: 'synthetic-client', mode: 'sarin_client' as const, requestId: 'synthetic-budget-request', callId: randomUUID(), provider: 'deepseek' as const, model: 'deepseek-flash' });
function business(id: string): Business {
  return { id, slug: id, ownerUid: `owner-${id}`, ownerEmail: 'owner@example.test', name: `Synthetic ${id}`, category: 'Services', phoneWhatsApp: '573001234567', timezone: 'America/Bogota',
    subscription: { status: 'active', trialEndsAt: 0, currentPeriodEndsAt: now + 30 * 86400000 },
    sarinConfig: { onboardingCompleted: true, tone: '', customRules: '', intakeFields: [] },
    resources: [{ id: 'one', name: 'Synthetic resource', active: true }],
    services: [{ id: 'service', name: 'Synthetic service', durationMinutes: 30, bufferMinutes: 0, price: 10000, resourceIds: ['one'] }],
    weeklySchedule: Object.fromEntries(Array.from({ length: 7 }, (_, day) => [String(day), { isOpen: true, intervals: [{ start: '09:00', end: '17:00' }] }])), createdAt: now };
}

describe('business budget overrides on real local D1', () => {
  let runtime: Awaited<ReturnType<typeof createDataTestRuntime>>, db: Database, secondDb: Database;
  beforeEach(async () => {
    vi.stubEnv('SUPERADMIN_UID', admin.uid);
    runtime = await createDataTestRuntime();
    const connect = () => createCloudflareDatabase(async command => {
      const response = await runtime.fetch(command), value = await response.json() as DataReadResult | DataCommitResult;
      if (!response.ok) throw new StorageError(response.status, (value as unknown as { code: string }).code);
      return value;
    });
    db = connect(); secondDb = connect();
  }, 30000);
  afterEach(async () => { await runtime?.dispose(); vi.unstubAllEnvs(); });

  it('reserves the final overridden business slot once across independent D1 handles', async () => {
    const id = 'synthetic-final-business';
    await db.collection('businesses').doc(id).set(business(id));
    await saveAiBudgetSettings(admin, { expectedVersion: 0, paused: false, limits: DEFAULT_AI_BUDGET_LIMITS, reason: 'Synthetic initial budget' }, db);
    await saveBusinessAiBudgetSettings(admin, { businessId: id, expectedVersion: 0, expectedSettingsVersion: 1,
      limits: { businessDayUsd: oneCallUsd, businessMonthUsd: 2 }, reason: 'Synthetic final business slot' }, db, now);

    const results = await Promise.allSettled([reservePaidCallBudget(call(id), db, now), reservePaidCallBudget(call(id), secondDb, now)]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.find(result => result.status === 'rejected')).toMatchObject({ reason: { status: 503, code: 'AI_BUDGET_EXHAUSTED' } });
    const reading = await readBusinessAiBudget(admin, id, secondDb, now);
    const held = { usedTokens: 0, reservedTokens: quote.maxTokens, usedCostNanoUsd: 0, reservedCostNanoUsd: quote.maxCostNanoUsd };
    expect(reading.limits).toEqual({ businessDayUsd: oneCallUsd, businessMonthUsd: 2 });
    expect(reading.usage.day).toMatchObject(held);
    expect(reading.usage.month).toMatchObject(held);
    expect(reading.global.day).toMatchObject(held);
    expect((await db.collection('aiBudgetCalls').get()).size).toBe(1);
  });

  it('preserves used and uncertain counters when raising A and still enforces the global pool shared with B', async () => {
    const firstId = 'synthetic-business-a', secondId = 'synthetic-business-b';
    await db.collection('businesses').doc(firstId).set(business(firstId));
    await db.collection('businesses').doc(secondId).set(business(secondId));
    await saveAiBudgetSettings(admin, { expectedVersion: 0, paused: false, limits: { ...DEFAULT_AI_BUDGET_LIMITS, globalDayUsd: 3 * oneCallUsd, businessDayUsd: 2 * oneCallUsd }, reason: 'Synthetic shared global pool' }, db);
    const initial = await readBusinessAiBudget(admin, firstId, db, now);
    expect(initial.global.day).toMatchObject({ usedTokens: 0, reservedTokens: 0, usedCostNanoUsd: 0, reservedCostNanoUsd: 0 });

    const used = await reservePaidCallBudget(call(firstId), db, now);
    await settlePaidCallBudget(used, { callId: used.callId, provider: 'deepseek', model: 'deepseek-flash', startedAt: now, finishedAt: now + 1, success: true,
      usage: { promptTokens: 100, cacheHitTokens: 0, cacheMissTokens: 100, completionTokens: 10, totalTokens: 110 } }, db);
    const uncertain = await reservePaidCallBudget(call(firstId), db, now);
    await settlePaidCallBudget(uncertain, { callId: uncertain.callId, provider: 'deepseek', model: 'deepseek-flash', startedAt: now, finishedAt: now + 1, success: false, usage: null }, db);
    await reservePaidCallBudget(call(secondId), secondDb, now);
    const before = await readBusinessAiBudget(admin, firstId, db, now);
    const usedCost = 100 * AI_TARIFFS.deepseek.input + 10 * AI_TARIFFS.deepseek.output;
    expect(before.usage.day).toMatchObject({ usedTokens: 110, reservedTokens: quote.maxTokens, usedCostNanoUsd: usedCost, reservedCostNanoUsd: quote.maxCostNanoUsd });
    expect(before.global.day).toMatchObject({ usedCostNanoUsd: usedCost, reservedCostNanoUsd: 2 * quote.maxCostNanoUsd });

    await saveBusinessAiBudgetSettings(admin, { businessId: firstId, expectedVersion: 0, expectedSettingsVersion: 1,
      limits: { businessDayUsd: 3 * oneCallUsd, businessMonthUsd: 2 }, reason: 'Synthetic increase for A only' }, secondDb, now);
    const after = await readBusinessAiBudget(admin, firstId, secondDb, now);
    expect(after.limits).toEqual({ businessDayUsd: 3 * oneCallUsd, businessMonthUsd: 2 });
    expect(after.usage).toEqual(before.usage);
    expect(after.global).toEqual(before.global);
    expect((await db.collection('aiBudgetCalls').doc(uncertain.callId).get()).data()?.status).toBe('uncertain');
    const other = await readBusinessAiBudget(admin, secondId, db, now);
    expect(other.override).toBeNull();
    expect(other.limits.businessDayUsd).toBe(2 * oneCallUsd);
    await expect(reservePaidCallBudget(call(firstId), db, now)).rejects.toMatchObject({ status: 503, code: 'AI_BUDGET_EXHAUSTED' });
    await expect(reservePaidCallBudget(call(secondId), secondDb, now)).rejects.toMatchObject({ status: 503, code: 'AI_BUDGET_EXHAUSTED' });
    expect((await db.collection('aiBudgetCalls').get()).size).toBe(3);
  });
});
