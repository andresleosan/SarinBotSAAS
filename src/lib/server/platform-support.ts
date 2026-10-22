import 'server-only';
import { randomUUID } from 'node:crypto';
import { getAdminDb } from '@/lib/firebase/admin';
import type { Database, Transaction } from '@/lib/storage/types';
import type { SupportActor, SupportMessageInput, SupportPage, SupportConversationPage } from '@/types/platform-support';
import { SUPPORT_BODY_TTL, SUPPORT_CONTROL_TTL, isSupportRecord, supportText, type SupportConversation, type SupportMessage } from '../../../shared/platform-support-records';
import { workExact, workInteger, workUuid } from '../../../shared/platform-whatsapp-work';
import { HttpError } from './http';
import { currentSupportUser, repeatSupportUser, supportPermissions, sameSupportPermissions, supportRef, readSupportRecord, stageSupportRecord, supportCrypto, supportMarker, supportNow, supportUuid, supportDenied, supportRequired, supportUnavailable, supportConflict } from './platform-support-core';
import { prepareSupportNotificationWithIdentity, prepareSupportRecipientIdentity, allocateSupportNotification, readSupportNotificationStates } from './platform-support-notifications';

async function authorized(actor: SupportActor, id: string, tx: Transaction, db: Database, at: number) {
  const row = await readSupportRecord(tx, db, 'platformSupportConversations/' + id);
  if (!row || row.recordType !== 'conversation' || row.expiresAt <= at || actor.role === 'customer' && row.ownerUid !== actor.uid) throw supportDenied();
  const permissions = await supportPermissions(actor.uid, tx, db), owner = row.ownerUid === actor.uid ? permissions : await supportPermissions(row.ownerUid, tx, db);
  if (!sameSupportPermissions(row, owner)) throw supportRequired();
  return { row, permissions, owner };
}
export async function createSupportConversation(uid: string, requestId: string, db: Database = getAdminDb()): Promise<{ id: string; revision: number }> {
  const actor = { uid, role: 'customer' as const }; await currentSupportUser(actor); supportUuid(requestId);
  const crypto = supportCrypto(), at = supportNow(), id = randomUUID(), requestDigest = crypto.digest('create-request', [uid, requestId]), path = 'platformSupportConversations/create_' + requestDigest;
  return db.runTransaction(async tx => {
    const permissions = await supportPermissions(uid, tx, db), marker = await supportMarker(tx, db, crypto, true), existing = await readSupportRecord(tx, db, path);
    const fingerprint = crypto.digest('create-fingerprint', [uid, requestId, permissions]);
    if (existing && existing.recordType !== 'create_request') throw supportUnavailable();
    if (existing && existing.expiresAt > at) {
      if (existing.ownerUid !== uid || existing.requestFingerprint !== fingerprint) throw supportConflict();
      const { row } = await authorized(actor, existing.conversationId, tx, db, at);
      return { id: row.id, revision: 0 };
    }
    const row: SupportConversation = { version: 1, recordType: 'conversation', id, ownerUid: uid, createRequestDigest: requestDigest, createFingerprint: fingerprint, revision: 0, lastSequence: 0, createdAt: at, expiresAt: at + SUPPORT_CONTROL_TTL, ...permissions };
    marker(); stageSupportRecord(tx, db, 'platformSupportConversations/' + id, row);
    stageSupportRecord(tx, db, path, { version: 1, recordType: 'create_request', requestDigest, requestFingerprint: fingerprint, ownerUid: uid, conversationId: id, createdAt: at, expiresAt: row.expiresAt });
    return { id, revision: 0 };
  });
}
export async function appendSupportMessage(actor: SupportActor, id: string, input: SupportMessageInput, db: Database = getAdminDb()): Promise<{ id: string; sequence: number; revision: number }> {
  await currentSupportUser(actor); supportUuid(id);
  if (!input || !workExact(input, ['requestId', 'expectedRevision', 'text']) || !workUuid(input.requestId) || !workInteger(input.expectedRevision) || !supportText(input.text)) throw new HttpError(400, 'Mensaje no válido.');
  const crypto = supportCrypto(), at = supportNow(), requestDigest = crypto.digest('message-request', [id, actor.uid, actor.role, input.requestId]), messageId = crypto.digest('message-id', [id, actor.uid, actor.role, input.requestId]), path = 'platformSupportMessages/' + messageId;
  const requestFingerprint = crypto.digest('message-fingerprint', { requestId: input.requestId, expectedRevision: input.expectedRevision, text: input.text });
  const content = crypto.encrypt(input.text, path), prepared = actor.role === 'customer' ? await prepareSupportRecipientIdentity(db, at) : null, allocation = allocateSupportNotification(messageId, prepared);
  const result = await db.runTransaction(async tx => {
    const { row, permissions } = await authorized(actor, id, tx, db, at); await supportMarker(tx, db, crypto);
    const existing = await readSupportRecord(tx, db, path);
    if (existing) {
      if (existing.recordType !== 'message' || existing.conversationId !== id || existing.authorUid !== actor.uid || existing.author !== actor.role) throw supportUnavailable();
      if (existing.requestFingerprint !== requestFingerprint) throw supportConflict();
      return { id: existing.id, sequence: existing.sequence, revision: existing.revision };
    }
    if (row.revision !== input.expectedRevision) throw supportConflict();
    if (row.revision >= Number.MAX_SAFE_INTEGER || row.lastSequence >= Number.MAX_SAFE_INTEGER) throw supportUnavailable();
    const sequence = row.lastSequence + 1, revision = row.revision + 1;
    // Preparation completes every dependency read before staging any writes.
    if (actor.role === 'customer') await prepareSupportNotificationWithIdentity(tx, { conversationId: id, messageId, authorUid: actor.uid, at }, db, prepared, allocation);
    const message: SupportMessage = { version: 1, recordType: 'message', id: messageId, conversationId: id, authorUid: actor.uid, author: actor.role, requestDigest, requestFingerprint, sequence, revision, createdAt: at, bodyExpiresAt: Math.min(at + SUPPORT_BODY_TTL, row.expiresAt), expiresAt: Math.min(at + SUPPORT_CONTROL_TTL, row.expiresAt), bodyState: 'body_present', content, ...permissions };
    stageSupportRecord(tx, db, path, message); stageSupportRecord(tx, db, 'platformSupportConversations/' + id, { ...row, revision, lastSequence: sequence });
    return { id: messageId, sequence, revision };
  });
  if (prepared && process.env.PLATFORM_WHATSAPP_PROCESSING_ENABLED === 'true') { const { kickPlatformWhatsAppWorker } = await import('./platform-whatsapp-worker'); kickPlatformWhatsAppWorker(); }
  return result;
}
const cursorInvalid = () => new HttpError(400, 'La continuación expiró o no es válida.', 'SUPPORT_CURSOR_INVALID');
export async function readSupportMessages(actor: SupportActor, id: string, cursor: string | null, db: Database = getAdminDb()): Promise<SupportPage> {
  const identity = await currentSupportUser(actor); supportUuid(id); const crypto = supportCrypto(), at = supportNow();
  const result = await db.runTransaction(async tx => {
    const { row, permissions, owner } = await authorized(actor, id, tx, db, at); await supportMarker(tx, db, crypto);
    const binding = crypto.digest('message-cursor-binding', [actor.uid, actor.role, id, row.createdAt, permissions, owner]);
    let after = 0, through = row.lastSequence, expiry = Math.min(at + 900_000, row.expiresAt);
    if (cursor !== null) {
      const c = crypto.parse(cursor);
      if (!workExact(c, ['v', 'domain', 'binding', 'id', 'birth', 'after', 'through', 'mode', 'expiresAt']) || c.v !== 1 || c.domain !== 'messages' || c.binding !== binding || c.id !== id || c.birth !== row.createdAt || !workInteger(c.after) || !workInteger(c.through) || c.after > c.through || c.through > row.lastSequence || !['bounded', 'follow'].includes(String(c.mode)) || c.mode === 'follow' && c.after !== c.through || !workInteger(c.expiresAt) || c.expiresAt <= at || c.expiresAt > row.expiresAt || c.expiresAt > at + 900_000) throw cursorInvalid();
      after = c.after; through = c.mode === 'follow' ? row.lastSequence : c.through; expiry = c.expiresAt;
      // A follow cursor starts a fresh bounded snapshot, never extends an in-flight one.
      if (c.mode === 'follow') expiry = Math.min(at + 900_000, row.expiresAt);
    }
    const docs = await tx.get(db.collection('platformSupportMessages').where('recordType', '==', 'message').where('conversationId', '==', id).where('sequence', '>', after).where('sequence', '<=', through).orderBy('sequence', 'asc').limit(101));
    const rows = docs.docs.map(d => { const v = d.data(); if (!isSupportRecord('platformSupportMessages/' + d.id, v) || v.recordType !== 'message' || v.conversationId !== id || v.expiresAt > row.expiresAt || v.sequence <= after || v.sequence > through) throw supportUnavailable(); return v; });
    if (rows.some((r, i) => r.sequence !== after + i + 1) || rows.length < 101 && (rows.at(-1)?.sequence ?? after) !== through) throw supportUnavailable();
    const page = rows.slice(0, 100), hasMore = rows.length > 100;
    const states = await readSupportNotificationStates(tx, page, db, at);
    return { page, states, revision: row.revision, hasMore, cursor: crypto.sign({ v: 1, domain: 'messages', binding, id, birth: row.createdAt, after: hasMore ? page.at(-1)!.sequence : through, through, mode: hasMore ? 'bounded' : 'follow', expiresAt: expiry }) };
  });
  await repeatSupportUser(actor, identity);
  await db.runTransaction(async tx => { await authorized(actor, id, tx, db, supportNow()); await supportMarker(tx, db, crypto); });
  const observedAt = supportNow();
  return { messages: result.page.map(m => ({ id: m.id, sequence: m.sequence, author: m.author, text: m.bodyExpiresAt <= observedAt || m.bodyState === 'body_erased' ? null : crypto.decrypt(m.content!, 'platformSupportMessages/' + m.id), createdAt: m.createdAt, expiresAt: m.bodyExpiresAt })), cursor: result.cursor, hasMore: result.hasMore, revision: result.revision, observedAt, notificationStates: result.states };
}
export async function listSupportConversations(actor: SupportActor, cursor: string | null, db: Database = getAdminDb()): Promise<SupportConversationPage> {
  const identity = await currentSupportUser(actor), crypto = supportCrypto(), at = supportNow();
  const result = await db.runTransaction(async tx => {
    const permissions = await supportPermissions(actor.uid, tx, db); await supportMarker(tx, db, crypto, true);
    const binding = crypto.digest('list-cursor-binding', [actor.uid, actor.role, permissions]);
    let query = db.collection('platformSupportConversations').where('recordType', '==', 'conversation');
    if (actor.role === 'customer') query = query.where('ownerUid', '==', actor.uid);
    let after = '', throughId = '', expiry = at + 900_000;
    if (cursor) {
      const c = crypto.parse(cursor);
      if (!workExact(c, ['v', 'domain', 'binding', 'after', 'throughId', 'expiresAt']) || c.v !== 1 || c.domain !== 'list' || c.binding !== binding || !workUuid(c.after) || !workUuid(c.throughId) || c.after > c.throughId || !workInteger(c.expiresAt) || c.expiresAt <= at || c.expiresAt > at + 900_000) throw cursorInvalid();
      after = c.after; throughId = c.throughId; expiry = c.expiresAt;
    } else { const last = (await tx.get(query.orderBy('id', 'desc').limit(1))).docs[0]; if (last) { const v = last.data(); if (!isSupportRecord('platformSupportConversations/' + last.id, v) || v.recordType !== 'conversation') throw supportUnavailable(); throughId = v.id; } }
    if (!throughId) return { conversations: [], cursor: null, hasMore: false, observedAt: at };
    const docs = await tx.get(query.where('id', '>', after).where('id', '<=', throughId).orderBy('id', 'asc').limit(101));
    const rows = docs.docs.map(d => { const v = d.data(); if (!isSupportRecord('platformSupportConversations/' + d.id, v) || v.recordType !== 'conversation' || actor.role === 'customer' && v.ownerUid !== actor.uid) throw supportUnavailable(); return v; });
    const page = rows.slice(0, 100), conversations = [];
    for (const row of page) { if (row.expiresAt <= at) continue; try { const owner = row.ownerUid === actor.uid ? permissions : await supportPermissions(row.ownerUid, tx, db); if (!sameSupportPermissions(row, owner)) continue; } catch (e) { if (e instanceof HttpError && e.status === 428) continue; throw e; } conversations.push({ id: row.id, revision: row.revision, lastSequence: row.lastSequence, createdAt: row.createdAt, expiresAt: row.expiresAt }); }
    const hasMore = rows.length > 100;
    return { conversations, hasMore, cursor: hasMore ? crypto.sign({ v: 1, domain: 'list', binding, after: page.at(-1)!.id, throughId, expiresAt: expiry }) : null, observedAt: at };
  });
  await repeatSupportUser(actor, identity); return result;
}