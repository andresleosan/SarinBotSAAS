import 'server-only';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { getAdminAuth } from '@/lib/firebase/admin';
import { HttpError } from './http';

export function isSuperadmin(uid: string): boolean { return Boolean(process.env.SUPERADMIN_UID) && uid === process.env.SUPERADMIN_UID; }

export async function requireUser(request: Request): Promise<DecodedIdToken> {
  const match = /^Bearer ([^\s]+)$/i.exec(request.headers.get('authorization') ?? '');
  if (!match) throw new HttpError(401, 'Inicia sesión para continuar.');
  const auth = getAdminAuth();
  try { return await auth.verifyIdToken(match[1], true); }
  catch { throw new HttpError(401, 'La sesión expiró. Vuelve a iniciar sesión.'); }
}

export async function requireSuperadmin(request: Request): Promise<DecodedIdToken> {
  const user = await requireUser(request);
  if (!isSuperadmin(user.uid)) throw new HttpError(403, 'Forbidden');
  return user;
}
