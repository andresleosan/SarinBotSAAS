import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface FakeApp {
  name: string;
  options: Record<string, unknown>;
}
const sdk = vi.hoisted(() => ({
  clientApps: [] as FakeApp[],
  adminApps: [] as FakeApp[],
  clientAuth: {},
  clientDb: {},
  adminAuth: {},
  adminDb: {},
  initializeClient: vi.fn(),
  initializeAdmin: vi.fn(),
  cert: vi.fn(),
  applicationDefault: vi.fn(),
  connectAuth: vi.fn(),
  connectFirestore: vi.fn(),
}));
vi.mock("firebase/app", () => ({
  getApps: () => sdk.clientApps,
  initializeApp: sdk.initializeClient,
}));
vi.mock("firebase/auth", () => ({
  GoogleAuthProvider: class {},
  getAuth: () => sdk.clientAuth,
  connectAuthEmulator: sdk.connectAuth,
}));
vi.mock("firebase/firestore", () => ({
  getFirestore: () => sdk.clientDb,
  connectFirestoreEmulator: sdk.connectFirestore,
}));
vi.mock("firebase-admin/app", () => ({
  getApps: () => sdk.adminApps,
  initializeApp: sdk.initializeAdmin,
  cert: sdk.cert,
  applicationDefault: sdk.applicationDefault,
}));
vi.mock("firebase-admin/auth", () => ({ getAuth: () => sdk.adminAuth }));
vi.mock("firebase-admin/firestore", () => ({
  getFirestore: () => sdk.adminDb,
}));

const emulatorVariables = [
  "NEXT_PUBLIC_FIREBASE_EMULATORS",
  "NEXT_PUBLIC_FIREBASE_PROJECT_ID",
  "NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST",
  "NEXT_PUBLIC_FIRESTORE_EMULATOR_HOST",
  "FIREBASE_AUTH_EMULATOR_HOST",
  "FIRESTORE_EMULATOR_HOST",
  "FIREBASE_ADMIN_PROJECT_ID",
  "FIREBASE_ADMIN_CLIENT_EMAIL",
  "FIREBASE_ADMIN_PRIVATE_KEY",
  "FIREBASE_ADMIN_CREDENTIAL_MODE",
  "GOOGLE_APPLICATION_CREDENTIALS",
  "CLOUDSDK_CONFIG",
] as const;

describe("Firebase singleton emulator connections", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    sdk.clientApps.length = 0;
    sdk.adminApps.length = 0;
    sdk.initializeClient.mockImplementation(
      (options: Record<string, unknown>, name: string) => {
        const app = { name, options };
        sdk.clientApps.push(app);
        return app;
      },
    );
    sdk.initializeAdmin.mockImplementation(
      (options: Record<string, unknown>, name: string) => {
        const app = { name, options };
        sdk.adminApps.push(app);
        return app;
      },
    );
    sdk.cert.mockReturnValue({ localTestCredential: true });
    sdk.applicationDefault.mockReturnValue({ localAdcCredential: true });
    for (const key of emulatorVariables) vi.stubEnv(key, undefined);
    vi.stubEnv("NODE_ENV", "development");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  function enableLocal() {
    vi.stubEnv("NEXT_PUBLIC_FIREBASE_EMULATORS", "true");
    vi.stubEnv("NEXT_PUBLIC_FIREBASE_PROJECT_ID", "demo-sarin-bot");
    vi.stubEnv("FIREBASE_ADMIN_PROJECT_ID", "demo-sarin-bot");
    vi.stubEnv("FIREBASE_AUTH_EMULATOR_HOST", "127.0.0.1:9099");
    vi.stubEnv("FIRESTORE_EMULATOR_HOST", "127.0.0.1:8080");
  }

  it("connects client Auth and Firestore once, including a module reload", async () => {
    enableLocal();
    const firstModule = await import("@/lib/firebase/client");
    const first = firstModule.getFirebaseClient();
    expect(firstModule.getFirebaseClient()).toEqual(first);
    vi.resetModules();
    const reloaded = await import("@/lib/firebase/client");
    expect(reloaded.getFirebaseClient()).toEqual(first);
    expect(sdk.initializeClient).toHaveBeenCalledTimes(1);
    expect(sdk.connectAuth).toHaveBeenCalledExactlyOnceWith(
      sdk.clientAuth,
      "http://127.0.0.1:9099",
    );
    expect(sdk.connectFirestore).toHaveBeenCalledExactlyOnceWith(
      sdk.clientDb,
      "127.0.0.1",
      8080,
    );
    expect(sdk.initializeClient.mock.calls[0][0]).toMatchObject({
      projectId: "demo-sarin-bot",
      apiKey: "demo-sarin-local-key",
    });
  });

  it("fails closed before returning an existing local client in production", async () => {
    enableLocal();
    const client = await import("@/lib/firebase/client");
    client.getFirebaseClient();
    vi.stubEnv("NODE_ENV", "production");
    expect(() => client.getFirebaseClient()).toThrow(/desarrollo/);
    expect(sdk.connectAuth).toHaveBeenCalledTimes(1);
  });

  it("keeps production client credentials separate and never calls emulator APIs", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_FIREBASE_API_KEY", "real-public-key");
    vi.stubEnv(
      "NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN",
      "sarin-real.firebaseapp.com",
    );
    vi.stubEnv("NEXT_PUBLIC_FIREBASE_PROJECT_ID", "sarin-real");
    vi.stubEnv("NEXT_PUBLIC_FIREBASE_APP_ID", "real-app-id");
    const client = await import("@/lib/firebase/client");
    client.getFirebaseClient();
    expect(sdk.initializeClient.mock.calls[0][0]).toMatchObject({
      projectId: "sarin-real",
      apiKey: "real-public-key",
    });
    expect(sdk.connectAuth).not.toHaveBeenCalled();
    expect(sdk.connectFirestore).not.toHaveBeenCalled();
  });

  it("initializes local Admin once without production credentials", async () => {
    enableLocal();
    const admin = await import("@/lib/firebase/admin");
    expect(admin.getAdminAuth()).toBe(sdk.adminAuth);
    expect(admin.getAdminDb()).toBe(sdk.adminDb);
    vi.resetModules();
    (await import("@/lib/firebase/admin")).getAdminAuth();
    expect(sdk.initializeAdmin).toHaveBeenCalledExactlyOnceWith(
      { projectId: "demo-sarin-bot" },
      "sarin-admin",
    );
    expect(sdk.cert).not.toHaveBeenCalled();
  });

  it("blocks unsigned emulator authentication in production even with a cached app", async () => {
    enableLocal();
    const admin = await import("@/lib/firebase/admin");
    admin.getAdminAuth();
    vi.stubEnv("NODE_ENV", "production");
    expect(() => admin.getAdminAuth()).toThrow(/desarrollo|pruebas/);
    expect(sdk.initializeAdmin).toHaveBeenCalledTimes(1);
  });

  it("rejects a partial emulator setup before initializing Admin SDK", async () => {
    enableLocal();
    vi.stubEnv("FIRESTORE_EMULATOR_HOST", undefined);
    const admin = await import("@/lib/firebase/admin");
    expect(() => admin.getAdminAuth()).toThrow(/juntos|parcial/);
    expect(sdk.initializeAdmin).not.toHaveBeenCalled();
  });

  it("preserves real Admin credential initialization when no emulator settings exist", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("FIREBASE_ADMIN_PROJECT_ID", "sarin-real");
    vi.stubEnv(
      "FIREBASE_ADMIN_CLIENT_EMAIL",
      "admin@sarin-real.iam.gserviceaccount.com",
    );
    vi.stubEnv("FIREBASE_ADMIN_PRIVATE_KEY", "line1\\nline2");
    const admin = await import("@/lib/firebase/admin");
    admin.getAdminAuth();
    admin.getAdminDb();
    expect(sdk.cert).toHaveBeenCalledExactlyOnceWith({
      projectId: "sarin-real",
      clientEmail: "admin@sarin-real.iam.gserviceaccount.com",
      privateKey: "line1\nline2",
    });
    expect(sdk.initializeAdmin).toHaveBeenCalledTimes(1);
    expect(sdk.initializeAdmin.mock.calls[0][0]).toMatchObject({
      projectId: "sarin-real",
      credential: { localTestCredential: true },
    });
  });

  it("requires a restart if a cached Admin app changes environment", async () => {
    enableLocal();
    const admin = await import("@/lib/firebase/admin");
    admin.getAdminAuth();
    vi.stubEnv("FIRESTORE_EMULATOR_HOST", "127.0.0.1:8181");
    vi.stubEnv("NEXT_PUBLIC_FIRESTORE_EMULATOR_HOST", "127.0.0.1:8181");
    expect(() => admin.getAdminDb()).toThrow(/Reinicia/);
  });

  it("uses explicitly selected ADC without requiring a downloaded service account key", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("FIREBASE_ADMIN_PROJECT_ID", "sarin-real");
    vi.stubEnv("FIREBASE_ADMIN_CREDENTIAL_MODE", "adc");
    vi.stubEnv("GOOGLE_APPLICATION_CREDENTIALS", "/private/sarin-adc.json");
    const admin = await import("@/lib/firebase/admin");
    expect(admin.getAdminAuth()).toBe(sdk.adminAuth);
    expect(admin.getAdminDb()).toBe(sdk.adminDb);
    expect(sdk.initializeAdmin).toHaveBeenCalledExactlyOnceWith(
      { projectId: "sarin-real", credential: { localAdcCredential: true } },
      "sarin-admin",
    );
    expect(sdk.cert).not.toHaveBeenCalled();
  });

  it("never falls back to ambient ADC when certificate configuration is missing", async () => {
    vi.stubEnv("FIREBASE_ADMIN_PROJECT_ID", "sarin-real");
    const admin = await import("@/lib/firebase/admin");
    expect(() => admin.getAdminAuth()).toThrow(/configurado/);
    expect(sdk.applicationDefault).not.toHaveBeenCalled();
    expect(sdk.initializeAdmin).not.toHaveBeenCalled();
  });

  it.each(["unknown", "emulator"])("rejects unsupported credential mode %s even with a complete certificate", async (mode) => {
    vi.stubEnv("FIREBASE_ADMIN_PROJECT_ID", "sarin-real");
    vi.stubEnv("FIREBASE_ADMIN_CREDENTIAL_MODE", mode);
    vi.stubEnv("FIREBASE_ADMIN_CLIENT_EMAIL", "admin@example.test");
    vi.stubEnv("FIREBASE_ADMIN_PRIVATE_KEY", "test-key");
    const admin = await import("@/lib/firebase/admin");
    expect(() => admin.getAdminAuth()).toThrow(/credenciales/);
    expect(sdk.initializeAdmin).not.toHaveBeenCalled();
  });

  it("rejects certificate variables in ADC mode rather than silently choosing an identity", async () => {
    vi.stubEnv("FIREBASE_ADMIN_PROJECT_ID", "sarin-real");
    vi.stubEnv("FIREBASE_ADMIN_CREDENTIAL_MODE", "adc");
    vi.stubEnv("FIREBASE_ADMIN_CLIENT_EMAIL", "admin@example.test");
    vi.stubEnv("FIREBASE_ADMIN_PRIVATE_KEY", "test-key");
    const admin = await import("@/lib/firebase/admin");
    expect(() => admin.getAdminAuth()).toThrow(/ADC|adc/);
    expect(sdk.initializeAdmin).not.toHaveBeenCalled();
  });

  it("requires a restart when a cached certificate app switches to ADC", async () => {
    vi.stubEnv("FIREBASE_ADMIN_PROJECT_ID", "sarin-real");
    vi.stubEnv("FIREBASE_ADMIN_CLIENT_EMAIL", "admin@example.test");
    vi.stubEnv("FIREBASE_ADMIN_PRIVATE_KEY", "test-key");
    const admin = await import("@/lib/firebase/admin");
    admin.getAdminAuth();
    vi.stubEnv("FIREBASE_ADMIN_CLIENT_EMAIL", undefined);
    vi.stubEnv("FIREBASE_ADMIN_PRIVATE_KEY", undefined);
    vi.stubEnv("FIREBASE_ADMIN_CREDENTIAL_MODE", "adc");
    expect(() => admin.getAdminDb()).toThrow(/Reinicia/);
  });

  it("requires a restart when the selected ADC file changes", async () => {
    vi.stubEnv("FIREBASE_ADMIN_PROJECT_ID", "sarin-real");
    vi.stubEnv("FIREBASE_ADMIN_CREDENTIAL_MODE", "adc");
    vi.stubEnv("GOOGLE_APPLICATION_CREDENTIALS", "/private/first-adc.json");
    const admin = await import("@/lib/firebase/admin");
    admin.getAdminAuth();
    vi.stubEnv("GOOGLE_APPLICATION_CREDENTIALS", "/private/second-adc.json");
    expect(() => admin.getAdminDb()).toThrow(/Reinicia/);
  });

  it("requires a restart when the default ADC configuration directory changes", async () => {
    vi.stubEnv("FIREBASE_ADMIN_PROJECT_ID", "sarin-real");
    vi.stubEnv("FIREBASE_ADMIN_CREDENTIAL_MODE", "adc");
    vi.stubEnv("CLOUDSDK_CONFIG", "/private/first-gcloud");
    const admin = await import("@/lib/firebase/admin");
    admin.getAdminAuth();
    vi.stubEnv("CLOUDSDK_CONFIG", "/private/second-gcloud");
    expect(() => admin.getAdminDb()).toThrow(/Reinicia/);
  });
});
