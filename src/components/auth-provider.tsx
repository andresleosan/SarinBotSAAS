"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import {
  GoogleAuthProvider,
  onIdTokenChanged,
  signInWithPopup,
  signOut as firebaseSignOut,
  type User,
} from "firebase/auth";
import { getFirebaseClient } from "@/lib/firebase/client";
import { apiFetch, errorMessage } from "@/lib/client/api";
import {
  signInLocalAccount,
  type LocalAccountRole,
} from "@/lib/firebase/local-auth";

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  isSuperadmin: boolean;
  error: string | null;
  signIn: () => Promise<void>;
  signInLocal: (account: LocalAccountRole) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);
const localEmulators =
  process.env.NODE_ENV === "development" &&
  process.env.NEXT_PUBLIC_FIREBASE_EMULATORS === "true";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [isSuperadmin, setIsSuperadmin] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    let version = 0;
    let unsubscribe: (() => void) | undefined;
    try {
      unsubscribe = onIdTokenChanged(
        getFirebaseClient().auth,
        async (nextUser) => {
          const currentVersion = ++version;
          setUser(nextUser);
          setIsSuperadmin(false);
          setError(null);
          setLoading(Boolean(nextUser));
          if (!nextUser) return;
          try {
            const session = await apiFetch<{ isSuperadmin: boolean }>(
              "/api/session",
            );
            if (active && version === currentVersion) {
              setIsSuperadmin(session.isSuperadmin);
              setError(null);
            }
          } catch (cause) {
            if (active && version === currentVersion)
              setError(errorMessage(cause));
          } finally {
            if (active && version === currentVersion) setLoading(false);
          }
        },
      );
    } catch (cause) {
      setError(errorMessage(cause));
      setLoading(false);
    }
    return () => {
      active = false;
      version++;
      unsubscribe?.();
    };
  }, []);
  const signIn = useCallback(async () => {
    setError(null);
    try {
      await signInWithPopup(getFirebaseClient().auth, new GoogleAuthProvider());
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }, []);
  const signOut = useCallback(async () => {
    setIsSuperadmin(false);
    setError(null);
    try {
      await firebaseSignOut(getFirebaseClient().auth);
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }, []);
  const signInLocal = useCallback(async (account: LocalAccountRole) => {
    setError(null);
    try {
      await signInLocalAccount(account);
    } catch (cause) {
      setError(errorMessage(cause));
      throw cause;
    }
  }, []);
  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        isSuperadmin,
        error,
        signIn,
        signInLocal,
        signOut,
      }}
    >
      {localEmulators && (
        <div
          role="status"
          className="border-b border-amber-500/40 bg-amber-950 px-4 py-2 text-center text-xs text-amber-100"
        >
          Entorno local · Firebase emulado · datos de negocio temporales
        </div>
      )}
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth debe usarse dentro de AuthProvider.");
  return value;
}

export function AuthGate({
  children,
  admin = false,
}: {
  children: ReactNode;
  admin?: boolean;
}) {
  const { user, loading, error, isSuperadmin, signIn, signInLocal, signOut } =
    useAuth();
  const [localSigningIn, setLocalSigningIn] = useState<LocalAccountRole | null>(
    null,
  );
  function enterLocal(account: LocalAccountRole) {
    setLocalSigningIn(account);
    void signInLocal(account)
      .catch(() => undefined)
      .finally(() => setLocalSigningIn(null));
  }
  if (loading)
    return (
      <main className="min-h-screen grid place-items-center p-6">
        <p role="status" className="text-slate-300">
          Verificando tu sesión…
        </p>
      </main>
    );
  if (!user)
    return (
      <main className="min-h-screen grid place-items-center p-6">
        <section className="w-full max-w-md rounded-3xl border border-slate-800 bg-slate-900 p-8 space-y-5">
          <p className="text-sm font-semibold text-emerald-400">SARIN BOT</p>
          <h1 className="text-2xl font-bold">Inicia sesión para continuar</h1>
          <p className="text-sm text-slate-400">
            {localEmulators
              ? "Usa una cuenta local de prueba para acceder a tu espacio."
              : "Usa tu cuenta de Google para acceder a tu espacio."}
          </p>
          {error && (
            <p role="alert" className="text-sm text-rose-300">
              {error}
            </p>
          )}
          {localEmulators && (
            <div className="space-y-2">
              {(
                [
                  ["admin", "Administrador local"],
                  ["owner", "Negocio local"],
                  ["client", "Cliente local"],
                ] as const
              ).map(([account, label]) => (
                <button
                  key={account}
                  onClick={() => enterLocal(account)}
                  disabled={localSigningIn !== null}
                  className="w-full rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm font-semibold text-emerald-200 hover:bg-emerald-500/20 disabled:opacity-50"
                >
                  {localSigningIn === account ? "Entrando…" : label}
                </button>
              ))}
            </div>
          )}
          <button
            onClick={() => void signIn()}
            disabled={localSigningIn !== null}
            className="w-full rounded-xl bg-emerald-500 px-4 py-3 font-semibold text-slate-950 hover:bg-emerald-400"
          >
            {localEmulators
              ? "Entrar con Google emulado"
              : "Continuar con Google"}
          </button>
        </section>
      </main>
    );
  if (admin && !isSuperadmin)
    return (
      <main className="min-h-screen grid place-items-center p-6">
        <section className="max-w-md space-y-4">
          <h1 className="text-2xl font-bold">Acceso restringido</h1>
          <p className="text-slate-400">
            Esta sección está reservada para el administrador.
          </p>
          {error && (
            <p role="alert" className="text-rose-300">
              {error}
            </p>
          )}
          <button
            className="text-emerald-400 underline"
            onClick={() => void signOut()}
          >
            Cambiar de cuenta
          </button>
        </section>
      </main>
    );
  return <>{children}</>;
}
