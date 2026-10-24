// Production entrypoint. CLI output and provider bodies stay private in memory.
import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { publicBuildArguments } from '../src/router.ts';
import { APP, WORKER, PAGES, boundedJson, fail, hash, releaseConfig, runRelease, verifyImage, workerReady, pagesReady, commandDiagnostic, pagesConfigFingerprint } from './release-core.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const wrangler = join(root, 'cloudflare/node_modules/wrangler/bin/wrangler.js');
const environment = process.env;
let temporary;
let stage = 'INPUT';
const progress = value => { stage = value; console.log(`Release: ${value}`); };
const json = value => { try { return JSON.parse(value); } catch { fail('COMMAND_JSON'); } };
const required = key => { const value = environment[key]; if (!value || /[\r\n\0]/.test(value)) fail('ENVIRONMENT'); return value; };
const baseEnvironment = () => Object.fromEntries(['PATH', 'HOME', 'USERPROFILE', 'SYSTEMROOT', 'TEMP', 'TMP', 'TMPDIR', 'DOCKER_HOST', 'DOCKER_CONTEXT'].filter(key => environment[key]).map(key => [key, environment[key]]));

function command(binary, args, { cwd = temporary, env = {}, timeout = 120_000, limit = 16_000_000, diagnosticOperation } = {}) {
  return new Promise((resolveCommand, reject) => {
    const child = spawn(binary, args, { cwd, env: { ...baseEnvironment(), CI: 'true', NO_COLOR: '1', ...env }, shell: false, windowsHide: true, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks = []; const errorChunks = []; let errorSize = 0; let size = 0; let failure; let reported = false;
    const report = (exitCode, startupCode = '') => {
      if (!diagnosticOperation || reported) return;
      reported = true;
      console.error(JSON.stringify(commandDiagnostic({ operation: diagnosticOperation, exitCode, stdout: Buffer.concat(chunks).toString('utf8'), stderr: startupCode + Buffer.concat(errorChunks).toString('utf8') })));
    };
    const stop = code => {
      failure ??= code;
      try { if (process.platform === 'win32') child.kill('SIGKILL'); else process.kill(-child.pid, 'SIGKILL'); } catch { /* process already exited */ }
    };
    const timer = setTimeout(() => stop('COMMAND_TIMEOUT'), timeout);
    child.stdout.on('data', data => { size += data.length; if (size > limit) stop('COMMAND_OUTPUT_LIMIT'); else chunks.push(data); });
    child.stderr.on('data', data => {
      size += data.length;
      if (diagnosticOperation && errorSize < 65_536) { const chunk = data.subarray(0, 65_536 - errorSize); errorChunks.push(chunk); errorSize += chunk.length; }
      if (size > limit) stop('COMMAND_OUTPUT_LIMIT');
    });
    child.on('error', error => { clearTimeout(timer); report(null, error.code === 'ENOENT' ? 'ENOENT' : ''); reject(new Error('COMMAND_START')); });
    child.on('close', code => { clearTimeout(timer); if (failure || code !== 0) { report(code); reject(new Error(failure ?? 'COMMAND_FAILED')); } else resolveCommand(Buffer.concat(chunks).toString('utf8').trim()); });
  });
}

async function main() {
  if (process.platform !== 'linux' || Number(process.versions.node.split('.')[0]) !== 24) fail('RUNNER_PLATFORM');
  const sha = required('GITHUB_SHA'), repository = required('GITHUB_REPOSITORY');
  const account = required('CLOUDFLARE_ACCOUNT_ID'), token = required('CLOUDFLARE_API_TOKEN'), githubToken = required('GITHUB_TOKEN');
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) fail('REPOSITORY');
  let buildArgs;
  try { buildArgs = publicBuildArguments(environment); } catch { fail('PUBLIC_FIREBASE'); }
  const config = json(await readFile(join(root, 'cloudflare/wrangler.jsonc'), 'utf8'));
  if (buildArgs.NEXT_PUBLIC_FIREBASE_PROJECT_ID !== config.vars.FIREBASE_ADMIN_PROJECT_ID) fail('FIREBASE_PROJECT');
  if (json(await readFile(join(root, 'cloudflare/node_modules/wrangler/package.json'), 'utf8')).version !== '4.150.0') fail('WRANGLER_VERSION');
  temporary = await mkdtemp(join(environment.RUNNER_TEMP || tmpdir(), 'sarin-release-'));
  const dockerConfig = join(temporary, 'docker'); await mkdir(dockerConfig);
  const dockerEnvironment = { DOCKER_CONFIG: dockerConfig };
  const cloudflareEnvironment = { ...dockerEnvironment, CLOUDFLARE_ACCOUNT_ID: account, CLOUDFLARE_API_TOKEN: token, WRANGLER_SEND_METRICS: 'false', WRANGLER_WRITE_LOGS: 'false' };
  const cli = (args, options = {}) => command(process.execPath, [wrangler, ...args], { ...options, env: cloudflareEnvironment });
  const cliJson = async args => json(await cli(args));
  const api = async path => {
    const body = await boundedJson(`https://api.cloudflare.com/client/v4/accounts/${account}/${path}`, { headers: { Authorization: `Bearer ${token}` } });
    if (body.success !== true || body.result == null) fail('API_UNSUCCESSFUL');
    return body.result;
  };
  const pagesProject = () => api(`pages/projects/${PAGES}`);
  const snapshot = async () => {
    const [deployment, settings, schedules, subdomain, app, instances, pages] = await Promise.all([
      cliJson(['deployments', 'status', '--name', WORKER, '--json']),
      api(`workers/scripts/${WORKER}/settings`), api(`workers/scripts/${WORKER}/schedules`), api(`workers/scripts/${WORKER}/subdomain`),
      cliJson(['containers', 'info', APP, '--json']), cliJson(['containers', 'instances', APP, '--per-page', '100', '--json']), pagesProject(),
    ]);
    const versionId = deployment.versions?.[0]?.version_id;
    if (!/^[a-f0-9-]{36}$/.test(versionId ?? '')) fail('WORKER_VERSION_ID');
    const version = await cliJson(['versions', 'view', versionId, '--name', WORKER, '--json']);
    return { deployment, version, settings, schedules, subdomain, app, instances, pages };
  };
  const wake = async () => {
    try {
      const response = await fetch('https://sarinbotsaas.pages.dev/dashboard/onboarding', { redirect: 'error', signal: AbortSignal.timeout(30_000) });
      await response.body?.cancel();
      return response.status === 200;
    } catch { return false; }
  };
  const poll = async (check, minutes, code) => {
    const end = Date.now() + minutes * 60_000;
    do { const result = await check(); if (result) return result; if (Date.now() < end) await delay(10_000); } while (Date.now() < end);
    fail(code);
  };
  let baselinePagesHash;
  let acceptedWorker;
  const result = await runRelease({ sha, account, config }, {
    exactSource: async () => {
      progress('SOURCE');
      const revision = await command('git', ['rev-parse', 'HEAD'], { cwd: root });
      const status = await command('git', ['status', '--porcelain', '--untracked-files=normal'], { cwd: root });
      if (status) fail('DIRTY_CHECKOUT');
      const tree = await command('git', ['rev-parse', `${sha}^{tree}`], { cwd: root });
      if (!/^[a-f0-9]{40}$/.test(tree)) fail('SOURCE_TREE');
      // Gateway and landing artifacts were built by the preceding CI steps.
      const gateway = await readFile(join(root, 'landing/out/_worker.js'));
      if (!gateway.equals(await readFile(join(root, 'pages-gateway/worker.mjs'))) || !(await readFile(join(root, 'landing/out/index.html'))).length || hash(json(await readFile(join(root, 'landing/out/_routes.json'), 'utf8'))) !== hash({ version: 1, include: ['/*'], exclude: [] })) fail('PAGES_ARTIFACT');
      return { sha: revision, tree };
    },
    mainSha: async () => {
      const body = await boundedJson(`https://api.github.com/repos/${repository}/git/ref/heads/main`, { headers: { Authorization: `Bearer ${githubToken}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' } });
      return body.object?.sha;
    },
    snapshot: async () => { progress('PREFLIGHT'); const value = await snapshot(); baselinePagesHash = pagesConfigFingerprint(value.pages.deployment_configs); return value; },
    buildAndPush: async source => {
      progress('IMAGE_BUILD');
      const context = join(temporary, 'source'); await mkdir(context);
      const archive = join(temporary, 'source.tar');
      await command('git', ['archive', '--format=tar', '--output', archive, source.sha], { cwd: root });
      await command('tar', ['-xf', archive, '-C', context]);
      const tag = `${WORKER}:git-${sha}`, registryTag = `registry.cloudflare.com/${account}/${tag}`;
      await command('docker', ['buildx', 'build', '--platform', 'linux/amd64', '--provenance=false', '--load', '--tag', tag, '--label', `org.opencontainers.image.revision=${sha}`, '--label', `com.sarin.source-tree=${source.tree}`, ...Object.keys(buildArgs).flatMap(key => ['--build-arg', key]), context], { env: { ...dockerEnvironment, ...buildArgs }, timeout: 900_000 });
      const built = json(await command('docker', ['image', 'inspect', '--format', '{{json .}}', tag], { env: dockerEnvironment }));
      if (built.Config?.Labels?.['com.sarin.source-tree'] !== source.tree || built.Config?.Labels?.['org.opencontainers.image.revision'] !== sha || built.Os !== 'linux' || built.Architecture !== 'amd64') fail('BUILT_IMAGE');
      progress('IMAGE_PUSH');
      await cli(['containers', 'push', tag], { timeout: 300_000 });
      const local = json(await command('docker', ['image', 'inspect', '--format', '{{json .}}', registryTag], { env: dockerEnvironment }));
      if (local.Id !== built.Id) fail('PUSHED_IMAGE_CHANGED');
      const manifest = json(await command('docker', ['manifest', 'inspect', '--verbose', registryTag], { env: dockerEnvironment }));
      return verifyImage({ local, manifest, sha, account });
    },
    deployWorker: async image => {
      progress('WORKER_DEPLOY');
      const path = join(temporary, 'release.json');
      await writeFile(path, JSON.stringify(releaseConfig(config, image.reference, root, dirname(path))), { mode: 0o600 });
      await cli(['deploy', '--config', path, '--autoconfig=false', '--keep-vars', '--containers-rollout=immediate', '--tag', sha, '--message', `GitHub main ${sha}`], { timeout: 300_000, diagnosticOperation: 'WRANGLER_DEPLOY' });
    },
    waitForWorker: async (image, baseline) => {
      progress('WORKER_RECONCILE');
      return poll(async () => {
        await wake();
        const value = await snapshot();
        if (!workerReady(value, { config, account, sha, image, baseline })) return false;
        acceptedWorker = { config, account, sha, image, baseline };
        return { workerVersion: value.version.id, containerVersion: value.app.version };
      }, 10, 'ROLLOUT_TIMEOUT');
    },
    deployPages: async () => {
      progress('PAGES_DEPLOY');
      if (!workerReady(await snapshot(), acceptedWorker)) fail('WORKER_CHANGED_BEFORE_PAGES');
      await cli(['pages', 'deploy', join(root, 'landing/out'), '--project-name', PAGES, '--branch', 'main', '--commit-hash', sha, '--commit-message', `GitHub main ${sha}`, '--commit-dirty=false'], { timeout: 180_000, diagnosticOperation: 'WRANGLER_PAGES_DEPLOY' });
    },
    waitForPages: async () => {
      progress('PAGES_RECONCILE');
      return poll(async () => {
        const value = await snapshot();
        if (!workerReady(value, acceptedWorker)) fail('WORKER_CHANGED_AFTER_PAGES');
        if (pagesConfigFingerprint(value.pages.deployment_configs) !== baselinePagesHash) fail('PAGES_RUNTIME_CHANGED');
        if (!pagesReady(value.pages, sha) || !await wake()) return false;
        return { pagesDeployment: value.pages.canonical_deployment.id };
      }, 2, 'PAGES_TIMEOUT');
    },
  });
  progress('VERIFIED');
  console.log(JSON.stringify(result));
}

try { await main(); }
catch (error) {
  const code = /^[A-Z][A-Z0-9_]{1,64}$/.test(error?.message ?? '') ? error.message : 'RELEASE_FAILED';
  console.error(`Release failed at ${stage}: ${code}. Inspect live deployment state before retrying; no automatic rollback was attempted.`);
  process.exitCode = 1;
} finally {
  if (temporary) await rm(temporary, { recursive: true, force: true }).catch(() => { process.exitCode = 1; console.error('Release cleanup failed.'); });
}
