import { createHash, randomInt } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DecodedIdToken } from 'firebase-admin/auth';
vi.mock('node:crypto', async original => ({ ...await original<typeof import('node:crypto')>(), randomInt: vi.fn() }));
import { claimInvitationAttempt, createInvitation, redeemInvitation, updateInvitation } from '@/lib/server/invitations';
import { consentedFirestore } from './consent-fixtures';
const memoryFirestore = (initial: Parameters<typeof consentedFirestore>[0] = {}) => consentedFirestore(initial, ['admin', 'owner', ...Array.from({ length: 5 }, (_, index) => `guess-${index}`)]);
const now = 1900000000000;
const admin = { uid: 'admin' } as DecodedIdToken;
const owner = { uid: 'owner', email: 'owner@example.test', email_verified: true, firebase: { sign_in_provider: 'google.com' } } as DecodedIdToken;
const input = { recipientEmail: owner.email!, requestId: 'short-create' };
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(now); vi.stubEnv('SUPERADMIN_UID', admin.uid); vi.mocked(randomInt).mockReset().mockReturnValue(7 as never); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });
describe('six digit invitations', () => {
  it('generates and redeems leading zero codes without storing or listing the code', async () => {
    const { db, rows } = memoryFirestore();
    const result = await createInvitation(admin, input, db);
    expect(result.code).toBe('000007');
    expect(result.invitation.maskedCode).toBe('••••07');
    for (const row of rows.values()) expect(Object.values(row.data)).not.toContain(result.code);
    expect(await createInvitation(admin, input, db)).toMatchObject({ code: null, replayed: true });
    expect((await redeemInvitation(owner, { code: result.code!, requestId: 'short-redeem' }, db)).business.subscription.paidTrial?.appointmentLimit).toBe(10);
    expect((await redeemInvitation(owner, { code: result.code!, requestId: 'short-redeem' }, db)).replayed).toBe(true);
  });
  it('keeps collision allocation atomic and never reuses a revoked code', async () => {
    const { db, rows } = memoryFirestore();
    const first = await createInvitation(admin, input, db);
    await updateInvitation(admin, { action: 'revoke_code', invitationId: first.invitation.id, expectedVersion: 0, requestId: 'revoke-short', reason: 'Reemitir' }, db);
    vi.mocked(randomInt).mockReturnValueOnce(7 as never).mockReturnValue(999999 as never);
    const second = await createInvitation(admin, { ...input, requestId: 'short-second' }, db);
    expect(second.code).toBe('999999');
    expect([...rows.keys()].filter(path => path.startsWith('serverSettings/invitation_code_'))).toHaveLength(2);
    await expect(redeemInvitation(owner, { code: '000007', requestId: 'revoked-attempt' }, db)).rejects.toMatchObject({ code: 'INVITATION_UNAVAILABLE' });
    vi.mocked(randomInt).mockReturnValue(7 as never);
    await expect(createInvitation(admin, { ...input, requestId: 'collision-exhausted' }, db)).rejects.toMatchObject({ status: 503 });
    expect([...rows.keys()].filter(path => path.startsWith('invitations/'))).toHaveLength(2);
  });
  it('serializes simultaneous allocation of the same candidate', async () => {
    const { db, rows } = memoryFirestore();
    vi.mocked(randomInt).mockReturnValueOnce(7 as never).mockReturnValueOnce(7 as never).mockReturnValue(8 as never);
    const results = await Promise.all([createInvitation(admin, input, db), createInvitation(admin, { ...input, requestId: 'parallel-second' }, db)]);
    expect(new Set(results.map(item => item.code))).toEqual(new Set(['000007', '000008']));
    expect([...rows.keys()].filter(path => path.startsWith('serverSettings/invitation_code_'))).toHaveLength(2);
  });
  it('limits guesses by verified email across UIDs and recovers a real replay after rate exhaustion', async () => {
    const { db } = memoryFirestore();
    await createInvitation(admin, input, db);
    for (let index = 0; index < 5; index++) await expect(redeemInvitation({ ...owner, uid: `guess-${index}` }, { code: '111111', requestId: `guess-code-${index}` }, db)).rejects.toMatchObject({ code: 'INVITATION_UNAVAILABLE' });
    await expect(redeemInvitation(owner, { code: '000007', requestId: 'too-soon' }, db)).rejects.toMatchObject({ status: 429, code: 'INVITATION_RATE_LIMITED', retryAfterSeconds: 60 });
    vi.setSystemTime(now + 60000);
    await redeemInvitation(owner, { code: '000007', requestId: 'confirmed-redeem' }, db);
    for (let index = 0; index < 4; index++) await expect(redeemInvitation(owner, { code: '111111', requestId: `more-code-${index}` }, db)).rejects.toMatchObject({ code: 'INVITATION_UNAVAILABLE' });
    expect((await redeemInvitation(owner, { code: '000007', requestId: 'confirmed-redeem' }, db)).replayed).toBe(true);
  });
  it('keeps codes bound to verified email and rejects unknown, expired and malformed inputs', async () => {
    const { db } = memoryFirestore();
    await createInvitation(admin, input, db);
    await expect(redeemInvitation({ ...owner, email: 'other@example.test' }, { code: '000007', requestId: 'wrong-email' }, db)).rejects.toMatchObject({ code: 'INVITATION_UNAVAILABLE' });
    await expect(redeemInvitation(owner, { code: '222222', requestId: 'unknown-code' }, db)).rejects.toMatchObject({ code: 'INVITATION_UNAVAILABLE' });
    vi.setSystemTime(now + 7 * 86400000);
    await expect(redeemInvitation(owner, { code: '000007', requestId: 'expired-code' }, db)).rejects.toMatchObject({ code: 'INVITATION_UNAVAILABLE' });
    await expect(redeemInvitation(owner, { code: '12345', requestId: 'invalid' }, db)).rejects.toThrow();
  });
  it('reserves the final UID/email attempt atomically and keeps corrupt counters closed', async () => {
    const { db, rows } = memoryFirestore();
    for (let index = 0; index < 4; index++) await claimInvitationAttempt(owner.uid, db, now, owner.email);
    const attempts = await Promise.allSettled([claimInvitationAttempt(owner.uid, db, now, owner.email), claimInvitationAttempt('another-uid', db, now, owner.email)]);
    expect(attempts.filter(item => item.status === 'fulfilled')).toHaveLength(1);
    const failed = attempts.find(item => item.status === 'rejected') as PromiseRejectedResult;
    expect(failed.reason).toMatchObject({ status: 429, retryAfterSeconds: 60 });
    rows.get(`serverSettings/invitation_email_rate_${digest(owner.email!)}`)!.data.timestamps = [now + 1];
    await expect(claimInvitationAttempt('new-uid', db, now, owner.email)).rejects.toMatchObject({ status: 503 });
  });
  it('enforces hourly and daily limits beyond the minute window without extending the reset time', async () => {
    const hourly = memoryFirestore();
    for (let minute = 0; minute < 4; minute++) for (let index = 0; index < 5; index++) await claimInvitationAttempt(owner.uid, hourly.db, now + minute * 60000, owner.email);
    await expect(claimInvitationAttempt(owner.uid, hourly.db, now + 4 * 60000, owner.email)).rejects.toMatchObject({ status: 429, retryAfterSeconds: 3360 });
    await claimInvitationAttempt(owner.uid, hourly.db, now + 3600000, owner.email);
    const daily = memoryFirestore();
    for (let index = 0; index < 50; index++) await claimInvitationAttempt(owner.uid, daily.db, now + index * 4 * 60000, owner.email);
    await expect(claimInvitationAttempt(owner.uid, daily.db, now + 50 * 4 * 60000, owner.email)).rejects.toMatchObject({ status: 429, retryAfterSeconds: 74400 });
    await claimInvitationAttempt(owner.uid, daily.db, now + 86400000, owner.email);
  });
  it('redeems and recovers previously issued long codes without a new lookup index', async () => {
    const { db, rows } = memoryFirestore();
    const result = await createInvitation(admin, input, db), id = result.invitation.id;
    const code = `SARIN-${id}-${'s'.repeat(32)}`;
    const row = rows.get(`invitations/${id}`)!;
    row.data.codeHash = digest(code); row.data.maskedCode = 'SARIN-…ssssss';
    await redeemInvitation(owner, { code, requestId: 'legacy-redeem' }, db);
    await updateInvitation(admin, { action: 'suspend_access', invitationId: id, expectedVersion: 1, requestId: 'legacy-suspend', reason: 'Revisión' }, db);
    expect((await redeemInvitation(owner, { code, requestId: 'legacy-redeem' }, db)).business.subscription.paidTrial?.accessSuspended).toBe(true);
  });
});
