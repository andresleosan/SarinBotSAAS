"use client";
import { apiFetch, ApiError } from '@/lib/client/api';

export type OwnerAccessFailure = { status: 401 | 403; source: 'feature' | 'owner_authority'; code?: string };
export type OwnerRequestScope = {
  ownerUid: string; authEpoch: number; businessId: string;
  isCurrent: () => boolean; readonly readGeneration: number;
  canRead: () => boolean; canStartAction: () => boolean;
  onAccessDenied: (failure: OwnerAccessFailure) => void;
};

/** The caller fixes provenance; a feature's response cannot promote itself to owner authority. */
export async function ownerApiFetch<T>(scope: OwnerRequestScope, kind: 'read' | 'write' | 'authority', path: string, init: RequestInit = {}, isCurrent: () => boolean = () => true): Promise<T> {
  const generation = scope.readGeneration;
  if (!scope.isCurrent() || !isCurrent()) throw new ApiError('La cuenta cambió.', 401, 'AUTH_IDENTITY_CHANGED');
  if ((kind === 'read' && !scope.canRead()) || (kind === 'write' && !scope.canStartAction())) throw new ApiError('Comprueba el acceso antes de continuar.', 403, 'OWNER_SCOPE_PROTECTED');
  let reported = false;
  // After a known denial, let apiFetch finish parsing that error under the same identity.
  // Protection invalidates ordinary read generations, not the authority of the command.
  const current = () => scope.isCurrent() && isCurrent() && (kind !== 'read' || reported || (scope.canRead() && scope.readGeneration === generation));
  const report = (status: 401 | 403, code?: string) => {
    if (!current()) return;
    reported = true;
    scope.onAccessDenied({ status, source: kind === 'authority' ? 'owner_authority' : 'feature', code });
  };
  try {
    return await apiFetch<T>(path, init, scope.ownerUid, current, status => { if (status === 401 || status === 403) report(status); });
  } catch (error) {
    if (error instanceof ApiError && (error.status === 401 || error.status === 403) && (!reported || error.code)) report(error.status, error.code);
    throw error;
  }
}
