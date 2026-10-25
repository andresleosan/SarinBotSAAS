import { expect, it, vi } from 'vitest';
import type { Database, DocumentReference, Query, Transaction } from '@/lib/storage/types';
import { waitlistFixture } from './waitlist-contract';
import { acceptSyntheticConsent } from './consent-fixtures';
import { subjectAdmin } from './represented-booking-contract';
import { cancelWaitlist, joinWaitlist, waitlistDocumentId } from '@/lib/server/waitlist';
import { createOwnerWaitlistOffer, prepareClientWaitlistOffer, confirmClientWaitlistOffer, closeExpiredWaitlistOffer, declineClientWaitlistOffer, withdrawOwnerWaitlistOffer, readClientWaitlistOffer, readOwnerWaitlistOffer, parseCanonicalWaitlistOffer } from '@/lib/server/waitlist-offers';
import { createAppointment, createManualBlock, cancelAppointment } from '@/lib/server/bookings';
import { createAppointmentRescheduleProposal } from '@/lib/server/appointment-rescheduling';
import { confirmBookingProposal } from '@/lib/server/booking-proposals';
import { readConsent, updateConsent } from '@/lib/server/consent';
import { saveBookingDataPolicy } from '@/lib/server/booking-data-policy';
import { clientWaitlistOfferRecoverySchema, ownerWaitlistOfferRecoverySchema } from '@/lib/waitlist-offers';

export const raceContact = { clientPhone: '573001234567', intakeAnswers: { preference: 'SYNTHETIC_PRIVATE_ANSWER' } };
const nextDate = (offset: number) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
export async function raceFixture(db: Database, second: Database) {
  // Dynamic dates keep the Admin SDK and its gRPC deadline clock real.
  const f = await waitlistFixture(db, 'general', false, true, nextDate(2));
  const business = { ...f.business, services: f.business.services.map(s => ({ ...s, bufferMinutes: 15, price: 25000 })), sarinConfig: { ...f.business.sarinConfig, intakeFields: [{ key: 'preference', label: 'Preferencia demo', required: false }] }, subscription: { ...f.business.subscription, paidTrial: { ...f.business.subscription.paidTrial!, appointmentsUsed: 1 } } };
  const ref = db.collection('businesses').doc(business.id);
  await ref.set(business);
  await acceptSyntheticConsent(db, f.owner.uid, business);
  const other = { uid: `demo-offer-other-${crypto.randomUUID()}`, name: 'Otro cliente demo', email: 'other@example.test' };
  const actor = { ...f.actor, name: 'SYNTHETIC_PRIVATE_CLIENT', email: 'synthetic-private@example.test' };
  await acceptSyntheticConsent(db, other.uid, business);
  const first = await joinWaitlist(actor, business.id, f.input, db);
  const secondRequest = await joinWaitlist(other, business.id, { ...f.input, requestId: 'demo-other-join', case: { bookingRequestId: 'demo-other-case', subjectKind: 'self' } }, second);
  await ref.collection('appointments').doc('block-one').delete();
  const recordId = waitlistDocumentId(actor.uid, business.id), requestRef = ref.collection('waitlistRequests').doc(recordId);
  const created = await createOwnerWaitlistOffer(f.owner, business.id, recordId, { requestId: 'demo-race-offer', entryId: first.request!.id, expectedWaitlistRevision: first.revision, expectedHeadRevision: 0, selection: { resourceId: 'one', startTimeStr: '09:00' } }, db);
  const offerId = created.recovery.offer.id;
  await prepareClientWaitlistOffer(actor, business.id, offerId, { requestId: 'demo-race-proposal' }, db);
  const offerRef = ref.collection('waitlistOffers').doc(offerId);
  const offer = parseCanonicalWaitlistOffer(offerId, (await offerRef.get()).data(), business.id);
  return { ...f, actor, business, db, second, other, first, secondRequest, recordId, requestRef, ref, offerId, offerRef, offer, originalRequest: (await requestRef.get()).data() };
}
export type RaceFixture = Awaited<ReturnType<typeof raceFixture>>;
const quota = async (f: RaceFixture) => (await f.ref.get()).data()!.subscription.paidTrial.appointmentsUsed;
const appointments = async (f: RaceFixture) => (await f.ref.collection('appointments').where('type', '==', 'appointment').get()).docs.map(d => d.data());
const confirm = (f: RaceFixture, db = f.db) => confirmClientWaitlistOffer(f.actor, f.business.id, f.offerId, raceContact, db);

/** Observes actual adapter reads/writes; never replaces the appointment engine. */
export function observeRaceDb(db: Database, afterRead?: (path: string, staging: boolean) => Promise<void> | void, beforeFirstRead?: () => Promise<void>) {
  const writes: string[] = [], readPaths: string[] = [];
  const wrapped: Database = { collection: name => db.collection(name), runTransaction: (handler, options) => db.runTransaction(async tx => {
    let staging = false, first = true, wrote = false;
    const proxy: Transaction = {
      get: (async (ref: DocumentReference | Query) => {
        expect(wrote, 'actual transaction cannot read after applying writes').toBe(false);
        if (first) { first = false; await beforeFirstRead?.(); }
        const path = 'path' in ref ? ref.path : '<query>';
        if (path.includes('/bookingLocks/')) staging = true;
        const result = await tx.get(ref as DocumentReference);
        readPaths.push(path); await afterRead?.(path, staging);
        return result;
      }) as Transaction['get'],
      set: (ref, data, opts) => { wrote = true; writes.push(ref.path); return tx.set(ref, data, opts); },
      create: (ref, data) => { wrote = true; writes.push(ref.path); return tx.create(ref, data); },
      delete: ref => { wrote = true; writes.push(ref.path); return tx.delete(ref); },
    };
    return handler(proxy);
  }, options) };
  return { db: wrapped, writes, readPaths };
}

/** No SDK I/O runs under the synthetic domain clock; restore before get/write/commit. */
export function domainClock(db: Database, time: number, onlyAfterStaging = false) {
  let changed = false;
  const realNow = Date.now.bind(Date), spy = vi.spyOn(Date, 'now');
  const real = () => spy.mockImplementation(realNow);
  const instrumented = observeRaceDb(db, (path, staging) => {
    if (!onlyAfterStaging || staging && path.endsWith('/resourceSchedulePolicies/current')) {
      spy.mockReturnValue(time); changed = true;
    }
  });
  const wrapped: Database = { collection: name => db.collection(name), runTransaction: (handler, opts) => instrumented.db.runTransaction(async tx => {
    try {
      return await handler(new Proxy(tx, { get(target, key: keyof Transaction) {
        return (...args: unknown[]) => {
          real();
          return (target[key] as (...values: unknown[]) => unknown)(...args);
        };
      } }));
    } finally { real(); }
  }, opts) };
  return { db: wrapped, writes: instrumented.writes, changed: () => changed, restore: () => spy.mockRestore() };
}

function barrier(db: Database, backend: 'd1' | 'firestore') {
  let reached!: () => void, release!: () => void, paused = false;
  const ready = new Promise<void>(resolve => { reached = resolve; }), released = new Promise<void>(resolve => { release = resolve; });
  const pause = async () => { if (!paused) { paused = true; reached(); await released; } };
  const monitor = observeRaceDb(db, backend === 'd1' ? async (path, staging) => { if (staging && path.endsWith('/resourceSchedulePolicies/current')) await pause(); } : undefined, backend === 'firestore' ? pause : undefined);
  return { ...monitor, ready, release: () => release() };
}
async function reachedOrFailed(gate: Promise<void>, pending: Promise<unknown>) {
  await Promise.race([gate, pending.then(() => { throw new Error('Operation completed before reaching its real adapter barrier'); })]);
}

export async function verifyRecovery(f: RaceFixture, initial: Awaited<ReturnType<typeof confirm>>) {
  const proof = initial.proof;
  const startAt = Date.parse(`${f.input.dateKey}T14:00:00Z`);
  expect(proof).toMatchObject({ appointmentId: initial.appointment.id, entryId: f.first.request!.id, previousWaitlistRevision: 1, resolvedWaitlistRevision: 2,
    source: { dateKey: f.input.dateKey, startAt, endAt: startAt + 1800000, reservedUntilAt: startAt + 2700000, resourceId: 'one', serviceId: 'cut' } });
  const movedDate = nextDate(3);
  const proposal = await createAppointmentRescheduleProposal(f.actor, f.business.id, { appointmentId: initial.appointment.id, sourceRevision: 0, requestId: 'demo-race-s07', case: { bookingRequestId: 'demo-race-s07', subjectKind: 'self' }, selection: { dateKey: movedDate, resourceId: 'one', startTimeStr: '09:00' } }, f.second);
  const moved = await confirmBookingProposal(f.actor, f.business.id, proposal.id, { clientPhone: null, intakeAnswers: {}, beneficiary: { kind: 'self' } }, f.second);
  expect((await confirm(f)).proof).toEqual(proof);
  expect((await confirm(f)).appointment).toEqual(moved);
  const cancelled = await cancelAppointment(f.actor, f.business.id, initial.appointment.id, f.second);
  const replay = await confirmClientWaitlistOffer(f.actor, f.business.id, f.offerId, { clientPhone: null, intakeAnswers: null }, f.db);
  expect(replay).toEqual({ proof, appointment: cancelled, replayed: true });
  expect(replay.appointment.client).toMatchObject({ uid: f.actor.uid, name: 'SYNTHETIC_PRIVATE_CLIENT', email: 'synthetic-private@example.test', phone: '573001234567', intakeAnswers: { preference: 'SYNTHETIC_PRIVATE_ANSWER' } });
  expect(replay.appointment).not.toHaveProperty('ownerActorUid');
  expect((await f.requestRef.get()).data()).toMatchObject({ request: null, revision: 2 });
  expect(await quota(f)).toBe(2);
  const privateOffer = (await f.offerRef.get()).data();
  expect(JSON.stringify(privateOffer)).not.toMatch(/SYNTHETIC_PRIVATE|synthetic-private@example|573001234567|intakeAnswers|clientPhone/);
  for (const actor of [f.owner, f.other, subjectAdmin]) {
    await expect(readClientWaitlistOffer(actor, f.business.id, f.offerId, f.db)).rejects.toMatchObject({ status: 404 });
    await expect(confirmClientWaitlistOffer(actor, f.business.id, f.offerId, raceContact, f.second)).rejects.toMatchObject({ status: 404 });
  }
  const own = await readClientWaitlistOffer(f.actor, f.business.id, f.offerId, f.second), owner = await readOwnerWaitlistOffer(f.owner, f.business.id, f.offerId, f.db);
  expect(clientWaitlistOfferRecoverySchema.safeParse(own).success).toBe(true);
  expect(ownerWaitlistOfferRecoverySchema.safeParse(owner).success).toBe(true);
  expect(owner).not.toHaveProperty('appointment');
  expect(JSON.stringify(owner)).not.toMatch(/SYNTHETIC_PRIVATE|synthetic-private@example|573001234567|clientUid|ownerActorUid/);
}

export function registerWaitlistOfferRaces(backend: 'd1' | 'firestore', handles: () => { db: Database; second: Database }) {
  const fixture = () => { const h = handles(); return raceFixture(h.db, h.second); };
  it('same-offer concurrent confirmation resolves one entry, consumes one quota and preserves private recovery through S07/cancel', async () => {
    const f = await fixture();
    const results = await Promise.all([confirm(f), confirm(f, f.second)]);
    expect(results[0].proof).toEqual(results[1].proof);
    expect(results.map(r => r.replayed).sort()).toEqual([false, true]);
    expect(await appointments(f)).toHaveLength(1); expect(await quota(f)).toBe(2);
    await verifyRecovery(f, results[0]);
  }, 60000);

  it.each(['booking', 'manual', 's07'] as const)('committed %s wins against an in-flight offer without resolving its request', async competitor => {
    const f = await fixture();
    let compete: () => Promise<unknown>;
    if (competitor === 'booking') compete = () => createAppointment(f.other, f.business.id, { ...raceContact, dateKey: f.input.dateKey, resourceId: 'one', serviceId: 'cut', startTimeStr: '09:00' }, 'demo-direct-competitor', f.second);
    else if (competitor === 'manual') compete = () => createManualBlock(f.owner, f.business.id, { requestId: 'demo-manual-competitor', dateKey: f.input.dateKey, resourceId: 'one', startTimeStr: '09:00', endTimeStr: '09:30' }, f.second);
    else {
      const source = await createAppointment(f.other, f.business.id, { ...raceContact, dateKey: nextDate(3), resourceId: 'one', serviceId: 'cut', startTimeStr: '09:00' }, 'demo-s07-source', f.second);
      const proposal = await createAppointmentRescheduleProposal(f.other, f.business.id, { appointmentId: source.id, sourceRevision: 0, requestId: 'demo-s07-competing', selection: { dateKey: f.input.dateKey, resourceId: 'one', startTimeStr: '09:00' } }, f.second);
      compete = () => confirmBookingProposal(f.other, f.business.id, proposal.id, { clientPhone: null, intakeAnswers: {} }, f.second);
    }
    const beforeQuota = await quota(f), b = barrier(f.db, backend), pending = confirm(f, b.db);
    await reachedOrFailed(b.ready, pending);
    try { await compete(); } finally { b.release(); }
    await expect(pending).rejects.toMatchObject({ code: 'SLOT_UNAVAILABLE' });
    expect((await f.offerRef.get()).data()!.state).toBe('offered');
    expect((await f.requestRef.get()).data()).toEqual(f.originalRequest);
    expect(await quota(f)).toBe(beforeQuota + (competitor === 'booking' ? 1 : 0));
    const occupied = (await f.ref.collection('appointments').where('dateKey', '==', f.input.dateKey).where('resourceId', '==', 'one').where('status', '==', 'confirmed').get()).docs;
    expect(occupied).toHaveLength(1);
  }, 60000);

  it.each(['slot', 'last-quota'] as const)('two clients compete for one %s across independent handles', async mode => {
    const f = await fixture(), otherRecord = waitlistDocumentId(f.other.uid, f.business.id);
    if (mode === 'last-quota') await f.ref.collection('appointments').doc('block-two').delete();
    const offer = await createOwnerWaitlistOffer(f.owner, f.business.id, otherRecord, { requestId: 'demo-second-offer', entryId: f.secondRequest.request!.id, expectedWaitlistRevision: 1, expectedHeadRevision: 0, selection: { resourceId: mode === 'slot' ? 'one' : 'two', startTimeStr: '09:00' } }, f.second);
    await prepareClientWaitlistOffer(f.other, f.business.id, offer.recovery.offer.id, { requestId: 'demo-second-proposal' }, f.second);
    if (mode === 'last-quota') await f.ref.set({ ...f.business, subscription: { ...f.business.subscription, paidTrial: { ...f.business.subscription.paidTrial!, appointmentsUsed: 9 } } });
    const outcomes = await Promise.allSettled([confirm(f), confirmClientWaitlistOffer(f.other, f.business.id, offer.recovery.offer.id, raceContact, f.second)]);
    expect(outcomes.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    const loser = outcomes.find(r => r.status === 'rejected');
    expect(loser).toMatchObject({ reason: mode === 'slot' ? { code: 'SLOT_UNAVAILABLE' } : { status: 402 } });
    expect(await appointments(f)).toHaveLength(1); expect(await quota(f)).toBe(mode === 'slot' ? 2 : 10);
    const records = [(await f.requestRef.get()).data(), (await f.ref.collection('waitlistRequests').doc(otherRecord).get()).data()];
    expect(records.filter(r => r!.request === null)).toHaveLength(1);
    expect(records.filter(r => r!.request !== null)).toHaveLength(1);
    const losingIndex = outcomes.findIndex(r => r.status === 'rejected');
    expect(records[losingIndex]).toMatchObject({ revision: 1, request: { id: losingIndex === 0 ? f.first.request!.id : f.secondRequest.request!.id } });
    if (losingIndex === 0) expect(records[0]).toEqual(f.originalRequest);
    const offers = [(await f.offerRef.get()).data(), (await f.ref.collection('waitlistOffers').doc(offer.recovery.offer.id).get()).data()];
    expect(offers.map(r => r!.state).sort()).toEqual(['booked', 'offered']);
  }, 60000);

  it.each(['withdraw', 'decline', 'close-expired', 'cancel', 'rejoin', 'revoke', 'policy', 'schedule', 'catalog', 'owner'] as const)('committed %s prevents a previously started confirmation from applying', async mutation => {
    const f = await fixture(), b = barrier(f.db, backend), pending = confirm(f, b.db);
    await reachedOrFailed(b.ready, pending);
    let replacement: unknown;
    try {
      if (mutation === 'withdraw') await withdrawOwnerWaitlistOffer(f.owner, f.business.id, f.offerId, f.second);
      if (mutation === 'decline') await declineClientWaitlistOffer(f.actor, f.business.id, f.offerId, f.second);
      if (mutation === 'close-expired') {
        const clock = domainClock(f.second, f.offer.expiresAt);
        try { expect(await closeExpiredWaitlistOffer(f.actor, f.business.id, f.offerId, 'client', clock.db)).toMatchObject({ persistedState: 'expired' }); } finally { clock.restore(); }
      }
      if (mutation === 'cancel' || mutation === 'rejoin') {
        await cancelWaitlist(f.actor, f.business.id, { requestId: 'demo-race-cancel', expectedRevision: 1, entryId: f.offer.entryId }, f.second);
        if (mutation === 'rejoin') {
          await createManualBlock(f.owner, f.business.id, { requestId: 'demo-rejoin-block', dateKey: f.input.dateKey, resourceId: 'one', startTimeStr: '09:00', endTimeStr: '10:00' }, f.second);
          const rejoined = await joinWaitlist(f.actor, f.business.id, { ...f.input, expectedRevision: 2 }, f.second);
          expect(rejoined.request!.id).toBe(f.offer.entryId); expect(rejoined.revision).toBe(3);
          replacement = (await f.requestRef.get()).data();
        }
      }
      if (mutation === 'revoke') { const consent = await readConsent(f.actor.uid, 'account', undefined, f.second); await updateConsent(f.actor, { scope: 'account', action: 'revoke', requestId: 'demo-race-revoke', expectedRevision: consent.revision }, f.second); }
      if (mutation === 'policy') await saveBookingDataPolicy(subjectAdmin, { businessId: f.business.id, expectedRevision: 1, dataMode: 'general', representedMinorsEnabled: false, reason: 'Demo racing revision' }, f.second);
      if (mutation === 'schedule') await f.second.collection('businesses').doc(f.business.id).collection('resourceSchedulePolicies').doc('current').set({ version: 1, businessId: f.business.id, revision: 1, updatedAt: Date.now(), rules: { weekly: [], exceptions: [], closures: [] } });
      if (mutation === 'catalog') await f.second.collection('businesses').doc(f.business.id).set({ ...f.business, services: [{ ...f.business.services[0], price: 26000 }] });
      if (mutation === 'owner') await f.second.collection('businesses').doc(f.business.id).set({ ...f.business, ownerUid: 'demo-transferred-owner' });
    } finally { b.release(); }
    await expect(pending).rejects.toMatchObject({ code: ['withdraw', 'decline', 'close-expired'].includes(mutation) ? 'OFFER_CLOSED' : mutation === 'revoke' ? 'CONSENT_REQUIRED' : 'OFFER_CHANGED' });
    expect(await appointments(f)).toHaveLength(0); expect(await quota(f)).toBe(1);
    expect((await f.offerRef.get()).data()!.state).toBe(mutation === 'withdraw' ? 'withdrawn' : mutation === 'decline' ? 'declined' : mutation === 'close-expired' ? 'expired' : 'offered');
    if (replacement) expect((await f.requestRef.get()).data()).toEqual(replacement);
    else if (mutation === 'cancel') expect((await f.requestRef.get()).data()).toMatchObject({ request: null, revision: 2 });
    else expect((await f.requestRef.get()).data()).toEqual(f.originalRequest);
  }, 60000);

  it.each(['withdraw', 'decline', 'close-expired'] as const)('confirmation committed before paused %s returns booked proof without cancelling or spending quota', async closure => {
    const f = await fixture(), b = barrier(f.second, 'firestore');
    const clock = closure === 'close-expired' ? domainClock(b.db, f.offer.expiresAt) : null;
    const closingDb = clock?.db ?? b.db;
    const pending = closure === 'withdraw' ? withdrawOwnerWaitlistOffer(f.owner, f.business.id, f.offerId, closingDb)
      : closure === 'decline' ? declineClientWaitlistOffer(f.actor, f.business.id, f.offerId, closingDb)
      : closeExpiredWaitlistOffer(f.actor, f.business.id, f.offerId, 'client', closingDb);
    try {
      await reachedOrFailed(b.ready, pending);
      const booked = await confirm(f);
      b.release();
      const closed = await pending;
      expect(closed.proof).toEqual(booked.proof);
      expect('persistedState' in closed ? closed.persistedState : closed.offer.persistedState).toBe('booked');
      expect(b.writes).toEqual([]);
      expect((await f.offerRef.get()).data()!.state).toBe('booked');
      expect((await f.requestRef.get()).data()).toMatchObject({ revision: 2, request: null });
      expect(await quota(f)).toBe(2);
      expect((await appointments(f))[0].status).toBe('confirmed');
    } finally { b.release(); clock?.restore(); }
  }, 60000);

  it('exact expiry after the real helper final S09 read writes only expired offer, never appointment locks quota or request', async () => {
    const f = await fixture(), beforeBusiness = (await f.ref.get()).data(), locks = (await f.ref.collection('bookingLocks').get()).docs.map(d => d.data());
    const clock = domainClock(f.db, f.offer.expiresAt, true);
    try {
      await expect(confirm(f, clock.db)).rejects.toMatchObject({ code: 'OFFER_CLOSED' });
      expect(clock.changed()).toBe(true); expect(clock.writes).toEqual([f.offerRef.path]);
    } finally { clock.restore(); }
    expect((await f.offerRef.get()).data()).toMatchObject({ state: 'expired', closedAt: f.offer.expiresAt });
    expect(await appointments(f)).toHaveLength(0); expect((await f.ref.get()).data()).toEqual(beforeBusiness);
    expect((await f.ref.collection('bookingLocks').get()).docs.map(d => d.data())).toEqual(locks);
    expect((await f.requestRef.get()).data()).toEqual(f.originalRequest);
  }, 60000);

  it('expired_pending_close GET is read-only and cannot prove a pending confirmation failed', async () => {
    const f = await fixture(), before = (await f.offerRef.get()).data(), clock = domainClock(f.db, f.offer.expiresAt);
    try {
      const recovery = await readClientWaitlistOffer(f.actor, f.business.id, f.offerId, clock.db);
      expect(recovery).toMatchObject({ usability: 'expired_pending_close', offer: { persistedState: 'offered' }, proof: null });
      expect(clock.writes).toEqual([]);
    } finally { clock.restore(); }
    expect((await f.offerRef.get()).data()).toEqual(before);
    expect((await f.requestRef.get()).data()).toEqual(f.originalRequest);
  }, 60000);
}
