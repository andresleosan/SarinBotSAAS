import type { Business } from '@/types/firestore';
import type { Database } from '@/lib/storage/types';
import { privateBusinessDraft } from '@/lib/server/businesses';
import { acceptSyntheticConsent } from './consent-fixtures';
import { bookingDataPolicyKey } from '@/lib/server/booking-data-policy';
export const factualFaqNow = Date.parse('2030-01-01T12:00:00Z');
export async function seedFactualFaqScenario(db: Database) {
  const owner = { uid: 'demo-owner' }, client = { uid: 'demo-client' };
  const business: Business = { ...privateBusinessDraft(owner, factualFaqNow), id: 'demo-general', name: 'Synthetic FAQ', slug: 'demo-general', category: 'Services', phoneWhatsApp: '573001234567', sarinConfig: { onboardingCompleted: true, tone: '', customRules: '', intakeFields: [] }, subscription: { status: 'active', trialEndsAt: 0, currentPeriodEndsAt: factualFaqNow + 86400000 } };
  const ref = db.collection('businesses').doc(business.id);
  await ref.set(business);
  await db.collection('businesses').doc('demo-other').set({ ...business, id: 'demo-other', ownerUid: 'demo-other-owner', slug: 'demo-other' });
  await db.collection('serverSettings').doc(bookingDataPolicyKey(business.id)).set({ version: 1, businessId: business.id, revision: 1, dataMode: 'general', representedMinorsEnabled: false, reason: 'Synthetic', updatedAt: factualFaqNow, updatedBy: 'demo-admin' });
  await acceptSyntheticConsent(db, owner.uid);
  await acceptSyntheticConsent(db, client.uid, business);
  return { owner, client, business, ref, stateRef: ref.collection('factualFaq').doc('current'), operations: ref.collection('factualFaqOperations') };
}
export const syntheticFaqItems = [{ topic: 'parking' as const, answer: 'Entrada lateral sintética.' }, { topic: 'accessibility' as const, answer: 'Acceso de prueba.' }, { topic: 'onsite_payment_methods' as const, answer: 'Tarjeta de prueba.' }];

