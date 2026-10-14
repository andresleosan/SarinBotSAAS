import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  signInLocalAccount,
  type LocalAccountRole,
} from "@/lib/firebase/local-auth";
import { LOCAL_TEST_ACCOUNTS } from "@/lib/firebase/emulator-constants.mjs";

const sdk = vi.hoisted(() => ({
  auth: {},
  getClient: vi.fn(),
  credential: vi.fn(),
  signIn: vi.fn(),
}));
vi.mock("firebase/auth", () => ({
  GoogleAuthProvider: class {
    static credential = sdk.credential;
  },
  signInWithCredential: sdk.signIn,
}));
vi.mock("@/lib/firebase/client", () => ({ getFirebaseClient: sdk.getClient }));

describe("explicit local emulator accounts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("NEXT_PUBLIC_FIREBASE_EMULATORS", "true");
    sdk.getClient.mockReturnValue({ auth: sdk.auth });
    sdk.credential.mockImplementation((idToken: string) => ({
      providerId: "google.com",
      idToken,
    }));
    sdk.signIn.mockResolvedValue({});
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each(LOCAL_TEST_ACCOUNTS)(
    "signs in $role through the real SDK credential path",
    async (account) => {
      await signInLocalAccount(account.role);
      expect(sdk.getClient).toHaveBeenCalledTimes(1);
      const payload = JSON.stringify({
        sub: account.providerUid,
        email: account.email,
        email_verified: true,
        name: account.displayName,
      });
      expect(sdk.credential).toHaveBeenCalledExactlyOnceWith(payload);
      expect(sdk.signIn).toHaveBeenCalledExactlyOnceWith(sdk.auth, {
        providerId: "google.com",
        idToken: payload,
      });
    },
  );

  it.each([
    { mode: "production", flag: "true" },
    { mode: "production", flag: "false" },
    { mode: "development", flag: "false" },
    { mode: "development", flag: undefined },
    { mode: "test", flag: "true" },
  ])(
    "rejects outside an explicitly enabled development client ($mode, $flag)",
    async ({ mode, flag }) => {
      vi.stubEnv("NODE_ENV", mode);
      vi.stubEnv("NEXT_PUBLIC_FIREBASE_EMULATORS", flag);
      await expect(signInLocalAccount("admin")).rejects.toThrow(
        /solo.*emuladores.*desarrollo/,
      );
      expect(sdk.getClient).not.toHaveBeenCalled();
      expect(sdk.credential).not.toHaveBeenCalled();
      expect(sdk.signIn).not.toHaveBeenCalled();
    },
  );

  it("rejects arbitrary identities rather than constructing a custom UID", async () => {
    await expect(
      signInLocalAccount("arbitrary-uid" as LocalAccountRole),
    ).rejects.toThrow(/no está permitida/);
    expect(sdk.getClient).not.toHaveBeenCalled();
    expect(sdk.signIn).not.toHaveBeenCalled();
    expect(Object.isFrozen(LOCAL_TEST_ACCOUNTS)).toBe(true);
    expect(LOCAL_TEST_ACCOUNTS.every(Object.isFrozen)).toBe(true);
  });

  it("propagates emulator authentication errors without assigning a session", async () => {
    sdk.signIn.mockRejectedValueOnce(new Error("Auth emulator offline"));
    await expect(signInLocalAccount("admin")).rejects.toThrow(
      "Auth emulator offline",
    );
  });
});
