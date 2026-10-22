import 'server-only';
import { z } from 'zod';
import type { Database, Transaction } from '@/lib/storage/types';
import type { PlatformWhatsAppBudgetView } from '@/types/platform-whatsapp-budget';
import type { CostStage } from '../../../shared/platform-whatsapp-work';
import { getAdminDb } from '@/lib/firebase/admin';
import { isSuperadmin } from './auth';
import { HttpError } from './http';

const integer = z.number().int().nonnegative().safe();
const microsUsd = z.number().finite().min(0).max(10000).refine(v => Math.abs(v * 1e6 - Math.round(v * 1e6)) < 1e-6);
export const platformBudgetInput = z.object({ expectedVersion: integer, dayUsd: microsUsd, monthUsd: microsUsd }).strict();
const settingsSchema = z.object({ version: integer.min(1), dayMicros: integer, monthMicros: integer, updatedAt: integer, updatedBy: z.string().min(1).max(128) }).strict();
const counterSchema = z.object({ usedMicros: integer, heldMicros: integer, blocked: z.boolean() }).strict();
const callSchema = z.object({ maximumMicros: integer, actualMicros: integer.nullable(), periodIds: z.tuple([z.string().regex(/^day_\d{4}-\d{2}-\d{2}$/), z.string().regex(/^month_\d{4}-\d{2}$/)]), status: z.enum(['held', 'settled']) }).strict();
const settingsId = 'platform_whatsapp_budget';
const counter = (v: unknown) => v === undefined ? { usedMicros: 0, heldMicros: 0, blocked: false } : counterSchema.parse(v);
const ref = (db: Database, id: string) => db.collection('platformWhatsAppSpending').doc(id);
const settingsRef = (db: Database) => db.collection('serverSettings').doc(settingsId);
const closed = () => new HttpError(503, 'El bot alcanzó su presupuesto o está pausado.', 'PLATFORM_WORK_CLOSED');
function authorize(uid: string) { if (!isSuperadmin(uid)) throw new HttpError(403, 'No tienes permisos para modificar este presupuesto.'); }
function add(...values: number[]) { const result = values.reduce((a, b) => a + BigInt(b), 0n); if (result > BigInt(Number.MAX_SAFE_INTEGER) || result < 0n) throw closed(); return Number(result); }
export function platformBudgetPeriods(at: number): [string, string] {
  const date = new Date(at).toISOString();
  return ['day_' + date.slice(0, 10), 'month_' + date.slice(0, 7)];
}
export async function readPlatformAdminBudget(uid: string, db: Database = getAdminDb(), at = Date.now()): Promise<PlatformWhatsAppBudgetView> {
  authorize(uid);
  return db.runTransaction(async tx => {
    const ids = platformBudgetPeriods(at);
    const [document, ...periods] = await Promise.all([tx.get(settingsRef(db)), ...ids.map(id => tx.get(ref(db, id)))]);
    const settings = document.exists ? settingsSchema.parse(document.data()) : null;
    return { configured: !!settings, version: settings?.version ?? 0, dayUsd: (settings?.dayMicros ?? 250000) / 1e6,
      monthUsd: (settings?.monthMicros ?? 3000000) / 1e6, timezone: 'UTC', day: ids[0].slice(4), month: ids[1].slice(6),
      usage: { day: counter(periods[0].data()), month: counter(periods[1].data()) } };
  });
}
export async function savePlatformAdminBudget(uid: string, supplied: z.input<typeof platformBudgetInput>, db: Database = getAdminDb(), at = Date.now()) {
  authorize(uid); const input = platformBudgetInput.parse(supplied);
  await db.runTransaction(async tx => {
    const document = await tx.get(settingsRef(db)), previous = document.exists ? settingsSchema.parse(document.data()) : null;
    if ((previous?.version ?? 0) !== input.expectedVersion || input.expectedVersion === Number.MAX_SAFE_INTEGER) throw new HttpError(409, 'El presupuesto cambió. Actualiza antes de guardar.');
    tx.set(settingsRef(db), { version: input.expectedVersion + 1, dayMicros: Math.round(input.dayUsd * 1e6), monthMicros: Math.round(input.monthUsd * 1e6), updatedAt: at, updatedBy: uid });
  });
  return readPlatformAdminBudget(uid, db, at);
}
export async function readAdminBudgetReservation(id: string, stage: CostStage, maximumMicros: number, tx: Transaction, db: Database, at: number) {
  const document = await tx.get(settingsRef(db));
  if (!document.exists) {
    if (process.env.PLATFORM_WHATSAPP_ADMIN_BUDGET_REQUIRED === 'true') throw closed();
    return null;
  }
  // The approved launch covers text only. Worker audio settlement requires its own accounting integration.
  if (stage === 'audio') throw closed();
  const settings = settingsSchema.parse(document.data()), ids = platformBudgetPeriods(at), callRef = ref(db, 'call_' + id);
  const [existing, ...documents] = await Promise.all([tx.get(callRef), ...ids.map(key => tx.get(ref(db, key)))]);
  const periods = documents.map(d => counter(d.data()));
  const limits = [settings.dayMicros, settings.monthMicros];
  if (existing.exists) {
    const call = callSchema.parse(existing.data());
    if (call.maximumMicros !== maximumMicros || JSON.stringify(call.periodIds) !== JSON.stringify(ids)) throw closed();
    periods.forEach((p, i) => { if (!limits[i] || p.blocked || add(p.usedMicros, p.heldMicros) > limits[i]) throw closed(); });
    return { callRef, periods, ids, existing: true, maximumMicros };
  }
  periods.forEach((p, i) => { if (!limits[i] || p.blocked || add(p.usedMicros, p.heldMicros, maximumMicros) > limits[i]) throw closed(); });
  return { callRef, periods, ids, existing: false, maximumMicros };
}
export function stageAdminBudgetReservation(facts: Awaited<ReturnType<typeof readAdminBudgetReservation>>, tx: Transaction, db: Database) {
  if (!facts || facts.existing) return;
  tx.create(facts.callRef, { maximumMicros: facts.maximumMicros, actualMicros: null, periodIds: facts.ids, status: 'held' });
  facts.periods.forEach((p, i) => tx.set(ref(db, facts.ids[i]), { ...p, heldMicros: add(p.heldMicros, facts.maximumMicros) }));
}
export async function readAdminBudgetSettlement(id: string, tx: Transaction, db: Database) {
  const callRef = ref(db, 'call_' + id), document = await tx.get(callRef);
  if (!document.exists) return null; // Legacy reservations predate this ledger.
  const call = callSchema.parse(document.data());
  const documents = await Promise.all(call.periodIds.map(key => tx.get(ref(db, key))));
  if (documents.some(d => !d.exists)) throw closed();
  return { callRef, call, periods: documents.map(d => counter(d.data())) };
}
export function stageAdminBudgetSettlement(facts: Awaited<ReturnType<typeof readAdminBudgetSettlement>>, actualMicros: number | null, tx: Transaction, db: Database) {
  if (!facts || actualMicros === null) return; // Unknown outcomes keep the full reservation.
  integer.parse(actualMicros);
  if (facts.call.status === 'settled') { if (facts.call.actualMicros !== actualMicros) throw closed(); return; }
  facts.periods.forEach((p, i) => {
    if (p.heldMicros < facts.call.maximumMicros) throw closed();
    tx.set(ref(db, facts.call.periodIds[i]), { usedMicros: add(p.usedMicros, actualMicros), heldMicros: p.heldMicros - facts.call.maximumMicros,
      blocked: p.blocked || actualMicros > facts.call.maximumMicros });
  });
  tx.set(facts.callRef, { ...facts.call, status: 'settled', actualMicros });
}
