import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import type { Database, DocumentReference, Query, Transaction } from '@/lib/storage/types';
import type { OwnerWaitlistOfferCommand } from '@/lib/waitlist-offers';
import { ownerWaitlistOfferRecoverySchema, clientWaitlistOfferRecoverySchema, ownerWaitlistOfferContextSchema } from '@/lib/waitlist-offers';
import { waitlistOffersFixture } from './waitlist-offers-contract';
import { memoryFirestore } from './memoryFirestore';
import { subjectAdmin } from './represented-booking-contract';
import { waitlistNow } from './waitlist-contract';
import { readConsent, updateConsent } from '@/lib/server/consent';
import { bookingDataPolicyKey, saveBookingDataPolicy } from '@/lib/server/booking-data-policy';
import { bookingSubjectHash } from '@/lib/server/booking-subject-consent';
import { readResourceSchedulePolicy, resourceDayScheduleFingerprint } from '@/lib/server/resource-schedules';
import { cancelWaitlist, joinWaitlist, waitlistDocumentId } from '@/lib/server/waitlist';
import {
  createOwnerWaitlistOffer, readOwnerWaitlistOffers, readOwnerWaitlistOffer, readOwnerWaitlistOfferContext,
  readCurrentClientWaitlistOffer, readClientWaitlistOffer, withdrawOwnerWaitlistOffer, declineClientWaitlistOffer,
  closeExpiredWaitlistOffer, waitlistOfferId, waitlistOfferCommandFingerprint, waitlistOfferRequestFingerprint,
  parseCanonicalWaitlistOffer, waitlistOfferProposalId,
} from '@/lib/server/waitlist-offers';

type Fixture = Awaited<ReturnType<typeof waitlistOffersFixture>>;
const command = (f: Fixture, patch: Partial<OwnerWaitlistOfferCommand> = {}): OwnerWaitlistOfferCommand => ({ requestId: 'demo-owner-offer-command', entryId: f.first.request!.id,
  expectedWaitlistRevision: f.first.revision, expectedHeadRevision: 0, selection: { resourceId: 'one', startTimeStr: '09:00' }, ...patch });
const businessRef = (f: Fixture) => f.db.collection('businesses').doc(f.business.id);
const offerRef = (f: Fixture, id: string) => businessRef(f).collection('waitlistOffers').doc(id);
const headRef = (f: Fixture) => businessRef(f).collection('waitlistOfferHeads').doc(f.recordId);
const waitlistRef = (f: Fixture) => businessRef(f).collection('waitlistRequests').doc(f.recordId);
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

// Seed immutable data directly so read/closure assertions do not depend on create.
async function seedOffer(f: Fixture, options: { requestId?: string; createdAt?: number; headRevision?: number; head?: boolean } = {}) {
  const input = command(f, { requestId: options.requestId ?? 'demo-owner-offer-command', expectedHeadRevision: (options.headRevision ?? 1) - 1 });
  const id = waitlistOfferId(f.business.id, input.entryId, f.owner.uid, input.requestId), createdAt = options.createdAt ?? Date.now();
  const service = f.business.services[0], resource = f.business.resources[0];
  const catalog = { service, resource, intakeFields: f.business.sarinConfig.intakeFields };
  const schedule = await f.db.runTransaction(tx => readResourceSchedulePolicy(tx, f.business.id, f.db));
  const target = { serviceId: service.id, serviceName: service.name, resourceId: resource.id, resourceName: resource.name, dateKey: f.input.dateKey,
    startTimeStr: '09:00', endTimeStr: '09:30', startAt: Date.parse('2030-01-07T14:00:00Z'), endAt: Date.parse('2030-01-07T14:30:00Z'), reservedUntilAt: Date.parse('2030-01-07T14:45:00Z'),
    durationMinutes: 30, bufferMinutes: 15, priceCOP: 25000, intakeFields: f.business.sarinConfig.intakeFields };
  const offer = parseCanonicalWaitlistOffer(id, { version: 1, id, businessId: f.business.id, waitlistRecordId: f.recordId, entryId: input.entryId,
    waitlistRevision: f.first.revision, headRevisionAtCreation: input.expectedHeadRevision + 1, clientUid: f.actor.uid, ownerActorUid: f.owner.uid,
    requestId: input.requestId, commandFingerprint: waitlistOfferCommandFingerprint(f.business.id, f.owner.uid, input), requestFingerprint: waitlistOfferRequestFingerprint(f.record),
    dateKey: target.dateKey, createdAt, expiresAt: createdAt + 600000, target, catalog, catalogFingerprint: bookingSubjectHash(catalog),
    resourceScheduleFingerprint: resourceDayScheduleFingerprint(f.business, schedule, resource.id, target.dateKey), policyRevision: 1,
    state: 'offered', proposal: null, booking: null, closedAt: null, closedReason: null, closedByUid: null }, f.business.id);
  await offerRef(f, id).set(offer);
  if (options.head !== false) await headRef(f).set({ version: 1, businessId: f.business.id, waitlistRecordId: f.recordId, revision: offer.headRevisionAtCreation, entryId: offer.entryId, currentOfferId: id });
  return offer;
}

function observe(db: Database, onRead?: (target: DocumentReference | Query) => void) {
  const reads: string[] = [], writes: string[] = [];
  let transactions = 0;
  const instrumented: Database = { collection: name => db.collection(name), runTransaction: handler => {
    transactions++;
    return db.runTransaction(tx => {
      let wrote = false;
      const proxy = new Proxy(tx, { get(target, key: keyof Transaction) {
        if (key === 'get') return async (ref: DocumentReference | Query) => {
          expect(wrote, 'all reads must precede the first write').toBe(false);
          const path = 'path' in ref ? ref.path : '<query>';
          reads.push(path); onRead?.(ref);
          return target.get(ref as DocumentReference);
        };
        return (ref: DocumentReference, data?: object) => {
          wrote = true; writes.push(ref.path);
          if (key === 'delete') return target.delete(ref);
          return target[key](ref, data!);
        };
      } });
      return handler(proxy);
    });
  } };
  return { db: instrumented, reads, writes, transactions: () => transactions };
}

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(waitlistNow); vi.stubEnv('SUPERADMIN_UID', subjectAdmin.uid); vi.stubEnv('SARIN_WAITLIST_OFFERS_ENABLED', 'true'); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

it('ownerOnlyCurrentBusinessEvenForSuperadmin', async () => {
  const f = await waitlistOffersFixture();
  for (const actor of [subjectAdmin, f.secondOwner, f.actor]) {
    await expect(createOwnerWaitlistOffer(actor, f.business.id, f.recordId, command(f), f.db)).rejects.toMatchObject({ status: 403 });
    await expect(readOwnerWaitlistOfferContext(actor, f.business.id, f.recordId, f.db)).rejects.toMatchObject({ status: 403 });
    await expect(readOwnerWaitlistOffers(actor, f.business.id, { dateKey: f.input.dateKey, filter: 'all' }, f.db)).rejects.toMatchObject({ status: 403 });
  }
});
it('clientCannotReadOtherClientOfferOrHead', async () => {
  const f = await waitlistOffersFixture(), offer = await seedOffer(f);
  await expect(readClientWaitlistOffer(f.secondClient, f.business.id, offer.id, f.db)).rejects.toMatchObject({ status: 404 });
  await expect(declineClientWaitlistOffer(f.secondClient, f.business.id, offer.id, f.db)).rejects.toMatchObject({ status: 404 });
  await expect(readCurrentClientWaitlistOffer(f.secondClient, f.business.id, f.db)).resolves.toMatchObject({ headRevision: 0, current: null });
  await expect(readClientWaitlistOffer(f.actor, f.business.id, offer.id, f.db)).resolves.toMatchObject({ usability: 'ready', viewerUid: f.actor.uid });
});
it('canonicalWaitlistAndHeadScopeChecked', async () => {
  const f = await waitlistOffersFixture(), offer = await seedOffer(f);
  const head = (await headRef(f).get()).data();
  await headRef(f).set({ ...head, waitlistRecordId: 'wrong-record' });
  await expect(readCurrentClientWaitlistOffer(f.actor, f.business.id, f.db)).rejects.toMatchObject({ status: 503, code: 'WAITLIST_OFFER_UNVERIFIABLE' });
  await headRef(f).set(head!);
  await waitlistRef(f).set({ ...f.record, ownerUid: f.secondClient.uid });
  await expect(readClientWaitlistOffer(f.actor, f.business.id, offer.id, f.db)).rejects.toMatchObject({ status: 503, code: 'WAITLIST_OFFER_UNVERIFIABLE' });
});
it('snapshotSelectionDerivedFromRequest', async () => {
  const f = await waitlistOffersFixture(), result = await createOwnerWaitlistOffer(f.owner, f.business.id, f.recordId, command(f), f.db);
  expect(result.recovery.offer.target).toMatchObject({ serviceId: f.input.serviceId, dateKey: f.input.dateKey, resourceId: 'one', durationMinutes: 30, bufferMinutes: 15, priceCOP: 25000 });
  expect(result).toMatchObject({ appliedHeadRevision: 1, headRevision: 1, replayed: false });
  expect(ownerWaitlistOfferRecoverySchema.safeParse(result.recovery).success).toBe(true);
  const saved = parseCanonicalWaitlistOffer(result.recovery.offer.id, (await offerRef(f, result.recovery.offer.id).get()).data(), f.business.id);
  expect(saved.requestFingerprint).toBe(waitlistOfferRequestFingerprint(f.record));
  expect(saved.expiresAt).toBe(Date.now() + 600000);
  for (const key of ['clientUid', 'ownerActorUid', 'catalog', 'intakeFields', 'clientPhone', 'intakeAnswers']) expect(JSON.stringify(result.recovery)).not.toContain(`"${key}"`);
});
it('specifiedResourceCannotBecomeAny', async () => {
  const f = await waitlistOffersFixture();
  await waitlistRef(f).set({ ...f.record, request: { ...f.record.request!, resourceId: 'two' } });
  await expect(createOwnerWaitlistOffer(f.owner, f.business.id, f.recordId, command(f), f.db)).rejects.toMatchObject({ status: 409 });
  expect((await businessRef(f).collection('waitlistOffers').get()).empty).toBe(true);
});
it.each(['service', 'resource', 'shift'] as const)('inactiveServiceResourceOrClosedShiftCannotPublish:%s', async kind => {
  const f = await waitlistOffersFixture();
  await businessRef(f).set({ ...f.business, ...(kind === 'service' ? { services: [] } : kind === 'resource' ? { resources: f.business.resources.map(r => ({ ...r, active: false })) }
    : { weeklySchedule: Object.fromEntries(Array.from({ length: 7 }, (_, i) => [i, { isOpen: false, intervals: [] }])) }) });
  await expect(createOwnerWaitlistOffer(f.owner, f.business.id, f.recordId, command(f), f.db)).rejects.toMatchObject({ status: 409 });
});
it('noHoldNoQuotaNoContactOnCreate', async () => {
  const memory = memoryFirestore(), f = await waitlistOffersFixture(memory.db), before = structuredClone([...memory.rows]);
  const monitor = observe(f.db);
  await expect(createOwnerWaitlistOffer(f.owner, f.business.id, f.recordId, command(f), monitor.db)).resolves.toMatchObject({ replayed: false });
  expect(monitor.writes.every(path => path.includes('/waitlistOffers/') || path.includes('/waitlistOfferHeads/') || path.startsWith('serverSettings/booking_action_'))).toBe(true);
  expect((await businessRef(f).get()).data()?.subscription).toEqual(f.business.subscription);
  expect((await waitlistRef(f).get()).data()).toEqual(f.record);
  expect([...memory.rows].filter(([path]) => path.includes('bookingLocks'))).toHaveLength(0);
  expect(before.filter(([path]) => path.includes('/appointments/'))).toEqual([...memory.rows].filter(([path]) => path.includes('/appointments/')));
});
it('sameOwnerCommandReplaysSameExpiryAndReturnsCurrentHead', async () => {
  const f = await waitlistOffersFixture(), original = await seedOffer(f);
  await withdrawOwnerWaitlistOffer(f.owner, f.business.id, original.id, f.db);
  vi.setSystemTime(Date.now() + 1000);
  const second = await createOwnerWaitlistOffer(f.owner, f.business.id, f.recordId, command(f, { requestId: 'demo-owner-second-command', expectedHeadRevision: 1 }), f.db);
  vi.stubEnv('SARIN_WAITLIST_OFFERS_ENABLED', 'false');
  const account = await readConsent(f.owner.uid, 'account', undefined, f.db);
  await updateConsent(f.owner, { scope: 'account', action: 'revoke', requestId: 'demo-owner-revoke', expectedRevision: account.revision }, f.db);
  await businessRef(f).set({ ...f.business, subscription: { ...f.business.subscription, status: 'suspended' } });
  const replay = await createOwnerWaitlistOffer(f.owner, f.business.id, f.recordId, command(f), f.db);
  expect(replay).toMatchObject({ appliedHeadRevision: 1, headRevision: 2, replayed: true, recovery: { offer: { id: original.id, persistedState: 'withdrawn', expiresAt: original.expiresAt } } });
  expect(second.recovery.offer.id).not.toBe(original.id);
});
it('staleHeadRequestOrFingerprintRejects', async () => {
  const f = await waitlistOffersFixture(), offer = await seedOffer(f);
  await expect(createOwnerWaitlistOffer(f.owner, f.business.id, f.recordId, command(f, { selection: { resourceId: 'one', startTimeStr: '09:15' } }), f.db)).rejects.toMatchObject({ code: 'OFFER_REQUEST_REUSED' });
  await expect(createOwnerWaitlistOffer(f.owner, f.business.id, f.recordId, command(f, { requestId: 'demo-stale-head-command' }), f.db)).rejects.toMatchObject({ code: 'OFFER_CHANGED' });
  await expect(createOwnerWaitlistOffer(f.owner, f.business.id, f.recordId, command(f, { requestId: 'demo-stale-revision-command', expectedWaitlistRevision: 2, expectedHeadRevision: 1 }), f.db)).rejects.toMatchObject({ code: 'OFFER_CHANGED' });
  await waitlistRef(f).set({ ...f.record, request: { ...f.record.request!, resourceId: 'one' } });
  await expect(readCurrentClientWaitlistOffer(f.actor, f.business.id, f.db)).resolves.toMatchObject({ current: null });
  await expect(readClientWaitlistOffer(f.actor, f.business.id, offer.id, f.db)).resolves.toMatchObject({ usability: 'request_changed' });
});
it('liveOfferCannotBeReplacedSilently', async () => {
  const f = await waitlistOffersFixture(), offer = await seedOffer(f);
  await expect(createOwnerWaitlistOffer(f.owner, f.business.id, f.recordId, command(f, { requestId: 'demo-replacement-command', expectedHeadRevision: 1 }), f.db)).rejects.toMatchObject({ code: 'OFFER_EXISTS' });
  expect((await headRef(f).get()).data()?.currentOfferId).toBe(offer.id);
});
it('expiredPreviousCanCloseAndNewHeadCommitTogether', async () => {
  const f = await waitlistOffersFixture(), old = await seedOffer(f);
  vi.setSystemTime(old.expiresAt);
  const monitor = observe(f.db), result = await createOwnerWaitlistOffer(f.owner, f.business.id, f.recordId, command(f, { requestId: 'demo-replace-expired', expectedHeadRevision: 1 }), monitor.db);
  expect(monitor.transactions()).toBe(1);
  expect(result.headRevision).toBe(2);
  expect((await offerRef(f, old.id).get()).data()).toMatchObject({ state: 'expired', closedAt: old.expiresAt });
  expect((await headRef(f).get()).data()?.currentOfferId).toBe(result.recovery.offer.id);
});
it('creationAdmissionOncePerCommand', async () => {
  const f = await waitlistOffersFixture(), input = command(f);
  await createOwnerWaitlistOffer(f.owner, f.business.id, f.recordId, input, f.db);
  await createOwnerWaitlistOffer(f.owner, f.business.id, f.recordId, input, f.db);
  const secondRecordId = waitlistDocumentId(f.secondClient.uid, f.business.id), secondInput = { ...input, entryId: f.second.request!.id };
  await createOwnerWaitlistOffer(f.owner, f.business.id, secondRecordId, secondInput, f.db);
  const events = (await f.db.collection('serverSettings').doc(`booking_action_uid_${hash(f.owner.uid)}`).get()).data()?.events;
  expect(events).toHaveLength(2);
  expect(events.map((e: { request: string }) => e.request)).toEqual([hash([f.owner.uid, f.business.id, 'proposal', `waitlist-offer-owner:${input.entryId}:${input.requestId}`]),
    hash([f.owner.uid, f.business.id, 'proposal', `waitlist-offer-owner:${secondInput.entryId}:${input.requestId}`])]);
});
it('getNeverMutatesEvenPastExpiry', async () => {
  const f = await waitlistOffersFixture(), offer = await seedOffer(f);
  vi.setSystemTime(offer.expiresAt);
  const monitor = observe(f.db);
  await expect(readOwnerWaitlistOffer(f.owner, f.business.id, offer.id, monitor.db)).resolves.toMatchObject({ usability: 'expired_pending_close', offer: { persistedState: 'offered' } });
  await expect(readClientWaitlistOffer(f.actor, f.business.id, offer.id, monitor.db)).resolves.toMatchObject({ usability: 'expired_pending_close' });
  await expect(readCurrentClientWaitlistOffer(f.actor, f.business.id, monitor.db)).resolves.toMatchObject({ current: { usability: 'expired_pending_close' } });
  expect(monitor.writes).toEqual([]);
  expect((await offerRef(f, offer.id).get()).data()?.state).toBe('offered');
});
it('createReplayUsabilityUsesFinalEnvelopeClockAtExpiryBoundary', async () => {
  const f = await waitlistOffersFixture(), offer = await seedOffer(f);
  let clock = Date.now();
  const now = vi.spyOn(Date, 'now').mockImplementation(() => clock++);
  try {
    const monitor = observe(f.db, target => {
      if ('path' in target && target.path.endsWith('/resourceSchedulePolicies/current')) clock = offer.expiresAt - 1;
    });
    const replay = await createOwnerWaitlistOffer(f.owner, f.business.id, f.recordId, command(f), monitor.db);
    expect(replay.recovery.serverNow).toBeGreaterThanOrEqual(offer.expiresAt);
    expect(replay.recovery.usability).toBe('expired_pending_close');
    expect(monitor.writes).toEqual([]);
  } finally { now.mockRestore(); }
});
it('declineOrWithdrawKeepsRequestAndQuota', async () => {
  for (const role of ['owner', 'client'] as const) {
    const f = await waitlistOffersFixture(), offer = await seedOffer(f), monitor = observe(f.db);
    vi.stubEnv('SARIN_WAITLIST_OFFERS_ENABLED', 'false');
    const account = await readConsent(f.actor.uid, 'account', undefined, f.db);
    await updateConsent(f.actor, { scope: 'account', action: 'revoke', requestId: 'demo-client-revoke', expectedRevision: account.revision }, f.db);
    const close = role === 'owner' ? () => withdrawOwnerWaitlistOffer(f.owner, f.business.id, offer.id, monitor.db) : () => declineClientWaitlistOffer(f.actor, f.business.id, offer.id, monitor.db);
    await expect(close()).resolves.toMatchObject({ offer: { persistedState: role === 'owner' ? 'withdrawn' : 'declined' }, usability: null });
    const count = monitor.writes.length;
    await close();
    expect(monitor.writes).toHaveLength(count);
    expect(monitor.writes).toEqual([offerRef(f, offer.id).path]);
    expect((await waitlistRef(f).get()).data()).toEqual(f.record);
    expect((await businessRef(f).get()).data()?.subscription).toEqual(f.business.subscription);
  }
});
it('closeExpiredBeforeBoundary409AtBoundaryCloses', async () => {
  const f = await waitlistOffersFixture(), offer = await seedOffer(f);
  vi.setSystemTime(offer.expiresAt - 1);
  await expect(closeExpiredWaitlistOffer(f.actor, f.business.id, offer.id, 'client', f.db)).rejects.toMatchObject({ code: 'OFFER_NOT_EXPIRED' });
  vi.setSystemTime(offer.expiresAt);
  await expect(closeExpiredWaitlistOffer(f.actor, f.business.id, offer.id, 'client', f.db)).resolves.toMatchObject({ persistedState: 'expired', proof: null });
  await expect(withdrawOwnerWaitlistOffer(f.owner, f.business.id, offer.id, f.db)).resolves.toMatchObject({ offer: { persistedState: 'expired' } });
});
it('otherOwnerReceiptCannotBecomeReplay', async () => {
  const f = await waitlistOffersFixture(), old = await seedOffer(f);
  await businessRef(f).set({ ...f.business, ownerUid: f.secondOwner.uid });
  await expect(createOwnerWaitlistOffer(f.owner, f.business.id, f.recordId, command(f), f.db)).rejects.toMatchObject({ status: 403 });
  await expect(readOwnerWaitlistOffer(f.secondOwner, f.business.id, old.id, f.db)).resolves.toMatchObject({ usability: 'policy_changed' });
  await expect(createOwnerWaitlistOffer(f.secondOwner, f.business.id, f.recordId, command(f), f.db)).rejects.toMatchObject({ code: 'OFFER_CHANGED' });
  await expect(withdrawOwnerWaitlistOffer(f.secondOwner, f.business.id, old.id, f.db)).resolves.toMatchObject({ offer: { persistedState: 'withdrawn' } });
});
it('newEntryResetsOfferContextNotOldProof', async () => {
  const f = await waitlistOffersFixture(), old = await seedOffer(f);
  await cancelWaitlist(f.actor, f.business.id, { requestId: 'demo-cancel-entry', expectedRevision: 1, entryId: f.first.request!.id }, f.db);
  await businessRef(f).collection('appointments').doc('block-one').set({ id: 'block-one', tenantId: f.business.id, dateKey: f.input.dateKey, resourceId: 'one', status: 'confirmed', type: 'manual_block', startTimeStr: '09:00', endTimeStr: '10:00' });
  await joinWaitlist(f.actor, f.business.id, { ...f.input, expectedRevision: 2 }, f.db);
  await businessRef(f).collection('appointments').doc('block-one').delete();
  const context = await readOwnerWaitlistOfferContext(f.owner, f.business.id, f.recordId, f.db);
  expect(context).toMatchObject({ headRevision: 1, currentOffer: null, eligible: true });
  expect(context.detail.row.entryId).toBe(old.entryId);
  expect((await readCurrentClientWaitlistOffer(f.actor, f.business.id, f.db)).current).toBeNull();
  expect((await readClientWaitlistOffer(f.actor, f.business.id, old.id, f.db)).usability).toBe('request_changed');
});
it('contextDetailHeadAndCurrentUseOneTransactionAndOneClock', async () => {
  const f = await waitlistOffersFixture(); await seedOffer(f);
  let now = Date.now();
  const monitor = observe(f.db, () => { vi.setSystemTime(++now); });
  const context = await readOwnerWaitlistOfferContext(f.owner, f.business.id, f.recordId, monitor.db);
  expect(monitor.transactions()).toBe(1); expect(monitor.writes).toEqual([]);
  expect(ownerWaitlistOfferContextSchema.safeParse(context).success).toBe(true);
  expect(context.currentOffer?.serverNow).toBe(context.detail.serverNow);
});
it('contextServiceUsesCanonicalIdWithDuplicateNamesAndMissingServiceIsNull', async () => {
  const f = await waitlistOffersFixture();
  await businessRef(f).set({ ...f.business, services: [{ ...f.business.services[0], id: 'other-cut', price: 99999 }, f.business.services[0]] });
  const monitor = observe(f.db), context = await readOwnerWaitlistOfferContext(f.owner, f.business.id, f.recordId, monitor.db);
  expect(monitor.transactions()).toBe(1);
  expect(context).toMatchObject({ eligible: true, service: { serviceId: 'cut', serviceName: f.business.services[0].name, priceCOP: 25000, durationMinutes: 30, bufferMinutes: 15 } });
  await businessRef(f).set({ ...f.business, services: [] });
  await expect(readOwnerWaitlistOfferContext(f.owner, f.business.id, f.recordId, f.db)).resolves.toMatchObject({ eligible: false, reason: 'not_available', service: null });
});
it('gateAndRestrictedPolicyBlockNewCreateButPreserveReads', async () => {
  const f = await waitlistOffersFixture(), old = await seedOffer(f);
  vi.stubEnv('SARIN_WAITLIST_OFFERS_ENABLED', 'false');
  await expect(readOwnerWaitlistOfferContext(f.owner, f.business.id, f.recordId, f.db)).resolves.toMatchObject({ eligible: false, reason: 'disabled' });
  await expect(createOwnerWaitlistOffer(f.owner, f.business.id, f.recordId, command(f, { requestId: 'demo-gate-command', expectedHeadRevision: 1 }), f.db)).rejects.toMatchObject({ code: 'WAITLIST_OFFERS_DISABLED' });
  await expect(createOwnerWaitlistOffer(f.owner, f.business.id, f.recordId, command(f), f.db)).resolves.toMatchObject({ replayed: true });
  vi.stubEnv('SARIN_WAITLIST_OFFERS_ENABLED', 'true');
  await saveBookingDataPolicy(subjectAdmin, { businessId: f.business.id, expectedRevision: 1, dataMode: 'health', representedMinorsEnabled: false, reason: 'Synthetic policy change' }, f.db);
  await expect(readOwnerWaitlistOfferContext(f.owner, f.business.id, f.recordId, f.db)).resolves.toMatchObject({ eligible: false, reason: 'restricted_policy' });
  await expect(readClientWaitlistOffer(f.actor, f.business.id, old.id, f.db)).resolves.toMatchObject({ usability: 'policy_changed' });
});
it.each(['client-consent', 'owner-consent', 'plan'] as const)('freshCreateRetainsConsentAndPlanErrorBoundary:%s', async kind => {
  const f = await waitlistOffersFixture();
  if (kind === 'plan') await businessRef(f).set({ ...f.business, subscription: { ...f.business.subscription, status: 'suspended' } });
  else {
    const actor = kind === 'client-consent' ? f.actor : f.owner, account = await readConsent(actor.uid, 'account', undefined, f.db);
    await updateConsent(actor, { scope: 'account', action: 'revoke', requestId: 'demo-revoke-before-create', expectedRevision: account.revision }, f.db);
  }
  const monitor = observe(f.db);
  await expect(createOwnerWaitlistOffer(f.owner, f.business.id, f.recordId, command(f), monitor.db)).rejects.toMatchObject({ status: kind === 'plan' ? 402 : 428 });
  expect(monitor.writes).toEqual([]);
});
it('finalAdmissionReadCrossingTargetExpiryDoesNotPublishOrSpendAdmission', async () => {
  const f = await waitlistOffersFixture();
  vi.setSystemTime(Date.parse('2030-01-07T13:59:59.999Z'));
  const monitor = observe(f.db, target => {
    if ('path' in target && target.path.startsWith('serverSettings/booking_action_')) vi.setSystemTime(Date.parse('2030-01-07T14:00:00Z'));
  });
  await expect(createOwnerWaitlistOffer(f.owner, f.business.id, f.recordId, command(f), monitor.db)).rejects.toMatchObject({ code: 'SLOT_UNAVAILABLE' });
  expect(monitor.writes).toEqual([]);
});
it('storedConsentChangesStayReadOnlyUsability', async () => {
  const f = await waitlistOffersFixture(), offer = await seedOffer(f);
  const account = await readConsent(f.actor.uid, 'account', undefined, f.db);
  await updateConsent(f.actor, { scope: 'account', action: 'revoke', requestId: 'demo-revoke-after-offer', expectedRevision: account.revision }, f.db);
  const monitor = observe(f.db);
  await expect(readClientWaitlistOffer(f.actor, f.business.id, offer.id, monitor.db)).resolves.toMatchObject({ usability: 'consent_changed' });
  expect(monitor.writes).toEqual([]);
});
it('S09ClosureIsEnforcedWithScheduleWritesDisabledAndRevisionAloneInvalidatesOffer', async () => {
  const f = await waitlistOffersFixture(), offer = await seedOffer(f);
  vi.stubEnv('SARIN_RESOURCE_SCHEDULES_ENABLED', 'false');
  const scheduleRef = businessRef(f).collection('resourceSchedulePolicies').doc('current');
  await scheduleRef.set({ version: 1, businessId: f.business.id, revision: 1, updatedAt: Date.now(), rules: { weekly: [], exceptions: [], closures: [] } });
  const monitor = observe(f.db);
  await expect(readClientWaitlistOffer(f.actor, f.business.id, offer.id, monitor.db)).resolves.toMatchObject({ usability: 'schedule_changed' });
  expect(monitor.writes).toEqual([]);
  await withdrawOwnerWaitlistOffer(f.owner, f.business.id, offer.id, f.db);
  await scheduleRef.set({ version: 1, businessId: f.business.id, revision: 2, updatedAt: Date.now(), rules: { weekly: [], exceptions: [], closures: [
    { id: 'demo-closure', fromDateKey: f.input.dateKey, throughDateKey: f.input.dateKey, scope: 'resource', resourceId: 'one', interval: null, label: 'Synthetic closure' },
  ] } });
  await expect(createOwnerWaitlistOffer(f.owner, f.business.id, f.recordId, command(f, { requestId: 'demo-s09-command', expectedHeadRevision: 1 }), f.db)).rejects.toMatchObject({ code: 'SLOT_UNAVAILABLE' });
});
it('occupiedTargetStaysNonexclusiveAndCatalogChangeInvalidatesSnapshot', async () => {
  const f = await waitlistOffersFixture(), offer = await seedOffer(f);
  const block = businessRef(f).collection('appointments').doc('demo-new-occupancy');
  await block.set({ id: block.id, tenantId: f.business.id, dateKey: offer.dateKey, resourceId: offer.target.resourceId, status: 'confirmed', type: 'manual_block', startTimeStr: '09:00', endTimeStr: '10:00' });
  const monitor = observe(f.db);
  await expect(readClientWaitlistOffer(f.actor, f.business.id, offer.id, monitor.db)).resolves.toMatchObject({ usability: 'slot_unavailable', offer: { persistedState: 'offered' } });
  await block.delete();
  await businessRef(f).set({ ...f.business, services: [{ ...f.business.services[0], price: 26000 }] });
  await expect(readClientWaitlistOffer(f.actor, f.business.id, offer.id, monitor.db)).resolves.toMatchObject({ usability: 'catalog_changed' });
  expect(monitor.writes).toEqual([]);
});
it('backendErrorsCannotBecomeEmptyOfferResults', async () => {
  const f = await waitlistOffersFixture();
  const failing: Database = { collection: name => f.db.collection(name), runTransaction: async () => { throw new Error('synthetic backend outage'); } };
  await expect(readOwnerWaitlistOffers(f.owner, f.business.id, { dateKey: f.input.dateKey, filter: 'all' }, failing)).rejects.toMatchObject({ status: 503, code: 'WAITLIST_OFFER_UNVERIFIABLE' });
  await expect(readCurrentClientWaitlistOffer(f.actor, f.business.id, failing)).rejects.toMatchObject({ status: 503, code: 'WAITLIST_OFFER_UNVERIFIABLE' });
});
it('corruptOfferHeadAndPolicyFailClosedInsteadOfNull', async () => {
  const f = await waitlistOffersFixture(), offer = await seedOffer(f);
  await offerRef(f, offer.id).set({ ...offer, catalogFingerprint: 'a'.repeat(64) });
  await expect(readCurrentClientWaitlistOffer(f.actor, f.business.id, f.db)).rejects.toMatchObject({ code: 'WAITLIST_OFFER_UNVERIFIABLE' });
  await offerRef(f, offer.id).set(offer);
  await f.db.collection('serverSettings').doc(bookingDataPolicyKey(f.business.id)).set({ invalid: true });
  await expect(readOwnerWaitlistOffer(f.owner, f.business.id, offer.id, f.db)).rejects.toMatchObject({ code: 'WAITLIST_OFFER_UNVERIFIABLE' });
});
it('listTwentyPlusLookaheadFiltersStoredStateNotDynamicExpiry', async () => {
  const f = await waitlistOffersFixture(), offers = [];
  for (let i = 0; i < 24; i++) offers.push(await seedOffer(f, { requestId: `demo-list-offer-${i.toString().padStart(3, '0')}`, createdAt: Date.now() - Math.floor(i / 4), head: false }));
  await offerRef(f, offers[0].id).set({ ...offers[0], state: 'withdrawn', closedAt: Date.now(), closedReason: 'withdrawn', closedByUid: f.owner.uid });
  vi.setSystemTime(Date.now() + 600001);
  const first = await readOwnerWaitlistOffers(f.owner, f.business.id, { dateKey: f.input.dateKey, filter: 'offered' }, f.db);
  expect(first.rows).toHaveLength(20); expect(first.nextCursor).not.toBeNull();
  expect(first.rows.every((r: { persistedState: string; expiresAt: number }) => r.persistedState === 'offered' && r.expiresAt < Date.now())).toBe(true);
  const next = await readOwnerWaitlistOffers(f.owner, f.business.id, { dateKey: f.input.dateKey, filter: 'offered', cursor: first.nextCursor! }, f.db);
  expect(next.rows).toHaveLength(3); expect(next.nextCursor).toBeNull();
  expect(new Set([...first.rows, ...next.rows].map((r: { id: string }) => r.id)).size).toBe(23);
  await expect(readOwnerWaitlistOffers(f.owner, f.business.id, { dateKey: f.input.dateKey, filter: 'offered', cursor: { offerId: offers[0].id, createdAt: offers[0].createdAt } }, f.db)).rejects.toMatchObject({ code: 'OFFER_CHANGED' });
});
it('listDoesNotRevalidateAvailabilityPerRow', async () => {
  const f = await waitlistOffersFixture(); await seedOffer(f);
  await f.db.collection('serverSettings').doc(bookingDataPolicyKey(f.business.id)).set({ invalid: true });
  const monitor = observe(f.db);
  const page = await readOwnerWaitlistOffers(f.owner, f.business.id, { dateKey: f.input.dateKey, filter: 'all' }, monitor.db);
  expect(page.rows).toHaveLength(1);
  expect(monitor.reads.every(path => path === businessRef(f).path || path.includes('waitlistOffers') || path === '<query>')).toBe(true);
  expect(monitor.writes).toEqual([]);
});
it('listRejectsCorruptLookaheadAndUnverifiedCursor', async () => {
  const f = await waitlistOffersFixture(), offers = [];
  for (let i = 0; i < 21; i++) offers.push(await seedOffer(f, { requestId: `demo-lookahead-${i.toString().padStart(3, '0')}`, createdAt: Date.now() - i, head: false }));
  await offerRef(f, offers[20].id).set({ ...offers[20], catalogFingerprint: 'a'.repeat(64) });
  await expect(readOwnerWaitlistOffers(f.owner, f.business.id, { dateKey: f.input.dateKey, filter: 'all' }, f.db)).rejects.toMatchObject({ code: 'WAITLIST_OFFER_UNVERIFIABLE' });
  await expect(readOwnerWaitlistOffers(f.owner, f.business.id, { dateKey: f.input.dateKey, filter: 'all', cursor: { offerId: offers[0].id, createdAt: offers[0].createdAt - 1 } }, f.db)).rejects.toMatchObject({ code: 'OFFER_CHANGED' });
  await expect(readOwnerWaitlistOffers(f.owner, f.business.id, { dateKey: f.input.dateKey, filter: 'all', cursor: { offerId: 'missing-anchor', createdAt: 1 } }, f.db)).rejects.toMatchObject({ code: 'OFFER_CHANGED' });
});
it('bookedCannotBeWithdrawnOrReopened', async () => {
  const f = await waitlistOffersFixture(), offer = await seedOffer(f);
  const requestId = 'demo-booked-proposal', proposalId = waitlistOfferProposalId(f.business.id, offer.id, f.actor.uid, requestId);
  const proposal = { id: proposalId, requestId, subjectCase: { bookingRequestId: requestId, subjectKind: 'self' }, createdAt: Date.now(), expiresAt: offer.expiresAt,
    catalogFingerprint: offer.catalogFingerprint, resourceScheduleFingerprint: offer.resourceScheduleFingerprint, policyRevision: 1 };
  const { dateKey, startAt, endAt, reservedUntilAt, resourceId, serviceId } = offer.target;
  const booking = { appointmentId: 'demo-booked-appointment', proposalId, entryId: offer.entryId, previousWaitlistRevision: 1, resolvedWaitlistRevision: 2, confirmedAt: Date.now(), source: { dateKey, startAt, endAt, reservedUntilAt, resourceId, serviceId } };
  await offerRef(f, offer.id).set({ ...offer, state: 'booked', proposal, booking, closedAt: Date.now(), closedReason: 'booked', closedByUid: f.actor.uid });
  await waitlistRef(f).set({ ...f.record, revision: 2, request: null, lastOperation: { ...f.record.lastOperation, appliedRevision: 2 } });
  const appointment = { ...offer.target, id: booking.appointmentId, tenantId: f.business.id, type: 'appointment', status: 'cancelled_by_client', client: { uid: f.actor.uid },
    dateKey: '2030-01-08', startAt: startAt + 86400000, endAt: endAt + 86400000, reservedUntilAt: reservedUntilAt + 86400000 };
  await businessRef(f).collection('appointments').doc(booking.appointmentId).set(appointment);
  await businessRef(f).set({ ...f.business, ownerUid: f.secondOwner.uid });
  vi.stubEnv('SARIN_WAITLIST_OFFERS_ENABLED', 'false'); vi.setSystemTime(offer.expiresAt + 1);
  const monitor = observe(f.db);
  const owner = await withdrawOwnerWaitlistOffer(f.secondOwner, f.business.id, offer.id, monitor.db);
  expect(owner).toMatchObject({ offer: { persistedState: 'booked' }, proof: booking, proposal: null });
  expect('appointment' in owner).toBe(false);
  const client = await declineClientWaitlistOffer(f.actor, f.business.id, offer.id, monitor.db);
  expect(clientWaitlistOfferRecoverySchema.safeParse(client).success).toBe(true);
  expect(client.appointment).toEqual(appointment); expect(client.proof).toEqual(booking);
  expect((await readCurrentClientWaitlistOffer(f.actor, f.business.id, monitor.db)).current?.proof).toEqual(booking);
  await expect(closeExpiredWaitlistOffer(f.secondOwner, f.business.id, offer.id, 'owner', monitor.db)).resolves.toMatchObject({ persistedState: 'booked', proof: booking });
  expect(monitor.writes).toEqual([]);
});
