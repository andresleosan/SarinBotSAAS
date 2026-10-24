import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { resolve, join, posix, win32 } from 'node:path';
import { runRelease, validateSnapshot, releaseConfig, boundedJson, verifyImage, workerReady, pagesReady, commandDiagnostic, pagesConfigFingerprint } from '../scripts/release-core.mjs';

const sha = 'a'.repeat(40);
const account = 'b'.repeat(32);
const digest = `sha256:${'c'.repeat(64)}`;
const config = JSON.parse(readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));
function snapshot() {
  return {
    deployment: { id: 'old', versions: [{ version_id: 'v1', percentage: 100 }] },
    version: { id: 'v1', annotations: { 'workers/tag': 'prior' } },
    settings: { compatibility_date: config.compatibility_date, compatibility_flags: config.compatibility_flags, bindings: [
      ...Object.entries(config.vars).map(([name, text]) => ({ name, type: 'plain_text', text })),
      { name: 'PRIVATE_RUNTIME', type: 'plain_text', text: 'private-never-log' },
      { name: 'PRIVATE_KEY', type: 'secret_text' },
      { name: 'AI', type: 'ai' },
      { name: 'SARIN_DB', type: 'd1', id: config.d1_databases[0].database_id },
      { name: 'SARIN_FILES', type: 'r2_bucket', bucket_name: config.r2_buckets[0].bucket_name },
      { name: 'SARIN_APP', type: 'durable_object_namespace', class_name: 'SarinApp' },
      { name: 'SARIN_IDENTITY', type: 'durable_object_namespace', class_name: 'SarinIdentity' },
    ] },
    schedules: [{ cron: '*/5 * * * *' }], subdomain: { enabled: false, previews_enabled: false },
    app: { id: 'a032778c-ce3d-4673-b65a-4bf13fa3e02c', account_id: account, name: 'sarin-bot-app-sarinapp', version: 30, max_instances: 1, scheduling_policy: 'default', constraints: { tiers: [1, 2] }, rollout_active_grace_period: 0, configuration: { image: `registry.cloudflare.com/${account}/sarin-bot-app@${digest}`, vcpu: 0.25, memory_mib: 1024, disk: { size_mb: 4000 } } },
    instances: { instances: [{ id: 'one', state: 'running', version: 30 }], result_info: { next_page_token: null } },
    pages: { name: 'sarinbotsaas', production_branch: 'main', deployment_configs: { production: { env_vars: { SARIN_PUBLIC_ORIGIN: { type: 'plain_text', value: 'https://sarinbotsaas.pages.dev' } }, services: { SARIN_APP_HOST: { service: 'sarin-bot-app', environment: 'production' } } } } },
  };
}
function adapters() {
  const events = [];
  let deployed = false;
  const current = snapshot();
  return { events, current,
    exactSource: async () => { events.push('source'); return { sha, tree: 'd'.repeat(40) }; },
    mainSha: async () => { events.push('main'); return sha; },
    snapshot: async () => { events.push('snapshot'); return structuredClone(current); },
    buildAndPush: async () => { events.push('image'); return { reference: `registry.cloudflare.com/${account}/sarin-bot-app@${digest}`, digest }; },
    deployWorker: async () => { events.push('worker'); deployed = true; },
    waitForWorker: async () => { events.push('worker-ready'); assert.equal(deployed, true); return { workerVersion: 'v2', containerVersion: 31 }; },
    deployPages: async () => { events.push('pages'); },
    waitForPages: async () => { events.push('pages-ready'); return { pagesDeployment: 'page2' }; },
  };
}
test('release requires exact main and validates both preflights before Worker, then waits before Pages', async () => {
  const deps = adapters();
  const result = await runRelease({ sha, account, config }, deps);
  assert.deepEqual(deps.events, ['source', 'main', 'snapshot', 'image', 'main', 'snapshot', 'worker', 'worker-ready', 'pages', 'pages-ready']);
  assert.equal(result.sha, sha);
  assert.equal(JSON.stringify(result).includes('private-never-log'), false);
});
test('stale source stops without image or deployment; a new main during build stops Worker', async () => {
  for (const staleRead of [1, 2]) {
    const deps = adapters(); let reads = 0;
    deps.mainSha = async () => ++reads === staleRead ? 'e'.repeat(40) : sha;
    await assert.rejects(runRelease({ sha, account, config }, deps), /STALE_MAIN/);
    assert.equal(deps.events.includes('worker'), false);
    if (staleRead === 1) assert.equal(deps.events.includes('image'), false);
  }
});
test('runtime flag drift during build prevents deployment without exposing its value', async () => {
  const deps = adapters(); const read = deps.snapshot; let reads = 0;
  deps.snapshot = async () => { const value = await read(); if (++reads === 2) value.settings.bindings.find(b => b.name === 'PRIVATE_RUNTIME').text = 'changed-secret'; return value; };
  await assert.rejects(runRelease({ sha, account, config }, deps), error => error.message === 'RUNTIME_CHANGED');
  assert.equal(deps.events.includes('worker'), false);
});
test('Worker reconciliation failure never publishes Pages', async () => {
  const deps = adapters(); deps.waitForWorker = async () => { throw new Error('ROLLOUT_TIMEOUT'); };
  await assert.rejects(runRelease({ sha, account, config }, deps), /ROLLOUT_TIMEOUT/);
  assert.equal(deps.events.includes('pages'), false);
});
test('snapshot rejects wrong backend, binding, replica, settings, partial inventory and Pages target', () => {
  const changes = [
    s => { s.settings.bindings.find(b => b.name === 'SARIN_DATA_BACKEND').text = 'firestore'; },
    s => { s.settings.bindings.find(b => b.name === 'SARIN_DB').id = 'other'; },
    s => { s.app.max_instances = 2; },
    s => { s.app.configuration.memory_mib = 2048; },
    s => { s.instances.result_info.next_page_token = 'next'; },
    s => { s.subdomain.enabled = true; },
    s => { s.schedules = []; },
    s => { s.pages.deployment_configs.production.services.SARIN_APP_HOST.service = 'other'; },
    s => { s.pages.deployment_configs.production.env_vars.SARIN_PUBLIC_ORIGIN.value = 'https://other.test'; },
    s => { s.pages.deployment_configs.production.env_vars.SARIN_APP_ORIGIN = { type: 'secret_text' }; },
    s => { s.instances.instances.push({ id: 'two', state: 'running', version: 30 }); },
  ];
  for (const change of changes) { const value = snapshot(); change(value); assert.throws(() => validateSnapshot(value, config, account)); }
});
test('release configuration preserves runtime vars and limits; public build arguments are not runtime overrides', () => {
  const result = releaseConfig(config, `registry.cloudflare.com/${account}/sarin-bot-app@${digest}`, resolve('/repo'), resolve('/tmp/release'));
  assert.deepEqual(result.vars, {}); assert.equal(result.keep_vars, true);
  assert.equal(result.containers[0].max_instances, 1); assert.equal(result.containers[0].image_vars, undefined);
  assert.equal(result.containers[0].image_build_context, undefined);
  assert.equal(result.main, resolve('/repo', 'cloudflare/src/index.ts'));
  assert.deepEqual(result.d1_databases, config.d1_databases);
  assert.deepEqual(result.durable_objects, config.durable_objects);
});

test('temporary release tsconfig resolves correctly through Wrangler path.join on Linux and Windows', () => {
  for (const [paths, root, directory] of [[posix, '/home/runner/work/sarin/source', '/tmp/sarin-release'], [win32, 'C:\\repo with spaces\\source', 'C:\\temp\\sarin-release']]) {
    const result = releaseConfig(config, `registry.cloudflare.com/${account}/sarin-bot-app@${digest}`, root, directory, paths);
    assert.equal(paths.isAbsolute(result.tsconfig), false);
    assert.equal(paths.join(directory, result.tsconfig), paths.join(root, 'cloudflare/tsconfig.json'));
    // Wrangler resolves main with resolve(), unlike tsconfig's join().
    assert.equal(paths.resolve(directory, result.main), paths.join(root, 'cloudflare/src/index.ts'));
  }
});

test('installed Wrangler reads the generated config with the actual checkout tsconfig', async () => {
  const { unstable_readConfig } = await import('wrangler');
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const directory = await mkdtemp(join(tmpdir(), 'sarin-release-config-test-'));
  try {
    const path = join(directory, 'release.json');
    await writeFile(path, JSON.stringify(releaseConfig(config, `registry.cloudflare.com/${account}/sarin-bot-app@${digest}`, root, directory)));
    const normalized = unstable_readConfig({ config: path });
    assert.equal(resolve(normalized.tsconfig), resolve(root, 'cloudflare/tsconfig.json'));
    assert.equal(normalized.main, resolve(root, 'cloudflare/src/index.ts'));
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('Pages project API uses production.services for service bindings', () => {
  // GET /accounts/{account_id}/pages/projects/{project_name} documented response.
  const value = snapshot();
  assert.doesNotThrow(() => validateSnapshot(value, config, account));
  const production = value.pages.deployment_configs.production;
  production.service_bindings = production.services;
  delete production.services;
  assert.throws(() => validateSnapshot(value, config, account), /PAGES_TARGET/);
});

test('Pages config fingerprint ignores only the per-environment Wrangler source hash', () => {
  const configs = snapshot().pages.deployment_configs;
  configs.production.wrangler_config_hash = 'prior-production-config';
  configs.preview = { env_vars: {}, wrangler_config_hash: 'prior-preview-config' };
  const baseline = pagesConfigFingerprint(configs);
  const after = structuredClone(configs);
  delete after.production.wrangler_config_hash;
  after.preview.wrangler_config_hash = 'new-preview-config';
  assert.equal(pagesConfigFingerprint(after), baseline);
  after.production.wrangler_config_hash = 'new-production-config';
  delete after.preview.wrangler_config_hash;
  assert.equal(pagesConfigFingerprint(after), baseline);
  assert.equal(configs.production.wrangler_config_hash, 'prior-production-config');
  for (const [key, value] of Object.entries({ env_vars: {}, services: {}, compatibility_date: '2026-10-24', compatibility_flags: ['nodejs_compat'], always_use_latest_compatibility_date: true, fail_open: false, build_image_major_version: 3, usage_model: 'standard', limits: { cpu_ms: 50 }, placement: { mode: 'smart' }, future_runtime_setting: true })) {
    const changed = structuredClone(after); changed.production[key] = value;
    assert.notEqual(pagesConfigFingerprint(changed), baseline, key);
  }
});

test('Worker reconciliation survives Pages source-hash removal but blocks service runtime drift', () => {
  const value = snapshot();
  value.version.annotations['workers/tag'] = sha;
  value.pages.deployment_configs.production.wrangler_config_hash = 'previous-git-build';
  const baseline = validateSnapshot(value, config, account);
  const parameters = { config, account, sha, image: { reference: value.app.configuration.image }, baseline };
  delete value.pages.deployment_configs.production.wrangler_config_hash;
  assert.equal(workerReady(value, parameters), true);
  value.pages.deployment_configs.production.services.SARIN_APP_HOST.entrypoint = 'OtherHandler';
  assert.throws(() => workerReady(value, parameters), /POST_DEPLOY_RUNTIME_CHANGED/);
});

test('reconciliation requires same tagged Worker, pinned image and sole running current instance', () => {
  const value = snapshot(); const baseline = validateSnapshot(value, config, account);
  const image = { reference: value.app.configuration.image };
  assert.equal(workerReady(value, { config, account, sha, image, baseline }), false);
  value.version.annotations['workers/tag'] = sha;
  assert.equal(workerReady(value, { config, account, sha, image, baseline }), true);
  value.app.active_rollout_id = 'rollout-still-active';
  assert.throws(() => validateSnapshot(value, config, account), /CONTAINER_ROLLOUT_ACTIVE/);
  assert.equal(workerReady(value, { config, account, sha, image, baseline }), false);
  delete value.app.active_rollout_id;
  value.instances.instances[0].version--;
  assert.equal(workerReady(value, { config, account, sha, image, baseline }), false);
  value.instances.instances = [];
  assert.equal(workerReady(value, { config, account, sha, image, baseline }), false);
});

test('Pages reconciliation requires successful production canonical deployment of this commit', () => {
  const value = snapshot().pages;
  assert.equal(pagesReady(value, sha), false);
  value.canonical_deployment = { id: 'p1', environment: 'production', latest_stage: { status: 'success' }, deployment_trigger: { metadata: { commit_hash: sha } } };
  assert.equal(pagesReady(value, sha), true);
  value.canonical_deployment.deployment_trigger.metadata.commit_hash = 'other';
  assert.equal(pagesReady(value, sha), false);
});

test('automatic Git deployments must be disabled; cron timestamp changes are not runtime drift', () => {
  const value = snapshot();
  value.pages.source = { type: 'github', config: { production_deployments_enabled: true, preview_deployment_setting: 'none' } };
  assert.throws(() => validateSnapshot(value, config, account), /PAGES_GIT_AUTODEPLOY/);
  value.pages.source.config.production_deployments_enabled = false;
  value.pages.source.config.preview_deployment_setting = 'all';
  assert.throws(() => validateSnapshot(value, config, account), /PAGES_GIT_AUTODEPLOY/);
  value.pages.source.config.preview_deployment_setting = 'none';
  const baseline = validateSnapshot(value, config, account);
  value.schedules[0].created_on = 'changed-by-provider';
  assert.equal(validateSnapshot(value, config, account).preservedHash, baseline.preservedHash);
});

test('Cloudflare empty command defaults and private network are accepted and custom runtime is rejected', () => {
  const value = snapshot();
  const baseline = validateSnapshot(value, config, account);
  Object.assign(value.app.configuration, { command: [], entrypoint: [], network: { assign_ipv6: 'none', assign_ipv4: 'none', mode: 'private' } });
  assert.equal(validateSnapshot(value, config, account).preservedHash, baseline.preservedHash);
  for (const field of ['command', 'entrypoint']) {
    const custom = structuredClone(value); custom.app.configuration[field] = ['custom'];
    assert.throws(() => validateSnapshot(custom, config, account), /CONTAINER_CUSTOM_RUNTIME/);
  }
  for (const network of [{ assign_ipv4: 'predefined', assign_ipv6: 'none', mode: 'private' }, { assign_ipv4: 'none', assign_ipv6: 'none', mode: 'public' }, { assign_ipv4: 'none', assign_ipv6: 'none', mode: 'private', extra: 'custom' }]) {
    const custom = structuredClone(value); custom.app.configuration.network = network;
    assert.throws(() => validateSnapshot(custom, config, account), /CONTAINER_CUSTOM_RUNTIME/);
  }
});
test('bounded API failures omit provider bodies, token and URL; large and stalled bodies fail closed', async () => {
  const fetchBad = async () => new Response(JSON.stringify({ errors: [{ code: 10000, message: 'Bearer private-token' }] }), { status: 403 });
  await assert.rejects(boundedJson('https://example.test', { fetch: fetchBad }), error => error.message === 'API_HTTP_403');
  await assert.rejects(boundedJson('https://example.test', { fetch: async () => new Response('x'.repeat(100)), limit: 20 }), /API_TOO_LARGE/);
  await assert.rejects(boundedJson('https://example.test', { fetch: async () => new Response(new ReadableStream({ start() {} })), timeout: 10 }), /API_TIMEOUT/);
});
test('registry verification binds manifest to locally built image and source/platform', () => {
  const configDigest = `sha256:${'f'.repeat(64)}`;
  const reference = `registry.cloudflare.com/${account}/sarin-bot-app@${digest}`;
  const local = { Id: configDigest, Os: 'linux', Architecture: 'amd64', Config: { Labels: { 'org.opencontainers.image.revision': sha } }, RepoDigests: [reference] };
  const manifest = { Descriptor: { digest, platform: { os: 'linux', architecture: 'amd64' } }, SchemaV2Manifest: { schemaVersion: 2, config: { digest: configDigest }, layers: [] } };
  assert.equal(verifyImage({ local, manifest, sha, account }).reference, reference);
  assert.throws(() => verifyImage({ local: { ...local, Architecture: 'arm64' }, manifest, sha, account }));
  assert.throws(() => verifyImage({ local, manifest: { ...manifest, Descriptor: { ...manifest.Descriptor, digest: configDigest } }, sha, account }));
});

test('CLI diagnostics expose only fixed operation, bounded numeric codes and fixed error classes', () => {
  const secret = 'Bearer private-token /private/path https://private.test/?key=secret';
  const result = commandDiagnostic({ operation: 'WRANGLER_DEPLOY', exitCode: 1, stdout: secret, stderr: `Authentication error [code: 10000]\n${secret}\n[code: 10000] [code: 123456789]` });
  assert.deepEqual(result, { operation: 'WRANGLER_DEPLOY', exitCode: 1, cloudflareCodes: [10000], errorClass: 'AUTHORIZATION' });
  const cases = [['Could not resolve "private-module"', 'MODULE_RESOLUTION'], ['Invalid configuration file at /private/path', 'CONFIGURATION'], ['Unknown argument: private-flag', 'CONFIGURATION'], ['spawn private-command ENOENT', 'COMMAND_NOT_FOUND'], [secret, 'UNKNOWN']];
  for (const [stderr, errorClass] of cases) {
    const value = commandDiagnostic({ operation: secret, exitCode: secret, stderr });
    assert.equal(value.errorClass, errorClass);
    assert.equal(value.operation, 'UNKNOWN'); assert.equal(value.exitCode, null);
    assert.equal(JSON.stringify(value).includes('private'), false);
  }
  const many = Array.from({ length: 20 }, (_, i) => `[code: ${10000 + i}]`).join(' ');
  assert.equal(commandDiagnostic({ stderr: many }).cloudflareCodes.length, 8);
  assert.deepEqual(commandDiagnostic({ stderr: 'x'.repeat(65_536) + '[code: 10000]' }).cloudflareCodes, []);
});
