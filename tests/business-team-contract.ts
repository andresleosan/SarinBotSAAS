import type { Database } from '@/lib/storage/types';
import { privateBusinessDraft } from '@/lib/server/businesses';
import { bookingDataPolicyKey } from '@/lib/server/booking-data-policy';
import { acceptSyntheticConsent } from './consent-fixtures';

export const teamNow = Date.parse('2030-01-07T15:00:00Z');
export const teamOwner = { uid: 'demo-team-owner' };
export const teamMember = { uid: 'demo-team-member' };
export async function teamFixture(db: Database, id = 'demo-team-business', owner = teamOwner) {
  const business = { ...privateBusinessDraft(owner, teamNow - 86400000), id, slug: id, name: 'Demo team',
    subscription: { status: 'active' as const, trialEndsAt: 0, currentPeriodEndsAt: teamNow + 365 * 86400000 },
    sarinConfig: { onboardingCompleted: true, tone: '', customRules: '', intakeFields: [] },
    resources: [{ id: 'demo-chair', name: 'Demo chair', active: true }] };
  await db.collection('businesses').doc(id).set(business);
  await db.collection('businessSlugs').doc(id).set({ businessId: id, ownerUid: owner.uid });
  await db.collection('serverSettings').doc(bookingDataPolicyKey(id)).set({ version: 1, businessId: id, revision: 1,
    dataMode: 'general', representedMinorsEnabled: false, reason: 'Synthetic', updatedAt: teamNow - 1000, updatedBy: owner.uid });
  await acceptSyntheticConsent(db, owner.uid); await acceptSyntheticConsent(db, teamMember.uid);
  return { business, owner, member: teamMember, request: { businessSlug: id, requestId: 'demo-request-000', expectedMembershipRevision: 0 } };
}
