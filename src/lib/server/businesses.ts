import 'server-only';
import { createHash } from 'node:crypto';
import type { ChatActor } from '@/types/chat';
import type { Firestore } from 'firebase-admin/firestore';
import type { Business, PublicBusiness } from '@/types/firestore';
import { getAdminDb } from '@/lib/firebase/admin';
import { HttpError } from './http';
import { documentIdSchema, type BusinessConfig } from './schemas';

export const businessIdForOwner = (uid: string) => `b_${createHash('sha256').update(uid).digest('hex').slice(0, 32)}`;
export const stableDocumentId = (...parts: string[]) => createHash('sha256').update(JSON.stringify(parts)).digest('hex');

export function publicBusiness(business: Business): PublicBusiness {
  return {
    id: business.id, slug: business.slug, name: business.name, category: business.category,
    phoneWhatsApp: business.phoneWhatsApp, timezone: business.timezone,
    subscription: { status: business.subscription.status, trialEndsAt: business.subscription.trialEndsAt, currentPeriodEndsAt: business.subscription.currentPeriodEndsAt, ...(business.subscription.graceEndsAt !== undefined ? { graceEndsAt: business.subscription.graceEndsAt } : {}) },
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
    // Deterministic owner documents make repeated onboarding unable to create
    // a second trial. Configuration changes preserve all billing timestamps.
    if (existing.exists) {
      const business = existing.data() as Business;
      assertOwner(business, user.uid);
      if (business.slug !== config.slug) throw new HttpError(409, 'El enlace del negocio es permanente para conservar tu código QR.');
      const updated: Business = { ...business, name: config.name, category: config.category, phoneWhatsApp: config.phoneWhatsApp, sarinConfig: { onboardingCompleted: true, tone: config.tone, customRules: config.customRules, intakeFields: config.intakeFields }, resources: config.resources, services: config.services, weeklySchedule: config.weeklySchedule };
      transaction.set(reference, updated);
      transaction.set(db.collection('publicBusinesses').doc(config.slug), publicBusiness(updated));
      return updated;
    }
    if (slug.exists) throw new HttpError(409, 'Este enlace ya está ocupado. Escoge otro slug.');
    const now = Date.now();
    const business: Business = {
      id, slug: config.slug, ownerUid: user.uid, ownerEmail: user.email ?? '',
      name: config.name, category: config.category, phoneWhatsApp: config.phoneWhatsApp,
      timezone: 'America/Bogota',
      subscription: { status: 'trial', trialEndsAt: now + 7 * 86400000, currentPeriodEndsAt: 0 },
      sarinConfig: { onboardingCompleted: true, tone: config.tone, customRules: config.customRules, intakeFields: config.intakeFields },
      resources: config.resources, services: config.services, weeklySchedule: config.weeklySchedule, createdAt: now,
    };
    transaction.create(reference, business);
    transaction.create(slugReference, { businessId: id, ownerUid: user.uid });
    transaction.create(db.collection('publicBusinesses').doc(config.slug), publicBusiness(business));
    transaction.set(profileReference, { ownedTenantId: id }, { merge: true });
    return business;
  });
}
