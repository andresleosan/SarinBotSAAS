import { createHash } from 'node:crypto';
import { afterEach, expect, it } from 'vitest';
import { memoryFirestore } from './memoryFirestore';
import type { Database, Transaction } from '@/lib/storage/types';
import {
  exportWaitlistData, deleteExportedWaitlistData, deleteExportedWaitlistDataBatch, reconcileWaitlistDataErasure,
  type WaitlistDataExport,
} from '@/lib/server/waitlist-data-maintenance';
import {
  waitlistOfferId, waitlistOfferProposalId, waitlistOfferCommandFingerprint, parseCanonicalWaitlistOffer, readWaitlistOfferHead,
  type WaitlistOfferRecord,
} from '@/lib/server/waitlist-offers';
import { waitlistDocumentId, parseCanonicalWaitlistRecord } from '@/lib/server/waitlist';
import { bookingSubjectHash } from '@/lib/server/booking-subject-consent';
import { createDataTestRuntime } from '../cloudflare/tests/data-runtime.mjs';
import { buildImportSql, buildReversePlan, prepareMigration, canonicalJson, encodeFirestoreValue } from '../scripts/lib/data-migration.mjs';

const scope = { businessId: 'demo-business', ownerUid: 'demo-alice' }, root = 'businesses/demo-business';
const createdAt = Date.parse('2030-01-07T13:55:00Z');
function syntheticOffer(index = 0, clientUid = scope.ownerUid, state: WaitlistOfferRecord['state'] = 'booked'): WaitlistOfferRecord {
  const entryId = 'demo-entry-' + index, requestId = 'demo-offer-' + index;
  const id = waitlistOfferId(scope.businessId, entryId, 'demo-owner', requestId);
  const target = { serviceId: 'cut', serviceName: 'Corte demo', resourceId: 'one', resourceName: 'Uno', dateKey: '2030-01-07',
    startTimeStr: '09:00', endTimeStr: '09:30', startAt: Date.parse('2030-01-07T14:00:00Z'), endAt: Date.parse('2030-01-07T14:30:00Z'),
    reservedUntilAt: Date.parse('2030-01-07T14:45:00Z'), durationMinutes: 30, bufferMinutes: 15, priceCOP: 25000, intakeFields: [] };
  const catalog = { service: { id: 'cut', name: 'Corte demo', durationMinutes: 30, bufferMinutes: 15, price: 25000, resourceIds: ['one'] }, resource: { id: 'one', name: 'Uno', active: true }, intakeFields: [] };
  const proposal = { id: waitlistOfferProposalId(scope.businessId, id, clientUid, 'demo-proposal-' + index), requestId: 'demo-proposal-' + index,
    createdAt: createdAt + 60_000, expiresAt: target.startAt, subjectCase: { bookingRequestId: 'demo-proposal-' + index, subjectKind: 'self' },
    catalogFingerprint: bookingSubjectHash(catalog), resourceScheduleFingerprint: 'c'.repeat(64), policyRevision: 1 };
  const confirmedAt = createdAt + 120_000;
  const booking = { appointmentId: 'demo-appointment-' + index, proposalId: proposal.id, entryId, previousWaitlistRevision: 1, resolvedWaitlistRevision: 2, confirmedAt,
    source: { dateKey: target.dateKey, startAt: target.startAt, endAt: target.endAt, reservedUntilAt: target.reservedUntilAt, resourceId: 'one', serviceId: 'cut' } };
  return parseCanonicalWaitlistOffer(id, { version: 1, id, businessId: scope.businessId, waitlistRecordId: waitlistDocumentId(clientUid, scope.businessId), entryId,
    waitlistRevision: 1, headRevisionAtCreation: index + 1, clientUid, ownerActorUid: 'demo-owner', requestId,
    commandFingerprint: waitlistOfferCommandFingerprint(scope.businessId, 'demo-owner', { requestId, entryId, expectedWaitlistRevision: 1, expectedHeadRevision: index, selection: { resourceId: 'one', startTimeStr: '09:00' } }),
    requestFingerprint: 'a'.repeat(64), dateKey: target.dateKey, createdAt, expiresAt: target.startAt, target, catalog,
    catalogFingerprint: bookingSubjectHash(catalog), resourceScheduleFingerprint: 'c'.repeat(64), policyRevision: 1, state, proposal,
    booking: state === 'booked' ? booking : null, closedAt: state === 'offered' ? null : state === 'expired' ? target.startAt : confirmedAt,
    closedReason: state === 'offered' ? null : state, closedByUid: state === 'offered' ? null : state === 'withdrawn' ? 'demo-owner' : clientUid }, scope.businessId);
}
const headFor = (offer: WaitlistOfferRecord) => ({ version: 1, businessId: offer.businessId, waitlistRecordId: offer.waitlistRecordId, revision: offer.headRevisionAtCreation, entryId: offer.entryId, currentOfferId: offer.id });
const tombstoneFor = (offer: WaitlistOfferRecord) => ({ version: 1, businessId: offer.businessId, ownerUid: offer.clientUid, revision: 2, request: null, updatedAt: offer.booking!.confirmedAt,
  lastOperation: { requestId: 'offer-' + offer.id, operationHash: bookingSubjectHash({ kind: 'resolve_offer', offerId: offer.id, proposalId: offer.proposal!.id, entryId: offer.entryId, appointmentId: offer.booking!.appointmentId }), appliedRevision: 2 } });
async function seed(db: Database, offers = [syntheticOffer()], request = true) {
  const ref = db.collection('businesses').doc(scope.businessId), last = offers.at(-1)!;
  for (const offer of offers) await ref.collection('waitlistOffers').doc(offer.id).set(offer);
  await ref.collection('waitlistOfferHeads').doc(last.waitlistRecordId).set(headFor(last));
  await ref.collection('waitlistOwnerReviews').doc(last.entryId).set({ version: 2, businessId: scope.businessId, waitlistRecordId: last.waitlistRecordId, entryId: last.entryId, waitlistRevision: 1, revision: 1, reviewed: true, updatedAt: createdAt, actorUid: 'demo-owner', lastOperation: { requestId: 'demo-review', operationHash: 'b'.repeat(64), appliedRevision: 1 } });
  if (request) await ref.collection('waitlistRequests').doc(last.waitlistRecordId).set(tombstoneFor(last));
  return last;
}
const refFor = (db: Database, path: string) => { const [parent, business, child, id] = path.split('/'); return db.collection(parent).doc(business).collection(child).doc(id); };
function rehash(exported: WaitlistDataExport): WaitlistDataExport { return { ...exported, sha256: createHash('sha256').update(canonicalJson({ version: 1, scope: exported.scope, documents: exported.documents })).digest('hex') }; }
let runtime: Awaited<ReturnType<typeof createDataTestRuntime>> | undefined;
afterEach(async () => { await runtime?.dispose(); runtime = undefined; });

it.each([true, false])('exports all four private children with canonical identity when request present=%s', async request => {
  const f = memoryFirestore(), db = f.db as Database, offer = await seed(db, [syntheticOffer()], request);
  const other = syntheticOffer(9, 'demo-bob');
  await db.collection('businesses').doc(scope.businessId).collection('waitlistOffers').doc(other.id).set(other);
  await db.collection('businesses').doc(scope.businessId).collection('appointments').doc('unrelated').set({ private: 'appointment-only' });
  const exported = await exportWaitlistData(db, scope);
  expect(exported.documents.map(row => row.path)).toEqual([
    `${root}/waitlistOfferHeads/${offer.waitlistRecordId}`, `${root}/waitlistOffers/${offer.id}`,
    `${root}/waitlistOwnerReviews/${offer.entryId}`, ...(request ? [`${root}/waitlistRequests/${offer.waitlistRecordId}`] : []),
  ]);
  expect(exported.documents.find(row => row.path.endsWith('/' + offer.id))!.data).toEqual(offer);
  expect(await deleteExportedWaitlistData(db, exported)).toEqual({ deleted: request ? 4 : 3 });
  expect((await exportWaitlistData(db, scope)).documents).toEqual([]);
  expect((await db.collection('businesses').doc(scope.businessId).collection('waitlistOffers').doc(other.id).get()).exists).toBe(true);
  expect((await db.collection('businesses').doc(scope.businessId).collection('appointments').doc('unrelated').get()).exists).toBe(true);
});

it.each(['head_shape', 'hidden_head_record', 'head_entry', 'head_revision', 'head_missing_offer', 'offer_scope', 'offer_id', 'offer_proof', 'offer_contact'] as const)('rejects present corrupt %s instead of exporting an empty inventory', async corruption => {
  const f = memoryFirestore(), db = f.db as Database, offer = await seed(db);
  const head = `${root}/waitlistOfferHeads/${offer.waitlistRecordId}`, path = `${root}/waitlistOffers/${offer.id}`;
  if (corruption === 'head_shape') await refFor(db, head).set({ ...headFor(offer), revision: 0 });
  if (corruption === 'hidden_head_record') await refFor(db, head).set({ ...headFor(offer), waitlistRecordId: 'other-record' });
  if (corruption === 'head_entry') await refFor(db, head).set({ ...headFor(offer), entryId: 'other-entry' });
  if (corruption === 'head_revision') await refFor(db, head).set({ ...headFor(offer), revision: 9 });
  if (corruption === 'head_missing_offer') await refFor(db, head).set({ ...headFor(offer), currentOfferId: 'missing-offer' });
  if (corruption === 'offer_scope') await refFor(db, path).set({ ...offer, clientUid: 'demo-bob' });
  if (corruption === 'offer_id') { await refFor(db, path).delete(); await refFor(db, `${root}/waitlistOffers/forged`).set(offer); }
  if (corruption === 'offer_proof') await refFor(db, path).set({ ...offer, booking: { ...offer.booking, resolvedWaitlistRevision: 9 } });
  if (corruption === 'offer_contact') await refFor(db, path).set({ ...offer, clientPhone: 'private-contact' });
  const before = structuredClone([...f.rows]);
  await expect(exportWaitlistData(db, scope)).rejects.toMatchObject({ status: 503 });
  expect([...f.rows]).toEqual(before);
});

it('keeps the head until 1005 historical offers and anti-replay documents finish erasing and resumes a lost batch response', async () => {
  const f = memoryFirestore(), writes: string[][] = [], db = f.db as Database;
  const offers = Array.from({ length: 1005 }, (_, index) => syntheticOffer(index, scope.ownerUid, index === 1004 ? 'booked' : 'expired'));
  const last = await seed(db, offers), original = db.runTransaction.bind(db);
  const tracked = { ...db, runTransaction: <T>(handler: (tx: Transaction) => Promise<T>) => original(async tx => {
    const deleted: string[] = [], value = await handler({ ...tx, delete: ref => { deleted.push(ref.path); tx.delete(ref); } });
    if (deleted.length) writes.push(deleted); return value;
  }) } as Database;
  const exported = await exportWaitlistData(tracked, scope);
  expect(exported.documents).toHaveLength(1008);
  await expect(deleteExportedWaitlistData(tracked, exported)).rejects.toMatchObject({ status: 413 });
  await expect(deleteExportedWaitlistDataBatch(tracked, exported, { writersStopped: false } as never)).rejects.toMatchObject({ status: 409 });
  await deleteExportedWaitlistDataBatch(tracked, exported, { writersStopped: true });
  expect((await refFor(db, `${root}/waitlistOfferHeads/${last.waitlistRecordId}`).get()).exists).toBe(true);
  expect((await db.collection('businesses').doc(scope.businessId).collection('waitlistOffers').get()).size).toBe(905);
  let progress = await reconcileWaitlistDataErasure(tracked, exported, { writersStopped: true });
  expect(progress).toMatchObject({ deletedCount: 100, complete: false, basis: 'current_inventory' });
  while (!progress.complete) {
    progress = await deleteExportedWaitlistDataBatch(tracked, exported, { writersStopped: true, previous: progress });
    if (!progress.complete) expect((await refFor(db, `${root}/waitlistOfferHeads/${last.waitlistRecordId}`).get()).exists).toBe(true);
  }
  expect(progress).toMatchObject({ deletedCount: 1008, totalCount: 1008, complete: true });
  expect(writes.map(rows => rows.length)).toEqual([100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 8]);
  expect(writes.slice(0, -1).flat().some(path => path.includes('/waitlistOfferHeads/'))).toBe(false);
  expect(writes.at(-1)!.at(-1)).toBe(`${root}/waitlistOfferHeads/${last.waitlistRecordId}`);
  expect((await exportWaitlistData(db, scope)).documents).toEqual([]);
  expect(await reconcileWaitlistDataErasure(tracked, exported, { writersStopped: true, previous: progress })).toMatchObject({ complete: true, deletedCount: 1008 });
}, 30000);

it.each(['changed_offer', 'new_offer', 'new_head'] as const)('rejects %s before final deletion or lost-response completion', async change => {
  const f = memoryFirestore(), db = f.db as Database, offer = await seed(db), exported = await exportWaitlistData(db, scope);
  if (change === 'changed_offer') await refFor(db, `${root}/waitlistOffers/${offer.id}`).set({ ...offer, requestFingerprint: 'd'.repeat(64) });
  if (change === 'new_offer') { const added = syntheticOffer(1, scope.ownerUid, 'expired'); await refFor(db, `${root}/waitlistOffers/${added.id}`).set(added); }
  if (change === 'new_head') await refFor(db, `${root}/waitlistOfferHeads/forged`).set(headFor(offer));
  const before = structuredClone([...f.rows]);
  await expect(deleteExportedWaitlistDataBatch(db, exported, { writersStopped: true })).rejects.toMatchObject({ status: 409 });
  expect([...f.rows]).toEqual(before);
  if (change === 'changed_offer') await expect(reconcileWaitlistDataErasure(db, exported, { writersStopped: true })).rejects.toMatchObject({ status: 409 });
  else await expect(reconcileWaitlistDataErasure(db, exported, { writersStopped: true })).resolves.toMatchObject({ complete: false, deletedCount: 0 });
});

it('rejects forged exported scope, offer proof and progress receipts even with a recomputed export digest', async () => {
  const f = memoryFirestore(), db = f.db as Database; await seed(db);
  const exported = await exportWaitlistData(db, scope);
  for (const patch of [{ waitlistRecordId: 'foreign-record' }, { businessId: 'demo-other' }, { clientUid: 'demo-bob' }, { booking: null }]) {
    const changed = structuredClone(exported), row = changed.documents.find(item => item.path.includes('/waitlistOffers/'))!;
    row.data = { ...row.data, ...patch };
    await expect(deleteExportedWaitlistDataBatch(db, rehash(changed), { writersStopped: true })).rejects.toMatchObject({ status: 400 });
  }
  const progress = await reconcileWaitlistDataErasure(db, exported, { writersStopped: true });
  await expect(deleteExportedWaitlistDataBatch(db, exported, { writersStopped: true, previous: { ...progress, deletedCount: 1 } })).rejects.toMatchObject({ status: 400 });
});

it('never reconciles a partial erasure or a new residual offer into completed progress', async () => {
  const f = memoryFirestore(), db = f.db as Database, offer = await seed(db), exported = await exportWaitlistData(db, scope);
  const offerPath = `${root}/waitlistOffers/${offer.id}`;
  await refFor(db, offerPath).delete();
  await expect(reconcileWaitlistDataErasure(db, exported, { writersStopped: true })).rejects.toMatchObject({ status: 409 });
  expect((await refFor(db, `${root}/waitlistOfferHeads/${offer.waitlistRecordId}`).get()).exists).toBe(true);
  await refFor(db, offerPath).set(offer);
  await deleteExportedWaitlistDataBatch(db, exported, { writersStopped: true });
  const added = syntheticOffer(1, scope.ownerUid, 'expired');
  await refFor(db, `${root}/waitlistOffers/${added.id}`).set(added);
  await expect(reconcileWaitlistDataErasure(db, exported, { writersStopped: true })).rejects.toMatchObject({ status: 409 });
  expect((await refFor(db, `${root}/waitlistOffers/${added.id}`).get()).exists).toBe(true);
});

it.each([true, false])('snapshot SQL import and reverse reconciliation preserve all states proposal proof head with request present=%s', async request => {
  const f = memoryFirestore(), db = f.db as Database;
  const states: WaitlistOfferRecord['state'][] = ['offered', 'withdrawn', 'declined', 'expired', 'booked'];
  const offers = states.map((state, index) => syntheticOffer(index, scope.ownerUid, state));
  const last = await seed(db, offers, request);
  const requestPath = `${root}/waitlistRequests/${last.waitlistRecordId}`;
  const exported = await exportWaitlistData(db, scope);
  // The offline migration format is pinned to this namespace; every document
  // below is synthetic, and only the local D1 emulator receives the SQL.
  const stamp = '2030-01-07T14:00:00.000000Z', prefix = 'projects/sarinbotsaas/databases/(default)/documents/';
  const baseline = { version: 1, projectId: 'sarinbotsaas', databaseId: '(default)', readTime: stamp, collections: [], missingAncestors: [],
    documents: exported.documents.map(row => ({ name: prefix + row.path, fields: Object.fromEntries(Object.entries(row.data).map(([key, value]) => [key, encodeFirestoreValue(value)])), createTime: stamp, updateTime: stamp })) };
  const bundle = prepareMigration(baseline, { updatedAt: createdAt });
  runtime = await createDataTestRuntime();
  await runtime.db.exec(buildImportSql(bundle));
  const rows = (await runtime.db.prepare('SELECT * FROM app_documents ORDER BY path').all()).results;
  const reverse = buildReversePlan({ baseline, rows, blobs: [], revision: 0 });
  expect(reverse.deletionCandidates).toEqual([]);
  expect(reverse.upserts).toHaveLength(request ? 8 : 7);
  const restored = prepareMigration({ ...baseline, documents: reverse.upserts.map((write: { update: { name: string; fields: unknown } }) => ({ ...write.update, createTime: stamp, updateTime: stamp })) }, { updatedAt: createdAt });
  expect(restored.rows).toEqual(bundle.rows);
  const restoredData = new Map(restored.rows.map((row: { path: string; data: Record<string, unknown> }) => [row.path, row.data]));
  for (const offer of offers) {
    const record = parseCanonicalWaitlistOffer(offer.id, restoredData.get(`${root}/waitlistOffers/${offer.id}`), scope.businessId);
    expect(record).toEqual(offer);
    expect(record.state).toBe(offer.state);
    expect(record.proposal).toEqual(offer.proposal);
    expect(record.booking).toEqual(offer.booking);
  }
  if (request) expect(parseCanonicalWaitlistRecord(last.waitlistRecordId, restoredData.get(requestPath), scope.businessId)).toEqual(tombstoneFor(last));
  else expect(restoredData.has(requestPath)).toBe(false);
  expect(readWaitlistOfferHead(restoredData.get(`${root}/waitlistOfferHeads/${last.waitlistRecordId}`), { businessId: scope.businessId, waitlistRecordId: last.waitlistRecordId })).toEqual({ revision: 5, entryId: last.entryId, currentOfferId: last.id });
  await refFor(db, requestPath).delete();
  const orphaned = await exportWaitlistData(db, scope);
  expect(orphaned.documents).toHaveLength(7);
  expect(orphaned.documents.find(row => row.path.endsWith('/' + last.id))!.data.booking).toEqual(last.booking);
}, 30000);
