import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('@/lib/firebase/admin', () => ({ getAdminDb: () => { throw new Error('Default backend forbidden'); } }));
import { budgetIds, reservePlatformCost, settlePlatformCost, readPlatformReservation, stagePlatformCostStart, recordPlatformStageUsage } from '@/lib/server/platform-whatsapp-budget';
import { emptyUsage, isPlatformJob, isBudgetCall, isBudgetPeriod } from '../shared/platform-whatsapp-work';
import { parsePlatformWorkPolicy, platformCost } from '../shared/platform-whatsapp-policy';
import { memoryStore, now } from './platform-whatsapp-test-fixtures';
import { configureWork, workCircuit, workJob, leaseToken } from './platform-whatsapp-work-fixtures';

describe('independent durable platform budgets', () => {
  beforeEach(() => { configureWork(); vi.spyOn(Date, 'now').mockReturnValue(now); });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });
  const fixture = () => { const s = memoryStore(), j = workJob(); s.seed('platformWhatsAppJobs/' + j.jobId, j); for (const stage of ['audio', 'generation', 'send'] as const) { const c = workCircuit(j, stage); s.seed('platformWhatsAppBudgetPeriods/' + c.circuitId, c); } return { ...s, j }; };
  it('rounds each rational component independently with overflow-safe intermediates', () => {
    expect(platformCost([{ units: 1, rate: { numerator: 1, denominator: 3 } }, { units: 1, rate: { numerator: 1, denominator: 3 } }])).toBe(2);
    expect(() => platformCost([{ units: Number.MAX_SAFE_INTEGER, rate: { numerator: 2, denominator: 1 } }])).toThrow();
    expect(platformCost([{ units: Number.MAX_SAFE_INTEGER, rate: { numerator: 2, denominator: 2 } }])).toBe(Number.MAX_SAFE_INTEGER);
  });
  it('requires a trusted closed tariff and treats invalid/missing limits as zero', () => {
    expect(parsePlatformWorkPolicy({})).toBeNull();
    expect(parsePlatformWorkPolicy({ ...process.env, PLATFORM_WHATSAPP_SEND_DAILY_BUDGET_MICROS: '-1' })?.limits.send).toBe(0);
    expect(parsePlatformWorkPolicy({ ...process.env, PLATFORM_WHATSAPP_TARIFF_POLICY: JSON.stringify({ ...JSON.parse(process.env.PLATFORM_WHATSAPP_TARIFF_POLICY!), allow: true }) })).toBeNull();
  });
  it('atomically deduplicates a reservation and keeps the three scopes independent', async () => {
    const s = fixture();
    const both = await Promise.all([reservePlatformCost(s.j.jobId, 'send', 10, s.db), reservePlatformCost(s.j.jobId, 'send', 10, s.db)]);
    expect(both[0]).toEqual(both[1]);
    await reservePlatformCost(s.j.jobId, 'audio', 1, s.db); await reservePlatformCost(s.j.jobId, 'generation', 2, s.db);
    const days = [...s.rows.values()].filter(isBudgetPeriod);
    expect(days.map(d => [d.stage, d.heldMicros]).sort()).toEqual([['audio', 1], ['generation', 2], ['send', 10]]);
    expect([...s.rows.values()].filter(isBudgetCall)).toHaveLength(3);
  });
  it('never opens missing/expired circuits or permits even a free call under zero limit', async () => {
    const s = fixture(), id = budgetIds(s.j, 'send', now).circuitId;
    s.rows.delete('platformWhatsAppBudgetPeriods/' + id);
    await expect(reservePlatformCost(s.j.jobId, 'send', 10, s.db)).rejects.toMatchObject({ status: 503 });
    const c = workCircuit(s.j); s.seed('platformWhatsAppBudgetPeriods/' + id, { ...c, createdAt: now - 2_592_000_000, expiresAt: now });
    await expect(reservePlatformCost(s.j.jobId, 'send', 10, s.db)).rejects.toMatchObject({ status: 503 });
    vi.stubEnv('PLATFORM_WHATSAPP_SEND_DAILY_BUDGET_MICROS', '0');
    await expect(reservePlatformCost(s.j.jobId, 'send', 0, s.db)).rejects.toMatchObject({ status: 503 });
  });
  it('releases only proven unstarted reservations and forbids changed final settlements', async () => {
    const s = fixture(), { reservationId } = await reservePlatformCost(s.j.jobId, 'send', 10, s.db);
    await expect(settlePlatformCost(reservationId, null, s.db)).rejects.toMatchObject({ status: 409 });
    await settlePlatformCost(reservationId, 0, s.db); await settlePlatformCost(reservationId, 0, s.db);
    expect(s.rows.get('platformWhatsAppBudgetCalls/' + reservationId)).toMatchObject({ status: 'released', actualMicros: 0 });
    await expect(settlePlatformCost(reservationId, 1, s.db)).rejects.toMatchObject({ status: 409 });
    expect([...s.rows.values()].find(isBudgetPeriod)?.heldMicros).toBe(0);
  });
  it('retains uncertain holds and records a later actual overrun with a durable circuit block', async () => {
    const s = fixture(), { reservationId } = await reservePlatformCost(s.j.jobId, 'send', 10, s.db);
    await s.db.runTransaction(async tx => { const f = await readPlatformReservation(s.j, 'send', 10, tx, s.db, now); expect(stagePlatformCostStart(f, leaseToken, tx, s.db, now)).toBe(true); });
    await settlePlatformCost(reservationId, null, s.db);
    expect([...s.rows.values()].find(isBudgetPeriod)).toMatchObject({ heldMicros: 10, usedMicros: 0 });
    await recordPlatformStageUsage(reservationId, leaseToken, { ...emptyUsage, usageMessages: 1 }, 15, s.db, now);
    expect([...s.rows.values()].find(isBudgetPeriod)).toMatchObject({ heldMicros: 0, usedMicros: 15, overrunMicros: 5, usageMessages: 1 });
    expect(s.rows.get('platformWhatsAppBudgetPeriods/' + budgetIds(s.j, 'send', now).circuitId)).toMatchObject({ status: 'blocked', reason: 'overrun' });
    await expect(reservePlatformCost(s.j.jobId, 'send', 10, s.db)).rejects.toMatchObject({ status: 503 });
  });
  it('blocks accounting overflow while preserving the conservative original hold', async () => {
    const s = fixture(), { reservationId } = await reservePlatformCost(s.j.jobId, 'send', 10, s.db);
    await s.db.runTransaction(async tx => { const f = await readPlatformReservation(s.j, 'send', 10, tx, s.db, now); stagePlatformCostStart(f, leaseToken, tx, s.db, now); });
    await expect(settlePlatformCost(reservationId, Number.MAX_SAFE_INTEGER + 1, s.db)).rejects.toMatchObject({ status: 503 });
    expect([...s.rows.values()].find(isBudgetPeriod)).toMatchObject({ heldMicros: 10, usedMicros: 0 });
    expect(s.rows.get('platformWhatsAppBudgetPeriods/' + budgetIds(s.j, 'send', now).circuitId)).toMatchObject({ status: 'blocked', reason: 'accounting_invalid' });
  });
  it('retains identical journaled payload on lost reserve response', async () => {
    const s = fixture(); s.loseNextResponse();
    await reservePlatformCost(s.j.jobId, 'send', 10, s.db);
    const commits = s.seen.filter(c => c.action === 'commit'); expect(commits).toHaveLength(2); expect(commits[0]).toEqual(commits[1]);
  });
  it('validates exact records, safe numbers and original source deadlines', () => {
    const j = workJob(); expect(isPlatformJob(j)).toBe(true);
    for (const change of [{ customerPhone: '+12025550101' }, { expiresAt: j.expiresAt + 1 }, { connectionRevision: Number.MAX_SAFE_INTEGER + 1 }, { windowExpiresAt: null }, { nextJobId: j.jobId }, { generationState: 'started' }]) expect(isPlatformJob({ ...j, ...change })).toBe(false);
  });
  it('cannot carry yesterday\'s unstarted reservation into today or silently reprice it', async () => {
    const s = fixture(), { reservationId } = await reservePlatformCost(s.j.jobId, 'send', 10, s.db);
    const nextDay = Math.floor(now / 86_400_000) * 86_400_000 + 86_400_000;
    vi.mocked(Date.now).mockReturnValue(nextDay);
    await expect(reservePlatformCost(s.j.jobId, 'send', 10, s.db)).rejects.toMatchObject({ status: 409 });
    await settlePlatformCost(reservationId, 0, s.db);
    expect(s.rows.get('platformWhatsAppBudgetCalls/' + reservationId)).toMatchObject({ status: 'released' });
    expect([...s.rows.values()].filter(isBudgetPeriod)).toHaveLength(1);
  });
});
