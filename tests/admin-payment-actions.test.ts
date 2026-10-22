import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { DecodedIdToken } from 'firebase-admin/auth';
import type { Database, Transaction } from '@/lib/storage/types';
import { memoryFirestore } from './memoryFirestore';
import { readPaymentReviewReceipt, reviewPayment } from '@/lib/server/billing';
const auth = vi.hoisted(() => ({ getUser: vi.fn() }));
vi.mock('@/lib/firebase/admin', () => ({ getAdminDb: () => { throw new Error('Default backend forbidden'); }, getAdminAuth: () => auth }));
import { preparePaymentAction, confirmPaymentAction, readPaymentAction, paymentActionResult } from '@/lib/server/admin-payment-actions';
const now = Date.parse('2030-01-01T12:00:00Z');
const actor = { uid: 'demo-admin', auth_time: now / 1000 } as DecodedIdToken;
const requestId = '11111111-1111-4111-8111-111111111111';
const command = { requestId, expectedRevision: 1, confirmed: true as const };
export const paymentFixture = () => ({
  'businesses/demo-business': { id: 'demo-business', ownerUid: 'demo-owner', name: 'Demo business', createdAt: 1, subscription: { status: 'past_due', trialEndsAt: 0, currentPeriodEndsAt: 0, lastPaymentId: 'demo-payment' } },
  'paymentReceipts/demo-payment': { id: 'demo-payment', tenantId: 'demo-business', ownerUid: 'demo-owner', status: 'pending', amountCOP: 49000, submittedAt: 1 },
});
const prepareInput = { paymentId: 'demo-payment', action: 'approve' as const, requestId };
beforeEach(() => { vi.spyOn(Date, 'now').mockReturnValue(now); vi.stubEnv('SUPERADMIN_UID', actor.uid); vi.stubEnv('ADMIN_PAYMENT_ACTION_KEY', Buffer.alloc(32, 2).toString('base64')); auth.getUser.mockReset().mockImplementation(async uid => ({ uid, disabled: false })); });
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

it('reviews WhatsApp payment against the supplied database without opening the default backend', async () => {
  for (const [key, value] of Object.entries({ WHATSAPP_ENABLED: 'true', WHATSAPP_RETENTION_ENABLED: 'true', WHATSAPP_APP_SECRET: 'synthetic-app-secret', WHATSAPP_VERIFY_TOKEN: 'synthetic-verify-token', WHATSAPP_CONTENT_KEY: Buffer.alloc(32, 1).toString('base64'), WHATSAPP_PHONE_CREDENTIALS_JSON: JSON.stringify({ '12345678': { wabaId: '87654321', accessToken: 'synthetic-token' } }) })) vi.stubEnv(key, value);
  const { db } = memoryFirestore({
    'businesses/demo-business': { id: 'demo-business', ownerUid: 'demo-owner', name: 'Demo', createdAt: 1, subscription: { status: 'past_due', trialEndsAt: 0, currentPeriodEndsAt: 0 } },
    'paymentReceipts/demo-payment': { id: 'demo-payment', tenantId: 'demo-business', ownerUid: 'demo-owner', status: 'pending', kind: 'subscription', planId: 'whatsapp', periodDays: 30, amountCOP: 1000, submittedAt: 1 },
    'whatsappBusinesses/demo-business': { phoneNumberId: '12345678' },
    'whatsappNumbers/12345678': { businessId: 'demo-business', phoneNumberId: '12345678', wabaId: '87654321', enabled: true, verifiedAt: 1, updatedAt: 1 },
  });
  await expect(reviewPayment('demo-payment', 'approve', undefined, db)).resolves.toMatchObject({ receipt: { status: 'approved' } });
});

it('prepares exactly five minutes, preserves the original index result and rehydrates one canonical effect', async () => {
  const { db, rows } = memoryFirestore(paymentFixture());
  const first = await preparePaymentAction(actor, prepareInput, db);
  expect(first.expiresAt - now).toBe(300_000);
  expect(first.id).toMatch(/^[a-f0-9-]{36}$/);
  vi.mocked(Date.now).mockReturnValue(now + 1000);
  expect(await preparePaymentAction(actor, prepareInput, db)).toEqual(first);
  expect(rows.get('paymentReceipts/demo-payment')!.data.status).toBe('pending');
  const applied = await confirmPaymentAction(actor, first.id, command, db);
  const again = await confirmPaymentAction(actor, first.id, { ...command, requestId: '22222222-2222-4222-8222-222222222222' }, db);
  expect(again).toEqual(applied);
  expect(applied.business.subscription.currentPeriodEndsAt).toBe(now + 1000 + 30 * 86400000);
  expect([...rows.keys()].filter(p => p.includes('/periods/payment_'))).toHaveLength(1);
  expect(rows.get('adminPaymentActions/' + first.id)!.data).toMatchObject({ state: 'executed', reason: null, effectId: 'demo-payment' });
  await db.collection('businesses').doc('demo-business').set({ ...applied.business, name: 'Current authorized name' });
  expect((await confirmPaymentAction(actor, first.id, command, db)).business.name).toBe('Current authorized name');
});
it.each([300_000, 300_001])('rejects proposal validity equality/beyond at %s without an effect', async elapsed => {
  const { db, rows } = memoryFirestore(paymentFixture());
  const p = await preparePaymentAction(actor, prepareInput, db);
  vi.mocked(Date.now).mockReturnValue(now + elapsed);
  const recent = { ...actor, auth_time: (now + elapsed - elapsed % 1000) / 1000 } as DecodedIdToken;
  await expect(confirmPaymentAction(recent, p.id, command, db)).rejects.toMatchObject({ status: 409 });
  expect((await readPaymentAction(recent, p.id, db)).proposal.state).toBe('expired');
  expect(rows.get('paymentReceipts/demo-payment')!.data.status).toBe('pending');
});
it.each(['', ' ', 'x'.repeat(501)])('requires an explicit bounded trimmed rejection reason', async rejectionReason => {
  const { db, rows } = memoryFirestore(paymentFixture());
  await expect(preparePaymentAction(actor, { ...prepareInput, action: 'reject', rejectionReason }, db)).rejects.toThrow();
  expect([...rows.keys()].filter(p => p.startsWith('adminPaymentActions/'))).toHaveLength(0);
});
it('encrypts transient rejection content and erases it on execution without snapshots or images', async () => {
  const { db, rows } = memoryFirestore(paymentFixture());
  const p = await preparePaymentAction(actor, { ...prepareInput, action: 'reject', rejectionReason: 'Motivo privado sintético' }, db);
  const controls = () => [...rows].filter(([path]) => path.startsWith('adminPaymentActions/'));
  expect(JSON.stringify(controls())).not.toContain('Motivo privado');
  expect(await readPaymentAction(actor, p.id, db)).toMatchObject({ rejectionReason: 'Motivo privado sintético' });
  await confirmPaymentAction(actor, p.id, command, db);
  expect(rows.get('adminPaymentActions/' + p.id)!.data.reason).toBeNull();
  expect(JSON.stringify(controls())).not.toMatch(/receiptDataUrl|ownerEmail|tenantName|phoneWhatsApp/);
});
it.each(['disabled', 'deleted', 'cutoff', 'foreign', 'future', 'old'] as const)('checks current %s identity and recent auth before confirmation', async loss => {
  const { db, rows } = memoryFirestore(paymentFixture());
  const p = await preparePaymentAction(actor, prepareInput, db);
  if (loss === 'disabled') auth.getUser.mockResolvedValue({ uid: actor.uid, disabled: true });
  if (loss === 'deleted') auth.getUser.mockRejectedValue(new Error('deleted'));
  if (loss === 'cutoff') auth.getUser.mockResolvedValue({ uid: actor.uid, tokensValidAfterTime: new Date(now + 1000).toISOString() });
  const testActor = loss === 'foreign' ? { ...actor, uid: 'demo-other' } : loss === 'future' ? { ...actor, auth_time: actor.auth_time + 1 } : loss === 'old' ? { ...actor, auth_time: actor.auth_time - 300 } : actor;
  await expect(confirmPaymentAction(testActor as DecodedIdToken, p.id, command, db)).rejects.toMatchObject({ status: loss === 'foreign' ? 403 : loss === 'old' ? 428 : 401 });
  expect(rows.get('paymentReceipts/demo-payment')!.data.status).toBe('pending');
});
it.each(['amountCOP', 'planId', 'periodDays', 'responseAllowance', 'appointmentAllowance', 'quotaPeriodId', 'submittedAt', 'kind', 'ownerUid', 'tenantId', 'id', 'status', 'reviewedAt', 'rejectionReason'])('invalidates changed receipt dependency %s', async field => {
  const { db, rows } = memoryFirestore(paymentFixture());
  const p = await preparePaymentAction(actor, prepareInput, db), original = rows.get('paymentReceipts/demo-payment')!.data;
  await db.collection('paymentReceipts').doc('demo-payment').set({ ...original, [field]: ['amountCOP', 'periodDays', 'responseAllowance', 'appointmentAllowance', 'submittedAt'].includes(field) ? 99 : 'changed' });
  await expect(confirmPaymentAction(actor, p.id, command, db)).rejects.toMatchObject({ status: 409 });
});
it.each(['status', 'trialEndsAt', 'currentPeriodEndsAt', 'graceEndsAt', 'graceGrantedAt', 'lastPaymentId', 'paidTrial'])('invalidates changed subscription dependency %s', async field => {
  const { db, rows } = memoryFirestore(paymentFixture());
  const p = await preparePaymentAction(actor, prepareInput, db), b = rows.get('businesses/demo-business')!.data;
  await db.collection('businesses').doc('demo-business').set({ ...b, subscription: { ...(b.subscription as object), [field]: field === 'paidTrial' ? { source: 'payment', paymentId: 'other', activatedAt: 1, appointmentLimit: 10, appointmentsUsed: 1 } : field === 'status' || field === 'lastPaymentId' ? 'changed' : 99 } });
  await expect(confirmPaymentAction(actor, p.id, command, db)).rejects.toMatchObject({ status: 409 });
});
it.each(['id', 'name', 'createdAt', 'ownerUid'])('invalidates changed business dependency %s', async field => {
  const { db, rows } = memoryFirestore(paymentFixture());
  const p = await preparePaymentAction(actor, prepareInput, db), b = rows.get('businesses/demo-business')!.data;
  await db.collection('businesses').doc('demo-business').set({ ...b, [field]: field === 'createdAt' ? 2 : 'changed' });
  await expect(confirmPaymentAction(actor, p.id, command, db)).rejects.toMatchObject({ status: 409 });
});
it('excludes unrelated contact, images and current offer price; projection has only safe fields', async () => {
  const { db, rows } = memoryFirestore(paymentFixture());
  const p = await preparePaymentAction(actor, prepareInput, db), b = rows.get('businesses/demo-business')!.data;
  await db.collection('businesses').doc('demo-business').set({ ...b, ownerEmail: 'private@example.test', phoneWhatsApp: 'private-contact' });
  await db.collection('platformSettings').doc('main').set({ monthlyPriceCOP: 99999 });
  await db.collection('paymentReceipts').doc('demo-payment').set({ ...rows.get('paymentReceipts/demo-payment')!.data, receiptImageUrl: 'private-image' });
  expect(JSON.stringify(await readPaymentAction(actor, p.id, db))).not.toMatch(/private-|ownerUid|actorUid|contextFingerprint/);
  const result = await confirmPaymentAction(actor, p.id, command, db);
  expect(result.receipt.amountCOP).toBe(49000);
  expect(JSON.stringify(paymentActionResult(result))).not.toMatch(/private-|ownerUid|actorUid|contextFingerprint/);
});
it('rejects changed prepare input and recreates only a new UUID after index retention', async () => {
  const { db } = memoryFirestore(paymentFixture());
  const p = await preparePaymentAction(actor, prepareInput, db);
  await expect(preparePaymentAction(actor, { ...prepareInput, action: 'reject', rejectionReason: 'Explicit reason' }, db)).rejects.toMatchObject({ status: 409 });
  vi.mocked(Date.now).mockReturnValue(now + 2_592_000_000);
  const next = await preparePaymentAction({ ...actor, auth_time: (now + 2_592_000_000) / 1000 } as DecodedIdToken, prepareInput, db);
  expect(next.id).not.toBe(p.id);
});
it.each(['', Buffer.alloc(32, 3).toString('base64'), 'not-base64'])('fails closed with absent, changed or malformed dedicated key', async key => {
  const { db, rows } = memoryFirestore(paymentFixture());
  const p = await preparePaymentAction(actor, prepareInput, db);
  vi.stubEnv('ADMIN_PAYMENT_ACTION_KEY', key);
  await expect(confirmPaymentAction(actor, p.id, command, db)).rejects.toMatchObject({ status: 503 });
  expect(rows.get('paymentReceipts/demo-payment')!.data.status).toBe('pending');
});
it('reads all context before staging any write and never opens a nested transaction', async () => {
  const { db } = memoryFirestore(paymentFixture());
  let inside = false;
  const strict: Database = { collection: db.collection.bind(db), async runTransaction(handler) {
    expect(inside).toBe(false); inside = true;
    try { return await db.runTransaction(async raw => {
      const tx = raw as unknown as Transaction; let writes = false;
      return handler({ get: (async (target: never) => { expect(writes).toBe(false); return tx.get(target); }) as Transaction['get'], set: (...args) => { writes = true; return tx.set(...args); }, create: (...args) => { writes = true; return tx.create(...args); }, delete: (...args) => { writes = true; return tx.delete(...args); } });
    }); } finally { inside = false; }
  } };
  const p = await preparePaymentAction(actor, prepareInput, strict);
  await confirmPaymentAction(actor, p.id, command, strict);
});
it('preserves manual same-terminal replay without reading later malformed quota', async () => {
  const { db, rows } = memoryFirestore(paymentFixture());
  await reviewPayment('demo-payment', 'approve', undefined, db);
  const period = [...rows.keys()].find(p => p.includes('/periods/'))!;
  await db.collection('responseQuotaScopes').doc('business_demo-business').collection('periods').doc(period.split('/').at(-1)!).set({ startsAt: now, invalid: true });
  await expect(reviewPayment('demo-payment', 'approve', undefined, db)).resolves.toMatchObject({ receipt: { status: 'approved' } });
});
const period = (id: string, startsAt: number) => ({ id, source: 'subscription', planId: 'monthly', startsAt, endsAt: now + 100000, includedResponses: 3000, extraResponses: 1, usedResponses: 2, reservedResponses: 3 });
it.each(['current', 'next'].flatMap(which => ['id', 'source', 'planId', 'startsAt', 'endsAt', 'includedResponses', 'extraResponses', 'usedResponses', 'reservedResponses'].map(field => [which, field])))('invalidates %s quota field %s', async (which, field) => {
  const { db } = memoryFirestore(paymentFixture());
  const scope = db.collection('responseQuotaScopes').doc('business_demo-business'); await scope.set({ initializedAt: now });
  await scope.collection('periods').doc('current').set(period('current', now - 10000)); await scope.collection('periods').doc('next').set(period('next', now + 10000));
  const p = await preparePaymentAction(actor, prepareInput, db), reference = scope.collection('periods').doc(which), original = (await reference.get()).data()!;
  const changed = field === 'id' ? 'different' : field === 'source' ? 'legacy' : field === 'planId' ? 'weekly' : Number(original[field]) + 1;
  await reference.set({ ...original, [field]: changed });
  await expect(confirmPaymentAction(actor, p.id, command, db)).rejects.toMatchObject({ status: 409 });
});
it.each(['source', 'paymentId', 'invitationId', 'activatedAt', 'appointmentLimit', 'appointmentsUsed', 'accessSuspended'])('fingerprints complete paid trial field %s', async field => {
  const { db, rows } = memoryFirestore(paymentFixture()), b = rows.get('businesses/demo-business')!.data;
  const trial = { source: 'payment', paymentId: 'trial-payment', activatedAt: 100, appointmentLimit: 10, appointmentsUsed: 2 };
  await db.collection('businesses').doc('demo-business').set({ ...b, subscription: { ...(b.subscription as object), paidTrial: trial } });
  const p = await preparePaymentAction(actor, prepareInput, db);
  await db.collection('businesses').doc('demo-business').set({ ...b, subscription: { ...(b.subscription as object), paidTrial: { ...trial, [field]: field === 'accessSuspended' ? true : ['activatedAt', 'appointmentLimit', 'appointmentsUsed'].includes(field) ? 9 : 'changed' } } });
  await expect(confirmPaymentAction(actor, p.id, command, db)).rejects.toMatchObject({ status: 409 });
});
it('expires at the immediate pre-write boundary even when reads began while valid', async () => {
  const { db, rows } = memoryFirestore(paymentFixture());
  const p = await preparePaymentAction(actor, prepareInput, db);
  vi.mocked(Date.now).mockReturnValue(now + 200000);
  const recent = { ...actor, auth_time: (now + 200000) / 1000 } as DecodedIdToken;
  const delayed: Database = { collection: db.collection.bind(db), runTransaction: handler => db.runTransaction(raw => {
    const tx = raw as unknown as Transaction;
    return handler({ ...tx, get: (async (ref: { path?: string }) => { const value = await tx.get(ref as never); if (ref.path === 'responseQuotaScopes/business_demo-business') vi.mocked(Date.now).mockReturnValue(now + 300000); return value; }) as unknown as Transaction['get'] });
  }) };
  await expect(confirmPaymentAction(recent, p.id, command, delayed)).rejects.toMatchObject({ status: 409 });
  expect(rows.get('paymentReceipts/demo-payment')!.data.status).toBe('pending');
});
it('keeps fixed paid trial price and once-only rules through proposal confirmation', async () => {
  const { db, rows } = memoryFirestore(paymentFixture());
  await db.collection('paymentReceipts').doc('demo-payment').set({ ...rows.get('paymentReceipts/demo-payment')!.data, kind: 'paid_trial', amountCOP: 5000, appointmentAllowance: 10 });
  const p = await preparePaymentAction(actor, prepareInput, db); const result = await confirmPaymentAction(actor, p.id, command, db);
  expect(result.business.subscription.paidTrial).toMatchObject({ paymentId: 'demo-payment', appointmentLimit: 10, appointmentsUsed: 0 });
  await db.collection('paymentReceipts').doc('another').set({ ...result.receipt, id: 'another', status: 'pending', reviewedAt: undefined });
  await expect(preparePaymentAction(actor, { ...prepareInput, paymentId: 'another', requestId: '22222222-2222-4222-8222-222222222222' }, db)).rejects.toMatchObject({ status: 409 });
});
it.each(['businessId', 'phoneNumberId', 'wabaId', 'enabled', 'verifiedAt', 'updatedAt', 'index', 'config'])('invalidates exact WhatsApp readiness dependency %s', async field => {
  for (const [key, value] of Object.entries({ WHATSAPP_ENABLED: 'true', WHATSAPP_RETENTION_ENABLED: 'true', WHATSAPP_APP_SECRET: 'synthetic-app-secret', WHATSAPP_VERIFY_TOKEN: 'synthetic-verify-token', WHATSAPP_CONTENT_KEY: Buffer.alloc(32, 1).toString('base64'), WHATSAPP_PHONE_CREDENTIALS_JSON: JSON.stringify({ '12345678': { wabaId: '87654321', accessToken: 'synthetic-token' } }) })) vi.stubEnv(key, value);
  const { db, rows } = memoryFirestore(paymentFixture());
  await db.collection('paymentReceipts').doc('demo-payment').set({ ...rows.get('paymentReceipts/demo-payment')!.data, planId: 'whatsapp', periodDays: 30 });
  const binding = { businessId: 'demo-business', phoneNumberId: '12345678', wabaId: '87654321', enabled: true, verifiedAt: 1, updatedAt: 1 };
  await db.collection('whatsappBusinesses').doc('demo-business').set({ phoneNumberId: binding.phoneNumberId });
  await db.collection('whatsappNumbers').doc(binding.phoneNumberId).set(binding);
  const p = await preparePaymentAction(actor, prepareInput, db);
  if (field === 'config') vi.stubEnv('WHATSAPP_ENABLED', 'false');
  else if (field === 'index') await db.collection('whatsappBusinesses').doc('demo-business').set({ phoneNumberId: '12345679' });
  else await db.collection('whatsappNumbers').doc(binding.phoneNumberId).set({ ...binding, [field]: field === 'businessId' ? 'other-business' : field === 'enabled' ? false : field === 'verifiedAt' || field === 'updatedAt' ? 2 : '12345679' });
  await expect(confirmPaymentAction(actor, p.id, command, db)).rejects.toMatchObject({ status: 409 });
});
it('uses native metadata projection where the Firestore query supports it', async () => {
  const { db } = memoryFirestore(paymentFixture());
  let selected: string[] | null = null;
  const projected: Database = { collection: name => {
    const collection = (db as unknown as Database).collection(name);
    if (name !== 'paymentReceipts') return collection as unknown as ReturnType<Database['collection']>;
    const originalWhere = collection.where.bind(collection);
    collection.where = ((...args: Parameters<typeof originalWhere>) => {
      const query = originalWhere(...args), originalLimit = query.limit.bind(query);
      query.limit = ((...limits: Parameters<typeof originalLimit>) => {
        const limited = originalLimit(...limits) as ReturnType<typeof originalLimit> & { select: (...fields: string[]) => unknown };
        limited.select = (...fields) => { selected = fields; return limited; }; return limited;
      }) as typeof query.limit;
      return query;
    }) as typeof collection.where;
    return collection as unknown as ReturnType<Database['collection']>;
  }, runTransaction: handler => db.runTransaction(raw => handler(raw as unknown as Transaction)) };
  await preparePaymentAction(actor, prepareInput, projected);
  expect(selected).toEqual(['id', 'tenantId', 'tenantName', 'ownerUid', 'ownerEmail', 'amountCOP', 'kind', 'appointmentAllowance', 'responseAllowance', 'quotaPeriodId', 'planId', 'periodDays', 'bankSelected', 'status', 'rejectionReason', 'submittedAt', 'reviewedAt']);
});
it('returns only closed receipt metadata and rejects a mismatched document identity', async () => {
  const receipt = paymentFixture()['paymentReceipts/demo-payment'];
  const { db } = memoryFirestore({ 'paymentReceipts/demo-payment': { ...receipt, receiptDataUrl: 'synthetic-image', unknownPrivateField: 'excluded' } });
  const database = db as unknown as Database;
  expect(await database.runTransaction(tx => readPaymentReviewReceipt(tx, database, receipt.id))).toEqual(receipt);
  const mismatch = memoryFirestore({ 'paymentReceipts/other-document': receipt }).db as unknown as Database;
  await expect(mismatch.runTransaction(tx => readPaymentReviewReceipt(tx, mismatch, receipt.id))).rejects.toMatchObject({ status: 409 });
});
