import { readFile } from 'node:fs/promises';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { initializeApp, deleteApp, type App } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { initializeTestEnvironment, assertFails, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, doc, getDoc, getDocs, query, setDoc, where, setLogLevel } from 'firebase/firestore';
import type { Database } from '@/lib/storage/types';
import { activeTeam, registerTeamStorageCases, teamAppointment } from './business-team-storage-contract';
import { readTeamAssignedAgenda } from '@/lib/server/team-agenda';
import { teamNow } from './business-team-contract';

// Normal unit runs skip honestly. Local acceptance runs only this new file under
// the hash-pinned official Java21 emulator; it does not repeat legacy rules cases.
describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)('S13 official Firestore Admin transactions and raw SDK denials', () => {
  const projectId = 'demo-sarin-team-storage';
  let environment: RulesTestEnvironment, apps: App[], stores: Firestore[], db: Database, second: Database;
  beforeAll(async () => {
    expect(process.env.FIRESTORE_EMULATOR_HOST).toMatch(/^127\.0\.0\.1:\d+$/);
    setLogLevel('silent');
    environment = await initializeTestEnvironment({ projectId, firestore: { rules: await readFile('firestore.rules', 'utf8') } });
    apps = [0, 1].map(index => initializeApp({ projectId }, `demo-s13-team-${index}-${crypto.randomUUID()}`));
    stores = apps.map(app => getFirestore(app)); db = stores[0] as unknown as Database; second = stores[1] as unknown as Database;
  }, 30000);
  beforeEach(async () => { await environment.clearFirestore(); vi.stubEnv('SARIN_TEAM_ACCESS_ENABLED', 'true'); vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(teamNow); });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllEnvs(); });
  afterAll(async () => { await Promise.all(stores?.map(store => store.terminate()) ?? []); await Promise.all(apps?.map(app => deleteApp(app)) ?? []); await environment?.cleanup(); });

  // Explicit read-only Firestore transaction gives a consistent historical
  // snapshot without blocking the second Admin handle's revocation commit.
  registerTeamStorageCases('Firestore independent Admin handles', () => ({ db, second }), () => ((handler: Parameters<Database['runTransaction']>[0]) => stores[0].runTransaction(tx => handler(tx as unknown as Parameters<typeof handler>[0]), { readOnly: true })) as Database['runTransaction']);

  it('real approved staff can read projected agenda but raw SDK cannot read or forge memberships events or other appointments', async () => {
    const f = await activeTeam(db), eventPath = `businesses/${f.business.id}/teamAccessEvents/${f.approved.applied.eventId}`;
    await db.collection('businesses').doc(f.business.id).collection('appointments').doc('demo-private-appointment').set(teamAppointment(f.business.id));
    expect((await readTeamAssignedAgenda(f.member, f.business.id, '2030-01-07', db)).rows).toHaveLength(1);
    expect((await db.collection('businessMemberships').doc(f.membershipId).get()).data()).toMatchObject({ status: 'active', memberUid: f.member.uid });
    const staff = environment.authenticatedContext(f.member.uid).firestore();
    await assertFails(getDoc(doc(staff, 'businessMemberships', f.membershipId)));
    await assertFails(getDocs(query(collection(staff, 'businessMemberships'), where('memberUid', '==', f.member.uid))));
    await assertFails(getDoc(doc(staff, eventPath)));
    await assertFails(getDocs(collection(staff, `businesses/${f.business.id}/teamAccessEvents`)));
    await assertFails(getDoc(doc(staff, `businesses/${f.business.id}/appointments/demo-private-appointment`)));
    await assertFails(getDocs(query(collection(staff, `businesses/${f.business.id}/appointments`), where('resourceId', '==', 'demo-chair'))));
    await assertFails(setDoc(doc(staff, 'businessMemberships', f.membershipId), { status: 'active', ownerUidAtApproval: f.member.uid }));
    await assertFails(setDoc(doc(staff, eventPath), { sequence: 999 }));
  }, 30000);
});
