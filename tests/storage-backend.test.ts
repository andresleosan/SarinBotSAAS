import { afterEach, describe, expect, it, vi } from 'vitest';

const sdk = vi.hoisted(() => ({ getFirestore: vi.fn(() => { throw new Error('Unexpected Firestore access'); }), getApps: vi.fn(() => []) }));
vi.mock('firebase-admin/firestore', () => ({ getFirestore: sdk.getFirestore }));
vi.mock('firebase-admin/app', () => ({ getApps: sdk.getApps, applicationDefault: vi.fn(), cert: vi.fn(), initializeApp: vi.fn() }));
vi.mock('firebase-admin/auth', () => ({ getAuth: vi.fn() }));

afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });
describe('explicit application data backend', () => {
  it('selects D1 without initializing Firestore or credentials for reading business data', async () => {
    vi.stubEnv('SARIN_DATA_BACKEND', 'd1');
    vi.stubEnv('FIRESTORE_EMULATOR_HOST', undefined);
    vi.stubEnv('FIREBASE_AUTH_EMULATOR_HOST', undefined);
    const { getAdminDb } = await import('../src/lib/firebase/admin');
    expect(getAdminDb().collection('businesses').doc('shop').path).toBe('businesses/shop');
    expect(sdk.getFirestore).not.toHaveBeenCalled();
    expect(sdk.getApps).not.toHaveBeenCalled();
  });
  it('rejects a misspelled backend rather than silently using Firestore', async () => {
    vi.stubEnv('SARIN_DATA_BACKEND', 'D1');
    const { getAdminDb } = await import('../src/lib/firebase/admin');
    expect(() => getAdminDb()).toThrow(/backend/);
    expect(sdk.getFirestore).not.toHaveBeenCalled();
  });
  it('rejects a mixed production D1 and Firebase emulator configuration', async () => {
    vi.stubEnv('SARIN_DATA_BACKEND', 'd1');
    vi.stubEnv('FIRESTORE_EMULATOR_HOST', '127.0.0.1:8080');
    const { getAdminDb } = await import('../src/lib/firebase/admin');
    expect(() => getAdminDb()).toThrow(/emuladores/);
    expect(sdk.getFirestore).not.toHaveBeenCalled();
  });
});
