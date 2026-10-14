import "server-only";
import { cert, getApps, initializeApp, type App } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { readAdminEmulatorConfig } from "@/lib/firebase/emulator-config";
const state = globalThis as typeof globalThis & {
  __sarinAdminConnections?: WeakMap<App, string>;
};

function getAdminApp() {
  // Admin SDK automatically accepts unsigned Auth tokens when its emulator
  // environment variable exists. Validate before returning even a cached app.
  const emulator = readAdminEmulatorConfig(process.env);
  const projectId = process.env.FIREBASE_ADMIN_PROJECT_ID;
  if (!projectId) throw new Error("Firebase Admin no está configurado.");
  if (!emulator && projectId.startsWith("demo-"))
    throw new Error("El proyecto demo requiere los emuladores locales.");
  const connections = (state.__sarinAdminConnections ??= new WeakMap());
  const fingerprint = JSON.stringify({ projectId, emulator });
  const existing = getApps().find((app) => app.name === "sarin-admin");
  if (existing) {
    if (
      existing.options.projectId !== projectId ||
      connections.get(existing) !== fingerprint
    )
      throw new Error(
        "La configuración Firebase Admin cambió. Reinicia el servidor.",
      );
    return existing;
  }
  const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(
    /\\n/g,
    "\n",
  );
  if (emulator) {
    const app = initializeApp({ projectId: emulator.projectId }, "sarin-admin");
    connections.set(app, fingerprint);
    return app;
  }
  if (!clientEmail || !privateKey)
    throw new Error("Firebase Admin no está configurado.");
  const app = initializeApp(
    { projectId, credential: cert({ projectId, clientEmail, privateKey }) },
    "sarin-admin",
  );
  connections.set(app, fingerprint);
  return app;
}
export function getAdminAuth() {
  return getAuth(getAdminApp());
}
export function getAdminDb() {
  return getFirestore(getAdminApp());
}
