import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { memoryFirestore } from './memoryFirestore';
import { assertConsent, consentDocuments, consentInputSchema, consentStateKey, preauthorizeAccount, readConsent, readVerifiedConsentAnchor, updateConsent } from '@/lib/server/consent';
import type { ConsentDocuments, ConsentScope } from '@/lib/legal';
import { historicalAccount, historicalBusiness } from './fixtures/consent-2026-10-18.1';
import { createHash } from 'node:crypto';
import type { ConsentAnchor, PlatformActor } from '../shared/platform-whatsapp-authorization';

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Exact<T extends true> = T;
type AnchorContract = Exact<Equal<ConsentAnchor, { revision: number; fingerprint: string; receiptId: string }>>;
type ActorContract = Exact<Equal<PlatformActor, { uid: string; linkId: string; linkRevision: number; account: ConsentAnchor; support: ConsentAnchor; connectionRevision: number; conversationRevision: number }>>;
// A missing read anchor cannot be passed as an authorized actor's immutable receipt.
const nullableAnchor = { revision: 0, fingerprint: 'a'.repeat(64), receiptId: null };
// @ts-expect-error A nullable receipt is not a verified ConsentAnchor.
const invalidAnchor: ConsentAnchor = nullableAnchor;
void (null as unknown as AnchorContract | ActorContract); void invalidAnchor;

const now = Date.parse('2030-01-01T12:00:00Z');
const user = { uid: 'client', email: 'client@example.test', name: 'Cliente' };
const business = { id: 'shop', name: 'Negocio Uno', phoneWhatsApp: '573001234567' };
const setup = () => memoryFirestore({ 'businesses/shop': business });
type Db = ReturnType<typeof setup>['db'];
async function accept(db: Db, scope: 'account' | 'business_client' = 'account', requestId = 'accept-initial', expectedRevision = 0) {
  const current = await readConsent(user.uid, scope, scope === 'account' ? undefined : business, db);
  return updateConsent(user, { scope, ...(scope === 'business_client' ? { businessId: business.id } : {}), action: 'accept', requestId, expectedRevision, fingerprint: current.documents.fingerprint, termsAccepted: true, dataAuthorized: true,
    ...(scope === 'account' ? { preauthorization: preauthorizeAccount({ termsAccepted: true, dataAuthorized: true, fingerprint: current.documents.fingerprint }).token } : {}),
  }, db);
}

describe('explicit versioned consent', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(now); });
  afterEach(() => vi.useRealTimers());

  it('fingerprints the published documents independently for account and a named synthetic business', () => {
    // Independently reconstructed from the published literal AST, with recursively sorted keys.
    expect(historicalAccount.fingerprint).toBe('0266cade348f0cea94ea79d38d69f8a597e36d19dcdce7ddceab8caef575fcb7');
    expect(historicalBusiness.fingerprint).toBe('38e87d63418d061441185236b26fd5a88f19ee0e4ae319cf24df053ee816da11');
    function canonical(value: unknown): unknown { return Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => [key, canonical(item)])) : value; }
    for (const { fingerprint, ...content } of [historicalAccount, historicalBusiness]) expect(createHash('sha256').update(JSON.stringify(canonical(content))).digest('hex')).toBe(fingerprint);
  });

  it('denies missing consent without manufacturing a profile or acceptance', async () => {
    const { db, rows } = setup();
    expect(await readConsent(user.uid, 'account', undefined, db)).toMatchObject({ active: false, revision: 0 });
    await expect(assertConsent(user.uid, 'account', undefined, db)).rejects.toMatchObject({ status: 428, code: 'CONSENT_REQUIRED' });
    expect([...rows.keys()]).toEqual(['businesses/shop']);
  });

  it('requires both affirmative decisions and the exact current document fingerprint', async () => {
    const { db } = setup();
    const status = await readConsent(user.uid, 'account', undefined, db);
    const input = { scope: 'account' as const, action: 'accept' as const, requestId: 'invalid-input', expectedRevision: 0, fingerprint: status.documents.fingerprint, termsAccepted: true, dataAuthorized: false };
    await expect(updateConsent(user, input, db)).rejects.toBeDefined();
    expect(() => preauthorizeAccount({ ...input, dataAuthorized: false } as never)).toThrow();
    expect(() => preauthorizeAccount({ termsAccepted: true, dataAuthorized: true, fingerprint: 'a'.repeat(64) })).toThrow();
    await expect(updateConsent(user, { ...input, dataAuthorized: true, fingerprint: 'a'.repeat(64) }, db)).rejects.toBeDefined();
  });

  it('persists immutable document snapshots, explicit choices and server dates and creates a profile only on account acceptance', async () => {
    const { db, rows } = setup();
    const result = await accept(db);
    expect(result).toMatchObject({ active: true, revision: 1, receipt: { uid: user.uid, action: 'accept', termsAccepted: true, dataAuthorized: true, occurredAt: now, preauthorizedAt: now } });
    expect(result.receipt?.documents.terms).toContain('Sarin');
    expect(result.receipt?.documents.dataAuthorization).toContain('ALS Dev Studio');
    expect(result.receipt?.documents.privacy).toContain('7005674733');
    expect(rows.get('users/client')?.data).toMatchObject({ uid: 'client', email: user.email });
    await expect(assertConsent(user.uid, 'account', undefined, db)).resolves.toBeUndefined();
    expect([...rows.keys()].filter(path => path.startsWith('serverSettings/consent_receipt_'))).toHaveLength(1);
  });

  it('requires separate scope per UID and business and invalidates changes to the named business', async () => {
    const { db } = setup(); await accept(db);
    await expect(assertConsent(user.uid, 'business_client', business, db)).rejects.toMatchObject({ code: 'CONSENT_REQUIRED' });
    await accept(db, 'business_client');
    await expect(assertConsent(user.uid, 'business_client', business, db)).resolves.toBeUndefined();
    await expect(assertConsent('other', 'business_client', business, db)).rejects.toMatchObject({ code: 'CONSENT_REQUIRED' });
    await expect(assertConsent(user.uid, 'business_client', { ...business, id: 'other' }, db)).rejects.toMatchObject({ code: 'CONSENT_REQUIRED' });
    await expect(assertConsent(user.uid, 'business_client', { ...business, name: 'Changed' }, db)).rejects.toMatchObject({ code: 'CONSENT_REQUIRED' });
  });

  it('does not reactivate revocation when the original acceptance request is retried', async () => {
    const { db, rows } = setup();
    const status = await readConsent(user.uid, 'account', undefined, db);
    const input = { scope: 'account' as const, action: 'accept' as const, requestId: 'accept-once', expectedRevision: 0, fingerprint: status.documents.fingerprint, termsAccepted: true, dataAuthorized: true, preauthorization: preauthorizeAccount({ termsAccepted: true, dataAuthorized: true, fingerprint: status.documents.fingerprint }).token };
    await updateConsent(user, input, db);
    vi.setSystemTime(now + 1000);
    await updateConsent(user, { scope: 'account', action: 'revoke', requestId: 'revoke-once', expectedRevision: 1 }, db);
    vi.setSystemTime(now + 2 * 86400000);
    expect(await updateConsent(user, input, db)).toMatchObject({ active: false, revision: 2, receipt: { action: 'revoke', occurredAt: now + 1000 } });
    expect([...rows.keys()].filter(path => path.startsWith('serverSettings/consent_receipt_'))).toHaveLength(2);
    await expect(assertConsent(user.uid, 'account', undefined, db)).rejects.toMatchObject({ code: 'CONSENT_REQUIRED' });
  });

  it('rejects stale revision and conflicting request replay without overwriting the current decision', async () => {
    const { db } = setup(); await accept(db);
    await expect(updateConsent(user, { scope: 'account', action: 'revoke', requestId: 'stale-revoke', expectedRevision: 0 }, db)).rejects.toMatchObject({ status: 409 });
    await expect(updateConsent(user, { scope: 'account', action: 'revoke', requestId: 'accept-initial', expectedRevision: 1 }, db)).rejects.toMatchObject({ status: 409 });
    expect(await readConsent(user.uid, 'account', undefined, db)).toMatchObject({ active: true, revision: 1 });
  });

  it('serializes simultaneous account decisions with the same expected revision', async () => {
    const { db } = setup();
    const results = await Promise.allSettled([accept(db, 'account', 'accept-first'), accept(db, 'account', 'accept-second')]);
    expect(results.filter(item => item.status === 'fulfilled')).toHaveLength(1);
    expect(await readConsent(user.uid, 'account', undefined, db)).toMatchObject({ active: true, revision: 1 });
  });

  it('rejects tampered and expired preauthorization and does not allow a signed decision to be claimed by two users', async () => {
    const { db } = setup(), status = await readConsent(user.uid, 'account', undefined, db);
    const proof = preauthorizeAccount({ termsAccepted: true, dataAuthorized: true, fingerprint: status.documents.fingerprint }).token;
    const input = { scope: 'account' as const, action: 'accept' as const, requestId: 'claim-proof', expectedRevision: 0, fingerprint: status.documents.fingerprint, termsAccepted: true, dataAuthorized: true, preauthorization: proof };
    await expect(updateConsent(user, { ...input, preauthorization: proof + 'x' }, db)).rejects.toMatchObject({ status: 428 });
    await updateConsent(user, input, db);
    await expect(updateConsent({ uid: 'other' }, { ...input, requestId: 'other-claim' }, db)).rejects.toMatchObject({ status: 409 });
    await updateConsent(user, { scope: 'account', action: 'revoke', requestId: 'revoke-proof', expectedRevision: 1 }, db);
    await expect(updateConsent(user, { ...input, requestId: 'claim-again', expectedRevision: 2 }, db)).rejects.toMatchObject({ status: 409 });
    vi.setSystemTime(now + 1200001);
    await expect(updateConsent({ uid: 'third' }, input, db)).rejects.toMatchObject({ status: 428 });
  });

  it('fails closed for malformed private state and records no conversation or IP', async () => {
    const { db, rows } = setup(); await accept(db);
    expect(JSON.stringify([...rows])).not.toMatch(/messages|clientPhone|ipAddress/);
    const key = [...rows.keys()].find(path => path.startsWith('serverSettings/consent_state_'))!;
    await db.collection('serverSettings').doc(key.split('/')[1]).set({ active: true, revision: 'corrupt' });
    await expect(assertConsent(user.uid, 'account', undefined, db)).rejects.toMatchObject({ status: 503 });
  });

  it('does not allow a missing or inconsistent immutable receipt to authorize processing', async () => {
    const { db, rows } = setup(); await accept(db);
    const key = [...rows.keys()].find(path => path.startsWith('serverSettings/consent_receipt_'))!;
    const ref = db.collection('serverSettings').doc(key.split('/')[1]);
    const receipt = (await ref.get()).data()!;
    await ref.set({ ...receipt, dataAuthorized: false });
    await expect(assertConsent(user.uid, 'account', undefined, db)).rejects.toMatchObject({ status: 503 });
    await ref.delete();
    await expect(assertConsent(user.uid, 'account', undefined, db)).rejects.toMatchObject({ status: 503 });
  });

  it('validates receipt content independently of stored map key order while still detecting changed text', async () => {
    const { db, rows } = setup(); await accept(db);
    const key = [...rows.keys()].find(path => path.startsWith('serverSettings/consent_receipt_'))!;
    const ref = db.collection('serverSettings').doc(key.split('/')[1]), receipt = (await ref.get()).data()!;
    function reorder(value: unknown): unknown {
      if (Array.isArray(value)) return value.map(reorder);
      if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).reverse().map(([key, item]) => [key, reorder(item)]));
      return value;
    }
    await ref.set(reorder(receipt) as object);
    await expect(assertConsent(user.uid, 'account', undefined, db)).resolves.toBeUndefined();
    await ref.set({ ...receipt, documents: { ...receipt.documents, notice: 'Changed text' } });
    await expect(assertConsent(user.uid, 'account', undefined, db)).rejects.toMatchObject({ status: 503 });
  });
});

const support = 'platform_support' as ConsentScope;
async function supportInput(db: Db, requestId = 'support-accept', expectedRevision = 0) {
  const current = await readConsent(user.uid, support, undefined, db);
  return { scope: support, action: 'accept' as const, requestId, expectedRevision, fingerprint: current.documents.fingerprint, termsAccepted: true, dataAuthorized: true };
}
async function seedHistorical(db: Db, documents: ConsentDocuments, receiptId = 'demo-historical-receipt') {
  const businessId = documents.business?.id ?? null;
  const receipt = { uid: user.uid, scope: documents.scope, businessId, requestId: 'demo-historical', action: 'accept', revision: 4, occurredAt: now - 1000, preauthorizedAt: null, termsAccepted: true, dataAuthorized: true, documents };
  await db.collection('serverSettings').doc(receiptId).set(receipt);
  await db.collection('serverSettings').doc(consentStateKey(user.uid, documents.scope, businessId)).set({ version: 1, uid: user.uid, scope: documents.scope, businessId, revision: 4, active: true, fingerprint: documents.fingerprint, receiptId });
  return receipt;
}
describe('independent platform support consent', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(now); });
  afterEach(() => vi.useRealTimers());
  it('accepts the support schema with no business and rejects scope, identity and business injection', () => {
    const body = { scope: support, action: 'accept', requestId: 'demo-schema', expectedRevision: 0, fingerprint: 'a'.repeat(64), termsAccepted: true, dataAuthorized: true };
    expect(consentInputSchema.safeParse(body).success).toBe(true);
    for (const extra of [{ businessId: 'shop' }, { businessId: null }, { uid: 'other' }, { occurredAt: 1 }, { actor: {} }, { effect: 'send' }]) expect(consentInputSchema.safeParse({ ...body, ...extra }).success).toBe(false);
    for (const value of [{ ...body, scope: 'unknown' }, { ...body, scope: 'account', businessId: 'shop' }, { ...body, scope: 'business_client' }, { ...body, scope: 'business_client', businessId: '../bad' }]) expect(consentInputSchema.safeParse(value).success).toBe(false);
  });
  it('offers a separate platform decision without a business or profile', async () => {
    const { db, rows } = setup();
    await expect(readConsent(user.uid, support, undefined, db)).resolves.toMatchObject({ active: false, revision: 0, receipt: null, documents: { version: '2026-10-21.1', scope: 'platform_support', business: null } });
    expect([...rows.keys()]).toEqual(['businesses/shop']);
  });
  it.each(['missing', 'revoked', 'obsolete'] as const)('blocks support acceptance with %s account consent before writes', async state => {
    const { db, rows } = setup();
    if (state === 'revoked') { await accept(db); await updateConsent(user, { scope: 'account', action: 'revoke', requestId: 'revoke-account', expectedRevision: 1 }, db); }
    if (state === 'obsolete') await seedHistorical(db, historicalAccount as unknown as ConsentDocuments);
    const before = structuredClone([...rows]);
    // Runtime assertion reaches the actual schema/transaction rather than depending on a new type import.
    await expect(updateConsent(user, await supportInput(db, 'demo-denied'), db)).rejects.toMatchObject({ status: 428 });
    expect([...rows]).toEqual(before);
  });
  it('accepts support without account proof, changes only support records, and isolates UID and business permission', async () => {
    const { db, rows } = setup(); await accept(db);
    const before = structuredClone([...rows]);
    const input = await supportInput(db);
    const result = await updateConsent(user, input, db);
    expect(result).toMatchObject({ active: true, revision: 1, receipt: { scope: 'platform_support', businessId: null, preauthorizedAt: null } });
    for (const [path, value] of before) expect(rows.get(path)).toEqual(value);
    expect([...rows.keys()].filter(path => !before.some(([old]) => old === path))).toHaveLength(2);
    await expect(assertConsent(user.uid, 'business_client', business, db)).rejects.toMatchObject({ status: 428 });
    expect(await readConsent('other', support, undefined, db)).toMatchObject({ active: false, revision: 0 });
    await updateConsent(user, { scope: support, action: 'revoke', requestId: 'support-withdraw', expectedRevision: 1 }, db);
    expect(await readConsent(user.uid, 'account', undefined, db)).toMatchObject({ active: true, revision: 1 });
  });
  it('does not substitute business acceptance for support and permits support withdrawal after account revocation', async () => {
    const { db } = setup(); await accept(db); await accept(db, 'business_client');
    await expect(assertConsent(user.uid, support, undefined, db)).rejects.toMatchObject({ status: 428 });
    await updateConsent(user, await supportInput(db), db);
    await updateConsent(user, { scope: 'account', action: 'revoke', requestId: 'account-stop', expectedRevision: 1 }, db);
    expect(await updateConsent(user, { scope: support, action: 'revoke', requestId: 'support-stop', expectedRevision: 1 }, db)).toMatchObject({ active: false, revision: 2 });
    expect(await readConsent(user.uid, 'business_client', business, db)).toMatchObject({ active: true, revision: 1 });
  });
  it('requires both choices, current documents and revision, while preserving replay across revoke/reaccept', async () => {
    const { db, rows } = setup(); await accept(db); const input = await supportInput(db);
    for (const change of [{ termsAccepted: false }, { dataAuthorized: false }, { fingerprint: 'b'.repeat(64) }]) await expect(updateConsent(user, { ...input, ...change }, db)).rejects.toMatchObject({ status: 428 });
    expect(await updateConsent(user, input, db)).toMatchObject({ active: true, revision: 1 });
    expect(await updateConsent(user, input, db)).toMatchObject({ active: true, revision: 1 });
    await expect(updateConsent(user, { ...input, dataAuthorized: false }, db)).rejects.toMatchObject({ status: 409 });
    await expect(updateConsent(user, { scope: support, action: 'revoke', requestId: 'stale-support', expectedRevision: 0 }, db)).rejects.toMatchObject({ status: 409 });
    const revoke = { scope: support, action: 'revoke' as const, requestId: 'revoke-support', expectedRevision: 1 };
    await updateConsent(user, revoke, db);
    expect(await updateConsent(user, input, db)).toMatchObject({ active: false, revision: 2 });
    await updateConsent(user, await supportInput(db, 'support-renew', 2), db);
    expect(await updateConsent(user, revoke, db)).toMatchObject({ active: true, revision: 3 });
    expect([...rows.values()].filter(row => row.data.scope === support && row.data.action)).toHaveLength(3);
  });
  it('rechecks account acceptance in the support transaction before creating its receipt', async () => {
    const { db, rows } = setup(); await accept(db); const input = await supportInput(db);
    let resume!: () => void, reached!: () => void, paused = false;
    const wait = new Promise<void>(resolve => { resume = resolve; }), ready = new Promise<void>(resolve => { reached = resolve; });
    const accountPath = `serverSettings/${consentStateKey(user.uid, 'account')}`;
    const guarded = { collection: db.collection.bind(db), runTransaction: (handler: Parameters<Db['runTransaction']>[0]) => db.runTransaction(tx => {
      let wrote = false;
      return handler({ ...tx, get: async (target: { path?: string }) => {
        if (wrote) throw new Error('Read after write');
        const result = await tx.get(target as never);
        if (!paused && target.path === accountPath) { paused = true; reached(); await wait; }
        return result;
      }, create: (...args: Parameters<typeof tx.create>) => { wrote = true; return tx.create(...args); }, set: (...args: Parameters<typeof tx.set>) => { wrote = true; return tx.set(...args); } } as never);
    }) } as unknown as Db;
    const accepting = updateConsent(user, input, guarded);
    await ready;
    await updateConsent(user, { scope: 'account', action: 'revoke', requestId: 'race-account-stop', expectedRevision: 1 }, db); resume();
    await expect(accepting).rejects.toMatchObject({ status: 428 });
    expect([...rows.values()].some(row => row.data.scope === support)).toBe(false);
  });
  it.each([historicalAccount, historicalBusiness])('keeps frozen .1 $scope receipts readable but inactive and appends a fresh decision', async frozen => {
    const { db, rows } = setup(); const documents = frozen as unknown as ConsentDocuments;
    const old = await seedHistorical(db, documents); const persisted = structuredClone(rows.get('serverSettings/demo-historical-receipt'));
    const status = await readConsent(user.uid, documents.scope, documents.business ?? undefined, db);
    expect(status).toMatchObject({ active: false, revision: 4, documents: { version: '2026-10-18.2' }, receipt: old });
    await expect(assertConsent(user.uid, documents.scope, documents.business ?? undefined, db)).rejects.toMatchObject({ status: 428 });
    const anchor = await db.runTransaction(tx => readVerifiedConsentAnchor(user.uid, documents.scope, documents.business ?? undefined, db, tx));
    expect(anchor).toEqual({ active: false, revision: 4, fingerprint: documents.fingerprint, receiptId: 'demo-historical-receipt' });
    if (documents.scope === 'business_client') { await accept(db); await db.collection('businesses').doc(documents.business!.id).set(documents.business!); }
    const current = status.documents;
    await updateConsent(user, { scope: documents.scope, ...(documents.business ? { businessId: documents.business.id } : {}), action: 'accept', requestId: 'fresh-version', expectedRevision: 4, fingerprint: current.fingerprint, termsAccepted: true, dataAuthorized: true, ...(documents.scope === 'account' ? { preauthorization: preauthorizeAccount({ fingerprint: current.fingerprint, termsAccepted: true, dataAuthorized: true }).token } : {}) }, db);
    expect(rows.get('serverSettings/demo-historical-receipt')).toEqual(persisted);
    expect(await readConsent(user.uid, documents.scope, documents.business ?? undefined, db)).toMatchObject({ active: true, revision: 5, receipt: { documents: { version: '2026-10-18.2' } } });
  });
  it('rejects tampered frozen history and represents a missing receipt as a nullable anchor', async () => {
    const { db } = setup();
    expect(await db.runTransaction(tx => readVerifiedConsentAnchor(user.uid, 'account', undefined, db, tx))).toMatchObject({ active: false, revision: 0, receiptId: null });
    const old = await seedHistorical(db, historicalAccount as unknown as ConsentDocuments);
    await db.collection('serverSettings').doc('demo-historical-receipt').set({ ...old, documents: { ...old.documents, notice: 'tampered' } });
    await expect(readConsent(user.uid, 'account', undefined, db)).rejects.toMatchObject({ status: 503 });
    await expect(db.runTransaction(tx => readVerifiedConsentAnchor(user.uid, 'account', undefined, db, tx))).rejects.toMatchObject({ status: 503 });
  });
});
