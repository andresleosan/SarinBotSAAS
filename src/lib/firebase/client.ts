"use client";

import { initializeApp, getApps, type FirebaseApp } from "firebase/app";
import {
  connectAuthEmulator,
  getAuth,
  GoogleAuthProvider,
  type Auth,
} from "firebase/auth";
import {
  connectFirestoreEmulator,
  getFirestore,
  type Firestore,
} from "firebase/firestore";
import { readClientEmulatorConfig } from "@/lib/firebase/emulator-config";

interface ClientConnection {
  fingerprint: string;
  auth: Auth;
  db: Firestore;
  authConnected: boolean;
  firestoreConnected: boolean;
}
const state = globalThis as typeof globalThis & {
  __sarinFirebaseClientConnections?: WeakMap<FirebaseApp, ClientConnection>;
};
/** Lazy initialization permits building without live credentials. */
export function getFirebaseClient() {
  // Explicit property access lets Next inline only the intended public values.
  const emulator = readClientEmulatorConfig({
    NODE_ENV: process.env.NODE_ENV,
    NEXT_PUBLIC_FIREBASE_EMULATORS: process.env.NEXT_PUBLIC_FIREBASE_EMULATORS,
    NEXT_PUBLIC_FIREBASE_PROJECT_ID:
      process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST:
      process.env.NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST,
    NEXT_PUBLIC_FIRESTORE_EMULATOR_HOST:
      process.env.NEXT_PUBLIC_FIRESTORE_EMULATOR_HOST,
  });
  const config = emulator
    ? {
        apiKey: "demo-sarin-local-key",
        authDomain: `${emulator.projectId}.firebaseapp.com`,
        projectId: emulator.projectId,
        appId: "1:000000000000:web:0000000000000000",
      }
    : {
        apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
        authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
        projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
        appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
      };
  if (Object.values(config).some((value) => !value))
    throw new Error("Configura Firebase en .env.local para iniciar sesión.");
  if (!emulator && config.projectId?.startsWith("demo-"))
    throw new Error(
      "El proyecto demo requiere activar los emuladores locales.",
    );
  const app =
    getApps().find((entry) => entry.name === "sarin-client") ??
    initializeApp(config, "sarin-client");
  if (app.options.projectId !== config.projectId)
    throw new Error(
      "La configuración Firebase cambió. Reinicia la aplicación.",
    );
  const connections = (state.__sarinFirebaseClientConnections ??=
    new WeakMap());
  const fingerprint = JSON.stringify({ projectId: config.projectId, emulator });
  let connection = connections.get(app);
  if (connection && connection.fingerprint !== fingerprint)
    throw new Error("El modo Firebase cambió. Reinicia la aplicación.");
  if (!connection) {
    connection = {
      fingerprint,
      auth: getAuth(app),
      db: getFirestore(app),
      authConnected: false,
      firestoreConnected: false,
    };
    connections.set(app, connection);
  }
  if (emulator && !connection.authConnected) {
    connectAuthEmulator(connection.auth, `http://${emulator.auth.authority}`);
    connection.authConnected = true;
  }
  if (emulator && !connection.firestoreConnected) {
    connectFirestoreEmulator(
      connection.db,
      emulator.firestore.host,
      emulator.firestore.port,
    );
    connection.firestoreConnected = true;
  }
  return { auth: connection.auth, db: connection.db };
}
export const googleProvider = new GoogleAuthProvider();
