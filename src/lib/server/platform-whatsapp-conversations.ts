import 'server-only';
import { getAdminDb } from '@/lib/firebase/admin';
import type { Database } from '@/lib/storage/types';
import type { PlatformWhatsAppConversationList, PlatformWhatsAppConversationView } from '@/types/platform-whatsapp';
import { PLATFORM_METADATA_TTL, PLATFORM_PHONE_PATTERN, isPlatformWhatsAppConversationRecord, type PlatformWhatsAppConversationRecord, type PlatformWhatsAppControlRecord } from '../../../shared/platform-whatsapp-records';
import { getPlatformWhatsAppConfig, type PlatformWhatsAppConfig } from './platform-whatsapp-config';
import { decryptPlatformWhatsAppContent } from './platform-whatsapp-crypto';
import { assertPlatformWhatsAppNow, isPlatformWhatsAppControlReplay, platformWhatsAppConflictError, platformWhatsAppControlIdentity, platformWhatsAppConversationControlSchema,
  platformWhatsAppIdentity, platformWhatsAppIsoTime, samePlatformWhatsAppScope } from './platform-whatsapp-store';
import { HttpError } from './http';

function presentConversation(id: string, record: PlatformWhatsAppConversationRecord, config: PlatformWhatsAppConfig, now: number): PlatformWhatsAppConversationView {
  let customerPhone: string | null = null, lastMessage: string | null = null, contentAvailable = false;
  if (record.state === 'body_present' && record.bodyExpiresAt > now && config.contentKey.length === 32) {
    try {
      const payload = decryptPlatformWhatsAppContent(record.contactContent, `platformWhatsAppConversations/${id}`, config.contentKey) as { customerPhone?: unknown; text?: unknown } | null;
      // v24 presentation uses UTF-16 length; ingress Zod counts codepoints.
      if (payload && typeof payload.customerPhone === 'string' && PLATFORM_PHONE_PATTERN.test(payload.customerPhone)
        && (payload.text === null || (typeof payload.text === 'string' && payload.text.length <= 4096))) {
        customerPhone = payload.customerPhone; lastMessage = payload.text; contentAvailable = true;
      }
    } catch { /* Invalid or unavailable private content is hidden without mutation. */ }
  }
  return { id, mode: record.mode, revision: record.revision, updatedAt: new Date(record.updatedAt).toISOString(), lastInboundAt: platformWhatsAppIsoTime(record.lastInboundAt),
    lastHumanAt: platformWhatsAppIsoTime(record.lastHumanAt), customerName: null, customerPhone, lastMessage, contentAvailable,
    contentExpiresAt: new Date(record.bodyExpiresAt).toISOString(), contentObservedAt: new Date(now).toISOString() };
}
/** Frozen 50437.I. This bounded private view does not require reception enabled. */
export async function listPlatformWhatsAppConversations(database: Database = getAdminDb(), now = Date.now()): Promise<PlatformWhatsAppConversationList> {
  assertPlatformWhatsAppNow(now);
  const config = getPlatformWhatsAppConfig();
  if (!config.scope) return { conversations: [], truncated: true, observedAt: new Date(now).toISOString() };
  const snapshot = await database.collection('platformWhatsAppConversations').where('phoneNumberId', '==', config.scope.phoneNumberId).orderBy('updatedAt', 'desc').limit(101).get();
  let truncated = snapshot.docs.length > 100;
  const conversations: PlatformWhatsAppConversationView[] = [];
  for (const doc of snapshot.docs) {
    const value = doc.data();
    if (!/^[a-f0-9]{64}$/.test(doc.id) || !isPlatformWhatsAppConversationRecord(value) || !samePlatformWhatsAppScope(value, config.scope) || value.expiresAt <= now) {
      truncated = true; continue;
    }
    if (conversations.length < 100) conversations.push(presentConversation(doc.id, value, config, now));
  }
  return { conversations, truncated, observedAt: new Date(now).toISOString() };
}
/** Frozen 50437.c. The caller supplies an authenticated administrator UID. */
export async function applyPlatformWhatsAppConversationControl(input: unknown, actorUid: string, database: Database = getAdminDb(), now = Date.now()): Promise<PlatformWhatsAppConversationView> {
  assertPlatformWhatsAppNow(now);
  const parsed = platformWhatsAppConversationControlSchema.safeParse(input);
  if (!parsed.success) throw new HttpError(400, 'Control no válido.');
  const body = parsed.data, config = getPlatformWhatsAppConfig(), control = platformWhatsAppControlIdentity(actorUid, body.requestId, body);
  const conversationRef = database.collection('platformWhatsAppConversations').doc(body.conversationId), auditRef = database.collection('platformWhatsAppEvents').doc(control.id);
  const updated = await database.runTransaction(async transaction => {
    const [snapshot, audit] = await Promise.all([transaction.get(conversationRef), transaction.get(auditRef)]);
    const value = snapshot.data();
    if (!config.scope || !isPlatformWhatsAppConversationRecord(value) || !samePlatformWhatsAppScope(value, config.scope) || value.expiresAt <= now) throw new HttpError(404, 'Conversación no disponible.');
    if (isPlatformWhatsAppControlReplay(audit.data(), control.fingerprint, now)) return value;
    if (value.revision !== body.expectedRevision || value.revision === Number.MAX_SAFE_INTEGER) throw platformWhatsAppConflictError();
    const updated = { ...value, mode: body.mode, revision: value.revision + 1 };
    const record: PlatformWhatsAppControlRecord = { ...platformWhatsAppIdentity(value), recordType: 'control', state: 'conversation_control', receivedAt: now, updatedAt: now,
      expiresAt: now + PLATFORM_METADATA_TTL, actorUid, fingerprint: control.fingerprint, action: body.mode, targetId: body.conversationId, resultRevision: updated.revision };
    transaction.set(conversationRef, updated); transaction.set(auditRef, record);
    return updated;
  });
  return presentConversation(body.conversationId, updated, config, now);
}
