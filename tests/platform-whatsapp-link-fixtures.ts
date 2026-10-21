import { vi } from 'vitest';
import type { DecodedIdToken } from 'firebase-admin/auth';
import type { Database } from '@/lib/storage/types';
import { consentDocuments, consentStateKey } from '@/lib/server/consent';
import { configure, now } from './platform-whatsapp-test-fixtures';

export const linkKey = Buffer.alloc(32, 19);
export const phone = '+12025550101';
export const token = (uid = 'demo-link-user', at = now): DecodedIdToken => ({ uid, sub: uid, aud: 'demo-link', iss: 'synthetic', iat: at / 1000, exp: at / 1000 + 3600, auth_time: Math.floor(at / 1000), firebase: { identities: {}, sign_in_provider: 'password' } });
export function configureLink() { configure(); vi.stubEnv('PLATFORM_WHATSAPP_LINK_HMAC_KEY', linkKey.toString('base64')); }
export async function seedConsents(db: Database, uid = token().uid, revision = 1, active = true) {
  for (const scope of ['account', 'platform_support'] as const) {
    const documents = consentDocuments(scope), receiptId = 'demo_receipt_' + scope + '_' + uid + '_' + revision;
    await db.collection('serverSettings').doc(receiptId).set({ uid, scope, businessId: null, requestId: 'demo-fixture', action: active ? 'accept' : 'revoke', revision, occurredAt: now, preauthorizedAt: null, termsAccepted: active, dataAuthorized: active, documents });
    await db.collection('serverSettings').doc(consentStateKey(uid, scope)).set({ version: 1, uid, scope, businessId: null, revision, active, fingerprint: documents.fingerprint, receiptId });
  }
}
