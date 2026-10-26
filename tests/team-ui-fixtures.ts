import { createHash, webcrypto } from 'node:crypto';
import { vi } from 'vitest';
export const token = vi.fn(async () => 'synthetic-token');
export const auth = { user: { uid: 'owner' }, authEpoch: 1, isCurrentSession: (uid: string, epoch: number) => uid === auth.user.uid && epoch === auth.authEpoch, invalidateSession: vi.fn() };
export const membership = (status: 'requested'|'active'|'revoked' = 'requested') => ({ membershipId: 'member1', businessId: 'business1', businessLabel: 'Taller demo', status, revision: 1, role: status === 'requested' ? null : { id: 'own_agenda_viewer' as const, version: 1 as const }, resourceId: status === 'requested' ? null : 'resource1', updatedAt: 1000 });
export const ownerView = () => ({ businessId: 'business1', ownerUid: 'owner', teamRevision: 1, requested: [{ ...membership(), memberUid: 'staff' }], active: [], events: [], serverNow: 2000, enabled: true, eligible: true, applied: null });
export const page = () => ({ scopeUid: auth.user.uid, items: [membership()], mode: 'page', nextAfterBusinessId: null, target: null, serverNow: 2000, applied: null });
export const lookup = () => ({ ...page(), mode: 'business', target: { businessId: 'business1', businessName: 'Taller demo' } });
export const agenda = () => ({ businessId: 'business1', businessName: 'Taller demo', resource: { id: 'resource1', name: 'Estación uno' }, dateKey: '2026-10-25', checkedAt: Date.parse('2026-10-25T12:00:00Z'), membershipRevision: 1, rows: [] });
export function deferred<T>() { let resolve!: (value: T) => void, reject!: (reason: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
export const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
export const hash = (value: string) => createHash('sha256').update(value).digest('hex');
export function proof(command: Record<string, unknown>, uid: string, kind: string, status: 'active'|'requested'|'revoked' = 'active') {
  const canonical = { kind, businessId: 'business1', actorUid: uid, requestId: command.requestId, expectedMembershipRevision: command.expectedMembershipRevision, expectedTeamRevision: command.expectedTeamRevision ?? null, resourceId: command.resourceId ?? null };
  return { audience: uid === 'owner' ? 'owner' : 'member', applied: { requestId: command.requestId, commandHash: hash(JSON.stringify(canonical)), eventId: hash(JSON.stringify(['team-access','business1',uid,command.requestId])), membershipRevision: Number(command.expectedMembershipRevision)+1, teamRevision: Number(command.expectedTeamRevision ?? 1)+1, recordedAt: 2000 }, replayed: false, teamRevision: 2, current: { ...membership(status), revision: 2, updatedAt: 2000, ...(uid === 'owner' ? { memberUid: 'staff' } : {}) } };
}
export function setup() { token.mockReset().mockResolvedValue('synthetic-token'); vi.stubGlobal('crypto', webcrypto); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.stubGlobal('fetch', vi.fn(async () => response(ownerView()))); auth.user.uid = 'owner'; auth.authEpoch = 1; }

export function receiptEvent(applied: ReturnType<typeof proof>['applied'], kind: 'approve'|'reject'|'revoke' = 'reject') {
  return { id: applied.eventId, sequence: applied.teamRevision, membershipId: 'member1', memberUid: 'staff', actorUid: 'owner',
    beforeStatus: kind === 'revoke' ? 'active' : 'requested', afterStatus: kind === 'approve' ? 'active' : kind === 'reject' ? 'rejected' : 'revoked',
    role: kind === 'reject' ? null : { id: 'own_agenda_viewer', version: 1 }, resourceId: kind === 'reject' ? null : 'resource1', recordedAt: applied.recordedAt };
}
