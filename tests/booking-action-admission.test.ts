import { afterEach, expect, it, vi } from 'vitest';
import { memoryFirestore } from './memoryFirestore';
import { subjectAdmin, subjectFixture } from './represented-booking-contract';
import { readBookingSubjectConsent, updateBookingSubjectConsent } from '@/lib/server/booking-subject-consent';
import { createStructuredBookingProposal } from '@/lib/server/structured-booking';
afterEach(() => vi.unstubAllEnvs());
it('bounds new authorization writes while always allowing withdrawal and stable recovery', async () => {
  vi.stubEnv('SUPERADMIN_UID', subjectAdmin.uid); const { db, rows } = memoryFirestore(), f = await subjectFixture(db);
  const decision = async (index: number) => {
    const subjectCase = { ...f.subjectCase, bookingRequestId: `demo-rate-case-${index}` }, status = await readBookingSubjectConsent(f.actor, f.business.id, subjectCase, db);
    return updateBookingSubjectConsent(f.actor, { businessId: f.business.id, case: subjectCase, action: 'accept', requestId: `demo-rate-accept-${index}`, expectedRevision: status.revision, fingerprint: status.documents.fingerprint, decisions: { dataAuthorized: true, sensitiveDataAuthorized: true, representationDeclared: true } }, db);
  };
  for (let index = 0; index < 20; index++) await decision(index);
  await expect(decision(20)).rejects.toMatchObject({ status: 429, code: 'BOOKING_ACTION_RATE_LIMITED' });
  const subjectCase = { ...f.subjectCase, bookingRequestId: 'demo-rate-case-0' };
  const withdrawn = await updateBookingSubjectConsent(f.actor, { businessId: f.business.id, case: subjectCase, action: 'revoke', requestId: 'demo-rate-revoke', expectedRevision: 1 }, db); expect(withdrawn.active).toBe(false);
  const count = [...rows.keys()].filter(path => path.startsWith('serverSettings/subject_receipt_')).length;
  for (let index = 0; index < 30; index++) await updateBookingSubjectConsent(f.actor, { businessId: f.business.id, case: subjectCase, action: 'revoke', requestId: `demo-noop-${index}`, expectedRevision: 2 }, db);
  expect([...rows.keys()].filter(path => path.startsWith('serverSettings/subject_receipt_'))).toHaveLength(count);
});
it('bounds general self proposals without an additional consent scope', async () => {
  vi.stubEnv('SUPERADMIN_UID', subjectAdmin.uid); const { db } = memoryFirestore(), f = await subjectFixture(db, 'general', false);
  const proposal = (index: number) => createStructuredBookingProposal(f.actor, f.business.id, { case: { bookingRequestId: `demo-rate-proposal-${index}`, subjectKind: 'self' }, beneficiary: { kind: 'self' }, selection: f.selection }, db);
  const first = await proposal(0); for (let index = 1; index < 20; index++) await proposal(index);
  await expect(proposal(20)).rejects.toMatchObject({ status: 429 }); expect(await proposal(0)).toEqual(first);
});
