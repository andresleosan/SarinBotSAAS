import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import type { DecodedIdToken } from 'firebase-admin/auth';
import type { Database } from '@/lib/storage/types';
import type { DataCommand, DataReadResult, DataCommitResult } from '../shared/data-protocol';
import { createDataTestRuntime } from '../cloudflare/tests/data-runtime.mjs';
import { createCloudflareDatabase, StorageError, type DataTransport } from '@/lib/storage/database';
const state = vi.hoisted(() => ({ db: null as Database | null, getUser: vi.fn(), verifyIdToken: vi.fn() }));
vi.mock('@/lib/firebase/admin', () => ({ getAdminDb: () => { if (!state.db) throw new Error('Default remote backend forbidden'); return state.db; }, getAdminAuth: () => state }));
import { preparePaymentAction, confirmPaymentAction, readPaymentAction } from '@/lib/server/admin-payment-actions';
import { PATCH } from '@/app/api/admin/route';
import { RESPONSE_PACK } from '@/lib/billing-plans';
const now = Date.parse('2030-01-01T12:00:00Z'), actor = { uid: 'demo-admin', auth_time: now / 1000 } as DecodedIdToken;
const requestId = '11111111-1111-4111-8111-111111111111', request2 = '22222222-2222-4222-8222-222222222222';
const input = { paymentId: 'demo-payment', action: 'approve' as const, requestId }, command = { requestId, expectedRevision: 1, confirmed: true as const };
let runtime: Awaited<ReturnType<typeof createDataTestRuntime>>, db: Database, second: Database;
const seen: DataCommand[] = [];
const transport: DataTransport = async command => { seen.push(structuredClone(command)); const response = await runtime.fetch(command), value = await response.json() as DataReadResult | DataCommitResult; if (!response.ok) throw new StorageError(response.status, (value as unknown as { code: string }).code); return value; };
beforeAll(async () => { runtime = await createDataTestRuntime(); }, 30000);
afterAll(async () => { await runtime?.dispose(); });
beforeEach(async () => {
  vi.spyOn(Date, 'now').mockReturnValue(now); vi.stubEnv('SUPERADMIN_UID', actor.uid); vi.stubEnv('ADMIN_PAYMENT_ACTION_KEY', Buffer.alloc(32, 7).toString('base64'));
  state.getUser.mockReset().mockImplementation(async uid => ({ uid, disabled: false })); state.verifyIdToken.mockReset().mockResolvedValue(actor);
  await runtime.db.exec('DELETE FROM app_documents; DELETE FROM app_commits;');
  db = createCloudflareDatabase(transport); second = createCloudflareDatabase(transport); state.db = db; seen.length = 0;
  await db.runTransaction(async tx => {
    tx.set(db.collection('businesses').doc('demo-business'), { id: 'demo-business', ownerUid: 'demo-owner', name: 'Demo business', createdAt: 1, subscription: { status: 'past_due', trialEndsAt: 0, currentPeriodEndsAt: 0, lastPaymentId: 'demo-payment' } });
    tx.set(db.collection('paymentReceipts').doc('demo-payment'), { id: 'demo-payment', tenantId: 'demo-business', ownerUid: 'demo-owner', status: 'pending', amountCOP: 49000, submittedAt: 1 });
  });
});
afterEach(() => { state.db = null; vi.restoreAllMocks(); vi.unstubAllEnvs(); });
const barrier = () => { let release!: () => void; const promise = new Promise<void>(r => { release = r; }); return { promise, release }; };
const manual = async (action = 'approve') => PATCH(new Request('http://local.test/api/admin', { method: 'PATCH', headers: { Authorization: 'Bearer synthetic', 'Content-Type': 'application/json' }, body: JSON.stringify({ action, paymentId: 'demo-payment', ...(action === 'reject' ? { rejectionReason: 'Synthetic manual review' } : {}) }) }));
const periods = () => db.collection('responseQuotaScopes').doc('business_demo-business').collection('periods').get();
const receipt = () => db.collection('paymentReceipts').doc('demo-payment').get();

it('two independent D1 handles confirm one proposal once, including a second tab request', async () => {
  const p = await preparePaymentAction(actor, input, db);
  const [a, b] = await Promise.all([confirmPaymentAction(actor, p.id, command, db), confirmPaymentAction(actor, p.id, { ...command, requestId: request2 }, second)]);
  expect(a.receipt).toEqual(b.receipt); expect((await periods()).size).toBe(1);
  expect((await receipt()).data()?.reviewedAt).toBe(now);
});
it('two different D1 proposals compete for one canonical receipt', async () => {
  const first = await preparePaymentAction(actor, input, db), other = await preparePaymentAction(actor, { ...input, requestId: request2 }, second);
  const results = await Promise.allSettled([confirmPaymentAction(actor, first.id, command, db), confirmPaymentAction(actor, other.id, command, second)]);
  expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
  expect(results.find(r => r.status === 'rejected')).toMatchObject({ reason: { status: 409 } }); expect((await periods()).size).toBe(1);
});
it.each(['approve', 'reject'])('manual PATCH %s commits first at a real D1 barrier; pending proposal loses', async action => {
  const p = await preparePaymentAction(actor, input, db), entered = barrier(), gate = barrier(); let blocked = false;
  const racing = createCloudflareDatabase(async c => {
    if (!blocked && c.action === 'commit' && c.writes.some(w => w.op !== 'delete' && w.path === 'adminPaymentActions/' + p.id && w.data.state === 'executed')) { blocked = true; entered.release(); await gate.promise; }
    return transport(c);
  });
  const pending = confirmPaymentAction(actor, p.id, command, racing).catch(e => e);
  try { await entered.promise; state.db = second; expect((await manual(action)).status).toBe(200); } finally { gate.release(); }
  expect(await pending).toMatchObject({ status: 409 });
  expect((await db.collection('adminPaymentActions').doc(p.id).get()).data()?.state).toBe('pending');
  expect((await periods()).size).toBe(action === 'approve' ? 1 : 0);
});
it.each(['approve', 'reject'])('confirmation commits first at D1 barrier before manual PATCH %s', async action => {
  const p = await preparePaymentAction(actor, input, db), entered = barrier(), gate = barrier(); let blocked = false;
  state.db = createCloudflareDatabase(async c => {
    if (!blocked && c.action === 'commit' && c.writes.some(w => w.path === 'paymentReceipts/demo-payment')) { blocked = true; entered.release(); await gate.promise; }
    return transport(c);
  });
  const pending = manual(action);
  try { await entered.promise; await confirmPaymentAction(actor, p.id, command, second); } finally { gate.release(); }
  expect((await pending).status).toBe(action === 'approve' ? 200 : 409);
  expect((await periods()).size).toBe(1);
});
it.each(['quota', 'plan', 'binding'])('real concurrent %s mutation invalidates the original D1 confirmation', async mutation => {
  if (mutation === 'binding') {
    for (const [key, value] of Object.entries({ WHATSAPP_ENABLED: 'true', WHATSAPP_RETENTION_ENABLED: 'true', WHATSAPP_APP_SECRET: 'synthetic-app-secret', WHATSAPP_VERIFY_TOKEN: 'synthetic-verify-token', WHATSAPP_CONTENT_KEY: Buffer.alloc(32, 1).toString('base64'), WHATSAPP_PHONE_CREDENTIALS_JSON: JSON.stringify({ '12345678': { wabaId: '87654321', accessToken: 'synthetic-token' } }) })) vi.stubEnv(key, value);
    await db.collection('paymentReceipts').doc('demo-payment').set({ ...(await receipt()).data(), planId: 'whatsapp', periodDays: 30 });
    await db.collection('whatsappBusinesses').doc('demo-business').set({ phoneNumberId: '12345678' });
    await db.collection('whatsappNumbers').doc('12345678').set({ businessId: 'demo-business', phoneNumberId: '12345678', wabaId: '87654321', enabled: true, verifiedAt: 1, updatedAt: 1 });
  }
  const p = await preparePaymentAction(actor, input, db), entered = barrier(), gate = barrier(); let blocked = false;
  const racing = createCloudflareDatabase(async c => { if (!blocked && c.action === 'commit' && c.writes.some(w => w.path === 'paymentReceipts/demo-payment')) { blocked = true; entered.release(); await gate.promise; } return transport(c); });
  const pending = confirmPaymentAction(actor, p.id, command, racing).catch(e => e);
  try {
    await entered.promise;
    if (mutation === 'quota') {
      await second.collection('responseQuotaScopes').doc('business_demo-business').set({ initializedAt: now });
      await second.collection('responseQuotaScopes').doc('business_demo-business').collection('periods').doc('current').set({ id: 'current', source: 'subscription', planId: 'monthly', startsAt: now - 1, endsAt: now + 10000, includedResponses: 3000, extraResponses: 0, usedResponses: 1, reservedResponses: 1 });
    } else if (mutation === 'plan') await second.collection('paymentReceipts').doc('demo-payment').set({ ...(await receipt()).data(), planId: 'weekly', periodDays: 7 });
    else await second.collection('whatsappNumbers').doc('12345678').set({ businessId: 'demo-business', phoneNumberId: '12345678', wabaId: '87654321', enabled: true, verifiedAt: 1, updatedAt: 2 });
  } finally { gate.release(); }
  expect(await pending).toMatchObject({ status: 409 }); expect((await receipt()).data()?.status).toBe('pending');
});
it('an effect failure leaves receipt and proposal unconsumed in actual D1', async () => {
  const p = await preparePaymentAction(actor, input, db);
  await db.collection('responseQuotaScopes').doc('business_demo-business').collection('periods').doc('payment_demo-payment').set({ collision: true });
  await expect(confirmPaymentAction(actor, p.id, command, second)).rejects.toThrow();
  expect((await receipt()).data()?.status).toBe('pending');
  expect((await db.collection('adminPaymentActions').doc(p.id).get()).data()?.state).toBe('pending');
});
it('lost durable commit uses identical command and fresh-handle replay keeps one effect', async () => {
  const p = await preparePaymentAction(actor, input, db); let lost = false;
  const attempts: DataCommand[] = [];
  const uncertain = createCloudflareDatabase(async c => {
    if (c.action === 'commit') attempts.push(structuredClone(c));
    const result = await transport(c);
    if (!lost && c.action === 'commit' && c.writes.some(w => w.path === 'paymentReceipts/demo-payment')) { lost = true; throw new TypeError('synthetic lost response'); }
    return result;
  });
  await confirmPaymentAction(actor, p.id, command, uncertain);
  expect(attempts).toHaveLength(2); expect(attempts[1]).toEqual(attempts[0]);
  const replay = await confirmPaymentAction(actor, p.id, command, createCloudflareDatabase(transport));
  expect(replay.receipt.reviewedAt).toBe(now); expect((await periods()).size).toBe(1);
});
it('two handles add a response pack once without resetting current quota', async () => {
  const b = (await db.collection('businesses').doc('demo-business').get()).data()!;
  await db.collection('businesses').doc('demo-business').set({ ...b, subscription: { status: 'active', trialEndsAt: 0, currentPeriodEndsAt: now + 100000 } });
  await db.collection('responseQuotaScopes').doc('business_demo-business').set({ initializedAt: now });
  const current = { id: 'paid', source: 'subscription', planId: 'monthly', startsAt: now - 10000, endsAt: now + 100000, includedResponses: 3000, extraResponses: 5, usedResponses: 10, reservedResponses: 3 };
  await db.collection('responseQuotaScopes').doc('business_demo-business').collection('periods').doc('paid').set(current);
  await db.collection('paymentReceipts').doc('demo-payment').set({ ...(await receipt()).data(), kind: 'response_pack', responseAllowance: RESPONSE_PACK.responses, quotaPeriodId: 'paid' });
  const p = await preparePaymentAction(actor, input, db);
  await Promise.all([confirmPaymentAction(actor, p.id, command, db), confirmPaymentAction(actor, p.id, command, second)]);
  expect((await periods()).docs[0].data()).toEqual({ ...current, extraResponses: 5 + RESPONSE_PACK.responses });
});
it('D1 callback retry checks actual wall-clock expiry and cannot extend the proposal', async () => {
  const p = await preparePaymentAction(actor, input, db), entered = barrier(), gate = barrier(); let blocked = false;
  vi.mocked(Date.now).mockReturnValue(now + 200000);
  const recent = { ...actor, auth_time: (now + 200000) / 1000 } as DecodedIdToken;
  const racing = createCloudflareDatabase(async c => { if (!blocked && c.action === 'commit' && c.writes.some(w => w.path === 'paymentReceipts/demo-payment')) { blocked = true; entered.release(); await gate.promise; } return transport(c); });
  const pending = confirmPaymentAction(recent, p.id, command, racing).catch(e => e);
  try { await entered.promise; await second.collection('platformSettings').doc('unrelated').set({ changed: true }); vi.mocked(Date.now).mockReturnValue(now + 300000); } finally { gate.release(); }
  expect(await pending).toMatchObject({ status: 409 }); expect((await receipt()).data()?.status).toBe('pending');
});
it.each(['😀'.repeat(500), 'a' + '\u0000'.repeat(498) + 'b'])('real D1 retains a bounded 500-codepoint rejection envelope and erases it on effect', async rejectionReason => {
  const p = await preparePaymentAction(actor, { ...input, action: 'reject', rejectionReason }, db);
  const result = await confirmPaymentAction(actor, p.id, command, second);
  expect(result.receipt.rejectionReason).toBe(rejectionReason);
  expect((await db.collection('adminPaymentActions').doc(p.id).get()).data()?.reason).toBeNull();
});
it('D1 callback retry rechecks real authentication age at five-minute equality', async () => {
  const p = await preparePaymentAction(actor, input, db), entered = barrier(), gate = barrier(); let blocked = false;
  const aging = { ...actor, auth_time: actor.auth_time - 200 } as DecodedIdToken;
  const racing = createCloudflareDatabase(async c => { if (!blocked && c.action === 'commit' && c.writes.some(w => w.path === 'paymentReceipts/demo-payment')) { blocked = true; entered.release(); await gate.promise; } return transport(c); });
  const pending = confirmPaymentAction(aging, p.id, command, racing).catch(e => e);
  try { await entered.promise; await second.collection('platformSettings').doc('unrelated').set({ changed: true }); vi.mocked(Date.now).mockReturnValue(now + 100000); } finally { gate.release(); }
  expect(await pending).toMatchObject({ status: 428, code: 'ADMIN_PAYMENT_REAUTH_REQUIRED' }); expect((await receipt()).data()?.status).toBe('pending');
});
it('proposal read, confirm and replay never hydrate a historical receipt image or discard its blob reference', async () => {
  await db.collection('paymentReceipts').doc('demo-payment').set({ ...(await receipt()).data(), receiptDataUrl: 'data:image/webp;base64,' + Buffer.from('RIFFxxxxWEBPsynthetic').toString('base64') });
  const row = await runtime.db.prepare('SELECT blob FROM app_documents WHERE path=?').bind('paymentReceipts/demo-payment').first();
  const blob = JSON.parse(row.blob); await runtime.bucket.delete(blob.key);
  const p = await preparePaymentAction(actor, input, db);
  expect((await readPaymentAction(actor, p.id, second)).payment.amountCOP).toBe(49000);
  const result = await confirmPaymentAction(actor, p.id, command, db);
  expect(result.receipt.status).toBe('approved'); expect(result.receipt.receiptDataUrl).toBeUndefined();
  expect((await confirmPaymentAction(actor, p.id, command, second)).receipt.status).toBe('approved');
  const after = await runtime.db.prepare('SELECT blob FROM app_documents WHERE path=?').bind('paymentReceipts/demo-payment').first();
  expect(after.blob).toBe(row.blob);
});
