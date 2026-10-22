import 'server-only';
import { randomUUID } from 'node:crypto';
import { getAdminDb } from '@/lib/firebase/admin';
import type { Database } from '@/lib/storage/types';
import type { PlatformWhatsAppConversationList, PlatformWhatsAppConversationView } from '@/types/platform-whatsapp';
import { PLATFORM_METADATA_TTL, PLATFORM_PHONE_PATTERN, isPlatformWhatsAppConversationRecord, type PlatformWhatsAppConversationRecord, type PlatformWhatsAppControlRecord } from '../../../shared/platform-whatsapp-records';
import { getPlatformWhatsAppConfig, type PlatformWhatsAppConfig } from './platform-whatsapp-config';
import { decryptPlatformWhatsAppContent } from './platform-whatsapp-crypto';
import { assertPlatformWhatsAppNow, isPlatformWhatsAppControlReplay, platformWhatsAppConflictError, platformWhatsAppControlIdentity, platformWhatsAppConversationControlSchema,
  platformWhatsAppIdentity, platformWhatsAppIsoTime, samePlatformWhatsAppScope } from './platform-whatsapp-store';
import { HttpError } from './http';
import { preparePlatformWhatsAppAudioRetentionIdentity, readPlatformWhatsAppAudioRetentionIdentityInTransaction } from './platform-whatsapp-link';
import { actorAuthority, authorityFingerprint, freshWorkConnection } from './platform-whatsapp-work-authority';
import { readWorkCancellation, stageWorkCancellation } from './platform-whatsapp-work-cancellation';
import { stageWork } from './platform-whatsapp-work-records';
import { normalizePlatformWhatsAppConnection } from './platform-whatsapp-store';

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
  const initial = body.mode === 'bot' ? (await conversationRef.get()).data() : null;
  const shown = initial && isPlatformWhatsAppConversationRecord(initial) ? presentConversation(body.conversationId, initial, config, now) : null;
  const prepared = body.mode === 'bot' && shown?.customerPhone && config.scope ? await preparePlatformWhatsAppAudioRetentionIdentity(shown.customerPhone, config.scope, database, now) : null;
  const epoch = randomUUID();
  const updated = await database.runTransaction(async transaction => {
    const [snapshot, audit] = await Promise.all([transaction.get(conversationRef), transaction.get(auditRef)]);
    const value = snapshot.data();
    if (!config.scope || !isPlatformWhatsAppConversationRecord(value) || !samePlatformWhatsAppScope(value, config.scope) || value.expiresAt <= now) throw new HttpError(404, 'Conversación no disponible.');
    if (isPlatformWhatsAppControlReplay(audit.data(), control.fingerprint, now)) return value;
    if (value.revision !== body.expectedRevision || value.revision === Number.MAX_SAFE_INTEGER) throw platformWhatsAppConflictError();
    const cancellation = await readWorkCancellation(body.conversationId, value, transaction, database);
    const connection = body.mode === 'bot' ? normalizePlatformWhatsAppConnection((await transaction.get(database.collection('serverSettings').doc('platform_whatsapp'))).data(), config.scope, now) : null;
    const identity = body.mode === 'bot' && prepared && shown?.customerPhone ? await readPlatformWhatsAppAudioRetentionIdentityInTransaction(prepared, shown.customerPhone, value, transaction, database, now) : null;
    if (body.mode === 'bot' && (!identity || identity.conversationId !== body.conversationId || !connection || !freshWorkConnection(connection, now))) throw new HttpError(403, 'La conversación no tiene autorización vigente para el asistente.');
    const updated = { ...value, mode: body.mode, revision: value.revision + 1 };
    const record: PlatformWhatsAppControlRecord = { ...platformWhatsAppIdentity(value), recordType: 'control', state: 'conversation_control', receivedAt: now, updatedAt: now,
      expiresAt: now + PLATFORM_METADATA_TTL, actorUid, fingerprint: control.fingerprint, action: body.mode, targetId: body.conversationId, resultRevision: updated.revision };
    stageWorkCancellation(cancellation, updated.revision, transaction, database, now);
    if (body.mode === 'bot' && identity && connection) {
      const old = cancellation?.head;
      stageWork(transaction, database, 'platformWhatsAppJobs/head_' + body.conversationId, { ...platformWhatsAppIdentity(value), recordType: 'control_head', conversationId: body.conversationId, controlEpoch: old && old.expiresAt > now ? old.controlEpoch : epoch, controlRevision: old && old.expiresAt > now ? old.controlRevision + 1 : 0, connectionRevision: connection.connectionRevision, entryState: 'bot', botAuthorityFingerprint: authorityFingerprint(actorAuthority(identity)), attachedConversationRevision: updated.revision, headJobId: null, tailJobId: null, currentMenuOutboxId: null, status: 'idle', nextAttemptAt: null, receivedAt: now, expiresAt: now + PLATFORM_METADATA_TTL });
    }
    transaction.set(conversationRef, updated); transaction.set(auditRef, record);
    return updated;
  });
  if (process.env.PLATFORM_WHATSAPP_PROCESSING_ENABLED === 'true') { const { recognizePlatformWorkCancellation } = await import('./platform-whatsapp-worker'); await recognizePlatformWorkCancellation(body.conversationId); }
  return presentConversation(body.conversationId, updated, config, now);
}
