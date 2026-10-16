import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { planWifSetup } from '../../scripts/cloudflare-wif-setup.mjs';

const execute = promisify(execFile);
const script = fileURLToPath(new URL('../../scripts/cloudflare-wif-setup.mjs', import.meta.url));
const poolName = 'projects/153690559048/locations/global/workloadIdentityPools/sarin-cloudflare';
const providerName = `${poolName}/providers/worker-oidc`;
const audience = '//iam.googleapis.com/projects/153690559048/locations/global/workloadIdentityPools/sarin-cloudflare/providers/worker-oidc';
const member = 'principal://iam.googleapis.com/projects/153690559048/locations/global/workloadIdentityPools/sarin-cloudflare/subject/sarin-cloudflare-production';
const condition = "assertion.iss == 'https://sarinbotsaas.pages.dev' && assertion.sub == 'sarin-cloudflare-production' && assertion.aud == '//iam.googleapis.com/projects/153690559048/locations/global/workloadIdentityPools/sarin-cloudflare/providers/worker-oidc'";

function snapshot() {
  return {
    project: { projectId: 'sarinbotsaas', projectNumber: '153690559048' },
    serviceAccount: { email: 'sarin-runtime@sarinbotsaas.iam.gserviceaccount.com', disabled: false },
    enabledServices: ['iam.googleapis.com', 'iamcredentials.googleapis.com', 'sts.googleapis.com', 'cloudresourcemanager.googleapis.com'].map(name => ({ config: { name } })),
    pool: null,
    providers: [],
    serviceAccountPolicy: { version: 1, etag: 'synthetic-etag', bindings: [{ role: 'roles/iam.workloadIdentityUser', members: ['principal://iam.googleapis.com/projects/153690559048/locations/global/workloadIdentityPools/legacy-vps/subject/legacy-runtime'] }] },
  };
}

function configuredSnapshot() {
  const current = snapshot();
  current.pool = { name: poolName, state: 'ACTIVE', disabled: false };
  current.providers = [{ name: providerName, state: 'ACTIVE', disabled: false, attributeMapping: { 'google.subject': 'assertion.sub' }, attributeCondition: condition, oidc: { issuerUri: 'https://sarinbotsaas.pages.dev', allowedAudiences: [audience] } }];
  current.serviceAccountPolicy.bindings.push({ role: 'roles/iam.workloadIdentityUser', members: [member] });
  return current;
}

test('default WIF plan requests inspection and cannot propose changes from unverified absence', () => {
  const plan = planWifSetup();
  assert.equal(plan.mode, 'plan-only');
  assert.equal(plan.remoteCommandsExecuted, false);
  assert.equal(plan.status, 'inspection-required');
  assert.deepEqual(plan.changes, []);
  assert.equal(plan.expected.provider.oidc.issuerUri, 'https://sarinbotsaas.pages.dev');
  assert.deepEqual(plan.expected.provider.oidc.allowedAudiences, [audience]);
  assert.equal(plan.expected.provider.attributeCondition, condition);
  assert.equal(plan.expected.serviceAccountBinding.member, member);
  assert.equal(plan.expected.serviceAccountBinding.role, 'roles/iam.workloadIdentityUser');
  assert.ok(plan.inspection.some(command => command.args.includes('get-iam-policy')));
  assert.ok(plan.inspection.some(command => command.args.includes('providers') && command.args.includes('list')));
  for (const command of plan.inspection) {
    assert.equal(command.executable, 'gcloud');
    assert.ok(command.args.includes('--project=sarinbotsaas'));
    assert.ok(command.args.includes('--format=json'));
  }
});

test('verified absence produces only additive pool, exact OIDC provider and subject-scoped impersonation commands', () => {
  const current = snapshot();
  const before = structuredClone(current);
  const plan = planWifSetup({ snapshot: current });
  assert.equal(plan.status, 'ready-for-review');
  assert.deepEqual(plan.blockers, []);
  assert.deepEqual(current, before);
  assert.deepEqual(plan.changes.map(change => change.id), ['create-pool', 'create-provider', 'grant-runtime-impersonation']);
  const provider = plan.changes[1];
  assert.ok(provider.args.includes('--issuer-uri=https://sarinbotsaas.pages.dev'));
  assert.ok(provider.args.includes(`--allowed-audiences=${audience}`));
  assert.ok(provider.args.includes('--attribute-mapping=google.subject=assertion.sub'));
  assert.ok(provider.args.includes(`--attribute-condition=${condition}`));
  const grant = plan.changes[2];
  assert.ok(grant.args.includes('sarin-runtime@sarinbotsaas.iam.gserviceaccount.com'));
  assert.ok(grant.args.includes(`--member=${member}`));
  assert.ok(grant.args.includes('--role=roles/iam.workloadIdentityUser'));
  assert.ok(grant.args.includes('--condition=None'));
  for (const change of plan.changes) {
    assert.equal(change.executable, 'gcloud');
    assert.ok(change.args.includes('--project=sarinbotsaas'));
    assert.ok(!change.args.some(arg => ['delete', 'update-oidc', 'set-iam-policy', 'keys', 'roles/owner', 'roles/editor', 'roles/iam.serviceAccountTokenCreator'].includes(arg)));
  }
});

test('all WIF commands pin both resource and billing projects when ambient gcloud uses another project', () => {
  const current = snapshot();
  current.enabledServices = [];
  const plan = planWifSetup({ snapshot: current });
  for (const command of [...plan.inspection, ...plan.changes]) {
    // --project alone does not override the CLI quota/billing project for IAM calls.
    assert.deepEqual(command.args.filter(argument => argument.startsWith('--project=')), ['--project=sarinbotsaas']);
    assert.deepEqual(command.args.filter(argument => argument.startsWith('--billing-project=')), ['--billing-project=sarinbotsaas'], command.id);
  }
});

test('existing matching WIF trust is idempotent and preserves unrelated rollback access', () => {
  const current = configuredSnapshot();
  const plan = planWifSetup({ snapshot: current });
  assert.equal(plan.status, 'already-configured');
  assert.deepEqual(plan.changes, []);
  assert.deepEqual(plan.blockers, []);
  assert.doesNotMatch(JSON.stringify(plan), /synthetic-etag|legacy-runtime/);
});

test('WIF drift, incomplete inspection and shared pool trust block every proposed change', () => {
  const mutations = [
    current => { current.project.projectNumber = '999999999999'; },
    current => { current.serviceAccount.email = 'other@sarinbotsaas.iam.gserviceaccount.com'; },
    current => { current.serviceAccount.disabled = true; },
    current => { current.pool.disabled = true; },
    current => { current.pool.state = 'DELETED'; },
    current => { current.providers[0].oidc.issuerUri = 'https://evil.invalid'; },
    current => { current.providers[0].oidc.allowedAudiences.push('other-audience'); },
    current => { current.providers[0].oidc.jwksJson = '{"keys":[]}'; },
    current => { current.providers[0].attributeMapping['google.subject'] = 'assertion.email'; },
    current => { current.providers[0].attributeCondition = 'true'; },
    current => { current.providers.push({ name: `${poolName}/providers/other-provider` }); },
    current => { current.serviceAccountPolicy.bindings.push({ role: 'roles/iam.workloadIdentityUser', members: [`principalSet://iam.googleapis.com/${poolName}/*`] }); },
    current => { current.serviceAccountPolicy.bindings.at(-1).condition = { expression: 'false' }; },
    current => { delete current.enabledServices; },
    current => { delete current.serviceAccountPolicy; },
  ];
  for (const mutate of mutations) {
    const current = configuredSnapshot();
    mutate(current);
    const plan = planWifSetup({ snapshot: current });
    assert.equal(plan.status, 'blocked');
    assert.ok(plan.blockers.length > 0);
    assert.deepEqual(plan.changes, []);
  }
});

test('missing APIs are proposed explicitly while an existing matching pool is preserved', () => {
  const current = snapshot();
  current.enabledServices = current.enabledServices.filter(service => service.config.name !== 'sts.googleapis.com');
  current.pool = { name: poolName, state: 'ACTIVE' };
  const plan = planWifSetup({ snapshot: current });
  assert.equal(plan.status, 'ready-for-review');
  assert.deepEqual(plan.changes.map(change => change.id), ['enable-required-apis', 'create-provider', 'grant-runtime-impersonation']);
  assert.deepEqual(plan.changes[0].args, ['services', 'enable', 'sts.googleapis.com', '--project=sarinbotsaas', '--billing-project=sarinbotsaas', '--format=json']);
});

test('CLI emits review JSON without gcloud, rejects apply, and refuses to overwrite a review file', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sarin-wif-plan-'));
  const env = { ...process.env, PATH: '' };
  const result = await execute(process.execPath, [script, '--output', join(directory, 'review.json')], { env, windowsHide: true });
  assert.equal(result.stderr, '');
  const review = JSON.parse(await readFile(join(directory, 'review.json'), 'utf8'));
  assert.equal(review.status, 'inspection-required');
  await assert.rejects(execute(process.execPath, [script, '--apply'], { env, windowsHide: true }));
  await assert.rejects(execute(process.execPath, [script, '--output', join(directory, 'review.json')], { env, windowsHide: true }));
  assert.deepEqual(JSON.parse(await readFile(join(directory, 'review.json'), 'utf8')), review);
});

test('CLI reads a complete snapshot and returns a blocked review without echoing invalid JSON input', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sarin-wif-snapshot-'));
  const file = join(directory, 'existing.json');
  await writeFile(file, JSON.stringify(snapshot()));
  const result = await execute(process.execPath, [script, '--snapshot', file], { windowsHide: true });
  assert.equal(JSON.parse(result.stdout).status, 'ready-for-review');
  const conflicting = configuredSnapshot();
  conflicting.providers[0].attributeCondition = 'true';
  await writeFile(file, JSON.stringify(conflicting));
  await assert.rejects(execute(process.execPath, [script, '--snapshot', file], { windowsHide: true }), error => {
    assert.equal(error.code, 2);
    assert.equal(error.stderr, '');
    const review = JSON.parse(error.stdout);
    assert.equal(review.status, 'blocked');
    assert.deepEqual(review.changes, []);
    return true;
  });
  await writeFile(file, '{"private-secret-that-must-not-print"');
  await assert.rejects(execute(process.execPath, [script, '--snapshot', file], { windowsHide: true }), error => {
    assert.doesNotMatch(error.stderr, /private-secret-that-must-not-print/);
    return true;
  });
});
