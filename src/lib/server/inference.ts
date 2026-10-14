import 'server-only';
import { HttpError } from './http';

const state = globalThis as typeof globalThis & { __sarinUsers?: Set<string> };
/** Bounds concurrent abuse, without imposing a daily message allowance. */
export async function runUserInference<T>(uid: string, task: () => Promise<T>): Promise<T> {
  const users = state.__sarinUsers ??= new Set<string>();
  if (users.has(uid)) throw new HttpError(429, 'Ya tienes una consulta en curso. Espera su respuesta.');
  users.add(uid);
  try { return await task(); } finally { users.delete(uid); }
}
