import 'server-only';
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { DecodedIdToken, UserRecord } from 'firebase-admin/auth';
import { getAdminAuth, getAdminDb } from '@/lib/firebase/admin';
import type { Database, Transaction } from '@/lib/storage/types';
import { StorageError } from '@/lib/storage/database';
import type { ConsentAnchor, PlatformActor } from '../../../shared/platform-whatsapp-authorization';
import {
  LINK_TTL, LINK_CHALLENGE_TTL, LINK_ISSUE_TTL, LINK_UUID,
  isPlatformWhatsAppLinkKeyMarker, isPlatformWhatsAppLinkUidRecord, isPlatformWhatsAppLinkPhoneRecord,
  isPlatformWhatsAppLinkRecord, isPlatformWhatsAppLinkChallengeRecord, isPlatformWhatsAppLinkRequestRecord, isPlatformWhatsAppLinkRevokeRequestRecord,
  isPlatformWhatsAppStoredLinkControl,
  type PlatformWhatsAppLinkUidRecord as Owner, type PlatformWhatsAppLinkPhoneRecord as Phone,
  type PlatformWhatsAppLinkRecord as Link, type PlatformWhatsAppLinkChallengeRecord as Challenge,
  type PlatformWhatsAppLinkRequestRecord as RequestRecord, type PlatformWhatsAppLinkRevokeRequestRecord as RevokeRecord,
} from '../../../shared/platform-whatsapp-link-records';
import { PLATFORM_PHONE_PATTERN, isPlatformWhatsAppConversationRecord, type PlatformWhatsAppScope } from '../../../shared/platform-whatsapp-records';
import { getPlatformWhatsAppConfig, getPlatformWhatsAppLinkKey } from './platform-whatsapp-config';
import { platformWhatsAppDigest } from './platform-whatsapp-crypto';
import { assertPlatformWhatsAppNow, normalizePlatformWhatsAppConnection, platformWhatsAppIdentity, samePlatformWhatsAppScope } from './platform-whatsapp-store';
import { readVerifiedConsentAnchor } from './consent';
import type { NormalizedYCloudEvent } from './ycloud-webhook';
import { HttpError } from './http';
import { readOwnerWorkCancellation, stageOwnerWorkCancellation } from './platform-whatsapp-work-cancellation';

type IncomingText = Omit<Extract<NormalizedYCloudEvent, { kind: 'incoming_text' }>, 'customerSentAt'> & { customerSentAt?: number | null };
import type { PlatformWhatsAppLinkStatus } from '@/types/platform-whatsapp-link';
export type { PlatformWhatsAppLinkStatus } from '@/types/platform-whatsapp-link';
const links = 'platformWhatsAppLinks', challenges = 'platformWhatsAppLinkChallenges';
const unavailable = () => new HttpError(503, 'La vinculación no está disponible.', 'LINK_UNAVAILABLE');
const conflict = () => new HttpError(409, 'La vinculación cambió. Consulta su estado.', 'LINK_CONFLICT');
const unauthorized = () => new HttpError(401, 'Vuelve a autenticarte para continuar.', 'LINK_AUTH_REQUIRED');
const hash = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
const scopeParts = (scope: PlatformWhatsAppScope) => [scope.wabaId, scope.phoneE164, scope.phoneNumberId];
const sameAnchor = (a: ConsentAnchor, b: ConsentAnchor) => a.revision === b.revision && a.fingerprint === b.fingerprint && a.receiptId === b.receiptId;
const sameAnchors = (a: { account: ConsentAnchor; support: ConsentAnchor }, b: { account: ConsentAnchor; support: ConsentAnchor }) => sameAnchor(a.account, b.account) && sameAnchor(a.support, b.support);
const validUid = (uid: unknown): uid is string => typeof uid === 'string' && uid.length > 0 && uid.length <= 128 && !/[\u0000-\u001f]/.test(uid);
function authTime(value: unknown, now: number, recent: boolean): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || !Number.isSafeInteger(value * 1000) || value * 1000 > now || (recent && now - value * 1000 > 300_000)) throw unauthorized();
  return value;
}
async function currentUser(uid: string): Promise<UserRecord> {
  if (!validUid(uid)) throw unauthorized();
  let user: UserRecord;
  try { user = await getAdminAuth().getUser(uid); }
  catch (error) { if (error && typeof error === 'object' && 'code' in error && error.code === 'auth/user-not-found') throw unauthorized(); throw unavailable(); }
  if (!user || user.uid !== uid || user.disabled !== false) throw unauthorized();
  if (user.tokensValidAfterTime !== undefined && (typeof user.tokensValidAfterTime !== 'string' || !Number.isFinite(Date.parse(user.tokensValidAfterTime)))) throw unauthorized();
  return user;
}
function checkCutoff(user: UserRecord, at: number) { if (user.tokensValidAfterTime !== undefined && at * 1000 < Date.parse(user.tokensValidAfterTime)) throw unauthorized(); }
async function webUser(user: DecodedIdToken, now: number, recent: boolean) {
  assertPlatformWhatsAppNow(now);
  if (!user || !validUid(user.uid)) throw unauthorized();
  const at = authTime(user.auth_time, now, false); checkCutoff(await currentUser(user.uid), at);
  if (recent && now - at * 1000 > 300_000) throw new HttpError(428, 'Vuelve a autenticarte para continuar.', 'LINK_RECENT_AUTH_REQUIRED');
  return at;
}
function configuration() {
  const config = getPlatformWhatsAppConfig(), key = getPlatformWhatsAppLinkKey();
  if (!config.scope || config.contentKey.length !== 32 || !key) return null;
  const scope = config.scope, parts = scopeParts(scope), scopeDigest = hash(['sarin-link-scope', 1, ...parts]);
  return { scope, parts, key, contentKey: config.contentKey, scopeDigest, markerId: 'platform_whatsapp_link_key_' + scopeDigest,
    digest: (domain: string, values: string[]) => platformWhatsAppDigest(domain, [...parts, ...values], key) };
}
type Config = NonNullable<ReturnType<typeof configuration>>;
function requireConfiguration() { const config = configuration(); if (!config) throw unavailable(); return config; }
async function readMarkerState(tx: Transaction, db: Database, config: Config): Promise<'matching' | 'empty' | 'unavailable'> {
  const value = (await tx.get(db.collection('serverSettings').doc(config.markerId))).data();
  if (value !== undefined) {
    if (!isPlatformWhatsAppLinkKeyMarker(value) || value.scopeDigest !== config.scopeDigest || value.keyFingerprint !== config.digest('link-key-marker-v1', [])) return 'unavailable';
    return 'matching';
  }
  const first = await tx.get(db.collection(links).limit(1)), second = await tx.get(db.collection(challenges).limit(1));
  return !first.empty || !second.empty ? 'unavailable' : 'empty';
}
async function readMarker(tx: Transaction, db: Database, config: Config): Promise<boolean> {
  const state = await readMarkerState(tx, db, config);
  if (state === 'unavailable') throw unavailable();
  return state === 'empty';
}
function requestId(id: string) { if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{8,128}(?![\s\S])/.test(id) || id.startsWith('revoke_v1_')) throw new HttpError(400, 'Solicitud no válida.', 'LINK_INVALID'); }
async function read<T>(tx: Transaction, db: Database, collection: string, id: string, guard: (v: unknown) => v is T): Promise<T | null> {
  const value = (await tx.get(db.collection(collection).doc(id))).data();
  if (value === undefined) return null; if (!guard(value)) throw unavailable();
  if (isPlatformWhatsAppStoredLinkControl(value)) {
    const expected = value.recordType === 'link_uid' ? 'uid_' + value.uidIndex : value.recordType === 'link_phone' ? 'phone_' + value.phoneIndex : value.recordType === 'link_request' ? 'request_' + value.requestDigest : value.recordType === 'link_revoke_request' ? 'revoke_' + value.requestDigest : id;
    if (id !== expected) throw unavailable();
  }
  return value;
}
async function ownerLookup(tx: Transaction, db: Database, uid: string) {
  const matches = await tx.get(db.collection(links).where('ownerUid', '==', uid).limit(2));
  if (matches.size > 1) throw unavailable(); const doc = matches.docs[0]; if (!doc) return null;
  const owner = doc.data(); if (!isPlatformWhatsAppLinkUidRecord(owner) || owner.ownerUid !== uid || doc.id !== 'uid_' + owner.uidIndex) throw unavailable();
  return owner;
}
async function readOwner(tx: Transaction, db: Database, owner: Owner | null, now: number) {
  if (!owner) return { owner, link: null, challenge: null, phone: null, current: null, pending: null };
  if (owner.createdAt > now) throw unavailable();
  const link = owner.currentLinkId ? await read(tx, db, links, 'link_' + owner.currentLinkId, isPlatformWhatsAppLinkRecord) : null;
  const challenge = owner.pendingChallengeId ? await read(tx, db, challenges, 'challenge_' + owner.pendingChallengeId, isPlatformWhatsAppLinkChallengeRecord) : null;
  if ((owner.currentLinkId && !link) || (owner.pendingChallengeId && !challenge)) throw unavailable();
  for (const child of [link, challenge]) if (child && (child.uidIndex !== owner.uidIndex || !samePlatformWhatsAppScope(child, owner))) throw unavailable();
  if (link && link.status !== 'active') throw unavailable();
  if (challenge && !['pending', 'verified'].includes(challenge.status)) throw unavailable();
  const dates = [...owner.issues.map(i => ({ createdAt: i.issuedAt, expiresAt: i.expiresAt })), ...link ? [link] : [], ...challenge ? [{ createdAt: challenge.createdAt, expiresAt: challenge.validUntil }] : []];
  if (!dates.length || owner.createdAt !== Math.max(...dates.map(i => i.createdAt)) || owner.expiresAt !== Math.max(...dates.map(i => i.expiresAt))) throw unavailable();
  const phone = link ? await read(tx, db, links, 'phone_' + link.phoneIndex, isPlatformWhatsAppLinkPhoneRecord) : null;
  if (phone && !samePlatformWhatsAppScope(phone, owner)) throw unavailable();
  if (phone && link) {
    if (phone.linkId === owner.currentLinkId) {
      if (phone.uidIndex !== owner.uidIndex || phone.linkRevision !== link.revision || phone.createdAt !== link.createdAt || phone.expiresAt !== link.expiresAt) throw unavailable();
    } else {
      const replacement = await read(tx, db, links, 'link_' + phone.linkId, isPlatformWhatsAppLinkRecord), replacementOwner = await read(tx, db, links, 'uid_' + phone.uidIndex, isPlatformWhatsAppLinkUidRecord);
      if (!replacement || !replacementOwner || replacementOwner.currentLinkId !== phone.linkId || replacementOwner.uidIndex !== phone.uidIndex || replacement.uidIndex !== phone.uidIndex || replacement.phoneIndex !== phone.phoneIndex || replacement.revision !== phone.linkRevision || replacement.status !== 'active' || replacement.createdAt !== phone.createdAt || replacement.expiresAt !== phone.expiresAt || !samePlatformWhatsAppScope(replacement, owner) || !samePlatformWhatsAppScope(replacementOwner, owner)) throw unavailable();
    }
  }
  if (link && now < link.validUntil && (!phone || phone.uidIndex !== owner.uidIndex || phone.linkId !== owner.currentLinkId || phone.linkRevision !== link.revision || phone.createdAt !== link.createdAt || phone.expiresAt !== link.expiresAt || phone.phoneIndex !== link.phoneIndex)) throw unavailable();
  return { owner, link, challenge, phone, current: link && now < link.validUntil ? link : null, pending: challenge && now < challenge.validUntil ? challenge : null };
}
type Facts = Awaited<ReturnType<typeof readOwner>>;
function stageLink(tx: Transaction, db: Database, id: string, value: Link, create = false) {
  if (!isPlatformWhatsAppLinkRecord(value)) throw unavailable();
  const ref = db.collection(links).doc('link_' + id);
  if (create) tx.create(ref, value); else tx.set(ref, value);
}
function stageChallenge(tx: Transaction, db: Database, id: string, value: Challenge, create = false) {
  if (!isPlatformWhatsAppLinkChallengeRecord(value)) throw unavailable();
  const ref = db.collection(challenges).doc('challenge_' + id);
  if (create) tx.create(ref, value); else tx.set(ref, value);
}
function stageExpiredLinkRelease(tx: Transaction, db: Database, facts: Facts) {
  if (!facts.owner?.currentLinkId || !facts.link || facts.current) return;
  const terminal: Link = { ...facts.link, status: 'revoked', revision: facts.link.revision + 1 };
  stageLink(tx, db, facts.owner.currentLinkId, terminal);
  if (facts.phone?.uidIndex === facts.owner.uidIndex && facts.phone.linkId === facts.owner.currentLinkId && facts.phone.linkRevision === facts.link.revision) {
    tx.delete(db.collection(links).doc('phone_' + facts.link.phoneIndex));
  }
}
async function anchors(tx: Transaction, db: Database, uid: string) {
  const account = await readVerifiedConsentAnchor(uid, 'account', undefined, db, tx), support = await readVerifiedConsentAnchor(uid, 'platform_support', undefined, db, tx);
  if (!account.active || !support.active || !account.receiptId || !support.receiptId) throw new HttpError(428, 'Se requieren las autorizaciones vigentes.', 'CONSENT_REQUIRED');
  return { account: { revision: account.revision, fingerprint: account.fingerprint, receiptId: account.receiptId }, support: { revision: support.revision, fingerprint: support.fingerprint, receiptId: support.receiptId } };
}
function stageOwner(tx: Transaction, db: Database, owner: Owner, current: { id: string; value: Link } | null, pending: { id: string; value: Challenge } | null, now: number, generation: string, issues = owner.issues) {
  const liveIssues = issues.filter(i => i.issuedAt > now - LINK_ISSUE_TTL && i.issuedAt <= now);
  const dates = [...liveIssues.map(i => ({ createdAt: i.issuedAt, expiresAt: i.expiresAt })), ...current ? [current.value] : [], ...pending ? [{ createdAt: pending.value.createdAt, expiresAt: pending.value.validUntil }] : []];
  const ref = db.collection(links).doc('uid_' + owner.uidIndex);
  if (!dates.length) { tx.delete(ref); return; }
  const updated: Owner = { ...owner, createdAt: Math.max(...dates.map(i => i.createdAt)), expiresAt: Math.max(...dates.map(i => i.expiresAt)), revision: owner.revision + 1, revokeGeneration: generation, currentLinkId: current?.id ?? null, pendingChallengeId: pending?.id ?? null, issues: liveIssues };
  if (!isPlatformWhatsAppLinkUidRecord(updated)) throw unavailable(); tx.set(ref, updated);
}
const liveLink = (facts: Facts) => facts.current ? { id: facts.owner!.currentLinkId!, value: facts.current } : null;
function issuance(config: Config, id: string, c: Challenge) { return config.digest('link-issuance-v1', [id, c.secretHash, c.uidIndex, c.phoneIndex, String(c.revision), String(c.validUntil), c.conversationId, JSON.stringify([c.account.revision, c.account.fingerprint, c.account.receiptId]), JSON.stringify([c.support.revision, c.support.fingerprint, c.support.receiptId])]); }
function sameBytes(a: Buffer, b: Buffer) { return a.length === b.length && timingSafeEqual(a, b); }
function decoded(value: string): Buffer | null { if (!/^[A-Za-z0-9_-]{43}(?![\s\S])/.test(value)) return null; const b = Buffer.from(value, 'base64url'); return b.length === 32 && b.toString('base64url') === value ? b : null; }
function conversation(config: Config, phone: string) { return platformWhatsAppDigest('conversation', [...config.parts, phone], config.contentKey); }

export async function beginPlatformWhatsAppLink(user: DecodedIdToken, input: { phoneE164: string; requestId: string }, db: Database = getAdminDb(), now = Date.now()): Promise<{ challengeId: string; code: string; expiresAt: number }> {
  await webUser(user, now, true); requestId(input.requestId); const config = requireConfiguration();
  if (!PLATFORM_PHONE_PATTERN.test(input.phoneE164) || input.phoneE164 === config.scope.phoneE164) throw new HttpError(400, 'Número no válido.', 'LINK_INVALID');
  const id = randomUUID(), generation = randomUUID(), secret = randomBytes(32), uidIndex = config.digest('link-uid-v1', [user.uid]), phoneIndex = config.digest('link-phone-v1', [input.phoneE164]);
  const requestDigest = config.digest('link-request-v1', [uidIndex, input.requestId]), fingerprint = config.digest('link-request-body-v1', ['begin', input.phoneE164]);
  return db.runTransaction(async tx => {
    const bootstrap = await readMarker(tx, db, config), owner = await ownerLookup(tx, db, user.uid);
    const direct = await read(tx, db, links, 'uid_' + uidIndex, isPlatformWhatsAppLinkUidRecord);
    if (owner?.uidIndex !== direct?.uidIndex || (owner && (owner.uidIndex !== uidIndex || !samePlatformWhatsAppScope(owner, config.scope)))) throw unavailable();
    const prior = await read(tx, db, challenges, 'request_' + requestDigest, isPlatformWhatsAppLinkRequestRecord), facts = await readOwner(tx, db, owner, now), consent = await anchors(tx, db, user.uid);
    if (prior) {
      if (prior.requestDigest !== requestDigest || prior.uidIndex !== uidIndex || !samePlatformWhatsAppScope(prior, config.scope)) throw unavailable();
      if (prior.action !== 'begin' || prior.fingerprint !== fingerprint) throw conflict();
      throw new HttpError(409, 'El código anterior no se puede recuperar. Inicia una nueva solicitud.', 'CHALLENGE_CODE_UNAVAILABLE');
    }
    const issues = (owner?.issues ?? []).filter(i => i.issuedAt > now - LINK_ISSUE_TTL && i.issuedAt <= now);
    if (issues.length >= 3) throw new HttpError(429, 'Espera antes de solicitar otro código.', 'LINK_RATE_LIMIT');
    const c: Challenge = { ...platformWhatsAppIdentity(config.scope), recordType: 'link_challenge', createdAt: now, expiresAt: now + LINK_TTL, validUntil: now + LINK_CHALLENGE_TTL, uidIndex, phoneIndex, revision: (owner?.revision ?? 0) + 1, status: 'pending', phoneSuffix: input.phoneE164.slice(-4), conversationId: conversation(config, input.phoneE164), secretHash: createHash('sha256').update(secret).digest('hex'), ...consent, attempts: [], verifiedAt: null, resultLinkId: null };
    const code = 'sarinbot.link.v1:' + id + ':' + secret.toString('base64url') + ':' + Buffer.from(issuance(config, id, c), 'hex').toString('base64url');
    const request: RequestRecord = { ...platformWhatsAppIdentity(config.scope), recordType: 'link_request', createdAt: now, expiresAt: now + LINK_TTL, uidIndex, requestDigest, fingerprint, action: 'begin', challengeId: id, linkId: null, resultRevision: null };
    stageExpiredLinkRelease(tx, db, facts);
    if (bootstrap) tx.create(db.collection('serverSettings').doc(config.markerId), { version: 1, scopeDigest: config.scopeDigest, keyFingerprint: config.digest('link-key-marker-v1', []) });
    if (facts.challenge) stageChallenge(tx, db, owner!.pendingChallengeId!, { ...facts.challenge, status: 'replaced' });
    stageChallenge(tx, db, id, c, true); tx.create(db.collection(challenges).doc('request_' + requestDigest), request);
    stageOwner(tx, db, owner ?? { ...platformWhatsAppIdentity(config.scope), recordType: 'link_uid', ownerUid: user.uid, uidIndex, revision: 0, revokeGeneration: generation, currentLinkId: null, pendingChallengeId: null, issues: [], createdAt: now, expiresAt: now + LINK_ISSUE_TTL }, liveLink(facts), { id, value: c }, now, generation, [...issues, { issuedAt: now, expiresAt: now + LINK_ISSUE_TTL }]);
    return { challengeId: id, code, expiresAt: c.validUntil };
  });
}

export async function verifyPlatformWhatsAppLinkInbound(event: IncomingText, db: Database = getAdminDb(), now = Date.now()): Promise<'not_control' | 'verified' | 'rejected'> {
  if (typeof event?.text !== 'string' || !event.text.startsWith('sarinbot.link.')) return 'not_control';
  // Parse a safe challenge identity before configuration/storage; malformed reserved text is always consumed.
  const parts = event.text.split(':');
  if (parts.length !== 4 || parts[0] !== 'sarinbot.link.v1' || !LINK_UUID.test(parts[1])) return 'rejected';
  const secret = decoded(parts[2]), mac = decoded(parts[3]), malformed = !secret || !mac;
  assertPlatformWhatsAppNow(now); const config = configuration();
  if (!config) { if (malformed) return 'rejected'; throw unavailable(); }
  if (event.provider !== 'ycloud' || event.kind !== 'incoming_text' || event.sourceEventType !== 'whatsapp.inbound_message.received' || event.wabaId !== config.scope.wabaId || event.businessPhone !== config.scope.phoneE164 || !PLATFORM_PHONE_PATTERN.test(event.customerPhone) || event.customerPhone === config.scope.phoneE164 || ![event.eventId, event.messageId].every(v => typeof v === 'string' && /^[\x21-\x7e]{1,256}(?![\s\S])/.test(v)) || !(event.whatsappMessageId === null || typeof event.whatsappMessageId === 'string' && event.whatsappMessageId.length > 0 && event.whatsappMessageId.length <= 1024)) return 'rejected';
  const id = parts[1], phoneIndex = config.digest('link-phone-v1', [event.customerPhone]);
  const discover = async (tx: Transaction) => {
    const marker = await readMarkerState(tx, db, config);
    if (marker === 'unavailable') { if (malformed) return null; throw unavailable(); }
    const c = await read(tx, db, challenges, 'challenge_' + id, isPlatformWhatsAppLinkChallengeRecord);
    if (!c || c.phoneIndex !== phoneIndex || !samePlatformWhatsAppScope(c, config.scope) || c.validUntil <= now) return null;
    const owner = await read(tx, db, links, 'uid_' + c.uidIndex, isPlatformWhatsAppLinkUidRecord);
    if (!owner || owner.uidIndex !== c.uidIndex || owner.pendingChallengeId !== id || config.digest('link-uid-v1', [owner.ownerUid]) !== c.uidIndex || !samePlatformWhatsAppScope(owner, config.scope)) return null;
    if ((await ownerLookup(tx, db, owner.ownerUid))?.uidIndex !== owner.uidIndex) throw unavailable();
    return { c, owner };
  };
  const initial = await db.runTransaction(discover); if (!initial) return 'rejected';
  await currentUser(initial.owner.ownerUid); // Proof has no saved auth_time and grants no link; confirmation checks token cutoff.
  return db.runTransaction(async tx => {
    const state = await discover(tx); if (!state || state.owner.ownerUid !== initial.owner.ownerUid) return 'rejected';
    const { c, owner } = state; const facts = await readOwner(tx, db, owner, now), consent = await anchors(tx, db, owner.ownerUid);
    if (!facts.pending || !sameAnchors(c, consent)) return 'rejected';
    const aliases = [config.digest('link-provider-v1', ['event', event.eventId]), config.digest('link-provider-v1', ['message', event.messageId]), ...event.whatsappMessageId ? [config.digest('link-provider-v1', ['wamid', event.whatsappMessageId])] : []].sort();
    const fingerprint = config.digest('link-attempt-body-v1', [event.text]);
    const overlap = c.attempts.filter(a => a.aliases.some(v => aliases.includes(v)));
    if (overlap.length) return overlap.length === 1 && overlap[0].fingerprint === fingerprint && overlap[0].accepted ? 'verified' : 'rejected';
    if (c.status !== 'pending' || c.attempts.length >= 5) return 'rejected';
    const hashMatches = !!secret && sameBytes(createHash('sha256').update(secret).digest(), Buffer.from(c.secretHash, 'hex'));
    const macMatches = !!mac && sameBytes(mac, Buffer.from(issuance(config, id, c), 'hex'));
    const accepted = hashMatches && macMatches;
    const updated: Challenge = { ...c, attempts: [...c.attempts, { aliases, fingerprint, accepted, at: now }], status: accepted ? 'verified' : 'pending', verifiedAt: accepted ? now : null };
    stageChallenge(tx, db, id, updated); return accepted ? 'verified' : 'rejected';
  });
}

export async function confirmPlatformWhatsAppLink(user: DecodedIdToken, input: { challengeId: string; requestId: string }, db: Database = getAdminDb(), now = Date.now()): Promise<{ linkId: string; revision: number; expiresAt: number }> {
  const at = await webUser(user, now, true); requestId(input.requestId); if (!LINK_UUID.test(input.challengeId)) throw conflict(); const config = requireConfiguration();
  const id = randomUUID(), generation = randomUUID(), displacedGeneration = randomUUID(), uidIndex = config.digest('link-uid-v1', [user.uid]);
  const requestDigest = config.digest('link-request-v1', [uidIndex, input.requestId]), fingerprint = config.digest('link-request-body-v1', ['confirm', input.challengeId]);
  return db.runTransaction(async tx => {
    await readMarker(tx, db, config); const owner = await ownerLookup(tx, db, user.uid), facts = await readOwner(tx, db, owner, now);
    if (!owner || owner.uidIndex !== uidIndex || !samePlatformWhatsAppScope(owner, config.scope)) throw conflict();
    const prior = await read(tx, db, challenges, 'request_' + requestDigest, isPlatformWhatsAppLinkRequestRecord), consent = await anchors(tx, db, user.uid);
    if (prior) {
      if (prior.requestDigest !== requestDigest || prior.uidIndex !== uidIndex || !samePlatformWhatsAppScope(prior, config.scope)) throw unavailable();
      if (prior.action !== 'confirm' || prior.fingerprint !== fingerprint || prior.challengeId !== input.challengeId || prior.linkId !== owner.currentLinkId || prior.resultRevision !== facts.current?.revision || !facts.current || !sameAnchors(facts.current, consent)) throw conflict();
      return { linkId: prior.linkId!, revision: facts.current.revision, expiresAt: facts.current.validUntil };
    }
    const c = facts.pending;
    if (!c || owner.pendingChallengeId !== input.challengeId || c.status !== 'verified' || !sameAnchors(c, consent)) throw conflict();
    const destination = await read(tx, db, links, 'phone_' + c.phoneIndex, isPlatformWhatsAppLinkPhoneRecord);
    let displaced: Facts | null = null;
    if (destination) {
      if (destination.phoneIndex !== c.phoneIndex || !samePlatformWhatsAppScope(destination, config.scope)) throw unavailable();
      const oldLink = await read(tx, db, links, 'link_' + destination.linkId, isPlatformWhatsAppLinkRecord);
      const oldOwner = await read(tx, db, links, 'uid_' + destination.uidIndex, isPlatformWhatsAppLinkUidRecord);
      if (!oldLink || !oldOwner || oldOwner.uidIndex !== destination.uidIndex || oldLink.uidIndex !== destination.uidIndex || oldLink.phoneIndex !== c.phoneIndex || oldOwner.currentLinkId !== destination.linkId || oldLink.revision !== destination.linkRevision || oldLink.expiresAt !== destination.expiresAt || oldLink.createdAt !== destination.createdAt || !samePlatformWhatsAppScope(oldLink, config.scope)) throw unavailable();
      const uniqueOwner = await ownerLookup(tx, db, oldOwner.ownerUid);
      if (!uniqueOwner || uniqueOwner.uidIndex !== oldOwner.uidIndex
        || !samePlatformWhatsAppScope(oldOwner, config.scope)
        || config.digest('link-uid-v1', [oldOwner.ownerUid]) !== oldOwner.uidIndex) throw unavailable();
      displaced = await readOwner(tx, db, oldOwner, now);
      if (destination.uidIndex !== uidIndex && displaced.current) throw conflict();
    }
    const cancellation = await readOwnerWorkCancellation(user.uid, tx, db);
    const displacedCancellation = displaced?.owner && displaced.owner.uidIndex !== uidIndex ? await readOwnerWorkCancellation(displaced.owner.ownerUid, tx, db) : null;
    const link: Link = { ...platformWhatsAppIdentity(config.scope), recordType: 'link', uidIndex, phoneIndex: c.phoneIndex, revision: 1, status: 'active', createdAt: now, validUntil: now + LINK_TTL, expiresAt: now + LINK_TTL, phoneSuffix: c.phoneSuffix, conversationId: c.conversationId, ...consent, confirmedAuthTime: at };
    const phone: Phone = { ...platformWhatsAppIdentity(config.scope), recordType: 'link_phone', uidIndex, phoneIndex: c.phoneIndex, linkId: id, linkRevision: 1, createdAt: now, expiresAt: link.expiresAt };
    const request: RequestRecord = { ...platformWhatsAppIdentity(config.scope), recordType: 'link_request', uidIndex, requestDigest, fingerprint, action: 'confirm', challengeId: input.challengeId, linkId: id, resultRevision: 1, createdAt: now, expiresAt: now + LINK_TTL };
    stageOwnerWorkCancellation(cancellation, tx, db, now); stageOwnerWorkCancellation(displacedCancellation, tx, db, now);
    if (facts.link) { stageLink(tx, db, owner.currentLinkId!, { ...facts.link, status: 'revoked', revision: facts.link.revision + 1 }); if (facts.phone?.linkId === owner.currentLinkId && facts.phone.linkRevision === facts.link.revision) tx.delete(db.collection(links).doc('phone_' + facts.link.phoneIndex)); }
    if (displaced?.owner && displaced.owner.uidIndex !== uidIndex) {
      if (displaced.link) stageLink(tx, db, displaced.owner.currentLinkId!, { ...displaced.link, status: 'revoked', revision: displaced.link.revision + 1 });
      stageOwner(tx, db, displaced.owner, null, displaced.pending ? { id: displaced.owner.pendingChallengeId!, value: displaced.pending } : null, now, displacedGeneration);
    }
    stageChallenge(tx, db, input.challengeId, { ...c, status: 'consumed', resultLinkId: id });
    stageLink(tx, db, id, link, true); tx.set(db.collection(links).doc('phone_' + c.phoneIndex), phone); tx.create(db.collection(challenges).doc('request_' + requestDigest), request);
    stageOwner(tx, db, owner, { id, value: link }, null, now, generation);
    return { linkId: id, revision: 1, expiresAt: link.validUntil };
  });
}

export async function readPlatformWhatsAppLinkStatus(user: DecodedIdToken, db: Database = getAdminDb(), now = Date.now()): Promise<PlatformWhatsAppLinkStatus> {
  await webUser(user, now, false); const config = configuration();
  return db.runTransaction(async tx => {
    const facts = await readOwner(tx, db, await ownerLookup(tx, db, user.uid), now); let available = false;
    if (config) { try { await readMarker(tx, db, config); available = !facts.owner || samePlatformWhatsAppScope(facts.owner, config.scope) && facts.owner.uidIndex === config.digest('link-uid-v1', [user.uid]); } catch (error) { if (!(error instanceof HttpError) || error.code !== 'LINK_UNAVAILABLE') throw error; } }
    return { available, revokeGeneration: facts.current || facts.pending ? facts.owner!.revokeGeneration : null,
      current: facts.current ? { linkId: facts.owner!.currentLinkId!, revision: facts.current.revision, expiresAt: facts.current.validUntil, maskedPhone: '••••' + facts.current.phoneSuffix } : null,
      pending: facts.pending ? { challengeId: facts.owner!.pendingChallengeId!, revision: facts.pending.revision, expiresAt: facts.pending.validUntil, maskedPhone: '••••' + facts.pending.phoneSuffix, proof: facts.pending.status === 'verified' ? 'verified' : 'pending' } : null };
  });
}

export async function revokePlatformWhatsAppLink(user: DecodedIdToken, input: string, db: Database = getAdminDb(), now = Date.now()): Promise<void> {
  await webUser(user, now, true);
  const parsed = /^revoke_v1_([0-9a-f-]{36})_([0-9a-f-]{36})(?![\s\S])/.exec(input);
  if (!parsed || !LINK_UUID.test(parsed[1]) || !LINK_UUID.test(parsed[2])) throw new HttpError(400, 'Solicitud no válida.', 'LINK_INVALID');
  const requestDigest = hash(['sarin-link-revoke-request', 1, user.uid, input]), generation = randomUUID();
  await db.runTransaction(async tx => {
    const prior = await read(tx, db, challenges, 'revoke_' + requestDigest, isPlatformWhatsAppLinkRevokeRequestRecord);
    if (prior) { if (prior.actorUid !== user.uid || prior.generation !== parsed[1] || prior.requestDigest !== requestDigest) throw unavailable(); return; }
    const owner = await ownerLookup(tx, db, user.uid), facts = await readOwner(tx, db, owner, now);
    if (!owner || owner.revokeGeneration !== parsed[1] || !facts.current && !facts.pending) throw conflict();
    const cancellation = await readOwnerWorkCancellation(user.uid, tx, db);
    const record: RevokeRecord = { ...platformWhatsAppIdentity(owner), recordType: 'link_revoke_request', createdAt: now, expiresAt: now + LINK_TTL, actorUid: user.uid, generation: parsed[1], requestDigest, challengeId: facts.pending ? owner.pendingChallengeId : null, linkId: facts.current ? owner.currentLinkId : null, resultRevision: facts.current ? facts.current.revision + 1 : null };
    stageOwnerWorkCancellation(cancellation, tx, db, now);
    if (facts.link) { stageLink(tx, db, owner.currentLinkId!, { ...facts.link, status: 'revoked', revision: facts.link.revision + 1 }); if (facts.phone?.uidIndex === owner.uidIndex && facts.phone.linkId === owner.currentLinkId && facts.phone.linkRevision === facts.link.revision) tx.delete(db.collection(links).doc('phone_' + facts.link.phoneIndex)); }
    if (facts.challenge) stageChallenge(tx, db, owner.pendingChallengeId!, { ...facts.challenge, status: 'revoked' });
    stageOwner(tx, db, owner, null, null, now, generation); tx.create(db.collection(challenges).doc('revoke_' + requestDigest), record);
  });
  if (process.env.PLATFORM_WHATSAPP_PROCESSING_ENABLED === 'true') { const { recognizePlatformWorkCancellation } = await import('./platform-whatsapp-worker'); await recognizePlatformWorkCancellation(); }
}

async function actorFacts(tx: Transaction, db: Database, config: Config, uidIndex: string, now: number) {
  await readMarker(tx, db, config); const owner = await read(tx, db, links, 'uid_' + uidIndex, isPlatformWhatsAppLinkUidRecord);
  if (!owner || owner.uidIndex !== uidIndex || !samePlatformWhatsAppScope(owner, config.scope) || config.digest('link-uid-v1', [owner.ownerUid]) !== uidIndex) return null;
  if ((await ownerLookup(tx, db, owner.ownerUid))?.uidIndex !== uidIndex) throw unavailable();
  const facts = await readOwner(tx, db, owner, now); if (!facts.current) return null;
  const consent = await anchors(tx, db, owner.ownerUid); if (!sameAnchors(facts.current, consent)) return null;
  const conv = (await tx.get(db.collection('platformWhatsAppConversations').doc(facts.current.conversationId))).data();
  if (!isPlatformWhatsAppConversationRecord(conv) || !samePlatformWhatsAppScope(conv, config.scope) || conv.expiresAt <= now || conv.lastInboundAt === null) return null;
  const connection = normalizePlatformWhatsAppConnection((await tx.get(db.collection('serverSettings').doc('platform_whatsapp'))).data(), config.scope, now);
  const actor: PlatformActor = { uid: owner.ownerUid, linkId: owner.currentLinkId!, linkRevision: facts.current.revision, account: consent.account, support: consent.support, connectionRevision: connection.connectionRevision, conversationRevision: conv.revision };
  return { actor, link: facts.current };
}
export async function resolvePlatformWhatsAppActor(phoneE164: string, conversationId: string, db: Database = getAdminDb(), now = Date.now()): Promise<PlatformActor | null> {
  assertPlatformWhatsAppNow(now); const config = configuration();
  if (!config || !PLATFORM_PHONE_PATTERN.test(phoneE164) || phoneE164 === config.scope.phoneE164 || conversation(config, phoneE164) !== conversationId) return null;
  try {
    const phoneIndex = config.digest('link-phone-v1', [phoneE164]);
    const snapshot = async (tx: Transaction) => {
      await readMarker(tx, db, config); const phone = await read(tx, db, links, 'phone_' + phoneIndex, isPlatformWhatsAppLinkPhoneRecord);
      if (!phone || phone.phoneIndex !== phoneIndex || !samePlatformWhatsAppScope(phone, config.scope) || phone.expiresAt <= now) return null;
      const found = await actorFacts(tx, db, config, phone.uidIndex, now);
      return found && found.link.phoneIndex === phoneIndex && found.link.conversationId === conversationId && found.actor.linkId === phone.linkId ? found : null;
    };
    const first = await db.runTransaction(snapshot); if (!first) return null;
    checkCutoff(await currentUser(first.actor.uid), authTime(first.link.confirmedAuthTime, now, false));
    return db.runTransaction(async tx => { const next = await snapshot(tx); return next && JSON.stringify(first) === JSON.stringify(next) ? next.actor : null; });
  } catch (error) { if (error instanceof HttpError && ['LINK_UNAVAILABLE', 'LINK_AUTH_REQUIRED', 'CONSENT_REQUIRED'].includes(error.code ?? '')) return null; throw error; }
}
export async function assertPlatformWhatsAppAuthorization(actor: PlatformActor, tx?: Transaction, db: Database = getAdminDb(), now = Date.now()): Promise<void> {
  assertPlatformWhatsAppNow(now);
  const config = requireConfiguration(), user = tx ? null : await currentUser(actor.uid);
  const check = async (transaction: Transaction) => {
    const found = await actorFacts(transaction, db, config, config.digest('link-uid-v1', [actor.uid]), now);
    if (found) {
      if (user) checkCutoff(user, authTime(found.link.confirmedAuthTime, now, false));
      if (found.actor.linkId !== actor.linkId || found.actor.linkRevision !== actor.linkRevision
        || !sameAnchors(found.actor, actor) || found.actor.connectionRevision !== actor.connectionRevision
        || found.actor.conversationRevision !== actor.conversationRevision) throw new HttpError(403, 'La autorización cambió.', 'LINK_AUTHORIZATION_DENIED');
    }
    // A1 always denies automation. Future effect authorization must prepare current identity outside a caller's transaction.
    throw new HttpError(403, 'La automatización no está autorizada.', 'LINK_AUTHORIZATION_DENIED');
  };
  if (tx) await check(tx); else await db.runTransaction(check);
}

/** Ephemeral read facts authorize encrypted descriptor retention only. */
export interface AudioRetentionIdentity {
  uid: string;
  confirmedAuthTime: number;
  linkId: string;
  linkRevision: number;
  account: ConsentAnchor;
  support: ConsentAnchor;
  conversationId: string;
}
async function audioRetentionFacts(customerPhone: string, scope: PlatformWhatsAppScope, tx: Transaction, db: Database, config: Config, now: number): Promise<AudioRetentionIdentity | null> {
  if (!samePlatformWhatsAppScope(config.scope, scope) || !PLATFORM_PHONE_PATTERN.test(customerPhone) || customerPhone === scope.phoneE164) return null;
  const marker = await readMarkerState(tx, db, config);
  if (marker !== 'matching') {
    // Missing bootstrap is a known absence; a nonempty/malformed marker is corruption.
    if (marker === 'unavailable') throw unavailable();
    return null;
  }
  const phoneIndex = config.digest('link-phone-v1', [customerPhone]);
  const phone = await read(tx, db, links, 'phone_' + phoneIndex, isPlatformWhatsAppLinkPhoneRecord);
  if (!phone) return null;
  if (phone.phoneIndex !== phoneIndex || !samePlatformWhatsAppScope(phone, scope)) throw unavailable();
  const owner = await read(tx, db, links, 'uid_' + phone.uidIndex, isPlatformWhatsAppLinkUidRecord);
  if (!owner || owner.uidIndex !== phone.uidIndex || !samePlatformWhatsAppScope(owner, scope) || config.digest('link-uid-v1', [owner.ownerUid]) !== phone.uidIndex) throw unavailable();
  if ((await ownerLookup(tx, db, owner.ownerUid))?.uidIndex !== owner.uidIndex) throw unavailable();
  const facts = await readOwner(tx, db, owner, now);
  if (!facts.current || phone.expiresAt <= now) return null;
  const link = facts.current, conversationId = conversation(config, customerPhone);
  if (owner.currentLinkId !== phone.linkId || link.phoneIndex !== phoneIndex || link.revision !== phone.linkRevision || link.conversationId !== conversationId) throw unavailable();
  let consent: Awaited<ReturnType<typeof anchors>>;
  try { consent = await anchors(tx, db, owner.ownerUid); }
  catch (error) { if (error instanceof HttpError && error.code === 'CONSENT_REQUIRED') return null; throw error; }
  if (!sameAnchors(link, consent)) return null;
  const conv = (await tx.get(db.collection('platformWhatsAppConversations').doc(conversationId))).data();
  if (conv !== undefined && (!isPlatformWhatsAppConversationRecord(conv) || !samePlatformWhatsAppScope(conv, scope))) throw unavailable();
  return { uid: owner.ownerUid, confirmedAuthTime: link.confirmedAuthTime, linkId: phone.linkId, linkRevision: link.revision, account: { ...consent.account }, support: { ...consent.support }, conversationId };
}
export async function preparePlatformWhatsAppAudioRetentionIdentity(customerPhone: string, scope: PlatformWhatsAppScope, db: Database = getAdminDb(), now = Date.now()): Promise<AudioRetentionIdentity | null> {
  assertPlatformWhatsAppNow(now); const config = configuration(); if (!config) return null;
  try {
    const prepared = await db.runTransaction(tx => audioRetentionFacts(customerPhone, scope, tx, db, config, now));
    if (!prepared) return null;
    // Firebase must stay outside every caller/storage callback. D1 and Firebase are not atomic.
    checkCutoff(await currentUser(prepared.uid), authTime(prepared.confirmedAuthTime, now, false));
    return prepared;
  } catch (error) {
    if (error instanceof HttpError && error.code === 'LINK_AUTH_REQUIRED') return null;
    throw unavailable();
  }
}
export async function readPlatformWhatsAppAudioRetentionIdentityInTransaction(prepared: AudioRetentionIdentity, customerPhone: string, scope: PlatformWhatsAppScope, tx: Transaction, db: Database, now: number): Promise<AudioRetentionIdentity | null> {
  assertPlatformWhatsAppNow(now); const config = configuration(); if (!config) return null;
  try {
    const current = await audioRetentionFacts(customerPhone, scope, tx, db, config, now);
    return current && current.uid === prepared.uid && current.confirmedAuthTime === prepared.confirmedAuthTime && current.linkId === prepared.linkId
      && current.linkRevision === prepared.linkRevision && current.conversationId === prepared.conversationId && sameAnchors(current, prepared) ? current : null;
  } catch (error) {
    // The supplied Database owns snapshot/CAS retries; do not disguise its retry signal.
    if (error instanceof StorageError && error.code === 'DATA_CONFLICT') throw error;
    throw unavailable();
  }
}
