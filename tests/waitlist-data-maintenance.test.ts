import { describe, expect, it } from 'vitest';
import { memoryFirestore } from './memoryFirestore';
import type { Database } from '@/lib/storage/types';
import { deleteExportedWaitlistData, exportWaitlistData } from '@/lib/server/waitlist-data-maintenance';
import { stableDocumentId } from '@/lib/server/businesses';
import { createDataTestRuntime } from '../cloudflare/tests/data-runtime.mjs';
import { createCloudflareDatabase, StorageError } from '@/lib/storage/database';
import type { DataReadResult, DataCommitResult } from '../shared/data-protocol';

const root = 'businesses/demo-business';
const entry = (ownerUid: string, businessId = 'demo-business', revision = 1) => ({ version: 1, businessId, ownerUid, revision, updatedAt: 1792274400000, request: null, lastOperation: { requestId: 'demo-cancel', operationHash: 'a'.repeat(64), appliedRevision: revision } });
const ownerReview = (entryId: string, uid = 'demo-alice') => ({ version: 1, businessId: 'demo-business', waitlistRecordId: stableDocumentId('waitlist', 'demo-business', uid), entryId, revision: 1, reviewed: true, updatedAt: 1792274400000, actorUid: 'demo-business-owner', lastOperation: { requestId: 'review-maintenance', operationHash: 'b'.repeat(64), appliedRevision: 1 } });
function seed() {
  return memoryFirestore({
    [`${root}/waitlistRequests/alice`]: entry('demo-alice'),
    [`${root}/waitlistRequests/bob`]: entry('demo-bob'),
    [`${root}/appointments/demo-a`]: { id: 'demo-a', client: { uid: 'demo-alice' } },
    ['businesses/demo-other/waitlistRequests/alice']: entry('demo-alice', 'demo-other'),
  }).db as unknown as Database;
}
describe('private waitlist export and guarded deletion', () => {
  it.each([true,false])('owner review inventory follows canonical record even when singleton missing=%s', async missing => {
    const db=seed(),ref=db.collection('businesses').doc('demo-business'),id=stableDocumentId('waitlist','demo-business','demo-alice');
    if(!missing)await ref.collection('waitlistRequests').doc(id).set(entry('demo-alice'));
    await ref.collection('waitlistOwnerReviews').doc('old-entry').set(ownerReview('old-entry'));
    await ref.collection('waitlistOwnerReviews').doc('other-entry').set(ownerReview('other-entry','demo-bob'));
    const scope={businessId:'demo-business',ownerUid:'demo-alice'},exported=await exportWaitlistData(db,scope);
    expect(exported.documents.map(d=>d.path)).toContain(root+'/waitlistOwnerReviews/old-entry');
    expect(exported.documents.map(d=>d.path)).not.toContain(root+'/waitlistOwnerReviews/other-entry');
    expect(await deleteExportedWaitlistData(db,exported)).toEqual({deleted:missing?2:3});
    expect((await ref.collection('waitlistOwnerReviews').doc('other-entry').get()).exists).toBe(true);
    expect((await exportWaitlistData(db,scope)).documents).toEqual([]);
  });
  it('owner review added after an old export prevents partial deletion and new joint inventory is bounded',async()=>{
    const db=seed(),scope={businessId:'demo-business',ownerUid:'demo-alice'},old=await exportWaitlistData(db,scope),collection=db.collection('businesses').doc('demo-business').collection('waitlistOwnerReviews');
    await collection.doc('new-entry').set(ownerReview('new-entry'));
    await expect(deleteExportedWaitlistData(db,old)).rejects.toMatchObject({status:409});
    for(let i=0;i<99;i++)await collection.doc('entry-'+i).set(ownerReview('entry-'+i));
    const exported=await exportWaitlistData(db,scope);expect(exported.documents).toHaveLength(101);await expect(deleteExportedWaitlistData(db,exported)).rejects.toMatchObject({status:413});
  });
  it('owner review invalid cross-business marker fails inventory instead of silently omitting it',async()=>{
    const db=seed();await db.collection('businesses').doc('demo-business').collection('waitlistOwnerReviews').doc('entry').set({...ownerReview('entry'),businessId:'other'});
    await expect(exportWaitlistData(db,{businessId:'demo-business'})).rejects.toMatchObject({status:503});
  });
  it.each(['missing_owner', 'other_owner', 'other_business'] as const)('fails closed on a canonical account document with %s instead of claiming an empty export', async corruption => {
    const db = seed(), scope = { businessId: 'demo-business', ownerUid: 'demo-alice' };
    const ref = db.collection('businesses').doc(scope.businessId).collection('waitlistRequests').doc(stableDocumentId('waitlist', scope.businessId, scope.ownerUid));
    const data: Record<string, unknown> = { ...entry('demo-alice'), request: { serviceId: 'private-service' } };
    if (corruption === 'missing_owner') delete data.ownerUid;
    if (corruption === 'other_owner') data.ownerUid = 'demo-bob';
    if (corruption === 'other_business') data.businessId = 'demo-other';
    await ref.set(data);
    await expect(exportWaitlistData(db, scope)).rejects.toMatchObject({ status: 503 });
    expect((await ref.get()).data()).toEqual(data);
  });
  it('exports an account including its empty revision tombstone, then removes only the exact inventory', async () => {
    const db = seed(), scope = { businessId: 'demo-business', ownerUid: 'demo-alice' };
    const exported = await exportWaitlistData(db, scope);
    expect(exported.documents).toEqual([{ path: `${root}/waitlistRequests/alice`, data: entry('demo-alice') }]);
    expect((await exportWaitlistData(db, { businessId: 'demo-business' })).documents).toHaveLength(2);
    expect(await deleteExportedWaitlistData(db, exported)).toEqual({ deleted: 1 });
    expect((await exportWaitlistData(db, scope)).documents).toEqual([]);
    expect((await exportWaitlistData(db, { businessId: 'demo-business' })).documents.map(row => row.path)).toEqual([`${root}/waitlistRequests/bob`]);
    expect((await db.collection('businesses').doc('demo-business').collection('appointments').doc('demo-a').get()).exists).toBe(true);
    expect((await exportWaitlistData(db, { businessId: 'demo-other' })).documents).toHaveLength(1);
  });
  it('exports all requests of a business whose parent is absent without modifying appointments', async () => {
    const db = seed(), exported = await exportWaitlistData(db, { businessId: 'demo-business' });
    expect(exported.documents).toHaveLength(2);
    expect(await deleteExportedWaitlistData(db, exported)).toEqual({ deleted: 2 });
    expect((await exportWaitlistData(db, exported.scope)).documents).toEqual([]);
    expect((await db.collection('businesses').doc('demo-business').collection('appointments').get()).size).toBe(1);
  });
  it.each(['changed', 'added', 'deleted'] as const)('refuses the entire deletion after a %s document since export', async change => {
    const db = seed(), exported = await exportWaitlistData(db, { businessId: 'demo-business' });
    const collection = db.collection('businesses').doc('demo-business').collection('waitlistRequests');
    if (change === 'changed') await collection.doc('alice').set(entry('demo-alice', 'demo-business', 2));
    if (change === 'added') await collection.doc('charlie').set(entry('demo-charlie'));
    if (change === 'deleted') await collection.doc('alice').delete();
    const before = await exportWaitlistData(db, exported.scope);
    await expect(deleteExportedWaitlistData(db, exported)).rejects.toMatchObject({ status: 409 });
    expect(await exportWaitlistData(db, exported.scope)).toEqual(before);
  });
  it('rejects scope tampering, appointment filtering and ownership corruption', async () => {
    const db = seed(), exported = await exportWaitlistData(db, { businessId: 'demo-business' });
    await expect(deleteExportedWaitlistData(db, { ...exported, scope: { businessId: 'demo-other' } })).rejects.toMatchObject({ status: 400 });
    await expect(exportWaitlistData(db, { businessId: 'demo-business', appointmentId: 'demo-a' } as never)).rejects.toBeDefined();
    await db.collection('businesses').doc('demo-business').collection('waitlistRequests').doc('wrong').set(entry('demo-c', 'demo-other'));
    await expect(exportWaitlistData(db, { businessId: 'demo-business' })).rejects.toMatchObject({ status: 503 });
    expect((await db.collection('businesses').doc('demo-business').collection('waitlistRequests').get()).size).toBe(3);
  });
  it('refuses oversized deletes without truncating the export', async () => {
    const db = seed(), collection = db.collection('businesses').doc('demo-business').collection('waitlistRequests');
    for (let index = 0; index < 99; index++) await collection.doc(`many_${index}`).set(entry(`demo-${index}`));
    const exported = await exportWaitlistData(db, { businessId: 'demo-business' });
    expect(exported.documents).toHaveLength(101);
    await expect(deleteExportedWaitlistData(db, exported)).rejects.toMatchObject({ status: 413 });
    expect((await collection.get()).size).toBe(101);
  });
});

it('real D1 preserves neighboring data and rejects a concurrent change before deleting the exact new export', async () => {
  const runtime = await createDataTestRuntime();
  let concurrentChange: (() => Promise<unknown>) | null = null;
  const connect = () => createCloudflareDatabase(async command => {
    if (concurrentChange && command.action === 'commit' && command.writes.some(row => row.op === 'delete')) {
      const change = concurrentChange; concurrentChange = null; await change();
    }
    const response = await runtime.fetch(command), value = await response.json() as DataReadResult | DataCommitResult;
    if (!response.ok) throw new StorageError(response.status, (value as unknown as { code: string }).code);
    return value;
  });
  const db = connect(), second = connect();
  try {
    const collection = db.collection('businesses').doc('demo-business').collection('waitlistRequests');
    await collection.doc('alice').set(entry('demo-alice'));
    await collection.doc('bob').set(entry('demo-bob'));
    const exported = await exportWaitlistData(db, { businessId: 'demo-business', ownerUid: 'demo-alice' });
    concurrentChange = () => second.collection('businesses').doc('demo-business').collection('waitlistRequests').doc('alice').set(entry('demo-alice', 'demo-business', 2));
    await expect(deleteExportedWaitlistData(db, exported)).rejects.toMatchObject({ status: 409 });
    const refreshed = await exportWaitlistData(second, exported.scope);
    expect(refreshed.documents).toHaveLength(1);
    expect(refreshed.documents[0].data.revision).toBe(2);
    expect(await deleteExportedWaitlistData(db, refreshed)).toEqual({ deleted: 1 });
    expect((await exportWaitlistData(second, exported.scope)).documents).toEqual([]);
    expect((await exportWaitlistData(second, { businessId: 'demo-business' })).documents.map(row => row.path)).toEqual([`${root}/waitlistRequests/bob`]);
  } finally { await runtime.dispose(); }
}, 60000);
