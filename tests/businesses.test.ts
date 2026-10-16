import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { businessIdForOwner, createBusiness, privateBusinessDraft, publicBusiness } from '../src/lib/server/businesses';
import { businessConfigSchema } from '../src/lib/server/schemas';
import { memoryFirestore } from './memoryFirestore';

const user = { uid: 'owner', email: 'owner@example.test' } as unknown as DecodedIdToken;
const config = businessConfigSchema.parse({ name: 'Negocio real', slug: 'negocio-real', category: 'Barbería', phoneWhatsApp: '573001234567', resources: [{ id: 'one', name: 'Uno', active: true }], services: [{ id: 'cut', name: 'Corte', durationMinutes: 30, bufferMinutes: 15, price: 20000, resourceIds: ['one'] }], intakeFields: [], weeklySchedule: Object.fromEntries(Array.from({ length: 7 }, (_, day) => [String(day), { isOpen: true, intervals: [{ start: '09:00', end: '17:00' }] }])) });
afterEach(() => vi.useRealTimers());
function paidDraft(uid = user.uid) {
  const draft = privateBusinessDraft({ uid, email: user.email }, Date.parse('2030-01-01'));
  return { ...draft, subscription: { ...draft.subscription, status: 'trial' as const, paidTrial: { paymentId: 'approved-receipt', activatedAt: draft.createdAt, appointmentLimit: 10 as const, appointmentsUsed: 4 } } };
}
describe('business isolation and paid entitlement', () => {
  it('preserves the purchased entitlement and consumed appointments while saving configuration', async () => {
    vi.useFakeTimers(); vi.setSystemTime('2030-01-01');
    const { db } = memoryFirestore({ [`businesses/${businessIdForOwner(user.uid)}`]: paidDraft() });
    const first = await createBusiness(user, config, db);
    vi.setSystemTime('2030-01-05');
    const second = await createBusiness(user, { ...config, name: 'Nombre actualizado' }, db);
    expect(second.id).toBe(businessIdForOwner(user.uid));
    expect(second.name).toBe('Nombre actualizado');
    expect(second.subscription.trialEndsAt).toBe(first.subscription.trialEndsAt);
    expect(second.subscription.paidTrial).toEqual(first.subscription.paidTrial);
    expect(second.createdAt).toBe(first.createdAt);
  });
  it('gives a slug to only one of two simultaneous businesses', async () => {
    const { db } = memoryFirestore(Object.fromEntries([user.uid, 'another'].map(uid => [`businesses/${businessIdForOwner(uid)}`, paidDraft(uid)])));
    const results = await Promise.allSettled([createBusiness(user, config, db), createBusiness({ ...user, uid: 'another' }, config, db)]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
  });
  it('publishes only an explicit safe field list even if private fields are added later', async () => {
    const { db } = memoryFirestore({ [`businesses/${businessIdForOwner(user.uid)}`]: paidDraft() });
    const business = await createBusiness(user, config, db);
    const withPrivateField = { ...business, internalOwnerNote: 'sensitive' };
    const projection = publicBusiness(withPrivateField);
    expect(projection).not.toHaveProperty('internalOwnerNote');
    expect(projection).not.toHaveProperty('ownerEmail');
  });
});
