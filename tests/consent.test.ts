import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { memoryFirestore } from './memoryFirestore';
import { assertConsent, preauthorizeAccount, readConsent, updateConsent } from '@/lib/server/consent';

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
});
