import { afterEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { memoryFirestore } from './memoryFirestore';
import { DEFAULT_AI_BUDGET_LIMITS, saveAiBudgetSettings, reservePaidCallBudget, settlePaidCallBudget, reconcilePaidCallBudget, readAdminAiBudget } from '@/lib/server/ai-budget';
import { quotePaidCall } from '@/lib/server/ai-pricing';
const now = Date.parse('2030-02-01T04:59:00Z');
const context = { businessId: 'business', actorUid: 'client', mode: 'sarin_client' as const, requestId: 'synthetic-request' };
const quote = quotePaidCall({ provider: 'deepseek', model: 'deepseek-flash', requestBytes: 4000, maxOutputTokens: 4096 });
const input = () => ({ ...context, ...quote, callId: randomUUID(), provider: 'deepseek' as const, model: 'deepseek-flash' });
afterEach(() => vi.unstubAllEnvs());
describe('pre-fetch paid inference budget', () => {
  it('paginates all uncertain calls without losing a same-date call after the first fifty', async () => {
    const { db } = memoryFirestore(); vi.stubEnv('SUPERADMIN_UID', 'admin');
    await saveAiBudgetSettings({ uid: 'admin' }, { expectedVersion: 0, paused: false, limits: { ...DEFAULT_AI_BUDGET_LIMITS, globalDayUsd: 100, globalMonthUsd: 100, businessDayUsd: 100, businessMonthUsd: 100 }, reason: 'Synthetic pagination' }, db);
    for (let index = 0; index < 51; index++) await reservePaidCallBudget(input(), db, now);
    const first = await readAdminAiBudget({ uid: 'admin' }, db), second = await readAdminAiBudget({ uid: 'admin' }, db, first.nextCursor!);
    expect(first.calls).toHaveLength(50); expect(second.calls).toHaveLength(1); expect(second.nextCursor).toBeNull();
    expect(new Set([...first.calls, ...second.calls].map(call => call.callId)).size).toBe(51);
  });
  it('fails closed without validated configuration and serializes the final budget slot', async () => {
    const { db } = memoryFirestore(); vi.stubEnv('SUPERADMIN_UID', 'admin');
    await expect(reservePaidCallBudget(input(), db, now)).rejects.toMatchObject({ code: 'AI_BUDGET_UNAVAILABLE', status: 503 });
    await saveAiBudgetSettings({ uid: 'admin' }, { expectedVersion: 0, paused: false, limits: { ...DEFAULT_AI_BUDGET_LIMITS, businessDayUsd: quote.maxCostNanoUsd / 1e9 }, reason: 'Synthetic final slot' }, db);
    const results = await Promise.allSettled([reservePaidCallBudget(input(), db, now), reservePaidCallBudget(input(), db, now)]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.find(result => result.status === 'rejected')).toMatchObject({ reason: { code: 'AI_BUDGET_EXHAUSTED', status: 503 } });
  });
  it('retains unknown usage through restart, settles once in original Bogota periods, and requires evidence to release', async () => {
    const { db, rows } = memoryFirestore(); vi.stubEnv('SUPERADMIN_UID', 'admin');
    await saveAiBudgetSettings({ uid: 'admin' }, { expectedVersion: 0, paused: false, limits: DEFAULT_AI_BUDGET_LIMITS, reason: 'Synthetic setup' }, db);
    const reservation = await reservePaidCallBudget(input(), db, now);
    const observation = { callId: reservation.callId, provider: 'deepseek' as const, model: 'deepseek-flash', startedAt: now, finishedAt: now + 120000, success: true, usage: null };
    await settlePaidCallBudget(reservation, observation, db);
    const periods = [...rows].filter(([path]) => path.startsWith('aiBudgetPeriods/'));
    expect(periods).toHaveLength(4); expect(periods.every(([, row]) => row.data.reservedTokens === reservation.maxTokens)).toBe(true);
    await settlePaidCallBudget(reservation, { ...observation, usage: { promptTokens: 2500, cacheHitTokens: 0, cacheMissTokens: 2500, completionTokens: 500, totalTokens: 3000 } }, db);
    const settled = structuredClone([...rows]);
    await settlePaidCallBudget(reservation, { ...observation, usage: { promptTokens: 2500, cacheHitTokens: 0, cacheMissTokens: 2500, completionTokens: 500, totalTokens: 3000 } }, db);
    expect([...rows]).toEqual(settled);
    expect([...rows.keys()].some(path => path.includes('2030-02'))).toBe(false);
    const unknown = await reservePaidCallBudget(input(), db, now);
    await expect(reconcilePaidCallBudget({ uid: 'admin' }, { callId: unknown.callId, resolution: 'confirmed_not_charged', reason: 'Reviewed', evidence: '' }, db)).rejects.toBeDefined();
    await reconcilePaidCallBudget({ uid: 'admin' }, { callId: unknown.callId, resolution: 'confirmed_not_charged', reason: 'Provider confirmed no charge', evidence: 'Synthetic provider statement 001' }, db);
    expect(rows.get(`aiBudgetCalls/${unknown.callId}`)?.data.status).toBe('released');
    expect(JSON.stringify([...rows])).not.toMatch(/synthetic-request|actorUid|messages|content/);
  });
  it('pauses future calls on an unexpected model or underestimated usage', async () => {
    const { db, rows } = memoryFirestore(); vi.stubEnv('SUPERADMIN_UID', 'admin');
    await saveAiBudgetSettings({ uid: 'admin' }, { expectedVersion: 0, paused: false, limits: DEFAULT_AI_BUDGET_LIMITS, reason: 'Synthetic setup' }, db);
    const reservation = await reservePaidCallBudget(input(), db, now);
    await settlePaidCallBudget(reservation, { callId: reservation.callId, provider: 'deepseek', model: 'unknown-model', startedAt: now, finishedAt: now + 1, success: true, usage: null }, db);
    expect(rows.get('serverSettings/pilotAiBudget')?.data.paused).toBe(true);
    await expect(reservePaidCallBudget(input(), db, now)).rejects.toMatchObject({ status: 503 });
  });
  it('allows the token volume of 100 legitimate daily responses and 3000 monthly responses with enough monetary funding', async () => {
    const { db } = memoryFirestore(); vi.stubEnv('SUPERADMIN_UID', 'admin');
    await saveAiBudgetSettings({ uid: 'admin' }, { expectedVersion: 0, paused: false, limits: { ...DEFAULT_AI_BUDGET_LIMITS, globalDayUsd: 100, globalMonthUsd: 1000, businessDayUsd: 100, businessMonthUsd: 1000 }, reason: 'Synthetic funded volume' }, db);
    for (let index = 0; index < 3000; index++) {
      const at = Date.parse('2030-04-01T12:00:00Z') + Math.floor(index / 100) * 86400000;
      const reservation = await reservePaidCallBudget(input(), db, at);
      await settlePaidCallBudget(reservation, { callId: reservation.callId, provider: 'deepseek', model: 'deepseek-flash', startedAt: at, finishedAt: at + 1, success: true, usage: { promptTokens: 2500, cacheHitTokens: 0, cacheMissTokens: 2500, completionTokens: 500, totalTokens: 3000 } }, db);
    }
  }, 20000);
});
