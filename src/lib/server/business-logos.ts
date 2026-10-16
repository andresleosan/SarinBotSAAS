import 'server-only';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { z } from 'zod';
import type { ChatActor } from '@/types/chat';
import type { Business, PublicBusiness } from '@/types/firestore';
import type { Database } from '@/lib/storage/types';
import { getAdminDb } from '@/lib/firebase/admin';
import { isSubscriptionAllowed } from '@/lib/sarin/subscription';
import { assertOwner, businessIdForOwner, getOwnedBusiness, publicBusiness } from './businesses';
import { documentIdSchema } from './schemas';
import { HttpError } from './http';

const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
export const businessLogoSchema = z.object({ logoDataUrl: z.string().max(3 * 1024 * 1024).nullable(), expectedSha256: z.string().regex(/^[a-f0-9]{64}$/).nullable() }).strict();
function assertAccess(business: Business, uid: string) {
  assertOwner(business, uid);
  if (!isSubscriptionAllowed(business)) throw new HttpError(403, 'Necesitas acceso vigente para cambiar el logo.');
}
export async function normalizeBusinessLogo(dataUrl: string): Promise<{ dataUrl: string; sha256: string }> {
  const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl);
  if (!match || match[2].length % 4) throw new HttpError(400, 'Usa una imagen PNG, JPEG o WebP válida.');
  if (match[2].length > Math.ceil(2 * 1024 * 1024 / 3) * 4) throw new HttpError(413, 'El logo debe pesar como máximo 2 MiB.');
  const bytes = Buffer.from(match[2], 'base64');
  if (bytes.length > 2 * 1024 * 1024) throw new HttpError(413, 'El logo debe pesar como máximo 2 MiB.');
  const png = match[1] === 'png' && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const jpeg = match[1] === 'jpeg' && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  const webp = match[1] === 'webp' && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
  if (bytes.length < 12 || bytes.toString('base64') !== match[2] || !(png || jpeg || webp)) throw new HttpError(400, 'La imagen no es válida.');
  try {
    const decoder = sharp(bytes, { failOn: 'warning', animated: false, limitInputPixels: 16777216 });
    const metadata = await decoder.metadata();
    if (metadata.format !== match[1] || !metadata.width || !metadata.height || metadata.width > 4096 || metadata.height > 4096 || (metadata.pages ?? 1) !== 1) throw new HttpError(400, 'Usa una imagen estática de hasta 4096 × 4096 píxeles.');
    const output = await decoder.rotate().resize(512, 512, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).webp({ quality: 85 }).toBuffer();
    if (output.length > 256 * 1024) throw new HttpError(413, 'El logo normalizado es demasiado grande. Usa una imagen más sencilla.');
    return { dataUrl: `data:image/webp;base64,${output.toString('base64')}`, sha256: digest(output) };
  } catch (error) { if (error instanceof HttpError) throw error; throw new HttpError(400, 'No pudimos leer la imagen. Usa un PNG, JPEG o WebP estático válido.'); }
}

export async function saveBusinessLogo(user: Pick<ChatActor, 'uid'>, input: { logoDataUrl: string | null; expectedSha256: string | null }, db: Database = getAdminDb()): Promise<Business> {
  const parsed = businessLogoSchema.parse(input);
  const initial = await getOwnedBusiness(user.uid, db);
  if (!initial) throw new HttpError(404, 'Primero configura tu negocio.');
  assertAccess(initial, user.uid);
  const normalized = parsed.logoDataUrl === null ? null : await normalizeBusinessLogo(parsed.logoDataUrl);
  const reference = db.collection('businesses').doc(businessIdForOwner(user.uid));
  return db.runTransaction(async transaction => {
    const document = await transaction.get(reference);
    if (!document.exists) throw new HttpError(404, 'El negocio no existe.');
    const business = document.data() as Business;
    assertAccess(business, user.uid);
    const current = business.logo?.sha256 ?? null;
    const desired = normalized?.sha256 ?? null;
    if (current === desired) return business;
    if (current !== parsed.expectedSha256) throw new HttpError(409, 'El logo cambió. Actualiza el negocio antes de reemplazarlo.', 'BRANDING_CHANGED');
    const { logo: _old, ...withoutLogo } = business;
    const updated: Business = { ...withoutLogo, ...(normalized ? { logo: { sha256: normalized.sha256 } } : {}) };
    if (normalized) transaction.set(db.collection('businessLogos').doc(`${business.id}_${normalized.sha256}`), { businessId: business.id, ownerUid: user.uid, sha256: normalized.sha256, logoDataUrl: normalized.dataUrl, createdAt: Date.now() });
    if (current) transaction.delete(db.collection('businessLogos').doc(`${business.id}_${current}`));
    transaction.set(reference, updated);
    if (business.slug) transaction.set(db.collection('publicBusinesses').doc(business.slug), publicBusiness(updated));
    return updated;
  });
}

export async function readPublicBusinessLogo(slug: string, sha256: string, db: Database = getAdminDb()): Promise<Uint8Array> {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length < 3 || slug.length > 70 || !/^[a-f0-9]{64}$/.test(sha256)) throw new HttpError(400, 'Logo no válido.');
  const projection = (await db.collection('publicBusinesses').doc(slug).get()).data() as PublicBusiness | undefined;
  if (!projection?.sarinConfig.onboardingCompleted || projection.logo?.sha256 !== sha256 || !documentIdSchema.safeParse(projection.id).success) throw new HttpError(404, 'El logo no está disponible.');
  const asset = (await db.collection('businessLogos').doc(`${projection.id}_${sha256}`).get()).data();
  if (asset?.businessId !== projection.id || asset.sha256 !== sha256 || typeof asset.logoDataUrl !== 'string') throw new HttpError(404, 'El logo no está disponible.');
  const match = /^data:image\/webp;base64,([A-Za-z0-9+/]+={0,2})$/.exec(asset.logoDataUrl);
  if (!match || match[1].length > 349528 || match[1].length % 4) throw new HttpError(503, 'El logo no está disponible.');
  const bytes = Buffer.from(match[1], 'base64');
  if (bytes.length < 12 || bytes.length > 256 * 1024 || bytes.toString('base64') !== match[1] || digest(bytes) !== sha256 || bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WEBP') throw new HttpError(503, 'El logo no está disponible.');
  return new Uint8Array(bytes);
}
