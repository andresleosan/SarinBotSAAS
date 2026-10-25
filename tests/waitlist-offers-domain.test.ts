import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import type { Database, DocumentReference, Query, Transaction } from '@/lib/storage/types';
import type { OwnerWaitlistOfferCommand } from '@/lib/waitlist-offers';
import { ownerWaitlistOfferRecoverySchema, clientWaitlistOfferRecoverySchema, ownerWaitlistOfferContextSchema } from '@/lib/waitlist-offers';
import { waitlistOffersFixture } from './waitlist-offers-contract';
import { memoryFirestore } from './memoryFirestore';
import { subjectAdmin, contact } from './represented-booking-contract';
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
  prepareClientWaitlistOffer, confirmClientWaitlistOffer, waitlistOfferRecordSchema,
} from '@/lib/server/waitlist-offers';
import { createAppointment, cancelAppointment } from '@/lib/server/bookings';
import { stableDocumentId } from '@/lib/server/businesses';
import { updateClientPolicy } from '@/lib/server/client-policy';
import { waitlistRecordSchema, parseCanonicalWaitlistRecord } from '@/lib/server/waitlist';
import { createAppointmentRescheduleProposal } from '@/lib/server/appointment-rescheduling';
import { confirmBookingProposal } from '@/lib/server/booking-proposals';
import { StorageError } from '@/lib/storage/database';

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

async function seedPrepared(f: Fixture) {
  const offer = await seedOffer(f), requestId = 'demo-client-offer-proposal';
  const proposal = { id: waitlistOfferProposalId(f.business.id, offer.id, f.actor.uid, requestId), requestId,
    subjectCase: { bookingRequestId: requestId, subjectKind: 'self' as const }, createdAt: Date.now(), expiresAt: offer.expiresAt,
    catalogFingerprint: offer.catalogFingerprint, resourceScheduleFingerprint: offer.resourceScheduleFingerprint, policyRevision: offer.policyRevision };
  const prepared = parseCanonicalWaitlistOffer(offer.id, { ...offer, proposal }, f.business.id);
  await offerRef(f, offer.id).set(prepared);
  return { ...prepared, proposal };
}
const savedOffer = async (f: Fixture, offerId: string) => parseCanonicalWaitlistOffer(offerId, (await offerRef(f, offerId).get()).data(), f.business.id);
const appointmentCount = async (f: Fixture) => (await businessRef(f).collection('appointments').where('type', '==', 'appointment').get()).size;
function pauseFinalStagingRead(db: Database) {
  let signal!: () => void, release!: () => void, paused = false;
  const reached = new Promise<void>(resolve => { signal = resolve; }), released = new Promise<void>(resolve => { release = resolve; });
  const blocked: Database = { collection: name => db.collection(name), runTransaction: handler => db.runTransaction(tx => {
    let staging = false;
    return handler(new Proxy(tx, { get(target, key: keyof Transaction) {
      if (key !== 'get') return target[key].bind(target);
      return async (ref: DocumentReference | Query) => {
        if ('path' in ref && ref.path.includes('/bookingLocks/')) staging = true;
        const result = await target.get(ref as DocumentReference);
        if (!paused && staging && 'path' in ref && ref.path.endsWith('/resourceSchedulePolicies/current')) { paused = true; signal(); await released; }
        return result;
      };
    } }));
  }) };
  return { db: blocked, reached, release };
}

it('realClientOnlyNotOwnerOrBodyUid', async () => {
  const f = await waitlistOffersFixture(), offer = await seedPrepared(f);
  for (const actor of [f.owner, f.secondClient, subjectAdmin]) {
    await expect(prepareClientWaitlistOffer(actor, f.business.id, offer.id, { requestId: offer.proposal.requestId }, f.db)).rejects.toMatchObject({ status: 404 });
    await expect(confirmClientWaitlistOffer(actor, f.business.id, offer.id, contact, f.db)).rejects.toMatchObject({ status: 404 });
  }
  await expect(prepareClientWaitlistOffer(f.actor, f.business.id, offer.id, { requestId: offer.proposal.requestId, clientUid: f.actor.uid } as never, f.db)).rejects.toThrow();
});
it('prepareRequiresCurrentRequestAnchorsGeneralSelfAndGate', async () => {
  for (const change of ['gate', 'anchor', 'request', 'policy'] as const) {
    const f = await waitlistOffersFixture(), offer = await seedOffer(f), monitor = observe(f.db);
    if (change === 'gate') vi.stubEnv('SARIN_WAITLIST_OFFERS_ENABLED', 'false');
    if (change === 'anchor') { const current = await readConsent(f.actor.uid, 'account', undefined, f.db); await updateConsent(f.actor, { scope: 'account', action: 'revoke', requestId: 'demo-prepare-revoke', expectedRevision: current.revision }, f.db); }
    if (change === 'request') await waitlistRef(f).set({ ...f.record, request: { ...f.record.request!, resourceId: 'two' } });
    if (change === 'policy') await saveBookingDataPolicy(subjectAdmin, { businessId: f.business.id, expectedRevision: 1, dataMode: 'general', representedMinorsEnabled: true, reason: 'Synthetic minors change' }, f.db);
    await expect(prepareClientWaitlistOffer(f.actor, f.business.id, offer.id, { requestId: 'demo-prepare-request' }, monitor.db)).rejects.toMatchObject({ status: change === 'gate' ? 503 : change === 'anchor' ? 428 : 409 });
    expect(monitor.writes).toEqual([]); vi.stubEnv('SARIN_WAITLIST_OFFERS_ENABLED', 'true');
  }
});
it('sameProposalRequestKeepsIdAndExpiry', async () => {
  const f = await waitlistOffersFixture(), offer = await seedOffer(f), input = { requestId: 'demo-prepare-request' };
  const first = await prepareClientWaitlistOffer(f.actor, f.business.id, offer.id, input, f.db);
  expect(first.proposal?.proposal.id).toBe(waitlistOfferProposalId(f.business.id, offer.id, f.actor.uid, input.requestId));
  expect(first.proposal?.proposal.expiresAt).toBe(offer.expiresAt);
  expect(first.proposal?.proposal.subjectCase).toEqual({ bookingRequestId: input.requestId, subjectKind: 'self' });
  vi.setSystemTime(Date.now() + 1000); vi.stubEnv('SARIN_WAITLIST_OFFERS_ENABLED', 'false');
  const account = await readConsent(f.actor.uid, 'account', undefined, f.db);
  await updateConsent(f.actor, { scope: 'account', action: 'revoke', requestId: 'demo-prepare-replay-revoke', expectedRevision: account.revision }, f.db);
  const monitor = observe(f.db), replay = await prepareClientWaitlistOffer(f.actor, f.business.id, offer.id, input, monitor.db);
  expect(replay.proposal).toEqual(first.proposal); expect(replay.usability).toBe('consent_changed'); expect(monitor.writes).toEqual([]);
});
it('anotherRequestIdDoesNotOverwritePreparedProposal', async () => {
  const f = await waitlistOffersFixture(), offer = await seedPrepared(f);
  await expect(prepareClientWaitlistOffer(f.actor, f.business.id, offer.id, { requestId: 'demo-different-proposal' }, f.db)).rejects.toMatchObject({ code: 'OFFER_PROPOSAL_EXISTS' });
  expect((await savedOffer(f, offer.id)).proposal).toEqual(offer.proposal);
});
it.each(['catalog', 'schedule', 'policy', 'owner'] as const)('catalogSchedulePolicyOrOwnerChangedRequireNewOffer:%s', async change => {
  const f = await waitlistOffersFixture(), offer = await seedPrepared(f);
  if (change === 'catalog') await businessRef(f).set({ ...f.business, services: [{ ...f.business.services[0], price: 30000 }] });
  if (change === 'owner') await businessRef(f).set({ ...f.business, ownerUid: f.secondOwner.uid });
  if (change === 'schedule') await businessRef(f).collection('resourceSchedulePolicies').doc('current').set({ version: 1, businessId: f.business.id, revision: 1, updatedAt: Date.now(), rules: { weekly: [], exceptions: [], closures: [] } });
  if (change === 'policy') await saveBookingDataPolicy(subjectAdmin, { businessId: f.business.id, expectedRevision: 1, dataMode: 'general', representedMinorsEnabled: false, reason: 'Synthetic policy revision' }, f.db);
  const monitor = observe(f.db);
  await expect(confirmClientWaitlistOffer(f.actor, f.business.id, offer.id, contact, monitor.db)).rejects.toMatchObject({ code: 'OFFER_CHANGED' });
  expect(monitor.writes).toEqual([]); expect(await appointmentCount(f)).toBe(0);
});
it('preparationConsumesAdmissionButNotBookingQuota', async () => {
  const f = await waitlistOffersFixture(), offer = await seedOffer(f), monitor = observe(f.db), input = { requestId: 'demo-prepare-admission' };
  await prepareClientWaitlistOffer(f.actor, f.business.id, offer.id, input, monitor.db);
  const events = (await f.db.collection('serverSettings').doc(`booking_action_uid_${hash(f.actor.uid)}`).get()).data()?.events;
  const event = hash([f.actor.uid, f.business.id, 'proposal', `waitlist-offer-client:${offer.id}:${input.requestId}`]);
  expect(events.filter((e: { request: string }) => e.request === event)).toHaveLength(1);
  const count = monitor.writes.length;
  await prepareClientWaitlistOffer(f.actor, f.business.id, offer.id, input, monitor.db);
  expect(monitor.writes).toHaveLength(count);
  expect(monitor.writes.every(path => path.includes('/waitlistOffers/') || path.startsWith('serverSettings/booking_action_'))).toBe(true);
  expect(await appointmentCount(f)).toBe(0); expect((await businessRef(f).get()).data()?.subscription).toEqual(f.business.subscription);
});
it('proposalUsesCurrentAllowedIntakeDefinitionsWithoutAnswers', async () => {
  const f = await waitlistOffersFixture();
  f.business = { ...f.business, sarinConfig: { ...f.business.sarinConfig, intakeFields: [{ key: 'preference', label: 'Preferencia', required: true }] } };
  await businessRef(f).set(f.business);
  const offer = await seedOffer(f), recovery = await prepareClientWaitlistOffer(f.actor, f.business.id, offer.id, { requestId: 'demo-prepare-intake' }, f.db);
  expect(recovery.proposal?.proposal.intakeFields).toEqual(f.business.sarinConfig.intakeFields);
  await expect(confirmClientWaitlistOffer(f.actor, f.business.id, offer.id, contact, f.db)).rejects.toMatchObject({ status: 400 });
  await expect(confirmClientWaitlistOffer(f.actor, f.business.id, offer.id, { ...contact, intakeAnswers: { preference: 'Synthetic answer', unknown: 'forbidden' } }, f.db)).rejects.toMatchObject({ status: 400 });
  const result = await confirmClientWaitlistOffer(f.actor, f.business.id, offer.id, { ...contact, intakeAnswers: { preference: 'Synthetic answer' } }, f.db);
  expect(result.appointment.client?.intakeAnswers).toEqual({ preference: 'Synthetic answer' });
  expect(JSON.stringify((await offerRef(f, offer.id).get()).data())).not.toContain('Synthetic answer');
  expect(JSON.stringify((await offerRef(f, offer.id).get()).data())).not.toContain(contact.clientPhone);
});
it('expiredPreparationDoesNotCreateCloseOrSpendAdmission', async () => {
  const f = await waitlistOffersFixture(), offer = await seedOffer(f); vi.setSystemTime(offer.expiresAt); vi.stubEnv('SARIN_WAITLIST_OFFERS_ENABLED', 'false');
  const monitor = observe(f.db);
  await expect(prepareClientWaitlistOffer(f.actor, f.business.id, offer.id, { requestId: 'demo-prepare-expired' }, monitor.db)).resolves.toMatchObject({ usability: 'expired_pending_close', proposal: null, offer: { persistedState: 'offered' } });
  expect(monitor.writes).toEqual([]);
});
it('expiryDuringLastPreparationReadClosesWithoutAppointmentOrQuota', async () => {
  const f = await waitlistOffersFixture(), offer = await seedPrepared(f); let staging = false, finalRead = false;
  const monitor = observe(f.db, target => {
    if ('path' in target && target.path.includes('/bookingLocks/')) staging = true;
    if (staging && 'path' in target && target.path.endsWith('/resourceSchedulePolicies/current')) { finalRead = true; vi.setSystemTime(offer.expiresAt); }
  });
  await expect(confirmClientWaitlistOffer(f.actor, f.business.id, offer.id, contact, monitor.db)).rejects.toMatchObject({ code: 'OFFER_CLOSED' });
  expect(finalRead).toBe(true); expect(monitor.writes).toEqual([offerRef(f, offer.id).path]);
  expect((await savedOffer(f, offer.id)).state).toBe('expired'); expect((await waitlistRef(f).get()).data()).toEqual(f.record);
  expect(await appointmentCount(f)).toBe(0); expect((await businessRef(f).get()).data()?.subscription).toEqual(f.business.subscription);
});
it('expiryEqualsNowRejectsBeforeContactPermissionsOrGate', async () => {
  const f = await waitlistOffersFixture(), offer = await seedPrepared(f); vi.setSystemTime(offer.expiresAt); vi.stubEnv('SARIN_WAITLIST_OFFERS_ENABLED', 'false');
  const account = await readConsent(f.actor.uid, 'account', undefined, f.db);
  await updateConsent(f.actor, { scope: 'account', action: 'revoke', requestId: 'demo-expired-revoke', expectedRevision: account.revision }, f.db);
  const monitor = observe(f.db);
  await expect(confirmClientWaitlistOffer(f.actor, f.business.id, offer.id, { clientPhone: null, intakeAnswers: null }, monitor.db)).rejects.toMatchObject({ code: 'OFFER_CLOSED' });
  expect((await savedOffer(f, offer.id)).state).toBe('expired'); expect(monitor.writes).toEqual([offerRef(f, offer.id).path]);
  expect(monitor.reads.some(path => path.includes('bookingLocks'))).toBe(false);
});
it('targetStartedBeforeApplyCloses', async () => {
  const f = await waitlistOffersFixture(), offer = await seedPrepared(f); let staging = false;
  const monitor = observe(f.db, target => {
    if ('path' in target && target.path.includes('/bookingLocks/')) staging = true;
    if (staging && 'path' in target && target.path.endsWith('/resourceSchedulePolicies/current')) vi.setSystemTime(offer.target.startAt);
  });
  await expect(confirmClientWaitlistOffer(f.actor, f.business.id, offer.id, contact, monitor.db)).rejects.toMatchObject({ code: 'OFFER_CLOSED' });
  expect((await savedOffer(f, offer.id)).state).toBe('expired'); expect(monitor.writes).toEqual([offerRef(f, offer.id).path]); expect(await appointmentCount(f)).toBe(0);
});
it('sameOfferProducesOneAppointmentAndOneQuota', async () => {
  const f = await waitlistOffersFixture(), offer = await seedPrepared(f);
  const results = await Promise.all([confirmClientWaitlistOffer(f.actor, f.business.id, offer.id, contact, f.db), confirmClientWaitlistOffer(f.actor, f.business.id, offer.id, contact, f.db)]);
  expect(new Set(results.map(r => r.appointment.id)).size).toBe(1); expect(results.map(r => r.replayed).sort()).toEqual([false, true]);
  expect(results[0].appointment.id).toBe(stableDocumentId(f.actor.uid, `waitlist-offer-${offer.proposal.id}`, 'appointment'));
  expect(results[0].appointment.beneficiary).toEqual({ kind: 'self' }); expect(results[0].appointment.subjectAuthorization).toBeUndefined();
  expect(await appointmentCount(f)).toBe(1); expect((await businessRef(f).get()).data()?.subscription.paidTrial.appointmentsUsed).toBe(2);
});
it('resolvedTombstoneMatchesExistingWaitlistSchema', async () => {
  const f = await waitlistOffersFixture(), offer = await seedPrepared(f), monitor = observe(f.db);
  const result = await confirmClientWaitlistOffer(f.actor, f.business.id, offer.id, contact, monitor.db), record = (await waitlistRef(f).get()).data();
  expect(waitlistRecordSchema.safeParse(record).success).toBe(true); expect(parseCanonicalWaitlistRecord(f.recordId, record, f.business.id)).toMatchObject({ version: 1, request: null, revision: 2,
    lastOperation: { requestId: `offer-${offer.id}`, appliedRevision: 2, operationHash: bookingSubjectHash({ kind: 'resolve_offer', offerId: offer.id, proposalId: offer.proposal.id, entryId: offer.entryId, appointmentId: result.appointment.id }) } });
  expect(result.proof).toMatchObject({ previousWaitlistRevision: 1, resolvedWaitlistRevision: 2, confirmedAt: Date.now(), appointmentId: result.appointment.id });
  expect(waitlistOfferRecordSchema.safeParse((await offerRef(f, offer.id).get()).data()).success).toBe(true);
  expect(monitor.writes.slice(-2)).toEqual([waitlistRef(f).path, offerRef(f, offer.id).path]);
});
it('replayIgnoresNewContactAndReturnsCurrentAppointment', async () => {
  const f = await waitlistOffersFixture(), offer = await seedPrepared(f), first = await confirmClientWaitlistOffer(f.actor, f.business.id, offer.id, contact, f.db);
  vi.stubEnv('SARIN_WAITLIST_OFFERS_ENABLED', 'false'); vi.setSystemTime(offer.expiresAt + 1);
  const account = await readConsent(f.actor.uid, 'account', undefined, f.db);
  await updateConsent(f.actor, { scope: 'account', action: 'revoke', requestId: 'demo-confirm-replay-revoke', expectedRevision: account.revision }, f.db);
  await businessRef(f).set({ ...f.business, subscription: { ...f.business.subscription, status: 'suspended' } });
  const monitor = observe(f.db), replay = await confirmClientWaitlistOffer(f.actor, f.business.id, offer.id, { clientPhone: Symbol(), intakeAnswers: undefined }, monitor.db);
  expect(replay).toEqual({ ...first, replayed: true }); expect(monitor.writes).toEqual([]);
});
it('replayAfterS07OrCancellationDoesNotRestoreOriginalSlot', async () => {
  const f = await waitlistOffersFixture(), offer = await seedPrepared(f), first = await confirmClientWaitlistOffer(f.actor, f.business.id, offer.id, contact, f.db);
  const proposal = await createAppointmentRescheduleProposal(f.actor, f.business.id, { appointmentId: first.appointment.id, sourceRevision: 0, requestId: 'demo-offer-s07-move', case: { bookingRequestId: 'demo-offer-s07-move', subjectKind: 'self' }, selection: { dateKey: '2030-01-08', resourceId: 'one', startTimeStr: '09:00' } }, f.db);
  const moved = await confirmBookingProposal(f.actor, f.business.id, proposal.id, { clientPhone: null, intakeAnswers: {}, beneficiary: { kind: 'self' } }, f.db);
  const replay = await confirmClientWaitlistOffer(f.actor, f.business.id, offer.id, { clientPhone: null, intakeAnswers: null }, f.db);
  expect(replay.proof).toEqual(first.proof); expect(replay.appointment).toEqual(moved); expect(replay.appointment.dateKey).toBe('2030-01-08');
  const cancelled = await cancelAppointment(f.actor, f.business.id, first.appointment.id, f.db);
  expect((await confirmClientWaitlistOffer(f.actor, f.business.id, offer.id, { clientPhone: null, intakeAnswers: null }, f.db)).appointment).toEqual(cancelled);
  expect((await waitlistRef(f).get()).data()?.request).toBeNull();
});
it('existingAppointmentWithUnbookedOfferIsUnverifiableNotAutoRepair', async () => {
  const f = await waitlistOffersFixture(), offer = await seedPrepared(f);
  await createAppointment(f.actor, f.business.id, { serviceId: offer.target.serviceId, resourceId: offer.target.resourceId, dateKey: offer.dateKey, startTimeStr: offer.target.startTimeStr, ...contact }, `waitlist-offer-${offer.proposal.id}`, f.db);
  const monitor = observe(f.db);
  await expect(confirmClientWaitlistOffer(f.actor, f.business.id, offer.id, contact, monitor.db)).rejects.toMatchObject({ code: 'WAITLIST_OFFER_UNVERIFIABLE' });
  expect((await savedOffer(f, offer.id)).state).toBe('offered'); expect((await waitlistRef(f).get()).data()).toEqual(f.record); expect(monitor.writes).toEqual([]);
});
it.each(['slot', 'client'] as const)('conflictingDeterministicAppointmentWhileUnbookedIsUnverifiable:%s', async mismatch => {
  const f = await waitlistOffersFixture(), offer = await seedPrepared(f);
  const existing = await createAppointment(f.actor, f.business.id, { serviceId: 'cut', resourceId: 'one', dateKey: mismatch === 'slot' ? '2030-01-08' : offer.dateKey, startTimeStr: '09:00', ...contact }, `waitlist-offer-${offer.proposal.id}`, f.db);
  if (mismatch === 'client') await businessRef(f).collection('appointments').doc(existing.id).set({ ...existing, client: { ...existing.client!, uid: f.secondClient.uid } });
  const beforeBusiness = (await businessRef(f).get()).data();
  const monitor = observe(f.db);
  await expect(confirmClientWaitlistOffer(f.actor, f.business.id, offer.id, contact, monitor.db)).rejects.toMatchObject({ status: 503, code: 'WAITLIST_OFFER_UNVERIFIABLE' });
  expect(monitor.writes).toEqual([]); expect((await waitlistRef(f).get()).data()).toEqual(f.record); expect((await savedOffer(f, offer.id)).state).toBe('offered');
  expect((await businessRef(f).get()).data()).toEqual(beforeBusiness);
});
it('finalStagingStorageConflictAtExpiryCannotBeConvertedToClosure', async () => {
  const f = await waitlistOffersFixture(), offer = await seedPrepared(f); let staging = false;
  const monitor = observe(f.db, target => {
    if ('path' in target && target.path.includes('/bookingLocks/')) staging = true;
    if (staging && 'path' in target && target.path.endsWith('/resourceSchedulePolicies/current')) { vi.setSystemTime(offer.expiresAt); throw new StorageError(409, 'DATA_CONFLICT'); }
  });
  await expect(confirmClientWaitlistOffer(f.actor, f.business.id, offer.id, contact, monitor.db)).rejects.toMatchObject({ code: 'DATA_CONFLICT' });
  expect(monitor.writes).toEqual([]); expect((await savedOffer(f, offer.id)).state).toBe('offered'); expect((await waitlistRef(f).get()).data()).toEqual(f.record);
});
it('partialFailureLeavesRequestAndOfferUnresolved', async () => {
  const memory = memoryFirestore(), f = await waitlistOffersFixture(memory.db), offer = await seedPrepared(f), before = structuredClone([...memory.rows]);
  const db: Database = { collection: name => f.db.collection(name), runTransaction: handler => f.db.runTransaction(tx => handler(new Proxy(tx, { get(target, key: keyof Transaction) {
    if (key === 'set') return (ref: DocumentReference, data: object) => { if (ref.path === offerRef(f, offer.id).path) throw new Error('synthetic apply failure'); return target.set(ref, data); };
    return target[key].bind(target);
  } }))) };
  await expect(confirmClientWaitlistOffer(f.actor, f.business.id, offer.id, contact, db)).rejects.toMatchObject({ code: 'WAITLIST_OFFER_UNVERIFIABLE' });
  expect([...memory.rows]).toEqual(before);
});
it('independentBookingDoesNotResolveByUid', async () => {
  const f = await waitlistOffersFixture(), offer = await seedPrepared(f);
  await createAppointment(f.actor, f.business.id, { serviceId: offer.target.serviceId, resourceId: 'one', dateKey: '2030-01-08', startTimeStr: '09:00', ...contact }, 'demo-independent-booking', f.db);
  expect((await waitlistRef(f).get()).data()).toEqual(f.record); expect((await savedOffer(f, offer.id)).state).toBe('offered');
});
it('convertedAppointmentCancelOrMoveDoesNotReopen', async () => {
  const f = await waitlistOffersFixture(), offer = await seedPrepared(f), result = await confirmClientWaitlistOffer(f.actor, f.business.id, offer.id, contact, f.db);
  await cancelAppointment(f.actor, f.business.id, result.appointment.id, f.db);
  expect((await waitlistRef(f).get()).data()?.request).toBeNull(); expect((await savedOffer(f, offer.id)).booking).toEqual(result.proof);
});
it('slotTakenLeavesRequestAndQuotaIntact', async () => {
  const f = await waitlistOffersFixture(), offer = await seedPrepared(f);
  await businessRef(f).collection('appointments').doc('demo-taken-slot').set({ id: 'demo-taken-slot', tenantId: f.business.id, dateKey: offer.dateKey, resourceId: 'one', status: 'confirmed', type: 'manual_block', startTimeStr: '09:00', endTimeStr: '10:00' });
  const monitor = observe(f.db);
  await expect(confirmClientWaitlistOffer(f.actor, f.business.id, offer.id, contact, monitor.db)).rejects.toMatchObject({ code: 'SLOT_UNAVAILABLE' });
  expect(monitor.writes).toEqual([]); expect((await waitlistRef(f).get()).data()).toEqual(f.record); expect((await businessRef(f).get()).data()?.subscription).toEqual(f.business.subscription);
});
it('quotaLastUnitAndClientLimitStillApply', async () => {
  const f = await waitlistOffersFixture(), offer = await seedPrepared(f);
  await businessRef(f).set({ ...f.business, subscription: { ...f.business.subscription, paidTrial: { ...f.business.subscription.paidTrial!, appointmentsUsed: 9 } } });
  const result = await confirmClientWaitlistOffer(f.actor, f.business.id, offer.id, contact, f.db);
  expect(result.replayed).toBe(false); expect((await businessRef(f).get()).data()?.subscription.paidTrial.appointmentsUsed).toBe(10);
  expect((await confirmClientWaitlistOffer(f.actor, f.business.id, offer.id, contact, f.db)).replayed).toBe(true);
  const limited = await waitlistOffersFixture(), second = await seedPrepared(limited);
  await createAppointment(limited.actor, limited.business.id, { serviceId: 'cut', resourceId: 'one', dateKey: '2030-01-08', startTimeStr: '09:00', ...contact }, 'demo-client-limit-existing', limited.db);
  await updateClientPolicy(limited.owner, limited.business.id, { clientUid: limited.actor.uid, futureAppointmentLimit: 1, reason: 'Synthetic future limit' }, limited.db);
  await expect(confirmClientWaitlistOffer(limited.actor, limited.business.id, second.id, contact, limited.db)).rejects.toMatchObject({ code: 'CLIENT_BOOKING_LIMIT' });
  expect((await waitlistRef(limited).get()).data()).toEqual(limited.record);
});
it('clientCancellationWinnerRejectsOffer', async () => {
  const f = await waitlistOffersFixture(), offer = await seedPrepared(f);
  await cancelWaitlist(f.actor, f.business.id, { requestId: 'demo-cancel-before-confirm', expectedRevision: 1, entryId: offer.entryId }, f.db);
  await expect(confirmClientWaitlistOffer(f.actor, f.business.id, offer.id, contact, f.db)).rejects.toMatchObject({ code: 'OFFER_CHANGED' });
  expect(await appointmentCount(f)).toBe(0); expect((await savedOffer(f, offer.id)).state).toBe('offered');
});
it('offerWinnerMakesOldWaitlistCancelConflict', async () => {
  const f = await waitlistOffersFixture(), offer = await seedPrepared(f);
  await confirmClientWaitlistOffer(f.actor, f.business.id, offer.id, contact, f.db);
  await expect(cancelWaitlist(f.actor, f.business.id, { requestId: 'demo-cancel-after-confirm', expectedRevision: 1, entryId: offer.entryId }, f.db)).rejects.toMatchObject({ code: 'WAITLIST_CHANGED' });
  expect((await savedOffer(f, offer.id)).state).toBe('booked');
});
it.each(['revocation', 'policy'] as const)('revocationOrPolicyChangeWinsBeforeConfirm:%s', async change => {
  const f = await waitlistOffersFixture(), offer = await seedPrepared(f);
  if (change === 'revocation') { const consent = await readConsent(f.actor.uid, 'account', undefined, f.db); await updateConsent(f.actor, { scope: 'account', action: 'revoke', requestId: 'demo-confirm-revocation', expectedRevision: consent.revision }, f.db); }
  else await saveBookingDataPolicy(subjectAdmin, { businessId: f.business.id, expectedRevision: 1, dataMode: 'health', representedMinorsEnabled: false, reason: 'Synthetic restricted policy' }, f.db);
  await expect(confirmClientWaitlistOffer(f.actor, f.business.id, offer.id, contact, f.db)).rejects.toMatchObject({ status: change === 'revocation' ? 428 : 409 });
  expect(await appointmentCount(f)).toBe(0); expect((await waitlistRef(f).get()).data()).toEqual(f.record);
});
it('newRequestCannotBeResolvedByOldOffer', async () => {
  const f = await waitlistOffersFixture(), offer = await seedPrepared(f);
  await cancelWaitlist(f.actor, f.business.id, { requestId: 'demo-cancel-rejoin-offer', expectedRevision: 1, entryId: offer.entryId }, f.db);
  await businessRef(f).collection('appointments').doc('block-one').set({ id: 'block-one', tenantId: f.business.id, dateKey: f.input.dateKey, resourceId: 'one', status: 'confirmed', type: 'manual_block', startTimeStr: '09:00', endTimeStr: '10:00' });
  await joinWaitlist(f.actor, f.business.id, { ...f.input, expectedRevision: 2 }, f.db); await businessRef(f).collection('appointments').doc('block-one').delete();
  await expect(confirmClientWaitlistOffer(f.actor, f.business.id, offer.id, contact, f.db)).rejects.toMatchObject({ code: 'OFFER_CHANGED' });
  expect((await waitlistRef(f).get()).data()?.revision).toBe(3); expect((await waitlistRef(f).get()).data()?.request.id).toBe(offer.entryId); expect(await appointmentCount(f)).toBe(0);
});
it('ownerTransferBlocksFreshAcceptButKeepsOwnBookedRead', async () => {
  const f = await waitlistOffersFixture(), offer = await seedPrepared(f);
  await businessRef(f).set({ ...f.business, ownerUid: f.secondOwner.uid });
  await expect(confirmClientWaitlistOffer(f.actor, f.business.id, offer.id, contact, f.db)).rejects.toMatchObject({ code: 'OFFER_CHANGED' });
  await businessRef(f).set(f.business); const result = await confirmClientWaitlistOffer(f.actor, f.business.id, offer.id, contact, f.db);
  await businessRef(f).set({ ...(await businessRef(f).get()).data(), ownerUid: f.secondOwner.uid });
  expect(await confirmClientWaitlistOffer(f.actor, f.business.id, offer.id, { clientPhone: null, intakeAnswers: null }, f.db)).toEqual({ ...result, replayed: true });
});
it('freshConfirmationGateAndTerminalPreparationPreserveDurableAuthority', async () => {
  const f = await waitlistOffersFixture(), offer = await seedPrepared(f); vi.stubEnv('SARIN_WAITLIST_OFFERS_ENABLED', 'false');
  const monitor = observe(f.db);
  await expect(confirmClientWaitlistOffer(f.actor, f.business.id, offer.id, contact, monitor.db)).rejects.toMatchObject({ code: 'WAITLIST_OFFERS_DISABLED' });
  expect(monitor.writes).toEqual([]);
  await withdrawOwnerWaitlistOffer(f.owner, f.business.id, offer.id, f.db);
  await expect(prepareClientWaitlistOffer(f.actor, f.business.id, offer.id, { requestId: 'demo-terminal-proposal' }, f.db)).resolves.toMatchObject({ usability: null, offer: { persistedState: 'withdrawn' } });
  await expect(confirmClientWaitlistOffer(f.actor, f.business.id, offer.id, { clientPhone: null, intakeAnswers: null }, f.db)).rejects.toMatchObject({ code: 'OFFER_CLOSED' });
});
it('finalSubscriptionBoundaryAfterStagingDoesNotApply', async () => {
  const f = await waitlistOffersFixture(), offer = await seedPrepared(f), endsAt = Date.now() + 1000;
  await businessRef(f).set({ ...f.business, subscription: { ...f.business.subscription, status: 'active', currentPeriodEndsAt: endsAt } });
  let staging = false;
  const monitor = observe(f.db, target => {
    if ('path' in target && target.path.includes('/bookingLocks/')) staging = true;
    if (staging && 'path' in target && target.path.endsWith('/resourceSchedulePolicies/current')) vi.setSystemTime(endsAt);
  });
  await expect(confirmClientWaitlistOffer(f.actor, f.business.id, offer.id, contact, monitor.db)).rejects.toMatchObject({ status: 402 });
  expect(monitor.writes).toEqual([]); expect(await appointmentCount(f)).toBe(0); expect((await savedOffer(f, offer.id)).state).toBe('offered');
});
it.each(['cancel', 'withdraw', 'revoke', 'policy'] as const)('inFlightConfirmationRetriesAgainstCommittedWinner:%s', async winner => {
  const f = await waitlistOffersFixture(), offer = await seedPrepared(f), barrier = pauseFinalStagingRead(f.db);
  const pending = confirmClientWaitlistOffer(f.actor, f.business.id, offer.id, contact, barrier.db);
  await barrier.reached;
  try {
    if (winner === 'cancel') await cancelWaitlist(f.actor, f.business.id, { requestId: 'demo-barrier-cancel', expectedRevision: 1, entryId: offer.entryId }, f.db);
    if (winner === 'withdraw') await withdrawOwnerWaitlistOffer(f.owner, f.business.id, offer.id, f.db);
    if (winner === 'revoke') { const consent = await readConsent(f.actor.uid, 'account', undefined, f.db); await updateConsent(f.actor, { scope: 'account', action: 'revoke', requestId: 'demo-barrier-revoke', expectedRevision: consent.revision }, f.db); }
    if (winner === 'policy') await saveBookingDataPolicy(subjectAdmin, { businessId: f.business.id, expectedRevision: 1, dataMode: 'health', representedMinorsEnabled: false, reason: 'Synthetic racing policy' }, f.db);
  } finally { barrier.release(); }
  await expect(pending).rejects.toMatchObject({ code: winner === 'withdraw' ? 'OFFER_CLOSED' : winner === 'revoke' ? 'CONSENT_REQUIRED' : 'OFFER_CHANGED' });
  expect(await appointmentCount(f)).toBe(0); expect((await businessRef(f).get()).data()?.subscription.paidTrial.appointmentsUsed).toBe(1);
  expect((await savedOffer(f, offer.id)).state).toBe(winner === 'withdraw' ? 'withdrawn' : 'offered');
});
it.each(['same-slot', 'last-quota-distinct-resource'] as const)('twoOffersRaceForSharedCapacityAndQuota:%s', async mode => {
  const f = await waitlistOffersFixture(), first = await seedPrepared(f), secondRecordId = waitlistDocumentId(f.secondClient.uid, f.business.id);
  if (mode === 'last-quota-distinct-resource') await businessRef(f).collection('appointments').doc('block-two').delete();
  const second = await createOwnerWaitlistOffer(f.owner, f.business.id, secondRecordId, command(f, { entryId: f.second.request!.id, requestId: 'demo-racing-second-offer', selection: { resourceId: mode === 'same-slot' ? 'one' : 'two', startTimeStr: '09:00' } }), f.db);
  await prepareClientWaitlistOffer(f.secondClient, f.business.id, second.recovery.offer.id, { requestId: 'demo-racing-second-proposal' }, f.db);
  if (mode === 'last-quota-distinct-resource') await businessRef(f).set({ ...f.business, subscription: { ...f.business.subscription, paidTrial: { ...f.business.subscription.paidTrial!, appointmentsUsed: 9 } } });
  const outcomes = await Promise.allSettled([confirmClientWaitlistOffer(f.actor, f.business.id, first.id, contact, f.db), confirmClientWaitlistOffer(f.secondClient, f.business.id, second.recovery.offer.id, contact, f.db)]);
  expect(outcomes.filter(result => result.status === 'fulfilled')).toHaveLength(1); expect(outcomes.filter(result => result.status === 'rejected')).toHaveLength(1);
  expect(await appointmentCount(f)).toBe(1); expect((await businessRef(f).get()).data()?.subscription.paidTrial.appointmentsUsed).toBe(mode === 'same-slot' ? 2 : 10);
  const records = [(await waitlistRef(f).get()).data(), (await businessRef(f).collection('waitlistRequests').doc(secondRecordId).get()).data()];
  expect(records.filter(record => record?.request === null)).toHaveLength(1); expect(records.filter(record => record?.request !== null)).toHaveLength(1);
});
