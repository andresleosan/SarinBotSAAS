import { act, createElement } from 'react';
import { create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useClientWaitlistOffer, type ClientWaitlistOfferInput } from '@/hooks/use-client-waitlist-offer';
const auth = vi.hoisted(() => ({ uid: 'demo-client', epoch: 1 }));
vi.mock('@/components/auth-provider', () => ({ useAuth: () => ({ user: { uid: auth.uid }, authEpoch: auth.epoch, isCurrentSession: (uid: string, epoch: number) => uid === auth.uid && epoch === auth.epoch }) }));
vi.mock('@/lib/firebase/client', () => ({ getFirebaseClient: () => ({ auth: { currentUser: { uid: auth.uid, getIdToken: async () => 'synthetic-token' } } }) }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const now = Date.parse('2030-01-06T14:00:00Z');
const target = { serviceId: 'cut', serviceName: 'Corte', resourceId: 'one', resourceName: 'Uno', dateKey: '2030-01-06', startTimeStr: '15:00', endTimeStr: '15:30', startAt: Date.parse('2030-01-06T20:00:00Z'), endAt: Date.parse('2030-01-06T20:30:00Z'), reservedUntilAt: Date.parse('2030-01-06T20:35:00Z'), durationMinutes: 30, bufferMinutes: 5, priceCOP: 20000 };
const offer = { id: 'offer-one', businessId: 'demo-business', waitlistRecordId: 'record', entryId: 'entry', createdAt: now, expiresAt: now + 90000, persistedState: 'offered', target };
const proposal = { offerId: offer.id, entryId: offer.entryId, proposal: { id: 'proposal-one', businessId: offer.businessId, serviceName: target.serviceName, resourceName: target.resourceName, dateKey: target.dateKey, startTimeStr: target.startTimeStr, endTimeStr: target.endTimeStr, priceCOP: target.priceCOP, expiresAt: offer.expiresAt, intakeFields: [], subjectCase: { bookingRequestId: 'demo-case', subjectKind: 'self' } } };
const recovery = () => ({ businessId: offer.businessId, viewerUid: auth.uid, serverNow: now, writesEnabled: true, offer, usability: 'ready', proposal, proof: null, appointment: null });
const proof = { appointmentId: 'appointment', proposalId: proposal.proposal.id, entryId: offer.entryId, previousWaitlistRevision: 1, resolvedWaitlistRevision: 2, confirmedAt: now + 1, source: { dateKey: target.dateKey, startAt: target.startAt, endAt: target.endAt, reservedUntilAt: target.reservedUntilAt, resourceId: target.resourceId, serviceId: target.serviceId } };
const appointment = { id: proof.appointmentId, tenantId: offer.businessId, type: 'appointment', status: 'confirmed', ...target, client: { uid: 'demo-client', name: 'Demo' } };
const booked = () => ({ ...recovery(), serverNow: now + 1, offer: { ...offer, persistedState: 'booked' }, usability: null, proof, appointment });
const reply = (value: unknown, status = 200) => Response.json(value, { status });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }
let tree: ReactTestRenderer | undefined, c: ReturnType<typeof useClientWaitlistOffer>, input: ClientWaitlistOfferInput;
const fetchMock = vi.fn<typeof fetch>(), released = vi.fn(), confirmed = vi.fn(), renders: (string | null)[] = [];
function Harness() { c = useClientWaitlistOffer(input); renders.push(c.recovery?.businessId ?? null); return null; }
const mount = async () => { await act(async () => { tree = create(createElement(Harness)); }); };
const update = async () => { await act(async () => tree!.update(createElement(Harness))); };
const confirms = () => fetchMock.mock.calls.filter(call => String(call[0]).endsWith('/confirm'));
beforeEach(() => { vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] }); vi.setSystemTime(now); auth.uid = 'demo-client'; auth.epoch = 1; released.mockReset(); confirmed.mockReset(); input = { businessId: offer.businessId, userId: auth.uid, authEpoch: 1, enabled: true, acquireAction: () => released, onConfirmed: confirmed }; fetchMock.mockReset().mockImplementation(async path => reply(String(path).endsWith('/offer') ? { businessId: offer.businessId, viewerUid: auth.uid, serverNow: now, headRevision: 1, current: recovery() } : recovery())); vi.stubGlobal('fetch', fetchMock); renders.length = 0; });
afterEach(async () => { await act(async () => tree?.unmount()); tree = undefined; vi.unstubAllGlobals(); vi.useRealTimers(); });
it('clientPrepareNotConfirmOnOpen and reload only performs explicit GET', async () => { await mount(); expect(fetchMock).not.toHaveBeenCalled(); await act(async () => c.check()); expect(c.recovery?.proposal?.proposal.id).toBe(proposal.proposal.id); expect(fetchMock.mock.calls[0][1]?.method).toBeUndefined(); await act(async () => c.review()); expect(String(fetchMock.mock.calls[1][0])).toMatch(/\/proposal$/); expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).toEqual({ requestId: expect.any(String) }); expect(confirms()).toHaveLength(0); });
it('separateRecoveryDoesNotAbortPendingPost and mutation timer only warns', async () => { await mount(); await act(async () => c.check()); const pending = deferred<Response>(); fetchMock.mockReturnValueOnce(pending.promise); let operation!: Promise<void>; await act(async () => { operation = c.confirm(proposal.proposal.id, { clientPhone: '573001234567', intakeAnswers: {} }); }); await act(async () => vi.advanceTimersByTimeAsync(20000)); expect(c.notice).toContain('demorando'); await act(async () => c.recover()); expect(confirms()[0][1]?.signal?.aborted).toBe(false); expect(c.busy).toBe(true); await act(async () => c.confirm(proposal.proposal.id, { clientPhone: 'different', intakeAnswers: {} })); expect(confirms()).toHaveLength(1); await act(async () => { pending.resolve(reply({ proof, appointment, replayed: false })); await operation; }); expect(c.recovery?.proof).toEqual(proof); expect(confirmed).toHaveBeenCalledTimes(1); expect(released).toHaveBeenCalledTimes(1); });
it('offeredOrUsabilityDoesNotUnlockUnknownConfirm and retry uses immutable contact', async () => { await mount(); await act(async () => c.check()); fetchMock.mockRejectedValueOnce(TypeError('lost')); await act(async () => c.confirm(proposal.proposal.id, { clientPhone: '573001234567', intakeAnswers: { note: 'original' } })); const body = confirms()[0][1]?.body; expect(c.uncertain).toBe(true); fetchMock.mockResolvedValueOnce(reply({ ...recovery(), usability: 'disabled', writesEnabled: false })); await act(async () => c.recover()); expect(c.uncertain).toBe(true); expect(released).not.toHaveBeenCalled(); fetchMock.mockResolvedValueOnce(reply({ proof, appointment, replayed: true })); await act(async () => c.confirm(proposal.proposal.id, { clientPhone: 'changed', intakeAnswers: {} })); expect(confirms()[1][1]?.body).toBe(body); expect(c.uncertain).toBe(false); });
it('declineKeepsWaitlist and decodes full client recovery without extra read', async () => { await mount(); await act(async () => c.check()); const declined = { ...recovery(), offer: { ...offer, persistedState: 'declined' }, usability: null }; fetchMock.mockResolvedValueOnce(reply(declined)); await act(async () => c.decline()); expect(c.recovery).toEqual(declined); expect(fetchMock).toHaveBeenCalledTimes(2); expect(String(fetchMock.mock.calls[1][0])).toMatch(/\/decline$/); expect(released).toHaveBeenCalledTimes(1); });
it('terminalCloseInvalidatesLateMutationPublication for matching offer only', async () => { await mount(); await act(async () => c.check()); const pending = deferred<Response>(); fetchMock.mockReturnValueOnce(pending.promise); let operation!: Promise<void>; await act(async () => { operation = c.confirm(proposal.proposal.id, { clientPhone: '573001234567', intakeAnswers: {} }); }); fetchMock.mockResolvedValueOnce(reply({ businessId: offer.businessId, viewerUid: auth.uid, offerId: offer.id, persistedState: 'expired', proof: null })); await act(async () => c.closeExpired()); expect(c.recovery?.offer.persistedState).toBe('expired'); expect(c.uncertain).toBe(false); await act(async () => { pending.resolve(reply({ proof, appointment, replayed: false })); await operation; }); expect(c.recovery?.offer.persistedState).toBe('expired'); expect(confirmed).not.toHaveBeenCalled(); });
it.each(['uid', 'epoch', 'business'] as const)('identityChangeMasksBeforeEffects and lateResponseCannotCross%s', async change => { await mount(); await act(async () => c.check()); const pending = deferred<Response>(); fetchMock.mockReturnValueOnce(pending.promise); let operation!: Promise<void>; await act(async () => { operation = c.confirm(proposal.proposal.id, { clientPhone: '573001234567', intakeAnswers: {} }); }); if (change === 'uid') { auth.uid = 'other-client'; input = { ...input, userId: auth.uid }; } else if (change === 'epoch') { auth.epoch++; input = { ...input, authEpoch: auth.epoch }; } else input = { ...input, businessId: 'other-business' }; renders.length = 0; await update(); expect(renders[0]).toBeNull(); expect(confirms()[0][1]?.signal?.aborted).toBe(true); await act(async () => { pending.resolve(reply({ proof, appointment, replayed: false })); await operation; }); expect(c.recovery).toBeNull(); expect(confirmed).not.toHaveBeenCalled(); });
it('read timeout settles and aborts at ten seconds without publishing late data', async () => { await mount(); const pending = deferred<Response>(); fetchMock.mockReturnValueOnce(pending.promise); let read!: Promise<void>; await act(async () => { read = c.check(); }); await act(async () => vi.advanceTimersByTimeAsync(10000)); await read; expect(c.error).toContain('tiempo'); expect(c.loading).toBe(false); expect(fetchMock.mock.calls[0][1]?.signal?.aborted).toBe(true); await act(async () => pending.resolve(reply({ businessId: offer.businessId, viewerUid: auth.uid, serverNow: now, headRevision: 1, current: recovery() }))); expect(c.recovery).toBeNull(); });
it('oldProofCurrentAppointmentShownSeparately after move or cancellation', async () => { await mount(); const moved = { ...appointment, status: 'cancelled_by_client', resourceId: 'another', dateKey: '2030-01-07', startTimeStr: '10:00', endTimeStr: '10:30', startAt: Date.parse('2030-01-07T15:00:00Z'), endAt: Date.parse('2030-01-07T15:30:00Z'), reservedUntilAt: Date.parse('2030-01-07T15:35:00Z') }; fetchMock.mockResolvedValueOnce(reply({ businessId: offer.businessId, viewerUid: auth.uid, serverNow: now + 1, headRevision: 1, current: { ...booked(), appointment: moved } })); await act(async () => c.check()); expect(c.recovery?.proof?.source.resourceId).toBe('one'); expect(c.recovery?.appointment?.resourceId).toBe('another'); expect(c.recovery?.appointment?.status).toBe('cancelled_by_client'); });
it.each(['declined', 'booked'] as const)('repeated terminal %s recovery settles its read and releases only its new lease', async persistedState => {
  await mount(); const terminal = persistedState === 'booked' ? booked() : { ...recovery(), offer: { ...offer, persistedState }, usability: null };
  fetchMock.mockResolvedValueOnce(reply({ businessId: offer.businessId, viewerUid: auth.uid, serverNow: terminal.serverNow, headRevision: 1, current: terminal }));
  await act(async () => c.check()); expect(released).toHaveBeenCalledTimes(1);
  fetchMock.mockResolvedValueOnce(reply(terminal)); await act(async () => c.recover());
  expect(c.loading).toBe(false); expect(released).toHaveBeenCalledTimes(2);
});
it('retained offer callbacks cannot review or decline a later different offer', async () => {
  await mount(); await act(async () => c.check()); const oldReview = c.review, oldDecline = c.decline;
  await act(async () => c.dismiss());
  const next = { ...recovery(), offer: { ...offer, id: 'offer-two' }, proposal: null };
  fetchMock.mockResolvedValueOnce(reply({ businessId: offer.businessId, viewerUid: auth.uid, serverNow: now, headRevision: 2, current: next }));
  await act(async () => c.check()); const before = fetchMock.mock.calls.length;
  await act(async () => { void oldReview(); void oldDecline(); });
  expect(fetchMock.mock.calls).toHaveLength(before);
});
it('unknown confirm survives missing head, 404 and unrelated terminal close', async () => {
  await mount(); await act(async () => c.check()); fetchMock.mockRejectedValueOnce(TypeError('lost'));
  await act(async () => c.confirm(proposal.proposal.id, { clientPhone: '573001234567', intakeAnswers: {} }));
  fetchMock.mockResolvedValueOnce(reply({ businessId: offer.businessId, viewerUid: auth.uid, serverNow: now, headRevision: 0, current: null })); await act(async () => c.check());
  fetchMock.mockResolvedValueOnce(reply({ error: 'missing' }, 404)); await act(async () => c.recover());
  fetchMock.mockResolvedValueOnce(reply({ businessId: offer.businessId, viewerUid: auth.uid, offerId: 'other-offer', persistedState: 'expired', proof: null })); await act(async () => c.closeExpired());
  expect(c.uncertain).toBe(true); expect(c.recovery?.offer.id).toBe(offer.id); expect(released).not.toHaveBeenCalled();
});
it('rejects same-ID recovery with a changed immutable target', async () => {
  await mount(); await act(async () => c.check());
  const changed = { ...recovery(), offer: { ...offer, target: { ...target, resourceId: 'other', resourceName: 'Other' } }, proposal: null };
  fetchMock.mockResolvedValueOnce(reply(changed)); await act(async () => c.recover());
  expect(c.recovery?.offer.target.resourceId).toBe('one'); expect(c.error).toBeTruthy();
});
it('proposal retry preserves its requestId and verified recovery unlocks fresh contact entry', async () => {
  await mount(); await act(async () => c.check()); fetchMock.mockRejectedValueOnce(TypeError('lost'));
  await act(async () => c.review()); const body = fetchMock.mock.calls.at(-1)![1]?.body;
  fetchMock.mockResolvedValueOnce(reply(recovery())); await act(async () => c.review());
  expect(fetchMock.mock.calls.at(-1)![1]?.body).toBe(body); expect(c.uncertain).toBe(false);
});
it('booked recovery must match the proposal already reviewed even when its response omits proposal', async () => {
  await mount(); await act(async () => c.check()); fetchMock.mockRejectedValueOnce(TypeError('lost'));
  await act(async () => c.confirm(proposal.proposal.id, { clientPhone: '573001234567', intakeAnswers: {} }));
  fetchMock.mockResolvedValueOnce(reply({ ...booked(), proposal: null, proof: { ...proof, proposalId: 'unrelated-proposal' } }));
  await act(async () => c.recover());
  expect(c.recovery?.proof).toBeNull(); expect(c.uncertain).toBe(true); expect(released).not.toHaveBeenCalled();
});
it('booked recovery cannot substitute a manual block for the client appointment', async () => {
  await mount(); await act(async () => c.check());
  fetchMock.mockResolvedValueOnce(reply({ ...booked(), appointment: { ...appointment, type: 'manual_block' } }));
  await act(async () => c.recover()); expect(c.recovery?.proof).toBeNull(); expect(confirmed).not.toHaveBeenCalled();
});
it('decline returns booked client recovery without a second read when confirm won', async () => {
  await mount(); await act(async () => c.check()); fetchMock.mockResolvedValueOnce(reply(booked()));
  await act(async () => c.decline()); expect(c.recovery).toEqual(booked()); expect(fetchMock).toHaveBeenCalledTimes(2); expect(confirmed).toHaveBeenCalledTimes(1);
});
it('confirm rejects a proof for a different target and retains its exact recovery fence', async () => {
  await mount(); await act(async () => c.check()); fetchMock.mockResolvedValueOnce(reply({ proof: { ...proof, source: { ...proof.source, resourceId: 'other' } }, appointment, replayed: false }));
  await act(async () => c.confirm(proposal.proposal.id, { clientPhone: '573001234567', intakeAnswers: {} })); expect(c.uncertain).toBe(true); expect(c.recovery?.proof).toBeNull(); expect(released).not.toHaveBeenCalled();
});
it('a retained fresh confirm cannot start after decline has acquired its mutation slot', async () => {
  await mount(); await act(async () => c.check()); const confirm = c.confirm, pending = deferred<Response>(); fetchMock.mockReturnValueOnce(pending.promise);
  let operation!: Promise<void>; await act(async () => { operation = c.decline(); void confirm(proposal.proposal.id, { clientPhone: '573001234567', intakeAnswers: {} }); });
  expect(confirms()).toHaveLength(0);
  await act(async () => { pending.resolve(reply({ ...recovery(), offer: { ...offer, persistedState: 'declined' }, usability: null })); await operation; });
});
