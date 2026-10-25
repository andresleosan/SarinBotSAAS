import type { Database } from '@/lib/storage/types';
import { privateBusinessDraft } from '@/lib/server/businesses';
export const summaryNow = Date.parse('2030-01-08T02:00:00Z');
export const summaryOwner = { uid: 'demo-s17-owner' }, summaryBusinessId = 'demo-s17';
export const summaryRange = { from: '2030-01-01', through: '2030-01-07' };
export function summaryRecords(now = summaryNow) {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(now);
  const make = (id: string, status: string, extra: Record<string, unknown> = {}) => ({ id, tenantId: summaryBusinessId, dateKey: today, type: 'appointment', status, startAt: now - 3600000, endAt: now - 1800000, reservedUntilAt: now, ...extra });
  return [make('ended', 'confirmed'), make('completed', 'completed'), make('no-show', 'no_show'), make('cancel-client', 'cancelled_by_client'), make('cancel-owner', 'cancelled_by_owner'), make('future', 'confirmed', { startAt: now + 60000, endAt: now + 120000, reservedUntilAt: now + 180000 }), make('unknown-end', 'confirmed', { reservedUntilAt: null }), make('block', 'confirmed', { type: 'manual_block' }), make('corrupt', 'unknown')];
}
export async function seedOperationSummary(db: Database, now = summaryNow) {
  const business = { ...privateBusinessDraft(summaryOwner, now), id: summaryBusinessId, name: 'Synthetic summary', subscription: { status: 'past_due' as const, trialEndsAt: 0, currentPeriodEndsAt: 0 } };
  const ref = db.collection('businesses').doc(business.id); await ref.set(business);
  for (const record of summaryRecords(now)) await ref.collection('appointments').doc(record.id).set(record);
  return { business, ref, owner: summaryOwner };
}
