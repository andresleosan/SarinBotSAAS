import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { registerHooks } from 'node:module';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { executeDataCommand } from '../src/data.ts';
import { cleanupPlatformWhatsAppRetention, cleanupPlatformWhatsAppRetentionReport } from '../src/platform-whatsapp-retention.ts';
import {
  recordWorkerBoundaryError,
  recordWorkerCronSummary,
  getWorkerSignalWriteFailures,
} from '../src/operational-signals.ts';
import {
  OPERATIONAL_SIGNALS_WORKER_DOC_PATH,
  evaluateOperationalSignals,
  operationalSignalsWorkerSchema,
} from '../../shared/operational-signals.ts';
import { event, set, seed } from './platform-whatsapp-fixture.mjs';

const require = createRequire(import.meta.url);
const wranglerRequire = createRequire(require.resolve('wrangler/package.json'));
const { build } = wranglerRequire('esbuild');
const { Miniflare, convertV4MiniflareOptions } = wranglerRequire('miniflare');

const platform = 'data:text/javascript,' + encodeURIComponent(
  'export class DurableObject { constructor(ctx, env) { this.ctx = ctx; this.env = env; } } export class WorkerEntrypoint extends DurableObject {}',
);
const hooks = registerHooks({
  resolve(specifier, options, next) {
    if (specifier === 'cloudflare:workers') return { url: platform, shortCircuit: true };
    try {
      return next(specifier, options);
    } catch (error) {
      if (specifier.startsWith('.') && options.parentURL?.includes('@cloudflare')) return next(`${specifier}.js`, options);
      throw error;
    }
  },
});
const { default: worker } = await import('../src/index.ts');
const { handlePublicIdentityRequest, handleIdentityOutbound } = await import('../src/identity.ts');
hooks.deregister();

const CANARIES = ['Bearer token-secreto', 'sk-canary-999', '+573001234567', 'cliente@demo.test', 'private-body-text', '../../etc/passwd'];

async function d1Fixture(context) {
  const mf = new Miniflare(convertV4MiniflareOptions({
    modules: true,
    script: 'export default {fetch(){return new Response("synthetic")}}',
    compatibilityDate: '2026-10-13',
    d1Databases: { SARIN_DB: 'sarin-ops-signals-test' },
  }));
  context.after(() => mf.dispose());
  const db = await mf.getD1Database('SARIN_DB');
  const directory = new URL('../migrations/', import.meta.url);
  for (const migration of readdirSync(directory).filter(name => /^\d+.*\.sql$/.test(name)).sort()) {
    const schema = readFileSync(new URL(migration, directory), 'utf8');
    await db.exec(schema.replace(/^--.*$/gm, '').replace(/\r?\n/g, ' '));
  }
  return {
    SARIN_DB: db,
    SARIN_FILES: new Proxy({}, { get() { throw new Error('Signals must not touch R2'); } }),
  };
}

async function readWorkerDoc(env) {
  const res = await executeDataCommand({ action: 'read', read: { kind: 'document', path: OPERATIONAL_SIGNALS_WORKER_DOC_PATH } }, env);
  assert.equal('documents' in res, true);
  const data = res.documents[0]?.data;
  if (data !== undefined) operationalSignalsWorkerSchema.parse(data);
  return data;
}

function assertNoCanaries(value) {
  const serialized = JSON.stringify(value);
  for (const canary of CANARIES) {
    assert.equal(serialized.includes(canary), false, `Found leaked canary: ${canary}`);
  }
}

function createWaitUntilCollector() {
  const pending = [];
  return {
    ctx: { waitUntil(promise) { pending.push(Promise.resolve(promise)); } },
    async flush() { await Promise.all(pending.splice(0)); },
    get count() { return pending.length; },
  };
}

test('cleanupPlatformWhatsAppRetentionReport adds invalidRecords/failedPhases while cleanupPlatformWhatsAppRetention keeps exact 3-key shape', async context => {
  const env = await d1Fixture(context);
  const now = 3_000_000_000;
  const invalid = event(now - 86_400_001, { content: { version: 1, iv: 'corrupt', tag: 'bad', data: 'bad' } });
  await seed(env, [set('platformWhatsAppEvents/invalid', invalid)]);
  const warnings = [];
  context.mock.method(console, 'warn', value => warnings.push(value));

  const legacy = await cleanupPlatformWhatsAppRetention(env, { now });
  assert.deepEqual(Object.keys(legacy).sort(), ['clearedBodies', 'deletedMetadata', 'morePending']);
  assert.deepEqual(legacy, { clearedBodies: 0, deletedMetadata: 0, morePending: true });

  const report = await cleanupPlatformWhatsAppRetentionReport(env, { now });
  assert.deepEqual(report, { clearedBodies: 0, deletedMetadata: 0, morePending: true, invalidRecords: 1, failedPhases: 0 });
  assert.equal(warnings.length, 2);

  const failingDb = env.SARIN_DB;
  let calls = 0;
  const brokenEnv = {
    ...env,
    SARIN_DB: {
      prepare: failingDb.prepare.bind(failingDb),
      batch: async statements => {
        if (++calls <= 3) throw new Error('synthetic retention phase error');
        return failingDb.batch(statements);
      },
    },
  };
  const failedReport = await cleanupPlatformWhatsAppRetentionReport(brokenEnv, { now });
  assert.equal(failedReport.failedPhases, 1);
  assert.equal(failedReport.morePending, true);
});

test('identity.ts wrappers emit sanitized identity_wif errors via waitUntil on getJwks and mintToken failures without leaking secrets', async context => {
  const env = await d1Fixture(context);
  const wait = createWaitUntilCollector();
  const leakingMessage = 'Bearer token-secreto sk-canary-999 +573001234567 cliente@demo.test';

  env.SARIN_IDENTITY = {
    getByName: () => ({
      async getJwks() { throw new Error(leakingMessage); },
      async mintToken() { throw new Error('La identidad de Google no está configurada.'); },
    }),
  };
  env.SARIN_APP = { idFromName: () => ({ toString: () => 'singleton-container-id' }) };

  const jwksResponse = await handlePublicIdentityRequest(new Request('https://sarinbotsaas.pages.dev/.well-known/jwks.json'), env, wait.ctx);
  assert.equal(jwksResponse.status, 503);
  assertNoCanaries(await jwksResponse.text());
  assert.equal(wait.count, 1);
  await wait.flush();

  const mintResponse = await handleIdentityOutbound(
    new Request('http://sarin-google.internal/token'),
    env,
    { containerId: 'singleton-container-id', className: 'SarinApp' },
  );
  assert.equal(mintResponse.status, 503);

  const doc = await readWorkerDoc(env);
  assert.ok(doc);
  assert.equal(doc.identityWifFailures15m, 2);
  assert.equal(doc.boundaryStreaks.identityWifConsecutive, 2);
  assert.equal(doc.recentErrors[0].boundary, 'identity_wif');
  assert.equal(doc.recentErrors[0].errorClass, 'CONFIG_INVALID');
  assert.equal(doc.recentErrors[1].boundary, 'identity_wif');
  assert.equal(doc.recentErrors[1].errorClass, 'TRANSPORT_UNAVAILABLE');
  assertNoCanaries(doc);
});

test('index.ts fetch emits container_proxy errors via waitUntil for real proxy failures, ignores maintenance 503, and resets streak on success', async context => {
  const env = await d1Fixture(context);
  const wait = createWaitUntilCollector();
  env.SARIN_IDENTITY = { getByName: () => ({ async getJwks() { return { keys: [] }; } }) };

  // Deliberate maintenance 503 must NOT emit container_proxy error.
  const maintEnv = { ...env, SARIN_MAINTENANCE: 'true', SARIN_APP: { idFromName: () => 'id', get: () => { throw new Error('must not acquire'); } } };
  const maintRes = await worker.fetch(new Request('https://sarinbotsaas.pages.dev/'), maintEnv, wait.ctx);
  assert.equal(maintRes.status, 503);
  assert.equal(wait.count, 0);
  assert.equal(await readWorkerDoc(env), undefined);

  // Real proxy throw -> TRANSPORT_UNAVAILABLE
  const failEnv = {
    ...env,
    SARIN_APP: {
      idFromName: name => name,
      get: () => ({ fetch: async () => { throw new Error('sk-canary-999 Bearer token-secreto private-body-text'); } }),
    },
  };
  const errRes1 = await worker.fetch(new Request('https://sarinbotsaas.pages.dev/api/sarin/chat'), failEnv, wait.ctx);
  assert.equal(errRes1.status, 503);
  assert.equal(wait.count, 1);
  await wait.flush();

  // Timeout error -> TIMEOUT
  const timeoutEnv = {
    ...env,
    SARIN_APP: {
      idFromName: name => name,
      get: () => ({ fetch: async () => { const e = new Error('timed out cliente@demo.test'); e.name = 'TimeoutError'; throw e; } }),
    },
  };
  const errRes2 = await worker.fetch(new Request('https://sarinbotsaas.pages.dev/api/sarin/chat'), timeoutEnv, wait.ctx);
  assert.equal(errRes2.status, 503);
  await wait.flush();

  // Non-JSON 502 from container proxy -> UPSTREAM_5XX
  const badGatewayEnv = {
    ...env,
    SARIN_APP: {
      idFromName: name => name,
      get: () => ({ fetch: async () => new Response('stack trace +573001234567', { status: 502 }) }),
    },
  };
  const errRes3 = await worker.fetch(new Request('https://sarinbotsaas.pages.dev/api/sarin/chat'), badGatewayEnv, wait.ctx);
  assert.equal(errRes3.status, 503);
  await wait.flush();

  let doc = await readWorkerDoc(env);
  assert.equal(doc.containerProxyFailures15m, 3);
  assert.equal(doc.boundaryStreaks.containerProxyConsecutive, 3);
  assert.deepEqual(doc.recentErrors.slice(0, 3).map(e => [e.boundary, e.errorClass, e.httpStatus]), [
    ['container_proxy', 'UPSTREAM_5XX', 502],
    ['container_proxy', 'TIMEOUT', null],
    ['container_proxy', 'TRANSPORT_UNAVAILABLE', null],
  ]);
  assertNoCanaries(doc);

  // Success resets consecutive streak while preserving 15m failure counter.
  const okEnv = {
    ...env,
    SARIN_APP: {
      idFromName: name => name,
      get: () => ({ fetch: async () => Response.json({ ok: true }) }),
    },
  };
  const okRes = await worker.fetch(new Request('https://sarinbotsaas.pages.dev/api/session'), okEnv, wait.ctx);
  assert.equal(okRes.status, 200);
  await wait.flush();

  doc = await readWorkerDoc(env);
  assert.equal(doc.containerProxyFailures15m, 3);
  assert.equal(doc.boundaryStreaks.containerProxyConsecutive, 0);
  assert.equal(doc.boundaryStreaks.containerProxyLastFailureAt, null);
});

test('scheduled isolates failures of each of the 5 Cron subtasks, runs remaining subtasks, and persists summary via commit', async context => {
  const subtaskModules = [
    { key: 'recovery_backup', module: './recovery-backup.ts', exportName: 'scheduleRecoveryBackup' },
    { key: 'response_quota_recovery', module: './response-quota-recovery.ts', exportName: 'recoverWorkerResponseQuota' },
    { key: 'admin_payment_retention', module: './admin-payment-retention.ts', exportName: 'cleanupAdminPaymentRetention' },
    { key: 'platform_support_retention', module: './platform-support-retention.ts', exportName: 'cleanupPlatformSupportRetention' },
    { key: 'platform_whatsapp_retention', module: './platform-whatsapp-retention.ts', exportName: 'cleanupPlatformWhatsAppRetentionReport' },
  ];

  for (const target of subtaskModules) {
    const env = await d1Fixture(context);
    const result = await build({
      entryPoints: [fileURLToPath(new URL('../src/index.ts', import.meta.url))],
      bundle: true,
      write: false,
      format: 'esm',
      platform: 'node',
      plugins: [{
        name: `fail-${target.key}`,
        setup(b) {
          b.onResolve({ filter: /^(\.\/|@cloudflare\/containers|cloudflare:workers)/ }, args => {
            if (args.path === 'cloudflare:workers') return { path: 'cloudflare:workers', namespace: 'stub' };
            if (args.path === '@cloudflare/containers') return { path: '@cloudflare/containers', namespace: 'stub' };
            if (args.importer.endsWith('index.ts') && [
              './recovery-backup.ts',
              './response-quota-recovery.ts',
              './admin-payment-retention.ts',
              './platform-support-retention.ts',
              './platform-whatsapp-retention.ts',
              './platform-whatsapp-wake.ts',
            ].includes(args.path)) {
              return { path: args.path, namespace: 'stub' };
            }
            return undefined;
          });
          b.onLoad({ filter: /.*/, namespace: 'stub' }, args => {
            const failThis = args.path === target.module;
            const map = {
              'cloudflare:workers': 'export class DurableObject {}; export class WorkerEntrypoint {};',
              '@cloudflare/containers': 'export class Container {}; export class ContainerProxy {}; export const getContainer=()=>({startAndWaitForPorts:async()=>{}, fetch:async()=>new Response("ok")});',
              './platform-whatsapp-wake.ts': 'export const hasPotentialPlatformWork=async()=>false;',
              './recovery-backup.ts': `export const scheduleRecoveryBackup=${failThis ? 'async()=>{throw new Error("Bearer token-secreto")}' : 'async()=>{globalThis.__ran.push("recovery_backup");return {phase:"disabled",health:"missing",lastRecoverableAt:null,ages:{},bytes:0,durationMs:0,failureCode:null,gaps:{weeks:[],months:[]}}}'}; export const sourceObjectsPinned=async()=>false; export const handleRecoveryOutbound=()=>new Response("ok");`,
              './response-quota-recovery.ts': `export const recoverWorkerResponseQuota=${failThis ? 'async()=>{throw new Error("sk-canary-999")}' : 'async()=>{globalThis.__ran.push("response_quota_recovery");return {visited:0,settled:0,needsReview:0,morePending:false,protocolReady:true}}'};`,
              './admin-payment-retention.ts': `export const cleanupAdminPaymentRetention=${failThis ? 'async()=>{throw new Error("+573001234567")}' : 'async()=>{globalThis.__ran.push("admin_payment_retention");return {clearedBodies:0,deletedMetadata:0,morePending:false,invalidRecords:0,failedPhases:0}}'};`,
              './platform-support-retention.ts': `export const cleanupPlatformSupportRetention=${failThis ? 'async()=>{throw new Error("cliente@demo.test")}' : 'async()=>{globalThis.__ran.push("platform_support_retention");return {clearedBodies:0,deletedMetadata:0,invalidRecords:0,failedPhases:0,morePending:false}}'};`,
              './platform-whatsapp-retention.ts': `export const cleanupPlatformWhatsAppRetention=async()=>({clearedBodies:0,deletedMetadata:0,morePending:false}); export const cleanupPlatformWhatsAppRetentionReport=${failThis ? 'async()=>{throw new Error("private-body-text")}' : 'async()=>{globalThis.__ran.push("platform_whatsapp_retention");return {clearedBodies:0,deletedMetadata:0,morePending:false,invalidRecords:0,failedPhases:0}}'};`,
            };
            return { contents: map[args.path], loader: 'js' };
          });
        },
      }],
    });

    const oldErr = console.error;
    const oldInfo = console.info;
    console.error = () => {};
    console.info = () => {};
    globalThis.__ran = [];
    try {
      const mod = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}#subtask=${target.key}`);
      const retentionFlag = target.key === 'platform_whatsapp_retention' ? 'true' : 'false';
      await mod.default.scheduled({}, { ...env, SARIN_MAINTENANCE: 'false', PLATFORM_WHATSAPP_RETENTION_ENABLED: retentionFlag });

      const expectedOther = target.key === 'platform_whatsapp_retention'
        ? ['recovery_backup', 'response_quota_recovery', 'admin_payment_retention']
        : ['recovery_backup', 'response_quota_recovery', 'admin_payment_retention', 'platform_support_retention'].filter(k => k !== target.key);
      assert.deepEqual(globalThis.__ran, expectedOther, `Remaining subtasks must run when ${target.key} fails`);

      const doc = await readWorkerDoc(env);
      assert.ok(doc);
      assert.equal(doc.subtasks[target.key].failed, true, target.key);
      assert.equal(doc.cronConsecutiveFailures, 1);
      assert.equal(doc.recentErrors[0].boundary, target.key);
      assert.equal(doc.recentErrors[0].errorClass, 'CRON_FAILED');
      assertNoCanaries(doc);
    } finally {
      console.error = oldErr;
      console.info = oldInfo;
      delete globalThis.__ran;
    }
  }
});

test('scheduled tracks >=3 backlog cycles, clears on recovery, skips cleanly in maintenance, and respects SARIN_OPERATIONAL_ALERTS_ENABLED', async context => {
  const env = await d1Fixture(context);
  const now = 1_800_000_000_000;
  let internalEvalCalls = 0;
  const appEnv = {
    ...env,
    SARIN_APP: {
      idFromName: name => name,
      get: () => ({
        async startAndWaitForPorts() { assert.fail('must not wake'); },
        async fetch(request) {
          internalEvalCalls++;
          assert.equal(new URL(request.url).pathname, '/api/internal/operational-signals');
          assert.equal(request.headers.get('x-sarin-ops-evaluate'), 'true');
          return new Response(null, { status: 204 });
        },
      }),
    },
  };

  // Seed 3 consecutive backlog cycles directly via recordWorkerCronSummary + real D1.
  for (let cycle = 0; cycle < 3; cycle++) {
    await recordWorkerCronSummary(appEnv, {
      maintenanceSkipped: false,
      backup: { phase: 'disabled', health: 'missing', lastRecoverableAt: null, failureCode: null, gaps: { weeks: [], months: [] } },
      subtasks: {
        recovery_backup: { ran: true, failed: false, morePending: false, invalidRecords: 0, failedPhases: 0 },
        response_quota_recovery: { ran: true, failed: false, morePending: true, invalidRecords: 0, failedPhases: 0 },
        admin_payment_retention: { ran: true, failed: false, morePending: false, invalidRecords: 0, failedPhases: 0 },
        platform_support_retention: { ran: true, failed: false, morePending: false, invalidRecords: 0, failedPhases: 0 },
        platform_whatsapp_retention: { ran: false, failed: false, morePending: false, invalidRecords: 0, failedPhases: 0 },
      },
      errors: [],
    }, now + cycle * 300_000);
  }
  let doc = await readWorkerDoc(appEnv);
  assert.equal(doc.backlogCycles, 3);
  const evalWarn = evaluateOperationalSignals({
    now: now + 600_000,
    worker: { available: true, data: doc },
  });
  assert.equal(evalWarn.families.cron_and_retention.severity, 'warning');
  assert.equal(evalWarn.families.cron_and_retention.code, 'RETENTION_BACKLOG_WARNING');

  // Maintenance run suppresses alert evaluation even if flag is true and sets maintenanceSkipped=true.
  await worker.scheduled({}, { ...appEnv, SARIN_MAINTENANCE: 'true', SARIN_OPERATIONAL_ALERTS_ENABLED: 'true' });
  assert.equal(internalEvalCalls, 0);
  doc = await readWorkerDoc(appEnv);
  assert.equal(doc.maintenanceSkipped, true);

  // Normal run with SARIN_OPERATIONAL_ALERTS_ENABLED="false" clears backlog and does NOT call container.
  await worker.scheduled({}, { ...appEnv, SARIN_MAINTENANCE: 'false', SARIN_OPERATIONAL_ALERTS_ENABLED: 'false' });
  assert.equal(internalEvalCalls, 0);
  doc = await readWorkerDoc(appEnv);
  assert.equal(doc.maintenanceSkipped, false);
  assert.equal(doc.backlogCycles, 0);

  // Normal run with SARIN_OPERATIONAL_ALERTS_ENABLED="true" triggers internal evaluation once.
  await worker.scheduled({}, { ...appEnv, SARIN_MAINTENANCE: 'false', SARIN_OPERATIONAL_ALERTS_ENABLED: 'true' });
  assert.equal(internalEvalCalls, 1);

  // Recovery restricted never calls internal evaluation even if flag is true.
  await worker.scheduled({}, { ...appEnv, SARIN_RECOVERY_MODE: 'recovery', SARIN_OPERATIONAL_ALERTS_ENABLED: 'true' });
  assert.equal(internalEvalCalls, 1);
});

test('operational-signals degrades safely on 409 CAS conflict and 503 D1 failure without throwing, and flushes signalWriteFailures', async context => {
  const env = await d1Fixture(context);
  const db = env.SARIN_DB;
  let commitAttempts = 0;

  // 1) Simulate single 409 CAS conflict on first commit attempt -> retries and succeeds.
  const casEnv = {
    ...env,
    SARIN_DB: {
      prepare: db.prepare.bind(db),
      batch: async statements => {
        commitAttempts++;
        if (commitAttempts === 2) {
          // Concurrent bump of revision between read and commit forces 409 DATA_CONFLICT.
          await executeDataCommand({
            action: 'commit',
            expectedRevision: 0,
            requestId: crypto.randomUUID(),
            writes: [{ op: 'set', path: 'businesses/concurrent', data: { id: 'concurrent' } }],
          }, env);
        }
        return db.batch(statements);
      },
    },
  };
  const casResult = await recordWorkerBoundaryError(casEnv, {
    boundary: 'container_proxy',
    errorClass: 'TRANSPORT_UNAVAILABLE',
    httpStatus: null,
    providerCode: 'Bearer token-secreto',
  }, 1_800_000_000_000);
  assert.equal(casResult.ok, true);

  let doc = await readWorkerDoc(env);
  assert.equal(doc.containerProxyFailures15m, 1);
  assert.equal(doc.recentErrors[0].providerCode, null);
  assertNoCanaries(doc);

  // 2) Simulate persistent D1 failure (503) -> never throws, increments local signalWriteFailures.
  const beforeFailures = getWorkerSignalWriteFailures();
  const downEnv = {
    ...env,
    SARIN_DB: {
      prepare: () => { throw new Error('D1 down'); },
      batch: async () => { throw new Error('D1 down'); },
    },
  };
  const failedWrite = await recordWorkerBoundaryError(downEnv, {
    boundary: 'identity_wif',
    errorClass: 'TRANSPORT_UNAVAILABLE',
    httpStatus: null,
    providerCode: '../../etc/passwd',
  }, 1_800_000_010_000);
  assert.equal(failedWrite.ok, false);
  assert.equal(getWorkerSignalWriteFailures(), beforeFailures + 1);

  // 3) Next successful write flushes pending signalWriteFailures into persisted document.
  const recoveredWrite = await recordWorkerBoundaryError(env, {
    boundary: 'container_proxy',
    errorClass: 'UPSTREAM_5XX',
    httpStatus: 503,
    providerCode: 'OK_CODE',
  }, 1_800_000_020_000);
  assert.equal(recoveredWrite.ok, true);
  doc = await readWorkerDoc(env);
  assert.ok(doc.signalWriteFailures >= 1);
  assert.equal(doc.recentErrors[0].providerCode, 'OK_CODE');

  // 4) recoveryRestricted skips commits safely.
  const restricted = await recordWorkerBoundaryError({ ...env, SARIN_RECOVERY_MODE: 'recovery' }, {
    boundary: 'container_proxy',
    errorClass: 'TRANSPORT_UNAVAILABLE',
    httpStatus: null,
  }, 1_800_000_030_000);
  assert.equal(restricted.ok, false);
});
