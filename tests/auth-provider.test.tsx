import { act, createElement } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import type { User } from "firebase/auth";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthGate, AuthProvider, useAuth } from "@/components/auth-provider";
import { apiFetch } from "@/lib/client/api";
import { signOut, signInWithCredential } from "firebase/auth";

const state = vi.hoisted(() => ({
  listener: null as ((user: User | null) => Promise<void>) | null,
}));
vi.mock("firebase/auth", () => ({
  GoogleAuthProvider: class {},
  onIdTokenChanged: vi.fn(
    (_auth: unknown, listener: (user: User | null) => Promise<void>) => {
      state.listener = listener;
      return vi.fn();
    },
  ),
  signInWithPopup: vi.fn(),
  signInWithCredential: vi.fn(),
  signOut: vi.fn(),
}));
vi.mock("@/lib/firebase/client", () => ({
  getFirebaseClient: () => ({ auth: {} }),
}));
vi.mock("@/lib/client/api", () => ({
  apiFetch: vi.fn(),
  errorMessage: (error: unknown) =>
    error instanceof Error ? error.message : String(error),
}));
(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const user = {
  uid: "owner",
  displayName: "Owner",
  email: "owner@example.test",
} as User;

describe("authentication provider access state", () => {
  let renderer: ReactTestRenderer | undefined;
  let auth!: ReturnType<typeof useAuth>;
  function Harness() {
    auth = useAuth();
    return createElement(AuthGate, {
      admin: true,
      children: "PRIVATE_ADMIN_CONTENT",
    });
  }
  async function mount() {
    await act(async () => {
      renderer = create(
        createElement(AuthProvider, { children: createElement(Harness) }),
      );
    });
  }
  beforeEach(() => {
    state.listener = null;
    vi.mocked(apiFetch).mockReset();
    vi.mocked(signOut).mockReset();
  });
  afterEach(async () => {
    await act(async () => renderer?.unmount());
    renderer = undefined;
  });

  it("keeps administrator content blocked when server session validation fails", async () => {
    vi.mocked(apiFetch).mockRejectedValue(new Error("Servicio no disponible"));
    await mount();
    await act(async () => {
      await state.listener?.(user);
    });
    expect(auth.user?.uid).toBe("owner");
    expect(auth.isSuperadmin).toBe(false);
    expect(auth.loading).toBe(false);
    expect(auth.error).toBe("Servicio no disponible");
    expect(JSON.stringify(renderer?.toJSON())).not.toContain(
      "PRIVATE_ADMIN_CONTENT",
    );
  });

  it("ignores an old administrator session response after signing out", async () => {
    const session = deferred<{ isSuperadmin: boolean }>();
    vi.mocked(apiFetch).mockImplementationOnce(() => session.promise);
    await mount();
    let pending: Promise<void> | undefined;
    act(() => {
      pending = state.listener?.(user);
    });
    await act(async () => {
      await state.listener?.(null);
    });
    await act(async () => {
      session.resolve({ isSuperadmin: true });
      await pending;
    });
    expect(auth.user).toBeNull();
    expect(auth.isSuperadmin).toBe(false);
    expect(JSON.stringify(renderer?.toJSON())).not.toContain(
      "PRIVATE_ADMIN_CONTENT",
    );
  });

  it("revokes administrator UI access immediately when sign-out begins", async () => {
    vi.mocked(apiFetch).mockResolvedValue({ isSuperadmin: true });
    const logout = deferred<void>();
    vi.mocked(signOut).mockImplementationOnce(() => logout.promise);
    await mount();
    await act(async () => {
      await state.listener?.(user);
    });
    expect(JSON.stringify(renderer?.toJSON())).toContain(
      "PRIVATE_ADMIN_CONTENT",
    );
    let pending!: Promise<void>;
    act(() => {
      pending = auth.signOut();
    });
    expect(auth.isSuperadmin).toBe(false);
    expect(auth.error).toBeNull();
    expect(JSON.stringify(renderer?.toJSON())).not.toContain(
      "PRIVATE_ADMIN_CONTENT",
    );
    await act(async () => {
      logout.resolve();
      await pending;
      await state.listener?.(null);
    });
    expect(auth.user).toBeNull();
  });

  it("rejects direct local account access outside development emulation", async () => {
    await mount();
    await act(async () => {
      await expect(auth.signInLocal("admin")).rejects.toThrow(
        /solo.*emuladores.*desarrollo/,
      );
    });
    expect(signInWithCredential).not.toHaveBeenCalled();
    expect(auth.user).toBeNull();
    expect(auth.isSuperadmin).toBe(false);
  });
});
