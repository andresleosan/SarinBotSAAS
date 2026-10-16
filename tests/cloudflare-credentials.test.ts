import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import * as credentials from '../scripts/lib/cloudflare-credentials.mjs';

const env = {
  FIREBASE_ADMIN_CREDENTIAL_MODE: 'adc',
  FIREBASE_ADMIN_PROJECT_ID: 'sarinbotsaas',
  FIREBASE_WIF_AUDIENCE: '//iam.googleapis.com/projects/153690559048/locations/global/workloadIdentityPools/sarin-cloudflare/providers/worker-oidc',
  FIREBASE_WIF_SERVICE_ACCOUNT_EMAIL: 'sarin-runtime@sarinbotsaas.iam.gserviceaccount.com',
};
const directories: string[] = [];
const execute = promisify(execFile);
afterEach(async () => {
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })));
});

describe('Cloudflare startup credentials', () => {
  it('creates standard refreshable ADC with a fixed private source and Google destinations', () => {
    expect(credentials.createCloudflareCredentialConfiguration(env)).toEqual({
      type: 'external_account',
      audience: env.FIREBASE_WIF_AUDIENCE,
      subject_token_type: 'urn:ietf:params:oauth:token-type:jwt',
      token_url: 'https://sts.googleapis.com/v1/token',
      service_account_impersonation_url: 'https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/sarin-runtime@sarinbotsaas.iam.gserviceaccount.com:generateAccessToken',
      credential_source: { url: 'http://sarin-google.internal/token', format: { type: 'json', subject_token_field_name: 'subject_token' } },
    });
  });

  it('preserves existing non-Cloudflare startup modes for rollback', () => {
    expect(credentials.createCloudflareCredentialConfiguration({ FIREBASE_ADMIN_CREDENTIAL_MODE: 'cert' })).toBeNull();
    expect(credentials.createCloudflareCredentialConfiguration({ FIREBASE_ADMIN_CREDENTIAL_MODE: 'adc', GOOGLE_APPLICATION_CREDENTIALS: '/legacy/adc.json' })).toBeNull();
  });

  it.each([
    { FIREBASE_ADMIN_CREDENTIAL_MODE: 'cert' },
    { FIREBASE_WIF_AUDIENCE: undefined },
    { FIREBASE_WIF_SERVICE_ACCOUNT_EMAIL: undefined },
    { FIREBASE_ADMIN_PROJECT_ID: 'demo-sarin' },
    { FIREBASE_ADMIN_PROJECT_ID: 'sarinbotsaas\n' },
    { FIREBASE_WIF_AUDIENCE: env.FIREBASE_WIF_AUDIENCE + '\n' },
    { FIREBASE_WIF_AUDIENCE: env.FIREBASE_WIF_AUDIENCE.replace('worker-oidc', 'other') },
    { FIREBASE_WIF_SERVICE_ACCOUNT_EMAIL: 'sarin-runtime@other-project.iam.gserviceaccount.com' },
    { GOOGLE_APPLICATION_CREDENTIALS: '/operator/credentials.json' },
    { CLOUDSDK_CONFIG: '/operator/gcloud' },
    { FIREBASE_ADMIN_PRIVATE_KEY: 'synthetic-private-value' },
    { FIREBASE_ADMIN_CLIENT_EMAIL: 'operator@example.invalid' },
    { FIRESTORE_EMULATOR_HOST: 'localhost:8080' },
    { FIREBASE_AUTH_EMULATOR_HOST: 'localhost:9099' },
  ])('rejects incomplete or mixed identity without returning input values: %j', overrides => {
    expect(() => credentials.createCloudflareCredentialConfiguration({ ...env, ...overrides })).toThrow(/^Configuración/);
  });

  it('writes a fresh private ADC file before returning an environment, without mutating the caller', async () => {
    const temporaryRoot = await mkdtemp(join(tmpdir(), 'sarin-adc-test-'));
    directories.push(temporaryRoot);
    const first = await credentials.prepareCloudflareEnvironment(env, temporaryRoot);
    const second = await credentials.prepareCloudflareEnvironment(env, temporaryRoot);
    expect(first.GOOGLE_CLOUD_PROJECT).toBe('sarinbotsaas');
    expect(first.GOOGLE_APPLICATION_CREDENTIALS).not.toBe(second.GOOGLE_APPLICATION_CREDENTIALS);
    expect(env).not.toHaveProperty('GOOGLE_APPLICATION_CREDENTIALS');
    expect(JSON.parse(await readFile(first.GOOGLE_APPLICATION_CREDENTIALS!, 'utf8'))).toEqual(credentials.createCloudflareCredentialConfiguration(env));
    if (process.platform !== 'win32') {
      expect((await stat(first.GOOGLE_APPLICATION_CREDENTIALS!)).mode & 0o777).toBe(0o600);
      expect((await stat(join(first.GOOGLE_APPLICATION_CREDENTIALS!, '..'))).mode & 0o777).toBe(0o700);
    }
  });

  it('starts the standalone server in the same PID only after ADC is available', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'sarin-startup-test-'));
    directories.push(directory);
    await writeFile(join(directory, 'server.js'), `const fs = require('node:fs');
      const adc = JSON.parse(fs.readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS, 'utf8'));
      fs.writeFileSync('started.json', JSON.stringify({pid:process.pid, project:process.env.GOOGLE_CLOUD_PROJECT, type:adc.type}));`);
    const result = await execute(process.execPath, [fileURLToPath(new URL('../scripts/container-start.mjs', import.meta.url))], {
      cwd: directory, env: { NODE_ENV: 'production', SystemRoot: process.env.SystemRoot, TEMP: directory, TMP: directory, TMPDIR: directory, ...env },
    });
    const started = JSON.parse(await readFile(join(directory, 'started.json'), 'utf8'));
    expect(started).toMatchObject({ project: 'sarinbotsaas', type: 'external_account' });
    expect(started.pid).toBeGreaterThan(0);
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe('');
  });

  it('does not load the server or leak invalid credential values on startup failure', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'sarin-startup-failure-'));
    directories.push(directory);
    await writeFile(join(directory, 'server.js'), "require('node:fs').writeFileSync('should-not-start', 'started');");
    const outcome = await execute(process.execPath, [fileURLToPath(new URL('../scripts/container-start.mjs', import.meta.url))], {
      cwd: directory, env: { NODE_ENV: 'production', SystemRoot: process.env.SystemRoot, ...env, FIREBASE_ADMIN_PRIVATE_KEY: 'DO-NOT-PRINT-SYNTHETIC' },
    }).then(() => null, error => error);
    expect(outcome?.code).toBe(1);
    expect(outcome?.stdout).toBe('');
    expect(outcome?.stderr).toBe('No se pudo iniciar el servidor de Sarin. Revisa la configuración del runtime.\n');
    await expect(stat(join(directory, 'should-not-start'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
