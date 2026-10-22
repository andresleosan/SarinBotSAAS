import 'server-only';
import type { Database, Transaction } from '@/lib/storage/types';
import { PLATFORM_BODY_TTL, PLATFORM_METADATA_TTL } from '../../../shared/platform-whatsapp-records';
import { emptyUsage, validUsage, workInteger, type BudgetCall, type BudgetPeriod, type BudgetCircuit, type CostStage, type PlatformJob, type Usage, type GenerationQuote } from '../../../shared/platform-whatsapp-work';
import { maximumPlatformCost, parsePlatformWorkPolicy, platformPolicyTuple, type WorkPolicy, parseGenerationPolicy, generationPolicyTuple, quoteGenerationMicros } from '../../../shared/platform-whatsapp-policy';
import { assertPlatformWhatsAppNow, platformWhatsAppConflictError, platformWhatsAppIdentity, platformWhatsAppUnavailableError, samePlatformWhatsAppScope } from './platform-whatsapp-store';
import { checkedAdd, readWork, stageWork, workHash } from './platform-whatsapp-work-records';
import { platformWhatsAppDigest } from './platform-whatsapp-crypto';
import { getPlatformWhatsAppConfig } from './platform-whatsapp-config';
import { HttpError } from './http';
import { platformSettlementPeriod } from '../../../shared/platform-whatsapp-accounting';
const closed = () => new HttpError(503, 'El presupuesto de plataforma no está habilitado.', 'PLATFORM_WORK_CLOSED');

export function currentPlatformWorkPolicy(): { policy: WorkPolicy; fingerprint: string } {
  const policy = parsePlatformWorkPolicy({
    PLATFORM_WHATSAPP_GENERATION_POLICY: process.env.PLATFORM_WHATSAPP_GENERATION_POLICY,
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
export function currentGenerationPolicy() {
  const { policy } = currentPlatformWorkPolicy(), mapping = parseGenerationPolicy(process.env.PLATFORM_WHATSAPP_GENERATION_POLICY);
  if (!mapping || policy.tariff.maximumOutputTokens < 4096 || BigInt(policy.tariff.generationInput.numerator) * 1000n !== 300n * BigInt(policy.tariff.generationInput.denominator) || BigInt(policy.tariff.generationOutput.numerator) * 1000n !== 1200n * BigInt(policy.tariff.generationOutput.denominator)) throw closed();
  return { mapping, fingerprint: workHash('generation-policy', generationPolicyTuple(policy, mapping)), policy };
}
export function quotePlatformGeneration(body: string): GenerationQuote {
  const { policy, fingerprint } = currentGenerationPolicy(), bytes = Buffer.byteLength(body, 'utf8');
  if (bytes + 4096 > policy.tariff.maximumInputTokens) throw closed();
  return { requestDigest: platformWhatsAppDigest('generation-request', [body], getPlatformWhatsAppConfig().contentKey), requestBytes: bytes, inputUpper: bytes + 4096, outputCap: 4096, provider: 'deepseek', requestedModel: 'deepseek-flash', modelPolicy: fingerprint, maximumMicros: quoteGenerationMicros(bytes) };
}
export function budgetIds(job: PlatformJob, stage: CostStage, now: number) {
  const scope = [job.wabaId, job.phoneE164, job.phoneNumberId], dayStart = Math.floor(now / PLATFORM_BODY_TTL) * PLATFORM_BODY_TTL;
  return { reservationId: 'call_' + workHash('cost', scope, job.jobId, job.epoch, stage), circuitId: 'circuit_' + workHash('stage-circuit', scope, stage), periodId: 'day_' + workHash('day', scope, stage, dayStart), dayStart };
}
type BudgetFacts = { call: BudgetCall | null; period: BudgetPeriod; circuit: BudgetCircuit; policy: WorkPolicy; fingerprint: string };
/** Read-only preparation. Callers stage only after all of their own reads. */
export async function readPlatformReservation(job: PlatformJob, stage: CostStage, maximumMicros: number, tx: Transaction, db: Database, now: number, quote?: GenerationQuote, precheck = false): Promise<BudgetFacts> {
  assertPlatformWhatsAppNow(now);
  if (!workInteger(maximumMicros) || job.expiresAt <= now || job.sourceReceivedAt > now) throw platformWhatsAppUnavailableError();
  const { policy, fingerprint } = currentPlatformWorkPolicy(), ids = budgetIds(job, stage, now);
  if (!policy.enabled[stage] || policy.limits[stage] <= 0 || stage === 'send' && !policy.tariff.sendEvidence) throw closed();
  const [call, day, circuit] = await Promise.all([readWork(tx, db, 'platformWhatsAppBudgetCalls/' + ids.reservationId), readWork(tx, db, 'platformWhatsAppBudgetPeriods/' + ids.periodId), readWork(tx, db, 'platformWhatsAppBudgetPeriods/' + ids.circuitId)]);
  if (circuit && (circuit.recordType !== 'budget_circuit' || circuit.stage !== stage || !samePlatformWhatsAppScope(circuit, job))) throw platformWhatsAppUnavailableError();
  if (circuit?.recordType !== 'budget_circuit' || circuit.status !== 'open' || circuit.createdAt > now || circuit.expiresAt <= now || circuit.policyFingerprint !== fingerprint) throw closed();
  if (call && (call.recordType !== 'budget_call' || !samePlatformWhatsAppScope(call, job) || call.jobId !== job.jobId || call.epoch !== job.epoch || call.stage !== stage || call.maximumMicros !== maximumMicros || call.tariffVersion !== policy.tariff.version || call.policyFingerprint !== fingerprint || call.requestFingerprint !== job.requestFingerprint || call.expiresAt !== job.expiresAt || call.periodId !== ids.periodId || call.circuitId !== ids.circuitId)) throw platformWhatsAppConflictError();
  if (quote && (stage !== 'generation' || quote.modelPolicy !== currentGenerationPolicy().fingerprint || quote.inputUpper > policy.tariff.maximumInputTokens || quote.maximumMicros !== maximumMicros || call && JSON.stringify(call.quote) !== JSON.stringify(quote))) throw closed();
  if (precheck && stage === 'generation') currentGenerationPolicy();
  if (!precheck && !quote && maximumMicros !== maximumPlatformCost(policy, stage)) throw call ? platformWhatsAppConflictError() : closed();
  if (day && (day.recordType !== 'budget_period' || !samePlatformWhatsAppScope(day, job) || day.stage !== stage || day.dayStart !== ids.dayStart)) throw platformWhatsAppUnavailableError();
  const period: BudgetPeriod = day as BudgetPeriod ?? { ...platformWhatsAppIdentity(job), recordType: 'budget_period', periodId: ids.periodId, stage, dayStart: ids.dayStart, dayEnd: ids.dayStart + PLATFORM_BODY_TTL, usedMicros: 0, heldMicros: 0, overrunMicros: 0, ...emptyUsage, expiresAt: ids.dayStart + PLATFORM_METADATA_TTL };
  if (!call && checkedAdd(period.usedMicros, period.heldMicros, maximumMicros) > policy.limits[stage]) throw closed();
  return { call: call as BudgetCall | null, period, circuit, policy, fingerprint };
}
export function stagePlatformReservation(job: PlatformJob, stage: CostStage, maximumMicros: number, facts: BudgetFacts, tx: Transaction, db: Database, now: number, quote?: GenerationQuote): BudgetCall {
  if (facts.call) return facts.call;
  const ids = budgetIds(job, stage, now);
  const call: BudgetCall = { ...(quote ? { quote } : {}), ...platformWhatsAppIdentity(job), recordType: 'budget_call', ...ids, jobId: job.jobId, epoch: job.epoch, stage, requestFingerprint: job.requestFingerprint, maximumMicros, actualMicros: null, tariffVersion: facts.policy.tariff.version, policyFingerprint: facts.fingerprint, createdAt: now, expiresAt: job.expiresAt, status: 'reserved', effectToken: null, startedAt: null, finishedAt: null, ...emptyUsage };
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
export async function reservePlatformGeneration(job: PlatformJob, quote: GenerationQuote, db: Database, now = Date.now()) {
  return db.runTransaction(async tx => {
    const current = await readWork(tx, db, 'platformWhatsAppJobs/' + job.jobId);
    if (current?.recordType !== 'job' || current.epoch !== job.epoch || current.leaseToken !== job.leaseToken || current.generationState !== 'not_started') throw closed();
    const facts = await readPlatformReservation(current, 'generation', quote.maximumMicros, tx, db, now, quote);
    return stagePlatformReservation(current, 'generation', quote.maximumMicros, facts, tx, db, now, quote);
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
  const [period, circuit, job] = await Promise.all([readWork(tx, db, 'platformWhatsAppBudgetPeriods/' + call.periodId), readWork(tx, db, 'platformWhatsAppBudgetPeriods/' + call.circuitId), readWork(tx, db, 'platformWhatsAppJobs/' + call.jobId)]);
  if (period?.recordType !== 'budget_period' || circuit?.recordType !== 'budget_circuit' || !samePlatformWhatsAppScope(call, period) || !samePlatformWhatsAppScope(call, circuit) || call.stage !== period.stage || call.stage !== circuit.stage) throw platformWhatsAppUnavailableError();
  if (job?.recordType !== 'job' || !samePlatformWhatsAppScope(call, job) || call.epoch !== job.epoch || call.requestFingerprint !== job.requestFingerprint || call.expiresAt !== job.expiresAt || call.createdAt < job.createdAt || call.createdAt >= job.expiresAt) throw platformWhatsAppUnavailableError();
  const original = budgetIds(job, call.stage, call.createdAt);
  if (call.reservationId !== original.reservationId || call.periodId !== original.periodId || call.circuitId !== original.circuitId || period.dayStart !== original.dayStart || call.createdAt >= period.dayEnd) throw platformWhatsAppUnavailableError();
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
  const updated = platformSettlementPeriod(period, call.maximumMicros, actual, usage);
  if (!updated) {
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
