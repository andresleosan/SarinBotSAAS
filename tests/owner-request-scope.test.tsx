import { act, createElement } from 'react';
import { create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ownerApiFetch, type OwnerRequestScope } from '@/lib/client/owner-request-scope';
import { useOwnerAuthority } from '@/hooks/use-owner-authority';
import { apiFetch, ApiError } from '@/lib/client/api';

const auth = vi.hoisted(() => ({ user: { uid: 'demo-owner' } as { uid: string } | null, authEpoch: 1, invalidateSession: vi.fn(), isCurrentSession: (uid: string, epoch: number) => auth.user?.uid === uid && auth.authEpoch === epoch }));
vi.mock('@/components/auth-provider', () => ({ useAuth: () => auth }));
vi.mock('@/lib/client/api', async original => ({ ...await original<typeof import('@/lib/client/api')>(), apiFetch: vi.fn() }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let renderer: ReactTestRenderer | undefined, authority!: ReturnType<typeof useOwnerAuthority>;
function Harness() { authority = useOwnerAuthority({ ownerUid: 'demo-owner', authEpoch: 1, businessId: 'demo-business' }); return null; }
const mount = async () => act(async () => { renderer = create(createElement(Harness)); });
const deferred = <T,>() => { let resolve!: (value: T) => void, reject!: (error: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
beforeEach(() => { vi.useFakeTimers(); auth.user = { uid: 'demo-owner' }; auth.authEpoch = 1; auth.invalidateSession.mockReset(); vi.mocked(apiFetch).mockReset(); });
afterEach(async () => { await act(async () => renderer?.unmount()); renderer = undefined; vi.useRealTimers(); });

it('feature denial protects without changing command identity or posting a probe', async () => {
  await mount(); const scope = authority.requestScope;
  await act(async () => scope.onAccessDenied({ status: 403, source: 'feature', code: 'OWNER_RESCHEDULE_UNSUPPORTED' }));
  expect(authority.protected).toBe(true); expect(authority.revoked).toBe(false); expect(scope.isCurrent()).toBe(true);
  expect(authority.requestScope).toBe(scope); expect(scope.canRead()).toBe(false); expect(scope.canStartAction()).toBe(false);
  expect(apiFetch).not.toHaveBeenCalled(); expect(auth.invalidateSession).not.toHaveBeenCalled();
});
it('same owner probe renews read generation without resolving or resending a feature command', async () => {
  await mount(); const scope = authority.requestScope, initial = scope.readGeneration;
  await act(async () => scope.onAccessDenied({ status: 403, source: 'feature', code: 'FEATURE_CLOSED' }));
  vi.mocked(apiFetch).mockResolvedValueOnce({ business: { id: 'demo-business', ownerUid: 'demo-owner' } });
  await act(async () => authority.checkAccess());
  expect(authority.protected).toBe(false); expect(authority.requestScope).toBe(scope); expect(scope.readGeneration).toBeGreaterThan(initial);
  expect(authority.featureCode).toBe('FEATURE_CLOSED'); expect(vi.mocked(apiFetch).mock.calls.map(call => [call[0], call[1]?.method])).toEqual([['/api/businesses', undefined]]);
});
it.each([null, { id: 'demo-business', ownerUid: 'demo-new-owner' }, { id: 'demo-other', ownerUid: 'demo-owner' }])('verified owner loss purges scope (%j)', async business => {
  await mount(); const scope = authority.requestScope; await act(async () => scope.onAccessDenied({ status: 403, source: 'feature' }));
  vi.mocked(apiFetch).mockResolvedValueOnce({ business }); await act(async () => authority.checkAccess());
  expect(authority.revoked).toBe(true); expect(scope.isCurrent()).toBe(false);
});
it('authoritative 403 revokes and 401 invalidates only the captured session', async () => {
  await mount(); const scope = authority.requestScope;
  await act(async () => scope.onAccessDenied({ status: 401, source: 'feature' }));
  expect(auth.invalidateSession).toHaveBeenCalledWith('demo-owner', 1); expect(scope.isCurrent()).toBe(false);
});
it('authoritative business 403 revokes even before its JSON settles', async () => {
  await mount(); const pending = deferred<unknown>();
  vi.mocked(apiFetch).mockImplementationOnce(async (_path, _init, _uid, _current, status) => { status?.(403); return pending.promise; });
  let request!: Promise<void>; await act(async () => { request = authority.checkAccess(); });
  expect(authority.revoked).toBe(true); pending.resolve({ business: { id: 'demo-business', ownerUid: 'demo-owner' } }); await act(async () => request);
  expect(authority.revoked).toBe(true);
});
it('probe deadline includes an uncooperative token/body and preserves protection', async () => {
  await mount(); await act(async () => authority.requestScope.onAccessDenied({ status: 403, source: 'feature' }));
  const pending = deferred<unknown>(); vi.mocked(apiFetch).mockReturnValueOnce(pending.promise);
  let request!: Promise<void>; await act(async () => { request = authority.checkAccess(); });
  await act(async () => { void authority.checkAccess(); await vi.advanceTimersByTimeAsync(10000); await request; });
  expect(authority.checking).toBe(false); expect(authority.protected).toBe(true); expect(authority.revoked).toBe(false);
  expect(vi.mocked(apiFetch).mock.calls).toHaveLength(1); expect(vi.mocked(apiFetch).mock.calls[0][1]?.signal?.aborted).toBe(true);
  await act(async () => pending.resolve({ business: { id: 'demo-business', ownerUid: 'demo-owner' } })); expect(authority.protected).toBe(true);
});
it.each([{}, { business: {} }, { business: 'invalid' }])('malformed probe cannot claim owner loss or reactivate writes (%j)', async value => {
  await mount(); await act(async () => authority.requestScope.onAccessDenied({ status: 403, source: 'feature' }));
  vi.mocked(apiFetch).mockResolvedValueOnce(value); await act(async () => authority.checkAccess());
  expect(authority.protected).toBe(true); expect(authority.revoked).toBe(false);
});
it('request wrapper separates read generations from in-flight writes and reports typed denial', async () => {
  let generation = 0, allowed = true;
  const failures: unknown[] = [];
  const scope: OwnerRequestScope = { ownerUid: 'demo-owner', authEpoch: 1, businessId: 'demo-business', get readGeneration() { return generation; }, isCurrent: () => true, canRead: () => allowed, canStartAction: () => allowed, onAccessDenied: failure => { failures.push(failure); allowed = false; generation++; } };
  const pending = deferred<unknown>(); vi.mocked(apiFetch).mockReturnValueOnce(pending.promise);
  const writing = ownerApiFetch(scope, 'write', '/api/businesses/demo-business/feature', { method: 'POST', body: '{"confirm":true}' });
  const call = vi.mocked(apiFetch).mock.calls[0]; allowed = false; generation++; expect(call[3]?.()).toBe(true);
  pending.resolve({ ok: true }); expect(await writing).toEqual({ ok: true });
  await expect(ownerApiFetch(scope, 'read', '/api/businesses/demo-business/feature')).rejects.toMatchObject({ status: 403 });
  allowed = true;
  vi.mocked(apiFetch).mockImplementationOnce(async (_path, _init, _uid, _current, status) => { status?.(403); throw new ApiError('Feature blocked', 403, 'FEATURE_CLOSED'); });
  await expect(ownerApiFetch(scope, 'read', '/api/businesses/demo-business/feature')).rejects.toMatchObject({ status: 403 });
  expect(failures).toEqual([{ status: 403, source: 'feature', code: undefined }, { status: 403, source: 'feature', code: 'FEATURE_CLOSED' }]);
  expect(call[2]).toBe('demo-owner');
});
