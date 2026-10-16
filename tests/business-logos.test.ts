import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { normalizeBusinessLogo, saveBusinessLogo, readPublicBusinessLogo } from '@/lib/server/business-logos';
import { businessIdForOwner, privateBusinessDraft, publicBusiness } from '@/lib/server/businesses';
import { memoryFirestore } from './memoryFirestore';
const dataUrl = (bytes: Buffer, mime = 'png') => `data:image/${mime};base64,${bytes.toString('base64')}`;
const image = (background: string) => sharp({ create: { width: 200, height: 100, channels: 4, background } }).png().toBuffer();
const user = { uid: 'owner', email: 'synthetic@example.test' };
function fixture() {
  const business = { ...privateBusinessDraft(user, Date.now()), slug: 'synthetic-business', sarinConfig: { onboardingCompleted: true, tone: '', customRules: '', intakeFields: [] }, subscription: { status: 'active' as const, trialEndsAt: 0, currentPeriodEndsAt: Date.now() + 86400000 } };
  return { business, ...memoryFirestore({ [`businesses/${business.id}`]: business, [`publicBusinesses/${business.slug}`]: publicBusiness(business) }) };
}
describe('validated business logos', () => {
  it('rejects_hostile_images', async () => {
    const png = await image('#315ff3');
    const animated = await sharp(Buffer.concat([Buffer.alloc(16 * 16 * 3, 255), Buffer.alloc(16 * 16 * 3)]), { raw: { width: 16, height: 32, channels: 3, pageHeight: 16 } }).webp({ loop: 0, delay: [100, 100] }).toBuffer();
    expect((await sharp(animated).metadata()).pages).toBe(2);
    for (const input of [dataUrl(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')), dataUrl(png.subarray(0, 30)), dataUrl(png, 'jpeg'), dataUrl(animated, 'webp'), dataUrl(await sharp({ create: { width: 4097, height: 1, channels: 3, background: 'white' } }).png().toBuffer())]) await expect(normalizeBusinessLogo(input)).rejects.toMatchObject({ status: 400 });
    await expect(normalizeBusinessLogo(dataUrl(Buffer.alloc(2 * 1024 * 1024 + 1)))).rejects.toMatchObject({ status: 413 });
  });
  it('normalizes_without_exif_or_crop and pads a non-square logo transparently', async () => {
    const input = await sharp(await image('#315ff3')).withExif({ IFD0: { Artist: 'Synthetic private metadata' } }).jpeg().toBuffer();
    const result = await normalizeBusinessLogo(dataUrl(input, 'jpeg'));
    const bytes = Buffer.from(result.dataUrl.split(',')[1], 'base64');
    const metadata = await sharp(bytes).metadata();
    expect(metadata).toMatchObject({ width: 512, height: 512, format: 'webp', hasAlpha: true });
    expect(metadata.exif).toBeUndefined(); expect(bytes.length).toBeLessThanOrEqual(256 * 1024);
    expect(result.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect((await sharp(bytes).raw().toBuffer())[3]).toBe(0);
  });
  it('rejects_foreign_owner_and_stale_replace and recovers an identical replacement', async () => {
    const { db, business } = fixture();
    const first = dataUrl(await image('blue')), second = dataUrl(await image('red'));
    await expect(saveBusinessLogo({ uid: 'foreign' }, { logoDataUrl: first, expectedSha256: null }, db)).rejects.toMatchObject({ status: 404 });
    const results = await Promise.allSettled([first, second].map(logoDataUrl => saveBusinessLogo(user, { logoDataUrl, expectedSha256: null }, db)));
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.find(result => result.status === 'rejected')).toMatchObject({ reason: { status: 409, code: 'BRANDING_CHANGED' } });
    const current = (await db.collection('businesses').doc(business.id).get()).data()!;
    const desired = await normalizeBusinessLogo(first);
    const winnerInput = desired.sha256 === current.logo.sha256 ? first : second;
    expect((await saveBusinessLogo(user, { logoDataUrl: winnerInput, expectedSha256: null }, db)).logo).toEqual(current.logo);
  });
  it('binds_public_logo_to_projection and removes its private document without changing personal photo', async () => {
    const { db, business, rows } = fixture();
    await db.collection('users').doc(user.uid).set({ photoURL: 'personal-google-photo' });
    const saved = await saveBusinessLogo(user, { logoDataUrl: dataUrl(await image('blue')), expectedSha256: null }, db);
    expect((await readPublicBusinessLogo(business.slug, saved.logo!.sha256, db)).length).toBeGreaterThan(12);
    await expect(readPublicBusinessLogo('other-slug', saved.logo!.sha256, db)).rejects.toMatchObject({ status: 404 });
    const removed = await saveBusinessLogo(user, { logoDataUrl: null, expectedSha256: saved.logo!.sha256 }, db);
    expect(removed.logo).toBeUndefined();
    expect(rows.has(`businessLogos/${business.id}_${saved.logo!.sha256}`)).toBe(false);
    expect(rows.get(`users/${user.uid}`)?.data.photoURL).toBe('personal-google-photo');
    await expect(readPublicBusinessLogo(business.slug, saved.logo!.sha256, db)).rejects.toMatchObject({ status: 404 });
    expect(businessIdForOwner(user.uid)).toBe(business.id);
  });
});
