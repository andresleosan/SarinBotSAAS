import { act, createElement } from 'react';
import { create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useOwnerClientRecord, type OwnerClientRecordScope } from '@/hooks/use-owner-client-record';
import { ownerClientRecordAppointment as appointment } from './owner-client-record-fixture';
import type { OwnerClientRecordPage } from '@/lib/owner-client-record';

const auth = vi.hoisted(() => ({ uid: 'demo-owner', epoch: 1, token: vi.fn(), current: true }));
vi.mock('@/components/auth-provider', () => ({ useAuth: () => ({ user: { uid: auth.uid }, authEpoch: auth.epoch, isCurrentSession: (uid: string, epoch: number) => auth.current && uid === auth.uid && epoch === auth.epoch }) }));
vi.mock('@/lib/firebase/client', () => ({ getFirebaseClient: () => ({ auth: { currentUser: { uid: auth.uid, getIdToken: auth.token } } }) }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const scope: OwnerClientRecordScope = { businessId: appointment.tenantId, ownerUid: 'demo-owner', dateKey: appointment.dateKey, sourceAppointmentId: appointment.id, clientUid: appointment.client.uid };
function page(count = 1, offset = 0): OwnerClientRecordPage {
  const rows = Array.from({ length: count }, (_, i) => ({ appointmentId: `demo-${String(i + offset).padStart(3, '0')}`, dateKey: appointment.dateKey, startAt: appointment.startAt - (i + offset) * 1000, endAt: null, status: 'confirmed' as const, resourceLabel: 'Demo resource', beneficiaryKind: 'represented_minor' as const }));
  return { scope: { businessId: scope.businessId, sourceAppointmentId: scope.sourceAppointmentId, clientUid: scope.clientUid }, filter: 'all', checkedAt: appointment.startAt, rows, nextCursor: count === 20 ? { appointmentId: rows[19].appointmentId, startAt: rows[19].startAt, revision: 'a'.repeat(64) } : null, coverage: { mode: 'indexed_appointments', completeness: 'not_guaranteed' } };
}
function deferred<T>() { let resolve!: (value: T) => void, reject!: (reason: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
const response = (data: unknown, status = 200) => ({ ok: status < 400, status, headers: new Headers(), json: async () => data }) as Response;
let tree: ReactTestRenderer | undefined;
let result: ReturnType<typeof useOwnerClientRecord>;
let input: Parameters<typeof useOwnerClientRecord>[0];
let renders: (ReturnType<typeof useOwnerClientRecord>)[];
const fetchMock = vi.fn<typeof fetch>();
function Harness() { result = useOwnerClientRecord(input); renders.push(result); return null; }
const mount = async () => { await act(async () => { tree = create(createElement(Harness)); }); };
const update = async () => { await act(async () => tree!.update(createElement(Harness))); };
const flush = async () => { await act(async () => { await Promise.resolve(); }); };
const init = (index = 0) => fetchMock.mock.calls[index][1]!;
beforeEach(() => {
  vi.useFakeTimers(); auth.uid = 'demo-owner'; auth.epoch = 1; auth.current = true; auth.token.mockReset().mockResolvedValue('demo-token');
  fetchMock.mockReset().mockResolvedValue(response(page())); vi.stubGlobal('fetch', fetchMock);
  input = { scope, enabled: true, invalidation: 0 }; renders = [];
});
afterEach(async () => { await act(async () => tree?.unmount()); tree = undefined; vi.useRealTimers(); vi.unstubAllGlobals(); });

it('doesNotLoadBeforeExplicitOpen', async () => { input.enabled = false; await mount(); expect(fetchMock).not.toHaveBeenCalled(); expect(result.page).toBeNull(); input = { ...input, enabled: true }; await update(); expect(result.page?.rows).toHaveLength(1); });
it('bodyCarriesExactSourceUidAndFilter', async () => { await mount(); expect(fetchMock.mock.calls[0][0]).toBe(`/api/businesses/${scope.businessId}/appointments/${scope.sourceAppointmentId}/client-record`); expect(init().method).toBe('POST'); expect(JSON.parse(String(init().body))).toEqual({ clientUid: scope.clientUid, filter: 'all' }); expect(new Headers(init().headers).get('Authorization')).toBe('Bearer demo-token'); });
it('neverUsesMineOrAnotherDailyGet', async () => { await mount(); await act(async () => result.refresh()); expect(fetchMock.mock.calls.every(([path, options]) => String(path).endsWith('/client-record') && !String(path).includes('?') && options?.method === 'POST')).toBe(true); });
it('scopeChangeMasksBeforeEffects', async () => { await mount(); renders = []; const next = { ...scope, sourceAppointmentId: 'demo-next' }; fetchMock.mockResolvedValue(response({ ...page(), scope: { ...page().scope, sourceAppointmentId: next.sourceAppointmentId } })); input = { ...input, scope: next }; await update(); expect(renders[0].page).toBeNull(); });
it('filterChangeResetsCursorAndAborts', async () => { const pending = deferred<Response>(); fetchMock.mockReturnValueOnce(pending.promise); await mount(); const signal = init().signal!; await act(async () => result.setFilter('completed')); expect(signal.aborted).toBe(true); expect(JSON.parse(String(init(1).body))).toEqual({ clientUid: scope.clientUid, filter: 'completed' }); expect(result.page).toBeNull(); });
it.each(['ownerUid', 'businessId', 'sourceAppointmentId', 'clientUid', 'dateKey', 'epoch', 'filter'] as const)('latePagesCannotCrossAccountBusinessSourceOrFilter: %s', async field => {
  const pending = deferred<Response>(); fetchMock.mockReturnValueOnce(pending.promise); await mount();
  fetchMock.mockReturnValue(new Promise(() => {}));
  if (field === 'epoch') auth.epoch++;
  else if (field === 'filter') { await act(async () => result.setFilter('no_show')); }
  else { input = { ...input, scope: { ...scope, [field]: field === 'dateKey' ? '2030-01-08' : 'demo-other' } }; }
  await update(); await act(async () => pending.resolve(response(page()))); expect(result.page).toBeNull();
});
it.each(['token', 'fetch', 'body'])('deadlineTenSeconds includes stalled %s', async phase => {
  const pending = deferred<never>();
  if (phase === 'token') auth.token.mockReturnValue(pending.promise);
  if (phase === 'fetch') fetchMock.mockReturnValue(pending.promise);
  if (phase === 'body') fetchMock.mockResolvedValue({ ...response(null), json: () => pending.promise } as Response);
  await mount(); expect(result.loading).toBe(true); await act(async () => vi.advanceTimersByTimeAsync(9999)); expect(result.loading).toBe(true);
  await act(async () => vi.advanceTimersByTimeAsync(1)); expect(result.loading).toBe(false); expect(result.error).toMatch(/tiempo/i); expect(result.page).toBeNull();
  if (phase !== 'token') expect(init().signal?.aborted).toBe(true);
  await act(async () => pending.reject(new Error('late failure'))); expect(result.page).toBeNull(); expect(fetchMock.mock.calls.length).toBe(phase === 'token' ? 0 : 1);
});
it('closingAbortsAndClears', async () => { await mount(); const pending = deferred<Response>(); fetchMock.mockReturnValue(pending.promise); let refresh!: Promise<void>; await act(async () => { refresh = result.refresh(); }); input = { ...input, enabled: false }; await update(); await refresh; expect(init(1).signal?.aborted).toBe(true); expect(result.page).toBeNull(); expect(result.loading).toBe(false); expect(vi.getTimerCount()).toBe(0); });
it.each([401, 403])('unauthorizedClearsPrivatePage and closes selection immediately: %s', async status => {
  const close = vi.fn(); input.onAccessLost = close; await mount(); const body = deferred<never>(); fetchMock.mockResolvedValue({ ...response(null, status), json: () => body.promise } as Response);
  await act(async () => { void result.refresh(); }); expect(result.page).toBeNull(); expect(result.loading).toBe(false); expect(close).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0); await act(async () => body.reject(new Error('late body'))); expect(close).toHaveBeenCalledTimes(1);
});
it('stale unauthorized headers cannot close a newly opened record', async () => { const close = vi.fn(); input.onAccessLost = close; const pending = deferred<Response>(); fetchMock.mockReturnValueOnce(pending.promise); await mount(); input = { ...input, scope: { ...scope, sourceAppointmentId: 'new-source' } }; fetchMock.mockResolvedValue(response({ ...page(), scope: { ...page().scope, sourceAppointmentId: 'new-source' } })); await update(); await act(async () => pending.resolve(response({}, 403))); expect(close).not.toHaveBeenCalled(); expect(result.page?.scope.sourceAppointmentId).toBe('new-source'); });
it('cleansTimersAndConsumesLateResponses', async () => { const pending = deferred<Response>(); fetchMock.mockReturnValue(pending.promise); await mount(); await act(async () => tree!.unmount()); tree = undefined; expect(vi.getTimerCount()).toBe(0); expect(init().signal?.aborted).toBe(true); await act(async () => pending.reject(new Error('late'))); });
it('olderPageReplacesInsteadOfAccumulating', async () => { fetchMock.mockResolvedValueOnce(response(page(20))).mockResolvedValueOnce(response(page(2, 20))); await mount(); await act(async () => result.loadOlder()); expect(result.page?.rows.map(row => row.appointmentId)).toEqual(['demo-020', 'demo-021']); expect(JSON.parse(String(init(1).body)).cursor).toEqual(page(20).nextCursor); });
it('failedOlderPageRetainsCurrentScopePageWithError and retries same cursor explicitly', async () => { fetchMock.mockResolvedValueOnce(response(page(20))).mockResolvedValueOnce(response({}, 503)).mockResolvedValueOnce(response(page(1, 20))); await mount(); await act(async () => result.loadOlder()); expect(result.page?.rows).toHaveLength(20); expect(result.error).toBeTruthy(); expect(result.error).not.toMatch(/sin historial|no hay reservas/i); await flush(); expect(fetchMock).toHaveBeenCalledTimes(2); await act(async () => result.loadOlder()); expect(init(2).body).toBe(init(1).body); expect(result.page?.rows[0].appointmentId).toBe('demo-020'); });
it('headRefreshDoesNotMixOldPages', async () => { fetchMock.mockResolvedValueOnce(response(page(20))).mockResolvedValueOnce(response(page(2, 20))).mockResolvedValueOnce(response(page(1))); await mount(); await act(async () => result.loadOlder()); await act(async () => result.refresh()); expect(JSON.parse(String(init(2).body))).not.toHaveProperty('cursor'); expect(result.page?.rows.map(row => row.appointmentId)).toEqual(['demo-000']); });
it('repeatedIdFromCurrentPageRequiresRefresh', async () => { const duplicate = page(1, 20); duplicate.rows[0].appointmentId = 'demo-000'; fetchMock.mockResolvedValueOnce(response(page(20))).mockResolvedValueOnce(response(duplicate)); await mount(); await act(async () => result.loadOlder()); expect(result.page?.rows).toHaveLength(20); expect(result.error).toMatch(/Actualizar/); await act(async () => result.loadOlder()); expect(fetchMock).toHaveBeenCalledTimes(2); });
it('anchorChangedOffersRestart', async () => { fetchMock.mockResolvedValueOnce(response(page(20))).mockResolvedValueOnce(response({ code: 'CLIENT_RECORD_CHANGED' }, 409)).mockResolvedValueOnce(response(page(1))); await mount(); await act(async () => result.loadOlder()); expect(result.error).toMatch(/Actualizar/); await act(async () => result.loadOlder()); expect(fetchMock).toHaveBeenCalledTimes(2); await act(async () => result.refresh()); expect(result.page?.rows).toHaveLength(1); });
it('failedHeadRefreshKeepsChangedAnchorBlocked', async () => { fetchMock.mockResolvedValueOnce(response(page(20))).mockResolvedValueOnce(response({}, 409)).mockResolvedValueOnce(response({}, 503)); await mount(); await act(async () => result.loadOlder()); await act(async () => result.refresh()); await act(async () => result.loadOlder()); expect(fetchMock).toHaveBeenCalledTimes(3); expect(result.error).toMatch(/Actualizar/); });
it('409HeadersWithHangingBodyKeepCursorBlockedAfterDeadlineAndFailedHeadRefresh', async () => {
  const body = deferred<never>();
  fetchMock.mockResolvedValueOnce(response(page(20)))
    .mockResolvedValueOnce({ ...response(null, 409), json: () => body.promise } as Response)
    .mockResolvedValueOnce(response({}, 503))
    .mockResolvedValueOnce(response(page(20)))
    .mockResolvedValueOnce(response(page(1, 20)));
  await mount();
  await act(async () => { void result.loadOlder(); });
  await act(async () => vi.advanceTimersByTimeAsync(10_000));
  expect(result.page?.rows).toHaveLength(20);
  expect(result.error).toMatch(/Actualizar/);
  await act(async () => result.loadOlder());
  expect(fetchMock).toHaveBeenCalledTimes(2);
  await act(async () => result.refresh());
  expect(JSON.parse(String(init(2).body))).not.toHaveProperty('cursor');
  await act(async () => result.loadOlder());
  expect(fetchMock).toHaveBeenCalledTimes(3);
  expect(result.error).toMatch(/Actualizar/);
  await act(async () => result.refresh());
  await act(async () => result.loadOlder());
  expect(result.page?.rows[0].appointmentId).toBe('demo-020');
  expect(fetchMock).toHaveBeenCalledTimes(5);
  await act(async () => body.reject(new Error('late 409 body failure')));
  expect(result.error).toBeNull();
});
it('409HeadersSettleImmediatelySoExplicitRefreshDoesNotWaitForBody', async () => {
  const body = deferred<never>();
  fetchMock.mockResolvedValueOnce(response(page(20)))
    .mockResolvedValueOnce({ ...response(null, 409), json: () => body.promise } as Response)
    .mockResolvedValueOnce(response(page(1)));
  await mount();
  let settled = false;
  await act(async () => { void result.loadOlder().then(() => { settled = true; }); });
  expect(settled).toBe(true);
  expect(result.loading).toBe(false);
  expect(result.error).toMatch(/Actualizar/);
  expect(init(1).signal?.aborted).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
  await act(async () => result.refresh());
  expect(fetchMock).toHaveBeenCalledTimes(3);
  expect(result.page?.rows).toHaveLength(1);
  await act(async () => body.reject(new Error('late 409 body failure')));
});
it('stale409HeadersCannotBlockContinuationInNewScope', async () => {
  const pending = deferred<Response>();
  fetchMock.mockResolvedValueOnce(response(page(20))).mockReturnValueOnce(pending.promise);
  await mount();
  await act(async () => { void result.loadOlder(); });
  const nextScope = { ...scope, sourceAppointmentId: 'new-source' };
  const nextPage = (count: number, offset = 0) => ({ ...page(count, offset), scope: { ...page().scope, sourceAppointmentId: nextScope.sourceAppointmentId } });
  input = { ...input, scope: nextScope };
  fetchMock.mockResolvedValueOnce(response(nextPage(20))).mockResolvedValueOnce(response(nextPage(1, 20)));
  await update();
  await act(async () => pending.resolve(response({}, 409)));
  expect(result.error).toBeNull();
  await act(async () => result.loadOlder());
  expect(fetchMock).toHaveBeenCalledTimes(4);
  expect(result.page?.scope.sourceAppointmentId).toBe('new-source');
  expect(result.page?.rows[0].appointmentId).toBe('demo-020');
});
it('disablingAbortsAndMasksWithoutReportingAuthorizationLoss', async () => { const close = vi.fn(); input.onAccessLost = close; await mount(); const pending = deferred<Response>(); fetchMock.mockReturnValue(pending.promise); await act(async () => { void result.refresh(); }); input = { ...input, enabled: false }; renders = []; await update(); expect(renders[0].page).toBeNull(); expect(init(1).signal?.aborted).toBe(true); expect(close).not.toHaveBeenCalled(); await act(async () => pending.resolve(response({}, 403))); expect(close).not.toHaveBeenCalled(); await act(async () => vi.advanceTimersByTimeAsync(60_000)); expect(fetchMock).toHaveBeenCalledTimes(2); });
it('callbackIdentityChangesDoNotRestartReads', async () => { input.onAccessLost = vi.fn(); await mount(); input = { ...input, onAccessLost: vi.fn() }; await update(); expect(fetchMock).toHaveBeenCalledTimes(1); });
it('explicitReopenCanReadSameScopeAfterAuthorizationLoss', async () => { fetchMock.mockResolvedValueOnce(response({}, 403)); await mount(); expect(result.page).toBeNull(); input = { ...input, enabled: false }; await update(); input = { ...input, enabled: true }; await update(); expect(result.page?.rows).toHaveLength(1); });
it('invalidationRejectsEarlierRead', async () => { const pending = deferred<Response>(); fetchMock.mockReturnValueOnce(pending.promise).mockResolvedValueOnce(response(page(1, 20))); await mount(); input = { ...input, invalidation: 1 }; await update(); await act(async () => pending.resolve(response(page()))); expect(result.page?.rows[0].appointmentId).toBe('demo-020'); expect(init().signal?.aborted).toBe(true); });
it.each(['extra', 'revision', 'scope', 'filter', 'order', 'duplicate', 'cursor', 'continuation'])('rejects unverified response: %s', async fault => {
  const value = structuredClone(page(20)) as OwnerClientRecordPage & { contact?: string };
  if (fault === 'extra') value.contact = 'private';
  if (fault === 'revision') value.nextCursor!.revision = 'x'.repeat(64);
  if (fault === 'scope') value.scope.clientUid = 'foreign';
  if (fault === 'filter') value.filter = 'completed';
  if (fault === 'order') value.rows.reverse();
  if (fault === 'duplicate') value.rows[1] = value.rows[0];
  if (fault === 'cursor') value.nextCursor!.appointmentId = 'different';
  if (fault === 'continuation') { fetchMock.mockResolvedValueOnce(response(page(20))).mockResolvedValueOnce(response(value)); await mount(); await act(async () => result.loadOlder()); expect(result.error).toBeTruthy(); expect(result.page?.rows).toHaveLength(20); return; }
  fetchMock.mockResolvedValue(response(value)); await mount(); expect(result.page).toBeNull(); expect(result.error).toBeTruthy();
});
it('suppresses duplicate reads while loading and disabled', async () => { const pending = deferred<Response>(); fetchMock.mockReturnValue(pending.promise); await mount(); await act(async () => { void result.refresh(); void result.loadOlder(); }); expect(fetchMock).toHaveBeenCalledTimes(1); input = { ...input, enabled: false }; await update(); await act(async () => { void result.refresh(); void result.loadOlder(); }); expect(fetchMock).toHaveBeenCalledTimes(1); });
