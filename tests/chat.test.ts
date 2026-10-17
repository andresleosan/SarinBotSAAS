import { afterEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ db: undefined as unknown, engine: vi.fn() }));
vi.mock('@/lib/firebase/admin', () => ({ getAdminDb: () => state.db }));
vi.mock('@/lib/sarin/engine', async original => ({ ...await original<typeof import('@/lib/sarin/engine')>(), completeChat: state.engine }));
import { memoryFirestore } from './memoryFirestore';
import { subjectFixture, subjectAdmin, contact } from './represented-booking-contract';
import { createBookingProposal, confirmBookingProposal } from '@/lib/server/booking-proposals';
import { saveBookingDataPolicy } from '@/lib/server/booking-data-policy';
import { runSarinChat } from '@/lib/server/chat';
afterEach(() => vi.unstubAllEnvs());
it('health policy preserves saved confirmation recovery before any admission or model', async () => {
  vi.stubEnv('SUPERADMIN_UID', subjectAdmin.uid); const { db } = memoryFirestore(); state.db = db; state.engine.mockReset().mockResolvedValue({ role: 'assistant', content: '' }); const f = await subjectFixture(db, 'general', false), requestId = 'demo-confirmed-chat';
  const proposal = await createBookingProposal(f.actor, f.business.id, f.selection, requestId, db), saved = await confirmBookingProposal(f.actor, f.business.id, proposal.id, contact, db);
  await saveBookingDataPolicy(subjectAdmin, { businessId: f.business.id, expectedRevision: 1, dataMode: 'health', representedMinorsEnabled: false, reason: 'Demo' }, db);
  const response = await runSarinChat({ user: f.actor, body: { mode: 'sarin_client', tenantId: f.business.id, requestId, messages: [{ role: 'user', content: 'Recuperar confirmación' }] } });
  expect(response.toolResults?.[0].result).toEqual({ appointment: saved }); expect(state.engine).not.toHaveBeenCalled();
});
