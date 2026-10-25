import { act, createElement } from 'react';
import { create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useWaitlist } from '@/hooks/use-waitlist';
import { apiFetch, ApiError } from '@/lib/client/api';
import type { WaitlistState } from '@/types/waitlist';

vi.mock('@/lib/client/api', async original => ({ ...await original<typeof import('@/lib/client/api')>(), apiFetch: vi.fn() }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const now = Date.parse('2030-01-01T15:00:00Z');
const empty: WaitlistState = { businessId: 'demo-business', ownerUid: 'demo-client', revision: 0, serverNow: now, request: null };
const waiting: WaitlistState = { ...empty, revision: 1, request: { id: 'demo-entry', serviceId: 'cut', dateKey: '2030-01-01', resourceId: 'one', subjectKind: 'self', createdAt: now, expiresAt: Date.parse('2030-01-02T05:00:00Z'), status: 'waiting', checkedAt: now } };
const input = { case: { bookingRequestId: 'demo-case', subjectKind: 'self' as const }, serviceId: 'cut', dateKey: '2030-01-01', resourceId: 'one' };
let renderer: ReactTestRenderer | undefined, controller!: ReturnType<typeof useWaitlist>;
const acquire = vi.fn(() => true), release = vi.fn();
function Harness({ uid = 'demo-client', businessId = 'demo-business', canJoin = true, actionsLocked = false, lease }: { uid?: string; businessId?: string; canJoin?: boolean; actionsLocked?: boolean; lease?: () => false | (() => void) }) {
  controller = useWaitlist(businessId, uid, { canJoin, actionsLocked, acquireAction: lease ?? acquire, releaseAction: release } as Parameters<typeof useWaitlist>[2]); return null;
}
const mount = async (props = {}) => act(async () => { renderer = create(createElement(Harness, props)); });
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(now); acquire.mockReturnValue(true); vi.mocked(apiFetch).mockResolvedValue(empty); });
afterEach(async () => { await act(async () => renderer?.unmount()); renderer = undefined; vi.useRealTimers(); vi.clearAllMocks(); });
it('releases only the callback captured by its own acquired lease', async () => {
  const ownRelease = vi.fn(); await mount({ lease: () => ownRelease });
  vi.mocked(apiFetch).mockResolvedValueOnce(waiting);
  await act(async () => controller.join(input));
  expect(ownRelease).toHaveBeenCalledTimes(1); expect(release).not.toHaveBeenCalled();
});

it('reads once with the expected identity, without polling, and refreshes explicitly', async () => {
  await mount(); expect(controller.data).toEqual(empty); expect(controller.loading).toBe(false);
  expect(vi.mocked(apiFetch).mock.calls[0][2]).toBe('demo-client');
  await act(async () => vi.advanceTimersByTimeAsync(90000)); expect(vi.mocked(apiFetch).mock.calls).toHaveLength(1);
  vi.mocked(apiFetch).mockResolvedValue(waiting); await act(async () => controller.refresh()); expect(controller.request).toEqual(waiting.request);
});
it('latches a join synchronously and saves only the exact selected filters and fresh operation', async () => {
  await mount(); let finish!: (value: WaitlistState) => void;
  vi.mocked(apiFetch).mockImplementationOnce(async () => new Promise(resolve => { finish = resolve; }));
  let pending!: Promise<void>; act(() => { pending = controller.join(input); void controller.join(input); });
  expect(controller.busy).toBe(true); expect(vi.mocked(apiFetch).mock.calls).toHaveLength(2);
  const body = JSON.parse(vi.mocked(apiFetch).mock.calls[1][1]!.body as string);
  expect(body).toMatchObject({ ...input, expectedRevision: 0 }); expect(typeof body.requestId).toBe('string');
  expect(Object.keys(body).sort()).toEqual(['case', 'dateKey', 'expectedRevision', 'requestId', 'resourceId', 'serviceId']);
  await act(async () => { finish(waiting); await pending; }); expect(controller.request).toEqual(waiting.request); expect(release).toHaveBeenCalledTimes(1);
});
it('reconciles a lost join response with GET without replaying the mutation or preserving a stale network error', async () => {
  await mount(); vi.mocked(apiFetch).mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValueOnce(waiting);
  await act(async () => controller.join(input));
  expect(controller.request).toEqual(waiting.request); expect(controller.actionError).toBeNull(); expect(controller.reconciling).toBe(false);
  expect(vi.mocked(apiFetch).mock.calls.slice(1).map(call => call[1]?.method ?? 'GET')).toEqual(['POST', 'GET']);
});
it.each([500, 502, 503, 504])('clears an ambiguous HTTP %s save error after GET recovers the committed request', async status => {
  await mount(); vi.mocked(apiFetch).mockRejectedValueOnce(new ApiError('Servicio temporalmente no disponible.', status)).mockResolvedValueOnce(waiting);
  await act(async () => controller.join(input));
  expect(controller.request).toEqual(waiting.request); expect(controller.actionError).toBeNull(); expect(controller.reconciling).toBe(false);
  expect(vi.mocked(apiFetch).mock.calls.slice(1).map(call => call[1]?.method ?? 'GET')).toEqual(['POST', 'GET']);
  expect(release).toHaveBeenCalledTimes(1);
});
it('keeps an ambiguous save blocked until an explicit successful reconciliation and does not claim an empty list', async () => {
  await mount(); vi.mocked(apiFetch).mockRejectedValueOnce(new Error('lost')).mockRejectedValueOnce(new Error('offline'));
  await act(async () => controller.join(input)); expect(controller.reconciling).toBe(true); expect(controller.readError).toBeTruthy();
  expect(release).not.toHaveBeenCalled();
  const calls = vi.mocked(apiFetch).mock.calls.length; await act(async () => controller.join(input)); expect(vi.mocked(apiFetch).mock.calls).toHaveLength(calls);
  vi.mocked(apiFetch).mockResolvedValue(waiting); await act(async () => controller.refresh()); expect(controller.request).toEqual(waiting.request); expect(controller.reconciling).toBe(false);
  expect(release).toHaveBeenCalledTimes(1);
});
it('retains definite rejection copy after reconciliation and permits a new explicit attempt only when cleared', async () => {
  await mount(); vi.mocked(apiFetch).mockRejectedValueOnce(new ApiError('Revisa tus permisos.', 403)).mockResolvedValueOnce(empty);
  await act(async () => controller.join(input)); expect(controller.actionError).toBe('Revisa tus permisos.'); expect(controller.reconciling).toBe(false);
});
it.each(['canJoin', 'actionsLocked', 'mutex'] as const)('rejects a retained join when the current %s gate changes', async gate => {
  await mount(); const retained = controller.join;
  if (gate === 'mutex') acquire.mockReturnValue(false); else await act(async () => renderer!.update(createElement(Harness, gate === 'canJoin' ? { canJoin: false } : { actionsLocked: true })));
  await act(async () => retained(input)); expect(vi.mocked(apiFetch).mock.calls).toHaveLength(1);
});
it('cancels a suspended request without new-booking permission and reconciles a lost response', async () => {
  vi.mocked(apiFetch).mockResolvedValueOnce({ ...waiting, request: { ...waiting.request!, status: 'suspended', reason: 'consent_changed', checkedAt: null } }); await mount({ canJoin: false });
  vi.mocked(apiFetch).mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValueOnce({ ...empty, revision: 2 });
  await act(async () => controller.cancel()); expect(controller.request).toBeNull(); expect(controller.actionError).toBeNull();
  const [path, init, uid] = vi.mocked(apiFetch).mock.calls[1]; expect(path).toBe('/api/businesses/demo-business/waitlist/cancel'); expect(uid).toBe('demo-client');
  expect(JSON.parse(init!.body as string)).toMatchObject({ entryId: 'demo-entry', expectedRevision: 1 });
});
it('blocks a retained cancel after the request revision changes', async () => {
  vi.mocked(apiFetch).mockResolvedValueOnce(waiting); await mount(); const retained = controller.cancel;
  vi.mocked(apiFetch).mockResolvedValueOnce({ ...waiting, revision: 3, request: { ...waiting.request!, id: 'demo-new-entry' } }); await act(async () => controller.refresh());
  await act(async () => retained()); expect(vi.mocked(apiFetch).mock.calls).toHaveLength(2);
});
it('discards late reads and retained actions through account A to B to A', async () => {
  const reads: { signal: AbortSignal; finish: (value: WaitlistState) => void }[] = [];
  vi.mocked(apiFetch).mockImplementation(async (_path, init) => new Promise(resolve => reads.push({ signal: init!.signal as AbortSignal, finish: resolve })));
  await mount(); const oldJoin = controller.join;
  await act(async () => renderer!.update(createElement(Harness, { uid: 'demo-other' })));
  await act(async () => renderer!.update(createElement(Harness)));
  expect(reads[0].signal.aborted).toBe(true); await act(async () => reads[0].finish(waiting)); expect(controller.request).toBeNull();
  await act(async () => reads[2].finish(empty)); await act(async () => oldJoin(input)); expect(vi.mocked(apiFetch).mock.calls).toHaveLength(3);
});
it('does not let an older GET overwrite a committed join', async () => {
  await mount(); let oldRead!: (data: WaitlistState) => void;
  vi.mocked(apiFetch).mockImplementationOnce(async () => new Promise(resolve => { oldRead = resolve; }));
  let reading!: Promise<void>; act(() => { reading = controller.refresh(); });
  // Joining stays blocked while a current read is unresolved.
  await act(async () => controller.join(input)); expect(vi.mocked(apiFetch).mock.calls).toHaveLength(2);
  await act(async () => { oldRead(empty); await reading; });
  vi.mocked(apiFetch).mockResolvedValueOnce(waiting); await act(async () => controller.join(input)); expect(controller.request?.id).toBe('demo-entry');
});
it.each([
  { ownerUid: 'another' }, { businessId: 'another' }, { revision: -1 },
  { request: { ...waiting.request!, status: 'available', checkedAt: null } },
  { request: { ...waiting.request!, dateKey: '2030-02-30' } },
  { request: { ...waiting.request!, subjectKind: 'represented_minor' } },
  { request: { ...waiting.request!, privateName: 'not allowed' } },
])('rejects a malformed or cross-scope DTO rather than exposing a request: %j', async patch => {
  vi.mocked(apiFetch).mockResolvedValueOnce({ ...waiting, ...patch }); await mount(); expect(controller.readError).toBeTruthy(); expect(controller.request).toBeNull();
});
it('expires availability at the server-derived boundary without another API request or write', async () => {
  vi.setSystemTime(now - 86400000);
  vi.mocked(apiFetch).mockResolvedValueOnce({ ...waiting, request: { ...waiting.request!, status: 'available', expiresAt: now + 1000 } });
  await mount(); expect(controller.request?.status).toBe('available');
  expect(typeof controller.canResume).toBe('function');
  const original = controller.request!; expect(controller.canResume(original, 1)).toBe(true);
  await act(async () => vi.advanceTimersByTimeAsync(1001)); expect(controller.request?.status).toBe('expired'); expect(vi.mocked(apiFetch).mock.calls).toHaveLength(1);
  expect(controller.canResume(original, 1)).toBe(false);
});
