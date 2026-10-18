import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createCloudflareDatabase, StorageError } from '@/lib/storage/database';
import type { Database } from '@/lib/storage/types';
import type { DataCommand, DataReadResult, DataCommitResult } from '../shared/data-protocol';
import { readAppointmentReminders, saveReminderPreference, markAppointmentReminderSeen, reminderReceiptId } from '@/lib/server/appointment-reminders';
import { createBookingProposal, confirmBookingProposal } from '@/lib/server/booking-proposals';
import { cancelAppointment } from '@/lib/server/bookings';
import { readConsent, updateConsent } from '@/lib/server/consent';
import { acceptSyntheticConsent } from './consent-fixtures';
import { rescheduleActor as actor, rescheduleBusiness as business, rescheduleSource as source, rescheduleSelection, rescheduleContact } from './appointment-reschedule-contract';

const now = Date.parse('2030-01-06T14:00:00Z');
const sourcePath = `businesses/${business.id}/appointments/${source.id}`;
const occurrence = { appointmentId: source.id, sourceRevision: 0, sourceStartAt: source.startAt, offsetMinutes: 1440 as const };
type Metrics = { rowsRead: number; rowsWritten: number; sqlStatements: number };
let mf: { dispose(): Promise<void>; dispatchFetch(url: string, options: object): Promise<Response> };
let db: Database, second: Database;
let metrics: Metrics[];
let intercept: ((command: DataCommand) => Promise<void>) | null;
let loseFirstSeenCommit: boolean, lost: Extract<DataCommand, { action: 'commit' }>[];
let localD1: { exec(sql: string): Promise<unknown>; prepare(sql: string): { all(): Promise<{ results: unknown[] }> } };
const isSeenCommit = (command: DataCommand): command is Extract<DataCommand, { action: 'commit' }> => command.action === 'commit' && command.writes.some(row => row.path.includes('/reminderReceipts/'));
beforeEach(async ({ task }) => {
  vi.spyOn(Date, 'now').mockReturnValue(now); metrics = []; intercept = null; loseFirstSeenCommit = false; lost = [];
  const require = createRequire(new URL('../cloudflare/package.json', import.meta.url));
  const wrangler = createRequire(require.resolve('wrangler/package.json'));
  const { build } = wrangler('esbuild'), { Miniflare, convertV4MiniflareOptions } = wrangler('miniflare');
  // Real local D1/R2 only. The test-only wrapper measures statements executed by
  // the production data handler; no test path or counters enter runtime code.
  const bundle = await build({ stdin: { resolveDir: fileURLToPath(new URL('../cloudflare/', import.meta.url)), contents: `
    import {executeDataCommand,DataError} from './src/data.ts';
    export default {async fetch(request,env){
      const metrics={rowsRead:0,rowsWritten:0,sqlStatements:0};
      const measured={...env,SARIN_DB:{prepare:sql=>env.SARIN_DB.prepare(sql),batch:async statements=>{
        const result=await env.SARIN_DB.batch(statements);
        for(const row of result){metrics.rowsRead+=row.meta?.rows_read??0;metrics.rowsWritten+=row.meta?.rows_written??0;metrics.sqlStatements++;}
        return result;
      }}};
      try{return Response.json(await executeDataCommand(await request.json(),measured),{headers:{'X-Test-D1-Metrics':JSON.stringify(metrics)}});}
      catch(error){return Response.json({code:error instanceof DataError?error.code:'DATA_UNAVAILABLE'},{status:error instanceof DataError?error.status:503});}
    }};` }, bundle: true, write: false, format: 'esm', platform: 'browser' });
  mf = new Miniflare(convertV4MiniflareOptions({ modules: true, script: bundle.outputFiles[0].text, compatibilityDate: '2026-10-13', d1Databases: { SARIN_DB: 'demo-reminders-data' }, r2Buckets: { SARIN_FILES: 'demo-reminders-files' } }));
  localD1 = await (mf as unknown as { getD1Database(name: string): Promise<typeof localD1> }).getD1Database('SARIN_DB');
  for (const migration of readdirSync('cloudflare/migrations').filter(name => /^\d+.*\.sql$/.test(name)).sort()) {
    if (migration === '0002_appointment_reminder_window.sql' && task.name.startsWith('index migration')) continue;
    await localD1.exec(readFileSync(`cloudflare/migrations/${migration}`, 'utf8').replace(/^--.*$/gm, '').replace(/\r?\n/g, ' '));
  }
  function connect(first: boolean) {
    return createCloudflareDatabase(async command => {
      if (first && intercept) await intercept(command);
      const response = await mf.dispatchFetch('http://demo-reminders.test/execute', { method: 'POST', body: JSON.stringify(command) });
      const value = await response.json() as DataReadResult | DataCommitResult;
      if (!response.ok) throw new StorageError(response.status, (value as unknown as { code: string }).code);
      const measured = response.headers.get('X-Test-D1-Metrics'); if (measured) metrics.push(JSON.parse(measured));
      if (first && loseFirstSeenCommit && isSeenCommit(command)) { lost.push(structuredClone(command)); if (lost.length === 1) throw new StorageError(503, 'DATA_UNAVAILABLE'); }
      return value;
    });
  }
  db = connect(true); second = connect(false);
  await db.collection('businesses').doc(business.id).set(business);
  await db.collection('businesses').doc(business.id).collection('appointments').doc(source.id).set(source);
  await acceptSyntheticConsent(db, actor.uid, business);
}, 30000);
afterEach(async () => { await mf?.dispose(); vi.restoreAllMocks(); });
const enable = () => saveReminderPreference(actor, business.id, { enabled: true, expectedRevision: 0 }, db);
function pauseCommit(match: (command: DataCommand) => boolean) {
  let release!: () => void, entered!: () => void;
  const waiting = new Promise<void>(resolve => { release = resolve; }), ready = new Promise<void>(resolve => { entered = resolve; });
  let blocked = false;
  intercept = async command => { if (!blocked && match(command)) { blocked = true; entered(); await waiting; } };
  return { ready, release };
}

// Integration characterization: domain RED preceded implementation; these
// exercise its real D1 protocol, contention, journal and measured query shape.
it('two D1 handles preserve one seen timestamp and never mutate the appointment', async () => {
  await enable();
  const [a, b] = await Promise.all([markAppointmentReminderSeen(actor, business.id, occurrence, db), markAppointmentReminderSeen(actor, business.id, occurrence, second)]);
  expect(a).toEqual(b); expect(a.reminder.seenAt).toBe(now);
  const ref = second.collection('businesses').doc(business.id);
  expect((await ref.collection('reminderReceipts').get()).size).toBe(1);
  expect((await ref.collection('appointments').doc(source.id).get()).data()).toEqual(source);
}, 30000);

it('rejects an in-flight old enable after another handle disables the preference', async () => {
  await enable();
  const gate = pauseCommit(command => command.action === 'commit' && command.writes.some(row => row.op !== 'delete' && row.path.includes('/reminderPreferences/') && row.data.enabled === true));
  const old = saveReminderPreference(actor, business.id, { enabled: true, expectedRevision: 1 }, db);
  await gate.ready; await saveReminderPreference(actor, business.id, { enabled: false, expectedRevision: 1 }, second); gate.release();
  await expect(old).rejects.toMatchObject({ status: 409 });
  expect((await readAppointmentReminders(actor, business.id, second)).preference).toMatchObject({ enabled: false, revision: 2, status: 'disabled' });
}, 30000);

it.each(['consent', 'cancel', 'reschedule'] as const)('revalidates a %s that commits while seen is in flight', async change => {
  await enable();
  const proposal = change === 'reschedule' ? await createBookingProposal(actor, business.id, rescheduleSelection, 'demo-reminder-race-change', second, undefined, { appointmentId: source.id, sourceRevision: 0 }) : null;
  const gate = pauseCommit(isSeenCommit);
  const mark = markAppointmentReminderSeen(actor, business.id, occurrence, db);
  await gate.ready;
  if (change === 'cancel') await cancelAppointment(actor, business.id, source.id, second);
  else if (change === 'reschedule') await confirmBookingProposal(actor, business.id, proposal!.id, rescheduleContact, second);
  else {
    const current = await readConsent(actor.uid, 'business_client', business, second);
    await updateConsent(actor, { scope: 'business_client', businessId: business.id, action: 'revoke', expectedRevision: current.revision, requestId: 'demo-reminder-race-withdraw' }, second);
  }
  gate.release(); await expect(mark).rejects.toMatchObject({ status: change === 'consent' ? 428 : 409 });
  expect((await second.collection('businesses').doc(business.id).collection('reminderReceipts').get()).size).toBe(0);
}, 30000);

it('repeats only an identical journaled seen commit after response loss', async () => {
  await enable(); loseFirstSeenCommit = true;
  const first = await markAppointmentReminderSeen(actor, business.id, occurrence, db);
  expect(lost).toHaveLength(2); expect(lost[1]).toEqual(lost[0]);
  vi.mocked(Date.now).mockReturnValue(now + 5000);
  expect(await markAppointmentReminderSeen(actor, business.id, occurrence, second)).toEqual(first);
  expect((await second.collection('businesses').doc(business.id).collection('reminderReceipts').doc(reminderReceiptId(actor.uid, business.id, source.id)).get()).data()?.seenAt).toBe(now);
}, 30000);

it('queries only the future window despite 1001 historical visits and measures real local D1 read cost', async () => {
  await enable(); metrics = []; await readAppointmentReminders(actor, business.id, db);
  const baseline = metrics.reduce((sum, value) => ({ rowsRead: sum.rowsRead + value.rowsRead, rowsWritten: sum.rowsWritten + value.rowsWritten, sqlStatements: sum.sqlStatements + value.sqlStatements }), { rowsRead: 0, rowsWritten: 0, sqlStatements: 0 });
  for (let start = 0; start < 1001; start += 100) await second.runTransaction(async tx => {
    for (let i = start; i < Math.min(start + 100, 1001); i++) tx.set(second.collection('businesses').doc(business.id).collection('appointments').doc(`demo-history-${i}`), { ...source, id: `demo-history-${i}`, startAt: now - 86400000, endAt: now - 84600000, reservedUntilAt: now - 84600000 });
  });
  metrics = [];
  const result = await readAppointmentReminders(actor, business.id, db);
  expect(result.reminders).toEqual([{ ...occurrence, availableAt: now, seenAt: null }]);
  const highHistory = metrics.reduce((sum, value) => ({ rowsRead: sum.rowsRead + value.rowsRead, rowsWritten: sum.rowsWritten + value.rowsWritten, sqlStatements: sum.sqlStatements + value.sqlStatements }), { rowsRead: 0, rowsWritten: 0, sqlStatements: 0 });
  expect(highHistory.rowsWritten).toBe(0); expect(baseline.rowsWritten).toBe(0);
  mkdirSync('qa/reports', { recursive: true });
  writeFileSync('qa/reports/in-app-reminders-d1-metrics.json', JSON.stringify({ checkedAt: new Date().toISOString(), localOnly: true, baseline, historyAppointments: 1001, highHistory, note: 'Measured batch statement metadata from the real production data handler in isolated local D1. This is not a production-cost or universal query-cost estimate.' }, null, 2) + '\n');
  console.info('Synthetic local D1 reminder GET metrics', JSON.stringify({ baseline, historyAppointments: 1001, highHistory }));
  expect(highHistory.rowsRead).toBeLessThanOrEqual(baseline.rowsRead + 10);
}, 30000);

it('index migration preserves existing documents and the global revision', async () => {
  await enable(); await markAppointmentReminderSeen(actor, business.id, occurrence, db);
  const documents = await localD1.prepare('SELECT path,data,blob FROM app_documents ORDER BY path').all();
  const revision = await localD1.prepare('SELECT revision FROM app_revision WHERE id=1').all();
  await localD1.exec(readFileSync('cloudflare/migrations/0002_appointment_reminder_window.sql', 'utf8').replace(/^--.*$/gm, '').replace(/\r?\n/g, ' '));
  expect((await localD1.prepare('SELECT path,data,blob FROM app_documents ORDER BY path').all()).results).toEqual(documents.results);
  expect((await localD1.prepare('SELECT revision FROM app_revision WHERE id=1').all()).results).toEqual(revision.results);
  expect((await readAppointmentReminders(actor, business.id, second)).reminders).toEqual([{ ...occurrence, availableAt: now, seenAt: now }]);
}, 30000);
