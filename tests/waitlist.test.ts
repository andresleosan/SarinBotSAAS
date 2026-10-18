import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { waitlistFixture, waitlistNow } from './waitlist-contract';
import { subjectAdmin } from './represented-booking-contract';
import { readConsent, updateConsent, consentStateKey } from '@/lib/server/consent';
import { acceptSyntheticConsent, acceptSyntheticSubjectConsent } from './consent-fixtures';
import { bookingSubjectStateKey, readBookingSubjectConsent, updateBookingSubjectConsent } from '@/lib/server/booking-subject-consent';
import { saveBookingDataPolicy } from '@/lib/server/booking-data-policy';
import { updateClientPolicy } from '@/lib/server/client-policy';
import { memoryFirestore } from './memoryFirestore';

async function backend() {
  const path = '../src/lib/server/waitlist.ts';
  const module = await import(path).catch(() => null);
  expect(module, 'The approved waitlist backend is not implemented').not.toBeNull();
  return module as typeof import('@/lib/server/waitlist');
}
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(waitlistNow); vi.stubEnv('SUPERADMIN_UID', subjectAdmin.uid); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

it('starts empty without writing and keeps a single private selection without booking data', async () => {
  const m = await backend(), memory = memoryFirestore(), f = await waitlistFixture(memory.db), before = structuredClone([...memory.rows]);
  expect(await m.readWaitlist(f.actor, f.business.id, f.db)).toEqual({ businessId: f.business.id, ownerUid: f.actor.uid, revision: 0, serverNow: waitlistNow, request: null });
  expect([...memory.rows]).toEqual(before);
  const result = await m.joinWaitlist(f.actor, f.business.id, f.input, f.db);
  expect(result).toMatchObject({ revision: 1, request: { serviceId: 'cut', dateKey: '2030-01-07', resourceId: null, subjectKind: 'self', status: 'waiting', expiresAt: Date.parse('2030-01-08T05:00:00Z'), checkedAt: waitlistNow } });
  expect(Object.keys(result.request!).sort()).toEqual(['id', 'serviceId', 'dateKey', 'resourceId', 'subjectKind', 'createdAt', 'expiresAt', 'status', 'checkedAt'].sort());
  expect(JSON.stringify(result)).not.toMatch(/anchors|receipt|bookingRequestId|phone|beneficiary|intake/);
  const after = structuredClone([...memory.rows]); await m.readWaitlist(f.actor, f.business.id, f.db); expect([...memory.rows]).toEqual(after);
  expect((await f.db.collection('bookingProposals').get()).empty).toBe(true);
  expect((await f.db.collection('businesses').doc(f.business.id).collection('appointments').get()).size).toBe(2);
  expect((await f.db.collection('businesses').doc(f.business.id).get()).data()?.subscription.paidTrial.appointmentsUsed).toBe(0);
});

it('rejects a join when a current slot exists and derives available after a cancellation', async () => {
  const m = await backend(), f = await waitlistFixture();
  await f.db.collection('businesses').doc(f.business.id).collection('appointments').doc('block-two').delete();
  await expect(m.joinWaitlist(f.actor, f.business.id, f.input, f.db)).rejects.toMatchObject({ status: 409, code: 'WAITLIST_SLOTS_AVAILABLE' });
  const joined = await m.joinWaitlist(f.actor, f.business.id, { ...f.input, resourceId: 'one' }, f.db);
  expect(joined.request?.status).toBe('waiting');
  await f.db.collection('businesses').doc(f.business.id).collection('appointments').doc('block-one').delete();
  expect((await m.readWaitlist(f.actor, f.business.id, f.db)).request?.status).toBe('available');
});

it('keeps exact retries read-only and prevents old joins and cancellations from replacing newer intent', async () => {
  const m = await backend(), memory = memoryFirestore(), f = await waitlistFixture(memory.db);
  const joined = await m.joinWaitlist(f.actor, f.business.id, f.input, f.db), before = structuredClone([...memory.rows]);
  expect(await m.joinWaitlist(f.actor, f.business.id, f.input, f.db)).toEqual(joined); expect([...memory.rows]).toEqual(before);
  await expect(m.joinWaitlist(f.actor, f.business.id, { ...f.input, serviceId: 'other' }, f.db)).rejects.toMatchObject({ status: 409 });
  await expect(m.joinWaitlist(f.actor, f.business.id, { ...f.input, requestId: 'another-waitlist', expectedRevision: 1 }, f.db)).rejects.toMatchObject({ code: 'WAITLIST_REQUEST_EXISTS' });
  const cancel = { entryId: joined.request!.id, requestId: 'waitlist-cancel-first', expectedRevision: 1 };
  expect((await m.cancelWaitlist(f.actor, f.business.id, cancel, f.db))).toMatchObject({ revision: 2, request: null });
  const cancelled = structuredClone([...memory.rows]); await m.cancelWaitlist(f.actor, f.business.id, cancel, f.db); expect([...memory.rows]).toEqual(cancelled);
  await expect(m.joinWaitlist(f.actor, f.business.id, f.input, f.db)).rejects.toMatchObject({ code: 'WAITLIST_CHANGED' });
  const next = await m.joinWaitlist(f.actor, f.business.id, { ...f.input, requestId: 'waitlist-next-entry', expectedRevision: 2 }, f.db);
  expect(next).toMatchObject({ revision: 3, request: { status: 'waiting' } });
  await expect(m.cancelWaitlist(f.actor, f.business.id, { ...cancel, requestId: 'waitlist-cancel-stale', expectedRevision: 3 }, f.db)).rejects.toMatchObject({ code: 'WAITLIST_CHANGED' });
});

it('expires exactly at Colombian midnight without a write and replaces expired selection only on explicit join', async () => {
  const m = await backend(), memory = memoryFirestore(), f = await waitlistFixture(memory.db);
  const joined = await m.joinWaitlist(f.actor, f.business.id, f.input, f.db), before = structuredClone([...memory.rows]);
  vi.setSystemTime(Date.parse('2030-01-08T05:00:00Z'));
  expect((await m.readWaitlist(f.actor, f.business.id, f.db)).request).toMatchObject({ status: 'expired', checkedAt: null }); expect([...memory.rows]).toEqual(before);
  await f.db.collection('businesses').doc(f.business.id).set({ ...f.business, weeklySchedule: Object.fromEntries(Array.from({ length: 7 }, (_, day) => [day, { isOpen: false, intervals: [] }])) });
  const next = await m.joinWaitlist(f.actor, f.business.id, { ...f.input, requestId: 'waitlist-after-expiry', expectedRevision: 1, dateKey: '2030-01-08' }, f.db);
  expect(next).toMatchObject({ revision: 2, request: { dateKey: '2030-01-08', status: 'waiting' } }); expect(next.request?.id).not.toBe(joined.request?.id);
});

it.each(['2029-12-31', '2030-02-30', '2031-01-08'])('rejects invalid/past/out-of-horizon date %s before persistence', async dateKey => {
  const m = await backend(), f = await waitlistFixture();
  await expect(m.joinWaitlist(f.actor, f.business.id, { ...f.input, dateKey }, f.db)).rejects.toBeDefined();
  expect((await m.readWaitlist(f.actor, f.business.id, f.db)).request).toBeNull();
});

it.each(['account', 'business_client'] as const)('suspends revoked/reaccepted %s permissions instead of silently opting back in', async scope => {
  const m = await backend(), f = await waitlistFixture(); await m.joinWaitlist(f.actor, f.business.id, f.input, f.db);
  const current = await readConsent(f.actor.uid, scope, scope === 'account' ? undefined : f.business, f.db);
  await updateConsent(f.actor, { scope, ...(scope === 'account' ? {} : { businessId: f.business.id }), action: 'revoke', requestId: 'waitlist-revoke-permit', expectedRevision: current.revision }, f.db);
  await acceptSyntheticConsent(f.db, f.actor.uid, f.business);
  expect((await m.readWaitlist(f.actor, f.business.id, f.db)).request).toMatchObject({ status: 'suspended', reason: 'consent_changed', checkedAt: null });
});

it.each([['general', true], ['health', false], ['health', true]] as const)('requires and preserves %s represented=%s case consent', async (mode, represented) => {
  const m = await backend(), f = await waitlistFixture(undefined, mode, represented, false);
  await expect(m.joinWaitlist(f.actor, f.business.id, f.input, f.db)).rejects.toMatchObject({ status: 428 });
  await acceptSyntheticSubjectConsent(f.db, f.actor, f.business, f.subjectCase, f.policy);
  const joined = await m.joinWaitlist(f.actor, f.business.id, f.input, f.db);
  expect(joined.request?.subjectKind).toBe(represented ? 'represented_minor' : 'self');
  const current = await readBookingSubjectConsent(f.actor, f.business.id, f.subjectCase, f.db);
  await updateBookingSubjectConsent(f.actor, { businessId: f.business.id, case: f.subjectCase, action: 'revoke', requestId: 'waitlist-revoke-subject', expectedRevision: current.revision }, f.db);
  await acceptSyntheticSubjectConsent(f.db, f.actor, f.business, f.subjectCase, f.policy);
  expect((await m.readWaitlist(f.actor, f.business.id, f.db)).request).toMatchObject({ status: 'suspended', reason: 'consent_changed' });
});

it('suspends a changed classification and never uses old case data to grant a new capability', async () => {
  const m = await backend(), f = await waitlistFixture(); await m.joinWaitlist(f.actor, f.business.id, f.input, f.db);
  await saveBookingDataPolicy(subjectAdmin, { businessId: f.business.id, expectedRevision: 1, dataMode: 'health', representedMinorsEnabled: false, reason: 'Synthetic classification change' }, f.db);
  expect((await m.readWaitlist(f.actor, f.business.id, f.db)).request).toMatchObject({ status: 'suspended', reason: 'booking_policy_changed' });
});

it('allows withdrawal with missing business and revoked permissions without retaining selection or case', async () => {
  const m = await backend(), f = await waitlistFixture(), joined = await m.joinWaitlist(f.actor, f.business.id, f.input, f.db);
  await f.db.collection('businesses').doc(f.business.id).delete();
  expect((await m.readWaitlist(f.actor, f.business.id, f.db)).request).toMatchObject({ status: 'suspended', reason: 'business_unavailable' });
  const current = await readConsent(f.actor.uid, 'account', undefined, f.db);
  await updateConsent(f.actor, { scope: 'account', action: 'revoke', requestId: 'waitlist-withdraw-account', expectedRevision: current.revision }, f.db);
  expect(await m.cancelWaitlist(f.actor, f.business.id, { expectedRevision: 1, requestId: 'waitlist-leave-missing', entryId: joined.request!.id }, f.db)).toMatchObject({ revision: 2, request: null });
  const saved = (await f.db.collection('businesses').doc(f.business.id).collection('waitlistRequests').get()).docs[0].data();
  expect(saved.request).toBeNull(); expect(JSON.stringify(saved)).not.toMatch(/serviceId|bookingRequestId|subjectKind|dateKey/);
});

it('isolates accounts, rejects forged stored ownership, and does not treat corrupt consent evidence as suspension', async () => {
  const m = await backend(), f = await waitlistFixture(undefined, 'health');
  const joined = await m.joinWaitlist(f.actor, f.business.id, f.input, f.db);
  expect((await m.readWaitlist({ uid: 'demo-foreign' }, f.business.id, f.db)).request).toBeNull();
  await expect(m.cancelWaitlist({ uid: 'demo-foreign' }, f.business.id, { expectedRevision: 1, requestId: 'waitlist-foreign-cancel', entryId: joined.request!.id }, f.db)).rejects.toMatchObject({ status: 409 });
  const subject = f.db.collection('serverSettings').doc(bookingSubjectStateKey(f.actor.uid, f.business.id, f.subjectCase.bookingRequestId));
  await subject.set({ ...(await subject.get()).data(), revision: 'corrupt' });
  await expect(m.readWaitlist(f.actor, f.business.id, f.db)).rejects.toMatchObject({ status: 503 });
  const ref = f.db.collection('businesses').doc(f.business.id).collection('waitlistRequests').doc(m.waitlistDocumentId(f.actor.uid, f.business.id));
  await ref.set({ ...(await ref.get()).data(), ownerUid: 'demo-foreign' });
  await expect(m.cancelWaitlist(f.actor, f.business.id, { expectedRevision: 1, requestId: 'waitlist-cancel-corrupt', entryId: joined.request!.id }, f.db)).rejects.toMatchObject({ status: 503 });
});

it('surfaces corruption even when another permission is already inactive', async () => {
  const m = await backend(), f = await waitlistFixture(); await m.joinWaitlist(f.actor, f.business.id, f.input, f.db);
  const account = await readConsent(f.actor.uid, 'account', undefined, f.db);
  await updateConsent(f.actor, { scope: 'account', action: 'revoke', requestId: 'waitlist-inactive-account', expectedRevision: account.revision }, f.db);
  const businessState = f.db.collection('serverSettings').doc(consentStateKey(f.actor.uid, 'business_client', f.business.id));
  const state = (await businessState.get()).data()!; await f.db.collection('serverSettings').doc(state.receiptId).set({ corrupted: true });
  await expect(m.readWaitlist(f.actor, f.business.id, f.db)).rejects.toMatchObject({ status: 503 });
});

it('checks current client restrictions and still permits leaving the list', async () => {
  const m = await backend(), f = await waitlistFixture(), joined = await m.joinWaitlist(f.actor, f.business.id, f.input, f.db);
  await acceptSyntheticConsent(f.db, f.owner.uid, f.business);
  await updateClientPolicy(f.owner, f.business.id, { clientUid: f.actor.uid, blocked: true, reason: 'Synthetic block' }, f.db);
  expect((await m.readWaitlist(f.actor, f.business.id, f.db)).request).toMatchObject({ status: 'suspended', reason: 'client_blocked' });
  expect((await m.cancelWaitlist(f.actor, f.business.id, { expectedRevision: 1, requestId: 'waitlist-blocked-leave', entryId: joined.request!.id }, f.db)).request).toBeNull();
});

it('serializes two concurrent joins into one current request', async () => {
  const m = await backend(), f = await waitlistFixture();
  const outcomes = await Promise.allSettled([m.joinWaitlist(f.actor, f.business.id, f.input, f.db), m.joinWaitlist(f.actor, f.business.id, { ...f.input, requestId: 'waitlist-racing-join' }, f.db)]);
  expect(outcomes.filter(item => item.status === 'fulfilled')).toHaveLength(1);
  expect((await m.readWaitlist(f.actor, f.business.id, f.db)).revision).toBe(1);
});

it('fails closed when a required saved subject anchor was removed', async () => {
  const m = await backend(), f = await waitlistFixture(undefined, 'health'); await m.joinWaitlist(f.actor, f.business.id, f.input, f.db);
  const ref = f.db.collection('businesses').doc(f.business.id).collection('waitlistRequests').doc(m.waitlistDocumentId(f.actor.uid, f.business.id)), saved = (await ref.get()).data()!;
  await ref.set({ ...saved, request: { ...saved.request, anchors: { ...saved.request.anchors, subject: null } } });
  await expect(m.readWaitlist(f.actor, f.business.id, f.db)).rejects.toMatchObject({ status: 503 });
});

it('does not classify a mismatched persisted case as a normal suspension or caller conflict', async () => {
  const m = await backend(), f = await waitlistFixture(undefined, 'health', true); await m.joinWaitlist(f.actor, f.business.id, f.input, f.db);
  const ref = f.db.collection('serverSettings').doc(bookingSubjectStateKey(f.actor.uid, f.business.id, f.subjectCase.bookingRequestId)), saved = (await ref.get()).data()!;
  await ref.set({ ...saved, case: { ...saved.case, representativeRole: 'legal_guardian' } });
  await expect(m.readWaitlist(f.actor, f.business.id, f.db)).rejects.toMatchObject({ status: 503 });
});

// Additional boundary characterization of the implemented shared booking gates.
it.each(['subscription', 'service', 'resource', 'client_limit'] as const)('suspends current %s changes without deleting the selection', async change => {
  const m = await backend(), f = await waitlistFixture(), joined = await m.joinWaitlist(f.actor, f.business.id, f.input, f.db);
  if (change === 'subscription') await f.db.collection('businesses').doc(f.business.id).set({ ...f.business, subscription: { ...f.business.subscription, status: 'suspended' } });
  else if (change === 'service') await f.db.collection('businesses').doc(f.business.id).set({ ...f.business, services: [] });
  else if (change === 'resource') await f.db.collection('businesses').doc(f.business.id).set({ ...f.business, resources: f.business.resources.map(resource => ({ ...resource, active: false })) });
  else for (let i = 0; i < 3; i++) await f.db.collection('businesses').doc(f.business.id).collection('appointments').doc(`client-limit-${i}`).set({ client: { uid: f.actor.uid }, type: 'appointment', status: 'confirmed', startAt: waitlistNow + 1000 });
  expect((await m.readWaitlist(f.actor, f.business.id, f.db)).request).toMatchObject({ id: joined.request!.id, status: 'suspended', reason: change === 'subscription' ? 'business_unavailable' : change === 'client_limit' ? 'client_limit' : 'service_unavailable', checkedAt: null });
});

it('limits repeated joins while reads, exact retries and leaving remain available', async () => {
  const m = await backend(), f = await waitlistFixture();
  for (let index = 0; index < 20; index++) {
    const input = { ...f.input, requestId: `waitlist-admit-${index}`, expectedRevision: index * 2 };
    const joined = await m.joinWaitlist(f.actor, f.business.id, input, f.db);
    await m.joinWaitlist(f.actor, f.business.id, input, f.db);
    await m.readWaitlist(f.actor, f.business.id, f.db);
    await m.cancelWaitlist(f.actor, f.business.id, { requestId: `waitlist-leave-${index}`, expectedRevision: index * 2 + 1, entryId: joined.request!.id }, f.db);
  }
  await expect(m.joinWaitlist(f.actor, f.business.id, { ...f.input, requestId: 'waitlist-too-many', expectedRevision: 40 }, f.db)).rejects.toMatchObject({ status: 429, code: 'BOOKING_ACTION_RATE_LIMITED' });
  expect(await m.readWaitlist(f.actor, f.business.id, f.db)).toMatchObject({ revision: 40, request: null });
});

it('counts every new join revision even when a caller reuses the same operation requestId', async () => {
  const m = await backend(), f = await waitlistFixture();
  for (let index = 0; index < 20; index++) {
    const joined = await m.joinWaitlist(f.actor, f.business.id, { ...f.input, requestId: 'waitlist-reused-join', expectedRevision: index * 2 }, f.db);
    await m.cancelWaitlist(f.actor, f.business.id, { requestId: `waitlist-reused-leave-${index}`, expectedRevision: index * 2 + 1, entryId: joined.request!.id }, f.db);
  }
  await expect(m.joinWaitlist(f.actor, f.business.id, { ...f.input, requestId: 'waitlist-reused-join', expectedRevision: 40 }, f.db)).rejects.toMatchObject({ status: 429, code: 'BOOKING_ACTION_RATE_LIMITED' });
  expect((await m.readWaitlist(f.actor, f.business.id, f.db)).revision).toBe(40);
});
