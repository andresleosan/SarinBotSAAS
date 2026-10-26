import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { auth, token, setup, ownerView, response, deferred, proof, receiptEvent } from './team-ui-fixtures';
vi.mock('@/components/auth-provider', () => ({ useAuth: () => auth }));
vi.mock('@/lib/firebase/client', () => ({ getFirebaseClient: () => ({ auth: { currentUser: { uid: auth.user.uid, getIdToken: () => token() } } }) }));
import { useBusinessTeam } from '@/hooks/use-business-team';
import { BusinessTeamWorkspace } from '@/components/business-team-workspace';
let renderer: ReactTestRenderer, controller: ReturnType<typeof useBusinessTeam>;
function Harness() { controller = useBusinessTeam({ businessId: 'business1', ownerUid: 'owner', authEpoch: auth.authEpoch, enabled: true }); return null; }
const mount = async () => { await act(async () => { renderer = create(createElement(Harness)); }); };
beforeEach(setup);
afterEach(async () => { await act(async () => renderer?.unmount()); vi.unstubAllGlobals(); vi.useRealTimers(); });
describe('owner team authority and command recovery', () => {
  it('requestDoesNotGrantBeforeExplicitApproval', async () => { await mount(); expect(controller.view?.requested[0].status).toBe('requested'); expect(controller.view?.active).toEqual([]); expect(vi.mocked(fetch).mock.calls.every(([, init]) => !init?.method)).toBe(true); });
  it('softDeadlineDoesNotAbortOrFreeUnknownCommand', async () => { vi.useFakeTimers(); await mount(); const pending = deferred<Response>(); vi.mocked(fetch).mockImplementationOnce(() => pending.promise); let sending!: Promise<void>; await act(async () => { sending = controller.decide('member1', { action: 'reject', requestId: 'request-123', expectedMembershipRevision: 1, expectedTeamRevision: 1 }); }); await act(async () => { await vi.advanceTimersByTimeAsync(20001); }); expect(controller.busy).toBe(true); await act(async () => controller.decide('member1', { action: 'reject', requestId: 'request-456', expectedMembershipRevision: 1, expectedTeamRevision: 1 })); expect(fetch).toHaveBeenCalledTimes(2); await act(async () => { pending.reject(new Error('lost')); await sending; }); expect(controller.pending).toBe(true); });
  it('oldReceiptDoesNotShowActiveAgain', async () => { await mount(); const command = { action: 'approve' as const, requestId: 'request-123', expectedMembershipRevision: 1, expectedTeamRevision: 1, resourceId: 'resource1' }; const result = proof(command, 'owner', 'approve', 'revoked'); vi.mocked(fetch).mockResolvedValueOnce(response(result)); await act(async () => controller.decide('member1', command)); expect(controller.applied?.requestId).toBe(command.requestId); expect(controller.current?.status).toBe('revoked'); expect(controller.view).toBeNull(); });
  it('malformedSuccessAndAbsentReceiptRetainExactReplayBarrier', async () => { await mount(); vi.mocked(fetch).mockResolvedValueOnce(response({})); const command = { action: 'reject' as const, requestId: 'request-123', expectedMembershipRevision: 1, expectedTeamRevision: 1 }; await act(async () => controller.decide('member1', command)); vi.mocked(fetch).mockResolvedValueOnce(response(ownerView())); await act(async () => controller.inspectPending()); expect(controller.pending).toBe(true); vi.mocked(fetch).mockResolvedValueOnce(response(proof(command, 'owner', 'reject', 'revoked'))); await act(async () => controller.retryPending()); expect(JSON.parse(String(vi.mocked(fetch).mock.calls.at(-1)?.[1]?.body))).toEqual(command); });
  it('sameUidOwnershipLossPurgesPrivateRoster', async () => { await mount(); vi.mocked(fetch).mockResolvedValueOnce(response({ error: 'denied' }, 403)); await act(async () => controller.refresh()); expect(controller.view).toBeNull(); expect(controller.protected).toBe(true); vi.mocked(fetch).mockResolvedValueOnce(response({ business: null })); await act(async () => controller.checkAccess()); expect(controller.revoked).toBe(true); expect(controller.pending).toBe(false); });
});

describe('owner team review with real workspace', () => {
  const business = { id: 'business1', ownerUid: 'owner', resources: [{ id: 'resource1', name: 'Estación uno', active: true }, { id: 'inactive', name: 'Inactiva', active: false }] } as import('@/types/firestore').Business;
  async function workspace(value = business) { await act(async () => { renderer = create(createElement(BusinessTeamWorkspace, { businessId: 'business1', ownerUid: 'owner', business: value })); }); }
  const text = () => JSON.stringify(renderer.toJSON());
  const button = (label: string) => renderer.root.findAllByType('button').find(node => node.children.join('') === label)!;
  const click = async (label: string) => { await act(async () => button(label).props.onClick()); };
  it('onlyAssignedResourceAndReadRoleInReview', async () => {
    await workspace();
    expect(renderer.root.findAllByType('option').map(node => node.props.value)).toEqual(['', 'resource1']);
    await act(async () => renderer.root.findByType('select').props.onChange({ target: { value: 'resource1' } }));
    await click('Revisar aprobación');
    expect(text()).toContain('agenda asignada solo lectura, versión 1');
    expect(text()).toContain('staff');
    expect(text()).toContain('Estación uno');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(button('Confirmar aprobación').props.disabled).toBe(false);
  });
  it('wrongOrInactiveResourceCannotApprove', async () => {
    await workspace();
    await act(async () => renderer.root.findByType('select').props.onChange({ target: { value: 'inactive' } }));
    expect(button('Revisar aprobación').props.disabled).toBe(true);
    await click('Revisar aprobación');
    expect(renderer.root.findAllByProps({ 'aria-label': 'Confirmación de acceso' })).toHaveLength(0);
    await act(async () => renderer.root.findByType('select').props.onChange({ target: { value: 'other-business-resource' } }));
    await click('Revisar aprobación');
    expect(fetch).toHaveBeenCalledTimes(1);
    await act(async () => renderer.update(createElement(BusinessTeamWorkspace, { businessId: 'business1', ownerUid: 'owner', business: { ...business, ownerUid: 'other-owner' } })));
    expect(renderer.root.findAllByType('option').map(node => node.props.value)).toEqual(['']);
  });
  it('revocationReviewShowsBeforeAfter', async () => {
    const value = ownerView(); vi.mocked(fetch).mockResolvedValueOnce(response({ ...value, requested: [], active: [{ ...value.requested[0], status: 'active', role: { id: 'own_agenda_viewer', version: 1 }, resourceId: 'resource1' }] }));
    await workspace(); await click('Revisar revocación');
    expect(text()).toContain('Antes: '); expect(text()).toContain('Acceso activo'); expect(text()).toContain('Acceso retirado; no cancela reservas de clientes');
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('planGateAndConsentDoNotBlockWithdrawal', async () => {
    const paused = ownerView();
    vi.mocked(fetch).mockResolvedValueOnce(response({ ...paused, enabled: false, eligible: false, active: [{ ...paused.requested[0], membershipId: 'member2', memberUid: 'staff2', status: 'active', resourceId: 'resource1', role: { id: 'own_agenda_viewer', version: 1 } }] }));
    await workspace(); expect(button('Revisar aprobación').props.disabled).toBe(true); expect(button('Revisar rechazo').props.disabled).toBe(false);
    await click('Revisar rechazo'); expect(button('Confirmar rechazo').props.disabled).toBe(false);
    await click('Revisar revocación'); expect(button('Confirmar revocación').props.disabled).toBe(false);
  });
});

describe('owner exact uncertainty isolation', () => {
  const command = { action: 'reject' as const, requestId: 'request-123', expectedMembershipRevision: 1, expectedTeamRevision: 1 };
  it('feature403WithCurrentOwnerPreservesUnknownCommandAndBlocksB', async () => {
    await mount(); vi.mocked(fetch).mockRejectedValueOnce(new Error('lost response'));
    await act(async () => controller.decide('member1', command));
    vi.mocked(fetch).mockResolvedValueOnce(response({ error: 'policy', code: 'TEAM_POLICY' }, 403));
    await act(async () => controller.refresh()); expect(controller.protected).toBe(true); expect(controller.pending).toBe(true); expect(controller.view).toBeNull();
    vi.mocked(fetch).mockResolvedValueOnce(response({ business: { id: 'business1', ownerUid: 'owner' } }));
    await act(async () => controller.checkAccess()); expect(controller.protected).toBe(false); expect(controller.pending).toBe(true);
    const count = vi.mocked(fetch).mock.calls.length;
    await act(async () => controller.decide('member1', { ...command, requestId: 'request-BBB' })); expect(fetch).toHaveBeenCalledTimes(count);
    vi.mocked(fetch).mockResolvedValueOnce(response(proof(command, 'owner', 'reject', 'revoked')));
    await act(async () => controller.retryPending()); expect(controller.pending).toBe(false); expect(JSON.parse(String(vi.mocked(fetch).mock.calls.at(-1)?.[1]?.body))).toEqual(command);
  });
  it('proofMaySettleHiddenCommandWithoutPublishingPrivateRows', async () => {
    await mount(); const pending = deferred<Response>(); vi.mocked(fetch).mockImplementationOnce(() => pending.promise); let sending!: Promise<void>;
    await act(async () => { sending = controller.decide('member1', command); await new Promise(resolve => setTimeout(resolve, 20)); });
    vi.mocked(fetch).mockResolvedValueOnce(response({ error: 'paused' }, 403)); await act(async () => controller.refresh());
    await act(async () => { pending.resolve(response(proof(command, 'owner', 'reject', 'revoked'))); await sending; });
    expect(controller.pending).toBe(false); expect(controller.view).toBeNull(); expect(controller.applied).toBeNull();
    vi.mocked(fetch).mockResolvedValueOnce(response({ business: { id: 'business1', ownerUid: 'owner' } })); await act(async () => controller.checkAccess());
    expect(controller.applied?.requestId).toBe(command.requestId); expect(controller.current?.status).toBe('revoked');
  });
  it.each(['requestId', 'commandHash', 'eventId', 'membershipRevision', 'teamRevision'] as const)('wrongProofFieldRetainsBarrier:%s', async field => {
    await mount(); const result = proof(command, 'owner', 'reject', 'revoked');
    const bad = { ...result.applied, [field]: field.includes('Revision') ? 3 : field === 'commandHash' ? '0'.repeat(64) : 'wrong-12345' };
    vi.mocked(fetch).mockResolvedValueOnce(response({ ...result, applied: bad })); await act(async () => controller.decide('member1', command));
    expect(controller.applied).toBeNull(); expect(controller.pending).toBe(true);
  });
  it('syncSealPrecedesAsyncHashAndEpochChangeCannotDispatch', async () => {
    await mount(); const digest = deferred<ArrayBuffer>(); vi.stubGlobal('crypto', { randomUUID: () => 'request-123', subtle: { digest: () => digest.promise } });
    let sending!: Promise<void>;
    await act(async () => { sending = controller.decide('member1', command); });
    expect(controller.busy).toBe(true); expect(controller.pending).toBe(true);
    await act(async () => controller.decide('member1', { ...command, requestId: 'request-BBB' })); expect(fetch).toHaveBeenCalledTimes(1);
    auth.authEpoch = 2; await act(async () => renderer.update(createElement(Harness)));
    await act(async () => { digest.resolve(new Uint8Array(32).buffer); await sending; });
    expect(vi.mocked(fetch).mock.calls.every(([,init]) => !init?.method)).toBe(true); expect(controller.pending).toBe(false);
  });
  it('ownerProbe403PurgesUnknownAndLateSuccessCannotRestoreIt', async () => {
    await mount(); const pending = deferred<Response>(); vi.mocked(fetch).mockImplementationOnce(() => pending.promise); let sending!: Promise<void>;
    await act(async () => { sending = controller.decide('member1', command); await new Promise(resolve => setTimeout(resolve, 20)); });
    vi.mocked(fetch).mockResolvedValueOnce(response({ error: 'feature' }, 403)); await act(async () => controller.refresh());
    vi.mocked(fetch).mockResolvedValueOnce(response({ error: 'owner denied' }, 403)); await act(async () => controller.checkAccess());
    expect(controller.revoked).toBe(true); expect(controller.pending).toBe(false);
    await act(async () => { pending.resolve(response(proof(command, 'owner', 'reject', 'revoked'))); await sending; }); expect(controller.applied).toBeNull(); expect(controller.view).toBeNull();
  });
});

it('secondaryTeamLinkDoesNotSaveConfiguration', async () => {
  const { OwnerConfigurationWorkspace } = await import('@/components/owner-configuration-workspace');
  const config = { name: 'Draft retained', resources: [], services: [], weeklySchedule: {}, socialLinks: [] };
  const save = vi.fn(), change = vi.fn();
  const value = { session: { section: 'summary', draft: config, issues: [], external: null }, dirty: true, configured: true, busy: false, writeBlocked: true, canSave: false, save, change } as unknown as import('@/components/owner-configuration-workspace').OwnerConfigurationController;
  await act(async () => { renderer = create(createElement(OwnerConfigurationWorkspace, { business: {} as import('@/types/firestore').Business, capability: null, policyReady: false, consentActive: false, controller: value, logo: null, assistant: null })); });
  const link = renderer.root.findByProps({ href: '/dashboard/team' });
  expect(link.props.target).toBe('_blank'); expect(link.children.join('')).toContain('otra pestaña'); expect(link.props.onClick).toBeUndefined(); expect(save).not.toHaveBeenCalled(); expect(change).not.toHaveBeenCalled(); expect(value.session.draft.name).toBe('Draft retained'); expect(fetch).not.toHaveBeenCalled();
});

it('receiptInspectionCannotReleaseWhileOriginalPromiseStillRuns', async () => {
  await mount();
  const command = { action: 'reject' as const, requestId: 'request-123', expectedMembershipRevision: 1, expectedTeamRevision: 1 };
  const waiting = deferred<Response>();
  vi.mocked(fetch).mockImplementationOnce(() => waiting.promise);
  let sending!: Promise<void>;
  await act(async () => { sending = controller.decide('member1', command); await new Promise(resolve => setTimeout(resolve, 20)); });
  const applied = proof(command, 'owner', 'reject', 'revoked').applied;
  vi.mocked(fetch).mockResolvedValueOnce(response({ ...ownerView(), requested: [], teamRevision: 2, applied, events: [receiptEvent(applied)] }));
  await act(async () => controller.inspectPending());
  expect(controller.applied?.requestId).toBe(command.requestId);
  expect(controller.busy).toBe(true);
  expect(controller.pending).toBe(true);
  await act(async () => controller.decide('member1', { ...command, requestId: 'request-BBB' }));
  expect(fetch).toHaveBeenCalledTimes(3);
  await act(async () => { waiting.resolve(response(proof(command, 'owner', 'reject', 'revoked'))); await sending; });
  expect(controller.pending).toBe(false);
});

it('lateMutationSnapshotCannotReactivateAfterNewerReceiptInspection', async () => {
  await mount();
  const command = { action: 'approve' as const, resourceId: 'resource1', requestId: 'request-123', expectedMembershipRevision: 1, expectedTeamRevision: 1 };
  const waiting = deferred<Response>(); vi.mocked(fetch).mockImplementationOnce(() => waiting.promise);
  let sending!: Promise<void>;
  await act(async () => { sending = controller.decide('member1', command); await new Promise(resolve => setTimeout(resolve, 20)); });
  const oldResult = proof(command, 'owner', 'approve', 'active');
  vi.mocked(fetch).mockResolvedValueOnce(response({ ...ownerView(), requested: [], active: [], teamRevision: 3, serverNow: 3000, applied: oldResult.applied, events: [receiptEvent(oldResult.applied, 'approve')] }));
  await act(async () => controller.inspectPending());
  expect(controller.current).toBeNull();
  await act(async () => { waiting.resolve(response(oldResult)); await sending; });
  expect(controller.applied?.requestId).toBe(command.requestId);
  expect(controller.current).toBeNull();
});

it('wrongTargetMutationAndReceiptNeverResolveSealedMember', async () => {
  await mount();
  const command = { action: 'approve' as const, resourceId: 'resource1', requestId: 'request-123', expectedMembershipRevision: 1, expectedTeamRevision: 1 };
  const result = proof(command, 'owner', 'approve', 'active');
  vi.mocked(fetch).mockResolvedValueOnce(response({ ...result, current: { ...result.current, membershipId: 'another-member', memberUid: 'another-staff' } }));
  await act(async () => controller.decide('member1', command));
  expect(controller.pending).toBe(true);
  const event = { id: result.applied.eventId, sequence: 2, membershipId: 'another-member', memberUid: 'another-staff', actorUid: 'owner', beforeStatus: 'requested', afterStatus: 'active', role: { id: 'own_agenda_viewer', version: 1 }, resourceId: 'resource1', recordedAt: 2000 };
  vi.mocked(fetch).mockResolvedValueOnce(response({ ...ownerView(), requested: [], teamRevision: 2, applied: result.applied, events: [event] }));
  await act(async () => controller.inspectPending());
  expect(controller.pending).toBe(true);
  expect(controller.applied).toBeNull();
});

it('scalarReceiptOutsideRecentEventsRequiresExactReplay', async () => {
  await mount();
  const command = { action: 'approve' as const, resourceId: 'resource1', requestId: 'request-123', expectedMembershipRevision: 1, expectedTeamRevision: 1 };
  vi.mocked(fetch).mockRejectedValueOnce(new Error('lost'));
  await act(async () => controller.decide('member1', command));
  vi.mocked(fetch).mockResolvedValueOnce(response({ ...ownerView(), requested: [], teamRevision: 30, applied: proof(command, 'owner', 'approve', 'active').applied }));
  await act(async () => controller.inspectPending());
  expect(controller.pending).toBe(true);
  expect(controller.applied).toBeNull();
  vi.mocked(fetch).mockResolvedValueOnce(response({ ...proof(command, 'owner', 'approve', 'revoked'), teamRevision: 30 }));
  await act(async () => controller.retryPending());
  expect(controller.current?.status).toBe('revoked');
});

it('keyboardReviewReceivesFocusAndReturnsToTrigger', async () => {
  const focusHeading = vi.fn(), focusTrigger = vi.fn();
  await act(async () => { renderer = create(createElement(BusinessTeamWorkspace, { businessId: 'business1', ownerUid: 'owner' }), { createNodeMock: element => element.type === 'h2' ? { focus: focusHeading } : null }); });
  const reject = renderer.root.findAllByType('button').find(node => node.children.join('') === 'Revisar rechazo')!;
  await act(async () => reject.props.onClick({ currentTarget: { focus: focusTrigger } }));
  expect(focusHeading).toHaveBeenCalled();
  const cancel = renderer.root.findAllByType('button').find(node => node.children.join('') === 'Volver sin confirmar')!;
  await act(async () => cancel.props.onClick());
  expect(focusTrigger).toHaveBeenCalled();
});

it('partialReceiptReadStillPreventsLateActiveSnapshotFromReplacingCurrentView', async () => {
  await mount();
  const command = { action: 'approve' as const, resourceId: 'resource1', requestId: 'request-123', expectedMembershipRevision: 1, expectedTeamRevision: 1 };
  const waiting = deferred<Response>(); vi.mocked(fetch).mockImplementationOnce(() => waiting.promise);
  let sending!: Promise<void>;
  await act(async () => { sending = controller.decide('member1', command); await new Promise(resolve => setTimeout(resolve, 20)); });
  const oldResult = proof(command, 'owner', 'approve', 'active');
  vi.mocked(fetch).mockResolvedValueOnce(response({ ...ownerView(), requested: [], active: [], teamRevision: 30, serverNow: 3000, applied: oldResult.applied }));
  await act(async () => controller.inspectPending());
  expect(controller.pending).toBe(true);
  await act(async () => { waiting.resolve(response(oldResult)); await sending; });
  expect(controller.applied?.requestId).toBe(command.requestId);
  expect(controller.current).toBeNull();
});
