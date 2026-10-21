import 'server-only';
import { z } from 'zod';
import type { Database } from '@/lib/storage/types';
import type { PlatformWhatsAppIngressResult } from '@/types/platform-whatsapp';
import {
  PLATFORM_BODY_TTL, PLATFORM_METADATA_TTL, PLATFORM_PHONE_PATTERN,
  isPlatformWhatsAppConversationRecord, isPlatformWhatsAppStoredEvent, isPlatformWhatsAppEventRecord,
  type PlatformWhatsAppScope, type PlatformWhatsAppConversationRecord, type PlatformWhatsAppStoredEvent,
  type PlatformWhatsAppEventRecord, type PlatformWhatsAppAliasRecord, type PlatformWhatsAppConflictRecord,
} from '../../../shared/platform-whatsapp-records';
import { type PlatformWhatsAppConfig, requirePlatformWhatsAppReception } from './platform-whatsapp-config';
import { encryptPlatformWhatsAppContent, platformWhatsAppDigest } from './platform-whatsapp-crypto';
import { assertPlatformWhatsAppNow, normalizePlatformWhatsAppConnection, platformWhatsAppIdentity, platformWhatsAppUnavailableError, samePlatformWhatsAppScope } from './platform-whatsapp-store';
import { HttpError } from './http';
import { validatePlatformAudioDescriptor, type AudioDescriptor } from '../../../shared/platform-whatsapp-audio';
import { parsePlatformMenuChoice } from '../../../shared/platform-whatsapp-menu';
import { preparePlatformWhatsAppAudioRetentionIdentity, readPlatformWhatsAppAudioRetentionIdentityInTransaction } from './platform-whatsapp-link';

const externalId = z.string().min(1).max(256).regex(/^[\x21-\x7e]+$/);
const eventFields = {
  provider: z.literal('ycloud'), eventId: externalId, messageId: externalId,
  whatsappMessageId: z.string().min(1).max(1024).nullable(),
  occurredAt: z.number().int().nonnegative().max(8_640_000_000_000_000 - PLATFORM_METADATA_TTL),
  wabaId: z.string(), businessPhone: z.string(), customerPhone: z.string().regex(PLATFORM_PHONE_PATTERN),
};
const eventSchema = z.discriminatedUnion('kind', [
  z.object({ ...eventFields, kind: z.literal('incoming_text'), sourceEventType: z.literal('whatsapp.inbound_message.received'), text: z.string().min(1).max(4096), customerSentAt: z.number().int().nonnegative().nullable().optional() }).strict(),
  z.object({ ...eventFields, kind: z.literal('human_echo'), sourceEventType: z.enum(['whatsapp.smb.message.echoes', 'whatsapp.smb.message.created']), messageType: z.string().min(1).max(64), text: z.string().min(1).max(4096).nullable() }).strict(),
  z.object({ ...eventFields, kind: z.literal('incoming_audio'), sourceEventType: z.literal('whatsapp.inbound_message.received'), customerSentAt: z.number().int().nonnegative().nullable(),
    audio: z.custom<AudioDescriptor>(value => { const descriptor = validatePlatformAudioDescriptor(value); return descriptor !== null && descriptor.mimeType === (value as AudioDescriptor).mimeType; }) }).strict(),
  z.object({ ...eventFields, kind: z.literal('incoming_choice'), sourceEventType: z.literal('whatsapp.inbound_message.received'), customerSentAt: z.number().int().nonnegative().nullable(), choiceId: z.string().refine(value => parsePlatformMenuChoice(value) !== null) }).strict(),
]);

/** Frozen 5649.f. The caller must authenticate the YCloud payload before this
 * normalized-event boundary. This helper neither verifies HMAC nor sends messages. */
export async function ingestPlatformWhatsAppEvent(input: unknown, config: PlatformWhatsAppConfig, database: Database, now = Date.now()): Promise<PlatformWhatsAppIngressResult> {
  assertPlatformWhatsAppNow(now);
  requirePlatformWhatsAppReception(config);
  const parsed = eventSchema.safeParse(input);
  if (!parsed.success) throw new HttpError(400, 'Evento no válido.');
  // The frozen helper validates without substituting the parsed event.
  const event = input as z.infer<typeof eventSchema>, scope = config.scope as PlatformWhatsAppScope;
  if (event.wabaId !== scope.wabaId || event.businessPhone !== scope.phoneE164 || event.customerPhone === scope.phoneE164
    || (event.kind === 'human_echo' && (event.messageType === 'text') !== (event.text !== null))
    || (event.kind !== 'human_echo' && Object.hasOwn(event, 'customerSentAt') && (event.customerSentAt === undefined || (event.customerSentAt !== null && (!Number.isSafeInteger(event.customerSentAt) || event.customerSentAt > now))))) throw new HttpError(400, 'Evento no válido.');
  const scopeParts = [scope.wabaId, scope.phoneE164, scope.phoneNumberId];
  const digest = (domain: string, parts: string[]) => platformWhatsAppDigest(domain, parts, config.contentKey);
  const conversationId = digest('conversation', [...scopeParts, event.customerPhone]);
  const canonicalIdentity = digest('canonical', [...scopeParts, event.kind, event.messageId]);
  const newKind = event.kind === 'incoming_audio' || event.kind === 'incoming_choice';
  const fingerprint = digest('semantic', newKind
    ? [...scopeParts, event.kind, event.customerPhone, JSON.stringify(event.kind === 'incoming_audio' ? [event.audio.id, event.audio.link, event.audio.sha256, event.audio.mimeType, event.customerSentAt] : [event.choiceId, event.customerSentAt])]
    : [...scopeParts, event.kind, event.customerPhone, event.kind === 'human_echo' ? event.messageType : 'text', JSON.stringify(event.text)]);
  const eventId = 'event_' + digest('event', [event.provider, event.eventId]);
  const conflictId = 'event_' + digest('conflict', [event.provider, event.eventId, fingerprint]);
  const identities = [eventId, 'message_' + digest('message', [event.provider, event.messageId]),
    ...(event.whatsappMessageId ? ['wamid_' + digest('wamid', [event.provider, event.whatsappMessageId])] : [])];
  const events = database.collection('platformWhatsAppEvents'), conversations = database.collection('platformWhatsAppConversations');
  const connectionRef = database.collection('serverSettings').doc('platform_whatsapp'), conversationRef = conversations.doc(conversationId);
  const prepared = event.kind === 'incoming_audio' ? await preparePlatformWhatsAppAudioRetentionIdentity(event.customerPhone, scope, database, now) : null;
  return database.runTransaction(async transaction => {
    const stageEvent = (id: string, value: PlatformWhatsAppStoredEvent) => {
      if (!isPlatformWhatsAppStoredEvent(value)) throw platformWhatsAppUnavailableError();
      transaction.set(events.doc(id), value);
    };
    const stageConversation = (id: string, value: PlatformWhatsAppConversationRecord) => {
      if (!isPlatformWhatsAppConversationRecord(value)) throw platformWhatsAppUnavailableError();
      transaction.set(conversations.doc(id), value);
    };
    const [connectionSnapshot, conversationSnapshot, conflictSnapshot, ...identitySnapshots] = await Promise.all([
      transaction.get(connectionRef), transaction.get(conversationRef), transaction.get(events.doc(conflictId)), ...identities.map(id => transaction.get(events.doc(id))),
    ]);
    const connection = normalizePlatformWhatsAppConnection(connectionSnapshot.data(), scope, now);
    if (connection.paused || connection.providerConnection === 'disconnected') throw platformWhatsAppUnavailableError();
    const value = conversationSnapshot.data();
    if (value !== undefined && (!isPlatformWhatsAppConversationRecord(value) || !samePlatformWhatsAppScope(value, scope))) throw platformWhatsAppUnavailableError();
    const current = value && value.expiresAt > now ? value as PlatformWhatsAppConversationRecord : null;
    const existing = new Map<string, PlatformWhatsAppStoredEvent>();
    for (let index = 0; index < identities.length; index++) {
      const value = identitySnapshots[index].data();
      if (value !== undefined && !isPlatformWhatsAppStoredEvent(value)) throw platformWhatsAppUnavailableError();
      if (value && value.expiresAt > now) existing.set(identities[index], value as PlatformWhatsAppStoredEvent);
    }
    const marker = conflictSnapshot.data();
    if (marker !== undefined && !isPlatformWhatsAppStoredEvent(marker)) throw platformWhatsAppUnavailableError();
    for (const value of [marker, existing.get(eventId)]) {
      if (value?.recordType === 'conflict' && value.expiresAt > now && value.fingerprint === fingerprint && value.conversationId === conversationId && samePlatformWhatsAppScope(value as PlatformWhatsAppConflictRecord, scope)) {
        return { outcome: 'conflict', conversationId };
      }
    }
    const canonicalIds = [...new Set([...existing].flatMap(([id, value]) => value.recordType === 'event' ? [id] : value.recordType === 'alias' ? [value.canonicalEventId] : []))];
    const canonicals = new Map<string, PlatformWhatsAppEventRecord>();
    for (const id of canonicalIds) {
      const value = existing.get(id) ?? (await transaction.get(events.doc(id))).data();
      if (!isPlatformWhatsAppEventRecord(value) || value.expiresAt <= now) throw platformWhatsAppUnavailableError();
      canonicals.set(id, value);
    }
    let conflict = canonicalIds.length > 1;
    for (const value of [...existing.values(), ...canonicals.values()]) {
      if (value.recordType === 'control' || value.recordType === 'conflict' || value.fingerprint !== fingerprint || !samePlatformWhatsAppScope(value, scope) || value.conversationId !== conversationId) conflict = true;
    }
    for (const value of canonicals.values()) {
      if ('customerSentAt' in value && (event.kind === 'human_echo' || value.customerSentAt !== event.customerSentAt)) conflict = true;
    }
    const related = new Map<string, PlatformWhatsAppConversationRecord>();
    for (const canonical of canonicals.values()) {
      if (canonical.conversationId === conversationId) continue;
      const value = (await transaction.get(conversations.doc(canonical.conversationId))).data();
      if (value !== undefined && !isPlatformWhatsAppConversationRecord(value)) throw platformWhatsAppUnavailableError();
      // Preserve v24 text/echo behavior; new control/media conflicts affect this scope only.
      if (value && value.expiresAt > now && (!newKind || samePlatformWhatsAppScope(value, scope))) related.set(canonical.conversationId, value as PlatformWhatsAppConversationRecord);
    }
    const bodyExpiresAt = Math.min(event.occurredAt, now) + PLATFORM_BODY_TTL;
    const seed: PlatformWhatsAppConversationRecord = { ...platformWhatsAppIdentity(scope), recordType: 'conversation', state: 'body_erased', mode: 'human', revision: 0,
      updatedAt: now, lastInboundAt: null, lastHumanAt: null, bodyExpiresAt, expiresAt: now + PLATFORM_METADATA_TTL,
      previewOccurredAt: event.occurredAt, previewReceivedAt: now, canonicalIdentity, contactContent: null, conflictAt: null };
    if (conflict) {
      const base = current ?? seed;
      if (current || !newKind) stageConversation(conversationId, { ...base, mode: 'review', revision: base.revision + 1, conflictAt: now });
      for (const [id, value] of related) stageConversation(id, { ...value, mode: 'review', revision: value.revision + 1, conflictAt: now });
      const record: PlatformWhatsAppConflictRecord = { ...platformWhatsAppIdentity(scope), recordType: 'conflict', state: 'metadata', conversationId, fingerprint, receivedAt: now, expiresAt: now + PLATFORM_METADATA_TTL };
      stageEvent(existing.has(eventId) ? conflictId : eventId, record);
      return { outcome: 'conflict', conversationId };
    }
    const canonical = [...canonicals][0];
    if (canonical) {
      const [id, value] = canonical;
      for (const identity of identities) {
        if (!existing.has(identity)) {
          const alias: PlatformWhatsAppAliasRecord = { ...platformWhatsAppIdentity(value), recordType: 'alias', state: 'metadata', canonicalEventId: id, conversationId, fingerprint,
            bodyExpiresAt: value.bodyExpiresAt, receivedAt: value.receivedAt, expiresAt: value.expiresAt };
          stageEvent(identity, alias);
        }
      }
      return { outcome: 'duplicate', conversationId };
    }
    const retentionIdentity = event.kind === 'incoming_audio' && prepared && prepared.conversationId === conversationId && bodyExpiresAt > now
      ? await readPlatformWhatsAppAudioRetentionIdentityInTransaction(prepared, event.customerPhone, scope, transaction, database, now) : null;
    const bodyPresent = bodyExpiresAt > now && (!newKind || retentionIdentity !== null);
    const plaintext = event.kind === 'incoming_audio' && retentionIdentity
      ? { customerPhone: event.customerPhone, audio: event.audio, retentionAnchor: { uid: retentionIdentity.uid, linkId: retentionIdentity.linkId, linkRevision: retentionIdentity.linkRevision, account: retentionIdentity.account, support: retentionIdentity.support } }
      : { customerPhone: event.customerPhone, text: event.kind === 'incoming_text' || event.kind === 'human_echo' ? event.text : null };
    const record: PlatformWhatsAppEventRecord = { ...platformWhatsAppIdentity(scope), recordType: 'event', connectionRevision: connection.connectionRevision, conversationId,
      kind: event.kind, occurredAt: event.occurredAt, canonicalIdentity, fingerprint, receivedAt: now, bodyExpiresAt, expiresAt: now + PLATFORM_METADATA_TTL,
      ...(event.kind !== 'human_echo' && Object.hasOwn(event, 'customerSentAt') ? { customerSentAt: event.customerSentAt } : {}),
      ...(newKind ? { ingressDisposition: retentionIdentity ? 'descriptor_retained' : 'control_only' } : {}),
      ...(bodyPresent ? { state: 'body_present', content: encryptPlatformWhatsAppContent(plaintext, events.doc(eventId).path, config.contentKey) } : { state: 'body_erased', content: null }) } as PlatformWhatsAppEventRecord;
    let updated: PlatformWhatsAppConversationRecord = { ...(current ?? seed), updatedAt: Math.max(current?.updatedAt ?? 0, now), expiresAt: now + PLATFORM_METADATA_TTL };
    if (event.kind !== 'human_echo') updated.lastInboundAt = Math.max(updated.lastInboundAt ?? 0, event.occurredAt);
    else updated.lastHumanAt = Math.max(updated.lastHumanAt ?? 0, event.occurredAt);
    if (!current || event.occurredAt > current.previewOccurredAt || (event.occurredAt === current.previewOccurredAt && canonicalIdentity > current.canonicalIdentity)) {
      updated = { ...updated, previewOccurredAt: event.occurredAt, previewReceivedAt: now, canonicalIdentity, bodyExpiresAt,
        ...(bodyPresent ? { state: 'body_present', contactContent: encryptPlatformWhatsAppContent(event.kind === 'incoming_audio' ? { customerPhone: event.customerPhone, text: null } : plaintext, conversationRef.path, config.contentKey) } : { state: 'body_erased', contactContent: null }) };
    }
    if (event.kind !== 'human_echo') connection.lastSignedInboundAt = Math.max(connection.lastSignedInboundAt ?? 0, event.occurredAt);
    else connection.lastHumanEchoAt = Math.max(connection.lastHumanEchoAt ?? 0, event.occurredAt);
    connection.updatedAt = Math.max(connection.updatedAt, now);
    if (!isPlatformWhatsAppEventRecord(record) || !isPlatformWhatsAppConversationRecord(updated)) throw platformWhatsAppUnavailableError();
    stageEvent(eventId, record);
    for (const id of identities.slice(1)) {
      const alias: PlatformWhatsAppAliasRecord = { ...platformWhatsAppIdentity(scope), recordType: 'alias', state: 'metadata', canonicalEventId: eventId, conversationId, fingerprint,
        bodyExpiresAt, receivedAt: now, expiresAt: record.expiresAt };
      stageEvent(id, alias);
    }
    if (!newKind || retentionIdentity) { stageConversation(conversationId, updated); transaction.set(connectionRef, connection); }
    return { outcome: 'stored', conversationId };
  });
}
