import type { ConsentAnchor } from './platform-whatsapp-authorization';
import type { PlatformWhatsAppIdentity } from './platform-whatsapp-records';

export const LINK_TTL = 2_592_000_000;
export const LINK_CHALLENGE_TTL = 600_000;
export const LINK_ISSUE_TTL = 3_600_000;
export const LINK_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}(?![\s\S])/;
interface Base extends PlatformWhatsAppIdentity { createdAt: number; expiresAt: number }
export interface PlatformWhatsAppLinkKeyMarker { version: 1; scopeDigest: string; keyFingerprint: string }
export interface PlatformWhatsAppLinkUidRecord extends Base { recordType: 'link_uid'; ownerUid: string; uidIndex: string; revision: number; revokeGeneration: string; currentLinkId: string | null; pendingChallengeId: string | null; issues: { issuedAt: number; expiresAt: number }[] }
export interface PlatformWhatsAppLinkPhoneRecord extends Base { recordType: 'link_phone'; uidIndex: string; phoneIndex: string; linkId: string; linkRevision: number }
export interface PlatformWhatsAppLinkRecord extends Base { recordType: 'link'; uidIndex: string; phoneIndex: string; revision: number; status: 'active' | 'revoked'; validUntil: number; phoneSuffix: string; conversationId: string; account: ConsentAnchor; support: ConsentAnchor; confirmedAuthTime: number }
export interface PlatformWhatsAppLinkAttempt { aliases: string[]; fingerprint: string; accepted: boolean; at: number }
export interface PlatformWhatsAppLinkChallengeRecord extends Base { recordType: 'link_challenge'; uidIndex: string; phoneIndex: string; revision: number; status: 'pending' | 'verified' | 'consumed' | 'replaced' | 'revoked'; validUntil: number; phoneSuffix: string; conversationId: string; secretHash: string; account: ConsentAnchor; support: ConsentAnchor; attempts: PlatformWhatsAppLinkAttempt[]; verifiedAt: number | null; resultLinkId: string | null }
export interface PlatformWhatsAppLinkRequestRecord extends Base { recordType: 'link_request'; uidIndex: string; requestDigest: string; fingerprint: string; action: 'begin' | 'confirm'; challengeId: string; linkId: string | null; resultRevision: number | null }
export interface PlatformWhatsAppLinkRevokeRequestRecord extends Base { recordType: 'link_revoke_request'; actorUid: string; generation: string; requestDigest: string; challengeId: string | null; linkId: string | null; resultRevision: number | null }
export type PlatformWhatsAppStoredLinkControl = PlatformWhatsAppLinkUidRecord | PlatformWhatsAppLinkPhoneRecord | PlatformWhatsAppLinkRecord | PlatformWhatsAppLinkChallengeRecord | PlatformWhatsAppLinkRequestRecord | PlatformWhatsAppLinkRevokeRequestRecord;
type R = Record<string, unknown>;
const object = (v: unknown): v is R => !!v && typeof v === 'object' && !Array.isArray(v);
const exact = (v: R, keys: string[]) => Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
const integer = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 && v <= 8_640_000_000_000_000;
const revision = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v > 0;
const digest = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}(?![\s\S])/.test(v);
const uuid = (v: unknown): v is string => typeof v === 'string' && LINK_UUID.test(v);
const nullableUuid = (v: unknown) => v === null || uuid(v);
const uid = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 128 && !/[\u0000-\u001f]/.test(v);
const anchor = (v: unknown): v is ConsentAnchor => object(v) && exact(v, ['revision', 'fingerprint', 'receiptId']) && revision(v.revision) && digest(v.fingerprint) && typeof v.receiptId === 'string' && /^[A-Za-z0-9_-]{1,128}(?![\s\S])/.test(v.receiptId) && !['__proto__', 'prototype', 'constructor'].includes(v.receiptId);
const baseKeys = ['version', 'provider', 'purpose', 'wabaId', 'phoneE164', 'phoneNumberId', 'recordType', 'createdAt', 'expiresAt'];
const isPlatformWhatsAppScope = (v: R) => typeof v.wabaId === 'string' && /^\d{5,30}(?![\s\S])/.test(v.wabaId) && typeof v.phoneNumberId === 'string' && /^\d{5,30}(?![\s\S])/.test(v.phoneNumberId) && typeof v.phoneE164 === 'string' && /^\+[1-9]\d{7,14}(?![\s\S])/.test(v.phoneE164);
function base(v: unknown, type: string, fields: string[], fixedTtl = true): v is R & Base {
  return object(v) && exact(v, [...baseKeys, ...fields]) && v.version === 1 && v.provider === 'ycloud' && v.purpose === 'platform_support' && isPlatformWhatsAppScope(v) && v.recordType === type && integer(v.createdAt) && integer(v.expiresAt) && v.expiresAt > v.createdAt && (fixedTtl ? v.expiresAt === v.createdAt + LINK_TTL : v.expiresAt <= v.createdAt + LINK_TTL);
}
export function isPlatformWhatsAppLinkKeyMarker(v: unknown): v is PlatformWhatsAppLinkKeyMarker { return object(v) && exact(v, ['version', 'scopeDigest', 'keyFingerprint']) && v.version === 1 && digest(v.scopeDigest) && digest(v.keyFingerprint); }
export function isPlatformWhatsAppLinkUidRecord(v: unknown): v is PlatformWhatsAppLinkUidRecord {
  return base(v, 'link_uid', ['ownerUid', 'uidIndex', 'revision', 'revokeGeneration', 'currentLinkId', 'pendingChallengeId', 'issues'], false) && uid(v.ownerUid) && digest(v.uidIndex) && revision(v.revision) && uuid(v.revokeGeneration) && nullableUuid(v.currentLinkId) && nullableUuid(v.pendingChallengeId) && Array.isArray(v.issues) && v.issues.length <= 3
    && v.issues.every((issue, i, all) => object(issue) && exact(issue, ['issuedAt', 'expiresAt']) && integer(issue.issuedAt) && integer(issue.expiresAt) && issue.expiresAt === issue.issuedAt + LINK_ISSUE_TTL && issue.issuedAt <= v.createdAt && issue.expiresAt <= v.expiresAt && (i === 0 || issue.issuedAt >= all[i - 1].issuedAt))
    && (v.currentLinkId !== null || v.pendingChallengeId !== null || v.issues.length > 0);
}
export function isPlatformWhatsAppLinkPhoneRecord(v: unknown): v is PlatformWhatsAppLinkPhoneRecord { return base(v, 'link_phone', ['uidIndex', 'phoneIndex', 'linkId', 'linkRevision']) && digest(v.uidIndex) && digest(v.phoneIndex) && uuid(v.linkId) && revision(v.linkRevision); }
const proofFields = ['uidIndex', 'phoneIndex', 'revision', 'status', 'validUntil', 'phoneSuffix', 'conversationId', 'account', 'support'];
function proof(v: R & Base): boolean { return digest(v.uidIndex) && digest(v.phoneIndex) && revision(v.revision) && integer(v.validUntil) && typeof v.phoneSuffix === 'string' && /^\d{4}(?![\s\S])/.test(v.phoneSuffix) && digest(v.conversationId) && anchor(v.account) && anchor(v.support); }
export function isPlatformWhatsAppLinkRecord(v: unknown): v is PlatformWhatsAppLinkRecord { return base(v, 'link', [...proofFields, 'confirmedAuthTime']) && proof(v) && ['active', 'revoked'].includes(v.status as string) && v.validUntil === v.expiresAt && integer(v.confirmedAuthTime) && v.confirmedAuthTime * 1000 <= v.createdAt && v.createdAt - v.confirmedAuthTime * 1000 <= 300_000; }
export function isPlatformWhatsAppLinkChallengeRecord(v: unknown): v is PlatformWhatsAppLinkChallengeRecord {
  if (!base(v, 'link_challenge', [...proofFields, 'secretHash', 'attempts', 'verifiedAt', 'resultLinkId']) || !proof(v) || v.validUntil !== v.createdAt + LINK_CHALLENGE_TTL || !digest(v.secretHash) || !['pending', 'verified', 'consumed', 'replaced', 'revoked'].includes(v.status as string) || !Array.isArray(v.attempts) || v.attempts.length > 5 || !nullableUuid(v.resultLinkId)) return false;
  const seen = new Set<string>(); let accepted = 0; let acceptedAt: number | null = null;
  for (const a of v.attempts) {
    if (!object(a) || !exact(a, ['aliases', 'fingerprint', 'accepted', 'at']) || !digest(a.fingerprint) || typeof a.accepted !== 'boolean' || !integer(a.at) || a.at < v.createdAt || a.at > Number(v.validUntil) || !Array.isArray(a.aliases) || a.aliases.length < 1 || a.aliases.length > 3) return false;
    for (let i = 0; i < a.aliases.length; i++) { const alias = a.aliases[i]; if (!digest(alias) || seen.has(alias) || (i > 0 && a.aliases[i - 1] >= alias)) return false; seen.add(alias); }
    if (a.accepted) { accepted++; acceptedAt = a.at; }
  }
  if (accepted > 1 || v.verifiedAt !== acceptedAt) return false;
  if (v.status === 'pending' && accepted !== 0) return false;
  if (['verified', 'consumed'].includes(v.status as string) && accepted !== 1) return false;
  return v.status === 'consumed' ? uuid(v.resultLinkId) : v.resultLinkId === null;
}
export function isPlatformWhatsAppLinkRequestRecord(v: unknown): v is PlatformWhatsAppLinkRequestRecord {
  return base(v, 'link_request', ['uidIndex', 'requestDigest', 'fingerprint', 'action', 'challengeId', 'linkId', 'resultRevision']) && digest(v.uidIndex) && digest(v.requestDigest) && digest(v.fingerprint) && uuid(v.challengeId) && (v.action === 'begin' ? v.linkId === null && v.resultRevision === null : v.action === 'confirm' && uuid(v.linkId) && revision(v.resultRevision));
}
export function isPlatformWhatsAppLinkRevokeRequestRecord(v: unknown): v is PlatformWhatsAppLinkRevokeRequestRecord {
  return base(v, 'link_revoke_request', ['actorUid', 'generation', 'requestDigest', 'challengeId', 'linkId', 'resultRevision']) && uid(v.actorUid) && uuid(v.generation) && digest(v.requestDigest) && nullableUuid(v.challengeId) && nullableUuid(v.linkId) && (v.challengeId !== null || v.linkId !== null) && (v.linkId === null ? v.resultRevision === null : revision(v.resultRevision));
}
export function isPlatformWhatsAppStoredLinkControl(v: unknown): v is PlatformWhatsAppStoredLinkControl { return isPlatformWhatsAppLinkUidRecord(v) || isPlatformWhatsAppLinkPhoneRecord(v) || isPlatformWhatsAppLinkRecord(v) || isPlatformWhatsAppLinkChallengeRecord(v) || isPlatformWhatsAppLinkRequestRecord(v) || isPlatformWhatsAppLinkRevokeRequestRecord(v); }
