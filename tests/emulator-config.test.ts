import { describe, expect, it } from "vitest";
import {
  LOCAL_FIREBASE_AUTH_HOST,
  LOCAL_FIREBASE_FIRESTORE_HOST,
  LOCAL_FIREBASE_PROJECT_ID,
  readAdminEmulatorConfig,
  readClientEmulatorConfig,
  type FirebaseEmulatorEnvironment,
} from "@/lib/firebase/emulator-config";

const server: FirebaseEmulatorEnvironment = {
  NODE_ENV: "development",
  FIREBASE_ADMIN_PROJECT_ID: LOCAL_FIREBASE_PROJECT_ID,
  FIREBASE_AUTH_EMULATOR_HOST: LOCAL_FIREBASE_AUTH_HOST,
  FIRESTORE_EMULATOR_HOST: LOCAL_FIREBASE_FIRESTORE_HOST,
};

describe("local Firebase emulator configuration boundary", () => {
  it("uses explicit local demo resources only with the development client flag", () => {
    expect(
      readClientEmulatorConfig({
        NODE_ENV: "development",
        NEXT_PUBLIC_FIREBASE_EMULATORS: "true",
      }),
    ).toEqual({
      projectId: "demo-sarin-bot",
      auth: { host: "127.0.0.1", port: 9099, authority: "127.0.0.1:9099" },
      firestore: { host: "127.0.0.1", port: 8080, authority: "127.0.0.1:8080" },
    });
    expect(readClientEmulatorConfig({ NODE_ENV: "production" })).toBeNull();
    expect(
      readAdminEmulatorConfig({
        NODE_ENV: "production",
        FIREBASE_ADMIN_PROJECT_ID: "sarin-real-project",
      }),
    ).toBeNull();
  });

  it.each(["production", "test", undefined])(
    "rejects the client flag outside development (%s)",
    (NODE_ENV) => {
      expect(() =>
        readClientEmulatorConfig({
          NODE_ENV,
          NEXT_PUBLIC_FIREBASE_EMULATORS: "true",
        }),
      ).toThrow();
    },
  );

  it.each(["production", undefined])(
    "rejects server emulator hosts outside development/test (%s)",
    (NODE_ENV) => {
      expect(() => readAdminEmulatorConfig({ ...server, NODE_ENV })).toThrow();
    },
  );

  it("allows server integration tests and rejects partial environments", () => {
    expect(
      readAdminEmulatorConfig({ ...server, NODE_ENV: "test" })?.projectId,
    ).toBe(LOCAL_FIREBASE_PROJECT_ID);
    expect(() =>
      readAdminEmulatorConfig({
        ...server,
        FIREBASE_AUTH_EMULATOR_HOST: undefined,
      }),
    ).toThrow(/juntos|parcial/);
    expect(() =>
      readAdminEmulatorConfig({ ...server, FIRESTORE_EMULATOR_HOST: "" }),
    ).toThrow(/juntos|parcial/);
    expect(() =>
      readAdminEmulatorConfig({
        NODE_ENV: "development",
        NEXT_PUBLIC_FIREBASE_EMULATORS: "true",
        FIREBASE_ADMIN_PROJECT_ID: LOCAL_FIREBASE_PROJECT_ID,
      }),
    ).toThrow(/juntos|parcial/);
  });

  it.each([
    "real-project",
    "demo-",
    "demo-../project",
    "demo-UPPER",
    "demo-" + "x".repeat(30),
  ])("rejects a nonisolated project (%s)", (projectId) => {
    expect(() =>
      readClientEmulatorConfig({
        NODE_ENV: "development",
        NEXT_PUBLIC_FIREBASE_EMULATORS: "true",
        NEXT_PUBLIC_FIREBASE_PROJECT_ID: projectId,
      }),
    ).toThrow(/demo-/);
    expect(() =>
      readAdminEmulatorConfig({
        ...server,
        FIREBASE_ADMIN_PROJECT_ID: projectId,
      }),
    ).toThrow(/demo-/);
  });

  it.each([
    "https://127.0.0.1:9099",
    "127.0.0.1:9099/path",
    "127.0.0.1.evil:9099",
    "user@localhost:9099",
    "192.168.1.2:9099",
    "0.0.0.0:9099",
    "example.com:9099",
    "localhost:0",
    "localhost:65536",
    "localhost:9099?x=1",
  ])("rejects nonloopback or malformed hosts (%s)", (host) => {
    expect(() =>
      readClientEmulatorConfig({
        NODE_ENV: "development",
        NEXT_PUBLIC_FIREBASE_EMULATORS: "true",
        NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST: host,
      }),
    ).toThrow(/loopback/);
    expect(() =>
      readAdminEmulatorConfig({ ...server, FIRESTORE_EMULATOR_HOST: host }),
    ).toThrow(/loopback/);
  });

  it("accepts localhost and literal IPv6 loopback with bounded ports", () => {
    const config = readAdminEmulatorConfig({
      ...server,
      FIREBASE_AUTH_EMULATOR_HOST: "localhost:9099",
      FIRESTORE_EMULATOR_HOST: "[::1]:8080",
    });
    expect(config?.auth.host).toBe("localhost");
    expect(config?.firestore).toEqual({
      host: "[::1]",
      port: 8080,
      authority: "[::1]:8080",
    });
  });

  it("rejects unknown flags and client/server mismatches", () => {
    expect(() =>
      readClientEmulatorConfig({
        NODE_ENV: "development",
        NEXT_PUBLIC_FIREBASE_EMULATORS: "yes",
      }),
    ).toThrow();
    expect(() =>
      readAdminEmulatorConfig({
        ...server,
        NEXT_PUBLIC_FIREBASE_EMULATORS: "true",
        NEXT_PUBLIC_FIREBASE_PROJECT_ID: "demo-another-project",
      }),
    ).toThrow(/mismo proyecto/);
    expect(() =>
      readAdminEmulatorConfig({
        ...server,
        NEXT_PUBLIC_FIREBASE_EMULATORS: "true",
        NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST: "localhost:9199",
      }),
    ).toThrow(/mismo proyecto/);
  });
});
