import 'server-only';
import { createHash } from 'node:crypto';
import type { ChatActor } from '@/types/chat';
import type { Database as Firestore } from '@/lib/storage/types';
import type { Business, PublicBusiness } from '@/types/firestore';
import { getAdminDb } from '@/lib/firebase/admin';
import { HttpError } from './http';
import { documentIdSchema, type BusinessConfig } from './schemas';
import { isSubscriptionAllowed } from '@/lib/sarin/subscription';
import { normalizeBusinessSocialLinks, type BusinessSocialLink } from '@/lib/business-branding';
import { assertConsent } from './consent';

export const businessIdForOwner = (uid: string) => `b_${createHash('sha256').update(uid).digest('hex').slice(0, 32)}`;
export const stableDocumentId = (...parts: string[]) => createHash('sha256').update(JSON.stringify(parts)).digest('hex');

/** Created only inside the validated first-payment transaction. */
export function privateBusinessDraft(user: Pick<ChatActor, 'uid' | 'email'>, now: number): Business {
  return {
    id: businessIdForOwner(user.uid), slug: '', ownerUid: user.uid, ownerEmail: user.email ?? '',
    name: '', category: '', phoneWhatsApp: '', timezone: 'America/Bogota',
    subscription: { status: 'pending_payment', trialEndsAt: 0, currentPeriodEndsAt: 0 },
    sarinConfig: { onboardingCompleted: false, tone: '', customRules: '', intakeFields: [] },
    resources: [], services: [], weeklySchedule: {}, createdAt: now,
  };
}

export function publicBusiness(business: Business): PublicBusiness {
  let socialLinks: BusinessSocialLink[] | undefined;
  if (business.socialLinks !== undefined) {
    try { socialLinks = normalizeBusinessSocialLinks(business.socialLinks); } catch { /* Invalid historic contacts are not public. */ }
  }
  return {
    id: business.id, slug: business.slug, name: business.name, category: business.category,
    phoneWhatsApp: business.phoneWhatsApp, timezone: business.timezone,
    ...(socialLinks !== undefined ? { socialLinks } : {}),
    ...(business.logo && /^[a-f0-9]{64}$/.test(business.logo.sha256) ? { logo: { sha256: business.logo.sha256 } } : {}),
    subscription: { status: business.subscription.status, trialEndsAt: business.subscription.trialEndsAt, currentPeriodEndsAt: business.subscription.currentPeriodEndsAt, ...(business.subscription.graceEndsAt !== undefined ? { graceEndsAt: business.subscription.graceEndsAt } : {}), ...(business.subscription.paidTrial ? { paidTrial: { activatedAt: business.subscription.paidTrial.activatedAt, appointmentLimit: business.subscription.paidTrial.appointmentLimit, appointmentsUsed: business.subscription.paidTrial.appointmentsUsed, ...(business.subscription.paidTrial.source ? { source: business.subscription.paidTrial.source } : {}), ...(business.subscription.paidTrial.source === 'invitation' ? { accessSuspended: business.subscription.paidTrial.accessSuspended } : {}) } } : {}) },
    sarinConfig: { onboardingCompleted: business.sarinConfig.onboardingCompleted, tone: business.sarinConfig.tone, customRules: business.sarinConfig.customRules, intakeFields: business.sarinConfig.intakeFields },
    resources: business.resources, services: business.services, weeklySchedule: business.weeklySchedule,
  };
}

export async function getOwnedBusiness(uid: string, db: Firestore = getAdminDb()): Promise<Business | null> {
  const snapshot = await db.collection('businesses').doc(businessIdForOwner(uid)).get();
  if (!snapshot.exists) return null;
  const business = snapshot.data() as Business;
  if (business.ownerUid !== uid) throw new HttpError(403, 'No tienes acceso a este negocio.');
  return business;
}

export async function getBusiness(id: string, db: Firestore = getAdminDb()): Promise<Business> {
  if (!documentIdSchema.safeParse(id).success) throw new HttpError(400, 'Identificador de negocio inválido.');
  const snapshot = await db.collection('businesses').doc(id).get();
  if (!snapshot.exists) throw new HttpError(404, 'El negocio no existe.');
  return snapshot.data() as Business;
}

export function assertOwner(business: Business, uid: string): void {
  if (business.ownerUid !== uid) throw new HttpError(403, 'Esta operación es exclusiva del dueño del negocio.');
}

export async function createBusiness(user: ChatActor, config: BusinessConfig, db: Firestore = getAdminDb()): Promise<Business> {
  const id = businessIdForOwner(user.uid);
  const reference = db.collection('businesses').doc(id);
  const slugReference = db.collection('businessSlugs').doc(config.slug);
  const profileReference = db.collection('users').doc(user.uid);
  return db.runTransaction(async (transaction) => {
    const [existing, slug] = await Promise.all([transaction.get(reference), transaction.get(slugReference)]);
    if (!existing.exists) throw new HttpError(402, 'Primero debes activar la prueba pagada o un plan.', 'PAYMENT_REQUIRED');
    const business = existing.data() as Business;
    assertOwner(business, user.uid);
    await assertConsent(user.uid, 'account', undefined, db, transaction);
    if (!isSubscriptionAllowed(business)) throw new HttpError(402, 'Activa un plan para configurar tu negocio.', 'PAYMENT_REQUIRED');
    if (business.slug && business.slug !== config.slug) throw new HttpError(409, 'El enlace del negocio es permanente para conservar tu código QR.');
    if (!business.slug && slug.exists) throw new HttpError(409, 'Este enlace ya está ocupado. Escoge otro slug.');
    const updated: Business = { ...business, slug: config.slug, name: config.name, category: config.category, phoneWhatsApp: config.phoneWhatsApp, ...(config.socialLinks !== undefined ? { socialLinks: normalizeBusinessSocialLinks(config.socialLinks) } : {}), sarinConfig: { onboardingCompleted: true, tone: config.tone, customRules: config.customRules, intakeFields: config.intakeFields }, resources: config.resources, services: config.services, weeklySchedule: config.weeklySchedule };
    if (!business.slug) transaction.create(slugReference, { businessId: id, ownerUid: user.uid });
    transaction.set(reference, updated);
    transaction.set(db.collection('publicBusinesses').doc(config.slug), publicBusiness(updated));
    transaction.set(profileReference, { ownedTenantId: id }, { merge: true });
    return updated;
  });
}
