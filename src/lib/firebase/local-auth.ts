"use client";

import { GoogleAuthProvider, signInWithCredential } from "firebase/auth";
import { getFirebaseClient } from "@/lib/firebase/client";

export type LocalAccountRole = "admin" | "owner" | "client";

/** Firebase's official noninteractive OAuth flow, exclusively for local Auth. */
export async function signInLocalAccount(
  role: LocalAccountRole,
): Promise<void> {
  if (
    process.env.NODE_ENV !== "development" ||
    process.env.NEXT_PUBLIC_FIREBASE_EMULATORS !== "true"
  ) {
    throw new Error(
      "Las cuentas locales solo están disponibles con los emuladores en desarrollo.",
    );
  }
  // Build-time environment checks keep the development account import behind
  // an unreachable production branch. Session state always comes from Firebase.
  const { LOCAL_TEST_ACCOUNTS } =
    await import("@/lib/firebase/emulator-constants.mjs");
  const account = LOCAL_TEST_ACCOUNTS.find(
    (candidate) => candidate.role === role,
  );
  if (!account)
    throw new Error("La cuenta local seleccionada no está permitida.");
  const { auth } = getFirebaseClient();
  const credential = GoogleAuthProvider.credential(
    JSON.stringify({
      sub: account.providerUid,
      email: account.email,
      email_verified: true,
      name: account.displayName,
    }),
  );
  await signInWithCredential(auth, credential);
}
