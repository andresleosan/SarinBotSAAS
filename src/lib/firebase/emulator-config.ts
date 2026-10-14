/** Local-only Firebase configuration. This module has no environment side effects. */
import {
  LOCAL_FIREBASE_PROJECT_ID,
  LOCAL_FIREBASE_AUTH_HOST,
  LOCAL_FIREBASE_FIRESTORE_HOST,
} from "./emulator-constants.mjs";
export {
  LOCAL_FIREBASE_PROJECT_ID,
  LOCAL_FIREBASE_AUTH_HOST,
  LOCAL_FIREBASE_FIRESTORE_HOST,
  LOCAL_SUPERADMIN_UID,
} from "./emulator-constants.mjs";

export interface FirebaseEmulatorEnvironment {
  NODE_ENV?: string;
  NEXT_PUBLIC_FIREBASE_EMULATORS?: string;
  NEXT_PUBLIC_FIREBASE_PROJECT_ID?: string;
  NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST?: string;
  NEXT_PUBLIC_FIRESTORE_EMULATOR_HOST?: string;
  FIREBASE_ADMIN_PROJECT_ID?: string;
  FIREBASE_AUTH_EMULATOR_HOST?: string;
  FIRESTORE_EMULATOR_HOST?: string;
}

interface LocalEndpoint {
  host: string;
  port: number;
  authority: string;
}
export interface FirebaseEmulatorConfig {
  projectId: string;
  auth: LocalEndpoint;
  firestore: LocalEndpoint;
}

function emulatorFlag(value: string | undefined): boolean {
  if (value === undefined || value === "" || value === "false") return false;
  if (value !== "true")
    throw new Error(
      "El indicador de emuladores Firebase debe ser true o false.",
    );
  return true;
}

function demoProjectId(value: string | undefined): string {
  if (!value || !/^demo-[a-z0-9](?:[a-z0-9-]{0,23}[a-z0-9])?$/.test(value)) {
    throw new Error(
      "Los emuladores requieren un proyecto aislado con prefijo demo-.",
    );
  }
  return value;
}

function loopbackEndpoint(value: string): LocalEndpoint {
  // Accept literal loopback endpoints only, never URLs, credentials, LAN
  // addresses or hostnames whose DNS could route unsigned tokens elsewhere.
  const match = /^(127\.0\.0\.1|localhost|\[::1\]):([0-9]{1,5})$/.exec(value);
  const port = match ? Number(match[2]) : 0;
  if (!match || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(
      "Los emuladores Firebase deben usar un host loopback y un puerto válido.",
    );
  }
  return { host: match[1], port, authority: `${match[1]}:${port}` };
}

export function readClientEmulatorConfig(
  env: FirebaseEmulatorEnvironment,
): FirebaseEmulatorConfig | null {
  if (!emulatorFlag(env.NEXT_PUBLIC_FIREBASE_EMULATORS)) return null;
  if (env.NODE_ENV !== "development")
    throw new Error(
      "Los emuladores del cliente solo están permitidos en desarrollo.",
    );
  return {
    projectId: demoProjectId(
      env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || LOCAL_FIREBASE_PROJECT_ID,
    ),
    auth: loopbackEndpoint(
      env.NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST || LOCAL_FIREBASE_AUTH_HOST,
    ),
    firestore: loopbackEndpoint(
      env.NEXT_PUBLIC_FIRESTORE_EMULATOR_HOST || LOCAL_FIREBASE_FIRESTORE_HOST,
    ),
  };
}

export function readAdminEmulatorConfig(
  env: FirebaseEmulatorEnvironment,
): FirebaseEmulatorConfig | null {
  const enabled = emulatorFlag(env.NEXT_PUBLIC_FIREBASE_EMULATORS);
  const hasAuth = env.FIREBASE_AUTH_EMULATOR_HOST !== undefined;
  const hasFirestore = env.FIRESTORE_EMULATOR_HOST !== undefined;
  if (!enabled && !hasAuth && !hasFirestore) return null;
  if (env.NODE_ENV !== "development" && env.NODE_ENV !== "test") {
    throw new Error(
      "Los emuladores del servidor solo están permitidos en desarrollo o pruebas.",
    );
  }
  if (!env.FIREBASE_AUTH_EMULATOR_HOST || !env.FIRESTORE_EMULATOR_HOST) {
    throw new Error(
      "Configura juntos los emuladores Auth y Firestore; no se permite una conexión parcial.",
    );
  }
  const config = {
    projectId: demoProjectId(env.FIREBASE_ADMIN_PROJECT_ID),
    auth: loopbackEndpoint(env.FIREBASE_AUTH_EMULATOR_HOST),
    firestore: loopbackEndpoint(env.FIRESTORE_EMULATOR_HOST),
  };
  if (enabled) {
    const client = readClientEmulatorConfig({
      ...env,
      NODE_ENV: "development",
    });
    if (
      !client ||
      client.projectId !== config.projectId ||
      client.auth.authority !== config.auth.authority ||
      client.firestore.authority !== config.firestore.authority
    ) {
      throw new Error(
        "El cliente y el servidor deben usar el mismo proyecto y emuladores locales.",
      );
    }
  }
  return config;
}
