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
        setDoc(doc(db, 'serverSettings', 'ai'), { provider:'ollama', updatedAt:1 }),
        setDoc(doc(db, 'aiUsageCalls', 'synthetic-call'), { businessId:'one', promptTokens:100 }),
        setDoc(doc(db, 'aiUsageMonths', '2026-10'), { calls:1 }),
        setDoc(doc(db, 'aiUsageMonths', '2026-10', 'businesses', 'one'), { calls:1 }),
        setDoc(doc(db, 'aiUsageMeta', 'main'), { measurementStartedAt:1 }),
        setDoc(doc(db, 'responseQuotaScopes', 'business_one'), { initializedAt: 1 }),
        setDoc(doc(db, 'responseQuotaScopes', 'business_one', 'periods', 'initial'), { includedResponses: 700 }),
        setDoc(doc(db, 'responseQuotaTurns', 'synthetic-turn'), { status: 'reserved' }),
        setDoc(doc(db, 'whatsappNumbers', 'synthetic-number'), { businessId: 'one', enabled: false }),
        setDoc(doc(db, 'whatsappBusinesses', 'one'), { phoneNumberId: 'synthetic-number' }),
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
  it('keeps the global AI selection private and rejects direct browser changes, including forged admin claims', async () => {
    const contexts = [
      environment.unauthenticatedContext(),
      environment.authenticatedContext('owner-one'),
      environment.authenticatedContext('stale-admin', { role:'superadmin', isSuperadmin:true }),
    ];
    for (const context of contexts) {
      const db = context.firestore();
      await assertFails(getDoc(doc(db,'serverSettings','ai')));
      await assertFails(getDocs(collection(db,'serverSettings')));
      await assertFails(updateDoc(doc(db,'serverSettings','ai'),{provider:'deepseek'}));
      await assertFails(setDoc(doc(db,'serverSettings','other'),{provider:'deepseek'}));
    }
  });
  it('keeps usage records and aggregates private even from the business owner and forged admin claims', async () => {
    for (const context of [environment.unauthenticatedContext(), environment.authenticatedContext('owner-one'), environment.authenticatedContext('stale-admin', { role:'superadmin', isSuperadmin:true })]) {
      const db = context.firestore();
      for (const path of ['aiUsageCalls/synthetic-call', 'aiUsageMonths/2026-10', 'aiUsageMonths/2026-10/businesses/one', 'aiUsageMeta/main', 'aiUsageCalls/openai_synthetic-call', 'aiUsageMonths/openai_2026-10', 'aiUsageMonths/openai_2026-10/businesses/one', 'aiUsageMeta/openai']) {
        await assertFails(getDoc(doc(db, path)));
        await assertFails(setDoc(doc(db, path), { calls:0 }));
      }
      await assertFails(getDocs(collection(db, 'aiUsageCalls')));
      await assertFails(getDocs(collection(db, 'aiUsageMonths/2026-10/businesses')));
      await assertFails(getDocs(collection(db, 'aiUsageMonths/openai_2026-10/businesses')));
    }
  });
  it('denies direct quota and WhatsApp configuration access even to owners and forged administrators', async () => {
    for (const context of [environment.unauthenticatedContext(), environment.authenticatedContext('owner-one'), environment.authenticatedContext('stale-admin', { role: 'superadmin', isSuperadmin: true })]) {
      const db = context.firestore();
      for (const path of ['responseQuotaScopes/business_one', 'responseQuotaScopes/business_one/periods/initial', 'responseQuotaTurns/synthetic-turn', 'whatsappNumbers/synthetic-number', 'whatsappBusinesses/one', 'whatsappInbox/synthetic', 'whatsappOutbox/synthetic', 'whatsappConversations/synthetic', 'whatsappMessageIds/synthetic', 'whatsappUsage/2026-10', 'whatsappUsage/2026-10/businesses/one']) {
        await assertFails(getDoc(doc(db, path)));
        await assertFails(setDoc(doc(db, path), { enabled: true, includedResponses: 999999 }));
      }
      await assertFails(getDocs(collection(db, 'responseQuotaScopes')));
      await assertFails(getDocs(collection(db, 'responseQuotaTurns')));
      await assertFails(getDocs(collection(db, 'whatsappNumbers')));
    }
  });
});
