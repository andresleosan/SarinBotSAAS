import { afterEach, beforeEach, describe, expect, vi } from 'vitest';
import { initializeApp, deleteApp, type App } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import type { Database } from '@/lib/storage/types';
import { subjectAdmin } from './represented-booking-contract';
import { registerWaitlistOfferRaces } from './waitlist-offers-race-contract';

describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)('official Firestore Admin SDK waitlist offer races', () => {
  let apps: App[], stores: Firestore[];
  beforeEach(() => {
    expect(process.env.FIRESTORE_EMULATOR_HOST).toMatch(/^127\.0\.0\.1:\d+$/);
    vi.stubEnv('SUPERADMIN_UID', subjectAdmin.uid); vi.stubEnv('SARIN_WAITLIST_OFFERS_ENABLED', 'true');
    apps = [0, 1].map(i => initializeApp({ projectId: 'demo-sarin-bot' }, `demo-offer-races-${i}-${crypto.randomUUID()}`));
    stores = apps.map(app => getFirestore(app));
  });
  afterEach(async () => {
    vi.restoreAllMocks(); vi.unstubAllEnvs();
    await Promise.all(stores.map(store => store.terminate()));
    await Promise.all(apps.map(app => deleteApp(app)));
  });
  registerWaitlistOfferRaces('firestore', () => ({ db: stores[0] as unknown as Database, second: stores[1] as unknown as Database }));
});
