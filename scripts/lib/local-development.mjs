import { LOCAL_FIREBASE_AUTH_HOST, LOCAL_FIREBASE_FIRESTORE_HOST, LOCAL_FIREBASE_PROJECT_ID, LOCAL_SUPERADMIN_UID } from '../../src/lib/firebase/emulator-constants.mjs';
import path from 'node:path';

/** @param {Record<string, string | undefined>} input
 * @returns {Record<string, string | undefined>}
 */
export function localDevelopmentEnvironment(input) {
  const env = { ...input };
  for (const name of ['FIREBASE_TOKEN','GOOGLE_APPLICATION_CREDENTIALS','FIREBASE_CONFIG','GOOGLE_CLOUD_PROJECT','GCLOUD_PROJECT','FIREBASE_ADMIN_PRIVATE_KEY','FIREBASE_ADMIN_CLIENT_EMAIL','DEBUG','FIREBASE_DEBUG_PATH']) delete env[name];
  for (const name of Object.keys(env)) if (name.startsWith('WHATSAPP_')) delete env[name];
  return {
    ...env, NODE_ENV:'development', NEXT_TELEMETRY_DISABLED:'1', CI:'1',
    SARIN_DATA_BACKEND:'firestore', SARIN_MAINTENANCE:'false', SARIN_PUBLIC_BOOKING_ORIGIN:'', PILOT_AI_BUDGET_ENFORCED:'false',
    // Explicit values also prevent Next's dotenv loading from enabling cloud inference.
    SARIN_CHAT_PROVIDER:'ollama', DEEPSEEK_API_KEY:'', DEEPSEEK_MODEL:'',
    GEMINI_API_KEY:'', GEMINI_MODEL:'', GEMINI_BILLING_VERIFIED:'false',
    GEMINI_TEST_API_KEY:'', GEMINI_TEST_MODEL:'',
    WHATSAPP_ENABLED:'false', WHATSAPP_RETENTION_ENABLED:'false', WHATSAPP_GRAPH_API_VERSION:'v25.0',
    WHATSAPP_APP_SECRET:'', WHATSAPP_VERIFY_TOKEN:'', WHATSAPP_CONTENT_KEY:'', WHATSAPP_PHONE_CREDENTIALS_JSON:'',
    NEXT_PUBLIC_FIREBASE_EMULATORS:'true',
    NEXT_PUBLIC_FIREBASE_API_KEY:'sarin-local-emulator-only',
    NEXT_PUBLIC_FIREBASE_APP_ID:'sarin-local-emulator-only',
    NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN:'127.0.0.1',
    NEXT_PUBLIC_FIREBASE_PROJECT_ID:LOCAL_FIREBASE_PROJECT_ID,
    NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST:LOCAL_FIREBASE_AUTH_HOST,
    NEXT_PUBLIC_FIRESTORE_EMULATOR_HOST:LOCAL_FIREBASE_FIRESTORE_HOST,
    FIREBASE_ADMIN_PROJECT_ID:LOCAL_FIREBASE_PROJECT_ID,
    FIREBASE_AUTH_EMULATOR_HOST:LOCAL_FIREBASE_AUTH_HOST,
    FIRESTORE_EMULATOR_HOST:LOCAL_FIREBASE_FIRESTORE_HOST,
    SUPERADMIN_UID:LOCAL_SUPERADMIN_UID,
  };
}

/** @param {string[]} args */
export function parseLocalArguments(args) {
  let port = 3030; let help = false;
  for (let index=0; index<args.length; index++) {
    if (args[index]==='--help' || args[index]==='-h') { help=true; continue; }
    if (args[index]!=='--port') throw new Error('Solo se admite --port NUMERO o --help.');
    const value=args[++index];
    if (!value || !/^\d+$/.test(value)) throw new Error('Indica un puerto numérico.');
    port=Number(value);
    if (port<1024 || port>65535) throw new Error('El puerto debe estar entre 1024 y 65535.');
  }
  return {port,help};
}

/** @param {string} output */
export function javaMajorVersion(output) {
  const match=/(?:openjdk|java)(?: version)?\s+"?(\d+)(?:\.(\d+))?/i.exec(output);
  return match ? (Number(match[1])===1 ? Number(match[2]) : Number(match[1])) : null;
}

/** Resolve pnpm's actual CLI from its standard lifecycle environment. Scripts
 * must not treat npm_execpath as npm: pnpm supplies this variable too.
 * @param {Record<string, string | undefined>} env
 * @param {string} root @param {string} nodeBinary
 */
export function pnpmFirebaseInvocation(env, root, nodeBinary) {
  const cli = env.npm_execpath ?? '';
  const manager = /^pnpm\/11\.23\.0(?:\s|$)/.test(env.npm_config_user_agent ?? '');
  const absolute = cli && (path.posix.isAbsolute(cli) || path.win32.isAbsolute(cli));
  const name = cli ? cli.replaceAll('\\', '/').split('/').at(-1) : '';
  if (!manager || !absolute || /[\r\n\0]/.test(cli) || !/^pnpm(?:\.mjs|\.cjs|\.js|\.exe)?$/i.test(name)) throw new Error('Inicia con pnpm 11.23.0: pnpm run dev:local. Se requiere su CLI real, sin wrappers de shell.');
  const javascript = /\.(mjs|cjs|js)$/i.test(name);
  const prefix = javascript ? [cli] : [];
  const paths = /^(?:[A-Za-z]:[\\/]|\\\\)/.test(root) ? path.win32 : path.posix;
  return {
    command: javascript ? nodeBinary : cli,
    versionArgs: [...prefix, '--version'],
    args: [...prefix, 'dlx', '--allow-build=protobufjs', 'firebase-tools@15.33.0', 'emulators:start', '--only', 'auth,firestore', '--project', LOCAL_FIREBASE_PROJECT_ID, '--config', paths.join(root, 'firebase.json'), '--non-interactive'],
  };
}
