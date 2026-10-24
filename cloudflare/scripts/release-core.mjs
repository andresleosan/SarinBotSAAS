import { createHash } from 'node:crypto';
import path from 'node:path';

export const WORKER = 'sarin-bot-app';
export const PAGES = 'sarinbotsaas';
export const APP = 'a032778c-ce3d-4673-b65a-4bf13fa3e02c';
export const fail = code => { throw new Error(code); };
const canonical = value => value && typeof value === 'object' ? Array.isArray(value) ? value.map(canonical) : Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
export const hash = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
export function pagesConfigFingerprint(configs) {
  const runtime = structuredClone(configs);
  // This describes the config file used by a deployment, not its runtime.
  // Direct upload without a Wrangler Pages config may remove this metadata.
  for (const environment of ['production', 'preview']) {
    if (runtime?.[environment] && typeof runtime[environment] === 'object') delete runtime[environment].wrangler_config_hash;
  }
  return hash(runtime);
}
const same = (a, b) => hash(a) === hash(b);
const sha256 = value => /^sha256:[a-f0-9]{64}$/.test(value ?? '');

/** Never return provider text, arguments, paths, URLs or permission guesses. */
export function commandDiagnostic({ operation, exitCode, stdout = '', stderr = '' } = {}) {
  const text = `${String(stderr)}\n${String(stdout)}`.slice(0, 65_536);
  const cloudflareCodes = [...new Set([...text.matchAll(/\[code:\s*(\d{1,8})\]/g)].map(match => Number(match[1])))].slice(0, 8);
  let errorClass = 'UNKNOWN';
  if (/Cannot find (?:module|package)|Could not resolve|MODULE_NOT_FOUND|ERR_MODULE_NOT_FOUND/i.test(text)) errorClass = 'MODULE_RESOLUTION';
  else if (/Unknown (?:argument|option)|Invalid configuration|Error parsing configuration|Missing entry-point/i.test(text)) errorClass = 'CONFIGURATION';
  else if (/Authentication error|Authorization error|not authori[sz]ed|insufficient permissions?|permission denied|\bForbidden\b|\bUnauthorized\b/i.test(text)) errorClass = 'AUTHORIZATION';
  else if (/\bENOENT\b|command not found|executable (?:was )?not found/i.test(text)) errorClass = 'COMMAND_NOT_FOUND';
  return {
    operation: ['WRANGLER_DEPLOY', 'WRANGLER_PAGES_DEPLOY'].includes(operation) ? operation : 'UNKNOWN',
    exitCode: Number.isInteger(exitCode) && exitCode >= 0 && exitCode <= 255 ? exitCode : null,
    cloudflareCodes, errorClass,
  };
}

/** Provider bodies and URLs are deliberately absent from errors and evidence. */
export async function boundedJson(url, { fetch: request = globalThis.fetch, headers = {}, timeout = 20_000, limit = 2_000_000 } = {}) {
  const controller = new AbortController();
  let timer;
  const deadline = new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('API_TIMEOUT')); }, timeout); });
  try {
    return await Promise.race([deadline, (async () => {
      let response;
      try { response = await request(url, { headers, redirect: 'error', signal: controller.signal }); }
      catch { fail('API_TRANSPORT'); }
      if (!response.ok) { await response.body?.cancel(); fail(`API_HTTP_${response.status}`); }
      const reader = response.body?.getReader();
      if (!reader) fail('API_EMPTY');
      const chunks = []; let size = 0;
      try {
        for (;;) {
          const { done, value } = await reader.read(); if (done) break;
          size += value.byteLength; if (size > limit) { await reader.cancel(); fail('API_TOO_LARGE'); }
          chunks.push(Buffer.from(value));
        }
        try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { fail('API_JSON'); }
      } finally { reader.releaseLock(); }
    })()]);
  } finally { clearTimeout(timer); controller.abort(); }
}

export function validateSnapshot(snapshot, config, account, { allowRollout = false } = {}) {
  const { app, deployment, version, settings, instances, subdomain, pages } = snapshot;
  if (app?.active_rollout_id && !allowRollout) fail('CONTAINER_ROLLOUT_ACTIVE');
  if (app?.id !== APP || app.account_id !== account || app.name !== `${WORKER}-sarinapp` || app.max_instances !== 1 || app.scheduling_policy !== 'default') fail('CONTAINER_IDENTITY');
  if (!Number.isInteger(app.version) || !new RegExp(`^registry\\.cloudflare\\.com/${account}/${WORKER}@sha256:[a-f0-9]{64}$`).test(app.configuration?.image ?? '')) fail('CONTAINER_IMAGE');
  const expectedContainer = { constraints: { tiers: [1, 2] }, grace: 0, resources: [0.25, 1024, 4000] };
  const actualContainer = { constraints: app.constraints, grace: app.rollout_active_grace_period ?? 0, resources: [app.configuration.vcpu, app.configuration.memory_mib, app.configuration.disk?.size_mb] };
  if (!same(expectedContainer, actualContainer)) fail('CONTAINER_SETTINGS');
  // Cloudflare returns these exact defaults even when Wrangler omits them.
  const defaults = { command: [], entrypoint: [], network: { assign_ipv4: 'none', assign_ipv6: 'none', mode: 'private' } };
  const containerRuntime = Object.fromEntries(Object.keys(defaults).map(key => [key, app.configuration[key] ?? defaults[key]]));
  if (!same(containerRuntime, defaults)) fail('CONTAINER_CUSTOM_RUNTIME');
  if (app.observability?.logs?.enabled || app.configuration.observability?.logs?.enabled || settings?.observability?.enabled || settings?.observability?.logs?.enabled || settings?.observability?.traces?.enabled) fail('OBSERVABILITY_DRIFT');
  if (deployment?.versions?.length !== 1 || deployment.versions[0].percentage !== 100 || version?.id !== deployment.versions[0].version_id) fail('WORKER_TRAFFIC');
  const schedules = Array.isArray(snapshot.schedules) ? snapshot.schedules : snapshot.schedules?.schedules;
  if (!Array.isArray(schedules) || !same(schedules.map(item => item.cron).sort(), [...config.triggers.crons].sort()) || settings.compatibility_date !== config.compatibility_date || !same(settings.compatibility_flags, config.compatibility_flags) || subdomain?.enabled !== false || subdomain.previews_enabled !== false) fail('WORKER_SETTINGS');
  const bindings = settings.bindings;
  if (!Array.isArray(bindings)) fail('WORKER_BINDINGS');
  const binding = name => bindings.find(item => item.name === name);
  const expected = { SARIN_DATA_BACKEND: 'd1', SARIN_MAINTENANCE: 'false', FIREBASE_ADMIN_CREDENTIAL_MODE: 'adc', FIREBASE_ADMIN_PROJECT_ID: config.vars.FIREBASE_ADMIN_PROJECT_ID, FIREBASE_WIF_AUDIENCE: config.vars.FIREBASE_WIF_AUDIENCE, FIREBASE_WIF_SERVICE_ACCOUNT_EMAIL: config.vars.FIREBASE_WIF_SERVICE_ACCOUNT_EMAIL };
  for (const [name, value] of Object.entries(expected)) if (binding(name)?.type !== 'plain_text' || binding(name).text !== value) fail('RUNTIME_INVARIANT');
  if (binding('SARIN_DB')?.type !== 'd1' || binding('SARIN_DB').id !== config.d1_databases[0].database_id || binding('SARIN_FILES')?.type !== 'r2_bucket' || binding('SARIN_FILES').bucket_name !== config.r2_buckets[0].bucket_name || binding('AI')?.type !== 'ai') fail('DATA_BINDINGS');
  for (const item of config.durable_objects.bindings) if (binding(item.name)?.type !== 'durable_object_namespace' || binding(item.name).class_name !== item.class_name || binding(item.name).script_name && binding(item.name).script_name !== WORKER) fail('DO_BINDINGS');
  const configuredNames = new Set(['AI', 'SARIN_DB', 'SARIN_FILES', ...config.durable_objects.bindings.map(item => item.name)]);
  if (bindings.some(item => !['plain_text', 'json', 'secret_text', 'secret_key'].includes(item.type) && !configuredNames.has(item.name))) fail('UNMANAGED_BINDING');
  if (!bindings.some(item => ['secret_text', 'secret_key'].includes(item.type))) fail('MISSING_RUNTIME_SECRETS');
  if (!Array.isArray(instances?.instances) || instances.result_info?.next_page_token !== null) fail('INCOMPLETE_INSTANCE_INVENTORY');
  const states = new Set(['inactive', 'stopped', 'running', 'provisioning', 'stopping', 'unhealthy', 'failed']);
  if (instances.instances.some(item => !states.has(item.state))) fail('INSTANCE_STATE');
  if (instances.instances.filter(item => !['inactive', 'stopped'].includes(item.state)).length > 1) fail('MULTIPLE_ACTIVE_INSTANCES');
  if (pages?.name !== PAGES || pages.production_branch !== 'main' || pages.deployment_configs?.production?.services?.SARIN_APP_HOST?.service !== WORKER) fail('PAGES_TARGET');
  if (pages.source && (pages.source.config?.production_deployments_enabled !== false || pages.source.config.preview_deployment_setting !== 'none')) fail('PAGES_GIT_AUTODEPLOY');
  const pageVars = pages.deployment_configs.production.env_vars;
  if (pageVars?.SARIN_PUBLIC_ORIGIN?.value !== 'https://sarinbotsaas.pages.dev' || ['SARIN_APP_ORIGIN', 'SARIN_APP_ACCESS_CLIENT_ID', 'SARIN_APP_ACCESS_CLIENT_SECRET'].some(key => key in pageVars)) fail('PAGES_ENVIRONMENT');
  // Raw values remain only in memory. Hashes detect drift without logging values.
  return {
    deploymentId: deployment.id, workerVersion: version.id, containerVersion: app.version, image: app.configuration.image,
    preservedHash: hash({ bindings: [...bindings].sort((a, b) => a.name.localeCompare(b.name)), container: actualContainer, containerRuntime, compatibility_date: settings.compatibility_date, compatibility_flags: settings.compatibility_flags, crons: schedules.map(item => item.cron).sort(), subdomain, observability: settings.observability ?? null, containerObservability: app.observability ?? null, pagesConfig: pagesConfigFingerprint(pages.deployment_configs) }),
  };
}

export function workerReady(snapshot, { config, account, sha, image, baseline }) {
  const current = validateSnapshot(snapshot, config, account, { allowRollout: true });
  if (current.preservedHash !== baseline.preservedHash) fail('POST_DEPLOY_RUNTIME_CHANGED');
  const active = snapshot.instances.instances.filter(item => !['inactive', 'stopped'].includes(item.state));
  return !snapshot.app.active_rollout_id && snapshot.version.annotations?.['workers/tag'] === sha && current.image === image.reference && active.length === 1 && active[0].state === 'running' && active[0].version === snapshot.app.version;
}

export function pagesReady(pages, sha) {
  const deployment = pages.canonical_deployment;
  return deployment?.environment === 'production' && deployment.latest_stage?.status === 'success' && deployment.deployment_trigger?.metadata?.commit_hash === sha;
}

export function releaseConfig(config, image, root, configDirectory, paths = path) {
  const next = structuredClone(config);
  next.main = paths.resolve(root, 'cloudflare/src/index.ts');
  // Wrangler 4.150 joins tsconfig to its config directory (main uses resolve).
  next.tsconfig = paths.relative(configDirectory, paths.resolve(root, 'cloudflare/tsconfig.json'));
  if (paths.isAbsolute(next.tsconfig)) fail('RELEASE_CONFIG_PATH');
  delete next.$schema;
  next.vars = {}; next.keep_vars = true;
  next.containers[0].image = image;
  delete next.containers[0].image_vars; delete next.containers[0].image_build_context;
  return next;
}

export function verifyImage({ local, manifest, sha, account }) {
  const descriptor = manifest?.Descriptor;
  const content = manifest?.OCIManifest ?? manifest?.SchemaV2Manifest;
  if (!sha256(descriptor?.digest) || content?.schemaVersion !== 2 || !sha256(content.config?.digest) || !Array.isArray(content.layers) || content.layers.some(layer => !sha256(layer.digest))) fail('REGISTRY_MANIFEST');
  if (local?.Os !== 'linux' || local.Architecture !== 'amd64' || local.Config?.Labels?.['org.opencontainers.image.revision'] !== sha || descriptor.platform && (descriptor.platform.os !== 'linux' || descriptor.platform.architecture !== 'amd64')) fail('IMAGE_SOURCE_PLATFORM');
  const reference = `registry.cloudflare.com/${account}/${WORKER}@${descriptor.digest}`;
  if (![content.config.digest, descriptor.digest].includes(local.Id) || !local.RepoDigests?.includes(reference)) fail('REGISTRY_IDENTITY');
  return { reference, digest: descriptor.digest };
}

export async function runRelease({ sha, account, config }, deps) {
  if (!/^[a-f0-9]{40}$/.test(sha) || !/^[a-f0-9]{32}$/.test(account) || config.name !== WORKER || config.containers?.length !== 1 || config.containers[0].max_instances !== 1 || config.containers[0].instance_type !== 'basic') fail('RELEASE_INPUT');
  const source = await deps.exactSource();
  if (source.sha !== sha) fail('CHECKOUT_SHA');
  if (await deps.mainSha() !== sha) fail('STALE_MAIN');
  const before = validateSnapshot(await deps.snapshot(), config, account);
  const image = await deps.buildAndPush(source);
  if (await deps.mainSha() !== sha) fail('STALE_MAIN');
  const current = validateSnapshot(await deps.snapshot(), config, account);
  if (!same(before, current)) fail('RUNTIME_CHANGED');
  await deps.deployWorker(image);
  const worker = await deps.waitForWorker(image, before);
  // Complete this release even if main advances after the first runtime write.
  // A newer release waits for the global deployment concurrency group.
  await deps.deployPages();
  const pages = await deps.waitForPages();
  return { sha, tree: source.tree, image: image.reference, ...worker, ...pages };
}
