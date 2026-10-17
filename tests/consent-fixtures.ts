import { createHash } from 'node:crypto';
import type { Database } from '@/lib/storage/types';
import { consentDocuments, consentStateKey, preauthorizeAccount, readConsent, updateConsent } from '@/lib/server/consent';
import type { ConsentBusiness, ConsentScope } from '@/lib/legal';
import { memoryFirestore } from './memoryFirestore';
import type { ChatActor } from '@/types/chat';
import type { BookingSubjectCase, BookingDataPolicy } from '@/lib/booking-subject';
import { readBookingSubjectConsent, updateBookingSubjectConsent } from '@/lib/server/booking-subject-consent';

export async function acceptSyntheticSubjectConsent(db: Database, actor: ChatActor, business: ConsentBusiness, subjectCase: BookingSubjectCase, policy: BookingDataPolicy): Promise<void> {
  if (!actor.uid.startsWith('demo-')) throw new Error('Subject fixtures require an explicit demo actor');
  await acceptSyntheticConsent(db, actor.uid, business);
  const status = await readBookingSubjectConsent(actor, business.id, subjectCase, db);
  if (!status.required || status.active) return;
  await updateBookingSubjectConsent(actor, { businessId: business.id, case: subjectCase, action: 'accept', requestId: `demo-subject-${crypto.randomUUID()}`, expectedRevision: status.revision, fingerprint: status.documents.fingerprint,
    decisions: { dataAuthorized: true, sensitiveDataAuthorized: policy.dataMode === 'health', representationDeclared: subjectCase.subjectKind === 'represented_minor' },
  }, db);
}

/** Explicit synthetic authorization for tests of other commercial behavior. */
export async function acceptSyntheticConsent(db: Database, uid: string, business?: ConsentBusiness): Promise<void> {
  for (const scope of ['account', ...(business ? ['business_client'] : [])] as ConsentScope[]) {
    const current = await readConsent(uid, scope, scope === 'account' ? undefined : business, db);
    if (current.active) continue;
    await updateConsent({ uid }, { scope, ...(scope === 'business_client' ? { businessId: business!.id } : {}), action: 'accept', requestId: `fixture-${scope}-${current.revision}`, expectedRevision: current.revision, fingerprint: current.documents.fingerprint, termsAccepted: true, dataAuthorized: true,
      ...(scope === 'account' ? { preauthorization: preauthorizeAccount({ fingerprint: current.documents.fingerprint, termsAccepted: true, dataAuthorized: true }).token } : {}),
    }, db);
  }
}

/** Only callers listing synthetic actor UIDs opt into these fixtures. */
export function consentedFirestore(initial: Parameters<typeof memoryFirestore>[0], actors: readonly string[]) {
  const entries = { ...initial };
  const businesses = Object.entries(initial ?? {}).filter(([path]) => /^businesses\/[^/]+$/.test(path)).map(([, value]) => value as unknown as ConsentBusiness);
  for (const uid of actors) for (const business of [undefined, ...businesses]) {
    const scope = business ? 'business_client' : 'account', documents = consentDocuments(scope, business), businessId = business?.id ?? null;
    const receiptId = `consent_receipt_${createHash('sha256').update(JSON.stringify([uid, scope, businessId, 'synthetic-fixture'])).digest('hex')}`;
    entries[`serverSettings/${receiptId}`] = { uid, scope, businessId, requestId: 'synthetic-fixture', action: 'accept', revision: 1, occurredAt: 0, preauthorizedAt: business ? null : 0, termsAccepted: true, dataAuthorized: true, documents };
    entries[`serverSettings/${consentStateKey(uid, scope, businessId)}`] = { version: 1, uid, scope, businessId, revision: 1, active: true, fingerprint: documents.fingerprint, receiptId };
  }
  return memoryFirestore(entries);
}
