import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Firestore } from 'firebase-admin/firestore';
import type { EngineUsageObservation } from '@/lib/sarin/engine';
import { memoryFirestore } from './memoryFirestore';

const state = vi.hoisted(() => ({ db: undefined as unknown, verify: vi.fn() }));
vi.mock('@/lib/firebase/admin', () => ({ getAdminDb: () => state.db, getAdminAuth: () => ({ verifyIdToken: state.verify }) }));
import { GET } from '@/app/api/admin/ai/usage/route';
import { readAdminAiUsage, recordAiUsage } from '@/lib/server/ai-usage';

const now = Date.parse('2030-01-15T12:00:00Z');
const observation: EngineUsageObservation = { callId: '00000000-0000-4000-8000-000000000001', provider: 'deepseek', model: 'deepseek-flash', startedAt: now, finishedAt: now + 1000, success: true, usage: { promptTokens: 1000, cacheHitTokens: 800, cacheMissTokens: 200, completionTokens: 100, totalTokens: 1100 } };
const context = { businessId: 'business-a', mode: 'sarin_client' as const };
const request = (query = '', token = 'admin-token') => new Request(`http://localhost/api/admin/ai/usage${query}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(now); vi.stubEnv('SUPERADMIN_UID', 'admin');
  delete (globalThis as typeof globalThis & { __sarinAiUsageTelemetry?: unknown }).__sarinAiUsageTelemetry;
  state.db = memoryFirestore().db;
  state.verify.mockReset().mockImplementation(async token => ({ uid: token === 'admin-token' ? 'admin' : 'ordinary' }));
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('No provider calls allowed'); }));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe('administrator usage meter', () => {
  const openai = { ...observation, provider: 'openai' as const, model: 'gpt-6-luna', serviceTier: 'default', usage: { ...observation.usage!, cacheWriteTokens: 100 } };

  it('isolates OpenAI from historical DeepSeek paths and deduplicates each provider independently', async () => {
    const { db, rows } = memoryFirestore();
    await recordAiUsage(observation, context, db);
    await Promise.all([recordAiUsage(openai, context, db), recordAiUsage(openai, context, db)]);
    const deepseek = await readAdminAiUsage('2030-01', db);
    const result = await readAdminAiUsage('2030-01', db, 'openai');
    expect(deepseek).toMatchObject({ provider: 'deepseek', model: 'deepseek-flash', totals: { calls: 1 } });
    expect(result).toMatchObject({ provider: 'openai', model: 'gpt-6-luna', measurementStartedAt: now, totals: { calls: 1, cacheWriteTokens: 100, cacheWriteReportedCalls: 1 } });
    expect(result.totals.estimatedCostUSD).toEqual({ min: 0.0000805, max: 0.0000805 });
    expect(result.businesses).toEqual([{ businessId: 'business-a', ...result.totals }]);
    expect(rows.has('aiUsageMonths/2030-01')).toBe(true);
    expect(rows.has('aiUsageMonths/openai_2030-01')).toBe(true);
    expect(rows.has('aiUsageMeta/main')).toBe(true);
    expect(rows.has('aiUsageMeta/openai')).toBe(true);
    expect([...rows.keys()].filter(key => key.startsWith('aiUsageCalls/'))).toHaveLength(2);
  });

  it('estimates a range when cache writes are unknown without claiming zero writes', async () => {
    const { db } = memoryFirestore();
    await recordAiUsage({ ...openai, usage: { ...openai.usage, cacheWriteTokens: null } }, context, db);
    const result = await readAdminAiUsage('2030-01', db, 'openai');
    expect(result.totals).toMatchObject({ costEstimatedCalls: 1, unknownCostCalls: 0, cacheWriteReportedCalls: 0 });
    expect(result.totals.estimatedCostUSD).toEqual({ min: 0.000078, max: 0.000083 });
  });

  it.each([[272000, 0.02716], [272001, 0.0542952]])('prices the full request at the long-context boundary %s', async (promptTokens, price) => {
    const { db } = memoryFirestore();
    await recordAiUsage({ ...openai, usage: { promptTokens, cacheHitTokens: 1000, cacheMissTokens: promptTokens - 1000, cacheWriteTokens: 0, completionTokens: 100, totalTokens: promptTokens + 100 } }, context, db);
    expect((await readAdminAiUsage('2030-01', db, 'openai')).totals.estimatedCostUSD).toEqual({ min: price, max: price });
  });

  it.each([{ model: 'unknown-model', serviceTier: 'default' }, { model: 'gpt-6-luna', serviceTier: 'priority' }, { model: 'gpt-6-luna', serviceTier: null }])('keeps token and failure counts but no invented tariff for %j', async metadata => {
    const { db } = memoryFirestore();
    await recordAiUsage({ ...openai, ...metadata, success: false }, context, db);
    expect((await readAdminAiUsage('2030-01', db, 'openai')).totals).toMatchObject({ calls: 1, failedCalls: 1, promptTokens: 1000, costEstimatedCalls: 0, unknownCostCalls: 1, estimatedCostUSD: null });
  });

  it('contains inconsistent cache writes and separates telemetry uncertainty by provider', async () => {
    const { db, rows } = memoryFirestore();
    await recordAiUsage({ ...openai, usage: { ...openai.usage, cacheWriteTokens: 201 } }, context, db);
    expect(rows.size).toBe(0);
    expect((await readAdminAiUsage('2030-01', db, 'openai')).telemetryWriteFailures).toBe(1);
    expect((await readAdminAiUsage('2030-01', db)).telemetryWriteFailures).toBe(0);
  });

  it('validates provider selection after authorization and returns only the requested provider', async () => {
    await recordAiUsage(observation, context, state.db as Firestore);
    await recordAiUsage(openai, context, state.db as Firestore);
    expect(await (await GET(request('?provider=openai'))).json()).toMatchObject({ provider: 'openai', totals: { calls: 1 } });
    expect(await (await GET(request())).json()).toMatchObject({ provider: 'deepseek', totals: { calls: 1 } });
    state.db = { collection: () => { throw new Error('Must not reach storage'); } };
    expect((await GET(request('?provider=ollama'))).status).toBe(400);
    expect((await GET(request('?provider=openai&provider=deepseek'))).status).toBe(400);
    expect((await GET(request('?provider=openai&provider=openai'))).status).toBe(400);
    expect((await GET(request('?provider=bad', ''))).status).toBe(401);
    expect((await GET(request('?provider=bad', 'ordinary-token'))).status).toBe(403);
  });

  it('distinguishes no measurement from a zero charge without writing on GET', async () => {
    const { db, rows } = memoryFirestore(); state.db = db;
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ month: '2030-01', timeZone: 'America/Bogota', measurementStartedAt: null, coverage: 'best_effort', telemetryWriteFailures: 0, totals: { calls: 0, estimatedCostUSD: null }, businesses: [], truncated: false });
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(rows.size).toBe(0);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('enforces superadmin and rejects invalid month input without reading usage or calling a provider', async () => {
    state.db = { collection: () => { throw new Error('Must not reach storage'); } };
    expect((await GET(request('', ''))).status).toBe(401);
    expect((await GET(request('', 'ordinary-token'))).status).toBe(403);
    expect((await GET(request('?month=2030-13'))).status).toBe(400);
    expect((await GET(request('?month=2030-01&month=2030-02'))).status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('records one immutable observation and exactly one aggregate increment for simultaneous duplicate IDs', async () => {
    const { db, rows } = memoryFirestore();
    await Promise.all([recordAiUsage(observation, context, db), recordAiUsage(observation, context, db)]);
    const result = await readAdminAiUsage('2030-01', db);
    expect(result.measurementStartedAt).toBe(now);
    expect(result.totals).toMatchObject({ calls: 1, successfulCalls: 1, failedCalls: 0, usageReportedCalls: 1, missingUsageCalls: 0, costEstimatedCalls: 1, unknownCostCalls: 0, promptTokens: 1000, cacheHitTokens: 800, cacheMissTokens: 200, completionTokens: 100 });
    expect(result.totals.estimatedCostUSD?.min).toBeCloseTo(0.0000924, 10);
    expect(result.totals.estimatedCostUSD?.max).toBeCloseTo(0.0001848, 10);
    expect(result.businesses).toEqual([{ businessId: 'business-a', ...result.totals }]);
    expect([...rows.keys()].filter(key => key.startsWith('aiUsageCalls/'))).toHaveLength(1);
    const ledger = rows.get(`aiUsageCalls/${observation.callId}`)!.data;
    expect(ledger).toMatchObject({ pricingVersion: 'deepseek-flash-verified-2026-10-15', model: 'deepseek-flash', businessId: 'business-a', mode: 'sarin_client' });
    expect(Object.keys(ledger).sort()).toEqual(['businessId', 'callId', 'costNanoMax', 'costNanoMin', 'finishedAt', 'mode', 'model', 'month', 'pricingVersion', 'provider', 'startedAt', 'success', 'usage']);
  });

  it('counts failed calls with usage, unknown costs, and missing usage without pricing unknown models as Flash', async () => {
    const { db } = memoryFirestore();
    await recordAiUsage({ ...observation, model: 'unexpected-model', success: false }, context, db);
    let result = await readAdminAiUsage('2030-01', db);
    expect(result.totals).toMatchObject({ calls: 1, failedCalls: 1, usageReportedCalls: 1, unknownCostCalls: 1, costEstimatedCalls: 0, promptTokens: 1000, estimatedCostUSD: null });
    await recordAiUsage({ ...observation, callId: '00000000-0000-4000-8000-000000000002', usage: null, success: false }, context, db);
    await recordAiUsage({ ...observation, callId: '00000000-0000-4000-8000-000000000003', success: false }, context, db);
    result = await readAdminAiUsage('2030-01', db);
    expect(result.totals).toMatchObject({ calls: 3, failedCalls: 3, successfulCalls: 0, usageReportedCalls: 2, missingUsageCalls: 1, unknownCostCalls: 2, costEstimatedCalls: 1, promptTokens: 2000 });
    expect(result.totals.estimatedCostUSD?.min).toBeCloseTo(0.0000924, 10);
  });

  it('separates onboarding without a business from a business literally named unassigned', async () => {
    const { db } = memoryFirestore();
    await recordAiUsage(observation, { businessId: null, mode: 'sarin_onboarding' }, db);
    await recordAiUsage({ ...observation, callId: '00000000-0000-4000-8000-000000000002' }, { businessId: 'unassigned', mode: 'sarin_owner_copilot' }, db);
    const result = await readAdminAiUsage('2030-01', db);
    expect(result.totals.calls).toBe(2);
    expect(result.businesses.map(row => row.businessId)).toEqual(expect.arrayContaining([null, 'unassigned']));
    expect(result.businesses.every(row => row.calls === 1)).toBe(true);
  });

  it('uses the month at request start in Colombia across UTC and month boundaries', async () => {
    const { db } = memoryFirestore();
    await recordAiUsage({ ...observation, startedAt: Date.parse('2030-02-01T04:59:59Z'), finishedAt: Date.parse('2030-02-01T05:00:02Z') }, context, db);
    await recordAiUsage({ ...observation, callId: '00000000-0000-4000-8000-000000000002', startedAt: Date.parse('2030-02-01T05:00:00Z'), finishedAt: Date.parse('2030-02-01T05:00:03Z') }, context, db);
    expect((await readAdminAiUsage('2030-01', db)).totals.calls).toBe(1);
    expect((await readAdminAiUsage('2030-02', db)).totals.calls).toBe(1);
    const empty = await readAdminAiUsage('2029-12', db);
    expect(empty.totals.estimatedCostUSD).toBeNull();
    expect(empty.measurementStartedAt).toBe(Date.parse('2030-02-01T04:59:59Z'));
  });

  it('bounds business rows and explicitly reports truncation without scanning the ledger', async () => {
    const aggregate = { calls: 1, successfulCalls: 1, failedCalls: 0, usageReportedCalls: 0, missingUsageCalls: 1, costEstimatedCalls: 0, unknownCostCalls: 1, promptTokens: 0, cacheHitTokens: 0, cacheMissTokens: 0, completionTokens: 0, costNanoMin: 0, costNanoMax: 0 };
    const initial = Object.fromEntries(Array.from({ length: 501 }, (_, index) => [`aiUsageMonths/2030-01/businesses/business_${index}`, { businessId: `business-${index}`, ...aggregate }]));
    const { db } = memoryFirestore(initial);
    const result = await readAdminAiUsage('2030-01', db);
    expect(result.businesses).toHaveLength(500);
    expect(result.truncated).toBe(true);
  });

  it('contains a telemetry write failure and reports its uncertainty only for the matching month and process', async () => {
    const failing = { runTransaction: async () => { throw new Error('private database detail'); } } as unknown as Firestore;
    await expect(recordAiUsage(observation, context, failing)).resolves.toBeUndefined();
    const { db } = memoryFirestore();
    const result = await readAdminAiUsage('2030-01', db);
    expect(result).toMatchObject({ coverage: 'best_effort', telemetryProcessStartedAt: now, telemetryWriteFailures: 1, measurementStartedAt: null, totals: { calls: 0, estimatedCostUSD: null } });
    expect(JSON.stringify(result)).not.toContain('private database detail');
    expect((await readAdminAiUsage('2030-02', db)).telemetryWriteFailures).toBe(0);
  });

  it('stops awaiting slow telemetry within a bounded time without retrying inference', async () => {
    const stalled = { runTransaction: async () => new Promise(() => {}) } as unknown as Firestore;
    const pending = recordAiUsage(observation, context, stalled);
    await vi.advanceTimersByTimeAsync(1600);
    await expect(pending).resolves.toBeUndefined();
    expect((await readAdminAiUsage('2030-01', memoryFirestore().db)).telemetryWriteFailures).toBe(1);
    expect(fetch).not.toHaveBeenCalled();
  });
});
