import { act, createElement } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import type { User } from "firebase/auth";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthGate, AuthProvider, useAuth } from "@/components/auth-provider";
import { apiFetch } from "@/lib/client/api";
import { signOut, signInWithCredential, signInWithPopup } from "firebase/auth";

const state = vi.hoisted(() => ({
  listener: null as ((user: User | null) => Promise<void>) | null,
  currentUser: null as User | null,
}));
vi.mock("firebase/auth", () => ({
  GoogleAuthProvider: class {},
  onIdTokenChanged: vi.fn(
    (_auth: unknown, listener: (user: User | null) => Promise<void>) => {
      state.listener = (user) => { state.currentUser = user; return listener(user); };
      return vi.fn();
    },
  ),
  signInWithPopup: vi.fn(),
  signInWithCredential: vi.fn(),
  signOut: vi.fn(),
}));
vi.mock("@/lib/firebase/client", () => ({
  getFirebaseClient: () => ({ auth: { currentUser: state.currentUser } }),
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
    state.currentUser = null;
    vi.mocked(apiFetch).mockReset();
    vi.mocked(signOut).mockReset();
    vi.mocked(signInWithPopup).mockReset();
  });
  afterEach(async () => {
    await act(async () => renderer?.unmount());
    renderer = undefined;
  });

  it("offers public service information before Google sign-in without requesting a session", async () => {
    await mount();
    await act(async () => state.listener?.(null));
    const destinations = renderer!.root.findAllByType("a").map(link => link.props.href);
    expect(destinations).toContain("/privacidad");
    expect(destinations).toContain("/ayuda");
    expect(vi.mocked(apiFetch)).not.toHaveBeenCalled();
    expect(JSON.stringify(renderer?.toJSON())).not.toContain("PRIVATE_ADMIN_CONTENT");
  });

  it('records the explicit pre-Google proof against the resulting account without treating ordinary login as acceptance', async () => {
    await mount(); await act(async () => state.listener?.(null));
    state.currentUser = user;
    vi.mocked(signInWithPopup).mockResolvedValue({ user } as never);
    vi.mocked(apiFetch).mockResolvedValue({ revision: 0, documents: { fingerprint: 'a'.repeat(64) } });
    await act(async () => auth.signIn('proof-before-google'));
    const accepted = vi.mocked(apiFetch).mock.calls.find(call => call[1]?.method === 'POST');
    expect(accepted?.[0]).toBe('/api/consent');
    expect(JSON.parse(String(accepted?.[1]?.body))).toMatchObject({ action: 'accept', scope: 'account', termsAccepted: true, dataAuthorized: true, preauthorization: 'proof-before-google' });
    vi.mocked(apiFetch).mockClear();
    await act(async () => auth.signIn());
    expect(vi.mocked(apiFetch).mock.calls.some(call => call[1]?.method === 'POST')).toBe(false);
  });

  it('does not claim a preauthorization for a different Google account after an identity switch', async () => {
    await mount(); await act(async () => state.listener?.(null));
    state.currentUser = { ...user, uid: 'next-account' } as User;
    vi.mocked(signInWithPopup).mockResolvedValue({ user } as never);
    await act(async () => auth.signIn('prior-account-proof'));
    expect(vi.mocked(apiFetch).mock.calls.some(call => call[1]?.method === 'POST')).toBe(false);
  });

  it("keeps administrator content blocked when server session validation fails", async () => {
    vi.mocked(apiFetch).mockRejectedValue(new Error("Servicio no disponible"));
    await mount();
    await act(async () => {
      await state.listener?.(user);
    });
    expect(auth.user).toBeNull();
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
    expect(auth.user).toBeNull();
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

  it("keeps the verified AuthGate mounted during same-UID background validation", async () => {
    vi.mocked(apiFetch).mockResolvedValue({ isSuperadmin: true });
    await mount();
    await act(async () => state.listener?.(user));
    expect(JSON.stringify(renderer?.toJSON())).toContain("PRIVATE_ADMIN_CONTENT");
    const refresh = deferred<{ isSuperadmin: boolean }>();
    vi.mocked(apiFetch).mockImplementation((path) => path === '/api/session' ? refresh.promise : Promise.resolve({}));
    let pending: Promise<void> | undefined;
    act(() => { pending = state.listener?.(user); });
    expect(auth.loading).toBe(false);
    expect(JSON.stringify(renderer?.toJSON())).toContain("PRIVATE_ADMIN_CONTENT");
    await act(async () => { refresh.resolve({ isSuperadmin: true }); await pending; });
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

  it.each([undefined, {}, { isSuperadmin: 'true' }, { isSuperadmin: null }])('rejects malformed session %j and does not reopen on a token event', async result => {
    vi.mocked(apiFetch).mockResolvedValue(result);
    await mount(); await act(async () => state.listener?.(user));
    expect(auth.user).toBeNull(); expect(auth.isSuperadmin).toBe(false);
    const calls = vi.mocked(apiFetch).mock.calls.length;
    vi.mocked(apiFetch).mockResolvedValue({ isSuperadmin: true });
    await act(async () => state.listener?.(user));
    expect(auth.user).toBeNull(); expect(vi.mocked(apiFetch)).toHaveBeenCalledTimes(calls);
  });

  it('uses the latest literal false as a verified nonadmin session without borrowing an earlier role', async () => {
    vi.mocked(apiFetch).mockResolvedValue({ isSuperadmin: true });
    await mount(); await act(async () => state.listener?.(user));
    const epoch = auth.authEpoch, predicate = auth.isCurrentSession;
    vi.mocked(apiFetch).mockResolvedValue({ isSuperadmin: false });
    await act(async () => state.listener?.(user));
    expect(auth.user?.uid).toBe(user.uid); expect(auth.isSuperadmin).toBe(false);
    expect(auth.authEpoch).toBe(epoch); expect(auth.isCurrentSession).toBe(predicate);
    expect(predicate(user.uid, epoch)).toBe(true);
    expect(JSON.stringify(renderer?.toJSON())).not.toContain('PRIVATE_ADMIN_CONTENT');
    expect(vi.mocked(apiFetch).mock.calls.find(call => call[0] === '/api/session')?.[2]).toBe(user.uid);
  });

  it('rejects a captured session synchronously at logout start before React rerenders', async () => {
    vi.mocked(apiFetch).mockResolvedValue({ isSuperadmin: true });
    await mount(); await act(async () => state.listener?.(user));
    const epoch = auth.authEpoch, predicate = auth.isCurrentSession;
    const logout = deferred<void>(); vi.mocked(signOut).mockReturnValue(logout.promise);
    let pending!: Promise<void>;
    await act(async () => {
      pending = auth.signOut();
      expect(predicate(user.uid, epoch)).toBe(false);
      logout.resolve(); await pending;
    });
    expect(auth.authEpoch).toBeGreaterThan(epoch);
    expect(predicate(user.uid, epoch)).toBe(false);
  });

  it('does not extend the first pending deadline and ignores superseded or late validation', async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(apiFetch).mockResolvedValue({ isSuperadmin: true });
      await mount(); await act(async () => state.listener?.(user));
      const epoch = auth.authEpoch;
      const first = deferred<{ isSuperadmin: boolean }>(), second = deferred<{ isSuperadmin: boolean }>();
      vi.mocked(apiFetch).mockImplementationOnce(() => first.promise);
      act(() => { void state.listener?.(user); });
      await act(async () => vi.advanceTimersByTimeAsync(9000));
      vi.mocked(apiFetch).mockImplementationOnce(() => second.promise);
      act(() => { void state.listener?.(user); });
      await act(async () => vi.advanceTimersByTimeAsync(999));
      expect(auth.isSuperadmin).toBe(true); expect(auth.authEpoch).toBe(epoch);
      await act(async () => vi.advanceTimersByTimeAsync(1));
      expect(auth.user).toBeNull(); expect(auth.authEpoch).toBeGreaterThan(epoch);
      await act(async () => { second.resolve({ isSuperadmin: true }); first.resolve({ isSuperadmin: true }); });
      expect(auth.user).toBeNull(); expect(auth.isSuperadmin).toBe(false);
    } finally { vi.useRealTimers(); }
  });

  it('masks a UID transition while its new validation is pending and ignores an old true after current failure', async () => {
    vi.mocked(apiFetch).mockResolvedValue({ isSuperadmin: true });
    await mount(); await act(async () => state.listener?.(user));
    const old = deferred<{ isSuperadmin: boolean }>();
    vi.mocked(apiFetch).mockImplementationOnce(() => old.promise);
    act(() => { void state.listener?.(user); });
    vi.mocked(apiFetch).mockRejectedValueOnce(new Error('Revoked'));
    await act(async () => state.listener?.({ ...user, uid: 'other' } as User));
    await act(async () => old.resolve({ isSuperadmin: true }));
    expect(auth.user).toBeNull(); expect(auth.isSuperadmin).toBe(false);
  });
  it('does not post a preauthorization after logout interrupts its consent read', async () => {
    await mount(); await act(async () => state.listener?.(null));
    state.currentUser = user; vi.mocked(signInWithPopup).mockResolvedValue({ user } as never);
    const consent = deferred<unknown>();
    vi.mocked(apiFetch).mockImplementation(path => path === '/api/consent?scope=account' ? consent.promise : Promise.resolve({ isSuperadmin: false }));
    let signingIn!: Promise<void>;
    act(() => { signingIn = auth.signIn('synthetic-preauthorization'); });
    await act(async () => {
      await auth.signOut();
      consent.resolve({ revision: 0, documents: { fingerprint: 'a'.repeat(64) } }); await signingIn;
    });
    expect(vi.mocked(apiFetch).mock.calls.filter(call => call[1]?.method === 'POST')).toHaveLength(0);
  });
  it('rejects the current SDK UID mismatch synchronously and never grants the old role to a pending new user', async () => {
    vi.mocked(apiFetch).mockResolvedValue({ isSuperadmin: true }); await mount(); await act(async () => state.listener?.(user));
    const epoch = auth.authEpoch, predicate = auth.isCurrentSession;
    state.currentUser = { ...user, uid: 'other' } as User;
    expect(predicate(user.uid, epoch)).toBe(false);
    const session = deferred<{ isSuperadmin: boolean }>(); vi.mocked(apiFetch).mockImplementationOnce(() => session.promise);
    act(() => { void state.listener?.(state.currentUser); });
    expect(auth.user).toBeNull(); expect(auth.isSuperadmin).toBe(false); expect(auth.loading).toBe(true);
    await act(async () => session.resolve({ isSuperadmin: false }));
    expect(auth.user?.uid).toBe('other'); expect(auth.isSuperadmin).toBe(false);
  });
});
