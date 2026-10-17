import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { claimInvitationAttempt, createInvitation, listInvitations, redeemInvitation, updateInvitation } from '@/lib/server/invitations';
import { businessIdForOwner } from '@/lib/server/businesses';
import { submitReceipt, reviewPayment } from '@/lib/server/billing';
import { businessQuotaScope, responsePeriodReference } from '@/lib/server/response-periods';
import { memoryFirestore } from './memoryFirestore';

const now = 1900000000000;
const admin = { uid: 'admin' } as DecodedIdToken;
const owner = { uid: 'owner', email: 'owner@example.test', email_verified: true, firebase: { sign_in_provider: 'google.com' } } as DecodedIdToken;
const input = { recipientEmail: ' OWNER@example.test ', requestId: 'create-one' };
const redeem = { requestId: 'redeem-one' };
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(now); vi.stubEnv('SUPERADMIN_UID', admin.uid); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

describe('complimentary invitations', () => {
  it('redeems once without financial records and never persists or recovers the complete code', async () => {
    const { db, rows } = memoryFirestore();
    const created = await createInvitation(admin, input, db);
    expect(created.code).toMatch(/^\d{6}$/);
    for (const row of rows.values()) expect(Object.values(row.data)).not.toContain(created.code);
    expect(created.invitation).not.toHaveProperty('codeHash');
    expect(await createInvitation(admin, input, db)).toMatchObject({ code: null, replayed: true });
    await expect(createInvitation(admin, { ...input, recipientEmail: 'other@example.test' }, db)).rejects.toMatchObject({ code: 'INVITATION_REQUEST_CONFLICT' });
    const [first, repeated] = await Promise.all([redeemInvitation(owner, { ...redeem, code: created.code! }, db), redeemInvitation(owner, { ...redeem, code: created.code! }, db)]);
    expect(first.business.subscription.paidTrial).toMatchObject({ source: 'invitation', appointmentLimit: 10, appointmentsUsed: 0, accessSuspended: false });
    expect(first.business.subscription.paidTrial).not.toHaveProperty('paymentId');
    expect(repeated.business).toEqual(first.business);
    expect([...rows.keys()].filter(path => /^(paymentReceipts|paymentImages|publicBusinesses|businessSlugs)\//.test(path))).toEqual([]);
    expect([...rows.keys()].filter(path => path.includes('/periods/'))).toHaveLength(1);
    expect(rows.get(`users/${owner.uid}`)?.data.ownedTenantId).toBe(first.business.id);
  });
  it('two codes cannot reset one owner and two accounts cannot consume the same code', async () => {
    const { db, rows } = memoryFirestore();
    const a = await createInvitation(admin, input, db), b = await createInvitation(admin, { ...input, requestId: 'create-two' }, db);
    const results = await Promise.allSettled([redeemInvitation(owner, { ...redeem, code: a.code! }, db), redeemInvitation(owner, { ...redeem, code: b.code! }, db)]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect([...rows.values()].filter(row => row.data.state === 'issued')).toHaveLength(1);
    const other = await createInvitation(admin, { ...input, requestId: 'create-third' }, db);
    const contested = await Promise.allSettled(['alice', 'bob'].map(uid => redeemInvitation({ ...owner, uid }, { ...redeem, code: other.code! }, db)));
    expect(contested.filter(result => result.status === 'fulfilled')).toHaveLength(1);
  });
  it('replay cannot lift suspension or undo a later administrative decision', async () => {
    const { db } = memoryFirestore();
    const created = await createInvitation(admin, input, db);
    await redeemInvitation(owner, { ...redeem, code: created.code! }, db);
    const command = { action: 'suspend_access' as const, invitationId: created.invitation.id, expectedVersion: 1, requestId: 'suspend-one', reason: 'Revisión del piloto' };
    await updateInvitation(admin, command, db);
    vi.setSystemTime(now + 31 * 86400000);
    expect((await redeemInvitation(owner, { ...redeem, code: created.code! }, db)).business.subscription.paidTrial).toMatchObject({ accessSuspended: true, appointmentsUsed: 0 });
    await expect(updateInvitation(admin, { ...command, action: 'reactivate_access', requestId: 'stale-command' }, db)).rejects.toMatchObject({ code: 'INVITATION_STATE_CHANGED' });
    await updateInvitation(admin, { ...command, action: 'reactivate_access', expectedVersion: 2, requestId: 'reactivate-one' }, db);
    const replay = await updateInvitation(admin, command, db);
    expect(replay).toMatchObject({ replayed: true, invitation: { version: 3, access: { state: 'active' } } });
    await expect(updateInvitation(admin, { ...command, reason: 'Different' }, db)).rejects.toMatchObject({ code: 'INVITATION_REQUEST_CONFLICT' });
  });
  it('pending receipt blocks courtesy until rejected, and paid history excludes a second trial', async () => {
    const bank = { id: 'bank', bankName: 'Test', accountType: 'Ahorros', accountNumber: '000', holderName: 'Test' };
    const { db } = memoryFirestore({ 'platformSettings/main': { bankAccounts: [bank] } });
    const created = await createInvitation(admin, input, db);
    const receipt = await submitReceipt(owner, { bankSelected: 'bank', kind: 'paid_trial', requestId: 'receipt-one', receiptDataUrl: `data:image/webp;base64,${Buffer.from('RIFFxxxxWEBPfixture').toString('base64')}` }, db);
    await expect(redeemInvitation(owner, { ...redeem, code: created.code! }, db)).rejects.toMatchObject({ code: 'PAYMENT_PENDING' });
    await reviewPayment(receipt.receipt.id, 'reject', 'Test', db);
    expect((await redeemInvitation(owner, { ...redeem, code: created.code! }, db)).business.subscription.status).toBe('trial');
    const historical = memoryFirestore({ [`businesses/${businessIdForOwner(owner.uid)}`]: { ...receipt.business, subscription: { status: 'past_due', trialEndsAt: 0, currentPeriodEndsAt: now - 1 } } });
    const second = await createInvitation(admin, input, historical.db);
    await expect(redeemInvitation(owner, { ...redeem, code: second.code! }, historical.db)).rejects.toMatchObject({ code: 'PAID_TRIAL_UNAVAILABLE' });
  });
  it('historic quota survives upgrade and a missing period is unknown rather than zero', async () => {
    const { db } = memoryFirestore();
    const created = await createInvitation(admin, input, db), claimed = await redeemInvitation(owner, { ...redeem, code: created.code! }, db);
    const reference = responsePeriodReference(db, businessQuotaScope(claimed.business.id), `invitation_${created.invitation.id}`);
    await reference.set({ ...(await reference.get()).data(), usedResponses: 12 });
    await db.collection('businesses').doc(claimed.business.id).set({ ...claimed.business, subscription: { ...claimed.business.subscription, status: 'active', currentPeriodEndsAt: now + 86400000, paidTrial: { ...claimed.business.subscription.paidTrial!, appointmentsUsed: 2 } } });
    expect((await listInvitations(admin, undefined, db)).invitations[0].usage).toMatchObject({ appointmentsUsed: 2, responsesUsed: 12 });
    await reference.delete();
    expect((await listInvitations(admin, undefined, db)).invitations[0].usage?.responsesUsed).toBeNull();
  });
  it('uses uniform unavailable errors and validates administrative privilege and verified Google identity', async () => {
    const { db } = memoryFirestore();
    await expect(createInvitation(owner, input, db)).rejects.toMatchObject({ status: 403 });
    const created = await createInvitation(admin, input, db);
    for (const invalid of [{ ...owner, email_verified: false }, { ...owner, firebase: { sign_in_provider: 'password' } }]) await expect(redeemInvitation(invalid as DecodedIdToken, { ...redeem, code: created.code! }, db)).rejects.toMatchObject({ status: 403 });
    for (const code of [created.code!.slice(0, -1) + (created.code!.endsWith('0') ? '1' : '0'), `SARIN-${'0'.repeat(24)}-${'a'.repeat(32)}`]) await expect(redeemInvitation(owner, { ...redeem, code }, db)).rejects.toMatchObject({ code: 'INVITATION_UNAVAILABLE' });
    await expect(redeemInvitation({ ...owner, email: 'other@example.test' }, { ...redeem, code: created.code! }, db)).rejects.toMatchObject({ code: 'INVITATION_UNAVAILABLE' });
    await updateInvitation(admin, { action: 'revoke_code', invitationId: created.invitation.id, expectedVersion: 0, requestId: 'revoke-one', reason: 'Reemitir' }, db);
    await expect(redeemInvitation(owner, { ...redeem, code: created.code! }, db)).rejects.toMatchObject({ code: 'INVITATION_UNAVAILABLE' });
  });
  it('limits redemption attempts without blocking recovery and serializes the last available attempt', async () => {
    const { db, rows } = memoryFirestore();
    const created = await createInvitation(admin, input, db);
    await redeemInvitation(owner, { ...redeem, code: created.code! }, db);
    for (let index = 0; index < 9; index++) await claimInvitationAttempt('limited', db, now);
    const last = await Promise.allSettled([claimInvitationAttempt('limited', db, now), claimInvitationAttempt('limited', db, now)]);
    expect(last.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    await expect(claimInvitationAttempt('limited', db, now)).rejects.toMatchObject({ status: 429, code: 'INVITATION_RATE_LIMITED' });
    for (let index = 0; index < 9; index++) await claimInvitationAttempt(owner.uid, db, now);
    expect((await redeemInvitation(owner, { ...redeem, code: created.code! }, db)).replayed).toBe(true);
    expect(JSON.stringify([...rows].filter(([path]) => path.includes('invitation_rate_')))).not.toMatch(/owner@example|SARIN-/);
    await claimInvitationAttempt('limited', db, now + 60000);
  });
});
