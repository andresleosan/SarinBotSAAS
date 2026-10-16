import { describe, expect, it } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveConfig } from 'vite';
import { journeyEnvironment, assertJourneyEnvironment, assertEmulatorInventory, createJourneyFixture, assertJourneyUrl, cleanupOwnedDocuments, removeJourneyBank } from '../scripts/lib/local-journey.mjs';

const runId = '83276e9c-8e62-4ec8-8a59-7e8a91787ae3';

describe('local journey isolation', () => {
  it('rejects WhatsApp delivery, retention and secrets in an isolated journey', () => {
    const unsafe = { WHATSAPP_ENABLED: 'true', WHATSAPP_RETENTION_ENABLED: 'true', WHATSAPP_APP_SECRET: 'synthetic-app', WHATSAPP_VERIFY_TOKEN: 'synthetic-token', WHATSAPP_CONTENT_KEY: 'synthetic-key', WHATSAPP_PHONE_CREDENTIALS_JSON: 'synthetic-credentials' };
    const env = journeyEnvironment(unsafe, 3040, runId);
    expect(env.WHATSAPP_ENABLED).toBe('false'); expect(env.WHATSAPP_RETENTION_ENABLED).toBe('false');
    for (const [key, value] of Object.entries(unsafe)) expect(() => assertJourneyEnvironment({ ...env, [key]: value })).toThrow();
  });
  it('creates an explicit demo environment without inherited credentials, proxies or Node hooks', () => {
    const env = journeyEnvironment({ PATH: 'safe-path', FIREBASE_ADMIN_PRIVATE_KEY: 'private', GOOGLE_APPLICATION_CREDENTIALS: 'private.json', CF_ACCESS_CLIENT_SECRET: 'secret', SARIN_TUNNEL_URL: 'https://production.invalid', HTTPS_PROXY: 'https://proxy.invalid', NODE_OPTIONS: '--import=untrusted.mjs' }, 3040, runId);
    expect(env.PATH).toBe('safe-path');
    expect(env.FIREBASE_ADMIN_PROJECT_ID).toBe('demo-sarin-bot');
    expect(env.FIREBASE_AUTH_EMULATOR_HOST).toBe('127.0.0.1:9099');
    expect(env.FIRESTORE_EMULATOR_HOST).toBe('127.0.0.1:8080');
    for (const key of ['FIREBASE_ADMIN_PRIVATE_KEY', 'GOOGLE_APPLICATION_CREDENTIALS', 'CF_ACCESS_CLIENT_SECRET', 'SARIN_TUNNEL_URL', 'HTTPS_PROXY', 'NODE_OPTIONS']) expect(env[key]).toBeUndefined();
    expect(() => assertJourneyEnvironment(env)).not.toThrow();
  });

  it('refuses non demo projects, alternate hosts and ordinary test execution before any SDK use', () => {
    const env = journeyEnvironment({}, 3030, runId);
    for (const change of [{ SARIN_LOCAL_JOURNEY: undefined }, { FIREBASE_ADMIN_PROJECT_ID: 'production' }, { FIRESTORE_EMULATOR_HOST: '192.168.0.2:8080' }, { FIREBASE_AUTH_EMULATOR_HOST: 'localhost:9099' }, { NODE_ENV: 'production' }, { SARIN_JOURNEY_RUN: '../../manual' }, { SARIN_JOURNEY_PORT: '9099' }]) {
      expect(() => assertJourneyEnvironment({ ...env, ...change })).toThrow();
    }
  });

  it('rejects cloud inference credentials and provider overrides in the isolated journey', () => {
    const unsafe = { SARIN_CHAT_PROVIDER: 'deepseek', DEEPSEEK_API_KEY: 'synthetic-key', DEEPSEEK_MODEL: 'deepseek-flash' };
    const env = journeyEnvironment(unsafe, 3040, runId);
    for (const [key, value] of Object.entries(unsafe)) {
      expect(env[key]).toBeUndefined();
      expect(() => assertJourneyEnvironment({ ...env, [key]: value })).toThrow();
    }
  });

  it('accepts only fixed loopback origins and forbids credentials and redirects to another host', () => {
    expect(assertJourneyUrl('http://127.0.0.1:3040/api/businesses', 3040)).toBe('http://127.0.0.1:3040/api/businesses');
    expect(assertJourneyUrl('http://127.0.0.1:9099/', 3040)).toBe('http://127.0.0.1:9099/');
    expect(assertJourneyUrl('http://127.0.0.1:8080/v1/projects/demo-sarin-bot/databases/(default)/documents/users/test', 3040)).toContain('demo-sarin-bot');
    for (const url of ['https://127.0.0.1:3040/', 'http://localhost:3040/', 'http://127.0.0.1:3041/', 'http://user:password@127.0.0.1:3040/', 'http://production.invalid/', 'http://127.0.0.1:3040@production.invalid/']) expect(() => assertJourneyUrl(url, 3040)).toThrow();
  });

  it('requires both official emulator endpoints in the hub inventory', () => {
    expect(() => assertEmulatorInventory({ auth: { host: '127.0.0.1', port: 9099 }, firestore: { host: '127.0.0.1', port: 8080 } })).not.toThrow();
    for (const inventory of [{}, { auth: { host: '127.0.0.1', port: 9099 } }, { auth: { host: '127.0.0.1', port: 9099 }, firestore: { host: '0.0.0.0', port: 8080 } }]) expect(() => assertEmulatorInventory(inventory)).toThrow();
  });

  it('uses new names per run and cannot target the seeded admin or manually created businesses', async () => {
    const fixture = createJourneyFixture(runId);
    expect(fixture.ownerUid).toBe('journey-83276e9c-8e62-4ec8-8a59-7e8a91787ae3-owner');
    expect(fixture.slug).toBe('journey-83276e9c-8e62-4ec8-8a59-7e8a91787ae3');
    expect(() => createJourneyFixture('manual-owner')).toThrow();
    const removed: string[] = [];
    await expect(cleanupOwnedDocuments([
      { path: `users/${fixture.ownerUid}`, data: { uid: fixture.ownerUid } },
      { path: 'users/sarin-local-admin', data: { uid: 'sarin-local-admin' } },
    ], fixture, async path => { removed.push(path); })).rejects.toThrow();
    expect(removed).toEqual([]);
    await expect(cleanupOwnedDocuments([{ path: `businesses/${fixture.businessId}`, data: { ownerUid: 'manual-owner', slug: fixture.slug } }], fixture, async path => { removed.push(path); })).rejects.toThrow();
    expect(removed).toEqual([]);
  });

  it('deletes only proven run documents including a pending receipt whose HTTP response was lost', async () => {
    const fixture = createJourneyFixture(runId);
    const records = [
      { path: `businesses/${fixture.businessId}/appointments/appointment-a`, data: { tenantId: fixture.businessId, client: { uid: fixture.clientUid } } },
      { path: `businesses/${fixture.businessId}/bookingLocks/2026-12-01_room`, data: { version: 1 } },
      { path: 'paymentReceipts/receipt-a', data: { ownerUid: fixture.ownerUid, tenantId: fixture.businessId } },
      { path: 'paymentImages/receipt-a', data: { ownerUid: fixture.ownerUid } },
      { path: `publicBusinesses/${fixture.slug}`, data: { id: fixture.businessId, slug: fixture.slug } },
      { path: `businessSlugs/${fixture.slug}`, data: { businessId: fixture.businessId, ownerUid: fixture.ownerUid } },
      { path: `users/${fixture.ownerUid}`, data: { ownedTenantId: fixture.businessId } },
      { path: `businesses/${fixture.businessId}`, data: { ownerUid: fixture.ownerUid, slug: fixture.slug } },
    ];
    const removed: string[] = [];
    await cleanupOwnedDocuments(records, fixture, async path => { removed.push(path); });
    expect(removed).toHaveLength(8);
    expect(removed).toContain('paymentImages/receipt-a');
    await expect(cleanupOwnedDocuments([{ path: `businesses/${fixture.businessId}/unknown/manual`, data: {} }], fixture, async () => {})).rejects.toThrow();
  });

  it('cleans quota periods only with proof of the exact synthetic parent', async () => {
    const fixture = createJourneyFixture(runId);
    const parent = { path: `businesses/${fixture.businessId}`, data: { ownerUid: fixture.ownerUid, slug: fixture.slug } };
    const scope = { path: `responseQuotaScopes/business_${fixture.businessId}`, data: { initializedAt: 1 } };
    const period = { path: `${scope.path}/periods/paid-period`, data: { id: 'paid-period' } };
    const removed: string[] = [];
    await cleanupOwnedDocuments([period, scope, parent], fixture, async path => { removed.push(path); });
    expect(removed).toEqual([period.path, scope.path, parent.path]);
    for (const rows of [[period], [scope], [parent, { ...period, path: 'responseQuotaScopes/business_other/periods/paid-period' }], [parent, { ...period, data: { id: 'other-period' } }]]) {
      const attempted: string[] = [];
      await expect(cleanupOwnedDocuments(rows, fixture, async path => { attempted.push(path); })).rejects.toThrow();
      expect(attempted).toEqual([]);
    }
  });

  it('removes only the exact synthetic bank while preserving concurrent settings edits', () => {
    const fixture = createJourneyFixture(runId);
    const manualBank = { id: 'manual-bank', bankName: 'Manual account' };
    const result = removeJourneyBank({ companyName: 'Manual change', bankAccounts: [fixture.bank, manualBank] }, fixture.bank, true);
    expect(result).toEqual({ action: 'update', bankAccounts: [manualBank] });
    expect(removeJourneyBank({ bankAccounts: [fixture.bank] }, fixture.bank, true)).toEqual({ action: 'delete' });
    expect(removeJourneyBank({ bankAccounts: [{ holderName: fixture.bank.holderName, accountNumber: fixture.bank.accountNumber, accountType: fixture.bank.accountType, bankName: fixture.bank.bankName, id: fixture.bank.id }] }, fixture.bank, true)).toEqual({ action: 'delete' });
    expect(removeJourneyBank({ companyName: 'Existing company', bankAccounts: [fixture.bank] }, fixture.bank, false)).toEqual({ action: 'update', bankAccounts: [] });
    expect(() => removeJourneyBank({ bankAccounts: [{ ...fixture.bank, holderName: 'Modified manually' }] }, fixture.bank, false)).toThrow();
  });

  it('prevents Vite from loading any dotenv file even when it exists beside the project', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'sarin-journey-env-'));
    try {
      await writeFile(join(directory, '.env.local'), 'VITE_JOURNEY_DOTENV_SHOULD_NOT_LOAD=synthetic-private-value\n');
      const configFile = fileURLToPath(new URL('../scripts/journey.vitest.config.mts', import.meta.url));
      const resolved = await resolveConfig({ configFile, root: directory }, 'serve', 'test');
      expect(resolved.env.VITE_JOURNEY_DOTENV_SHOULD_NOT_LOAD).toBeUndefined();
    } finally {
      if (!directory.startsWith(join(tmpdir(), 'sarin-journey-env-'))) throw new Error('Unsafe temporary test path.');
      await rm(directory, { recursive: true, force: true });
    }
  });
});
