import { expect, it } from 'vitest';
import { ownerWaitlistQuerySchema, ownerWaitlistReviewCommandSchema, ownerWaitlistPageSchema, ownerWaitlistDetailSchema, projectOwnerWaitlistRow, compareOwnerWaitlistRows, readOwnerWaitlistReview, parseOwnerWaitlistDate } from '@/lib/owner-waitlist';
const now = Date.parse('2030-01-06T14:00:00Z');
const business = { id: 'biz', services: [{ id: 'cut', name: 'Corte' }], resources: [{ id: 'one', name: 'Uno' }] };
const source = { revision: 2, ownerUid: 'private-client', request: { id: 'entry', serviceId: 'cut', resourceId: null, dateKey: '2030-01-07', createdAt: now, expiresAt: Date.parse('2030-01-08T05:00:00Z'), case: { subjectKind: 'represented_minor' as const, minorName: 'PRIVATE', representativeRole: 'parent' }, anchors: { secret: 'PRIVATE' } } };
const row = () => projectOwnerWaitlistRow('record', source, business, { revision: 0, reviewed: false, updatedAt: null }, now);
const page = () => ({ businessId: 'biz', ownerUid: 'actual-owner', dateKey: '2030-01-07', serverNow: now, rows: [row()], nextCursor: null, coverage: 'current_indexed_requests' });
it('strictDatesCursorAnd2048ReviewShape', () => {
  expect(ownerWaitlistQuerySchema.safeParse({ dateKey: '2030-02-30' }).success).toBe(false);
  expect(ownerWaitlistQuerySchema.safeParse({ dateKey: '2030-01-07', cursor: { recordId: 'record', entryId: 'entry', createdAt: now }, uid: 'private' }).success).toBe(false);
  expect(ownerWaitlistReviewCommandSchema.safeParse({ requestId: 'review-001', entryId: 'entry', expectedWaitlistRevision: 2, expectedReviewRevision: 0, reviewed: true }).success).toBe(true);
  expect(ownerWaitlistReviewCommandSchema.safeParse({ requestId: 'review-001', entryId: 'entry', expectedWaitlistRevision: 2, expectedReviewRevision: 0, reviewed: true, actorUid: 'owner' }).success).toBe(false);
  expect(parseOwnerWaitlistDate('1900-01-01', now)).toBe('1900-01-01');
  expect(()=>parseOwnerWaitlistDate('2031-01-08',now)).toThrow();
});
it.each(['entry\n', 'record\r', 'bad\u0000', '__proto__'])('controlCharactersIncludingFinalNewlineReject %s', id => {
  expect(ownerWaitlistQuerySchema.safeParse({ dateKey: '2030-01-07', cursor: { recordId: id, entryId: 'entry', createdAt: now } }).success).toBe(false);
  expect(ownerWaitlistReviewCommandSchema.safeParse({ requestId: 'review-001\n', entryId: 'entry', expectedWaitlistRevision: 2, expectedReviewRevision: 0, reviewed: true }).success).toBe(false);
});
it('opaqueRecordIdIsNotClientUidAndProjectionOmitsUidContactCaseRoleAnchorsAndMinorName', () => {
  expect(row()).toMatchObject({ recordId: 'record', entryId: 'entry', subjectKind: 'represented_minor', resourceLabel: 'Cualquiera elegible', lifecycle: 'unchecked' });
  expect(JSON.stringify(row())).not.toMatch(/PRIVATE|ownerUid|anchors|representativeRole|minorName/);
  expect(projectOwnerWaitlistRow('record', { ...source, request: { ...source.request, serviceId: 'retired', resourceId: 'retired' } }, business, { revision: 0, reviewed: false, updatedAt: null }, now)).toMatchObject({ serviceLabel: 'Servicio anterior', resourceLabel: 'Recurso anterior' });
  expect(row().serviceLabel.length).toBeLessThanOrEqual(120);
});
it('fifoUsesCreatedAtThenOrdinalEntryId', () => {
  const a = { ...row(), entryId: 'A' }, b = { ...row(), entryId: 'a' }, later = { ...row(), createdAt: now + 1 };
  expect(compareOwnerWaitlistRows(a,b)).toBeLessThan(0); expect(compareOwnerWaitlistRows(b,later)).toBeLessThan(0);
  expect(ownerWaitlistPageSchema.safeParse({ ...page(), rows: [b,a] }).success).toBe(false);
  expect(ownerWaitlistPageSchema.safeParse({ ...page(), nextCursor: { recordId: 'other', entryId: 'entry', createdAt: now } }).success).toBe(false);
});
it('listLifecycleNeverClaimsLiveAvailabilityAndNullRequestIsNotActiveHistory', () => {
  expect(ownerWaitlistPageSchema.safeParse({ ...page(), rows: [{ ...row(), lifecycle: 'available' }] }).success).toBe(false);
  expect(()=>projectOwnerWaitlistRow('record', { ...source, request: null }, business, { revision: 0, reviewed: false, updatedAt: null }, now)).toThrow();
  expect(projectOwnerWaitlistRow('record', source, business, { revision: 0, reviewed: false, updatedAt: null }, source.request.expiresAt).lifecycle).toBe('expired');
});
it('reviewDefaultOnlyOnRealAbsence', () => {
  const scope = { businessId: 'biz', recordId: 'record', entryId: 'entry', waitlistRevision: 1 };
  expect(readOwnerWaitlistReview(undefined,scope)).toEqual({ revision: 0, reviewed: false, updatedAt: null });
  for (const value of [null, {}, { revision: 0, reviewed: false, updatedAt: null }]) expect(()=>readOwnerWaitlistReview(value,scope)).toThrow();
  const marker = { version: 1, businessId: 'biz', waitlistRecordId: 'record', entryId: 'entry', revision: 1, reviewed: true, updatedAt: now, actorUid: 'owner', lastOperation: { requestId: 'review-001', operationHash: 'a'.repeat(64), appliedRevision: 1 } };
  expect(readOwnerWaitlistReview(marker,scope)).toEqual({ revision: 1, reviewed: true, updatedAt: now });
  expect(()=>readOwnerWaitlistReview({ ...marker, lastOperation: { ...marker.lastOperation, appliedRevision: 2 } },scope)).toThrow();
  expect(()=>readOwnerWaitlistReview({ ...marker, businessId: 'other' },scope)).toThrow();
});
it('dtoOwnerIsBusinessOwnerNotStoredWaitlistOwnerAndDetailIsStrict', () => {
  expect(ownerWaitlistPageSchema.parse(page()).ownerUid).toBe('actual-owner');
  expect(ownerWaitlistPageSchema.safeParse({ ...page(), ownerUid: 'owner\n' }).success).toBe(false);
  const detail = { businessId: 'biz', ownerUid: 'actual-owner', serverNow: now, row: row(), state: 'available', availability: [{ resourceId: 'one', resourceName: 'Uno', slots: ['09:00'] }] };
  expect(ownerWaitlistDetailSchema.safeParse(detail).success).toBe(true);
  expect(ownerWaitlistDetailSchema.safeParse({ ...detail, state: 'expired' }).success).toBe(false);
  expect(ownerWaitlistDetailSchema.safeParse({ ...detail, clientUid: 'private' }).success).toBe(false);
});
it('legacyAndVersionTwoMarkersCannotCrossIncarnationsOrHideFutureRevisionCorruption',()=>{
  const scope={businessId:'biz',recordId:'record',entryId:'entry',waitlistRevision:3};
  const legacy={version:1,businessId:'biz',waitlistRecordId:'record',entryId:'entry',revision:1,reviewed:true,updatedAt:now,actorUid:'owner',lastOperation:{requestId:'review-001',operationHash:'a'.repeat(64),appliedRevision:1}};
  expect(readOwnerWaitlistReview(legacy,scope)).toEqual({revision:0,reviewed:false,updatedAt:null});
  expect(readOwnerWaitlistReview({...legacy,version:2,waitlistRevision:3},scope).reviewed).toBe(true);
  expect(()=>readOwnerWaitlistReview({...legacy,version:2,waitlistRevision:5},scope)).toThrow();
});
