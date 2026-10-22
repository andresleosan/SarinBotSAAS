import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const auth = vi.hoisted(() => ({ getUser: vi.fn() }));
vi.mock('@/lib/firebase/admin', () => ({ getAdminDb: () => { throw new Error('Default backend forbidden'); }, getAdminAuth: () => auth }));
import { buildSupportScenario } from './platform-support-fixtures';
import { now } from './platform-whatsapp-test-fixtures';
import { runPlatformSupportWork } from '@/lib/server/platform-support-bot';
import { preparePlatformPaymentAction, parsePlatformPaymentSelection } from '@/lib/server/admin-payment-actions';
import { isPlatformOutbox } from '../shared/platform-whatsapp-work';
import { workActor, workPayload } from '@/lib/server/platform-whatsapp-work-authority';
beforeEach(() => {
  vi.spyOn(Date, 'now').mockReturnValue(now); vi.stubEnv('SUPERADMIN_UID', 'demo-link-user'); vi.stubEnv('ADMIN_PAYMENT_ACTION_KEY', Buffer.alloc(32, 9).toString('base64'));
  vi.stubEnv('DEEPSEEK_API_KEY', 'synthetic-key'); vi.stubEnv('PILOT_AI_BUDGET_ENFORCED', 'true');
  auth.getUser.mockReset().mockImplementation(async uid => ({ uid, disabled: false }));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
async function scenario(question = 'aprobar pago demo-payment') {
  const s = await buildSupportScenario();
  s.seed('businesses/demo-business', { id: 'demo-business', ownerUid: 'demo-owner', name: 'Demo', createdAt: 1, subscription: { status: 'past_due', trialEndsAt: 0, currentPeriodEndsAt: 0 } });
  s.seed('paymentReceipts/demo-payment', { id: 'demo-payment', tenantId: 'demo-business', tenantName: 'Demo', ownerUid: 'demo-owner', status: 'pending', submittedAt: 1, amountCOP: 49000 });
  const { lease } = await s.question(question);
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ model: 'synthetic-wire-model-v1', choices: [{ message: { content: JSON.stringify({ reply: 'Revisa el pago en el panel.', sourceIds: ['payment-demo-payment'] }) } }], usage: { prompt_tokens: 11, prompt_cache_hit_tokens: 1, prompt_cache_miss_tokens: 10, completion_tokens: 3, total_tokens: 14 } })));
  return { ...s, lease };
}
it('actual private source selection prepares one opaque web link without approving a payment', async () => {
  const s = await scenario(); await runPlatformSupportWork(s.lease, s.db, new AbortController().signal);
  const proposals = [...s.rows.entries()].filter(([path, value]) => path.startsWith('adminPaymentActions/') && value.recordType === 'proposal');
  expect(proposals).toHaveLength(1); expect(proposals[0][1]).toMatchObject({ actorUid: 'demo-link-user', paymentId: 'demo-payment', state: 'pending' });
  expect(s.rows.get('paymentReceipts/demo-payment')?.status).toBe('pending');
  const out = [...s.rows.values()].filter(isPlatformOutbox).find(o => o.outputKind === 'generated')!;
  if (!isPlatformOutbox(out)) throw new Error('Generated outbox required');
  expect(workPayload(out, now)?.text).toContain('https://sarinbotsaas.pages.dev/admin/assistant?paymentAction=' + proposals[0][1].id);
  expect(workPayload(out, now)?.text).not.toMatch(/actorUid=|rejectionReason=|contextFingerprint=/);
  expect([...s.rows.keys()].filter(path => path.startsWith('responseQuotaScopes/'))).toHaveLength(0);
});
it('private preparation rejects direct caller authority copied from a valid job without its actual source context', async () => {
  const s = await scenario(), job = await s.work.readAuthorized(s.lease);
  if (job?.authorityKind !== 'actor') throw new Error('Synthetic actor expected');
  await expect(preparePlatformPaymentAction(workActor(job), { paymentId: 'demo-payment', action: 'approve' })).rejects.toThrow();
  expect([...s.rows.keys()].some(path => path.startsWith('adminPaymentActions/'))).toBe(false);
});
it.each(['aprueba todos los pagos', 'aprobar pago demo-payment\n', 'aprobar pago ../payment', 'rechazar pago demo-payment: '])('keeps unsupported selection %s consult-only', text => { expect(parsePlatformPaymentSelection(text)).toBeNull(); });
it('late current role loss prevents preparing an otherwise selected payment', async () => {
  const s = await scenario(), normal = vi.mocked(fetch).getMockImplementation()!;
  vi.mocked(fetch).mockImplementation(async (...args) => { const result = await normal(...args); vi.stubEnv('SUPERADMIN_UID', 'other'); return result; });
  await expect(runPlatformSupportWork(s.lease, s.db, new AbortController().signal)).rejects.toThrow();
  expect([...s.rows.keys()].some(path => path.startsWith('adminPaymentActions/'))).toBe(false);
});
it('settles observed generation cost when payment preparation is unavailable', async () => {
  const s = await scenario(); vi.stubEnv('ADMIN_PAYMENT_ACTION_KEY', '');
  await expect(runPlatformSupportWork(s.lease, s.db, new AbortController().signal)).rejects.toThrow();
  const cost = [...s.rows.values()].find(value => value.recordType === 'budget_call' && value.stage === 'generation');
  expect(cost).toMatchObject({ status: 'settled', actualMicros: 8 });
  expect([...s.rows.keys()].some(path => path.startsWith('adminPaymentActions/'))).toBe(false);
});
