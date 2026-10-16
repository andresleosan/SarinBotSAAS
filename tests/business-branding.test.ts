import { describe, expect, it } from 'vitest';
import { normalizeBusinessSocialLinks, businessSocialLabel } from '@/lib/business-branding';
import { businessConfigSchema } from '@/lib/server/schemas';
import { businessIdForOwner, createBusiness, privateBusinessDraft, publicBusiness } from '@/lib/server/businesses';
import { memoryFirestore } from './memoryFirestore';

const user = { uid: 'owner', email: 'synthetic@example.test' };
const config = businessConfigSchema.parse({ name: 'Negocio real', slug: 'negocio-real', category: 'Servicios', phoneWhatsApp: '573001234567', resources: [{ id: 'one', name: 'Uno', active: true }], services: [{ id: 'cut', name: 'Corte', durationMinutes: 30, bufferMinutes: 0, price: 20000, resourceIds: ['one'] }], intakeFields: [], weeklySchedule: Object.fromEntries(Array.from({ length: 7 }, (_, day) => [day, { isOpen: true, intervals: [{ start: '09:00', end: '17:00' }] }])) });
describe('business branding contracts', () => {
  it('preserves_omitted_branding and clears_only_explicit_links', async () => {
    const before = { ...privateBusinessDraft(user, Date.now()), logo: { sha256: 'a'.repeat(64) }, socialLinks: [{ platform: 'instagram' as const, url: 'https://instagram.com/negocio' }], subscription: { status: 'active' as const, trialEndsAt: 0, currentPeriodEndsAt: Date.now() + 86400000 } };
    const { db } = memoryFirestore({ [`businesses/${businessIdForOwner(user.uid)}`]: before });
    const updated = await createBusiness(user, config, db);
    expect(updated.logo).toEqual(before.logo); expect(updated.socialLinks).toEqual(before.socialLinks);
    expect((await createBusiness(user, businessConfigSchema.parse({ ...config, socialLinks: [] }), db)).socialLinks).toEqual([]);
  });
  it('rejects_unsafe_social_links', () => {
    for (const url of ['javascript:alert(1)', '/profile', 'http://instagram.com/name', 'https://instagram.com.evil.test/name', 'https://user:secret@instagram.com/name', 'https://instagram.com:443/name', 'https://instagram.com/name#part', 'https://instagram.com/na\nme']) expect(() => normalizeBusinessSocialLinks([{ platform: 'instagram', url }])).toThrow();
    expect(() => normalizeBusinessSocialLinks(Array.from({ length: 4 }, () => ({ platform: 'instagram', url: 'https://instagram.com/name' })))).toThrow();
    expect(() => normalizeBusinessSocialLinks([{ platform: 'instagram', url: 'https://instagram.com/one' }, { platform: 'instagram', url: 'https://instagram.com/two' }])).toThrow();
    expect(businessConfigSchema.safeParse({ ...config, logo: { sha256: 'a'.repeat(64) } }).success).toBe(false);
  });
  it('preserves_functional_profile_identifiers and produces readable labels', () => {
    const links = normalizeBusinessSocialLinks([{ platform: 'facebook', url: 'https://www.facebook.com/profile.php?id=100123456789&fbclid=tracking' }, { platform: 'website', url: 'https://negocio.example/reservas?sede=norte' }, { platform: 'instagram', url: 'https://instagram.com/barberia_norte?utm_source=x' }]);
    expect(links[0].url).toBe('https://www.facebook.com/profile.php?id=100123456789');
    expect(links[1].url).toBe('https://negocio.example/reservas?sede=norte');
    expect(links[2].url).toBe('https://instagram.com/barberia_norte');
    expect(businessSocialLabel(links[2])).toBe('@barberia_norte');
    expect(businessSocialLabel(links[1])).toBe('negocio.example');
    expect(() => normalizeBusinessSocialLinks([{ platform: 'facebook', url: 'https://facebook.com/profile.php?fbclid=x' }])).toThrow();
  });
  it('projects_only_safe_logo_metadata and never private image bytes or storage keys', () => {
    const source = { ...privateBusinessDraft(user, Date.now()), logo: { sha256: 'a'.repeat(64), logoDataUrl: 'private', r2Key: 'payment-images/private' }, socialLinks: [{ platform: 'instagram' as const, url: 'https://instagram.com/name?utm_source=x' }] };
    const projection = publicBusiness(source);
    expect(projection.logo).toEqual({ sha256: 'a'.repeat(64) });
    expect(projection.socialLinks).toEqual([{ platform: 'instagram', url: 'https://instagram.com/name' }]);
    expect(JSON.stringify(projection)).not.toMatch(/ownerEmail|logoDataUrl|payment-images/);
    expect(publicBusiness({ ...source, logo: { sha256: '../bad' } })).not.toHaveProperty('logo');
  });
});
