"use client";

import { SarinBrand } from "@/components/sarin-brand";
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
          className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-center text-xs text-amber-900"
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
      <main className="min-h-screen grid place-items-center bg-sarin-canvas p-6 text-sarin-ink">
        <p role="status" className="text-sarin-muted">
          Verificando tu sesión…
        </p>
      </main>
    );
  if (!user)
    return (
      <main className="sarin-backdrop grid min-h-screen place-items-center px-5 py-12">
        <section className="sarin-surface w-full max-w-md space-y-6 rounded-2xl p-7 shadow-[0_16px_48px_#233e7c09] sm:p-9">
          <a href="/" aria-label="Sarin Bot, inicio" className="mb-3 inline-block"><SarinBrand /></a>
          <div><p className="sarin-eyebrow mb-3 text-sarin-blue">Tu espacio está aquí</p><h1 className="text-3xl font-semibold leading-tight tracking-[-0.04em] text-sarin-ink">Inicia sesión para continuar</h1></div>
          <p className="text-sm leading-7 text-sarin-muted">
            {localEmulators
              ? "Usa una cuenta local de prueba para acceder a tu espacio."
              : "Usa tu cuenta de Google para acceder a tu espacio."}
          </p>
          {error && (
            <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
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
                  className="min-h-12 w-full rounded-[10px] border border-sarin-line bg-sarin-paper px-4 py-3 text-sm font-medium text-sarin-ink hover:border-sarin-blue hover:bg-sarin-soft disabled:opacity-50"
                >
                  {localSigningIn === account ? "Entrando…" : label}
                </button>
              ))}
            </div>
          )}
          <button
            onClick={() => void signIn()}
            disabled={localSigningIn !== null}
            className="min-h-12 w-full rounded-[10px] bg-sarin-blue px-4 py-3 text-sm font-semibold text-white hover:bg-[#244dd0] disabled:opacity-50"
          >
            {localEmulators
              ? "Entrar con Google emulado"
              : "Continuar con Google"}
          </button>
          <nav aria-label="Información del servicio" className="flex flex-wrap gap-x-5 text-xs text-sarin-blue">
            <a href="/privacidad" className="inline-flex min-h-11 items-center underline underline-offset-4">Privacidad</a>
            <a href="/ayuda" className="inline-flex min-h-11 items-center underline underline-offset-4">Ayuda</a>
          </nav>
          <p className="border-t border-sarin-line pt-5 text-xs leading-6 text-sarin-muted">Tu agenda, tus servicios y tu forma de atender. Todo en un mismo espacio.</p>
        </section>
      </main>
    );
  if (admin && !isSuperadmin)
    return (
      <main className="min-h-screen grid place-items-center bg-sarin-canvas p-6 text-sarin-ink">
        <section className="w-full max-w-md space-y-4 rounded-2xl border border-sarin-line bg-sarin-paper p-6">
          <h1 className="text-2xl font-bold">Acceso restringido</h1>
          <p className="text-sarin-muted">
            Esta sección está reservada para el administrador.
          </p>
          {error && (
            <p role="alert" className="text-rose-800">
              {error}
            </p>
          )}
          <button
            className="min-h-11 text-sarin-blue underline"
            onClick={() => void signOut()}
          >
            Cambiar de cuenta
          </button>
        </section>
      </main>
    );
  return <>{children}</>;
}
