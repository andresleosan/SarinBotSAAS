import { describe, expect, it } from 'vitest';
import { businessIdForOwner, createBusiness, privateBusinessDraft, publicBusiness, publicBusinessProfile } from '@/lib/server/businesses';
import { businessConfigSchema } from '@/lib/server/schemas';
import type { Database } from '@/lib/storage/types';
import type { Business } from '@/types/firestore';
import { consentedFirestore } from './consent-fixtures';
import { memoryFirestore } from './memoryFirestore';

const user = { uid: 'demo-location-owner', email: 'synthetic-location@example.test' };
const config = businessConfigSchema.parse({ name: 'Negocio de prueba', slug: 'ubicacion-prueba', category: 'Servicios', phoneWhatsApp: '573001234567', resources: [{ id: 'one', name: 'Uno', active: true }], services: [{ id: 'cut', name: 'Corte', durationMinutes: 30, bufferMinutes: 0, price: 20000, resourceIds: ['one'] }], intakeFields: [], weeklySchedule: Object.fromEntries(Array.from({ length: 7 }, (_, day) => [day, { isOpen: true, intervals: [{ start: '09:00', end: '17:00' }] }])) });
const currentLocation = { mode: 'at_business' as const, address: 'Calle 10 # 5-20', instructions: 'Segundo piso.' };
const businessPath = `businesses/${businessIdForOwner(user.uid)}`;
const publicPath = `publicBusinesses/${config.slug}`;
function existingBusiness() {
  return { ...privateBusinessDraft(user, 1893456000000), location: currentLocation, subscription: { status: 'active' as const, trialEndsAt: 0, currentPeriodEndsAt: Date.now() + 86400000 } };
}
const initialRows = () => ({ [businessPath]: existingBusiness() });

describe('business location storage and publication', () => {
  it('preserves location when an older client or assistant omits it', async () => {
    const { db, rows } = consentedFirestore(initialRows(), [user.uid]);
    const updated = await createBusiness(user, config, db);
    expect(updated.location).toEqual(currentLocation);
    expect(rows.get(businessPath)?.data.location).toEqual(currentLocation);
    expect(rows.get(publicPath)?.data.location).toEqual(currentLocation);
  });

  it('saves a normalized replacement to the private record and public projection', async () => {
    const { db, rows } = consentedFirestore(initialRows(), [user.uid]);
    const updated = await createBusiness(user, { ...config, location: { mode: 'at_client', instructions: '  Confirma tu zona.  ' } }, db);
    expect(updated.location).toEqual({ mode: 'at_client', instructions: 'Confirma tu zona.' });
    expect(rows.get(businessPath)?.data.location).toEqual({ mode: 'at_client', instructions: 'Confirma tu zona.' });
    expect(rows.get(publicPath)?.data.location).toEqual({ mode: 'at_client', instructions: 'Confirma tu zona.' });
  });

  it('removes the optional location from both records only on explicit null', async () => {
    const { db, rows } = consentedFirestore(initialRows(), [user.uid]);
    await createBusiness(user, config, db);
    const updated = await createBusiness(user, { ...config, location: null }, db);
    expect(updated).not.toHaveProperty('location');
    expect(rows.get(businessPath)?.data).not.toHaveProperty('location');
    expect(rows.get(publicPath)?.data).not.toHaveProperty('location');
  });

  it('rejects an invalid replacement passed directly to the server without changing either record', async () => {
    const { db, rows } = consentedFirestore(initialRows(), [user.uid]);
    const before = structuredClone(rows.get(businessPath)?.data);
    await expect(createBusiness(user, { ...config, location: { mode: 'online', address: 'private' } } as never, db)).rejects.toThrow();
    expect(rows.get(businessPath)?.data).toEqual(before);
    expect(rows.has(publicPath)).toBe(false);
  });

  it('does not partially save a location if its public write fails', async () => {
    const { db, rows } = consentedFirestore(initialRows(), [user.uid]);
    const database = db as unknown as Database;
    const originalTransaction = database.runTransaction.bind(database);
    const failingDb: Database = { collection: database.collection.bind(database), runTransaction: handler => originalTransaction(tx => handler({ get: tx.get.bind(tx), create: tx.create.bind(tx), delete: tx.delete.bind(tx), set: (reference, data, options) => {
      if (reference.path === publicPath) throw new Error('Synthetic public storage failure');
      return tx.set(reference, data, options);
    } })) };
    const before = structuredClone(rows.get(businessPath)?.data);
    await expect(createBusiness(user, { ...config, location: { mode: 'online' } }, failingDb)).rejects.toThrow('Synthetic public storage failure');
    expect(rows.get(businessPath)?.data).toEqual(before);
    expect(rows.has(publicPath)).toBe(false);
    expect(rows.has(`businessSlugs/${config.slug}`)).toBe(false);
  });

  it('retains owner isolation for location changes', async () => {
    const before = { ...existingBusiness(), ownerUid: 'demo-other-owner' };
    const { db, rows } = consentedFirestore({ [businessPath]: before }, [user.uid]);
    await expect(createBusiness(user, { ...config, location: null }, db)).rejects.toMatchObject({ status: 403 });
    expect(rows.get(businessPath)?.data).toEqual(before);
    expect(rows.has(publicPath)).toBe(false);
  });

  it('requires existing account consent before publishing location', async () => {
    const { db, rows } = memoryFirestore(initialRows());
    await expect(createBusiness(user, { ...config, location: { mode: 'online' } }, db)).rejects.toMatchObject({ status: 428 });
    expect(rows.get(businessPath)?.data.location).toEqual(currentLocation);
    expect(rows.has(publicPath)).toBe(false);
  });

  it('requires an allowed subscription before publishing location', async () => {
    const before = { ...existingBusiness(), subscription: { status: 'suspended' as const, trialEndsAt: 0, currentPeriodEndsAt: 0 } };
    const { db, rows } = consentedFirestore({ [businessPath]: before }, [user.uid]);
    await expect(createBusiness(user, { ...config, location: { mode: 'online' } }, db)).rejects.toMatchObject({ status: 402 });
    expect(rows.get(businessPath)?.data).toEqual(before);
    expect(rows.has(publicPath)).toBe(false);
  });

  it('publishes normalized location through the anonymous allowlist without private business data', () => {
    const business = { ...existingBusiness(), ...config, location: { mode: 'at_business', address: '  Calle 10 # 5-20  ', instructions: '  Segundo piso.  ' }, privateOwnerNote: 'private-value' } as unknown as Business;
    const profile = publicBusinessProfile(business);
    expect(publicBusiness(business).location).toEqual(currentLocation);
    expect(profile.location).toEqual(currentLocation);
    expect(profile).not.toHaveProperty('ownerUid');
    expect(profile).not.toHaveProperty('ownerEmail');
    expect(profile).not.toHaveProperty('sarinConfig');
    expect(profile).not.toHaveProperty('subscription');
    expect(JSON.stringify(profile)).not.toContain('private-value');
  });

  it.each([null, 'private', [], { mode: 'invalid' }, { mode: 'online', address: 'private' }, { mode: 'at_business', address: 'Calle\n10' }, { mode: 'online', instructions: 'a'.repeat(501) }, { mode: 'online', internalNote: 'private' }])('omits malformed historic location from all public projections: %j', (location) => {
    const business = { ...existingBusiness(), ...config, location } as unknown as Business;
    expect(() => publicBusiness(business)).not.toThrow();
    expect(() => publicBusinessProfile(business)).not.toThrow();
    expect(publicBusiness(business)).not.toHaveProperty('location');
    expect(publicBusinessProfile(business)).not.toHaveProperty('location');
  });
});
