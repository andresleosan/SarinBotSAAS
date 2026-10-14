import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { initializeTestEnvironment, assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, doc, getDoc, getDocs, query, setDoc, updateDoc, where, setLogLevel } from 'firebase/firestore';

describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)('Firestore rules on real emulator', () => {
  let environment: RulesTestEnvironment;
  beforeAll(async () => {
    setLogLevel('silent');
    environment = await initializeTestEnvironment({ projectId: 'demo-sarin-rules', firestore: { rules: await readFile('firestore.rules', 'utf8') } });
  });
  beforeEach(async () => {
    await environment.clearFirestore();
    await environment.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await Promise.all([
        setDoc(doc(db, 'businesses', 'one'), { ownerUid: 'owner-one', subscription: { status:'trial' } }),
        setDoc(doc(db, 'businesses', 'two'), { ownerUid: 'owner-two' }),
        setDoc(doc(db, 'publicBusinesses', 'private-island'), { id: 'one', name: 'Public projection' }),
        setDoc(doc(db, 'businesses', 'one', 'appointments', 'mine'), { client: { uid: 'customer' }, dateKey:'2026-10-14' }),
        setDoc(doc(db, 'businesses', 'one', 'appointments', 'other'), { client: { uid: 'another' }, dateKey:'2026-10-14' }),
        setDoc(doc(db, 'users', 'customer'), { isSuperadmin: false }),
        setDoc(doc(db, 'users', 'stale-admin'), { isSuperadmin: true, role:'superadmin' }),
        setDoc(doc(db, 'paymentReceipts', 'payment'), { ownerUid:'owner-one' }),
        setDoc(doc(db, 'paymentImages', 'payment'), { ownerUid:'owner-one', receiptDataUrl:'sensitive' }),
      ]);
    });
  });
  afterAll(async () => { await environment?.cleanup(); });
  it('allows owner queries and denies cross-tenant reads and browser writes', async () => {
    const db = environment.authenticatedContext('owner-one').firestore();
    await assertSucceeds(getDoc(doc(db,'businesses','one')));
    await assertSucceeds(getDocs(query(collection(db,'businesses'),where('ownerUid','==','owner-one'))));
    await assertFails(getDoc(doc(db,'businesses','two')));
    await assertFails(updateDoc(doc(db,'businesses','one'),{'subscription.status':'active'}));
    await assertFails(setDoc(doc(db,'businesses','new'),{ownerUid:'owner-one'}));
  });
  it('permits a signed in island get while denying enumeration and anonymous reads', async () => {
    const db = environment.authenticatedContext('customer').firestore();
    await assertSucceeds(getDoc(doc(db,'publicBusinesses','private-island')));
    await assertFails(getDocs(collection(db,'publicBusinesses')));
    await assertFails(getDoc(doc(environment.unauthenticatedContext().firestore(),'publicBusinesses','private-island')));
  });
  it('isolates appointment lists and forbids direct double-booking writes', async () => {
    const db = environment.authenticatedContext('customer').firestore();
    await assertSucceeds(getDocs(query(collection(db,'businesses','one','appointments'),where('client.uid','==','customer'))));
    await assertFails(getDoc(doc(db,'businesses','one','appointments','other')));
    await assertFails(getDocs(collection(db,'businesses','one','appointments')));
    await assertFails(setDoc(doc(db,'businesses','one','appointments','new'),{client:{uid:'customer'}}));
    await assertSucceeds(getDocs(collection(environment.authenticatedContext('owner-one').firestore(),'businesses','one','appointments')));
  });
  it('protects receipts and ignores a stale or forged superadmin profile flag', async () => {
    const owner = environment.authenticatedContext('owner-one').firestore();
    const stranger = environment.authenticatedContext('stale-admin').firestore();
    await assertSucceeds(getDoc(doc(owner,'paymentImages','payment')));
    await assertFails(getDoc(doc(stranger,'paymentImages','payment')));
    await assertFails(getDoc(doc(stranger,'paymentReceipts','payment')));
    await assertFails(getDoc(doc(stranger,'businesses','one')));
    const customer = environment.authenticatedContext('customer').firestore();
    await assertFails(updateDoc(doc(customer,'users','customer'),{isSuperadmin:true}));
    await assertFails(setDoc(doc(customer,'vault','secret'),{content:'never in Firestore'}));
  });
});
