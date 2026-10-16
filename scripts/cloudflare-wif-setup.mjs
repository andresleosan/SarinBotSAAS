import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const PROJECT = 'sarinbotsaas';
const PROJECT_NUMBER = '153690559048';
const POOL = 'sarin-cloudflare';
const PROVIDER = 'worker-oidc';
const POOL_NAME = `projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL}`;
const PROVIDER_NAME = `${POOL_NAME}/providers/${PROVIDER}`;
const AUDIENCE = `//iam.googleapis.com/${PROVIDER_NAME}`;
const ISSUER = 'https://sarinbotsaas.pages.dev';
const SUBJECT = 'sarin-cloudflare-production';
const SERVICE_ACCOUNT = 'sarin-runtime@sarinbotsaas.iam.gserviceaccount.com';
const MEMBER = `principal://iam.googleapis.com/${POOL_NAME}/subject/${SUBJECT}`;
const ROLE = 'roles/iam.workloadIdentityUser';
const CONDITION = `assertion.iss == '${ISSUER}' && assertion.sub == '${SUBJECT}' && assertion.aud == '${AUDIENCE}'`;
const REQUIRED_APIS = ['iam.googleapis.com', 'iamcredentials.googleapis.com', 'sts.googleapis.com', 'cloudresourcemanager.googleapis.com'];
const PROJECT_ARGS = [`--project=${PROJECT}`, `--billing-project=${PROJECT}`, '--format=json'];
const POOL_ARGS = ['--location=global', `--workload-identity-pool=${POOL}`];
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const command = (id, args) => ({ id, executable: 'gcloud', args: [...args, ...PROJECT_ARGS] });

function expectedConfiguration() {
  return {
    project: { projectId: PROJECT, projectNumber: PROJECT_NUMBER },
    pool: { name: POOL_NAME, state: 'ACTIVE', disabled: false },
    provider: {
      name: PROVIDER_NAME,
      state: 'ACTIVE', disabled: false,
      oidc: { issuerUri: ISSUER, allowedAudiences: [AUDIENCE] },
      attributeMapping: { 'google.subject': 'assertion.sub' },
      attributeCondition: CONDITION,
    },
    serviceAccount: SERVICE_ACCOUNT,
    serviceAccountBinding: { role: ROLE, member: MEMBER },
  };
}

function inspectionCommands() {
  return [
    command('project', ['projects', 'describe', PROJECT]),
    command('enabledServices', ['services', 'list', '--enabled']),
    command('serviceAccount', ['iam', 'service-accounts', 'describe', SERVICE_ACCOUNT]),
    command('pool', ['iam', 'workload-identity-pools', 'describe', POOL, '--location=global']),
    command('providers', ['iam', 'workload-identity-pools', 'providers', 'list', ...POOL_ARGS]),
    command('serviceAccountPolicy', ['iam', 'service-accounts', 'get-iam-policy', SERVICE_ACCOUNT]),
  ];
}

function reviewSnapshot(snapshot) {
  const blockers = [];
  const required = ['project', 'serviceAccount', 'enabledServices', 'pool', 'providers', 'serviceAccountPolicy'];
  if (!object(snapshot) || required.some(name => !Object.hasOwn(snapshot, name))) {
    return { blockers: ['El snapshot debe incluir todos los resultados de inspección; la ausencia de campos no demuestra que un recurso no exista.'] };
  }
  if (!object(snapshot.project) || snapshot.project.projectId !== PROJECT || String(snapshot.project.projectNumber) !== PROJECT_NUMBER || (snapshot.project.lifecycleState !== undefined && snapshot.project.lifecycleState !== 'ACTIVE')) blockers.push('La identidad o el estado del proyecto no coincide.');
  if (!object(snapshot.serviceAccount) || snapshot.serviceAccount.email !== SERVICE_ACCOUNT || ![undefined, false].includes(snapshot.serviceAccount.disabled)) blockers.push('La cuenta de servicio existente no coincide o está deshabilitada.');
  if (!Array.isArray(snapshot.enabledServices) || snapshot.enabledServices.some(service => !object(service?.config) || typeof service.config.name !== 'string')) blockers.push('Falta una lista válida de APIs habilitadas.');
  if (!Array.isArray(snapshot.providers)) blockers.push('Falta la inspección de todos los proveedores del pool.');
  if (snapshot.pool !== null && (!object(snapshot.pool) || snapshot.pool.name !== POOL_NAME || snapshot.pool.state !== 'ACTIVE' || ![undefined, false].includes(snapshot.pool.disabled))) blockers.push('El pool existente difiere del destino activo esperado; no se reemplaza ni se elimina.');
  if (snapshot.pool === null && Array.isArray(snapshot.providers) && snapshot.providers.length > 0) blockers.push('El snapshot declara un pool ausente con proveedores existentes.');

  const providers = Array.isArray(snapshot.providers) ? snapshot.providers : [];
  // IAM subjects share the whole pool namespace, so another provider could assert the same subject.
  if (providers.some(provider => !object(provider) || provider.name !== PROVIDER_NAME) || providers.length > 1) blockers.push('El pool contiene otro proveedor o una lista ambigua; la confianza por sujeto necesita revisión manual.');
  const provider = providers.find(candidate => candidate?.name === PROVIDER_NAME);
  if (provider && (provider.state !== 'ACTIVE' || ![undefined, false].includes(provider.disabled) || !object(provider.oidc) || provider.oidc.issuerUri !== ISSUER || !Array.isArray(provider.oidc.allowedAudiences) || provider.oidc.allowedAudiences.length !== 1 || provider.oidc.allowedAudiences[0] !== AUDIENCE || (provider.oidc.jwksJson !== undefined && provider.oidc.jwksJson !== '') || !object(provider.attributeMapping) || Object.keys(provider.attributeMapping).length !== 1 || provider.attributeMapping['google.subject'] !== 'assertion.sub' || provider.attributeCondition !== CONDITION || ['aws', 'saml', 'x509'].some(name => provider[name] !== undefined))) blockers.push('El proveedor existente difiere en issuer, audiencia, sujeto, condición o fuente JWKS; no se sobrescribe.');

  let hasGrant = false;
  const policy = snapshot.serviceAccountPolicy;
  if (!object(policy) || !Array.isArray(policy.bindings) || policy.bindings.some(binding => !object(binding) || typeof binding.role !== 'string' || !Array.isArray(binding.members) || binding.members.some(member => typeof member !== 'string'))) {
    blockers.push('Falta una política IAM válida de la cuenta de servicio.');
  } else {
    for (const binding of policy.bindings) {
      for (const member of binding.members) {
        const samePool = member.startsWith(`principal://iam.googleapis.com/${POOL_NAME}/`) || member.startsWith(`principalSet://iam.googleapis.com/${POOL_NAME}/`);
        if (!samePool) continue;
        if (member !== MEMBER || binding.role !== ROLE || binding.condition !== undefined) blockers.push('Existe acceso del pool más amplio, distinto o condicionado; debe revisarse antes de añadir confianza.');
        else hasGrant = true;
      }
    }
  }
  return { blockers: [...new Set(blockers)], provider, hasGrant };
}

/** Produces reviewable arguments only. This module never starts gcloud or sends a network request. */
export function planWifSetup({ snapshot } = {}) {
  const plan = {
    mode: 'plan-only', remoteCommandsExecuted: false,
    status: 'inspection-required', expected: expectedConfiguration(),
    inspection: inspectionCommands(), blockers: [], changes: [],
    instructions: [
      'Este archivo es un plan local. No existe modo apply y no se ejecuta gcloud.',
      'Ejecuta primero los comandos de inspection como executable + args, sin shell, con una sesión Google autorizada; conserva los JSON fuera de Git.',
      'Todos los comandos fijan el proyecto del recurso y el de cuota/facturación en sarinbotsaas; no dependen del proyecto activo de gcloud ni requieren ampliar roles para otro proyecto.',
      'Forma un snapshot JSON con las claves project, serviceAccount, enabledServices, pool, providers y serviceAccountPolicy usando la salida de cada comando homónimo.',
      'Usa pool:null y providers:[] solo tras confirmar NOT_FOUND del pool; un error de permisos, autenticación o red nunca significa ausencia.',
      'Genera la revisión con node scripts/cloudflare-wif-setup.mjs --snapshot <archivo> --output <archivo-nuevo>. El destino existente nunca se sobrescribe.',
      'Antes de ejecutar cualquier cambio propuesto, vuelve a cotejar el snapshot con Google y verifica discovery/JWKS públicos en el issuer exacto. Revisa cambios y presupuesto con el responsable.',
      'Los cambios son aditivos. Conserva la confianza anterior, la cuenta y sus permisos Firebase; no se crean claves Google ni se elimina o reemplaza ningún pool, proveedor o política.',
    ],
    references: [
      'https://cloud.google.com/iam/docs/workload-identity-federation-with-other-providers',
      'https://cloud.google.com/sdk/gcloud/reference/iam/workload-identity-pools/providers/create-oidc',
      'https://cloud.google.com/sdk/gcloud/reference/iam/service-accounts/add-iam-policy-binding',
    ],
  };
  if (snapshot === undefined) return plan;
  const review = reviewSnapshot(snapshot);
  plan.blockers = review.blockers;
  if (plan.blockers.length > 0) { plan.status = 'blocked'; return plan; }
  const enabled = new Set(snapshot.enabledServices.map(service => service.config.name));
  const missing = REQUIRED_APIS.filter(api => !enabled.has(api));
  if (missing.length) plan.changes.push(command('enable-required-apis', ['services', 'enable', ...missing]));
  if (snapshot.pool === null) plan.changes.push(command('create-pool', ['iam', 'workload-identity-pools', 'create', POOL, '--location=global', '--display-name=Sarin Cloudflare']));
  if (!review.provider) plan.changes.push(command('create-provider', ['iam', 'workload-identity-pools', 'providers', 'create-oidc', PROVIDER, ...POOL_ARGS, `--issuer-uri=${ISSUER}`, `--allowed-audiences=${AUDIENCE}`, '--attribute-mapping=google.subject=assertion.sub', `--attribute-condition=${CONDITION}`]));
  if (!review.hasGrant) plan.changes.push(command('grant-runtime-impersonation', ['iam', 'service-accounts', 'add-iam-policy-binding', SERVICE_ACCOUNT, `--member=${MEMBER}`, `--role=${ROLE}`, '--condition=None']));
  plan.status = plan.changes.length ? 'ready-for-review' : 'already-configured';
  return plan;
}

async function main(args) {
  if (args.length === 1 && args[0] === '--help') {
    console.log('Plan local sin ejecución remota: node scripts/cloudflare-wif-setup.mjs [--snapshot archivo.json] [--output archivo-nuevo.json]');
    return;
  }
  const options = {};
  for (let index = 0; index < args.length; index += 2) {
    const option = args[index];
    if (!['--snapshot', '--output'].includes(option) || options[option] !== undefined || !args[index + 1] || args[index + 1].startsWith('--')) throw new Error('Usa únicamente --snapshot y --output, cada uno con un archivo. No existe modo apply.');
    options[option] = args[index + 1];
  }
  let snapshot;
  if (options['--snapshot']) {
    let content;
    try { content = await readFile(options['--snapshot'], 'utf8'); }
    catch { throw new Error('No se pudo leer el snapshot local.'); }
    try { snapshot = JSON.parse(content); }
    catch { throw new Error('El snapshot no es JSON válido.'); }
  }
  const plan = planWifSetup({ snapshot });
  const output = JSON.stringify(plan, null, 2) + '\n';
  if (options['--output']) {
    try { await writeFile(options['--output'], output, { flag: 'wx', mode: 0o600 }); }
    catch { throw new Error('No se creó la revisión: el destino debe ser nuevo y escribible.'); }
  } else process.stdout.write(output);
  if (plan.status === 'blocked') process.exitCode = 2;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
}
