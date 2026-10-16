import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { LOCAL_FIREBASE_PROJECT_ID, LOCAL_FIREBASE_AUTH_HOST, LOCAL_FIREBASE_FIRESTORE_HOST, LOCAL_SUPERADMIN_UID } from '../../src/lib/firebase/emulator-constants.mjs';

const runPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const reservedPorts = new Set([8080, 9099, 4400, 4500]);
/** @param {number} port */
function assertPort(port) {
  if (!Number.isInteger(port) || port < 1024 || port > 65535 || reservedPorts.has(port)) throw new Error('Selecciona un puerto Next local válido, distinto de los emuladores.');
}
/** @param {string} runId */
function assertRun(runId) {
  if (!runPattern.test(runId)) throw new Error('La corrida debe tener un UUID v4 nuevo.');
}
/** @param {unknown} value @returns {Record<string, unknown>} */
function record(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }

/** The child process never inherits cloud credentials, proxies, env-file flags or Node preload hooks.
 * @param {Record<string, string | undefined>} input @param {number} port @param {string} runId
 * @returns {Record<string, string | undefined>}
 */
export function journeyEnvironment(input, port, runId) {
  assertPort(port); assertRun(runId);
  const env = {};
  for (const name of ['PATH', 'Path', 'SystemRoot', 'SYSTEMROOT', 'WINDIR', 'COMSPEC', 'TMP', 'TEMP', 'TMPDIR', 'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA']) if (input[name]) env[name] = input[name];
  return { ...env, NODE_ENV: 'test', NEXT_TELEMETRY_DISABLED: '1', CI: '1', NO_COLOR: '1',
    WHATSAPP_ENABLED: 'false', WHATSAPP_RETENTION_ENABLED: 'false', WHATSAPP_GRAPH_API_VERSION: 'v25.0',
    WHATSAPP_APP_SECRET: '', WHATSAPP_VERIFY_TOKEN: '', WHATSAPP_CONTENT_KEY: '', WHATSAPP_PHONE_CREDENTIALS_JSON: '',
    SARIN_LOCAL_JOURNEY: '1', SARIN_JOURNEY_PORT: String(port), SARIN_JOURNEY_RUN: runId,
    FIREBASE_ADMIN_PROJECT_ID: LOCAL_FIREBASE_PROJECT_ID, NEXT_PUBLIC_FIREBASE_PROJECT_ID: LOCAL_FIREBASE_PROJECT_ID,
    NEXT_PUBLIC_FIREBASE_EMULATORS: 'true', FIREBASE_AUTH_EMULATOR_HOST: LOCAL_FIREBASE_AUTH_HOST,
    FIRESTORE_EMULATOR_HOST: LOCAL_FIREBASE_FIRESTORE_HOST,
    NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST: LOCAL_FIREBASE_AUTH_HOST, NEXT_PUBLIC_FIRESTORE_EMULATOR_HOST: LOCAL_FIREBASE_FIRESTORE_HOST,
    SUPERADMIN_UID: LOCAL_SUPERADMIN_UID,
  };
}

/** @param {Record<string, string | undefined>} env */
export function assertJourneyEnvironment(env) {
  const required = { SARIN_LOCAL_JOURNEY: '1', NODE_ENV: 'test', FIREBASE_ADMIN_PROJECT_ID: LOCAL_FIREBASE_PROJECT_ID,
    WHATSAPP_ENABLED: 'false', WHATSAPP_RETENTION_ENABLED: 'false',
    NEXT_PUBLIC_FIREBASE_PROJECT_ID: LOCAL_FIREBASE_PROJECT_ID, NEXT_PUBLIC_FIREBASE_EMULATORS: 'true',
    FIREBASE_AUTH_EMULATOR_HOST: LOCAL_FIREBASE_AUTH_HOST, FIRESTORE_EMULATOR_HOST: LOCAL_FIREBASE_FIRESTORE_HOST,
    NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST: LOCAL_FIREBASE_AUTH_HOST, NEXT_PUBLIC_FIRESTORE_EMULATOR_HOST: LOCAL_FIREBASE_FIRESTORE_HOST,
    SUPERADMIN_UID: LOCAL_SUPERADMIN_UID };
  for (const [name, expected] of Object.entries(required)) if (env[name] !== expected) throw new Error(`Ensayo local deshabilitado: configuración inválida de ${name}.`);
  assertRun(env.SARIN_JOURNEY_RUN ?? '');
  if (!/^\d+$/.test(env.SARIN_JOURNEY_PORT ?? '')) throw new Error('Falta el puerto local del ensayo.');
  assertPort(Number(env.SARIN_JOURNEY_PORT));
  for (const name of ['WHATSAPP_APP_SECRET', 'WHATSAPP_VERIFY_TOKEN', 'WHATSAPP_CONTENT_KEY', 'WHATSAPP_PHONE_CREDENTIALS_JSON']) if (env[name]) throw new Error(`No se admite ${name} en el ensayo local.`);
  for (const name of ['FIREBASE_ADMIN_PRIVATE_KEY', 'FIREBASE_ADMIN_CLIENT_EMAIL', 'GOOGLE_APPLICATION_CREDENTIALS', 'FIREBASE_TOKEN', 'GOOGLE_CLOUD_PROJECT', 'GCLOUD_PROJECT', 'FIREBASE_CONFIG', 'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NODE_OPTIONS', 'SARIN_TUNNEL_URL', 'CF_ACCESS_CLIENT_ID', 'CF_ACCESS_CLIENT_SECRET', 'SARIN_CHAT_PROVIDER', 'DEEPSEEK_API_KEY', 'DEEPSEEK_MODEL']) if (env[name]) throw new Error(`No se admite ${name} en el ensayo local.`);
}

/** Reject DNS, alternate ports, credentials, SSL endpoints and redirect targets before fetch.
 * @param {string} value @param {number} port @returns {string}
 */
export function assertJourneyUrl(value, port) {
  assertPort(port);
  let url;
  try { url = new URL(value); } catch { throw new Error('El ensayo solo admite URLs loopback explícitas.'); }
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.username || url.password || url.hash || ![port, 9099, 8080, 4400].includes(Number(url.port))) throw new Error('El ensayo solo admite sus endpoints loopback explícitos.');
  return url.href;
}

/** @param {unknown} inventory */
export function assertEmulatorInventory(inventory) {
  const data = record(inventory);
  for (const [name, port] of [['auth', 9099], ['firestore', 8080]]) {
    const endpoint = record(data[name]);
    if (endpoint.host !== '127.0.0.1' || endpoint.port !== port) throw new Error('Inicia Auth y Firestore oficiales con pnpm run dev:local.');
  }
}

/** @param {string} runId */
export function createJourneyFixture(runId) {
  assertRun(runId);
  const prefix = `journey-${runId}`;
  const ownerUid = `${prefix}-owner`;
  return { runId, slug: prefix, ownerUid, clientUid: `${prefix}-client`, otherOwnerUid: `${prefix}-other-owner`,
    businessId: `b_${createHash('sha256').update(ownerUid).digest('hex').slice(0, 32)}`,
    accounts: ['owner', 'client', 'other-owner'].map(role => ({ uid: `${prefix}-${role}`, role, email: `${prefix}-${role}@example.test`, displayName: `Ensayo sintético ${role}`, providerUid: `${prefix}-${role}-google` })),
    bank: { id: prefix, bankName: 'Banco sintético del ensayo', accountType: 'Ensayo local', accountNumber: 'SIN-CUENTA-REAL', holderName: prefix },
  };
}

/** Validate the complete deletion plan before any side effect. A child collection requires
 * its proven synthetic parent, and neither arbitrary paths nor the fixed admin UID are allowed.
 * @param {{path: string, data: Record<string, unknown>}[]} records
 * @param {ReturnType<typeof createJourneyFixture>} fixture
 * @param {(path: string) => Promise<void>} remove
 */
export async function cleanupOwnedDocuments(records, fixture, remove) {
  assertRun(fixture.runId);
  const canonical = createJourneyFixture(fixture.runId);
  if (fixture.ownerUid !== canonical.ownerUid || fixture.businessId !== canonical.businessId || fixture.slug !== canonical.slug) throw new Error('El manifiesto de limpieza no pertenece a esta corrida.');
  const uids = canonical.accounts.map(account => account.uid);
  const parentPath = `businesses/${canonical.businessId}`;
  const quotaScopePath = `responseQuotaScopes/business_${canonical.businessId}`;
  const ownsParent = records.some(item => item.path === parentPath && item.data.ownerUid === canonical.ownerUid && item.data.slug === canonical.slug);
  for (const { path, data } of records) {
    const parts = path.split('/');
    const allowed = parts.length === 2 && (
      (parts[0] === 'users' && uids.includes(parts[1]) && (data.uid === parts[1] || (parts[1] === canonical.ownerUid && data.ownedTenantId === canonical.businessId)))
      || (path === parentPath && data.ownerUid === canonical.ownerUid && data.slug === canonical.slug)
      || (path === quotaScopePath && ownsParent)
      || (path === `publicBusinesses/${canonical.slug}` && data.id === canonical.businessId && data.slug === canonical.slug)
      || (path === `businessSlugs/${canonical.slug}` && data.ownerUid === canonical.ownerUid && data.businessId === canonical.businessId)
      || (parts[0] === 'paymentReceipts' && data.ownerUid === canonical.ownerUid && data.tenantId === canonical.businessId)
      || (parts[0] === 'paymentImages' && data.ownerUid === canonical.ownerUid)
    ) || parts.length === 4 && ownsParent && `${parts[0]}/${parts[1]}` === parentPath && (
      parts[2] === 'bookingLocks' || parts[2] === 'appointments' && data.tenantId === canonical.businessId && (uids.includes(String(record(data.client).uid)) || data.type === 'manual_block' && data.createdBy === 'manual_panel')
    ) || parts.length === 4 && ownsParent && `${parts[0]}/${parts[1]}` === quotaScopePath && parts[2] === 'periods' && data.id === parts[3];
    if (!allowed || parts.some(part => !/^[A-Za-z0-9_-]+$/.test(part))) throw new Error(`Limpieza rechazada para un documento ajeno: ${path}.`);
  }
  for (const { path } of records) await remove(path);
}

/** @param {Record<string, unknown>} data @param {ReturnType<typeof createJourneyFixture>['bank']} bank @param {boolean} created */
export function removeJourneyBank(data, bank, created) {
  if (!Array.isArray(data.bankAccounts)) throw new Error('La configuración bancaria cambió durante el ensayo.');
  const existing = data.bankAccounts.find(account => record(account).id === bank.id);
  if (!existing) return { action: 'none' };
  if (!isDeepStrictEqual(existing, bank)) throw new Error('La cuenta sintética cambió; se preservó la configuración para revisión.');
  const remaining = data.bankAccounts.filter(account => record(account).id !== bank.id);
  return created && remaining.length === 0 && Object.keys(data).every(key => key === 'bankAccounts') ? { action: 'delete' } : { action: 'update', bankAccounts: remaining };
}
