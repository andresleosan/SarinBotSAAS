import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createHash } from 'node:crypto';
import { memoryFirestore } from './memoryFirestore';
import { DEFAULT_AI_BUDGET_LIMITS, readBusinessAiBudget, saveBusinessAiBudgetSettings, saveAiBudgetSettings, reservePaidCallBudget, settlePaidCallBudget } from '@/lib/server/ai-budget';
import { quotePaidCall } from '@/lib/server/ai-pricing';

const admin = { uid: 'admin' }, now = Date.parse('2030-02-01T04:59:00Z');
const quote = quotePaidCall({ provider: 'deepseek', model: 'deepseek-flash', requestBytes: 4000, maxOutputTokens: 4096 });
const slot = quote.maxCostNanoUsd / 1e9;
const input = (businessId = 'one') => ({ ...quote, businessId, actorUid: 'client', mode: 'sarin_client' as const, requestId: randomUUID(), callId: randomUUID(), provider: 'deepseek' as const, model: 'deepseek-flash' });
const change = (limits: { businessDayUsd: number; businessMonthUsd: number } | null, expectedVersion = 0) => ({ businessId: 'one', expectedVersion, expectedSettingsVersion: 1, limits, reason: 'Synthetic funding decision' });
const initial = { 'businesses/one': { id: 'one', name: 'Barbería Uno' }, 'businesses/two': { id: 'two', name: 'Negocio Dos' } };
async function setup(extra = {}) {
  const memory = memoryFirestore(initial);
  await saveAiBudgetSettings(admin, { expectedVersion: 0, paused: false, limits: { ...DEFAULT_AI_BUDGET_LIMITS, businessDayUsd: slot, ...extra }, reason: 'Synthetic setup' }, memory.db);
  return memory;
}
beforeEach(() => vi.stubEnv('SUPERADMIN_UID', admin.uid));
afterEach(() => vi.unstubAllEnvs());

describe('individual business AI budgets', () => {
  it('shows inherited limits and authoritative held usage in Colombia periods, including uncertain calls', async () => {
    const { db } = await setup();
    const reservation = await reservePaidCallBudget(input(), db, now);
    await settlePaidCallBudget(reservation, { callId: reservation.callId, provider: 'deepseek', model: 'deepseek-flash', startedAt: now, finishedAt: now + 1, success: false, usage: null }, db);
    const view = await readBusinessAiBudget(admin, 'one', db, now);
    expect(view).toMatchObject({ businessId: 'one', name: 'Barbería Uno', override: null, periods: { day: '2030-01-31', month: '2030-01' }, limits: { businessDayUsd: slot, businessMonthUsd: 2 }, usage: { day: { usedTokens: 0, reservedTokens: quote.maxTokens, reservedCostNanoUsd: quote.maxCostNanoUsd } }, global: { day: { reservedCostNanoUsd: quote.maxCostNanoUsd } } });
    expect((await readBusinessAiBudget(admin, 'two', db, now)).usage.day.reservedTokens).toBe(0);
    expect((await readBusinessAiBudget(admin, 'one', db, now + 120000)).usage.day.reservedTokens).toBe(0);
    expect((await readBusinessAiBudget(admin, 'one', db, now)).usage.month.reservedTokens).toBe(quote.maxTokens);
  });

  it('increases only the selected business limit without clearing held usage; restoring inherits and keeps its version', async () => {
    const { db, rows } = await setup();
    await reservePaidCallBudget(input(), db, now);
    await expect(reservePaidCallBudget(input(), db, now)).rejects.toMatchObject({ code: 'AI_BUDGET_EXHAUSTED' });
    await saveBusinessAiBudgetSettings(admin, change({ businessDayUsd: slot * 2, businessMonthUsd: 3 }), db, now);
    await reservePaidCallBudget(input(), db, now);
    const view = await readBusinessAiBudget(admin, 'one', db, now);
    expect(view.usage.day.reservedCostNanoUsd).toBe(quote.maxCostNanoUsd * 2);
    expect(view.override).toMatchObject({ version: 1, updatedBy: 'admin', updatedAt: now });
    expect((await readBusinessAiBudget(admin, 'two', db, now)).limits.businessDayUsd).toBe(slot);
    const calls = structuredClone([...rows].filter(([key]) => key.startsWith('aiBudgetCalls/')));
    await saveBusinessAiBudgetSettings(admin, change(null, 1), db, now);
    expect((await readBusinessAiBudget(admin, 'one', db, now)).override).toMatchObject({ version: 2, limits: null });
    await expect(reservePaidCallBudget(input(), db, now)).rejects.toMatchObject({ code: 'AI_BUDGET_EXHAUSTED' });
    expect([...rows].filter(([key]) => key.startsWith('aiBudgetCalls/'))).toEqual(calls);
    await expect(saveBusinessAiBudgetSettings(admin, change(null), db)).rejects.toMatchObject({ status: 409 });
  });

  it('retains global and token caps even with a large individual money allowance', async () => {
    const { db } = await setup({ globalDayUsd: slot * 2 });
    await saveBusinessAiBudgetSettings(admin, change({ businessDayUsd: 10, businessMonthUsd: 100 }), db);
    await reservePaidCallBudget(input(), db, now); await reservePaidCallBudget(input('two'), db, now);
    await expect(reservePaidCallBudget(input(), db, now)).rejects.toMatchObject({ code: 'AI_BUDGET_EXHAUSTED' });
    const tokenBound = await setup({ businessDayTokens: quote.maxTokens });
    await saveBusinessAiBudgetSettings(admin, change({ businessDayUsd: 10, businessMonthUsd: 100 }), tokenBound.db);
    await reservePaidCallBudget(input(), tokenBound.db, now);
    await expect(reservePaidCallBudget(input(), tokenBound.db, now)).rejects.toMatchObject({ code: 'AI_BUDGET_EXHAUSTED' });
  });

  it('authorizes domain reads and edits, validates input and existing business, and rejects stale base settings', async () => {
    const { db } = await setup();
    await expect(readBusinessAiBudget({ uid: 'owner' }, 'one', db)).rejects.toMatchObject({ status: 403 });
    await expect(saveBusinessAiBudgetSettings({ uid: 'owner' }, change(null), db)).rejects.toMatchObject({ status: 403 });
    await expect(saveBusinessAiBudgetSettings(admin, { ...change(null), businessId: 'absent' }, db)).rejects.toMatchObject({ status: 404 });
    await expect(saveBusinessAiBudgetSettings(admin, change({ businessDayUsd: -1, businessMonthUsd: 2 }), db)).rejects.toBeDefined();
    await saveAiBudgetSettings(admin, { expectedVersion: 1, paused: false, limits: DEFAULT_AI_BUDGET_LIMITS, reason: 'New general funding' }, db);
    await expect(saveBusinessAiBudgetSettings(admin, change(null), db)).rejects.toMatchObject({ status: 409, code: 'AI_BUDGET_SETTINGS_CONFLICT' });
    const empty = memoryFirestore(initial);
    await expect(saveBusinessAiBudgetSettings(admin, change(null), empty.db)).rejects.toMatchObject({ status: 409 });
  });

  it('serializes competing edits and fails closed on an invalid saved override', async () => {
    const { db, rows } = await setup();
    const edits = await Promise.allSettled([saveBusinessAiBudgetSettings(admin, change({ businessDayUsd: 1, businessMonthUsd: 3 }), db), saveBusinessAiBudgetSettings(admin, change({ businessDayUsd: 2, businessMonthUsd: 4 }), db)]);
    expect(edits.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(edits.find(result => result.status === 'rejected')).toMatchObject({ reason: { status: 409 } });
    const key = `serverSettings/pilotAiBudgetBusiness_${createHash('sha256').update('one').digest('hex')}`;
    rows.get(key)!.data.businessId = 'two';
    await expect(readBusinessAiBudget(admin, 'one', db)).rejects.toMatchObject({ code: 'AI_BUDGET_UNAVAILABLE' });
    await expect(reservePaidCallBudget(input(), db, now)).rejects.toMatchObject({ code: 'AI_BUDGET_UNAVAILABLE' });
    await expect(saveBusinessAiBudgetSettings(admin, change(null, 1), db)).rejects.toMatchObject({ code: 'AI_BUDGET_UNAVAILABLE' });
  });
});
