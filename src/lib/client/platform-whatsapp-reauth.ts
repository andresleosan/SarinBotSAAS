"use client";
import { GoogleAuthProvider, reauthenticateWithPopup } from 'firebase/auth';
import { getFirebaseClient } from '@/lib/firebase/client';

/** Freshness is established by Google authentication, then checked by the server. */
export async function reauthenticatePlatformWhatsAppOwner(expectedUid: string, expectedEpoch: number, isCurrentSession: (expectedUid: string, expectedEpoch: number) => boolean): Promise<void> {
  const user = getFirebaseClient().auth.currentUser;
  const valid = () => user?.uid === expectedUid && getFirebaseClient().auth.currentUser?.uid === expectedUid && isCurrentSession(expectedUid, expectedEpoch);
  if (!valid()) throw new Error('La sesión cambió. Vuelve a iniciar sesión.');
  if (!user!.providerData.some(provider => provider.providerId === 'google.com')) throw new Error('Esta cuenta no admite la verificación con Google.');
  let credential;
  try { credential = await reauthenticateWithPopup(user!, new GoogleAuthProvider()); }
  catch { throw new Error('No se completó la verificación con Google. Puedes volver a intentarlo.'); }
  if (!valid() || credential.user.uid !== expectedUid) throw new Error('La cuenta cambió durante la verificación.');
  await credential.user.getIdTokenResult(true);
  if (!valid()) throw new Error('La sesión cambió durante la verificación.');
}
