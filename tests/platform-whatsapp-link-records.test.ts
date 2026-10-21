import { describe, expect, it } from 'vitest';
import * as records from '../shared/platform-whatsapp-link-records';
import { identity, now } from './platform-whatsapp-test-fixtures';

const uuid = '00000000-0000-4000-8000-000000000001', hash = 'a'.repeat(64);
const base = { ...identity, createdAt: now, expiresAt: now + 2_592_000_000 };
const anchor = { revision: 1, fingerprint: hash, receiptId: 'demo_receipt' };
const challenge = { ...base, recordType: 'link_challenge', uidIndex: hash, phoneIndex: hash, revision: 1, status: 'pending', validUntil: now + 600_000, phoneSuffix: '0101', conversationId: hash, secretHash: hash, account: anchor, support: anchor, attempts: [], verifiedAt: null, resultLinkId: null };
const examples = [
  { ...base, recordType: 'link_uid', ownerUid: 'demo-user', uidIndex: hash, revision: 1, revokeGeneration: uuid, currentLinkId: uuid, pendingChallengeId: null, issues: [] },
  { ...base, recordType: 'link_phone', uidIndex: hash, phoneIndex: hash, linkId: uuid, linkRevision: 1 },
  { ...base, recordType: 'link', uidIndex: hash, phoneIndex: hash, revision: 1, status: 'active', validUntil: base.expiresAt, phoneSuffix: '0101', conversationId: hash, account: anchor, support: anchor, confirmedAuthTime: now / 1000 },
  challenge,
  { ...base, recordType: 'link_request', uidIndex: hash, requestDigest: hash, fingerprint: hash, action: 'begin', challengeId: uuid, linkId: null, resultRevision: null },
  { ...base, recordType: 'link_revoke_request', actorUid: 'demo-user', generation: uuid, requestDigest: hash, challengeId: uuid, linkId: null, resultRevision: null },
];
describe('exact pure link control guards', () => {
  it.each(examples)('accepts the bounded $recordType contract and rejects extra keys and invalid timestamps', value => {
    expect(records.isPlatformWhatsAppStoredLinkControl(value)).toBe(true);
    for (const bad of [{ ...value, code: 'private' }, { ...value, createdAt: -1 }, { ...value, expiresAt: value.createdAt + 2_592_000_001 }, { ...value, provider: 'other' }, { ...value, recordType: 'other' }]) expect(records.isPlatformWhatsAppStoredLinkControl(bad)).toBe(false);
  });
  it('rejects unproved verified challenges, duplicate aliases, six attempts and changed anchors', () => {
    const attempt = { aliases: [hash], fingerprint: hash, accepted: false, at: now };
    for (const bad of [{ ...challenge, status: 'verified' }, { ...challenge, account: { ...anchor, rawUid: 'demo' } }, { ...challenge, attempts: [attempt, attempt] }, { ...challenge, attempts: Array.from({ length: 6 }, (_, i) => ({ ...attempt, aliases: [i.toString().repeat(64)] })) }, { ...challenge, verifiedAt: now }, { ...challenge, validUntil: now + 600_001 }]) expect(records.isPlatformWhatsAppLinkChallengeRecord(bad)).toBe(false);
  });
  it('accepts only a non-user exact persistent marker', () => {
    const marker = { version: 1, scopeDigest: hash, keyFingerprint: hash };
    expect(records.isPlatformWhatsAppLinkKeyMarker(marker)).toBe(true);
    expect(records.isPlatformWhatsAppLinkKeyMarker({ ...marker, expiresAt: now })).toBe(false);
    expect(records.isPlatformWhatsAppStoredLinkControl(marker)).toBe(false);
  });
  it('keeps safe revision integers distinct from epoch bounds and accepts retained attempt deadline equality', () => {
    expect(records.isPlatformWhatsAppLinkChallengeRecord({ ...challenge, account: { ...anchor, revision: Number.MAX_SAFE_INTEGER - 1 } })).toBe(true);
    expect(records.isPlatformWhatsAppLinkChallengeRecord({ ...challenge, attempts: [{ aliases: [hash], fingerprint: hash, accepted: false, at: challenge.validUntil }] })).toBe(true);
  });
});
