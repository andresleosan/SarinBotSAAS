import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { deleteApp, getApps } from 'firebase-admin/app';
import type { DecodedIdToken } from 'firebase-admin/auth';
import type { Firestore } from 'firebase-admin/firestore';
import { getAdminDb } from '@/lib/firebase/admin';
import { createBusiness, getOwnedBusiness, publicBusiness } from '@/lib/server/businesses';
import { cancelAppointment, createAppointment } from '@/lib/server/bookings';
import { reviewPayment, submitReceipt } from '@/lib/server/billing';
import { businessConfigSchema, receiptSchema } from '@/lib/server/schemas';
import { readAdminAiUsage, recordAiUsage } from '@/lib/server/ai-usage';
import type { EngineUsageObservation } from '@/lib/sarin/engine';
import { reserveResponseQuota, commitResponseQuota, releaseResponseQuota, getResponseQuota } from '@/lib/server/response-quota';
import { ingestWhatsAppWebhook, persistWhatsAppReply, cleanupWhatsAppRetention, getWhatsAppUsage, whatsappHash } from '@/lib/server/whatsapp-store';
import { syntheticWhatsAppEnv, inbound, phoneId, wabaId } from './whatsapp-fixtures';
import { verifyInvitationLifecycle } from './invitation-contract';
import { readPublicBusinessLogo, saveBusinessLogo } from '@/lib/server/business-logos';
import sharp from 'sharp';

function user(uid: string): DecodedIdToken { return { uid, sub:uid, aud:'demo-sarin-bot', auth_time:0, exp:9999999999, iat:0, iss:'https://securetoken.google.com/demo-sarin-bot', firebase:{identities:{},sign_in_provider:'google.com'}, email:`${uid}@example.test`, name:uid }; }

describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)('real Firestore serializable operations', () => {
  let db: Firestore;
  const owner = user(`owner-${crypto.randomUUID()}`);
  const dateKey = new Intl.DateTimeFormat('en-CA',{timeZone:'America/Bogota',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(Date.now()+2*86400000));
  const config = businessConfigSchema.parse({ name:'Integration business', category:'Services', slug:`test-${crypto.randomUUID()}`, phoneWhatsApp:'573001234567',
    intakeFields:[], resources:[{id:'r',name:'Room',active:true}], services:[{id:'s',name:'Service',durationMinutes:60,bufferMinutes:15,price:100,resourceIds:['r']}],
    weeklySchedule:Object.fromEntries(Array.from({length:7},(_,day)=>[day,{isOpen:true,intervals:[{start:'09:00',end:'18:00'}]}])) });
  beforeAll(async () => {
    // This suite exercises the official Firestore emulator and its additional
    // cleanup APIs, beyond the application's smaller database interface.
    db = getAdminDb() as unknown as Firestore;
    await db.doc('platformSettings/main').set({ bankAccounts: [{ id: 'bank', bankName: 'Synthetic bank', accountType: 'Test', accountNumber: 'fixture-only', holderName: 'Fixture' }] }, { merge: true });
  });
  async function paidBusiness(identity: DecodedIdToken, chosenConfig = config) {
    const existing = await getOwnedBusiness(identity.uid, db);
    if (!existing?.subscription.paidTrial && existing?.subscription.status !== 'active') {
      const uploaded = await submitReceipt(identity, { kind: 'paid_trial', bankSelected: 'bank', requestId: crypto.randomUUID(),
        receiptDataUrl: `data:image/webp;base64,${Buffer.from('RIFFxxxxWEBPfixture').toString('base64')}` }, db);
      await reviewPayment(uploaded.receipt.id, 'approve', undefined, db);
    }
    return createBusiness(identity, chosenConfig, db);
  }
  afterAll(async () => { if (db) { await db.terminate(); const app = getApps().find(value => value.name === 'sarin-admin'); if (app) await deleteApp(app); } });
  it('preserves invitation access, quota, suspension and concurrent payment invariants on Firestore', async () => {
    await verifyInvitationLifecycle(db, config, dateKey);
  }, 75000);
  it('keeps normalized business logos separate from profile photos and protects stale replacements on Firestore', async () => {
    const identity = user(`logo-${crypto.randomUUID()}`);
    const value = await paidBusiness(identity, { ...config, slug: `logo-${crypto.randomUUID()}` });
    const png = await sharp({ create: { width: 120, height: 60, channels: 4, background: 'blue' } }).png().toBuffer();
    const input = { logoDataUrl: `data:image/png;base64,${png.toString('base64')}`, expectedSha256: null };
    const saved = await saveBusinessLogo(identity, input, db);
    expect((await readPublicBusinessLogo(value.slug, saved.logo!.sha256, db)).length).toBeGreaterThan(12);
    await expect(saveBusinessLogo(identity, { logoDataUrl: null, expectedSha256: null }, db)).rejects.toMatchObject({ code: 'BRANDING_CHANGED' });
    await saveBusinessLogo(identity, { logoDataUrl: null, expectedSha256: saved.logo!.sha256 }, db);
    await expect(readPublicBusinessLogo(value.slug, saved.logo!.sha256, db)).rejects.toMatchObject({ status: 404 });
  }, 75000);
  it('persists one encrypted WhatsApp turn and reconciles duplicate delivery and quota exactly once', async () => {
    syntheticWhatsAppEnv();
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('External HTTP prohibited in WhatsApp emulator test'); }));
    try {
      const waOwner = user(`wa-${crypto.randomUUID()}`);
      const business = await paidBusiness(waOwner, { ...config, slug: `wa-${crypto.randomUUID()}` });
      // This storage/delivery test starts from an already paid WhatsApp plan;
      // payment approval and external connection gates have separate coverage.
      const paidAt = Date.now(), paidUntil = paidAt + 30 * 86400000;
      const paid = { ...business, subscription: { ...business.subscription, status: 'active' as const, currentPeriodEndsAt: paidUntil } };
      await db.doc(`businesses/${business.id}`).set(paid);
      await db.doc(`publicBusinesses/${business.slug}`).set(publicBusiness(paid));
      await db.doc(`responseQuotaScopes/business_${business.id}/periods/fixture_whatsapp`).set({ id: 'fixture_whatsapp', source: 'subscription', planId: 'whatsapp', startsAt: paidAt, endsAt: paidUntil, includedResponses: 4500, extraResponses: 0, usedResponses: 0, reservedResponses: 0 });
      await db.collection('whatsappNumbers').doc(phoneId).set({ businessId: business.id, phoneNumberId: phoneId, wabaId, enabled: true, verifiedAt: Date.now(), updatedAt: Date.now() });
      await db.collection('whatsappBusinesses').doc(business.id).set({ phoneNumberId: phoneId });
      const messageId = `wamid.${crypto.randomUUID()}`, id = whatsappHash(phoneId, messageId);
      const payload = inbound(messageId);
      await Promise.all([ingestWhatsAppWebhook(payload, db), ingestWhatsAppWebhook(payload, db)]);
      const inboxes = await db.collection('whatsappInbox').where('businessId', '==', business.id).get();
      expect(inboxes.size).toBe(1);
      expect(JSON.stringify(inboxes.docs[0].data())).not.toMatch(/Reserva|573001112233/);
      const due = await db.collection('whatsappInbox').where('nextAttemptAt', '<=', Date.now()).orderBy('nextAttemptAt').limit(10).get();
      expect(due.docs.some(document => document.id === id)).toBe(true);
      const quota = await reserveResponseQuota({ businessId: business.id, actorUid: 'wa-synthetic-actor', mode: 'sarin_client', channel: 'whatsapp', requestId: id, fingerprint: 'b'.repeat(64) }, db);
      await db.collection('whatsappInbox').doc(id).update({ state: 'processing', leaseId: 'fixture-lease' });
      const response = { reply: 'Synthetic durable reply' };
      await persistWhatsAppReply(id, 'fixture-lease', response, quota.reservation, db);
      await persistWhatsAppReply(id, 'fixture-lease', response, quota.reservation, db);
      await commitResponseQuota(quota.reservation, undefined, db);
      await commitResponseQuota(quota.reservation, undefined, db);
      const status = { object: 'whatsapp_business_account', entry: [{ id: wabaId, changes: [{ field: 'messages', value: {
        messaging_product: 'whatsapp', metadata: { phone_number_id: phoneId }, statuses: [{ id: 'wamid.synthetic-delivered', status: 'read', timestamp: String(Math.floor(Date.now() / 1000)), biz_opaque_callback_data: id, pricing: { type: 'regular', category: 'service' } }],
      } }] }] };
      await ingestWhatsAppWebhook(status, db); await ingestWhatsAppWebhook(status, db);
      status.entry[0].changes[0].value.statuses[0].status = 'delivered'; await ingestWhatsAppWebhook(status, db);
      const usage = await getWhatsAppUsage(db);
      expect(usage.businesses.find(row => row.businessId === business.id)).toMatchObject({ sent: 1, delivered: 1, read: 1, regularDelivered: 1, serviceDelivered: 1 });
      expect(await getResponseQuota(business.id, db)).toMatchObject({ currentPeriod: { usedResponses: 1, reservedResponses: 0 } });
      const outbox = await db.collection('whatsappOutbox').doc(id).get();
      expect(outbox.data()?.state).toBe('delivered');
      expect(JSON.stringify(outbox.data())).not.toMatch(/Synthetic durable reply|573001112233/);
      await cleanupWhatsAppRetention(db, Date.now() + 86_400_001);
      expect((await db.collection('whatsappInbox').doc(id).get()).data()?.content).toBeNull();
      expect((await db.collection('whatsappOutbox').doc(id).get()).data()?.content).toBeNull();
      expect(fetch).not.toHaveBeenCalled();
    } finally { vi.unstubAllGlobals(); vi.unstubAllEnvs(); }
  }, 75000);
  it('atomically records a repeated provider call once across the ledger and both monthly totals', async () => {
    const callId = crypto.randomUUID();
    const businessId = `usage-${crypto.randomUUID()}`;
    const startedAt = Date.parse('2098-07-15T12:00:00Z');
    const observation: EngineUsageObservation = { callId, provider: 'deepseek', model: 'deepseek-flash', startedAt, finishedAt: startedAt + 1, success: true,
      usage: { promptTokens: 1000, cacheHitTokens: 800, cacheMissTokens: 200, completionTokens: 100, totalTokens: 1100 } };
    const scope = { businessId, mode: 'sarin_client' as const };
    await Promise.all([recordAiUsage(observation, scope, db), recordAiUsage(observation, scope, db)]);
    // The recorder bounds the chat wait, not the lifetime of a contended RPC.
    // Observe the eventual commit before asserting atomic stored totals.
    await expect.poll(async () => (await db.doc('aiUsageMonths/2098-07').get()).data()?.calls, { timeout: 50000, interval: 100 }).toBe(1);
    const usage = await readAdminAiUsage('2098-07', db);
    expect(usage.totals).toMatchObject({ calls: 1, successfulCalls: 1, usageReportedCalls: 1, promptTokens: 1000, completionTokens: 100, estimatedCostUSD: { min: 0.0000924, max: 0.0001848 } });
    expect(usage.businesses).toHaveLength(1);
    expect(usage.businesses[0]).toMatchObject({ businessId, calls: 1 });
    const ledger = await db.collection('aiUsageCalls').where('businessId', '==', businessId).get();
    expect(ledger.size).toBe(1);
    expect(ledger.docs[0].id).toBe(callId);
    expect(usage.measurementStartedAt).toBe(startedAt);
  }, 60000);
  it('requires approved introductory payment before configuration and never publishes its private receipt ID', async () => {
    const firstOwner = user(`first-${crypto.randomUUID()}`);
    const firstConfig = { ...config, slug: `first-${crypto.randomUUID()}` };
    await expect(createBusiness(firstOwner, firstConfig, db)).rejects.toMatchObject({ status: 402 });
    const uploaded = await submitReceipt(firstOwner, { kind: 'paid_trial', bankSelected: 'bank', requestId: crypto.randomUUID(),
      receiptDataUrl: `data:image/webp;base64,${Buffer.from('RIFFxxxxWEBPfixture').toString('base64')}` }, db);
    expect(uploaded.receipt).toMatchObject({ kind: 'paid_trial', amountCOP: 5000, appointmentAllowance: 10, status: 'pending' });
    expect(uploaded.business.subscription.status).toBe('pending_payment');
    expect(uploaded.business.subscription.graceEndsAt).toBeUndefined();
    expect((await db.doc(`publicBusinesses/${firstConfig.slug}`).get()).exists).toBe(false);
    await expect(createBusiness(firstOwner, firstConfig, db)).rejects.toMatchObject({ status: 402 });
    const [approved, repeatedApproval] = await Promise.all([
      reviewPayment(uploaded.receipt.id, 'approve', undefined, db), reviewPayment(uploaded.receipt.id, 'approve', undefined, db),
    ]);
    expect(approved.business.subscription.paidTrial).toEqual(repeatedApproval.business.subscription.paidTrial);
    const [a,b] = await Promise.all([createBusiness(firstOwner,firstConfig,db),createBusiness(firstOwner,firstConfig,db)]);
    expect(a.id).toBe(b.id);
    expect(a.subscription.trialEndsAt).toBe(0);
    expect(a.subscription.paidTrial).toMatchObject({ paymentId: uploaded.receipt.id, appointmentLimit: 10, appointmentsUsed: 0 });
    const projection = (await db.doc(`publicBusinesses/${a.slug}`).get()).data();
    expect(projection?.ownerEmail).toBeUndefined(); expect(projection?.ownerUid).toBeUndefined();
    expect(projection?.subscription?.paidTrial?.paymentId).toBeUndefined();
    expect(projection?.subscription?.paidTrial).toMatchObject({ appointmentLimit: 10, appointmentsUsed: 0 });
  }, 75000);
  it('allows only one of two simultaneous reservations for an initially empty resource/day', async () => {
    const business = await paidBusiness(owner);
    const input={dateKey,startTimeStr:'10:00',resourceId:'r',serviceId:'s',clientPhone:'573001234567',intakeAnswers:{}};
    const results=await Promise.allSettled([createAppointment(user('client-a'),business.id,input,crypto.randomUUID(),db),createAppointment(user('client-b'),business.id,input,crypto.randomUUID(),db)]);
    expect(results.filter(result=>result.status==='fulfilled')).toHaveLength(1);
    const rejected=results.find(result=>result.status==='rejected');
    expect(rejected?.status==='rejected' && rejected.reason.status).toBe(409);
    const saved=await db.collection(`businesses/${business.id}/appointments`).get(); expect(saved.size).toBe(1);
    const appointment=saved.docs[0].data(); expect(appointment.reservedUntilAt-appointment.endAt).toBe(15*60000);
  });
  it('serializes the tenth introductory appointment across different resources and keeps retries and cancellations from resetting it', async () => {
    const cappedOwner = user(`capped-${crypto.randomUUID()}`);
    const cappedConfig = { ...config, slug: `capped-${crypto.randomUUID()}`,
      resources: [{ id: 'r', name: 'First', active: true }, { id: 'r2', name: 'Second', active: true }],
      services: [{ ...config.services[0], resourceIds: ['r', 'r2'] }] };
    const business = await paidBusiness(cappedOwner, cappedConfig);
    const subscription = { ...business.subscription, paidTrial: { ...business.subscription.paidTrial!, appointmentsUsed: 9 } };
    await db.doc(`businesses/${business.id}`).update({ subscription });
    const attempts = ['r', 'r2'].map(resourceId => ({ actor: user(`last-${resourceId}-${crypto.randomUUID()}`), requestId: crypto.randomUUID(),
      input: { dateKey, startTimeStr: '10:00', resourceId, serviceId: 's', clientPhone: '573001234567', intakeAnswers: {} } }));
    const results = await Promise.allSettled(attempts.map(attempt => createAppointment(attempt.actor, business.id, attempt.input, attempt.requestId, db)));
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.find(result => result.status === 'rejected')).toMatchObject({ reason: { status: 402 } });
    const winner = results.findIndex(result => result.status === 'fulfilled');
    const committed = results[winner];
    if (committed.status !== 'fulfilled') throw new Error('Expected one committed tenth appointment');
    const attempt = attempts[winner];
    expect((await createAppointment(attempt.actor, business.id, attempt.input, attempt.requestId, db)).id).toBe(committed.value.id);
    expect((await getOwnedBusiness(cappedOwner.uid, db))?.subscription.paidTrial?.appointmentsUsed).toBe(10);
    expect((await db.doc(`publicBusinesses/${business.slug}`).get()).data()?.subscription?.paidTrial).toMatchObject({ appointmentLimit: 10, appointmentsUsed: 10 });
    await cancelAppointment(attempt.actor, business.id, committed.value.id, db);
    await expect(createAppointment(attempt.actor, business.id, { ...attempt.input, startTimeStr: '12:00' }, crypto.randomUUID(), db)).rejects.toMatchObject({ status: 402 });
    await expect(submitReceipt(cappedOwner, { kind: 'paid_trial', bankSelected: 'bank', requestId: crypto.randomUUID(),
      receiptDataUrl: `data:image/webp;base64,${Buffer.from('RIFFxxxxWEBPfixture').toString('base64')}` }, db)).rejects.toMatchObject({ status: 409 });
    expect((await getOwnedBusiness(cappedOwner.uid, db))?.subscription.paidTrial?.appointmentsUsed).toBe(10);
  }, 75000);
  it('keeps image content out of payment lists and extends only once under concurrent approvals', async () => {
    await db.doc('platformSettings/main').set({companyName:'Test',monthlyPriceCOP:49900,bankAccounts:[{id:'bank',bankName:'Configured test bank',accountType:'Savings',accountNumber:'fixture-only',holderName:'Fixture'}]});
    // A small raster signature fixture; production validation also imposes the byte cap.
    const input=receiptSchema.parse({bankSelected:'bank',requestId:crypto.randomUUID(),receiptDataUrl:`data:image/webp;base64,${Buffer.from('RIFFxxxxWEBPfixture').toString('base64')}`});
    const uploaded=await submitReceipt(owner,input,db);
    expect((await db.doc(`paymentReceipts/${uploaded.receipt.id}`).get()).data()?.receiptDataUrl).toBeUndefined();
    expect((await db.doc(`paymentImages/${uploaded.receipt.id}`).get()).data()?.receiptDataUrl).toBe(input.receiptDataUrl);
    const [a,b]=await Promise.all([reviewPayment(uploaded.receipt.id,'approve',undefined,db),reviewPayment(uploaded.receipt.id,'approve',undefined,db)]);
    expect(a.business.subscription.currentPeriodEndsAt).toBe(b.business.subscription.currentPeriodEndsAt);
    expect(a.business.subscription.currentPeriodEndsAt).toBeGreaterThanOrEqual(uploaded.receipt.submittedAt + 30 * 86400000);
    expect(a.business.subscription.currentPeriodEndsAt).toBeLessThanOrEqual(Date.now() + 30 * 86400000);
  });
  // Each plan runs two sequential races (upload and approval). Emulator locks
  // can take 30s to release per race; allow both plus 15s for setup/RPC overhead.
  // https://firebase.google.com/docs/emulator-suite/connect_firestore#transactions
  it.each([
    { planId: 'weekly', amountCOP: 20000, periodDays: 7 },
    { planId: 'fortnightly', amountCOP: 35000, periodDays: 15 },
    { planId: 'monthly', amountCOP: 59900, periodDays: 30 },
  ])('stores and approves $planId without repricing a pending receipt', async ({ planId, amountCOP, periodDays }) => {
    const planOwner = user(`plan-${crypto.randomUUID()}`);
    const business = await paidBusiness(planOwner, { ...config, slug: `plan-${crypto.randomUUID()}` });
    await db.doc('platformSettings/main').set({ weeklyPriceCOP: 20000, fortnightlyPriceCOP: 35000, monthlyPriceCOP: 59900,
      bankAccounts: [{ id: 'bank', bankName: 'Synthetic bank', accountType: 'Test', accountNumber: 'fixture-only', holderName: 'Fixture' }] });
    const input = receiptSchema.parse({ planId, bankSelected: 'bank', requestId: crypto.randomUUID(),
      receiptDataUrl: `data:image/webp;base64,${Buffer.from('RIFFxxxxWEBPfixture').toString('base64')}` });
    const [first, retried] = await Promise.all([submitReceipt(planOwner, input, db), submitReceipt(planOwner, input, db)]);
    expect(first.receipt.id).toBe(retried.receipt.id);
    expect(first.receipt).toMatchObject({ planId, amountCOP, periodDays, status: 'pending' });
    await db.doc('platformSettings/main').update({ weeklyPriceCOP: 25000, fortnightlyPriceCOP: 40000, monthlyPriceCOP: 65000 });
    const [approved, duplicate] = await Promise.all([
      reviewPayment(first.receipt.id, 'approve', undefined, db), reviewPayment(first.receipt.id, 'approve', undefined, db),
    ]);
    expect(approved.receipt).toMatchObject({ planId, amountCOP, periodDays, status: 'approved' });
    expect(approved.business.subscription.currentPeriodEndsAt).toBe(approved.receipt.reviewedAt! + periodDays * 86400000);
    expect(duplicate.business.subscription.currentPeriodEndsAt).toBe(approved.business.subscription.currentPeriodEndsAt);
    expect(approved.business.subscription.trialEndsAt).toBe(business.subscription.trialEndsAt);
    const receipts = await db.collection('paymentReceipts').where('ownerUid', '==', planOwner.uid).get();
    expect(receipts.docs.filter(document => document.data().kind === 'subscription')).toHaveLength(1);
    expect(receipts.docs.filter(document => document.data().kind === 'paid_trial')).toHaveLength(1);
  }, 75000);
  it('serializes the final response across client and owner and replays completion without another debit', async () => {
    const quotaOwner = user(`quota-${crypto.randomUUID()}`);
    const business = await paidBusiness(quotaOwner, { ...config, slug: `quota-${crypto.randomUUID()}` });
    const request = { businessId: business.id, actorUid: 'fixture-client', mode: 'sarin_client' as const, channel: 'web' as const, requestId: crypto.randomUUID(), fingerprint: 'a'.repeat(64) };
    const initial = await reserveResponseQuota(request, db);
    await releaseResponseQuota(initial.reservation, db);
    await db.collection('responseQuotaScopes').doc(initial.reservation.scopeId).collection('periods').doc(initial.reservation.periodId).update({ usedResponses: 699 });
    const inputs = [{ ...request, requestId: crypto.randomUUID() }, { ...request, actorUid: 'another-fixture-client', requestId: crypto.randomUUID() }];
    const results = await Promise.allSettled(inputs.map(input => reserveResponseQuota(input, db)));
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.find(result => result.status === 'rejected')).toMatchObject({ reason: { status: 402, code: 'AI_QUOTA_EXHAUSTED' } });
    const index = results.findIndex(result => result.status === 'fulfilled');
    const successful = results[index];
    if (successful.status !== 'fulfilled') throw new Error('Expected one successful reservation');
    await commitResponseQuota(successful.value.reservation, undefined, db);
    expect(await reserveResponseQuota(inputs[index], db)).toMatchObject({ kind: 'replay', response: null });
    expect(await getResponseQuota(business.id, db)).toMatchObject({ state: 'exhausted', currentPeriod: { usedResponses: 700, reservedResponses: 0, remainingResponses: 0 } });
  }, 60000);
  it('approves a response pack once under contention without extending the paid period', async () => {
    const packOwner = user(`pack-${crypto.randomUUID()}`);
    const business = await paidBusiness(packOwner, { ...config, slug: `pack-${crypto.randomUUID()}` });
    await db.doc('platformSettings/main').set({ responsePackPriceCOP: 20000, bankAccounts: [{ id: 'bank', bankName: 'Synthetic bank', accountType: 'Test', accountNumber: 'fixture-only', holderName: 'Fixture' }] });
    const monthly = await submitReceipt(packOwner, { kind: 'subscription', planId: 'monthly', bankSelected: 'bank', requestId: crypto.randomUUID(),
      receiptDataUrl: `data:image/webp;base64,${Buffer.from('RIFFxxxxWEBPfixture').toString('base64')}` }, db);
    const paid = await reviewPayment(monthly.receipt.id, 'approve', undefined, db);
    const endsAt = paid.business.subscription.currentPeriodEndsAt;
    const input = receiptSchema.parse({ kind: 'response_pack', bankSelected: 'bank', requestId: crypto.randomUUID(), receiptDataUrl: `data:image/webp;base64,${Buffer.from('RIFFxxxxWEBPfixture').toString('base64')}` });
    const receipt = await submitReceipt(packOwner, input, db);
    const [first, duplicate] = await Promise.all([reviewPayment(receipt.receipt.id, 'approve', undefined, db), reviewPayment(receipt.receipt.id, 'approve', undefined, db)]);
    expect(first.receipt).toMatchObject({ kind: 'response_pack', responseAllowance: 1000, amountCOP: 20000, status: 'approved' });
    expect(first.business.subscription.currentPeriodEndsAt).toBe(endsAt);
    expect(duplicate.business.subscription.currentPeriodEndsAt).toBe(endsAt);
    expect(await getResponseQuota(business.id, db)).toMatchObject({ currentPeriod: { includedResponses: 3000, extraResponses: 1000, endsAt } });
  }, 60000);
});
