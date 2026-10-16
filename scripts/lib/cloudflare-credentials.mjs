import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const identityKeys = ['FIREBASE_WIF_AUDIENCE', 'FIREBASE_WIF_SERVICE_ACCOUNT_EMAIL'];
const incompatibleKeys = ['GOOGLE_APPLICATION_CREDENTIALS', 'CLOUDSDK_CONFIG', 'FIREBASE_ADMIN_CLIENT_EMAIL', 'FIREBASE_ADMIN_PRIVATE_KEY', 'FIREBASE_AUTH_EMULATOR_HOST', 'FIRESTORE_EMULATOR_HOST', 'NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST', 'NEXT_PUBLIC_FIRESTORE_EMULATOR_HOST'];
const invalidConfiguration = () => new Error('Configuración de identidad Cloudflare inválida.');

/** Materialize only an external_account configuration, never an access token or key.
 * Without WIF settings the existing VPS/cert entrypoint remains usable for rollback.
 * @param {Record<string, string | undefined>} env
 */
export function createCloudflareCredentialConfiguration(env) {
  if (!identityKeys.some(key => Boolean(env[key]))) return null;
  const project = env.FIREBASE_ADMIN_PROJECT_ID ?? '';
  const audience = env.FIREBASE_WIF_AUDIENCE ?? '';
  const account = env.FIREBASE_WIF_SERVICE_ACCOUNT_EMAIL ?? '';
  const values = [project, audience, account];
  if (env.FIREBASE_ADMIN_CREDENTIAL_MODE !== 'adc'
    || incompatibleKeys.some(key => Boolean(env[key]))
    || env.NEXT_PUBLIC_FIREBASE_EMULATORS === 'true'
    || values.some(value => value.trim() !== value || /[\r\n\0]/.test(value))
    || !/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(project) || project.startsWith('demo-')
    || !/^\/\/iam\.googleapis\.com\/projects\/[1-9][0-9]*\/locations\/global\/workloadIdentityPools\/sarin-cloudflare\/providers\/worker-oidc$/.test(audience)
    || account !== `sarin-runtime@${project}.iam.gserviceaccount.com`) throw invalidConfiguration();
  return {
    type: 'external_account',
    audience,
    subject_token_type: 'urn:ietf:params:oauth:token-type:jwt',
    token_url: 'https://sts.googleapis.com/v1/token',
    service_account_impersonation_url: `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${account}:generateAccessToken`,
    credential_source: { url: 'http://sarin-google.internal/token', format: { type: 'json', subject_token_field_name: 'subject_token' } },
  };
}

/** @param {Record<string, string | undefined>} input @param {string} [temporaryRoot]
 * @returns {Promise<Record<string, string | undefined>>}
 */
export async function prepareCloudflareEnvironment(input, temporaryRoot = tmpdir()) {
  const configuration = createCloudflareCredentialConfiguration(input);
  if (!configuration) return { ...input };
  const directory = await mkdtemp(join(temporaryRoot, 'sarin-google-'));
  const credentialPath = join(directory, 'adc.json');
  await writeFile(credentialPath, JSON.stringify(configuration), { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  return { ...input, GOOGLE_APPLICATION_CREDENTIALS: credentialPath, GOOGLE_CLOUD_PROJECT: input.FIREBASE_ADMIN_PROJECT_ID };
}
