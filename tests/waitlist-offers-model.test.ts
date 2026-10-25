import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { waitlistOffersFixture } from './waitlist-offers-contract';
import { waitlistNow } from './waitlist-contract';
import { subjectAdmin } from './represented-booking-contract';
import { bookingSubjectHash } from '@/lib/server/booking-subject-consent';
import { waitlistDocumentId } from '@/lib/server/waitlist';
import {
  waitlistOfferExpiry, waitlistOfferEligible, ownerWaitlistOfferCommandSchema, waitlistOfferSummarySchema,
  ownerWaitlistOfferRecoverySchema, clientWaitlistOfferRecoverySchema, waitlistOfferConfirmationSchema,
  ownerWaitlistOfferContextSchema, ownerWaitlistOfferPageSchema, waitlistOfferCloseResultSchema,
  ownerWaitlistOfferResultSchema, clientWaitlistOfferCurrentSchema, ownerWaitlistOfferQuerySchema,
  waitlistOfferProposalCommandSchema, waitlistOfferConfirmCommandSchema, waitlistOfferWithdrawCommandSchema,
  waitlistOfferDeclineCommandSchema, waitlistOfferCloseExpiredCommandSchema,
} from '@/lib/waitlist-offers';
import {
  readWaitlistOfferHead, waitlistOfferId, waitlistOfferProposalId, waitlistOfferCommandFingerprint,
  waitlistOfferRequestFingerprint, waitlistOfferRecordSchema, parseCanonicalWaitlistOffer,
  waitlistOfferProposalSchema, newWaitlistOfferSubject, currentHeadMatchesWaitlist,
  projectWaitlistOfferSummary, projectWaitlistOfferProposal,
} from '@/lib/server/waitlist-offers';

const createdAt = Date.parse('2030-01-07T13:55:00Z');
const target = { serviceId: 'cut', serviceName: 'Corte demo', resourceId: 'one', resourceName: 'Uno', dateKey: '2030-01-07',
  startTimeStr: '09:00', endTimeStr: '09:30', startAt: Date.parse('2030-01-07T14:00:00Z'), endAt: Date.parse('2030-01-07T14:30:00Z'),
  reservedUntilAt: Date.parse('2030-01-07T14:45:00Z'), durationMinutes: 30, bufferMinutes: 15, priceCOP: 25000 };
const command = { requestId: 'demo-offer-command', entryId: 'entry', expectedWaitlistRevision: 1, expectedHeadRevision: 0, selection: { resourceId: 'one', startTimeStr: '09:00' } };
function record() {
  const id = waitlistOfferId('biz', 'entry', 'demo-owner', command.requestId);
  return { version: 1 as const, id, businessId: 'biz', waitlistRecordId: 'record', entryId: 'entry', waitlistRevision: 1, headRevisionAtCreation: 1,
    clientUid: 'demo-client', ownerActorUid: 'demo-owner', requestId: command.requestId,
    commandFingerprint: waitlistOfferCommandFingerprint('biz', 'demo-owner', command), requestFingerprint: 'a'.repeat(64),
    dateKey: target.dateKey, createdAt, expiresAt: target.startAt,
    target: { ...target, intakeFields: [{ key: 'note', label: 'Preferencia', required: false }] },
    catalog: { service: { id: 'cut', name: 'Corte demo', durationMinutes: 30, bufferMinutes: 15, price: 25000, resourceIds: ['one'] }, resource: { id: 'one', name: 'Uno', active: true as const }, intakeFields: [{ key: 'note', label: 'Preferencia', required: false }] },
    catalogFingerprint: 'b'.repeat(64), resourceScheduleFingerprint: 'c'.repeat(64), policyRevision: 1,
    state: 'offered' as const, proposal: null, booking: null, closedAt: null, closedReason: null, closedByUid: null };
}
function proposal(offer = record()) {
  return { id: waitlistOfferProposalId(offer.businessId, offer.id, offer.clientUid, 'demo-client-proposal'), requestId: 'demo-client-proposal',
    createdAt: createdAt + 60_000, expiresAt: offer.expiresAt, subjectCase: { bookingRequestId: 'demo-client-proposal', subjectKind: 'self' as const },
    catalogFingerprint: offer.catalogFingerprint, resourceScheduleFingerprint: offer.resourceScheduleFingerprint, policyRevision: 1 };
}
function proof(offer = record()) {
  return { appointmentId: 'appointment', proposalId: proposal(offer).id, entryId: 'entry', previousWaitlistRevision: 1, resolvedWaitlistRevision: 2,
    confirmedAt: createdAt + 120_000, source: { dateKey: target.dateKey, startAt: target.startAt, endAt: target.endAt, reservedUntilAt: target.reservedUntilAt, resourceId: 'one', serviceId: 'cut' } };
}
function recovery(offer = record()) { return { businessId: 'biz', viewerUid: 'demo-owner', serverNow: createdAt + 120_000, writesEnabled: true, offer: projectWaitlistOfferSummary(offer), usability: 'ready', proposal: null, proof: null }; }
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(waitlistNow); vi.stubEnv('SUPERADMIN_UID', subjectAdmin.uid); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

// A corrupt stored head treated as absent would silently reset the CAS guard.
it('headAbsentIsNotCorruptHead', () => {
  const scope = { businessId: 'biz', waitlistRecordId: 'record' };
  expect(readWaitlistOfferHead(undefined, scope)).toEqual({ revision: 0, entryId: null, currentOfferId: null });
  for (const value of [null, {}, { version: 1, ...scope, revision: 0, entryId: 'entry', currentOfferId: 'offer' }, { version: 1, ...scope, revision: Number.MAX_SAFE_INTEGER, entryId: 'entry', currentOfferId: 'offer' }]) expect(() => readWaitlistOfferHead(value, scope)).toThrow();
  expect(readWaitlistOfferHead({ version: 1, ...scope, revision: 1, entryId: 'entry', currentOfferId: 'offer' }, scope).revision).toBe(1);
});
// IDs must isolate commands/actors, while changed expectations cannot replay the same command.
it('opaqueOfferIdsBindCommandAndActor', () => {
  const a = record();
  expect(a.id).toMatch(/^[a-f0-9]{64}$/);
  expect(waitlistOfferId('biz', 'entry', 'demo-other-owner', command.requestId)).not.toBe(a.id);
  expect(waitlistOfferId('biz', 'other-entry', 'demo-owner', command.requestId)).not.toBe(a.id);
  expect(waitlistOfferId('biz', 'entry', 'demo-owner', 'demo-other-command')).not.toBe(a.id);
  expect(waitlistOfferProposalId('biz', a.id, 'other-client', 'demo-client-proposal')).not.toBe(proposal(a).id);
  expect(waitlistOfferCommandFingerprint('biz', 'demo-owner', { ...command, expectedHeadRevision: 1 })).not.toBe(a.commandFingerprint);
  expect(waitlistOfferCommandFingerprint('biz', 'demo-owner', { ...command, selection: { ...command.selection, startTimeStr: '09:15' } })).not.toBe(a.commandFingerprint);
  expect(() => parseCanonicalWaitlistOffer('wrong-id', a, 'biz')).toThrow();
  expect(() => parseCanonicalWaitlistOffer(a.id, { ...a, ownerActorUid: 'other-owner' }, 'biz')).toThrow();
});
it('offerExpiryIsMinOfTenMinutesRequestAndStart', () => {
  expect(waitlistOfferExpiry(1000, 900000, 800000)).toBe(601000);
  expect(waitlistOfferExpiry(1000, 300000, 800000)).toBe(300000);
  expect(waitlistOfferExpiry(1000, 900000, 200000)).toBe(200000);
  expect(() => waitlistOfferExpiry(1000, 1000, 800000)).toThrow();
});
it('proposalCannotExtendOfferExpiry', () => {
  const a = record(), p = proposal(a);
  expect(waitlistOfferRecordSchema.safeParse({ ...a, proposal: p }).success).toBe(true);
  for (const patch of [{ expiresAt: a.expiresAt + 1 }, { expiresAt: a.expiresAt - 1 }, { createdAt: a.expiresAt }, { catalogFingerprint: 'd'.repeat(64) }, { subjectCase: { bookingRequestId: 'other-case', subjectKind: 'self' } }]) expect(waitlistOfferRecordSchema.safeParse({ ...a, proposal: { ...p, ...patch } }).success).toBe(false);
  expect(waitlistOfferProposalSchema.safeParse({ ...p, authorization: { receiptId: 'old' } }).success).toBe(false);
});
it('generalSelfOnlyNotMinorOrHealth', () => {
  const capability = { configured: true, dataMode: 'general' as const, representedMinorsEnabled: false, revision: 1 };
  expect(waitlistOfferEligible(capability, { subjectKind: 'self', bookingRequestId: 'demo-self-case' })).toBe(true);
  for (const policy of [{ ...capability, dataMode: 'health' as const }, { ...capability, representedMinorsEnabled: true }, { ...capability, configured: false }]) expect(waitlistOfferEligible(policy, { subjectKind: 'self', bookingRequestId: 'demo-self-case' })).toBe(false);
  expect(waitlistOfferEligible(capability, { subjectKind: 'represented_minor', bookingRequestId: 'demo-child-case', representativeRole: 'parent' })).toBe(false);
});
it('dtoOmitsClientActorAnchorsContactsAndAnswers', () => {
  const a = record(), summary = projectWaitlistOfferSummary(a), dto = recovery(a);
  expect(summary).toEqual({ id: a.id, businessId: 'biz', waitlistRecordId: 'record', entryId: 'entry', createdAt, expiresAt: target.startAt, persistedState: 'offered', target });
  expect(ownerWaitlistOfferRecoverySchema.safeParse(dto).success).toBe(true);
  for (const secret of ['clientUid', 'ownerActorUid', 'anchors', 'clientPhone', 'intakeAnswers', 'catalog', 'requestFingerprint']) {
    expect(ownerWaitlistOfferRecoverySchema.safeParse({ ...dto, [secret]: 'private' }).success).toBe(false);
    expect(waitlistOfferSummarySchema.safeParse({ ...summary, [secret]: 'private' }).success).toBe(false);
  }
  expect(ownerWaitlistOfferRecoverySchema.safeParse({ ...dto, proposal: projectWaitlistOfferProposal({ ...a, proposal: proposal(a) }) }).success).toBe(false);
});
it('proofOriginalPositionIsNotCurrentAppointment', () => {
  const a = record(), p = proposal(a), original = proof(a);
  const appointment = { id: 'appointment', tenantId: 'biz', type: 'appointment', status: 'cancelled_by_client', dateKey: '2030-01-08', startTimeStr: '10:00', endTimeStr: '10:30', startAt: Date.parse('2030-01-08T15:00:00Z'), endAt: Date.parse('2030-01-08T15:30:00Z'), reservedUntilAt: Date.parse('2030-01-08T15:45:00Z'), resourceId: 'two', serviceId: 'cut', createdAt, createdBy: 'sarin_client', client: { uid: 'demo-client', name: 'Demo', email: '', intakeAnswers: {} } };
  const dto = { ...recovery(a), viewerUid: 'demo-client', offer: { ...projectWaitlistOfferSummary(a), persistedState: 'booked' }, usability: null, proof: original, proposal: projectWaitlistOfferProposal({ ...a, proposal: p }), appointment };
  expect(clientWaitlistOfferRecoverySchema.safeParse(dto).success).toBe(true);
  expect(waitlistOfferConfirmationSchema.safeParse({ proof: original, appointment, replayed: true }).success).toBe(true);
  expect(clientWaitlistOfferRecoverySchema.safeParse({ ...dto, appointment: { ...appointment, client: { ...appointment.client, uid: 'other-client' } } }).success).toBe(false);
  expect(waitlistOfferConfirmationSchema.safeParse({ proof: original, appointment: { ...appointment, id: 'other' }, replayed: true }).success).toBe(false);
});
it('structuredSelfSubjectIsNewCaseNotBorrowedAuthorization', () => {
  const a = record(), p = proposal(a);
  expect(newWaitlistOfferSubject(p)).toEqual({ case: { bookingRequestId: 'demo-client-proposal', subjectKind: 'self' }, beneficiary: { kind: 'self' }, proposalId: p.id, authorization: null });
  const view = projectWaitlistOfferProposal({ ...a, proposal: p });
  expect(view?.proposal.subjectCase).toEqual({ bookingRequestId: 'demo-client-proposal', subjectKind: 'self' });
  expect(view?.proposal.expiresAt).toBe(target.startAt);
});
it('currentHeadForNewEntryNeverAttachesOldOffer', () => {
  const a = record(), head = { version: 1 as const, businessId: 'biz', waitlistRecordId: 'record', revision: 1, entryId: 'entry', currentOfferId: a.id };
  const current = { entryId: 'entry', waitlistRevision: 1, requestFingerprint: a.requestFingerprint };
  expect(currentHeadMatchesWaitlist(head, a, current)).toBe(true);
  expect(currentHeadMatchesWaitlist(head, a, { ...current, entryId: 'new-entry' })).toBe(false);
  expect(currentHeadMatchesWaitlist(head, a, { ...current, waitlistRevision: 3 })).toBe(false);
  expect(currentHeadMatchesWaitlist(head, a, { ...current, requestFingerprint: 'd'.repeat(64) })).toBe(false);
  expect(currentHeadMatchesWaitlist(head, a, null)).toBe(false);
  expect(currentHeadMatchesWaitlist(head, { ...a, state: 'booked', proposal: proposal(a), booking: proof(a), closedAt: proof(a).confirmedAt, closedReason: 'booked', closedByUid: 'demo-client' }, null)).toBe(true);
});
it('strictContractsRejectMalformedIdentityRevisionsAndSnapshots', () => {
  const a = record();
  for (const bad of ['entry\n', '__proto__', 'constructor', 'a/b', '']) expect(ownerWaitlistOfferCommandSchema.safeParse({ ...command, entryId: bad }).success).toBe(false);
  for (const patch of [{ expectedWaitlistRevision: 0 }, { expectedWaitlistRevision: Number.MAX_SAFE_INTEGER }, { expectedHeadRevision: Number.MAX_SAFE_INTEGER - 1 }]) expect(ownerWaitlistOfferCommandSchema.safeParse({ ...command, ...patch }).success).toBe(false);
  for (const patch of [{ clientUid: 'demo-client\n' }, { commandFingerprint: 'a'.repeat(64) + '\n' }, { requestFingerprint: 'A'.repeat(64) }, { headRevisionAtCreation: Number.MAX_SAFE_INTEGER }, { target: { ...a.target, reservedUntilAt: target.endAt } }, { expiresAt: a.expiresAt + 1 }, { clientPhone: 'private' }, { closedAt: createdAt }, { booking: proof(a) }]) expect(waitlistOfferRecordSchema.safeParse({ ...a, ...patch }).success).toBe(false);
  expect(waitlistOfferRecordSchema.safeParse({ ...a, state: 'booked', proposal: proposal(a), booking: proof(a), closedAt: proof(a).confirmedAt, closedReason: 'booked', closedByUid: 'demo-client' }).success).toBe(true);
  for (const state of ['withdrawn', 'declined', 'expired']) {
    const closedAt = state === 'expired' ? a.expiresAt : createdAt + 1;
    const closed = { ...a, state, closedAt, closedReason: state, closedByUid: 'demo-client' };
    expect(waitlistOfferRecordSchema.safeParse(closed).success).toBe(true);
    expect(waitlistOfferRecordSchema.safeParse({ ...closed, closedReason: 'booked' }).success).toBe(false);
    expect(waitlistOfferRecordSchema.safeParse({ ...closed, booking: proof(a) }).success).toBe(false);
  }
});
it('dtoStateAndPageContractsDoNotInventTerminalResults', () => {
  const dto = recovery();
  expect(ownerWaitlistOfferRecoverySchema.safeParse({ ...dto, serverNow: target.startAt, usability: 'expired_pending_close' }).success).toBe(true);
  expect(ownerWaitlistOfferRecoverySchema.safeParse({ ...dto, usability: null }).success).toBe(false);
  expect(waitlistOfferCloseResultSchema.safeParse({ businessId: 'biz', viewerUid: 'demo-client', offerId: dto.offer.id, persistedState: 'booked', proof: null }).success).toBe(false);
  expect(ownerWaitlistOfferPageSchema.safeParse({ businessId: 'biz', viewerUid: 'demo-owner', serverNow: createdAt, dateKey: target.dateKey, filter: 'booked', rows: [dto.offer], nextCursor: null }).success).toBe(false);
  const detail = { businessId: 'biz', ownerUid: 'demo-owner', serverNow: createdAt + 120_000,
    row: { recordId: 'record', entryId: 'entry', waitlistRevision: 1, dateKey: target.dateKey, createdAt, expiresAt: Date.parse('2030-01-08T05:00:00Z'), subjectKind: 'self', serviceLabel: 'Corte demo', resourceLabel: 'Uno', lifecycle: 'unchecked', review: { revision: 0, reviewed: false, updatedAt: null } },
    state: 'available', availability: [{ resourceId: 'one', resourceName: 'Uno', slots: ['09:00'] }] };
  const context = { detail, headRevision: 1, currentOffer: dto, writesEnabled: true, eligible: true, reason: null };
  expect(ownerWaitlistOfferContextSchema.safeParse(context).success).toBe(true);
  expect(ownerWaitlistOfferContextSchema.safeParse({ ...context, reason: 'restricted_policy' }).success).toBe(false);
  expect(ownerWaitlistOfferResultSchema.safeParse({ recovery: dto, appliedHeadRevision: 1, headRevision: 2, replayed: true }).success).toBe(true);
  expect(ownerWaitlistOfferResultSchema.safeParse({ recovery: dto, appliedHeadRevision: 1, headRevision: 2, replayed: false }).success).toBe(false);
  const client = { ...dto, viewerUid: 'demo-client', appointment: null };
  const current = { businessId: 'biz', viewerUid: 'demo-client', serverNow: dto.serverNow, headRevision: 1, current: client };
  expect(clientWaitlistOfferCurrentSchema.safeParse(current).success).toBe(true);
  expect(clientWaitlistOfferCurrentSchema.safeParse({ ...current, viewerUid: 'other-client' }).success).toBe(false);
  const older = { ...dto.offer, id: 'older-offer', createdAt: createdAt - 1 };
  const page = { businessId: 'biz', viewerUid: 'demo-owner', serverNow: dto.serverNow, dateKey: target.dateKey, filter: 'all', rows: [dto.offer, older], nextCursor: null };
  expect(ownerWaitlistOfferPageSchema.safeParse(page).success).toBe(true);
  expect(ownerWaitlistOfferPageSchema.safeParse({ ...page, rows: [older, dto.offer] }).success).toBe(false);
  expect(ownerWaitlistOfferPageSchema.safeParse({ ...page, nextCursor: { offerId: older.id, createdAt: older.createdAt } }).success).toBe(false);
  expect(ownerWaitlistOfferQuerySchema.safeParse({ dateKey: target.dateKey, filter: 'offered' }).success).toBe(true);
});
it('syntheticFixturePreservesExactRequestFingerprintAndPaidTrial', async () => {
  const f = await waitlistOffersFixture();
  expect(f.first.request?.status).toBe('waiting');
  expect(f.second.request?.status).toBe('waiting');
  expect(f.business.services[0]).toMatchObject({ durationMinutes: 30, bufferMinutes: 15, price: 25000 });
  expect(f.business.subscription.paidTrial?.appointmentsUsed).toBe(1);
  const hash = waitlistOfferRequestFingerprint(f.record);
  expect(waitlistOfferRequestFingerprint({ ...f.record, revision: f.record.revision + 2 })).not.toBe(hash);
  if (!f.record.request) throw new Error('Fixture requires a current request');
  expect(waitlistOfferRequestFingerprint({ ...f.record, request: { ...f.record.request, resourceId: 'two' } })).not.toBe(hash);
});

// A stored opaque ID cannot authorize a modified immutable catalog/command snapshot.
it('canonicalRecordVerifiesSavedCatalogAndCommandFingerprints', () => {
  const a = record(), canonical = { ...a, waitlistRecordId: waitlistDocumentId(a.clientUid, a.businessId), catalogFingerprint: bookingSubjectHash(a.catalog) };
  expect(parseCanonicalWaitlistOffer(a.id, canonical, 'biz').id).toBe(a.id);
  for (const patch of [{ catalogFingerprint: 'd'.repeat(64) }, { commandFingerprint: 'd'.repeat(64) }, { waitlistRecordId: 'other-record' }]) expect(() => parseCanonicalWaitlistOffer(a.id, { ...canonical, ...patch }, 'biz')).toThrow();
});
// Malformed public dates must be rejected by safeParse without escaping as RangeError.
it('malformedDatesAreValidationFailures', () => {
  const a = record(), summary = projectWaitlistOfferSummary(a);
  expect(() => waitlistOfferSummarySchema.safeParse({ ...summary, target: { ...target, dateKey: '2030-02-31' } })).not.toThrow();
  expect(waitlistOfferSummarySchema.safeParse({ ...summary, target: { ...target, dateKey: '2030-02-31' } }).success).toBe(false);
  expect(() => waitlistOfferRecordSchema.safeParse({ ...a, target: { ...a.target, startTimeStr: '09:00\n' } })).not.toThrow();
});
it('terminalClosureCannotPrecedeItsPersistedProposal', () => {
  const a = record();
  expect(waitlistOfferRecordSchema.safeParse({ ...a, proposal: proposal(a), state: 'declined', closedAt: createdAt + 1, closedReason: 'declined', closedByUid: a.clientUid }).success).toBe(false);
});

it('commandsAcceptOnlyTheirOwnIntentAndDeferFreshContactForReplay', () => {
  const cases = [
    [waitlistOfferProposalCommandSchema, { requestId: 'demo-client-proposal' }],
    [waitlistOfferWithdrawCommandSchema, { withdraw: true }],
    [waitlistOfferDeclineCommandSchema, { decline: true }],
    [waitlistOfferCloseExpiredCommandSchema, { closeExpired: true }],
    [waitlistOfferConfirmCommandSchema, { confirm: true, clientPhone: null, intakeAnswers: ['invalid-fresh-contact'] }],
  ] as const;
  for (const [schema, input] of cases) {
    expect(schema.safeParse(input).success).toBe(true);
    expect(schema.safeParse({ ...input, clientUid: 'other-client' }).success).toBe(false);
  }
});
