import { afterEach, beforeEach, expect, it, vi } from 'vitest';
vi.mock('@/lib/firebase/admin', () => ({ getAdminDb: () => { throw new Error('Explicit synthetic database required'); } }));
import { reservePlatformCost, settlePlatformCost, readPlatformReservation, stagePlatformCostStart, recordPlatformStageUsage } from '@/lib/server/platform-whatsapp-budget';
import { emptyUsage } from '../shared/platform-whatsapp-work';
import { readPlatformAdminBudget, savePlatformAdminBudget } from '@/lib/server/platform-whatsapp-admin-budget';
import { memoryStore, now } from './platform-whatsapp-test-fixtures';
import { configureWork, workCircuit, workJob } from './platform-whatsapp-work-fixtures';

beforeEach(() => { configureWork(); vi.stubEnv('PLATFORM_WHATSAPP_ADMIN_BUDGET_REQUIRED', 'true'); vi.spyOn(Date, 'now').mockReturnValue(now); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });
it('blocks text generation and sending until an administrative budget exists', async () => {
  const s = memoryStore(), j = workJob();
  s.seed('platformWhatsAppJobs/' + j.jobId, j);
  for (const stage of ['generation', 'send'] as const) {
    const c = workCircuit(j, stage); s.seed('platformWhatsAppBudgetPeriods/' + c.circuitId, c);
  }
  await expect(reservePlatformCost(j.jobId, 'send', 10, s.db)).rejects.toMatchObject({ status: 503 });
  await expect(reservePlatformCost(j.jobId, 'generation', 2, s.db)).rejects.toMatchObject({ status: 503 });
});

const admin = 'synthetic-admin';
function fixture() {
  vi.stubEnv('SUPERADMIN_UID', admin);
  const s = memoryStore(), j = workJob();
  s.seed('platformWhatsAppJobs/' + j.jobId, j);
  const c = workCircuit(j, 'send'); s.seed('platformWhatsAppBudgetPeriods/' + c.circuitId, c);
  return { ...s, j };
}
it('permits only the administrator and rejects stale saves without resetting counters', async () => {
  const s = fixture();
  await expect(savePlatformAdminBudget('other', { expectedVersion: 0, dayUsd: 0.25, monthUsd: 3 }, s.db)).rejects.toMatchObject({ status: 403 });
  await expect(readPlatformAdminBudget('other', s.db)).rejects.toMatchObject({ status: 403 });
  await savePlatformAdminBudget(admin, { expectedVersion: 0, dayUsd: 0.25, monthUsd: 3 }, s.db);
  await reservePlatformCost(s.j.jobId, 'send', 10, s.db);
  await expect(savePlatformAdminBudget(admin, { expectedVersion: 0, dayUsd: 1, monthUsd: 10 }, s.db)).rejects.toMatchObject({ status: 409 });
  const changed = await savePlatformAdminBudget(admin, { expectedVersion: 1, dayUsd: 0, monthUsd: 1 }, s.db);
  expect(changed.usage.day.heldMicros).toBe(10);
  await expect(s.db.runTransaction(tx => readPlatformReservation(s.j, 'send', 10, tx, s.db, now))).rejects.toMatchObject({ status: 503 });
});
it('counts concurrent reservations once and blocks a second call at the daily ceiling', async () => {
  const s = fixture();
  await savePlatformAdminBudget(admin, { expectedVersion: 0, dayUsd: 0.000015, monthUsd: 3 }, s.db);
  const same = await Promise.all([reservePlatformCost(s.j.jobId, 'send', 10, s.db), reservePlatformCost(s.j.jobId, 'send', 10, s.db)]);
  expect(same[0]).toEqual(same[1]);
  const j2 = { ...s.j, jobId: 'job_' + '2'.repeat(64) }; s.seed('platformWhatsAppJobs/' + j2.jobId, j2);
  await expect(reservePlatformCost(j2.jobId, 'send', 10, s.db)).rejects.toMatchObject({ status: 503 });
  expect((await readPlatformAdminBudget(admin, s.db)).usage.day.heldMicros).toBe(10);
});
it('keeps monthly holds across UTC day rollover and does not double release a proven unstarted call', async () => {
  const s = fixture();
  await savePlatformAdminBudget(admin, { expectedVersion: 0, dayUsd: 1, monthUsd: 0.000015 }, s.db);
  const call = await reservePlatformCost(s.j.jobId, 'send', 10, s.db);
  const tomorrow = now + 86400000; vi.mocked(Date.now).mockReturnValue(tomorrow);
  const j2 = { ...s.j, jobId: 'job_' + '2'.repeat(64) }; s.seed('platformWhatsAppJobs/' + j2.jobId, j2);
  await expect(reservePlatformCost(j2.jobId, 'send', 10, s.db)).rejects.toMatchObject({ status: 503 });
  const view = await readPlatformAdminBudget(admin, s.db, tomorrow);
  expect(view.usage.day.heldMicros).toBe(0); expect(view.usage.month.heldMicros).toBe(10);
  await settlePlatformCost(call.reservationId, 0, s.db); await settlePlatformCost(call.reservationId, 0, s.db);
  expect((await readPlatformAdminBudget(admin, s.db, tomorrow)).usage.month.heldMicros).toBe(0);
});
it('rejects negative, nonfinite and sub-micro-dollar administrative limits', async () => {
  const s = fixture();
  for (const dayUsd of [-1, Number.NaN, Number.POSITIVE_INFINITY, 0.0000001]) {
    await expect(savePlatformAdminBudget(admin, { expectedVersion: 0, dayUsd, monthUsd: 3 }, s.db)).rejects.toThrow();
  }
});
it('retains unknown costs, settles a late known result once and blocks accounting overruns', async () => {
  const s = fixture();
  await savePlatformAdminBudget(admin, { expectedVersion: 0, dayUsd: 0.25, monthUsd: 3 }, s.db);
  const call = await reservePlatformCost(s.j.jobId, 'send', 10, s.db);
  const token = '00000000-0000-4000-8000-000000000002';
  await s.db.runTransaction(async tx => { const facts = await readPlatformReservation(s.j, 'send', 10, tx, s.db, now); stagePlatformCostStart(facts, token, tx, s.db, now); });
  await settlePlatformCost(call.reservationId, null, s.db);
  expect((await readPlatformAdminBudget(admin, s.db)).usage.month.heldMicros).toBe(10);
  const usage = { ...emptyUsage, usageMessages: 1 };
  await recordPlatformStageUsage(call.reservationId, token, usage, 11, s.db);
  await recordPlatformStageUsage(call.reservationId, token, usage, 11, s.db);
  const view = await readPlatformAdminBudget(admin, s.db);
  expect(view.usage.day).toEqual({ usedMicros: 11, heldMicros: 0, blocked: true });
  expect(view.usage.month).toEqual(view.usage.day);
});
it('serializes distinct concurrent calls against the same administrative ceiling', async () => {
  const s = fixture();
  await savePlatformAdminBudget(admin, { expectedVersion: 0, dayUsd: 0.00001, monthUsd: 3 }, s.db);
  const j2 = { ...s.j, jobId: 'job_' + '2'.repeat(64) }; s.seed('platformWhatsAppJobs/' + j2.jobId, j2);
  const results = await Promise.allSettled([reservePlatformCost(s.j.jobId, 'send', 10, s.db), reservePlatformCost(j2.jobId, 'send', 10, s.db)]);
  expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
  expect((await readPlatformAdminBudget(admin, s.db)).usage.month.heldMicros).toBe(10);
});
it('denies starting an unstarted legacy reservation after administrative budgeting is configured', async () => {
  const s = fixture(); vi.stubEnv('PLATFORM_WHATSAPP_ADMIN_BUDGET_REQUIRED', 'false');
  await reservePlatformCost(s.j.jobId, 'send', 10, s.db);
  await savePlatformAdminBudget(admin, { expectedVersion: 0, dayUsd: 0.25, monthUsd: 3 }, s.db);
  await expect(s.db.runTransaction(async tx => {
    const facts = await readPlatformReservation(s.j, 'send', 10, tx, s.db, now);
    stagePlatformCostStart(facts, '00000000-0000-4000-8000-000000000002', tx, s.db, now);
  })).rejects.toMatchObject({ status: 503 });
});
