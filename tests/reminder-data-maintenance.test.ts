import { describe, expect, it } from 'vitest';
import { memoryFirestore } from './memoryFirestore';
import type { Database } from '@/lib/storage/types';
import { deleteExportedReminderData, exportReminderData } from '@/lib/server/reminder-data-maintenance';
import { createDataTestRuntime } from '../cloudflare/tests/data-runtime.mjs';
import { createCloudflareDatabase, StorageError } from '@/lib/storage/database';
import type { DataReadResult, DataCommitResult } from '../shared/data-protocol';

const preference = (ownerUid: string, businessId = 'demo-business') => ({ version: 1, businessId, ownerUid, enabled: true, revision: 1 });
const receipt = (ownerUid: string, appointmentId: string, businessId = 'demo-business') => ({ version: 1, businessId, ownerUid, appointmentId, sourceRevision: 0, sourceStartAt: 1792368000000, offsetMinutes: 1440, seenAt: 1792364400000 });
const root = 'businesses/demo-business';
function seed() {
  return memoryFirestore({
    [`${root}/reminderPreferences/alice`]: preference('demo-alice'),
    [`${root}/reminderPreferences/bob`]: preference('demo-bob'),
    [`${root}/reminderReceipts/alice_a`]: receipt('demo-alice', 'demo-a'),
    [`${root}/reminderReceipts/alice_b`]: receipt('demo-alice', 'demo-b'),
    [`${root}/reminderReceipts/bob_c`]: receipt('demo-bob', 'demo-c'),
    [`${root}/appointments/demo-a`]: { id: 'demo-a', client: { uid: 'demo-alice' } },
    ['businesses/demo-other/reminderPreferences/alice']: preference('demo-alice', 'demo-other'),
  }).db as unknown as Database;
}
async function remaining(db: Database) {
  return (await Promise.all(['reminderPreferences', 'reminderReceipts'].map(name => db.collection('businesses').doc('demo-business').collection(name).get())))
    .flatMap((snapshot, index) => snapshot.docs.map(doc => `${index === 0 ? 'preference' : 'receipt'}/${doc.id}`)).sort();
}

describe('private reminder export and guarded deletion procedure', () => {
  it('exports one appointment receipt and deletes only that receipt, preserving its owner preference and neighboring data', async () => {
    const db = seed();
    const exported = await exportReminderData(db, { businessId: 'demo-business', appointmentId: 'demo-a' });
    expect(exported.documents.map(row => row.path)).toEqual([`${root}/reminderReceipts/alice_a`]);
    expect(exported.documents[0].data).toEqual(receipt('demo-alice', 'demo-a'));
    expect(await remaining(db)).toHaveLength(5);
    expect(await deleteExportedReminderData(db, exported)).toEqual({ deleted: 1 });
    expect((await exportReminderData(db, exported.scope)).documents).toEqual([]);
    expect(await remaining(db)).toEqual(['preference/alice', 'preference/bob', 'receipt/alice_b', 'receipt/bob_c']);
    expect((await db.collection('businesses').doc('demo-business').collection('appointments').doc('demo-a').get()).exists).toBe(true);
    expect((await db.collection('businesses').doc('demo-other').collection('reminderPreferences').doc('alice').get()).exists).toBe(true);
  });
  it('exports and deletes every preference and receipt of an account in the specified business', async () => {
    const db = seed();
    const exported = await exportReminderData(db, { businessId: 'demo-business', ownerUid: 'demo-alice' });
    expect(exported.documents.map(row => row.path)).toEqual([`${root}/reminderPreferences/alice`, `${root}/reminderReceipts/alice_a`, `${root}/reminderReceipts/alice_b`]);
    expect(await deleteExportedReminderData(db, exported)).toEqual({ deleted: 3 });
    expect((await exportReminderData(db, exported.scope)).documents).toEqual([]);
    expect(await remaining(db)).toEqual(['preference/bob', 'receipt/bob_c']);
  });
  it('exports and deletes both private collections of one business without touching its appointments', async () => {
    const db = seed();
    const exported = await exportReminderData(db, { businessId: 'demo-business' });
    expect(exported.documents).toHaveLength(5);
    expect(await deleteExportedReminderData(db, exported)).toEqual({ deleted: 5 });
    expect((await exportReminderData(db, exported.scope)).documents).toEqual([]);
    expect((await db.collection('businesses').doc('demo-business').collection('appointments').get()).size).toBe(1);
  });
  it.each(['changed', 'added', 'deleted'] as const)('refuses all deletion after a %s record since the private export', async change => {
    const db = seed(), exported = await exportReminderData(db, { businessId: 'demo-business', ownerUid: 'demo-alice' });
    const collection = db.collection('businesses').doc('demo-business').collection('reminderReceipts');
    if (change === 'changed') await collection.doc('alice_a').set({ ...receipt('demo-alice', 'demo-a'), seenAt: 1792364400001 });
    if (change === 'added') await collection.doc('alice_new').set(receipt('demo-alice', 'demo-new'));
    if (change === 'deleted') await collection.doc('alice_a').delete();
    const before = await remaining(db);
    await expect(deleteExportedReminderData(db, exported)).rejects.toMatchObject({ status: 409 });
    expect(await remaining(db)).toEqual(before);
  });
  it('rejects a tampered export, identity mismatch and oversized batch before any deletes', async () => {
    const db = seed(), exported = await exportReminderData(db, { businessId: 'demo-business' });
    await expect(deleteExportedReminderData(db, { ...exported, scope: { businessId: 'demo-other' } })).rejects.toMatchObject({ status: 400 });
    await db.collection('businesses').doc('demo-business').collection('reminderReceipts').doc('wrong_tenant').set(receipt('demo-alice', 'demo-x', 'demo-other'));
    await expect(exportReminderData(db, { businessId: 'demo-business' })).rejects.toMatchObject({ status: 503 });
    expect(await remaining(db)).toHaveLength(6);
    await db.collection('businesses').doc('demo-business').collection('reminderReceipts').doc('wrong_tenant').delete();
    for (let index = 0; index < 96; index++) await db.collection('businesses').doc('demo-business').collection('reminderReceipts').doc(`many_${index}`).set(receipt('demo-alice', `demo-${index}`));
    const large = await exportReminderData(db, { businessId: 'demo-business' });
    await expect(deleteExportedReminderData(db, large)).rejects.toMatchObject({ status: 413 });
    expect(await remaining(db)).toHaveLength(101);
  });
});

it('real D1 rejects a concurrent inserted receipt before deletion and later removes the exact new export only', async () => {
  const runtime = await createDataTestRuntime();
  let concurrentInsert: (() => Promise<unknown>) | null = null;
  const connect = () => createCloudflareDatabase(async command => {
    if (concurrentInsert && command.action === 'commit' && command.writes.some(row => row.op === 'delete')) {
      const insert = concurrentInsert; concurrentInsert = null; await insert();
    }
    const response = await runtime.fetch(command);
    const value = await response.json() as DataReadResult | DataCommitResult;
    if (!response.ok) throw new StorageError(response.status, (value as unknown as { code: string }).code);
    return value;
  });
  const db = connect(), second = connect();
  try {
    const business = db.collection('businesses').doc('demo-business');
    await business.collection('reminderPreferences').doc('alice').set(preference('demo-alice'));
    await business.collection('reminderReceipts').doc('alice_a').set(receipt('demo-alice', 'demo-a'));
    await business.collection('reminderPreferences').doc('bob').set(preference('demo-bob'));
    const exported = await exportReminderData(db, { businessId: 'demo-business', ownerUid: 'demo-alice' });
    concurrentInsert = () => second.collection('businesses').doc('demo-business').collection('reminderReceipts').doc('alice_new').set(receipt('demo-alice', 'demo-new'));
    await expect(deleteExportedReminderData(db, exported)).rejects.toMatchObject({ status: 409 });
    const refreshed = await exportReminderData(second, exported.scope);
    expect(refreshed.documents).toHaveLength(3);
    expect(await deleteExportedReminderData(db, refreshed)).toEqual({ deleted: 3 });
    expect((await exportReminderData(second, exported.scope)).documents).toEqual([]);
    expect((await exportReminderData(second, { businessId: 'demo-business' })).documents.map(row => row.path)).toEqual([`${root}/reminderPreferences/bob`]);
  } finally { await runtime.dispose(); }
}, 60000);

it.each([false, true])('real D1 supports exact appointment export and deletion with owner filter=%s, preserving preferences and other receipts', async includeOwner => {
  const runtime = await createDataTestRuntime();
  const db = createCloudflareDatabase(async command => {
    const response = await runtime.fetch(command), value = await response.json() as DataReadResult | DataCommitResult;
    if (!response.ok) throw new StorageError(response.status, (value as unknown as { code: string }).code);
    return value;
  });
  try {
    const business = db.collection('businesses').doc('demo-business');
    await business.collection('reminderPreferences').doc('alice').set(preference('demo-alice'));
    await business.collection('reminderReceipts').doc('alice_a').set(receipt('demo-alice', 'demo-a'));
    await business.collection('reminderReceipts').doc('alice_b').set(receipt('demo-alice', 'demo-b'));
    const exported = await exportReminderData(db, { businessId: 'demo-business', appointmentId: 'demo-a', ...(includeOwner ? { ownerUid: 'demo-alice' } : {}) });
    expect(exported.documents.map(row => row.path)).toEqual([`${root}/reminderReceipts/alice_a`]);
    expect(await deleteExportedReminderData(db, exported)).toEqual({ deleted: 1 });
    expect((await exportReminderData(db, exported.scope)).documents).toEqual([]);
    expect((await exportReminderData(db, { businessId: 'demo-business' })).documents.map(row => row.path)).toEqual([`${root}/reminderPreferences/alice`, `${root}/reminderReceipts/alice_b`]);
  } finally { await runtime.dispose(); }
}, 60000);
