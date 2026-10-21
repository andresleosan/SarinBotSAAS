import 'server-only';
import type { Database, Transaction } from '@/lib/storage/types';
import { PLATFORM_BODY_TTL, PLATFORM_METADATA_TTL } from '../../../shared/platform-whatsapp-records';
import { emptyUsage, validUsage, workInteger, type BudgetCall, type BudgetPeriod, type BudgetCircuit, type CostStage, type PlatformJob, type Usage } from '../../../shared/platform-whatsapp-work';
import { maximumPlatformCost, parsePlatformWorkPolicy, platformPolicyTuple, type WorkPolicy } from '../../../shared/platform-whatsapp-policy';
import { assertPlatformWhatsAppNow, platformWhatsAppConflictError, platformWhatsAppIdentity, platformWhatsAppUnavailableError, samePlatformWhatsAppScope } from './platform-whatsapp-store';
import { checkedAdd, readWork, stageWork, workHash } from './platform-whatsapp-work-records';
import { HttpError } from './http';
const closed = () => new HttpError(503, 'El presupuesto de plataforma no está habilitado.', 'PLATFORM_WORK_CLOSED');

export function currentPlatformWorkPolicy(): { policy: WorkPolicy; fingerprint: string } {
  const policy = parsePlatformWorkPolicy({
    PLATFORM_WHATSAPP_TARIFF_POLICY: process.env.PLATFORM_WHATSAPP_TARIFF_POLICY,
    PLATFORM_WHATSAPP_AUDIO_ENABLED: process.env.PLATFORM_WHATSAPP_AUDIO_ENABLED,
    PLATFORM_WHATSAPP_AI_ENABLED: process.env.PLATFORM_WHATSAPP_AI_ENABLED,
    PLATFORM_WHATSAPP_SEND_ENABLED: process.env.PLATFORM_WHATSAPP_SEND_ENABLED,
    PLATFORM_WHATSAPP_AUDIO_DAILY_BUDGET_MICROS: process.env.PLATFORM_WHATSAPP_AUDIO_DAILY_BUDGET_MICROS,
    PLATFORM_WHATSAPP_GENERATION_DAILY_BUDGET_MICROS: process.env.PLATFORM_WHATSAPP_GENERATION_DAILY_BUDGET_MICROS,
    PLATFORM_WHATSAPP_SEND_DAILY_BUDGET_MICROS: process.env.PLATFORM_WHATSAPP_SEND_DAILY_BUDGET_MICROS,
  });
  if (!policy) throw closed();
  return { policy, fingerprint: workHash('policy', platformPolicyTuple(policy)) };
}
export function budgetIds(job: PlatformJob, stage: CostStage, now: number) {
  const scope = [job.wabaId, job.phoneE164, job.phoneNumberId], dayStart = Math.floor(now / PLATFORM_BODY_TTL) * PLATFORM_BODY_TTL;
  return { reservationId: 'call_' + workHash('cost', scope, job.jobId, job.epoch, stage), circuitId: 'circuit_' + workHash('stage-circuit', scope, stage), periodId: 'day_' + workHash('day', scope, stage, dayStart), dayStart };
}
type BudgetFacts = { call: BudgetCall | null; period: BudgetPeriod; circuit: BudgetCircuit; policy: WorkPolicy; fingerprint: string };
/** Read-only preparation. Callers stage only after all of their own reads. */
export async function readPlatformReservation(job: PlatformJob, stage: CostStage, maximumMicros: number, tx: Transaction, db: Database, now: number): Promise<BudgetFacts> {
  assertPlatformWhatsAppNow(now);
  if (!workInteger(maximumMicros) || job.expiresAt <= now || job.sourceReceivedAt > now) throw platformWhatsAppUnavailableError();
  const { policy, fingerprint } = currentPlatformWorkPolicy(), ids = budgetIds(job, stage, now);
  if (!policy.enabled[stage] || policy.limits[stage] <= 0) throw closed();
  const [call, day, circuit] = await Promise.all([readWork(tx, db, 'platformWhatsAppBudgetCalls/' + ids.reservationId), readWork(tx, db, 'platformWhatsAppBudgetPeriods/' + ids.periodId), readWork(tx, db, 'platformWhatsAppBudgetPeriods/' + ids.circuitId)]);
  if (circuit && (circuit.recordType !== 'budget_circuit' || circuit.stage !== stage || !samePlatformWhatsAppScope(circuit, job))) throw platformWhatsAppUnavailableError();
  if (circuit?.recordType !== 'budget_circuit' || circuit.status !== 'open' || circuit.createdAt > now || circuit.expiresAt <= now || circuit.policyFingerprint !== fingerprint) throw closed();
  if (call && (call.recordType !== 'budget_call' || !samePlatformWhatsAppScope(call, job) || call.jobId !== job.jobId || call.epoch !== job.epoch || call.stage !== stage || call.maximumMicros !== maximumMicros || call.tariffVersion !== policy.tariff.version || call.policyFingerprint !== fingerprint || call.requestFingerprint !== job.requestFingerprint || call.expiresAt !== job.expiresAt || call.periodId !== ids.periodId || call.circuitId !== ids.circuitId)) throw platformWhatsAppConflictError();
  if (maximumMicros !== maximumPlatformCost(policy, stage)) throw call ? platformWhatsAppConflictError() : closed();
  if (day && (day.recordType !== 'budget_period' || !samePlatformWhatsAppScope(day, job) || day.stage !== stage || day.dayStart !== ids.dayStart)) throw platformWhatsAppUnavailableError();
  const period: BudgetPeriod = day as BudgetPeriod ?? { ...platformWhatsAppIdentity(job), recordType: 'budget_period', periodId: ids.periodId, stage, dayStart: ids.dayStart, dayEnd: ids.dayStart + PLATFORM_BODY_TTL, usedMicros: 0, heldMicros: 0, overrunMicros: 0, ...emptyUsage, expiresAt: ids.dayStart + PLATFORM_METADATA_TTL };
  if (!call && checkedAdd(period.usedMicros, period.heldMicros, maximumMicros) > policy.limits[stage]) throw closed();
  return { call: call as BudgetCall | null, period, circuit, policy, fingerprint };
}
export function stagePlatformReservation(job: PlatformJob, stage: CostStage, maximumMicros: number, facts: BudgetFacts, tx: Transaction, db: Database, now: number): BudgetCall {
  if (facts.call) return facts.call;
  const ids = budgetIds(job, stage, now);
  const call: BudgetCall = { ...platformWhatsAppIdentity(job), recordType: 'budget_call', ...ids, jobId: job.jobId, epoch: job.epoch, stage, requestFingerprint: job.requestFingerprint, maximumMicros, actualMicros: null, tariffVersion: facts.policy.tariff.version, policyFingerprint: facts.fingerprint, createdAt: now, expiresAt: job.expiresAt, status: 'reserved', effectToken: null, startedAt: null, finishedAt: null, ...emptyUsage };
  // dayStart is an aggregate coordinate, never an extra field on a call.
  delete (call as BudgetCall & { dayStart?: number }).dayStart;
  stageWork(tx, db, 'platformWhatsAppBudgetCalls/' + call.reservationId, call);
  stageWork(tx, db, 'platformWhatsAppBudgetPeriods/' + facts.period.periodId, { ...facts.period, heldMicros: checkedAdd(facts.period.heldMicros, maximumMicros) });
  return call;
}
export async function reservePlatformCost(jobId: string, stage: CostStage, maximumMicros: number, db: Database): Promise<{ reservationId: string }> {
  const now = Date.now();
  return db.runTransaction(async tx => {
    const job = await readWork(tx, db, 'platformWhatsAppJobs/' + jobId);
    if (job?.recordType !== 'job' || !['audio', 'generation', 'send'].includes(stage)) throw platformWhatsAppUnavailableError();
    const facts = await readPlatformReservation(job, stage, maximumMicros, tx, db, now);
    return { reservationId: stagePlatformReservation(job, stage, maximumMicros, facts, tx, db, now).reservationId };
  });
}
export function stagePlatformCostStart(facts: BudgetFacts, token: string, tx: Transaction, db: Database, now: number): boolean {
  const c = facts.call;
  if (!c || c.status !== 'reserved' || c.createdAt > now || now >= facts.period.dayEnd || now < facts.period.dayStart || c.periodId !== facts.period.periodId) return false;
  stageWork(tx, db, 'platformWhatsAppBudgetCalls/' + c.reservationId, { ...c, status: 'started', effectToken: token, startedAt: now });
  return true;
}
export async function readPlatformSettlement(id: string, tx: Transaction, db: Database) {
  const call = await readWork(tx, db, 'platformWhatsAppBudgetCalls/' + id);
  if (call?.recordType !== 'budget_call') throw platformWhatsAppUnavailableError();
  const [period, circuit] = await Promise.all([readWork(tx, db, 'platformWhatsAppBudgetPeriods/' + call.periodId), readWork(tx, db, 'platformWhatsAppBudgetPeriods/' + call.circuitId)]);
  if (period?.recordType !== 'budget_period' || circuit?.recordType !== 'budget_circuit' || !samePlatformWhatsAppScope(call, period) || !samePlatformWhatsAppScope(call, circuit) || call.stage !== period.stage || call.stage !== circuit.stage) throw platformWhatsAppUnavailableError();
  return { call, period, circuit };
}
export function stagePlatformSettlement(facts: Awaited<ReturnType<typeof readPlatformSettlement>>, actual: number | null, usage: Usage, token: string | null, tx: Transaction, db: Database, now: number): boolean {
  const { call, period, circuit } = facts;
  if (token !== call.effectToken || !validUsage(usage, call.stage)) throw platformWhatsAppConflictError();
  if (['settled', 'released'].includes(call.status)) {
    if (call.actualMicros !== actual || Object.keys(emptyUsage).some(k => call[k as keyof Usage] !== usage[k as keyof Usage])) throw platformWhatsAppConflictError();
    return true;
  }
  if (call.status === 'reserved') {
    if (actual !== 0 || Object.values(usage).some(v => v !== null) || period.heldMicros < call.maximumMicros) throw platformWhatsAppConflictError();
    stageWork(tx, db, 'platformWhatsAppBudgetCalls/' + call.reservationId, { ...call, status: 'released', actualMicros: 0, finishedAt: now });
    stageWork(tx, db, 'platformWhatsAppBudgetPeriods/' + period.periodId, { ...period, heldMicros: period.heldMicros - call.maximumMicros });
    return true;
  }
  if (actual === null) {
    if (Object.values(usage).some(v => v !== null)) throw platformWhatsAppConflictError();
    if (call.status !== 'uncertain') stageWork(tx, db, 'platformWhatsAppBudgetCalls/' + call.reservationId, { ...call, status: 'uncertain', finishedAt: now });
    return true;
  }
  let updated: BudgetPeriod;
  try {
    if (!workInteger(actual) || period.heldMicros < call.maximumMicros) throw platformWhatsAppUnavailableError();
    updated = { ...period, heldMicros: period.heldMicros - call.maximumMicros, usedMicros: checkedAdd(period.usedMicros, actual), overrunMicros: checkedAdd(period.overrunMicros, Math.max(0, actual - call.maximumMicros)) };
    for (const k of Object.keys(emptyUsage) as Array<keyof Usage>) if (usage[k] !== null) updated[k] = checkedAdd(period[k] ?? 0, usage[k]!);
  } catch {
    stageWork(tx, db, 'platformWhatsAppBudgetPeriods/' + circuit.circuitId, { ...circuit, status: 'blocked', reason: 'accounting_invalid', trippedAt: circuit.trippedAt ?? now });
    return false;
  }
  stageWork(tx, db, 'platformWhatsAppBudgetCalls/' + call.reservationId, { ...call, status: 'settled', actualMicros: actual, finishedAt: now, ...usage });
  stageWork(tx, db, 'platformWhatsAppBudgetPeriods/' + period.periodId, updated);
  if (actual > call.maximumMicros) stageWork(tx, db, 'platformWhatsAppBudgetPeriods/' + circuit.circuitId, { ...circuit, status: 'blocked', reason: 'overrun', trippedAt: circuit.trippedAt ?? now });
  return true;
}
export async function settlePlatformCost(reservationId: string, actualMicros: number | null, db: Database): Promise<void> {
  const now = Date.now();
  const valid = await db.runTransaction(async tx => { const facts = await readPlatformSettlement(reservationId, tx, db); return stagePlatformSettlement(facts, actualMicros, emptyUsage, facts.call.effectToken, tx, db, now); });
  if (!valid) throw platformWhatsAppUnavailableError();
}
export async function recordPlatformStageUsage(reservationId: string, effectToken: string, usage: Usage, actualMicros: number, db: Database, now = Date.now()): Promise<void> {
  const valid = await db.runTransaction(async tx => { const facts = await readPlatformSettlement(reservationId, tx, db); return stagePlatformSettlement(facts, actualMicros, usage, effectToken, tx, db, now); });
  if (!valid) throw platformWhatsAppUnavailableError();
}
