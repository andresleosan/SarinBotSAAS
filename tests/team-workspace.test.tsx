import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { auth, token, setup, page, agenda, lookup, response, deferred } from './team-ui-fixtures';
vi.mock('@/components/auth-provider', () => ({ useAuth: () => auth }));
vi.mock('@/lib/firebase/client', () => ({ getFirebaseClient: () => ({ auth: { currentUser: { uid: auth.user.uid, getIdToken: () => token() } } }) }));
import { useTeamWorkspace } from '@/hooks/use-team-workspace';
import { TeamAssignedAgenda } from '@/components/team-assigned-agenda';
let renderer: ReactTestRenderer, controller: ReturnType<typeof useTeamWorkspace>;
function Harness({ businessId }: { businessId?: string }) { controller = useTeamWorkspace({ uid: auth.user.uid, authEpoch: auth.authEpoch, businessId, enabled: true }); return null; }
const mount = async (businessId?: string) => { await act(async () => { renderer = create(createElement(Harness, { businessId })); }); };
beforeEach(() => { setup(); auth.user.uid = 'staff'; vi.mocked(fetch).mockImplementation(async () => response(page())); });
afterEach(async () => { await act(async () => renderer?.unmount()); vi.useRealTimers(); vi.unstubAllGlobals(); });
describe('staff assigned workspace', () => {
  it('pendingIsNotAgenda', async () => { await mount(); expect(controller.page?.items[0].status).toBe('requested'); expect(controller.agenda).toBeNull(); });
  it('spacesAreOwnAndPaged', async () => { await mount(); await act(async () => controller.loadMemberships('business0')); expect(String(vi.mocked(fetch).mock.calls.at(-1)?.[0])).toBe('/api/team/memberships?afterBusinessId=business0'); expect(controller.page?.items).toHaveLength(1); });
  it('requestUsesTokenIdentityOnly', async () => { await mount(); vi.mocked(fetch).mockResolvedValueOnce(response({ ...lookup(), items: [] })); await act(async () => controller.checkBusiness('taller-demo')); vi.mocked(fetch).mockResolvedValueOnce(response({})); const command = { businessSlug: 'taller-demo', requestId: 'request-123', expectedMembershipRevision: 0 }; await act(async () => controller.requestAccess(command)); expect(JSON.parse(String(vi.mocked(fetch).mock.calls.at(-1)?.[1]?.body))).toEqual(command); expect(new Headers(vi.mocked(fetch).mock.calls.at(-1)?.[1]?.headers).get('Authorization')).toBe('Bearer synthetic-token'); });
  it('sameUidNewEpochAndLateReadsCannotRestoreAccess', async () => { await mount(); const waiting = deferred<Response>(); vi.mocked(fetch).mockImplementationOnce(() => waiting.promise); let read!: Promise<void>; await act(async () => { read = controller.checkBusiness('taller-demo'); }); auth.authEpoch = 2; vi.mocked(fetch).mockResolvedValueOnce(response(page())); await act(async () => renderer.update(createElement(Harness))); await act(async () => { waiting.resolve(response(lookup())); await read; }); expect(controller.page?.mode).toBe('page'); });
  it('gatePolicyOrResourceDenialClearsAgenda', async () => { vi.mocked(fetch).mockResolvedValue(response(agenda())); await mount('business1'); expect(controller.agenda).not.toBeNull(); vi.mocked(fetch).mockResolvedValueOnce(response({ error: 'paused' }, 403)); await act(async () => controller.readAgenda('2026-10-25')); expect(controller.agenda).toBeNull(); });
  it('networkErrorIsNotEmptySlots', async () => { vi.mocked(fetch).mockRejectedValue(new Error('sin red')); await mount('business1'); expect(controller.agenda).toBeNull(); expect(controller.error).toBeTruthy(); });
  it('assignedAgendaHasNoOwnerMenusContactsReasonsOrActions', async () => { await act(async () => { renderer = create(createElement(TeamAssignedAgenda, { view: agenda(), loading: false, error: null, onDateChange: vi.fn() })); }); const text = JSON.stringify(renderer.toJSON()); expect(text).toContain('Sin reservas'); expect(text).not.toMatch(/Copiloto|Cancelar cita|Contacto|Mi negocio/); expect(renderer.root.findAllByType('select')).toHaveLength(0); });
});

describe('staff focus, denial and exact scope', () => {
  function browserEvents() { const document = Object.assign(new EventTarget(), { visibilityState: 'visible' }); const window = new EventTarget(); vi.stubGlobal('document', document); vi.stubGlobal('window', window); return { document, window }; }
  it('focusReentryVerifiesBeforeShowingCache', async () => {
    const browser = browserEvents(); vi.mocked(fetch).mockResolvedValueOnce(response(agenda())); await mount('business1'); expect(controller.agenda).not.toBeNull();
    const fresh = deferred<Response>(); vi.mocked(fetch).mockImplementationOnce(() => fresh.promise);
    await act(async () => { browser.window.dispatchEvent(new Event('focus')); }); expect(controller.agenda).toBeNull(); expect(controller.loading).toBe(true);
    await act(async () => { fresh.resolve(response(agenda())); }); expect(controller.agenda?.resource.id).toBe('resource1');
  });
  it('visiblePollingDoesNotOverlapAndHideInvalidatesLateResponse', async () => {
    vi.useFakeTimers(); const browser = browserEvents(); vi.mocked(fetch).mockResolvedValueOnce(response(agenda())); await mount('business1');
    const pending = deferred<Response>(); vi.mocked(fetch).mockImplementationOnce(() => pending.promise);
    await act(async () => { await vi.advanceTimersByTimeAsync(15000); }); expect(fetch).toHaveBeenCalledTimes(2);
    // At 10 seconds the GET deadline releases the read; before that no overlapping poll can begin.
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); }); expect(fetch).toHaveBeenCalledTimes(2);
    browser.document.visibilityState = 'hidden'; await act(async () => { browser.document.dispatchEvent(new Event('visibilitychange')); });
    await act(async () => { pending.resolve(response(agenda())); await vi.advanceTimersByTimeAsync(30000); }); expect(controller.agenda).toBeNull(); expect(fetch).toHaveBeenCalledTimes(2); vi.useRealTimers();
  });
  it('otherResourceCannotBeChosenByQuery', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(response(agenda())); await mount('business1');
    await act(async () => controller.readAgenda('2026-10-25'));
    expect(String(vi.mocked(fetch).mock.calls.at(-1)?.[0])).toBe('/api/team/businesses/business1/agenda?date=2026-10-25');
    expect(String(vi.mocked(fetch).mock.calls.at(-1)?.[0])).not.toContain('resource');
    expect(controller.agenda).toBeNull(); // The unrelated page response cannot be parsed as an agenda.
  });
  it('lateDateAndDeniedGenerationCannotRestoreAgenda', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(response(agenda())); await mount('business1'); const old = deferred<Response>(); let reading!: Promise<void>;
    vi.mocked(fetch).mockImplementationOnce(() => old.promise); await act(async () => { reading = controller.readAgenda('2026-10-25'); });
    vi.mocked(fetch).mockResolvedValueOnce(response({ error: 'resource retired' }, 403)); await act(async () => controller.readAgenda('2026-10-26'));
    await act(async () => { old.resolve(response(agenda())); await reading; }); expect(controller.agenda).toBeNull(); expect(controller.error).toContain('acceso');
  });
  it('totalGetDeadlineIncludesTokenAndIgnoresLateSuccess', async () => {
    vi.useFakeTimers(); const waitingToken = deferred<string>(); token.mockImplementationOnce(() => waitingToken.promise);
    await mount('business1'); await act(async () => { await vi.advanceTimersByTimeAsync(10001); }); expect(controller.error).toContain('10 segundos'); expect(controller.loading).toBe(false);
    await act(async () => waitingToken.resolve('synthetic-token')); expect(controller.agenda).toBeNull(); expect(fetch).not.toHaveBeenCalled(); vi.useRealTimers();
  });
  it('leavingDoesNotChangeClientBookings', async () => {
    await mount(); vi.mocked(fetch).mockRejectedValueOnce(new Error('ack lost'));
    const command = { requestId: 'leave-1234', expectedMembershipRevision: 1 }; await act(async () => controller.leave('member1', command));
    expect(vi.mocked(fetch).mock.calls.at(-1)?.[0]).toBe('/api/team/memberships/member1'); expect(vi.mocked(fetch).mock.calls.at(-1)?.[1]?.method).toBe('DELETE'); expect(controller.pending).toBe(true);
    await act(async () => controller.requestAccess({ businessSlug: 'taller-demo', requestId: 'other-1234', expectedMembershipRevision: 0 })); expect(fetch).toHaveBeenCalledTimes(2);
    vi.mocked(fetch).mockResolvedValueOnce(response(page())); await act(async () => controller.inspectPending()); expect(controller.pending).toBe(true); expect(controller.notice).toContain('estado actual');
    vi.mocked(fetch).mockRejectedValueOnce(new Error('still lost')); await act(async () => controller.retryPending()); expect(JSON.parse(String(vi.mocked(fetch).mock.calls.at(-1)?.[1]?.body))).toEqual(command);
    expect(vi.mocked(fetch).mock.calls.every(([path]) => !String(path).includes('appointments'))).toBe(true);
  });
});

it('emptyDateCannotKeepPreviouslyAuthorizedDayVisible', async () => {
  vi.mocked(fetch).mockResolvedValueOnce(response(agenda()));
  await mount('business1');
  expect(controller.agenda).not.toBeNull();
  await act(async () => controller.readAgenda(''));
  expect(controller.agenda).toBeNull();
  expect(controller.error).toBeTruthy();
});

it('staffShellAndPendingWorkspaceNeverMountOwnerTools', async () => {
  const { TeamWorkspaceShell } = await import('@/components/team-workspace-shell');
  const { TeamWorkspace } = await import('@/components/team-workspace');
  const { AccountConsentProvider } = await import('@/components/consent-panel');
  vi.mocked(fetch).mockImplementation(async path => String(path).startsWith('/api/team/') ? response(page()) : response({ error: 'Renueva tus permisos de cuenta' }, 503));
  await act(async () => { renderer = create(createElement(AccountConsentProvider, { uid: 'staff', children: createElement(TeamWorkspaceShell, { children: createElement(TeamWorkspace) }) })); });
  const rendered = JSON.stringify(renderer.toJSON());
  expect(rendered).toContain('Mis espacios');
  expect(rendered).toContain('Solicitud pendiente');
  expect(rendered).toContain('Permisos de mi cuenta');
  expect(rendered).not.toMatch(/Copiloto|Mi negocio|Suscripción|Enlace y QR|Navegación del negocio/);
  expect(renderer.root.findAllByType('a').some(node => String(node.props.href).startsWith('/team/business'))).toBe(false);
  expect(vi.mocked(fetch).mock.calls.every(([path, init]) => !/engine|health|sarin\/chat/.test(String(path)) && !init?.method)).toBe(true);
});

it('spacesPageReplacesTwentyRowsInsteadOfAppending', async () => {
  const first = Array.from({ length: 20 }, (_, i) => ({ ...page().items[0], businessId: `business${String(i).padStart(2, '0')}`, membershipId: `member${i}` }));
  vi.mocked(fetch).mockResolvedValueOnce(response({ ...page(), items: first, nextAfterBusinessId: 'business19' }));
  await mount();
  expect(controller.page?.items).toHaveLength(20);
  vi.mocked(fetch).mockResolvedValueOnce(response({ ...page(), items: [{ ...page().items[0], businessId: 'business20' }] }));
  await act(async () => controller.loadMemberships('business19'));
  expect(controller.page?.items).toHaveLength(1);
  expect(controller.page?.items[0].businessId).toBe('business20');
});

it('verifiedSelfRequestRemainsRequestedWithoutGrantingAgenda', async () => {
  const { proof, hash } = await import('./team-ui-fixtures');
  await mount();
  vi.mocked(fetch).mockResolvedValueOnce(response({ ...lookup(), items: [] }));
  await act(async () => controller.checkBusiness('taller-demo'));
  const command = { businessSlug: 'taller-demo', requestId: 'request-123', expectedMembershipRevision: 0 };
  const result = proof(command, 'staff', 'request', 'requested');
  result.current.membershipId = hash(JSON.stringify(['business-team', 'business1', 'staff']));
  result.current.revision = 1;
  vi.mocked(fetch).mockResolvedValueOnce(response(result));
  await act(async () => controller.requestAccess(command));
  expect(controller.pending).toBe(false);
  expect(controller.applied?.membershipRevision).toBe(1);
  expect(controller.current?.status).toBe('requested');
  expect(controller.agenda).toBeNull();
});

it('controlledFutureClockKeepsAgendaFixtureAndInitialReadCoherent', async () => {
  vi.setSystemTime(new Date('2031-05-19T16:00:00Z'));
  vi.mocked(fetch).mockResolvedValueOnce(response(agenda()));
  await mount('business1');
  expect(controller.agenda).toMatchObject({ dateKey: '2031-05-19', checkedAt: Date.parse('2031-05-19T16:00:00Z') });
  expect(controller.error).toBeNull();
});
