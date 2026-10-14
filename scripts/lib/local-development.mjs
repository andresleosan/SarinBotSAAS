import { LOCAL_FIREBASE_AUTH_HOST, LOCAL_FIREBASE_FIRESTORE_HOST, LOCAL_FIREBASE_PROJECT_ID, LOCAL_SUPERADMIN_UID } from '../../src/lib/firebase/emulator-constants.mjs';

/** @param {Record<string, string | undefined>} input
 * @returns {Record<string, string | undefined>}
 */
export function localDevelopmentEnvironment(input) {
  const env = { ...input };
  for (const name of ['FIREBASE_TOKEN','GOOGLE_APPLICATION_CREDENTIALS','FIREBASE_CONFIG','GOOGLE_CLOUD_PROJECT','GCLOUD_PROJECT','FIREBASE_ADMIN_PRIVATE_KEY','FIREBASE_ADMIN_CLIENT_EMAIL','DEBUG','FIREBASE_DEBUG_PATH']) delete env[name];
  return {
    ...env, NODE_ENV:'development', NEXT_TELEMETRY_DISABLED:'1', CI:'1',
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
