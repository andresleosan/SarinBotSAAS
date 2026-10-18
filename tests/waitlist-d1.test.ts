import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createCloudflareDatabase, StorageError } from '@/lib/storage/database';
import type { Database } from '@/lib/storage/types';
import type { DataCommand, DataReadResult, DataCommitResult } from '../shared/data-protocol';
import { joinWaitlist, readWaitlist, cancelWaitlist } from '@/lib/server/waitlist';
import { readConsent, updateConsent } from '@/lib/server/consent';
import { subjectAdmin } from './represented-booking-contract';
import { waitlistFixture, waitlistNow } from './waitlist-contract';

type Metrics = { rowsRead: number; rowsWritten: number; sqlStatements: number };
let mf: { dispose(): Promise<void>; dispatchFetch(url: string, options: object): Promise<Response> };
let db: Database, second: Database, f: Awaited<ReturnType<typeof waitlistFixture>>;
let metrics: Metrics[], intercept: ((command: DataCommand) => Promise<void>) | null;
let queryMetrics: { read: unknown; metrics: Metrics }[];
let loseCommit: boolean, lost: DataCommand[], clock: number;
const waitlistCommit = (command: DataCommand) => command.action === 'commit' && command.writes.some(row => row.path.includes('/waitlistRequests/'));
beforeEach(async () => {
  clock = waitlistNow; vi.spyOn(Date, 'now').mockImplementation(() => clock); vi.stubEnv('SUPERADMIN_UID', subjectAdmin.uid);
  metrics = []; queryMetrics = []; intercept = null; loseCommit = false; lost = [];
  const require = createRequire(new URL('../cloudflare/package.json', import.meta.url)), wrangler = createRequire(require.resolve('wrangler/package.json'));
  const { build } = wrangler('esbuild'), { Miniflare, convertV4MiniflareOptions } = wrangler('miniflare');
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
  mf = new Miniflare(convertV4MiniflareOptions({ modules: true, script: bundle.outputFiles[0].text, compatibilityDate: '2026-10-13', d1Databases: { SARIN_DB: 'demo-waitlist-data' }, r2Buckets: { SARIN_FILES: 'demo-waitlist-files' } }));
  const localD1 = await (mf as unknown as { getD1Database(name: string): Promise<{ exec(sql: string): Promise<unknown> }> }).getD1Database('SARIN_DB');
  for (const migration of readdirSync('cloudflare/migrations').filter(name => /^\d+.*\.sql$/.test(name)).sort()) await localD1.exec(readFileSync(`cloudflare/migrations/${migration}`, 'utf8').replace(/^--.*$/gm, '').replace(/\r?\n/g, ' '));
  const connect = (first: boolean) => createCloudflareDatabase(async command => {
    if (first && intercept) await intercept(command);
    const response = await mf.dispatchFetch('http://demo-waitlist.test/execute', { method: 'POST', body: JSON.stringify(command) });
    const value = await response.json() as DataReadResult | DataCommitResult;
    if (!response.ok) throw new StorageError(response.status, (value as unknown as { code: string }).code);
    const measured = response.headers.get('X-Test-D1-Metrics'); if (measured) { const value = JSON.parse(measured); metrics.push(value); if (command.action === 'read' && command.read.kind === 'query') queryMetrics.push({ read: command.read, metrics: value }); }
    if (first && loseCommit && waitlistCommit(command)) { lost.push(structuredClone(command)); if (lost.length === 1) throw new StorageError(503, 'DATA_UNAVAILABLE'); }
    return value;
  });
  db = connect(true); second = connect(false); f = await waitlistFixture(db);
}, 30000);
afterEach(async () => { await mf?.dispose(); vi.restoreAllMocks(); vi.unstubAllEnvs(); });
function pauseCommit() {
  let release!: () => void, entered!: () => void, blocked = false;
  const waiting = new Promise<void>(resolve => { release = resolve; }), ready = new Promise<void>(resolve => { entered = resolve; });
  intercept = async command => { if (!blocked && waitlistCommit(command)) { blocked = true; entered(); await waiting; } };
  return { ready, release };
}
const sumMetrics = () => metrics.reduce((sum, value) => ({ rowsRead: sum.rowsRead + value.rowsRead, rowsWritten: sum.rowsWritten + value.rowsWritten, sqlStatements: sum.sqlStatements + value.sqlStatements }), { rowsRead: 0, rowsWritten: 0, sqlStatements: 0 });

// Integration verification after the domain RED: real production D1 protocol,
// optimistic conflicts, journal replay, bounds and measured SQL work.
it('keeps GET cost independent of 1001 old appointments without writing or scanning waitlist history', async () => {
  await joinWaitlist(f.actor, f.business.id, f.input, db);
  metrics = []; expect((await readWaitlist(f.actor, f.business.id, db)).request?.status).toBe('waiting'); const baseline = sumMetrics();
  for (let start = 0; start < 1001; start += 100) await second.runTransaction(async tx => {
    for (let i = start; i < Math.min(start + 100, 1001); i++) tx.set(second.collection('businesses').doc(f.business.id).collection('appointments').doc(`history-${i}`), { id: `history-${i}`, tenantId: f.business.id, client: { uid: f.actor.uid }, type: 'appointment', status: 'confirmed', dateKey: '2029-01-01', resourceId: 'one', startAt: Date.parse('2029-01-01T14:00:00Z'), endAt: Date.parse('2029-01-01T14:30:00Z'), startTimeStr: '09:00', endTimeStr: '09:30' });
  });
  metrics = []; queryMetrics = []; expect((await readWaitlist(f.actor, f.business.id, db)).request?.status).toBe('waiting'); const highHistory = sumMetrics();
  mkdirSync('qa/reports', { recursive: true }); writeFileSync('qa/reports/in-app-waitlist-d1-metrics.json', JSON.stringify({ checkedAt: new Date().toISOString(), localOnly: true, baseline, historyAppointments: 1001, highHistory, queryMetrics, note: 'Measured production-handler batch metadata in isolated local D1; not a production cost estimate.' }, null, 2) + '\n');
  expect(baseline.rowsWritten).toBe(0); expect(highHistory.rowsWritten).toBe(0); expect(highHistory.rowsRead).toBeLessThanOrEqual(baseline.rowsRead + 10);
}, 30000);

it('never truncates more than 1000 matching day records into a trustworthy availability result', async () => {
  for (let start = 0; start < 1001; start += 100) await second.runTransaction(async tx => {
    for (let i = start; i < Math.min(start + 100, 1001); i++) tx.set(second.collection('businesses').doc(f.business.id).collection('appointments').doc(`large-day-${i}`), { tenantId: f.business.id, dateKey: '2030-01-07', resourceId: 'one', status: 'confirmed', type: 'manual_block', startTimeStr: '09:00', endTimeStr: '10:00' });
  });
  await expect(joinWaitlist(f.actor, f.business.id, f.input, db)).rejects.toMatchObject({ status: 413 });
  expect((await readWaitlist(f.actor, f.business.id, db)).request).toBeNull();
}, 30000);

it.each(['availability', 'consent'] as const)('revalidates %s that changes before the join commit', async change => {
  const gate = pauseCommit(), pending = joinWaitlist(f.actor, f.business.id, f.input, db);
  await gate.ready;
  if (change === 'availability') await second.collection('businesses').doc(f.business.id).collection('appointments').doc('block-one').delete();
  else {
    const current = await readConsent(f.actor.uid, 'business_client', f.business, second);
    await updateConsent(f.actor, { scope: 'business_client', businessId: f.business.id, action: 'revoke', requestId: 'waitlist-race-withdraw', expectedRevision: current.revision }, second);
  }
  gate.release(); await expect(pending).rejects.toMatchObject({ status: change === 'availability' ? 409 : 428 });
  expect((await readWaitlist(f.actor, f.business.id, second)).request).toBeNull();
}, 30000);

it('serializes competing joins and rejects a delayed cancellation after a replacement', async () => {
  const outcomes = await Promise.allSettled([joinWaitlist(f.actor, f.business.id, f.input, db), joinWaitlist(f.actor, f.business.id, { ...f.input, requestId: 'waitlist-race-second' }, second)]);
  expect(outcomes.filter(item => item.status === 'fulfilled')).toHaveLength(1);
  const current = await readWaitlist(f.actor, f.business.id, second), cancel = { expectedRevision: 1, requestId: 'waitlist-race-cancel', entryId: current.request!.id };
  const gate = pauseCommit(), delayed = cancelWaitlist(f.actor, f.business.id, cancel, db);
  await gate.ready;
  await cancelWaitlist(f.actor, f.business.id, { ...cancel, requestId: 'waitlist-newer-cancel' }, second);
  await joinWaitlist(f.actor, f.business.id, { ...f.input, requestId: 'waitlist-replacement', expectedRevision: 2 }, second);
  gate.release(); await expect(delayed).rejects.toMatchObject({ status: 409 });
  expect((await readWaitlist(f.actor, f.business.id, second))).toMatchObject({ revision: 3, request: { status: 'waiting' } });
}, 30000);

it('retries only the identical journaled join commit after response loss', async () => {
  loseCommit = true; const joined = await joinWaitlist(f.actor, f.business.id, f.input, db);
  expect(lost).toHaveLength(2); expect(lost[1]).toEqual(lost[0]);
  expect(await joinWaitlist(f.actor, f.business.id, f.input, second)).toEqual(joined);
  expect((await second.collection('businesses').doc(f.business.id).collection('waitlistRequests').get()).size).toBe(1);
}, 30000);

it('uses a fresh clock when an availability read crosses the requested day end', async () => {
  intercept = async command => {
    if (command.action === 'read' && command.read.kind === 'query' && command.read.filters.some(filter => filter.field === 'dateKey')) clock = Date.parse('2030-01-08T05:00:00Z');
  };
  await expect(joinWaitlist(f.actor, f.business.id, f.input, db)).rejects.toMatchObject({ status: 400 });
  expect((await readWaitlist(f.actor, f.business.id, second)).request).toBeNull();
  intercept = null; clock = waitlistNow; await joinWaitlist(f.actor, f.business.id, f.input, second);
  intercept = async command => { if (command.action === 'read' && command.read.kind === 'query' && command.read.filters.some(filter => filter.field === 'dateKey')) clock = Date.parse('2030-01-08T05:00:00Z'); };
  expect((await readWaitlist(f.actor, f.business.id, db)).request).toMatchObject({ status: 'expired', checkedAt: null });
}, 30000);
