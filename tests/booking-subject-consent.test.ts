import { afterEach, expect, it, vi } from 'vitest';
import { readBookingSubjectConsent, updateBookingSubjectConsent, assertBookingSubjectConsent, bookingSubjectStateKey } from '@/lib/server/booking-subject-consent';
import { saveBookingDataPolicy } from '@/lib/server/booking-data-policy';
import { privateBusinessDraft } from '@/lib/server/businesses';
import type { BookingSubjectCase } from '@/lib/booking-subject';
import { consentedFirestore } from './consent-fixtures';
const actor = { uid: 'demo-client' }, business = { ...privateBusinessDraft({ uid: 'demo-owner' }, 0), id: 'demo-subject', name: 'Demo', phoneWhatsApp: '573001234567' };
const self: BookingSubjectCase = { bookingRequestId: 'demo-case-self', subjectKind: 'self' };
const minor: BookingSubjectCase = { bookingRequestId: 'demo-case-minor', subjectKind: 'represented_minor', representativeRole: 'parent' };
const yes = { dataAuthorized: true, sensitiveDataAuthorized: true, representationDeclared: true };
async function setup(dataMode: 'general' | 'health', representedMinorsEnabled = true) {
  vi.stubEnv('SUPERADMIN_UID', 'demo-admin'); const result = consentedFirestore({ [`businesses/${business.id}`]: business }, [actor.uid, 'demo-other']);
  await saveBookingDataPolicy({ uid: 'demo-admin' }, { businessId: business.id, expectedRevision: 0, dataMode, representedMinorsEnabled, reason: 'Demo' }, result.db); return result;
}
async function accept(db: ReturnType<typeof consentedFirestore>['db'], subjectCase = minor, decisions = yes, requestId = 'demo-accept-1') {
  const current = await readBookingSubjectConsent(actor, business.id, subjectCase, db);
  return updateBookingSubjectConsent(actor, { businessId: business.id, case: subjectCase, action: 'accept', requestId, expectedRevision: current.revision, fingerprint: current.documents.fingerprint, decisions }, db);
}
afterEach(() => vi.unstubAllEnvs());
it('requires explicit sensitive choice for adult health and no extra receipt for general self', async () => {
  const { db } = await setup('health');
  await expect(db.runTransaction(tx => assertBookingSubjectConsent(tx, actor, business, self, db))).rejects.toMatchObject({ status: 428 });
  await expect(accept(db, self, { ...yes, sensitiveDataAuthorized: false })).rejects.toMatchObject({ status: 428 });
  expect(await accept(db, self)).toMatchObject({ required: true, active: true, revision: 1 });
  const general = await setup('general', false);
  expect(await general.db.runTransaction(tx => assertBookingSubjectConsent(tx, actor, business, self, general.db))).toBeNull();
  expect((await readBookingSubjectConsent(actor, business.id, self, general.db)).required).toBe(false);
  expect([...general.rows.keys()].filter(path => /subject_(receipt|state)/.test(path))).toHaveLength(0);
});
it('requires representation and child-data authorization and both for pediatrics', async () => {
  for (const mode of ['general', 'health'] as const) {
    const { db } = await setup(mode);
    for (const key of ['dataAuthorized', 'representationDeclared', ...(mode === 'health' ? ['sensitiveDataAuthorized'] : [])]) await expect(accept(db, minor, { ...yes, [key]: false })).rejects.toMatchObject({ status: 428 });
    const accepted = await accept(db); expect(accepted.active).toBe(true);
    expect(JSON.stringify(accepted.receipt)).not.toMatch(/displayName|SYNTHETIC_PRIVATE_SUBJECT|intake|ipAddress|messages/);
  }
});
it('cannot replay acceptance over withdrawal or reuse a decision with different input', async () => {
  const { db } = await setup('health'); const accepted = await accept(db);
  await updateBookingSubjectConsent(actor, { businessId: business.id, case: minor, action: 'revoke', expectedRevision: 1, requestId: 'demo-revoke-1' }, db);
  const replay = await updateBookingSubjectConsent(actor, { businessId: business.id, case: minor, action: 'accept', requestId: 'demo-accept-1', expectedRevision: 0, fingerprint: accepted.documents.fingerprint, decisions: yes }, db);
  expect(replay).toMatchObject({ active: false, revision: 2 });
  await expect(db.runTransaction(tx => assertBookingSubjectConsent(tx, actor, business, minor, db))).rejects.toMatchObject({ status: 428 });
  await expect(updateBookingSubjectConsent(actor, { businessId: business.id, case: minor, action: 'revoke', expectedRevision: 0, requestId: 'demo-accept-1' }, db)).rejects.toMatchObject({ status: 409 });
});
it('cannot cross uid business case or representative role', async () => {
  const { db } = await setup('health'); await accept(db);
  for (const [who, target, subjectCase] of [[{ uid: 'demo-other' }, business, minor], [actor, business, { ...minor, bookingRequestId: 'demo-another-case' }]] as const) await expect(db.runTransaction(tx => assertBookingSubjectConsent(tx, who, target, subjectCase, db))).rejects.toMatchObject({ status: 428 });
  await expect(readBookingSubjectConsent(actor, business.id, { ...minor, representativeRole: 'legal_guardian' }, db)).rejects.toMatchObject({ status: 409 });
  await expect(readBookingSubjectConsent(actor, 'demo-other-business', minor, db)).rejects.toMatchObject({ status: 404 });
  await expect(readBookingSubjectConsent(actor, business.id, { ...self, representativeRole: 'parent' } as never, db)).rejects.toBeDefined();
  await expect(readBookingSubjectConsent(actor, business.id, { bookingRequestId: 'demo-no-role', subjectKind: 'represented_minor' } as never, db)).rejects.toBeDefined();
});
it('canonical receipt survives map key sorting and corrupt content fails closed', async () => {
  const { db } = await setup('health'); await accept(db);
  const state = (await db.collection('serverSettings').doc(bookingSubjectStateKey(actor.uid, business.id, minor.bookingRequestId)).get()).data()!;
  const ref = db.collection('serverSettings').doc(state.receiptId), receipt = (await ref.get()).data()!;
  const reorder = (value: any): any => Array.isArray(value) ? value.map(reorder) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().reverse().map(key => [key, reorder(value[key])])) : value;
  await ref.set(reorder(receipt)); expect((await readBookingSubjectConsent(actor, business.id, minor, db)).active).toBe(true);
  await ref.set({ ...receipt, decisions: { ...yes, dataAuthorized: false } });
  await expect(readBookingSubjectConsent(actor, business.id, minor, db)).rejects.toMatchObject({ status: 503 });
});
