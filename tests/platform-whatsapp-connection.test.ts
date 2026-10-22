import { afterEach, beforeEach, expect, it, vi } from 'vitest';
vi.mock('@/lib/firebase/admin', () => ({ getAdminDb: () => { throw new Error('Default backend forbidden'); } }));
import { reconcilePlatformConnection } from '@/lib/server/platform-whatsapp-connection';
import { configure, connection, connectionPath, identity, memoryStore, now } from './platform-whatsapp-test-fixtures';
const fetcher = vi.fn();
beforeEach(() => { configure(); vi.stubEnv('PLATFORM_YCLOUD_API_KEY', 'synthetic-key'); vi.spyOn(Date, 'now').mockReturnValue(now); fetcher.mockReset(); vi.stubGlobal('fetch', fetcher); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
const account = () => Response.json({ id: identity.wabaId, accountReviewStatus: 'APPROVED', banState: 'REINSTATE', restrictions: [], paymentMethodAttached: true });
const phone = (status = 'CONNECTED') => Response.json({ id: identity.phoneNumberId, wabaId: identity.wabaId, phoneNumber: identity.phoneE164, status });
it('shares concurrent own-scope observation and never clears a manual pause', async () => {
  const s = memoryStore(); s.seed(connectionPath, connection({ paused: true, pausedReason: 'manual' }));
  fetcher.mockResolvedValueOnce(account()).mockResolvedValueOnce(phone());
  await Promise.all([reconcilePlatformConnection(s.db), reconcilePlatformConnection(s.db)]);
  expect(fetcher).toHaveBeenCalledTimes(2); expect(s.rows.get(connectionPath)).toMatchObject({ observationStatus: 'connected', observedAt: now, paused: true, pausedReason: 'manual' });
});
it('discards late positive observation after revision CAS changed', async () => {
  const s = memoryStore(); s.seed(connectionPath, connection());
  fetcher.mockResolvedValueOnce(account()).mockImplementationOnce(async () => { s.seed(connectionPath, connection({ connectionRevision: 1, paused: true, pausedReason: 'manual' })); return phone(); });
  await reconcilePlatformConnection(s.db); expect(s.rows.get(connectionPath)).toMatchObject({ connectionRevision: 1, paused: true, providerConnection: 'unverified' });
});
it('unknown lookup invalidates stale evidence and known disconnect fences before reconnect', async () => {
  const s = memoryStore(); s.seed(connectionPath, { ...connection({ providerConnection: 'connected' }), observationStatus: 'connected', observationRevision: 0, observedAt: now - 300000 });
  fetcher.mockResolvedValueOnce(new Response('{}', { status: 404 })); await reconcilePlatformConnection(s.db);
  expect(s.rows.get(connectionPath)).toMatchObject({ observationStatus: 'failed', observationRevision: null, observedAt: null, connectionRevision: 0 });
  fetcher.mockResolvedValueOnce(account()).mockResolvedValueOnce(phone('DISCONNECTED')); await reconcilePlatformConnection(s.db);
  expect(s.rows.get(connectionPath)).toMatchObject({ providerConnection: 'disconnected', paused: true, connectionRevision: 1 });
  fetcher.mockResolvedValueOnce(account()).mockResolvedValueOnce(phone()); await reconcilePlatformConnection(s.db);
  expect(s.rows.get(connectionPath)).toMatchObject({ providerConnection: 'connected', paused: true, pausedReason: 'manual', connectionRevision: 1 });
});
